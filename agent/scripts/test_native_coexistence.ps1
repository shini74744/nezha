param([Parameter(Mandatory=$true)][string]$Binary, [Parameter(Mandatory=$true)][string]$OldBinary)
# Real installers and services, only on a disposable GitHub-hosted Windows runner.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
function Assert($condition, $message) { if (-not $condition) { throw $message } }
Assert ($env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted') 'Disposable runner required'
foreach ($p in @('C:\nezha','C:\DDnezha')) { Assert (-not (Test-Path -LiteralPath $p)) "Existing path: $p; refusing test" }
Assert (@(Get-Service -Name 'DDnezha','nezha-agent','nezha-agent.exe' -ErrorAction SilentlyContinue).Count -eq 0) 'Existing service: refusing test'
$work = Join-Path $env:RUNNER_TEMP ('ddnezha-native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$officialZIP = Join-Path $work 'official.zip'
Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing 'https://github.com/nezhahq/agent/releases/download/v2.3.5/nezha-agent_windows_amd64.zip' -OutFile $officialZIP
Assert ((Get-FileHash -LiteralPath $officialZIP -Algorithm SHA256).Hash.ToLowerInvariant() -eq '557afdc7666fb3a38fe9d492365de10f94f86ef96b7301b70b35056395d3293c') 'Official checksum mismatch'
$officialScript = Join-Path $work 'official.ps1'
Microsoft.PowerShell.Utility\Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/nezhahq/scripts/a606b570f6da4181bc1f44348d4d1885e8caccdf/agent/install.ps1' -OutFile $officialScript
# The upstream script recursively removes C:\temp, which already belongs to
# the hosted runner. Relocate ONLY its disposable archive/extraction paths;
# its install directory, service commands and binary remain upstream originals.
$officialSource = Get-Content -LiteralPath $officialScript -Raw
Assert ($officialSource.Contains('C:\temp') -and $officialSource.Contains('C:\nezha.zip')) 'Upstream temporary-path contract changed'
$officialSource = $officialSource.Replace('C:\temp',(Join-Path $work 'official-extract')).Replace('C:\nezha.zip',(Join-Path $work 'official-download.zip'))
Assert (-not $officialSource.Contains('C:\temp') -and -not $officialSource.Contains('C:\nezha.zip')) 'Unsafe temporary path remains'
$officialSource | Set-Content -LiteralPath $officialScript -Encoding utf8
foreach ($item in @(@('1.0.1',$OldBinary),@('1.0.2',$Binary))) {
 $stage = Join-Path $work $item[0]
 New-Item -ItemType Directory -Path $stage | Out-Null
 Copy-Item -LiteralPath $item[1] -Destination (Join-Path $stage 'DDnezha.exe')
 Compress-Archive -LiteralPath (Join-Path $stage 'DDnezha.exe') -DestinationPath (Join-Path $work ($item[0]+'.zip'))
}
$global:DDNZTestVersion = '1.0.1'
function Invoke-WebRequest {
 param([Parameter(Position=0)][string]$Uri,[switch]$UseBasicParsing,[string]$OutFile,[int]$TimeoutSec)
 if ($Uri -eq 'https://api.github.com/repos/nezhahq/agent/releases') { return '[{"tag_name":"v2.3.5"}]' }
 if ($Uri -eq 'https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt') { return [pscustomobject]@{Content=('v'+$global:DDNZTestVersion)} }
 if ($Uri -eq 'https://github.com/nezhahq/agent/releases/download/v2.3.5/nezha-agent_windows_amd64.zip') {
  Copy-Item -LiteralPath $officialZIP -Destination $OutFile; return
 }
 $expected = 'https://github.com/shini74744/nezha/releases/download/agent-v'+$global:DDNZTestVersion+'/DDnezha_windows_amd64.zip'
 Assert ($Uri -ceq $expected -or $Uri -ceq ($expected+'.sha256')) "Unexpected download: $Uri"
 $zip = Join-Path $work ($global:DDNZTestVersion+'.zip')
 if ($Uri.EndsWith('.sha256')) { (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash | Set-Content -LiteralPath $OutFile -Encoding ascii }
 else { Copy-Item -LiteralPath $zip -Destination $OutFile }
}
function Invoke-RestMethod { param([string]$Uri,[int]$TimeoutSec,[switch]$UseBasicParsing); Assert ($Uri -like '*/cdn-cgi/trace') 'Unexpected region query'; return "loc=US" }
$env:DDNZ_SERVER='127.0.0.1:1';$env:DDNZ_CLIENT_SECRET='DDNZ-fixture-key';$env:DDNZ_UUID='11111111-1111-4111-8111-111111111111'
$env:DDNZ_TLS='false';$env:DDNZ_DISABLE_AUTO_UPDATE='true';$env:DDNZ_DISABLE_FORCE_UPDATE='true';$env:DDNZ_DISABLE_COMMAND_EXECUTE='true'
$env:NZ_SERVER='127.0.0.1:1';$env:NZ_CLIENT_SECRET='NZ-fixture-key';$env:NZ_UUID='22222222-2222-4222-8222-222222222222'
$env:NZ_TLS='false';$env:NZ_DISABLE_AUTO_UPDATE='true';$env:NZ_DISABLE_FORCE_UPDATE='true';$env:NZ_DISABLE_COMMAND_EXECUTE='true'
$new='C:\DDnezha\DDnezha.exe';$old='C:\nezha\nezha-agent.exe'
$ownScript=Join-Path $PSScriptRoot 'install.ps1'
function Service-Pid([string]$binary,[string]$config) {
 $matches = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -and $_.PathName.Contains($binary) -and $_.PathName.Contains($config) })
 if ($matches.Count -eq 0) { return 0 }
 Assert ($matches.Count -eq 1) 'Ambiguous service'
 return [int]$matches[0].ProcessId
}
function Wait-Running([string]$binary,[string]$config) {
 for ($i=0;$i -lt 40;$i++) { if ((Service-Pid $binary $config) -gt 0) { return }; Start-Sleep -Milliseconds 500 }
 throw "Service did not run: $binary"
}
function Snapshot([string]$dir) {
 return (@(Get-ChildItem -LiteralPath $dir -File -Recurse | Sort-Object FullName | ForEach-Object { $_.FullName+':'+(Get-FileHash -LiteralPath $_.FullName).Hash }) -join '\n')
}
function Unchanged([string]$dir,[string]$before,[string]$binary,[string]$config,[int]$process) {
 Assert ((Snapshot $dir) -ceq $before) 'Other installation files changed'
 Assert ((Service-Pid $binary $config) -eq $process -and $process -gt 0) 'Other service restarted/stopped'
}
$cfgNew='C:\DDnezha\config.yml';$cfgOld='C:\nezha\config.yml'
try {
 & $ownScript
 Wait-Running $new $cfgNew
 $ownBefore=Snapshot 'C:\DDnezha';$ownPid=Service-Pid $new $cfgNew
 & $officialScript
 Wait-Running $old $cfgOld
 Unchanged 'C:\DDnezha' $ownBefore $new $cfgNew $ownPid
 $officialBefore=Snapshot 'C:\nezha';$officialPid=Service-Pid $old $cfgOld
 $identity=(Get-FileHash -LiteralPath $cfgNew).Hash
 $global:DDNZTestVersion='1.0.2'
 & $ownScript
 Wait-Running $new $cfgNew
 Assert ((& $new -v) -ceq 'DDnezha version 1.0.2') 'Upgrade version mismatch'
 Assert ((Get-FileHash -LiteralPath $cfgNew).Hash -eq $identity) 'Own identity changed'
 Unchanged 'C:\nezha' $officialBefore $old $cfgOld $officialPid
 & $ownScript uninstall
 Assert (-not (Test-Path -LiteralPath $cfgNew)) 'Own config not removed'
 Unchanged 'C:\nezha' $officialBefore $old $cfgOld $officialPid
 Write-Host 'OWN_UPGRADE_UNINSTALL_PRESERVES_OFFICIAL_PASS'
 & $ownScript
 Wait-Running $new $cfgNew
 $ownBefore=Snapshot 'C:\DDnezha';$ownPid=Service-Pid $new $cfgNew
 # The official reinstall script removes and recreates C:\nezha.
 & $officialScript
 Wait-Running $old $cfgOld
 Unchanged 'C:\DDnezha' $ownBefore $new $cfgNew $ownPid
 & $old service uninstall
 Assert ($LASTEXITCODE -eq 0) 'Official uninstall failed'
 Unchanged 'C:\DDnezha' $ownBefore $new $cfgNew $ownPid
 Write-Host 'OFFICIAL_REINSTALL_UNINSTALL_PRESERVES_OWN_PASS'
 & $ownScript uninstall
 & $ownScript uninstall
 Write-Host 'NATIVE_WINDOWS_COEXISTENCE_PASS'
} finally {
 foreach ($dir in @('C:\DDnezha','C:\nezha')) {
  $binary=if($dir -eq 'C:\DDnezha'){$new}else{$old}
  if (Test-Path -LiteralPath $binary) {
   foreach($cfg in @(Get-ChildItem -LiteralPath $dir -Filter '*config*.yml' -File)) {
    & $binary service -c $cfg.FullName stop
    & $binary service -c $cfg.FullName uninstall
   }
  }
 }
}
