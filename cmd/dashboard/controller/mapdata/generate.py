"""Build the password gate's offline, world-scale cable illustration.

Run with Python 3: generate.py CACHE_DIRECTORY [--download].
The cache holds greg.json (2015 Global GCM Cables) and apps.json (GNWT).
Only referenced line geometries are drawn. Projection and symbols are for
overview display; no branch, landing or connection is inferred between lines.
"""
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
from urllib.request import urlopen

CONTROLLER = Path(__file__).resolve().parents[1]
ROOT = CONTROLLER.parents[2]
GCM = "https://services1.arcgis.com/cc7nIINtrZ67dyVJ/ArcGIS/rest/services/Communication_Media_Use/FeatureServer/7"
GNWT = "https://www.apps.geomatics.gov.nt.ca/arcgis/rest/services/GNWT/UtilitiesCommunication_LCC/MapServer/18"
SELECTED = {
    "Greenland Connect", "AKORN Alaska-Oregon", "Alaska United - West",
    "Southern Cross", "PC-1", "TGN Transpacific", "Japan-US", "Unity",
    "Australia-Japan Cable", "Telstra Endeavour", "AAG (Asia-American Gateway)",
    "SEA-ME-WE-4", "EIG", "I-ME-WE", "SEACOM", "SAFE", "EASSY", "WACS",
    "MainOne", "FARICE-1", "Hibernia Atlantic", "TGN Atlantic", "Apollo",
    "GlobeNet", "SAm-1", "Pan-American Crossing (PAC)", "ARCOS-1",
    "Gondwana-1", "Tata TGN Intra-Asia (TGN-IA)", "Trans-Pacific Express",
    "Svalbard Undersea Cable System", "FLAG Europe Asia (FEA)", "SJC",
}


def load_layer(cache, filename, url, download):
    target = cache / filename
    if download:
        query = "/query?where=1%3D1&outFields=*&outSR=4326&maxAllowableOffset=0.12&f=geojson"
        with urlopen(url + query, timeout=60) as response:
            raw = response.read()
        data = json.loads(raw)
    else:
        data = json.loads(target.read_bytes())
    if not data.get("features") or data.get("exceededTransferLimit") or data.get("properties", {}).get("exceededTransferLimit"):
        raise ValueError("Missing or incomplete layer: " + filename)
    if download:
        target.write_bytes(raw)
    return data["features"]


def project(point):
    lon, lat = point[:2]
    return round((180 + lon) * 4), round((84 - lat) * 4.8 + 30)


def split_dateline(line):
    segment = [line[0]]
    for end in line[1:]:
        a, b = segment[-1][:2]
        x, y = end[:2]
        if abs(x - a) > 180:
            edge = 180 if a > 0 else -180
            dx = x + 2 * edge - a
            crossing = b + (y - b) * (edge - a) / dx if dx else b
            yield segment + [(edge, crossing)]
            segment = [(-edge, crossing)]
        segment.append(end)
    yield segment


def simplify(points, tolerance):
    if len(points) < 3:
        return points
    (x, y), (u, v) = points[0], points[-1]
    dx, dy = u - x, v - y
    norm = dx * dx + dy * dy
    largest, split = -1, 0
    for i, (px, py) in enumerate(points[1:-1], 1):
        t = max(0, min(1, ((px-x)*dx + (py-y)*dy) / norm)) if norm else 0
        error = (px-x-t*dx)**2 + (py-y-t*dy)**2
        if error > largest:
            largest, split = error, i
    if largest <= tolerance**2:
        return [points[0], points[-1]]
    return simplify(points[:split+1], tolerance)[:-1] + simplify(points[split:], tolerance)


def coordinates(points):
    return [[round(x / 4 - 180, 2), round(84 - (y - 30) / 4.8, 2)] for x, y in points]


def continents(countries):
    for country in countries:
        geo = country["geometry"]
        polys = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
        for polygon in polys:
            rings = [simplify(list(map(project, ring)), 1.15) for ring in polygon]
            if len(rings[0]) >= 4:
                yield [coordinates(ring) for ring in rings if len(ring) >= 4]


def place_name(p):
    short_names = {"CHN": "中国", "TWN": "台湾"}
    return short_names.get(p["iso_a3"], p["name_zh"] or p["name"])


def place_labels(countries):
    places = sorted((f["properties"] for f in countries),
                    key=lambda p: (p["labelrank"], p["min_label"], p["name"]))
    return [{"name": place_name(p),
             "point": [round(p["label_x"], 3), round(p["label_y"], 3)]} for p in places]


def coast_index(countries):
    for country in countries:
        g = country["geometry"]
        polygons = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for rings in polygons:
            xs, ys = zip(*(p[:2] for p in rings[0]))
            yield place_name(country["properties"]), (min(xs), min(ys), max(xs), max(ys)), rings


def nearby_regions(lines, coasts):
    # These are geographic neighbours of the mapped line, not a list of landing stations.
    nearest = {}
    threshold = .65  # angular degrees, about 72 km
    for line in lines:
        samples = [line[0]]
        for (x, y), (u, v) in zip(line, line[1:]):
            steps = max(1, math.ceil(max(abs(u-x), abs(v-y)) / .5))
            samples.extend((x+(u-x)*i/steps, y+(v-y)*i/steps) for i in range(1, steps+1))
        for x, y in samples:
            scale = max(.05, math.cos(math.radians(y)))
            for name, (west, south, east, north), rings in coasts:
                if y < south-threshold or y > north+threshold or x < west-threshold/scale or x > east+threshold/scale:
                    continue
                if name in nearest and nearest[name][0] == 0:
                    continue
                best = nearest.get(name, (threshold**2, None))
                inside = False
                for ring in rings:
                    for a, b in zip(ring, ring[1:]):
                        ax, ay = a[:2]
                        bx, by = b[:2]
                        if (ay > y) != (by > y) and x < ax+(bx-ax)*(y-ay)/(by-ay):
                            inside = not inside
                        dx, dy = (bx-ax)*scale, by-ay
                        norm = dx*dx + dy*dy
                        t = min(1, max(0, ((x-ax)*scale*dx + (y-ay)*dy)/norm)) if norm else 0
                        px, py = ax+t*(bx-ax), ay+t*dy
                        dist = ((px-x)*scale)**2 + (py-y)**2
                        if dist < best[0]:
                            best = (dist, [round(px, 3), round(py, 3)])
                if inside:
                    best = (0, [round(x, 3), round(y, 3)])
                if best[1] is not None:
                    nearest[name] = best
    return [{"name": name, "point": value[1]} for name, value in nearest.items()]


def append_lines(groups, key, geometry):
    lines = geometry["coordinates"]
    if geometry["type"] == "LineString":
        lines = [lines]
    elif geometry["type"] != "MultiLineString":
        raise ValueError(geometry["type"])
    for line in lines:
        for part in split_dateline(line):
            points = simplify(list(map(project, part)), 0.85)
            distance = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
            if distance >= 1:
                groups[key].append((distance, points))


def build(cache, download):
    groups = defaultdict(list)
    for feature in load_layer(cache, "greg.json", GCM, download):
        props = feature["properties"]
        name = props["NAME"]
        if name in SELECTED and not props["NOTLIVE"] and 0 < props["INSERVICE"] <= 2015:
            kind = "land" if props["OVERLAND"] else "sea"
            append_lines(groups, (kind, name, "gcm"), feature["geometry"])
    for feature in load_layer(cache, "apps.json", GNWT, download):
        append_lines(groups, ("land", feature["properties"]["NAME"], "gnwt"), feature["geometry"])

    routes = []
    for (kind, name, source), segments in sorted(groups.items()):
        routes.append({"kind": kind, "name": name, "source": source,
                       "lines": [coordinates(points) for _, points in segments]})
    text = (ROOT / "frontend/user/src/lib/geo-json-string.ts").read_text()
    countries = json.loads(text.split(chr(96))[1])["features"]
    coasts = list(coast_index(countries))
    for route in routes:
        route["regions"] = nearby_regions(route["lines"], coasts)
    atlas = {"land": list(continents(countries)), "routes": routes, "labels": place_labels(countries)}
    raw = json.dumps(atlas, separators=(",", ":"), ensure_ascii=True)
    # The JSON is embedded inside an inert HTML template in the standalone gate.
    (CONTROLLER / "mapdata/globe.json").write_text(raw.replace("<", r"\u003c").replace("&", r"\u0026") + "\n")
    print(f"{len(routes)} cable systems/type pairs and {len(atlas['land'])} land polygons")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    build(args.cache, args.download)
