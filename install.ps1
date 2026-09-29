<#
    Installs FRSMiniMap into the game, next to SpeedLoader:

        <game>\scripts\SpeedLoader\mods\frsminimap\

        .\install.ps1                          # F:\Games\NFSU2
        .\install.ps1 -GameDir "D:\Games\NFSU2"

    Safe with the game running: it only copies files, and the page picks them
    up on F5. Needs SpeedLoader installed (the scripts\SpeedLoader folder).
#>
param(
    [string]$GameDir = "F:\Games\NFSU2"
)

$root = $PSScriptRoot
$mods = Join-Path $GameDir "scripts\SpeedLoader\mods"
if (-not (Test-Path $mods)) { throw "SpeedLoader is not installed in $GameDir (no scripts\SpeedLoader\mods)" }

# a quick check that the script still parses, if SpeedLoader's checker is at hand
$check = Join-Path $root "..\SpeedLoader\tools\modcheck.js"
if ((Test-Path $check) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $out = & node $check (Join-Path $root "main.js") 2>&1
    if ($LASTEXITCODE -ne 0) { $out; throw "main.js does not pass modcheck" }
}

$dest = Join-Path $mods "frsminimap"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $root "mod.json"), (Join-Path $root "main.js") $dest -Force
Copy-Item (Join-Path $root "ui") $dest -Recurse -Force
New-Item -ItemType Directory -Force (Join-Path $dest "maps") | Out-Null
Copy-Item (Join-Path $root "maps\*") (Join-Path $dest "maps") -Force

$dds = @(Get-ChildItem (Join-Path $root "maps") -Filter *.dds -ErrorAction SilentlyContinue).Count
if ($dds -eq 0) {
    "[..] no redrawn maps in maps\ - the minimap will use the game's own (512 px)."
    "     To use the redrawn ones: .\tools\extract-maps.ps1 -Zip <NFSU2 Detailed Map zip>"
}

# the mod's first home was mods\minimap, installed by SpeedLoader; two copies
# would both hide the stock minimap and patch the same functions
$old = Join-Path $mods "minimap"
if ((Test-Path (Join-Path $old "main.js")) -and
    (Select-String -Path (Join-Path $old "main.js") -Pattern "Minimapa|FRSMiniMap" -Quiet)) {
    Remove-Item $old -Recurse -Force
    "[ok] removed the old copy in mods\minimap"
}
"[ok] FRSMiniMap installed in $dest ($dds redrawn maps)"
