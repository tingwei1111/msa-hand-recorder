# MSA Hand Recorder — User Guide

**English** · [繁體中文](使用教學.md) · [Project home](../README.en.md) · [Download releases](https://github.com/tingwei1111/msa-hand-recorder/releases)

This guide covers the **v0.11.0 prerelease** for desktop Google Chrome. MSA Hand Recorder saves observations of your own visible hand and both players' public Battle Log in Mobile Suit Arena. It provides an in-game panel, a deck list with observed counts, match review, bookmarks, deck versions, manually confirmed results, and local backup/restore.

**The interface supports English, Traditional Chinese and Simplified Chinese.** Select **English** under **Interface language** at the top of the popup, review or workspace. In the live panel, use **Display settings**. Your choice is saved and synchronizes across open extension pages. Older screenshots below use Traditional Chinese and synthetic demonstration data; the bilingual control reference remains useful for matching them.

**A complete live match has not yet been validated end to end.** Start with a test match and compare the saved card IDs, counts, turns, and public events with the game. A successful save, a fully recognized snapshot, and a public log containing the start and end are different kinds of evidence; none proves that every hand change was captured.

## Language settings

The initial language follows your browser; an explicit saved choice takes priority. Switching language keeps the active recording, selected match, search filters and unsaved deck/result/note drafts. The preference belongs to this Chrome profile and is not overwritten by backup imports. Chrome’s extension-manager name follows Chrome’s language independently.

Player names, notes, card names, official card text, raw Battle Log, and JSON/CSV field names retain their original content. HTML and Markdown report headings follow the selected interface language at export time; original evidence stays unchanged. The English interface requests official English card text; both Chinese interfaces request official Traditional Chinese card text. Text and image languages may differ.

See [v0.11 changes](v0.11.md#english).

## Common controls

| Chinese control | Where and how to use it |
| --- | --- |
| 本機儲存空間 / Local storage | At the bottom of the popup and the top of Data & decks. It shows actual used MiB and reminders at 80%/95%. Back up important records when prompted; old records are not deleted automatically. |
| 下載未存資料救援 JSON / Download unsaved-data rescue JSON | Expand Having trouble saving? at the bottom of the popup and download rescue JSON. It combines available page buffers with acknowledged local recovery records, including after a page reload. Some originals may already be saved; rescue records are not automatically replayed or imported. |
| 直接匯出已存資料 / Export saved data directly | In Match review, check this option, choose a format, and click Export. It skips waiting for an MSA refresh and explicitly marks that fact in the export. |
| 保存對局確認 / Save match confirmation | Unsaved match drafts survive deck saves and library list updates. Press this button to store a draft formally; save before closing the page. |
| 大廳待命中 / Lobby · ready | This is a normal lobby state. Diagnostics independently check page versions and the deck engine; verify hand/Log observations after entering a match. |

See the [v0.11 change notes](v0.11.md#english) for behavior, screenshots and validation limits.

## v0.11: tabs and persistent rescue

Data & decks now has **Matches, Deck, Results and Backups** tabs. Tab changes retain unsaved results, deck drafts and import previews. Arrow keys and Home/End navigate the tab bar. Save before closing the page.

Each new observation attempts to enter an independent local recovery journal first. Protection is acknowledged only after its transaction completes. A successful normal session write removes the matching journal entry; failures, lost acknowledgements and invalid records may leave originals behind. These are not saved hand snapshots or statistical results and are never replayed automatically. The last observation before a reload may not have reached disk.

Standard full backups exclude the independent recovery journal. Before updating or removing the extension, download and inspect rescue JSON separately if pending/rescue originals remain.

The journal is bounded at **16 MiB / 512 entries, with a 2 MiB per-entry limit**, with no automatic eviction. Downloading creates a copy and **does not clear the journal**; this version has no journal cleanup interface. When full, new originals cannot gain durable protection, while normal session saves are still attempted. Keep the original tab open and check pending status. The storage meter covers normal Chrome storage, excluding the independent IndexedDB journal.

Rescue JSON combines journal originals with the currently selected MSA tab’s available memory buffers. Switch to each other open tab separately to rescue its not-yet-persisted buffers. Originals may duplicate normal records; inspect them manually. Rescue JSON is not a standard importable backup.

## Contents

1. [First match checklist](#1-first-match-checklist)
2. [Install or update](#2-install-or-update)
3. [Configure and check recording](#3-configure-and-check-recording)
4. [Verify that data is being saved](#4-verify-that-data-is-being-saved)
5. [Use the in-game panel](#5-use-the-in-game-panel)
6. [Bookmarks and review notes](#6-bookmarks-and-review-notes)
7. [Review and export a match](#7-review-and-export-a-match)
8. [Back up and restore your library](#8-back-up-and-restore-your-library)
9. [Deck versions and personal results](#9-deck-versions-and-personal-results)
10. [Understand labels and coverage](#10-understand-labels-and-coverage)
11. [Privacy, permissions, and sharing](#11-privacy-permissions-and-sharing)
12. [Troubleshooting](#12-troubleshooting)
13. [Chinese-to-English control reference](#13-chinese-to-english-control-reference)
14. [Report a problem or suggest an improvement](#14-report-a-problem-or-suggest-an-improvement)

## 1. First match checklist

1. Install the release ZIP, then refresh the MSA tab **before** starting a match.
2. Open the extension, enable recording, and run **記錄自檢** (Recorder check). Confirm the loaded versions and your player identity.
3. Open **資料與牌組** (Data & decks) and save your 50-card main-deck version if you want the deck view.
4. After your first hand has been saved, open **對戰小窗** (Live panel), select the deck you are actually using, and confirm its binding to this match.
5. Compare the saved hand with the game after the opening hand, a draw, and a play. Check timestamps, counts, and public events.
6. After the match, keep the MSA tab open, use **更新 Log** (Refresh Log), and open **對局回顧** (Match review). Inspect coverage and any gaps before exporting.
7. Confirm the result manually and download a full library backup. For a readable single-match report, export standalone HTML separately.

You do not need to take screenshots for routine recording. The recorder observes the visible page while it is running. It cannot recover hands from before recording began, reveal an opponent's hidden hand, or reconstruct every missed animation.

## 2. Install or update

### First installation

1. Open [GitHub Releases](https://github.com/tingwei1111/msa-hand-recorder/releases). Expand the release's **Assets** and download its install ZIP, for example `msa-hand-recorder-v0.11.0.zip`.
2. Extract the ZIP to a permanent folder. Keep this folder after installation; Chrome reads the unpacked extension from it.
3. Enter `chrome://extensions` directly in Chrome's address bar and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted **`extension` subfolder**, which contains `manifest.json`.
5. Pin **MSA 手牌記錄器** in Chrome's extensions menu, then refresh MSA before starting a match.

```text
msa-hand-recorder-v0.11.0/
├── README.md
├── docs/
└── extension/          ← select this folder in Chrome
    ├── manifest.json
    ├── …
    └── wasm/
        ├── deck_tracker.js
        ├── deck_tracker_bg.wasm
        └── build-info.json
```

Normal use does **not** require Node.js, Rust, `npm install`, a local server, or a separate WebAssembly runtime. The install package includes the compiled Wasm core. GitHub's automatically generated source ZIP is a source snapshot; the versioned install ZIP under Assets is the clearest choice for a specific release.

Desktop Chrome is the intended browser. Other Chromium browsers, Firefox, Safari, and mobile browsers are not verified installation targets. The available browser checks and screenshots do not establish full live-match compatibility across operating systems.

### Update without losing your records

A GitHub release does not automatically update a manually loaded extension.

1. Open **資料與牌組** (Data & decks), select **下載完整備份** (Download full backup), and confirm the downloaded file exists. If an older version has no full-backup button, first use its available raw JSON export for each recording segment you want to retain.
2. Find the folder used by the **existing** Chrome installation using the instructions below.
3. Keep a copy of the existing extension files for rollback, then replace the files **inside that same `extension` folder** with the new release's extension files, including `wasm/`.
4. In `chrome://extensions`, use the existing recorder's **Reload** button. Do not remove it first or add a second installation from another folder.
5. Before the next match, refresh MSA, run **記錄自檢**, and confirm that the extension and page report the new version.

Do this between matches. Removing the extension or clearing its browser data can delete local records. Loading a different folder can create a different extension identity and make the original records unavailable in that installation. Use a full backup when moving to another computer or Chrome profile.

### Find the original installation folder

1. Open `chrome://extensions` and find **MSA 手牌記錄器**.
2. Click **Details**.
3. Scroll near the very bottom, to **Source**, just above **Remove extension**.
4. Find **Loaded from:**. In a Traditional Chinese Chrome interface, the label is **載入來源：**.
5. The following link is the installation path. Clicking it opens the folder in the system's file manager, such as Finder on macOS. You can also use the page's Find command (`⌘F` on macOS or `Ctrl+F` on Windows/Linux) to search for the label.

If this line is absent, keep the existing installation and ask for help with a screenshot of the lower part of its Details page. Do not guess a replacement folder or remove the extension to find the path.

### Permissions and the Wasm core

The extension stores records locally with Chrome's `storage` permission. Its MSA content scripts run on `https://mobilesuitarena.com/*`. Official single-card previews use the existing `https://www.gundam-gcg.com/*` host permission. The packaged Wasm file is exposed only to MSA through an exact resource rule; this does not expose your saved records.

If updating from an older release produces a Chrome permission prompt, check that it matches the documented official-card domain. The recorder does not need access to MSA's private backend, cookies, or unrelated websites.

In v0.11.0 the deck projection is calculated by Rust compiled to WebAssembly. The visible-page capture, recording, Chrome storage, panel, and backup format retain their existing roles. This migration does not promise a speed improvement. See the [Rust/Wasm technical reference](Rust-Wasm.en.md) for build details.

## 3. Configure and check recording

Open the recorder's toolbar popup. Confirm that recording is enabled. An enabled switch indicates configuration; it does **not** confirm a successful save.

Expand **記錄設定** (Recording settings):

- **我的玩家名稱** (My player name): optionally enter your MSA name to help identify your own hand.
- **我的手牌位置** (My hand position): begin with **自動：下方玩家手牌** (Automatic: bottom player's hand). Choose a manual position only when you have confirmed that it is your own hand. Do not designate another player's spectator view as yours.
- **自動收錄 Battle Log** (Automatically collect Battle Log): leave it enabled if you want automatic attempts at the start and end. Apply changes with **儲存設定** (Save settings).

During safe idle moments, automatic collection may briefly open the game's log, read it, and restore its previous state. An already open log can be read directly. Typing, game dialogs, attacks, target selection, or other protected interactions can delay or prevent a refresh.

Disabling automatic log collection stops its start/end display attempts. Explicit **更新 Log** actions and exports may still attempt to read the log when safe.

### Run Recorder check

Switch to the MSA match tab you want to check, open the recorder, click **記錄自檢**, and expand **目前分頁自檢結果** (Current tab check results). Check:

1. The extension and the MSA tab have loaded the same version.
2. Settings are loaded, recording is enabled, and the player identity is correct.
3. Saved snapshots, pending writes, recognition quality, and the most recent storage error.
4. Saved public events and whether the public log's start/end have been observed.

This check does not count your physical hand for you and cannot prove that no animation was missed. If versions differ, refresh MSA at a suitable time and run the check again.

For the deck view, save a deck version before playing. Once a matching hand has been successfully saved in the current recording segment, the panel can ask you to confirm which version you are using.

## 4. Verify that data is being saved

For your first test match, compare the game with the recorder after the initial deal, a draw, and a play:

1. Confirm that the match and player are yours.
2. Count the visible cards and compare card IDs, recognized counts, expected total, and unknown count with the saved observation.
3. Confirm that the saved snapshot's content, observation time, or count changes. Do not rely on the recording switch alone.
4. Check that public-event counts and turn sources are plausible.

If there are no public events, keep the match open and use **更新 Log**, or open the game's Battle Log yourself. Move focus away from chat or other input fields before using the game's `L` shortcut.

Reading the log early can calibrate later turns. If the first log read happens after the match, earlier uncalibrated hand observations remain labeled as observation turns; the recorder does not pretend to backfill exact turn numbers.

You may close the extension popup while playing. Recording can continue while the MSA page is operating. Background throttling, sleep, closing the page, animations, or unavailable hand containers can still create gaps. Refreshing MSA, changing player settings, or pausing and resuming can create a new recording segment; the original segments remain stored.

## 5. Use the in-game panel

Click **對戰小窗** in the corner of an MSA match, or **顯示對戰側邊小窗 ↗** (Show in-game panel) in the extension popup.

![Deck tracker panel with synthetic data and the Traditional Chinese interface](images/deck-tracker-v0.7.jpg)

*This existing v0.7 screenshot uses synthetic demonstration data. The v0.8 deck core retains these controls; the screenshot is not a live-match validation record.*

The panel belongs to the MSA page. It is not an operating-system overlay that stays above other applications, and it does not play cards or select targets for you.

### Tabs, movement, and display preferences

| Tab/control | What it shows or changes |
| --- | --- |
| **牌組** — Deck | Frozen main-deck list, saved hand counts, public-use counts, and manually confirmed statistics for that version. Public cards and generated Tokens appear in separate groups. |
| **手牌** — Hand | Latest saved own-hand observation, resources, and eligible adjacent-snapshot differences. |
| **公開事件** — Public events | Up to 20 recent public plays and Token-generation events, newest first. |
| **全部** — All | Deck, hand, and public-event sections together. |
| **顯示設定** — Display settings | Width, text size, and free/left-docked/right-docked position. Width is constrained on narrow screens. |

Drag the title to move the panel. Alternatively, focus its title with `Tab`: arrow keys move it by 10 pixels, and `Home` resets the position. Dragging or keyboard movement switches it to a free position. **收合** (Collapse), or `Esc` while inside the panel, hides the contents while leaving the corner launcher.

Tab, size, position, and expanded-state preferences are saved separately from match records. Collapsing does not pause recording. Game dialogs temporarily hide the panel so that it does not obstruct the dialog; it does not close the game's dialog for you.

### Bind your deck to the current match

1. Open **資料與牌組** or **管理牌組** (Manage decks) and save a deck version with 50 main-deck cards. Put resources and Tokens in their separate fields.
2. Return to the match. Confirm your player name and that a hand has actually been saved in the current segment.
3. In **牌組**, expand **選擇本場牌組** (Choose this match's deck) and choose **選擇已保存的牌組版本** (Select a saved deck version).
4. Check the displayed player, then click **確認綁定本場牌組** (Confirm deck for this match). This confirms the deck identity; it does not confirm a result.
5. Check the deck name, version, main-deck total of 50, and card rows. The match stores a frozen copy so that saving a later revision does not change this match's deck.

After binding, **重新選擇本場牌組** (Choose another deck for this match) allows another selection when permitted. Confirming the same version again does not create a redundant change. If the match result has already been confirmed, review and change the frozen deck through **資料與牌組**. After changing match, player, or segment, verify the context and make a fresh selection rather than using an old draft.

### Read deck, hand, and public-use counts

| Column/value | Meaning |
| --- | --- |
| **牌表** — Deck list | Copies of this card in the frozen main-deck version, totaling 50 cards across the list. This is not reduced as cards are used. |
| **手牌 `n`** — Hand `n` | A complete latest saved observation whose counts can be checked. A card not observed in that complete hand may show `0`; that does not mean it is exhausted from the deck. |
| **手牌 `≥n`** — Hand at least `n` | A lower bound from partial recognition. Unrecognized cards remain unknown. |
| **手牌 `?`** — Hand unknown | No reliable current saved count for that card. Treating it as zero would be incorrect. |
| **公開使用** — Public uses | Recorded occurrences with an identifiable primary card ID. Reusing the same card increases the count again. |

Rows combine matching card IDs from the deck list. Observed own-hand or public-use cards outside the bound list are flagged separately; they do not change the 50-card list. A missing card name remains a card ID rather than being replaced with a guess.

Expand **本人公開使用** (Your public uses), **對手公開使用** (Opponent's public uses), and **待核對的公開使用** (Public uses to check) to inspect grouped records. Only events with a confirmed player source are assigned to the opponent. Unknown actor/card information stays unresolved. Generated Tokens appear under **Token 生成（不計手牌出牌）** (Token generation, not hand plays).

These groups aggregate accepted public events, while the Public events tab keeps its recent 20-item view and access to original text. Repeated legitimate events are retained.

**Public-use occurrences are not unique physical copies or confirmed hand consumption.** A card returned to hand and played again can have more uses than its deck-list count. Because deployment sources, shields, returns, shuffling, and other zones are not completely tracked, subtracting hand and public-use counts from the list does not produce an exact remaining deck count.

Expand **數量與來源說明** (Counts and sources) to inspect hand provenance, public-log coverage, and unresolved items. The projection does not invent missing draws, plays, discards, or zone movements.

### Version statistics

The panel shows your manually confirmed results for the **same bound deck version**, including sample size and overall win rate. Multiple segments of one game count once. Unconfirmed results are excluded from the denominator; an empty sample is unknown. Your own concession counts as a loss, and draws are included in the overall denominator.

Binding a deck, seeing an end screen, or observing the log's end does not automatically determine a winner. Different deck versions remain separate; the library offers further filtering by version and play order.

### Saved hand, differences, and resources

The hand view uses the latest successfully saved snapshot from the **current segment and matching confirmed player**. Pending observations are not displayed as already saved. A new segment without a snapshot does not borrow a previous segment's hand.

If the current view cannot be recognized, an earlier complete saved snapshot may remain visible with a notice. Check its observation time before treating it as your current hand. Unconfirmed identity does not reveal a hand as yours.

Differences are computed only between adjacent, complete snapshots from the same segment. `+1` and `−1` describe changes in a card ID's observed count; they do not establish a draw, play, discard, or return. Partial/unknown snapshots and segment boundaries do not produce inferred differences.

Resources retain level, normally available resources, available EX resources, and the total. Missing fields remain unknown rather than becoming zero. Generated Tokens are separate from hand plays; other deployments with an unknown source are not automatically treated as hand consumption.

### Official card previews

Hover over a card ID, focus it with the keyboard, or click it to open a preview. Check the card ID, name, text language, image language, retrieval time, and **官方來源** (Official source) link.

Lookup follows the interface language: English requests official English text, while either Chinese interface requests official Traditional Chinese text. Official text is not machine-converted into Simplified Chinese. Text and image languages are shown separately; an image may use a different language.

A missing card, network error, or failed image remains unresolved; the tool does not substitute another card. Previews do not validate deck legality and do not replace official rules, errata, FAQs, or rulings. Alternate-art filenames are normalized to the base card ID, so the preview may not show the exact artwork in your hand.

Requests fetch one card on demand from `www.gundam-gcg.com`, without credentials or a referrer and without attaching match records. Card data uses a short-lived memory cache rather than match storage. The recorder does not batch-download the whole deck or ship an official card-image/text archive. See [card sources](card-sources.en.md).

### Refresh Log and recording alerts

**更新 Log** waits about 0.9 seconds after the click, then checks whether reading is safe. Inputs, game dialogs, attacks, and target selection remain protected. A failed refresh shows a reason and retains existing saved records.

Alerts can indicate write failures, visible changes without a confirmed save, a seen hand without a current-segment snapshot, or missing start/end evidence after a match. **知道了** (Acknowledged) or **收起提醒** (Dismiss reminder) dismisses a notice; it does not repair a save or fill a gap.

### Wasm loading or errors in v0.8

While the deck core loads, deck selection is disabled and the Deck tab shows a loading message. If the core is missing, corrupt, or fails to initialize, the Deck tab reports an error. Existing hand/public-log recording and backup remain available; an engine failure is not converted into a zero-card hand or zero public uses. There is no hidden fallback to the old JavaScript projection.

Keep your match and saved records. Download a backup, check that the installation contains the complete `wasm/` folder, reload the **existing** Chrome extension, and refresh MSA at an appropriate time. Do not start by uninstalling or clearing its data. If the error persists, include the displayed message and version information in a report.

## 6. Bookmarks and review notes

During a match, click **標記此刻** (Bookmark now). Check the source snapshot shown in the editor, add a short note or tags, then click **儲存書籤** (Save bookmark). The bookmark stays anchored to the snapshot selected when you opened the editor; a later draw does not silently move the anchor.

Bookmarks require a saved hand with matching identity and provenance. After a match/player change, reopen the editor so that notes cannot be saved against an old context.

In Match review, use **新增筆記** (Add note) on a specific snapshot. You can return from the note list to its original snapshot, edit text/tags, or restore a deleted note. Editing does not change its match, source segment, snapshot, or observation anchor. Deleting a note does not delete its hand snapshot.

Notes are stored separately and are included in a full backup. Single-match JSON/HTML export metadata can also carry the related notes, manual confirmations, and deck versions without changing the original session JSON into note content. Do not assume Markdown and CSV contain the same workspace records; use the full library backup for comprehensive backup.

## 7. Review and export a match

1. Keep the MSA match tab open and check post-match notices, pending writes, and the log.
2. Click **對局回顧** in the panel, or select a session in the popup and click **開啟對局回顧** (Open match review).
3. Leave **合併同對局的相容記錄段落** (Combine compatible segments of the same match) enabled when appropriate. It combines compatible public logs and hands from the same game and confirmed player without overwriting the originals.
4. Inspect log start/end evidence, uncalibrated turns, public-log gaps, and hand-capture issues.
5. Select an export format. For a standalone report, choose **獨立 HTML 報告** (Standalone HTML report), then **匯出 HTML 報告** (Export HTML report).
6. Review the pre-export refresh result, confirm the download exists, and only then close the match tab.

The exporter attempts to refresh the corresponding match, wait for saves, and reread local data. If the tab is closed, a refresh times out, or reading is unsafe, existing saved data can still be exported with the reason preserved. An unavailable safe review source does not redirect the panel to another match.

Use search, the turn index, previous/next turn, and hand/play/public-event shortcuts to navigate. Search filters the on-screen view; exports retain all saved data in the selected scope rather than only search results.

| Goal | Choose |
| --- | --- |
| Read or share one match's recorded content | Standalone HTML after combining compatible segments as appropriate. It can be read offline. |
| Text-based analysis | Turn-report Markdown. Check the coverage notes before drawing conclusions. |
| Preserve raw fields and provenance for further processing | Raw-data JSON, including unknown fields. |
| Spreadsheet work | Hand CSV, public-event CSV, or combined hand/event CSV. Capture time is not event time. |
| Back up all matches, notes, decks, manual results, and import originals | **資料與牌組 → 下載完整備份**. |

Standalone HTML contains the original `msa-record-data` JSON and `msa-export-info` metadata. It does not require external fonts or official card images for reading. When imported through the library, only its data blocks are parsed; its scripts are not executed.

## 8. Back up and restore your library

Open **資料與牌組** from the popup, **資料與牌組 · 備份與還原** (Data & decks · Backup and restore) from the panel, or the management entry in Match review.

![Local library with backup, deck versions, and results using synthetic data](images/library-v0.6.jpg)

*This existing screenshot shows the Traditional Chinese interface with synthetic records.*

### Download a full backup

Click **下載完整備份**. It includes local sessions, notes, deck versions, manual results, and archived import originals, retaining unknown fields. Recording preferences, tab state, and panel position are not part of the restore allowlist.

A message that the download has started does not establish that the file reached disk. Check Chrome's Downloads and retain the file before switching computer/profile, clearing extension data, or removing the extension. There is no automatic cloud backup or synchronization.

### Preview, then confirm an import

1. Select this tool's full-backup JSON, single-match JSON, or standalone HTML. The per-file limit is **20 MiB**.
2. Inspect source, record/segment counts, additions, conflicts, identical records to skip, and estimated write size. Selecting a file only previews it; nothing has been written yet.
3. Review the per-record actions and click **確認匯入這些資料** (Confirm import). If local data changed since preview, review a fresh preview.
4. Check verified saves, skips, and unfinished items. If everything is already identical, another import is unnecessary.

Conflicts preserve local content. Conflicting sessions receive separate IDs while retaining original game/player identity. Conflicting deck versions are stored separately with corresponding imported references linked. Other conflicting notes/confirmations are archived as originals. Use **匯入原件與衝突副本** (Import originals and conflict copies) and **下載原始資料** (Download original data) to retrieve them. An archived original is not an automatic replacement for the active local note or result.

Reimporting the same file skips identical records or already stored identical import copies. Different recording segments and legitimate repeated public events are retained; matching event text alone is not a reason to delete them.

### Storage limits and partial imports

The estimated write size includes archived originals and can exceed the original match data size. It is not an estimate of free storage.

Imports verify writes record by record; they are **not an atomic transaction**. A storage limit or interruption can leave a partial import. Keep the original file, inspect verified and unfinished records, retrieve archived originals if needed, address the storage/error, then preview again. Some newly visible records do not prove that all records were restored. Uninstalling first risks losing records you could otherwise preserve.

v0.11 retains the existing standard JSON/HTML backup formats. Its transient Wasm transport is not stored in backups, and old records do not need a database conversion. The separate rescue JSON is not a standard importable backup. Older records with absent fields retain their uncertainty; a missing EX count does not become zero.

## 9. Deck versions and personal results

### Save immutable deck versions

In **保存每一次改牌** (Save each deck revision), enter a deck name and main list. Put resources and Tokens in their own fields. Supported line formats include:

```text
4xGD01-001
4 GD01-002
GD01-003x4
```

These lines illustrate syntax; they are **not** a complete recommended deck. The parser combines duplicate IDs and checks for exactly 50 main-deck cards and no more than four copies of one main-deck ID. Resources and Tokens do not count toward the main 50.

These checks do not validate card existence, card type, colors, current restrictions, or tournament legality. Resource/Token zones are supplied by the user; the recorder does not infer an official card type from an ID.

Click **保存為牌組版本** (Save as deck version). Editing an existing version and saving produces a new version; identical existing content retains that version. It does not rewrite decks already frozen into matches. Use **清空並建立新牌組** (Clear and create a new deck) for another deck.

Saved hand fragments do not automatically become a full list. After saving a version, bind it in the match panel and complete result/play-order confirmation later.

### Confirm a match manually

In **替對局補上你的確認** (Confirm match details):

1. Select the local recording segment and verify the match source and your player name.
2. Check **我確認這是本人在這場對局使用的名稱。** (I confirm this is my player name in this match).
3. Choose the deck version used. Saving freezes the full version for that match.
4. Select whether you played first/second and your result, confirm the result checkbox if known, then click **保存對局確認** (Save match confirmation). Keep uncertain fields as **尚未確認** (Unconfirmed).

If the opponent conceded, select **勝（含對手投降）** (Win, including opponent concession). If you conceded, choose **本人投降（計負）** (Own concession, counts as loss). A log end marker does not determine a winner automatically.

A game plus confirmed player counts as one match, even with multiple segments. Updating confirmation through another segment does not add another match. Later deck edits do not alter the frozen copy, and incomplete hand data is not used to infer an exact remaining deck.

### Win rates and sample sizes

Filter the statistics by deck version and play order:

| Statistic | Calculation |
| --- | --- |
| Overall win rate | Wins ÷ confirmed wins, losses, draws, and own concessions. |
| Decisive win rate | Wins ÷ confirmed wins, losses, and own concessions; draws excluded. |
| Own concessions | Counted as losses, with the concession sample also shown separately. |
| Unconfirmed results | Excluded from both rate denominators. A zero-size sample is unknown, not a fabricated 0% result. |

These are local, manually confirmed samples, not all MSA matches or an automatic estimate of deck strength.

## 10. Understand labels and coverage

| Label/concept | How to interpret it |
| --- | --- |
| Earliest/latest observation | First/last saved observation within a turn group; not necessarily the actual start/end hand of that turn. |
| Complete recognition | This snapshot met recognition conditions. Manually compare it on first use. It does not certify other moments. |
| Partial/unavailable recognition | Known IDs need not cover the full hand. Missing IDs do not mean an empty hand. |
| Log-confirmed/calibrated turn | Turn information came from the visible public log at that time. |
| Estimated turn | Advanced from earlier information without direct current log confirmation. |
| Observation turn | The recorder's own sequence, not yet aligned with an absolute game turn. Separate segments are not joined arbitrarily. |
| Snapshot difference | Count differences between eligible adjacent complete observations; the cause is unknown. |
| Deck-list column | Counts from the frozen version; not decremented as cards are used. |
| Hand `≥` / `?` | Recognized lower bound / unknown, rather than an invented exact count. |
| Public-use count | Recorded occurrences; can exceed deck-list copies and does not establish hand consumption or remaining cards. |
| Outside-deck observation | Observed own hand/public use contains an ID absent from the bound main list. Check the version and source. |
| Public log start/end observed | Stored public events include start and end evidence. This is not a server guarantee or complete hand history. |
| Hand-capture issue | A known pending/buffer/capture gap. A later complete public log does not restore the missing hand. |
| First capture time | When the recorder first read an event, not necessarily when the event occurred. |
| Acknowledged/dismissed reminder | The notice was hidden; its underlying error or gap was not repaired. |

Installing mid-match, pausing, closing the page, or missing a visible animation can lose hand history permanently. Opening an old match can collect its available public log, but cannot reconstruct previously unobserved hands.

## 11. Privacy, permissions, and sharing

Sessions, notes, decks, results, and exports are handled locally in the current Chrome profile. There is no automatic match upload or cloud synchronization. Backups are files you choose to save and share.

The recorder reads the MSA DOM that is displayed to you. It does not read cookies, intercept WebSockets, request MSA private APIs, read an opponent's hidden hand, send messages, or automatically play the game.

Official previews make on-demand requests for a single card to `www.gundam-gcg.com`. They omit credentials/referrers and do not attach your match, player names, or hand list. The official site can still observe the queried card ID and normal network connection information; card lookup is not completely offline. Text/image language, source, and retrieval time are shown, and the temporary card cache is not persisted as match storage. See [card-source details](card-sources.en.md).

**Exported reports and backups may contain your own hands, player names, notes, deck lists, and results. They are not automatically anonymized.** Review them before posting publicly or sending them to someone else. Share a minimal sanitized example when reporting a bug rather than a complete real-match backup by default.

## 12. Troubleshooting

| Problem | Checks and next action |
| --- | --- |
| Chrome cannot find the manifest | Extract the ZIP and choose the `extension` subfolder containing `manifest.json`, not the outer folder or ZIP. |
| Cannot find the installation path | Open the recorder's Details page, scroll to Source near the bottom, and find Loaded from / 載入來源. Keep the installation if the line is absent and ask for help. |
| New features or the panel are missing | Reload the existing extension, refresh MSA at a suitable time, and run Recorder check. An open game dialog can temporarily hide the panel. |
| Deck core is loading or unavailable | Check the complete packaged `wasm/` folder, then reload the existing extension and refresh MSA. Back up first; hand/log recording remains separate. |
| Hand display lags behind the game | Check the saved observation time, pending writes, and recognition/storage errors. The panel does not mark pending observations as saved. |
| No deck version is offered | Save a validly formatted 50-card main list, maximum four per ID, in Data & decks; keep resources/Tokens separate. |
| Cannot bind the deck | Verify player identity, a saved hand in this segment, game, and source tab. After switching match/player, start the action again. |
| Cannot change a deck after confirming the result | Review and edit that match's manual confirmation and frozen version in Data & decks. |
| Public uses exceed deck-list copies | Repeated use counts again. Check the original public log; do not derive remaining deck counts from it. |
| Only card IDs or `?` appear | Missing names/counts remain unresolved. Check observation provenance and use the single-card preview for official information. |
| Version statistics differ | The panel uses your confirmed results for the currently bound version; different versions and unconfirmed results are separate. |
| Recording alerts return | Inspect the underlying cause. Acknowledging does not repair storage. Back up readable records instead of uninstalling first. |
| Hands exist but public events are zero | Keep the match open and safely Refresh Log or open the game's log, then check saved counts. |
| Refresh Log or pre-export refresh fails | Finish inputs/game actions and close unnecessary dialogs before retrying. Existing records can still be exported with gaps preserved. |
| Card text/image will not load | Check source/language, permission to the official domain, network, and the displayed error. Existing match records remain intact. |
| Cannot bookmark a moment | Confirm identity and a saved current-segment hand. After switching match, reopen the editor. |
| A note's source snapshot is missing | Check the selected match and combined-segment scope. Keep the backup/source IDs rather than reassigning it to another match. |
| Selecting an import file writes nothing | File selection creates a preview. Confirm the import if there are additions; identical data needs no reimport. |
| Only part of an import succeeded | Keep the original file, check verified/unfinished items and capacity, then preview again after addressing the issue. |
| Import is too large/unsupported/unsafe | Use this tool's supported formats and allowed data keys. The per-file limit is 20 MiB; do not strip unknown fields to pretend it succeeded. |
| Deck will not save | Check syntax, exactly 50 main cards, maximum four per ID, and separate resource/Token fields. |
| Fewer matches than recording segments | One game/confirmed player is counted once. Check confirmation and filters; unconfirmed results are excluded from rates. |
| A downloaded file cannot be found | Check Chrome Downloads. “Download started” does not prove that a file was saved. |
| No English interface or card-text option appears | Update to v0.11.0 and reload the existing extension. Choose English in Interface language; refresh MSA after upgrading the extension files. |

### Common usage questions

**Do I need to import a deck before recording?**

No. Hand and public-log recording do not require a bound deck. Saving and confirming a deck enables its full frozen list and version-specific manual statistics.

**Can it recommend the best play or determine the result automatically?**

These features are not implemented. You confirm results and play order yourself. Reports provide review material, and observed hand differences do not establish their causes or the optimal play.

**What works offline?**

A downloaded standalone HTML report can be read offline. Playing still depends on the MSA website, and official card previews require a network connection. Official art is not bundled as a full offline library.

**How do I move records to another computer or Chrome profile?**

Download a full backup in the original environment, install the tool in the destination, preview the import, then confirm it. There is no automatic synchronization. Recording settings and panel preferences are not overwritten by imports; set them again and check any partially completed import.

## 13. Chinese-to-English control reference

Use this reference to match older screenshots and either UI language. Chrome’s own management-page labels follow your browser language.

| Traditional Chinese control/label | English meaning |
| --- | --- |
| 啟用記錄 / 啟用自動記錄 | Enable recording / Enable automatic recording |
| 記錄設定 | Recording settings |
| 我的玩家名稱 | My player name |
| 我的手牌位置 | My hand position |
| 自動：下方玩家手牌 | Automatic: bottom player's hand |
| 自動收錄 Battle Log | Automatically collect Battle Log |
| 儲存設定 | Save settings |
| 記錄自檢 | Recorder check |
| 目前分頁自檢結果 | Current tab check results |
| 對戰小窗 | Live panel |
| 顯示對戰側邊小窗 ↗ | Show in-game panel |
| 牌組 / 手牌 / 公開事件 / 全部 | Deck / Hand / Public events / All |
| 顯示設定 | Display settings |
| 收合 | Collapse |
| 管理牌組 | Manage decks |
| 選擇本場牌組 | Choose this match's deck |
| 選擇已保存的牌組版本 | Select a saved deck version |
| 確認綁定本場牌組 | Confirm deck for this match |
| 重新選擇本場牌組 | Choose another deck for this match |
| 牌表 / 公開使用 | Deck-list copies / Public-use occurrences |
| 本人公開使用 / 對手公開使用 | Your public uses / Opponent's public uses |
| 待核對的公開使用 | Public uses to check |
| Token 生成（不計手牌出牌） | Token generation (not hand plays) |
| 數量與來源說明 | Counts and sources |
| 官方來源 | Official source |
| 更新 Log | Refresh Log |
| 知道了 / 收起提醒 | Acknowledged / Dismiss reminder |
| 標記此刻 | Bookmark now |
| 儲存書籤 / 新增筆記 | Save bookmark / Add note |
| 對局回顧 / 開啟對局回顧 | Match review / Open match review |
| 合併同對局的相容記錄段落 | Combine compatible segments of the same match |
| 獨立 HTML 報告 / 匯出 HTML 報告 | Standalone HTML report / Export HTML report |
| 回合報告 Markdown / 全部原始資料 JSON | Turn-report Markdown / All raw-data JSON |
| 手牌 CSV / 公開事件 CSV / 手牌＋事件整合 CSV | Hand CSV / Public-event CSV / Combined hand/event CSV |
| 資料與牌組 | Data & decks |
| 下載完整備份 | Download full backup |
| 確認匯入這些資料 | Confirm import |
| 匯入原件與衝突副本 | Import originals and conflict copies |
| 下載原始資料 | Download original data |
| 保存為牌組版本 | Save as deck version |
| 清空並建立新牌組 | Clear and create a new deck |
| 保存對局確認 | Save match confirmation |
| 尚未確認 | Unconfirmed |
| 勝（含對手投降） / 本人投降（計負） | Win (including opponent concession) / Own concession (counts as loss) |

## 14. Report a problem or suggest an improvement

Open a [GitHub issue](https://github.com/tingwei1111/msa-hand-recorder/issues) in English or Traditional Chinese. Include:

- Extension version and Chrome version, plus operating system.
- The smallest set of steps that reproduces the problem.
- Expected behavior and what actually happened.
- Relevant Recorder check results, displayed error text, and whether saved counts changed.
- For a Wasm problem, whether it says loading/error and whether the packaged files are present.

Remove player names, private notes, real hand history, and unrelated personal information from public screenshots or files. Prefer a small synthetic reproduction. Do not post account credentials, cookies, or private backend/network captures. If the issue only occurs in a real match, describe the capture conditions and what you checked; do not claim full coverage from a passing self-check.

Feature suggestions, clearer translations, and documentation corrections are welcome. Please distinguish a proposed feature from behavior already present in the released extension.
