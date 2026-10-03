# shini74744/agent only. Run in an elevated PowerShell window.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run PowerShell as Administrator.'
}
Write-Host '安装脚本 install.ps1 已就绪' -ForegroundColor Green
$cpu = $env:PROCESSOR_ARCHITEW6432
if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
switch ($cpu.ToUpperInvariant()) {
    'AMD64' { $arch = 'amd64' }
    'ARM64' { $arch = 'arm64' }
    'X86' { $arch = '386' }
    default { throw "Unsupported architecture: $cpu" }
}
$dir = 'C:\nezha'
$binary = Join-Path $dir 'nezha-agent.exe'
$config = Join-Path $dir 'config.yml'
if (-not (Test-Path -LiteralPath $config)) {
    if (-not $env:NZ_SERVER -or -not $env:NZ_CLIENT_SECRET) { throw 'NZ_SERVER and NZ_CLIENT_SECRET are required.' }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('nezha-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$asset = "nezha-agent_windows_$arch.zip"
$base = 'https://github.com/shini74744/agent/releases/latest/download'
$archive = Join-Path $tmp $asset
$checksum = Join-Path $tmp 'checksum'
$extracted = Join-Path $tmp 'unzipped'
$backup = $null
$changed = $false
try {
    Invoke-WebRequest -UseBasicParsing "$base/$asset.sha256" -OutFile $checksum
    Write-Host '校验文件下载成功' -ForegroundColor Green
    Invoke-WebRequest -UseBasicParsing "$base/$asset" -OutFile $archive
    Write-Host 'Agent 程序下载成功' -ForegroundColor Green
    $expected = (Get-Content -LiteralPath $checksum -Raw).Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
        throw 'SHA256 mismatch; existing agent unchanged.'
    }
    Write-Host 'Agent 文件 SHA-256 校验成功' -ForegroundColor Green
    Expand-Archive -LiteralPath $archive -DestinationPath $extracted
    $newBinary = Join-Path $extracted 'nezha-agent.exe'
    & $newBinary -v
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded agent cannot run.' }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $backup = Join-Path $dir ('backup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    # Configuration contains credentials: limit backup access to SYSTEM/Administrators.
    & icacls.exe $backup /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot secure backup directory.' }
    if (Test-Path -LiteralPath $binary) { Copy-Item -LiteralPath $binary -Destination $backup }
    if (Test-Path -LiteralPath $config) { Copy-Item -LiteralPath $config -Destination $backup }
    if (Test-Path -LiteralPath $binary) { & $binary service stop }
    $changed = $true
    Copy-Item -LiteralPath $newBinary -Destination $binary -Force
    & $binary service uninstall
    & $binary service install
    if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
    & $binary service start
    if ($LASTEXITCODE -ne 0) { throw 'Service start failed.' }
    Write-Host "Installed from shini74744/agent. Backup: $backup"
} catch {
    if ($changed -and $backup -and (Test-Path -LiteralPath (Join-Path $backup 'nezha-agent.exe'))) {
        Copy-Item -LiteralPath (Join-Path $backup 'nezha-agent.exe') -Destination $binary -Force
        if (Test-Path -LiteralPath (Join-Path $backup 'config.yml')) {
            Copy-Item -LiteralPath (Join-Path $backup 'config.yml') -Destination $config -Force
        }
        & $binary service install
        & $binary service start
    }
    throw
} finally {
    # Only remove the unique directory created by this invocation.
    $resolved = [IO.Path]::GetFullPath($tmp)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^nezha-install-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
