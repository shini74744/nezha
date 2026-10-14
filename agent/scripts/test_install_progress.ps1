param([string]$ScriptPath = (Join-Path $PSScriptRoot 'install.ps1'))
$ErrorActionPreference = 'Stop'
# Load the built-in module before mocks, including on Windows PowerShell 5.1.
Import-Module Microsoft.PowerShell.Utility
$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$source = [IO.File]::ReadAllText($ScriptPath)
# Extract only readiness, architecture, download and checksum statements.
# Never run installation, privilege checks, service commands or cleanup.
$ready = [regex]::Match($source, "(?m)^Write-Host '安装脚本.*$").Value
$start = $source.IndexOf('    Invoke-WebRequest')
$end = $source.IndexOf('    Expand-Archive')
if (-not $ready -or $start -lt 0 -or $end -le $start) { throw 'Missing test blocks' }
$block = [scriptblock]::Create($ready + "`n" + $source.Substring($start, $end - $start))
$expectedMessages = @('安装脚本 install.ps1 已就绪', '校验文件下载成功', 'Agent 程序下载成功', 'Agent 文件 SHA-256 校验成功')
function Write-Host {
    param([string]$Object, [string]$ForegroundColor)
    if ($ForegroundColor -ne 'Green') { throw 'Success is not green' }
    $script:messages.Add($Object)
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    $script:downloads++
    if (($script:mode -eq 'checksum-download' -and $script:downloads -eq 1) -or
        ($script:mode -eq 'archive-download' -and $script:downloads -eq 2)) { throw 'Simulated network failure' }
}
function Get-Content {
    param([string]$LiteralPath, [switch]$Raw)
    if ($script:mode -eq 'invalid-checksum') { return 'invalid' }
    return ('a' * 64)
}
function Get-FileHash {
    param([string]$LiteralPath, [string]$Algorithm)
    if ($Algorithm -ne 'SHA256') { throw 'Wrong algorithm' }
    if ($script:mode -eq 'mismatch') { return @{Hash=('b' * 64)} }
    return @{Hash=('a' * 64)}
}
$base = 'https://example.invalid'
$asset = 'fixture.zip'
$checksum = 'not-a-real-checksum-file'
$archive = 'not-a-real-archive'
foreach ($case in @(@('success',4), @('checksum-download',1), @('archive-download',2), @('invalid-checksum',3), @('mismatch',3))) {
    $script:mode = $case[0]
    $script:downloads = 0
    $script:messages = New-Object 'System.Collections.Generic.List[string]'
    $failed = $false
    $failureReason = ''
    try { & $block } catch { $failed = $true; $failureReason = $_.Exception.Message }
    if ($failed -ne ($script:mode -ne 'success')) { throw "Unexpected result: $script:mode $failureReason" }
    if ($script:messages.Count -ne $case[1]) { throw "Incorrect success count: $script:mode" }
    for ($i = 0; $i -lt $script:messages.Count; $i++) {
        if ($script:messages[$i] -cne $expectedMessages[$i]) { throw 'Incorrect message or order' }
    }
    Write-Output "PASS $script:mode"
}
Write-Output "PowerShell $($PSVersionTable.PSVersion): syntax and 5 isolated progress tests passed; no Agent installed."
