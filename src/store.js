'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Scale = require('../public/scale');
const { parseIngredient, AISLES } = require('./ingredients');

const uuid = () => crypto.randomUUID();
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Tiny JSON-file store: one file per recipe under DATA_DIR/recipes. No native deps. */
class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'recipes');
    this.imageDir = path.join(dataDir, 'images');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.imageDir, { recursive: true });
  }
  file(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(new Error('Bad id'), { status: 400 });
    return path.join(this.dir, `${id}.json`);
  }
  list() {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  get(id) {
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch (e) { if (e.status) throw e; return null; }
  }
  findByExternal(externalId) {
    return this.list().find((r) => r.externalId === externalId) || null;
  }
  create(recipe) {
    const rec = { notes: '', users: [], households: [], ...recipe, id: uuid(), savedAt: recipe.savedAt || new Date().toISOString() };
    writeJson(this.file(rec.id), rec);
    return rec;
  }
  setShare(id, share) { const r = this.get(id); if (!r) return null; r.users = share.users; r.households = share.households; this.write(r); return r; }
  /** Give users/households access without removing anyone (used when a meal is shared). */
  grant(id, share) {
    const r = this.get(id); if (!r) return;
    r.users = [...new Set([...(r.users || []), ...share.users])];
    r.households = [...new Set([...(r.households || []), ...share.households])];
    this.write(r);
  }
  write(rec) { writeJson(this.file(rec.id), rec); }
  update(id, patch) {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur };
    for (const k of ['title', 'notes', 'ingredients', 'steps', 'yield', 'rating']) if (k in patch) next[k] = patch[k];
    this.write(next);
    return next;
  }
  remove(id) {
    const cur = this.get(id);
    if (!cur) return false;
    fs.unlinkSync(this.file(id));
    if (cur.image?.startsWith('/images/')) fs.rmSync(path.join(this.imageDir, path.basename(cur.image)), { force: true });
    return true;
  }
  /** Save image bytes for a recipe; returns the public path or null if not a known image type. */
  saveImage(id, buf) {
    const ext = buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg'
      : buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png'
      : buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null;
    if (!ext) return null;
    fs.writeFileSync(path.join(this.imageDir, `${id}.${ext}`), buf);
    return `/images/${id}.${ext}`;
  }
}

/* ---------- shopping lists ---------- */
const fmtNum = (n) => {
  const whole = Math.floor(n + 1e-9), f = n - whole;
  const sym = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']].find(([v]) => Math.abs(f - v) < 0.02);
  if (f < 0.02) return String(whole);
  if (sym) return (whole ? whole + ' ' : '') + sym[1];
  return String(Math.round(n * 10) / 10);
};
/** Leading "number unit" of a quantity string, e.g. "350 g (¾ lb)" -> { n: 350, unit: 'g' }. */
function primary(q) {
  const m = String(q || '').trim().match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[¼½¾⅓⅔⅛⅜⅝⅞]?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*([A-Za-zÀ-ÿ.]*)/);
  if (!m) return null;
  const n = Scale.toNumber(m[1]);
  return Number.isFinite(n) && n > 0 ? { n, unit: m[2].toLowerCase().replace(/\.$/, '').replace(/s$/, '') } : null;
}
/** Add two quantities of the same item when they share the same first unit; otherwise null. */
function mergeQuantity(a, b) {
  const pa = primary(a), pb = primary(b);
  if (!pa || !pb || pa.unit !== pb.unit) return null;
  const total = pa.n + pb.n;
  if (!pa.unit && !/[(]/.test(a)) return fmtNum(total);
  if (!pa.unit) return null;
  const out = Scale.scaleLine(a, total / pa.n, { lang: /[àéèêç]|tasse|c\. à/i.test(a + b) ? 'fr' : 'en' });
  return out === a ? null : out;
}

const newItem = (i, p, extra = {}) => ({
  id: uuid(), name: p.name.slice(0, 200), quantity: String(p.quantity || '').slice(0, 80), details: String(i.details || '').slice(0, 200),
  checked: !!i.checked, key: p.key, aisle: p.aisle, store: '', addedAt: new Date().toISOString(), ...extra,
});

class ListStore {
  /** accounts supplies the learned aisle corrections shared by the whole instance. */
  constructor(dataDir, accounts) {
    this.file = path.join(dataDir, 'lists.json');
    this.accounts = accounts;
    if (!fs.existsSync(this.file)) writeJson(this.file, { lists: [] });
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  mutate(fn) { const db = this.read(); const out = fn(db); writeJson(this.file, db); return out; }
  all() { return this.read().lists; }
  get(id) { return this.read().lists.find((l) => l.id === id) || null; }
  find(db, id) { return db.lists.find((l) => l.id === id); }
  learned() { return this.accounts?.db.learned || {}; }

  blank(owner, name, extra = {}) {
    return { id: uuid(), name: String(name).slice(0, 80), owner, users: [], households: [], aisleOrder: [], stores: [], aisleStores: {}, itemStores: {}, items: [], ...extra };
  }
  createList(owner, name, share, externalId) {
    return this.mutate((db) => { const l = this.blank(owner, name, { externalId, ...(share || {}) }); db.lists.push(l); return l; });
  }
  deleteList(id) { return this.mutate((db) => { const n = db.lists.length; db.lists = db.lists.filter((l) => l.id !== id); return db.lists.length < n; }); }
  setShare(id, share) { return this.mutate((db) => { const l = this.find(db, id); if (!l) return null; l.users = share.users; l.households = share.households; return l; }); }

  /** The store an item belongs in: remembered per item first, then the store assigned to its aisle. */
  storeFor(l, key, aisle) { return l.itemStores[key] || l.aisleStores[aisle] || ''; }

  /**
   * Add items. Lines from recipes ("1 ½ lb (675 g) poulet") are recognized: name, quantity, aisle and store
   * are filled in, water is skipped, and an item already on the list with the same unit is summed.
   */
  addItems(listId, items, { skipStaples = false } = {}) {
    const learned = this.learned();
    return this.mutate((db) => {
      const l = this.find(db, listId);
      if (!l) return null;
      for (const i of items) {
        const raw = String(i.name || '').trim();
        if (!raw) continue;
        const explicit = i.quantity != null && String(i.quantity).trim() !== '';
        const p = explicit ? { ...parseIngredient(raw, learned), name: raw, quantity: String(i.quantity) } : parseIngredient(raw, learned);
        if (skipStaples && p.skip) continue;
        const dup = l.items.find((x) => !x.checked && x.key === p.key && p.key);
        if (dup) {
          const sum = mergeQuantity(dup.quantity, p.quantity);
          if (sum) { dup.quantity = sum; if (i.details && !dup.details.includes(i.details)) dup.details = (dup.details ? dup.details + ', ' : '') + i.details; continue; }
          if (!dup.quantity && !p.quantity) continue;       // "milk" already on the list
        }
        const it = newItem(i, p);
        it.store = i.store || this.storeFor(l, p.key, p.aisle);
        l.items.push(it);
      }
      return l;
    });
  }
  updateItem(listId, itemId, patch) {
    let learnAisle = null;
    const it = this.mutate((db) => {
      const l = this.find(db, listId);
      const it = l?.items.find((x) => x.id === itemId);
      if (!it) return null;
      for (const k of ['name', 'quantity', 'details']) if (k in patch) it[k] = String(patch[k]).slice(0, 200);
      if ('checked' in patch) it.checked = !!patch.checked;
      if ('aisle' in patch && AISLES.includes(patch.aisle) && patch.aisle !== it.aisle) { it.aisle = patch.aisle; learnAisle = [it.key, patch.aisle]; }
      if ('store' in patch) {
        const ok = patch.store === '' || l.stores.some((s) => s.id === patch.store);
        if (ok) { it.store = patch.store; if (it.key) { if (patch.store) l.itemStores[it.key] = patch.store; else delete l.itemStores[it.key]; } }
      }
      return it;
    });
    if (learnAisle) this.accounts?.learnAisle(...learnAisle);
    return it;
  }
  deleteItem(listId, itemId) {
    return this.mutate((db) => { const l = this.find(db, listId); if (!l) return false; const n = l.items.length; l.items = l.items.filter((x) => x.id !== itemId); return l.items.length < n; });
  }
  clearChecked(listId) { return this.mutate((db) => { const l = this.find(db, listId); if (!l) return null; l.items = l.items.filter((x) => !x.checked); return l; }); }

  /** Rename, reorder aisles, define stores, and say which aisle is bought at which store. */
  settings(listId, b) {
    return this.mutate((db) => {
      const l = this.find(db, listId);
      if (!l) return null;
      if (b.name != null && String(b.name).trim()) l.name = String(b.name).trim().slice(0, 80);
      const order = (o) => (Array.isArray(o) ? [...new Set(o.filter((a) => AISLES.includes(a)))] : []);
      if ('aisleOrder' in b) l.aisleOrder = order(b.aisleOrder);
      if (Array.isArray(b.stores)) {
        l.stores = b.stores.slice(0, 20).map((s) => ({ id: /^[\w-]{1,40}$/.test(s.id || '') ? s.id : uuid(), name: String(s.name || '').trim().slice(0, 40), order: s.order ? order(s.order) : null })).filter((s) => s.name);
        const ids = new Set(l.stores.map((s) => s.id));
        for (const it of l.items) if (it.store && !ids.has(it.store)) it.store = '';
        for (const [k, v] of Object.entries(l.itemStores)) if (!ids.has(v)) delete l.itemStores[k];
      }
      if (b.aisleStores && typeof b.aisleStores === 'object') {
        const ids = new Set(l.stores.map((s) => s.id));
        l.aisleStores = Object.fromEntries(Object.entries(b.aisleStores).filter(([a, s]) => AISLES.includes(a) && ids.has(s)));
        // Re-sort items that were not placed by hand.
        for (const it of l.items) if (!it.checked && !l.itemStores[it.key]) it.store = l.aisleStores[it.aisle] || '';
      }
      return l;
    });
  }
  /** Idempotent import from another app: replaces the items of a list previously imported with the same externalId. */
  importList({ externalId, name, items, owner }) {
    const learned = this.learned();
    return this.mutate((db) => {
      let l = externalId && db.lists.find((x) => x.externalId === externalId);
      if (!l) { l = this.blank(owner, name || 'Imported', { externalId }); db.lists.push(l); }
      l.items = [];
      for (const i of items || []) {
        const n = String(i.name || '').trim();
        if (!n) continue;
        const p = parseIngredient(n, learned);
        l.items.push(newItem(i, { ...p, name: n, quantity: i.quantity || p.quantity }, { store: this.storeFor(l, p.key, p.aisle) }));
      }
      return l;
    });
  }
  claimOrphans(ownerId) { this.mutate((db) => { for (const l of db.lists) if (!l.owner) Object.assign(l, { owner: ownerId, users: l.users || [], households: l.households || [], aisleOrder: l.aisleOrder || [], stores: l.stores || [], aisleStores: l.aisleStores || {}, itemStores: l.itemStores || {} }); }); }
}

/* ---------- meal plan ---------- */
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
class MealStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'meals.json');
    if (!fs.existsSync(this.file)) writeJson(this.file, { meals: [] });
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  mutate(fn) { const db = this.read(); const out = fn(db); writeJson(this.file, db); return out; }
  all() { return this.read().meals; }
  get(id) { return this.all().find((m) => m.id === id) || null; }
  create(owner, b, share) {
    if (!DATE_RE.test(b.date || '')) throw Object.assign(new Error('Pick a date'), { status: 400 });
    const m = {
      id: uuid(), owner, date: b.date, slot: SLOTS.includes(b.slot) ? b.slot : 'dinner',
      recipeId: b.recipeId || null, title: String(b.title || '').trim().slice(0, 200),
      servings: Number.isFinite(+b.servings) && +b.servings > 0 ? +b.servings : null, note: String(b.note || '').slice(0, 500),
      users: share.users, households: share.households,
    };
    if (!m.recipeId && !m.title) throw Object.assign(new Error('Pick a recipe or type a name'), { status: 400 });
    return this.mutate((db) => { db.meals.push(m); return m; });
  }
  update(id, b, share) {
    return this.mutate((db) => {
      const m = db.meals.find((x) => x.id === id);
      if (!m) return null;
      if (DATE_RE.test(b.date || '')) m.date = b.date;
      if (SLOTS.includes(b.slot)) m.slot = b.slot;
      if ('title' in b) m.title = String(b.title).trim().slice(0, 200);
      if ('note' in b) m.note = String(b.note).slice(0, 500);
      if ('servings' in b) m.servings = Number.isFinite(+b.servings) && +b.servings > 0 ? +b.servings : null;
      if (share) { m.users = share.users; m.households = share.households; }
      return m;
    });
  }
  remove(id) { return this.mutate((db) => { const n = db.meals.length; db.meals = db.meals.filter((m) => m.id !== id); return db.meals.length < n; }); }
  /** A guest removing a shared meal only takes it off their own plan. */
  leave(id, userId) { return this.mutate((db) => { const m = db.meals.find((x) => x.id === id); if (m) m.users = m.users.filter((u) => u !== userId); return m; }); }
  claimOrphans(ownerId) { this.mutate((db) => { for (const m of db.meals) if (!m.owner) m.owner = ownerId; }); }
}

module.exports = { Store, ListStore, MealStore, mergeQuantity, SLOTS };
