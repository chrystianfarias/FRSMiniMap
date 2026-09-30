<#
    Installs FRSMiniMap into the game, next to FRSModLoader:

        <game>\scripts\FRSModLoader\mods\frsminimap\

        .\install.ps1                          # F:\Games\NFSU2
        .\install.ps1 -GameDir "D:\Games\NFSU2"

    Safe with the game running: it only copies files, and the page picks them
    up on F5. Needs FRSModLoader installed (the scripts\FRSModLoader folder).
#>
param(
    [string]$GameDir = "F:\Games\NFSU2"
)

$root = $PSScriptRoot
$mods = Join-Path $GameDir "scripts\FRSModLoader\mods"
if (-not (Test-Path $mods)) { throw "FRSModLoader is not installed in $GameDir (no scripts\FRSModLoader\mods)" }

# a quick check that the script still parses, if FRSModLoader's checker is at hand
$check = Join-Path $root "..\SpeedLoader\tools\modcheck.js"
if ((Test-Path $check) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $out = & node $check (Join-Path $root "main.js") 2>&1
    if ($LASTEXITCODE -ne 0) { $out; throw "main.js does not pass modcheck" }
}

$dest = Join-Path $mods "frsminimap"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $root "mod.json"), (Join-Path $root "main.js"), (Join-Path $root "thumb.jpg") $dest -Force
Copy-Item (Join-Path $root "ui") $dest -Recurse -Force
# the pictures of Options > Mods (tools\demo\shoot.py makes them)
# replaced, not merged: a picture that is gone from the repo goes from the game too
$legend = Join-Path $dest "legend"
if (Test-Path $legend) { Remove-Item $legend -Recurse -Force }
Copy-Item (Join-Path $root "legend") $dest -Recurse -Force
New-Item -ItemType Directory -Force (Join-Path $dest "maps") | Out-Null
# calibration.json and the themes' layers (maps\layers, from tools\map_layers.py)
Copy-Item (Join-Path $root "maps\*") (Join-Path $dest "maps") -Recurse -Force

# The "NFSU2 Detailed Map" zip, as downloaded, next to mod.json: the mod reads
# the maps straight out of it (FRSModLoader's GameTextures looks inside the zips
# in a mod's root). Copied only when it changed - it is 44 MB.
$zips = @(Get-ChildItem $root -Filter *.zip -File)
foreach ($z in $zips) {
    $there = Join-Path $dest $z.Name
    if (-not (Test-Path $there) -or (Get-Item $there).Length -ne $z.Length) { Copy-Item $z.FullName $dest -Force }
}

# the mod's first home was mods\minimap, installed by FRSModLoader; two copies
# would both hide the stock minimap and patch the same functions
$old = Join-Path $mods "minimap"
if ((Test-Path (Join-Path $old "main.js")) -and
    (Select-String -Path (Join-Path $old "main.js") -Pattern "Minimapa|FRSMiniMap" -Quiet)) {
    Remove-Item $old -Recurse -Force
    "[ok] removed the old copy in mods\minimap"
}
"[ok] FRSMiniMap installed in $dest ($($zips.Count) map pack(s))"
