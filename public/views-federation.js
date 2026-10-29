/* Linked Simmers: set up a link (admins) and share things with people on another Simmer. */
(() => {
  'use strict';
  const { $, t, esc, api } = S;
  const KIND = { recipe: 'fed.kRecipe', list: 'fed.kList', meal: 'fed.kMeal', collection: 'fed.kCollection' };
  const copy = async (text, btn) => { try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = t('acct.copied'); setTimeout(() => (btn.textContent = o), 1500); } catch { /* the text is selectable */ } };

  const status = (s) => (s.declined ? `<span class="muted">${esc(t('fed.declined'))}</span>` : s.error ? `<span class="err">${esc(I18n.err(s.error))}</span>` : `<span class="ok">${esc(t('fed.synced'))}</span>`);

  /** Share one thing with a person on another Simmer, and see/stop what is already shared. */
  S.remoteShareDialog = async ({ kind, ref, title }) => {
    const [peers, shares] = await Promise.all([api('/api/peers'), api(`/api/remote-shares?kind=${kind}&ref=${encodeURIComponent(ref)}`)]);
    S.modal('<div id="fd"></div>', (el, close) => {
      const draw = () => {
        $('#fd', el).innerHTML = `<h2 class="sec">${t('fed.shareTitle')}</h2><p class="muted" style="margin:0 0 8px"><b>${esc(title)}</b> · ${t(KIND[kind])}</p>
          <p class="muted" style="margin:0 0 10px">${t('fed.shareHelp_' + kind)}</p>
          ${shares.length ? `<ul class="plain">${shares.map((s) => `<li class="row between"><span>${esc(s.toUser)} <span class="muted">· ${esc(s.peerName)}</span><br>${status(s)}</span><button type="button" class="quiet" data-stop="${s.id}">${t('fed.stop')}</button></li>`).join('')}</ul>` : ''}
          <form id="ff" class="stack">
            <label for="fp">${t('fed.which')}</label><select id="fp">${peers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
            <label for="fu">${t('fed.username')}</label><input id="fu" autocomplete="off" autocapitalize="none" required placeholder="${esc(t('fed.usernamePh'))}">
            <p class="err" id="fe" hidden></p>
            <div class="row end"><button type="button" class="quiet" data-x>${t('fed.close')}</button><button class="primary">${t('fed.share')}</button></div>
          </form>`;
        $('[data-x]', el).onclick = close;
        el.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = async () => { b.disabled = true; await S.del('/api/remote-shares/' + b.dataset.stop); shares.splice(shares.findIndex((s) => s.id === b.dataset.stop), 1); draw(); }));
        $('#ff', el).onsubmit = async (e) => {
          e.preventDefault();
          const btn = $('#ff .primary', el); btn.disabled = true;
          try {
            const s = await S.post('/api/remote-shares', { peerId: $('#fp', el).value, toUser: $('#fu', el).value, kind, ref });
            shares.push(s); draw();
          } catch (x) { const er = $('#fe', el); er.textContent = x.message; er.hidden = false; btn.disabled = false; }
        };
      };
      draw();
    });
  };

  /** The "Share with another Simmer" button, shown only when this Simmer is linked to another. */
  S.remoteShareButton = (kind, ref, title, cls = '') => (S.me?.linkedSimmers ? `<button type="button" class="${cls}" data-rshare data-kind="${kind}" data-ref="${esc(ref)}" data-title="${esc(title)}">${S.ic('share')} ${t('fed.button')}</button>` : '');
  S.wireRemoteShare = (root) => root.querySelectorAll('[data-rshare]').forEach((b) => (b.onclick = () => S.remoteShareDialog({ kind: b.dataset.kind, ref: b.dataset.ref, title: b.dataset.title })));

  /** Account page: linked Simmers (admins set them up) and everything you have shared with them. */
  S.federationAccount = async (box) => {
    if (!box) return;
    let revealed = '', note = '';
    const draw = async () => {
      if (!$('#fedbox')) return;
      const [peers, shares] = await Promise.all([api('/api/peers'), api('/api/remote-shares')]);
      const admin = !!S.me.admin;
      box.innerHTML = `<h2 class="sec">${t('fed.title')}</h2><p class="muted">${t('fed.help')}</p>
        ${peers.length ? `<ul class="plain">${peers.map((p) => `<li class="row between wrap"><span><b>${esc(p.name)}</b>${admin ? ` <span class="muted">${esc(p.url)} · …${esc(p.secretEnd)}</span>` : ''}<span class="ok" data-r="${p.id}"></span></span>
          ${admin ? `<span class="row"><button type="button" class="quiet" data-test="${p.id}">${t('fed.test')}</button><button type="button" class="quiet" data-rm="${p.id}" data-n="${esc(p.name)}">${t('fed.remove')}</button></span>` : ''}</li>`).join('')}</ul>` : `<p class="muted">${t('fed.none')}</p>`}
        ${admin ? `<form id="fpf" class="stack"><h3 class="sub">${t('fed.add')}</h3>
          <label for="fpn">${t('fed.name')}</label><input id="fpn" required maxlength="60" placeholder="${esc(t('fed.namePh'))}">
          <label for="fpu">${t('fed.address')}</label><input id="fpu" inputmode="url" required placeholder="https://simmer.example.com" autocomplete="off">
          <label for="fps">${t('fed.token')}</label><input id="fps" autocomplete="off" placeholder="${esc(t('fed.tokenPh'))}">
          <p class="err" id="fpe" hidden></p>
          <div class="row"><button class="primary">${t('fed.link')}</button></div></form>` : ''}
        ${revealed ? `<div class="reveal"><p><b>${t('fed.revealTitle')}</b></p><p class="muted">${t('fed.revealHelp')}</p><code id="fptk">${esc(revealed)}</code><div class="row"><button type="button" id="fptc">${t('acct.copy')}</button></div></div>` : ''}
        ${note ? `<p class="ok">${esc(note)}</p>` : ''}
        ${shares.length ? `<h3 class="sub" style="margin-top:18px">${t('fed.mine')}</h3><ul class="plain">${shares.map((s) => `<li class="row between wrap"><span>${esc(s.label)} <span class="muted">· ${t(KIND[s.kind])} → ${esc(s.toUser)} (${esc(s.peerName)})</span><br>${status(s)}</span><button type="button" class="quiet" data-stop="${s.id}">${t('fed.stop')}</button></li>`).join('')}</ul>` : ''}`;
      $('#fpf')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const p = await S.post('/api/admin/peers', { name: $('#fpn').value, url: $('#fpu').value, secret: $('#fps').value.trim() || undefined });
          revealed = $('#fps').value.trim() ? '' : p.secret; note = t('fed.linked', { name: p.name }); await S.refreshMe(); draw();
        } catch (x) { $('#fpe').textContent = x.message; $('#fpe').hidden = false; }
      });
      $('#fptc')?.addEventListener('click', (e) => copy(revealed, e.target));
      box.querySelectorAll('[data-test]').forEach((b) => (b.onclick = async () => {
        b.disabled = true; const out = box.querySelector(`[data-r="${b.dataset.test}"]`);
        try { const r = await S.post(`/api/admin/peers/${b.dataset.test}/test`); out.className = r.ok ? 'ok' : 'err'; out.textContent = ' · ' + (r.ok ? t('fed.works') : I18n.err(r.error)); } catch (x) { out.className = 'err'; out.textContent = ' · ' + x.message; }
        b.disabled = false;
      }));
      box.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { if (confirm(t('fed.confirmRemove', { name: b.dataset.n }))) { await S.del('/api/admin/peers/' + b.dataset.rm); revealed = ''; await S.refreshMe(); draw(); } }));
      box.querySelectorAll('[data-stop]').forEach((b) => (b.onclick = async () => { b.disabled = true; await S.del('/api/remote-shares/' + b.dataset.stop); draw(); }));
    };
    box.id = box.id || 'fedbox';
    draw().catch(() => { box.hidden = true; });
  };
})();
