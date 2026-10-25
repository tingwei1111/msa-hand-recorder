# Rust／WebAssembly 牌組核心

**繁體中文** · [English](Rust-Wasm.en.md) · [專案首頁](../README.md) · [使用教學](使用教學.md)

v0.8.0 將牌組追蹤的資料計算移至 Rust，編譯為 WebAssembly，保留 Chrome 擴充功能的既有操作與存檔格式。一般使用者下載安裝包即可，不需安裝 Rust、Node.js 或額外的 Wasm 執行環境。

## 程式分工

| 區域 | 負責內容 |
| --- | --- |
| Rust 牌組核心 | 驗證及選擇本場凍結牌組、分類已存手牌數量、彙整公開使用與 Token、計算同版本人工戰績。 |
| JavaScript 橋接器 | 載入本機 Wasm、傳送當次輸入、還原輸出，以及保留原 JavaScript 的字串與宿主語義。 |
| 原有 Chrome 程式 | 讀取 MSA 可見 DOM、記錄手牌／公開 Log、操作小窗、確認本場牌組、存取 Chrome 儲存、備份與匯出。 |

`extension/deck-tracker-core.js` 對外維持 `project(input)` 的同步計算介面。瀏覽器先完成一次非同步 Wasm 載入，後續投影使用同一個引擎；Node 測試使用實際編譯後的 Wasm。核心不讀 DOM、Chrome 儲存、Cookie、私有後端或網路，也不替玩家出牌。

改寫目標是保留行為並讓資料計算可由 Rust 驗證與測試。本版沒有根據未量測結果承諾更快、較低記憶體用量或更完整的對戰捕捉。

## 保留既有 JavaScript 語義

Rust 與 JavaScript 的字串、日期及排序規則不同。`extension/deck-tracker-wire.js` 只擷取 Rust 實際讀取的欄位，再使用可還原的傳輸資料保留 UTF-16 字串，並在宿主端處理既有的日期解析、英文定序及 Unicode 大寫轉換語義。原始快照內容與匯入附件不需在每次畫面更新時複製進 Wasm；牌組驗證、分類、統計與結果組裝仍由 Rust 執行。

這層資料只存在當次計算中，不會原地改寫呼叫者的 `input`、session 或 Chrome 儲存，也不會加進備份。測試以合成輸入比較實際 Wasm 與改寫前的 JavaScript 輸出，涵蓋格式錯誤、空值、邊界字串、日期、排序、重複事件與玩家／對局隔離。

## 啟動、錯誤與記錄流程

Wasm 載入中時，牌組追蹤區會顯示等待狀態並停用牌組綁定；載入失敗或程式檔毀損時，該區會顯示錯誤，不把未取得的結果當成零張手牌或零次出牌。沒有自動改用舊 JavaScript 投影的隱藏備援。

手牌、公開 Battle Log、原始記錄與備份由既有流程保存。牌組引擎的載入或錯誤不會要求清除記錄，也不會改寫已有存檔。途中換局、換玩家或銷毀小窗時，延遲的載入通知不能套用前一個對局的資料。

若牌組核心無法載入，請保留對局並先備份，再核對安裝資料夾是否完整、Chrome 擴充功能是否已重新載入，以及 MSA 分頁是否已重新整理。不要先解除安裝，以免遺失本機資料。

## 備份相容性

本版不變更 session、deck、match、note 或匯入原件的 schema，也不重建或轉換資料庫。舊版完整 JSON、單場 JSON 與本工具獨立 HTML 仍經原有匯入流程處理；原始未知欄位與衝突處理規則保留。

手牌數量保留三種意義：可核對的完整張數、部分已辨識下限 `≥`、未知 `?`。公開使用是已收錄的累計次數，合法重複使用會重複計數，Token 生成另列。這些欄位不代表精確剩餘牌庫。Rust 改寫不會補回未被觀察到的歷史手牌。

## 建置與檢查

開發需要 Node.js 22 以上、Python 3、Rust `1.99.1`、`wasm32-unknown-unknown` target，以及 `wasm-bindgen` CLI `0.2.90`。`rust-toolchain.toml` 固定 Rust 工具鏈；應用程式依提交的 `Cargo.lock` 以 `--locked` 建置及檢查，Wasm 依賴與 CLI 版本也必須一致。

Workspace 的 edition 為 `2024`，`crates/deck-tracker-core` 單獨使用 edition `2021`：已審視的 `wasm-bindgen 0.2.90` 巨集會產生舊式 `extern` 區塊，尚未符合 edition 2024 的 `unsafe extern` 要求。此設定讓相同 Rust 工具鏈能編譯既定的綁定版本。

在專案根目錄準備工具；以下把 CLI 裝在 Git 忽略的專案目錄，`PATH` 設定只適用於目前 shell：

```sh
rustup toolchain install 1.99.1 --profile minimal --component rustfmt --component clippy --target wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.90 --root .wasm-tools
export PATH="$PWD/.wasm-tools/bin:$PATH"
```

CLI 安裝固定 `0.2.90`，不加 `--locked`，讓工具自己的相依套件可配合目前 Rust 解析；此方式已經過隔離安裝與產物比對驗證。應用程式仍使用原本的 `Cargo.lock`。

在專案根目錄執行：

```sh
npm run build:wasm
python3 scripts/build_wasm.py --check
npm run test:rust
npm test
npm run package
```

`build:wasm` 重建安裝包所用的三個固定產物：

- `extension/wasm/deck_tracker_bg.wasm`：Rust 核心。
- `extension/wasm/deck_tracker.js`：classic-script 載入膠合程式。
- `extension/wasm/build-info.json`：Rust／CLI 版本及 Wasm 的 SHA-256。

`build_wasm.py --check` 重新執行建置與綁定產生，再逐一比較已提交的產物；產物過期時以非零狀態結束。建置會把專案與 Cargo 的本機來源路徑映射為 `/src` 與 `/cargo`，避免將開發者路徑帶入 Wasm。打包另行驗證 binary magic、metadata 與 SHA-256，並拒絕含本機使用者路徑或額外 Wasm 的安裝資源。

`test:rust` 執行 Rust 格式、Clippy、原生測試與文件檢查。`npm test` 使用實際 Wasm 驗證投影相容性及既有 JavaScript 行為；`package` 把所需程式與文件放入安裝 ZIP。實際測試數與結果以當次輸出及 CI 為準。

本機介面預覽使用：

```sh
npm run preview
```

預覽僅使用合成對局，不讀取已安裝擴充功能的真實記錄。瀏覽器檢查包含載入中、載入失敗、換局、未知手牌、Token、人工戰績及原錄製回歸；合成預覽不等於已完成真人整場對戰驗證。

## Chrome 載入範圍

Wasm 及膠合程式隨安裝包提供，不從 CDN 或遠端程式網址載入。橋接器從擴充功能產生的本機資源 URL 讀取精確的 Wasm 檔；該程式資源的 web-accessible 規則只對應 `https://mobilesuitarena.com/*`，不開放使用者的對局記錄。

一般權限仍只有 `storage`，官方單卡資料查詢沿用 `https://www.gundam-gcg.com/*`。Wasm 不新增網站存取權限。isolated-world content scripts 依 Chrome 提供的 CSP 執行；若在擴充功能頁面執行 Wasm，須使用 Chrome 允許的 `wasm-unsafe-eval` 政策，不開放一般 `unsafe-eval` 或遠端腳本。

官方文件：[content scripts 與 CSP](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)、[web-accessible resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)、[擴充功能 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)、[wasm-bindgen 部署方式](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)。
