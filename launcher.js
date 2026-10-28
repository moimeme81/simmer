'use strict';
/*
 * Simmer launcher: PID 1 of the container. Starts the app and (optionally) keeps it up to date
 * straight from the GitHub repo, with no Docker registry involved.
 *
 *  - The image contains a bundled copy of the app. An updated copy lives in DATA_DIR/app.
 *  - Every UPDATE_INTERVAL_HOURS (and when the UI asks via SIGUSR1) it compares the repo's
 *    latest commit to the one in DATA_DIR/app/.sha, downloads the tarball if newer, and restarts the app.
 *  - If an updated copy crashes within 30 s of starting, it is set aside, the bundled copy runs
 *    instead, and that commit is not tried again.
 *  - An update that changes package.json dependencies is not applied (the image must be rebuilt for those).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const env = process.env;
const DATA = env.DATA_DIR || '/data';
const BUNDLED = __dirname;
const APP = path.join(DATA, 'app');
const cfg = {
  enabled: env.AUTO_UPDATE === 'true',
  repo: env.UPDATE_REPO || 'moimeme81/simmer',
  branch: env.UPDATE_BRANCH || 'main',
  hours: +env.UPDATE_INTERVAL_HOURS || 24,
  token: env.GITHUB_TOKEN || '',
  api: (env.GITHUB_API || 'https://api.github.com').replace(/\/$/, ''),
  firstCheckMs: +env.UPDATE_FIRST_CHECK_MS || 15000,
};
const STATUS_FILE = path.join(DATA, 'update-status.json');
const BAD_FILE = path.join(DATA, '.bad-sha');
const log = (m) => console.log(`[launcher] ${m}`);

/* ---------- status file (read by the web UI) ---------- */
let status = { enabled: cfg.enabled, repo: cfg.repo, current: 'bundled', state: 'idle', message: '' };
function setStatus(patch) {
  status = { ...status, ...patch };
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2)); } catch { /* best effort */ }
}

const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const hasApp = (dir) => fs.existsSync(path.join(dir, 'src', 'server.js'));
const depsOf = (dir) => { try { return JSON.stringify(Object.entries(JSON.parse(read(path.join(dir, 'package.json'))).dependencies || {}).sort()); } catch { return ''; } };
const currentSha = () => (hasApp(APP) ? read(path.join(APP, '.sha')) || 'unknown' : 'bundled');

/* ---------- GitHub ---------- */
async function gh(url, accept) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
    headers: { 'user-agent': 'simmer-launcher', accept, ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
  return res;
}
const latestSha = async () => {
  const sha = (await (await gh(`${cfg.api}/repos/${cfg.repo}/commits/${cfg.branch}`, 'application/vnd.github.sha')).text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Unexpected reply from GitHub');
  return sha;
};

async function downloadAndSwap(sha) {
  const tmpDir = path.join(DATA, 'app-new');
  const tgz = path.join(DATA, 'app-download.tgz');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const buf = Buffer.from(await (await gh(`${cfg.api}/repos/${cfg.repo}/tarball/${sha}`, 'application/vnd.github+json')).arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) throw new Error('Update is unexpectedly large');
  fs.writeFileSync(tgz, buf);
  execFileSync('tar', ['xzf', tgz, '-C', tmpDir, '--strip-components=1']);
  fs.rmSync(tgz, { force: true });
  if (!hasApp(tmpDir)) throw new Error('Downloaded update has no src/server.js');
  if (depsOf(tmpDir) !== depsOf(BUNDLED)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return 'needs-rebuild';
  }
  fs.writeFileSync(path.join(tmpDir, '.sha'), sha);
  fs.rmSync(path.join(DATA, 'app-prev'), { recursive: true, force: true });
  if (fs.existsSync(APP)) fs.renameSync(APP, path.join(DATA, 'app-prev'));
  fs.renameSync(tmpDir, APP);
  return 'updated';
}

/** Returns true when new code was swapped in and the app should restart. */
async function checkForUpdate() {
  if (!cfg.enabled) return false;
  setStatus({ state: 'checking', message: '' });
  try {
    const latest = await latestSha();
    const checkedAt = new Date().toISOString();
    if (latest === read(BAD_FILE)) { setStatus({ state: 'error', latest, checkedAt, message: 'The newest version failed to start and was skipped.' }); return false; }
    if (latest === currentSha()) { setStatus({ state: 'idle', latest, checkedAt, message: 'Up to date.' }); return false; }
    log(`updating ${currentSha().slice(0, 7)} -> ${latest.slice(0, 7)}`);
    const result = await downloadAndSwap(latest);
    if (result === 'needs-rebuild') {
      setStatus({ state: 'needs-rebuild', latest, checkedAt, message: 'A newer version changes dependencies. Rebuild the image (run the build command) to get it.' });
      return false;
    }
    setStatus({ state: 'updated', current: latest, latest, checkedAt, message: 'Updated. Restarting.' });
    return true;
  } catch (e) {
    setStatus({ state: 'error', checkedAt: new Date().toISOString(), message: `Update check failed: ${e.message}` });
    return false;
  }
}

/* ---------- child process ---------- */
let child = null;
let shuttingDown = false;
let restarting = false;
let startedAt = 0;
let runningRoot = BUNDLED;

function startApp() {
  runningRoot = hasApp(APP) ? APP : BUNDLED;
  startedAt = Date.now();
  setStatus({ current: currentSha() });
  log(`starting app from ${runningRoot === APP ? 'updated copy ' + currentSha().slice(0, 7) : 'bundled copy'}`);
  child = spawn(process.execPath, [path.join(runningRoot, 'src', 'server.js')], {
    stdio: 'inherit',
    env: { ...env, NODE_PATH: path.join(BUNDLED, 'node_modules'), SIMMER_LAUNCHER_PID: String(process.pid) },
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (shuttingDown) process.exit(code ?? 0);
    if (restarting) { restarting = false; return startApp(); }
    if (runningRoot === APP && Date.now() - startedAt < 30000) {
      const bad = currentSha();
      log(`updated copy ${bad.slice(0, 7)} crashed on start (code ${code}); rolling back to the bundled copy`);
      fs.writeFileSync(BAD_FILE, bad);
      fs.rmSync(path.join(DATA, 'app-bad'), { recursive: true, force: true });
      fs.renameSync(APP, path.join(DATA, 'app-bad'));
      setStatus({ current: 'bundled', state: 'error', message: `Version ${bad.slice(0, 7)} failed to start, so the bundled version is running.` });
      return startApp();
    }
    log(`app exited (code ${code}, signal ${signal})`);
    process.exit(code || 1); // Docker's restart policy decides what happens next
  });
}

async function updateAndRestart() {
  if (shuttingDown || restarting) return;
  if (await checkForUpdate()) { restarting = true; child?.kill('SIGTERM'); }
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { shuttingDown = true; if (child) child.kill(sig); else process.exit(0); });
}
process.on('SIGUSR1', () => { updateAndRestart(); });

setStatus({});
startApp();
if (cfg.enabled) {
  log(`auto-update on: ${cfg.repo}@${cfg.branch}, every ${cfg.hours} h`);
  setTimeout(updateAndRestart, cfg.firstCheckMs).unref();
  setInterval(updateAndRestart, cfg.hours * 3600 * 1000).unref();
}
