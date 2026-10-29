/* Two-factor sign-in: set up an authenticator app, keep recovery codes, turn it off. */
(() => {
  'use strict';
  const { $, t, esc, api } = S;
  let qrLoad;
  const loadQR = () => (qrLoad = qrLoad || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/qrcode.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); }));
  const qrSvg = async (text) => {
    try { await loadQR(); const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch { return ''; }
  };
  const group = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

  S.twoFactorPanel = async (box, me, onChange) => {
    let st = { stage: me.twoFactor ? 'on' : 'off' }, left = null;
    if (me.twoFactor) left = (await api('/api/me/2fa')).recoveryLeft;
    const flash = (msg, bad) => { const el = $('#tferr', box); if (el) { el.textContent = msg; el.className = bad ? 'err' : 'ok'; el.hidden = !msg; } };
    const codesBlock = (codes) => `<div class="reveal"><p><b>${t('tf.recoveryTitle')}</b></p><p class="muted">${t('tf.recoveryHelp')}</p>
      <pre class="codes" id="tfcodes">${codes.map(esc).join('\n')}</pre><div class="row"><button type="button" id="tfcopy">${t('acct.copy')}</button><button type="button" id="tfprint">${S.ic('print')} ${t('print.button')}</button></div></div>`;
    const draw = async () => {
      if (st.stage === 'off') box.innerHTML = `<p class="muted" style="margin:0 0 8px">${t('tf.help')}</p><p class="muted" style="margin:0 0 8px">${t('tf.statusOff')}</p><div class="row"><button type="button" id="tfstart">${t('tf.setup')}</button></div><p id="tferr" hidden></p>`;
      else if (st.stage === 'scan') {
        box.innerHTML = `<p class="muted" style="margin:0 0 8px">${t('tf.scan')}</p>
          <div class="tfqr">${await qrSvg(st.uri)}<div><p class="muted" style="margin:0 0 4px">${t('tf.manual')}</p><code class="tfsecret">${esc(group(st.secret))}</code>
          <p style="margin:8px 0 0"><a href="${esc(st.uri)}">${t('tf.openApp')}</a></p></div></div>
          <form id="tfform" class="stack"><label for="tfc">${t('tf.enterCode')}</label><input id="tfc" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required>
          <p id="tferr" hidden></p><div class="row"><button class="primary">${t('tf.turnOn')}</button><button type="button" class="quiet" id="tfcancel">${t('share.cancel')}</button></div></form>`;
      } else if (st.stage === 'codes') box.innerHTML = `<p class="ok">${t('tf.nowOn')}</p>${codesBlock(st.codes)}<div class="row"><button type="button" class="primary" id="tfdone">${t('tf.saved')}</button></div>`;
      else box.innerHTML = `<p class="ok">${t('tf.statusOn')}</p><p class="muted" style="margin:0 0 8px">${t('tf.left', { n: left })}</p>
        ${st.codes ? codesBlock(st.codes) : ''}
        <form id="tfform" class="stack"><label for="tfp">${t('acct.current')}</label><input id="tfp" type="password" autocomplete="current-password" required>
        <label for="tfc">${t('tf.enterCode2')}</label><input id="tfc" autocomplete="one-time-code" autocapitalize="none" required>
        <p id="tferr" hidden></p><div class="row"><button type="button" id="tfnew">${t('tf.newCodes')}</button><button type="button" class="quiet" id="tfoff">${t('tf.turnOff')}</button></div></form>`;
      wire();
    };
    const wire = () => {
      $('#tfstart', box)?.addEventListener('click', async () => { try { const r = await S.post('/api/me/2fa/start'); st = { stage: 'scan', secret: r.secret, uri: r.uri }; draw(); } catch (x) { flash(x.message, true); } });
      $('#tfcancel', box)?.addEventListener('click', () => { st = { stage: 'off' }; draw(); });
      $('#tfform', box)?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (st.stage !== 'scan') return;
        try { const r = await S.post('/api/me/2fa/enable', { code: $('#tfc', box).value }); st = { stage: 'codes', codes: r.recoveryCodes }; await onChange?.(); draw(); } catch (x) { flash(x.message, true); }
      });
      $('#tfdone', box)?.addEventListener('click', async () => { left = (await api('/api/me/2fa')).recoveryLeft; st = { stage: 'on' }; draw(); });
      $('#tfcopy', box)?.addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(st.codes.join('\n')); e.target.textContent = t('acct.copied'); } catch { /* select by hand */ } });
      $('#tfprint', box)?.addEventListener('click', () => {
        const div = document.createElement('div'); div.id = 'printcodes';
        div.innerHTML = `<h1>Simmer · ${esc(t('tf.recoveryTitle'))}</h1><div>${st.codes.map(esc).join('<br>')}</div>`;
        document.body.append(div); document.body.classList.add('print-codes');
        const done = () => { document.body.classList.remove('print-codes'); div.remove(); removeEventListener('afterprint', done); };
        addEventListener('afterprint', done); S.printPage(t('tf.recoveryTitle')); setTimeout(done, 60000);
      });
      const secured = async (path) => S.post(path, { password: $('#tfp', box).value, code: $('#tfc', box).value.trim() });
      $('#tfnew', box)?.addEventListener('click', async () => { try { const r = await secured('/api/me/2fa/recovery'); st = { stage: 'on', codes: r.recoveryCodes }; left = r.recoveryCodes.length; draw(); } catch (x) { flash(x.message, true); } });
      $('#tfoff', box)?.addEventListener('click', async () => { if (!confirm(t('tf.confirmOff'))) return; try { await secured('/api/me/2fa/disable'); st = { stage: 'off' }; await onChange?.(); draw(); } catch (x) { flash(x.message, true); } });
    };
    draw();
  };
})();
