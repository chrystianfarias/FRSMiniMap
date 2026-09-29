<#
    Packs a drop-in release of FRSMiniMap into release\ (ignored by git):

        release\FRSMiniMap-<version>\
          INSTALL.txt
          LICENSE.txt
          scripts\FRSModLoader\mods\frsminimap\    mod.json, main.js, thumb.jpg, ui\, maps\
        release\FRSMiniMap-<version>.zip

        .\release.ps1                  version from mod.json, stage and zip
        .\release.ps1 -NoZip           leave the folder, skip the .zip

    The player unpacks it into the folder with SPEED2.EXE, over an installed
    FRSModLoader (v1.2 or later). The "NFSU2 Detailed Map" zip is never
    packed: it is JeansBig's, and the player drops it in themselves.
#>
param(
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$manifest = Get-Content (Join-Path $root "mod.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$name = "FRSMiniMap-$version"
$out = Join-Path $root "release"
$stage = Join-Path $out $name

# the script has to parse, and call nothing that is not there
$check = Join-Path $root "..\SpeedLoader\tools\modcheck.js"
if ((Test-Path $check) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $result = & node $check (Join-Path $root "main.js") 2>&1
    if ($LASTEXITCODE -ne 0) { $result; throw "main.js does not pass modcheck" }
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
$mod = Join-Path $stage "scripts\FRSModLoader\mods\frsminimap"
New-Item -ItemType Directory -Force $mod | Out-Null
Copy-Item (Join-Path $root "mod.json"), (Join-Path $root "main.js"), (Join-Path $root "thumb.jpg") $mod
Copy-Item (Join-Path $root "ui") $mod -Recurse
New-Item -ItemType Directory -Force (Join-Path $mod "maps") | Out-Null
Copy-Item (Join-Path $root "maps\calibration.json") (Join-Path $mod "maps")
Copy-Item (Join-Path $root "LICENSE") (Join-Path $stage "LICENSE.txt")

@"
FRSMiniMap $version
A 3D minimap and an expanded map for Need for Speed Underground 2 (v1.2 NTSC).

REQUIRES FRSModLoader v1.2 or later:
  https://github.com/chrystianfarias/SpeedLoader
FRSMiniMap is a mod for the loader, not a standalone .asi. Without the loader
installed it does nothing.

INSTALL

  1. Install FRSModLoader (v1.2+) and start the game once: the Options menu
     gets a "Mods" entry.
  2. Close the game. Copy the "scripts" folder of this package into the
     folder with SPEED2.EXE, merging with the "scripts" folder that is there.
     The mod ends up in:
         <game>\scripts\FRSModLoader\mods\frsminimap\
  3. Optional, for sharper maps: download "NFSU2 Detailed Map v1" by JeansBig
     and put its zip, as downloaded, into that frsminimap folder, next to
     mod.json. Do not extract it: the mod reads the maps out of the zip.
  4. Start the game. The options are in Options > Mods > FRSMiniMap.

IN THE GAME

  M opens the expanded map: drag to pan, wheel or + / - to zoom, C to centre.
  A click on an event sets the GPS there; a double click on the map puts a
  marker of your own with the route to it (a double click on it takes it
  away). The list on the left turns each kind of event on and off.

UNINSTALL

  Delete <game>\scripts\FRSModLoader\mods\frsminimap\, or switch the mod off
  in Options > Mods.

LICENSE

  CC BY-NC 4.0 - Copyright (c) 2025 Chrystian Farias. See LICENSE.txt.
  If the mod helps you: https://buymeacoffee.com/chrystianfarias
"@ | Set-Content (Join-Path $stage "INSTALL.txt") -Encoding UTF8

"[ok] staged $stage"
if (-not $NoZip) {
    $zip = Join-Path $out "$name.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    # entries with "/", which every unzip reads (Compress-Archive in
    # PowerShell 5.1 writes "\", which some take as part of the name)
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        foreach ($f in Get-ChildItem $stage -Recurse -File) {
            $entry = $f.FullName.Substring($stage.Length + 1).Replace([string][char]92, '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entry, 'Optimal')
        }
    } finally { $archive.Dispose() }
    "[ok] $zip ($([math]::Round((Get-Item $zip).Length / 1KB)) KB)"
}
