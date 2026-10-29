'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Scale = require('../public/scale');
const { extractRecipe } = require('./extract');
const { Store, ListStore, MealStore, TEMPLATES } = require('./store');
const { Accounts, fail } = require('./accounts');
const { AnyListImport, downloadPhoto } = require('./anylist');
const { AISLES } = require('./ingredients');
const { PhotoFinder } = require('./photos');
const { searchImages } = require('./imagesearch');

const cfg = {
  port: +process.env.PORT || 3000,
  dataDir: process.env.DATA_DIR || '/data',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.LLM_MODEL || 'claude-haiku-5-5',
  allowPrivate: process.env.ALLOW_PRIVATE_URLS === 'true',
};

fs.mkdirSync(cfg.dataDir, { recursive: true });
const acc = new Accounts(cfg.dataDir);
const store = new Store(cfg.dataDir);
const lists = new ListStore(cfg.dataDir, acc);
const meals = new MealStore(cfg.dataDir);
const photos = new PhotoFinder({ store, allowPrivate: cfg.allowPrivate });
const avatarDir = path.join(cfg.dataDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

/** Data created before accounts existed belongs to the first admin. */
function claimOrphans() {
  const admin = acc.firstAdmin;
  if (!admin) return;
  for (const r of store.list()) if (!r.owner) store.write({ ...r, owner: admin.id, users: r.users || [], households: r.households || [] });
  lists.claimOrphans(admin.id);
  meals.claimOrphans(admin.id);
}
claimOrphans();

const app = express();
app.disable('x-powered-by');

// Bulk-import endpoints carry photos as base64, so they get a larger body limit.
const small = express.json({ limit: '1mb' });
const big = express.json({ limit: '25mb' });
app.use((req, res, next) => ((req.path.startsWith('/api/import/') && req.path !== '/api/import/') || /^\/api\/recipes\/[\w-]+\/image$/.test(req.path) ? big : small)(req, res, next));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* ---------- authentication ---------- */
const COOKIE = 'simmer_sid';
const cookieOf = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
const bearerOf = (req) => (/^Bearer (.+)$/i.exec(req.headers.authorization || '') || [])[1];
const secure = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';
const setCookie = (req, res, token) =>
  res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure(req) ? '; Secure' : ''}`);
const clearCookie = (res) => res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

app.use((req, _res, next) => {
  const r = acc.resolve({ cookie: cookieOf(req, COOKIE), bearer: bearerOf(req) });
  if (r) { req.user = r.user; req.sessionId = r.sessionId; req.viaToken = !!r.token; }
  next();
});
// A page on another site must not be able to act with a logged-in browser's cookie.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.viaToken || !req.headers.origin) return next();
  let host = '';
  try { host = new URL(req.headers.origin).host; } catch { /* malformed */ }
  if (host === req.headers.host || host === req.headers['x-forwarded-host']) return next();
  res.status(403).json({ error: 'Cross-site request refused' });
});

const need = (req, _res, next) => (req.user ? next() : next(fail(401, 'Sign in required')));
const admin = (req, _res, next) => (req.user?.admin ? next() : next(fail(403, 'Admins only')));
const wrap = (fn) => (req, res, next) => { try { const out = fn(req, res); if (out && out.catch) out.catch(next); } catch (e) { next(e); } };
const notFound = () => fail(404, 'Not found');
const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const strArr = (v, max = 500) => (Array.isArray(v) ? v.map((x) => str(x, 2000).trim()).filter(Boolean).slice(0, max) : []);
const me = (req) => req.user.id;
const myShare = (req) => ({ users: [], households: [...(req.user.autoShare || [])].filter((h) => acc.household(h)?.members.includes(me(req))) });
const nameOf = (id) => acc.user(id)?.name || '?';
const today = () => new Date().toLocaleDateString('sv-SE');

app.get('/api/auth/state', (req, res) => res.json({ setup: acc.needsSetup, user: acc.publicUser(req.user) || null, ai: !!cfg.anthropicKey }));
app.post('/api/auth/setup', wrap((req, res) => {
  const u = acc.setup(req.body || {});
  claimOrphans();
  setCookie(req, res, acc.startSession(u.id).token);
  res.json(acc.publicUser(u));
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { token } = acc.login(str(req.body?.username, 80), str(req.body?.password, 500), req.ip);
  setCookie(req, res, token);
  res.json({ ok: true });
}));
app.post('/api/auth/logout', (req, res) => { const c = cookieOf(req, COOKIE); if (c) acc.endSession(c); clearCookie(res); res.json({ ok: true }); });
app.get('/api/auth/invite/:code', (req, res) => res.json({ valid: !!acc.checkInvite(req.params.code) }));
app.post('/api/auth/register', wrap((req, res) => {
  const u = acc.register(str(req.body?.invite, 200), req.body || {});
  setCookie(req, res, acc.startSession(u.id).token);
  res.json(acc.publicUser(u));
}));

app.use('/api', (req, res, next) => (req.path.startsWith('/auth/') ? next() : need(req, res, next)));

/* ---------- me, people, tokens, admin ---------- */
app.get('/api/me', (req, res) => res.json({ ...acc.publicUser(req.user), households: acc.describeHouseholds(me(req)) }));
app.put('/api/me', wrap((req, res) => res.json(acc.publicUser(acc.updateProfile(me(req), { ...req.body, keepSession: req.sessionId })))));
app.get('/api/people', (_req, res) => res.json(acc.people()));
app.get('/api/aisles', (_req, res) => res.json(AISLES));

/* ---------- profile photos ---------- */
const AVATAR_EXT = ['jpg', 'png', 'webp'];
const avatarType = (b) => (b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpg' : b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ? 'png' : b.subarray(8, 12).toString() === 'WEBP' ? 'webp' : null);
const clearAvatarFiles = (id) => { for (const e of AVATAR_EXT) fs.rmSync(path.join(avatarDir, `${id}.${e}`), { force: true }); };
app.put('/api/me/avatar', wrap((req, res) => {
  const buf = Buffer.from(str(req.body?.image, 1_400_000), 'base64');
  const ext = buf.length > 12 && buf.length <= 1_000_000 ? avatarType(buf) : null;
  if (!ext) throw fail(400, 'Use a JPEG, PNG or WebP picture under 1 MB');
  clearAvatarFiles(me(req));
  fs.writeFileSync(path.join(avatarDir, `${me(req)}.${ext}`), buf);
  acc.setAvatar(me(req), Date.now());
  res.json({ avatar: acc.avatarUrl(acc.user(me(req))) });
}));
app.delete('/api/me/avatar', (req, res) => { clearAvatarFiles(me(req)); acc.setAvatar(me(req), null); res.json({ ok: true }); });
app.get('/avatars/:id', need, (req, res, next) => {
  if (!/^[a-f0-9-]{36}$/.test(req.params.id)) return next(notFound());
  const file = AVATAR_EXT.map((e) => path.join(avatarDir, `${req.params.id}.${e}`)).find((f) => fs.existsSync(f));
  if (!file) return next(notFound());
  res.set('Cache-Control', 'private, max-age=31536000, immutable').sendFile(file);
});

app.get('/api/tokens', (req, res) => res.json(acc.listTokens(me(req))));
app.post('/api/tokens', wrap((req, res) => res.json({ token: acc.createToken(me(req), req.body?.name) })));
app.delete('/api/tokens/:id', (req, res, next) => (acc.deleteToken(me(req), req.params.id) ? res.json({ ok: true }) : next(notFound())));

app.get('/api/admin/users', admin, (_req, res) => res.json(acc.db.users.map((u) => ({ id: u.id, name: u.name, username: u.username, admin: !!u.admin, createdAt: u.createdAt }))));
app.delete('/api/admin/users/:id', admin, wrap((req, res) => {
  if (req.params.id === me(req)) throw fail(400, 'You cannot remove yourself');
  if (!acc.removeUser(req.params.id)) throw notFound();
  clearAvatarFiles(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/admin/users/:id/reset-password', admin, wrap((req, res) => {
  const temp = acc.resetPassword(req.params.id);
  if (!temp) throw notFound();
  res.json({ password: temp });
}));
app.post('/api/admin/invites', admin, wrap((req, res) => {
  const hid = req.body?.householdId;
  if (hid && !acc.household(hid)?.members.includes(me(req))) throw fail(400, 'Pick one of your households');
  res.json({ code: acc.createInvite(me(req), hid) });
}));

/* ---------- households ---------- */
app.get('/api/households', (req, res) => res.json(acc.describeHouseholds(me(req))));
app.post('/api/households', wrap((req, res) => { const h = acc.createHousehold(me(req), req.body?.name); res.json(acc.describeHouseholds(me(req)).find((x) => x.id === h.id)); }));
app.put('/api/households/:id', wrap((req, res) => { if (!acc.renameHousehold(me(req), req.params.id, req.body?.name)) throw notFound(); res.json({ ok: true }); }));
app.post('/api/households/:id/members', wrap((req, res) => { if (!acc.addMember(me(req), req.params.id, str(req.body?.userId, 60))) throw notFound(); res.json({ ok: true }); }));
app.delete('/api/households/:id/members/:userId', wrap((req, res) => { if (!acc.removeMember(me(req), req.params.id, req.params.userId)) throw notFound(); res.json({ ok: true }); }));
app.delete('/api/households/:id', wrap((req, res) => { if (!acc.deleteHousehold(me(req), req.params.id)) throw notFound(); res.json({ ok: true }); }));

/* ---------- recipes ---------- */
const shareView = (o) => ({ users: o.users || [], households: o.households || [] });
const recipeView = (req, r) => ({ ...r, mine: r.owner === me(req), ownerName: nameOf(r.owner), sharedWith: shareView(r) });
const recipeFor = (req) => { const r = store.get(req.params.id); if (!r || !acc.canAccess(me(req), r)) throw notFound(); return r; };

app.get('/api/recipes', (req, res) => res.json(store.list().filter((r) => acc.canAccess(me(req), r)).map((r) => recipeView(req, r))));
app.get('/api/recipes/:id', wrap((req, res) => res.json(recipeView(req, recipeFor(req)))));
/** Fields a person can type into the recipe editor, cleaned. Only fields present in the body are returned. */
const cleanRecipeFields = (b) => {
  const out = {}, has = (k) => b && k in b;
  const minutes = (v) => (Number.isFinite(+v) && +v > 0 && v !== '' ? Math.min(Math.round(+v), 100000) : null);
  if (has('title')) { out.title = str(b.title, 300).trim(); if (!out.title) throw fail(400, 'Enter a title'); }
  if (has('description')) out.description = str(b.description, 3000).trim();
  if (has('yield')) out.yield = str(b.yield, 100).trim() || null;
  for (const k of ['prepMinutes', 'cookMinutes', 'totalMinutes']) if (has(k)) out[k] = minutes(b[k]);
  if (has('ingredients')) out.ingredients = strArr(b.ingredients);
  if (has('steps')) out.steps = strArr(b.steps);
  if (has('notes')) out.notes = str(b.notes, 10000);
  if (has('rating')) out.rating = minutes(b.rating) ? Math.min(5, minutes(b.rating)) : null;
  if (has('collections')) out.collections = cleanCollections(b.collections);
  if (has('sourceUrl')) {
    const u = str(b.sourceUrl, 2000).trim();
    if (u && !/^https?:\/\//i.test(u)) throw fail(400, 'The source link must start with http:// or https://');
    out.sourceUrl = u || null;
    try { out.host = u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { throw fail(400, 'Invalid URL'); }
  }
  return out;
};
app.post('/api/recipes', wrap((req, res) => {
  const f = cleanRecipeFields(req.body);
  if (!f.title) throw fail(400, 'Enter a title');
  res.json(recipeView(req, store.create({ ingredients: [], steps: [], description: '', author: null, yield: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, sourceUrl: null, host: '', method: 'manual', image: null, ...f, owner: me(req), ...myShare(req) })));
}));
app.put('/api/recipes/:id', wrap((req, res) => {
  const r = recipeFor(req);
  const patch = r.owner === me(req) ? cleanRecipeFields(req.body) : { notes: str(req.body?.notes, 10000) }; // guests can only add notes
  res.json(recipeView(req, store.update(r.id, patch)));
}));
/* Search the web for a picture, then let the owner pick one: the server downloads it, so nothing is hot-linked. */
let lastSearch = 0;
app.get('/api/image-search', wrap(async (req, res) => {
  if (Date.now() - lastSearch < 400) throw fail(429, 'Too many searches. Wait a moment and try again.');
  lastSearch = Date.now();
  const { results, errors, reached } = await searchImages(str(req.query.q, 120));
  if (errors.length) console.warn('[image-search]', errors.join(' | '));
  if (!results.length && !reached) { console.warn('[image-search]', errors.join(' | ')); throw fail(502, `Simmer could not reach the image search (${errors.join('; ')}). Check the server’s internet connection and DNS.`); }
  res.json({ results });
}));
app.post('/api/recipes/:id/image-from-url', wrap(async (req, res) => {
  const r = recipeFor(req);
  if (r.owner !== me(req)) throw fail(403, 'Only the owner can change the picture');
  const url = str(req.body?.url, 2000).trim();
  if (!/^https?:\/\//i.test(url)) throw fail(400, 'Invalid URL');
  let buf, err;
  const alt = str(req.body?.alt, 2000).trim();
  for (const u of [url, /^https?:\/\//i.test(alt) ? alt : null]) {   // some sites block hotlinking: fall back to the search engine's own copy
    if (!u || buf) continue;
    try { buf = await downloadPhoto(u, cfg.allowPrivate); } catch (e) { err = e; }
  }
  if (!buf && err) throw fail(422, err.message);
  const img = buf ? store.saveImage(r.id, buf) : null;
  if (!img) throw fail(422, 'That link did not give a JPEG, PNG or WebP picture');
  const { imageCheck, ...cur } = store.get(r.id);
  store.write({ ...cur, image: img, ...(req.body?.credit ? { imageCredit: str(req.body.credit, 200) } : {}) });
  res.json(recipeView(req, store.get(r.id)));
}));
app.put('/api/recipes/:id/image', wrap((req, res) => {
  const r = recipeFor(req);
  if (r.owner !== me(req)) throw fail(403, 'Only the owner can change the picture');
  const buf = Buffer.from(str(req.body?.image, 5_000_000), 'base64');
  const img = buf.length > 12 && buf.length <= 3_500_000 ? store.saveImage(r.id, buf) : null;
  if (!img) throw fail(400, 'Use a JPEG, PNG or WebP picture under 3 MB');
  const { imageCheck, imageCredit, ...cur } = store.get(r.id);
  store.write({ ...cur, image: img });
  res.json(recipeView(req, store.get(r.id)));
}));
app.delete('/api/recipes/:id/image', wrap((req, res) => {
  const r = recipeFor(req);
  if (r.owner !== me(req)) throw fail(403, 'Only the owner can change the picture');
  store.removeImage(r.id);
  const { imageCredit, ...cur } = store.get(r.id);
  store.write({ ...cur, image: null });
  res.json(recipeView(req, store.get(r.id)));
}));
app.put('/api/recipes/:id/share', wrap((req, res) => {
  const r = recipeFor(req);
  if (r.owner !== me(req)) throw fail(403, 'Only the owner can change sharing');
  res.json(recipeView(req, store.setShare(r.id, acc.cleanShare(me(req), req.body))));
}));
app.delete('/api/recipes/:id', wrap((req, res) => {
  const r = recipeFor(req);
  if (r.owner !== me(req)) throw fail(403, 'Only the owner can delete a recipe');
  store.remove(r.id);
  res.json({ ok: true });
}));

app.post('/api/import', wrap(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) throw fail(400, 'Missing url');
  try { new URL(url); } catch { throw fail(400, 'Invalid URL'); }
  let recipe;
  try { recipe = await extractRecipe(url, cfg); } catch (e) { throw fail(422, e.message); }
  res.json(recipeView(req, store.create({ ...recipe, owner: me(req), ...myShare(req) })));
}));

/**
 * Create or update one recipe imported from another app. Idempotent: a recipe with the
 * same externalId is updated, not duplicated. Used by the bulk endpoint and the AnyList job.
 */
/** Collection names: trimmed, unique, at most 20 of up to 40 characters. */
const cleanCollections = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
function upsertImported(b, photoBuf, owner, share) {
  const title = str(b.title, 300).trim();
  const ingredients = strArr(b.ingredients);
  const steps = strArr(b.steps);
  if (!title || (!ingredients.length && !steps.length)) throw fail(400, 'Recipe needs a title and ingredients or steps');
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
    ...(Array.isArray(b.collections) ? { collections: cleanCollections(b.collections) } : {}),
  };
  // Match on (owner, externalId) so two people importing the same AnyList recipe each get their own copy.
  const existing = base.externalId && store.list().find((r) => r.externalId === base.externalId && r.owner === owner);
  let rec = existing ? { ...existing, ...base, id: existing.id, savedAt: existing.savedAt } : store.create({ ...base, image: null, owner, ...share });
  if (existing) store.write(rec);
  if (photoBuf?.length) {
    const img = store.saveImage(rec.id, photoBuf);
    if (img) { rec = { ...rec, image: img }; store.write(rec); }
  }
  return { id: rec.id, updated: !!existing, image: !!rec.image };
}

app.post('/api/import/bulk/recipe', wrap((req, res) => {
  const b = req.body || {};
  res.json(upsertImported(b, b.photoBase64 ? Buffer.from(String(b.photoBase64), 'base64') : null, me(req), myShare(req)));
}));
app.post('/api/import/bulk/list', wrap((req, res) => {
  const b = req.body || {};
  if (!b.name) throw fail(400, 'List needs a name');
  const l = lists.importList({ owner: me(req), externalId: b.externalId ? str(b.externalId, 100) : undefined, name: str(b.name, 80), items: Array.isArray(b.items) ? b.items.slice(0, 5000) : [] });
  lists.setShare(l.id, myShare(req));
  res.json({ id: l.id, items: l.items.length });
}));

/* ---------- AnyList import from the web UI (one job per user) ---------- */
const jobs = new Map();
const jobFor = (user) => {
  if (!jobs.has(user.id)) {
    const share = () => ({ users: [], households: (acc.user(user.id)?.autoShare || []).filter((h) => acc.household(h)?.members.includes(user.id)) });
    jobs.set(user.id, new AnyListImport({
      upsertRecipe: (b, photo) => upsertImported(b, photo, user.id, share()),
      importList: (l) => { const out = lists.importList({ ...l, owner: user.id }); lists.setShare(out.id, share()); return out; },
      allowPrivate: cfg.allowPrivate,
    }));
  }
  return jobs.get(user.id);
};
app.post('/api/import/anylist', wrap((req, res) => {
  const email = str(req.body?.email, 200).trim();
  const password = str(req.body?.password, 500);
  if (!email || !password) throw fail(400, 'Enter your AnyList email and password');
  jobFor(req.user).start(email, password); // throws 409 if one is already running
  res.status(202).json({ started: true });
}));
app.get('/api/import/anylist/status', (req, res) => res.json(jobFor(req.user).status()));

/* ---------- recipe collections: ordered per person, renamed or removed across their recipes ---------- */
const myRecipes = (req) => store.list().filter((r) => r.owner === me(req));
const saveCollections = (req, names) => { acc.user(me(req)).collections = cleanCollections(names); acc.save(); };
app.put('/api/collections', wrap((req, res) => { saveCollections(req, req.body?.names); res.json({ names: acc.user(me(req)).collections }); }));
app.post('/api/collections/rename', wrap((req, res) => {
  const from = str(req.body?.from, 40).trim(), to = str(req.body?.to, 40).trim();
  if (!from || !to) throw fail(400, 'Enter a name');
  for (const r of myRecipes(req)) if ((r.collections || []).includes(from)) store.update(r.id, { collections: cleanCollections(r.collections.map((c) => (c === from ? to : c))) });
  saveCollections(req, (acc.user(me(req)).collections || []).map((c) => (c === from ? to : c)));
  res.json({ names: acc.user(me(req)).collections });
}));
app.post('/api/collections/delete', wrap((req, res) => {
  const name = str(req.body?.name, 40).trim();
  for (const r of myRecipes(req)) if ((r.collections || []).includes(name)) store.update(r.id, { collections: r.collections.filter((c) => c !== name) });
  saveCollections(req, (acc.user(me(req)).collections || []).filter((c) => c !== name));
  res.json({ names: acc.user(me(req)).collections });
}));

/* ---------- recipes saved without a picture ---------- */
const myRecipeIds = (req) => new Set(store.list().filter((r) => acc.canAccess(me(req), r)).map((r) => r.id));
app.get('/api/photos/status', (req, res) => res.json({ ...photos.status(myRecipeIds(req)), enabled: process.env.PHOTO_CHECK !== 'false' }));
app.post('/api/photos/check', wrap((req, res) => {
  if (photos.running) throw fail(409, 'A photo search is already running');
  photos.run({ force: true, ids: myRecipeIds(req), max: 100 }).catch(() => {});
  res.status(202).json({ started: true });
}));
app.post('/api/recipes/:id/find-photo', wrap(async (req, res) => {
  const r = recipeFor(req);
  if (r.image) return res.json(recipeView(req, r));
  if (!/^https?:\/\//.test(r.sourceUrl || '')) throw fail(422, 'This recipe has no source link to look for a picture');
  try { res.json(recipeView(req, await photos.tryOne(r.id))); } catch (e) { throw fail(422, e.message); }
}));

/* ---------- self-update (see launcher.js) ---------- */
app.get('/api/update/status', (_req, res) => {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'update-status.json'), 'utf8')); } catch { /* launcher not running (dev) */ }
  res.json({ enabled: process.env.AUTO_UPDATE === 'true' && !!process.env.SIMMER_LAUNCHER_PID, ...st });
});
app.post('/api/update/check', admin, (_req, res) => {
  const pid = +process.env.SIMMER_LAUNCHER_PID;
  if (process.env.AUTO_UPDATE !== 'true' || !pid) return res.status(400).json({ error: 'Auto-update is off. Set AUTO_UPDATE to true on the container.' });
  process.kill(pid, 'SIGUSR1');
  res.status(202).json({ started: true });
});

/* ---------- shopping lists ---------- */
const listView = (req, l) => ({ ...l, mine: l.owner === me(req), ownerName: nameOf(l.owner), sharedWith: shareView(l) });
const listFor = (req) => { const l = lists.get(req.params.id); if (!l || !acc.canAccess(me(req), l)) throw notFound(); return l; };

app.get('/api/list-templates', (req, res) => {
  const fr = req.query.lang === 'fr';
  res.json(Object.entries(TEMPLATES).map(([id, t]) => ({ id, icon: t.icon, auto: t.auto, categories: t.cats ? t.cats.map((c) => ({ name: fr ? c.fr : c.en, color: c.color })) : null })));
});
app.get('/api/lists', wrap((req, res) => {
  let mine = lists.all().filter((l) => acc.canAccess(me(req), l));
  if (!mine.length) mine = [lists.createList(me(req), 'Groceries', myShare(req))];
  res.json(mine.map((l) => listView(req, l)));
}));
app.post('/api/lists', wrap((req, res) => {
  const name = str(req.body?.name, 80).trim();
  if (!name) throw fail(400, 'Missing name');
  const l = lists.createList(me(req), name, myShare(req), undefined, { template: str(req.body?.template, 20), lang: req.body?.lang === 'fr' ? 'fr' : 'en' });
  res.json(listView(req, req.body?.icon || req.body?.color ? lists.settings(l.id, { icon: req.body.icon, color: req.body.color }) : l));
}));
app.delete('/api/lists/:id', wrap((req, res) => {
  const l = listFor(req);
  if (l.owner !== me(req)) throw fail(403, 'Only the owner can delete a list');
  lists.deleteList(l.id);
  res.json({ ok: true });
}));
app.put('/api/lists/:id/share', wrap((req, res) => {
  const l = listFor(req);
  if (l.owner !== me(req)) throw fail(403, 'Only the owner can change sharing');
  res.json(listView(req, lists.setShare(l.id, acc.cleanShare(me(req), req.body))));
}));
app.put('/api/lists/:id/settings', wrap((req, res) => { listFor(req); res.json(listView(req, lists.settings(req.params.id, req.body || {}))); }));
app.post('/api/lists/:id/items', wrap((req, res) => {
  listFor(req);
  const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
  res.json(listView(req, lists.addItems(req.params.id, items)));
}));
app.patch('/api/lists/:id/items/:itemId', wrap((req, res) => {
  listFor(req);
  const it = lists.updateItem(req.params.id, req.params.itemId, req.body || {});
  if (!it) throw notFound();
  res.json(it);
}));
app.delete('/api/lists/:id/items/:itemId', wrap((req, res) => { listFor(req); if (!lists.deleteItem(req.params.id, req.params.itemId)) throw notFound(); res.json({ ok: true }); }));
app.post('/api/lists/:id/clear-checked', wrap((req, res) => { listFor(req); res.json(listView(req, lists.clearChecked(req.params.id))); }));
app.post('/api/recipes/:id/to-list', wrap((req, res) => {
  const r = recipeFor(req);
  // The page sends the (possibly scaled) ingredient lines; fall back to the stored ones.
  const lines = Array.isArray(req.body?.ingredients) ? strArr(req.body.ingredients) : r.ingredients;
  const listId = req.body?.listId || lists.all().find((l) => acc.canAccess(me(req), l))?.id;
  if (!listId) throw notFound();
  listFor({ params: { id: listId }, user: req.user });
  res.json(listView(req, lists.addItems(listId, lines.map((name) => ({ name, details: [r.title, str(req.body?.note, 80).trim()].filter(Boolean).join(' · ') })), { skipStaples: true })));
}));

/* ---------- meal plan ---------- */
const mealView = (req, m) => {
  const r = m.recipeId ? store.get(m.recipeId) : null;
  const canRecipe = r && acc.canAccess(me(req), r);
  return {
    ...m, mine: m.owner === me(req), ownerName: nameOf(m.owner), sharedWith: shareView(m),
    // Everyone invited by name (not whole households), so each person sees who else is at the table.
    attendees: [m.owner, ...(m.users || [])].filter((id, n, a) => a.indexOf(id) === n && acc.user(id)).map((id) => ({ id, name: nameOf(id), avatar: acc.avatarUrl(acc.user(id)), you: id === me(req) })),
    householdNames: (m.households || []).map((h) => acc.household(h)).filter((h) => h?.members.includes(me(req))).map((h) => h.name),
    recipe: canRecipe ? { id: r.id, title: r.title, image: r.image || null, yield: r.yield || null } : null,
    title: m.title || (canRecipe ? r.title : ''),
  };
};
const visibleMeals = (req, from, to) => meals.all().filter((m) => acc.canAccess(me(req), m) && (!from || m.date >= from) && (!to || m.date <= to));
const mealFor = (req) => { const m = meals.get(req.params.id); if (!m || !acc.canAccess(me(req), m)) throw notFound(); return m; };
/** Whoever a meal is shared with also gets to open its recipe, otherwise the plan would show a title they cannot cook. */
const grantRecipe = (m, share) => { if (m.recipeId && store.get(m.recipeId)) store.grant(m.recipeId, share); };

app.get('/api/meals', (req, res) => res.json(visibleMeals(req, str(req.query.from, 10), str(req.query.to, 10)).map((m) => mealView(req, m))));
app.get('/api/meals/:id', wrap((req, res) => res.json(mealView(req, mealFor(req)))));
app.post('/api/meals', wrap((req, res) => {
  const b = req.body || {};
  if (b.recipeId) { const r = store.get(b.recipeId); if (!r || !acc.canAccess(me(req), r)) throw fail(400, 'Recipe not found'); }
  const share = acc.cleanShare(me(req), b);
  const m = meals.create(me(req), b, share);
  const rec = m.recipeId && store.get(m.recipeId);
  if (rec && rec.owner === me(req)) grantRecipe(m, share);
  res.json(mealView(req, m));
}));
app.put('/api/meals/:id', wrap((req, res) => {
  const m = mealFor(req);
  if (m.owner !== me(req)) throw fail(403, 'Only the person who planned this meal can change it');
  const share = 'users' in req.body || 'households' in req.body ? acc.cleanShare(me(req), req.body) : null;
  const out = meals.update(m.id, req.body || {}, share);
  const rec = out.recipeId && store.get(out.recipeId);
  if (share && rec && rec.owner === me(req)) grantRecipe(out, share);
  res.json(mealView(req, out));
}));
app.delete('/api/meals/:id', wrap((req, res) => {
  const m = mealFor(req);
  if (m.owner === me(req)) meals.remove(m.id);
  else meals.leave(m.id, me(req)); // a guest only takes it off their own plan
  res.json({ ok: true });
}));
app.post('/api/meals/to-list', wrap((req, res) => {
  const b = req.body || {};
  const listId = b.listId || lists.all().find((l) => acc.canAccess(me(req), l))?.id;
  if (!listId) throw notFound();
  listFor({ params: { id: listId }, user: req.user });
  const lang = b.lang === 'fr' || req.user.lang === 'fr' ? 'fr' : 'en';
  let added = 0;
  for (const m of visibleMeals(req, str(b.from, 10), str(b.to, 10))) {
    const r = m.recipeId && store.get(m.recipeId);
    if (!r || !acc.canAccess(me(req), r)) continue;
    const base = Scale.parseYield(r.yield);
    const factor = base && m.servings ? m.servings / base : 1;
    const lines = r.ingredients.map((i) => Scale.scaleLine(i, factor, { lang }));
    const when = new Date(m.date + 'T12:00:00').toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    lists.addItems(listId, lines.map((name) => ({ name, details: `${r.title} · ${lang === 'fr' ? 'pour' : 'for'} ${when}` })), { skipStaples: true });
    added += lines.length;
  }
  res.json({ added, list: listView(req, lists.get(listId)) });
}));

/* ---------- Home Assistant and scripts: one small summary call ---------- */
app.get('/api/ha/summary', (req, res) => {
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('sv-SE'); };
  const todayStr = today();
  const mine = visibleMeals(req, todayStr, day(7)).map((m) => mealView(req, m));
  const brief = (m) => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, recipeId: m.recipeId, servings: m.servings });
  res.json({
    user: { id: me(req), name: req.user.name },
    lists: lists.all().filter((l) => acc.canAccess(me(req), l)).map((l) => ({ id: l.id, name: l.name, open: l.items.filter((i) => !i.checked).length, total: l.items.length })),
    today: mine.filter((m) => m.date === todayStr).map(brief),
    tomorrow: mine.filter((m) => m.date === day(1)).map(brief),
    upcoming: mine.map(brief),
  });
});

app.use('/images', need, express.static(store.imageDir, { maxAge: '30d', immutable: true }));
/* The page and its scripts always revalidate, and each script URL carries a fingerprint of the files, so a proxy
 * or browser cache (Nginx Proxy Manager's "Cache assets", for instance) can never keep serving an old version. */
const PUBLIC = path.join(__dirname, '..', 'public');
const assetVersion = () => {
  const h = crypto.createHash('sha1');
  for (const f of fs.readdirSync(PUBLIC).filter((x) => /\.(js|css)$/.test(x)).sort()) h.update(f + fs.statSync(path.join(PUBLIC, f)).mtimeMs + fs.statSync(path.join(PUBLIC, f)).size);
  return h.digest('hex').slice(0, 10);
};
const ASSET_V = assetVersion();
const indexHtml = () => fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(/(src|href)="([\w.-]+\.(?:js|css))"/g, `$1="$2?v=${ASSET_V}"`);
const sendIndex = (_req, res) => res.set('Cache-Control', 'no-cache').type('html').send(indexHtml());
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(PUBLIC, { setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.set('Cache-Control', 'no-cache'); if (/sw\.js$/.test(file)) res.set('Service-Worker-Allowed', '/'); } }));
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

if (require.main === module) {
  if (process.env.PHOTO_CHECK !== 'false') photos.start();
  app.listen(cfg.port, '0.0.0.0', () =>
    console.log(`Simmer listening on :${cfg.port} (data: ${cfg.dataDir}, AI: ${cfg.anthropicKey ? 'on' : 'off'}, users: ${acc.db.users.length})`)
  );
}
module.exports = app;
module.exports.cfg = cfg;
module.exports.photos = photos;
