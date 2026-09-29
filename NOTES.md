# FRSMiniMap - engineering notes

What was found in SPEED2.EXE (v1.2 NTSC) and in the game's files to build the
minimap, and why the mod does what it does. These sections started in
SpeedLoader's `NOTES.md` and moved here with the mod; SpeedLoader keeps the
parts of the platform the mod relies on (`GameTextures` and `GameData`, the
`http://nfsu2.tex/` and `http://nfsu2.data/` hosts).

A few paths below still name the mod's old place inside SpeedLoader
(`mods/minimap/...`) or SpeedLoader's `tools/`; in this repository they are the
repository root and `tools/`.

## The map and the race starts

The stock minimap is not drawn from the world, it is a texture:
`TRACKS\TRACKMAP<id>.BIN` is a pack holding one 512x512 DXT3 of the same name.
**`TRACKMAP4000` is the free-roam city** with no route highlighted; the others
are the same picture with one race's route painted on. Every L4RA city map uses
one framing, world to pixel:

```
px =  0.0917 * x + 312
py = -0.0917 * y + 298.5
```

The DXT3 alpha of every TRACKMAP is all zero - the game draws them opaque - so
`GameTextures` makes a DXT3 with no alpha at all opaque, and loads a TRACKMAP
pack the first time a page asks for `http://nfsu2.tex/TRACKMAP<id>`. The frame
around it and the icons (`MINIMAP_BORDER`, `MINIMAP_MASK`, `MINIMAP_ICON_CAR`,
`MINIMAP_NORTH_INDICATOR`, `MINIMAP_ICON_CIRCUIT`...) are in `InGameCommon.bun`,
which was already loaded.

The race starts (formats in FRSWorldEditor's `NFSU2-FORMATS.md`): the career
chunk `0x80034A10` of `GLOBALB.BUN` lists 224 races, each naming a trigger by
hash; the trigger is a type `0x0D` zone in `0x3414A` of
`ROUTESL4RA\PathsFreeRoam.bin`, whose centre is where the start icon sits. 222
races resolve to 116 points (the two `DDAY` intros have none).

`tools/minimap_dev.py` dumps all of this into `build\minimap-dev\` - textures
with alpha, `events.json`, and the triggers drawn over TRACKMAP4000 to check
the framing. It is for looking at while developing; the mod reads the textures
from the game at runtime and ships none of them.

### Sharp roads: the GPS's own road graph

The TRACKMAP is 512x512 for the whole city, and any zoom a radar needs blurs
it. The roads the game routes its GPS on are vectors, and they are the ones
drawn instead.

Found through the code: the GPS (`0x81CBC0`) is an incremental A* -
`0x413120` hands the car and the target to `0x40C440`, which only files the
request; `0x40C4D0` keeps the open list sorted by g + h, and the expansion turns
node pointers into indices with `sub [0x883DB0]` / `sar 5`. `0x5DEB80` fills
those globals from chunks `0x34121`..`0x34124`, and the file holding them is
`TRACKS\ROUTES<region>\RoutesFreeRoam.bin` (there is one per race too,
`Routes<id>B/F.bin`):

| Chunk | Global | What |
|---|---|---|
| `0x34121` | through `0x5DE1C0` | the streets: 855 records in L4RA, back to back |
| `0x34122` | `[0x883DB0]`, count `[0x883DB4]` | the planner's nodes, 32 bytes, after a 4-byte lead (3289) |
| `0x34123` | `[0x883DBC]`, count `[0x883DC0]` | 276-byte records |
| `0x34124` | `[0x883DC4]`, count `[0x883DC8]` | 264-byte records (absent in L4RA's free roam) |

A street record (`0x34121`), which is all the minimap reads:

```
+0x00  u32 0x0B, 0x0B
+0x10  char[32] name       "TrackRoutesA10"
+0x34  u16 point count     (twice)
+0x60  f32 x4              plan box
+0x84  u8                  1 = highway: the ring and its approaches (55)
+0x85  u8                  1 = avenue, the main streets (225, highways included)
+0x8C  points, 56 bytes    f32 x, y; u8 +0x0E is 252 on nearly every street
```

The classes were found by drawing each candidate byte over the map, one panel
each. `+0x84` isolates the highways with no noise. Point byte `+0x0E` at 248 or
253 on most of a street's points marks 52 short pieces beside the streets -
connectors, loops, passages the TRACKMAP does not draw - which the minimap
draws as alleys; that reading still needs confirming in the game. Other bytes
that turned out NOT to be a road class: `+0x86` and `+0x8A` (large mixed sets),
point `+0x13` (a district: the whole mountain has one value), and header
`+0x71` bit 2 / point `+0x0F` / `+0x1D`, which mark the short pieces inside
junctions.

Walking them by count lands exactly on the chunk's end. Unlike the race
routes, which were the first attempt, it has the alleys, and every street
once instead of one line per race that uses it. How the 32-byte nodes connect
the streets is the next thing to read, for a GPS line of our own.

`src/ui/GameData.cpp` builds the JSON at runtime from the game folder and
serves it next to the textures on a second host:

- `http://nfsu2.data/L4RA/roads.json` - one polyline per street, world units,
  each with its class: `{"c": "highway" | "avenue" | "street" | "alley", "p": [x, y, ...]}`.
- `http://nfsu2.data/L4RA/events.json` - 116 starts, 222 races, the same as
  `tools/minimap_dev.py` finds, checked value by value.

The minimap drew these as SVG for a while and stopped: tuning widths, tones
and junctions by hand to look like a map was a project of its own, and never
looked as good as a drawn one. What it draws now is the TRACKMAP itself, and
the sharpness comes from "NFSU2 Detailed Map" (JeansBig): every TRACKMAP
redrawn at 2048x2048 DXT5, with the missing shortcuts added. It keeps the
original framing exactly - scaled back to 512 it matches the stock map best at
an offset of zero - so the world-to-map formula holds.

It is not installed into the game (that is Binary rewriting every TRACKMAP
and GLOBALB.LZC): the minimap carries `maps\TRACKMAP4000.dds` in its own
folder, and `GameTextures` decodes it straight from there -
`http://nfsu2.tex/mod/<id>/<path>.dds`, the same DXT code as the packs, only
`.dds`, only under the mods folder, no `..`. Checked against Pillow's decode of
the same file: mean difference under 0.3 per channel, i.e. rounding. The page
falls back to the game's own TRACKMAP4000 when the file is not there. The road graph stays in GameData for what it is really for:
routing and drawing a GPS line.

One cost to keep in mind: GameTextures hands the page an uncompressed PNG, and
a 2048x2048 one is 16 MB, built once and cached for the session.

Two things about the 3D in CSS that cost a test each:

- An element flat in the same plane as the tilted map fights it for depth: the
  car arrow flickered because the plane passes exactly through its point. The
  arrow now lives outside the 3D context, and the map and its roads are one
  flat layer, so nothing is coplanar with anything else.
- The race pins are children of the plane that undo its transform in reverse
  (`scale(1/s) rotate(-r) rotateX(-tilt)`), which makes them stand upright,
  face the camera and keep their screen size, while perspective still shrinks
  the far ones.

### Which map: the loaded track's TrackInfo

`[0x883DAC]` is the TrackInfo of whatever the world was built for - free roam
or a race. `0x57F240` sets it while loading, from `GetTrackInfo` (`0x5D3E40`)
over `TheRaceParameters` (`0x89E7A0`). The records live in chunk `0x34201` of
GLOBALB.BUN, 296 bytes each, 125 of them:

| Offset | What |
|---|---|
| `+0x00` | description, `"(4011) Short Circuit #1"` |
| `+0x40` | region, `"L4RA"` |
| `+0x8A` | u16 track id - 4000 is the city's free roam |
| `+0xAC` | f32 TRACKMAP calibration: world x of the top-left corner |
| `+0xB0` | f32 world y of the top-left corner |
| `+0xB4` | f32 width of the map, in world units |
| `+0xC0` | f32 radar zoom: 1.5 city, 2 drag, 1 drift and Street X |

So a map pixel on the 512 TRACKMAP is `px = (x - ulx) / width * 512`,
`py = (uly - y) / width * 512`. For 4000 that is K = 0.0909, CX = 311.3,
CY = 298.8 - close to what was fitted by eye (0.0917 / 312 / 298.5), and
measurably better: the road graph's points land on brighter map pixels (mean
135 against 126). The minimap reads it live, so every track frames itself.

Checked by drawing each region's road graph over the redrawn maps: drift
(4301, L4RC) and Street X (4601, L4RF) fit exactly. **Drag does not**: a drag
TRACKMAP shows the whole city with the strip drawn on it, but the drag tracks
are their own region (L4RB) with their own coordinates, so the car does not
move over that picture. A straight line barely needs a radar; left as is.

The zoom factor is applied to map pixels, not to world units: at constant
world scale a drift track, 739 units across, would be a speck in the middle
of the radar.

### The redrawn maps and their own framing

The minimap carries all 115 of the pack's maps (the Default variant where there
is a choice, the pack's root for drift 43xx and Street X 46xx, which have
none): 461 MB, next to `mods/minimap/maps/`. Most keep the game's framing. Two
groups do not, and the pack fixes them with GLOBALB edits in its `script.end`
that the minimap does not make:

- **URL circuit, 4701-4709.** The pack moves the circuit into an enlarged inset
  in the top-right corner, and edits `TrackMapCalibrationOffsetX/Y` and
  `TrackMapCalibrationZoomIn`.
- **URL airport, 4711-4716.** It edits `TrackMapCalibrationOffsetY` only.

The script's numbers cannot be copied as they stand: for the airport,
`OffsetY 3500` is the top-left y in world units (+0xB0), and the fit agrees
(3494.7), but for the circuit `OffsetX 160` frames nothing - the route has
to sit at x = -4935 for it to land on the drawn loop. So `tools/
minimap_calibrate.py` measures instead: it draws each race's route (`Paths<id>.bin`,
0x34148) over its map and scores the brightness under it, since a race map
paints its own route white. Only the tracks the script recalibrates are
refitted; tracks that share one edit share one fit, and only the params the
script touches move. The result is `maps/calibration.json`, which the page
applies to the redrawn map only - the game's own TRACKMAP keeps the game's
TrackInfo.

| Group | Fit | Route brightness |
|---|---|---|
| 4701-4709 | ulx -4934.7, uly -1411.7, width 4991.0 | 41 -> 193 |
| 4711-4716 | uly 3494.7 (ulx, width unchanged) | 55 -> 251 |

Everything else scores 120-255 with the game's calibration. The lower ones
(4041, 4141, 4174...) are not misframed: the route file joins its segments
with straight lines the map does not paint, and some maps highlight only part
of the route. Drag (42xx, 44xx) scores 40-80 for the reason already noted -
its coordinates are not the city's.

### What the career shows right now

The pause map does not draw every event: `0x4E0440` walks the map event
table and keeps only what `0x533110` approves. The minimap asks the same
question, every two seconds in the city's free roam.

| | |
|---|---|
| `[0x850078]` | 1 while the table is valid; `0x500EE0` (the iterator) returns nothing otherwise |
| `0x85AD40` | 64 entries of 0x18 bytes. +0 zero = empty; +4 a race (the 136-byte career record, trigger hash at +0x28); +8 a shop (160 bytes, zone hash at +0x3C); +0xC and +0x10 two other kinds (0x501150 on 0x85EF50, 0x5135A0 on 0x861E88) |
| `0x533110` | `thiscall(entry) -> al`. Races go to `0x532C20` (race+0x7F, +0x0D, 0x5007E0 on table+0x7148). Shops: byte +0x9D (the stage it opens in) must not exceed `[0x862838]`, and a real shop (+0x51) must be found as **discovered** - `0x5003B0(name hash at +0x38)` on the same table, record +4 == 1 - then `0x512870` (+0x9C) |

Two traps: `0x533110` returns in AL and leaves the rest of EAX as it was, so
`speed.call` is asked for `int` and masked with `& 0xFF` (the `bool` return
tests the whole register). And `shops.json` now carries each shop's zone hash,
which is what the table's shop record names.

Before a career is loaded the table is not valid and the minimap shows every
start and shop, as before.

### Hiding the stock minimap, and nothing else

The stock minimap is not a widget of its own: it is loose FEng objects in the
HUD package (`HUD_SingleRace.fng`, 111 of its 258 objects; `HUD_Short_Track.fng`
has 19), which the minimap's constructor `0x4F73E0` finds by name with
`FEHashUpper` (`0x505450`) + `FEngFindObject` (`0x5379C0`). The HUD builds it
at `0x4F8BF0` and keeps it at `HUD+0x5C`, the HUD itself at `player+0x9A4`.

Named by hashing and matching against the package:

| Name | What |
|---|---|
| `Track2000_map` (90FE80F3) | the map image (resource Track4000_map.tga) |
| `TrackMapTargetRing` (382D2FC9) | a group: the four quarters of the border |
| `Minimap_Mask`, `Minimap_North_indicator`, `StartLineIndicator`, `PlayerCarIndicator_1/2`, `GPS_Search_Group` | the rest of the frame |
| `<prefix><n>` from the table at `0x7F4348` | the event and shop icons, up to ~10 each |
| D80C97E1, 7AF1CA61..63, 697D2BCA | unnamed: a backing, three start-line icons, the GPS selector group |

The minimap mod hides exactly those: `0x52CEF0(name)` says whether a HUD
package is loaded; when its address changes the objects are resolved again,
and every frame any of them that is visible goes through `FEngSetInvisible`
(`0x50CA00`: sets bit 0 of `+0x1C`, and for a group also its children).
Pointers are dropped when the package goes, so nothing freed is touched.
Whether the game's own per-frame update shows an icon again before the frame
is drawn is the thing to watch: if it does, the icons flicker.

### The GPS route

The GPS (`0x81CBC0`) is an incremental A*. `0x413120(car, &target)` files the
request through `0x40C440` (start at +0x10, target at +0x30, state +0 = 1);
`0x4268A0` is its update:

| State | |
|---|---|
| 1 | `0x422B90` sets the search up |
| 2 | `0x422F90` steps it: open list at +0x44 (count +0x16C4), closed at +0x2C4 (count +0x16C8); a search node holds the road node at +4, g at +8, h at +0xC |
| 3 | done: if +0x17A0, the route built at +0x16E0 is handed to the requester (+0x17A4, the car) by `[[car+0x2C]]+0x4C(code, &route)`, then the GPS resets |

That method is `0x41EA30`: the code goes to `ctrl+0x3E4` and the route - a
0xC0-byte struct, copied by `0x40A2D0` - to `ctrl+0x3F0`. In the route, +0x38
holds up to 64 u16 and +0xB9 how many; `0x418970` reads them as
`value & 0x1FFF` = the index of a node in `0x34122` (the `sub [0x883DB0]` /
`sar 5` of a node pointer), and `0x2000` as a direction bit.

A 0x34122 node (32 bytes, after a 4-byte lead) is the passage from one street
into another: street id +0x08 left at its point +0x04, street id +0x0A entered
at its point +0x06 - the street id being +0x0A of a 0x34121 record, 101..1219
in L4RA, one per street. Checked on all 3289 nodes: the two points are always
within 40 units (median 2.2). So a route draws itself: along each street, from
the point it was entered to the point the next node leaves it; before the
first node, from the car's nearest point on the street it is on; after the
last, to the point nearest the GPS target.

`graph.json` serves the nodes as `[street, point, street, point]`, and
`roads.json` now carries each street's `id`. The minimap reads
`[[player car]+0x2C]+0x428/+0x4A9` four times a second and redraws the line
when the node list changes.

Hiding every frame was not enough for one thing: with a GPS route set, the
target's pulsing selector (`Minimap_GPS_Selector`, inside groups 697D2BCA and
E2848973) is made visible again after the main-loop hook and before the frame
is drawn, so it kept showing. Two changes fixed the rest of the stock minimap
for good:

- Groups are walked: an FEng group is type 5 at `+0x18`, with its child count
  at `+0x60`, the first child at `+0x64` and each child's next at `+4` (the loop
  in `0x50CA25`). Hiding a group hides its children only at that moment, so
  the children go in the list themselves.
- `FEngSetVisible` (`0x50CA50`) gets a detour to a stub in memory from
  `speed.mem.alloc`: it looks the object up in a table of the stock minimap's
  objects (`[count][object...]`, rewritten by the mod whenever a HUD package
  comes or goes) and returns without touching it; anything else runs the
  original from the `je` at `0x50CA56`. It is only installed if the function
  still starts `8B 44 24 04 85 C0 74 49`, i.e. nobody else hooked it.

### The pause map's filters

The legend of the pause map turns each kind on and off, and the stock minimap
obeys it. It is one byte per category, 1 = shown; the order comes out of three
of the game's own tables, not out of the kind numbers:

| | |
|---|---|
| `0x5002E0` | race kind: `+0x0D == 1` -> 7 (SUV); `+0x34 == 2` -> 5 (URL; `+0x34 == 1` is a special race, drawn as an X); else by race type `+0x0F`: 0 circuit -> 0, 1 sprint -> 4, 2 Street X -> 2, 4 drag -> 1, 5 drift -> 3 |
| `0x500340` | shop kind by `+0x50`: 1 paint -> 9, 2 body -> 10, 5 specialty -> 11, 3 performance -> 12, 4 car lot -> 13, 0 garage -> 14 |
| `0x4965F0` | kind -> category: 0-5 as is, 7 -> 6, 9 -> 7, 10 -> 8, 11 -> 11, 12 -> 9, 13 -> 10, 14 -> 12 |
| `0x4964D0` | category -> byte (the getter; `0x496390` the setter) |

End to end, by the minimap's kind names: CIRCUIT `0x8635A9`, DRAG `AA`, STREET
`AB`, DRIFT `AC`, SPRINT `AD`, URL `AE`, SUV `B0` (checked in the game: kind 5
is URL and kind 7 is SUV, the opposite of the first reading), PAINT
`B2`, BODY `B3`, SPECIALTY `B4`, PERFORMANCE `B5`, CAR LOT `B6`, GARAGE `B7`.

The minimap does not use that table itself any more. Mapping kinds by hand
got URL and SUV wrong (race `+0x0D == 1` is SUV, kind 7; `+0x34 == 2` is URL,
kind 5), and a
trigger with races of several kinds showed as one pin of the most common
kind. It now asks the game, entry by entry of the map event table: `0x533110`
(shown), `0x500DE0` (thiscall, the entry's kind), `0x4965F0` (kind ->
category), `0x4964D0` (category -> 1 if the legend hides it). Each race left
is identified by its trigger (+0x28) and track (+0x18 low word) - the track
picks, among the trigger's races, the one that is available, and so its kind -
and special races get their own icon. A special race - the X on the map, of
any kind - is race `+0x34 == 1`: that is the test `0x4B06D0` makes before
giving the indicator the `MINIMAP_ICON_CROSS` texture (B90F50BB).

**The route's indices are into the table in memory, not the file.** The
nodes the game has at `[0x883DB0]` (count `[0x883DB4]`) are not the file's:
3273 in L4RA against the file's 3289, numbered differently - memory node 959
is file node 957. Reading the file's table with the route's indices gave the
nodes that seemed "off the path" and the route that kept needing repairs.
Read from memory, the same route (8 nodes) runs in order from the car to the
target - the distance to the car grows 143 -> 524, to the target it falls
488 -> 30 - with nothing off the path. The fields inside a node are the same
(streets +8/+0xA, points +4/+6, and street ids match `roads.json`), so the
minimap reads each route node's four fields from memory and sends them to the
page; `graph.json` is still what fills the short gaps between them. The route
holds decision points, not every passage: consecutive nodes rarely share a
street, and the gaps are 30-130 units.

### Turning with the camera

The radar turns with the camera, GTA-style, not with the car. The view matrix
is at `0x8734A0` (the one `mods/pops` found with its `/camera` command). The
camera's forward in the ground plane is its **third column, m[2] and m[6],
positive**: measured in the game by scoring the four candidates (third column
or third row, each with both signs) against the car's heading while driving
over 30 km/h with the camera behind - 0.94 for this one. The measurement was
done once and the result is now fixed in the code, so the radar turns with the
camera from the first frame at any speed. The player's arrow turns by the car's
heading minus the camera's; `/minimap giro carro` goes back to turning with
the car.

### The HUD's GPS arrow

The blue arrow that floats ahead of the car with a GPS route is not FEng: it is
a marker drawn in the world with the texture `MARKER_GPS_AID`, which
`0x5F3E10` loads into `player+0x110` (and `MARKER_DIRECTION_AID` into
`+0x10C`). `0x5F3CB0` (thiscall, one argument, `ret 4`) draws it: it checks
the controller's route state (`ctrl+0x3E4` 1 or 2), finds a point ahead on the
route and draws through `0x5EAC90`. Its only caller, `0x63176A`, ignores the
result, so hiding the arrow is making the function return at once
(`C2 04 00` over `55 8B EC`) and showing it again is putting the bytes back.
The minimap does that on `/minimap seta esconder|mostrar`, and only if the
function starts with one of those two sequences.
