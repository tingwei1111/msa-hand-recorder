# MSA 手牌記錄器

在 Chrome 本機記錄 Mobile Suit Arena 中**自己可見的手牌**與**雙方公開的 Battle Log**，賽後按回合回顧，再匯出可離線閱讀的報告。

**[下載 v0.4.0 公開測試版 ZIP](https://github.com/tingwei1111/msa-hand-recorder/releases/download/v0.4.0/msa-hand-recorder-v0.4.0.zip)** · [版本下載頁](https://github.com/tingwei1111/msa-hand-recorder/releases/tag/v0.4.0) · [完整使用教學](docs/使用教學.md)

v0.4.0 為公開測試版（Prerelease），尚未完成真人實際對戰的端到端驗證。[查看版本紀錄](CHANGELOG.md)。

## 能做什麼

- 保存已觀察到的手牌卡號、張數、時間、回合來源、辨識品質與資源，包含一般及 EX 可用資源。
- 在開局、結束的安全閒置時機，自動嘗試短暫顯示 Battle Log，讀取後恢復原狀；也能手動更新。
- 按回合檢視**每筆已儲存的手牌快照**與公開事件，標示數量差、未知資料與擷取缺口。
- 合併同一對局、同一玩家的相容記錄段落，下載 HTML、Markdown、JSON 或 CSV。HTML 包含完整可讀內容及可重新解析的原始 JSON。

![新版回顧介面：逐筆手牌與雙方公開出牌](docs/images/review-v0.4.jpg)

*上圖使用合成示範資料，不是真實對戰紀錄。另見[小視窗預覽](docs/images/popup-v0.4.jpg)。*

## 安裝到 Chrome

1. 下載上方 v0.4.0 公開測試版 ZIP；也可在版本下載頁的 **Assets** 選擇 `msa-hand-recorder-v0.4.0.zip`。備用方式是在本專案首頁按 **Code → Download ZIP** 取得程式碼。
2. 解壓縮到你會保留的固定資料夾，例如 `Documents/msa-hand-recorder`。不要直接從 ZIP 載入，也不要安裝後移動或刪除資料夾。
3. 在 Chrome 網址列輸入 `chrome://extensions`，開啟右上角「開發人員模式」。
4. 按「載入未封裝項目」，選取解壓後的 **`extension` 子資料夾**，不要選外層資料夾。
5. 釘選「MSA 手牌記錄器」，並在開局前重新整理已開啟的 MSA 分頁。

Release ZIP 的安裝位置是解壓後的 `msa-hand-recorder-v0.4.0/extension`。Download ZIP 也包含 `extension` 子資料夾，外層名稱可能不同。一般使用不需要 Node.js，也不需要安裝程式依賴。

## 一場對局怎麼用

1. **開局前：**確認「自動記錄」開關已開，並在「記錄設定」保留「自動收錄 Battle Log」，自己的手牌位置先保留「自動：下方玩家手牌」。
2. **開始打牌後：**點開擴充功能，展開「最近一次手牌」，核對玩家、卡號與實際手牌張數，確認快照及公開事件筆數有更新。第一次使用請在發牌、抽牌、出牌後各核對一次。
3. **賽後：**先保持 MSA 對局分頁開著，按「開啟對局回顧」，保留「合併同對局的相容記錄段落」，選「獨立 HTML 報告」下載。
4. **下載前後：**確認匯出前刷新結果、Log 起尾及缺口警告，再到 Chrome 下載項目確認檔案已保存。

小視窗「進階備份與管理」的「下載 JSON／手牌 CSV」備份單一段落；需要整理跨重新整理後的同一場對局，請使用回顧頁的合併匯出。操作細節與疑難排解見[使用教學](docs/使用教學.md)。

## 更新與資料

更新前先匯出重要記錄，再把新版 `extension` 的檔案更新到原來的同一資料夾。在 `chrome://extensions` 對原擴充功能按「重新載入」，並在下一場開局前重新整理 MSA 分頁。**不要先移除擴充功能**；移除或清除其資料可能刪掉本機記錄。

記錄存放在目前 Chrome 使用者設定檔內，沒有自動雲端同步或備份。工具讀取頁面已顯示的內容，不讀取對手隱藏手牌、不攔截遊戲連線，也不自動上傳記錄。**匯出報告包含自己的手牌與玩家資訊**，分享前請先確認內容。

## 使用限制

目前**尚未完成真人實際對戰的端到端驗證**，請先用測試對局人工核對。MSA 改版、背景節流、分頁關閉或動畫都可能造成缺漏；工具保存所有已儲存的觀察，不能保證捕捉每個瞬間。

沒有觀察到的歷史手牌無法補回。「公開 Log 已見開局與結束」不代表手牌全程完整；卡牌數量差也不代表已確認的抽牌、出牌或棄牌原因。部分辨識、未知回合與手牌擷取缺口會保留標示。

## 本機開發與介面預覽

開發請先 clone 儲存庫或使用 **Code → Download ZIP**；Release 安裝包只含擴充功能與教學。需要 Node.js 22 以上與 Python 3，沒有外部 npm 依賴。

```sh
npm test
npm run preview:sync
python3 -m http.server 8768 --bind 127.0.0.1
```

開啟 `http://127.0.0.1:8768/demo/popup-preview.html` 或 `http://127.0.0.1:8768/demo/review-preview.html`。預覽使用合成資料，不連線至 MSA；可加上 `?scenario=empty`、`partial`、`no-log`、`save-error`、`storage-error`、`settings-error`、`segments` 或 `long` 檢查不同畫面。更改 HTML 後以 `npm run preview:sync` 同步；`npm run package` 產生安裝包。
