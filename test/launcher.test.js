'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40);
const bundledDeps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).dependencies;

function makeTarball(dir, serverJs, deps) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-repo-'));
  const top = path.join(root, 'owner-repo-abc');
  fs.mkdirSync(path.join(top, 'src'), { recursive: true });
  fs.writeFileSync(path.join(top, 'src', 'server.js'), serverJs);
  fs.writeFileSync(path.join(top, 'package.json'), JSON.stringify({ dependencies: deps }));
  const out = path.join(dir, 'fake.tgz');
  execFileSync('tar', ['czf', out, '-C', root, 'owner-repo-abc']);
  return fs.readFileSync(out);
}

function fakeGitHub(state) {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/repos/o/r/commits/')) { res.end(state.sha); return; }
    if (req.url.startsWith('/repos/o/r/tarball/')) { res.setHeader('content-type', 'application/gzip'); res.end(state.tarball); return; }
    res.statusCode = 404; res.end();
  });
}

const until = async (fn, ms = 15000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)); } };
const readStatus = (data) => { try { return JSON.parse(fs.readFileSync(path.join(data, 'update-status.json'), 'utf8')); } catch { return {}; } };

async function run(serverJs, deps, sha) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'simmer-launch-'));
  const state = { sha, tarball: makeTarball(data, serverJs, deps) };
  const gh = fakeGitHub(state);
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'launcher.js')], {
    stdio: 'ignore',
    env: { ...process.env, DATA_DIR: data, AUTO_UPDATE: 'true', UPDATE_REPO: 'o/r', UPDATE_FIRST_CHECK_MS: '300', GITHUB_API: `http://127.0.0.1:${gh.address().port}`, PORT: '3187' },
  });
  return { data, proc, stop: () => { proc.kill('SIGTERM'); gh.close(); } };
}

test('applies a newer commit and runs the updated code', async () => {
  const t = await run(`require('fs').writeFileSync(process.env.DATA_DIR + '/ran-new', 'yes'); setInterval(() => {}, 1000);`, bundledDeps, SHA_A);
  try {
    await until(() => fs.existsSync(path.join(t.data, 'ran-new')));
    await until(() => readStatus(t.data).current === SHA_A);
    assert.equal(fs.readFileSync(path.join(t.data, 'app', '.sha'), 'utf8'), SHA_A);
  } finally { t.stop(); }
});

test('rolls back when the updated code crashes, and does not retry that commit', async () => {
  const t = await run(`process.exit(1);`, bundledDeps, SHA_B);
  try {
    await until(() => readStatus(t.data).state === 'error' && /failed to start/.test(readStatus(t.data).message));
    assert.equal(readStatus(t.data).current, 'bundled');
    assert.equal(fs.readFileSync(path.join(t.data, '.bad-sha'), 'utf8'), SHA_B);
    assert.ok(!fs.existsSync(path.join(t.data, 'app')));
    // bundled server is serving again
    const ok = await until(async () => { try { return (await fetch('http://127.0.0.1:3187/healthz')).ok; } catch { return false; } });
    assert.ok(ok);
  } finally { t.stop(); }
});

test('does not apply an update that changes dependencies', async () => {
  const t = await run(`setInterval(() => {}, 1000);`, { ...bundledDeps, leftpad: '1.0.0' }, SHA_A);
  try {
    await until(() => readStatus(t.data).state === 'needs-rebuild');
    assert.ok(!fs.existsSync(path.join(t.data, 'app')));
  } finally { t.stop(); }
});
