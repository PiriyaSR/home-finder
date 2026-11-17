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
  const SITE = 'https://piriyasr.github.io/home-finder/';
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

  const FORM_ROUTE = /^#\/(setup|edit|move|additem|edititem|placeform|typeform|newbox|search|scan|labels|settings|history)/i;
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


  /* ---------- Scan a QR sticker with the camera ---------- */
  let cam = null;
  function stopCamera() {
    if (!cam) return;
    clearInterval(cam.timer);
    if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
    cam = null;
  }
  function labelTarget(text) {
    const m = String(text || '').match(/#\/(box|place)\/([A-Za-z0-9]+)/i);
    if (!m) return null;
    if (m[1].toLowerCase() === 'box') { const id = normId(m[2]); return id ? '#/box/' + id : null; }
    return /^L\d+$/i.test(m[2]) ? '#/place/' + m[2].toUpperCase() : null;
  }

  async function showScan() {
    page('<h1>Scan a box <span class="ta">ஸ்கேன்</span></h1>' +
      '<div class="camwrap"><video id="vid" playsinline muted autoplay></video></div>' +
      '<p id="scanNote" class="note">Point the camera at the QR sticker. <span class="ta">QR ஸ்டிக்கரை நோக்கிப் பிடிக்கவும்.</span></p>' +
      '<section class="card"><b>Or type the box number <span class="ta">அல்லது எண்ணை தட்டச்சு செய்</span></b>' +
      '<input id="scanNum" inputmode="text" maxlength="6" autocomplete="off" placeholder="B004"></section>' +
      btn('bGoNum', 'Open this box', 'primary', 'பெட்டியைத் திற') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    const note = t => { const n = $('scanNote'); if (n) n.textContent = t; };
    const openNum = () => {
      const raw = $('scanNum').value.trim();
      const id = normId(/^\d+$/.test(raw) ? 'B' + raw : raw);
      if (!id) return note('That does not look like a box number. Try 4 or B004.');
      go('#/box/' + id);
    };
    on('bGoNum', openNum); on('bBack', () => go('#/'));
    $('scanNum').onkeydown = e => { if (e.key === 'Enter') openNum(); };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return note('The camera cannot be used here. Please type the box number below.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch (e) {
      return note(e && e.name === 'NotAllowedError'
        ? 'The camera is blocked. Tap the lock icon next to the address, choose Permissions, and allow the Camera. Or type the box number below.'
        : 'The camera could not be started. Please type the box number below.');
    }
    if (!$('vid')) { stream.getTracks().forEach(t => t.stop()); return; }   // the person already left this screen
    stopCamera();
    const vid = $('vid'); vid.srcObject = stream;
    try { await vid.play(); } catch (e) {}
    let det = null;
    try { if ('BarcodeDetector' in window) det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) {}
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    let busyNow = false, lastText = '', lastAt = 0;
    cam = { stream: stream, timer: setInterval(async () => {
      if (busyNow || vid.readyState < 2 || !vid.videoWidth) return;
      busyNow = true;
      try {
        let text = '';
        if (det) { try { const r = await det.detect(vid); if (r.length) text = r[0].rawValue; } catch (e) {} }
        if (!text && window.jsQR) {
          const sc = Math.min(1, 640 / vid.videoWidth); cv.width = Math.round(vid.videoWidth * sc); cv.height = Math.round(vid.videoHeight * sc);
          cx.drawImage(vid, 0, 0, cv.width, cv.height);
          const c = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
          if (c) text = c.data;
        }
        if (text) {
          const target = labelTarget(text);
          if (target) { stopCamera(); try { navigator.vibrate && navigator.vibrate(80); } catch (e) {} go(target); }
          else if (text !== lastText || Date.now() - lastAt > 3000) { lastText = text; lastAt = Date.now(); note('That QR code is not one of our labels. Try another sticker.'); }
        }
      } catch (e) {}
      busyNow = false;
    }, 300) };
  }

  /* ---------- QR labels to print ---------- */
  const LAYOUTS = {
    4:  { cols: 2, rows: 2, qr: 80, code: 36, word: 'Big' },
    8:  { cols: 2, rows: 4, qr: 48, code: 26, word: 'Medium' },
    12: { cols: 3, rows: 4, qr: 42, code: 22, word: 'Small' }
  };
  const lab_ = { kind: 'box', layout: 8, nums: '', start: 1 };

  function qrSvg(text) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 16, scalable: true });
  }
  function idFor(kind, n) { return (kind === 'place' ? 'L' : 'B') + ('000' + n).slice(-Math.max(3, String(n).length)); }
  function numOf(id) { return parseInt(String(id).slice(1), 10) || 0; }
  // "5-12" or "4,7,9" -> [5..12] or [4,7,9]
  function parseNums(str) {
    const out = [];
    String(str || '').toUpperCase().replace(/[BL]/g, '').split(/[,;\s]+/).filter(Boolean).forEach(tok => {
      const m = tok.match(/^(\d{1,4})(?:-(\d{1,4}))?$/);
      if (!m) { out.bad = true; return; }
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      if (a < 1 || b < a || b - a > 119) { out.bad = true; return; }
      for (let n = a; n <= b; n++) if (out.indexOf(n) === -1) out.push(n);
    });
    return out;
  }
  function defaultNums(kind, size) {
    if (kind === 'place') { const ns = places().map(l => numOf(l.loc_id)).filter(Boolean).sort((a, b) => a - b); return ns.join(', '); }
    const mx = state.data.boxes.reduce((m, b) => Math.max(m, numOf(b.box_id)), 0);
    return (mx + 1) + '-' + (mx + size);
  }
  function labelCell(id, kind, L) {
    if (!id) return '<div class="lcell blank"></div>';
    const url = SITE + '#/' + (kind === 'place' ? 'place' : 'box') + '/' + id;
    const sub = kind === 'place' ? '<div class="lsub">' + esc(locLabel(id)) + '</div>' : '<div class="nm">Name: <span class="ln"></span></div>';
    return '<div class="lcell"><div class="lqr" style="width:' + L.qr + 'mm;height:' + L.qr + 'mm">' + qrSvg(url) + '</div>' +
      '<div class="lcode" style="font-size:' + L.code + 'pt">' + esc(id) + '</div>' + sub + '</div>';
  }
  function sheetsHTML(ids, kind, layout, start) {
    const L = LAYOUTS[layout], per = L.cols * L.rows;
    const cells = [];
    for (let i = 1; i < start; i++) cells.push(null);
    ids.forEach(id => cells.push(id));
    let h = '';
    for (let i = 0; i < cells.length; i += per) {
      const chunk = cells.slice(i, i + per); while (chunk.length < per) chunk.push(null);
      h += '<div class="sheetwrap"><div class="sheet" style="grid-template-columns:repeat(' + L.cols + ',1fr);grid-template-rows:repeat(' + L.rows + ',1fr)">' +
        chunk.map(id => labelCell(id, kind, L)).join('') + '</div></div>';
    }
    return { html: h, sheets: Math.ceil(cells.length / per) };
  }

  function showLabels(hash) {
    const qm = (hash || '').match(/\?(.*)$/);
    if (qm) {
      const q = new URLSearchParams(qm[1]);
      lab_.kind = q.get('kind') === 'place' ? 'place' : 'box';
      lab_.nums = String(q.get('ids') || '').replace(/[BL]0*/gi, '');
      lab_.start = Number(q.get('start')) || 1;
    } else if (!lab_.nums) lab_.nums = defaultNums(lab_.kind, LAYOUTS[lab_.layout].cols * LAYOUTS[lab_.layout].rows);
    const segs = (items, cur, attr) => '<div class="seg row2">' + items.map(x => '<button class="segb' + (String(cur) === String(x[0]) ? ' sel' : '') + '" data-' + attr + '="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    page('<h1>Print labels <span class="ta">லேபிள்கள்</span></h1><div class="noprint">' +
      '<h2>What for? <span class="ta">எதற்கு?</span></h2>' + segs([['box', 'Boxes'], ['place', 'Shelves / places']], lab_.kind, 'kind') +
      lab('lNums', 'Which numbers? (for example 5-12 or 4,7,9)', 'எந்த எண்கள்?') + '<input id="lNums" inputmode="text" autocomplete="off" value="' + esc(lab_.nums) + '">' +
      '<h2>Labels on each page <span class="ta">ஒரு பக்கத்தில்</span></h2>' + segs(Object.keys(LAYOUTS).map(k => [k, k + ' (' + LAYOUTS[k].word + ')']), lab_.layout, 'layout') +
      lab('lStart', 'Start at spot number (to reuse a half-used page)', 'தொடங்கும் இடம்') + '<input id="lStart" inputmode="numeric" maxlength="2" value="' + esc(lab_.start) + '">' +
      '<p class="hint">Spot 1 is the top left. Spots count along each row.</p>' +
      '<p id="lInfo" class="note"></p>' +
      btn('bPrint', 'Print or save as PDF', 'primary', 'அச்சிடு') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு') +
      '<p class="hint">When printing, choose paper size A4 and Scale 100% (not "Fit to page"). Cut along the dashed lines.</p></div>' +
      '<div id="sheets"></div>');
    const draw = () => {
      lab_.nums = $('lNums').value;
      const L = LAYOUTS[lab_.layout], per = L.cols * L.rows;
      lab_.start = Math.max(1, Math.min(per, Number($('lStart').value) || 1));
      const ns = parseNums(lab_.nums);
      const info = $('lInfo');
      if (ns.bad || !ns.length) { info.textContent = 'Please type numbers like 5-12 or 4,7,9.'; $('sheets').innerHTML = ''; return; }
      if (ns.length > 120) { info.textContent = 'That is too many at once. Please print up to 120.'; $('sheets').innerHTML = ''; return; }
      const ids = ns.map(n => idFor(lab_.kind, n));
      const r = sheetsHTML(ids, lab_.kind, lab_.layout, lab_.start);
      info.textContent = ids.length + (ids.length > 1 ? ' labels on ' : ' label on ') + r.sheets + ' page' + (r.sheets > 1 ? 's' : '') + '.';
      $('sheets').innerHTML = r.html;
      const w = Math.min((view.clientWidth || 392) - 32, 794), sc = w / 794;
      view.querySelectorAll('.sheetwrap').forEach(sw => { sw.style.width = (794 * sc) + 'px'; sw.style.height = (1123 * sc) + 'px'; sw.firstChild.style.transform = 'scale(' + sc + ')'; });
    };
    view.querySelectorAll('[data-kind]').forEach(b => { b.onclick = () => { lab_.kind = b.getAttribute('data-kind'); lab_.nums = defaultNums(lab_.kind, LAYOUTS[lab_.layout].cols * LAYOUTS[lab_.layout].rows); lab_.start = 1; showLabels(''); }; });
    view.querySelectorAll('[data-layout]').forEach(b => { b.onclick = () => { lab_.layout = Number(b.getAttribute('data-layout')); lab_.nums = $('lNums').value; showLabels(''); }; });
    $('lNums').oninput = draw; $('lStart').oninput = draw;
    on('bPrint', () => window.print()); on('bBack', () => go('#/'));
    draw();
  }

  /* ---------- Home ---------- */
  function showHome() {
    const boxes = boxesAll().length;
    const items = allCurrentItems().length;
    page('<section class="card"><h1>Hello, ' + esc(state.me.nick) + ' <span class="ta">வணக்கம்</span></h1>' +
      '<p class="muted">' + boxes + ' boxes and ' + items + ' items saved so far.</p></section>' +
      btn('bSearch', 'Search', 'primary', 'தேடு') + btn('bScan', 'Scan a box', 'tape', 'பெட்டியை ஸ்கேன் செய்') +
      btn('bBoxes', 'All boxes', 'ghost', 'எல்லா பெட்டிகள்') + btn('bNew', 'Add a new box', 'ghost', 'புதிய பெட்டி சேர்') +
      btn('bMore', 'More', 'ghost', 'மேலும்'));
    on('bSearch', () => go('#/search')); on('bScan', () => go('#/scan'));
    on('bBoxes', () => go('#/boxes')); on('bNew', () => go('#/newbox')); on('bMore', () => go('#/more'));
  }

  function showMore() {
    page('<h1>More <span class="ta">மேலும்</span></h1>' +
      btn('bPlaces', 'Places', 'ghost', 'இடங்கள்') + btn('bTypes', 'Box types', 'ghost', 'பெட்டி வகைகள்') +
      btn('bLabels', 'Print labels', 'ghost', 'லேபிள்களை அச்சிடு') + btn('bHistory', 'History', 'ghost', 'வரலாறு') +
      btn('bHidden', 'Hidden things', 'ghost', 'மறைத்தவை') + btn('bSettings2', 'Settings', 'ghost', 'அமைப்புகள்') +
      (state.installEvt ? btn('bInstall', 'Install this app', 'tape', 'இந்த செயலியை நிறுவு') : '') +
      btn('bBack', 'Back to start', 'primary', 'முகப்புக்குத் திரும்பு'));
    on('bPlaces', () => go('#/places')); on('bTypes', () => go('#/types')); on('bLabels', () => go('#/labels'));
    on('bHistory', () => go('#/history')); on('bHidden', () => go('#/hidden')); on('bSettings2', () => go('#/settings'));
    on('bInstall', () => { state.installEvt.prompt(); state.installEvt = null; }); on('bBack', () => go('#/'));
  }


  /* ---------- Archive / restore, start fresh, past contents, history ---------- */
  const KIND = { box: ['boxes', 'box_id'], item: ['items', 'item_id'], location: ['locations', 'loc_id'] };
  async function setHidden(kind, id, hide) {
    await api('setArchived', { kind: kind, id: id, archived: !!hide });
    const rec = state.data[KIND[kind][0]].find(x => x[KIND[kind][1]] === id);
    if (rec) rec.archived = hide ? '1' : '';
    remember(); bgRefresh();
  }
  function confirmScreen(title, text, yesLabel, yesTa, yesFn, backHash) {
    page('<section class="card"><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></section><div id="err" class="err" hidden></div>' +
      btn('bYes', yesLabel, 'primary', yesTa) + btn('bNo', 'No, go back', 'ghost', 'இல்லை, திரும்பு'));
    on('bNo', () => go(backHash));
    on('bYes', async () => { busy('bYes', true); try { await yesFn(); } catch (e) { busy('bYes', false); showErr(e); } });
  }

  function confirmHideBox(id) {
    const box = findBox(id); if (!box) return go('#/');
    confirmScreen('Hide box ' + box.name + '?', 'The box and the things inside it will not show in lists or search. Nothing is deleted, and you can bring it back from More > Hidden things.',
      'Yes, hide it', 'ஆம், மறை', async () => { await setHidden('box', id, true); state.flash = 'Hidden. You can restore it from Hidden things.'; go('#/boxes'); }, '#/box/' + id);
  }
  function confirmHideItem(id) {
    const it = findItem(id); if (!it) return go('#/');
    confirmScreen('Hide "' + it.name + '"?', 'It will not show in the box or in search. Nothing is deleted, and you can bring it back from More > Hidden things.',
      'Yes, hide it', 'ஆம், மறை', async () => { await setHidden('item', id, true); state.flash = 'Hidden.'; go('#/box/' + it.box_id); }, '#/item/' + id);
  }
  function confirmHidePlace(id) {
    const l = state.data.locations.find(x => x.loc_id === id); if (!l) return go('#/places');
    if (countAt(id)) return showMessage('Boxes are still here', 'Move the boxes in ' + locLabel(id) + ' to another place first, then hide this place.', [{ label: 'Back', cls: 'ghost', ta: 'பின்', fn: () => go('#/place/' + id) }]);
    confirmScreen('Hide the place ' + locLabel(id) + '?', 'It will not show in the list of places. You can bring it back from More > Hidden things.',
      'Yes, hide it', 'ஆம், மறை', async () => { await setHidden('location', id, true); state.flash = 'Hidden.'; go('#/places'); }, '#/place/' + id);
  }

  function confirmFresh(id) {
    const box = findBox(id); if (!box) return go('#/');
    const n = currentItems(box).length;
    confirmScreen('Start ' + box.name + ' fresh?', 'Use this when the box is being used for different things now. The ' + n + ' thing' + (n === 1 ? '' : 's') + ' inside will be kept as "past contents" and will not show in search. Nothing is deleted, and you can put them back.',
      'Yes, start fresh', 'ஆம், புதிதாகத் தொடங்கு', async () => {
        const r = await api('startFresh', { box_id: id });
        box.gen = String(r.gen); box.status = 'Empty'; remember(); bgRefresh();
        state.flash = 'The box is empty and ready for new things.'; go('#/box/' + id);
      }, '#/box/' + id);
  }

  function pastItems(box) { return state.data.items.filter(i => i.box_id === box.box_id && !i.archived && Number(i.gen || 1) < Number(box.gen || 1)); }

  function showPast(raw) {
    const id = normId(raw), box = id && findBox(id); if (!box) return go('#/');
    const past = pastItems(box);
    const gens = Array.from(new Set(past.map(i => Number(i.gen || 1)))).sort((a, b) => b - a);
    page('<section class="card"><div class="big-id">' + esc(id) + '</div><h1>' + esc(box.name) + '</h1><p class="muted">Past contents. These are not in the box now. <span class="ta">முன்பு இருந்தவை</span></p></section>' +
      (gens.length ? gens.map(g => '<h2>Before fresh start ' + (Number(box.gen || 1) - g) + '</h2>' + past.filter(i => Number(i.gen || 1) === g).sort((a, b) => a.name.localeCompare(b.name)).map(itemRow).join('')).join('') : '<p class="note">Nothing here.</p>') +
      btn('bBack', 'Back to the box', 'ghost', 'பெட்டிக்குத் திரும்பு'));
    view.querySelectorAll('.row[data-item]').forEach(r => { r.onclick = () => go('#/item/' + r.getAttribute('data-item')); });
    on('bBack', () => go('#/box/' + id));
    needThumbs(past.map(i => i.photo_id));
  }

  function showHidden() {
    const d = state.data;
    const hb = d.boxes.filter(b => b.archived), hi = d.items.filter(i => i.archived), hl = d.locations.filter(l => l.archived);
    const row = (kind, id, title, sub) => '<div class="hrow"><div class="rt"><b>' + esc(title) + '</b><span class="sub">' + esc(sub) + '</span></div><button class="smallbtn" data-kind="' + kind + '" data-id="' + esc(id) + '">Restore<span class="ta">மீட்டெடு</span></button></div>';
    page('<h1>Hidden things <span class="ta">மறைத்தவை</span></h1><div id="err" class="err" hidden></div>' +
      (hb.length || hi.length || hl.length ? '' : '<section class="card"><p>Nothing is hidden.</p></section>') +
      (hb.length ? '<h2>Boxes</h2>' + hb.map(b => row('box', b.box_id, b.name + ' (' + b.box_id + ')', locLabel(b.loc_id))).join('') : '') +
      (hi.length ? '<h2>Things</h2>' + hi.map(i => { const b = findBox(i.box_id); return row('item', i.item_id, i.name, 'In ' + (b ? b.name : i.box_id) + (b && b.archived ? ' (hidden box)' : '')); }).join('') : '') +
      (hl.length ? '<h2>Places</h2>' + hl.map(l => row('location', l.loc_id, locLabel(l.loc_id), '')).join('') : '') +
      btn('bBack', 'Back', 'ghost', 'பின்'));
    on('bBack', () => go('#/more'));
    view.querySelectorAll('.smallbtn').forEach(b => {
      b.onclick = async () => {
        b.disabled = true;
        try { await setHidden(b.getAttribute('data-kind'), b.getAttribute('data-id'), false); state.flash = 'Restored.'; showHidden(); }
        catch (e) { b.disabled = false; showErr(e); }
      };
    });
  }

  /* ----- history ----- */
  const FIELD_WORDS = { name: 'Name', looks_like: 'Looks like', type_id: 'Type', owner: 'Whose', notes: 'Notes', cover_photo_id: 'Picture', status: 'Status',
    also_called: 'Other names', description: 'Details', qty: 'How many', photo_id: 'Picture', room: 'Room', shelf: 'Shelf', row: 'Row', note: 'Note', loc_id: 'Place' };
  // kind of history entry: label, Tamil, colour class
  const CATS = {
    added:   { en: 'Added', ta: 'சேர்க்கப்பட்டது' },
    moved:   { en: 'Moved', ta: 'நகர்த்தப்பட்டது' },
    out:     { en: 'Taken out', ta: 'வெளியே எடுத்தது' },
    used:    { en: 'Used up', ta: 'தீர்ந்துவிட்டது' },
    back:    { en: 'Back in box', ta: 'மீண்டும் பெட்டியில்' },
    changed: { en: 'Changed', ta: 'மாற்றப்பட்டது' },
    fresh:   { en: 'Fresh start', ta: 'புதிதாகத் தொடக்கம்' },
    hidden:  { en: 'Hidden', ta: 'மறைக்கப்பட்டது' },
    restored:{ en: 'Restored', ta: 'மீட்கப்பட்டது' }
  };
  function boxWord(id) { const b = findBox(id); return b ? b.name + ' (' + id + ')' : id; }
  const short = v => { v = String(v == null ? '' : v); return v.length > 40 ? v.slice(0, 40) + '…' : v; };

  // One history row -> { cat, label, kind, subject, lines[] }
  function describe(h) {
    let d = {}; try { d = JSON.parse(h.details || '{}') || {}; } catch (e) {}
    const t = h.target, nm = d.name || '', ch = d.changes || {};
    const changeLines = () => Object.keys(ch).map(k => {
      const w = FIELD_WORDS[k] || k;
      if (k === 'cover_photo_id' || k === 'photo_id') return w + ': new picture';
      if (k === 'type_id') return w + ': ' + (typeName(ch[k][0]) || 'none') + ' → ' + (typeName(ch[k][1]) || 'none');
      return w + ': ' + (ch[k][0] ? short(ch[k][0]) : '(empty)') + ' → ' + (ch[k][1] ? short(ch[k][1]) : '(empty)');
    });
    const kindOf = a => a.indexOf('location') >= 0 ? 'Place' : a.indexOf('item') >= 0 ? 'Item' : a.indexOf('type') >= 0 ? 'Box type' : 'Box';
    switch (h.action) {
      case 'box_created': return { cat: 'added', kind: 'Box', subject: boxWord(t), lines: d.place ? ['Kept at ' + d.place] : [] };
      case 'item_created': return { cat: 'added', kind: 'Item', subject: nm, lines: ['In box ' + boxWord(d.box_id)] };
      case 'place_created': return { cat: 'added', kind: 'Place', subject: [d.room, d.shelf, d.row].filter(Boolean).join(' > '), lines: [] };
      case 'type_created': return { cat: 'added', kind: 'Box type', subject: nm, lines: [] };
      case 'box_moved': return { cat: 'moved', kind: 'Box', subject: boxWord(t), lines: ['From: ' + (d.from || 'no place'), 'To: ' + (d.to || 'no place')] };
      case 'item_moved': return { cat: 'moved', kind: 'Item', subject: nm, lines: ['From box: ' + (ch.box_id ? boxWord(ch.box_id[0]) : '?'), 'To box: ' + boxWord(d.box_id)] };
      case 'item_status': {
        const s = ch.status ? ch.status[1] : '';
        return { cat: s === 'Taken out' ? 'out' : s === 'Used up' ? 'used' : 'back', kind: 'Item', subject: nm, lines: ['In box ' + boxWord(d.box_id)] };
      }
      case 'item_back_in_box': return { cat: 'back', kind: 'Item', subject: nm, lines: ['Put back in box ' + boxWord(d.box_id)] };
      case 'box_updated': case 'item_updated': case 'place_updated': case 'type_updated':
        return { cat: 'changed', kind: kindOf(h.action), subject: h.action === 'box_updated' ? boxWord(t) : (nm || [d.room, d.shelf, d.row].filter(Boolean).join(' > ') || t), lines: changeLines() };
      case 'box_start_fresh': return { cat: 'fresh', kind: 'Box', subject: boxWord(t), lines: [(d.items_moved_to_past || 0) + ' thing' + (d.items_moved_to_past === 1 ? '' : 's') + ' went to past contents'] };
      default:
        if (/^archived_/.test(h.action)) return { cat: 'hidden', kind: kindOf(h.action), subject: nm || t, lines: [] };
        if (/^restored_/.test(h.action)) return { cat: 'restored', kind: kindOf(h.action), subject: nm || t, lines: [] };
        return { cat: 'changed', kind: '', subject: t, lines: [h.action.replace(/_/g, ' ')] };
    }
  }
  function timeOnly(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function dayLabel(iso) {
    const d = new Date(iso); if (isNaN(d)) return 'Earlier';
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(new Date()) - day(d)) / 86400000);
    if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function entryHTML(h, showDay) {
    const x = describe(h), c = CATS[x.cat];
    return '<div class="he c-' + x.cat + '"><div class="he-top"><span class="tag t-' + x.cat + '">' + esc(c.en) + '</span><span class="he-who"><b>' + esc(h.who) + '</b> · ' +
      esc(showDay ? dayLabel(h.time) + ', ' + timeOnly(h.time) : timeOnly(h.time)) + '</span></div>' +
      '<div class="he-main">' + (x.kind ? '<span class="he-kind">' + esc(x.kind) + '</span> ' : '') + '<b>' + esc(x.subject) + '</b></div>' +
      x.lines.map(l => '<div class="he-line">' + esc(l) + '</div>').join('') + '</div>';
  }

  async function showHistory(hash) {
    const qm = (hash || '').match(/\?target=([^&]+)/);
    const target = qm ? decodeURIComponent(qm[1]) : '';
    const back = target ? (/^B/.test(target) ? '#/box/' + target : '#/item/' + target) : '#/more';
    const head = '<h1>History <span class="ta">வரலாறு</span></h1>' + (target ? '<p class="muted">' + esc(/^B/.test(target) ? boxWord(target) : ((findItem(target) || {}).name || target)) + '</p>' : '');
    page(head + '<p class="note center">Loading…</p>');
    let rows;
    try { rows = await api('getHistory', { target: target, limit: 150 }); }
    catch (e) {
      page(head + '<div class="err">' + esc(e.code === 'NETWORK' ? 'The history needs internet. Please try again when the internet is back.' : (e.message || 'Could not open the history.')) + '</div>' + btn('bBack', 'Back', 'ghost', 'பின்'));
      return on('bBack', () => go(back));
    }
    let mode = recall('hf_histview') === 'kind' ? 'kind' : 'date';
    const draw = () => {
      let body = '';
      if (!rows.length) body = '<section class="card"><p>Nothing has happened yet.</p></section>';
      else if (mode === 'date') {
        let last = '';
        rows.forEach(h => { const dl = dayLabel(h.time); if (dl !== last) { body += '<h2 class="dayh">' + esc(dl) + '</h2>'; last = dl; } body += entryHTML(h, false); });
      } else {
        Object.keys(CATS).forEach(k => {
          const list = rows.filter(h => describe(h).cat === k); if (!list.length) return;
          body += '<details class="kind k-' + k + '"' + (rows.length <= 12 ? ' open' : '') + '><summary><span class="tag t-' + k + '">' + esc(CATS[k].en) + '</span> <span class="ta">' + esc(CATS[k].ta) + '</span> <span class="cnt">' + list.length + '</span></summary>' +
            list.map(h => entryHTML(h, true)).join('') + '</details>';
        });
      }
      page(head + '<div class="seg row2"><button class="segb' + (mode === 'date' ? ' sel' : '') + '" data-m="date">By date<span class="ta">தேதிப்படி</span></button>' +
        '<button class="segb' + (mode === 'kind' ? ' sel' : '') + '" data-m="kind">By kind<span class="ta">வகைப்படி</span></button></div>' + body +
        (rows.length >= 150 ? '<p class="note center">Showing the latest 150 changes.</p>' : '') + btn('bBack', 'Back', 'ghost', 'பின்'));
      view.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { mode = b.getAttribute('data-m'); keep('hf_histview', mode); draw(); }; });
      on('bBack', () => go(back));
    };
    draw();
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
      btn('bPrint', 'Print this label again', 'ghost', 'லேபிளை மீண்டும் அச்சிடு') +
      (pastItems(box).length ? btn('bPast', 'Past contents (' + pastItems(box).length + ')', 'ghost', 'முன்பு இருந்தவை') : '') +
      btn('bFresh', 'Start fresh (box is reused)', 'ghost', 'புதிதாகத் தொடங்கு') + btn('bHist', 'History of this box', 'ghost', 'வரலாறு') +
      btn('bHide', 'Hide this box', 'ghost', 'பெட்டியை மறை') +
      btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    on('bPast', () => go('#/past/' + id)); on('bFresh', () => go('#/fresh/' + id)); on('bHist', () => go('#/history?target=' + id)); on('bHide', () => go('#/hide/' + id));
    on('bPrint', () => go('#/labels?kind=box&ids=' + id));
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
    const past = Number(it.gen || 1) < Number(box.gen || 1);
    page('<section class="card"><h1>' + esc(it.name) + (it.qty ? ' <span class="qty">× ' + esc(it.qty) + '</span>' : '') + '</h1>' +
      (it.photo_id ? '<button class="photo" id="bPhoto">' + thumbImg(it.photo_id, 'th big') + '<span class="note">Tap the picture to see it bigger</span></button>' : '') +
      (it.also_called ? '<div class="kv"><b>Also called <span class="ta">வேறு பெயர்கள்</span></b>' + esc(it.also_called) + '</div>' : '') +
      (it.description ? '<div class="kv"><b>Details <span class="ta">விவரம்</span></b>' + esc(it.description) + '</div>' : '') +
      '<div class="kv"><b>Kept in <span class="ta">எங்கே உள்ளது</span></b>' + esc(box.name) + ' (' + esc(box.box_id) + ')' +
      (locLabel(box.loc_id) ? '<br>' + esc(locLabel(box.loc_id)) : '') + '</div></section>' +
      (past ? '<p class="warn">This was in the box before it was started fresh. It is not counted as inside the box now.</p>' : '') +
      (past ? '' : '<h2>Status <span class="ta">நிலை</span></h2><div class="seg">') +
      (past ? '' : Object.keys(STATUS).map(s => '<button class="segb' + ((it.status || 'In box') === s ? ' sel' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '<span class="ta">' + esc(STATUS[s]) + '</span></button>').join('') + '</div>') +
      '<div id="err" class="err" hidden></div>' +
      (past ? btn('bBackIn', 'Put it back in the box', 'primary', 'மீண்டும் பெட்டியில் வை') : '') +
      btn('bBox', 'Open box ' + box.box_id, 'tape', 'பெட்டியைத் திற') + btn('bEdit', 'Change this item', 'ghost', 'மாற்று') +
      btn('bHist', 'History of this item', 'ghost', 'வரலாறு') + btn('bHide', 'Hide this item', 'ghost', 'மறை') + btn('bBack', 'Back to start', 'ghost', 'முகப்புக்குத் திரும்பு'));
    on('bBox', () => go('#/box/' + box.box_id)); on('bEdit', () => go('#/edititem/' + id)); on('bBack', () => go('#/'));
    on('bHist', () => go('#/history?target=' + id)); on('bHide', () => go('#/hideitem/' + id));
    on('bBackIn', async () => {
      busy('bBackIn', true);
      try { const r = await api('saveItem', { item_id: id, box_id: it.box_id, name: it.name, bring_back: true }); upsert(state.data.items, 'item_id', r.item); remember(); bgRefresh(); state.flash = 'It is back in the box.'; go('#/box/' + it.box_id); }
      catch (e) { busy('bBackIn', false); showErr(e); }
    });
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
      btn('bEdit', 'Change this place', 'ghost', 'இடத்தை மாற்று') + btn('bPrint', 'Print a label for this place', 'ghost', 'இந்த இடத்துக்கான லேபிள்') + btn('bHide', 'Hide this place', 'ghost', 'இடத்தை மறை') + btn('bBack', 'Back to places', 'ghost', 'இடங்களுக்குத் திரும்பு'));
    on('bHide', () => go('#/hideplace/' + id));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/box/' + r.getAttribute('data-id')); });
    on('bPrint', () => go('#/labels?kind=place&ids=' + id));
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
    stopCamera();
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
    if ((m = h.match(/^#\/past\/([^/?]+)/i))) return showPast(d(m[1]));
    if ((m = h.match(/^#\/fresh\/([^/?]+)/i))) return confirmFresh(normId(d(m[1])));
    if ((m = h.match(/^#\/hide\/([^/?]+)/i))) return confirmHideBox(normId(d(m[1])));
    if ((m = h.match(/^#\/hideitem\/([^/?]+)/i))) return confirmHideItem(d(m[1]));
    if ((m = h.match(/^#\/hideplace\/([^/?]+)/i))) return confirmHidePlace(d(m[1]));
    if (/^#\/hidden/i.test(h)) return showHidden();
    if (/^#\/history/i.test(h)) return showHistory(h);
    if (/^#\/more/i.test(h)) return showMore();
    if (/^#\/scan/i.test(h)) return showScan();
    if (/^#\/labels/i.test(h)) { if (h.indexOf('?') < 0) { lab_.nums = ''; lab_.start = 1; } return showLabels(h); }
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
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvt = e; if (state.data && /^#\/(more)?$/.test(location.hash || '#/')) route(); });
  window.addEventListener('appinstalled', () => { state.installEvt = null; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  start();
})();
