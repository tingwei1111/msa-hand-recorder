# Rust / WebAssembly deck tracker core

[繁體中文](Rust-Wasm.md) · **English** · [Project home](../README.en.md) · [User guide](user-guide.en.md)

Version **0.8.0** moves deck-tracker calculations into Rust compiled to WebAssembly while preserving the existing Chrome extension workflow and saved-data formats. Users can install the release ZIP without installing Rust, Node.js, or a separate Wasm runtime.

## Responsibilities

| Component | Responsibility |
| --- | --- |
| Rust deck tracker core | Validate and select the match's frozen deck, classify saved hand counts, aggregate public uses and Tokens, and calculate manually confirmed results for the same deck version. |
| JavaScript bridge | Load the packaged Wasm, pass the current input, restore the output, and preserve existing JavaScript string and host semantics. |
| Existing Chrome code | Read MSA's visible DOM, record hands and public logs, operate the panel, confirm the match's deck, access Chrome storage, back up data, and export reports. |

`extension/deck-tracker-core.js` retains the synchronous `project(input)` interface. In the browser, Wasm is loaded asynchronously once; subsequent projections use that initialized engine. Node tests execute the compiled Wasm artifact. The core does not read the DOM, Chrome storage, cookies, private backends, or the network, and it does not play cards for the user.

The migration aims to preserve behavior and make the calculations verifiable in Rust. It makes no unmeasured promise of higher speed, lower memory use, or more complete match capture.

## Preserving JavaScript semantics

Rust and JavaScript have different string, date, and sorting rules. `extension/deck-tracker-wire.js` selects only the fields that Rust actually reads, then uses a reversible transport representation to preserve UTF-16 strings. The host handles the existing date parsing, English collation, and Unicode uppercase semantics. Raw snapshot contents and imported attachments do not need to be copied into Wasm on every UI update. Deck validation, classification, statistics, and result assembly remain in Rust.

This representation exists only during the calculation. It does not mutate the caller's `input`, session, or Chrome storage, and it is not added to backups. Synthetic inputs compare the actual Wasm output with the previous JavaScript implementation, covering malformed fields, null values, boundary strings, dates, ordering, repeated events, and player / game isolation.

## Loading, errors, and recording

While Wasm loads, the deck section displays a waiting state and disables deck binding. Missing or corrupt program files produce an explicit error; unavailable results are not shown as zero cards in hand or zero public uses. There is no hidden fallback to the old JavaScript projection.

Hands, public Battle Logs, original records, and backups continue through the existing recording and storage flow. A loading or failed deck engine does not require clearing records or rewrite existing saves. If the user changes games or players, or the panel is destroyed, a delayed load notification must not apply the previous game's data.

If the core cannot load, keep the match available and back up existing data first. Check that the installation folder is complete, reload the existing extension, and refresh MSA. Do not uninstall first, because that can remove local data.

## Backup compatibility

This version does not change the schema of sessions, decks, matches, notes, or archived import originals. It does not rebuild or migrate the database. Existing full JSON backups, single-match JSON exports, and this tool's standalone HTML reports use the existing importer. Unknown original fields and conflict-handling rules are retained.

Hand counts keep three distinct meanings: a verifiable complete count, a recognized lower bound marked `≥`, and an unknown count marked `?`. Public use is a count of recorded occurrences, so legitimate repeated uses count again. Token generation is listed separately. These fields do not provide an exact remaining deck count. The Rust migration cannot recover historical hands that were never observed.

## Build and checks

Development requires Node.js 22 or later, Python 3, Rust **`1.99.1`**, the **`wasm32-unknown-unknown`** target, and **`wasm-bindgen` CLI `0.2.90`**. `rust-toolchain.toml` pins the Rust toolchain. Application builds and checks use the committed `Cargo.lock` with `--locked`; the Wasm dependency and CLI versions must match.

The workspace edition is `2024`, while `crates/deck-tracker-core` uses edition `2021`. The reviewed `wasm-bindgen 0.2.90` macro generates older `extern` blocks that do not satisfy edition 2024's `unsafe extern` requirement. The crate setting allows the pinned binding version to compile with the same Rust toolchain.

Prepare the tools from the repository root. These commands use POSIX-shell syntax and install the CLI in a Git-ignored project directory; the `PATH` change applies only to the current shell:

```sh
rustup toolchain install 1.99.1 --profile minimal --component rustfmt --component clippy --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.90 --root .wasm-tools
export PATH="$PWD/.wasm-tools/bin:$PATH"
```

The CLI is pinned to `0.2.90` and installed **without `--locked`**, allowing its own dependencies to resolve for the current Rust toolchain. An isolated installation and artifact comparison verified this method. Application dependencies remain fixed by the project's `Cargo.lock`.

Run the following from the repository root:

```sh
npm run build:wasm
python3 scripts/build_wasm.py --check
npm run test:rust
npm test
npm run package
```

`build:wasm` regenerates the three packaged artifacts:

- `extension/wasm/deck_tracker_bg.wasm`: the Rust core.
- `extension/wasm/deck_tracker.js`: classic-script binding and loading glue.
- `extension/wasm/build-info.json`: Rust / CLI versions and the Wasm SHA-256.

`build_wasm.py --check` runs the build and binding generation again, then compares each result with the committed artifacts. It exits with a nonzero status if an artifact is stale. The build remaps local project and Cargo source paths to `/src` and `/cargo` to avoid embedding developer paths in Wasm. Packaging separately validates the binary magic, metadata, and SHA-256 and rejects installation resources containing local user paths or additional Wasm binaries.

`test:rust` runs formatting checks, Clippy, native tests, and documentation checks. `npm test` uses the actual Wasm for projection compatibility and the existing JavaScript regression tests. `package` puts the required program files and documentation into the installation ZIP. Use the current command output and CI results for actual test counts and status.

For the local UI preview, run:

```sh
npm run preview
```

The preview uses synthetic matches only and does not read real records from the installed extension. Browser validation covers loading, failure, switching games, unknown hands, Tokens, manually entered results, and recording regressions. Synthetic previews are not evidence of a complete live-match end-to-end test.

## Chrome loading scope

Wasm and its glue are packaged with the extension; they are not loaded from a CDN or a remote program URL. The bridge obtains the exact local Wasm resource URL from the extension. Its web-accessible resource rule is restricted to `https://mobilesuitarena.com/*` and does not expose the user's match records.

The general permission remains `storage`. Official single-card lookup retains the `https://www.gundam-gcg.com/*` host permission. Wasm does not add website access permissions. Isolated-world content scripts run under Chrome's CSP. If Wasm is executed in extension pages, Chrome's permitted `wasm-unsafe-eval` policy is required; general `unsafe-eval` and remote scripts are not enabled.

Official references: [content scripts and CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [web-accessible resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources), [extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), and [wasm-bindgen deployment](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html).
