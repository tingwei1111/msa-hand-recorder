# 卡片預覽的資料來源

卡片預覽以使用者正在查閱的**單一卡號**向 GUNDAM CARD GAME 官方網站查詢。專案不附官方圖庫或完整卡文資料集；示範與自動測試使用自行編寫的合成資料。預覽不會讀取對方未公開手牌，也不會把整場對局、玩家名稱或手牌清單送到官方網站。

## 已核對的公開來源

2026-10-25 以官方公開頁面核對：

- [英文卡片搜尋](https://www.gundam-gcg.com/en/cards/index.php?freeword=GD05-002)：搜尋結果的 `data-src` 指向 `detail.php?detailSearch=<卡號>`。同卡異圖使用 `_p1`、`_p2` 等後綴。
- [英文單卡詳細頁](https://www.gundam-gcg.com/en/cards/detail.php?detailSearch=GD05-002)：HTML 直接包含卡號、名稱、類型、效果及圖片路徑，不需要執行網站腳本。
- [繁體中文單卡詳細頁](https://www.gundam-gcg.com/zh-tw/cards/detail.php?detailSearch=GD05-002)：有繁中名稱與效果；本次確認其圖片連到官方 `/jp/images/cards/card/`，因此 `locale: "zh-tw"` 不表示卡圖也是繁中。

以上連結是公開來源範例，沒有在專案保存該卡的真實卡文或圖檔。官方 HTML 並非有版本保證的公開 API；若格式或來源變更，工具會顯示未知／讀取失敗，並保留可人工核對的官方連結。預覽也不取代官方 FAQ、勘誤或比賽裁定。

## Provider API

`extension/card-provider.js` 可在 service worker 與 Node.js 使用，沒有 DOM、`DOMParser` 或第三方依賴。瀏覽器全域名稱為 `MSACardProvider`；CommonJS 使用 `require()`。

```js
const card = await MSACardProvider.lookupCard('GD05-002', {
  locale: 'zh-tw', // 預設；另支援 en，別名 zh-Hant / en-US
  fetch           // 可注入；未指定時使用 globalThis.fetch
});
// {status, cardCode, name, cardType, text, imageUrl, imageLocale,
//  sourceUrl, locale, fetchedAt, reason?}

if (card.status === 'ok' && card.imageUrl) {
  const image = await MSACardProvider.fetchCardImage(card.imageUrl, {
    cardCode: card.cardCode,
    fetch
  });
  // {status, dataUrl, mime, sourceUrl, fetchedAt, reason?}
}
```

- `status` 是 `ok`、`notfound` 或 `error`。未知欄位是 `null`，不以合成名稱、猜測卡文或其他卡牌代替。
- `notfound` 表示本次未能取得精確單卡證據。官方不存在的卡號目前可能轉址至首頁；瀏覽器也可能將手動轉址表示為不可讀取的 `opaqueredirect`。這類結果會標為 `not-found-or-redirected`，不是證明該卡永遠不存在。
- `fetchedAt` 是本次查詢時間的 ISO 字串；不是官方卡文更新日期。預設只查指定語言，不會悄悄改用別的語言。
- `normalizeCardCode()` 接受完整卡號及 `_p數字` 異圖檔名，回傳基礎卡號。例如 `GD05-002_p2.webp` 會查 `GD05-002`，因此預覽不保證是玩家持有的同款異圖。拒絕 URL、路徑及模糊子字串。
- `sourceUrlFor(cardCode, locale)` 只建立固定官方單卡網址；`allowedImageUrl(imageUrl, cardCode)` 驗證官方 HTTPS 來源、卡圖目錄、檔名、版本參數及精確卡號。`PR-001` 等符合文法的卡號可查詢，但接受文法不代表官方一定有該卡。
- `text` 與 `name` 都是純文字。UI 必須使用 `textContent`，不能把這些欄位當成 HTML 插入。

## 網路、圖片與快取邊界

背景查詢只需要 `https://www.gundam-gcg.com/*` 的 `host_permissions`。不需要 `tabs`、Cookie、其他網域、`web_accessible_resources` 或 iframe。此 provider 本身不讀 Chrome 儲存空間、不增設權限；由整合層決定何時查詢與儲存快取。

每次請求都採 `credentials: "omit"`、`referrerPolicy: "no-referrer"`、`redirect: "manual"` 及 `cache: "no-store"`。不自動跟隨任何轉址，不抓首頁、外部網站、追蹤程式或字型。總等待上限 8 秒，HTML 串流上限 512 KiB，圖片串流上限 2 MiB；超時會中止。可傳 `timeoutMs` 縮短上限，不能延長上限。

本次官方卡圖回應包含 `Cross-Origin-Resource-Policy: same-site`，且未見 `Access-Control-Allow-Origin`。因此 MSA 頁面不直接嵌入遠端圖；背景在已允許的官方來源取回單張圖後，核對 PNG／JPEG／WebP 的 MIME 與檔頭，再傳 `data:` 圖片給 UI。SVG、HTML、其他卡號及其他來源一律拒絕。背景只能使用 `lookupCard()` 解析出的已驗證圖片網址，不接受頁面提供任意 URL。圖片失敗時，已讀取的文字與官方來源連結仍可顯示。

provider 不批次下載、不預取全手牌、不自動翻頁，也不建立永久全域快取。整合層可依語言＋基礎卡號合併同時查詢並保存有期限的本機快取；應保留 `sourceUrl`、`locale`、`imageLocale`、`fetchedAt`，清楚區分快取內容與本次重新取得的內容。官方可以得知被查詢的單一卡號及一般網路連線資訊，這不等於完全離線功能。

## 驗證範圍

`tests/card-provider.test.cjs` 全部使用合成 HTML／圖片檔頭，涵蓋精確卡號、異圖正規化、語言、轉址拒絕、URL 白名單、文字安全、大小／超時及 service-worker-like 執行環境。另以本次讀到的英文、繁中公開單卡 HTML 在本機確認解析結構，並在 Node.js 實際完成一次繁中單卡與對應日文圖片的官方網路請求；沒有將該 HTML 或圖檔保存到公開專案。這些檢查不代表所有官方卡號、將來改版格式或真實 Chrome 網路環境均已驗證。
