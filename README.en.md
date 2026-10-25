# MSA Hand Recorder

[繁體中文](README.md) · **English**


A local Chrome recorder for **Mobile Suit Arena (MSA)** and **GUNDAM CARD GAME (GCG)**. Save your visible hand by card number and quantity, track both players’ public Battle Log, use a live deck panel, and review by turn afterward—without taking a screenshot every turn.

This is an independent community tool, not an official Mobile Suit Arena or GUNDAM CARD GAME product.

**[Download v0.9.0](https://github.com/tingwei1111/msa-hand-recorder/releases/tag/v0.9.0)** · [Full English guide](docs/user-guide.en.md) · [繁體中文教學](docs/使用教學.md) · [Report an issue](https://github.com/tingwei1111/msa-hand-recorder/issues) · [Share the project](docs/sharing.md)

**[Start in five minutes](#start-in-five-minutes)** · [Full English guide](docs/user-guide.en.md) · [繁體中文教學](docs/使用教學.md) · [Contribute](CONTRIBUTING.md)

## Start in five minutes

1. Open the [v0.9.0 release](https://github.com/tingwei1111/msa-hand-recorder/releases/tag/v0.9.0), expand **Assets**, download `msa-hand-recorder-v0.9.0.zip`, and extract it to a permanent folder.
2. Visit `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted **`extension`** folder.
3. Refresh the MSA tab before starting your next match. Open the extension and click **記錄自檢** (Recording diagnostics). The lobby should show **大廳待命中** (Standing by in the lobby).
4. Start a practice match and compare your visible hand, card IDs, quantities, and saved snapshot count. To use deck rows, save a deck in **資料與牌組** (Data & decks), then confirm its binding for this match.
5. Keep the MSA tab open after the match, click **更新 Log** (Refresh Log), and open **對局回顧** (Match review). Download a full backup or HTML report before closing the match.

**Updating an existing installation:** back up first, replace files in the original installation folder, reload the original extension entry, and refresh MSA. Keep the same Chrome entry so its local records stay associated with it.

## Status and language support

| Item | Current status |
| --- | --- |
| Version | **v0.9.0 Prerelease.** Published installation files are under the release’s **Assets**. |
| Documentation | Traditional Chinese and English READMEs, full user guides, card-source notes, and developer notes. |
| Extension interface | **Currently in Traditional Chinese.** There is no interface language selector. The English guide includes the actual Chinese button labels and their English meanings. |
| Card preview | The current panel requests official Traditional Chinese card text. Images may be Japanese; text and image languages are reported separately. English documentation does not change the lookup language. |
| Intended environment | Desktop Google Chrome. Other browsers, phones, and tablets have not been validated. |
| Validation | v0.9.0 passed 375 JavaScript/Wasm tests and 30 synthetic browser recording checks. The Rust/Wasm core is unchanged from v0.8. **A complete real-player match has not yet been validated end to end.** |

Start with a practice match and compare card numbers, quantities, turns, and public logs manually. A successful diagnostic check or log start/end markers do not prove that every hand state was captured.

## What it helps you do

- **Check records while playing:** an in-page panel brings together your frozen deck list, saved hand, and both players’ public-use counts.
- **Review the process afterward:** inspect each successfully saved hand change, original public text, and turn source.
- **Keep your own data:** organize deck versions, notes, and manually confirmed results locally; download backups or offline reports.
- **See uncertainty:** complete counts, partial lower bounds, and unknown values are separate rather than treating missing data as zero.

![v0.9 dark library, storage usage and backups; synthetic data](docs/images/library-v0.9.png)

[Popup](docs/images/popup-v0.9.png) · [Match review](docs/images/review-v0.9.png) · [v0.9 changes](docs/v0.9.md)

*Screenshots use synthetic data. v0.9 gives the popup, review, library, and live panel a consistent dark interface. The panel appears inside the MSA tab; it is not a system-wide always-on-top window.*

## Features

| Feature | What it does | Boundary |
| --- | --- | --- |
| Automatic hand observations | Saves your visible card numbers, quantities, times, quality, resources, and turn sources. | Only observations actually captured and saved are available. Animations, sleep, closed tabs, or mid-match installation may leave gaps. |
| Both players’ public Battle Log | Records public plays, primary card numbers, original text, and their turns. | Does not reveal an opponent’s hidden hand or reconstruct unseen historical hands. |
| Full deck rows | Bind a saved 50-card main-deck version; compare deck list / hand / public uses for each card. | Public uses are cumulative occurrences, **not an exact remaining deck**. Generated Tokens are separate. |
| Live panel | Deck / Hand / Public events / All tabs; dragging, docking, width, font size, and collapse controls. | Displays saved observations. Collapsing does not pause recording. |
| Official single-card preview | Hover, focus, or click a card number to request official text and an image. | Shows source, text/image languages, and fetch time. Unknown information stays unknown. |
| Review and notes | Turn-by-turn review, compatible segments, search, snapshot bookmarks, and editable notes. | Source segments are retained. Hand differences do not establish whether a card was drawn, played, or discarded. |
| Deck versions and manual results | Save edits as new versions; matches retain a frozen list. Confirm your result and play order. | Results are not inferred; unconfirmed results are excluded from win-rate denominators, with sample sizes shown. |
| Backup and import | Full JSON backups; preview and restore this tool’s JSON or standalone HTML exports. | Conflicts preserve local data and imported originals. Multi-record writes are not atomic. |
| Exports | Standalone HTML, Markdown, single-match JSON, and hand / public-event / combined CSV files. | HTML can be read offline. Reports may contain your hand, names, and notes. |
| Diagnostics | Checks tab version, identity, pending observations, write errors, and public-log status. | Enabled switches, dismissed notices, and successful diagnostics do not guarantee complete capture. |

![Local library with backups, deck versions, and manual results; synthetic data](docs/images/library-v0.6.jpg)

## Install: desktop Chrome is enough

**Players do not need Rust, Node.js, Python, or a local server.** The ZIP includes the local Wasm core. Installation is currently manual; there is no Chrome Web Store listing or automatic update mechanism.

1. Open the [v0.9.0 release](https://github.com/tingwei1111/msa-hand-recorder/releases/tag/v0.9.0), expand **Assets**, and download `msa-hand-recorder-v0.9.0.zip`.
2. Extract it into a permanent folder. Find the **`extension` subfolder** containing `manifest.json`.
3. **Type** `chrome://extensions` into Chrome’s address bar and enable **Developer mode**.
4. Click **Load unpacked** and select **`extension`**.
5. Pin the extension named **MSA 手牌記錄器**. Reload MSA before starting a match, then click **記錄自檢** (Recording check).

```text
msa-hand-recorder-v0.9.0/
├── README.md
├── docs/
└── extension/              ← select this folder in Chrome
    ├── manifest.json
    └── wasm/
        └── deck_tracker_bg.wasm
```

Do not select the ZIP or copy just one JavaScript file. Keep the installed folder in place with all files. **Code → Download ZIP** downloads the current source branch and may contain post-release documentation changes; new users should use the versioned ZIP under Releases.

## Update without losing access to existing records

1. Open **資料與牌組** (Data & decks), download a full JSON backup, and retain the old extension files for rollback. If your old version has no full-backup button, use its available JSON export to save existing matches first.
2. Find the folder Chrome is **currently loading**: `chrome://extensions` → **MSA 手牌記錄器** → **Details** → scroll near the bottom to **Source** → **Loaded from:**. It appears above **Remove extension**; clicking the path opens its location in the system file manager.
3. Update the **complete contents of the same original `extension` folder**, including `wasm`.
4. Click **Reload** on the existing extension. Reload MSA before the next match, check the version, and run diagnostics again.

Do not uninstall first or load another folder as a separate installation: a different extension ID may prevent direct access to existing local records. See the [full guide](docs/user-guide.en.md). A GitHub documentation update or release **does not update an installed extension automatically**. Bundled documentation reflects its release date; the repository has the latest bilingual guides.

## Your first match

1. **Prepare:** open **資料與牌組** (Data & decks) and save a 50-card main-deck version. Keep resources and Tokens separate. Format validation does not establish card existence, type, current restrictions, or tournament legality.
2. **Start observing:** enable automatic recording, check your player/hand position, leave automatic Battle Log collection enabled, and run **記錄自檢** (Recording check).
3. **After a hand is saved:** open **牌組** (Deck), select a saved version, and click **確認綁定本場牌組** (Confirm deck for this match). Compare your actual hand with saved counts and observation time.
4. **While playing:** look up a card or use **標記此刻** (Bookmark this moment). Pending observations and write errors are not successful saves.
5. **Afterward:** keep the match tab open, click **更新 Log** (Refresh log), inspect turns/start/end/gaps in **對局回顧** (Match review), then confirm the result and download a backup or report.

The [full English guide](docs/user-guide.en.md) includes a Chinese-to-English button glossary and troubleshooting steps.

## Read counts and statistics correctly

| Display | Meaning |
| --- | --- |
| Deck-list count `4` | Four copies in the frozen version bound to this match. |
| Hand `2` | Two copies in the latest saved complete observation whose total can be checked. |
| Hand `≥2` | At least two recognized copies in a partial observation; the rest remains unknown. |
| Hand `?` | No verifiable hand count for this card. It is not zero. |
| Public uses `3` | Three recorded recognizable uses; returning and replaying a card adds another occurrence. |

Do not calculate an exact remaining deck as “deck list − hand − public uses.” Shields, returns, shuffles, and source zones may be unknown. Actions without a confirmed player remain unverified.

Manual statistics count each game/confirmed player once, using the match’s frozen deck version. Your concession counts as a loss. Overall win rate includes confirmed draws in the denominator; decisive win rate excludes draws. Both exclude unconfirmed results.

## Data, permissions, and privacy

- **Match data stays local:** records use extension storage in the current Chrome profile. There is no automatic cloud synchronization, match upload, or hosted analysis service.
- **Visible information only:** no Cookie reading, WebSocket interception, MSA private API requests, opponent hidden-hand reading, or automated game actions.
- **Card previews use the network:** an individual card number/language is requested from public `www.gundam-gcg.com` pages without match records, hand lists, player names, credentials, or referrers. The site still receives ordinary network connection information; this is not an anonymizing proxy.
- **Inspectable permissions:** `storage` saves local data, the MSA content-script scope enables page observation, and the official-card host permission enables lookups. Wasm is packaged locally rather than loaded from a CDN.
- **Review before sharing:** backups/reports may include hands, names, notes, and manual results. Local storage and offline export do not anonymize them automatically.

See [card sources and network behavior](docs/card-sources.en.md) for cache and language details.

## Frequently asked questions

| Problem | First step |
| --- | --- |
| Chrome cannot find `manifest.json` | Extract the full archive and select the inner `extension` folder. |
| The old version still appears | Check **Loaded from:**, reload the existing extension, then reload MSA. |
| How do I switch the interface to English? | An English interface is not implemented yet. Use the English guide’s Chinese button glossary. |
| Hand records exist but the public log is empty | Keep the match open. When safe, click **更新 Log** (Refresh log) or open the game’s Battle Log, then check saved events. |
| The Wasm core is loading or unavailable | Check that the complete `extension/wasm` folder was installed; reload the extension and MSA. Preserve data instead of uninstalling. Hand/log recording does not depend on successful deck-engine initialization. |
| Some history seems missing after a reload | Combine compatible recording segments in review; unseen moments cannot be recovered. |
| Import completed only partly | Keep the original file, inspect saved/unfinished records and space, then preview again. |
| Can I use another browser or a phone? | These environments have not been validated. Use desktop Chrome for now. |

More cases are covered in the [full guide](docs/user-guide.en.md).

## Feedback, translations, and sharing

Issues in **English or Traditional Chinese** are welcome at [GitHub Issues](https://github.com/tingwei1111/msa-hand-recorder/issues). Include extension/Chrome versions, operating system, reproduction steps, expected/actual behavior, and whether a synthetic preview reproduces it. Attach only necessary reviewed screenshots or excerpts; do not publish a full real-match backup by default.

Share the [English README](https://github.com/tingwei1111/msa-hand-recorder/blob/main/README.en.md) or use the [bilingual announcement drafts](docs/sharing.md). Interface translation and usability suggestions are welcome; an English interface remains unimplemented.

The narrow deck rows and hover-preview experience were inspired by [WaterStone](https://github.com/scriptLin-bjtu/WaterStone). This project implements its own GCG data projection and Chrome interface. Public screenshots and fixtures use synthetic data; official card art and full card-text datasets are not bundled.

## Development and validation

Synthetic previews require Node.js 22+ and Python 3, with no external npm dependencies. Rebuilding the core additionally requires the pinned Rust/Wasm toolchain; see the [English developer notes](docs/Rust-Wasm.en.md).

```sh
npm test
npm run preview
```

Open `http://127.0.0.1:8768/demo/index.html` for live-panel, popup, review, and library previews. They do not read real records from your installed extension.

Rust handles deck validation, frozen-version selection, hand classification, public-card/Token aggregation, and same-version statistics. JavaScript retains capture, storage, UI, and host-semantics compatibility. v0.9.0 preserves backup formats without a database migration and does not claim a speed improvement.

[Historical changelog (Traditional Chinese)](CHANGELOG.md) · [Releases / bilingual v0.9.0 notes](https://github.com/tingwei1111/msa-hand-recorder/releases/tag/v0.9.0)

## Open source and contributions

This project is available under the [MIT License](LICENSE). You may use, study, modify, fork, and contribute changes; preserve the copyright and license notice when distributing it. GUNDAM, Mobile Suit Arena, official card text/images, and third-party packages retain their respective rights and license terms; see [third-party notices](THIRD_PARTY_NOTICES.md).

- Questions and ideas: open a [GitHub Issue](https://github.com/tingwei1111/msa-hand-recorder/issues) in English or Traditional Chinese.
- Code changes: read [CONTRIBUTING.md](CONTRIBUTING.md), work in your own branch, and submit a pull request.
- Local development previews use synthetic data and do not read real records from your installed Chrome extension.
