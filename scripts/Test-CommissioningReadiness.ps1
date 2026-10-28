[CmdletBinding()]
param(
    [switch]$ProbeBackend,
    [switch]$CheckTestDatabase,
    [string]$OutputDirectory = (Join-Path ([System.IO.Path]::GetTempPath()) 'pulselink-commissioning-preflight')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$apiRoot = Join-Path $repoRoot 'server/api'
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param([string]$Name, [ValidateSet('PASS','FAIL','BLOCKED','SKIPPED')][string]$Status, [string]$Detail, [string]$Action = '')
    $checks.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail; nextAction = $Action })
}

function Get-CommandVersion {
    param([string]$Name, [string[]]$Arguments = @('--version'))
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try {
        $values = @(& $command.Source @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) { return "$Name is installed but did not report a version" }
        return $values[0].ToString().Trim()
    } catch { return "$Name is installed but version query failed" }
}

function Find-ManagedTool {
    param([string]$Name)
    $toolsRoot = [Environment]::GetEnvironmentVariable('IDF_TOOLS_PATH', 'Process')
    if ([string]::IsNullOrWhiteSpace($toolsRoot)) { return $null }
    $directoryName = switch ($Name) { 'cmake' { 'cmake' } 'ninja' { 'ninja' } default { return $null } }
    $root = Join-Path $toolsRoot "tools/$directoryName"
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $exeName = if ($Name -eq 'cmake') { 'cmake.exe' } else { 'ninja.exe' }
    $found = Get-ChildItem -LiteralPath $root -Filter $exeName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

function Read-LocalEnvValue {
    param([string]$Name)
    $processValue = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($processValue)) { return $processValue }
    foreach ($file in @((Join-Path $apiRoot '.env'), (Join-Path $repoRoot '.env'))) {
        if (-not (Test-Path -LiteralPath $file)) { continue }
        foreach ($line in [IO.File]::ReadLines($file)) {
            if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
                $value = $Matches[1].Trim()
                if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
                return $value
            }
        }
    }
    return $null
}

function Get-SdkConfigValue {
    param([string]$Name)
    $file = Join-Path $repoRoot 'firmware/esp32/sdkconfig'
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    foreach ($line in [IO.File]::ReadLines($file)) {
        if ($line -match "^CONFIG_$([regex]::Escape($Name))=(.*)$") { return $Matches[1].Trim('"') }
        if ($line -eq "# CONFIG_$Name is not set") { return 'n' }
    }
    return $null
}

function Invoke-ReadOnlyHttpsProbe {
    param([uri]$BaseUri)
    $healthUri = [uri]::new($BaseUri, '/health/live')
    try {
        $response = Invoke-WebRequest -Uri $healthUri -Method Get -TimeoutSec 8 -MaximumRedirection 0
        $body = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -eq 200 -and $body.status -eq 'ok' -and $body.service -eq 'pulselink-api') {
            return @{ ok = $true; detail = 'HTTPS hostname/certificate validation succeeded; /health/live identified pulselink-api.' }
        }
        return @{ ok = $false; detail = 'HTTPS responded, but the liveness contract did not match.' }
    } catch {
        $reason = $_.Exception.GetType().Name
        return @{ ok = $false; detail = "HTTPS probe failed ($reason); response text and URL were omitted." }
    }
}

function Test-DevelopmentHost {
    param([string]$HostName)
    if ($HostName -in @('localhost','127.0.0.1','::1') -or $HostName.EndsWith('.test',[StringComparison]::OrdinalIgnoreCase) -or $HostName.EndsWith('.local',[StringComparison]::OrdinalIgnoreCase)) { return $true }
    $address = $null
    if (-not [Net.IPAddress]::TryParse($HostName, [ref]$address)) { return $false }
    $bytes = $address.GetAddressBytes()
    if ($bytes.Length -eq 4) {
        return ($bytes[0] -eq 10) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or ($bytes[0] -eq 127)
    }
    return $address.IsIPv6LinkLocal -or $address.IsIPv6SiteLocal -or (($bytes[0] -band 0xFE) -eq 0xFC) -or [Net.IPAddress]::IsLoopback($address)
}

# Toolchain checks are inventory only; this script does not install or mutate tools.
foreach ($tool in @('git','node','npm','python','cmake','ninja','adb')) {
    $version = Get-CommandVersion -Name $tool
    if (-not $version -and $tool -in @('cmake','ninja')) {
        $managedPath = Find-ManagedTool $tool
        if ($managedPath) {
            $toolVersion = & $managedPath --version 2>&1
            if ($LASTEXITCODE -eq 0) { $version = "$($toolVersion | Select-Object -First 1) (managed ESP-IDF tool path)" }
        }
    }
    if ($version) { Add-Check "tool:$tool" 'PASS' $version }
    else { Add-Check "tool:$tool" 'BLOCKED' "$tool is not available on PATH or in the configured ESP-IDF tool directory." "Configure the repository's documented development toolchain." }
}

$dockerVersion = Get-CommandVersion -Name 'docker'
if (-not $dockerVersion) {
    Add-Check 'tool:docker-daemon' 'BLOCKED' 'Docker CLI is unavailable; C host container tests cannot run.' 'Restore Docker Desktop or use the documented native host-test toolchain.'
} else {
    $dockerCommand = Get-Command docker
    $dockerInfo = @(& $dockerCommand.Source info --format '{{.ServerVersion}}' 2>&1)
    if ($LASTEXITCODE -eq 0 -and $dockerInfo.Count -gt 0) { Add-Check 'tool:docker-daemon' 'PASS' 'Docker daemon responded to a read-only version query.' }
    else { Add-Check 'tool:docker-daemon' 'BLOCKED' 'Docker CLI is installed but the daemon did not answer the read-only query.' 'Start/authorize the local Docker engine; no container was launched by preflight.' }
}

$idfPath = [Environment]::GetEnvironmentVariable('IDF_PATH', 'Process')
$idfPython = [Environment]::GetEnvironmentVariable('IDF_PYTHON_ENV_PATH', 'Process')
if (-not $idfPath) {
    $toolsRoot = [Environment]::GetEnvironmentVariable('IDF_TOOLS_PATH', 'Process')
    if ($toolsRoot) {
        $candidate = Join-Path $toolsRoot 'frameworks/esp-idf-v5.5.5'
        if (Test-Path (Join-Path $candidate 'tools/idf.py')) { $idfPath = $candidate }
    }
}
if (-not $idfPython) {
    $toolsRoot = [Environment]::GetEnvironmentVariable('IDF_TOOLS_PATH', 'Process')
    if ($toolsRoot) {
        $candidate = Join-Path $toolsRoot 'python_env/idf5.5_py3.11_env'
        if (Test-Path (Join-Path $candidate 'Scripts/python.exe')) { $idfPython = $candidate }
    }
}
if ($idfPath -and $idfPython -and (Test-Path (Join-Path $idfPath 'tools/idf.py')) -and (Test-Path (Join-Path $idfPython 'Scripts/python.exe'))) {
    $idfVersionOutput = & (Join-Path $idfPython 'Scripts/python.exe') (Join-Path $idfPath 'tools/idf.py') --version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $idfVersionOutput -match '5\.5\.5') { Add-Check 'firmware:esp-idf' 'PASS' 'ESP-IDF 5.5.5 Python entrypoint is available.' }
    elseif ($LASTEXITCODE -eq 0) { Add-Check 'firmware:esp-idf' 'FAIL' 'ESP-IDF is available but is not version 5.5.5.' 'Select the documented ESP-IDF 5.5.5 environment.' }
    else { Add-Check 'firmware:esp-idf' 'FAIL' 'ESP-IDF version command failed.' 'Repair the local ESP-IDF Python/toolchain environment.' }
} else {
    Add-Check 'firmware:esp-idf' 'BLOCKED' 'IDF_PATH or IDF_PYTHON_ENV_PATH is unset or incomplete.' 'Configure the paths from docs/development/firmware-build.md.'
}

$apkPath = Join-Path $repoRoot 'apps/android-fcm-test/owner/build/outputs/apk/debug/owner-debug.apk'
if (Test-Path -LiteralPath $apkPath) {
    $apk = Get-Item -LiteralPath $apkPath
    Add-Check 'android:debug-apk' 'PASS' "Debug APK exists; $($apk.Length) bytes."
} else { Add-Check 'android:debug-apk' 'BLOCKED' 'Owner debug APK is absent.' 'Run the documented Owner unit tests and assembleDebug task.' }

$adb = Get-Command adb -ErrorAction SilentlyContinue
if ($adb) {
    $adbOutput = & $adb.Source devices -l 2>&1
    if ($LASTEXITCODE -eq 0) {
        $devices = @($adbOutput | Where-Object { $_ -match '^\S+\s+device\b' })
        if ($devices.Count -gt 0) { Add-Check 'android:adb-device' 'PASS' "$($devices.Count) ADB device(s) listed; no install or app operation performed." }
        else { Add-Check 'android:adb-device' 'BLOCKED' 'ADB is available but no authorized device is listed.' 'Connect/authorize a development phone; this check does not imply commissioning.' }
    } else { Add-Check 'android:adb-device' 'FAIL' 'adb devices failed.' 'Start the local Android SDK platform-tools service and retry.' }
} else { Add-Check 'android:adb-device' 'BLOCKED' 'ADB is not available; device enumeration was not performed.' }

# Enumerate Windows PnP devices only. Never open COM ports (DTR/RTS can reset a board).
try {
    try {
        $serials = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object { $_.Name -match '\(COM\d+\)' } | ForEach-Object { $_.Name })
    } catch {
        $pnpCommand = Get-Command Get-PnpDevice -ErrorAction SilentlyContinue
        if (-not $pnpCommand) { throw }
        $serials = @(Get-PnpDevice -PresentOnly -ErrorAction Stop | Where-Object { $_.FriendlyName -match '\(COM\d+\)' } | ForEach-Object { $_.FriendlyName })
    }
    if ($serials.Count -gt 0) { Add-Check 'hardware:serial-enumeration' 'PASS' "$($serials.Count) serial interface(s) enumerated without opening a port." }
    else { Add-Check 'hardware:serial-enumeration' 'BLOCKED' 'No serial interface was enumerated.' 'Connect the intended board when operator hardware work is authorized.' }
} catch { Add-Check 'hardware:serial-enumeration' 'BLOCKED' 'Windows PnP enumeration is unavailable.' 'Run preflight on the operator workstation; no serial port was opened.' }

$commissioningEnabled = Get-SdkConfigValue 'PULSELINK_COMMISSIONING_ENABLED'
$nvsEncryption = Get-SdkConfigValue 'NVS_ENCRYPTION'
$credentialStorageEnabled = Get-SdkConfigValue 'PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE'
$certificateBundle = Get-SdkConfigValue 'MBEDTLS_CERTIFICATE_BUNDLE'
$redemptionOrigin = Get-SdkConfigValue 'PULSELINK_REDEMPTION_BASE_URL'
$eventEndpoint = Get-SdkConfigValue 'PULSELINK_EVENT_ENDPOINT_URL'
if ($commissioningEnabled -eq 'y') { Add-Check 'firmware:commissioning-profile' 'PASS' 'Local sdkconfig enables commissioning compile profile; this is not runtime or security readiness.' }
else { Add-Check 'firmware:commissioning-profile' 'BLOCKED' 'Local sdkconfig does not enable the commissioning profile.' 'Keep disabled until trusted enrollment and protected storage gates are approved.' }
if ($certificateBundle -eq 'y') { Add-Check 'firmware:tls-trust-bundle' 'PASS' 'ESP certificate bundle is selected in local sdkconfig; device trust/runtime has not been exercised.' }
else { Add-Check 'firmware:tls-trust-bundle' 'BLOCKED' 'ESP certificate bundle is not enabled in local sdkconfig.' 'Use the reviewed CA trust configuration; do not disable hostname/certificate verification.' }
foreach ($endpointName in @('redemption','event')) {
    $endpointValue = if ($endpointName -eq 'redemption') { $redemptionOrigin } else { $eventEndpoint }
    if ([string]::IsNullOrWhiteSpace($endpointValue)) {
        Add-Check "firmware:$endpointName-origin" 'BLOCKED' 'Firmware endpoint is not configured in local sdkconfig.' 'Configure only an approved development HTTPS endpoint in a local build configuration.'
        continue
    }
    $endpointUri = $null
    if ([uri]::TryCreate($endpointValue, [UriKind]::Absolute, [ref]$endpointUri) -and $endpointUri.Scheme -eq 'https' -and (Test-DevelopmentHost $endpointUri.Host)) {
        Add-Check "firmware:$endpointName-origin" 'PASS' 'An HTTPS development endpoint is configured; the endpoint and credentials were not printed or contacted.'
    } else {
        Add-Check "firmware:$endpointName-origin" 'BLOCKED' 'Configured firmware endpoint is not an approved local development HTTPS target; preflight did not contact it.' 'Replace with an explicitly approved development HTTPS origin after verifying its CA and network route.'
    }
}
if ($nvsEncryption -eq 'y' -and $credentialStorageEnabled -eq 'y') {
    Add-Check 'security:credential-provider' 'BLOCKED' 'Kconfig flags alone do not establish key custody, provider registration, or recovery.' 'Obtain the approved key provisioning/recovery policy and verify provider runtime on hardware.'
} else {
    Add-Check 'security:credential-provider' 'BLOCKED' 'Operational credential storage is not enabled; production provider remains fail-closed.' 'Approve key custody/recovery before implementing or enabling encrypted storage.'
}

Add-Check 'android:api-origin' 'SKIPPED' 'Owner app takes its HTTPS API origin at runtime; no endpoint was contacted by preflight.' 'Use only the approved development HTTPS origin on the phone; do not use localhost for a remote host.'

$apiBase = [Environment]::GetEnvironmentVariable('PULSELINK_PREFLIGHT_API_BASE_URL', 'Process')
if (-not $ProbeBackend) {
    Add-Check 'backend:development-https' 'SKIPPED' 'No backend request was made; use -ProbeBackend with an explicitly configured development base URL.'
} elseif ([string]::IsNullOrWhiteSpace($apiBase)) {
    Add-Check 'backend:development-https' 'BLOCKED' 'PULSELINK_PREFLIGHT_API_BASE_URL is not configured; no request was made.' 'Set it to the approved development HTTPS origin, without path, credentials, query, or fragment.'
} else {
    $parsedApi = $null
    $isValidUri = [uri]::TryCreate($apiBase, [UriKind]::Absolute, [ref]$parsedApi)
    if (-not $isValidUri -or $parsedApi.Scheme -ne 'https' -or $parsedApi.UserInfo -or $parsedApi.Query -or $parsedApi.Fragment -or $parsedApi.AbsolutePath -ne '/' -or -not (Test-DevelopmentHost $parsedApi.Host)) {
        Add-Check 'backend:development-https' 'FAIL' 'Configured API origin is not a clean HTTPS origin; it was not requested.' 'Use an HTTPS origin only; never put tokens or credentials in the URL.'
    } else {
        $probe = Invoke-ReadOnlyHttpsProbe -BaseUri $parsedApi
        if ($probe.ok) { Add-Check 'backend:development-https' 'PASS' $probe.detail }
        else { Add-Check 'backend:development-https' 'FAIL' $probe.detail 'Check the development service, trusted CA/hostname, and network route.' }
    }
}

if (-not $CheckTestDatabase) {
    Add-Check 'database:test-target' 'SKIPPED' 'Database and migration status were not queried; pass -CheckTestDatabase for read-only validation.'
} else {
    $testDatabaseUrl = Read-LocalEnvValue 'TEST_DATABASE_URL'
    $databaseUri = $null
    $validDbUri = $testDatabaseUrl -and [uri]::TryCreate($testDatabaseUrl, [UriKind]::Absolute, [ref]$databaseUri)
    $dbName = if ($validDbUri) { [uri]::UnescapeDataString($databaseUri.AbsolutePath.Trim('/')) } else { '' }
    if (-not $validDbUri -or $databaseUri.Scheme -notin @('postgres','postgresql') -or $databaseUri.Host -notin @('localhost','127.0.0.1','::1') -or $databaseUri.Port -ne 5434 -or $dbName -ne 'pulselink_test') {
        Add-Check 'database:test-target' 'BLOCKED' 'TEST_DATABASE_URL is missing or does not resolve exactly to a loopback pulselink_test database on port 5434; no database command was run.' 'Configure only the dedicated test target. This preflight never falls back to DATABASE_URL.'
    } else {
        $tcp = [Net.Sockets.TcpClient]::new()
        try {
            $connect = $tcp.BeginConnect($databaseUri.Host, 5434, $null, $null)
            $connected = $connect.AsyncWaitHandle.WaitOne(1500) -and $tcp.EndConnect($connect) -eq $null
        } catch { $connected = $false } finally { $tcp.Dispose() }
        if (-not $connected) {
            Add-Check 'database:test-target' 'BLOCKED' 'Verified test target is not accepting a TCP connection; Prisma was not run.' 'Start the dedicated postgres-test service and rerun preflight.'
        } else {
            $savedDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL','Process')
            try {
                [Environment]::SetEnvironmentVariable('DATABASE_URL', $testDatabaseUrl, 'Process')
                $nodeCommand = Get-Command node -ErrorAction Stop
                $prismaCli = Join-Path $apiRoot 'node_modules/prisma/build/index.js'
                if (-not (Test-Path -LiteralPath $prismaCli)) { throw 'Local Prisma CLI is not installed.' }
                $startInfo = [Diagnostics.ProcessStartInfo]::new()
                $startInfo.FileName = $nodeCommand.Source
                $startInfo.Arguments = '"' + $prismaCli + '" migrate status --schema prisma/schema.prisma'
                $startInfo.WorkingDirectory = $apiRoot
                $startInfo.UseShellExecute = $false
                $startInfo.CreateNoWindow = $true
                $startInfo.RedirectStandardOutput = $true
                $startInfo.RedirectStandardError = $true
                $prismaProcess = [Diagnostics.Process]::new()
                $prismaProcess.StartInfo = $startInfo
                [void]$prismaProcess.Start()
                $stdoutTask = $prismaProcess.StandardOutput.ReadToEndAsync()
                $stderrTask = $prismaProcess.StandardError.ReadToEndAsync()
                if (-not $prismaProcess.WaitForExit(20000)) {
                    $prismaProcess.Kill($true)
                    $statusCode = 124
                } else { $statusCode = $prismaProcess.ExitCode }
                $prismaOutput = $stdoutTask.Result + $stderrTask.Result
                $prismaProcess.Dispose()
            } finally {
                [Environment]::SetEnvironmentVariable('DATABASE_URL', $savedDatabaseUrl, 'Process')
            }
            if ($statusCode -eq 0) { Add-Check 'database:test-target' 'PASS' 'Read-only Prisma migration status succeeded for the validated loopback pulselink_test:5434 target.' }
            elseif ($statusCode -eq 124) { Add-Check 'database:test-target' 'BLOCKED' 'Read-only Prisma migration status timed out after 20 seconds; no write command was run.' 'Check test DB availability and Prisma configuration, then rerun.' }
            elseif ($prismaOutput -match 'EPERM|spawn') { Add-Check 'database:test-target' 'BLOCKED' 'Prisma migration status was blocked by process execution policy after target verification; no write command was run.' 'Run the same read-only status command in the approved local shell.' }
            else { Add-Check 'database:test-target' 'FAIL' 'Read-only Prisma migration status failed for the validated test target; command output was withheld to avoid accidental URL disclosure.' 'Inspect the local Prisma migration configuration without sharing environment output.' }
        }
    }
}

$counts = @{
    PASS = @($checks | Where-Object status -eq 'PASS').Count
    FAIL = @($checks | Where-Object status -eq 'FAIL').Count
    BLOCKED = @($checks | Where-Object status -eq 'BLOCKED').Count
    SKIPPED = @($checks | Where-Object status -eq 'SKIPPED').Count
}
$overall = if ($counts.FAIL -gt 0) { 'FAIL' } elseif ($counts.BLOCKED -gt 0) { 'BLOCKED' } elseif ($counts.SKIPPED -gt 0) { 'PARTIAL' } else { 'PASS' }
$result = [pscustomobject]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    repository = 'PulseLink'
    gitHead = ((& git -C $repoRoot rev-parse --short HEAD 2>$null) | Out-String).Trim()
    overall = $overall
    counts = $counts
    checks = @($checks)
    safety = @('No serial port opened','No flash/reset/erase/eFuse/security provisioning','No database writes or migrations','No production/staging service intentionally probed','No credentials included in output')
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$jsonPath = Join-Path $OutputDirectory 'commissioning-preflight.json'
$markdownPath = Join-Path $OutputDirectory 'commissioning-preflight.md'
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $jsonPath -Encoding utf8
$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add('# PulseLink commissioning preflight')
$lines.Add('')
$lines.Add("Generated UTC: $($result.generatedAtUtc)")
$lines.Add("Git HEAD: $($result.gitHead)")
$lines.Add("Overall: **$overall** — PASS $($counts.PASS), FAIL $($counts.FAIL), BLOCKED $($counts.BLOCKED), SKIPPED $($counts.SKIPPED)")
$lines.Add('')
$lines.Add('| Check | Status | Result | Next action |')
$lines.Add('| --- | --- | --- | --- |')
foreach ($check in $checks) {
    $safeDetail = $check.detail -replace '\|','/'
    $safeAction = $check.nextAction -replace '\|','/'
    $lines.Add("| $($check.name) | $($check.status) | $safeDetail | $safeAction |")
}
$lines.Add('')
$lines.Add('Hardware safety: serial enumeration only; no COM port opened. No flash, reset, erase, eFuse, Wi-Fi credential transfer, database write, production/staging request, or real notification was performed by this script.')
$lines | Set-Content -LiteralPath $markdownPath -Encoding utf8
Write-Output "Overall=$overall PASS=$($counts.PASS) FAIL=$($counts.FAIL) BLOCKED=$($counts.BLOCKED) SKIPPED=$($counts.SKIPPED)"
Write-Output "JSON=$jsonPath"
Write-Output "Markdown=$markdownPath"

if ($counts.FAIL -gt 0) { exit 1 }
if ($counts.BLOCKED -gt 0) { exit 2 }
if ($counts.SKIPPED -gt 0) { exit 3 }
exit 0
