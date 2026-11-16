(function () {
  'use strict';
  const CFG = window.HOME_FINDER || {};
  const view = document.getElementById('view');
  const bar = document.getElementById('bar');
  const state = { token: null, me: null, data: null, installEvt: null };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function keep(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function normId(raw) {
    const m = String(raw || '').trim().toUpperCase().match(/^B0*(\d{1,4})$/);
    if (!m || Number(m[1]) < 1) return null;
    return 'B' + ('000' + Number(m[1])).slice(-Math.max(3, String(Number(m[1])).length));
  }

  /* ---------- talking to the Google script ---------- */
  async function api(action, data) {
    let res;
    try {
      res = await fetch(CFG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: state.token, data: data || {} })
      });
    } catch (e) { throw { code: 'NETWORK', message: 'The phone has no internet right now.', detail: String(e && e.message || e) }; }
    let out;
    try { out = await res.json(); } catch (e) { throw { code: 'ERROR', message: 'The server gave an unexpected reply.' }; }
    if (!out.ok) throw { code: out.code, message: out.error };
    return out.data;
  }

  /* ---------- screens ---------- */
  function showMessage(title, text, buttons) {
    bar.hidden = !state.me;
    view.innerHTML = '<section class="card"><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></section>' +
      (buttons || []).map((b, i) => '<button class="big ' + (b.cls || 'primary') + '" id="mb' + i + '">' + esc(b.label) + '</button>').join('');
    (buttons || []).forEach((b, i) => { $('mb' + i).onclick = b.fn; });
  }

  function whenGoogle(fn, tries) {
    if (window.google && google.accounts && google.accounts.id) return fn();
    if ((tries || 0) > 50) { const n = $('gnote'); if (n) n.textContent = 'Could not reach Google. Please check the internet and reload.'; return; }
    setTimeout(() => whenGoogle(fn, (tries || 0) + 1), 200);
  }

  function showSignIn(msg) {
    bar.hidden = true;
    view.innerHTML = '<section class="card center"><h1>Home Finder</h1><p>Find what is kept in our boxes and organisers.</p>' +
      '<div id="gbtn" class="gbtn"></div><p id="gnote" class="note">' + esc(msg || '') + '</p></section>';
    whenGoogle(() => {
      google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false });
      google.accounts.id.renderButton($('gbtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
      google.accounts.id.prompt();
    });
  }

  function onCredential(resp) {
    state.token = resp.credential;
    keep('hf_token', resp.credential);
    load();
  }

  function signOut() {
    keep('hf_token', null);
    state.token = null; state.me = null; state.data = null;
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    showSignIn();
  }

  function handleError(e) {
    const code = e && e.code, msg = (e && e.message) || 'Something went wrong.';
    if (code === 'AUTH') { keep('hf_token', null); state.token = null; return showSignIn('Please sign in again.'); }
    if (code === 'DENIED') return showMessage('Not on the family list', 'This Google account is not allowed yet. Ask the person who manages the app to add it, or sign in with a different account.', [{ label: 'Use another account', fn: signOut }]);
    showMessage(code === 'NETWORK' ? 'No internet' : 'Could not open the app', msg + (e && e.detail ? '  [Technical: ' + e.detail + ' | Address starts: ' + String(CFG.SCRIPT_URL).slice(0, 45) + ' | online: ' + navigator.onLine + ']' : ''), [{ label: 'Try again', fn: load }]);
  }

  async function load() {
    view.innerHTML = '<p class="note center">Opening…</p>';
    try {
      state.data = await api('listAll');
      state.me = state.data.me;
      $('who').textContent = state.me.nick;
      bar.hidden = false;
      route();
    } catch (e) { handleError(e); }
  }

  function locLabel(id) {
    const l = (state.data.locations || []).find(x => x.loc_id === id);
    return l ? [l.room, l.shelf, l.row].filter(Boolean).join(' > ') : '';
  }

  function showHome() {
    const d = state.data;
    const boxes = d.boxes.filter(b => !b.archived).length;
    const items = d.items.filter(i => !i.archived).length;
    view.innerHTML = '<section class="card"><h1>Hello, ' + esc(state.me.nick) + '</h1>' +
      '<p class="muted">' + boxes + ' boxes and ' + items + ' items saved so far.</p></section>' +
      '<button class="big primary" id="bSearch">Search</button>' +
      '<button class="big tape" id="bScan">Scan a box</button>' +
      (state.installEvt ? '<button class="big ghost" id="bInstall">Install this app</button>' : '') +
      '<p class="note center" id="soon"></p>';
    $('bSearch').onclick = () => { $('soon').textContent = 'Search is being added next.'; };
    $('bScan').onclick = () => { $('soon').textContent = 'The scan button is being added soon.'; };
    if ($('bInstall')) $('bInstall').onclick = () => { state.installEvt.prompt(); state.installEvt = null; };
  }

  function showBox(raw) {
    const id = normId(raw);
    const box = id && state.data.boxes.find(b => b.box_id === id);
    const back = [{ label: 'Back to start', cls: 'ghost', fn: () => { location.hash = '#/'; } }];
    if (!id) return showMessage('Label not recognised', 'This label does not look like one of ours.', back);
    if (!box) return showMessage(id + ' is not set up yet', 'This label has not been used. Setting up new boxes is added in the next step.', back);
    view.innerHTML = '<section class="card"><div class="big-id">' + esc(box.box_id) + '</div><h1>' + esc(box.name) + '</h1>' +
      (box.looks_like ? '<div class="kv"><b>Looks like</b>' + esc(box.looks_like) + '</div>' : '') +
      (locLabel(box.loc_id) ? '<div class="kv"><b>Kept at</b>' + esc(locLabel(box.loc_id)) + '</div>' : '') +
      '</section><button class="big ghost" id="back">Back to start</button>';
    $('back').onclick = () => { location.hash = '#/'; };
  }

  function route() {
    const m = (location.hash || '').match(/^#\/box\/([^/?]+)/i);
    if (m) return showBox(decodeURIComponent(m[1]));
    showHome();
  }

  /* ---------- start ---------- */
  function start() {
    const bad = v => !v || String(v).indexOf('PASTE_') === 0;
    if (bad(CFG.SCRIPT_URL) || bad(CFG.CLIENT_ID)) {
      return showMessage('Setup not finished', 'Open config.js, type in the Web app URL and the Client ID, then upload it to GitHub again.');
    }
    const t = recall('hf_token');
    let exp = 0;
    try { exp = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) {}
    if (t && exp > Date.now() + 120000) { state.token = t; load(); } else showSignIn();
  }

  $('signout').onclick = signOut;
  window.addEventListener('hashchange', () => { if (state.data) route(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvt = e; if (state.data && !location.hash.match(/^#\/box/i)) showHome(); });
  window.addEventListener('appinstalled', () => { state.installEvt = null; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  start();
})();
