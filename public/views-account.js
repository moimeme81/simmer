/* Sign in, first-run setup, joining by invite, and the account page. */
(() => {
  'use strict';
  const { $, t, esc, api, ic } = S;
  const flash = (el, msg, bad) => { el.textContent = msg; el.className = bad ? 'err' : 'ok'; el.hidden = false; };

  /** kind: 'setup' | 'login' | 'join' */
  S.authScreen = async (kind, code) => {
    document.body.classList.add('auth');
    let invalid = false;
    if (kind === 'join') invalid = !(await api('/api/auth/invite/' + encodeURIComponent(code))).valid;
    const joining = kind === 'join' || kind === 'setup';
    S.app.innerHTML = `
      <div class="authcard">
        <img src="icon-192.png" alt="" width="72" height="72">
        <h1>${t(kind === 'setup' ? 'auth.setupTitle' : kind === 'join' ? 'auth.joinTitle' : 'auth.loginTitle')}</h1>
        <p class="muted">${t(kind === 'setup' ? 'auth.setupBlurb' : kind === 'join' ? 'auth.joinBlurb' : '')}</p>
        ${invalid ? `<p class="err">${t('auth.badInvite')}</p>` : `
        <form class="panel stack" id="af">
          ${joining ? `<label for="an">${t('auth.name')}</label><input id="an" name="name" autocomplete="name" required>` : ''}
          <label for="au">${t('auth.username')}</label><input id="au" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          <label for="ap">${t('auth.password')}</label><input id="ap" name="password" type="password" autocomplete="${joining ? 'new-password' : 'current-password'}" minlength="${joining ? 8 : 1}" required>
          ${joining ? `<small class="muted">${t('auth.hint')}</small>` : ''}
          <p class="err" id="aerr" hidden></p>
          <button class="primary wide">${t(joining ? 'auth.create' : 'auth.login')}</button>
        </form>`}
        <button class="quiet" id="alang">${t('lang.other')}</button>
      </div>`;
    $('#alang').onclick = () => { I18n.set(I18n.lang === 'fr' ? 'en' : 'fr'); S.authScreen(kind, code); };
    const form = $('#af');
    if (!form) return;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(form));
      try {
        if (kind === 'setup') await S.post('/api/auth/setup', b);
        else if (kind === 'join') await S.post('/api/auth/register', { ...b, invite: code });
        else await S.post('/api/auth/login', b);
        if (kind === 'join') history.replaceState(null, '', '#/');
        S.boot();
      } catch (x) { flash($('#aerr'), x.message, true); }
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
    let newToken = '', inviteLink = '', resetMsg = '';

    const draw = () => {
      S.app.innerHTML = `
        <h1 class="rtitle" style="margin-top:0">${t('acct.title')}</h1>
        <div class="cols">
          <section class="panel stack">
            <h2 class="sec">${t('acct.profile')}</h2>
            <form id="pf"><label for="pn">${t('auth.name')}</label><input id="pn" value="${esc(me.name)}" required>
              <p class="muted" style="margin:6px 0 0">@${esc(me.username)}${me.admin ? ` · ${t('acct.admin')}` : ''}</p>
              <p id="pfm" hidden></p>
              <div class="row"><button class="primary">${t('acct.save')}</button><button type="button" id="out" class="quiet">${t('auth.logout')}</button></div></form>
            <h2 class="sec" style="margin-top:22px">${t('acct.password')}</h2>
            <form id="pw"><label for="pc">${t('acct.current')}</label><input id="pc" type="password" autocomplete="current-password" required>
              <label for="pnw">${t('acct.new')}</label><input id="pnw" type="password" autocomplete="new-password" minlength="8" required>
              <p id="pwm" hidden></p><div class="row"><button>${t('acct.save')}</button></div></form>
          </section>

          <section class="panel stack">
            <h2 class="sec">${t('acct.households')}</h2>
            <p class="muted">${t('acct.hhHelp')}</p>
            ${me.households.map((h) => `
              <div class="hh" data-h="${h.id}">
                <div class="row between"><b>${esc(h.name)}</b>${h.mine ? `<span class="chip">${t('acct.owner')}</span>` : ''}</div>
                <div class="chips">${h.members.map((m) => `<span class="chip soft">${esc(m.id === me.id ? t('acct.you') : m.name)}${h.mine && m.id !== me.id ? ` <button class="xs" data-rm="${m.id}" aria-label="${esc(t('acct.remove'))} ${esc(m.name)}">×</button>` : ''}</span>`).join('')}</div>
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
            ${resetMsg ? `<p class="ok">${esc(resetMsg)}</p>` : ''}
            <ul class="plain">${users.map((u) => `<li class="row between"><span>${esc(u.name)} <span class="muted">@${esc(u.username)}${u.admin ? ` · ${t('acct.admin')}` : ''}</span></span>
              ${u.id === me.id ? '' : `<span class="row"><button class="quiet" data-reset="${u.id}" data-n="${esc(u.name)}">${t('acct.reset')}</button><button class="quiet" data-ru="${u.id}" data-n="${esc(u.name)}">${t('acct.removeUser')}</button></span>`}</li>`).join('')}</ul>
          </section>` : ''}
        </div>
        <p style="margin-top:18px"><a href="#/import">${ic('import')} ${t('acct.importLink')}</a></p>`;
      wire();
    };

    const reload = async () => { await S.refreshMe(); Object.assign(me, S.me); draw(); };
    const wire = () => {
      const app = S.app;
      $('#pf').onsubmit = async (e) => { e.preventDefault(); try { await S.put('/api/me', { name: $('#pn').value }); flash($('#pfm'), t('acct.saved')); await S.refreshMe(); S.chrome?.(); } catch (x) { flash($('#pfm'), x.message, true); } };
      $('#out').onclick = async () => { await S.post('/api/auth/logout'); S.boot(); };
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
      $('#tf').onsubmit = async (e) => { e.preventDefault(); newToken = (await S.post('/api/tokens', { name: $('#tn').value })).token; tokens.splice(0, tokens.length, ...(await api('/api/tokens'))); draw(); };
      $('#tkc')?.addEventListener('click', (e) => copy(newToken, e.target));
      app.querySelectorAll('[data-revoke]').forEach((b) => (b.onclick = async () => { await S.del('/api/tokens/' + b.dataset.revoke); tokens.splice(0, tokens.length, ...(await api('/api/tokens'))); draw(); }));
      $('#inv')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const { code } = await S.post('/api/admin/invites', { householdId: $('#ih').value || undefined });
        inviteLink = `${location.origin}/#/join/${code}`; draw();
      });
      $('#ilc')?.addEventListener('click', (e) => copy(inviteLink, e.target));
      app.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => { const r = await S.post(`/api/admin/users/${b.dataset.reset}/reset-password`); resetMsg = t('acct.resetDone', { name: b.dataset.n, pw: r.password }); draw(); }));
      app.querySelectorAll('[data-ru]').forEach((b) => (b.onclick = async () => {
        if (!confirm(t('acct.confirmRemoveUser', { name: b.dataset.n }))) return;
        await S.del('/api/admin/users/' + b.dataset.ru);
        users.splice(0, users.length, ...(await api('/api/admin/users'))); await S.refreshMe(); Object.assign(me, S.me); draw();
      }));
    };
    draw();
  };
})();
