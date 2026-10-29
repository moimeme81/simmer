'use strict';
/** Time-based one-time passwords (RFC 6238), as used by Google Authenticator, Aegis, 1Password, Authy and others. */
const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

function base32(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(str).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => base32(crypto.randomBytes(20));

function hotp(secret, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);
const codeAt = (secret, ms = Date.now()) => hotp(secret, stepAt(ms));

/** The matching time step (within a minute either side of now) or null. Steps at or before `after` are refused, so a code works once. */
function verify(secret, code, { after = -1, now = Date.now(), window = 1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepAt(now);
  let hit = null;
  for (let s = cur - window; s <= cur + window; s++) {
    const want = Buffer.from(hotp(secret, s)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got) && s > after && (hit === null || s > hit)) hit = s;
  }
  return hit;
}

const otpauth = (secret, account, issuer = 'Simmer') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;

/** Ten single-use recovery codes like "k3f9a-82hd1". */
const recoveryCodes = (n = 10) => Array.from({ length: n }, () => { const s = crypto.randomBytes(8).toString('hex').slice(0, 10); return `${s.slice(0, 5)}-${s.slice(5)}`; });
const normalizeRecovery = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecovery = (c) => crypto.createHash('sha256').update(normalizeRecovery(c)).digest('hex');

module.exports = { base32, unbase32, newSecret, hotp, codeAt, verify, stepAt, otpauth, recoveryCodes, hashRecovery, normalizeRecovery, STEP };
