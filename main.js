// FRSMiniMap - a 3D perspective minimap for NFS Underground 2 (FRSModLoader).
//
// This side runs in the game (QuickJS, every frame) and reads memory; the page
// (ui/index.html) only draws. What goes to it:
//
//   'track'   the loaded track's TrackInfo: id, region, map calibration
//   'pose'    every frame: the player's position and heading, the camera's
//             heading, speed (dynamic zoom) and the rivals
//   'career'  what the pause map shows now (races and shops), with the
//             legend's filters and the special events, asked of the game
//   'route'   the GPS route: the nodes read from the table the game holds in memory
//   'style'   the marker style
//
// And it changes the game in three places, always checking the bytes first:
//
//   - hides the original minimap (its FEng objects, and a detour in
//     FEngSetVisible so the animation does not show them again);
//   - optionally, hides the blue GPS arrow on the HUD.
//
// The player's pose (the same one spawn-car uses):
//
//   physics + 0x20  -> pose
//   pose    + 0x20  position x, y, z (z up; x, y is the map plane)
//   pose    + 0x30  rotation matrix; the ROWS are the axes, row 0 forward
//
// The options live in Options > Mods (mod.json's "settings"): icons, turn,
// dynamic zoom and the GPS arrow. /minimap in the console prints the state
// (pose, track, career, GPS). Addresses and formats are in NOTES.md.

const PHYSICS_POSE  = 0x20;
const POSE_POSITION = 0x20;
const POSE_ROTATION = 0x30;

// The loaded track: [0x883DAC] is the TrackInfo 0x57F240 picks when it builds
// the world or the race (GetTrackInfo over TheRaceParameters). 296-byte
// records in chunk 0x34201 of GLOBALB (NOTES.md, "The minimap"):
//
//   +0x40  char[]  region ("L4RA")
//   +0x8A  u16     track id: 4000 is the city's free roam
//   +0xAC  f32     TRACKMAP calibration: x of the top left corner
//   +0xB0  f32     y of the top left corner
//   +0xB4  f32     map width, in world units
//   +0xC0  f32     radar zoom: 1.5 city, 2 drag, 1 drift and Street X
const TRACK_INFO_PTR = 0x883DAC;

let track = null;          // the last one sent, to send only when it changes

// The rivals. Every car in the world is in a linked list (NOTES.md,
// "Spawning a car"): [0x890080] is the sentinel, +0 the first, and each car
// points to the next at its +0. The player's car is the same object
// speed.game.car() returns. car+0x14 points to the slot, and slot+0x04 says who
// it is: 1 player, 2 racer, 3 traffic.
const WORLD_CAR_LIST = 0x890080;
const CAR_SLOT       = 0x14;
const SLOT_TYPE      = 0x04;
const SLOT_RACER     = 2;
const MAX_CARS       = 32;
// A racer left in the world's list is not always in the world: one stayed put
// on the map with no car there. A live one is in an active part of the world
// (car+0x5C0, set by 0x5F6CD0 from its position) and has a rigid body
// ([car+0x3C]+0x68, hung by 0x5938C0); the ghost fails one of the two.
const CAR_WORLD_GATE = 0x5C0;
const CAR_SIM        = 0x3C;
const SIM_BODY       = 0x68;

// Where the car keeps its world position: NOTES says car+0x510 (what the
// constructor writes) and spawn-car uses car+0x60. Rather than bet, the mod
// compares both with the player's pose, which is known to be right, and keeps
// the one that matches. null until decided.
const CAR_POS_CANDIDATES = [0x60, 0x510];
let carPos = null;

// each rival's heading, taken from its movement: { [car]: { x, y, h } }
let trail = {};

// What the career shows now: the same question the pause map asks.
// The map's constructor (0x4E0440) walks the map's event table and draws only
// the ones 0x533110 approves (NOTES.md, "The minimap"):
//
//   0x85AD40  64 entries of 0x18 bytes, valid when [0x850078] == 1;
//             +0 zero = empty, +4 the race (136-byte career record,
//             +0x28 the trigger's hash), +8 the shop (160 bytes, +0x3C the
//             zone's hash)
//   0x533110  thiscall(entry) -> al: race available / shop of the current
//             stage and already discovered (0x5003B0(hash) -> +4 == 1)
//
// Only queries; the pause map calls the same path when it opens. The result
// is in AL, with junk in the rest of EAX: hence ret 'int' and & 0xFF.
const MAP_EVENTS       = 0x85AD40;
const MAP_EVENTS_READY = 0x850078;
const MAP_EVENT_SIZE   = 0x18;
const MAP_EVENT_COUNT  = 64;
const MAP_EVENT_SHOWN  = 0x533110;
const RACE_TRIGGER     = 0x28;
const SHOP_ZONE        = 0x3C;
const CAREER_MS        = 500;    // the filters change on the pause map; half a second is enough

let careerLast = 0;
let careerSent = '';


// The game's minimap, hidden. It is not a separate drawing: it is loose FEng
// objects in the HUD package (HUD_SingleRace.fng; HUD_Short_Track.fng on
// closed tracks), which the minimap's constructor (0x4F73E0) finds by name.
// The names are the ones it looks for, plus the event and shop indicators of
// table 0x7F4348 (<PREFIX><n>, from 0), and five objects with no known name, by
// hash, read from the package itself: the background, the three start icons
// and the GPS selector group. Nothing else is touched.
//
//   0x52CEF0  cdecl(package name) -> loaded package, or 0
//   0x5379C0  cdecl(package name, hash) -> object (FEngFindObject)
//   0x50CA00  cdecl(object) FEngSetInvisible: sets bit 0 of +0x1C, and in a
//             group (type 5, +0x18) hides the children too
//
// The pointers hold while the package lives: they are resolved again when the
// package's address changes, and forgotten when it goes away.
const FE_FIND_PACKAGE = 0x52CEF0;
const FE_FIND_OBJECT  = 0x5379C0;
const FE_SET_INVISIBLE = 0x50CA00;
const FE_OBJ_FLAGS    = 0x1C;
const HUD_PACKAGES = ['HUD_SingleRace.fng', 'HUD_Short_Track.fng', 'HUD_Drag.fng', 'HUD_Drift.fng'];
const MINIMAP_NAMES = ['Track2000_map', 'TrackMapTargetRing', 'Minimap_Mask', 'StartLineIndicator',
  'PlayerCarIndicator_1', 'PlayerCarIndicator_2', 'Minimap_North_indicator', 'GPS_Search_Group'];
const MINIMAP_HASHES = [0xD80C97E1, 0x7AF1CA61, 0x7AF1CA62, 0x7AF1CA63, 0x697D2BCA,
  0xE2848973, 0x4F649313, 0x4F649314];   // and the GPS selectors (Minimap_GPS_Selector)
const INDICATOR_PREFIXES = ['CIRCUITEVENTINDICATOR_', 'DRAGEVENTINDICATOR_', 'STREETEVENTINDICATOR_',
  'DRIFTEVENTINDICATOR_', 'SPRINTEVENTINDICATOR_', 'URLEVENTINDICATOR_', 'SUVEVENTINDICATOR_',
  'PAINTSHOPINDICATOR_', 'PARTSSHOPINDICATOR_', 'PERFORMANCESHOPINDICATOR_', 'CARLOTINDICATOR_',
  'ICESHOPINDICATOR_', 'CRIBINDICATOR_', 'SHOWCASEINDICATOR_', 'AIRACERINDICATOR_'];
// in the package they go from _0 to _5 (URL up to _8); each one's _0 is the one
// the game pins to the edge, pointing at the nearest of that kind out of range
const INDICATOR_MAX = 12;

// FEHashUpper (0x505450): h = h * 33 + upper(c), starting at 0xFFFFFFFF
function feHash(str) {
  let h = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0x61 && c <= 0x7A) c -= 0x20;
    h = (Math.imul(h, 33) + c) >>> 0;
  }
  return h;
}
const MINIMAP_OBJECTS = MINIMAP_NAMES.map(feHash).concat(MINIMAP_HASHES);
for (const p of INDICATOR_PREFIXES)
  for (let n = 0; n <= INDICATOR_MAX; n++) MINIMAP_OBJECTS.push(feHash(p + n));

let hudPackages = {};   // { name: { pkg, objs: [object...] } }

// The GPS route. The GPS (0x81CBC0) is an incremental A* (0x4268A0); when it
// finishes, it hands the route to whoever asked through [[car+0x2C]]+0x4C
// (0x41EA30), which copies it to the controller (NOTES.md, "The GPS route"):
//
//   ctrl+0x3E4  the search's result
//   ctrl+0x3F0  the route, 0xC0 bytes: +0x38 up to 64 u16, +0xB9 how many
//               (u16 & 0x1FFF = index of a node of 0x34122; 0x2000 a direction)
//   0x81CBC0+0x30  the requested destination, x y z
//
// A node is the passage from one street to another (graph.json); the page
// builds the line street by street.
const CAR_CONTROLLER = 0x2C;
const ROUTE_NODES    = 0x428;   // 0x3F0 + 0x38
const ROUTE_COUNT    = 0x4A9;   // 0x3F0 + 0xB9
const ROUTE_CODE     = 0x3E4;   // the search's outcome as the car has it; 0 = none
const ROUTE_MAX      = 64;
const GPS            = 0x81CBC0;
const GPS_TARGET     = 0x30;
const ROUTE_MS       = 250;
const NODE_TABLE     = 0x883DB0;   // pointer to the nodes (0x34122 loaded)
const NODE_COUNT     = 0x883DB4;
let routeLast = 0;
let routeSent = '';

function gpsRoute() {
  const car = speed.game.car();
  const ctrl = car ? speed.mem.readPtr(car + CAR_CONTROLLER) : 0;
  if (!ctrl) return null;
  // code 0 is no route: a cancelled one leaves its nodes behind (0x41EA30
  // writes only the code when handed none)
  if (speed.mem.readU32(ctrl + ROUTE_CODE) === 0) return null;
  const n = speed.mem.readI8(ctrl + ROUTE_COUNT);
  if (!n || n <= 0 || n > ROUTE_MAX) return null;
  // The nodes are read from the table the game holds in memory ([0x883DB0], 32
  // bytes each), not from the file: it has another count (3273 against 3289 in
  // L4RA) and another numbering, and the route's index only holds in it. Each
  // node gives the two streets and the two points: +8 street, +4 point; +0xA
  // street, +6 point.
  const base = speed.mem.readPtr(NODE_TABLE), total = speed.mem.readU32(NODE_COUNT);
  if (!base || !total) return null;
  const nodes = [], raw = [];
  for (let i = 0; i < n; i++) {
    const v = speed.mem.readU16(ctrl + ROUTE_NODES + i * 2);
    if (v === null) return null;
    raw.push(v);
    const idx = v & 0x1FFF;
    if (idx >= total) continue;
    const at = base + idx * 32;
    nodes.push({ i: idx, a: speed.mem.readU16(at + 8), pa: speed.mem.readU16(at + 4),
                 b: speed.mem.readU16(at + 0x0A), pb: speed.mem.readU16(at + 6) });
  }
  const target = vec3(GPS + GPS_TARGET);
  return { nodes, raw, target: target ? { x: target.x, y: target.y } : null };
}

function checkRoute(now) {
  if (now - routeLast < ROUTE_MS) return;
  routeLast = now;
  const r = gpsRoute();
  const key = r ? r.nodes.map((x) => x.i).join(',') + '|' + (r.target ? r.target.x.toFixed(0) + ',' + r.target.y.toFixed(0) : '') : '';
  if (key === routeSent) return;
  routeSent = key;
  speed.ui.send('route', r);
}

// Hiding a group only hides its children at that moment; the FEng animation
// shows some of them again (the blue circle pulsing on the GPS target is one).
// So the children go on the list and are checked one by one, every frame.
// Group: type 5 at +0x18, children counted at +0x60, the first at +0x64, and
// each child points to the next at +4 (the loop at 0x50CA25).
const FE_OBJ_TYPE = 0x18, FE_GROUP = 5, FE_CHILD_COUNT = 0x60, FE_FIRST_CHILD = 0x64, FE_NEXT = 0x04;
function addWithChildren(objs, o, depth) {
  if (objs.indexOf(o) < 0) objs.push(o);
  if (depth > 4 || speed.mem.readU32(o + FE_OBJ_TYPE) !== FE_GROUP) return;
  let n = speed.mem.readI32(o + FE_CHILD_COUNT) || 0;
  let c = speed.mem.readPtr(o + FE_FIRST_CHILD);
  for (; c && n > 0 && n < 256; n--, c = speed.mem.readPtr(c + FE_NEXT)) addWithChildren(objs, c, depth + 1);
}

// The GPS target's animation (the pulsing blue circle) makes the selector
// visible again every frame, after this hook and before drawing, and hiding it
// back does not win that race. So FEngSetVisible (0x50CA50) gets a detour
// that ignores the original minimap's objects: a table [count, object...]
// this mod keeps. Hiding (0x50CA00) goes on as usual.
//
//   0x50CA50  8B 44 24 04  mov eax,[esp+4]     <- becomes jmp stub
//   0x50CA54  85 C0        test eax,eax
//   0x50CA56  74 49        je ...              <- the stub returns here
//
// Installs only if the bytes are these (nobody else touched the function).
const FE_SET_VISIBLE = 0x50CA50;
const FE_SET_VISIBLE_BYTES = [0x8B, 0x44, 0x24, 0x04, 0x85, 0xC0, 0x74, 0x49];
const BLOCK_MAX = 1024;
let blockTable = 0;       // [u32 count][u32 object x BLOCK_MAX]
let blockTried = false;

function le32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

function installBlock() {
  blockTried = true;
  const b = speed.mem.readBytes(FE_SET_VISIBLE, 8);
  const got = b ? Array.from(new Uint8Array(b)) : [];
  if (got.join() !== FE_SET_VISIBLE_BYTES.join()) {
    console.log('minimap: another mod changed FEngSetVisible; the original GPS circle may still show');
    return;
  }
  const table = speed.mem.alloc(4 + 4 * BLOCK_MAX);
  const stub = speed.mem.alloc(64);
  if (!table || !stub) return;
  speed.mem.writeU32(table, 0);
  const back = FE_SET_VISIBLE + 6;                       // the je
  const code = [].concat(
    [0x8B, 0x44, 0x24, 0x04],                            //  0 mov eax,[esp+4]
    [0x51],                                              //  4 push ecx
    [0x8B, 0x0D], le32(table),                           //  5 mov ecx,[table]
    [0x85, 0xC9],                                        // 11 test ecx,ecx
    [0x74, 0x0C],                                        // 13 jz done (27)
    [0x3B, 0x04, 0x8D], le32(table),                     // 15 cmp eax,[table+ecx*4]
    [0x74, 0x0B],                                        // 22 je blocked (35)
    [0x49],                                              // 24 dec ecx
    [0x75, 0xF4],                                        // 25 jnz 15
    [0x59],                                              // 27 done: pop ecx
    [0x85, 0xC0],                                        // 28 test eax,eax
    [0xE9], le32((back - (stub + 35)) >>> 0),            // 30 jmp 0x50CA56
    [0x59],                                              // 35 blocked: pop ecx
    [0xC3]);                                             // 36 ret
  if (!speed.mem.patch(stub, code)) return;
  const jmp = [0xE9].concat(le32((stub - (FE_SET_VISIBLE + 5)) >>> 0), [0x90]);
  if (!speed.mem.patch(FE_SET_VISIBLE, jmp)) return;
  blockTable = table;
}

function updateBlock() {
  if (!blockTable) return;
  const all = [];
  for (const name of Object.keys(hudPackages)) for (const o of hudPackages[name].objs) all.push(o);
  const n = Math.min(all.length, BLOCK_MAX);
  speed.mem.writeU32(blockTable, 0);                     // empty while rewriting
  for (let i = 0; i < n; i++) speed.mem.writeU32(blockTable + 4 + 4 * i, all[i]);
  speed.mem.writeU32(blockTable, n);
}

function hideOriginalMinimap() {
  if (!blockTried) installBlock();
  for (const name of HUD_PACKAGES) {
    const pkg = speed.call(FE_FIND_PACKAGE, [name], { ret: 'int' }) >>> 0;
    let h = hudPackages[name];
    if (!pkg) { if (h) { delete hudPackages[name]; updateBlock(); } continue; }
    if (!h || h.pkg !== pkg) {
      const objs = [];
      for (const hash of MINIMAP_OBJECTS) {
        const o = speed.call(FE_FIND_OBJECT, [name, hash], { ret: 'int' }) >>> 0;
        if (o) addWithChildren(objs, o, 0);
      }
      h = hudPackages[name] = { pkg, objs };
      updateBlock();
    }
    for (const o of h.objs) {
      const f = speed.mem.readU32(o + FE_OBJ_FLAGS);
      if (f !== null && !(f & 1)) speed.call(FE_SET_INVISIBLE, [o], { ret: 'void' });
    }
  }
}

const RATE_MS = 1000 / 60;   // the page interpolates; 60 Hz keeps the turning smooth

let last = 0;
let visible = false;
let pageReady = false;

function vec3(addr) {
  const x = speed.mem.readF32(addr);
  const y = speed.mem.readF32(addr + 4);
  const z = speed.mem.readF32(addr + 8);
  return (x === null || y === null || z === null) ? null : { x, y, z };
}

// The player's position and heading, or null outside gameplay. The heading is
// the angle of the car's front in the plane, in radians, 0 = +x (east), pi/2 =
// +y (north).
function pose() {
  if (speed.game.state() !== 6) return null;
  const phys = speed.game.physics();
  if (!phys) return null;
  const p = speed.mem.readPtr(phys + PHYSICS_POSE);
  if (!p) return null;
  const pos = vec3(p + POSE_POSITION);
  const fwd = vec3(p + POSE_ROTATION);
  if (!pos || !fwd) return null;
  if (!isFinite(pos.x) || !isFinite(pos.y) || (fwd.x === 0 && fwd.y === 0)) return null;
  return { x: pos.x, y: pos.y, z: pos.z, h: Math.atan2(fwd.y, fwd.x) };
}

function trackInfo() {
  const info = speed.mem.readPtr(TRACK_INFO_PTR);
  if (!info) return null;
  const id = speed.mem.readU16(info + 0x8A);
  const ulx = speed.mem.readF32(info + 0xAC);
  const uly = speed.mem.readF32(info + 0xB0);
  const width = speed.mem.readF32(info + 0xB4);
  const zoom = speed.mem.readF32(info + 0xC0);
  if (!id || ulx === null || uly === null || !(width > 0)) return null;
  return { id, region: speed.mem.readString(info + 0x40, 8) || '', ulx, uly, width, zoom: zoom || 1 };
}

// TRACKMAP pixel (512) for a world point, by the track's calibration
// The camera's heading, so the radar turns with it (as in GTA) and not with the
// car. The game's view matrix is at 0x8734A0 (4x4 floats; the same one pops
// uses, found by its /camera). The camera's front in the plane is the third
// column, m[2] and m[6], with a positive sign: measured in the game comparing
// the four candidates (column or row, each with both signs) with the car's
// heading while driving with the camera behind - 0.94 match on the column, the
// others far from it.
const VIEW_MATRIX = 0x8734A0;

function camYaw() {
  const x = speed.mem.readF32(VIEW_MATRIX + 4 * 2);
  const y = speed.mem.readF32(VIEW_MATRIX + 4 * 6);
  if (x === null || y === null || !isFinite(x) || !isFinite(y) || Math.hypot(x, y) < 1e-3) return null;
  return Math.atan2(y, x);
}

// The blue GPS arrow on the HUD (the marker floating ahead of the car, texture
// MARKER_GPS_AID). It is drawn by 0x5F3CB0 (thiscall, 1 argument, ret 4; the
// only caller, 0x63176A, does not use the return): it checks the controller's
// route, finds a point ahead and draws with 0x5EAC90. Hiding is making the
// function return at its first instruction; showing, putting its bytes back.
// Only touched if the start is the expected one (nobody else changed it).
const GPS_ARROW_DRAW = 0x5F3CB0;
const GPS_ARROW_ORIG = [0x55, 0x8B, 0xEC];          // push ebp; mov ebp,esp
const GPS_ARROW_OFF  = [0xC2, 0x04, 0x00];          // ret 4
// The options used to be console commands, kept in the mod's store; the first
// time the menu options exist, whatever the player had chosen moves over.
if (!speed.store.get('settingsMigrated', false)) {
  const old = { icons: speed.store.get('icons', null), turn: speed.store.get('turn', null),
                zoom: speed.store.get('zoom', null), gpsArrow: speed.store.get('gpsArrow', null) };
  if (old.icons === 'nativo' || old.icons === 'pin') speed.settings.set('icons', old.icons === 'nativo' ? 'native' : 'pin');
  if (old.turn === 'camera' || old.turn === 'carro') speed.settings.set('turn', old.turn === 'carro' ? 'car' : 'camera');
  if (old.zoom === 'fixo' || old.zoom === 'dinamico') speed.settings.set('dynamicZoom', old.zoom === 'dinamico');
  if (old.gpsArrow === 'mostrar' || old.gpsArrow === 'esconder') speed.settings.set('gpsArrow', old.gpsArrow === 'mostrar');
  speed.store.set('settingsMigrated', true);
}

// Development builds stored Portuguese option values; the menu only knows the English ones
{
  const legacy = { shape: { redondo: 'round', retangular: 'rectangular' }, edge: { infinita: 'fade', solida: 'solid' },
                   icons: { nativo: 'native' }, turn: { carro: 'car' } };
  for (const id of Object.keys(legacy)) {
    const v = speed.settings.get(id, null);
    if (legacy[id][v]) speed.settings.set(id, legacy[id][v]);
  }
}

function gpsArrowMode() { return speed.settings.get('gpsArrow', false) === true ? 'show' : 'hide'; }
function applyGpsArrow() {
  const b = speed.mem.readBytes(GPS_ARROW_DRAW, 3);
  const now = b ? Array.from(new Uint8Array(b)).join() : '';
  const want = gpsArrowMode() === 'hide' ? GPS_ARROW_OFF : GPS_ARROW_ORIG;
  if (now === want.join()) return true;
  if (now !== GPS_ARROW_ORIG.join() && now !== GPS_ARROW_OFF.join()) {
    console.log('minimap: another mod changed the GPS arrow code; the GPS arrow option will not work');
    return false;
  }
  return speed.mem.patch(GPS_ARROW_DRAW, want);
}
applyGpsArrow();

// 'dynamic' (the default) or 'fixed': whether the zoom opens up with speed
function zoomMode() { return speed.settings.get('dynamicZoom', true) === false ? 'fixed' : 'dynamic'; }

// 'camera' (the default) or 'car': what the radar turns with
function turnMode() { const v = speed.settings.get('turn', 'camera'); return v === 'car' || v === 'carro' ? 'car' : 'camera'; }

function toMapPixel(t, x, y) {
  return { px: (x - t.ulx) / t.width * 512, py: (t.uly - y) / t.width * 512 };
}

// Decides the position offset from the player's car: the field within 2 units
// of the physics pose, in x and y.
function decideCarPos(p) {
  const me = speed.game.car();
  if (!me) return;
  for (const off of CAR_POS_CANDIDATES) {
    const v = vec3(me + off);
    if (v && Math.abs(v.x - p.x) < 2 && Math.abs(v.y - p.y) < 2) {
      carPos = off;
      return;
    }
  }
}

// The racers in the world, minus the player: [{ x, y, h }], h in radians like
// the player's (0 = +x). The heading comes from the displacement since the last
// frame, and the previous one stays while the car is standing still.
function rivals() {
  if (carPos === null) return [];
  const list = speed.mem.readPtr(WORLD_CAR_LIST);
  if (!list) return [];
  const me = speed.game.car();
  const out = [], seen = {};
  let car = speed.mem.readPtr(list);
  for (let i = 0; car && car !== list && i < MAX_CARS; i++, car = speed.mem.readPtr(car)) {
    if (car === me) continue;
    const slot = speed.mem.readPtr(car + CAR_SLOT);
    if (!slot || speed.mem.readI32(slot + SLOT_TYPE) !== SLOT_RACER) continue;
    const gate = speed.mem.readU8(car + CAR_WORLD_GATE);
    const sim = speed.mem.readPtr(car + CAR_SIM);
    const body = sim ? speed.mem.readPtr(sim + SIM_BODY) : 0;
    if (!gate || !body) continue;
    const v = vec3(car + carPos);
    if (!v || !isFinite(v.x) || !isFinite(v.y)) continue;
    const r = trail[car];
    let h = r ? r.h : 0;
    if (r) {
      const dx = v.x - r.x, dy = v.y - r.y;
      if (dx * dx + dy * dy > 0.25) h = Math.atan2(dy, dx);
      else { out.push({ x: v.x, y: v.y, h }); seen[car] = r; continue; }
    }
    seen[car] = { x: v.x, y: v.y, h };
    out.push({ x: v.x, y: v.y, h });
  }
  trail = seen;
  return out;
}

const hex = (v) => '0x' + ('00000000' + (v >>> 0).toString(16).toUpperCase()).slice(-8);

// What the pause map shows now, entry by entry, by the game's own rules:
// 0x533110 decides whether the entry shows; 0x500DE0 gives its kind, 0x4965F0
// the category and 0x4964D0 whether the legend's filter hides the category
// (1 = hidden). So the career, the filters and the special events come from the
// game, with no table of ours.
//   race:  +0x34 1 = special (the X on the map: 0x4B06D0 swaps the icon for
//          the MINIMAP_ICON_CROSS texture when it is 1; 2 is URL), +0x18 low16
//          the track, +0x28 the trigger's hash
//   shop:  +0x3C the zone's hash
// { races: [{ trigger, track, special }], zones: [hash] }, or null when the
// table is not built (outside the career, loading).
const EVENT_KIND    = 0x500DE0;   // thiscall(entry) -> kind
const KIND_CATEGORY = 0x4965F0;   // cdecl(kind) -> category
const CATEGORY_OFF  = 0x4964D0;   // cdecl(category) -> 1 if the filter hides it
const RACE_SPECIAL  = 0x34;   // == 1 (0x0D, which seemed to be it, marks the SUV)
const RACE_TRACK    = 0x18;
function careerVisible() {
  if (speed.mem.readU32(MAP_EVENTS_READY) !== 1) return null;
  const races = [], zones = {};
  for (let i = 0; i < MAP_EVENT_COUNT; i++) {
    const e = MAP_EVENTS + i * MAP_EVENT_SIZE;
    if (!speed.mem.readU32(e)) continue;
    const shown = (speed.call(MAP_EVENT_SHOWN, [e], { conv: 'thiscall', ret: 'int' }) & 0xFF) !== 0;
    if (!shown) continue;
    const kind = speed.call(EVENT_KIND, [e], { conv: 'thiscall', ret: 'int' });
    const cat = speed.call(KIND_CATEGORY, [kind], { ret: 'int' });
    if ((speed.call(CATEGORY_OFF, [cat], { ret: 'int' }) & 0xFF) !== 0) continue;
    const race = speed.mem.readPtr(e + 4);
    const shop = speed.mem.readPtr(e + 8);
    if (race) races.push({
      trigger: hex(speed.mem.readU32(race + RACE_TRIGGER)),
      track: speed.mem.readU16(race + RACE_TRACK),
      special: speed.mem.readU8(race + RACE_SPECIAL) === 1
    });
    else if (shop) zones[hex(speed.mem.readU32(shop + SHOP_ZONE))] = true;
  }
  races.sort((x, y) => (x.trigger + x.track < y.trigger + y.track ? -1 : 1));
  // the state of each legend category, for the expanded map's legend
  const off = [];
  for (let c = 0; c <= 13; c++) off.push((speed.call(CATEGORY_OFF, [c], { ret: 'int' }) & 0xFF) !== 0);
  return { races, zones: Object.keys(zones).sort(), off };
}

function checkCareer(now) {
  if (now - careerLast < CAREER_MS) return;
  careerLast = now;
  const c = careerVisible();
  const key = c ? JSON.stringify(c) : 'null';
  if (key === careerSent) return;
  careerSent = key;
  speed.ui.send('career', c);
}

// The marker style: 'pin' (the pins with an icon) or 'native' (circles, like
// the game's minimap: filled for shops, a thick ring for events).
// The minimap's shape: 'round' (the default) or 'rectangular' (as GTA V's).
// (The Portuguese values of development builds are still read, and rewritten at start.)
function shapeMode() { const v = speed.settings.get('shape', 'round'); return v === 'rectangular' || v === 'retangular' ? 'rectangular' : 'round'; }
// Its edge: 'fade' (the default, the map fades out) or 'solid'.
// The minimap's size, in percent of its size at 1080 lines (the page scales
// that to the screen first).
function sizePercent() { const v = +speed.settings.get('size', 100); return v >= 50 && v <= 200 ? v : 100; }

function edgeMode() { const v = speed.settings.get('edge', 'fade'); return v === 'solid' || v === 'solida' ? 'solid' : 'fade'; }

function iconStyle() {
  const v = speed.settings.get('icons', 'pin');
  return v === 'native' || v === 'nativo' ? 'native' : 'pin';
}

// ---- the expanded map ----
// M (and the pause menu's "Map") opens the game's map, UI_InGame_WorldMap.fng,
// and that is what pauses the game and runs the screen. The mod lets that
// happen and opens its own on top, full screen, with keyboard and mouse on the
// page; when its own closes, it closes the game's too, and the game goes on.
//   0x52CF60  cdecl(package) -> al: the package is open
//   PAD_BACK  the controller's "back" message (FEHashUpper 911AB364), the
//             one Esc generates: the map screen handles it (0x4EF642...) and
//             leaves on its own, resuming the game. Force-closing the package
//             (0x5379A0) was the first attempt: it removed the package and left
//             the screen half done, the map's buttons on screen and the game
//             stuck.
//   0x496390  cdecl(category, off): the legend's filter (the setter of
//             0x4964D0), so the expanded map's legend drives the game's
const WORLD_MAP_PKG = 'UI_InGame_WorldMap.fng';
const FE_PACKAGE_OPEN = 0x52CF60;
const PAD_BACK = 0x911AB364;
const CATEGORY_SET = 0x496390;
const CLOSE_WAIT_MS = 1500;   // how long to wait for the game's map to leave before reopening ours
const BIG_MS = 100;
let bigOpen = false, bigLast = 0, closingSince = 0;

function gameMapOpen() {
  return (speed.call(FE_PACKAGE_OPEN, [WORLD_MAP_PKG], { ret: 'int' }) & 0xFF) !== 0;
}

function openMap() {
  bigOpen = true;
  speed.ui.capture(true);
  speed.ui.send('bigmap', true);
}

function closeMap(closeGameMap) {
  if (!bigOpen) return;
  bigOpen = false;
  speed.ui.capture(false);
  speed.ui.send('bigmap', false);
  if (closeGameMap && gameMapOpen()) {
    speed.game.sendFrontendMessage(PAD_BACK, WORLD_MAP_PKG);
    closingSince = speed.now();
  }
}

// The pause menu and its option pages: the minimap stays out of them.
const PAUSE_PKGS = ['UI_Pause.fng', 'UI_PauseOptions.fng', 'UI_PauseOptionsMain.fng'];
let pausedSent = null;
function checkPause() {
  const paused = speed.game.state() === 6 &&
    PAUSE_PKGS.some((p) => (speed.call(FE_PACKAGE_OPEN, [p], { ret: 'int' }) & 0xFF) !== 0);
  if (paused === pausedSent) return;
  pausedSent = paused;
  speed.ui.send('paused', paused);
}

function checkBigMap(now) {
  if (now - bigLast < BIG_MS) return;
  bigLast = now;
  checkPause();
  const gameOpen = speed.game.state() === 6 && gameMapOpen();
  // once closing is requested, wait for the game's map to leave; if it does not,
  // reopen ours (better than leaving the player on a screen with no control)
  if (closingSince) {
    if (!gameOpen) closingSince = 0;
    else if (now - closingSince < CLOSE_WAIT_MS) return;
    else closingSince = 0;
  }
  if (gameOpen && !bigOpen) openMap();
  else if (!gameOpen && bigOpen) closeMap(false);   // the game's closed on its own
}

speed.on('ui:bigmap-close', () => closeMap(true));

// A click on a pin of the expanded map sets the GPS there, as picking the item
// on the game's map does. The map screen (0x4E0964, 0x532DFD) does it so:
//   0x529480  thiscall(0x838590, &entry): the destination manager; clears the
//             old GPS and requests a route to the entry's position (integers
//             at [entry]+0x34/+0x38, through 0x413120)
//   0x529410  thiscall(0x838590, &entry) -> al: the entry is the destination
// The entry is found by the pin's position: the nearest one among those the
// game's map shows right now.
//   0x4268A0  thiscall(0x81CBC0): one step of the search (A*). Only the world
//             update calls it (0x609D27), and that stops while paused; with
//             the map open the mod steps it, so the route shows at once.
//             Once a frame, as the world update would: each step is a time
//             slice (it reads the clock, 0x43BDF0, and runs until its budget
//             is spent), so 40 a frame took the game down to 4 fps.
const GPS_MANAGER   = 0x838590;
// thiscall(0x838590): no destination - resets the search (0x4131F0, which also
// tells the car its route is gone) and clears the manager, as the game does
// when a route is cancelled. 0x529480 resets only while a destination is
// active (0x501100 says so, from +0x29 and the last result at GPS+4); after a
// failed search it does not, and a request the game filed meanwhile keeps the
// search busy, so the new one was dropped (0x40C440 files only when idle).
// Clearing first makes every new destination take.
const GPS_CLEAR     = 0x5010E0;
const GPS_SET       = 0x529480;
const GPS_IS_TARGET = 0x529410;
const GPS_UPDATE    = 0x4268A0;
const ENTRY_POS     = 0x34;
const GPS_PICK_NEAR = 60;       // world units between the pin and the entry
const GPS_STEPS     = 1;        // search slices per frame, with the map open

// Off the streets the GPS has nowhere to start: 0x40C440 files the request
// with the car's own position as the start (GPS+0x10, x y z), the setup
// (0x422B90, state 1, sliced over the road sections with the index at +0x40)
// finds no road near it, and the search ends with no route - "GPS
// unavailable". The page sends the street point nearest the car ('snap');
// while the setup has not begun (state 1, +0x40 still 0) the start is moved
// there, so the route begins on the nearest street. This covers the mod's
// clicks and the game's own requests (its map, a recalculation).
const GPS_START   = 0x10;
const GPS_SECTION = 0x40;
const SNAP_MIN    = 8;      // world units off the street before the start is moved
let snap = null;

// A street point's height. The GPS takes a start and a target only within 4
// units of the street's height (0x422D82: the point's int16 at +0x12, times
// 2^13 * 2^-16, against the z) - so a marker at the car's height was found
// only when the ground happened to be as high there. The file has no heights
// (+0x12 is 0 in RoutesFreeRoam.bin); the game fills them in when it loads
// the streets: [0x88D21C + 4 i] for i < [0x88D218], each with its id at
// +0x0A (roads.json's), point count at +0x34 and 0x38-byte points from +0x8C
// (x, y at +0, +4).
const STREET_TABLE = 0x88D21C, STREET_COUNT = 0x88D218;
const STREET_ID = 0x0A, STREET_NPOINTS = 0x34, STREET_POINTS = 0x8C, POINT_SIZE = 0x38, POINT_Z = 0x12;
const Z_STEP = 0.125;
let streetPtr = null;   // id -> street, rebuilt when a load moves them

function streetHeight(street, idx, x, y) {
  if (typeof street !== 'number' || typeof idx !== 'number') return null;
  for (let pass = 0; pass < 2; pass++) {
    if (!streetPtr || pass) {
      streetPtr = {};
      const n = speed.mem.readU32(STREET_COUNT);
      for (let i = 0; n && i < n && i < 8192; i++) {
        const st = speed.mem.readPtr(STREET_TABLE + i * 4);
        if (st) streetPtr[speed.mem.readU16(st + STREET_ID)] = st;
      }
    }
    const st = streetPtr[street];
    if (!st || idx >= speed.mem.readU16(st + STREET_NPOINTS)) continue;
    const p = st + STREET_POINTS + idx * POINT_SIZE;
    const px = speed.mem.readF32(p), py = speed.mem.readF32(p + 4);
    if (px === null || Math.hypot(px - x, py - y) > 2) continue;   // not that point: look again
    const z = speed.mem.readI16(p + POINT_Z);
    return z === null ? null : z * Z_STEP;
  }
  return null;
}


function moveSearchStart(from, always) {
  if (!from || !(always || from.d > SNAP_MIN)) return false;
  if (speed.mem.readU32(GPS) !== 1 || speed.mem.readU32(GPS + GPS_SECTION) !== 0) return false;
  speed.mem.writeF32(GPS + GPS_START, from.x);
  speed.mem.writeF32(GPS + GPS_START + 4, from.y);
  const z = streetHeight(from.street, from.idx, from.x, from.y);
  if (z !== null) speed.mem.writeF32(GPS + GPS_START + 8, z);
  return true;
}

// a request the game filed from where the car is: start it on the street
function checkSearchStart() {
  if (!snap || !(snap.d > SNAP_MIN) || speed.mem.readU32(GPS) !== 1) return;
  const st = vec3(GPS + GPS_START);
  if (!st) return;
  const fromCar = Math.hypot(st.x - snap.cx, st.y - snap.cy) < SNAP_MIN;
  if (fromCar) moveSearchStart(snap);
}

speed.on('ui:snap', (p) => {
  if (p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.d === 'number') snap = p;
});

function setGpsToEvent(x, y, from) {
  if (speed.mem.readU32(MAP_EVENTS_READY) !== 1) return false;
  let best = 0, bd = GPS_PICK_NEAR * GPS_PICK_NEAR;
  for (let i = 0; i < MAP_EVENT_COUNT; i++) {
    const e = MAP_EVENTS + i * MAP_EVENT_SIZE;
    const p = speed.mem.readPtr(e);
    if (!p) continue;
    if ((speed.call(MAP_EVENT_SHOWN, [e], { conv: 'thiscall', ret: 'int' }) & 0xFF) === 0) continue;
    const ex = speed.mem.readI32(p + ENTRY_POS), ey = speed.mem.readI32(p + ENTRY_POS + 4);
    if (ex === null || ey === null) continue;
    const d = (ex - x) * (ex - x) + (ey - y) * (ey - y);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return false;
  if ((speed.call(GPS_IS_TARGET, [GPS_MANAGER, best], { conv: 'thiscall', ret: 'int' }) & 0xFF) !== 0) return true;
  speed.call(GPS_CLEAR, [GPS_MANAGER], { conv: 'thiscall', ret: 'void' });
  speed.call(GPS_SET, [GPS_MANAGER, best], { conv: 'thiscall', ret: 'void' });
  moveSearchStart(from || snap);
  routeLast = 0;                                    // send the new route right away
  return true;
}

function stepGps() {
  for (let i = 0; i < GPS_STEPS && speed.mem.readU32(GPS) !== 0; i++)
    speed.call(GPS_UPDATE, [GPS], { conv: 'thiscall', ret: 'void' });
}

// A marker of the player's own (a double click on the expanded map): the same
// call, with an entry the mod builds. 0x529480 reads only [entry] (a record
// with the position as integers at +0x34/+0x38/+0x3C, and +4/+8 copied along)
// and the four kind pointers at +4..+0x10; with those null the destination id
// is 0, a place and not an event. The page sends the street point nearest the
// click, so the search has a road to end on.
const ENTRY_SIZE = 0x18, PLACE_SIZE = 0x40;
let placeEntry = 0, placeRecord = 0;

// How a search ended: 0x4268A0 leaves it at GPS+8 (and +4, which a new
// request sets to 1): 2 a route, 3 no way to the target (the search ran out),
// 4 nothing to start from. A marker's street point can be one the GPS does
// not reach (a dead end, a one-way stretch): then the next of the page's
// candidates - the nearest point of the next nearest street - is tried, and
// with the start moved onto the street whatever the distance.
const GPS_RESULT = 0x08, GPS_PENDING = 0x04;
const RESULT_ROUTE = 2, RESULT_NO_WAY = 3, RESULT_NO_START = 4;
const WAYPOINT_WAIT_MS = 8000;
let pendingPlace = null;   // { targets, i, from, since }

function tryWaypoint(now) {
  const p = pendingPlace;
  const t = p.targets[p.i];
  setWaypoint(t.x, t.y, p.from, p.i > 0, streetHeight(t.street, t.idx, t.x, t.y));
  p.since = now;
  speed.ui.send('waypoint-target', { x: t.x, y: t.y });
}

// Only a search that ended without a way (3, 4) moves on to the next street;
// anything else (still going, reset by the game's own requests off the
// streets) waits, and gives up quietly after WAYPOINT_WAIT_MS. The page says
// when a route to the marker has arrived ('waypoint-routed'): that ends it.
function checkWaypoint(now) {
  const p = pendingPlace;
  if (!p || speed.mem.readU32(GPS) !== 0) return;       // still searching
  const result = speed.mem.readU32(GPS + GPS_RESULT);
  if (result === RESULT_ROUTE) { pendingPlace = null; return; }
  if (result !== RESULT_NO_WAY && result !== RESULT_NO_START) {
    if (now - p.since > WAYPOINT_WAIT_MS) pendingPlace = null;
    return;
  }
  if (++p.i < p.targets.length) { tryWaypoint(now); return; }
  pendingPlace = null;
  speed.ui.send('waypoint-failed');
}

// The route the car holds goes when the car is told so: its controller's
// route method ([[car+0x2C]]+0x4C, 0x41EA30: code to +0x3E4, the route to
// +0x3F0) with code 0 and no route, as 0x4131F0 does - but that one only
// while a search is under way, and a finished route stayed (on the HUD too).
const CTRL_SET_ROUTE = 0x4C;
function clearCarRoute() {
  const car = speed.game.car();
  const ctrl = car ? speed.mem.readPtr(car + CAR_CONTROLLER) : 0;
  const vt = ctrl ? speed.mem.readPtr(ctrl) : 0;
  const fn = vt ? speed.mem.readPtr(vt + CTRL_SET_ROUTE) : 0;
  if (fn) speed.call(fn, [ctrl, 0, 0], { conv: 'thiscall', ret: 'void' });
}

function setWaypoint(x, y, from, forceStart, z) {
  if (!placeEntry) {
    placeEntry = speed.mem.alloc(ENTRY_SIZE);
    placeRecord = speed.mem.alloc(PLACE_SIZE);
    if (!placeEntry || !placeRecord) { placeEntry = placeRecord = 0; return false; }
  }
  for (let i = 0; i < ENTRY_SIZE; i += 4) speed.mem.writeU32(placeEntry + i, 0);
  for (let i = 0; i < PLACE_SIZE; i += 4) speed.mem.writeU32(placeRecord + i, 0);
  const car = pose();
  speed.mem.writeU32(placeEntry, placeRecord);
  speed.mem.writeU32(placeRecord + ENTRY_POS, Math.round(x) >>> 0);
  speed.mem.writeU32(placeRecord + ENTRY_POS + 4, Math.round(y) >>> 0);
  // the street's own height; the car's only when it could not be read
  const h = typeof z === 'number' ? z : car ? car.z : 0;
  speed.mem.writeU32(placeRecord + ENTRY_POS + 8, Math.round(h) >>> 0);
  speed.call(GPS_CLEAR, [GPS_MANAGER], { conv: 'thiscall', ret: 'void' });
  speed.call(GPS_SET, [GPS_MANAGER, placeEntry], { conv: 'thiscall', ret: 'void' });
  moveSearchStart(from || snap, forceStart);
  routeLast = 0;
  return true;
}

speed.on('ui:waypoint', (p) => {
  if (!p || !Array.isArray(p.targets)) return;
  const targets = p.targets.filter((t) => t && typeof t.x === 'number' && typeof t.y === 'number');
  // the start's street, for its height too
  const from = p.from && typeof p.from.x === 'number' ? p.from : null;
  if (!targets.length) return;
  pendingPlace = { targets, i: 0, from, since: 0 };
  tryWaypoint(speed.now());
});

// a double click on the marker takes it away, and the route with it
speed.on('ui:waypoint-clear', () => {
  pendingPlace = null;
  speed.call(GPS_CLEAR, [GPS_MANAGER], { conv: 'thiscall', ret: 'void' });
  clearCarRoute();
  routeLast = 0;
});
speed.on('ui:waypoint-routed', () => { pendingPlace = null; });


speed.on('ui:gps', (p) => {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return;
  setGpsToEvent(p.x, p.y, p.from && typeof p.from.x === 'number' ? p.from : null);
});


// The expanded map's legend turns categories on and off in the game's filter;
// the minimap, the game's map and the expanded one follow the same filter.
speed.on('ui:filter', (f) => {
  if (!f || typeof f.cat !== 'number' || f.cat < 0 || f.cat > 13) return;
  speed.call(CATEGORY_SET, [f.cat, f.on ? 0 : 1], { ret: 'void' });
  careerLast = 0;                                   // refresh on the next pass
  careerSent = '';
});

speed.on('ui:ready', () => {
  speed.ui.send('style', iconStyle());
  speed.ui.send('shape', shapeMode());
  speed.ui.send('edge', edgeMode());
  speed.ui.send('size', sizePercent());
  pageReady = true;
  visible = false;           // the page reloaded: send the state again
  track = null;
  careerSent = '';
  routeSent = '';
  pausedSent = null;
});

// The track only changes on a load; checking it every frame would be waste,
// but a race's first pose must not go out before it.
function checkTrack() {
  const t = trackInfo();
  if (!t) return false;
  if (!track || track.id !== t.id || track.ulx !== t.ulx || track.width !== t.width) {
    track = t;
    speed.ui.send('track', t);
  }
  return true;
}
speed.on('gamestate', () => { track = null; trail = {}; streetPtr = null; });

speed.on('frame', () => {
  if (speed.game.state() === 6) hideOriginalMinimap();
  if (pageReady) checkBigMap(speed.now());
  else if (Object.keys(hudPackages).length) { hudPackages = {}; updateBlock(); }
  checkSearchStart();
  if (bigOpen) stepGps();
  if (pendingPlace) checkWaypoint(speed.now());
  if (!pageReady) return;
  const now = speed.now();
  if (now - last < RATE_MS) return;
  last = now;

  const p = pose();
  if (!p || (!track && !checkTrack())) {
    if (visible) { speed.ui.send('hide'); visible = false; }
    return;
  }
  visible = true;
  if (carPos === null) decideCarPos(p);
  if (track && track.id === 4000) { checkCareer(now); checkRoute(now); }
  p.rivals = rivals();
  const cy = turnMode() === 'camera' ? camYaw() : null;
  if (cy !== null) p.cam = cy;
  if (zoomMode() === 'dynamic') {
    const t = speed.game.telemetry();
    if (t && isFinite(t.kmh)) p.kmh = t.kmh;
  }
  speed.ui.send('pose', p);
});

// The player changed something in Options > Mods: the arrow applies at once,
// the style goes to the page; turn and zoom are read on every pose.
speed.on('settings', () => {
  applyGpsArrow();
  if (pageReady) { speed.ui.send('style', iconStyle()); speed.ui.send('shape', shapeMode()); speed.ui.send('edge', edgeMode()); speed.ui.send('size', sizePercent()); }
});

speed.command('minimap', () => {
  const p = pose();
  const t = trackInfo();
  if (!p || !t) return 'minimap: {gray}no car (not in a race or free roam){/}';
  if (carPos === null) decideCarPos(p);
  const m = toMapPixel(t, p.x, p.y);
  const tl = speed.game.telemetry();
  return 'minimap: ' + (tl ? '{white}' + tl.kmh.toFixed(0) + '{/} km/h (zoom ' + zoomMode() + ')  ' : '{gray}no speed{/}  ') +
         'x {white}' + p.x.toFixed(1) + '{/} y {white}' + p.y.toFixed(1) +
         '{/} z ' + p.z.toFixed(1) + '  heading {white}' + (p.h * 180 / Math.PI).toFixed(0) +
         '{/} deg  ->  track {white}' + t.id + '{/} ' + t.region + ', map {green}' +
         m.px.toFixed(0) + ', ' + m.py.toFixed(0) + '{/}  rivals {white}' +
         rivals().length + '{/} (position at ' +
         (carPos === null ? '{red}no field matched{/}' : 'car+0x' + carPos.toString(16)) + ')' +
         (() => { const c = careerVisible(); return c ? '  career: {white}' + c.races.length +
           '{/} race starts, {white}' + c.zones.length + '{/} shops' : '  career: {gray}no table{/}'; })() +
         (() => { const r = gpsRoute(); return r ? '  gps: {white}' + r.nodes.length + '{/} nodes [' +
           r.nodes.slice(0, 6).map((x) => x.i).join(' ') + (r.nodes.length > 6 ? ' ...' : '') + ']' : '  gps: {gray}no route{/}'; })();
}, 'minimap - the minimap state (options are in Options > Mods)');
