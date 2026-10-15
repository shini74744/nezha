param([ValidateSet('install','uninstall')][string]$Action = 'install')
# DDnezha-owned-agent-installer-v1
# shini74744/nezha only. Run in an elevated PowerShell window.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Please run PowerShell as Administrator.'
}
Write-Host 'DDnezha 管理脚本已就绪' -ForegroundColor Green
$cpu = $env:PROCESSOR_ARCHITEW6432
if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
switch ($cpu.ToUpperInvariant()) {
    'AMD64' { $arch = 'amd64' }
    'ARM64' { $arch = 'arm64' }
    'X86' { $arch = '386' }
    default { throw "Unsupported architecture: $cpu" }
}
$dir = 'C:\DDnezha'
$binary = Join-Path $dir 'DDnezha.exe'
$config = Join-Path $dir 'config.yml'
$marker = Join-Path $dir '.DDnezha-owned'
$installer = Join-Path $dir 'agent.ps1'
$installerMarker = '# DDnezha-owned-agent-installer-v1'
foreach ($candidate in @($dir, $binary, $config, $marker)) {
    $pathItem = Get-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    if ($pathItem -and ($pathItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'DDnezha refuses reparse-point installation paths.'
    }
}
$existing = (Test-Path -LiteralPath $binary) -or (Test-Path -LiteralPath $marker) -or
    ((Test-Path -LiteralPath $dir) -and @(Get-ChildItem -LiteralPath $dir -Filter '*config*.yml' -File).Count -gt 0)
if ($existing -and (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -cne 'DDnezha')) {
    throw 'DDnezha ownership cannot be verified. Migrate explicitly; existing services were not changed.'
}
if ($Action -eq 'uninstall') {
    $failed = $false
    $configs = if (Test-Path -LiteralPath $dir) { @(Get-ChildItem -LiteralPath $dir -Filter '*config*.yml' -File) } else { @() }
    foreach ($item in $configs) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not (Test-Path -LiteralPath $binary)) {
            throw 'Unsafe DDnezha configuration or missing binary; files retained.'
        }
        & $binary service -c $item.FullName stop
        & $binary service -c $item.FullName uninstall
        if ($LASTEXITCODE -ne 0) { $failed = $true; continue }
        Remove-Item -LiteralPath $item.FullName -Force
    }
    if ($failed) { throw 'Some DDnezha services could not be removed; their configurations were retained.' }
    Write-Host 'DDnezha uninstall complete; executable and backups retained. Official Agent untouched.'
    return
}
if (-not (Test-Path -LiteralPath $config)) {
    if (-not $env:DDNZ_SERVER -or -not $env:DDNZ_CLIENT_SECRET) { throw 'DDNZ_SERVER and DDNZ_CLIENT_SECRET are required.' }
}
$item = Get-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
if ($item) {
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        -not ((Get-Content -LiteralPath $installer) -ccontains $installerMarker)) {
        throw 'Refusing to replace an unknown or linked agent.ps1; existing services unchanged.'
    }
}
if (-not $PSCommandPath -or -not (Test-Path -LiteralPath $PSCommandPath -PathType Leaf) -or
    ((Get-Item -LiteralPath $PSCommandPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    -not ((Get-Content -LiteralPath $PSCommandPath) -ccontains $installerMarker)) {
    throw 'Run this installer from a regular file, not an expression or link.'
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('DDnezha-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$asset = "DDnezha_windows_$arch.zip"
$versionURL = 'https://raw.githubusercontent.com/shini74744/nezha/main/release/agent-version.txt'
$archive = Join-Path $tmp $asset
$checksum = Join-Path $tmp 'checksum'
$extracted = Join-Path $tmp 'unzipped'
$backup = $null
$changed = $false
try {
    $version = (Invoke-WebRequest -UseBasicParsing $versionURL).Content.Trim()
    if ($version -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Invalid Agent channel version.' }
    $base = "https://github.com/shini74744/nezha/releases/download/agent-$version"
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
    $newBinary = Join-Path $extracted 'DDnezha.exe'
    $actualVersion = & $newBinary -v
    if ($LASTEXITCODE -ne 0 -or $actualVersion -cne "DDnezha version $($version.Substring(1))") { throw 'Downloaded agent cannot run.' }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    & icacls.exe $dir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot secure DDnezha directory.' }
    'DDnezha' | Set-Content -LiteralPath $marker -Encoding ascii
    $backup = Join-Path $dir ('backup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    # Configuration contains credentials: limit backup access to SYSTEM/Administrators.
    & icacls.exe $backup /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot secure backup directory.' }
    if (Test-Path -LiteralPath $binary) { Copy-Item -LiteralPath $binary -Destination $backup }
    if (Test-Path -LiteralPath $config) { Copy-Item -LiteralPath $config -Destination $backup }
    if (Test-Path -LiteralPath $installer) { Copy-Item -LiteralPath $installer -Destination $backup }
    $stagedInstaller = Join-Path $backup 'agent.ps1.new'
    Copy-Item -LiteralPath $PSCommandPath -Destination $stagedInstaller
    if (Test-Path -LiteralPath $binary) { & $binary service stop }
    $changed = $true
    Copy-Item -LiteralPath $newBinary -Destination $binary -Force
    & $binary service uninstall
    & $binary service install
    if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
    # Replace on the same volume without truncating the script being executed.
    if (Test-Path -LiteralPath $installer) {
        [IO.File]::Replace($stagedInstaller, $installer, (Join-Path $backup 'agent.ps1.replaced'))
    } else {
        [IO.File]::Move($stagedInstaller, $installer)
    }
    Write-Host "管理脚本：$installer；卸载：在 C:\DDnezha 中运行 .\agent.ps1 uninstall"
    # service install already starts the service (SCM/launchd/systemd).
    Write-Host "Installed from shini74744/nezha. Backup: $backup"
} catch {
    if ($changed -and $backup -and (Test-Path -LiteralPath (Join-Path $backup 'DDnezha.exe'))) {
        Copy-Item -LiteralPath (Join-Path $backup 'DDnezha.exe') -Destination $binary -Force
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
        [IO.Path]::GetFileName($resolved) -match '^DDnezha-install-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
