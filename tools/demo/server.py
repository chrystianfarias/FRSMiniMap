"""
A stand-in for FRSModLoader's hosts, to run the minimap page in a desktop
browser (tools/demo/shoot.py uses it for the settings' pictures):

    http://nfsu2.tex/mod/frsminimap/maps/TRACKMAP<id>.dds   the pack's map, out of its zip, as PNG
    http://nfsu2.tex/MINIMAP_NORTH_INDICATOR               a small north arrow
    http://nfsu2.data/<region>/<file>.json                 from --data (events, shops, roads, graph)
    anything else                                          the mod's own files (FRSMiniMap's root);
                                                           */nfsu2.css from FRSModLoader's ui

The browser is told to send nfsu2.tex and nfsu2.data here with
--host-resolver-rules. The GameData JSONs are made by the loader from the
game's files, so they are not in the repository: --data points at a copy.

    python tools/demo/server.py --port 8765 --data <folder with L4RA/*.json>
"""
import argparse
import glob
import io
import os
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KIT = os.path.join(os.path.dirname(ROOT), 'SpeedLoader', 'ui', 'nfsu2.css')
DATA = None
_maps = {}


def pack_png(mid):
    if mid in _maps:
        return _maps[mid]
    z = glob.glob(os.path.join(ROOT, '*.zip'))
    if not z:
        return None
    with zipfile.ZipFile(z[0]) as zf:
        cand = [i.filename for i in zf.infolist()
                if i.filename.lower().endswith('trackmap%s.dds' % mid) and '/beta/' not in i.filename.lower()]
        cand.sort(key=lambda n: 0 if '/default/' in n.lower() else 1)
        if not cand:
            return None
        im = Image.open(io.BytesIO(zf.read(cand[0]))).convert('RGBA')
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    _maps[mid] = buf.getvalue()
    return _maps[mid]


def north_png():
    im = Image.new('RGBA', (52, 26), (0, 0, 0, 0))
    ImageDraw.Draw(im).polygon([(26, 1), (50, 25), (2, 25)], fill=(235, 240, 240, 230))
    buf = io.BytesIO()
    im.save(buf, 'PNG')
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        path = self.path.split('?')[0]
        if host == 'nfsu2.tex':
            name = os.path.basename(path)
            if name.upper().startswith('TRACKMAP'):
                body = pack_png(name[len('TRACKMAP'):].split('.')[0])
                return self.send_bytes(body, 'image/png') if body else self.send_error(404)
            if name == 'MINIMAP_NORTH_INDICATOR':
                return self.send_bytes(north_png(), 'image/png')
            return self.send_error(404)
        if host == 'nfsu2.data':
            f = os.path.join(DATA, *path.strip('/').split('/'))
            if os.path.isfile(f):
                return self.send_bytes(open(f, 'rb').read(), 'application/json')
            return self.send_error(404)
        if path.endswith('/nfsu2.css') and os.path.isfile(KIT):
            return self.send_bytes(open(KIT, 'rb').read(), 'text/css')
        return super().do_GET()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--data', required=True)
    a = ap.parse_args()
    DATA = a.data
    ThreadingHTTPServer(('127.0.0.1', a.port), Handler).serve_forever()
