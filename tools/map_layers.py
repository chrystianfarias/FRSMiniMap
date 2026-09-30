"""
Splits every map of the "NFSU2 Detailed Map" pack into the layers the themes
paint: water, relief, streets, highways, alleys, the race track and its start
line. Reads the pack's zip straight (as the mod does in the game), writes
maps/layers/:

    <id>_a.png   RGB: water, relief, streets          (grey levels 0-255)
    <id>_b.png   RGB: highways, alleys, track
    index.json   { "<id>": { "kind": "free"|"race", "start": [[x1,y1,x2,y2,w], ...],
                         "bbox": [x0, y0, x1, y1] } }   (image px; bbox: the track's extent)

The start line is kept as line segments, not pixels: a theme draws it crisp at
any size. Two RGB images rather than one RGBA: a canvas premultiplies alpha,
and a channel stored there would be lost wherever alpha is 0.

    python tools/map_layers.py                 all maps, all cores
    python tools/map_layers.py 4000 4716       only these

How each layer is found (see NOTES.md, "Map layers"):
  water     the pack's teal: blue well above red, green above red
  relief    the pack paints the terrain in flat steps (41,44,41) ... (90,101,90);
            each pixel takes its step, roads and their shadows are filled from
            the nearest step, water is 0
  free roam roads are neutral greys: highways (222), streets (132-140), alleys
            #424542 (and the (66,69,74) the DXT compression turns it into)
  race maps every road is one purple-grey (57,56,57)/(74,69,74), all in
            "streets"; the track is pure white, and its start (and finish) a
            short white bar across it, found as the pairs of close loose ends
            of the white trace's skeleton
"""
import glob
import io
import json
import os
import sys
import zipfile
from multiprocessing import Pool

import numpy as np
from PIL import Image
from scipy import ndimage as nd
from skimage.draw import line as draw_line
from skimage.morphology import skeletonize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'maps', 'layers')
LEVELS = [(41, 44, 41), (49, 52, 49), (57, 65, 57), (74, 81, 74), (90, 101, 90)]


def pack_entries():
    """{ id: zip member }, the Default variant first, never Beta."""
    zips = glob.glob(os.path.join(ROOT, '*.zip'))
    if not zips:
        sys.exit('no Detailed Map zip next to mod.json')
    zf = zipfile.ZipFile(zips[0])
    best = {}
    for info in zf.infolist():
        name = info.filename.replace('\\', '/')
        low = name.lower()
        base = os.path.basename(low)
        if not (base.startswith('trackmap') and base.endswith('.dds')) or '/beta/' in low:
            continue
        mid = base[len('trackmap'):-len('.dds')]
        rank = 0 if '/default/' in low else 1
        if mid not in best or rank < best[mid][0]:
            best[mid] = (rank, name)
    return zips[0], {k: v[1] for k, v in best.items()}


def smooth_mask(core, L, Lc, region_px=2.5, exclude=None):
    """1 in the core; around it, the pixel's own shading between the road and
    its shadow (the pack's anti-aliasing); 0 elsewhere."""
    reg = nd.distance_transform_edt(~core) <= region_px
    if exclude is not None:
        reg &= ~exclude
    alpha = np.clip((L - 22) / (Lc - 22), 0, 1)
    return nd.gaussian_filter(np.where(core, 1.0, np.where(reg, alpha, 0.0)), 0.45)


def keep_big(m, min_px):
    lab, n = nd.label(m)
    if n == 0:
        return m
    sz = nd.sum(m, lab, range(1, n + 1))
    return np.isin(lab, np.nonzero(sz >= min_px)[0] + 1)


def fill_small_holes(m, max_px):
    holes = ~m
    lab, n = nd.label(holes)
    if n == 0:
        return m
    sz = nd.sum(holes, lab, range(1, n + 1))
    return m | np.isin(lab, np.nonzero(sz < max_px)[0] + 1)


def relief_layer(r, g, b, water, roadish):
    shade = nd.binary_dilation(roadish, iterations=14)
    lab = np.zeros(r.shape, np.uint8)
    for i, c in enumerate(LEVELS):
        m = (np.abs(r - c[0]) <= 3) & (np.abs(g - c[1]) <= 3) & (np.abs(b - c[2]) <= 3) & ~shade
        m &= nd.binary_opening(m, iterations=2)
        lab[m] = i + 1
    present = sorted(set(np.unique(lab)) - {0})
    if not present:
        return np.zeros(r.shape)
    rank = np.zeros(len(LEVELS) + 1)
    for k, v in enumerate(present):
        rank[v] = k + 1
    idx = nd.distance_transform_edt(~(lab > 0) | water, return_distances=False, return_indices=True)
    fill = nd.median_filter(rank[lab][idx[0], idx[1]], size=9)
    grey = fill / len(present)
    grey[water] = 0
    return nd.gaussian_filter(grey, 1.2)


def start_bars(white):
    """The start (and finish) bars: pairs of close loose ends of the white
    trace's skeleton, with the bar's thickness measured near its ends."""
    sk = skeletonize(white)
    nb = nd.convolve(sk.astype(int), np.ones((3, 3), int), mode='constant') - 1
    ends = [e.astype(float) for e in np.argwhere(sk & (nb == 1))]
    used, bars = set(), []
    pairs = sorted(((np.hypot(*(ends[i] - ends[j])), i, j)
                    for i in range(len(ends)) for j in range(i + 1, len(ends))))
    for d, i, j in pairs:
        if d >= 80 or d < 8 or i in used or j in used:
            continue
        p, q = ends[i], ends[j]
        v = (q - p) / d
        nrm = np.array([-v[1], v[0]])
        # the segment between them must be white all the way (a bar, not a gap)
        rr, cc = draw_line(*p.astype(int), *q.astype(int))
        if white[rr, cc].mean() < 0.9:
            continue

        def thick(pt):
            n = 0
            for s in (1, -1):
                k = 0
                while k < 30:
                    y, x = (pt + nrm * s * (k + 1)).round().astype(int)
                    if not (0 <= y < white.shape[0] and 0 <= x < white.shape[1]) or not white[y, x]:
                        break
                    k += 1
                n += k
            return n + 1
        th = min(thick(p + v * 3), thick(q - v * 3))
        if th > 16:
            continue
        used.update((i, j))
        p2, q2 = p - v * 3, q + v * 3
        bars.append((p2, q2, float(th), v, nrm))
    return bars


def split(args):
    zpath, mid, member = args
    with zipfile.ZipFile(zpath) as zf:
        im = Image.open(io.BytesIO(zf.read(member))).convert('RGB')
    a = np.asarray(im).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    L = a.mean(-1)
    water = (b - r >= 14) & (g - r >= 8)
    neutral = (np.abs(r - g) <= 8) & (np.abs(g - b) <= 8)
    white = nd.binary_closing(L >= 245, iterations=1)
    is_race = white.sum() > 400
    zero = np.zeros(L.shape)
    info = {'kind': 'race' if is_race else 'free', 'start': []}

    if is_race:
        white = keep_big(white, 60)
        bars = start_bars(white)
        yy, xx = np.mgrid[0:L.shape[0], 0:L.shape[1]]
        bar_mask = np.zeros_like(white)
        for p2, q2, th, v, nrm in bars:
            d = q2 - p2
            t = np.clip(((yy - p2[0]) * d[0] + (xx - p2[1]) * d[1]) / np.dot(d, d), 0, 1)
            bar_mask |= white & (np.hypot(yy - (p2[0] + t * d[0]), xx - (p2[1] + t * d[1])) <= th / 2 + 0.5)
            info['start'].append([round(p2[1], 1), round(p2[0], 1), round(q2[1], 1), round(q2[0], 1), th])
        track = white & ~bar_mask
        if bar_mask.any():
            hw = np.median(nd.distance_transform_edt(track)[skeletonize(track)]) if track.any() else 4
            # under each bar the track goes on: joined along the bar's normal
            for p2, q2, th, v, nrm in bars:
                mid_pt = (p2 + q2) / 2
                a1 = (mid_pt - nrm * (th / 2 + 3)).round().astype(int)
                a2 = (mid_pt + nrm * (th / 2 + 3)).round().astype(int)
                br = np.zeros_like(white)
                rr, cc = draw_line(*a1, *a2)
                ok = (rr >= 0) & (rr < white.shape[0]) & (cc >= 0) & (cc < white.shape[1])
                br[rr[ok], cc[ok]] = True
                track |= bar_mask & (nd.distance_transform_edt(~br) <= hw - 0.5)
        core = track
        reg = (nd.distance_transform_edt(~core) <= 2.5) & ~(bar_mask & ~track)
        track_l = nd.gaussian_filter(np.where(core, 1.0, np.where(reg, np.clip((L - 20) / 235, 0, 1), 0.0)), 0.45)
        # the track's extent (with its start lines), for the top view to frame
        ys, xs = np.nonzero(white)
        if len(xs):
            info['bbox'] = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]

        road = (~water) & ((g - r) <= 0) & ((g - b) <= 0) & (L >= 44) & (L <= 92)
        road = nd.binary_closing(road, iterations=2)
        road = fill_small_holes(road, 60)
        road = keep_big(nd.binary_opening(road, iterations=1), 80)
        road &= ~nd.binary_dilation(white, iterations=1)
        core = nd.binary_erosion(nd.median_filter(road.astype(np.uint8), size=5).astype(bool), iterations=1)
        region = nd.binary_dilation(core, iterations=3) & ~nd.binary_dilation(white, iterations=1) & ~water
        alpha = np.clip((nd.gaussian_filter(L, 0.7) - 24) / (57 - 24), 0, 1)
        m = np.where(core, 1.0, np.where(region, alpha, 0.0))
        lab, n = nd.label(m > 0.35)
        keep = np.unique(lab[core]); keep = keep[keep > 0]
        streets = nd.gaussian_filter(np.where(np.isin(lab, keep), m, 0.0), 0.5)
        highways = alleys = zero
        roadish = road | white | ((r >= g + 1) & (b >= g + 1) & (L >= 45) & (L <= 100))
    else:
        track_l = zero
        hw_core = keep_big(nd.binary_closing(neutral & (L >= 190), iterations=1), 30)
        st_core = neutral & (L >= 115) & (L < 170) & ~nd.binary_dilation(hw_core, iterations=2)
        st_core = keep_big(nd.binary_closing(st_core, iterations=1), 30)
        al_core = (~water) & (np.abs(r - 66) <= 6) & (np.abs(g - 69) <= 6) & (b >= 60) & (b <= 80) & ((g - r) <= 5)
        al_core &= ~nd.binary_dilation(hw_core | st_core, iterations=1)
        al_core = keep_big(nd.binary_closing(al_core, iterations=1), 12)
        cores = [(hw_core, 222.0), (st_core, 136.0), (al_core, 68.0)]
        stack = np.stack([nd.distance_transform_edt(~c) if c.any() else np.full(L.shape, 1e9) for c, _ in cores])
        owner = np.argmin(stack, axis=0)
        dmin = stack.min(axis=0)
        outs = []
        for i, (c, Lc) in enumerate(cores):
            region = (owner == i) & (dmin <= 2.5) & ~water
            alpha = np.clip((L - 20) / (Lc - 20), 0, 1)
            outs.append(nd.gaussian_filter(np.where(c, 1.0, np.where(region, alpha, 0.0)), 0.45))
        highways, streets, alleys = outs
        roadish = hw_core | st_core | al_core | (neutral & (L >= 90))

    relief = relief_layer(r, g, b, water, roadish)
    wat = nd.gaussian_filter(water.astype(float), 0.6)
    to8 = lambda x: (np.clip(x, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([to8(wat), to8(relief), to8(streets)]), 'RGB').save(
        os.path.join(OUT, mid + '_a.png'), optimize=True)
    Image.fromarray(np.dstack([to8(highways), to8(alleys), to8(track_l)]), 'RGB').save(
        os.path.join(OUT, mid + '_b.png'), optimize=True)
    return mid, info


def main():
    os.makedirs(OUT, exist_ok=True)
    zpath, members = pack_entries()
    only = set(sys.argv[1:])
    jobs = [(zpath, k, v) for k, v in sorted(members.items()) if not only or k in only]
    index_path = os.path.join(OUT, 'index.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    # each map takes ~1.5 GB while it is split: a few at a time
    with Pool(min(len(jobs), 6), maxtasksperchild=4) as pool:
        for n, (mid, info) in enumerate(pool.imap_unordered(split, jobs), 1):
            index[mid] = info
            print('[%d/%d] %s %s, %d start line(s)' % (n, len(jobs), mid, info['kind'], len(info['start'])), flush=True)
    json.dump(dict(sorted(index.items())), open(index_path, 'w'), indent=1)
    print('[ok] %d maps in %s' % (len(index), OUT))


if __name__ == '__main__':
    main()
