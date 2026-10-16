[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$apiPath = Join-Path $PSScriptRoot '..\server\api'
$apiPath = (Resolve-Path -LiteralPath $apiPath).Path
$failed = $false
$missing = @()

function Invoke-Check {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host "`n==> $Name"
    Push-Location $apiPath
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "'$Name' exited with code $LASTEXITCODE."
        }
        Write-Host "PASS: $Name"
    }
    catch {
        Write-Error "FAIL: $Name - $($_.Exception.Message)"
        $script:failed = $true
    }
    finally {
        Pop-Location
    }
}

Write-Host "PulseLink backend baseline: $apiPath"

Invoke-Check 'TypeScript typecheck' { npm run typecheck }
Invoke-Check 'Backend build' { npm run build }
Invoke-Check 'Automated tests' { npm test }
Invoke-Check 'Prisma schema validation' { .\node_modules\.bin\prisma.cmd validate --schema prisma/schema.prisma }

$package = Get-Content -Raw (Join-Path $apiPath 'package.json') | ConvertFrom-Json
if ($null -eq $package.scripts.lint) {
    $missing += 'lint (no package.json script)'
    Write-Host 'NOT CONFIGURED: lint (no package.json script; no lint dependency was added by WP-01)'
}
else {
    Invoke-Check 'Lint' { npm run lint }
}

if ($missing.Count -gt 0) {
    Write-Host "`nBaseline completed with unconfigured checks: $($missing -join ', ')"
}
elseif (-not $failed) {
    Write-Host "`nBaseline completed: PASS"
}

if ($failed) {
    exit 1
}
if ($missing.Count -gt 0) {
    exit 2
}
exit 0
