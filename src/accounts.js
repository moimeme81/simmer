'use strict';
/**
 * Users, households, sessions, API tokens and invites, all in one JSON file (accounts.json).
 * Passwords use scrypt with a per-user salt. Session cookies and API tokens are random secrets
 * that are only stored as SHA-256 hashes, so a leaked data file cannot be replayed.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const uuid = () => crypto.randomUUID();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const secret = (prefix) => prefix + crypto.randomBytes(24).toString('base64url');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const INVITE_MS = 7 * 24 * 3600 * 1000;
const fail = (status, message) => Object.assign(new Error(message), { status });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(String(password), user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}
const cleanUsername = (s) => String(s || '').trim().toLowerCase();

/** How a user wants measurements shown: per kind, 'orig' (as written) | 'metric' | 'imperial' | 'both'. */
function cleanUnits(u) {
  const ok = (v) => (['orig', 'metric', 'imperial', 'both'].includes(v) ? v : 'orig');
  return { mass: ok(u?.mass), vol: ok(u?.vol), len: ok(u?.len), temp: ok(u?.temp) };
}

class Accounts {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'accounts.json');
    this.db = { users: [], households: [], sessions: [], tokens: [], invites: [], learned: {} };
    if (fs.existsSync(this.file)) Object.assign(this.db, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    this.fails = new Map();
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /* ---------- users ---------- */
  get needsSetup() { return this.db.users.length === 0; }
  get firstAdmin() { return this.db.users.find((u) => u.admin) || this.db.users[0]; }
  avatarUrl(u) { return u?.av ? `/avatars/${u.id}?v=${u.av}` : null; }
  setAvatar(id, version) { const u = this.user(id); if (u) { u.av = version; this.save(); } }
  publicUser(u) {
    return u && { id: u.id, name: u.name, username: u.username, avatar: this.avatarUrl(u), admin: !!u.admin, lang: u.lang || null, cookStyle: u.cookStyle === 'page' ? 'page' : 'focus', units: cleanUnits(u.units), collections: u.collections || [], autoShare: u.autoShare || [], households: this.householdsOf(u.id).map((h) => h.id) };
  }
  people() { return this.db.users.map((u) => ({ id: u.id, name: u.name, avatar: this.avatarUrl(u) })); }
  user(id) { return this.db.users.find((u) => u.id === id) || null; }

  validate(name, username, password) {
    if (!String(name || '').trim()) throw fail(400, 'Enter a name');
    if (!/^[a-z0-9._-]{3,40}$/.test(cleanUsername(username))) throw fail(400, 'Username must be 3 to 40 letters, numbers, dots or dashes');
    if (String(password || '').length < 8) throw fail(400, 'Password must be at least 8 characters');
    if (this.db.users.some((u) => u.username === cleanUsername(username))) throw fail(409, 'That username is taken');
  }
  addUser({ name, username, password, admin = false }) {
    this.validate(name, username, password);
    const u = { id: uuid(), name: String(name).trim().slice(0, 60), username: cleanUsername(username), admin, ...hashPassword(String(password)), createdAt: new Date().toISOString() };
    this.db.users.push(u);
    this.save();
    return u;
  }
  setup(b) {
    if (!this.needsSetup) throw fail(403, 'Setup is already done');
    return this.addUser({ ...b, admin: true });
  }
  updateProfile(userId, b) {
    const u = this.user(userId);
    if (b.name != null && String(b.name).trim()) u.name = String(b.name).trim().slice(0, 60);
    if (b.lang === 'fr' || b.lang === 'en') u.lang = b.lang;
    if (b.cookStyle === 'focus' || b.cookStyle === 'page') u.cookStyle = b.cookStyle;
    if (b.units && typeof b.units === 'object') u.units = cleanUnits({ ...cleanUnits(u.units), ...b.units });
    if (Array.isArray(b.autoShare)) {
      const mine = new Set(this.householdsOf(userId).map((h) => h.id));
      u.autoShare = b.autoShare.filter((id) => mine.has(id));
    }
    if (b.newPassword != null) {
      if (!checkPassword(u, b.currentPassword || '')) throw fail(403, 'Current password is wrong');
      if (String(b.newPassword).length < 8) throw fail(400, 'Password must be at least 8 characters');
      Object.assign(u, hashPassword(String(b.newPassword)));
      this.db.sessions = this.db.sessions.filter((s) => s.userId !== userId || s.id === b.keepSession);
    }
    this.save();
    return u;
  }
  removeUser(id) {
    const u = this.user(id);
    if (!u) return false;
    if (u.admin && this.db.users.filter((x) => x.admin).length === 1) throw fail(400, 'You cannot remove the only admin');
    this.db.users = this.db.users.filter((x) => x.id !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.userId !== id);
    this.db.tokens = this.db.tokens.filter((t) => t.userId !== id);
    for (const h of this.db.households) h.members = h.members.filter((m) => m !== id);
    this.db.households = this.db.households.filter((h) => h.members.length);
    this.save();
    return true;
  }
  resetPassword(id) {
    const u = this.user(id);
    if (!u) return null;
    const temp = crypto.randomBytes(9).toString('base64url');
    Object.assign(u, hashPassword(temp));
    this.db.sessions = this.db.sessions.filter((s) => s.userId !== id);
    this.save();
    return temp;
  }

  /* ---------- login, with a small brute-force brake ---------- */
  login(username, password, ip) {
    const key = `${ip}|${cleanUsername(username)}`;
    const f = this.fails.get(key);
    if (f && f.until > Date.now()) throw fail(429, 'Too many attempts. Wait a minute and try again.');
    const u = this.db.users.find((x) => x.username === cleanUsername(username));
    // Hash even when the user is unknown so timing does not reveal which usernames exist.
    const ok = u ? checkPassword(u, password) : (hashPassword(String(password)), false);
    if (!ok) {
      const n = (f?.n || 0) + 1;
      this.fails.set(key, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
      throw fail(401, 'Wrong username or password');
    }
    this.fails.delete(key);
    return this.startSession(u.id);
  }
  startSession(userId) {
    const token = secret('');
    const s = { id: uuid(), hash: sha(token), userId, expires: Date.now() + SESSION_MS };
    this.db.sessions = this.db.sessions.filter((x) => x.expires > Date.now());
    this.db.sessions.push(s);
    this.save();
    return { token, session: s };
  }
  endSession(token) { this.db.sessions = this.db.sessions.filter((s) => s.hash !== sha(token)); this.save(); }
  /** Resolve a request credential (session cookie value or API token) to { user, sessionId }. */
  resolve({ cookie, bearer }) {
    if (cookie) {
      const s = this.db.sessions.find((x) => x.hash === sha(cookie) && x.expires > Date.now());
      const user = s && this.user(s.userId);
      if (user) return { user, sessionId: s.id };
    }
    if (bearer) {
      const t = this.db.tokens.find((x) => x.hash === sha(bearer));
      const user = t && this.user(t.userId);
      if (user) return { user, token: t };
    }
    return null;
  }

  /* ---------- API tokens (for Home Assistant and scripts) ---------- */
  listTokens(userId) { return this.db.tokens.filter((t) => t.userId === userId).map(({ id, name, createdAt }) => ({ id, name, createdAt })); }
  createToken(userId, name) {
    const token = secret('smr_');
    this.db.tokens.push({ id: uuid(), userId, name: String(name || 'Token').slice(0, 60), hash: sha(token), createdAt: new Date().toISOString() });
    this.save();
    return token;
  }
  deleteToken(userId, id) {
    const n = this.db.tokens.length;
    this.db.tokens = this.db.tokens.filter((t) => !(t.id === id && t.userId === userId));
    this.save();
    return this.db.tokens.length < n;
  }

  /* ---------- invites ---------- */
  createInvite(createdBy, householdId) {
    const code = secret('inv_');
    this.db.invites = this.db.invites.filter((i) => i.expires > Date.now());
    this.db.invites.push({ id: uuid(), hash: sha(code), createdBy, householdId: householdId || null, expires: Date.now() + INVITE_MS });
    this.save();
    return code;
  }
  checkInvite(code) { return this.db.invites.find((i) => i.hash === sha(String(code || '')) && i.expires > Date.now()) || null; }
  register(code, b) {
    const inv = this.checkInvite(code);
    if (!inv) throw fail(400, 'This invite link is invalid or has expired');
    const u = this.addUser({ name: b.name, username: b.username, password: b.password });
    this.db.invites = this.db.invites.filter((i) => i.id !== inv.id);
    const h = inv.householdId && this.household(inv.householdId);
    if (h && !h.members.includes(u.id)) h.members.push(u.id);
    this.save();
    return u;
  }

  /* ---------- households ---------- */
  household(id) { return this.db.households.find((h) => h.id === id) || null; }
  householdsOf(userId) { return this.db.households.filter((h) => h.members.includes(userId)); }
  describeHouseholds(userId) {
    return this.householdsOf(userId).map((h) => ({
      id: h.id, name: h.name, owner: h.owner, mine: h.owner === userId,
      members: h.members.map((m) => ({ id: m, name: this.user(m)?.name || '?', avatar: this.avatarUrl(this.user(m)) })),
    }));
  }
  createHousehold(userId, name) {
    const n = String(name || '').trim().slice(0, 60);
    if (!n) throw fail(400, 'Enter a household name');
    const h = { id: uuid(), name: n, owner: userId, members: [userId] };
    this.db.households.push(h);
    this.save();
    return h;
  }
  renameHousehold(userId, id, name) {
    const h = this.household(id);
    if (!h || !h.members.includes(userId)) return null;
    if (String(name || '').trim()) h.name = String(name).trim().slice(0, 60);
    this.save();
    return h;
  }
  addMember(userId, id, memberId) {
    const h = this.household(id);
    if (!h || !h.members.includes(userId)) return null;
    if (!this.user(memberId)) throw fail(404, 'User not found');
    if (!h.members.includes(memberId)) h.members.push(memberId);
    this.save();
    return h;
  }
  removeMember(userId, id, memberId) {
    const h = this.household(id);
    if (!h || !h.members.includes(userId)) return null;
    if (memberId !== userId && h.owner !== userId) throw fail(403, 'Only the household owner can remove other members');
    h.members = h.members.filter((m) => m !== memberId);
    if (h.owner === memberId && h.members.length) h.owner = h.members[0];
    if (!h.members.length) this.db.households = this.db.households.filter((x) => x.id !== id);
    for (const u of this.db.users) if (u.id === memberId && u.autoShare) u.autoShare = u.autoShare.filter((x) => x !== id);
    this.save();
    return true;
  }
  deleteHousehold(userId, id) {
    const h = this.household(id);
    if (!h || h.owner !== userId) return false;
    this.db.households = this.db.households.filter((x) => x.id !== id);
    this.save();
    return true;
  }

  /* ---------- access: owner, shared user, or member of a shared household ---------- */
  canAccess(userId, obj) {
    if (!obj) return false;
    if (obj.owner === userId) return true;
    if (obj.users?.includes(userId)) return true;
    return !!obj.households?.some((hid) => this.household(hid)?.members.includes(userId));
  }
  /** Keep only users and households the sharer is allowed to pick. */
  cleanShare(userId, b) {
    const mine = new Set(this.householdsOf(userId).map((h) => h.id));
    return {
      users: [...new Set((Array.isArray(b?.users) ? b.users : []).filter((id) => id !== userId && this.user(id)))],
      households: [...new Set((Array.isArray(b?.households) ? b.households : []).filter((id) => mine.has(id)))],
    };
  }
  /** Everyone who can see an object, as user ids. */
  audience(obj) {
    const ids = new Set([obj.owner, ...(obj.users || [])]);
    for (const hid of obj.households || []) for (const m of this.household(hid)?.members || []) ids.add(m);
    return [...ids].filter(Boolean);
  }

  /* ---------- what the app has learned about items (shared by the whole instance) ---------- */
  learnAisle(key, aisle) { if (key) { this.db.learned[key] = aisle; this.save(); } }
}

module.exports = { Accounts, fail };
