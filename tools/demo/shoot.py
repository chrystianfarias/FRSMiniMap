"""
The pictures of Options > Mods > FRSMiniMap: every setting (and every option
of a choice) rendered by the real page in a desktop Chrome, through
tools/demo/server.py, cropped around the minimap and saved 16:9 in legend/.

    python tools/demo/shoot.py --data <folder with L4RA/*.json>

The data folder holds the GameData JSONs (events, shops, roads, graph) the
loader makes from the game's files; they are not in the repository.
"""
import argparse
import os
import subprocess
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'legend')
CHROME = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
          r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']
PORT = 8765

# name: query. Every picture is the minimap alone, centred, on a transparent
# background: a 720x405 box around the middle of the 1920x1080 screen (the
# minimap and its edge pins), scaled to 640x360.
BASE = 'transparent=1&center=1&'
SHOTS = {
    'theme-original': 'theme=original',
    'theme-google-light': 'theme=google-light',
    'theme-google-dark': 'theme=google-dark',
    'theme-waze': 'theme=waze',
    # clean in a race: the track alone - 4716, from its start line
    'clean-on': 'theme=waze&clean=1&edge=solid&buildings=0&track=4716&x=2520.7&y=241.8&h=1.5708&preset=3',
    'clean-off': 'theme=waze&clean=0&edge=solid&buildings=0&track=4716&x=2520.7&y=241.8&h=1.5708&preset=3',
    'buildings-on': 'theme=original&preset=0&area=dense',
    'buildings-off': 'theme=original&preset=0&area=dense&buildings=0',
    'shape-round': 'shape=round',
    'shape-rectangular': 'shape=rectangular',
    'edge-fade': 'edge=fade&shape=rectangular',
    'edge-solid': 'edge=solid&shape=rectangular',
    'icons-pin': 'style=pin',
    'icons-native': 'style=native',
    'turn-camera': 'turn=camera',
    'turn-car': 'turn=car',
    'route-colour-on': 'route=1&routeColour=1&eventColour=%239b59b6',
    'route-colour-off': 'route=1&routeColour=0',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True)
    ap.add_argument('only', nargs='*')
    a = ap.parse_args()
    chrome = next((c for c in CHROME if os.path.exists(c)), None)
    if not chrome:
        sys.exit('no Chrome or Edge')
    os.makedirs(OUT, exist_ok=True)
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, 'tools', 'demo', 'server.py'),
                               '--port', str(PORT), '--data', a.data])
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/ui/index.html' % PORT, timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        tmp = os.path.join(OUT, '_shot.png')

        def shoot(query):
            url = 'http://127.0.0.1:%d/tools/demo/harness.html?%s' % (PORT, query)
            subprocess.run([chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                            '--window-size=1920,1080', '--default-background-color=00000000',
                            '--host-resolver-rules=MAP nfsu2.tex 127.0.0.1:%d,MAP nfsu2.data 127.0.0.1:%d' % (PORT, PORT),
                            '--virtual-time-budget=25000', '--screenshot=' + tmp, url],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return Image.open(tmp).convert('RGBA')

        for name, query in SHOTS.items():
            if a.only and name not in a.only:
                continue
            im = shoot(BASE + query)
            dst = os.path.join(OUT, name + '.png')
            im.crop((960 - 360, 540 - 202, 960 + 360, 540 + 203)).resize((640, 360), Image.LANCZOS).save(
                dst + '.tmp', 'PNG', optimize=True)
            try:
                os.replace(dst + '.tmp', dst)
            except OSError:                       # open in a viewer: keep it beside
                os.replace(dst + '.tmp', dst.replace('.png', '_new.png'))
            print('[ok]', name)
        if os.path.exists(tmp):
            os.remove(tmp)
    finally:
        server.terminate()


if __name__ == '__main__':
    main()
