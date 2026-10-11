# CI check that the .msix really installs: sign a throwaway copy with a temporary self-signed certificate, trust it
# on this build machine only, install, confirm Windows registered it, then remove everything. The Store signs the
# real package; this certificate is never published.
param([string]$Target = 'x86_64-pc-windows-msvc')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$msix = Get-ChildItem (Join-Path $root "desktop\src-tauri\target\$Target\release\bundle\msix\*.msix") | Select-Object -First 1
$test = Join-Path $env:RUNNER_TEMP 'locatorzero-test.msix'
Copy-Item $msix.FullName $test -Force

$publisher = if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { 'CN=LocatorZero Test' }
$identity = if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { 'LocatorZero.LocatorZeroTest' }
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $publisher -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') -NotAfter (Get-Date).AddDays(1)
$pfx = Join-Path $env:RUNNER_TEMP 'test.pfx'
$pw = ConvertTo-SecureString -String 'test' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $pw | Out-Null

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1
& $signtool.FullName sign /fd SHA256 /f $pfx /p test $test
if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }

Add-AppxPackage -Path $test
$pkg = Get-AppxPackage -Name $identity
if (-not $pkg) { throw 'the package did not register' }
Write-Host "Installed: $($pkg.Name) $($pkg.Version), publisher shown as '$((Get-AppxPackageManifest $pkg).Package.Properties.PublisherDisplayName)'"
if (-not (Test-Path (Join-Path $pkg.InstallLocation 'locatorzero.exe'))) { throw 'locatorzero.exe missing from the installed package' }
if (-not (Test-Path (Join-Path $pkg.InstallLocation 'extension\manifest.json'))) { throw 'bundled extension missing' }

Remove-AppxPackage -Package $pkg.PackageFullName
Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object { $_.Thumbprint -eq $cert.Thumbprint } | Remove-Item
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)"
Write-Host 'MSIX install test passed'
