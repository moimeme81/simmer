'use strict';
/**
 * Moving recipes in and out of Simmer.
 *
 *   Simmer backup      everything of yours: recipes with photos, collections, lists, meal plan (a .zip)
 *   Paprika            .paprikarecipes, read by Mealie, Tandoor, RecipeSage and many others
 *   schema.org JSON    the cookbook layout (Nextcloud Cookbook): one folder per recipe with recipe.json and a photo,
 *                      which Mealie, Tandoor and most other recipe apps import
 *   Mealie             straight from / to a running Mealie server with its API token
 *
 * Nothing here writes to disk or opens the network by itself: the server passes in what it needs.
 */
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { writeZip, readZip, isZip } = require('./zip');
const { findRecipeNodes, fromLdNode, parseDuration, assertPublic } = require('./extract');

const IMG = /\.(?:jpe?g|png|webp)$/i;
const clip = (v, n) => String(v ?? '').slice(0, n);
const lines = (v) => String(v ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const uuid = () => crypto.randomUUID();
const safeName = (s) => String(s || 'recipe').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'recipe';
const imageType = (buf) => (buf?.length > 12 && (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg' : buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null)) || null;

/* ---------- times ---------- */
/** "PT1H20M", "1 hour 20 minutes", "80 min", "1:20", 80 -> minutes (or null). */
function minutesOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? Math.round(v) : null;
  const s = String(v).trim();
  const iso = parseDuration(s);
  if (iso) return iso;
  let m = /^(\d+):(\d{2})$/.exec(s);
  if (m) return +m[1] * 60 + +m[2] || null;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Math.round(+s.replace(',', '.')) || null;
  const h = /(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?|heures?)\b/i.exec(s), mi = /(\d+)\s*(?:m|mins?|minutes?)\b/i.exec(s), d = /(\d+)\s*(?:d|days?|jours?)\b/i.exec(s);
  const total = (d ? +d[1] * 1440 : 0) + (h ? Math.round(+h[1].replace(',', '.') * 60) : 0) + (mi ? +mi[1] : 0);
  return total || null;
}
const isoDuration = (mins) => (mins > 0 ? `PT${mins >= 60 ? `${Math.floor(mins / 60)}H` : ''}${mins % 60 ? `${mins % 60}M` : ''}` : undefined);
const timeText = (mins) => (mins > 0 ? (mins >= 60 ? `${Math.floor(mins / 60)} hour${mins >= 120 ? 's' : ''}${mins % 60 ? ` ${mins % 60} minutes` : ''}` : `${mins} minutes`) : '');

/* ---------- Simmer recipe <-> schema.org ---------- */
function toSchemaOrg(r, image) {
  const o = { '@context': 'https://schema.org', '@type': 'Recipe', name: r.title };
  if (r.description) o.description = r.description;
  if (image) o.image = image;
  if (r.author) o.author = { '@type': 'Person', name: r.author };
  if (r.yield) o.recipeYield = r.yield;
  if (isoDuration(r.prepMinutes)) o.prepTime = isoDuration(r.prepMinutes);
  if (isoDuration(r.cookMinutes)) o.cookTime = isoDuration(r.cookMinutes);
  if (isoDuration(r.totalMinutes)) o.totalTime = isoDuration(r.totalMinutes);
  o.recipeIngredient = r.ingredients || [];
  o.recipeInstructions = (r.steps || []).map((text) => ({ '@type': 'HowToStep', text }));
  if (r.collections?.length) { o.recipeCategory = r.collections[0]; o.keywords = r.collections.join(', '); }
  if (r.sourceUrl) o.url = r.sourceUrl;
  if (r.notes) o.comment = [{ '@type': 'Comment', text: r.notes }];
  if (r.rating) o.aggregateRating = { '@type': 'AggregateRating', ratingValue: r.rating, ratingCount: 1, bestRating: 5 };
  return o;
}

function fromSchemaOrg(node, fallbackTitle) {
  const base = fromLdNode(node, null, fallbackTitle);
  if (!base || !base.title) return null;
  const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  const cats = [...arr(node.recipeCategory), ...String(arr(node.keywords).join(',')).split(',')].map((x) => String(x).trim()).filter(Boolean);
  const comment = arr(node.comment).map((c) => (typeof c === 'string' ? c : c?.text)).filter(Boolean).join('\n\n');
  const rv = Number(node.aggregateRating?.ratingValue);
  return {
    ...base,
    image: undefined,
    notes: comment, collections: [...new Set(cats)].slice(0, 20),
    rating: rv > 0 ? Math.min(5, Math.round(rv)) : null,
    sourceUrl: /^https?:\/\//.test(node.url || '') ? node.url : /^https?:\/\//.test(node.sameAs || '') ? node.sameAs : null,
    importedFrom: 'schema.org',
  };
}

/* ---------- Paprika ---------- */
function toPaprika(r, photo) {
  const uid = (r.id || uuid()).toUpperCase();
  const json = {
    uid, created: (r.savedAt || new Date().toISOString()).slice(0, 19).replace('T', ' '), name: r.title, description: r.description || '',
    ingredients: (r.ingredients || []).join('\n'), directions: (r.steps || []).join('\n\n'), notes: r.notes || '', nutritional_info: '', difficulty: '',
    servings: r.yield || '', prep_time: timeText(r.prepMinutes), cook_time: timeText(r.cookMinutes), total_time: timeText(r.totalMinutes),
    source: r.host && r.host !== 'Imported' ? r.host : '', source_url: r.sourceUrl || '', image_url: '', rating: r.rating || 0,
    categories: r.collections || [], scale: null, on_favorites: false, on_grocery_list: null, in_trash: false, is_pinned: false,
  };
  if (photo) { json.photo = `${uid}.${imageType(photo) || 'jpg'}`; json.photo_data = photo.toString('base64'); }
  json.hash = crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
  return { name: `${safeName(r.title)}.paprikarecipe`, data: zlib.gzipSync(Buffer.from(JSON.stringify(json))) };
}

function fromPaprika(p) {
  const ingredients = lines(p.ingredients).filter((l) => !/^[-–—\s]*$/.test(l));
  const steps = lines(p.directions);
  if (!p.name || (!ingredients.length && !steps.length)) return null;
  let photo = null;
  try { if (p.photo_data) photo = Buffer.from(String(p.photo_data), 'base64'); } catch { /* no photo */ }
  return {
    data: {
      title: clip(p.name, 300), description: clip(p.description, 3000), ingredients, steps, notes: [p.notes, p.nutritional_info ? `Nutrition: ${p.nutritional_info}` : ''].filter(Boolean).join('\n\n'),
      yield: p.servings ? clip(p.servings, 100) : null, prepMinutes: minutesOf(p.prep_time), cookMinutes: minutesOf(p.cook_time), totalMinutes: minutesOf(p.total_time),
      rating: Number(p.rating) > 0 ? Math.min(5, Math.round(Number(p.rating))) : null, sourceUrl: p.source_url || null, sourceName: p.source || null,
      collections: Array.isArray(p.categories) ? p.categories.map(String) : [], importedFrom: 'paprika', externalId: p.uid ? `paprika:${p.uid}` : undefined,
    },
    photo: imageType(photo) ? photo : null,
  };
}

/* ---------- Mealie (its own JSON, as the API and its export return it) ---------- */
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };
const names = (list) => (Array.isArray(list) ? list : []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean).map(String);

function ingredientText(i) {
  if (typeof i === 'string') return i.trim();
  const display = String(pick(i, 'display') || '').trim();
  if (display) return display;
  const note = String(pick(i, 'note') || '').trim(), orig = String(pick(i, 'originalText', 'original_text') || '').trim();
  const q = Number(i.quantity) > 0 ? String(Math.round(Number(i.quantity) * 100) / 100) : '';
  const unit = typeof i.unit === 'object' ? i.unit?.name : i.unit, food = typeof i.food === 'object' ? i.food?.name : i.food;
  return orig || [q, unit, food, note].filter(Boolean).join(' ').trim();
}

function looksLikeMealie(j) {
  const ing = pick(j, 'recipeIngredient', 'recipe_ingredient');
  const ins = pick(j, 'recipeInstructions', 'recipe_instructions');
  return !!j && typeof j === 'object' && !Array.isArray(j) && j['@type'] == null && (typeof j.name === 'string') && (Array.isArray(ing) && ing.some((x) => x && typeof x === 'object') || Array.isArray(ins) && ins.some((x) => x && typeof x === 'object' && 'text' in x) || 'slug' in j && Array.isArray(ing));
}

function fromMealie(m) {
  const ingredients = (pick(m, 'recipeIngredient', 'recipe_ingredient') || []).map(ingredientText).filter(Boolean);
  const steps = (pick(m, 'recipeInstructions', 'recipe_instructions') || []).map((s) => (typeof s === 'string' ? s : [s.title ? `${s.title}:` : '', s.text].filter(Boolean).join(' '))).map((s) => s.trim()).filter(Boolean);
  if (!m.name || (!ingredients.length && !steps.length)) return null;
  const servings = Number(pick(m, 'recipeServings', 'recipe_servings')) || Number(pick(m, 'recipeYieldQuantity', 'recipe_yield_quantity')) || 0;
  const yieldText = pick(m, 'recipeYield', 'recipe_yield');
  const notes = (m.notes || []).map((n) => [n.title, n.text].filter(Boolean).join(': ')).filter(Boolean).join('\n\n');
  const rating = Number(m.rating);
  const org = pick(m, 'orgURL', 'org_url');
  return {
    title: clip(m.name, 300), description: clip(m.description, 3000), ingredients, steps, notes,
    yield: servings > 0 ? String(Math.round(servings * 100) / 100) : yieldText ? clip(yieldText, 100) : null,
    prepMinutes: minutesOf(pick(m, 'prepTime', 'prep_time')), cookMinutes: minutesOf(pick(m, 'cookTime', 'cook_time') ?? pick(m, 'performTime', 'perform_time')), totalMinutes: minutesOf(pick(m, 'totalTime', 'total_time')),
    rating: rating > 0 ? Math.min(5, Math.round(rating)) : null, sourceUrl: /^https?:\/\//.test(org || '') ? org : null,
    collections: [...new Set([...names(pick(m, 'recipeCategory', 'recipe_category')), ...names(m.tags)])].slice(0, 20),
    importedFrom: 'mealie', externalId: m.id ? `mealie:${m.id}` : undefined,
  };
}

/* ---------- reading uploads of any of the above ---------- */
const parseJson = (buf) => { try { return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const dirOf = (name) => (name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '');

/** A recipe object of any known JSON shape -> { data, photo? } or null. */
function recipeFromJson(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.format === 'simmer-recipe' && j.recipe) return { data: { ...j.recipe, importedFrom: 'simmer' } };
  if (looksLikeMealie(j)) { const d = fromMealie(j); return d && { data: d, format: 'Mealie' }; }
  if (j.name && ('directions' in j || 'photo_data' in j)) { const p = fromPaprika(j); return p && { ...p, format: 'Paprika' }; }
  const node = findRecipeNodes(j)[0];
  if (node) { const d = fromSchemaOrg(node); return d && { data: d, format: 'schema.org' }; }
  return null;
}

/** buf + file name -> { format, items: [{ data, photo }], lists, meals, collections, skipped } */
function parseUpload(buf, filename = '') {
  const out = { format: '', items: [], lists: [], meals: [], collections: [], skipped: 0 };
  const add = (r, fallbackPhoto) => {
    if (!r?.data) { out.skipped++; return; }
    out.items.push({ data: r.data, photo: r.photo || fallbackPhoto || null });
    if (r.format && !out.format) out.format = r.format;
  };
  if (isZip(buf)) {
    const entries = readZip(buf);
    const byName = new Map(entries.map((e) => [e.name, e]));
    if (byName.has('simmer.json')) return parseBackup(entries, out);
    for (const e of entries) if (/\.paprikarecipe$/i.test(e.name)) {
      let j = null;
      try { j = parseJson(zlib.gunzipSync(e.read())); } catch { /* skip */ }
      const p = j && fromPaprika(j);
      if (p) { out.items.push(p); out.format = 'Paprika'; } else out.skipped++;
    }
    if (out.items.length || out.skipped) return out;
    // Cookbook / Mealie export: a folder per recipe, with the recipe's JSON and its photo next to it
    const photos = entries.filter((e) => IMG.test(e.name));
    for (const e of entries) {
      if (!/\.json$/i.test(e.name) || /(^|\/)(manifest|categories|tags|settings|users|groups|shopping|mealplan)[^/]*\.json$/i.test(e.name) || e.size > 5_000_000) continue;
      const r = recipeFromJson(parseJson(e.read()));
      if (!r) { out.skipped++; continue; }
      const dir = dirOf(e.name);
      const near = photos.filter((p) => (dir ? p.name.startsWith(dir + '/') : !p.name.includes('/')));
      const best = near.find((p) => /(?:^|\/)(?:full|original|image|photo)\.[a-z]+$/i.test(p.name)) || near.find((p) => !/thumb|min-|tiny/i.test(p.name)) || null;
      let photo = null;
      try { photo = best ? best.read() : null; } catch { /* no photo */ }
      add(r, imageType(photo) ? photo : null);
    }
    return out;
  }
  const name = filename.toLowerCase();
  if (/\.paprikarecipe$/.test(name) || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    let j = null;
    try { j = parseJson(zlib.gunzipSync(buf)); } catch { /* skip */ }
    const p = j && fromPaprika(j);
    if (p) { out.items.push(p); out.format = 'Paprika'; } else out.skipped++;
    return out;
  }
  const j = parseJson(buf);
  if (j == null) throw Object.assign(new Error('Simmer could not read that file. Use a .zip, .paprikarecipes or .json file from another recipe app.'), { status: 422 });
  if (j.format === 'simmer-backup') throw Object.assign(new Error('That is a Simmer backup, which is a .zip file. Choose the .zip.'), { status: 422 });
  for (const x of Array.isArray(j) ? j : [j]) add(recipeFromJson(x));
  return out;
}

/* ---------- Simmer backup ---------- */
/**
 * recipes: [{ rec, photo }]  lists: [{ id, name, items, categories, auto, template }]  meals: [{ ... }]
 * Owner and sharing are left out: a backup restores into whoever imports it.
 */
function buildBackup({ recipes, lists, meals, collections, account }) {
  const files = [{ name: 'simmer.json', data: JSON.stringify({ format: 'simmer-backup', version: 1, exportedAt: new Date().toISOString(), account: account || '' }, null, 2) }];
  for (const { rec, photo } of recipes) {
    const { owner, users, households, image, imageCheck, ...keep } = rec;
    const ext = imageType(photo);
    files.push({ name: `recipes/${rec.id}.json`, data: JSON.stringify({ format: 'simmer-recipe', recipe: { ...keep, image: ext ? `images/${rec.id}.${ext}` : null } }, null, 2) });
    if (ext) files.push({ name: `images/${rec.id}.${ext}`, data: photo });
  }
  files.push({ name: 'collections.json', data: JSON.stringify(collections || []) });
  files.push({ name: 'lists.json', data: JSON.stringify((lists || []).map(({ owner, users, households, ...l }) => l), null, 2) });
  files.push({ name: 'meals.json', data: JSON.stringify((meals || []).map(({ owner, users, households, ...m }) => m), null, 2) });
  return writeZip(files);
}

function parseBackup(entries, out) {
  const by = new Map(entries.map((e) => [e.name, e]));
  const json = (n) => (by.has(n) ? parseJson(by.get(n).read()) : null);
  out.format = 'Simmer backup';
  for (const e of entries) {
    const m = /^recipes\/[^/]+\.json$/.exec(e.name);
    if (!m) continue;
    const j = parseJson(e.read());
    if (!j?.recipe?.title) { out.skipped++; continue; }
    const { image, id, ...rest } = j.recipe;
    let photo = null;
    if (image && by.has(image)) { try { photo = by.get(image).read(); } catch { /* none */ } }
    out.items.push({ data: { ...rest, externalId: `simmer:${id}`, importedFrom: rest.method || 'simmer', _was: id }, photo: imageType(photo) ? photo : null });
  }
  out.collections = Array.isArray(json('collections.json')) ? json('collections.json').map(String) : [];
  out.lists = Array.isArray(json('lists.json')) ? json('lists.json') : [];
  out.meals = Array.isArray(json('meals.json')) ? json('meals.json') : [];
  return out;
}

/** Recipes as the cookbook layout (one folder per recipe) used by Nextcloud Cookbook, readable by Mealie, Tandoor and more. */
function buildCookbook(recipes) {
  const files = [], used = new Set();
  for (const { rec, photo } of recipes) {
    let dir = safeName(rec.title), n = 1;
    while (used.has(dir.toLowerCase())) dir = `${safeName(rec.title)} (${++n})`;
    used.add(dir.toLowerCase());
    const ext = imageType(photo);
    files.push({ name: `${dir}/recipe.json`, data: JSON.stringify(toSchemaOrg(rec, ext ? `full.${ext}` : undefined), null, 2) });
    if (ext) files.push({ name: `${dir}/full.${ext}`, data: photo });
  }
  return writeZip(files);
}

const buildPaprika = (recipes) => writeZip(recipes.map(({ rec, photo }) => toPaprika(rec, imageType(photo) ? photo : null)));

/* ---------- lists and meal plan as plain files ---------- */
const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function listsCsv(lists) {
  const rows = [['List', 'Item', 'Quantity', 'Notes', 'Checked', 'Category']];
  for (const l of lists) for (const i of l.items || []) rows.push([l.name, i.name, i.quantity, i.details, i.checked ? 'yes' : '', i.aisle]);
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const SLOT_HOURS = { breakfast: [8, 9], lunch: [12, 13], snack: [15, 16], dinner: [18, 19] };
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function mealPlanIcs(meals) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Simmer//Meal plan//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Simmer meal plan'];
  for (const m of meals) {
    const d = String(m.date).replace(/-/g, ''), [a, b] = SLOT_HOURS[m.slot] || SLOT_HOURS.dinner, hh = (n) => String(n).padStart(2, '0');
    const title = m.title || m.recipeTitle || 'Meal';
    out.push('BEGIN:VEVENT', `UID:${m.id}@simmer`, `DTSTAMP:${stamp}`, `DTSTART:${d}T${hh(a)}0000`, `DTEND:${d}T${hh(b)}0000`,
      `SUMMARY:${icsText(`${m.slot[0].toUpperCase()}${m.slot.slice(1)}: ${title}`)}`,
      ...(m.servings || m.note ? [`DESCRIPTION:${icsText([m.servings ? `${m.servings} servings` : '', m.note].filter(Boolean).join('\n'))}`] : []), 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.join('\r\n') + '\r\n';
}

/* ---------- Mealie, live ---------- */
class MealieError extends Error {}

class MealieClient {
  constructor(url, token, { allowPrivate = false, fetchImpl } = {}) {
    let u;
    try { u = new URL(String(url).trim()); } catch { throw new MealieError('Enter the address of your Mealie server, for example http://192.168.1.20:9925'); }
    if (!/^https?:$/.test(u.protocol)) throw new MealieError('The address must start with http:// or https://');
    this.base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    this.token = String(token || '').trim().replace(/^Bearer\s+/i, '');
    if (!this.token) throw new MealieError('Enter a Mealie API token (Mealie: your profile, then API tokens)');
    this.allowPrivate = allowPrivate;
    this.fetch = fetchImpl || fetch;
  }

  async call(method, path, { json, form, raw } = {}) {
    await assertPublic(this.base + path, this.allowPrivate).catch((e) => { throw new MealieError(e.message); });
    let res;
    try {
      res = await this.fetch(this.base + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(60000), body: json !== undefined ? JSON.stringify(json) : form,
        headers: { authorization: `Bearer ${this.token}`, accept: raw ? '*/*' : 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}) },
      });
    } catch (e) {
      const code = String(e.cause?.code || e.message);
      if (/ENOTFOUND|EAI_AGAIN/.test(code)) throw new MealieError('Simmer cannot find that address. Check the spelling, and that Simmer can reach Mealie.');
      if (/ECONNREFUSED|ETIMEDOUT|TimeoutError|aborted/i.test(code + e.name)) throw new MealieError('Mealie did not answer at that address. Check the address and port.');
      throw new MealieError(`Could not reach Mealie (${code}).`);
    }
    if (res.status >= 300 && res.status < 400) throw new MealieError(`Mealie sent Simmer to ${res.headers.get('location') || 'another address'}. Use that address instead.`);
    if (res.status === 401 || res.status === 403) throw new MealieError('Mealie refused that token. Create a new API token in Mealie and try again.');
    if (res.status === 404 && !raw) throw new MealieError(`Mealie did not understand a request (${method} ${path}). Is this a Mealie address, and is Mealie up to date?`);
    if (!res.ok && !raw) throw new MealieError(`Mealie answered ${res.status} to ${method} ${path}.`);
    if (raw) return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { throw new MealieError('That address answered, but not like Mealie. Check the address.'); }
  }

  async check() { const me = await this.call('GET', '/api/users/self'); return me?.username || me?.fullName || 'Mealie'; }

  /** Every recipe's summary (name, slug, id), page by page. */
  async list() {
    const out = [];
    for (let page = 1; page < 500; page++) {
      const j = await this.call('GET', `/api/recipes?page=${page}&perPage=100&orderBy=name&orderDirection=asc`);
      const items = j?.items || (Array.isArray(j) ? j : []);
      out.push(...items);
      const total = Number(j?.total ?? 0);
      if (!items.length || items.length < 100 || (total && out.length >= total)) break;
    }
    return out;
  }
  recipe(slug) { return this.call('GET', `/api/recipes/${encodeURIComponent(slug)}`); }
  async photo(id) { return this.call('GET', `/api/media/recipes/${encodeURIComponent(id)}/images/original.webp`, { raw: true }); }

  async categories() {
    try {
      const j = await this.call('GET', '/api/organizers/categories?perPage=1000');
      return new Map((j?.items || []).map((c) => [String(c.name).toLowerCase(), c]));
    } catch { return null; }
  }
  async ensureCategory(known, name) {
    const key = name.toLowerCase();
    if (known?.has(key)) return known.get(key);
    const made = await this.call('POST', '/api/organizers/categories', { json: { name } });
    if (made?.id) { known?.set(key, made); return made; }
    return null;
  }

  /** Create one recipe in Mealie from a Simmer recipe. */
  async create(rec, photo, known) {
    const slug = await this.call('POST', '/api/recipes', { json: { name: rec.title } });
    if (typeof slug !== 'string') throw new MealieError('Mealie did not accept the new recipe.');
    const cur = await this.recipe(slug);
    const servings = Number((String(rec.yield || '').match(/\d+(?:[.,]\d+)?/) || [])[0]?.replace(',', '.')) || 0;
    const cats = [];
    for (const c of rec.collections || []) { try { const o = await this.ensureCategory(known, c); if (o) cats.push({ id: o.id, name: o.name, slug: o.slug }); } catch { /* categories are optional */ } }
    const body = {
      ...cur, description: rec.description || '', recipeServings: servings, recipeYieldQuantity: servings, recipeYield: rec.yield || '',
      prepTime: timeText(rec.prepMinutes) || null, cookTime: timeText(rec.cookMinutes) || null, totalTime: timeText(rec.totalMinutes) || null,
      orgURL: rec.sourceUrl || null, rating: rec.rating || null,
      recipeIngredient: (rec.ingredients || []).map((t) => ({ referenceId: uuid(), title: null, note: t, originalText: t, display: t, quantity: 0, unit: null, food: null, isFood: false, disableAmount: true })),
      recipeInstructions: (rec.steps || []).map((text) => ({ id: uuid(), title: '', summary: '', text, ingredientReferences: [] })),
      notes: rec.notes ? [{ title: 'Notes', text: rec.notes }] : [], recipeCategory: cats,
      extras: { ...(cur.extras || {}), simmer_id: rec.id },
    };
    await this.call('PUT', `/api/recipes/${encodeURIComponent(slug)}`, { json: body });
    if (photo && imageType(photo)) {
      const ext = imageType(photo), form = new FormData();
      form.append('image', new Blob([photo], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), `image.${ext}`);
      form.append('extension', ext);
      await this.call('PUT', `/api/recipes/${encodeURIComponent(slug)}/image`, { form });
    }
    return slug;
  }
}

const friendly = (e) => (e instanceof MealieError ? e.message : String(e?.message || e).slice(0, 300));

/** Pull every recipe from Mealie. upsert(data, photo) saves one into Simmer. progress(patch) reports. */
async function importFromMealie(client, { upsert, progress, state }) {
  progress({ phase: 'login' });
  await client.check();
  progress({ phase: 'fetching' });
  const all = await client.list();
  progress({ phase: 'recipes', total: all.length });
  for (const s of all) {
    try {
      const full = await client.recipe(s.slug || s.id);
      const data = fromMealie(full);
      if (!data) { progress({ skipped: state().skipped + 1 }); continue; }
      const photo = s.image || full.image ? await client.photo(full.id || s.id).catch(() => null) : null;
      const res = upsert(data, imageType(photo) ? photo : null);
      progress({ done: state().done + 1, photos: state().photos + (res?.image ? 1 : 0) });
    } catch (e) {
      progress({ failed: state().failed + 1, errors: state().errors.length < 20 ? [...state().errors, `${s.name || s.slug}: ${friendly(e)}`] : state().errors });
      if (e instanceof MealieError && /refused that token|cannot find|did not answer/.test(e.message)) throw e;
    }
  }
  progress({ phase: 'done' });
}

/** Push Simmer recipes to Mealie. Recipes Mealie already has (same name) are left alone. */
async function exportToMealie(client, recipes, { progress, state }) {
  progress({ phase: 'login' });
  await client.check();
  progress({ phase: 'fetching' });
  const have = new Set((await client.list()).map((r) => String(r.name || '').trim().toLowerCase()));
  const known = await client.categories();
  progress({ phase: 'recipes', total: recipes.length });
  for (const { rec, photo } of recipes) {
    try {
      if (have.has(rec.title.trim().toLowerCase())) { progress({ skipped: state().skipped + 1 }); continue; }
      await client.create(rec, photo, known);
      have.add(rec.title.trim().toLowerCase());
      progress({ done: state().done + 1, photos: state().photos + (photo ? 1 : 0) });
    } catch (e) {
      progress({ failed: state().failed + 1, errors: state().errors.length < 20 ? [...state().errors, `${rec.title}: ${friendly(e)}`] : state().errors });
      if (e instanceof MealieError && /refused that token|cannot find|did not answer/.test(e.message)) throw e;
    }
  }
  progress({ phase: 'done' });
}

/* ---------- one background job per person (Mealie runs can take minutes) ---------- */
class ExchangeJob {
  constructor() { this.state = { state: 'idle' }; }
  status() { return { ...this.state, errors: [...(this.state.errors || [])] }; }
  set(patch) { this.state = { ...this.state, ...patch }; }
  start(kind, run) {
    if (this.state.state === 'running') throw Object.assign(new Error('Something is already being moved. Wait for it to finish.'), { status: 409 });
    this.state = { state: 'running', kind, phase: 'login', total: 0, done: 0, failed: 0, skipped: 0, photos: 0, errors: [], startedAt: new Date().toISOString() };
    run((patch) => this.set(patch), () => this.state)
      .then(() => this.set({ state: 'done' }))
      .catch((e) => this.set({ state: 'error', error: friendly(e) }));
  }
}

module.exports = {
  minutesOf, isoDuration, timeText, toSchemaOrg, fromSchemaOrg, toPaprika, fromPaprika, fromMealie, looksLikeMealie, recipeFromJson, parseUpload,
  buildBackup, parseBackup, buildCookbook, buildPaprika, listsCsv, mealPlanIcs, MealieClient, MealieError, importFromMealie, exportToMealie, ExchangeJob, imageType,
};
