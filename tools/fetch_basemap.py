#!/usr/bin/env python3
"""Download the coastline used behind the route drawing and clip it to Jutland.

    python3 tools/fetch_basemap.py

Writes route/land.json: land outlines (lists of [lon, lat]) inside the map extent.
Source: Natural Earth 1:10m land (public domain), https://www.naturalearthdata.com
Only needs to be run again if MAP_EXTENT in tools/build_route.py changes.
"""

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_route import MAP_EXTENT  # noqa: E402

URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
OUT = Path(__file__).resolve().parent.parent / 'route' / 'land.json'


def clip_ring(ring, w, s, e, n):
    """Sutherland–Hodgman clip of one ring against a lon/lat rectangle."""
    def clip(points, inside, cross):
        out = []
        for i, cur in enumerate(points):
            prev = points[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
        return out

    def at_x(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))

    def at_y(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)

    pts = [tuple(p) for p in ring]
    for inside, cross in (
        (lambda p: p[0] >= w, at_x(w)),
        (lambda p: p[0] <= e, at_x(e)),
        (lambda p: p[1] >= s, at_y(s)),
        (lambda p: p[1] <= n, at_y(n)),
    ):
        if not pts:
            break
        pts = clip(pts, inside, cross)
    return pts


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if src:
        data = json.loads(Path(src).read_text())
    else:
        print('Downloading Natural Earth land (about 10 MB)…')
        with urllib.request.urlopen(URL) as r:
            data = json.load(r)

    w, s, e, n = MAP_EXTENT
    m = 0.05   # clip slightly outside the extent so edges don't show
    rings = []
    for f in data['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for poly in polys:
            for ring in poly:
                c = clip_ring(ring, w - m, s - m, e + m, n + m)
                if len(c) >= 3:
                    rings.append([[round(x, 4), round(y, 4)] for x, y in c])

    OUT.write_text(json.dumps({'source': 'Natural Earth 1:10m land (public domain)', 'rings': rings}, separators=(',', ':')))
    print(f'Wrote {OUT} with {len(rings)} outlines, {sum(map(len, rings))} points')


if __name__ == '__main__':
    main()
