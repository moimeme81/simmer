/*
 * Kitchen timers. Several can run at once, they survive a page reload (stored as end times, so
 * they stay accurate even if the tab was asleep), and a finished timer rings until dismissed.
 */
window.Timers = (() => {
  'use strict';
  const KEY = 'simmer-timers';
  const subs = new Set();
  let list = [];
  let ctx = null;          // AudioContext, created on the first tap so browsers allow sound
  let alarmTimer = null;
  let alarmStarted = 0;

  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ } };
  const emit = () => { subs.forEach((f) => { try { f(); } catch { /* a bad listener must not stop the clock */ } }); };
  const uid = () => Math.random().toString(36).slice(2, 9);

  function remainingMs(t) {
    if (t.done) return 0;
    return t.paused != null ? t.paused : Math.max(0, t.endsAt - Date.now());
  }

  function unlockAudio() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch { /* no audio available */ }
  }

  function beep(freq, at, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(at); o.stop(at + dur + 0.05);
  }

  function ring() {
    try {
      if (ctx) { const now = ctx.currentTime; [0, 0.25, 0.5].forEach((d) => beep(988, now + d, 0.16)); }
      navigator.vibrate?.([250, 120, 250, 120, 250]);
    } catch { /* ignore */ }
  }

  function syncAlarm() {
    const ringing = list.some((t) => t.done && !t.silenced);
    if (ringing && !alarmTimer) {
      alarmStarted = Date.now();
      ring();
      alarmTimer = setInterval(() => {
        if (Date.now() - alarmStarted > 120000) { list.forEach((t) => { if (t.done) t.silenced = true; }); save(); syncAlarm(); emit(); return; }
        ring();
      }, 1800);
    } else if (!ringing && alarmTimer) {
      clearInterval(alarmTimer); alarmTimer = null;
    }
  }

  function notify(t) {
    try {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Simmer', { body: t.label, tag: t.id });
    } catch { /* ignore */ }
  }

  function tick() {
    let changed = false;
    for (const t of list) {
      if (!t.done && t.paused == null && t.endsAt <= Date.now()) { t.done = true; t.silenced = false; changed = true; notify(t); }
    }
    if (changed) { save(); syncAlarm(); }
    emit();
  }

  const find = (id) => list.find((t) => t.id === id);

  const api = {
    list: () => list,
    remaining: (t) => remainingMs(t) / 1000,
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    anyRinging: () => list.some((t) => t.done && !t.silenced),

    add({ label, seconds }) {
      unlockAudio();
      try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
      const t = { id: uid(), label: String(label || '').slice(0, 80), total: seconds, endsAt: Date.now() + seconds * 1000, paused: null, done: false, silenced: false };
      list.push(t); save(); emit();
      return t;
    },
    pause(id) { const t = find(id); if (t && !t.done && t.paused == null) { t.paused = remainingMs(t); t.endsAt = null; save(); emit(); } },
    resume(id) { const t = find(id); if (t && t.paused != null) { t.endsAt = Date.now() + t.paused; t.paused = null; unlockAudio(); save(); emit(); } },
    addTime(id, seconds) {
      const t = find(id); if (!t) return;
      unlockAudio();
      if (t.done) { t.done = false; t.silenced = false; t.endsAt = Date.now() + seconds * 1000; t.total = seconds; }
      else if (t.paused != null) { t.paused += seconds * 1000; t.total += seconds; }
      else { t.endsAt += seconds * 1000; t.total += seconds; }
      save(); syncAlarm(); emit();
    },
    restart(id) { const t = find(id); if (t) { t.done = false; t.silenced = false; t.paused = null; t.endsAt = Date.now() + t.total * 1000; unlockAudio(); save(); syncAlarm(); emit(); } },
    silence(id) { const t = find(id); if (t) { t.silenced = true; save(); syncAlarm(); emit(); } },
    remove(id) { list = list.filter((t) => t.id !== id); save(); syncAlarm(); emit(); },
    unlockAudio,
  };

  list = load();
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  tick();
  return api;
})();
