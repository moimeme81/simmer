/* Sign in, first-run setup, joining by invite, and the account page. */
(() => {
  'use strict';
  const { $, t, esc, api, ic } = S;
  const flash = (el, msg, bad) => { el.textContent = msg; el.className = bad ? 'err' : 'ok'; el.hidden = false; };

  /** kind: 'setup' | 'login' | 'join' | 'reset' */
  S.authScreen = async (kind, code) => {
    document.body.classList.add('auth');
    let invalid = false, who = '';
    if (kind === 'join') invalid = !(await api('/api/auth/invite/' + encodeURIComponent(code))).valid;
    if (kind === 'reset') { const r = await api('/api/auth/reset/' + encodeURIComponent(code)); invalid = !r.valid; who = r.name; }
    const joining = kind === 'join' || kind === 'setup';
    S.app.innerHTML = `
      <div class="authcard">
        <img src="icon-192.png" alt="" width="72" height="72">
        <h1>${t(kind === 'setup' ? 'auth.setupTitle' : kind === 'join' ? 'auth.joinTitle' : kind === 'reset' ? 'auth.resetTitle' : 'auth.loginTitle')}</h1>
        <p class="muted">${kind === 'reset' && !invalid ? esc(t('auth.resetBlurb', { name: who })) : t(kind === 'setup' ? 'auth.setupBlurb' : kind === 'join' ? 'auth.joinBlurb' : '')}</p>
        ${invalid ? `<p class="err">${t(kind === 'reset' ? 'auth.badReset' : 'auth.badInvite')}</p>` : kind === 'reset' ? `
        <form class="panel stack" id="af"><label for="ap">${t('acct.new')}</label><input id="ap" name="password" type="password" autocomplete="new-password" minlength="8" required><small class="muted">${t('auth.hint')}</small>
          <p class="err" id="aerr" hidden></p><button class="primary wide">${t('auth.resetGo')}</button></form>` : `
        <form class="panel stack" id="af">
          ${joining ? `<label for="an">${t('auth.name')}</label><input id="an" name="name" autocomplete="name" required>` : ''}
          <label for="au">${t('auth.username')}</label><input id="au" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          <label for="ap">${t('auth.password')}</label><input id="ap" name="password" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}" minlength="${joining ? 8 : 1}" required>
          ${joining ? `<small class="muted">${t('auth.hint')}</small>` : ''}
          <div id="acodebox" hidden><label for="acode">${t('tf.signInCode')}</label><input id="acode" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" inputmode="text"><small class="muted">${t('tf.signInHelp')}</small></div>
          <p class="err" id="aerr" hidden></p>
          <button class="primary wide">${t(joining ? 'auth.create' : 'auth.login')}</button>
        </form>`}
        ${kind === 'login' ? `<details class="forgot"><summary>${t('auth.forgot')}</summary><p class="muted">${t('auth.forgotHelp')}</p></details>` : ''}
        <button class="quiet" id="alang">${t('lang.other')}</button>
      </div>`;
    $('#alang').onclick = () => { I18n.set(I18n.lang === 'fr' ? 'en' : 'fr'); S.authScreen(kind, code); };
    const form = $('#af');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(form));
      try {
        if (kind === 'reset') { await S.post('/api/auth/reset', { code, password: b.password }); history.replaceState(null, '', '#/'); return S.authScreen('login'); }
        if (kind === 'setup') await S.post('/api/auth/setup', b);
        else if (kind === 'join') await S.post('/api/auth/register', { ...b, invite: code });
        else if (S.embedded) S.setEmbedToken(await S.post('/api/auth/login', { ...b, asToken: true }));
        else await S.post('/api/auth/login', b);
        if (kind === 'join') history.replaceState(null, '', '#/');
        S.boot();
      } catch (x) {
        if (x.code === 'needs-2fa') { $('#acodebox').hidden = false; $('#acode').required = true; $('#acode').focus(); if (b.code) flash($('#aerr'), x.message, true); else $('#aerr').hidden = true; return; }
        flash($('#aerr'), x.message, true);
      }
    };
  };

  /* ---------- account page ---------- */
  const copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); btn.textContent = t('acct.copied'); } catch { /* clipboard blocked: the text is selectable */ }
  };

  S.views.account = async () => {
    await S.refreshMe();
    const me = S.me;
    const [tokens, users] = await Promise.all([api('/api/tokens'), me.admin ? api('/api/admin/users') : []]);
    let newToken = '', inviteLink = '', resetLink = null;

    const draw = () => {
      S.app.innerHTML = `
        <h1 class="rtitle" style="margin-top:0">${t('acct.title')}</h1>
        <div class="cols">
          <section class="panel stack">
            <h2 class="sec">${t('acct.profile')}</h2>
            <div class="photorow">${S.avatar(me, 84)}<div class="stack"><div class="row"><button type="button" id="ph">${ic('camera')} ${t('acct.photoChange')}</button>${me.avatar ? `<button type="button" id="phx" class="quiet">${t('acct.photoRemove')}</button>` : ''}</div>
              <small class="muted">${t('acct.photoHelp')}</small><p id="phm" hidden></p><input id="phf" type="file" accept="image/*" hidden></div></div>
            <form id="pf"><label for="pn">${t('auth.name')}</label><input id="pn" value="${esc(me.name)}" required>
              <p class="muted" style="margin:6px 0 0">@${esc(me.username)}${me.admin ? ` · ${t('acct.admin')}` : ''}</p>
              <p id="pfm" hidden></p>
              <div class="row"><button class="primary">${t('acct.save')}</button><button type="button" id="out" class="quiet">${t('auth.logout')}</button></div></form>
            <h2 class="sec" style="margin-top:22px">${t('cook.interface')}</h2>
            <form id="cs" class="stack">${[['focus', 'cook.focus'], ['page', 'cook.page']].map(([v, k]) => `<label class="pick"><input type="radio" name="cs" value="${v}" ${(me.cookStyle || 'focus') === v ? 'checked' : ''}><span>${t(k)}</span></label>`).join('')}</form>
            <h2 class="sec" style="margin-top:22px">${t('units.title')}</h2>
            <form id="un" class="stack"><p class="muted" style="margin:0">${t('units.help')}</p>${['mass', 'vol', 'len', 'temp'].map((k) => `<label for="un_${k}">${t('units.' + k)}</label><select id="un_${k}" data-k="${k}">${['orig', 'metric', 'imperial', 'both'].map((v) => `<option value="${v}" ${(me.units?.[k] || 'orig') === v ? 'selected' : ''}>${t('units.' + v)}</option>`).join('')}</select>`).join('')}</form>
            <h2 class="sec" style="margin-top:22px">${t('pwa.title')}</h2>
            <div class="stack"><p class="muted" style="margin:0">${t(S.isInstalled() ? 'pwa.done' : 'pwa.help')}</p>${S.installPrompt && !S.isInstalled() ? `<div class="row"><button type="button" id="installBtn" class="primary">${t('pwa.install')}</button></div>` : ''}</div>
            <h2 class="sec" style="margin-top:22px">${t('acct.password')}</h2>
            <form id="pw"><label for="pc">${t('acct.current')}</label><input id="pc" type="password" autocomplete="current-password" required>
              <label for="pnw">${t('acct.new')}</label><input id="pnw" type="password" autocomplete="new-password" minlength="8" required>
              <p id="pwm" hidden></p><div class="row"><button>${t('acct.save')}</button></div></form>
            <h2 class="sec" style="margin-top:22px">${t('tf.title')}</h2>
            <div id="tfbox"></div>
          </section>

          <section class="panel stack">
            <h2 class="sec">${t('acct.households')}</h2>
            <p class="muted">${t('acct.hhHelp')}</p>
            ${me.households.map((h) => `
              <div class="hh" data-h="${h.id}">
                <div class="row between"><b>${esc(h.name)}</b>${h.mine ? `<span class="chip">${t('acct.owner')}</span>` : ''}</div>
                <div class="chips">${h.members.map((m) => `<span class="chip soft">${S.avatar(m, 22)}${esc(m.id === me.id ? t('acct.you') : m.name)}${h.mine && m.id !== me.id ? ` <button class="xs" data-rm="${m.id}" aria-label="${esc(t('acct.remove'))} ${esc(m.name)}">×</button>` : ''}</span>`).join('')}</div>
                <div class="row">
                  <select data-add aria-label="${esc(t('acct.pick'))}"><option value="">${t('acct.pick')}</option>${S.people.filter((p) => !h.members.some((m) => m.id === p.id)).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
                  <button data-addbtn>${t('acct.add')}</button>
                </div>
                <div class="row"><button class="quiet" data-leave>${t('acct.leave')}</button>${h.mine ? `<button class="quiet" data-delhh>${t('acct.deleteHh')}</button>` : ''}</div>
              </div>`).join('')}
            <form id="nh" class="row"><input id="nhn" placeholder="${esc(t('acct.hhName'))}" aria-label="${esc(t('acct.hhName'))}" required><button>${t('acct.newHh')}</button></form>
            ${me.households.length ? `<h3 style="margin:18px 0 4px;font-size:18px">${t('acct.autoShare')}</h3><p class="muted" style="margin:0 0 6px">${t('acct.autoShareHelp')}</p>
              <form id="as">${me.households.map((h) => `<label class="pick"><input type="checkbox" value="${h.id}" ${me.autoShare.includes(h.id) ? 'checked' : ''}><span>${esc(h.name)}</span></label>`).join('')}</form>` : ''}
          </section>

          <section class="panel stack">
            <h2 class="sec">${t('acct.ha')}</h2>
            <p class="muted">${t('acct.haHelp')}</p>
            <p><b>${t('acct.address')}</b><br><code>${esc(location.origin)}</code></p>
            <h3 style="margin:12px 0 4px;font-size:18px">${t('acct.tokens')}</h3>
            <p class="muted" style="margin:0 0 8px">${t('acct.tokensHelp')}</p>
            ${newToken ? `<div class="reveal"><p><b>${t('acct.tokenOnce')}</b></p><code id="tk">${esc(newToken)}</code><div class="row"><button id="tkc">${t('acct.copy')}</button></div></div>` : ''}
            <ul class="plain">${tokens.map((k) => `<li class="row between"><span>${esc(k.name)}</span><button class="quiet" data-revoke="${k.id}">${t('acct.revoke')}</button></li>`).join('')}</ul>
            <form id="tf" class="row"><input id="tn" placeholder="${esc(t('acct.tokenName'))}" aria-label="${esc(t('acct.tokenName'))}" value="Home Assistant"><button>${t('acct.newToken')}</button></form>
          </section>

          ${me.admin ? `
          <section class="panel stack">
            <h2 class="sec">${t('acct.invite')}</h2>
            <p class="muted">${t('acct.inviteHelp')}</p>
            <form id="inv"><label for="ih">${t('acct.inviteHh')}</label>
              <select id="ih"><option value="">${t('acct.inviteNone')}</option>${me.households.map((h) => `<option value="${h.id}">${esc(h.name)}</option>`).join('')}</select>
              <div class="row"><button class="primary">${t('acct.makeInvite')}</button></div></form>
            ${inviteLink ? `<div class="reveal"><code id="il">${esc(inviteLink)}</code><div class="row"><button id="ilc">${t('acct.copy')}</button></div></div>` : ''}
            <h2 class="sec" style="margin-top:22px">${t('acct.users')}</h2>
            ${resetLink ? `<div class="reveal"><p><b>${esc(t('acct.resetLinkFor', { name: resetLink.name }))}</b></p><p class="muted">${t('acct.resetLinkHelp')}</p><code id="rl">${esc(resetLink.url)}</code><div class="row"><button id="rlc" type="button">${t('acct.copy')}</button></div></div>` : ''}
            <ul class="plain">${users.map((u) => `<li class="row between"><span>${esc(u.name)} <span class="muted">@${esc(u.username)}${u.admin ? ` · ${t('acct.admin')}` : ''}</span></span>
              ${u.id === me.id ? '' : `<span class="row">${u.twoFactor ? `<button class="quiet" data-r2="${u.id}" data-n="${esc(u.name)}">${t('tf.adminReset')}</button>` : ''}<button class="quiet" data-reset="${u.id}" data-n="${esc(u.name)}">${t('acct.reset')}</button><button class="quiet" data-ru="${u.id}" data-n="${esc(u.name)}">${t('acct.removeUser')}</button></span>`}</li>`).join('')}</ul>
          </section>` : ''}
          ${me.admin || me.linkedSimmers ? '<section class="panel stack" id="fedbox"></section>' : ''}
        </div>
        <p style="margin-top:18px"><a href="#/import">${ic('import')} ${t('acct.importLink')}</a></p>`;
      wire();
    };

    const reload = async () => { await S.refreshMe(); Object.assign(me, S.me); draw(); };
    const wire = () => {
      const app = S.app;
      $('#pf').onsubmit = async (e) => { e.preventDefault(); try { await S.put('/api/me', { name: $('#pn').value }); flash($('#pfm'), t('acct.saved')); await S.refreshMe(); S.chrome?.(); } catch (x) { flash($('#pfm'), x.message, true); } };
      $('#ph').onclick = () => $('#phf').click();
      $('#phf').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { await S.put('/api/me/avatar', { image: await S.squarePhoto(f) }); await reload(); S.chrome?.(); } catch (x) { flash($('#phm'), x.name === 'InvalidStateError' || !x.message ? t('acct.photoBad') : x.message, true); }
      };
      $('#phx')?.addEventListener('click', async () => { await S.del('/api/me/avatar'); await reload(); S.chrome?.(); });
      $('#installBtn')?.addEventListener('click', async () => { const p = S.installPrompt; if (!p) return; p.prompt(); await p.userChoice.catch(() => {}); S.installPrompt = null; draw(); });
      $('#un').onchange = async () => { const units = {}; $('#un').querySelectorAll('select').forEach((x) => (units[x.dataset.k] = x.value)); await S.put('/api/me', { units }); await S.refreshMe(); Object.assign(me, S.me); };
      $('#cs').onchange = async (e) => { await S.put('/api/me', { cookStyle: e.target.value }); await S.refreshMe(); Object.assign(me, S.me); };
      $('#out').onclick = async () => { const e = S.embedToken(); if (e?.tokenId) await S.del('/api/tokens/' + e.tokenId).catch(() => {}); S.setEmbedToken(null); await S.post('/api/auth/logout'); S.boot(); };
      $('#pw').onsubmit = async (e) => {
        e.preventDefault();
        try { await S.put('/api/me', { currentPassword: $('#pc').value, newPassword: $('#pnw').value }); $('#pw').reset(); flash($('#pwm'), t('acct.saved')); } catch (x) { flash($('#pwm'), x.message, true); }
      };
      $('#nh').onsubmit = async (e) => { e.preventDefault(); await S.post('/api/households', { name: $('#nhn').value }); reload(); };
      app.querySelectorAll('.hh').forEach((el) => {
        const id = el.dataset.h, h = me.households.find((x) => x.id === id);
        $('[data-addbtn]', el).onclick = async () => { const v = $('[data-add]', el).value; if (v) { await S.post(`/api/households/${id}/members`, { userId: v }); reload(); } };
        $('[data-leave]', el).onclick = async () => { await S.del(`/api/households/${id}/members/${me.id}`); reload(); };
        el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await S.del(`/api/households/${id}/members/${b.dataset.rm}`); reload(); }));
        $('[data-delhh]', el)?.addEventListener('click', async () => { if (confirm(t('acct.confirmDeleteHh', { name: h.name }))) { await S.del('/api/households/' + id); reload(); } });
      });
      $('#as')?.addEventListener('change', async () => {
        await S.put('/api/me', { autoShare: [...app.querySelectorAll('#as input:checked')].map((c) => c.value) });
        await S.refreshMe(); Object.assign(me, S.me);
      });
      S.federationAccount($('#fedbox'));
      S.twoFactorPanel($('#tfbox'), me, async () => { await S.refreshMe(); Object.assign(me, S.me); users.splice(0, users.length, ...(me.admin ? await api('/api/admin/users') : [])); });
      $('#tf').onsubmit = async (e) => { e.preventDefault(); newToken = (await S.post('/api/tokens', { name: $('#tn').value })).token; tokens.splice(0, tokens.length, ...(await api('/api/tokens'))); draw(); };
      $('#tkc')?.addEventListener('click', (e) => copy(newToken, e.target));
      app.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => { await S.del('/api/tokens/' + b.dataset.revoke); tokens.splice(0, tokens.length, ...(await api('/api/tokens'))); draw(); }));
      $('#inv')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { code } = await S.post('/api/admin/invites', { householdId: $('#ih').value || undefined });
        inviteLink = `${location.origin}/#/join/${code}`; draw();
      });
      $('#ilc')?.addEventListener('click', (e) => copy(inviteLink, e.target));
      $('#rlc')?.addEventListener('click', (e) => copy(resetLink.url, e.target));
      app.querySelectorAll('[data-r2]').forEach((b) => (b.onclick = async () => { if (!confirm(t('tf.confirmAdminReset', { name: b.dataset.n }))) return; await S.post(`/api/admin/users/${b.dataset.r2}/reset-2fa`); users.splice(0, users.length, ...(await api('/api/admin/users'))); draw(); }));
      app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => { const r = await S.post(`/api/admin/users/${b.dataset.reset}/reset-link`); resetLink = { name: b.dataset.n, url: `${location.origin}/#/reset/${r.code}` }; draw(); }));
      app.querySelectorAll('[data-ru]').forEach((b) => (b.onclick = async () => {
        if (!confirm(t('acct.confirmRemoveUser', { name: b.dataset.n }))) return;
        await S.del('/api/admin/users/' + b.dataset.ru);
        users.splice(0, users.length, ...(await api('/api/admin/users'))); await S.refreshMe(); Object.assign(me, S.me); draw();
      }));
    };
    draw();
  };
})();
