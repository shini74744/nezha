# Offline native-Windows installer tests. All services, downloads and paths are fixtures.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$workspace = Join-Path ([IO.Path]::GetTempPath()) ('nezha-installer-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workspace | Out-Null
function Assert($value, $message) { if (-not $value) { throw $message } }
try {
    $fixtureGo = Join-Path $workspace 'fixture.go'
    @'
package main
import ("fmt"; "os"; "path/filepath"; "strings")
var version string
func main() {
 if len(os.Args)>1 && os.Args[1]=="-v" { fmt.Printf("%s version %s\n",filepath.Base(os.Args[0]),version); return }
 f,e:=os.OpenFile(os.Getenv("INSTALLER_CALL_LOG"),os.O_CREATE|os.O_WRONLY|os.O_APPEND,0600)
 if e!=nil { panic(e) }; fmt.Fprintln(f,version+" "+strings.Join(os.Args[1:]," ")); f.Close()
 if version=="1.0.1" && os.Getenv("INSTALLER_FAIL_INSTALL")=="1" && len(os.Args)>2 && os.Args[2]=="install" { os.Exit(1) }
}
'@ | Set-Content -LiteralPath $fixtureGo -Encoding utf8
    $old = Join-Path $workspace 'old.exe'
    $new = Join-Path $workspace 'nezha-agent.exe'
    & go build -ldflags '-X main.version=1.0.0' -o $old $fixtureGo
    Assert ($LASTEXITCODE -eq 0) 'Fixture build failed'
    & go build -ldflags '-X main.version=1.0.1' -o $new $fixtureGo
    Assert ($LASTEXITCODE -eq 0) 'Fixture build failed'
    $zip = Join-Path $workspace 'fixture.zip'
    Compress-Archive -LiteralPath $new -DestinationPath $zip
    $zipHash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    $oldHash = (Get-FileHash -LiteralPath $old -Algorithm SHA256).Hash
    $newHash = (Get-FileHash -LiteralPath $new -Algorithm SHA256).Hash
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Raw
    $source = [regex]::Replace($source, '(?s)\$identity =.*?(?=Write-Host)', '')
    $source = $source.Replace('$dir = ''C:\nezha''', '$dir = $env:INSTALLER_TEST_DIR')
    Assert ($source.Contains('$dir = $env:INSTALLER_TEST_DIR')) 'Fixture path replacement failed'
    $scriptUnderTest = Join-Path $workspace 'install.ps1'
    $source | Set-Content -LiteralPath $scriptUnderTest -Encoding utf8
    function Invoke-WebRequest {
        param([Parameter(Position=0)][string]$Uri, [switch]$UseBasicParsing, [string]$OutFile)
        if ($Uri -ceq 'https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt') {
            return [pscustomobject]@{Content=$script:pointer}
        }
        $expected = "https://github.com/shini74744/nezha/releases/download/agent-$script:pointer/nezha-agent_windows_amd64.zip"
        Assert ($Uri -ceq $expected -or $Uri -ceq "$expected.sha256") 'Installer requested a wrong repository/component'
        if ($script:caseName -eq 'download') { throw 'fixture HTTP failure' }
        if ($Uri.EndsWith('.sha256')) { $script:checksum | Set-Content -LiteralPath $OutFile -Encoding ascii }
        else { Copy-Item -LiteralPath $script:zip -Destination $OutFile }
    }
    function icacls.exe { $global:LASTEXITCODE = 0 }
    foreach ($script:caseName in @('new','existing','checksum','version','download','rollback')) {
        $dir = Join-Path $workspace $script:caseName
        New-Item -ItemType Directory -Path $dir | Out-Null
        $env:INSTALLER_TEST_DIR = $dir
        $env:INSTALLER_CALL_LOG = Join-Path $dir 'calls.log'
        $env:INSTALLER_FAIL_INSTALL = if ($script:caseName -eq 'rollback') {'1'} else {'0'}
        $env:PROCESSOR_ARCHITECTURE = 'AMD64'
        $env:PROCESSOR_ARCHITEW6432 = 'AMD64'
        $env:NZ_SERVER='fixture.invalid:443'; $env:NZ_CLIENT_SECRET='fixture-only-secret'
        $env:NZ_UUID='11111111-1111-4111-8111-111111111111'
        $script:pointer = if ($script:caseName -eq 'version') {'v1.0.2'} else {'v1.0.1'}
        $script:checksum = if ($script:caseName -eq 'checksum') {'0'*64} else {$zipHash}
        $existing = $script:caseName -ne 'new'
        $config = Join-Path $dir 'config.yml'
        $target = Join-Path $dir 'nezha-agent.exe'
        if ($existing) {
            Copy-Item -LiteralPath $old -Destination $target
            "uuid: keep-own-uuid\nclient_secret: keep-own-key" | Set-Content -LiteralPath $config
            $configBefore = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
        }
        $failed = $false
        try { & $scriptUnderTest } catch { $failed = $true }
        $expectFailure = $script:caseName -notin @('new','existing')
        Assert ($failed -eq $expectFailure) "Unexpected installer result: $script:caseName"
        $wanted = if ($expectFailure) {$oldHash} else {$newHash}
        Assert ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $wanted) "Wrong final binary: $script:caseName"
        if ($existing) { Assert ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -eq $configBefore) 'UUID/config changed' }
        if ($script:caseName -in @('checksum','version','download')) {
            Assert (-not (Test-Path -LiteralPath $env:INSTALLER_CALL_LOG)) 'Service called before download/version verification'
        }
        Write-Host "PASS Windows installer $script:caseName"
    }
} finally {
    $resolved = [IO.Path]::GetFullPath($workspace)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^nezha-installer-test-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
