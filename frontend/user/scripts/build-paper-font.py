"""Build same-origin Paper webfonts. Requires fonttools[woff] and brotli.
Usage: python scripts/build-paper-font.py /path/to/LXGWWenKai-Regular.ttf /path/to/OFL.txt
Upstream a5afe68ecaf6b62fbe3d317cd6d541f210b25ee4. Only web subsets are distributed.
"""
import hashlib, json, re, sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
source, license_file = map(Path, sys.argv[1:])
assert hashlib.sha256(source.read_bytes()).hexdigest() == "2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b"
out = root / "src/themes/paper/fonts"
out.mkdir(parents=True, exist_ok=True)
font = TTFont(source)
# Include the full BMP coverage; uncommon supplementary ideographs use the OS fallback.
coverage = {c for c in font.getBestCmap() if c <= 0xffff}
core = set(range(0x20, 0x100))
for path in (root / "src").rglob("*"):
    if path.suffix in (".tsx", ".ts", ".json"):
        core.update(ord(c) for c in path.read_text() if ord(c) >= 0x100)
core &= coverage
groups = [("core", sorted(core))]
remaining = coverage - core
for block in sorted({c // 256 for c in remaining}):
    groups.append((f"u{block:02x}", sorted(c for c in remaining if c // 256 == block)))
css = ["/* DDnezha Paper Hand: derived from LXGW WenKai; SIL OFL 1.1. See OFL.txt. */"]
manifest = []
for name, points in groups:
    f = TTFont(source)
    options = subset.Options()
    options.flavor = "woff2"
    options.recalc_timestamp = False
    options.name_IDs = ["*"]
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=points)
    worker.subset(f)
    for record in f["name"].names:
        names = {1:"DDnezha Paper Hand",2:"Regular",3:"DDnezhaPaperHand-1.0",4:"DDnezha Paper Hand",6:"DDnezhaPaperHand",16:"DDnezha Paper Hand",17:"Regular"}
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    f.flavor = "woff2"
    filename = name + ".woff2"
    f.save(out / filename)
    spans = []
    start = end = points[0]
    for c in points[1:]:
        if c == end + 1:
            end = c
        else:
            spans.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
            start = end = c
    spans.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
    ranges = ",".join(spans)
    css.append('@font-face{font-family:"DDnezha Paper Hand";font-style:normal;font-weight:400;font-display:swap;src:url("./'+filename+'") format("woff2");unicode-range:'+ranges+'}')
    manifest.append({"file":filename,"bytes":(out / filename).stat().st_size,"glyphs":len(points)})
(out / "font.css").write_text("\n".join(css)+"\n")
(out / "OFL.txt").write_bytes(license_file.read_bytes())
(out / "README.md").write_text("DDnezha Paper Hand is a renamed web subset of [LXGW WenKai](https://github.com/lxgw/LxgwWenKai), revision a5afe68ecaf6b62fbe3d317cd6d541f210b25ee4. Copyright LXGW and the Klee Project Authors. Licensed under SIL OFL 1.1; see OFL.txt. Generated with scripts/build-paper-font.py. Latin and interface characters load in one core subset; other BMP characters load by Unicode range. No external font service is used. Supplementary characters fall back to local fonts.\n")
print(json.dumps({"files":len(manifest),"total_bytes":sum(x["bytes"] for x in manifest),"core":manifest[0]},ensure_ascii=False))
