(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MSACardProvider = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ORIGIN = 'https://www.gundam-gcg.com';
  const HTML_LIMIT = 512 * 1024;
  const IMAGE_LIMIT = 2 * 1024 * 1024;
  const TIMEOUT_MS = 8000;
  const CODE = /^(?:GD\d{2,3}|ST\d{2,3}|EB\d{2,3}|SC\d{2,3}|SLB\d{2,3}|PR|P|R|T|EXB|EXR)-\d{3}$/;
  const TYPES = new Set(['UNIT', 'PILOT', 'COMMAND', 'BASE', 'RESOURCE', 'EX BASE', 'EX RESOURCE', 'UNIT TOKEN']);
  const blockedTags = new Set(['script','style','template','noscript','iframe','object','svg','math']);
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const failure = reason => Object.assign(new Error(reason), {reason});

  // Accept a whole card label or parallel-art filename, never a URL or a
  // substring. Parallel illustrations resolve to the exact base card number.
  function normalizeCardCode(value) {
    if (typeof value !== 'string' || value.length > 80) return null;
    const match = value.trim().toUpperCase().match(/^([A-Z0-9]+-\d{3})(?:_P\d{1,3})?(?:\.(?:WEBP|PNG|JPE?G))?$/);
    return match && CODE.test(match[1]) ? match[1] : null;
  }
  function normalizeLocale(value) {
    if (value === undefined) return 'zh-tw';
    if (typeof value !== 'string') return null;
    const locale = value.toLowerCase();
    if (locale === 'en' || locale === 'en-us') return 'en';
    return ['zh-tw','zh-hant'].includes(locale) ? 'zh-tw' : null;
  }
  function sourceUrlFor(cardCode, locale) {
    const code = normalizeCardCode(cardCode), language = normalizeLocale(locale);
    return code && language ? `${ORIGIN}/${language}/cards/detail.php?detailSearch=${code}` : null;
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 500 || /[\s\\%]/.test(value)) return null;
    try {
      const url = new URL(value);
      return url.origin === ORIGIN && !url.username && !url.password && !url.port && !url.hash ? url : null;
    } catch (_) { return null; }
  }
  function allowedImageUrl(value, cardCode) {
    const url = safeUrl(value);
    if (!url) return false;
    const match = url.pathname.match(/^\/(en|jp|zh-tw)\/images\/cards\/card\/([A-Z0-9]+-\d{3})(?:_p\d{1,3})?\.(webp|png|jpe?g)$/);
    if (!match || !CODE.test(match[2]) || (url.search && !/^\?\d{6,14}=?$/.test(url.search))) return false;
    if (cardCode !== undefined && (!normalizeCardCode(cardCode) || normalizeCardCode(cardCode) !== match[2])) return false;
    return true;
  }
  function imageLocale(value) { return new URL(value).pathname.split('/')[1]; }
  function emptyCard(code, locale, sourceUrl, status, reason) {
    return {status, cardCode:code, name:null, cardType:null, text:null, imageUrl:null, imageLocale:null,
      sourceUrl, locale, fetchedAt:new Date().toISOString(), ...(reason ? {reason} : {})};
  }

  function decodeEntities(value) {
    const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”'};
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
      if (entity[0] !== '#') return Object.hasOwn(named, entity) ? named[entity] : whole;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '�';
    });
  }
  function attributes(tag) {
    const result = Object.create(null);
    const body = tag.replace(/^<\/?[\w:-]+/, '').replace(/\/?\s*>$/, '');
    const pattern = /([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for (const match of body.matchAll(pattern)) {
      const key = match[1].toLowerCase();
      if (!Object.hasOwn(result,key)) result[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
  }
  function* htmlTokens(html) {
    let position = 0;
    while (position < html.length) {
      if (html[position] !== '<') {
        const next = html.indexOf('<',position);
        const end = next < 0 ? html.length : next;
        yield html.slice(position,end); position = end; continue;
      }
      if (html.startsWith('<!--',position)) {
        const end = html.indexOf('-->',position+4);
        position = end < 0 ? html.length : end+3; continue;
      }
      if (!/^<\/?[A-Za-z]/.test(html.slice(position,position+3)) && !html.startsWith('<!',position)) {
        yield '<'; position += 1; continue;
      }
      const start = position;
      let quote = '', end = position+1;
      for (; end < html.length; end += 1) {
        const char = html[end];
        if (quote) { if (char === quote) quote = ''; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === '>' || char === '<') break;
      }
      if (html[end] === '>') { yield html.slice(start,end+1); position = end+1; }
      else {
        // Consume malformed tags once. Repeated '<a ' with no closing '>' must
        // not make a backtracking regular expression scan the whole tail again.
        yield '&lt;' + html.slice(start+1,end); position = end;
      }
    }
  }
  // A small inert HTML reader for the known official detail structure. This
  // creates plain objects, not DOM; markup, event handlers and scripts never run.
  function parseHTML(html) {
    const root = {tag:'root',attrs:{},children:[]}, stack = [root];
    let nodes = 0;
    for (const token of htmlTokens(html)) {
      if (++nodes > 20000) throw failure('unsupported-html');
      const parent = stack.at(-1);
      if (token.startsWith('<!')) continue;
      if (token[0] !== '<' || token === '<') { if (!parent.blocked) parent.children.push(decodeEntities(token)); continue; }
      const tag = token.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
      if (parent.blocked) {
        if (token.startsWith('</') && parent.tag === tag) stack.pop();
        continue;
      }
      if (token.startsWith('</')) {
        for (let i = stack.length-1; i > 0; i -= 1) {
          if (stack[i].tag === tag) { stack.length = i; break; }
        }
        continue;
      }
      const node = {tag,attrs:attributes(token),children:[],blocked:parent.blocked || blockedTags.has(tag)};
      if (!node.blocked) parent.children.push(node);
      if (!voidTags.has(tag) && !token.endsWith('/>')) {
        if (stack.length > 80) throw failure('unsupported-html');
        stack.push(node);
      }
    }
    return root;
  }
  function hasClass(node, name) { return Boolean(node && typeof node === 'object' && (node.attrs.class || '').split(/\s+/).includes(name)); }
  function findAll(root, predicate) {
    const matches = [], pending = [root];
    while (pending.length) {
      const node = pending.pop();
      if (typeof node !== 'object' || !node) continue;
      if (predicate(node)) matches.push(node);
      for (let i = node.children.length-1; i >= 0; i -= 1) pending.push(node.children[i]);
    }
    return matches;
  }
  function plainText(node) {
    if (typeof node === 'string') return node;
    if (node.tag === 'br') return '\n';
    if (node.tag === 'img') return node.attrs.alt || '';
    const value = node.children.map(plainText).join('');
    return ['p','div','li','dd','dt'].includes(node.tag) ? value + '\n' : value;
  }
  function cleanText(node) {
    return plainText(node).replace(/[\t\r\f ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  function parseDetail(html, code, locale, sourceUrl) {
    const root = parseHTML(html), cards = findAll(root,node => hasClass(node,'cardDetailPageContent'));
    const matching = cards.filter(node => {
      const numbers = findAll(node, item => hasClass(item,'cardNo'));
      return numbers.length === 1 && cleanText(numbers[0]) === code;
    });
    if (matching.length !== 1) return emptyCard(code,locale,sourceUrl,'notfound','exact-card-not-found');
    const card = matching[0], names = findAll(card,node => hasClass(node,'cardName'));
    const overviews = findAll(card,node => hasClass(node,'cardDataRow') && hasClass(node,'overview'));
    const types = findAll(card,node => node.tag === 'dl' && hasClass(node,'dataBox')).flatMap(box => {
      const labels = findAll(box,node => node.tag === 'dt' && hasClass(node,'dataTit'));
      if (labels.length !== 1 || !['TYPE','卡牌類型'].includes(cleanText(labels[0]))) return [];
      return findAll(box,node => node.tag === 'dd' && hasClass(node,'dataTxt')).map(cleanText);
    });
    if (names.length !== 1 || !cleanText(names[0]) || types.length !== 1 || !TYPES.has(types[0]) || overviews.length !== 1) {
      return emptyCard(code,locale,sourceUrl,'error','unsupported-card-structure');
    }
    const name = cleanText(names[0]), text = cleanText(overviews[0]);
    if (name.length > 500 || text.length > 20000) return emptyCard(code,locale,sourceUrl,'error','oversized-card-field');
    const images = findAll(card,node => hasClass(node,'cardImage')).flatMap(box => findAll(box,node => node.tag === 'img'));
    let imageUrl = null;
    if (images.length === 1 && images[0].attrs.src) {
      try {
        const resolved = new URL(images[0].attrs.src,sourceUrl).href;
        if (allowedImageUrl(resolved,code)) imageUrl = resolved;
      } catch (_) { /* Invalid image sources stay unknown. */ }
    }
    return {...emptyCard(code,locale,sourceUrl,'ok'),name,cardType:types[0],text,imageUrl,
      imageLocale:imageUrl ? imageLocale(imageUrl) : null};
  }

  async function boundedRead(response, limit, signal) {
    const length = response.headers?.get('content-length');
    if (length && /^\d+$/.test(length) && Number(length) > limit) throw failure('response-too-large');
    if (!response.body?.getReader) throw failure('unsupported-response');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    const cancel = () => { Promise.resolve(reader.cancel()).catch(() => {}); };
    signal.addEventListener('abort',cancel,{once:true});
    try {
      while (true) {
        if (signal.aborted) throw failure('timeout');
        const {done,value} = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw failure('unsupported-response');
        size += value.byteLength;
        if (size > limit) { cancel(); throw failure('response-too-large'); }
        chunks.push(value);
      }
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.byteLength; }
      return result;
    } finally { signal.removeEventListener('abort',cancel); reader.releaseLock(); }
  }
  async function request(url, options, limit, contentKind) {
    const fetcher = options.fetch || globalThis.fetch;
    if (typeof fetcher !== 'function') throw failure('fetch-unavailable');
    const controller = new AbortController();
    const milliseconds = Number.isFinite(options.timeoutMs) ? Math.max(1,Math.min(TIMEOUT_MS,options.timeoutMs)) : TIMEOUT_MS;
    let timer;
    const deadline = new Promise((_,reject) => {
      timer = setTimeout(() => { reject(failure('timeout')); controller.abort(); },milliseconds);
    });
    const operation = (async () => {
      const response = await fetcher(url,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'manual',
        cache:'no-store',signal:controller.signal,headers:{Accept:contentKind === 'html' ? 'text/html' : 'image/webp,image/png,image/jpeg'}});
      if (!response || response.redirected || (response.url && response.url !== url)) throw failure('unexpected-response-url');
      if (response.type === 'opaqueredirect') throw failure('not-found-or-redirected');
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get('location');
        let target;
        try { target = location ? new URL(location,url) : null; } catch (_) { /* Reject malformed redirect. */ }
        if (target && target.origin !== ORIGIN) throw failure('redirect-blocked');
        // Missing cards currently redirect to the locale homepage. Do not load
        // it or follow any redirect; an opaque browser redirect also stays unknown.
        throw failure('not-found-or-redirected');
      }
      if (response.status === 404 || response.status === 410) throw failure('not-found');
      if (!response.ok) throw failure('http-error');
      const mime = String(response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (contentKind === 'html' ? !['text/html','application/xhtml+xml'].includes(mime) : !['image/webp','image/png','image/jpeg'].includes(mime)) {
        throw failure('unsupported-content-type');
      }
      return {bytes:await boundedRead(response,limit,controller.signal),mime};
    })();
    try { return await Promise.race([operation,deadline]); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  function resultStatus(reason) { return ['not-found','not-found-or-redirected'].includes(reason) ? 'notfound' : 'error'; }
  async function lookupCard(cardCode, options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const code = normalizeCardCode(cardCode), locale = normalizeLocale(options.locale), sourceUrl = sourceUrlFor(code,locale);
    if (!code || !locale) return emptyCard(code,locale,null,'error',!code ? 'invalid-card-code' : 'unsupported-locale');
    try {
      const {bytes} = await request(sourceUrl,options,HTML_LIMIT,'html');
      return parseDetail(new TextDecoder('utf-8').decode(bytes),code,locale,sourceUrl);
    } catch (error) {
      const reason = error?.reason || 'network-error';
      return emptyCard(code,locale,sourceUrl,resultStatus(reason),reason);
    }
  }
  function validImageMagic(bytes,mime) {
    if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value);
    if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return mime === 'image/webp' && bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
  }
  function base64(bytes) {
    if (typeof globalThis.btoa === 'function') {
      const parts = [];
      for (let i = 0; i < bytes.length; i += 32768) parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
      return globalThis.btoa(parts.join(''));
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const output = [];
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i+1], c = bytes[i+2];
      output.push(alphabet[a >> 2],alphabet[((a & 3) << 4) | ((b || 0) >> 4)],
        i+1 < bytes.length ? alphabet[((b & 15) << 2) | ((c || 0) >> 6)] : '=',i+2 < bytes.length ? alphabet[c & 63] : '=');
    }
    return output.join('');
  }
  async function fetchCardImage(imageUrl, options = {}) {
    options = options && typeof options === 'object' ? options : {};
    const code = normalizeCardCode(options.cardCode);
    const result = {status:'error',dataUrl:null,mime:null,sourceUrl:null,fetchedAt:new Date().toISOString()};
    if (!code || !allowedImageUrl(imageUrl,code)) return {...result,reason:'invalid-image-url'};
    result.sourceUrl = imageUrl;
    try {
      const {bytes,mime} = await request(imageUrl,options,IMAGE_LIMIT,'image');
      if (!validImageMagic(bytes,mime)) return {...result,reason:'invalid-image-content'};
      return {...result,status:'ok',mime,dataUrl:`data:${mime};base64,${base64(bytes)}`,fetchedAt:new Date().toISOString()};
    } catch (error) {
      const reason = error?.reason || 'network-error';
      return {...result,status:resultStatus(reason),reason};
    }
  }
  return Object.freeze({lookupCard,fetchCardImage,normalizeCardCode,normalizeLocale,allowedImageUrl,sourceUrlFor,
    OFFICIAL_ORIGIN:ORIGIN,HTML_LIMIT,IMAGE_LIMIT,TIMEOUT_MS});
});
