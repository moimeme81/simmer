/* Import & export: move recipes, lists and the meal plan to and from other apps. */
(() => {
  'use strict';
  const { $, t, esc, api } = S;
  const auth = () => { const tok = S.embedToken?.()?.token; return tok ? { authorization: 'Bearer ' + tok } : {}; };

  async function download(url, btn) {
    btn.disabled = true;
    try {
      const r = await fetch(url, { headers: auth() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'simmer-export';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob()); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } finally { btn.disabled = false; }
  }

  function summary(j) {
    const bits = [t('xch.sumRecipes', { n: j.imported }), j.updated ? t('xch.sumUpdated', { n: j.updated }) : '', j.photos ? t('import.cPhotos', { n: j.photos }) : '',
      j.lists ? t('import.cLists', { n: j.lists }) : '', j.meals ? t('xch.sumMeals', { n: j.meals }) : '', j.skipped ? t('import.skipped', { n: j.skipped }) : ''].filter(Boolean);
    return `<p><b>${esc(t('xch.read', { f: j.format }))}</b></p><div class="chips">${bits.map((b) => `<span class="chip">${esc(b)}</span>`).join('')}</div>${(j.errors || []).length ? `<ul class="err" style="font-size:15px">${j.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
  }

  let timer;
  S.exchangePanel = async (box) => {
    clearInterval(timer);
    box.innerHTML = `
      <div class="panel" id="xout">
        <h2 class="sec">${t('xch.exportTitle')}</h2>
        <p class="muted" style="margin:0 0 10px">${t('xch.exportHelp')}</p>
        <div class="xlist">
          ${[['backup', 'xch.backup', '/api/export/backup'], ['paprika', 'xch.paprika', '/api/export/paprika'], ['cookbook', 'xch.cookbook', '/api/export/cookbook'], ['lists', 'xch.lists', '/api/export/lists.csv'], ['plan', 'xch.plan', '/api/export/mealplan.ics']]
            .map(([k, l, u]) => `<div class="xrow"><div><b>${t(l)}</b><div class="muted">${t(l + 'Help')}</div></div><button type="button" data-u="${u}">${t('xch.download')}</button></div>`).join('')}
        </div>
        <p class="err" id="xe1" hidden></p>
      </div>
      <div class="panel" id="xin" style="margin-top:18px">
        <h2 class="sec">${t('xch.importTitle')}</h2>
        <p class="muted" style="margin:0 0 10px">${t('xch.importHelp')}</p>
        <input type="file" id="xf" accept=".zip,.paprikarecipes,.paprikarecipe,.json,application/zip,application/json" hidden>
        <div class="cta" style="margin:0"><button class="primary" type="button" id="xpick">${t('xch.choose')}</button></div>
        <div id="xres" style="margin-top:12px"></div>
      </div>
      <div class="panel" id="xm" style="margin-top:18px">
        <h2 class="sec">Mealie</h2>
        <p class="muted" style="margin:0 0 8px">${t('xch.mealieHelp')}</p>
        <form id="xmf">
          <label for="xmu">${t('xch.mealieUrl')}</label><input id="xmu" name="url" inputmode="url" placeholder="http://192.168.1.20:9925" autocomplete="off" required>
          <label for="xmt">${t('xch.mealieToken')}</label><input id="xmt" name="token" type="password" autocomplete="off" required>
          <div class="cta" style="margin:16px 0 0"><button class="primary" type="button" id="xmi">${t('xch.fromMealie')}</button><button type="button" id="xme">${t('xch.toMealie')}</button></div>
        </form>
        <div id="xmp" style="margin-top:8px"></div>
      </div>`;

    box.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => {
      $('#xe1').hidden = true;
      try { await download(b.dataset.u, b); } catch (x) { $('#xe1').textContent = x.message; $('#xe1').hidden = false; }
    }));

    const file = $('#xf');
    $('#xpick').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      const res = $('#xres'); res.innerHTML = `<p>${t('xch.reading', { name: esc(f.name) })}</p>`;
      try {
        const r = await fetch('/api/import/file', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name), ...auth() }, body: f });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(I18n.err(j.error || r.statusText));
        res.innerHTML = summary(j) + `<div class="cta"><a href="#/"><button class="primary" type="button">${t('import.view')}</button></a></div>`;
      } catch (x) { res.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
      file.value = '';
    };

    const prog = $('#xmp');
    const draw = (s) => {
      if (s.state === 'idle' || !$('#xmp')) return;
      const fin = s.done + s.failed + (s.skipped || 0), pct = s.total ? Math.round((fin / s.total) * 100) : 0;
      const label = { login: t('xch.mLogin'), fetching: t('xch.mFetching'), recipes: t('import.recipes', { n: fin, total: s.total }), done: t('import.done') }[s.phase] || '';
      prog.innerHTML = s.state === 'error' ? `<p class="err">${esc(I18n.err(s.error))}</p>`
        : `<p style="margin:10px 0 0"><b>${esc(label)}</b></p><div class="bar"><i style="width:${s.state === 'done' ? 100 : pct}%"></i></div>
           <div class="chips"><span class="chip">${t('import.cRecipes', { n: s.done })}</span><span class="chip">${t('import.cPhotos', { n: s.photos })}</span>${s.skipped ? `<span class="chip">${t('xch.alreadyThere', { n: s.skipped })}</span>` : ''}${s.failed ? `<span class="chip bad">${t('import.failed', { n: s.failed })}</span>` : ''}</div>
           ${(s.errors || []).length ? `<ul class="err" style="font-size:15px">${s.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
      const busy = s.state === 'running';
      $('#xmi').disabled = busy; $('#xme').disabled = busy;
      if (!busy) clearInterval(timer);
    };
    const poll = async () => { try { draw(await api('/api/exchange/status')); } catch { /* next tick */ } };
    const start = async (path) => {
      const form = $('#xmf');
      if (!form.reportValidity()) return;
      const f = new FormData(form);
      prog.innerHTML = `<p>${t('import.starting')}</p>`;
      try { await api(path, { method: 'POST', body: { url: f.get('url'), token: f.get('token') } }); form.token.value = ''; clearInterval(timer); timer = setInterval(poll, 1000); poll(); }
      catch (x) { prog.innerHTML = `<p class="err">${esc(x.message)}</p>`; }
    };
    $('#xmi').onclick = () => start('/api/exchange/mealie/import');
    $('#xme').onclick = () => start('/api/exchange/mealie/export');
    try { const s = await api('/api/exchange/status'); if (s.state === 'running') { draw(s); timer = setInterval(poll, 1000); } else if (s.state !== 'idle') draw(s); } catch { /* ignore */ }
  };
})();
