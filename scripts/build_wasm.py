#!/usr/bin/env python3
"""Build the Rust core and its classic-script browser bindings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI_VERSION = "0.2.90"
RUST_VERSION = "1.99.1"
PUBLIC = ROOT / "extension" / "wasm"
BRIDGE = "\nglobalThis.MSADeckTrackerWasm = MSADeckTrackerWasm;\nif (typeof module === 'object' && module.exports) module.exports = MSADeckTrackerWasm;\n"


def run(*args):
    return subprocess.run(args, cwd=ROOT, check=True, text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check committed assets against a fresh build")
    args = parser.parse_args()
    executable = shutil.which("wasm-bindgen")
    if not executable or run(executable, "--version").stdout.strip() != "wasm-bindgen " + CLI_VERSION:
        raise SystemExit(f"Install wasm-bindgen-cli {CLI_VERSION}: cargo install wasm-bindgen-cli --version {CLI_VERSION}")
    version = run("rustc", "--version").stdout.strip()
    if not version.startswith("rustc " + RUST_VERSION + " "):
        raise SystemExit(f"Expected the pinned Rust toolchain {RUST_VERSION}")
    environment = os.environ.copy()
    cargo_home = Path(environment.get("CARGO_HOME", Path.home() / ".cargo")).resolve()
    environment.pop("RUSTFLAGS", None)
    environment["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join([
        f"--remap-path-prefix={ROOT}=/src", f"--remap-path-prefix={cargo_home}=/cargo"])
    build = subprocess.run(["cargo", "build", "--locked", "--release", "--target", "wasm32-unknown-unknown", "-p", "msa-deck-tracker-core"], cwd=ROOT, env=environment)
    if build.returncode:
        raise SystemExit(build.returncode)
    with tempfile.TemporaryDirectory(prefix="msa-wasm-") as directory:
        output = Path(directory)
        run(executable, str(ROOT / "target/wasm32-unknown-unknown/release/msa_deck_tracker_core.wasm"),
            "--target", "no-modules", "--no-modules-global", "MSADeckTrackerWasm", "--no-typescript",
            "--remove-name-section", "--remove-producers-section", "--out-name", "deck_tracker", "--out-dir", str(output))
        glue = output / "deck_tracker.js"
        glue.write_text(glue.read_text(encoding="utf-8") + BRIDGE, encoding="utf-8")
        binary = output / "deck_tracker_bg.wasm"
        if binary.read_bytes()[:8] != b"\0asm\x01\0\0\0":
            raise SystemExit("Invalid Wasm binary")
        files = {path.name: path.read_bytes() for path in output.iterdir() if path.is_file()}
        if set(files) != {"deck_tracker.js", "deck_tracker_bg.wasm"}:
            raise SystemExit("Unexpected generated assets")
        info = {"schemaVersion": 1, "rustVersion": RUST_VERSION, "wasmBindgenVersion": CLI_VERSION,
                "binarySha256": hashlib.sha256(files["deck_tracker_bg.wasm"]).hexdigest()}
        files["build-info.json"] = (json.dumps(info, indent=2) + "\n").encode()
        for name, contents in files.items():
            destination = PUBLIC / name
            if args.check:
                if not destination.is_file() or destination.read_bytes() != contents:
                    raise SystemExit(f"Stale generated Wasm asset: extension/wasm/{name}")
            else:
                PUBLIC.mkdir(exist_ok=True)
                destination.write_bytes(contents)
        print(f"{'Verified' if args.check else 'Built'} Rust/Wasm core: {len(files['deck_tracker_bg.wasm'])} bytes")


if __name__ == "__main__":
    main()
