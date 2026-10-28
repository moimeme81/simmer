'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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
    const rec = { notes: '', ...recipe, id: uuid(), savedAt: recipe.savedAt || new Date().toISOString() };
    writeJson(this.file(rec.id), rec);
    return rec;
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

/** Shopping lists: one JSON file holding every list. Small and single-process, so a whole-file rewrite is fine. */
class ListStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'lists.json');
    if (!fs.existsSync(this.file)) writeJson(this.file, { lists: [{ id: uuid(), name: 'Groceries', items: [] }] });
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  mutate(fn) { const db = this.read(); const out = fn(db); writeJson(this.file, db); return out; }
  all() { return this.read().lists; }
  find(db, id) { return db.lists.find((l) => l.id === id); }

  createList(name, externalId) {
    return this.mutate((db) => {
      const l = { id: uuid(), name: String(name).slice(0, 80), externalId, items: [] };
      db.lists.push(l);
      return l;
    });
  }
  deleteList(id) {
    return this.mutate((db) => { const n = db.lists.length; db.lists = db.lists.filter((l) => l.id !== id); return db.lists.length < n; });
  }
  addItems(listId, items) {
    return this.mutate((db) => {
      const l = this.find(db, listId);
      if (!l) return null;
      for (const i of items) {
        const name = String(i.name || '').trim();
        if (!name) continue;
        l.items.push({
          id: uuid(), name: name.slice(0, 200), quantity: String(i.quantity || '').slice(0, 40),
          details: String(i.details || '').slice(0, 200), checked: !!i.checked, category: i.category ? String(i.category).slice(0, 60) : '',
          addedAt: new Date().toISOString(),
        });
      }
      return l;
    });
  }
  updateItem(listId, itemId, patch) {
    return this.mutate((db) => {
      const it = this.find(db, listId)?.items.find((x) => x.id === itemId);
      if (!it) return null;
      for (const k of ['name', 'quantity', 'details', 'checked', 'category']) if (k in patch) it[k] = k === 'checked' ? !!patch[k] : String(patch[k]);
      return it;
    });
  }
  deleteItem(listId, itemId) {
    return this.mutate((db) => { const l = this.find(db, listId); if (!l) return false; const n = l.items.length; l.items = l.items.filter((x) => x.id !== itemId); return l.items.length < n; });
  }
  clearChecked(listId) {
    return this.mutate((db) => { const l = this.find(db, listId); if (!l) return null; l.items = l.items.filter((x) => !x.checked); return l; });
  }
  /** Idempotent import from another app: replaces the items of a list previously imported with the same externalId. */
  importList({ externalId, name, items }) {
    return this.mutate((db) => {
      let l = externalId && db.lists.find((x) => x.externalId === externalId);
      if (!l) { l = { id: uuid(), name: String(name || 'Imported').slice(0, 80), externalId, items: [] }; db.lists.push(l); }
      l.items = [];
      for (const i of items || []) {
        const n = String(i.name || '').trim();
        if (n) l.items.push({ id: uuid(), name: n.slice(0, 200), quantity: String(i.quantity || ''), details: String(i.details || ''), checked: !!i.checked, category: '', addedAt: new Date().toISOString() });
      }
      return l;
    });
  }
}

module.exports = { Store, ListStore };
