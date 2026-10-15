# Offline native-Windows installer tests. All services, downloads and paths are fixtures.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$workspace = Join-Path ([IO.Path]::GetTempPath()) ('DDnezha-installer-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workspace | Out-Null
function Assert($value, $message) { if (-not $value) { throw $message } }
try {
    $fixtureGo = Join-Path $workspace 'fixture.go'
    @'
package main
import ("fmt"; "os"; "strings")
var version string
func main() {
 if len(os.Args)>1 && os.Args[1]=="-v" { fmt.Printf("DDnezha version %s\n",version); return }
 f,e:=os.OpenFile(os.Getenv("INSTALLER_CALL_LOG"),os.O_CREATE|os.O_WRONLY|os.O_APPEND,0600)
 if e!=nil { panic(e) }; fmt.Fprintln(f,version+" "+strings.Join(os.Args[1:]," ")); f.Close()
 if version=="1.0.1" && os.Getenv("INSTALLER_FAIL_INSTALL")=="1" && len(os.Args)>2 && os.Args[2]=="install" { os.Exit(1) }
 if os.Getenv("INSTALLER_FAIL_UNINSTALL")=="1" && os.Args[len(os.Args)-1]=="uninstall" { os.Exit(1) }
}
'@ | Set-Content -LiteralPath $fixtureGo -Encoding utf8
    $old = Join-Path $workspace 'old.exe'
    $new = Join-Path $workspace 'DDnezha.exe'
    & go build -ldflags '-X main.version=1.0.0' -o $old $fixtureGo
    Assert ($LASTEXITCODE -eq 0) 'Fixture build failed'
    & go build -ldflags '-X main.version=1.0.1' -o $new $fixtureGo
    Assert ($LASTEXITCODE -eq 0) 'Fixture build failed'
    $zip = Join-Path $workspace 'fixture.zip'
    Compress-Archive -LiteralPath $new -DestinationPath $zip
    $env:INSTALLER_ZIP = $zip
    $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    $oldHash = (Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash
    $newHash = (Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Raw
    $source = [regex]::Replace($source, '(?s)\$identity =.*?(?=Write-Host)', '')
    $source = $source.Replace('$dir = ''C:\DDnezha''', '$dir = $env:INSTALLER_TEST_DIR')
    Assert ($source.Contains('$dir = $env:INSTALLER_TEST_DIR')) 'Fixture path replacement failed'
    $scriptUnderTest = Join-Path $workspace 'install.ps1'
    $source | Set-Content -LiteralPath $scriptUnderTest -Encoding utf8
    function Invoke-WebRequest {
        param([Parameter(Position=0)][string]$Uri, [switch]$UseBasicParsing, [string]$OutFile)
        if ($Uri -ceq 'https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt') {
            return [pscustomobject]@{Content=$env:INSTALLER_POINTER}
        }
        $expected = "https://github.com/shini74744/nezha/releases/download/agent-$env:INSTALLER_POINTER/DDnezha_windows_amd64.zip"
        Assert ($Uri -ceq $expected -or $Uri -ceq "$expected.sha256") 'Installer requested a wrong repository/component'
        if ($env:INSTALLER_CASE -eq 'download') { throw 'fixture HTTP failure' }
        if ($Uri.EndsWith('.sha256')) { $env:INSTALLER_CHECKSUM | Set-Content -LiteralPath $OutFile -Encoding ascii }
        else { Copy-Item -LiteralPath $env:INSTALLER_ZIP -Destination $OutFile }
    }
    function icacls.exe { $global:LASTEXITCODE = 0 }
    foreach ($env:INSTALLER_CASE in @('new','existing','checksum','version','download','rollback','foreign-script','script-directory')) {
        $dir = Join-Path $workspace $env:INSTALLER_CASE
        New-Item -ItemType Directory -Path $dir | Out-Null
        $env:INSTALLER_TEST_DIR = $dir
        $env:INSTALLER_CALL_LOG = Join-Path $dir 'calls.log'
        $env:INSTALLER_FAIL_INSTALL = if ($env:INSTALLER_CASE -eq 'rollback') {'1'} else {'0'}
        $env:PROCESSOR_ARCHITECTURE = 'AMD64'
        $env:PROCESSOR_ARCHITEW6432 = 'AMD64'
        $env:DDNZ_SERVER='fixture.invalid:443'; $env:DDNZ_CLIENT_SECRET='fixture-only-secret'
        $env:DDNZ_UUID='11111111-1111-4111-8111-111111111111'
        $env:INSTALLER_POINTER = if ($env:INSTALLER_CASE -eq 'version') {'v1.0.2'} else {'v1.0.1'}
        $env:INSTALLER_CHECKSUM = if ($env:INSTALLER_CASE -eq 'checksum') {'0'*64} else {$zipHash}
        $existing = $env:INSTALLER_CASE -ne 'new'
        $config = Join-Path $dir 'config.yml'
        $target = Join-Path $dir 'DDnezha.exe'
        if ($existing) {
            "DDnezha" | Set-Content -LiteralPath (Join-Path $dir ".DDnezha-owned") -Encoding ascii
            Copy-Item -LiteralPath $old -Destination $target
            "uuid: keep-own-uuid\nclient_secret: keep-own-key" | Set-Content -LiteralPath $config
            $configBefore = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
        }
        $savedInstaller = Join-Path $dir 'agent.ps1'
        if ($existing) {
            "# DDnezha-owned-agent-installer-v1`n# previously saved own installer" | Set-Content -LiteralPath $savedInstaller -Encoding utf8
        }
        if ($env:INSTALLER_CASE -eq 'foreign-script') { 'official installer - never overwrite' | Set-Content -LiteralPath $savedInstaller }
        if ($env:INSTALLER_CASE -eq 'script-directory') {
            Remove-Item -LiteralPath $savedInstaller
            New-Item -ItemType Directory -Path $savedInstaller | Out-Null
        }
        $savedBefore = if ($existing -and $env:INSTALLER_CASE -ne 'script-directory') { (Get-FileHash -LiteralPath $savedInstaller).Hash } else { $null }
        $failed = $false
        try { & $scriptUnderTest } catch { $failed = $true; Write-Host ("Fixture caught: " + $_.Exception.Message + " at " + $_.InvocationInfo.PositionMessage) }
        $expectFailure = $env:INSTALLER_CASE -notin @('new','existing')
        Assert ($failed -eq $expectFailure) "Unexpected installer result: $env:INSTALLER_CASE"
        $wanted = if ($expectFailure) {$oldHash} else {$newHash}
        Assert ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $wanted) "Wrong final binary: $env:INSTALLER_CASE"
        if ($existing) { Assert ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -eq $configBefore) 'UUID/config changed' }
        if (-not $expectFailure) {
            Assert ((Get-FileHash -LiteralPath $savedInstaller).Hash -eq (Get-FileHash -LiteralPath $scriptUnderTest).Hash) 'Saved installer differs from executed script'
            & $savedInstaller
            Assert ((Get-FileHash -LiteralPath $savedInstaller).Hash -eq (Get-FileHash -LiteralPath $scriptUnderTest).Hash) 'Saved installer cannot safely replace itself'
        } elseif ($savedBefore) {
            Assert ((Get-FileHash -LiteralPath $savedInstaller).Hash -eq $savedBefore) 'Failed update changed saved script'
        } else {
            Assert (Test-Path -LiteralPath $savedInstaller -PathType Container) 'Foreign directory changed'
        }
        if ($env:INSTALLER_CASE -in @('checksum','version','download','foreign-script','script-directory')) {
            Assert (-not (Test-Path -LiteralPath $env:INSTALLER_CALL_LOG)) 'Service called before download/version verification'
        }
        Write-Host "PASS Windows installer $env:INSTALLER_CASE"
    }
    $official = Join-Path $workspace 'official'
    New-Item -ItemType Directory -Path $official | Out-Null
    $officialConfig = Join-Path $official 'config.yml'
    'official configuration unchanged' | Set-Content -LiteralPath $officialConfig
    Copy-Item -LiteralPath $old -Destination (Join-Path $official 'nezha-agent.exe')
    $officialHash = (Get-FileHash -LiteralPath $officialConfig).Hash
    foreach ($case in @('uninstall','uninstall-failure','missing-marker')) {
        $dir = Join-Path $workspace $case
        New-Item -ItemType Directory -Path $dir | Out-Null
        $env:INSTALLER_TEST_DIR = $dir
        $env:INSTALLER_CALL_LOG = Join-Path $dir 'calls.log'
        $env:INSTALLER_FAIL_INSTALL = '0'
        $env:INSTALLER_FAIL_UNINSTALL = if ($case -eq 'uninstall-failure') {'1'} else {'0'}
        $env:INSTALLER_CASE = 'download' # Any network access must fail.
        $env:DDNZ_SERVER = ''; $env:DDNZ_CLIENT_SECRET = ''
        $config = Join-Path $dir 'config.yml'
        Copy-Item -LiteralPath $new -Destination (Join-Path $dir 'DDnezha.exe')
        'uuid: fixture-preserve' | Set-Content -LiteralPath $config
        if ($case -ne 'missing-marker') {
            'DDnezha' | Set-Content -LiteralPath (Join-Path $dir '.DDnezha-owned') -Encoding ascii
        }
        $failed = $false
        try { & $scriptUnderTest uninstall } catch { $failed = $true }
        Assert ($failed -eq ($case -ne 'uninstall')) "Unexpected uninstall result: $case"
        Assert ((Test-Path -LiteralPath $config) -eq ($case -ne 'uninstall')) "Incorrect configuration removal: $case"
        Assert (Test-Path -LiteralPath (Join-Path $dir 'DDnezha.exe')) 'Uninstall removed binary'
        Assert ((Get-FileHash -LiteralPath $officialConfig).Hash -eq $officialHash) 'Official configuration changed'
        Assert ((Get-FileHash -LiteralPath (Join-Path $official 'nezha-agent.exe')).Hash -eq $oldHash) 'Official executable changed'
        if ($case -eq 'missing-marker') { Assert (-not (Test-Path -LiteralPath $env:INSTALLER_CALL_LOG)) 'Unverified service was called' }
        if ($case -eq 'uninstall') { & $scriptUnderTest uninstall }
        Write-Host "PASS Windows isolation $case"
    }
    # Expected native failure fixtures leave LASTEXITCODE=1. All assertions passed;
    # do not let the GitHub PowerShell wrapper treat that stale value as failure.
    $global:LASTEXITCODE = 0
} finally {
    $resolved = [IO.Path]::GetFullPath($workspace)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^DDnezha-installer-test-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
