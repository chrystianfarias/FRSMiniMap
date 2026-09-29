![FRSMiniMap](docs/cover.jpg)

# FRSMiniMap

A 3D minimap for **NFS Underground 2** (`SPEED2.EXE` v1.2 NTSC), built on
[FRSModLoader](https://github.com/chrystianfarias/FRSModLoader). It replaces the game's radar with a tilted map
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
- **An expanded map on M**, in place of the game's: full screen, drag to pan
  with inertia, wheel to zoom towards the cursor, keyboard too; a click on an
  event sets the GPS, a double click puts a marker of your own with its route.

## Requirements

- **[FRSModLoader](https://github.com/chrystianfarias/FRSModLoader) >= 0.1.2** (required).
- Optional: the **"NFSU2 Detailed Map v1"** zip by JeansBig, as downloaded,
  for sharper maps (the mod reads it without extracting it).

## Install

With the game closed:

1. Install **FRSModLoader** (see its README) and start the game once to make
   sure it loads: the Options menu gets a **Mods** entry.
2. Copy this mod into the loader's mods folder, as a folder named
   `frsminimap`:

   ```
   <game>\scripts\FRSModLoader\mods\frsminimap\
     mod.json
     main.js
     thumb.jpg
     ui\
     maps\
   ```

3. Optional: put the Detailed Map zip in that same folder, next to
   `mod.json`, with its name as downloaded
   (`2d7d87-NFSU2 Detailed Map v1 Reup.zip`).
4. Start the game. FRSMiniMap shows up in **Options > Mods**, with its
   picture, its on/off switch and its options.

From a clone of this repository, `install.ps1` does steps 2 and 3 (it also
copies a zip lying next to `mod.json`):

```powershell
.\install.ps1                          # F:\Games\NFSU2
.\install.ps1 -GameDir "D:\Games\NFSU2"
```

It only copies files, so it is safe with the game running (F5 on the UI
reloads the page), and it stops with an error if FRSModLoader is not
installed in that game folder. Installing or updating the loader with its
own `install.ps1` replaces the whole `mods` folder: run this one again after
it.

To uninstall, delete `scripts\FRSModLoader\mods\frsminimap\`, or switch the
mod off in Options > Mods.

## In the game

The options are in the game's **Options > Mods > FRSMiniMap**, kept by the
loader between sessions:

| Option | |
|---|---|
| Shape | Round (default), or Rectangular as GTA V's |
| Edge | Infinite: the map fades out at the edges (default); or Solid, with an outline |
| Icons | Pins with icons (default), or Native: the game's circles and colours |
| Turn with | the map turns with the Camera (default) or with the Car |
| Dynamic zoom | the zoom opens up with speed (default), or stays |
| Blue GPS arrow | Hide (default) or Show the HUD's blue GPS arrow |

`/minimap` in the console shows the state (position, track, career, GPS).

On the expanded map (M): drag to pan, wheel, Q/E or the + and - buttons to zoom, WASD or the arrows
to move, C or the button under the zoom ones to centre on the car, a click on a pin to set the GPS there, a double click on the map to put a
marker of your own there with the route to it (a double click on the marker
takes it away), Esc or M to close. The filters are the game's own, set on its
pause map.

## Layout

```
mod.json, main.js     the in-game side: reads memory, talks to the page
thumb.jpg             the picture in Options > Mods
docs/cover.jpg        the cover at the top of this file
ui/index.html         the page: draws the map, markers, route
ui/icons/             pin, player arrow and the markers' icons
maps/calibration.json framing of the redrawn maps the pack recalibrates
*.zip                 the Detailed Map pack, optional (not in git)
tools/                minimap_calibrate.py (measures calibration.json);
                      minimap_dev.py (dumps the map data to look at while
                      developing)
NOTES.md              what was found in the game, and why the mod does what it does
release.ps1           packs a release zip into release/ (not in git)
```

## License

**CC BY-NC 4.0** - Copyright (c) 2025 Chrystian Farias.

You may use, modify and redistribute this, including your own forks and
derivative mods, as long as you credit Chrystian Farias and link back to
<https://github.com/chrystianfarias/FRSMiniMap>, and as long as it is not for
commercial purposes. For a commercial license, ask:
<https://buymeacoffee.com/chrystianfarias>. See [LICENSE](LICENSE).

If the mod helps you, you can [buy me a coffee](https://buymeacoffee.com/chrystianfarias).

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
