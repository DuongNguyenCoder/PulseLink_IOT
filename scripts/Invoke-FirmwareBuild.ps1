[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$firmwarePath = Join-Path $PSScriptRoot '..\firmware\esp32'
$firmwarePath = (Resolve-Path -LiteralPath $firmwarePath).Path

if (-not (Get-Command idf.py -ErrorAction SilentlyContinue)) {
    Write-Error 'idf.py was not found. Open the ESP-IDF PowerShell for ESP-IDF v5.5.5 and run this script again.'
    exit 1
}

Write-Host '==> ESP-IDF version'
$versionOutput = (& idf.py --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    Write-Error "Unable to query idf.py: $versionOutput"
    exit 1
}
Write-Host $versionOutput
if ($versionOutput -notmatch 'ESP-IDF v5\.5\.5(?:\s|$)') {
    Write-Error 'The active ESP-IDF version is not v5.5.5.'
    exit 1
}

Write-Host "`n==> Firmware build: $firmwarePath"
Push-Location $firmwarePath
try {
    & idf.py build
    if ($LASTEXITCODE -ne 0) {
        throw "idf.py build exited with code $LASTEXITCODE."
    }
    Write-Host 'PASS: firmware build'
}
catch {
    Write-Error "FAIL: firmware build - $($_.Exception.Message)"
    exit 1
}
finally {
    Pop-Location
}

Write-Host 'No flash, erase, monitor, or COM-port operation was performed.'
exit 0
