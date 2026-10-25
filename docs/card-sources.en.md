# Card preview data sources

[繁體中文](card-sources.md) · **English** · [Project home](../README.en.md) · [User guide](user-guide.en.md)

Card previews query the official GUNDAM CARD GAME website for the **single card number** the user is viewing. This project does not include the official image library or a complete card-text dataset. Demos and automated tests use synthetic data written for this project.

Previews do not read an opponent's hidden hand or send the match record, player names, or hand list to the official website.

**The v0.8.0 interface remains in Traditional Chinese. The live panel currently requests cards with `locale: 'zh-tw'` and has no card-text language selector.** English lookup support in the provider API below is a developer capability; it is not an available English-preview setting in the current UI. English documentation does not change the extension's interface language. Check the displayed text and image languages separately: Traditional Chinese text may accompany a Japanese card image.

## Public sources checked

The source check recorded on **2026-10-25** covered these public pages:

- [English card search](https://www.gundam-gcg.com/en/cards/index.php?freeword=GD05-002): search-result `data-src` attributes point to `detail.php?detailSearch=<card number>`. Alternate artwork uses suffixes such as `_p1` and `_p2`.
- [English single-card details](https://www.gundam-gcg.com/en/cards/detail.php?detailSearch=GD05-002): the HTML contains the card number, name, type, effects, and image path without needing to execute the site's scripts.
- [Traditional Chinese single-card details](https://www.gundam-gcg.com/zh-tw/cards/detail.php?detailSearch=GD05-002): the checked page contained Traditional Chinese names and effects, but its image pointed to the official `/jp/images/cards/card/` directory. **`locale: "zh-tw"` does not mean that the card image is also in Traditional Chinese.**

These links are public-source examples. The corresponding real card text and image files are not stored in this repository. The official HTML is not a versioned public API. If its structure or source changes, the tool reports unknown data or a lookup failure and retains an official link for manual verification. A preview does not replace the official FAQ, errata, or tournament rulings.

## Provider API

`extension/card-provider.js` runs in the service worker and Node.js without a DOM, `DOMParser`, or third-party dependencies. Its browser global is `MSACardProvider`; CommonJS consumers use `require()`.

```js
const card = await MSACardProvider.lookupCard('GD05-002', {
  locale: 'zh-tw', // Default; also supports en and aliases zh-Hant / en-US.
  fetch           // Optional injection; defaults to globalThis.fetch.
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

- `status` is `ok`, `notfound`, or `error`. Unknown fields are `null`; the provider does not substitute synthetic names, guessed text, or a different card.
- `notfound` means that the current request did not obtain evidence for the exact card. An unavailable card number may redirect to the official homepage, and a browser may expose a manual redirect as an unreadable `opaqueredirect`. These results are marked `not-found-or-redirected`; they do not prove that a card can never exist.
- `fetchedAt` is the ISO timestamp of this lookup, not the official text's last-update date. By default, the provider only queries the requested language and does not silently switch languages.
- `normalizeCardCode()` accepts a complete card number or an alternate-art filename ending in `_p<number>` and returns the base card number. For example, `GD05-002_p2.webp` looks up `GD05-002`, so the preview is not guaranteed to show the player's exact artwork. URLs, paths, and partial matches are rejected.
- `sourceUrlFor(cardCode, locale)` only constructs a fixed official single-card URL. `allowedImageUrl(imageUrl, cardCode)` validates the official HTTPS origin, card-image directory, filename, version parameter, and exact card number. Syntactically valid numbers such as `PR-001` can be queried; accepted syntax does not establish that the official site has that card.
- `text` and `name` are plain text. UI code must render them with `textContent`, not insert them as HTML.

## Network requests, images, and caching

Background card requests only need the `https://www.gundam-gcg.com/*` host permission. The card provider does not require `tabs`, cookies, other domains, `web_accessible_resources`, or an iframe. The provider itself does not read Chrome storage or grant permissions; its integration controls when to request a card and how to cache it. The extension's separate Wasm resource is described in [Rust / WebAssembly](Rust-Wasm.en.md).

Every request uses `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "manual"`, and `cache: "no-store"`. Redirects are not followed automatically. The provider does not fetch the homepage, external sites, tracking scripts, or fonts. Requests have an eight-second maximum wait, a 512 KiB HTML stream limit, and a 2 MiB image stream limit. Timeouts abort the request. `timeoutMs` can reduce the time limit but cannot extend it.

The recorded official image response included `Cross-Origin-Resource-Policy: same-site` and no observed `Access-Control-Allow-Origin`. The MSA page therefore does not embed the remote image directly. The background retrieves one image from the allowed official source, checks both its PNG / JPEG / WebP MIME type and file signature, and passes a `data:` image to the UI. SVG, HTML, other card numbers, and other origins are rejected. The background only accepts a validated image URL returned by `lookupCard()`, not an arbitrary URL supplied by a page. If the image fails, available text and the official source link can still be shown.

The provider does not download cards in bulk, prefetch an entire hand, paginate automatically, or build a permanent global cache. The integration may combine simultaneous requests by language and base card number and keep an expiring local cache. It should retain `sourceUrl`, `locale`, `imageLocale`, and `fetchedAt` so cached content can be distinguished from a fresh lookup. In the current integration, the background keeps a short-lived memory cache rather than adding card data to match storage.

The official website can see the requested individual card number and normal network connection information. Card lookup is therefore an online feature even though match records are stored locally.

## Validation scope

`tests/card-provider.test.cjs` uses synthetic HTML and image signatures throughout. It covers exact card numbers, alternate-art normalization, languages, redirect rejection, URL allowlists, safe text, size and timeout limits, and a service-worker-like environment.

The recorded source validation also checked the parsing structure of public English and Traditional Chinese single-card HTML locally. A Node.js request fetched one Traditional Chinese card and its corresponding Japanese image from the official site. Neither the real HTML nor the image was added to the public project. These checks do not establish coverage of every official card number, future website changes, or all network behavior in the installed Chrome extension.
