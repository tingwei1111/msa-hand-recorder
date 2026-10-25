# 參與開發 · Contributing

[繁中首頁](README.md) · [English README](README.en.md) · [Issues](https://github.com/tingwei1111/msa-hand-recorder/issues)

## 繁體中文

歡迎回報問題、改善文件、翻譯教學或提交程式修改。一般使用者只需下載安裝 ZIP；下面的工具與指令供開發者使用。

### 回報問題

1. 先搜尋既有 Issues，避免重複回報。
2. 使用 Bug report 範本，提供插件與 Chrome 版本、操作步驟、預期與實際結果，以及自檢的非敏感結果。
3. 優先用合成對局重現。真實 JSON／HTML 備份可能含手牌、玩家名稱與筆記；請先移除個人內容，保留能重現問題的最小範例。

### 開始開發

Fork 此專案，從 `main` 建立分支。需要 Node.js 22 以上及 Python 3；一般 JavaScript／介面工作使用隨包附帶的 Wasm，不必重建它。

```bash
git clone https://github.com/YOUR-USERNAME/msa-hand-recorder.git
cd msa-hand-recorder
git switch -c fix/describe-your-change
npm test
npm run preview
```

在 `npm run preview` 顯示的本機網址開啟合成預覽，可從導覽連到插件小視窗、回顧與管理頁。這些頁面不會讀取已安裝插件的真實紀錄。查卡操作會請求官方公開卡片來源。

修改 `extension/*.html` 後，執行 `npm run preview:sync`，再檢查預覽頁。請勿直接修改生成的 `demo/*-preview.html`。

提交前執行與改動相關的測試及下列檢查：

```bash
npm test
python3 scripts/sync_previews.py --check
npm run package
```

變更 Rust 核心或 Wasm 介面時，另依 [Rust／Wasm 建置說明](docs/Rust-Wasm.md) 使用固定工具鏈並執行 `npm run test:rust`、`npm run build:wasm`。保留 `Cargo.lock`，不要手動修改生成的 Wasm 或膠合程式。

### 提交 Pull Request

- 說明使用者遇到的問題、修改後行為及實際執行的驗證；介面修改請附合成資料截圖。
- 保留其他玩家、對局與記錄段落的隔離規則；未知手牌與缺漏不能變成零張或假定完整。
- 已存觀察、暫存觀察、公開 Log 覆蓋與真人整場驗證要分別表達。
- 不提交真實對局、匯出備份、Cookie、Token、`.env`、本機路徑或生成的 `output/`、`dist/`、`target/`。
- 程式修改與文件可用繁中或英文。貢獻遵循專案 [MIT 授權](LICENSE)，第三方內容須保留原授權。

## English

Contributions may include bug reports, documentation, translations, or code. End users only need the install ZIP; the tools below are for developers.

Search existing issues, then use the bug-report template with extension/Chrome versions, reproduction steps, expected and observed behavior, and non-sensitive diagnostic output. Prefer a minimal synthetic reproduction. Real exports can contain hands, names, and notes; remove private content before sharing.

Fork the repository and create a branch from `main`. Use Node.js 22+ and Python 3. Ordinary JavaScript/UI work uses the packaged Wasm and does not require rebuilding it. The clone and test commands above apply to either language. `npm run preview` serves synthetic local pages for the popup, review, library, and in-game panel; it does not read real installed-extension records. Card lookup still requests the official public card source.

After changing extension HTML, run `npm run preview:sync`. Before a PR, run relevant tests, `npm test`, `python3 scripts/sync_previews.py --check`, and `npm run package`. Rust/Wasm changes additionally follow the [pinned build instructions](docs/Rust-Wasm.en.md), `npm run test:rust`, and `npm run build:wasm`. Do not edit generated Wasm/glue manually.

Explain the user-facing problem, resulting behavior, and checks actually run. Add synthetic screenshots for UI changes. Preserve player/game/run isolation and the distinction between saved observations, pending data, public-log coverage, and complete live-match validation. Unknown or missing observations must not turn into zero counts or claims of completeness.

Do not commit real matches, exports, credentials, local paths, or generated output/build folders. English and Traditional Chinese are both welcome. Contributions use the project's [MIT License](LICENSE); third-party material retains its own license.
