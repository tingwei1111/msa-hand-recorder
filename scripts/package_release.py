#!/usr/bin/env python3
"""Build a reproducible install ZIP from an explicit public-file allowlist."""
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "extension/manifest.json").read_text(encoding="utf-8"))
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
version = manifest["version"]
if not re.fullmatch(r"\d+\.\d+\.\d+", version) or version != package["version"]:
    raise SystemExit("Manifest/package version mismatch or invalid version")
if manifest["permissions"] != ["storage"]:
    raise SystemExit("Review permission changes before packaging")
if manifest.get("host_permissions") != ["https://www.gundam-gcg.com/*"]:
    raise SystemExit("Only the reviewed public official-card host is allowed")
if manifest.get("optional_host_permissions") or manifest.get("optional_permissions"):
    raise SystemExit("Review optional permission changes before packaging")

extension_files = sorted((ROOT / "extension").rglob("*"))
for path in extension_files:
    if path.is_symlink():
        raise SystemExit(f"Refusing symlink: {path.relative_to(ROOT)}")
    if path.is_file() and path.suffix not in {".js", ".json", ".html", ".css"}:
        raise SystemExit(f"Unexpected extension asset: {path.relative_to(ROOT)}")
files = [path for path in extension_files if path.is_file()]
files += [ROOT / name for name in [
    "README.md", "CHANGELOG.md", "docs/使用教學.md", "docs/card-sources.md",
    "docs/images/popup-v0.4.jpg", "docs/images/review-v0.4.jpg", "docs/images/live-panel-v0.5.jpg",
    "docs/images/live-panel-v0.6.jpg", "docs/images/library-v0.6.jpg"
]]
for script in manifest["content_scripts"][0]["js"]:
    if not (ROOT / "extension" / script).is_file():
        raise SystemExit(f"Missing content script: {script}")
for path in files:
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"Missing/unsafe public file: {path.relative_to(ROOT)}")

out = ROOT / "dist"
out.mkdir(exist_ok=True)
stem = f"msa-hand-recorder-v{version}"
archive = out / f"{stem}.zip"
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
    for path in sorted(files):
        entry = zipfile.ZipInfo(f"{stem}/{path.relative_to(ROOT).as_posix()}", (2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        bundle.writestr(entry, path.read_bytes())
with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None or len(bundle.namelist()) != len(files):
        raise SystemExit("Archive verification failed")
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(out / "SHA256SUMS.txt").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
print(f"Built {archive.name}: {len(files)} public files, {archive.stat().st_size} bytes")
print(f"SHA256 {digest}")
