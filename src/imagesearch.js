'use strict';
/**
 * Web image search for recipe photos, with no account or API key: Openverse (openly licensed photos from
 * Flickr and others) and Wikimedia Commons. IMAGE_SEARCH_URL can point at another Openverse-compatible server.
 */
const OPENVERSE = () => process.env.IMAGE_SEARCH_URL || 'https://api.openverse.org/v1/images/';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const UA = { 'user-agent': 'Simmer/1.0 (self-hosted recipe app; https://github.com/moimeme81/simmer)', accept: 'application/json' };

async function getJson(url) {
  let res;
  try { res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'timed out' : String(e.cause?.code || e.cause?.message || e.message)); }   // e.g. ENOTFOUND = DNS cannot find the site
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  try { return await res.json(); } catch { throw new Error('unreadable reply'); }
}
const httpUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);

async function openverse(q) {
  const u = new URL(OPENVERSE());
  u.search = new URLSearchParams({ q, page_size: '18', mature: 'false', category: 'photograph' }).toString();
  const j = await getJson(u.toString());
  return (j.results || []).map((r) => ({
    thumb: httpUrl(r.thumbnail) || httpUrl(r.url), url: httpUrl(r.url), title: String(r.title || '').slice(0, 120),
    credit: [r.creator, r.license ? `CC ${String(r.license).toUpperCase()}${r.license_version ? ' ' + r.license_version : ''}` : ''].filter(Boolean).join(' · ').slice(0, 160),
    page: httpUrl(r.foreign_landing_url), source: 'Openverse',
  })).filter((r) => r.url && r.thumb);
}

async function commons(q) {
  const u = new URL(COMMONS);
  u.search = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `filetype:bitmap ${q}`, gsrnamespace: '6', gsrlimit: '12', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '400' }).toString();
  const j = await getJson(u.toString());
  return Object.values(j.query?.pages || {}).map((p) => {
    const i = p.imageinfo?.[0]; if (!i) return null;
    const meta = i.extmetadata || {};
    return { thumb: httpUrl(i.thumburl), url: httpUrl(i.thumburl && i.thumbwidth ? i.url : i.url), title: String(p.title || '').replace(/^File:/, '').slice(0, 120), credit: [String(meta.Artist?.value || '').replace(/<[^>]*>/g, ''), meta.LicenseShortName?.value].filter(Boolean).join(' · ').slice(0, 160), page: httpUrl(i.descriptionurl), source: 'Wikimedia Commons' };
  }).filter((r) => r && r.url && r.thumb && /\.(jpe?g|png|webp)$/i.test(r.url));
}

const BROWSER = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'application/json,text/html,*/*', 'accept-language': 'en-US,en;q=0.9' };
async function fetchText(url, headers) {
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new Error(e.name === 'TimeoutError' ? 'timed out' : String(e.cause?.code || e.cause?.message || e.message)); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Web-wide image results from DuckDuckGo (no key). It is an unofficial endpoint, so it can change without notice. */
async function duckduckgo(q0) {
  const q = q0 + ' food';
  const page = await fetchText('https://duckduckgo.com/?' + new URLSearchParams({ q, iax: 'images', ia: 'images' }), BROWSER);
  const vqd = /vqd=["']?([\d-]+)/.exec(page)?.[1];
  if (!vqd) throw new Error('no search token');
  const body = await fetchText('https://duckduckgo.com/i.js?' + new URLSearchParams({ l: 'us-en', o: 'json', q, vqd, f: ',,,,,', p: '1' }), { ...BROWSER, referer: 'https://duckduckgo.com/' });
  let j; try { j = JSON.parse(body); } catch { throw new Error('unreadable reply'); }
  return (j.results || []).slice(0, 24).map((r) => {
    let host = ''; try { host = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
    return { thumb: httpUrl(r.thumbnail), url: httpUrl(r.image), alt: httpUrl(r.thumbnail), title: String(r.title || '').slice(0, 120), credit: host, page: httpUrl(r.url), source: 'Web' };
  }).filter((r) => r.url && r.thumb);
}

/** Web-wide image results from Bing (no key), used alongside DuckDuckGo so one being rate-limited doesn't end the search. Unofficial. */
async function bing(q0) {
  const q = q0 + ' food';
  const html = await fetchText('https://www.bing.com/images/async?' + new URLSearchParams({ q, first: '0', count: '30', mmasync: '1', adlt: 'moderate' }), BROWSER);
  const out = [];
  for (const m of html.matchAll(/\sm="([^"]+)"/g)) {
    let j; try { j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { continue; }
    let host = ''; try { host = new URL(j.purl).hostname.replace(/^www\./, ''); } catch {}
    const r = { thumb: httpUrl(j.turl), url: httpUrl(j.murl), alt: httpUrl(j.turl), title: String(j.t || '').replace(/<[^>]*>/g, '').slice(0, 120), credit: host, page: httpUrl(j.purl), source: 'Web' };
    if (r.url && r.thumb) out.push(r);
  }
  if (!out.length && !/iusc|imgpt/.test(html)) throw new Error('unreadable reply');
  return out.slice(0, 24);
}

const STOP = /^(the|a|an|and|with|of|in|on|for|to|easy|best|simple|quick|homemade|recipe|style|my|our|et|ou|de|du|des|d|la|le|les|l|un|une|au|aux|en|avec|pour|sur|dans|a|à)$/i;
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const keywords = (q) => plain(q).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.test(w));
const stem = (w) => (w.length > 4 ? w.replace(/(es|s|e|x)$/, '') : w);

/** Wordings to try, most specific first: "Pork Osso Buco" -> "Osso Buco" -> "Buco". */
function variants(q) {
  const words = q.split(/\s+/).filter((w) => w && !STOP.test(plain(w)));
  const out = [q];
  for (const v of [words.join(' '), words.slice(-2).join(' '), words.slice(-1).join(' ')]) if (v && v.length > 2 && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  return out.slice(0, 4);
}

/** Keeps only photos whose title or page mentions a word from the search, so unrelated results (a band for "poutine") never show. */
function relevant(list, q) {
  const words = keywords(q).map(stem);
  if (!words.length) return list;
  return list.filter((r) => {
    const hay = plain([r.title, r.page, r.credit].join(' '));
    return !r.title && !r.page ? true : words.some((w) => hay.includes(w));
  });
}

/** Runs one source over the wordings until one finds relevant photos. Throws only when the source itself could not be reached. */
async function trySource(fn, q) {
  let failure = null;
  for (const v of variants(q)) {
    try { const r = relevant(await fn(v), v); if (r.length) return r; }
    catch (e) { failure = e; if (/timed out|ENOTFOUND|EAI_AGAIN|ECONN/.test(String(e.message))) break; }   // unreachable: don't retry
  }
  if (failure) throw failure;
  return [];
}

const cache = new Map();   // query -> { at, value }: repeat searches don't hit the sites again (they rate-limit)

/** Returns { results, errors, reached }. `reached` = how many sources answered (even with zero photos). */
async function searchImages(q) {
  const query = String(q || '').trim().slice(0, 120);
  if (!query) return { results: [], errors: [], reached: 0 };
  const key = query.toLowerCase(), hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.value;
  const value = await run(query);
  if (value.results.length) { cache.set(key, { at: Date.now(), value }); if (cache.size > 100) cache.delete(cache.keys().next().value); }
  return value;
}

async function run(query) {
  const jobs = process.env.IMAGE_SEARCH_URL ? [openverse] : [duckduckgo, bing, openverse, commons];
  const settled = await Promise.allSettled(jobs.map((f) => trySource(f, query)));
  const results = [], seen = new Set();
  const max = Math.max(...settled.map((s) => (s.status === 'fulfilled' ? s.value.length : 0)), 0);
  for (let n = 0; n < max; n++) for (const s of settled) { const r = s.status === 'fulfilled' && s.value[n]; if (r && !seen.has(r.url)) { seen.add(r.url); results.push(r); } }
  const names = process.env.IMAGE_SEARCH_URL ? ['Custom'] : ['DuckDuckGo', 'Bing', 'Openverse', 'Wikimedia Commons'];
  console.log('[image-search]', JSON.stringify(query), settled.map((x, n) => `${names[n]}=${x.status === 'fulfilled' ? x.value.length : 'failed'}`).join(' '));
  return { results, reached: settled.filter((s) => s.status === 'fulfilled').length, errors: settled.map((s, n) => (s.status === 'rejected' ? `${names[n]}: ${String(s.reason?.message || s.reason)}` : null)).filter(Boolean) };
}

module.exports = { searchImages };
