#!/usr/bin/env python3
"""Keep synthetic browser previews on the real extension markup."""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Fail if a preview is stale")
args = parser.parse_args()

banner = ('\n    <div style="padding:7px 12px;text-align:center;background:#e9efdf;'
          'color:#374b28;font:11px/1.5 system-ui,sans-serif">'
          '介面預覽 · 合成資料，未連線至 MSA</div>')

for page in ("popup", "review"):
    source = (ROOT / "extension" / f"{page}.html").read_text(encoding="utf-8")
    source = source.replace(f'href="{page}.css"', f'href="../extension/{page}.css"')
    for script in ("recorder-core.js", "battle-log-core.js", f"{page}.js"):
        source = source.replace(f'src="{script}"', f'src="../extension/{script}"')
    anchor = f'    <script src="../extension/{page}.js" defer></script>'
    if source.count(anchor) != 1 or source.count("  <body>") != 1:
        raise SystemExit(f"Unexpected extension markup: {page}")
    source = source.replace(anchor, '    <script src="popup-mock.js" defer></script>\n' + anchor)
    source = source.replace("  <body>", "  <body>" + banner)
    target = ROOT / "demo" / f"{page}-preview.html"
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != source:
            raise SystemExit(f"Stale preview: {target.relative_to(ROOT)}")
    else:
        target.write_text(source, encoding="utf-8")
    print(f"{'Checked' if args.check else 'Updated'} {target.relative_to(ROOT)}")
