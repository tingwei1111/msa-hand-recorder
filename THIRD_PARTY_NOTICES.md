# 第三方聲明 · Third-party notices

本專案自行撰寫的程式與文件採根目錄 MIT 授權；下列第三方元件仍使用各自授權。
The project-authored source and documentation use the root MIT License. Third-party components retain their own licenses.

## 名稱、卡片資料與圖像 · Names, card data, and images

GUNDAM CARD GAME、GUNDAM 名稱、卡文、卡圖與標誌，以及 Mobile Suit Arena 名稱與服務，屬於各自權利人。本專案 MIT 授權不授予這些素材或服務的額外權利；本工具非其官方產品。
GUNDAM CARD GAME/GUNDAM names, card text, card art and logos, and the Mobile Suit Arena name and service belong to their respective rights holders. The project MIT License grants no additional rights to those assets or services. This is an independent, unofficial tool.

公開示範圖片及預覽使用合成資料。安裝包不整批提供官方卡圖或卡文；單卡預覽向官方公開來源查詢。詳見 [卡片來源](docs/card-sources.md) / [Card sources](docs/card-sources.en.md)。

## Cargo.lock 相依套件 · Locked dependencies

下表列出 Cargo.lock 內的第三方套件，包含編譯工具與測試用依賴；不表示每個套件都以可執行程式碼連入安裝檔。對應授權及版權聲明逐一保留於 `third_party/licenses/`。
The table includes third-party packages in Cargo.lock, including build/test dependencies; it is not a claim that every package is linked as executable code into the install bundle. Original license/copyright notices are retained under `third_party/licenses/`.

| Package | Version | Declared license | Original notices |
| --- | --- | --- | --- |
| bumpalo | 3.20.3 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/bumpalo-3.20.3/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/bumpalo-3.20.3/LICENSE-MIT) |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/cfg-if-1.0.5/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/cfg-if-1.0.5/LICENSE-MIT) |
| itoa | 1.0.18 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/itoa-1.0.18/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/itoa-1.0.18/LICENSE-MIT) |
| log | 0.4.34 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/log-0.4.34/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/log-0.4.34/LICENSE-MIT) |
| memchr | 2.8.3 | Unlicense OR MIT | [COPYING](third_party/licenses/memchr-2.8.3/COPYING), [LICENSE-MIT](third_party/licenses/memchr-2.8.3/LICENSE-MIT) |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/once_cell-1.21.4/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/once_cell-1.21.4/LICENSE-MIT) |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/proc-macro2-1.0.107/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/proc-macro2-1.0.107/LICENSE-MIT) |
| quote | 1.0.47 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/quote-1.0.47/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/quote-1.0.47/LICENSE-MIT) |
| serde | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/serde-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/serde-1.0.229/LICENSE-MIT) |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/serde_core-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/serde_core-1.0.229/LICENSE-MIT) |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/serde_derive-1.0.229/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/serde_derive-1.0.229/LICENSE-MIT) |
| serde_json | 1.0.154 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/serde_json-1.0.154/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/serde_json-1.0.154/LICENSE-MIT) |
| syn | 2.0.119 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/syn-2.0.119/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/syn-2.0.119/LICENSE-MIT) |
| syn | 3.0.9 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/syn-3.0.9/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/syn-3.0.9/LICENSE-MIT) |
| unicode-ident | 1.0.27 | (MIT OR Apache-2.0) AND Unicode-3.0 | [LICENSE-APACHE](third_party/licenses/unicode-ident-1.0.27/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/unicode-ident-1.0.27/LICENSE-MIT), [LICENSE-UNICODE](third_party/licenses/unicode-ident-1.0.27/LICENSE-UNICODE) |
| wasm-bindgen | 0.2.90 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/wasm-bindgen-0.2.90/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/wasm-bindgen-0.2.90/LICENSE-MIT) |
| wasm-bindgen-backend | 0.2.90 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/wasm-bindgen-backend-0.2.90/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/wasm-bindgen-backend-0.2.90/LICENSE-MIT) |
| wasm-bindgen-macro | 0.2.90 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/wasm-bindgen-macro-0.2.90/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/wasm-bindgen-macro-0.2.90/LICENSE-MIT) |
| wasm-bindgen-macro-support | 0.2.90 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/wasm-bindgen-macro-support-0.2.90/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/wasm-bindgen-macro-support-0.2.90/LICENSE-MIT) |
| wasm-bindgen-shared | 0.2.90 | MIT OR Apache-2.0 | [LICENSE-APACHE](third_party/licenses/wasm-bindgen-shared-0.2.90/LICENSE-APACHE), [LICENSE-MIT](third_party/licenses/wasm-bindgen-shared-0.2.90/LICENSE-MIT) |
| zmij | 1.0.23 | MIT | [LICENSE-MIT](third_party/licenses/zmij-1.0.23/LICENSE-MIT) |
