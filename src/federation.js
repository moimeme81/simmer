'use strict';
/**
 * Linking Simmers.
 *
 * Every Simmer has its own long key. Admin A pastes B's key (plus B's address) to ask for a link; B's admin is notified and pastes
 * A's key to accept. Having both keys proves the two owners really were in touch. They then swap fresh per-link keys and the
 * servers see each other's people, so anyone can share a recipe, a shopping list, a meal or a collection with anyone on either.
 *
 *  - The owner's server stays the source of truth. The other server keeps a mirror and is told about every change
 *    (changes are pushed a couple of seconds after they happen, and re-tried every minute when the other side is down).
 *  - Mirrors belong to a stand-in owner ("r:<link>:<user>"), so the ordinary guest rules apply: recipes and meals are read-only
 *    (a guest can still keep their own notes), and shopping lists can be changed by the guest. List changes are sent to the
 *    owner's server, applied there, and the new list comes back.
 *  - Removing a mirror tells the owner's server, which stops sharing it, and it is not sent again.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assertPublic } = require('./extract');

const uuid = () => crypto.randomUUID();
const sha = (v) => crypto.createHash('sha1').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const clip = (v, n) => String(v ?? '').slice(0, n);
const num = (v) => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : null);
const arr = (v, n = 500, m = 2000) => (Array.isArray(v) ? v.slice(0, n).map((x) => clip(x, m)).filter(Boolean) : []);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const PHOTO_MAX = 3_500_000;

class FedError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

const KINDS = ['recipe', 'list', 'meal', 'collection'];
const RECIPE_FIELDS = ['title', 'description', 'author', 'yield', 'prepMinutes', 'cookMinutes', 'totalMinutes', 'ingredients', 'steps', 'notes', 'rating', 'sourceUrl', 'host'];

class Federation {
  constructor({ dataDir, store, lists, meals, acc, fetchImpl, debounceMs = 2500 }) {
    Object.assign(this, { store, lists, meals, acc, debounceMs });
    this.file = path.join(dataDir, 'federation.json');
    this.fetch = fetchImpl || fetch;
    this.db = { peers: [], shares: [], declined: [], remoteUsers: {} };
    try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* first run */ }
    this.queue = Promise.resolve();
    this.timer = null;
  }
  save() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file); }
  start() { this.interval = setInterval(() => this.schedule(0), 60_000); this.interval.unref?.(); }

  /* ---------- this Simmer's own key and name ---------- */
  /** A long secret that identifies THIS server. Its admin gives it to a friend's admin, who needs it to ask for a link. */
  get serverKey() { if (!this.db.serverKey) { this.db.serverKey = crypto.randomBytes(48).toString('base64url'); this.save(); } return this.db.serverKey; }
  rotateKey() { this.db.serverKey = crypto.randomBytes(48).toString('base64url'); this.save(); return this.db.serverKey; }
  get serverName() { return this.db.serverName || `${this.acc.firstAdmin?.name || 'My'}’s Simmer`; }
  setServerName(name) { name = clip(name, 60).trim(); if (!name) throw new FedError('Enter a name for this Simmer.'); this.db.serverName = name; this.save(); }
  static same(a, b) { const h = (v) => crypto.createHash('sha256').update(String(v || '')).digest(); return crypto.timingSafeEqual(h(a), h(b)); }
  isServerKey(token) { return !!token && Federation.same(token, this.serverKey); }
  static cleanUrl(url, what = 'the other Simmer') {
    let u;
    try { u = new URL(String(url).trim()); } catch { throw new FedError(`Enter the address of ${what}, for example https://simmer.example.com`); }
    if (!/^https?:$/.test(u.protocol)) throw new FedError('The address must start with http:// or https://');
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }
  rememberSelf(url) { const u = Federation.cleanUrl(url, 'this Simmer'); if (this.db.selfUrl !== u) { this.db.selfUrl = u; this.save(); } return u; }
  overview() {
    return {
      name: this.serverName, key: this.serverKey, selfUrl: this.db.selfUrl || '',
      peers: this.db.peers.map((p) => this.peerView(p, true)),
      pending: (this.db.pending || []).map((r) => ({ id: r.id, name: r.name, url: r.url, at: r.at })),
    };
  }
  pendingCount() { return (this.db.pending || []).length; }

  /* ---------- linking two Simmers: each admin hands the other their server's key ---------- */
  peer(id) { return this.db.peers.find((p) => p.id === id) || null; }
  active() { return this.db.peers.filter((p) => p.state === 'active'); }
  bySecret(token) {
    return this.active().find((p) => p.inKey && Federation.same(token, p.inKey)) || null;
  }
  /** Step 1, on the server that starts it: ask the other Simmer for a link, proving we hold ITS key. */
  async startLink({ url, key, selfUrl }) {
    const base = Federation.cleanUrl(url);
    key = String(key || '').trim();
    if (key.length < 32) throw new FedError('Paste the other Simmer’s key. It is a long text from its Account page.');
    if (this.db.peers.some((p) => p.url === base)) throw new FedError('That Simmer is already linked, or waiting for the other side to enter your key.');
    const mine = this.rememberSelf(selfUrl);
    if (mine === base) throw new FedError('That is this Simmer’s own address.');
    const linkId = uuid();
    const out = await this.call({ url: base, name: base }, '/api/federation/link-request', { linkId, name: this.serverName, url: mine }, 'POST', key);
    const p = { id: uuid(), name: clip(out.name, 60) || base, url: base, state: 'waiting', linkId, createdAt: new Date().toISOString() };
    this.db.peers.push(p);
    this.save();
    return p;
  }
  /** Step 2, on the other server: a request arrives (it knew our key). It waits there until our admin enters the requester's key. */
  receiveLinkRequest(body) {
    const url = Federation.cleanUrl(body.url, 'the requesting Simmer');
    if (this.db.peers.some((p) => p.url === url && p.state === 'active')) throw new FedError('Already linked.', 409);
    this.db.pending = (this.db.pending || []).filter((r) => r.url !== url).slice(-19);
    this.db.pending.push({ id: uuid(), linkId: clip(body.linkId, 80), name: clip(body.name, 60) || url, url, at: new Date().toISOString() });
    this.save();
    return { ok: true, name: this.serverName };
  }
  /** Step 3, on the second server: its admin enters the requester's key. If it is right, both sides now trust each other. */
  async acceptPending(id, { key, selfUrl }) {
    const req = (this.db.pending || []).find((r) => r.id === id);
    if (!req) throw new FedError('That request is gone.', 404);
    key = String(key || '').trim();
    if (key.length < 32) throw new FedError(`Paste ${req.name}’s key. Their admin copies it from their Account page.`);
    const mine = this.rememberSelf(selfUrl);
    const inKey = crypto.randomBytes(32).toString('base64url');
    let out;
    try { out = await this.call({ url: req.url, name: req.name }, '/api/federation/link-confirm', { linkId: req.linkId, name: this.serverName, url: mine, inKey }, 'POST', key); }
    catch (e) { throw new FedError(/did not accept/.test(e.message) ? `${req.name} did not accept that key. Ask their admin to copy it again from their Account page.` : e.message, e.status || 502); }
    if (!out.inKey) throw new FedError(`${req.name} answered, but not like a Simmer that can be linked.`, 502);
    this.db.pending = this.db.pending.filter((r) => r.id !== id);
    this.db.peers = this.db.peers.filter((p) => p.url !== req.url);
    const p = { id: uuid(), name: clip(out.name, 60) || req.name, url: req.url, state: 'active', inKey, outKey: String(out.inKey), createdAt: new Date().toISOString() };
    this.db.peers.push(p);
    this.save();
    return p;
  }
  /** Step 4, back on the first server: the other admin proved they hold our key. The link is now active both ways. */
  receiveLinkConfirm(body) {
    const p = this.db.peers.find((x) => x.state === 'waiting' && x.linkId === clip(body.linkId, 80));
    if (!p) throw new FedError('No link is waiting for that request. Start it again from the first Simmer.', 404);
    if (typeof body.inKey !== 'string' || body.inKey.length < 32) throw new FedError('Bad key');
    p.state = 'active'; p.outKey = body.inKey; p.inKey = crypto.randomBytes(32).toString('base64url'); delete p.linkId;
    if (body.name) p.name = clip(body.name, 60);
    this.save();
    return { ok: true, inKey: p.inKey, name: this.serverName };
  }
  declinePending(id) {
    const n = (this.db.pending || []).length;
    this.db.pending = (this.db.pending || []).filter((r) => r.id !== id);
    this.save();
    return this.db.pending.length < n;
  }
  /** Take a link down (or cancel one that never completed) and tell the other side. */
  async unlink(id) {
    const p = this.peer(id);
    if (!p) return false;
    if (p.state === 'active') await this.call(p, '/api/federation/unlink', {}).catch(() => {});
    return this.removePeer(id);
  }
  removePeer(id) {
    const n = this.db.peers.length;
    this.db.peers = this.db.peers.filter((p) => p.id !== id);
    if (this.db.peers.length === n) return false;
    this.db.shares = this.db.shares.filter((s) => s.peerId !== id);
    // Copies from that Simmer would never update again, so remove them rather than leave stale ones behind.
    for (const r of this.store.list()) if (r.remote?.peerId === id) this.store.remove(r.id);
    for (const l of this.lists.all()) if (l.remote?.peerId === id) this.lists.deleteList(l.id);
    for (const m of this.meals.all()) if (m.remote?.peerId === id) this.meals.remove(m.id);
    delete this.dirCache?.[id];
    this.save();
    return true;
  }
  peerView(p, full) { return { id: p.id, name: p.name, state: p.state, ...(full ? { url: p.url } : {}) }; }
  remoteName(id) { return this.db.remoteUsers[id] || ''; }

  async call(peer, route, body, method = 'POST', key = peer.outKey, timeout = 30_000) {
    const url = peer.url + route;
    await assertPublic(url, true).catch((e) => { throw new FedError(e.message); });
    let res;
    try {
      res = await this.fetch(url, {
        method, redirect: 'manual', signal: AbortSignal.timeout(timeout),
        headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const code = String(e.cause?.code || e.message);
      if (/ENOTFOUND|EAI_AGAIN/.test(code)) throw new FedError(`${peer.name} cannot be found at ${peer.url}. Check the address.`, 502);
      throw new FedError(`${peer.name} did not answer (${/Timeout|abort/i.test(code + e.name) ? 'timed out' : code}).`, 502);
    }
    if (res.status >= 300 && res.status < 400) throw new FedError(`${peer.name} redirects to ${res.headers.get('location') || 'another address'}. Use that address.`, 502);
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : {}; } catch { /* not json */ }
    if (res.status === 401) throw new FedError(`${peer.name} did not accept the key.`, 502);
    if (res.status === 429) throw new FedError(`${peer.name} is busy. Try again in a minute.`, 502);
    if (j === null || (res.status === 404 && !j.error)) throw new FedError(`${peer.url} is not a Simmer that can be linked (is it up to date?).`, 502);
    if (!res.ok) throw new FedError(j.error || `${peer.name} answered ${res.status}.`, j.code === 'no-user' ? 404 : 502);
    return j;
  }
  ping(peer) { return this.call(peer, '/api/federation/ping', null, 'GET'); }

  /* ---------- people on linked Simmers (so they appear in every "share with" list, as if on this server) ---------- */
  static rid(peerId, username) { return `r:${peerId}:${username}`; }
  static parseRid(id) { const m = /^r:([\w-]+):(.{1,60})$/.exec(String(id || '')); return m ? { peerId: m[1], username: m[2] } : null; }
  localDirectory() { return this.acc.db.users.map((u) => ({ username: u.username, name: u.name })); }
  async directory() {
    this.dirCache = this.dirCache || {};
    const out = [];
    await Promise.all(this.active().map(async (p) => {
      const c = this.dirCache[p.id];
      if (!c || Date.now() - c.at > 120_000) {
        try { this.dirCache[p.id] = { at: Date.now(), list: (await this.call(p, '/api/federation/people', null, 'GET', p.outKey, 4000)).people || [] }; }
        catch { this.dirCache[p.id] = { at: Date.now() - 100_000, list: c?.list || [] }; } // keep the old list, try again shortly
      }
      for (const u of this.dirCache[p.id].list.slice(0, 500)) out.push({ id: Federation.rid(p.id, clip(u.username, 40)), name: clip(u.name, 60), server: p.name, peerId: p.id });
    }));
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }
  remoteIds(owner, kind, ref) { return this.sharesOf(owner, kind, ref).map((s) => Federation.rid(s.peerId, s.toUser)); }
  /** Make "shared with these remote people" true for one thing: add the new ones, stop sharing with the ones left out. */
  async setTargets(user, kind, ref, ids) {
    const want = new Map();
    for (const id of ids) { const r = Federation.parseRid(id); if (r && this.peer(r.peerId)?.state === 'active') want.set(Federation.rid(r.peerId, r.username).toLowerCase(), r); }
    const have = this.sharesOf(user.id, kind, ref);
    for (const s of have) if (!want.has(Federation.rid(s.peerId, s.toUser).toLowerCase())) await this.removeShare(user, s.id);
    for (const [key, r] of want) if (!have.some((s) => Federation.rid(s.peerId, s.toUser).toLowerCase() === key)) await this.createShare(user, { peerId: r.peerId, toUser: r.username, kind, ref });
  }

  /* ---------- sharing out ---------- */
  sharesOf(userId, kind, ref) { return this.db.shares.filter((s) => s.owner === userId && (!kind || s.kind === kind) && (!ref || s.ref === ref)); }
  shareView(s) {
    return { id: s.id, kind: s.kind, ref: s.ref, label: s.label, peerId: s.peerId, peerName: this.peer(s.peerId)?.name || '?', toUser: s.toUser, error: s.error || '', declined: !!s.declined, syncedAt: s.syncedAt || null, count: s.kind === 'collection' ? Object.keys(s.sent || {}).length : undefined };
  }
  async createShare(user, { peerId, toUser, kind, ref }) {
    const peer = this.peer(peerId);
    if (!peer || peer.state !== 'active') throw new FedError('Pick a linked Simmer.');
    toUser = clip(toUser, 60).trim().replace(/^@/, '');
    if (!toUser) throw new FedError('Enter the username of the person on that Simmer.');
    if (!KINDS.includes(kind)) throw new FedError('Cannot share that.');
    ref = clip(ref, 200);
    let label = '';
    if (kind === 'recipe') { const r = this.store.get(ref); if (!r || r.owner !== user.id) throw new FedError('You can only share your own recipes.', 403); if (r.remote) throw new FedError('That recipe came from another Simmer.'); label = r.title; }
    if (kind === 'list') { const l = this.lists.get(ref); if (!l || l.owner !== user.id) throw new FedError('You can only share your own lists.', 403); if (l.remote) throw new FedError('That list came from another Simmer.'); label = l.name; }
    if (kind === 'meal') { const m = this.meals.get(ref); if (!m || m.owner !== user.id) throw new FedError('You can only share meals you planned.', 403); if (m.remote) throw new FedError('That meal came from another Simmer.'); label = m.title || this.store.get(m.recipeId)?.title || m.date; }
    if (kind === 'collection') { if (!this.store.list().some((r) => r.owner === user.id && !r.remote && (r.collections || []).includes(ref))) throw new FedError('That collection has no recipes of yours.'); label = ref; }
    const dupe = this.db.shares.find((s) => s.owner === user.id && s.peerId === peerId && s.kind === kind && s.ref === ref && s.toUser.toLowerCase() === toUser.toLowerCase());
    if (dupe) throw new FedError('Already shared with that person.');
    const s = { id: uuid(), peerId, toUser, kind, ref, label: clip(label, 120), owner: user.id, createdAt: new Date().toISOString(), sent: {}, skip: [] };
    this.db.shares.push(s);
    this.save();
    await this.exclusive(() => this.syncShare(s));
    return s;
  }
  async removeShare(user, id) {
    const s = this.db.shares.find((x) => x.id === id && x.owner === user.id);
    if (!s) return false;
    await this.exclusive(async () => {
      try { await this.revokeAll(s); } catch { /* the other side may be down; the mirror simply stays until they remove it */ }
      this.db.shares = this.db.shares.filter((x) => x.id !== id);
      this.save();
    });
    return true;
  }

  identity(s) { const u = this.acc.user(s.owner); return { id: s.owner, name: u?.name || 'Someone', username: u?.username || '' }; }
  photoOf(r) {
    const m = /^\/images\/([\w-]+\.(?:jpg|png|webp))/.exec(r.image || '');
    if (!m) return null;
    try { const b = fs.readFileSync(path.join(this.store.imageDir, m[1])); return b.length <= PHOTO_MAX ? b : null; } catch { return null; }
  }
  recipePayload(r, collections) {
    const data = { collections: collections || [] };
    for (const k of RECIPE_FIELDS) data[k] = r[k] ?? null;
    return { remoteId: r.id, data, hasPhoto: !!r.image, imageKey: r.image || '' };
  }
  listSnapshot(l) {
    const { id, owner, users, households, externalId, remote, ...rest } = l;
    return rest;
  }

  /** Make the other server match this one for one share. Records what was sent so unchanged things are not sent again. */
  async syncShare(s) {
    const peer = this.peer(s.peerId);
    if (!peer || peer.state !== 'active') { s.error = 'This link was removed.'; return; }
    if (s.declined) return;
    const from = this.identity(s);
    const send = async (key, payload, extra = {}) => {
      const h = sha(payload);
      if (s.sent[key] === h) return;
      const body = { ...payload, ...extra };
      if (body.kind === 'recipe' || body.recipe) {
        const rr = body.kind === 'recipe' ? body : body.recipe;
        const rec = this.store.get(rr.remoteId);
        const photo = rec && this.photoOf(rec);
        if (photo) rr.photo = photo.toString('base64');
      }
      const out = await this.call(peer, '/api/federation/push', { ...body, to: s.toUser, from });
      if (out.declined) { if (s.kind === 'collection') { s.skip.push(key); delete s.sent[key]; } else s.declined = true; return; }
      s.sent[key] = h;
    };
    try {
      if (s.kind === 'recipe') {
        const r = this.store.get(s.ref);
        if (!r || r.owner !== s.owner) return await this.finishGone(s, peer);
        await send('main', { kind: 'recipe', ...this.recipePayload(r, []) });
      } else if (s.kind === 'collection') {
        const mine = this.store.list().filter((r) => r.owner === s.owner && !r.remote && (r.collections || []).includes(s.ref) && !s.skip.includes(r.id));
        const have = new Set(mine.map((r) => r.id));
        for (const r of mine) await send(r.id, { kind: 'recipe', ...this.recipePayload(r, [s.ref]) });
        for (const key of Object.keys(s.sent)) if (!have.has(key)) { await this.call(peer, '/api/federation/revoke', { kind: 'recipe', remoteId: key, to: s.toUser, from }).catch((e) => { throw e; }); delete s.sent[key]; }
      } else if (s.kind === 'list') {
        const l = this.lists.get(s.ref);
        if (!l || l.owner !== s.owner) return await this.finishGone(s, peer);
        await send('main', { kind: 'list', remoteId: l.id, data: this.listSnapshot(l) });
      } else if (s.kind === 'meal') {
        const m = this.meals.get(s.ref);
        if (!m || m.owner !== s.owner) return await this.finishGone(s, peer);
        const r = m.recipeId && this.store.get(m.recipeId);
        const own = r && r.owner === s.owner && !r.remote ? r : null;
        await send('main', {
          kind: 'meal', remoteId: m.id, data: { date: m.date, slot: m.slot, title: m.title || (r ? r.title : ''), servings: m.servings, note: m.note },
          recipe: own ? { kind: 'recipe', ...this.recipePayload(own, []) } : undefined,
        });
      }
      s.error = ''; s.syncedAt = new Date().toISOString();
    } catch (e) {
      s.error = String(e.message || e).slice(0, 300);
    }
    this.save();
  }
  /** The shared thing was deleted here: remove the other side's mirror and forget the share. */
  async finishGone(s, peer) {
    try { await this.revokeAll(s); this.db.shares = this.db.shares.filter((x) => x.id !== s.id); }
    catch (e) { s.error = String(e.message || e).slice(0, 300); }
  }
  async revokeAll(s) {
    const peer = this.peer(s.peerId);
    if (!peer) return;
    const from = this.identity(s);
    const keys = s.kind === 'collection' ? Object.keys(s.sent) : s.sent.main ? [s.ref] : [];
    for (const k of keys) await this.call(peer, '/api/federation/revoke', { kind: s.kind === 'collection' ? 'recipe' : s.kind, remoteId: k, to: s.toUser, from });
  }

  exclusive(fn) { const run = this.queue.then(fn, fn); this.queue = run.catch(() => {}); return run; }
  async syncAll() {
    if (!this.db.shares.length) return;
    await this.exclusive(async () => { for (const s of [...this.db.shares]) await this.syncShare(s); this.save(); });
  }
  schedule(ms = this.debounceMs) {
    if (!this.db.shares.length) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncAll().catch((e) => console.warn('[federation]', e.message)), ms);
    this.timer.unref?.();
  }

  /* ---------- receiving ---------- */
  userByName(name) { const n = String(name || '').trim().toLowerCase(); return this.acc.db.users.find((u) => u.username.toLowerCase() === n) || null; }
  ownerFor(peer, from) {
    const id = `r:${peer.id}:${clip(from?.id, 60).replace(/[^\w-]/g, '')}`;
    const label = `${clip(from?.name, 60) || 'Someone'} (${peer.name})`;
    if (this.db.remoteUsers[id] !== label) { this.db.remoteUsers[id] = label; this.save(); }
    return id;
  }
  declinedKey(peer, kind, remoteId, userId) { return [peer.id, kind, remoteId, userId].join('|'); }
  isDeclined(peer, kind, remoteId, userId) { return this.db.declined.includes(this.declinedKey(peer, kind, remoteId, userId)); }
  mirrorRecipe(peer, remoteId, userId) { return this.store.list().find((r) => r.remote && r.remote.peerId === peer.id && r.remote.remoteId === remoteId && r.remote.userId === userId) || null; }

  upsertRecipe(peer, user, from, body) {
    const remoteId = clip(body.remoteId, 80);
    if (!remoteId) throw new FedError('Missing id');
    if (this.isDeclined(peer, 'recipe', remoteId, user.id)) return { declined: true };
    const d = body.data || {};
    const fields = {
      title: clip(d.title, 300) || 'Recipe', description: clip(d.description, 3000), author: d.author ? clip(d.author, 200) : null, yield: d.yield ? clip(d.yield, 100) : null,
      prepMinutes: num(d.prepMinutes), cookMinutes: num(d.cookMinutes), totalMinutes: num(d.totalMinutes),
      ingredients: arr(d.ingredients), steps: arr(d.steps, 500, 5000), notes: clip(d.notes, 10000), rating: num(d.rating) ? Math.min(5, num(d.rating)) : null,
      sourceUrl: /^https?:\/\//.test(d.sourceUrl || '') ? clip(d.sourceUrl, 2000) : null, host: clip(d.host, 200), collections: arr(d.collections, 20, 40),
    };
    const owner = this.ownerFor(peer, from);
    const remote = { peerId: peer.id, remoteId, userId: user.id, from: this.remoteName(owner) };
    let cur = this.mirrorRecipe(peer, remoteId, user.id);
    let rec;
    if (!cur) rec = this.store.create({ ...fields, method: 'shared', image: null, owner, users: [user.id], households: [], remote });
    else { rec = { ...cur, ...fields, notes: cur.notes, owner, remote }; this.store.write(rec); }
    if (body.photo) {
      const buf = Buffer.from(String(body.photo), 'base64');
      const img = buf.length > 12 && buf.length <= PHOTO_MAX ? this.store.saveImage(rec.id, buf) : null;
      if (img) { rec = { ...this.store.get(rec.id), image: img }; this.store.write(rec); }
    } else if (!body.hasPhoto && rec.image) { this.store.removeImage(rec.id); rec = { ...this.store.get(rec.id), image: null }; this.store.write(rec); }
    return { id: rec.id };
  }

  listFields(d) {
    const item = (i) => ({ id: clip(i.id, 80) || uuid(), name: clip(i.name, 200), quantity: clip(i.quantity, 80), details: clip(i.details, 200), checked: !!i.checked, key: clip(i.key, 200), aisle: clip(i.aisle, 80), store: clip(i.store, 80), addedAt: clip(i.addedAt, 40) });
    const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? JSON.parse(JSON.stringify(o)) : {});
    return {
      name: clip(d.name, 80) || 'List', icon: clip(d.icon, 8), color: clip(d.color, 20),
      categories: (Array.isArray(d.categories) ? d.categories : []).slice(0, 100).map((c) => ({ id: clip(c.id, 80), name: clip(c.name, 60), color: clip(c.color, 20) })),
      auto: !!d.auto, itemCats: obj(d.itemCats), stores: (Array.isArray(d.stores) ? d.stores : []).slice(0, 50).map((s) => ({ ...obj(s), id: clip(s.id, 80), name: clip(s.name, 60) })), aisleStores: obj(d.aisleStores), itemStores: obj(d.itemStores),
      items: (Array.isArray(d.items) ? d.items : []).slice(0, 5000).map(item),
    };
  }

  upsertList(peer, user, from, body) {
    const remoteId = clip(body.remoteId, 80);
    if (!remoteId) throw new FedError('Missing id');
    if (this.isDeclined(peer, 'list', remoteId, user.id)) return { declined: true };
    const d = body.data || {};
    const owner = this.ownerFor(peer, from);
    const fields = this.listFields(d);
    const remote = { peerId: peer.id, remoteId, userId: user.id, from: this.remoteName(owner) };
    return this.lists.mutate((db) => {
      const cur = db.lists.find((l) => l.remote && l.remote.peerId === peer.id && l.remote.remoteId === remoteId && l.remote.userId === user.id);
      if (cur) Object.assign(cur, fields, { owner, remote });
      else db.lists.push(this.lists.blank(owner, fields.name, { ...fields, users: [user.id], households: [], remote }));
      return { id: (cur || db.lists[db.lists.length - 1]).id };
    });
  }

  upsertMeal(peer, user, from, body) {
    const remoteId = clip(body.remoteId, 80);
    if (!remoteId) throw new FedError('Missing id');
    if (this.isDeclined(peer, 'meal', remoteId, user.id)) return { declined: true };
    const d = body.data || {};
    if (!DATE_RE.test(d.date || '')) throw new FedError('Bad date');
    let recipeId = null;
    if (body.recipe) { const out = this.upsertRecipe(peer, user, from, body.recipe); recipeId = out.id || null; }
    const owner = this.ownerFor(peer, from);
    const fields = { date: d.date, slot: SLOTS.includes(d.slot) ? d.slot : 'dinner', recipeId, title: recipeId ? '' : clip(d.title, 200), servings: num(d.servings), note: clip(d.note, 500) };
    const remote = { peerId: peer.id, remoteId, userId: user.id, from: this.remoteName(owner) };
    return this.meals.mutate((db) => {
      const cur = db.meals.find((m) => m.remote && m.remote.peerId === peer.id && m.remote.remoteId === remoteId && m.remote.userId === user.id);
      if (cur) Object.assign(cur, fields, { owner, remote });
      else db.meals.push({ id: uuid(), owner, users: [user.id], households: [], ...fields, remote });
      return { id: (cur || db.meals[db.meals.length - 1]).id };
    });
  }

  receivePush(peer, body) {
    const user = this.userByName(body.to);
    if (!user) throw Object.assign(new FedError(`There is no one called “${clip(body.to, 40)}” on this Simmer.`, 404), { code: 'no-user' });
    const from = body.from || {};
    if (body.kind === 'recipe') return this.upsertRecipe(peer, user, from, body);
    if (body.kind === 'list') return this.upsertList(peer, user, from, body);
    if (body.kind === 'meal') return this.upsertMeal(peer, user, from, body);
    throw new FedError('Unknown kind');
  }
  receiveRevoke(peer, body) {
    const user = this.userByName(body.to);
    if (!user) return { ok: true };
    const remoteId = clip(body.remoteId, 80);
    const same = (x) => x.remote && x.remote.peerId === peer.id && x.remote.remoteId === remoteId && x.remote.userId === user.id;
    if (body.kind === 'recipe') for (const r of this.store.list()) if (same(r)) this.store.remove(r.id);
    if (body.kind === 'list') for (const l of this.lists.all()) if (same(l)) this.lists.deleteList(l.id);
    if (body.kind === 'meal') for (const m of this.meals.all()) if (same(m)) this.meals.remove(m.id);
    // Sharing stopped on purpose, so a later share of the same thing starts fresh.
    this.db.declined = this.db.declined.filter((k) => k !== this.declinedKey(peer, body.kind, remoteId, user.id));
    this.save();
    return { ok: true };
  }

  /** A guest here removed a mirror: remember it so it is not sent again, and tell the owner's server. */
  decline(kind, item, user) {
    const r = item.remote;
    if (!r) return;
    const key = this.declinedKey({ id: r.peerId }, kind, r.remoteId, user.id);
    if (!this.db.declined.includes(key)) this.db.declined.push(key);
    this.save();
    const peer = this.peer(r.peerId);
    if (peer) this.call(peer, '/api/federation/declined', { kind, remoteId: r.remoteId, to: user.username }).catch(() => {});
  }
  receiveDeclined(peer, body) {
    const to = String(body.to || '').toLowerCase(), remoteId = clip(body.remoteId, 80);
    for (const s of this.db.shares) {
      if (s.peerId !== peer.id || s.toUser.toLowerCase() !== to) continue;
      if (s.kind === body.kind && s.ref === remoteId) s.declined = true;
      if (s.kind === 'collection' && body.kind === 'recipe' && s.sent[remoteId] !== undefined) { s.skip.push(remoteId); delete s.sent[remoteId]; }
    }
    this.save();
    return { ok: true };
  }

  /* ---------- changing a shared list from the other side ---------- */
  receiveListOp(peer, body) {
    const to = String(body.to || '').toLowerCase();
    const s = this.db.shares.find((x) => x.peerId === peer.id && x.kind === 'list' && x.ref === body.remoteId && x.toUser.toLowerCase() === to && !x.declined);
    if (!s) throw new FedError('This list is not shared with you any more.', 404);
    const op = body.op || {};
    const L = this.lists;
    if (op.type === 'add') L.addItems(s.ref, (Array.isArray(op.items) ? op.items : []).slice(0, 500).map((i) => ({ name: clip(i.name, 200), quantity: clip(i.quantity, 80), details: clip(i.details, 200), checked: !!i.checked })), { skipStaples: !!op.skipStaples });
    else if (op.type === 'update') { if (!L.updateItem(s.ref, clip(op.itemId, 80), op.patch || {})) throw new FedError('That item is gone.', 404); }
    else if (op.type === 'delete') L.deleteItem(s.ref, clip(op.itemId, 80));
    else if (op.type === 'clear') L.clearChecked(s.ref);
    else throw new FedError('Unknown change');
    const l = L.get(s.ref);
    if (!l) throw new FedError('That list is gone.', 404);
    const snap = this.listSnapshot(l);
    s.sent.main = sha({ kind: 'list', remoteId: l.id, data: snap }); // the guest gets it in this reply, no need to push it again
    this.save();
    return { data: snap };
  }
  /** The guest's side: send one change to the owner's server and keep the list it answers with. */
  async listOp(list, user, op) {
    const peer = this.peer(list.remote?.peerId);
    if (!peer) throw new FedError('This list’s Simmer is no longer linked.', 502);
    const out = await this.call(peer, '/api/federation/list-op', { remoteId: list.remote.remoteId, to: user.username, op });
    this.lists.mutate((db) => {
      const cur = db.lists.find((l) => l.id === list.id);
      if (cur) { const keep = { id: cur.id, owner: cur.owner, users: cur.users, households: cur.households, remote: cur.remote }; Object.assign(cur, this.cleanList(out.data), keep); }
    });
    return this.lists.get(list.id);
  }
  cleanList(d) { return this.listFields(d || {}); }
}

module.exports = { Federation, FedError, KINDS };
