[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('default', 'staging')]
    [string]$Profile
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$firmwareRoot = (Resolve-Path -LiteralPath (Join-Path $repositoryRoot 'firmware\esp32')).Path
$idfCommand = Get-Command idf.py -ErrorAction SilentlyContinue
if ($null -eq $idfCommand) {
    throw 'idf.py was not found. Start the ESP-IDF v5.5.5 PowerShell environment and retry.'
}

$idfPythonScript = Join-Path $env:IDF_PATH 'tools\idf.py'
if ([string]::IsNullOrWhiteSpace($env:IDF_PATH) -or -not (Test-Path -LiteralPath $idfPythonScript)) {
    throw 'IDF_PATH does not identify an ESP-IDF installation. Start the ESP-IDF v5.5.5 PowerShell environment and retry.'
}
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $pythonCommand) {
    throw 'The activated ESP-IDF Python interpreter was not found.'
}
$idfVersion = (& $pythonCommand.Source $idfPythonScript --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $idfVersion -notmatch 'ESP-IDF v5\.5\.5(?:\s|$)') {
    throw "Expected ESP-IDF v5.5.5; detected: $idfVersion"
}

$buildDirectory = Join-Path $firmwareRoot "build\profiles\$Profile"
$sdkconfigPath = Join-Path $buildDirectory 'sdkconfig'
$defaultsPaths = @((Join-Path $firmwareRoot 'sdkconfig.defaults'))
if ($Profile -eq 'staging') {
    $defaultsPaths += Join-Path $firmwareRoot 'sdkconfig.staging.defaults'
}
$defaultsArgument = ($defaultsPaths -join ';')
$sdkconfigArgument = $sdkconfigPath.Replace('\', '/')
$defaultsArgument = $defaultsArgument.Replace('\', '/')

New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
Push-Location $firmwareRoot
try {
    $idfArgs = @('-B', $buildDirectory, '-D', 'IDF_TARGET=esp32s3', '-D', "SDKCONFIG=$sdkconfigArgument", '-D', "SDKCONFIG_DEFAULTS=$defaultsArgument")
    Write-Host "Profile: $Profile"
    Write-Host "SDKCONFIG: $sdkconfigArgument"
    Write-Host "SDKCONFIG_DEFAULTS: $defaultsArgument"
    Write-Host "Build directory: $buildDirectory"
    Write-Host "ESP-IDF: $idfVersion"

    & idf.py @idfArgs reconfigure
    if ($LASTEXITCODE -ne 0) { throw "idf.py reconfigure failed with exit code $LASTEXITCODE" }

    $sdkconfigContent = Get-Content -LiteralPath $sdkconfigPath -Raw
    $requiredSettings = @{
        CONFIG_IDF_TARGET = '"esp32s3"'
        CONFIG_ESPTOOLPY_FLASHSIZE_16MB = 'y'
        CONFIG_PARTITION_TABLE_SINGLE_APP = 'y'
        CONFIG_PULSELINK_BUILD_PROFILE = "`"$Profile`""
        CONFIG_PULSELINK_BUTTON_GPIO = '4'
        CONFIG_PULSELINK_COMMISSIONING_ENABLED = 'y'
        CONFIG_PULSELINK_COMMISSIONING_BUTTON_GPIO = '5'
        CONFIG_PULSELINK_DEVICE_IDENTITY_NVS_PROVIDER = 'y'
        CONFIG_PULSELINK_OPERATIONAL_CREDENTIAL_STORAGE = 'y'
        CONFIG_COMPILER_OPTIMIZATION_SIZE = 'y'
    }
    foreach ($key in $requiredSettings.Keys) {
        $requiredPattern = '(?m)^' + [regex]::Escape($key) + '=' + [regex]::Escape([string]$requiredSettings[$key]) + '\r?$'
        if ($sdkconfigContent -notmatch $requiredPattern) {
            throw "Effective sdkconfig does not satisfy the $Profile profile requirement: $key"
        }
    }
    foreach ($key in @('CONFIG_PULSELINK_DEVICE_TOKEN')) {
        $emptyValuePattern = '(?m)^' + [regex]::Escape($key) + '=""\r?$'
        if ($sdkconfigContent -notmatch $emptyValuePattern) {
            throw "Refusing to build $Profile profile: build-time device token must be empty."
        }
    }

    $cachePath = Join-Path $buildDirectory 'CMakeCache.txt'
    $cacheContent = Get-Content -LiteralPath $cachePath -Raw
    foreach ($expectedCacheValue in @('IDF_TARGET:STRING=esp32s3', "SDKCONFIG:UNINITIALIZED=$sdkconfigArgument", "SDKCONFIG_DEFAULTS:UNINITIALIZED=$defaultsArgument")) {
        if ($cacheContent -notmatch [regex]::Escape($expectedCacheValue)) {
            throw "CMake cache does not match the selected $Profile profile: $expectedCacheValue"
        }
    }

    & idf.py @idfArgs build
    if ($LASTEXITCODE -ne 0) { throw "idf.py build failed with exit code $LASTEXITCODE" }

    $artifactPath = Join-Path $buildDirectory 'pulselink_firmware.bin'
    $artifact = Get-Item -LiteralPath $artifactPath
    $artifactHash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
    Write-Host "BUILD PASS: profile=$Profile target=esp32s3 image=$artifactPath size_bytes=$($artifact.Length) sha256=$artifactHash"
    Write-Host 'Build completed only; no flash, erase, monitor, or serial operation was run.'
}
finally {
    Pop-Location
}
