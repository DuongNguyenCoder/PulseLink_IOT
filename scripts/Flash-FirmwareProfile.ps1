[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('default', 'staging')]
    [string]$Profile,
    [string]$Port,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not $DryRun -and $Port -notmatch '^COM[0-9]+$') {
    throw 'A verified serial port such as COM7 is required for flash. No port is opened by this validation.'
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$firmwareRoot = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot 'firmware\esp32')).Path
$buildScript = Join-Path $PSScriptRoot 'Build-FirmwareProfile.ps1'
& $buildScript -Profile $Profile

$buildDirectory = Join-Path $firmwareRoot "build\profiles\$Profile"
$sdkconfigPath = Join-Path $buildDirectory 'sdkconfig'
$defaultsPaths = @((Join-Path $firmwareRoot 'sdkconfig.defaults'))
if ($Profile -eq 'staging') { $defaultsPaths += Join-Path $firmwareRoot 'sdkconfig.staging.defaults' }
$sdkconfigArgument = $sdkconfigPath.Replace('\', '/')
$defaultsArgument = (($defaultsPaths -join ';').Replace('\', '/'))
$artifactPath = Join-Path $buildDirectory 'pulselink_firmware.bin'
$artifact = Get-Item -LiteralPath $artifactPath
$artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
if ($artifact.Length -ge 0x100000) {
    throw "Refusing to flash: app image size $($artifact.Length) does not fit the 1 MiB app partition."
}

$cachePath = Join-Path $buildDirectory 'CMakeCache.txt'
$cacheContent = Get-Content -LiteralPath $cachePath -Raw
foreach ($expectedCacheValue in @('IDF_TARGET:STRING=esp32s3', "SDKCONFIG:UNINITIALIZED=$sdkconfigArgument", "SDKCONFIG_DEFAULTS:UNINITIALIZED=$defaultsArgument")) {
    if ($cacheContent -notmatch [regex]::Escape($expectedCacheValue)) {
        throw "Refusing to flash: CMake cache does not match profile '$Profile'."
    }
}

Write-Host ''
Write-Host 'FLASH REVIEW — no write has happened yet'
Write-Host "Profile: $Profile"
Write-Host "Target: esp32s3"
Write-Host "Config file: $sdkconfigPath"
Write-Host "Defaults: $defaultsArgument"
Write-Host "Build directory: $buildDirectory"
Write-Host "Firmware artifact: $artifactPath"
Write-Host "Image size: $($artifact.Length) bytes / 1 MiB partition"
Write-Host "SHA256: $artifactHash"
Write-Host 'Flash offsets: bootloader 0x0; partition table 0x8000; app 0x10000; NVS is not an image artifact.'
Write-Host 'The command does not request a full-chip erase or NVS erase.'

if ($DryRun) {
    Write-Host 'DRY RUN: flash command not executed.'
    return
}

if ($Profile -eq 'staging' -and $artifactHash -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'Refusing to flash staging image: invalid artifact digest.'
}
$confirmation = Read-Host "To proceed, type exactly: FLASH $Profile $artifactHash"
if ($confirmation -cne "FLASH $Profile $artifactHash") {
    throw 'Flash confirmation did not match; no flash command was executed.'
}

$idfCommand = Get-Command idf.py -ErrorAction SilentlyContinue
if ($null -eq $idfCommand) { throw 'idf.py was not found in the active ESP-IDF environment.' }

Push-Location $firmwareRoot
try {
    & idf.py -B $buildDirectory -D 'IDF_TARGET=esp32s3' -D "SDKCONFIG=$sdkconfigArgument" -D "SDKCONFIG_DEFAULTS=$defaultsArgument" -p $Port flash
    if ($LASTEXITCODE -ne 0) { throw "idf.py flash failed with exit code $LASTEXITCODE" }
    Write-Host "FLASH COMMAND COMPLETED: profile=$Profile target=esp32s3 sha256=$artifactHash port=$Port"
}
finally {
    Pop-Location
}
