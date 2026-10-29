/* Linked Simmers: link two servers (both admins hand over their key), then share with people on the other one. */
(() => {
  'use strict';
  const { $, t, esc, api } = S;
  const copy = async (text, btn) => { try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = t('acct.copied'); setTimeout(() => (btn.textContent = o), 1500); } catch { /* the text can be selected by hand */ } };
  const status = (s) => (s.declined ? `<span class="muted">${esc(t('fed.declined'))}</span>` : s.error ? `<span class="err">${esc(I18n.err(s.error))}</span>` : `<span class="ok">${esc(t('fed.synced'))}</span>`);
  const KIND = { recipe: 'fed.kRecipe', list: 'fed.kList', meal: 'fed.kMeal', collection: 'fed.kCollection' };
  const parseRid = (id) => { const m = /^r:([\w-]+):(.+)$/.exec(id); return m && { peerId: m[1], username: m[2] }; };

  /** Share a whole collection with people on other Simmers (recipes, lists and meals use the normal Share dialog). */
  S.remoteShareDialog = async ({ kind, ref, title }) => {
    const [people, shares] = await Promise.all([api('/api/people'), api(`/api/remote-shares?kind=${kind}&ref=${encodeURIComponent(ref)}`)]);
    const far = people.filter((p) => p.remote);
    const had = new Map(shares.map((s) => [`r:${s.peerId}:${s.toUser}`.toLowerCase(), s]));
    S.modal(`<h2 class="sec">${t('fed.shareTitle')}</h2><p class="muted" style="margin:0 0 8px"><b>${esc(title)}</b> · ${t(KIND[kind])}</p><p class="muted" style="margin:0 0 10px">${t('fed.shareHelp_collection')}</p>
      <form id="ff" class="stack"><fieldset><legend>${t('share.otherSimmers')}</legend>${far.length ? far.map((p) => `<label class="pick"><input type="checkbox" value="${esc(p.id)}" ${had.has(p.id.toLowerCase()) ? 'checked' : ''}><span>${esc(p.name)} · ${esc(p.server)}</span></label>`).join('') : `<p class="muted">${t('share.noPeople')}</p>`}</fieldset>
        <p class="err" id="fe" hidden></p>
        <div class="row end"><button type="button" class="quiet" data-x>${t('share.cancel')}</button><button class="primary">${t('share.save')}</button></div></form>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      $('#ff', el).onsubmit = async (e) => {
        e.preventDefault();
        const want = new Set([...el.querySelectorAll('#ff input:checked')].map((c) => c.value.toLowerCase()));
        try {
          for (const [k, s] of had) if (!want.has(k)) await S.del('/api/remote-shares/' + s.id);
          for (const k of want) if (!had.has(k)) { const r = parseRid(far.find((p) => p.id.toLowerCase() === k).id); await S.post('/api/remote-shares', { peerId: r.peerId, toUser: r.username, kind, ref }); }
          close();
        } catch (x) { const er = $('#fe', el); er.textContent = x.message; er.hidden = false; }
      };
    });
  };
  S.remoteShareButton = (kind, ref, title, cls = '') => (S.me?.linkedSimmers ? `<button type="button" class="${cls}" data-rshare data-kind="${kind}" data-ref="${esc(ref)}" data-title="${esc(title)}">${S.ic('globe')} ${t('fed.button')}</button>` : '');
  S.wireRemoteShare = (root) => root.querySelectorAll('[data-rshare]').forEach((b) => (b.onclick = () => S.remoteShareDialog({ kind: b.dataset.kind, ref: b.dataset.ref, title: b.dataset.title })));

  /** Account page. Admins link servers; everyone sees what they have shared with other Simmers. */
  S.federationAccount = async (box) => {
    if (!box) return;
    let ov = null, shown = false, msg = '', err = '';
    const refresh = async () => { S.refreshMe().catch(() => {}); };
    const draw = async () => {
      if (!$('#fedbox')) return;
      const admin = !!S.me.admin;
      const [shares, peers] = await Promise.all([api('/api/remote-shares'), admin ? Promise.resolve(null) : api('/api/peers')]);
      if (admin) ov = ov || (await api('/api/admin/federation'));
      const list = admin ? ov.peers : peers.map((p) => ({ ...p, state: 'active' }));
      box.innerHTML = `<h2 class="sec">${t('fed.title')}</h2><p class="muted">${t('fed.help')}</p>
        ${msg ? `<p class="ok">${esc(msg)}</p>` : ''}${err ? `<p class="err">${esc(err)}</p>` : ''}
        ${admin ? `
        <h3 class="sub">${t('fed.yourKey')}</h3>
        <p class="muted" style="margin:0 0 6px">${t('fed.yourKeyHelp')}</p>
        <div class="keybox"><code id="fk">${shown ? esc(ov.key) : '•'.repeat(24)}</code><button type="button" id="fshow">${t(shown ? 'fed.hide' : 'fed.show')}</button><button type="button" id="fcopy">${t('acct.copy')}</button></div>
        <p class="muted" style="margin:6px 0 0"><button type="button" class="quiet" id="fnew">${t('fed.newKey')}</button> <button type="button" class="quiet" id="fname">${esc(t('fed.shownAs', { name: ov.name }))}</button></p>
        ${ov.pending.length ? `<h3 class="sub" style="margin-top:18px">${t('fed.requests')}</h3>${ov.pending.map((r) => `<div class="reqbox"><p style="margin:0 0 6px"><b>${esc(r.name)}</b> <span class="muted">${esc(r.url)}</span><br>${t('fed.requestHelp', { name: esc(r.name) })}</p>
          <label for="rk-${r.id}">${t('fed.theirKey')}</label><input id="rk-${r.id}" data-rk="${r.id}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(t('fed.pasteKey'))}">
          <div class="row" style="margin-top:8px"><button type="button" class="primary" data-accept="${r.id}">${t('fed.accept')}</button><button type="button" class="quiet" data-decline="${r.id}">${t('fed.decline')}</button></div></div>`).join('')}` : ''}` : ''}
        <h3 class="sub" style="margin-top:18px">${t('fed.linkedTitle')}</h3>
        ${list.length ? `<ul class="plain">${list.map((p) => `<li class="row between wrap"><span><b>${esc(p.name)}</b>${admin ? ` <span class="muted">${esc(p.url)}</span>` : ''}<br>${p.state === 'active' ? `<span class="ok">${t('fed.linked')}</span>` : `<span class="muted">${esc(t('fed.waiting', { name: p.name }))}</span>`}<span data-r="${p.id}"></span></span>
          ${admin ? `<span class="row">${p.state === 'active' ? `<button type="button" class="quiet" data-test="${p.id}">${t('fed.test')}</button>` : ''}<button type="button" class="quiet" data-rm="${p.id}" data-n="${esc(p.name)}" data-w="${p.state === 'active' ? '' : '1'}">${t(p.state === 'active' ? 'fed.remove' : 'fed.cancel')}</button></span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${t('fed.none')}</p>`}
        ${admin ? `<form id="fpf" class="stack"><h3 class="sub">${t('fed.add')}</h3><p class="muted" style="margin:0">${t('fed.addHelp')}</p>
          <label for="fpu">${t('fed.address')}</label><input id="fpu" inputmode="url" required placeholder="https://simmer.example.com" autocomplete="off" autocapitalize="none">
          <label for="fpk">${t('fed.theirKey')}</label><input id="fpk" required autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(t('fed.pasteKey'))}">
          <div class="row"><button class="primary">${t('fed.ask')}</button></div></form>` : ''}
        ${shares.length ? `<h3 class="sub" style="margin-top:18px">${t('fed.mine')}</h3><ul class="plain">${shares.map((s) => `<li class="row between wrap"><span>${esc(s.label)} <span class="muted">· ${t(KIND[s.kind])} → ${esc(s.toUser)} (${esc(s.peerName)})</span><br>${status(s)}</span><button type="button" class="quiet" data-stop="${s.id}">${t('fed.stop')}</button></li>`).join('')}</ul>` : ''}`;
      wire();
    };
    const run = async (fn) => { msg = ''; err = ''; try { await fn(); } catch (x) { err = I18n.err(x.message); } await refresh(); await draw(); };
    const wire = () => {
      $('#fshow')?.addEventListener('click', () => { shown = !shown; draw(); });
      $('#fcopy')?.addEventListener('click', (e) => copy(ov.key, e.target));
      $('#fnew')?.addEventListener('click', () => confirm(t('fed.confirmNewKey')) && run(async () => { ov = await S.post('/api/admin/federation/new-key'); shown = true; msg = t('fed.newKeyDone'); }));
      $('#fname')?.addEventListener('click', () => { const n = prompt(t('fed.namePrompt'), ov.name); if (n && n.trim()) run(async () => { ov = await S.put('/api/admin/federation', { name: n }); }); });
      $('#fpf')?.addEventListener('submit', (e) => { e.preventDefault(); run(async () => { ov = await S.post('/api/admin/peers', { url: $('#fpu').value, key: $('#fpk').value.trim(), selfUrl: location.origin }); msg = t('fed.asked'); }); });
      box.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = () => run(async () => { ov = await S.post(`/api/admin/pending/${b.dataset.accept}/accept`, { key: box.querySelector(`[data-rk="${b.dataset.accept}"]`).value.trim(), selfUrl: location.origin }); msg = t('fed.accepted'); })));
      box.querySelectorAll('[data-decline]').forEach((b) => (b.onclick = () => run(async () => { ov = await S.del('/api/admin/pending/' + b.dataset.decline); })));
      box.querySelectorAll('[data-test]').forEach((b) => (b.onclick = async () => {
        b.disabled = true; const out = box.querySelector(`[data-r="${b.dataset.test}"]`);
        try { const r = await S.post(`/api/admin/peers/${b.dataset.test}/test`); out.className = r.ok ? 'ok' : 'err'; out.textContent = ' · ' + (r.ok ? t('fed.works') : I18n.err(r.error)); } catch (x) { out.className = 'err'; out.textContent = ' · ' + x.message; }
        b.disabled = false;
      }));
      box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => (b.dataset.w || confirm(t('fed.confirmRemove', { name: b.dataset.n }))) && run(async () => { ov = await S.del('/api/admin/peers/' + b.dataset.rm); })));
      box.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = () => run(async () => { await S.del('/api/remote-shares/' + b.dataset.stop); })));
    };
    box.id = box.id || 'fedbox';
    draw().catch(() => { box.hidden = true; });
  };
})();
