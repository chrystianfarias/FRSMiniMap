// FRSMiniMap - minimapa em perspectiva 3D para NFS Underground 2 (SpeedLoader).
//
// Este lado roda no jogo (QuickJS, a cada frame) e le a memoria; a pagina
// (ui/index.html) so desenha. O que vai para ela:
//
//   'track'   o TrackInfo da pista carregada: id, regiao, calibracao do mapa
//   'pose'    a cada frame: posicao e rumo do jogador, rumo da camera,
//             velocidade (zoom dinamico) e os adversarios
//   'career'  o que o mapa do pause mostra agora (corridas e lojas), com os
//             filtros da legenda e os eventos especiais, perguntado ao jogo
//   'route'   a rota do GPS: os nos lidos da tabela que o jogo tem na memoria
//   'style'   o estilo dos marcadores
//
// E mexe no jogo em tres pontos, sempre conferindo os bytes antes:
//
//   - esconde o minimapa original (os objetos FEng dele, e um desvio no
//     FEngSetVisible para a animacao nao os mostrar de novo);
//   - opcionalmente, esconde a seta azul do GPS no HUD.
//
// Pose do jogador (a mesma que o spawn-car usa):
//
//   fisica + 0x20  -> pose
//   pose   + 0x20  posicao x, y, z (z pra cima; x, y e o plano do mapa)
//   pose   + 0x30  matriz de rotacao; as LINHAS sao os eixos, linha 0 a frente
//
// /minimap no console mostra o estado (pose, pista, carreira, gps) e troca as
// opcoes: icones nativo|pin, giro camera|carro, zoom dinamico|fixo,
// seta esconder|mostrar. Os enderecos e formatos estao em NOTES.md.

const PHYSICS_POSE  = 0x20;
const POSE_POSITION = 0x20;
const POSE_ROTATION = 0x30;

// A pista carregada: [0x883DAC] e o TrackInfo que 0x57F240 escolhe ao montar
// o mundo ou a corrida (GetTrackInfo sobre TheRaceParameters). Registros de
// 296 bytes no chunk 0x34201 do GLOBALB (NOTES.md, "The minimap"):
//
//   +0x40  char[]  regiao ("L4RA")
//   +0x8A  u16     id da pista: 4000 e o free roam da cidade
//   +0xAC  f32     calibracao do TRACKMAP: x do canto superior esquerdo
//   +0xB0  f32     y do canto superior esquerdo
//   +0xB4  f32     largura do mapa, em unidades do mundo
//   +0xC0  f32     zoom do radar: 1.5 cidade, 2 drag, 1 drift e Street X
const TRACK_INFO_PTR = 0x883DAC;

let pista = null;          // a ultima enviada, para so mandar quando mudar

// Os adversarios. Todo carro no mundo esta numa lista encadeada (NOTES.md,
// "Spawning a car"): [0x890080] e o sentinela, +0 o primeiro, e cada carro
// aponta o proximo no seu +0. O carro do jogador e o mesmo objeto que
// speed.game.car() devolve. car+0x14 aponta o slot, e slot+0x04 diz quem e:
// 1 jogador, 2 corredor, 3 trafego.
const WORLD_CAR_LIST = 0x890080;
const CAR_SLOT       = 0x14;
const SLOT_TYPE      = 0x04;
const SLOT_RACER     = 2;
const MAX_CARS       = 32;

// Onde o carro guarda a posicao no mundo: o NOTES diz car+0x510 (o que o
// construtor escreve) e o spawn-car usa car+0x60. Em vez de apostar, o mod
// compara os dois com a pose do jogador, que ja se sabe certa, e fica com o
// que bater. null enquanto nao decidiu.
const CAR_POS_CANDIDATES = [0x60, 0x510];
let carPos = null;

// rumo de cada adversario, tirado do movimento: { [carro]: { x, y, h } }
let rastro = {};

// O que a carreira mostra agora: a mesma pergunta que o mapa do pause faz.
// O construtor do mapa (0x4E0440) percorre a tabela de eventos do mapa e
// desenha so os que 0x533110 aprova (NOTES.md, "The minimap"):
//
//   0x85AD40  64 entradas de 0x18 bytes, validas com [0x850078] == 1;
//             +0 zero = vaga, +4 a corrida (registro de 136 bytes da carreira,
//             +0x28 o hash do gatilho), +8 a loja (160 bytes, +0x3C o hash
//             da zona)
//   0x533110  thiscall(entrada) -> al: corrida disponivel / loja do estagio
//             atual e ja descoberta (0x5003B0(hash) -> +4 == 1)
//
// So consulta; o mapa do pause chama o mesmo caminho ao abrir. Devolve o
// resultado em AL, com lixo no resto de EAX: por isso ret 'int' e & 0xFF.
const MAP_EVENTS       = 0x85AD40;
const MAP_EVENTS_READY = 0x850078;
const MAP_EVENT_SIZE   = 0x18;
const MAP_EVENT_COUNT  = 64;
const MAP_EVENT_SHOWN  = 0x533110;
const RACE_TRIGGER     = 0x28;
const SHOP_ZONE        = 0x3C;
const CAREER_MS        = 500;    // os filtros mudam no mapa do pause; meio segundo basta

let careerLast = 0;
let careerSent = '';


// O minimapa do jogo, escondido. Ele nao e um desenho a parte: sao objetos
// FEng soltos no pacote do HUD (HUD_SingleRace.fng; HUD_Short_Track.fng nas
// pistas fechadas), que o construtor do minimapa (0x4F73E0) acha pelo nome.
// Os nomes sao os que ele procura, mais os indicadores de evento e loja da
// tabela 0x7F4348 (<PREFIXO><n>, de 0), e cinco objetos sem nome conhecido, pelo
// hash, lidos do proprio pacote: o fundo, os tres icones de largada e o grupo
// do seletor de GPS. Nada alem disso e tocado.
//
//   0x52CEF0  cdecl(nome do pacote) -> pacote carregado, ou 0
//   0x5379C0  cdecl(nome do pacote, hash) -> objeto (FEngFindObject)
//   0x50CA00  cdecl(objeto) FEngSetInvisible: liga o bit 0 de +0x1C, e num
//             grupo (tipo 5, +0x18) esconde os filhos tambem
//
// Os ponteiros valem enquanto o pacote vive: sao resolvidos de novo quando o
// endereco do pacote muda, e esquecidos quando ele some.
const FE_FIND_PACKAGE = 0x52CEF0;
const FE_FIND_OBJECT  = 0x5379C0;
const FE_SET_INVISIBLE = 0x50CA00;
const FE_OBJ_FLAGS    = 0x1C;
const HUD_PACKAGES = ['HUD_SingleRace.fng', 'HUD_Short_Track.fng', 'HUD_Drag.fng', 'HUD_Drift.fng'];
const MINIMAP_NAMES = ['Track2000_map', 'TrackMapTargetRing', 'Minimap_Mask', 'StartLineIndicator',
  'PlayerCarIndicator_1', 'PlayerCarIndicator_2', 'Minimap_North_indicator', 'GPS_Search_Group'];
const MINIMAP_HASHES = [0xD80C97E1, 0x7AF1CA61, 0x7AF1CA62, 0x7AF1CA63, 0x697D2BCA,
  0xE2848973, 0x4F649313, 0x4F649314];   // e os seletores do GPS (Minimap_GPS_Selector)
const INDICATOR_PREFIXES = ['CIRCUITEVENTINDICATOR_', 'DRAGEVENTINDICATOR_', 'STREETEVENTINDICATOR_',
  'DRIFTEVENTINDICATOR_', 'SPRINTEVENTINDICATOR_', 'URLEVENTINDICATOR_', 'SUVEVENTINDICATOR_',
  'PAINTSHOPINDICATOR_', 'PARTSSHOPINDICATOR_', 'PERFORMANCESHOPINDICATOR_', 'CARLOTINDICATOR_',
  'ICESHOPINDICATOR_', 'CRIBINDICATOR_', 'SHOWCASEINDICATOR_', 'AIRACERINDICATOR_'];
// no pacote vao de _0 a _5 (URL ate _8); o _0 de cada um e o que o jogo prende
// na borda, apontando o mais proximo daquele tipo que esta fora do alcance
const INDICATOR_MAX = 12;

// FEHashUpper (0x505450): h = h * 33 + maiuscula(c), comecando em 0xFFFFFFFF
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

let hudPackages = {};   // { nome: { pkg, objs: [objeto...] } }

// A rota do GPS. O GPS (0x81CBC0) e um A* incremental (0x4268A0); quando
// acaba, entrega a rota a quem pediu por [[carro+0x2C]]+0x4C (0x41EA30), que
// a copia para o controlador (NOTES.md, "The GPS route"):
//
//   ctrl+0x3E4  o resultado da busca
//   ctrl+0x3F0  a rota, 0xC0 bytes: +0x38 ate 64 u16, +0xB9 quantos
//               (u16 & 0x1FFF = indice de um no de 0x34122; 0x2000 um sentido)
//   0x81CBC0+0x30  o destino pedido, x y z
//
// Um no e a passagem de uma rua para outra (graph.json); a pagina monta o
// traco rua a rua.
const CAR_CONTROLLER = 0x2C;
const ROUTE_NODES    = 0x428;   // 0x3F0 + 0x38
const ROUTE_COUNT    = 0x4A9;   // 0x3F0 + 0xB9
const ROUTE_MAX      = 64;
const GPS            = 0x81CBC0;
const GPS_TARGET     = 0x30;
const ROUTE_MS       = 250;
const NODE_TABLE     = 0x883DB0;   // ponteiro para os nos (0x34122 carregado)
const NODE_COUNT     = 0x883DB4;
let routeLast = 0;
let routeSent = '';

function gpsRoute() {
  const car = speed.game.car();
  const ctrl = car ? speed.mem.readPtr(car + CAR_CONTROLLER) : 0;
  if (!ctrl) return null;
  const n = speed.mem.readI8(ctrl + ROUTE_COUNT);
  if (!n || n <= 0 || n > ROUTE_MAX) return null;
  // Os nos sao lidos da tabela que o jogo tem na memoria ([0x883DB0], 32 bytes
  // cada), nao do arquivo: ela tem outra contagem (3273 contra 3289 em L4RA) e
  // outra numeracao, e o indice da rota so vale nela. De cada no saem as duas
  // ruas e os dois pontos: +8 rua, +4 ponto; +0xA rua, +6 ponto.
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

function confereRota(now) {
  if (now - routeLast < ROUTE_MS) return;
  routeLast = now;
  const r = gpsRoute();
  const key = r ? r.nodes.map((x) => x.i).join(',') + '|' + (r.target ? r.target.x.toFixed(0) + ',' + r.target.y.toFixed(0) : '') : '';
  if (key === routeSent) return;
  routeSent = key;
  speed.ui.send('route', r);
}

// Esconder um grupo so esconde os filhos na hora; a animacao do FEng volta a
// mostrar alguns (o circulo azul que pulsa no alvo do GPS e um deles). Por
// isso os filhos entram na lista e sao conferidos um a um, a cada frame.
// Grupo: tipo 5 em +0x18, filhos contados em +0x60, o primeiro em +0x64, e
// cada filho aponta o proximo em +4 (o laco de 0x50CA25).
const FE_OBJ_TYPE = 0x18, FE_GROUP = 5, FE_CHILD_COUNT = 0x60, FE_FIRST_CHILD = 0x64, FE_NEXT = 0x04;
function addWithChildren(objs, o, depth) {
  if (objs.indexOf(o) < 0) objs.push(o);
  if (depth > 4 || speed.mem.readU32(o + FE_OBJ_TYPE) !== FE_GROUP) return;
  let n = speed.mem.readI32(o + FE_CHILD_COUNT) || 0;
  let c = speed.mem.readPtr(o + FE_FIRST_CHILD);
  for (; c && n > 0 && n < 256; n--, c = speed.mem.readPtr(c + FE_NEXT)) addWithChildren(objs, c, depth + 1);
}

// A animacao do alvo do GPS (o circulo azul que pulsa) torna o seletor visivel
// de novo a cada frame, depois deste hook e antes do desenho, e esconder de
// volta nao ganha dessa corrida. Entao o FEngSetVisible (0x50CA50) ganha um
// desvio que ignora os objetos do minimapa original: uma tabela [quantos,
// objeto...] que este mod mantem. Esconder (0x50CA00) segue normal.
//
//   0x50CA50  8B 44 24 04  mov eax,[esp+4]     <- vira jmp stub
//   0x50CA54  85 C0        test eax,eax
//   0x50CA56  74 49        je ...              <- o stub volta aqui
//
// So instala se os bytes forem esses (ninguem mais mexeu na funcao).
const FE_SET_VISIBLE = 0x50CA50;
const FE_SET_VISIBLE_BYTES = [0x8B, 0x44, 0x24, 0x04, 0x85, 0xC0, 0x74, 0x49];
const BLOCK_MAX = 1024;
let blockTable = 0;       // [u32 quantos][u32 objeto x BLOCK_MAX]
let blockTried = false;

function le32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

function instalaBloqueio() {
  blockTried = true;
  const b = speed.mem.readBytes(FE_SET_VISIBLE, 8);
  const got = b ? Array.from(new Uint8Array(b)) : [];
  if (got.join() !== FE_SET_VISIBLE_BYTES.join()) {
    console.log('minimap: FEngSetVisible ja alterado (' + got.map((x) => x.toString(16)).join(' ') +
                '); o circulo do GPS do original pode continuar aparecendo');
    return;
  }
  const table = speed.mem.alloc(4 + 4 * BLOCK_MAX);
  const stub = speed.mem.alloc(64);
  if (!table || !stub) return;
  speed.mem.writeU32(table, 0);
  const back = FE_SET_VISIBLE + 6;                       // o je
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
  console.log('minimap: FEngSetVisible desviado, o minimapa original nao volta a aparecer');
}

function atualizaBloqueio() {
  if (!blockTable) return;
  const all = [];
  for (const name of Object.keys(hudPackages)) for (const o of hudPackages[name].objs) all.push(o);
  const n = Math.min(all.length, BLOCK_MAX);
  speed.mem.writeU32(blockTable, 0);                     // vazia enquanto reescreve
  for (let i = 0; i < n; i++) speed.mem.writeU32(blockTable + 4 + 4 * i, all[i]);
  speed.mem.writeU32(blockTable, n);
}

function escondeMinimapaOriginal() {
  if (!blockTried) instalaBloqueio();
  for (const name of HUD_PACKAGES) {
    const pkg = speed.call(FE_FIND_PACKAGE, [name], { ret: 'int' }) >>> 0;
    let h = hudPackages[name];
    if (!pkg) { if (h) { delete hudPackages[name]; atualizaBloqueio(); } continue; }
    if (!h || h.pkg !== pkg) {
      const objs = [];
      for (const hash of MINIMAP_OBJECTS) {
        const o = speed.call(FE_FIND_OBJECT, [name, hash], { ret: 'int' }) >>> 0;
        if (o) addWithChildren(objs, o, 0);
      }
      h = hudPackages[name] = { pkg, objs };
      atualizaBloqueio();
      console.log('minimap: ' + name + ' carregado, ' + objs.length + ' objetos do minimapa original escondidos');
    }
    for (const o of h.objs) {
      const f = speed.mem.readU32(o + FE_OBJ_FLAGS);
      if (f !== null && !(f & 1)) speed.call(FE_SET_INVISIBLE, [o], { ret: 'void' });
    }
  }
}

const RATE_MS = 1000 / 60;   // a pagina interpola; 60 Hz deixa o giro liso

let last = 0;
let visivel = false;
let paginaPronta = false;

function vec3(addr) {
  const x = speed.mem.readF32(addr);
  const y = speed.mem.readF32(addr + 4);
  const z = speed.mem.readF32(addr + 8);
  return (x === null || y === null || z === null) ? null : { x, y, z };
}

// Posicao e rumo do jogador, ou null fora do jogo. O rumo e o angulo da
// frente do carro no plano, em radianos, 0 = +x (leste), pi/2 = +y (norte).
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

// pixel do TRACKMAP (512) para um ponto do mundo, pela calibracao da pista
// O rumo da camera, para o radar girar com ela (como no GTA) e nao com o carro.
// A matriz de vista do jogo fica em 0x8734A0 (4x4 floats; a mesma que o pops
// usa, achada pelo /camera dele). A frente da camera no plano e a terceira
// coluna, m[2] e m[6], com sinal positivo: medido no jogo comparando os quatro
// candidatos (coluna ou linha, cada um com os dois sinais) com o rumo do carro
// andando com a camera atras - acerto 0.94 na coluna, os outros longe disso.
const VIEW_MATRIX = 0x8734A0;

function camYaw() {
  const x = speed.mem.readF32(VIEW_MATRIX + 4 * 2);
  const y = speed.mem.readF32(VIEW_MATRIX + 4 * 6);
  if (x === null || y === null || !isFinite(x) || !isFinite(y) || Math.hypot(x, y) < 1e-3) return null;
  return Math.atan2(y, x);
}

// A seta azul do GPS no HUD (o marcador que flutua a frente do carro, textura
// MARKER_GPS_AID). Quem a desenha e 0x5F3CB0 (thiscall, 1 argumento, ret 4;
// o unico chamador, 0x63176A, nao usa o retorno): confere a rota do
// controlador, acha um ponto a frente e desenha com 0x5EAC90. Esconder e fazer
// a funcao voltar na primeira instrucao; mostrar, devolver os bytes dela.
// So mexe se o comeco for o esperado (ninguem mais alterou).
const GPS_ARROW_DRAW = 0x5F3CB0;
const GPS_ARROW_ORIG = [0x55, 0x8B, 0xEC];          // push ebp; mov ebp,esp
const GPS_ARROW_OFF  = [0xC2, 0x04, 0x00];          // ret 4
function setaGps() { return speed.store.get('gpsArrow', 'esconder') === 'mostrar' ? 'mostrar' : 'esconder'; }
function aplicaSetaGps() {
  const b = speed.mem.readBytes(GPS_ARROW_DRAW, 3);
  const now = b ? Array.from(new Uint8Array(b)).join() : '';
  const want = setaGps() === 'esconder' ? GPS_ARROW_OFF : GPS_ARROW_ORIG;
  if (now === want.join()) return true;
  if (now !== GPS_ARROW_ORIG.join() && now !== GPS_ARROW_OFF.join()) {
    console.log('minimap: a funcao da seta do GPS foi alterada por outro mod; nao mexo nela');
    return false;
  }
  return speed.mem.patch(GPS_ARROW_DRAW, want);
}
aplicaSetaGps();

// 'dinamico' (padrao) ou 'fixo': o zoom abre com a velocidade ou nao
function zoomMode() { return speed.store.get('zoom', 'dinamico') === 'fixo' ? 'fixo' : 'dinamico'; }

// 'camera' (padrao) ou 'carro': com o que o radar gira
function giro() { return speed.store.get('turn', 'camera') === 'carro' ? 'carro' : 'camera'; }

function mapa(t, x, y) {
  return { px: (x - t.ulx) / t.width * 512, py: (t.uly - y) / t.width * 512 };
}

// Decide o offset da posicao pelo carro do jogador: o campo que estiver a
// menos de 2 unidades da pose da fisica, em x e y.
function decideCarPos(p) {
  const me = speed.game.car();
  if (!me) return;
  for (const off of CAR_POS_CANDIDATES) {
    const v = vec3(me + off);
    if (v && Math.abs(v.x - p.x) < 2 && Math.abs(v.y - p.y) < 2) {
      carPos = off;
      console.log('minimap: posicao dos carros em car+0x' + off.toString(16));
      return;
    }
  }
}

// Os corredores no mundo, menos o jogador: [{ x, y, h }], h em radianos como
// o do jogador (0 = +x). O rumo sai do deslocamento desde o ultimo frame, e
// fica o anterior enquanto o carro esta parado.
function adversarios() {
  if (carPos === null) return [];
  const list = speed.mem.readPtr(WORLD_CAR_LIST);
  if (!list) return [];
  const me = speed.game.car();
  const out = [], vistos = {};
  let car = speed.mem.readPtr(list);
  for (let i = 0; car && car !== list && i < MAX_CARS; i++, car = speed.mem.readPtr(car)) {
    if (car === me) continue;
    const slot = speed.mem.readPtr(car + CAR_SLOT);
    if (!slot || speed.mem.readI32(slot + SLOT_TYPE) !== SLOT_RACER) continue;
    const v = vec3(car + carPos);
    if (!v || !isFinite(v.x) || !isFinite(v.y)) continue;
    const r = rastro[car];
    let h = r ? r.h : 0;
    if (r) {
      const dx = v.x - r.x, dy = v.y - r.y;
      if (dx * dx + dy * dy > 0.25) h = Math.atan2(dy, dx);
      else { out.push({ x: v.x, y: v.y, h }); vistos[car] = r; continue; }
    }
    vistos[car] = { x: v.x, y: v.y, h };
    out.push({ x: v.x, y: v.y, h });
  }
  rastro = vistos;
  return out;
}

const hex = (v) => '0x' + ('00000000' + (v >>> 0).toString(16).toUpperCase()).slice(-8);

// O que o mapa do pause mostra agora, entrada por entrada, com as regras do
// proprio jogo: 0x533110 decide se a entrada aparece; 0x500DE0 da o tipo dela,
// 0x4965F0 a categoria e 0x4964D0 se o filtro da legenda esconde a categoria
// (1 = escondida). Assim a carreira, os filtros e os eventos especiais saem do
// jogo, sem tabela nossa.
//   corrida: +0x34 1 = especial (o X no mapa: 0x4B06D0 troca o icone pela
//            textura MINIMAP_ICON_CROSS quando e 1; 2 e URL), +0x18 low16 a
//            pista, +0x28 o hash do gatilho
//   loja:    +0x3C o hash da zona
// { races: [{ trigger, track, special }], zones: [hash] }, ou null quando a
// tabela nao esta montada (fora da carreira, carregando).
const EVENT_KIND    = 0x500DE0;   // thiscall(entrada) -> tipo
const KIND_CATEGORY = 0x4965F0;   // cdecl(tipo) -> categoria
const CATEGORY_OFF  = 0x4964D0;   // cdecl(categoria) -> 1 se o filtro esconde
const RACE_SPECIAL  = 0x34;   // == 1 (0x0D, que parecia ser, marca o SUV)
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
  // o estado de cada categoria da legenda, para a do mapa expandido
  const off = [];
  for (let c = 0; c <= 13; c++) off.push((speed.call(CATEGORY_OFF, [c], { ret: 'int' }) & 0xFF) !== 0);
  return { races, zones: Object.keys(zones).sort(), off };
}

function confereCarreira(now) {
  if (now - careerLast < CAREER_MS) return;
  careerLast = now;
  const c = careerVisible();
  const key = c ? JSON.stringify(c) : 'null';
  if (key === careerSent) return;
  careerSent = key;
  speed.ui.send('career', c);
}

// O estilo dos marcadores: 'pin' (os pinos com icone) ou 'nativo' (circulos,
// como o minimapa do jogo: cheios nas lojas, anel grosso nos eventos). Fica
// guardado no store do mod.
function estiloIcones() {
  const v = speed.store.get('icons', 'pin');
  return v === 'nativo' ? 'nativo' : 'pin';
}

// ---- o mapa expandido ----
// O M (e o "Mapa" do pause) abre o mapa do jogo, UI_InGame_WorldMap.fng, e e
// ele que pausa o jogo e cuida da tela. O mod deixa isso acontecer e abre o
// seu por cima, em tela cheia, com teclado e mouse na pagina; ao fechar o seu,
// fecha o do jogo tambem, e o jogo segue.
//   0x52CF60  cdecl(pacote) -> al: o pacote esta aberto
//   PAD_BACK  a mensagem de "voltar" do controle (FEHashUpper 911AB364), a
//             que o Esc gera: a tela do mapa a trata (0x4EF642...) e sai
//             sozinha, retomando o jogo. Fechar o pacote a forca (0x5379A0)
//             foi a primeira tentativa: tirava o pacote e deixava a tela
//             pela metade, os botoes do mapa na tela e o jogo travado.
//   0x496390  cdecl(categoria, desligada): o filtro da legenda (o setter do
//             0x4964D0), para a legenda do mapa expandido mexer no do jogo
const WORLD_MAP_PKG = 'UI_InGame_WorldMap.fng';
const FE_PACKAGE_OPEN = 0x52CF60;
const PAD_BACK = 0x911AB364;
const CLOSE_WAIT_MS = 1500;   // quanto esperar o mapa do jogo sair antes de reabrir o nosso
const CATEGORY_SET = 0x496390;
const BIG_MS = 100;
let bigOpen = false, bigLast = 0, closingSince = 0;

function mapaDoJogoAberto() {
  return (speed.call(FE_PACKAGE_OPEN, [WORLD_MAP_PKG], { ret: 'int' }) & 0xFF) !== 0;
}

function abreMapa() {
  bigOpen = true;
  speed.ui.capture(true);
  speed.ui.send('bigmap', true);
}

function fechaMapa(fechaODoJogo) {
  if (!bigOpen) return;
  bigOpen = false;
  speed.ui.capture(false);
  speed.ui.send('bigmap', false);
  if (fechaODoJogo && mapaDoJogoAberto()) {
    speed.game.sendFrontendMessage(PAD_BACK, WORLD_MAP_PKG);
    closingSince = speed.now();
  }
}

function confereMapaGrande(now) {
  if (now - bigLast < BIG_MS) return;
  bigLast = now;
  const aberto = speed.game.state() === 6 && mapaDoJogoAberto();
  // pedido o fechamento, espera o mapa do jogo sair; se nao sair, reabre o
  // nosso (melhor do que deixar o jogador numa tela sem controle)
  if (closingSince) {
    if (!aberto) closingSince = 0;
    else if (now - closingSince < CLOSE_WAIT_MS) return;
    else closingSince = 0;
  }
  if (aberto && !bigOpen) abreMapa();
  else if (!aberto && bigOpen) fechaMapa(false);   // o do jogo fechou por conta propria
}

speed.on('ui:bigmap-close', () => fechaMapa(true));

// A legenda do mapa expandido liga e desliga categorias no filtro do jogo; o
// minimapa, o mapa do jogo e o expandido seguem o mesmo filtro.
speed.on('ui:filter', (f) => {
  if (!f || typeof f.cat !== 'number' || f.cat < 0 || f.cat > 13) return;
  speed.call(CATEGORY_SET, [f.cat, f.on ? 0 : 1], { ret: 'void' });
  careerLast = 0;                                   // atualiza na proxima volta
  careerSent = '';
});

speed.on('ui:ready', () => {
  speed.ui.send('style', estiloIcones());
  paginaPronta = true;
  visivel = false;           // a pagina recarregou: manda o estado de novo
  pista = null;
  careerSent = '';
  routeSent = '';
});

// A pista so muda num carregamento; conferir a cada frame seria desperdicio,
// mas a primeira pose de uma corrida nao pode sair antes dela.
function conferePista() {
  const t = trackInfo();
  if (!t) return false;
  if (!pista || pista.id !== t.id || pista.ulx !== t.ulx || pista.width !== t.width) {
    pista = t;
    speed.ui.send('track', t);
  }
  return true;
}
speed.on('gamestate', () => { pista = null; rastro = {}; });

speed.on('frame', () => {
  if (speed.game.state() === 6) escondeMinimapaOriginal();
  if (paginaPronta) confereMapaGrande(speed.now());
  else if (Object.keys(hudPackages).length) { hudPackages = {}; atualizaBloqueio(); }
  if (!paginaPronta) return;
  const now = speed.now();
  if (now - last < RATE_MS) return;
  last = now;

  const p = pose();
  if (!p || (!pista && !conferePista())) {
    if (visivel) { speed.ui.send('hide'); visivel = false; }
    return;
  }
  visivel = true;
  if (carPos === null) decideCarPos(p);
  if (pista && pista.id === 4000) { confereCarreira(now); confereRota(now); }
  p.rivals = adversarios();
  const cy = giro() === 'camera' ? camYaw() : null;
  if (cy !== null) p.cam = cy;
  if (zoomMode() === 'dinamico') {
    const t = speed.game.telemetry();
    if (t && isFinite(t.kmh)) p.kmh = t.kmh;
  }
  speed.ui.send('pose', p);
});

speed.command('minimap', (args) => {
  if (args && args[0] === 'seta') {
    const v = args[1] === 'esconder' ? 'esconder' : args[1] === 'mostrar' ? 'mostrar' : null;
    if (!v) return 'minimap seta {white}esconder{/} | {white}mostrar{/}  (agora: ' + setaGps() + ')';
    speed.store.set('gpsArrow', v);
    return aplicaSetaGps() ? 'minimap: seta do GPS {green}' + (v === 'esconder' ? 'escondida' : 'visivel') + '{/}'
                           : 'minimap: {red}nao consegui mexer na seta (outro mod alterou a funcao){/}';
  }
  if (args && args[0] === 'zoom') {
    const v = args[1] === 'dinamico' ? 'dinamico' : args[1] === 'fixo' ? 'fixo' : null;
    if (!v) return 'minimap zoom {white}dinamico{/} | {white}fixo{/}  (agora: ' + zoomMode() + ')';
    speed.store.set('zoom', v);
    return 'minimap: zoom {green}' + v + '{/}';
  }
  if (args && args[0] === 'giro') {
    const v = args[1] === 'camera' ? 'camera' : args[1] === 'carro' ? 'carro' : null;
    if (!v) return 'minimap giro {white}camera{/} | {white}carro{/}  (agora: ' + giro() + ')';
    speed.store.set('turn', v);
    return 'minimap: o radar gira com {green}' + v + '{/}';
  }
  if (args && args[0] === 'icones') {
    const v = args[1] === 'nativo' ? 'nativo' : args[1] === 'pin' ? 'pin' : null;
    if (!v) return 'minimap icones {white}nativo{/} | {white}pin{/}  (agora: ' + estiloIcones() + ')';
    speed.store.set('icons', v);
    speed.ui.send('style', v);
    return 'minimap: icones {green}' + v + '{/}';
  }
  const rr = gpsRoute();
  if (rr) {
    console.log('minimap: rota do gps (' + rr.nodes.length + ' nos): ' +
                rr.raw.map((v) => '0x' + v.toString(16)).join(' ') +
                (rr.target ? '  destino ' + rr.target.x.toFixed(1) + ' ' + rr.target.y.toFixed(1) : ''));
    // os nos como estao NA MEMORIA ([0x883DB0], 32 bytes cada), para comparar
    // com o arquivo: +4 ponto, +6 ponto, +8 rua, +0xA rua, +0x18..+0x1E
    const base = speed.mem.readPtr(0x883DB0), count = speed.mem.readU32(0x883DB4);
    console.log('minimap: nos na memoria em 0x' + (base || 0).toString(16) + ', ' + count + ' nos');
    if (base) for (const nn of rr.nodes) {
      const n = nn.i;
      const at = base + n * 32, w = [];
      for (let k = 0; k < 16; k++) w.push(speed.mem.readU16(at + 2 * k));
      console.log('minimap:   no ' + n + ': ' + w.join(' '));
    }
    const car = speed.game.car();
    const pc = car ? vec3(car + (carPos === null ? 0x60 : carPos)) : null;
    if (pc) console.log('minimap: carro em ' + pc.x.toFixed(1) + ' ' + pc.y.toFixed(1));
  }
  const p = pose();
  const t = trackInfo();
  if (!p || !t) return 'minimap: {gray}sem carro (fora do jogo){/}';
  if (carPos === null) decideCarPos(p);
  const m = mapa(t, p.x, p.y);
  const tl = speed.game.telemetry();
  return 'minimap: ' + (tl ? '{white}' + tl.kmh.toFixed(0) + '{/} km/h (zoom ' + zoomMode() + ')  ' : '{gray}sem velocidade{/}  ') +
         'x {white}' + p.x.toFixed(1) + '{/} y {white}' + p.y.toFixed(1) +
         '{/} z ' + p.z.toFixed(1) + '  rumo {white}' + (p.h * 180 / Math.PI).toFixed(0) +
         '{/} graus  ->  pista {white}' + t.id + '{/} ' + t.region + ', mapa {green}' +
         m.px.toFixed(0) + ', ' + m.py.toFixed(0) + '{/}  adversarios {white}' +
         adversarios().length + '{/} (posicao em ' +
         (carPos === null ? '{red}nenhum campo bateu{/}' : 'car+0x' + carPos.toString(16)) + ')' +
         (() => { const c = careerVisible(); return c ? '  carreira: {white}' + c.races.length +
           '{/} largadas, {white}' + c.zones.length + '{/} lojas' : '  carreira: {gray}sem tabela{/}'; })() +
         (() => { const r = gpsRoute(); return r ? '  gps: {white}' + r.nodes.length + '{/} nos [' +
           r.nodes.slice(0, 6).map((x) => x.i).join(' ') + (r.nodes.length > 6 ? ' ...' : '') + ']' : '  gps: {gray}sem rota{/}'; })();
}, 'minimap [icones nativo|pin] [giro camera|carro] [zoom dinamico|fixo] [seta esconder|mostrar] - estado; ou troca uma opcao');
