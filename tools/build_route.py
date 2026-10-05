#!/usr/bin/env python3
"""Build the route files the website uses from route/source.gpx.

    python3 tools/build_route.py

Writes:
  docs/route-data.js                       outline of the route + the 360 start spots, for drawing
  docs/downloads/catch-359-route.gpx       the route, cleaned up for riders' GPS devices
  docs/downloads/catch-359-start-spots.gpx the 360 start spots as waypoints

Start spots are spread evenly by distance: spot k sits k/360 of the way round the
route from the start, so neighbouring riders are route length / 360 apart (about 1.6 km).
Only the Python standard library is needed.
"""

import json
import math
import re
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'route' / 'source.gpx'
OUT_JS = ROOT / 'docs' / 'route-data.js'
OUT_ROUTE = ROOT / 'docs' / 'downloads' / 'catch-359-route.gpx'
OUT_SPOTS = ROOT / 'docs' / 'downloads' / 'catch-359-start-spots.gpx'

ROUTE_NAME = "Catch 359 - Denmark's biggest circle"
SPOTS = 360
OFFICIAL_KM = 578    # the distance quoted for the event; km labels use this
VIEW_W = 400          # drawing width; height follows the route's shape
PAD = 34              # room around the route for ticks and labels
SIMPLIFY_M = 120      # outline tolerance in metres (drawing only)


def haversine_km(a, b):
    r = 6371.0088
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def read_gpx(path):
    text = path.read_text(encoding='utf-8')
    pts = []
    for m in re.finditer(r'<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>(.*?)</trkpt>', text, re.S):
        ele = re.search(r'<ele>([-\d.]+)</ele>', m.group(3))
        pts.append((float(m.group(1)), float(m.group(2)), float(ele.group(1)) if ele else None))
    if len(pts) < 2:
        raise SystemExit(f'No track points found in {path}')
    return pts


def simplify(points, tol):
    """Douglas-Peucker on projected (x, y) points; returns kept indices."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = points[i], points[j]
        dx, dy = x2 - x1, y2 - y1
        seg = math.hypot(dx, dy) or 1e-12
        best, idx = 0, None
        for k in range(i + 1, j):
            x0, y0 = points[k]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / seg
            if d > best:
                best, idx = d, k
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [k for k, v in enumerate(keep) if v]


def main():
    pts = read_gpx(SOURCE)
    latlon = [(p[0], p[1]) for p in pts]

    cum = [0.0]
    for a, b in zip(latlon, latlon[1:]):
        cum.append(cum[-1] + haversine_km(a, b))
    total = cum[-1]

    # Local flat projection (metres), fine for a region the size of Jutland.
    lat0 = sum(p[0] for p in latlon) / len(latlon)
    kx = 111_320 * math.cos(math.radians(lat0))
    ky = 110_574
    xy_m = [(lon * kx, -lat * ky) for lat, lon in latlon]

    minx = min(p[0] for p in xy_m); maxx = max(p[0] for p in xy_m)
    miny = min(p[1] for p in xy_m); maxy = max(p[1] for p in xy_m)
    scale = (VIEW_W - 2 * PAD) / (maxx - minx)
    view_h = round((maxy - miny) * scale + 2 * PAD)

    def to_view(p):
        return ((p[0] - minx) * scale + PAD, (p[1] - miny) * scale + PAD)

    # Outline for drawing
    kept = simplify(xy_m, SIMPLIFY_M)
    outline = [to_view(xy_m[k]) for k in kept]
    path = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in outline) + ' Z'

    # Centre of the circle, for pointing the ticks outwards
    cx = (min(p[0] for p in outline) + max(p[0] for p in outline)) / 2
    cy = (min(p[1] for p in outline) + max(p[1] for p in outline)) / 2

    # Start spots, evenly spread by distance
    spots = []
    j = 0
    for k in range(SPOTS):
        target = total * k / SPOTS
        while cum[j + 1] < target:
            j += 1
        f = (target - cum[j]) / ((cum[j + 1] - cum[j]) or 1e-12)
        lat = latlon[j][0] + f * (latlon[j + 1][0] - latlon[j][0])
        lon = latlon[j][1] + f * (latlon[j + 1][1] - latlon[j][1])

        x, y = to_view((lon * kx, -lat * ky))
        # Ticks point straight out from the middle of the circle, so they stay tidy
        # even where the road wiggles.
        rx, ry = x - cx, y - cy
        n = math.hypot(rx, ry) or 1
        nx, ny = rx / n, ry / n
        spots.append({'x': round(x, 2), 'y': round(y, 2), 'nx': round(nx, 3), 'ny': round(ny, 3),
                      'lat': round(lat, 6), 'lon': round(lon, 6)})

    # Elevation profile, sampled evenly by distance, and total climbing
    eles = [p[2] if p[2] is not None else 0.0 for p in pts]
    profile, j = [], 0
    for k in range(721):
        target = total * k / 720
        while j < len(cum) - 2 and cum[j + 1] < target:
            j += 1
        f = (target - cum[j]) / ((cum[j + 1] - cum[j]) or 1e-12)
        profile.append(round(eles[j] + f * (eles[j + 1] - eles[j]), 1))
    gain = sum(max(0.0, b - a) for a, b in zip(eles, eles[1:]))

    data = {
        'width': VIEW_W,
        'height': view_h,
        'path': path,
        'measuredKm': round(total, 1),
        'climbM': round(gain / 10) * 10,
        'maxEleM': round(max(eles)),
        'profile': profile,
        'spots': spots,
    }
    OUT_JS.write_text(
        '// Generated by tools/build_route.py from route/source.gpx. Do not edit by hand.\n'
        f'export const route = {json.dumps(data, separators=(",", ":"))};\n',
        encoding='utf-8')

    # Clean route GPX for download (no planning timestamps)
    trkpts = '\n'.join(
        f'      <trkpt lat="{lat:.6f}" lon="{lon:.6f}">' + (f'<ele>{ele:.1f}</ele>' if ele is not None else '') + '</trkpt>'
        for lat, lon, ele in pts)
    OUT_ROUTE.parent.mkdir(parents=True, exist_ok=True)
    OUT_ROUTE.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Catch 359" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>{escape(ROUTE_NAME)}</name></metadata>
  <trk>
    <name>{escape(ROUTE_NAME)}</name>
    <trkseg>
{trkpts}
    </trkseg>
  </trk>
</gpx>
''', encoding='utf-8')

    wpts = '\n'.join(
        f'  <wpt lat="{s["lat"]:.6f}" lon="{s["lon"]:.6f}"><name>Catch 359 spot {k}</name>'
        f'<desc>Start spot {k} of 360, {OFFICIAL_KM * k / SPOTS:.1f} km along the route</desc></wpt>'
        for k, s in enumerate(spots))
    OUT_SPOTS.write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Catch 359" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Catch 359 - the 360 start spots</name></metadata>
{wpts}
</gpx>
''', encoding='utf-8')

    print(f'Route: {total:.1f} km measured, {len(pts)} points, outline {len(outline)} points, '
          f'drawing {VIEW_W}x{view_h}, spot spacing {total / SPOTS:.3f} km')


if __name__ == '__main__':
    main()
