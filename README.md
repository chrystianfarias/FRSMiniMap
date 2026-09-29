# FRSMiniMap

A 3D minimap for **NFS Underground 2** (`SPEED2.EXE` v1.2 NTSC), built on
[SpeedLoader](../SpeedLoader). It replaces the game's radar with a tilted map
in perspective that turns with the camera, and reads everything it shows from
the game itself: the map, the races and shops the career has open, the
legend's filters, the GPS route, the other racers.

## What it does

- **The map in perspective**, framed by each track's own calibration
  (`TrackInfo`), for free roam and every race. With the "NFSU2 Detailed Map"
  zip in the mod's folder it uses its redrawn maps (2048 px), read straight
  out of the zip; without it, the game's own (512 px).
- **Turns with the camera**, GTA-style (or with the car), smoothed.
- **Dynamic zoom**: opens up with speed, down to half the base zoom.
- **Race starts and shops** as the pause map shows them right now: only what
  the career has available and discovered, with the legend's filters, and the
  special events (the X) apart - the game is asked entry by entry, with its own
  functions.
- **The nearest of each kind at the edge** when it is out of sight, fading
  with distance.
- **The GPS route** as a line along the streets, read from the game's route
  and cleared behind the car as it goes; with a route set, only the
  destination stays on the map.
- **The other racers** as arrows.
- **Two marker styles**: pins with icons, or the game's own circles and
  colours.
- **Hides the stock minimap**, and nothing else of the HUD; optionally, also
  the blue GPS arrow that floats ahead of the car.

## Requirements

- SpeedLoader installed in the game, with its `GameTextures`
  (`http://nfsu2.tex/`, including `mod/<id>/<path>.dds`) and `GameData`
  (`http://nfsu2.data/`: `roads.json`, `graph.json`, `events.json`,
  `shops.json`) hosts.
- Optional, for the sharp maps: the "NFSU2 Detailed Map v1" pack by JeansBig,
  **the zip as downloaded**, next to `mod.json`. Nothing is extracted and
  nothing of it is installed into the game: SpeedLoader reads each map out of
  the zip when the minimap asks for it (entries compressed with LZMA, as 7-Zip
  writes them; the `Default` variant, never `Beta`).

## Install

```powershell
# optional: put "2d7d87-NFSU2 Detailed Map v1 Reup.zip" here, next to mod.json
.\install.ps1                      # F:\Games\NFSU2
.\install.ps1 -GameDir "D:\Games\NFSU2"
```

It copies the mod, and the zip if there is one, to
`<game>\scripts\SpeedLoader\mods\frsminimap\`. The zip can also be dropped
straight into that folder. It is safe
with the game running: press F5 on the UI to reload it.

## In the game

`/minimap` in the console shows the state (position, track, career, GPS) and
changes the options, which are kept between sessions:

| Command | |
|---|---|
| `/minimap icones pin \| nativo` | pins with icons, or the game's circles and colours |
| `/minimap giro camera \| carro` | the map turns with the camera (default) or with the car |
| `/minimap zoom dinamico \| fixo` | zoom opens with speed (default), or stays |
| `/minimap seta esconder \| mostrar` | hide (default) or show the HUD's blue GPS arrow |

## Layout

```
mod.json, main.js     the in-game side: reads memory, talks to the page
ui/index.html         the page: draws the map, markers, route
ui/icons/             pin, player arrow and the markers' icons
maps/calibration.json framing of the redrawn maps the pack recalibrates
*.zip                 the Detailed Map pack, optional (not in git)
tools/                minimap_calibrate.py (measures calibration.json);
                      minimap_dev.py (dumps the map data to look at while
                      developing)
NOTES.md              what was found in the game, and why the mod does what it does
```

## Credits

- Redrawn maps: **"NFSU2 Detailed Map"** by JeansBig - not included; drop the
  pack's zip next to `mod.json`.
- Marker icons (`car`, `flag-checkered`, `house`, `spray-can`, `star`,
  `volume`, `wrench`): **Font Awesome Free** 7, by Fonticons, Inc., under
  [CC BY 4.0](https://fontawesome.com/license/free); the notice is kept in
  each file.
- The pin and the player arrow were drawn for this mod; `xmark.svg` is a
  placeholder.
- The race-start and road-graph formats build on the reverse engineering done
  for FRSWorldEditor.
