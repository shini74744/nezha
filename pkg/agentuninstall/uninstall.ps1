$ErrorActionPreference = 'Stop'
$uuid = '__UUID__'
$dir = 'C:\nezha'
$binary = Join-Path $dir 'nezha-agent.exe'
function Assert-PlainPath([string]$path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse paths are not supported.' }
}
function Read-AgentUUID([string]$path) {
    Assert-PlainPath $path
    $match = [regex]::Match([IO.File]::ReadAllText($path), '(?m)^\s*uuid:\s*["'']?([a-fA-F0-9-]+)["'']?\s*$')
    return $match.Groups[1].Value.ToLowerInvariant()
}
function Find-Config {
    $matches = @(Get-ChildItem -LiteralPath $dir -Filter '*config*.yml' | Where-Object {
        -not $_.PSIsContainer -and (Read-AgentUUID $_.FullName) -eq $uuid
    })
    if ($matches.Count -ne 1) { throw 'Standard installation UUID not found or ambiguous.' }
    return $matches[0].FullName
}
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator required.' }
    Assert-PlainPath $dir
    Assert-PlainPath $binary
    $null = Find-Config
    $job = 'Nezha-Uninstall-' + [guid]::NewGuid().ToString('N')
    $work = Join-Path $dir $job
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
        $identityRef = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identityRef, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    $null = [IO.Directory]::CreateDirectory($work, $acl)
    $scriptPath = Join-Path $work 'cleanup.ps1'
    $helpers = "function Assert-PlainPath { " + (Get-Command Assert-PlainPath).ScriptBlock.ToString() + " }`r`n" +
               "function Read-AgentUUID { " + (Get-Command Read-AgentUUID).ScriptBlock.ToString() + " }`r`n" +
               "function Find-Config { " + (Get-Command Find-Config).ScriptBlock.ToString() + " }`r`n"
    $worker = @'
param([string]$uuid, [string]$work, [string]$job)
$ErrorActionPreference = 'Stop'
$dir = 'C:\nezha'
$binary = Join-Path $dir 'nezha-agent.exe'
try {
    [IO.File]::WriteAllText((Join-Path $work 'ready'), 'started')
    Start-Sleep -Seconds 3
    Assert-PlainPath $dir
    Assert-PlainPath $binary
    $config = Find-Config
    & $binary service -c $config stop
    if ($LASTEXITCODE -ne 0) { throw 'Agent stop failed; data retained.' }
    & $binary service -c $config uninstall
    if ($LASTEXITCODE -ne 0) { throw 'Agent unregister failed; data retained.' }
    Remove-Item -LiteralPath $config -Force
    foreach ($backup in @(Get-ChildItem -LiteralPath $dir -Filter 'backup-*' | Where-Object { $_.PSIsContainer })) {
        Assert-PlainPath $backup.FullName
        $saved = Join-Path $backup.FullName 'config.yml'
        if ((Test-Path -LiteralPath $saved) -and (Read-AgentUUID $saved) -eq $uuid) {
            Remove-Item -LiteralPath $saved -Force
            $savedBinary = Join-Path $backup.FullName 'nezha-agent.exe'
            if (Test-Path -LiteralPath $savedBinary) {
                Assert-PlainPath $savedBinary
                Remove-Item -LiteralPath $savedBinary -Force
            }
            if (@(Get-ChildItem -LiteralPath $backup.FullName -Force).Count -eq 0) { [IO.Directory]::Delete($backup.FullName) }
        }
    }
    $remaining = @(Get-ChildItem -LiteralPath $dir -Filter '*config*.yml')
    if ($remaining.Count -eq 0) {
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            try { Remove-Item -LiteralPath $binary -Force; break }
            catch { if ($attempt -eq 29) { throw }; Start-Sleep -Seconds 1 }
        }
        foreach ($name in @('agent.ps1', 'install.ps1')) {
            $installer = Join-Path $dir $name
            if (Test-Path -LiteralPath $installer) {
                Assert-PlainPath $installer
                $text = [IO.File]::ReadAllText($installer)
                if ($text.Contains('NZ_CLIENT_SECRET') -and $text.Contains('nezha-agent')) { Remove-Item -LiteralPath $installer -Force }
            }
        }
    }
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $scheduler.GetFolder('\').DeleteTask($job, 0)
    Remove-Item -LiteralPath (Join-Path $work 'cleanup.ps1') -Force
    Remove-Item -LiteralPath (Join-Path $work 'ready') -Force
    if (@(Get-ChildItem -LiteralPath $work -Force).Count -eq 0) { [IO.Directory]::Delete($work) }
    if (@(Get-ChildItem -LiteralPath $dir -Force).Count -eq 0) { [IO.Directory]::Delete($dir) }
} catch {
    [IO.File]::WriteAllText((Join-Path $work 'error.log'), $_.Exception.Message)
    exit 1
}
'@
    $worker = $worker.Replace('$ErrorActionPreference = ''Stop''', ('$ErrorActionPreference = ''Stop''' + "`r`n" + $helpers))
    [IO.File]::WriteAllText($scriptPath, $worker, (New-Object Text.UTF8Encoding($true)))
    $scheduler = New-Object -ComObject Schedule.Service
    $scheduler.Connect()
    $task = $scheduler.NewTask(0)
    $task.Principal.UserId = 'SYSTEM'
    $task.Principal.LogonType = 5
    $task.Principal.RunLevel = 1
    $task.Settings.Enabled = $true
    $task.Settings.ExecutionTimeLimit = 'PT5M'
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries = $false
    $action = $task.Actions.Create(0)
    $action.Path = Join-Path $PSHOME 'powershell.exe'
    $action.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -uuid "' + $uuid + '" -work "' + $work + '" -job "' + $job + '"'
    $action.WorkingDirectory = $work
    $registered = $scheduler.GetFolder('\').RegisterTaskDefinition($job, $task, 6, 'SYSTEM', $null, 5)
    $null = $registered.Run($null)
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        if (Test-Path -LiteralPath (Join-Path $work 'ready')) { Write-Output 'NZ_UNINSTALL_STARTED'; exit 0 }
        Start-Sleep -Seconds 1
    }
    throw 'Cleanup worker did not start.'
} catch {
    Write-Output 'NZ_UNINSTALL_ERROR: Windows preflight or scheduled task launch failed.'
    exit 1
}
