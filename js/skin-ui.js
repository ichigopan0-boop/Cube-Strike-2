/* ==========================================================================
   CUBE STRIKE 2 — skin-ui.js
   お絵かきアトリエ（スキンを作る画面）: からだの 6つの 面に 16×16 の ドット絵・からだの色・もよう・2つめの色・ぼうし。
   ・左（上）に ゲームと同じ絵で まわる プレビュー（べつの CS.Renderer）。えらんだ面が こちらを むく
   ・てんかいず（6面の 小さな 絵）を おすと その面を かく
   ・どうぐ: ペン / けしゴム / ぬりつぶし / スポイト。もどす・左右はんてん・ぜんぶの面に コピー
   「これにする」で CS.Settings.skin に保存（いつもの見た目なら null）。へやの中なら みんなに伝える。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);
  let U = null;
  let cur = null;               // 作っているスキン {c, c2, raw, h, p}
  let face = 0;                 // かいている面
  let paintKey = '2';           // ぬる色
  let tool = 'pen';             // pen / erase / fill / pick
  let painting = false;
  let hist = [];
  let r = null, raf = 0, drag = null, team = 0, lastT = 0;
  let yaw = 0, tilt = 0, yawT = 0, tiltT = 0, auto = true;

  const S = () => CS.Skins;
  const N = () => S().N;
  const AREA = () => N() * N();
  const TOOLS = [['pen', 'ペン'], ['erase', 'けしゴム'], ['fill', 'ぬりつぶし'], ['pick', 'スポイト']];
  /* てんかいず の ばしょ [列, 行]（まえ・うしろ・ひだり・みぎ・うえ・した） */
  const NET_POS = [[1, 1], [3, 1], [0, 1], [2, 1], [1, 0], [1, 2]];
  /* 面ごとの プレビューの むき（yaw: ブロックを y で まわす / tilt: x で かたむける） */
  const FACE_VIEW = [[0, 0], [Math.PI, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0], [0, -Math.PI / 2], [0, Math.PI / 2]];

  function load() {
    const s = S().clean(CS.Settings.skin) || S().clean(S().blank());
    cur = { c: s.c, c2: s.c2, raw: S().unpack(s.d) || S().DEFAULT_RAW, h: s.h, p: s.p };
    hist = [];
  }
  function toSkin() { return S().clean({ c: cur.c, c2: cur.c2, d: S().pack(cur.raw), h: cur.h, p: cur.p }); }
  function snap() { hist.push(cur.raw); if (hist.length > 40) hist.shift(); }
  function setFace(f) {
    face = f;
    yawT = FACE_VIEW[f][0]; tiltT = FACE_VIEW[f][1]; auto = true;
  }
  const faceStr = (f) => cur.raw.slice(f * AREA(), (f + 1) * AREA());
  function putFace(f, str) { cur.raw = cur.raw.slice(0, f * AREA()) + str + cur.raw.slice((f + 1) * AREA()); }

  /* ---------------- プレビュー ---------------- */
  function startPreview() {
    const cv = $('skCanvas');
    if (!cv) return;
    if (!r) {
      try { r = new CS.Renderer(cv); } catch (e) { r = null; }
      if (!r || !r.ok) { r = null; return; }
      r.setWorld(null);
      /* ドラッグで まわす */
      cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, a: yaw, t: tilt }; auto = false; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
      cv.addEventListener('pointermove', function (e) {
        if (!drag) return;
        yaw = drag.a + (e.clientX - drag.x) * 0.012;
        tilt = Math.max(-1.57, Math.min(1.57, drag.t + (e.clientY - drag.y) * 0.01));
      });
      const up = function () { drag = null; };
      cv.addEventListener('pointerup', up);
      cv.addEventListener('pointercancel', up);
    }
    lastT = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stopPreview() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    drawPreview(dt);
  }
  function drawPreview(dt) {
    if (!r || !r.ok) return;
    if (auto && dt) {
      const k = Math.min(1, dt * 6);
      yaw += CS.wrapAngle(yawT - yaw) * k; tilt += (tiltT - tilt) * k;
    }
    const wob = Math.sin(performance.now() / 900) * 0.12;
    r.begin({ pos: [0, 0.42, 2.9], yaw: 0, pitch: -0.13, fov: 36, shake: 0 });
    r.cube([0, -1.0, 0], null, 1.0, [0.16, 0.2, 0.36], { emissive: 0.05 });
    r.particle([0, -0.46, 0], 2.2, CS.TEAM_COLORS[team], 0.22);
    const a = Math.PI + yaw + (auto ? wob : 0);
    const q = CS.Q.normalize(CS.Q.mul(CS.Q.fromAxisAngle([0, 1, 0], a), CS.Q.fromAxisAngle([1, 0, 0], tilt)));
    const sk = toSkin();
    r.player({
      pos: [0, 0.1, 0], quat: q, yaw: Math.PI + yaw, pitch: 0, team: team, gun: false,
      flash: 0, protect: false, hit: 0, alpha: 1, spin: 0, charge: 0, side: 0, slide: 0, skin: S().isPlain(sk) ? null : sk
    });
    r.end();
  }

  /* ---------------- 部品 ---------------- */
  function swatches(el, colors, get, set, withTeam) {
    const mk = U.util.mk;
    U.util.clear(el);
    if (withTeam) {
      const b = mk('button', 'sw team' + (!get() ? ' sel' : ''), 'チーム');
      b.type = 'button';
      b.addEventListener('click', function () { U.util.sfx('click'); set(''); refresh(); });
      el.appendChild(b);
    }
    for (const c of colors) {
      const b = mk('button', 'sw' + (get() === c ? ' sel' : ''));
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', function () { U.util.sfx('click'); set(c); refresh(); });
      el.appendChild(b);
    }
    /* じぶんで色をえらぶ */
    const lab = mk('label', 'sw pickc');
    lab.textContent = '＋';
    const inp = D.createElement('input');
    inp.type = 'color';
    inp.value = get() || '#ff4d5e';
    inp.addEventListener('input', function () { set(inp.value.toLowerCase()); refresh(true); });
    inp.addEventListener('change', function () { set(inp.value.toLowerCase()); refresh(); });
    lab.appendChild(inp);
    el.appendChild(lab);
  }

  function pixColor(k) {
    const p = S().PIX[k];
    if (!p) return 'transparent';
    if (k === '8') return (CS.TEAM_CSS && CS.TEAM_CSS[team]) || '#fff';
    return 'rgb(' + Math.round(p[0] * 255) + ',' + Math.round(p[1] * 255) + ',' + Math.round(p[2] * 255) + ')';
  }
  function bodyCss() { return cur.c || ((CS.TEAM_CSS && CS.TEAM_CSS[team]) || '#ff4d5e'); }

  /* 面の 小さな絵（size×size px） */
  function faceCanvas(str, n, size) {
    const cv = D.createElement('canvas');
    cv.width = n; cv.height = n;
    if (size) { cv.style.width = size + 'px'; cv.style.height = size + 'px'; }
    drawFace(cv, str, n);
    return cv;
  }
  function drawFace(cv, str, n) {
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bodyCss();
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < n * n; i++) {
      const k = str[i];
      if (k === '0') continue;
      ctx.fillStyle = pixColor(k);
      ctx.fillRect(i % n, (i / n) | 0, 1, 1);
    }
  }

  function buildFaces() {
    const el = $('skFaces'), mk = U.util.mk;
    U.util.clear(el);
    const front = faceStr(0);
    for (const f of S().FACES) {
      const b = mk('button', 'face' + (front === f.big ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(faceCanvas(f.f, 8, 34));
      b.appendChild(mk('small', null, f.name));
      b.addEventListener('click', function () { U.util.sfx('click'); snap(); putFace(0, f.big); setFace(0); refresh(); });
      el.appendChild(b);
    }
  }

  function buildTabs() {
    const el = $('skFaceTabs'), mk = U.util.mk;
    U.util.clear(el);
    S().FACE_NAMES.forEach(function (nm, i) {
      const b = mk('button', 'btn ghost sm' + (face === i ? ' sel' : ''), nm);
      b.type = 'button';
      b.addEventListener('click', function () { U.util.sfx('click'); setFace(i); refresh(); });
      el.appendChild(b);
    });
  }

  function buildNet() {
    const el = $('skNet');
    if (!el) return;
    U.util.clear(el);
    for (let f = 0; f < 6; f++) {
      const b = D.createElement('button');
      b.type = 'button';
      b.className = face === f ? 'sel' : '';
      b.title = S().FACE_NAMES[f];
      b.style.gridColumn = String(NET_POS[f][0] + 1);
      b.style.gridRow = String(NET_POS[f][1] + 1);
      b.appendChild(faceCanvas(faceStr(f), N(), 0));
      b.addEventListener('click', function () { U.util.sfx('click'); setFace(f); refresh(); });
      el.appendChild(b);
    }
  }

  function buildGrid() {
    const el = $('skGrid');
    U.util.clear(el);
    el.style.setProperty('--body', bodyCss());
    const str = faceStr(face);
    for (let i = 0; i < AREA(); i++) {
      const c = D.createElement('i');
      c.setAttribute('data-i', String(i));
      const k = str[i];
      if (k !== '0') c.style.background = pixColor(k);
      el.appendChild(c);
    }
  }

  /* 1マス ぬる（なぞっても ぬれる）。画面は そのマスだけ かえる */
  function paintAt(el) {
    const i = el && el.getAttribute ? el.getAttribute('data-i') : null;
    if (i === null) return;
    const n = i | 0, at = face * AREA() + n;
    if (tool === 'pick') {
      const k = cur.raw[at];
      if (k !== '0') { paintKey = k; tool = 'pen'; buildPix(); buildTools(); }
      return;
    }
    if (tool === 'fill') { fill(n); return; }
    const k = tool === 'erase' ? '0' : paintKey;
    if (cur.raw[at] === k) return;
    cur.raw = cur.raw.slice(0, at) + k + cur.raw.slice(at + 1);
    el.style.background = k === '0' ? '' : pixColor(k);
    lightRefresh();
  }
  /* ぬりつぶし（おなじ色で つながっている ところ） */
  function fill(n) {
    const str = faceStr(face).split(''), from = str[n], to = paintKey;
    if (from === to) return;
    const NN = N(), st = [n], seen = new Uint8Array(AREA());
    while (st.length) {
      const i = st.pop();
      if (seen[i] || str[i] !== from) continue;
      seen[i] = 1; str[i] = to;
      const x = i % NN, y = (i / NN) | 0;
      if (x > 0) st.push(i - 1); if (x < NN - 1) st.push(i + 1);
      if (y > 0) st.push(i - NN); if (y < NN - 1) st.push(i + NN);
    }
    putFace(face, str.join(''));
    refresh();
  }
  let lightT = 0;
  function lightRefresh() {
    /* なぞっている あいだは てんかいずを ときどき だけ かきなおす */
    const now = performance.now();
    if (now - lightT < 120) return;
    lightT = now;
    buildNet();
  }

  function buildPix() {
    const el = $('skPix'), mk = U.util.mk;
    U.util.clear(el);
    for (const k of S().PIX_KEYS) {
      const b = mk('button', 'px' + (paintKey === k && tool !== 'erase' ? ' sel' : ''), k === '8' ? 'T' : '');
      b.type = 'button';
      b.style.background = pixColor(k);
      b.title = S().PIX[k][4];
      b.addEventListener('click', function () { U.util.sfx('click'); paintKey = k; if (tool === 'erase' || tool === 'pick') tool = 'pen'; buildPix(); buildTools(); });
      el.appendChild(b);
    }
  }
  function buildTools() {
    const el = $('skToolBtns'), mk = U.util.mk;
    U.util.clear(el);
    for (const t of TOOLS) {
      const b = mk('button', 'btn ghost sm' + (tool === t[0] ? ' sel' : ''), t[1]);
      b.type = 'button';
      b.addEventListener('click', function () { U.util.sfx('click'); tool = t[0]; buildTools(); buildPix(); });
      el.appendChild(b);
    }
  }

  function chips(el, ids, table, get, set) {
    const mk = U.util.mk;
    U.util.clear(el);
    for (const id of ids) {
      const b = mk('button', 'btn ghost sm' + (get() === id ? ' sel' : ''), table[id].name);
      b.type = 'button';
      b.addEventListener('click', function () { U.util.sfx('click'); set(id); refresh(); });
      el.appendChild(b);
    }
  }

  /* light = 色をえらんでいる最中（色の入力欄を作りなおすと えらぶ画面が閉じるので、スウォッチは そのまま） */
  function refresh(light) {
    const Sk = S();
    if (!light) {
      swatches($('skColors'), Sk.COLORS, () => cur.c, (v) => { cur.c = v; }, true);
      swatches($('skColors2'), Sk.COLORS, () => cur.c2, (v) => { cur.c2 = v || '#ffffff'; }, false);
      buildPix();
      buildTools();
      chips($('skPats'), Sk.PATTERN_IDS, Sk.PATTERNS, () => cur.p, (v) => { cur.p = v; });
      chips($('skHats'), Sk.HAT_IDS, Sk.HATS, () => cur.h, (v) => { cur.h = v; });
    }
    buildTabs();
    buildFaces();
    buildGrid();
    buildNet();
    const tb = D.querySelectorAll('[data-skteam]');
    for (let i = 0; i < tb.length; i++) tb[i].classList.toggle('sel', (tb[i].getAttribute('data-skteam') | 0) === team);
    drawPreview(0);
  }

  function init() {
    U = CS.UI;
    if (!CS.Skins) { const b = $('btnSkin'); if (b) b.style.display = 'none'; return; }
    const tap = U.util.tap;
    U.addScreen('scSkin', function () { load(); setFace(face); yaw = yawT; tilt = tiltT; refresh(); startPreview(); }, stopPreview);
    tap('btnSkin', function () { U.open('scSkin', 'scTitle'); }, 'ok');
    tap('btnLobbySkin', function () { U.open('scSkin', 'scLobby'); });
    tap('btnSkBack', function () { U.back('scSkin'); }, 'back');
    tap('btnSkRandom', function () { snap(); const s = S().random(Math.random); cur = { c: s.c, c2: s.c2, raw: S().unpack(s.d), h: s.h, p: s.p }; refresh(); });
    tap('btnSkReset', function () { snap(); const s = S().clean(S().blank()); cur = { c: s.c, c2: s.c2, raw: S().unpack(s.d), h: s.h, p: s.p }; refresh(); }, 'back');
    tap('skUndo', function () { if (!hist.length) { U.toast('もどせるものが ないよ'); return; } cur.raw = hist.pop(); refresh(); }, 'back');
    tap('skMirror', function () {
      snap();
      const NN = N(), str = faceStr(face);
      let out = '';
      for (let y = 0; y < NN; y++) for (let x = 0; x < NN; x++) out += str[y * NN + (NN - 1 - x)];
      putFace(face, out); refresh();
    });
    tap('skCopyAll', function () { snap(); const str = faceStr(face); for (let f = 0; f < 6; f++) putFace(f, str); refresh(); U.toast('ぜんぶの面に コピーしたよ'); });
    tap('skClearFace', function () { snap(); putFace(face, S().EMPTY_FACE); refresh(); }, 'back');
    tap('skClearAll', function () { snap(); for (let f = 0; f < 6; f++) putFace(f, S().EMPTY_FACE); refresh(); }, 'back');
    tap('btnSkOk', function () {
      const s = toSkin();
      CS.Settings.skin = s && !S().isPlain(s) ? s : null;
      if (CS.saveSettings) CS.saveSettings();
      U.util.call('look');
      U.toast('スキンを ほぞんしました');
      U.back('scSkin');
    }, 'ok');
    const tb = D.querySelectorAll('[data-skteam]');
    for (let i = 0; i < tb.length; i++) {
      tb[i].addEventListener('click', function () { U.util.sfx('click'); team = this.getAttribute('data-skteam') | 0; refresh(); });
    }
    /* ドットをぬる（なぞっても ぬれる） */
    const grid = $('skGrid');
    if (grid) {
      grid.addEventListener('pointerdown', function (e) {
        painting = true;
        snap();
        try { grid.setPointerCapture(e.pointerId); } catch (er) {}
        paintAt(e.target);
        e.preventDefault();
      });
      grid.addEventListener('pointermove', function (e) {
        if (!painting || tool === 'fill' || tool === 'pick') return;
        const el = D.elementFromPoint(e.clientX, e.clientY);
        if (el && el.parentNode === grid) paintAt(el);
      });
      const end = function () { if (painting) { painting = false; buildNet(); buildFaces(); } };
      grid.addEventListener('pointerup', end);
      grid.addEventListener('pointercancel', end);
    }
  }

  CS.UI.addInit(init);
})();
