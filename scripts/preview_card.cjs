'use strict';

// Loopback preview helper: accepts a card code and supported locale only. All
// URLs, redirects, MIME/byte limits, and image magic checks belong to the same
// official provider used by the extension. No match or hand data is accepted.
const provider = require('../extension/card-provider.js');
async function main() {
  const args = process.argv.slice(2), [rawCode,rawLocale] = args;
  const cardCode = provider.normalizeCardCode(rawCode), locale = provider.normalizeLocale(rawLocale);
  if (args.length !== 2 || cardCode !== rawCode || !['zh-tw','en'].includes(rawLocale) || !locale) {
    return {status:'error',reason:'只接受單一卡號與 zh-tw／en 語言。'};
  }
  const card = await provider.lookupCard(cardCode,{locale,fetch:globalThis.fetch});
  if (card.status === 'ok' && card.imageUrl) {
    const image = await provider.fetchCardImage(card.imageUrl,{cardCode,fetch:globalThis.fetch});
    if (image.status === 'ok') card.imageDataUrl = image.dataUrl;
    else card.imageReason = image.reason || '圖片未能載入';
  }
  return card;
}
main().then(value=>process.stdout.write(JSON.stringify(value)),error=>{
  process.stdout.write(JSON.stringify({status:'error',reason:String(error?.message||error)}));
});
