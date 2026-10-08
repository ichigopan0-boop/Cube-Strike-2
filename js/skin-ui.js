/* ==========================================================================
   CUBE STRIKE — skin-ui.js
   スキンを作る画面（v3）: じぶんのブロックの からだの色・かお（プリセット＋8×8 のドットで じぶんでかく）・
   もよう・2つめの色・ぼうし。右（上）に ゲームと同じ絵で くるくる回るプレビュー（べつの CS.Renderer）。
   「これにする」で CS.Settings.skin に保存（いつもの見た目なら null）。へやの中なら みんなに伝える。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);
  let U = null;
  let cur = null;               // 作っているスキン
  let paintKey = '1';           // ぬる色（'0' = けしゴム）
  let painting = false;
  let r = null, raf = 0, spin = 0, spinV = 0.7, drag = null, team = 0, lastT = 0;

  const S = () => CS.Skins;

  function load() {
    cur = S().clean(CS.Settings.skin) || S().blank();
  }

  /* ---------------- プレビュー ---------------- */
  function startPreview() {
    const cv = $('skCanvas');
    if (!cv) return;
    if (!r) {
      try { r = new CS.Renderer(cv); } catch (e) { r = null; }
      if (!r || !r.ok) { r = null; return; }
      r.setWorld(null);
      /* ドラッグで まわす */
      cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, s: spin }; spinV = 0; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
      cv.addEventListener('pointermove', function (e) { if (drag) spin = drag.s + (e.clientX - drag.x) * 0.012; });
      const up = function () { if (drag) { drag = null; spinV = 0.7; } };
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
    spin += spinV * (dt || 0);
    r.begin({ pos: [0, 0.42, 2.9], yaw: 0, pitch: -0.13, fov: 36, shake: 0 });
    r.cube([0, -1.0, 0], null, 1.0, [0.16, 0.2, 0.36], { emissive: 0.05 });
    r.particle([0, -0.46, 0], 2.2, CS.TEAM_COLORS[team], 0.22);
    const a = Math.PI + spin;
    const q = CS.Q.fromAxisAngle([0, 1, 0], a);
    r.player({
      pos: [0, 0.002, 0], quat: q, yaw: a, pitch: 0, team: team, gun: CS.Weapons.gun(CS.Settings.gun),
      flash: 0, protect: false, hit: 0, alpha: 1, spin: 0, charge: 0, side: 0, slide: 0, skin: S().isPlain(cur) ? null : cur
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

  /* かおの小さな絵 */
  function faceCanvas(f, size) {
    const cv = D.createElement('canvas');
    cv.width = 8; cv.height = 8;
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const ctx = cv.getContext('2d');
    ctx.fillStyle = bodyCss();
    ctx.fillRect(0, 0, 8, 8);
    for (let i = 0; i < 64; i++) {
      const k = f[i];
      if (k === '0') continue;
      ctx.fillStyle = pixColor(k);
      ctx.fillRect(i % 8, (i / 8) | 0, 1, 1);
    }
    return cv;
  }

  function buildFaces() {
    const el = $('skFaces'), mk = U.util.mk;
    U.util.clear(el);
    for (const f of S().FACES) {
      const b = mk('button', 'face' + (cur.f === f.f ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(faceCanvas(f.f, 34));
      b.appendChild(mk('small', null, f.name));
      b.addEventListener('click', function () { U.util.sfx('click'); cur.f = f.f; refresh(); });
      el.appendChild(b);
    }
  }

  function buildGrid() {
    const el = $('skGrid');
    U.util.clear(el);
    el.style.setProperty('--body', bodyCss());
    for (let i = 0; i < 64; i++) {
      const c = D.createElement('i');
      c.setAttribute('data-i', String(i));
      const k = cur.f[i];
      if (k !== '0') c.style.background = pixColor(k);
      el.appendChild(c);
    }
  }
  function paintAt(el) {
    const i = el && el.getAttribute ? el.getAttribute('data-i') : null;
    if (i === null) return;
    const n = i | 0;
    if (cur.f[n] === paintKey) return;
    cur.f = cur.f.slice(0, n) + paintKey + cur.f.slice(n + 1);
    el.style.background = paintKey === '0' ? '' : pixColor(paintKey);
    markFaces();
  }
  function markFaces() {
    const el = $('skFaces');
    const kids = el ? el.children : [];
    const F = S().FACES;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('sel', F[i] && F[i].f === cur.f);
  }

  function buildPix() {
    const el = $('skPix'), mk = U.util.mk;
    U.util.clear(el);
    const keys = S().PIX_KEYS.concat(['0']);
    for (const k of keys) {
      const b = mk('button', 'px' + (paintKey === k ? ' sel' : ''), k === '0' ? '⌫' : k === '8' ? 'T' : '');
      b.type = 'button';
      if (k !== '0') b.style.background = pixColor(k);
      b.title = k === '0' ? 'けす' : S().PIX[k][4];
      b.addEventListener('click', function () { U.util.sfx('click'); paintKey = k; buildPix(); });
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
      chips($('skPats'), Sk.PATTERN_IDS, Sk.PATTERNS, () => cur.p, (v) => { cur.p = v; });
      chips($('skHats'), Sk.HAT_IDS, Sk.HATS, () => cur.h, (v) => { cur.h = v; });
    }
    buildFaces();
    buildGrid();
    const tb = D.querySelectorAll('[data-skteam]');
    for (let i = 0; i < tb.length; i++) tb[i].classList.toggle('sel', (tb[i].getAttribute('data-skteam') | 0) === team);
    drawPreview(0);
  }

  function init() {
    U = CS.UI;
    if (!CS.Skins) { const b = $('btnSkin'); if (b) b.style.display = 'none'; return; }
    const tap = U.util.tap;
    U.addScreen('scSkin', function () { load(); refresh(); startPreview(); }, stopPreview);
    tap('btnSkin', function () { U.open('scSkin', 'scTitle'); }, 'ok');
    tap('btnLobbySkin', function () { U.open('scSkin', 'scLobby'); });
    tap('btnSkBack', function () { U.back('scSkin'); }, 'back');
    tap('btnSkRandom', function () { cur = S().random(Math.random); refresh(); });
    tap('btnSkReset', function () { cur = S().blank(); refresh(); }, 'back');
    tap('btnSkOk', function () {
      const s = S().clean(cur);
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
        try { grid.setPointerCapture(e.pointerId); } catch (er) {}
        paintAt(e.target);
        e.preventDefault();
      });
      grid.addEventListener('pointermove', function (e) {
        if (!painting) return;
        const el = D.elementFromPoint(e.clientX, e.clientY);
        if (el && el.parentNode === grid) paintAt(el);
      });
      const end = function () { painting = false; };
      grid.addEventListener('pointerup', end);
      grid.addEventListener('pointercancel', end);
    }
  }

  CS.UI.addInit(init);
})();
