$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$config = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
[xml]$manifest = Get-Content 'store/AppxManifest.xml' -Raw
if ($manifest.Package.Identity.Version -ne "$($config.version).0") {
    throw 'MSIX manifest version does not match the app version.'
}
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}/Windows Kits/10/bin" -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'x64/makeappx.exe') } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$sdk) { throw 'Windows SDK MakeAppx was not found.' }
$stage = Join-Path $root 'dist/msix-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item "$stage/Assets" -ItemType Directory -Force | Out-Null
Copy-Item 'src-tauri/target/release/coinjura-widget.exe' $stage
Copy-Item 'store/AppxManifest.xml' $stage
foreach ($icon in @('StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png')) {
    Copy-Item "src-tauri/icons/$icon" "$stage/Assets/"
}
$output = Join-Path $root "dist/coinjura-widget-store-$($config.version)-x64.msix"
& "$($sdk.FullName)/x64/makeappx.exe" pack /d $stage /p $output /o
if ($LASTEXITCODE -ne 0) { throw 'MSIX validation or packaging failed.' }
$hash = (Get-FileHash $output -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path $output -Leaf)" | Set-Content "$output.sha256" -Encoding utf8
