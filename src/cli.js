#!/usr/bin/env node
'use strict';
/**
 * Maintenance commands, run inside the container (Unraid: Docker tab → Simmer → Console), for example:
 *   node src/cli.js reset-password chris
 * The running server picks the request up and answers with a temporary password. Sign in with it and change it right away.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA = process.env.DATA_DIR || '/data';
const [cmd, username] = process.argv.slice(2);

async function resetPassword() {
  if (!username) { console.error('Usage: node src/cli.js reset-password <username>'); process.exit(2); }
  const id = crypto.randomUUID();
  const req = path.join(DATA, 'reset-request.json'), out = path.join(DATA, 'reset-result.json');
  fs.rmSync(out, { force: true });
  fs.writeFileSync(req, JSON.stringify({ username, id }), { mode: 0o600 });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    let res;
    try { res = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { continue; }
    if (res.id !== id) continue;
    fs.rmSync(out, { force: true });
    if (!res.ok) { console.error(res.error); process.exit(1); }
    console.log(`\nNew temporary password for ${res.name} (@${res.username}):\n\n  ${res.password}\n\nSign in with it, then change it in Account. Everyone signed in as them was signed out.`);
    return;
  }
  fs.rmSync(req, { force: true });
  console.error('Simmer did not answer. Is it running, and is this the same data folder (DATA_DIR)?');
  process.exit(1);
}

if (cmd === 'reset-password') resetPassword();
else { console.error('Commands:\n  reset-password <username>   make a new temporary password for an account'); process.exit(cmd ? 2 : 0); }
