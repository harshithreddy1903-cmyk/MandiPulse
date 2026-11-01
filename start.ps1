[CmdletBinding()]
param(
    [switch]$Restart,
    [switch]$OpenBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\', '/')
$localDirectory = Join-Path $projectRoot '.local'
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
$vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
$backendDirectory = Join-Path $projectRoot 'backend'

function Get-ListenerProcessIds([int]$Port) {
    try {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    }
    catch {
        throw 'Cannot inspect listening ports. Run this launcher in Windows PowerShell on the same Windows computer as the servers.'
    }
    return @($listeners | Where-Object { $_.LocalPort -eq $Port } | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-ProcessDetails([int]$ProcessId) {
    return Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
}

function Get-CanonicalCommandPaths($Process) {
    if (-not $Process -or [string]::IsNullOrWhiteSpace($Process.CommandLine)) { return @() }
    $paths = @()
    foreach ($match in [regex]::Matches($Process.CommandLine, '"[^"]*"|[^\s]+')) {
        $candidate = $match.Value.Trim('"')
        if ($candidate.StartsWith('-') -and $candidate.Contains('=')) {
            $candidate = $candidate.Substring($candidate.IndexOf('=') + 1).Trim('"')
        }
        # Require an absolute path. Relative paths depend on an unknown process CWD.
        if ($candidate -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)') { continue }
        try { $paths += [IO.Path]::GetFullPath($candidate.Replace('/', '\')).TrimEnd('\') }
        catch { continue }
    }
    return @($paths | Select-Object -Unique)
}

function Test-ProjectCommandLine($Process) {
    foreach ($path in @(Get-CanonicalCommandPaths $Process)) {
        if ($path.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
            $path.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Test-ServiceProcess($Process, [string]$Role) {
    if (-not (Test-ProjectCommandLine $Process)) { return $false }
    $commandLine = $Process.CommandLine.Replace('/', '\')
    if ($Role -eq 'backend') {
        return $Process.Name -match '^(?:python(?:w|[0-9.]+)?|uvicorn)\.exe$' -and
            $commandLine -match '(?i)\buvicorn(?:\.exe)?(?=\s|"|$)' -and
            $commandLine -match '(?i)(?:^|[\s"])app\.main:app(?:\s|"|$)'
    }
    return $Process.Name -ieq 'node.exe' -and @(
        Get-CanonicalCommandPaths $Process | Where-Object { $_.Equals($vitePath, [StringComparison]::OrdinalIgnoreCase) }
    ).Count -gt 0
}

function Get-RestartRootProcessIds($Services) {
    $roots = @()
    foreach ($service in $Services) {
        foreach ($ownerProcessId in $service.Owners) {
            $current = Get-ProcessDetails $ownerProcessId
            if (-not (Test-ServiceProcess $current $service.Role)) { throw 'Restart refused because listener ownership changed. Run the launcher again.' }
            $visited = [Collections.Generic.HashSet[int]]::new()
            [void]$visited.Add([int]$current.ProcessId)
            while ([int]$current.ParentProcessId -gt 0) {
                $parent = Get-ProcessDetails ([int]$current.ParentProcessId)
                if (-not $parent -or -not (Test-ServiceProcess $parent $service.Role) -or
                    $parent.CreationDate -gt $current.CreationDate -or $visited.Contains([int]$parent.ProcessId)) { break }
                [void]$visited.Add([int]$parent.ProcessId)
                $current = $parent
            }
            $roots += [int]$current.ProcessId
        }
    }
    return @($roots | Select-Object -Unique)
}

function Test-ServiceHealthy($Service) {
    try {
        if ($Service.Role -eq 'backend') {
            $response = Invoke-RestMethod -Uri $Service.Url -TimeoutSec 2 -ErrorAction Stop
            return $response.status -eq 'ok' -and $response.service -eq 'MandiPulse API'
        }
        $response = Invoke-WebRequest -Uri $Service.Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return $response.StatusCode -eq 200 -and $response.Content -match '/@vite/client' -and
            $response.Content -match 'MandiPulse'
    }
    catch { return $false }
}

function Assert-ServiceOwners($Service) {
    $owners = @(Get-ListenerProcessIds $Service.Port)
    foreach ($ownerProcessId in $owners) {
        $process = Get-ProcessDetails $ownerProcessId
        if (-not (Test-ServiceProcess $process $Service.Role)) {
            throw "Port $($Service.Port) belongs to an unrelated or unverifiable process (PID $ownerProcessId). Nothing on that port will be stopped. Close the other program yourself or choose a separate environment."
        }
    }
    return $owners
}

function Test-SystemConsoleHelper($Process, $Parent) {
    if (-not $Process -or -not $Parent -or $Process.Name -ine 'conhost.exe' -or
        [string]::IsNullOrWhiteSpace($Process.ExecutablePath) -or
        [string]::IsNullOrWhiteSpace($Process.CommandLine)) { return $false }
    if ([int]$Process.ParentProcessId -ne [int]$Parent.ProcessId -or
        -not $Process.CreationDate -or -not $Parent.CreationDate -or
        $Process.CreationDate -lt $Parent.CreationDate) { return $false }
    if (-not ((Test-ServiceProcess $Parent 'backend') -or (Test-ServiceProcess $Parent 'frontend'))) { return $false }
    $systemPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)) 'System32\conhost.exe'
    try {
        $executablePath = [IO.Path]::GetFullPath($Process.ExecutablePath)
        if (-not $executablePath.Equals($systemPath, [StringComparison]::OrdinalIgnoreCase)) { return $false }
        $firstArgument = [regex]::Match($Process.CommandLine, '^\s*(?:"([^"]+)"|(\S+))')
        if (-not $firstArgument.Success) { return $false }
        $commandPath = $firstArgument.Groups[2].Value
        if ($firstArgument.Groups[1].Success) { $commandPath = $firstArgument.Groups[1].Value }
        # Windows starts console hosts with an NT path prefix rather than a DOS path.
        if ($commandPath.StartsWith('\??\', [StringComparison]::Ordinal)) { $commandPath = $commandPath.Substring(4) }
        if ($commandPath -notmatch '^[A-Za-z]:[\\/]') { return $false }
        return [IO.Path]::GetFullPath($commandPath).Equals($systemPath, [StringComparison]::OrdinalIgnoreCase)
    }
    catch { return $false }
}

function Test-VerifiedTreeProcess($Current, $Entry) {
    if (-not $Current -or $Current.CreationDate -ne $Entry.Process.CreationDate -or
        [int]$Current.ParentProcessId -ne [int]$Entry.Process.ParentProcessId) { return $false }
    if ($Current.Name -ieq 'conhost.exe' -or $Entry.Process.Name -ieq 'conhost.exe') {
        if (-not $Entry.ConsoleParent) { return $false }
        $parent = Get-ProcessDetails ([int]$Current.ParentProcessId)
        if (-not $parent -or $parent.CreationDate -ne $Entry.ConsoleParent.CreationDate) { return $false }
        return Test-SystemConsoleHelper $Current $parent
    }
    return Test-ProjectCommandLine $Current
}

function Get-VerifiedProcessTree([int[]]$RootProcessIds) {
    $snapshot = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
    $processById = @{}
    foreach ($process in $snapshot) { $processById[[int]$process.ProcessId] = $process }
    $depthById = @{}
    foreach ($rootProcessId in $RootProcessIds) { $depthById[$rootProcessId] = 0 }
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $snapshot) {
            $processIdValue = [int]$process.ProcessId
            $parentIdValue = [int]$process.ParentProcessId
            if (-not $depthById.ContainsKey($processIdValue) -and $depthById.ContainsKey($parentIdValue)) {
                $depthById[$processIdValue] = $depthById[$parentIdValue] + 1
                $changed = $true
            }
        }
    }
    $verified = @()
    foreach ($process in $snapshot) {
        $processIdValue = [int]$process.ProcessId
        if ($depthById.ContainsKey($processIdValue)) {
            $consoleParent = $null
            $isVerified = $false
            if ($process.Name -ieq 'conhost.exe') {
                $parentIdValue = [int]$process.ParentProcessId
                $parent = $processById[$parentIdValue]
                if ($depthById.ContainsKey($parentIdValue) -and (Test-SystemConsoleHelper $process $parent)) {
                    $consoleParent = $parent
                    $isVerified = $true
                }
            }
            else { $isVerified = Test-ProjectCommandLine $process }
            if (-not $isVerified) {
                throw "Restart refused: a descendant process (PID $processIdValue) cannot be verified as belonging to this exact project. No restart processes have been stopped."
            }
            $verified += [pscustomobject]@{ Process = $process; Depth = $depthById[$processIdValue]; ConsoleParent = $consoleParent }
        }
    }
    return @($verified | Sort-Object -Property Depth -Descending)
}

function Stop-VerifiedProcessTree($Tree) {
    # Check every identity immediately before stopping the first process.
    foreach ($entry in $Tree) {
        $current = Get-ProcessDetails ([int]$entry.Process.ProcessId)
        if ($current -and -not (Test-VerifiedTreeProcess $current $entry)) {
            throw 'Restart refused because a process identity changed. Run the launcher again to inspect the current owners.'
        }
    }
    foreach ($entry in $Tree) {
        $processIdValue = [int]$entry.Process.ProcessId
        $current = Get-ProcessDetails $processIdValue
        if ($current) {
            if (-not (Test-VerifiedTreeProcess $current $entry)) {
                throw 'Stopped restarting because a process identity changed. No unrelated process will be stopped.'
            }
            Stop-Process -Id $processIdValue -Force -ErrorAction Stop
        }
    }
}

function Wait-ServiceHealthy($Service) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 25) {
        $owners = @(Assert-ServiceOwners $Service)
        if ($owners.Count -gt 0 -and (Test-ServiceHealthy $Service)) { return }
        Start-Sleep -Milliseconds 350
    }
    throw "$($Service.Name) did not become healthy. Inspect its output and error logs in $localDirectory. The launcher has not stopped any pre-existing healthy service."
}

try {
    $services = @(
        [pscustomobject]@{ Name = 'Backend'; Role = 'backend'; Port = 8000; Url = 'http://127.0.0.1:8000/api/health'; Owners = @() },
        [pscustomobject]@{ Name = 'Website'; Role = 'frontend'; Port = 5175; Url = 'http://127.0.0.1:5175/'; Owners = @() }
    )
    # Inspect both ports before starting or stopping either service.
    foreach ($service in $services) {
        $service.Owners = @(Assert-ServiceOwners $service)
        if ($service.Owners.Count -gt 0 -and -not $Restart -and -not (Test-ServiceHealthy $service)) {
            throw "$($service.Name) owns port $($service.Port) but is not healthy. Inspect .local logs, then use -Restart to replace only verified project processes."
        }
    }
    $toStart = @($services | Where-Object { $Restart -or $_.Owners.Count -eq 0 })
    if (@($toStart | Where-Object Role -eq 'backend').Count -gt 0 -and -not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
        throw "Python environment is missing. From this project folder run:`n  py -m venv .venv`n  .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt`nThen run the launcher again."
    }
    $nodePath = $null
    if (@($toStart | Where-Object Role -eq 'frontend').Count -gt 0) {
        if (-not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
            throw "Website packages are missing. From this project folder run npm ci, then run the launcher again."
        }
        $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCommand) { throw 'Node.js is missing from PATH. Install a Node.js version supported by this project (see README), reopen PowerShell, and run npm ci.' }
        $nodePath = $nodeCommand.Source
    }
    if ($Restart) {
        # Include a verified Uvicorn reloader parent so it cannot respawn its child.
        # Unverified shells/npm parents are never included.
        $rootProcessIds = @(Get-RestartRootProcessIds $services)
        if ($rootProcessIds.Count -gt 0) {
            $tree = @(Get-VerifiedProcessTree $rootProcessIds)
            Stop-VerifiedProcessTree $tree
            $timer = [Diagnostics.Stopwatch]::StartNew()
            do {
                $remaining = @($services | ForEach-Object { Get-ListenerProcessIds $_.Port })
                if ($remaining.Count -eq 0) { break }
                Start-Sleep -Milliseconds 200
            } while ($timer.Elapsed.TotalSeconds -lt 5)
            if ($remaining.Count -gt 0) { throw 'A required port remains occupied after the verified restart. Nothing else will be stopped.' }
        }
    }
    if ($toStart.Count -gt 0) { New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null }
    foreach ($service in $services) {
        if (-not $Restart -and $service.Owners.Count -gt 0) {
            Write-Host "$($service.Name): reusing the healthy server on port $($service.Port)."
            continue
        }
        if (@(Get-ListenerProcessIds $service.Port).Count -gt 0) { throw "Port $($service.Port) became occupied. Nothing on that port will be stopped." }
        $stdoutPath = Join-Path $localDirectory ($service.Role + '.out.log')
        $stderrPath = Join-Path $localDirectory ($service.Role + '.err.log')
        if ($service.Role -eq 'backend') {
            $arguments = '-u -m uvicorn app.main:app --app-dir "' + $backendDirectory + '" --host 127.0.0.1 --port 8000'
            Start-Process -FilePath $pythonPath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath | Out-Null
        }
        else {
            $arguments = '"' + $vitePath + '" --host 127.0.0.1 --port 5175 --strictPort'
            Start-Process -FilePath $nodePath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath | Out-Null
        }
        Wait-ServiceHealthy $service
        Write-Host "$($service.Name): ready on port $($service.Port)."
    }
    Write-Host ''
    Write-Host 'MandiPulse is ready: http://127.0.0.1:5175/'
    Write-Host 'Logs for launcher-started servers are in .local. Servers continue running when this window closes.'
    if ($OpenBrowser) { Start-Process -FilePath 'http://127.0.0.1:5175/' | Out-Null }
}
catch {
    Write-Host ('MandiPulse could not start: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
