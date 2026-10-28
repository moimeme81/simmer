'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { extractRecipe } = require('./extract');
const { Store, ListStore } = require('./store');
const { AnyListImport } = require('./anylist');

const cfg = {
  port: +process.env.PORT || 3000,
  dataDir: process.env.DATA_DIR || '/data',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.LLM_MODEL || 'claude-haiku-5-5',
  allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true',
  authUser: process.env.AUTH_USER || '',
  authPass: process.env.AUTH_PASS || '',
};

const store = new Store(cfg.dataDir);
const lists = new ListStore(cfg.dataDir);
const app = express();
app.disable('x-powered-by');

// Bulk-import endpoints carry photos as base64, so they get a larger body limit.
const small = express.json({ limit: '1mb' });
const big = express.json({ limit: '25mb' });
app.use((req, res, next) => (req.path.startsWith('/api/import/') && req.path !== '/api/import/' ? big : small)(req, res, next));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Optional HTTP basic auth (everything except /healthz)
if (cfg.authUser && cfg.authPass) {
  const safeEq = (a, b) => {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
  };
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const [u, ...p] = Buffer.from(encoded, 'base64').toString().split(':');
      if (safeEq(u, cfg.authUser) & safeEq(p.join(':'), cfg.authPass)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Simmer"').status(401).send('Authentication required');
  });
}

const notFound = (res) => res.status(404).json({ error: 'Not found' });
const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const strArr = (v, max = 500) => (Array.isArray(v) ? v.map((x) => str(x, 2000).trim()).filter(Boolean).slice(0, max) : []);

/* ---------- recipes ---------- */
app.get('/api/config', (_req, res) => res.json({ ai: !!cfg.anthropicKey }));
app.get('/api/recipes', (_req, res) => res.json(store.list()));
app.get('/api/recipes/:id', (req, res) => { const r = store.get(req.params.id); r ? res.json(r) : notFound(res); });
app.put('/api/recipes/:id', (req, res) => { const r = store.update(req.params.id, req.body || {}); r ? res.json(r) : notFound(res); });
app.delete('/api/recipes/:id', (req, res) => (store.remove(req.params.id) ? res.json({ ok: true }) : notFound(res)));

app.post('/api/import', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Missing url' });
    new URL(url); // validates
    const recipe = await extractRecipe(url, cfg);
    res.json(store.create(recipe));
  } catch (e) {
    res.status(e instanceof TypeError && /Invalid URL/.test(e.message) ? 400 : 422).json({ error: e.message });
  }
});

/**
 * Create or update one recipe imported from another app. Idempotent: a recipe with the
 * same externalId is updated, not duplicated. Used by the bulk endpoint and the AnyList job.
 */
function upsertImported(b, photoBuf) {
  const title = str(b.title, 300).trim();
  const ingredients = strArr(b.ingredients);
  const steps = strArr(b.steps);
  if (!title || (!ingredients.length && !steps.length)) throw Object.assign(new Error('Recipe needs a title and ingredients or steps'), { status: 400 });
  const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : null);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const base = {
    title, description: '', author: null,
    yield: b.yield ? str(b.yield, 100) : null,
    prepMinutes: num(b.prepMinutes), cookMinutes: num(b.cookMinutes), totalMinutes: null,
    ingredients, steps, notes: str(b.notes, 10000),
    rating: num(b.rating) ? Math.min(5, num(b.rating)) : null,
    sourceUrl: /^https?:\/\//.test(b.sourceUrl || '') ? str(b.sourceUrl, 2000) : null,
    host: str(b.sourceName || hostOf(b.sourceUrl || '') || 'Imported', 200),
    method: str(b.importedFrom || 'import', 40),
    externalId: b.externalId ? str(b.externalId, 100) : undefined,
  };
  const existing = base.externalId && store.findByExternal(base.externalId);
  let rec = existing ? { ...existing, ...base, id: existing.id, savedAt: existing.savedAt } : store.create({ ...base, image: null });
  if (existing) store.write(rec);
  if (photoBuf?.length) {
    const img = store.saveImage(rec.id, photoBuf);
    if (img) { rec = { ...rec, image: img }; store.write(rec); }
  }
  return { id: rec.id, updated: !!existing, image: !!rec.image };
}

app.post('/api/import/bulk/recipe', (req, res) => {
  const b = req.body || {};
  res.json(upsertImported(b, b.photoBase64 ? Buffer.from(String(b.photoBase64), 'base64') : null));
});

app.post('/api/import/bulk/list', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'List needs a name' });
  const l = lists.importList({ externalId: b.externalId ? str(b.externalId, 100) : undefined, name: str(b.name, 80), items: Array.isArray(b.items) ? b.items.slice(0, 5000) : [] });
  res.json({ id: l.id, items: l.items.length });
});

/* ---------- AnyList import from the web UI ---------- */
const anylistJob = new AnyListImport({
  upsertRecipe: upsertImported,
  importList: (l) => lists.importList(l),
  allowPrivate: cfg.allowPrivate,
});
app.post('/api/import/anylist', (req, res) => {
  const email = str(req.body?.email, 200).trim();
  const password = str(req.body?.password, 500);
  if (!email || !password) return res.status(400).json({ error: 'Enter your AnyList email and password' });
  anylistJob.start(email, password); // throws 409 if one is already running
  res.status(202).json({ started: true });
});
app.get('/api/import/anylist/status', (_req, res) => res.json(anylistJob.status()));

/* ---------- self-update (see launcher.js) ---------- */
app.get('/api/update/status', (_req, res) => {
  let st = {};
  try { st = JSON.parse(require('node:fs').readFileSync(path.join(cfg.dataDir, 'update-status.json'), 'utf8')); } catch { /* launcher not running (dev) */ }
  res.json({ enabled: process.env.AUTO_UPDATE === 'true' && !!process.env.SIMMER_LAUNCHER_PID, ...st });
});
app.post('/api/update/check', (_req, res) => {
  const pid = +process.env.SIMMER_LAUNCHER_PID;
  if (process.env.AUTO_UPDATE !== 'true' || !pid) return res.status(400).json({ error: 'Auto-update is off. Set AUTO_UPDATE to true on the container.' });
  process.kill(pid, 'SIGUSR1');
  res.status(202).json({ started: true });
});

/* ---------- shopping lists ---------- */
app.get('/api/lists', (_req, res) => res.json(lists.all()));
app.post('/api/lists', (req, res) => {
  const name = str(req.body?.name, 80).trim();
  name ? res.json(lists.createList(name)) : res.status(400).json({ error: 'Missing name' });
});
app.delete('/api/lists/:id', (req, res) => (lists.deleteList(req.params.id) ? res.json({ ok: true }) : notFound(res)));
app.post('/api/lists/:id/items', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  const l = lists.addItems(req.params.id, items);
  l ? res.json(l) : notFound(res);
});
app.patch('/api/lists/:id/items/:itemId', (req, res) => {
  const it = lists.updateItem(req.params.id, req.params.itemId, req.body || {});
  it ? res.json(it) : notFound(res);
});
app.delete('/api/lists/:id/items/:itemId', (req, res) => (lists.deleteItem(req.params.id, req.params.itemId) ? res.json({ ok: true }) : notFound(res)));
app.post('/api/lists/:id/clear-checked', (req, res) => { const l = lists.clearChecked(req.params.id); l ? res.json(l) : notFound(res); });
app.post('/api/recipes/:id/to-list', (req, res) => {
  const r = store.get(req.params.id);
  if (!r) return notFound(res);
  const only = Array.isArray(req.body?.ingredients) ? new Set(req.body.ingredients) : null;
  const items = r.ingredients.filter((i) => !only || only.has(i)).map((name) => ({ name, details: r.title }));
  const l = lists.addItems(req.body?.listId || lists.all()[0]?.id, items);
  l ? res.json(l) : notFound(res);
});

app.use('/images', express.static(store.imageDir, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

if (require.main === module) {
  app.listen(cfg.port, '0.0.0.0', () =>
    console.log(`Simmer listening on :${cfg.port} (data: ${cfg.dataDir}, AI: ${cfg.anthropicKey ? 'on' : 'off'})`)
  );
}
module.exports = app;
