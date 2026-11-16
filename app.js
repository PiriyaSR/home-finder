(function () {
  'use strict';
  const CFG = window.HOME_FINDER || {};
  const view = document.getElementById('view');
  const bar = document.getElementById('bar');
  const state = { token: null, me: null, data: null, installEvt: null, thumbs: {}, full: {}, offline: false, flash: '', ver: 0 };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function keep(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  /* ---------- this phone's settings: text size, Tamil words on/off ---------- */
  const SIZES = [['0.9', 'Small', 'சிறியது'], ['1', 'Normal', 'சாதாரணம்'], ['1.15', 'Large', 'பெரியது'], ['1.3', 'Extra large', 'மிகப் பெரியது']];
  function prefs() { try { return Object.assign({ size: '1', tamil: '1' }, JSON.parse(recall('hf_prefs') || '{}')); } catch (e) { return { size: '1', tamil: '1' }; } }
  function applyPrefs() {
    const p = prefs();
    document.documentElement.style.setProperty('--s', p.size);
    document.documentElement.classList.toggle('no-ta', p.tamil === '0');
  }
  function setPref(k, v) { const p = prefs(); p[k] = v; keep('hf_prefs', JSON.stringify(p)); applyPrefs(); }
  const ta = t => t ? '<span class="ta">' + esc(t) + '</span>' : '';

  function normId(raw) {
    const m = String(raw || '').trim().toUpperCase().match(/^B0*(\d{1,4})$/);
    if (!m || Number(m[1]) < 1) return null;
    return 'B' + ('000' + Number(m[1])).slice(-Math.max(3, String(Number(m[1])).length));
  }

  /* ---------- talking to the Google script ---------- */
  async function rawApi(action, data) {
    let res;
    try {
      res = await fetch(CFG.SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: state.token, data: data || {} })
      });
    } catch (e) { throw { code: 'NETWORK', message: 'No internet right now.', detail: String(e && e.message || e) }; }
    let out;
    try { out = await res.json(); } catch (e) { throw { code: 'ERROR', message: 'The server gave an unexpected reply.' }; }
    if (!out.ok) throw { code: out.code, message: out.error };
    state.offline = false;
    return out.data;
  }

  // If the Google pass ran out, renew it quietly (or with one tap) and try once more.
  async function api(action, data) {
    try { return await rawApi(action, data); }
    catch (e) {
      if (e && e.code === 'AUTH' && await silentSignIn()) return rawApi(action, data);
      throw e;
    }
  }

  function silentSignIn() {
    return new Promise(resolve => {
      let done = false;
      const finish = ok => { if (!done) { done = true; resolve(ok); } };
      setTimeout(() => finish(false), 15000);
      whenGoogle(() => {
        google.accounts.id.initialize({
          client_id: CFG.CLIENT_ID, auto_select: true, cancel_on_tap_outside: false,
          callback: r => { state.token = r.credential; keep('hf_token', r.credential); finish(true); }
        });
        google.accounts.id.prompt();
      });
    });
  }

  /* ---------- small screen helpers ---------- */
  function page(html) {
    bar.hidden = !state.me;
    const off = state.offline ? '<div class="warn">No internet. You are seeing the last saved list. Changes cannot be saved now. <span class="ta">இணையம் இல்லை.</span></div>' : '';
    const flash = state.flash ? '<div class="ok">' + esc(state.flash) + '</div>' : '';
    state.flash = '';
    view.innerHTML = off + flash + html;
    window.scrollTo(0, 0);
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function btn(id, label, cls, tamil) { return '<button class="big ' + (cls || 'primary') + '" id="' + id + '">' + esc(label) + ta(tamil) + '</button>'; }
  function lab(forId, en, tamil) { return '<label' + (forId ? ' for="' + forId + '"' : '') + '>' + esc(en) + ta(tamil) + '</label>'; }
  function on(id, fn) { const el = $(id); if (el) el.onclick = fn; }

  function showMessage(title, text, buttons) {
    page('<section class="card"><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></section>' +
      (buttons || []).map((b, i) => btn('mb' + i, b.label, b.cls, b.ta)).join(''));
    (buttons || []).forEach((b, i) => on('mb' + i, b.fn));
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
    keep('hf_token', null); keep('hf_cache', null);
    state.token = null; state.me = null; state.data = null;
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    showSignIn();
  }

  function handleError(e) {
    const code = e && e.code, msg = (e && e.message) || 'Something went wrong.';
    if (code === 'AUTH') { keep('hf_token', null); state.token = null; return showSignIn('Please sign in again.'); }
    if (code === 'DENIED') return showMessage('Not on the family list', 'This Google account is not allowed yet. Ask the person who manages the app to add it, or sign in with a different account.', [{ label: 'Use another account', fn: signOut }]);
    showMessage(code === 'NETWORK' ? 'No internet' : 'Could not open the app',
      msg + (e && e.detail ? '  [Technical: ' + e.detail + ' | online: ' + navigator.onLine + ']' : ''),
      [{ label: 'Try again', ta: 'மீண்டும் முயற்சி', fn: load }]);
  }

  /* ---------- loading, remembering and refreshing the list ---------- */
  function loadThumbCache() { try { state.thumbs = JSON.parse(recall('hf_thumbs') || '{}') || {}; } catch (e) { state.thumbs = {}; } }
  function saveThumbCache() { keep('hf_thumbs', JSON.stringify(state.thumbs)); }

  function setData(d) {
    d.types = d.types || []; d.locations = d.locations || []; d.boxes = d.boxes || []; d.items = d.items || []; d.people = d.people || [];
    state.data = d; state.me = d.me;
    if ($('who') && d.me) $('who').textContent = d.me.nick;
  }
  function remember() { state.ver++; keep('hf_cache', JSON.stringify(state.data)); }

  async function refresh() { setData(await api('listAll')); keep('hf_cache', JSON.stringify(state.data)); }

  async function load() {
    view.innerHTML = '<p class="note center">Opening…</p>';
    try {
      await refresh();
      bar.hidden = false;
      route();
    } catch (e) {
      if (e && e.code === 'NETWORK') {
        try {
          const c = JSON.parse(recall('hf_cache') || 'null');
          if (c && c.me) { setData(c); state.offline = true; return route(); }
        } catch (x) {}
      }
      handleError(e);
    }
  }

  const FORM_ROUTE = /^#\/(setup|edit|move|additem|edititem|placeform|typeform|newbox|search)/i;
  // Quietly fetch the newest list. The screen is redrawn only if something really changed.
  async function bgRefresh() {
    const v = state.ver;
    try {
      const fresh = await api('listAll');
      if (v !== state.ver) return;
      if (JSON.stringify(fresh) === JSON.stringify(state.data)) return;
      setData(fresh); keep('hf_cache', JSON.stringify(fresh));
      if (!FORM_ROUTE.test(location.hash || '#/') && !$('lb')) route();
    } catch (e) {}
  }

  // Fetch small pictures we do not have yet, then fill them in without redrawing the screen.
  async function needThumbs(ids) {
    const miss = Array.from(new Set(ids.filter(i => i && !state.thumbs[i])));
    if (!miss.length) return;
    try {
      for (let i = 0; i < miss.length; i += 60) {
        Object.assign(state.thumbs, await api('getThumbs', { ids: miss.slice(i, i + 60) }));
      }
      saveThumbCache(); fillImgs();
    } catch (e) {}
  }
  function fillImgs() {
    document.querySelectorAll('img[data-pid]').forEach(im => { const t = state.thumbs[im.getAttribute('data-pid')]; if (t) im.src = t; });
  }
  function thumbImg(pid, cls) {
    if (!pid) return '<span class="th none"></span>';
    return '<img class="' + (cls || 'th') + '" data-pid="' + esc(pid) + '" alt="" src="' + (state.thumbs[pid] || BLANK) + '">';
  }
  function cachePhoto(pid, p) {
    if (!pid || !p) return;
    state.thumbs[pid] = 'data:image/jpeg;base64,' + p.thumb;
    state.full[pid] = 'data:image/jpeg;base64,' + p.b64;
    saveThumbCache();
  }

  // After a save, update our own copy straight away, so nobody waits for a second round trip.
  function upsert(list, key, rec) {
    const i = list.findIndex(x => x[key] === rec[key]);
    if (i >= 0) list[i] = Object.assign({}, list[i], rec); else list.push(rec);
  }

  /* ---------- data helpers ---------- */
  const places = () => state.data.locations.filter(l => !l.archived);
  const boxesAll = () => state.data.boxes.filter(b => !b.archived);
  const typesAll = () => state.data.types.filter(t => !t.archived);
  const findBox = id => state.data.boxes.find(b => b.box_id === id);
  const findType = id => state.data.types.find(t => t.type_id === id);
  const findItem = id => state.data.items.find(i => i.item_id === id);
  const typeName = id => { const t = findType(id); return t ? t.name : ''; };
  function locLabel(id) {
    const l = state.data.locations.find(x => x.loc_id === id);
    return l ? [l.room, l.shelf, l.row].filter(Boolean).join(' > ') : '';
  }
  const byLabel = (a, b) => locLabel(a.loc_id).localeCompare(locLabel(b.loc_id), undefined, { numeric: true });
  const countAt = id => boxesAll().filter(b => b.loc_id === id).length;
  const currentItems = box => state.data.items.filter(i => i.box_id === box.box_id && !i.archived && Number(i.gen || 1) === Number(box.gen || 1));
  function allCurrentItems() {
    const out = [];
    boxesAll().forEach(b => currentItems(b).forEach(i => out.push(i)));
    return out;
  }
  const STATUS = { 'In box': 'பெட்டியில் உள்ளது', 'Taken out': 'வெளியே எடுத்தது', 'Used up': 'தீர்ந்துவிட்டது' };

  /* ---------- photos: shrink on the phone first ---------- */
  async function loadBitmap(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => res(im); im.onerror = () => rej(new Error('That picture could not be read.')); im.src = u;
    });
  }
  function toJpeg(src, maxSide, q) {
    const w = src.width, h = src.height, sc = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  }
  async function shrinkPhoto(file) {
    const src = await loadBitmap(file);
    let b64 = '';
    [[1280, 0.65], [1024, 0.6], [900, 0.55], [720, 0.5]].some(p => { b64 = toJpeg(src, p[0], p[1]); return b64.length <= 160000; });
    let th = toJpeg(src, 120, 0.6);
    if (th.length > 45000) th = toJpeg(src, 90, 0.5);
    return { b64: b64, thumb: th, preview: 'data:image/jpeg;base64,' + toJpeg(src, 400, 0.6) };
  }

  // The picture part of a form: Take a picture now / Choose from the phone.
  function photoPicker(existingPid) {
    let photo = null;
    return {
      html: lab('', 'Picture', 'படம்') + '<div id="prev">' + (existingPid ? thumbImg(existingPid, 'th big') : '') + '</div>' +
        '<input id="fCam" type="file" accept="image/*" capture="environment" hidden><input id="fPhoto" type="file" accept="image/*" hidden>' +
        btn('bCam', existingPid ? 'Take a new picture now' : 'Take a picture now', 'tape', 'இப்போது படம் எடு') +
        btn('bPick', 'Choose a picture from the phone', 'ghost', 'போனிலிருந்து படம் தேர்வு செய்'),
      wire() {
        on('bPick', () => $('fPhoto').click());
        on('bCam', () => $('fCam').click());
        const got = async ev => {
          const f = ev.target.files[0]; if (!f) return;
          $('prev').innerHTML = '<p class="note">Preparing picture…</p>';
          try { photo = await shrinkPhoto(f); $('prev').innerHTML = '<img class="cover" alt="" src="' + photo.preview + '">'; }
          catch (e) { photo = null; $('prev').innerHTML = ''; showErr({ code: 'INVALID', message: 'That picture could not be used. Please try another one.' }); }
        };
        $('fPhoto').onchange = got; $('fCam').onchange = got;
      },
      get: () => photo
    };
  }

  // Tap the small picture: open the big clear one on top of the screen.
  async function openBig(pid) {
    const old = $('lb'); if (old) old.remove();
    const lb = document.createElement('div'); lb.id = 'lb';
    lb.innerHTML = '<button class="big tape" id="lbClose">Close<span class="ta">மூடு</span></button><div id="lbBody"><p class="note">Opening the picture…</p></div>';
    document.body.appendChild(lb);
    $('lbClose').onclick = () => lb.remove();
    const body = $('lbBody');
    if (state.full[pid]) { body.innerHTML = '<img alt="" src="' + state.full[pid] + '">'; return; }
    try {
      const p = await api('getPhoto', { photo_id: pid });
      state.full[pid] = 'data:' + p.mime + ';base64,' + p.data;
      body.innerHTML = '<img alt="" src="' + state.full[pid] + '">';
    } catch (e) { body.innerHTML = '<p class="note">' + esc(e.code === 'NETWORK' ? 'No internet to open the big picture.' : (e.message || 'Could not open it.')) + '</p>'; }
  }

  function errText(e) {
    if (e && e.code === 'NETWORK') return 'NOT saved. There is no internet. Please try again when the internet is back.';
    if (e && e.code === 'AUTH') return 'NOT saved. The sign-in ended. Please tap Save again. If it still fails, press Sign out, sign in, and try again.';
    if (e && e.code === 'BUSY') return 'NOT saved. The app was busy. Please tap Save again.';
    if (e && e.code === 'INVALID') return e.message;
    return 'NOT saved. ' + ((e && e.message) || 'Something went wrong.');
  }
  function showErr(e) { const el = $('err'); el.textContent = errText(e); el.hidden = false; el.scrollIntoView({ block: 'center' }); }
  function busy(id, on_) { const b = $(id); if (!b) return; b.disabled = on_; if (on_) { b.dataset.t = b.innerHTML; b.textContent = 'Saving…'; } else if (b.dataset.t) b.innerHTML = b.dataset.t; }

  /* ---------- place chooser (used when making / moving a box) ---------- */
  function pickerHTML(selected) {
    const ps = places().slice().sort(byLabel);
    const rooms = Array.from(new Set(places().map(l => l.room)));
    const shelves = Array.from(new Set(places().map(l => l.shelf).filter(Boolean)));
    const rows = Array.from(new Set(places().map(l => l.row).filter(Boolean)));
    const dl = (id, a) => '<datalist id="' + id + '">' + a.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>';
    return '<select id="pl"><option value="">Choose a place…</option>' +
      ps.map(l => '<option value="' + esc(l.loc_id) + '"' + (l.loc_id === selected ? ' selected' : '') + '>' + esc(locLabel(l.loc_id)) + '</option>').join('') +
      '<option value="__new">+ A new place (not in this list)</option></select>' +
      '<div id="newpl" class="subform" hidden>' +
      lab('nRoom', 'Room (for example: Loft, Hall)') + '<input id="nRoom" list="dlRoom" maxlength="40" autocomplete="off">' +
      lab('nShelf', 'Shelf or cupboard (optional)') + '<input id="nShelf" list="dlShelf" maxlength="40" autocomplete="off">' +
      lab('nRow', 'Row (optional)') + '<input id="nRow" list="dlRow" maxlength="40" autocomplete="off">' +
      dl('dlRoom', rooms) + dl('dlShelf', shelves) + dl('dlRow', rows) + '</div>';
  }
  function wirePicker() {
    $('pl').onchange = () => { $('newpl').hidden = $('pl').value !== '__new'; if (!$('newpl').hidden) $('nRoom').focus(); };
  }
  async function resolvePlace() {
    const v = $('pl').value;
    if (v !== '__new') return v;
    const f = { room: $('nRoom').value, shelf: $('nShelf').value, row: $('nRow').value };
    if (!norm(f.room)) throw { code: 'INVALID', message: 'Please type the room name for the new place.' };
    const same = state.data.locations.find(l => norm(l.room) === norm(f.room) && norm(l.shelf) === norm(f.shelf) && norm(l.row) === norm(f.row));
    if (same) {
      if (same.archived) { await api('setArchived', { kind: 'location', id: same.loc_id, archived: false }); same.archived = ''; }
      return same.loc_id;
    }
    const r = await api('saveLocation', Object.assign({ note: '' }, f));
    upsert(state.data.locations, 'loc_id', r.location);
    return r.location.loc_id;
  }

  /* ---------- word suggestions (so everybody spells alike) ---------- */
  function vocab() {
    const m = {};
    state.data.items.forEach(i => {
      [i.name].concat(String(i.also_called || '').split(/[,;]+/)).forEach(p => { p = p.replace(/\s+/g, ' ').trim(); if (p && p.length <= 40) m[p] = (m[p] || 0) + 1; });
    });
    return Object.keys(m).sort((a, b) => m[b] - m[a]);
  }
  function wireSuggest(inputId, boxId, whole) {
    const inp = $(inputId), box = $(boxId); if (!inp || !box) return;
    const words = vocab();
    const draw = () => {
      const val = inp.value, idx = whole ? -1 : val.lastIndexOf(',');
      const q = norm(whole ? val : val.slice(idx + 1));
      const used = norm(val).split(/\s*,\s*/);
      if (!q) { box.innerHTML = ''; return; }
      const hits = words.filter(w => norm(w).indexOf(q) !== -1 && norm(w) !== q && used.indexOf(norm(w)) === -1).slice(0, 8);
      box.innerHTML = hits.length ? '<span class="note">Words already used: <span class="ta">ஏற்கனவே பயன்படுத்தியவை:</span></span> ' + hits.map(w => '<button type="button" class="chip" data-w="' + esc(w) + '">' + esc(w) + '</button>').join('') : '';
      box.querySelectorAll('.chip').forEach(c => {
        c.onclick = () => {
          const w = c.getAttribute('data-w');
          inp.value = whole ? w : (idx >= 0 ? val.slice(0, idx + 1) + ' ' : '') + w + ', ';
          box.innerHTML = ''; inp.focus();
        };
      });
    };
    inp.oninput = draw;
  }

  function showSettings() {
    const p = prefs();
    page('<h1>Settings <span class="ta">அமைப்புகள்</span></h1><p class="note">These choices are only for this phone.</p>' +
      '<h2>Text size <span class="ta">எழுத்தின் அளவு</span></h2><div class="seg">' +
      SIZES.map(z => '<button class="segb' + (p.size === z[0] ? ' sel' : '') + '" data-size="' + z[0] + '">' + z[1] + '<span class="ta">' + z[2] + '</span></button>').join('') + '</div>' +
      '<h2>Tamil words <span class="ta">தமிழ்</span></h2><div class="seg">' +
      '<button class="segb' + (p.tamil === '1' ? ' sel' : '') + '" data-tamil="1">Show Tamil beside English<span class="ta">தமிழ் காட்டு</span></button>' +
      '<button class="segb' + (p.tamil === '0' ? ' sel' : '') + '" data-tamil="0">English only</button></div>' +
      btn('bBack', 'Done', 'primary', 'முடிந்தது'));
    view.querySelectorAll('[data-size]').forEach(b => { b.onclick = () => { setPref('size', b.getAttribute('data-size')); showSettings(); }; });
    view.querySelectorAll('[data-tamil]').forEach(b => { b.onclick = () => { setPref('tamil', b.getAttribute('data-tamil')); showSettings(); }; });
    on('bBack', () => go('#/'));
  }

  /* ---------- Home ---------- */
  function showHome() {
    const boxes = boxesAll().length;
    const items = allCurrentItems().length;
    page('<section class="card"><h1>Hello, ' + esc(state.me.nick) + ' <span class="ta">வணக்கம்</span></h1>' +
      '<p class="muted">' + boxes + ' boxes and ' + items + ' items saved so far.</p></section>' +
      btn('bSearch', 'Search', 'primary', 'தேடு') + btn('bScan', 'Scan a box', 'tape', 'பெட்டியை ஸ்கேன் செய்') +
      btn('bBoxes', 'All boxes', 'ghost', 'எல்லா பெட்டிகள்') + btn('bNew', 'Add a new box', 'ghost', 'புதிய பெட்டி சேர்') +
      btn('bPlaces', 'Places', 'ghost', 'இடங்கள்') + btn('bTypes', 'Box types', 'ghost', 'பெட்டி வகைகள்') +
      (state.installEvt ? btn('bInstall', 'Install this app', 'ghost') : '') +
      '<p class="note center" id="soon"></p>');
    on('bSearch', () => go('#/search'));
    on('bScan', () => { $('soon').textContent = 'The scan button is being added soon.'; });
    on('bBoxes', () => go('#/boxes')); on('bNew', () => go('#/newbox'));
    on('bPlaces', () => go('#/places')); on('bTypes', () => go('#/types'));
    on('bInstall', () => { state.installEvt.prompt(); state.installEvt = null; });
  }

  /* ---------- Search ---------- */
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const wordsOf = t => norm(t).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  function wordScore(t, w) {
    if (w === t) return 5;
    const i = w.indexOf(t);
    if (i === 0) return 4;
    if (i > 0) return 3;
    if (t.length >= 4) { const d = t.length >= 7 ? 2 : 1; if (lev(t, w) <= d || lev(t, w.slice(0, t.length)) <= d) return 1; }
    return 0;
  }
  function tokScore(t, words) { let b = 0; for (let k = 0; k < words.length; k++) { const s = wordScore(t, words[k]); if (s > b) b = s; if (b === 5) break; } return b; }
  function hl(text, toks) {
    const t = String(text || ''), low = t.toLowerCase(), rs = [];
    toks.forEach(k => { if (!k) return; let i = low.indexOf(k); while (i >= 0) { rs.push([i, i + k.length]); i = low.indexOf(k, i + k.length); } });
    if (!rs.length) return esc(t);
    rs.sort((a, b) => a[0] - b[0]);
    const m = [];
    rs.forEach(r => { const l = m[m.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else m.push(r.slice()); });
    let o = '', p = 0;
    m.forEach(r => { o += esc(t.slice(p, r[0])) + '<mark>' + esc(t.slice(r[0], r[1])) + '</mark>'; p = r[1]; });
    return o + esc(t.slice(p));
  }

  function searchAll(q) {
    const toks = norm(q).split(' ').filter(Boolean);
    const res = { toks: toks, boxes: [], items: [] };
    if (!toks.length) return res;
    const direct = normId(/^\d{1,4}$/.test(q.trim()) ? 'B' + q.trim() : q);
    boxesAll().forEach(b => {
      const words = wordsOf([b.box_id, b.name, typeName(b.type_id), b.looks_like, b.owner, locLabel(b.loc_id), b.notes].join(' '));
      let sc = 0, ok = true;
      for (const t of toks) { const s = tokScore(t, words); if (!s) { ok = false; break; } sc += s; }
      if (direct && b.box_id === direct) { ok = true; sc += 100; }
      if (ok) res.boxes.push({ b: b, sc: sc });
    });
    boxesAll().forEach(b => {
      const second = wordsOf([b.box_id, b.name, typeName(b.type_id), locLabel(b.loc_id)].join(' '));
      currentItems(b).forEach(i => {
        const first = wordsOf([i.name, i.also_called, i.description].join(' '));
        let sc = 0, ok = true;
        for (const t of toks) { const s1 = tokScore(t, first), s2 = tokScore(t, second) * 0.5; const s = Math.max(s1, s2); if (!s) { ok = false; break; } sc += s; }
        if (ok) res.items.push({ i: i, b: b, sc: sc });
      });
    });
    res.boxes.sort((a, b) => b.sc - a.sc || a.b.box_id.localeCompare(b.b.box_id));
    res.items.sort((a, b) => b.sc - a.sc || a.i.name.localeCompare(b.i.name));
    res.boxes = res.boxes.slice(0, 20); res.items = res.items.slice(0, 50);
    return res;
  }

  function showSearch() {
    page('<h1>Search <span class="ta">தேடு</span></h1>' +
      '<input id="q" class="bigin" placeholder="Type a thing, or a box name or number" autocomplete="off" autocapitalize="none" spellcheck="false">' +
      '<div id="res"></div>' + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    on('bBack', () => go('#/'));
    let timer = null;
    const draw = () => {
      const q = $('q').value, r = searchAll(q), t = r.toks;
      if (!t.length) { $('res').innerHTML = '<p class="note">Type a few letters of what you are looking for.</p>'; return; }
      let h = '';
      if (r.boxes.length) {
        h += '<h2>Boxes <span class="ta">பெட்டிகள்</span></h2>' + r.boxes.map(x => '<button class="row" data-box="' + esc(x.b.box_id) + '">' + thumbImg(x.b.cover_photo_id) +
          '<span class="rt"><b>' + hl(x.b.name, t) + '</b><span class="id">' + hl(x.b.box_id, t) + '</span><span class="sub">' +
          hl([typeName(x.b.type_id), locLabel(x.b.loc_id)].filter(Boolean).join(' · '), t) + '</span></span></button>').join('');
      }
      if (r.items.length) {
        h += '<h2>Things <span class="ta">பொருட்கள்</span></h2>' + r.items.map(x => '<button class="row" data-item="' + esc(x.i.item_id) + '">' + thumbImg(x.i.photo_id) +
          '<span class="rt"><b>' + hl(x.i.name, t) + (x.i.qty ? ' <span class="qty">× ' + esc(x.i.qty) + '</span>' : '') + '</b>' +
          (x.i.also_called ? '<span class="sub">' + hl(x.i.also_called, t) + '</span>' : '') +
          '<span class="sub">In <b>' + hl(x.b.name, t) + '</b> (' + esc(x.b.box_id) + ')' + (locLabel(x.b.loc_id) ? ' · ' + hl(locLabel(x.b.loc_id), t) : '') + '</span>' +
          (x.i.status && x.i.status !== 'In box' ? '<span class="badge">' + esc(x.i.status) + '</span>' : '') + '</span></button>').join('');
      }
      if (!h) h = '<section class="card"><p>Nothing found. Try fewer letters, or another word. <span class="ta">எதுவும் கிடைக்கவில்லை.</span></p></section>';
      $('res').innerHTML = h;
      $('res').querySelectorAll('.row').forEach(row => {
        row.onclick = () => go(row.hasAttribute('data-box') ? '#/box/' + row.getAttribute('data-box') : '#/item/' + row.getAttribute('data-item'));
      });
      needThumbs(r.boxes.map(x => x.b.cover_photo_id).concat(r.items.map(x => x.i.photo_id)));
    };
    $('q').oninput = () => { clearTimeout(timer); timer = setTimeout(draw, 150); };
    $('q').focus(); draw();
  }

  /* ---------- Boxes ---------- */
  function showNewBoxAsk() {
    page('<section class="card"><h1>Add a new box <span class="ta">புதிய பெட்டி</span></h1><p>Type the number printed under the QR sticker. For example 4 or B004.</p>' +
      '<input id="num" inputmode="text" maxlength="6" autocomplete="off" placeholder="B004"></section>' +
      '<div id="err" class="err" hidden></div>' + btn('bGo', 'Next', 'primary', 'அடுத்து') + btn('bBack', 'Back', 'ghost', 'பின்'));
    const next = () => {
      const raw = $('num').value.trim();
      const id = normId(/^\d+$/.test(raw) ? 'B' + raw : raw);
      if (!id) { $('err').textContent = 'That does not look like a box number. Try 4 or B004.'; $('err').hidden = false; return; }
      go('#/box/' + id);
    };
    on('bGo', next); on('bBack', () => go('#/'));
    $('num').onkeydown = e => { if (e.key === 'Enter') next(); };
  }

  function showBoxes() {
    const list = boxesAll().slice().sort((a, b) => a.box_id.localeCompare(b.box_id));
    page('<h1>All boxes <span class="ta">எல்லா பெட்டிகள்</span></h1>' + (list.length ? '<input id="flt" placeholder="Type to filter" autocomplete="off">' : '') +
      '<div id="list"></div>' + (list.length ? '' : '<section class="card"><p>No boxes yet. Tap Add a new box.</p></section>') +
      btn('bNew', 'Add a new box', 'primary', 'புதிய பெட்டி சேர்') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    const draw = () => {
      const q = norm(($('flt') || {}).value);
      $('list').innerHTML = list.filter(b => !q || norm([b.box_id, b.name, b.looks_like, b.owner, typeName(b.type_id), locLabel(b.loc_id)].join(' ')).indexOf(q) !== -1).map(b =>
        '<button class="row" data-id="' + esc(b.box_id) + '">' + thumbImg(b.cover_photo_id) +
        '<span class="rt"><b>' + esc(b.name) + '</b><span class="id">' + esc(b.box_id) + '</span><span class="sub">' +
        esc([typeName(b.type_id), locLabel(b.loc_id) || 'No place yet'].filter(Boolean).join(' · ')) + '</span></span></button>').join('');
      $('list').querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/box/' + r.getAttribute('data-id')); });
      fillImgs();
    };
    draw();
    if ($('flt')) $('flt').oninput = draw;
    on('bNew', () => go('#/newbox')); on('bBack', () => go('#/'));
    needThumbs(list.map(b => b.cover_photo_id));
  }

  function itemRow(i) {
    return '<button class="row" data-item="' + esc(i.item_id) + '">' + thumbImg(i.photo_id) + '<span class="rt"><b>' + esc(i.name) +
      (i.qty ? ' <span class="qty">× ' + esc(i.qty) + '</span>' : '') + '</b>' + (i.also_called ? '<span class="sub">' + esc(i.also_called) + '</span>' : '') +
      (i.status && i.status !== 'In box' ? '<span class="badge">' + esc(i.status) + '</span>' : '') + '</span></button>';
  }

  function showBox(raw) {
    const id = normId(raw);
    const box = id && findBox(id);
    if (!id) return showMessage('Label not recognised', 'This label does not look like one of ours.', [{ label: 'Back to start', cls: 'ghost', fn: () => go('#/') }]);
    if (!box) {
      return showMessage('New box ' + id, 'This label has not been used yet. Set it up?',
        [{ label: 'Yes, set up this box', ta: 'ஆம், இந்தப் பெட்டியை அமை', fn: () => go('#/setup/' + id) }, { label: 'Back to start', cls: 'ghost', ta: 'முகப்புக்குத் திரும்பு', fn: () => go('#/') }]);
    }
    const kv = (k, tk, v) => v ? '<div class="kv"><b>' + k + ' <span class="ta">' + tk + '</span></b>' + esc(v) + '</div>' : '';
    const items = currentItems(box).sort((a, b) => a.name.localeCompare(b.name));
    page('<section class="card"><div class="big-id">' + esc(box.box_id) + '</div><h1>' + esc(box.name) + '</h1>' +
      (box.archived ? '<p class="warn">This box is archived (hidden).</p>' : '') +
      (box.cover_photo_id ? '<button class="photo" id="bPhoto">' + thumbImg(box.cover_photo_id, 'th big') + '<span class="note">Tap the picture to see it bigger</span></button>' : '') +
      kv('Type', 'வகை', typeName(box.type_id)) + kv('Looks like', 'எப்படி இருக்கும்', box.looks_like) +
      kv('Kept at', 'வைத்திருக்கும் இடம்', locLabel(box.loc_id) || 'No place chosen yet') +
      kv('Whose', 'யாருடையது', box.owner) + kv('Notes', 'குறிப்பு', box.notes) + '</section>' +
      '<h2>Inside this box <span class="ta">பெட்டியின் உள்ளே</span></h2>' +
      (items.length ? items.map(itemRow).join('') : '<p class="note">Nothing saved inside yet. <span class="ta">இன்னும் எதுவும் இல்லை.</span></p>') +
      btn('bAdd', 'Add an item', 'primary', 'பொருள் சேர்') +
      btn('bMove', 'Move this box', 'tape', 'பெட்டியை நகர்த்து') + btn('bEdit', 'Change details', 'ghost', 'விவரங்களை மாற்று') +
      btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    on('bAdd', () => go('#/additem/' + id));
    on('bMove', () => go('#/move/' + id)); on('bEdit', () => go('#/edit/' + id)); on('bBack', () => go('#/'));
    on('bPhoto', () => openBig(box.cover_photo_id));
    view.querySelectorAll('.row[data-item]').forEach(r => { r.onclick = () => go('#/item/' + r.getAttribute('data-item')); });
    needThumbs([box.cover_photo_id].concat(items.map(i => i.photo_id)));
  }

  function showBoxForm(raw, mode) {
    const id = normId(raw), box = id && findBox(id);
    if (!id) return go('#/');
    if (mode === 'new' && box) return go('#/box/' + id);
    if (mode === 'edit' && !box) return go('#/box/' + id);
    const b = box || {};
    const people = state.data.people;
    const owners = ['<option value="">Everyone / shared</option>'].concat(people.map(p => '<option' + (p === b.owner ? ' selected' : '') + '>' + esc(p) + '</option>'));
    if (b.owner && people.indexOf(b.owner) === -1) owners.push('<option selected>' + esc(b.owner) + '</option>');
    const typeOpts = '<option value="">No type</option>' + typesAll().map(t => '<option value="' + esc(t.type_id) + '"' + (t.type_id === b.type_id ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') +
      '<option value="__new">+ A new type of box</option>';
    const pp = photoPicker(b.cover_photo_id);
    page('<section class="card"><div class="big-id">' + esc(id) + '</div><h1>' + (mode === 'new' ? 'Set up this box' : 'Change details') + ' <span class="ta">' + (mode === 'new' ? 'பெட்டியை அமை' : 'விவரங்கள்') + '</span></h1></section>' +
      '<div id="err" class="err" hidden></div><section class="form">' +
      lab('fName', 'Name of the box', 'பெட்டியின் பெயர்') + '<input id="fName" maxlength="60" autocomplete="off" value="' + esc(b.name || '') + '">' +
      '<p class="hint">A short, easy name that no other box has. For example: Sun, Mango, Blue.</p>' +
      lab('fType', 'Type of box', 'பெட்டியின் வகை') + '<select id="fType">' + typeOpts + '</select>' +
      '<div id="newType" class="subform" hidden>' + lab('tName', 'Name of the type (for example: Orange tub)') + '<input id="tName" maxlength="60" autocomplete="off">' +
      lab('tLook', 'What this type looks like') + '<textarea id="tLook" maxlength="300" rows="2"></textarea></div>' +
      lab('fLook', 'What does the box look like?', 'எப்படி இருக்கும்?') + '<textarea id="fLook" maxlength="300" rows="3">' + esc(b.looks_like || '') + '</textarea>' +
      '<p class="hint">Choosing a type fills this in for you. You can change it.</p>' +
      pp.html +
      lab('fOwner', 'Whose organiser or box', 'யாருடையது') + '<select id="fOwner">' + owners.join('') + '</select>' +
      lab('pl', 'Where is it kept?', 'எங்கே வைத்திருக்கிறது?') + pickerHTML(b.loc_id) +
      lab('fNotes', 'Notes (optional)', 'குறிப்பு') + '<textarea id="fNotes" maxlength="500" rows="2">' + esc(b.notes || '') + '</textarea></section>' +
      btn('bSave', 'Save', 'primary', 'சேமி') + btn('bCancel', 'Cancel', 'ghost', 'ரத்து செய்'));
    wirePicker(); pp.wire();
    needThumbs([b.cover_photo_id]);
    let autoLook = b.looks_like || '';
    $('fType').onchange = () => {
      const v = $('fType').value;
      $('newType').hidden = v !== '__new';
      if (v === '__new') return $('tName').focus();
      const t = findType(v);
      if (t && t.looks_like && (!$('fLook').value.trim() || $('fLook').value === autoLook)) { $('fLook').value = t.looks_like; autoLook = t.looks_like; }
    };
    on('bCancel', () => go('#/box/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      const name = $('fName').value.trim();
      if (!name) return showErr({ code: 'INVALID', message: 'Please give the box a name.' });
      const clash = state.data.boxes.find(x => x.box_id !== id && norm(x.name) === norm(name));
      if (clash) {
        showErr({ code: 'INVALID', message: 'The name "' + clash.name + '" is already used by box ' + clash.box_id + (locLabel(clash.loc_id) ? ' (kept at ' + locLabel(clash.loc_id) + ')' : '') + '. This box needs a different name.' });
        const lk = document.createElement('a'); lk.href = '#/box/' + clash.box_id; lk.className = 'lk'; lk.textContent = 'Look at box ' + clash.box_id;
        $('err').appendChild(document.createElement('br')); $('err').appendChild(lk);
        return;
      }
      if (mode === 'new' && !$('pl').value) return showErr({ code: 'INVALID', message: 'Please choose where the box is kept.' });
      busy('bSave', true);
      try {
        const loc = await resolvePlace();
        let typeId = $('fType').value, look = $('fLook').value;
        if (typeId === '__new') {
          const tn = $('tName').value.trim();
          if (!tn) throw { code: 'INVALID', message: 'Please type the name of the new box type.' };
          const have = state.data.types.find(t => norm(t.name) === norm(tn));
          if (have) typeId = have.type_id;
          else {
            const tl = $('tLook').value || look;
            const r = await api('saveType', { name: tn, looks_like: tl });
            upsert(state.data.types, 'type_id', r.type); typeId = r.type.type_id;
            if (!look.trim()) look = tl;
          }
        }
        const p = { box_id: id, is_new: mode === 'new', name: name, looks_like: look, owner: $('fOwner').value, notes: $('fNotes').value, type_id: typeId };
        if (loc) p.loc_id = loc;
        const photo = pp.get();
        if (photo) { p.cover_b64 = photo.b64; p.cover_thumb_b64 = photo.thumb; }
        const r = await api('saveBox', p);
        upsert(state.data.boxes, 'box_id', r.box);
        if (photo) cachePhoto(r.box.cover_photo_id, photo);
        remember(); bgRefresh();
        state.flash = 'Saved. சேமிக்கப்பட்டது.';
        go('#/box/' + id);
      } catch (e) { busy('bSave', false); showErr(e); }
    });
  }

  function showMove(raw) {
    const id = normId(raw), box = id && findBox(id);
    if (!box) return go('#/box/' + (id || ''));
    page('<section class="card"><div class="big-id">' + esc(id) + '</div><h1>Move ' + esc(box.name) + '</h1>' +
      '<div class="kv"><b>Now kept at</b>' + esc(locLabel(box.loc_id) || 'No place chosen yet') + '</div></section>' +
      '<div id="err" class="err" hidden></div><section class="form">' + lab('pl', 'New place', 'புதிய இடம்') + pickerHTML('') + '</section>' +
      btn('bSave', 'Move it here', 'primary', 'இங்கே நகர்த்து') + btn('bCancel', 'Cancel', 'ghost', 'ரத்து செய்'));
    wirePicker();
    on('bCancel', () => go('#/box/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      if (!$('pl').value) return showErr({ code: 'INVALID', message: 'Please choose the new place.' });
      busy('bSave', true);
      try {
        const loc = await resolvePlace();
        if (loc === box.loc_id) { state.flash = 'It is already there.'; return go('#/box/' + id); }
        const r = await api('saveBox', { box_id: id, name: box.name, loc_id: loc });
        upsert(state.data.boxes, 'box_id', r.box);
        remember(); bgRefresh();
        state.flash = 'Moved. The old place is kept in the history.';
        go('#/box/' + id);
      } catch (e) { busy('bSave', false); showErr(e); }
    });
  }

  /* ---------- Items ---------- */
  function showItem(id) {
    const it = findItem(id), box = it && findBox(it.box_id);
    if (!it || !box) return go('#/');
    page('<section class="card"><h1>' + esc(it.name) + (it.qty ? ' <span class="qty">× ' + esc(it.qty) + '</span>' : '') + '</h1>' +
      (it.photo_id ? '<button class="photo" id="bPhoto">' + thumbImg(it.photo_id, 'th big') + '<span class="note">Tap the picture to see it bigger</span></button>' : '') +
      (it.also_called ? '<div class="kv"><b>Also called <span class="ta">வேறு பெயர்கள்</span></b>' + esc(it.also_called) + '</div>' : '') +
      (it.description ? '<div class="kv"><b>Details <span class="ta">விவரம்</span></b>' + esc(it.description) + '</div>' : '') +
      '<div class="kv"><b>Kept in <span class="ta">எங்கே உள்ளது</span></b>' + esc(box.name) + ' (' + esc(box.box_id) + ')' +
      (locLabel(box.loc_id) ? '<br>' + esc(locLabel(box.loc_id)) : '') + '</div></section>' +
      '<h2>Status <span class="ta">நிலை</span></h2><div class="seg">' +
      Object.keys(STATUS).map(s => '<button class="segb' + ((it.status || 'In box') === s ? ' sel' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '<span class="ta">' + esc(STATUS[s]) + '</span></button>').join('') + '</div>' +
      '<div id="err" class="err" hidden></div>' +
      btn('bBox', 'Open box ' + box.box_id, 'tape', 'பெட்டியைத் திற') + btn('bEdit', 'Change this item', 'ghost', 'மாற்று') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    on('bBox', () => go('#/box/' + box.box_id)); on('bEdit', () => go('#/edititem/' + id)); on('bBack', () => go('#/'));
    on('bPhoto', () => openBig(it.photo_id));
    view.querySelectorAll('.segb').forEach(b => {
      b.onclick = async () => {
        const s = b.getAttribute('data-s'); if (s === (it.status || 'In box')) return;
        view.querySelectorAll('.segb').forEach(x => { x.disabled = true; });
        try {
          const r = await api('saveItem', { item_id: id, box_id: it.box_id, name: it.name, status: s });
          upsert(state.data.items, 'item_id', r.item); remember(); bgRefresh();
          state.flash = 'Saved. சேமிக்கப்பட்டது.'; showItem(id);
        } catch (e) { view.querySelectorAll('.segb').forEach(x => { x.disabled = false; }); showErr(e); }
      };
    });
    needThumbs([it.photo_id]);
  }

  function showItemForm(arg, mode) {
    const it = mode === 'edit' ? findItem(arg) : null;
    const boxId = mode === 'edit' ? (it && it.box_id) : normId(arg);
    const box = boxId && findBox(boxId);
    if (!box) return go('#/');
    if (mode === 'edit' && !it) return go('#/');
    const i = it || {};
    const pp = photoPicker(i.photo_id);
    const boxOpts = mode === 'edit' ? lab('iBox', 'Which box is it in?', 'எந்தப் பெட்டியில்?') + '<select id="iBox">' +
      boxesAll().sort((a, b) => a.name.localeCompare(b.name)).map(b => '<option value="' + esc(b.box_id) + '"' + (b.box_id === boxId ? ' selected' : '') + '>' + esc(b.name) + ' (' + esc(b.box_id) + ')</option>').join('') + '</select>' : '';
    page('<section class="card"><h1>' + (mode === 'edit' ? 'Change this item' : 'Add an item') + ' <span class="ta">' + (mode === 'edit' ? 'மாற்று' : 'பொருள் சேர்') + '</span></h1>' +
      '<p class="muted">Box: <b>' + esc(box.name) + '</b> (' + esc(box.box_id) + ')</p></section>' +
      '<div id="err" class="err" hidden></div><section class="form">' +
      lab('iName', 'What is it?', 'என்ன பொருள்?') + '<input id="iName" maxlength="80" autocomplete="off" value="' + esc(i.name || '') + '"><div id="sugName" class="sugg"></div>' +
      lab('iAlso', 'Also called (other words, Tamil too)', 'வேறு பெயர்கள்') + '<input id="iAlso" maxlength="200" autocomplete="off" value="' + esc(i.also_called || '') + '"><div id="sugAlso" class="sugg"></div>' +
      '<p class="hint">Separate words with a comma. For example: torch, tochu, டார்ச்</p>' +
      lab('iQty', 'How many? (optional)', 'எத்தனை?') + '<input id="iQty" maxlength="20" autocomplete="off" value="' + esc(i.qty || '') + '">' +
      lab('iDesc', 'Details (optional)', 'விவரம்') + '<textarea id="iDesc" maxlength="500" rows="2">' + esc(i.description || '') + '</textarea>' +
      pp.html + boxOpts + '</section>' +
      btn('bSave', 'Save', 'primary', 'சேமி') + (mode === 'new' ? btn('bSaveMore', 'Save and add another', 'tape', 'சேமித்து இன்னொன்று சேர்') : '') + btn('bCancel', 'Cancel', 'ghost', 'ரத்து செய்'));
    pp.wire(); wireSuggest('iName', 'sugName', true); wireSuggest('iAlso', 'sugAlso', false);
    needThumbs([i.photo_id]);
    on('bCancel', () => go(mode === 'edit' ? '#/item/' + arg : '#/box/' + boxId));
    const save = async more => {
      $('err').hidden = true;
      const name = $('iName').value.trim();
      if (!name) return showErr({ code: 'INVALID', message: 'Please type what the item is.' });
      const trim = s => s.replace(/[,\s]+$/, '');
      const p = { box_id: mode === 'edit' ? $('iBox').value : boxId, name: name, also_called: trim($('iAlso').value), description: $('iDesc').value, qty: $('iQty').value.trim() };
      if (mode === 'edit') p.item_id = arg;
      const photo = pp.get();
      if (photo) { p.photo_b64 = photo.b64; p.thumb_b64 = photo.thumb; }
      busy('bSave', true); if ($('bSaveMore')) $('bSaveMore').disabled = true;
      try {
        const r = await api('saveItem', p);
        upsert(state.data.items, 'item_id', r.item);
        if (photo) cachePhoto(r.item.photo_id, photo);
        remember(); bgRefresh();
        state.flash = 'Saved. சேமிக்கப்பட்டது.';
        go(more ? '#/additem/' + boxId : (mode === 'edit' ? '#/item/' + arg : '#/box/' + boxId));
      } catch (e) { busy('bSave', false); if ($('bSaveMore')) $('bSaveMore').disabled = false; showErr(e); }
    };
    on('bSave', () => save(false)); on('bSaveMore', () => save(true));
  }

  /* ---------- Places ---------- */
  function showPlaces() {
    const ps = places().slice().sort(byLabel);
    page('<h1>Places <span class="ta">இடங்கள்</span></h1>' + (ps.length ? '' : '<section class="card"><p>No places yet. Tap Add a place.</p></section>') +
      ps.map(l => '<button class="row" data-id="' + esc(l.loc_id) + '"><span class="rt"><b>' + esc(locLabel(l.loc_id)) + '</b><span class="sub">' + countAt(l.loc_id) + ' boxes</span></span></button>').join('') +
      btn('bAdd', 'Add a place', 'primary', 'இடம் சேர்') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/place/' + r.getAttribute('data-id')); });
    on('bAdd', () => go('#/placeform/new')); on('bBack', () => go('#/'));
  }

  function showPlace(id) {
    const l = state.data.locations.find(x => x.loc_id === id);
    if (!l) return go('#/places');
    const here = boxesAll().filter(b => b.loc_id === id).sort((a, b) => a.box_id.localeCompare(b.box_id));
    page('<section class="card"><h1>' + esc(locLabel(id)) + '</h1>' + (l.note ? '<p class="muted">' + esc(l.note) + '</p>' : '') + '</section>' +
      '<h2>Boxes here <span class="ta">இங்குள்ள பெட்டிகள்</span></h2>' + (here.length ? '' : '<p class="note">No boxes are kept here.</p>') +
      here.map(b => '<button class="row" data-id="' + esc(b.box_id) + '">' + thumbImg(b.cover_photo_id) +
        '<span class="rt"><b>' + esc(b.name) + '</b><span class="id">' + esc(b.box_id) + '</span></span></button>').join('') +
      btn('bEdit', 'Change this place', 'ghost', 'இடத்தை மாற்று') + btn('bBack', 'Back to places', 'ghost', 'இடங்களுக்குத் திரும்பு'));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/box/' + r.getAttribute('data-id')); });
    on('bEdit', () => go('#/placeform/' + id)); on('bBack', () => go('#/places'));
    needThumbs(here.map(b => b.cover_photo_id));
  }

  function showPlaceForm(id) {
    const l = id === 'new' ? {} : state.data.locations.find(x => x.loc_id === id);
    if (!l) return go('#/places');
    const dl = (i, a) => '<datalist id="' + i + '">' + a.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>';
    page('<section class="card"><h1>' + (id === 'new' ? 'Add a place' : 'Change this place') + '</h1></section><div id="err" class="err" hidden></div><section class="form">' +
      lab('pRoom', 'Room (for example: Loft, Hall)') + '<input id="pRoom" list="dlRoom" maxlength="40" autocomplete="off" value="' + esc(l.room || '') + '">' +
      lab('pShelf', 'Shelf or cupboard (optional)') + '<input id="pShelf" list="dlShelf" maxlength="40" autocomplete="off" value="' + esc(l.shelf || '') + '">' +
      lab('pRow', 'Row (optional)') + '<input id="pRow" maxlength="40" autocomplete="off" value="' + esc(l.row || '') + '">' +
      lab('pNote', 'Note (optional)') + '<input id="pNote" maxlength="200" autocomplete="off" value="' + esc(l.note || '') + '">' +
      dl('dlRoom', Array.from(new Set(places().map(x => x.room)))) + dl('dlShelf', Array.from(new Set(places().map(x => x.shelf).filter(Boolean)))) +
      '</section>' + btn('bSave', 'Save', 'primary', 'சேமி') + btn('bCancel', 'Cancel', 'ghost', 'ரத்து செய்'));
    on('bCancel', () => go(id === 'new' ? '#/places' : '#/place/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      if (!norm($('pRoom').value)) return showErr({ code: 'INVALID', message: 'Please type the room name.' });
      busy('bSave', true);
      try {
        const p = { room: $('pRoom').value, shelf: $('pShelf').value, row: $('pRow').value, note: $('pNote').value };
        if (id !== 'new') p.loc_id = id;
        const r = await api('saveLocation', p);
        upsert(state.data.locations, 'loc_id', r.location); remember(); bgRefresh();
        state.flash = 'Saved. சேமிக்கப்பட்டது.';
        go('#/place/' + r.location.loc_id);
      } catch (e) { busy('bSave', false); showErr(e.code === 'DUPLICATE' ? { code: 'INVALID', message: 'This place is already in the list.' } : e); }
    });
  }

  /* ---------- Box types ---------- */
  function showTypes() {
    const ts = typesAll().slice().sort((a, b) => a.name.localeCompare(b.name));
    page('<h1>Box types <span class="ta">பெட்டி வகைகள்</span></h1><p class="note">A type is a kind of box or organiser that looks the same, for example "Orange tub".</p>' +
      (ts.length ? '' : '<section class="card"><p>No types yet. Tap Add a type.</p></section>') +
      ts.map(t => '<button class="row" data-id="' + esc(t.type_id) + '"><span class="rt"><b>' + esc(t.name) + '</b><span class="sub">' + esc(t.looks_like || '') + '</span><span class="sub">' +
        boxesAll().filter(b => b.type_id === t.type_id).length + ' boxes</span></span></button>').join('') +
      btn('bAdd', 'Add a type', 'primary', 'வகை சேர்') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/typeform/' + r.getAttribute('data-id')); });
    on('bAdd', () => go('#/typeform/new')); on('bBack', () => go('#/'));
  }

  function showTypeForm(id) {
    const t = id === 'new' ? {} : findType(id);
    if (!t) return go('#/types');
    page('<section class="card"><h1>' + (id === 'new' ? 'Add a box type' : 'Change this type') + '</h1></section><div id="err" class="err" hidden></div><section class="form">' +
      lab('tName', 'Name of the type (for example: Orange tub)') + '<input id="tName" maxlength="60" autocomplete="off" value="' + esc(t.name || '') + '">' +
      lab('tLook', 'What this type looks like') + '<textarea id="tLook" maxlength="300" rows="3">' + esc(t.looks_like || '') + '</textarea>' +
      '<p class="hint">Boxes you already set up keep the words they have now. Changing a type only helps boxes you set up next.</p></section>' +
      btn('bSave', 'Save', 'primary', 'சேமி') + btn('bCancel', 'Cancel', 'ghost', 'ரத்து செய்'));
    on('bCancel', () => go('#/types'));
    on('bSave', async () => {
      $('err').hidden = true;
      if (!norm($('tName').value)) return showErr({ code: 'INVALID', message: 'Please type the name of the type.' });
      busy('bSave', true);
      try {
        const p = { name: $('tName').value, looks_like: $('tLook').value };
        if (id !== 'new') p.type_id = id;
        const r = await api('saveType', p);
        upsert(state.data.types, 'type_id', r.type); remember(); bgRefresh();
        state.flash = 'Saved. சேமிக்கப்பட்டது.'; go('#/types');
      } catch (e) { busy('bSave', false); showErr(e.code === 'DUPLICATE' ? { code: 'INVALID', message: e.message } : e); }
    });
  }

  /* ---------- routing ---------- */
  function route() {
    const lb = $('lb'); if (lb) lb.remove();
    const h = location.hash || '#/';
    const d = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    let m;
    if ((m = h.match(/^#\/box\/([^/?]+)/i))) return showBox(d(m[1]));
    if ((m = h.match(/^#\/setup\/([^/?]+)/i))) return showBoxForm(d(m[1]), 'new');
    if ((m = h.match(/^#\/edit\/([^/?]+)/i))) return showBoxForm(d(m[1]), 'edit');
    if ((m = h.match(/^#\/move\/([^/?]+)/i))) return showMove(d(m[1]));
    if ((m = h.match(/^#\/additem\/([^/?]+)/i))) return showItemForm(d(m[1]), 'new');
    if ((m = h.match(/^#\/edititem\/([^/?]+)/i))) return showItemForm(d(m[1]), 'edit');
    if ((m = h.match(/^#\/item\/([^/?]+)/i))) return showItem(d(m[1]));
    if (/^#\/settings/i.test(h)) return showSettings();
    if (/^#\/search/i.test(h)) return showSearch();
    if (/^#\/boxes/i.test(h)) return showBoxes();
    if (/^#\/newbox/i.test(h)) return showNewBoxAsk();
    if ((m = h.match(/^#\/placeform\/([^/?]+)/i))) return showPlaceForm(d(m[1]));
    if ((m = h.match(/^#\/place\/([^/?]+)/i))) return showPlace(d(m[1]));
    if (/^#\/places/i.test(h)) return showPlaces();
    if ((m = h.match(/^#\/typeform\/([^/?]+)/i))) return showTypeForm(d(m[1]));
    if (/^#\/types/i.test(h)) return showTypes();
    showHome();
  }

  /* ---------- start ---------- */
  function start() {
    const bad = v => !v || String(v).indexOf('PASTE_') === 0;
    if (bad(CFG.SCRIPT_URL) || bad(CFG.CLIENT_ID)) {
      return showMessage('Setup not finished', 'Open config.js, type in the Web app URL and the Client ID, then upload it to GitHub again.');
    }
    loadThumbCache(); applyPrefs();
    if (!$('bSettings')) { const sb = document.createElement('button'); sb.id = 'bSettings'; sb.className = 'link'; sb.textContent = 'Settings'; sb.onclick = () => go('#/settings'); bar.insertBefore(sb, $('signout')); }
    const t = recall('hf_token');
    let exp = 0;
    try { exp = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) {}
    if (t && exp > Date.now() + 120000) {
      state.token = t;
      // Show the last saved list at once, then fetch the newest one quietly.
      try {
        const c = JSON.parse(recall('hf_cache') || 'null');
        if (c && c.me && c.boxes) { setData(c); bar.hidden = false; route(); bgRefresh(); return; }
      } catch (e) {}
      load();
    } else showSignIn();
  }

  $('signout').onclick = signOut;
  window.addEventListener('hashchange', () => { if (state.data) route(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvt = e; if (state.data && (location.hash || '#/') === '#/') showHome(); });
  window.addEventListener('appinstalled', () => { state.installEvt = null; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  start();
})();
