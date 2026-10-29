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

/** Returns { results, errors }. A source that fails is skipped; only if all fail does the caller see an error. */
async function searchImages(q) {
  const query = String(q || '').trim().slice(0, 120);
  if (!query) return { results: [], errors: [] };
  const jobs = process.env.IMAGE_SEARCH_URL ? [openverse] : [openverse, commons];
  const settled = await Promise.allSettled(jobs.map((f) => f(query)));
  const results = [], seen = new Set();
  const max = Math.max(...settled.map((s) => (s.status === 'fulfilled' ? s.value.length : 0)), 0);
  for (let n = 0; n < max; n++) for (const s of settled) { const r = s.status === 'fulfilled' && s.value[n]; if (r && !seen.has(r.url)) { seen.add(r.url); results.push(r); } }
  const names = process.env.IMAGE_SEARCH_URL ? ['Custom'] : ['Openverse', 'Wikimedia Commons'];
  return { results, errors: settled.map((s, n) => (s.status === 'rejected' ? `${names[n]}: ${String(s.reason?.message || s.reason)}` : null)).filter(Boolean) };
}

module.exports = { searchImages };
