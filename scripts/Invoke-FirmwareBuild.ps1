[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('default', 'staging')]
    [string]$Profile
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Build-FirmwareProfile.ps1') -Profile $Profile
