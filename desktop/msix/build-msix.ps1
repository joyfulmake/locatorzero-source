# Packs the Windows build into an unsigned .msix for the Microsoft Store, which signs it on submission.
#   pwsh desktop/msix/build-msix.ps1 -Target x86_64-pc-windows-msvc
# Store identity comes from repository variables (Partner Center → Product identity):
#   MSIX_IDENTITY_NAME, MSIX_PUBLISHER (CN=...), MSIX_PUBLISHER_DISPLAY_NAME
# Without them, test values are used so the package can still be built and tested.
param([string]$Target = 'x86_64-pc-windows-msvc')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$conf = Get-Content (Join-Path $root 'desktop\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$version = "$($conf.version).0"     # the Store wants four parts, the last one 0

function Pick($value, $fallback) { if ([string]::IsNullOrWhiteSpace($value)) { $fallback } else { $value } }
$name = Pick $env:MSIX_IDENTITY_NAME 'LocatorZero.LocatorZeroTest'
$publisher = Pick $env:MSIX_PUBLISHER 'CN=LocatorZero Test'
$display = Pick $env:MSIX_PUBLISHER_DISPLAY_NAME 'LocatorZero'

$release = Join-Path $root "desktop\src-tauri\target\$Target\release"
$stage = Join-Path $release 'msix-stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item (Join-Path $release 'locatorzero.exe') $stage
Copy-Item -Recurse (Join-Path $root 'extension') (Join-Path $stage 'extension')   # bundled resource, as in the installers
Copy-Item -Recurse (Join-Path $PSScriptRoot 'Assets') (Join-Path $stage 'Assets')

$manifest = (Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw).
  Replace('{{NAME}}', $name).Replace('{{PUBLISHER}}', $publisher).
  Replace('{{PUBLISHER_DISPLAY}}', $display).Replace('{{VERSION}}', $version)
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding $false))

$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe not found: install the Windows SDK' }

$out = Join-Path $release 'bundle\msix'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$msix = Join-Path $out "LocatorZero_$($conf.version)_x64.msix"
& $makeappx.FullName pack /d $stage /p $msix /o
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }
Write-Host "Built $msix (identity $name, publisher shown as '$display')"
