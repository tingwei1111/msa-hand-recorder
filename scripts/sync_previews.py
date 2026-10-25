#!/usr/bin/env python3
"""Keep synthetic browser previews on the real extension markup."""
import argparse
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true", help="Fail if a preview is stale")
args = parser.parse_args()

banner = ('\n    <div style="padding:7px 12px;text-align:center;background:#1a293b;'
          'color:#b9c9df;font:11px/1.5 system-ui,sans-serif">'
          '介面預覽 · 合成資料，未連線至 MSA；查卡只查詢官方公開卡片來源</div>')

for page in ("popup", "review", "library"):
    source = (ROOT / "extension" / f"{page}.html").read_text(encoding="utf-8")
    source = re.sub(r'^[ \t]*<script src="i18n(?:-data)?\.js" defer></script>\n?', "", source, flags=re.M)
    source = re.sub(r'(src|href)="([A-Za-z0-9_-]+\.(?:js|css))"',
                    lambda match: f'{match[1]}="../extension/{match[2]}"', source)
    anchor = f'    <script src="../extension/{page}.js" defer></script>'
    # Library uses two-space indentation; only exact script and body tags matter.
    script_match = re.search(rf'^[ \t]*<script src="\.\./extension/{page}\.js" defer></script>', source, re.M)
    body_match = re.search(r'<body\b[^>]*>', source)
    if not script_match or not body_match:
        raise SystemExit(f"Unexpected extension markup: {page}")
    dependencies = []
    for name in ("recorder-core.js", "battle-log-core.js", "annotations-core.js",
                 "diagnostics-core.js", "library-core.js", "library-store.js"):
        if f'src="../extension/{name}"' not in source:
            dependencies.append(f'    <script src="../extension/{name}" defer></script>')
    dependencies += ['    <script src="workspace-mock.js" defer></script>',
                     '    <script src="popup-mock.js" defer></script>',
                     '    <script src="../extension/i18n-data.js" defer></script>',
                     '    <script src="../extension/i18n.js" defer></script>']
    source = source[:script_match.start()] + '\n'.join(dependencies) + '\n' + source[script_match.start():]
    source = source.replace(body_match.group(), body_match.group() + banner, 1)
    target = ROOT / "demo" / f"{page}-preview.html"
    if args.check:
        if not target.exists() or target.read_text(encoding="utf-8") != source:
            raise SystemExit(f"Stale preview: {target.relative_to(ROOT)}")
    else:
        target.write_text(source, encoding="utf-8")
    print(f"{'Checked' if args.check else 'Updated'} {target.relative_to(ROOT)}")
