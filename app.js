(function () {
  'use strict';
  const CFG = window.HOME_FINDER || {};
  const view = document.getElementById('view');
  const bar = document.getElementById('bar');
  const state = { token: null, me: null, data: null, installEvt: null, thumbs: {}, full: {}, offline: false, flash: '' };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function keep(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

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
    const off = state.offline ? '<div class="warn">No internet. You are seeing the last saved list. Changes cannot be saved now.</div>' : '';
    const flash = state.flash ? '<div class="ok">' + esc(state.flash) + '</div>' : '';
    state.flash = '';
    view.innerHTML = off + flash + html;
    window.scrollTo(0, 0);
  }
  function go(h) { if (location.hash === h) route(); else location.hash = h; }
  function btn(id, label, cls) { return '<button class="big ' + (cls || 'primary') + '" id="' + id + '">' + esc(label) + '</button>'; }
  function on(id, fn) { const el = $(id); if (el) el.onclick = fn; }

  function showMessage(title, text, buttons) {
    page('<section class="card"><h1>' + esc(title) + '</h1><p>' + esc(text) + '</p></section>' +
      (buttons || []).map((b, i) => btn('mb' + i, b.label, b.cls)).join(''));
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
      [{ label: 'Try again', fn: load }]);
  }

  /* ---------- loading the list ---------- */
  function loadThumbCache() { try { state.thumbs = JSON.parse(recall('hf_thumbs') || '{}') || {}; } catch (e) { state.thumbs = {}; } }
  function saveThumbCache() { keep('hf_thumbs', JSON.stringify(state.thumbs)); }

  async function refresh() {
    state.data = await api('listAll');
    state.me = state.data.me;
    state.offline = false;
    keep('hf_cache', JSON.stringify(state.data));
    $('who').textContent = state.me.nick;
  }

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
          if (c && c.me) { state.data = c; state.me = c.me; state.offline = true; $('who').textContent = c.me.nick; return route(); }
        } catch (x) {}
      }
      handleError(e);
    }
  }

  // Fetch small pictures we do not have yet, then fill them in without redrawing the screen.
  async function needThumbs(ids) {
    const miss = Array.from(new Set(ids.filter(i => i && !state.thumbs[i])));
    if (!miss.length || state.offline) return;
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
    if (!pid) return '';
    return '<img class="' + (cls || 'th') + '" data-pid="' + esc(pid) + '" alt="" src="' + (state.thumbs[pid] || BLANK) + '">';
  }

  /* ---------- data helpers ---------- */
  const places = () => (state.data.locations || []).filter(l => !l.archived);
  const boxesAll = () => (state.data.boxes || []).filter(b => !b.archived);
  const findBox = id => (state.data.boxes || []).find(b => b.box_id === id);
  function locLabel(id) {
    const l = (state.data.locations || []).find(x => x.loc_id === id);
    return l ? [l.room, l.shelf, l.row].filter(Boolean).join(' > ') : '';
  }
  const byLabel = (a, b) => locLabel(a.loc_id).localeCompare(locLabel(b.loc_id), undefined, { numeric: true });
  const countAt = id => boxesAll().filter(b => b.loc_id === id).length;

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
    [[1280, 0.7], [1024, 0.6], [800, 0.55], [640, 0.5]].some(p => { b64 = toJpeg(src, p[0], p[1]); return b64.length <= 200000; });
    let th = toJpeg(src, 120, 0.6);
    if (th.length > 45000) th = toJpeg(src, 90, 0.5);
    return { b64: b64, thumb: th, preview: 'data:image/jpeg;base64,' + toJpeg(src, 400, 0.6) };
  }

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
      '<label for="nRoom">Room (for example: Loft, Hall)</label><input id="nRoom" list="dlRoom" maxlength="40" autocomplete="off">' +
      '<label for="nShelf">Shelf or cupboard (optional)</label><input id="nShelf" list="dlShelf" maxlength="40" autocomplete="off">' +
      '<label for="nRow">Row (optional)</label><input id="nRow" list="dlRow" maxlength="40" autocomplete="off">' +
      dl('dlRoom', rooms) + dl('dlShelf', shelves) + dl('dlRow', rows) + '</div>';
  }
  function wirePicker() {
    $('pl').onchange = () => { $('newpl').hidden = $('pl').value !== '__new'; if (!$('newpl').hidden) $('nRoom').focus(); };
  }
  // Gives back the place id to use ('' if none chosen). Makes a new place first if asked.
  async function resolvePlace() {
    const v = $('pl').value;
    if (v !== '__new') return v;
    const f = { room: $('nRoom').value, shelf: $('nShelf').value, row: $('nRow').value };
    if (!norm(f.room)) throw { code: 'INVALID', message: 'Please type the room name for the new place.' };
    const same = (state.data.locations || []).find(l => norm(l.room) === norm(f.room) && norm(l.shelf) === norm(f.shelf) && norm(l.row) === norm(f.row));
    if (same) {
      if (same.archived) await api('setArchived', { kind: 'location', id: same.loc_id, archived: false });
      return same.loc_id;
    }
    const r = await api('saveLocation', Object.assign({ note: '' }, f));
    return r.location.loc_id;
  }

  function errText(e) {
    if (e && e.code === 'NETWORK') return 'NOT saved. There is no internet. Please try again when the internet is back.';
    if (e && e.code === 'AUTH') return 'NOT saved. The sign-in ended. Please tap Save again. If it still fails, press Sign out, sign in, and try again.';
    if (e && e.code === 'BUSY') return 'NOT saved. The app was busy. Please tap Save again.';
    if (e && e.code === 'INVALID') return e.message;
    return 'NOT saved. ' + ((e && e.message) || 'Something went wrong.');
  }
  function showErr(e) { const el = $('err'); el.textContent = errText(e); el.hidden = false; el.scrollIntoView({ block: 'center' }); }
  function busy(id, on_) { const b = $(id); if (!b) return; b.disabled = on_; if (on_) { b.dataset.t = b.textContent; b.textContent = 'Saving…'; } else if (b.dataset.t) b.textContent = b.dataset.t; }

  /* ---------- screens ---------- */
  function showHome() {
    const d = state.data;
    const boxes = boxesAll().length;
    const items = d.items.filter(i => !i.archived).length;
    page('<section class="card"><h1>Hello, ' + esc(state.me.nick) + '</h1>' +
      '<p class="muted">' + boxes + ' boxes and ' + items + ' items saved so far.</p></section>' +
      btn('bSearch', 'Search') + btn('bScan', 'Scan a box', 'tape') + btn('bBoxes', 'All boxes', 'ghost') +
      btn('bNew', 'Add a new box', 'ghost') + btn('bPlaces', 'Places', 'ghost') +
      (state.installEvt ? btn('bInstall', 'Install this app', 'ghost') : '') +
      '<p class="note center" id="soon"></p>');
    on('bSearch', () => { $('soon').textContent = 'Search is being added soon.'; });
    on('bScan', () => { $('soon').textContent = 'The scan button is being added soon.'; });
    on('bBoxes', () => go('#/boxes'));
    on('bNew', () => go('#/newbox'));
    on('bPlaces', () => go('#/places'));
    on('bInstall', () => { state.installEvt.prompt(); state.installEvt = null; });
  }

  function showNewBoxAsk() {
    page('<section class="card"><h1>Add a new box</h1><p>Type the number printed under the QR sticker. For example 4 or B004.</p>' +
      '<input id="num" inputmode="text" maxlength="6" autocomplete="off" placeholder="B004"></section>' +
      '<div id="err" class="err" hidden></div>' + btn('bGo', 'Next') + btn('bBack', 'Back', 'ghost'));
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
    page('<h1>All boxes</h1>' + (list.length ? '<input id="flt" placeholder="Type to filter" autocomplete="off">' : '') +
      '<div id="list"></div>' + (list.length ? '' : '<section class="card"><p>No boxes yet. Tap Add a new box.</p></section>') +
      btn('bNew', 'Add a new box') + btn('bBack', 'Back to start', 'ghost'));
    const draw = () => {
      const q = norm(($('flt') || {}).value);
      $('list').innerHTML = list.filter(b => !q || norm([b.box_id, b.name, b.looks_like, b.owner, locLabel(b.loc_id)].join(' ')).indexOf(q) !== -1).map(b =>
        '<button class="row" data-id="' + esc(b.box_id) + '">' + (b.cover_photo_id ? thumbImg(b.cover_photo_id) : '<span class="th none"></span>') +
        '<span class="rt"><b>' + esc(b.name) + '</b><span class="id">' + esc(b.box_id) + '</span><span class="sub">' + esc(locLabel(b.loc_id) || 'No place yet') + '</span></span></button>').join('');
      $('list').querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/box/' + r.getAttribute('data-id')); });
      fillImgs();
    };
    draw();
    if ($('flt')) $('flt').oninput = draw;
    on('bNew', () => go('#/newbox')); on('bBack', () => go('#/'));
    needThumbs(list.map(b => b.cover_photo_id));
  }

  function showBox(raw) {
    const id = normId(raw);
    const box = id && findBox(id);
    if (!id) return showMessage('Label not recognised', 'This label does not look like one of ours.', [{ label: 'Back to start', cls: 'ghost', fn: () => go('#/') }]);
    if (!box) {
      return showMessage('New box ' + id, 'This label has not been used yet. Set it up?',
        [{ label: 'Yes, set up this box', fn: () => go('#/setup/' + id) }, { label: 'Back to start', cls: 'ghost', fn: () => go('#/') }]);
    }
    const kv = (k, v) => v ? '<div class="kv"><b>' + k + '</b>' + esc(v) + '</div>' : '';
    page('<section class="card"><div class="big-id">' + esc(box.box_id) + '</div><h1>' + esc(box.name) + '</h1>' +
      (box.archived ? '<p class="warn">This box is archived (hidden).</p>' : '') +
      (box.cover_photo_id ? '<button class="photo" id="bPhoto">' + thumbImg(box.cover_photo_id, 'th big') + '<span class="note">Tap the picture to see it bigger</span></button>' : '') +
      kv('Looks like', box.looks_like) + kv('Kept at', locLabel(box.loc_id) || 'No place chosen yet') +
      kv('Whose', box.owner) + kv('Notes', box.notes) + kv('Status', box.status) + '</section>' +
      '<p class="note center">Adding things inside the box comes in the next step.</p>' +
      btn('bMove', 'Move this box', 'tape') + btn('bEdit', 'Change details', 'ghost') + btn('bBack', 'Back to start', 'ghost'));
    on('bMove', () => go('#/move/' + id)); on('bEdit', () => go('#/edit/' + id)); on('bBack', () => go('#/'));
    on('bPhoto', () => openBig(box.cover_photo_id));
    needThumbs([box.cover_photo_id]);
  }

  // Tap the small picture: open the big clear one on top of the screen.
  async function openBig(pid) {
    const old = $('lb'); if (old) old.remove();
    const lb = document.createElement('div'); lb.id = 'lb';
    lb.innerHTML = '<button class="big tape" id="lbClose">Close</button><div id="lbBody"><p class="note">Opening the picture…</p></div>';
    document.body.appendChild(lb);
    $('lbClose').onclick = () => lb.remove();
    const body = $('lbBody');
    if (state.full[pid]) { body.innerHTML = '<img alt="" src="' + state.full[pid] + '">'; return; }
    if (state.offline) { body.innerHTML = '<p class="note">No internet to open the big picture.</p>'; return; }
    try {
      const p = await api('getPhoto', { photo_id: pid });
      state.full[pid] = 'data:' + p.mime + ';base64,' + p.data;
      body.innerHTML = '<img alt="" src="' + state.full[pid] + '">';
    } catch (e) { body.innerHTML = '<p class="note">' + esc(e.code === 'NETWORK' ? 'No internet to open the big picture.' : (e.message || 'Could not open it.')) + '</p>'; }
  }

  function showBoxForm(raw, mode) {
    const id = normId(raw), box = id && findBox(id);
    if (!id) return go('#/');
    if (mode === 'new' && box) return go('#/box/' + id);
    if (mode === 'edit' && !box) return go('#/box/' + id);
    if (state.offline) return showMessage('No internet', 'Boxes cannot be saved without internet.', [{ label: 'Back', cls: 'ghost', fn: () => go('#/') }]);
    const b = box || {};
    const people = state.data.people || [];
    const owners = ['<option value="">Everyone / shared</option>'].concat(people.map(p => '<option' + (p === b.owner ? ' selected' : '') + '>' + esc(p) + '</option>'));
    if (b.owner && people.indexOf(b.owner) === -1) owners.push('<option selected>' + esc(b.owner) + '</option>');
    let photo = null;
    page('<section class="card"><div class="big-id">' + esc(id) + '</div><h1>' + (mode === 'new' ? 'Set up this box' : 'Change details') + '</h1></section>' +
      '<div id="err" class="err" hidden></div><section class="form">' +
      '<label for="fName">Name of the box</label><input id="fName" maxlength="60" autocomplete="off" value="' + esc(b.name || '') + '">' +
      '<p class="hint">A short, easy name that no other box has. For example: Sun, Mango, Blue.</p>' +
      '<label for="fLook">What does the box look like?</label><textarea id="fLook" maxlength="300" rows="3">' + esc(b.looks_like || '') + '</textarea>' +
      '<p class="hint">For example: Brown cardboard box with a red tape.</p>' +
      '<label>Picture of the outside</label><div id="prev">' + (b.cover_photo_id ? thumbImg(b.cover_photo_id, 'th') : '') + '</div>' +
      '<input id="fCam" type="file" accept="image/*" capture="environment" hidden><input id="fPhoto" type="file" accept="image/*" hidden>' +
      btn('bCam', b.cover_photo_id ? 'Take a new picture now' : 'Take a picture now', 'tape') + btn('bPick', 'Choose a picture from the phone', 'ghost') +
      '<label for="fOwner">Whose organiser or box</label><select id="fOwner">' + owners.join('') + '</select>' +
      '<label for="pl">Where is it kept?</label>' + pickerHTML(b.loc_id) +
      '<label for="fNotes">Notes (optional)</label><textarea id="fNotes" maxlength="500" rows="2">' + esc(b.notes || '') + '</textarea></section>' +
      btn('bSave', 'Save') + btn('bCancel', 'Cancel', 'ghost'));
    wirePicker();
    needThumbs([b.cover_photo_id]);
    on('bPick', () => $('fPhoto').click());
    on('bCam', () => $('fCam').click());
    const gotPhoto = async ev => {
      const f = ev.target.files[0]; if (!f) return;
      $('prev').innerHTML = '<p class="note">Preparing picture…</p>';
      try { photo = await shrinkPhoto(f); $('prev').innerHTML = '<img class="cover" alt="" src="' + photo.preview + '">'; }
      catch (e) { photo = null; $('prev').innerHTML = ''; showErr({ code: 'INVALID', message: 'That picture could not be used. Please try another one.' }); }
    };
    $('fPhoto').onchange = gotPhoto; $('fCam').onchange = gotPhoto;
    on('bCancel', () => go('#/box/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      const name = $('fName').value.trim();
      if (!name) return showErr({ code: 'INVALID', message: 'Please give the box a name.' });
      const clash = (state.data.boxes || []).find(x => x.box_id !== id && norm(x.name) === norm(name));
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
        const p = { box_id: id, is_new: mode === 'new', name: name, looks_like: $('fLook').value, owner: $('fOwner').value, notes: $('fNotes').value };
        if (loc) p.loc_id = loc;
        if (photo) { p.cover_b64 = photo.b64; p.cover_thumb_b64 = photo.thumb; }
        await api('saveBox', p);
        await refresh();
        state.flash = 'Saved.';
        go('#/box/' + id);
      } catch (e) { busy('bSave', false); showErr(e); }
    });
  }

  function showMove(raw) {
    const id = normId(raw), box = id && findBox(id);
    if (!box) return go('#/box/' + (id || ''));
    if (state.offline) return showMessage('No internet', 'A box cannot be moved without internet.', [{ label: 'Back', cls: 'ghost', fn: () => go('#/box/' + id) }]);
    page('<section class="card"><div class="big-id">' + esc(id) + '</div><h1>Move ' + esc(box.name) + '</h1>' +
      '<div class="kv"><b>Now kept at</b>' + esc(locLabel(box.loc_id) || 'No place chosen yet') + '</div></section>' +
      '<div id="err" class="err" hidden></div><section class="form"><label for="pl">New place</label>' + pickerHTML('') + '</section>' +
      btn('bSave', 'Move it here') + btn('bCancel', 'Cancel', 'ghost'));
    wirePicker();
    on('bCancel', () => go('#/box/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      if (!$('pl').value) return showErr({ code: 'INVALID', message: 'Please choose the new place.' });
      busy('bSave', true);
      try {
        const loc = await resolvePlace();
        if (loc === box.loc_id) { state.flash = 'It is already there.'; return go('#/box/' + id); }
        await api('saveBox', { box_id: id, name: box.name, loc_id: loc });
        await refresh();
        state.flash = 'Moved. The old place is kept in the history.';
        go('#/box/' + id);
      } catch (e) { busy('bSave', false); showErr(e); }
    });
  }

  function showPlaces() {
    const ps = places().slice().sort(byLabel);
    page('<h1>Places</h1>' + (ps.length ? '' : '<section class="card"><p>No places yet. Tap Add a place.</p></section>') +
      ps.map(l => '<button class="row" data-id="' + esc(l.loc_id) + '"><span class="rt"><b>' + esc(locLabel(l.loc_id)) + '</b><span class="sub">' + countAt(l.loc_id) + ' boxes</span></span></button>').join('') +
      btn('bAdd', 'Add a place') + btn('bBack', 'Back to start', 'ghost'));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/place/' + r.getAttribute('data-id')); });
    on('bAdd', () => go('#/placeform/new')); on('bBack', () => go('#/'));
  }

  function showPlace(id) {
    const l = (state.data.locations || []).find(x => x.loc_id === id);
    if (!l) return go('#/places');
    const here = boxesAll().filter(b => b.loc_id === id).sort((a, b) => a.box_id.localeCompare(b.box_id));
    page('<section class="card"><h1>' + esc(locLabel(id)) + '</h1>' + (l.note ? '<p class="muted">' + esc(l.note) + '</p>' : '') + '</section>' +
      '<h2>Boxes here</h2>' + (here.length ? '' : '<p class="note">No boxes are kept here.</p>') +
      here.map(b => '<button class="row" data-id="' + esc(b.box_id) + '">' + (b.cover_photo_id ? thumbImg(b.cover_photo_id) : '<span class="th none"></span>') +
        '<span class="rt"><b>' + esc(b.name) + '</b><span class="id">' + esc(b.box_id) + '</span></span></button>').join('') +
      btn('bEdit', 'Change this place', 'ghost') + btn('bBack', 'Back to places', 'ghost'));
    view.querySelectorAll('.row').forEach(r => { r.onclick = () => go('#/box/' + r.getAttribute('data-id')); });
    on('bEdit', () => go('#/placeform/' + id)); on('bBack', () => go('#/places'));
    needThumbs(here.map(b => b.cover_photo_id));
  }

  function showPlaceForm(id) {
    const l = id === 'new' ? {} : (state.data.locations || []).find(x => x.loc_id === id);
    if (!l) return go('#/places');
    if (state.offline) return showMessage('No internet', 'Places cannot be saved without internet.', [{ label: 'Back', cls: 'ghost', fn: () => go('#/places') }]);
    const dl = (i, a) => '<datalist id="' + i + '">' + a.map(v => '<option value="' + esc(v) + '">').join('') + '</datalist>';
    page('<section class="card"><h1>' + (id === 'new' ? 'Add a place' : 'Change this place') + '</h1></section><div id="err" class="err" hidden></div><section class="form">' +
      '<label for="pRoom">Room (for example: Loft, Hall)</label><input id="pRoom" list="dlRoom" maxlength="40" autocomplete="off" value="' + esc(l.room || '') + '">' +
      '<label for="pShelf">Shelf or cupboard (optional)</label><input id="pShelf" list="dlShelf" maxlength="40" autocomplete="off" value="' + esc(l.shelf || '') + '">' +
      '<label for="pRow">Row (optional)</label><input id="pRow" maxlength="40" autocomplete="off" value="' + esc(l.row || '') + '">' +
      '<label for="pNote">Note (optional)</label><input id="pNote" maxlength="200" autocomplete="off" value="' + esc(l.note || '') + '">' +
      dl('dlRoom', Array.from(new Set(places().map(x => x.room)))) + dl('dlShelf', Array.from(new Set(places().map(x => x.shelf).filter(Boolean)))) +
      '</section>' + btn('bSave', 'Save') + btn('bCancel', 'Cancel', 'ghost'));
    on('bCancel', () => go(id === 'new' ? '#/places' : '#/place/' + id));
    on('bSave', async () => {
      $('err').hidden = true;
      if (!norm($('pRoom').value)) return showErr({ code: 'INVALID', message: 'Please type the room name.' });
      busy('bSave', true);
      try {
        const p = { room: $('pRoom').value, shelf: $('pShelf').value, row: $('pRow').value, note: $('pNote').value };
        if (id !== 'new') p.loc_id = id;
        const r = await api('saveLocation', p);
        await refresh();
        state.flash = 'Saved.';
        go('#/place/' + r.location.loc_id);
      } catch (e) { busy('bSave', false); showErr(e.code === 'DUPLICATE' ? { code: 'INVALID', message: 'This place is already in the list.' } : e); }
    });
  }

  function route() {
    const lb = $('lb'); if (lb) lb.remove();
    const h = location.hash || '#/';
    const d = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
    let m;
    if ((m = h.match(/^#\/box\/([^/?]+)/i))) return showBox(d(m[1]));
    if ((m = h.match(/^#\/setup\/([^/?]+)/i))) return showBoxForm(d(m[1]), 'new');
    if ((m = h.match(/^#\/edit\/([^/?]+)/i))) return showBoxForm(d(m[1]), 'edit');
    if ((m = h.match(/^#\/move\/([^/?]+)/i))) return showMove(d(m[1]));
    if (/^#\/boxes/i.test(h)) return showBoxes();
    if (/^#\/newbox/i.test(h)) return showNewBoxAsk();
    if ((m = h.match(/^#\/placeform\/([^/?]+)/i))) return showPlaceForm(d(m[1]));
    if ((m = h.match(/^#\/place\/([^/?]+)/i))) return showPlace(d(m[1]));
    if (/^#\/places/i.test(h)) return showPlaces();
    showHome();
  }

  /* ---------- start ---------- */
  function start() {
    const bad = v => !v || String(v).indexOf('PASTE_') === 0;
    if (bad(CFG.SCRIPT_URL) || bad(CFG.CLIENT_ID)) {
      return showMessage('Setup not finished', 'Open config.js, type in the Web app URL and the Client ID, then upload it to GitHub again.');
    }
    loadThumbCache();
    const t = recall('hf_token');
    let exp = 0;
    try { exp = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch (e) {}
    if (t && exp > Date.now() + 120000) { state.token = t; load(); } else showSignIn();
  }

  $('signout').onclick = signOut;
  window.addEventListener('hashchange', () => { if (state.data) route(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.installEvt = e; if (state.data && (location.hash || '#/') === '#/') showHome(); });
  window.addEventListener('appinstalled', () => { state.installEvt = null; });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  start();
})();
