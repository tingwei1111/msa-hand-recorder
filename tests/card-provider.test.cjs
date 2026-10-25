'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const provider = require('../extension/card-provider.js');
const ORIGIN = 'https://www.gundam-gcg.com';
const CODE = 'GD99-001';
const imageUrl = `${ORIGIN}/en/images/cards/card/${CODE}.webp?261025`;

// Entirely invented card data in the observed public HTML structure. No real
// card text, card art, match history or hidden hand data is bundled here.
function detail({code=CODE,name='Sample Unit &amp; Friend',type='UNIT',label='TYPE',effect='【Deploy】Sample effect.<br>Second line &lt;Sample&gt;.',image='../images/cards/card/GD99-001.webp?261025',extra=''} = {}) {
  return `<!doctype html><html><head><script>throw new Error('must not execute');</script></head><body>
    <article class="article"><div class="cardDetailPageContent">
      <div class="cardNoCol"><div class="cardNo">${code}</div></div>
      <h1 class="cardName">${name}</h1>
      <div class="cardImage"><img src="${image}" alt="Sample art"></div>
      <div class="cardData"><dl class="dataBox side"><dt class="dataTit">${label}</dt><dd class="dataTxt">${type}</dd></dl>
        <div class="cardDataRow overview"><div class="dataTxt isRegular">${effect}</div></div>
      </div>${extra}</div><aside>FAQ content must not be included.</aside></article></body></html>`;
}
const htmlResponse = (html=detail(), options={}) => new Response(html,{...options,headers:{'content-type':'text/html; charset=UTF-8',...options.headers}});
const lookup = (html=detail(), options={}) => provider.lookupCard(CODE,{locale:'en',fetch:async()=>htmlResponse(html),...options});
const bytes = {
  'image/webp':Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80]),
  'image/png':Uint8Array.from([137,80,78,71,13,10,26,10,0]),
  'image/jpeg':Uint8Array.from([255,216,255,224,0,0,255,217])
};

test('normalizes whole supported codes and parallel filenames without fuzzy matching or URLs',()=>{
  for (const input of [CODE,` ${CODE.toLowerCase()} `,`${CODE}_p2`,`${CODE}_p12.webp`,`${CODE}.png`]) assert.equal(provider.normalizeCardCode(input),CODE);
  for (const input of ['PR-001','P-001','T-021','R-001','EXB-001','EXR-001','ST01-001','EB01-001','SLB01-001','SC01-001']) assert.equal(provider.normalizeCardCode(input),input);
  for (const input of ['A'+CODE,CODE+'0','prefix '+CODE,`https://example.test/${CODE}`,`${CODE}?x=1`,`${CODE}/../x`,`${CODE}_p1_evil`,'GD99_001','GD99-01','__proto__',null,{},'GD99-%30%30%31']) assert.equal(provider.normalizeCardCode(input),null);
});
test('locale and source builders expose only the exact public official detail endpoint',()=>{
  assert.equal(provider.sourceUrlFor(CODE),`${ORIGIN}/zh-tw/cards/detail.php?detailSearch=${CODE}`);
  assert.equal(provider.sourceUrlFor(`${CODE}_p1`,'en-US'),`${ORIGIN}/en/cards/detail.php?detailSearch=${CODE}`);
  assert.equal(provider.normalizeLocale('zh-Hant'),'zh-tw');
  for (const locale of ['ja','../en','https://other.test',{},null]) assert.equal(provider.sourceUrlFor(CODE,locale),null);
});
test('one-card lookup uses anonymous bounded manual-redirect fetch and extracts only card data',async()=>{
  let calls=0;
  const result=await provider.lookupCard(CODE,{locale:'en',fetch:async(url,options)=>{
    calls++;
    assert.equal(url,provider.sourceUrlFor(CODE,'en'));
    assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.redirect,'manual'); assert.equal(options.cache,'no-store');
    assert.equal(options.method,'GET'); assert.ok(options.signal instanceof AbortSignal);
    return htmlResponse();
  }});
  assert.equal(calls,1); assert.equal(result.status,'ok'); assert.equal(result.name,'Sample Unit & Friend');
  assert.equal(result.cardCode,CODE); assert.equal(result.cardType,'UNIT');
  assert.equal(result.text,'【Deploy】Sample effect.\nSecond line <Sample>.');
  assert.equal(result.imageUrl,imageUrl); assert.equal(result.imageLocale,'en'); assert.equal(result.locale,'en');
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  assert.equal(result.sourceUrl,provider.sourceUrlFor(CODE,'en'));
});
test('Traditional Chinese fields retain Japanese image locale and numeric entities safely',async()=>{
  const result=await lookup(detail({name:'合成&#x5361;&#29260;',label:'卡牌類型',effect:'測試&#039;文字<br/>下一行',image:'../../jp/images/cards/card/GD99-001_p1.webp?261025'}),{locale:'zh-tw'});
  assert.equal(result.status,'ok'); assert.equal(result.name,'合成卡牌'); assert.equal(result.text,"測試'文字\n下一行");
  assert.equal(result.imageLocale,'jp'); assert.equal(result.locale,'zh-tw');
});
test('scripts/styles/iframes/comments cannot supply fake card names or effects',async()=>{
  const fake=detail({name:'Wrong script card'}).replace(/<script>[\s\S]*?<\/script>/g,'');
  const html=`<script>"</div>${fake}"</script><!-- ${fake} -->`+detail({effect:'Safe<script>"</div><h1 class="cardName">Attack</h1>"</script><style>bad</style><iframe>bad</iframe><br>Still safe'});
  const result=await lookup(html);
  assert.equal(result.status,'ok'); assert.equal(result.name,'Sample Unit & Friend'); assert.equal(result.text,'Safe\nStill safe');
});
test('HTML entity markup remains inert text rather than injected HTML',async()=>{
  const result=await lookup(detail({name:'&lt;img src=x onerror=alert(1)&gt;',effect:'&lt;script&gt;sample&lt;/script&gt;'}));
  assert.equal(result.name,'<img src=x onerror=alert(1)>'); assert.equal(result.text,'<script>sample</script>');
  assert.equal(result.status,'ok');
});
test('parallel input resolves canonical card and never matches a neighboring card number',async()=>{
  let url;
  const result=await provider.lookupCard(`${CODE}_p2.webp`,{locale:'en',fetch:async(value)=>{url=value;return htmlResponse(detail({code:'GD99-002'}));}});
  assert.equal(url,provider.sourceUrlFor(CODE,'en')); assert.equal(result.status,'notfound'); assert.equal(result.name,null);
  assert.equal((await lookup(detail({code:CODE+'0'}))).status,'notfound');
});
test('duplicate or ambiguous exact-card evidence is not selected arbitrarily',async()=>{
  assert.equal((await lookup(detail()+detail())).status,'notfound');
  assert.equal((await lookup(detail({extra:`<div class="cardNo">${CODE}</div>`}))).status,'notfound');
});
test('unsupported structure/type fails explicitly while an observed blank effect remains blank',async()=>{
  assert.equal((await lookup(detail({type:'MYSTERY'}))).status,'error');
  assert.equal((await lookup(detail().replace('cardDataRow overview','cardDataRow unknown'))).reason,'unsupported-card-structure');
  const result=await lookup(detail({effect:''})); assert.equal(result.status,'ok'); assert.equal(result.text,'');
});
test('untrusted or mismatched image URL cannot enter the card model',async()=>{
  for (const image of ['https://evil.test/GD99-001.webp','javascript:alert(1)',`${ORIGIN}/en/images/cards/card/GD99-002.webp`,`${ORIGIN}/en/images/cards/card/GD99-001.svg`]) {
    const result=await lookup(detail({image})); assert.equal(result.status,'ok'); assert.equal(result.imageUrl,null); assert.equal(result.imageLocale,null);
  }
});
test('image URL allowlist checks origin, credentials, path, exact code, query and file format',()=>{
  assert.equal(provider.allowedImageUrl(imageUrl,CODE),true);
  assert.equal(provider.allowedImageUrl(`${ORIGIN}/jp/images/cards/card/${CODE}_p12.png`,CODE),true);
  for (const url of [imageUrl.replace('https:','http:'),imageUrl.replace('www.',''),imageUrl.replace('.com/','.com.evil.test/'),imageUrl.replace('https://','https://user@'),imageUrl+'#x',imageUrl+'&token=x',imageUrl.replace('?261025','?redirect=https://evil.test'),imageUrl.replace('.webp','.svg'),imageUrl.replace('/card/','/card/%2e%2e/'),imageUrl.replace('/en/','/fr/'),'data:image/png;base64,AAAA','file:///tmp/a.png']) assert.equal(provider.allowedImageUrl(url,CODE),false,url);
  assert.equal(provider.allowedImageUrl(imageUrl,'GD99-002'),false);
});
test('invalid code and locale return structured error without invoking fetch',async()=>{
  let calls=0; const fetch=async()=>{calls++;throw Error('unexpected');};
  assert.equal((await provider.lookupCard('https://evil.test',{fetch})).reason,'invalid-card-code');
  assert.equal((await provider.lookupCard(CODE,{fetch,locale:'unknown'})).reason,'unsupported-locale');
  assert.equal(calls,0);
});
test('404 and opaque redirects remain unknown and no redirect target is fetched',async()=>{
  let calls=0;
  for (const response of [new Response('',{status:404}),{url:'',type:'opaqueredirect',status:0}]) {
    const result=await lookup('',{fetch:async()=>{calls++;return response;}});
    assert.equal(result.status,'notfound'); assert.equal(result.name,null);
  }
  assert.equal(calls,2);
});
test('same-origin homepage redirect is not followed; external redirects are blocked',async()=>{
  let calls=0;
  for (const [location,reason] of [['../index.php','not-found-or-redirected'],['https://evil.test/','redirect-blocked']]) {
    const result=await lookup('',{fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location}});}});
    assert.equal(result.reason,reason);
  }
  assert.equal(calls,2);
});
test('a fetcher that follows redirects or changes the final URL is rejected',async()=>{
  for (const attrs of [{redirected:true},{url:'https://evil.test/'}]) {
    const response=htmlResponse(); for(const [key,value] of Object.entries(attrs)) Object.defineProperty(response,key,{value});
    const result=await lookup('',{fetch:async()=>response}); assert.equal(result.reason,'unexpected-response-url');
  }
});
test('HTTP, MIME and network errors never substitute card data',async()=>{
  for (const [fetch,reason] of [
    [async()=>new Response('',{status:503}),'http-error'],
    [async()=>new Response('{}',{headers:{'content-type':'application/json'}}),'unsupported-content-type'],
    [async()=>{throw new Error('secret in transport error');},'network-error']
  ]) {
    const result=await lookup('',{fetch}); assert.equal(result.status,'error'); assert.equal(result.reason,reason); assert.equal(result.text,null);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});
test('HTML byte limit applies both to declared content length and streamed bytes',async()=>{
  assert.equal((await lookup('',{fetch:async()=>htmlResponse('small',{headers:{'content-length':String(provider.HTML_LIMIT+1)}})})).reason,'response-too-large');
  let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(provider.HTML_LIMIT+1));},cancel(){cancelled=true;}});
  const result=await lookup('',{fetch:async()=>new Response(stream,{headers:{'content-type':'text/html'}})});
  assert.equal(result.reason,'response-too-large'); assert.equal(cancelled,true);
});
test('fetch and stalled-body reads time out and abort instead of hanging',async()=>{
  let signal;
  const result=await lookup('',{timeoutMs:5,fetch:async(url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  assert.equal(result.reason,'timeout'); assert.equal(signal.aborted,true);
  let cancelled=false;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}});
  const bodyResult=await lookup('',{timeoutMs:5,fetch:async()=>new Response(stream,{headers:{'content-type':'text/html'}})});
  assert.equal(bodyResult.reason,'timeout'); assert.equal(cancelled,true);
});
test('HTML parser complexity and oversized field bounds fail safely',async()=>{
  assert.equal((await lookup('<div>'.repeat(100)+detail())).reason,'unsupported-html');
  assert.equal((await lookup(detail({name:'x'.repeat(501)}))).reason,'oversized-card-field');
  assert.equal((await lookup(detail({effect:'x'.repeat(20001)}))).reason,'oversized-card-field');
  assert.equal((await lookup('<a '.repeat(15000))).status,'notfound');
  assert.equal((await lookup('<div title="'+ 'x'.repeat(300000))).status,'notfound');
});
test('image helper accepts only matching PNG/JPEG/WebP MIME and magic, with anonymous fetch',async()=>{
  for (const [mime,data] of Object.entries(bytes)) {
    let calls=0;
    const result=await provider.fetchCardImage(imageUrl,{cardCode:CODE,fetch:async(url,options)=>{
      calls++; assert.equal(url,imageUrl); assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer'); assert.equal(options.redirect,'manual');
      return new Response(data,{headers:{'content-type':mime}});
    }});
    assert.equal(calls,1); assert.equal(result.status,'ok'); assert.equal(result.mime,mime); assert.equal(result.sourceUrl,imageUrl);
    assert.equal(result.dataUrl,`data:${mime};base64,${Buffer.from(data).toString('base64')}`); assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  }
});
test('image helper refuses arbitrary URL, missing code, mismatch, SVG and disguised HTML',async()=>{
  let calls=0; const fetch=async()=>{calls++;return new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}});};
  for(const [url,cardCode] of [['https://evil.test/a.png',CODE],[imageUrl,undefined],[imageUrl,'GD99-002']]) {
    assert.equal((await provider.fetchCardImage(url,{cardCode,fetch})).reason,'invalid-image-url');
  }
  assert.equal(calls,0);
  assert.equal((await provider.fetchCardImage(imageUrl,{cardCode:CODE,fetch})).reason,'unsupported-content-type');
  assert.equal((await provider.fetchCardImage(imageUrl,{cardCode:CODE,fetch:async()=>new Response('<html>bad</html>',{headers:{'content-type':'image/png'}})})).reason,'invalid-image-content');
  assert.equal((await provider.fetchCardImage(imageUrl,{cardCode:CODE,fetch:async()=>new Response(bytes['image/jpeg'],{headers:{'content-type':'image/png'}})})).reason,'invalid-image-content');
});
test('image response size is bounded to 2 MiB without replacing successful card metadata',async()=>{
  const card=await lookup();
  const image=await provider.fetchCardImage(imageUrl,{cardCode:CODE,fetch:async()=>new Response(new Uint8Array(provider.IMAGE_LIMIT+1),{headers:{'content-type':'image/png'}})});
  assert.equal(image.reason,'response-too-large'); assert.equal(image.dataUrl,null); assert.equal(card.status,'ok'); assert.equal(card.name,'Sample Unit & Friend');
});
test('UMD module loads in a service-worker-like context without DOMParser or Node globals',async()=>{
  const context=vm.createContext({URL,AbortController,TextDecoder,Uint8Array,setTimeout,clearTimeout,fetch:async()=>htmlResponse()});
  vm.runInContext(fs.readFileSync(require.resolve('../extension/card-provider.js'),'utf8'),context);
  assert.equal(typeof context.MSACardProvider.lookupCard,'function');
  const result=await context.MSACardProvider.lookupCard(CODE,{locale:'en'}); assert.equal(result.status,'ok');
  const image=await context.MSACardProvider.fetchCardImage(imageUrl,{cardCode:CODE,fetch:async()=>new Response(bytes['image/png'],{headers:{'content-type':'image/png'}})});
  assert.equal(image.status,'ok'); assert.equal(image.dataUrl,`data:image/png;base64,${Buffer.from(bytes['image/png']).toString('base64')}`);
});
