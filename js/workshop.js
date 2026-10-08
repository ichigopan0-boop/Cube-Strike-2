/* ==========================================================================
   CUBE STRIKE 2 — workshop.js
   武器こうぼう: ぶきをえらぶ画面（scLoadout）に「部品」と「組み合わせ」の らんを たす。
   ・部品: いま えらんでいる わく（メイン / サブ）の 銃に 部品を つける・はずす。
     ふつうの 部品は かさねられる・とくしゅ部品は 1こまで・ぜんぶで 30こまで（parts.js）
     つけると どう かわるか（ダメージ・連射・リロード…）を くらべて 出す。銃は 3Dで くるくる まわる
   ・組み合わせ: 銃 2つ ＋ 部品 ＋ ボム を 10こまで なまえを つけて ほぞん・よびだし（CS.Settings.loadouts）
   えらんでいる ものは ui.js の CS.UI.loadoutSel（gun / gun2 / gm / gm2 / bomb / slot）
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);
  const MAX_PRESETS = 10;
  let U = null, built = false;
  let r = null, raf = 0, spin = 0.6, spinV = 0.6, drag = null, lastT = 0, pitch = 0.18;
  let confirmI = -1, confirmT = 0;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const sel = () => CS.UI.loadoutSel;
  const P = () => CS.Parts;
  const gunDef = (id) => (CS.GunMap && CS.GunMap[id]) || null;

  /* いま 部品を つけている わく: {id, mods, key} */
  function cur() {
    const s = sel();
    if (s.slot === 1) return { id: s.gun2, mods: s.gm2 || '', key: 'gm2', slot: 1 };
    return { id: s.gun, mods: s.gm || '', key: 'gm', slot: 0 };
  }
  function setMods(m) {
    const c = cur(), s = sel();
    s[c.key] = P().clean(m, gunDef(c.id));
    CS.UI.refreshLoadout();
  }

  /* ---------------- CSS ---------------- */
  const CSS = [
    '#partsSec h3 span,#presetSec h3 span{font-size:11px;font-weight:500;color:#9fb4d4;letter-spacing:.04em;margin-left:8px}',
    '.wsTop{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:10px;width:100%}',
    '@media (max-width:760px){.wsTop{grid-template-columns:1fr}}',
    '#wsCanvas{width:100%;height:190px;display:block;border-radius:12px;background:radial-gradient(circle at 50% 40%,#16204a,#060a18);touch-action:none;cursor:grab}',
    '.wsHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
    '.wsHead b{font-size:15px;letter-spacing:.04em}.wsHead .cnt{margin-left:auto;font-size:13px;font-weight:800;padding:3px 10px;border-radius:10px;background:rgba(127,214,255,.15);border:1px solid rgba(127,214,255,.35)}',
    '.wsHead .cnt.full{background:rgba(255,94,168,.2);border-color:rgba(255,94,168,.5)}',
    '.wsBar{height:8px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;margin:4px 0 8px}',
    '.wsBar i{display:block;height:100%;background:linear-gradient(90deg,#7fd6ff,#ff5ea8);transition:width .2s}',
    '.wsStats{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:3px 8px;font-size:12px;align-items:center}',
    '.wsStats .k{color:#9fb4d4}.wsStats .v{font-weight:700;color:#eaf4ff;white-space:nowrap}',
    '.wsStats .v .up{color:#7dffb0}.wsStats .v .dn{color:#ff8fa8}',
    '.wsBody{font-size:11.5px;color:#cfe0f7;margin-top:6px;line-height:1.5}',
    '.wsBody .bad{color:#ff9fb4}',
    '.wsBtns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.wsBtns .btn{min-height:34px;padding:5px 12px;font-size:12px}',
    '.wsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:6px;width:100%;margin-top:8px}',
    '.wsCat{grid-column:1/-1;font-size:12.5px;font-weight:800;letter-spacing:.06em;color:#ffd28a;margin-top:6px}',
    '.wsCat small{font-weight:500;color:#9fb4d4;margin-left:6px}',
    '.wsP{display:flex;align-items:center;gap:7px;padding:6px 7px;border-radius:11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);text-align:left}',
    '.wsP.on{border-color:rgba(127,214,255,.6);background:rgba(70,140,255,.14)}',
    '.wsP.sp{background:rgba(255,94,168,.05)}.wsP.sp.on{border-color:rgba(255,120,190,.7);background:rgba(255,94,168,.16)}',
    '.wsP.no{opacity:.38}',
    '.wsP .ic{flex:0 0 30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:#06101e}',
    '.wsP .tx{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.wsP .tx b{font-size:12.5px}.wsP .tx small{font-size:10px;color:#9fe8b8;line-height:1.3}.wsP .tx small.c{color:#ffa3b8}',
    '.wsP .ct{display:flex;align-items:center;gap:3px}',
    '.wsP .ct button{width:28px;height:28px;border-radius:8px;border:1px solid rgba(127,214,255,.4);background:rgba(10,20,50,.7);color:#eaf4ff;font-size:16px;font-weight:900;cursor:pointer;font-family:inherit;padding:0}',
    '.wsP .ct button:disabled{opacity:.3;cursor:default}',
    '.wsP .ct span{min-width:22px;text-align:center;font-weight:900;font-size:13px}',
    '.psGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;width:100%}',
    '.psCard{display:flex;flex-direction:column;gap:5px;padding:9px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14)}',
    '.psCard.empty{opacity:.75;border-style:dashed}',
    '.psCard .nm{display:flex;gap:6px;align-items:center}.psCard .nm i{font-style:normal;font-weight:900;color:#7fd6ff;font-size:13px}',
    '.psCard input{flex:1;min-width:0;padding:5px 8px;border-radius:8px;border:1px solid rgba(127,214,255,.3);background:rgba(0,0,0,.25);color:#fff;font-family:inherit;font-size:13px}',
    '.psCard .sm{font-size:11.5px;color:#cfe0f7;line-height:1.45;min-height:34px}',
    '.psCard .rw{display:flex;gap:6px}.psCard .rw .btn{flex:1;min-height:32px;padding:4px 8px;font-size:12px}'
  ].join('\n');

  /* ---------------- 部品の らん ---------------- */
  function buildDom() {
    if (built) return;
    built = true;
    const st = D.createElement('style');
    st.textContent = CSS;
    D.head.appendChild(st);
    const ps = $('partsSec');
    ps.innerHTML =
      '<h3>部品<span>銃を 強くできる。でも 1こ つけるごとに リロードが +30%</span></h3>' +
      '<div class="wsTop">' +
      '  <div><canvas id="wsCanvas"></canvas><div class="wsBtns"><button id="wsClear" class="btn ghost" type="button">ぜんぶ はずす</button>' +
      '  <button id="wsRand" class="btn ghost" type="button">おまかせで つける</button><button id="wsTry" class="btn ghost" type="button">ためし撃ち</button></div></div>' +
      '  <div><div class="wsHead"><b id="wsGun">-</b><span id="wsCnt" class="cnt">0 / 30</span></div>' +
      '  <div class="wsBar"><i id="wsBarI"></i></div><div id="wsStats" class="wsStats"></div><div id="wsBody" class="wsBody"></div></div>' +
      '</div>' +
      '<div id="wsGrid" class="wsGrid"></div>';
    const pr = $('presetSec');
    pr.innerHTML = '<h3>組み合わせ<span>銃2つ＋部品＋ボムを ' + MAX_PRESETS + 'こまで ほぞんできる</span></h3><div id="psGrid" class="psGrid"></div>';

    U.util.tap('wsClear', function () { setMods(''); });
    U.util.tap('wsRand', function () { randomMods(); });
    U.util.tap('wsTry', function () { tryNow(); }, 'ok');

    /* 3D プレビュー: ドラッグで まわす */
    const cv = $('wsCanvas');
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, s: spin, p: pitch }; spinV = 0; try { cv.setPointerCapture(e.pointerId); } catch (er) {} });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      spin = drag.s + (e.clientX - drag.x) * 0.012;
      pitch = Math.max(-0.8, Math.min(0.8, drag.p + (e.clientY - drag.y) * 0.008));
    });
    const up = function () { if (drag) { drag = null; spinV = 0.6; } };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  function partsGrid(def, mods) {
    const grid = $('wsGrid');
    const o = P().parse(mods), total = P().total(mods), max = P().MAX_TOTAL;
    grid.innerHTML = '';
    const cats = [[false, 'ふつうの 部品', 'いくつでも かさねられる'], [true, 'とくしゅ部品', '1こまで。つよいけど なにかが よわくなる']];
    for (const c of cats) {
      const h = D.createElement('div');
      h.className = 'wsCat';
      h.innerHTML = esc(c[1]) + '<small>' + esc(c[2]) + '</small>';
      grid.appendChild(h);
      for (const p of P().LIST) {
        if (p.s !== c[0]) continue;
        const n = o[p.id] | 0, ok = !!def && p.ok(def);
        const el = D.createElement('div');
        el.className = 'wsP' + (p.s ? ' sp' : '') + (n > 0 ? ' on' : '') + (ok ? '' : ' no');
        const col = 'rgb(' + p.col.map((x) => Math.round(Math.min(1, x) * 255)).join(',') + ')';
        el.innerHTML = '<span class="ic" style="background:' + col + '">' + esc(p.icon || '') + '</span>' +
          '<span class="tx"><b>' + esc(p.name) + '</b><small>' + esc(p.pros || '') + '</small>' + (p.cons ? '<small class="c">' + esc(p.cons) + '</small>' : '') +
          (ok ? '' : '<small class="c">この銃には つけられない</small>') + '</span>' +
          '<span class="ct"><button type="button" data-a="-" aria-label="へらす">−</button><span>' + n + '</span><button type="button" data-a="+" aria-label="ふやす">＋</button></span>';
        const bm = el.querySelector('[data-a="-"]'), bp = el.querySelector('[data-a="+"]');
        bm.disabled = n <= 0;
        bp.disabled = !ok || total >= max || (p.s && n >= 1);
        bm.addEventListener('click', function () { U.util.sfx('back'); const q = P().parse(cur().mods); q[p.id] = Math.max(0, (q[p.id] | 0) - 1); setMods(P().stringify(q)); });
        bp.addEventListener('click', function () {
          const q = P().parse(cur().mods);
          if (P().total(cur().mods) >= max) { CS.UI.toast('部品は ' + max + 'こ まで'); return; }
          U.util.sfx('click');
          q[p.id] = (q[p.id] | 0) + 1;
          setMods(P().stringify(q));
        });
        grid.appendChild(el);
      }
    }
  }

  /* くらべる（もとの 銃 → 部品つき）。lowGood = 小さいほうが よい */
  function row(k, a, b, fmt, lowGood) {
    const f = fmt || ((x) => String(Math.round(x)));
    let cls = '';
    if (Math.abs(b - a) > 1e-6 * Math.max(1, Math.abs(a))) cls = (b > a) !== !!lowGood ? 'up' : 'dn';
    return '<span class="k">' + esc(k) + '</span><span class="v">' + esc(f(a)) + (cls ? ' → <span class="' + cls + '">' + esc(f(b)) + '</span>' : '') + '</span>';
  }

  function stats(base, g) {
    const s = sel();
    const dmgTxt = (d) => { const v = Math.round(d.dmg * 10) / 10; return (d.pellets | 0) > 1 ? v + '×' + d.pellets : String(v); };
    const out = [];
    out.push('<span class="k">ダメージ</span><span class="v">' + esc(dmgTxt(base)) + (g !== base && (g.dmg !== base.dmg || g.pellets !== base.pellets) ? ' → <span class="' +
      (g.dmg * g.pellets >= base.dmg * base.pellets ? 'up' : 'dn') + '">' + esc(dmgTxt(g)) + '</span>' : '') + '</span>');
    out.push(row('連射/分', base.rpm, g.rpm));
    out.push(row('弾の数', base.mag, g.mag));
    out.push(row('リロード', base.reload, g.reload, (x) => x.toFixed(1) + '秒', true));
    out.push(row('しゃてい', base.range || 0, g.range || 0, (x) => Math.round(x) + 'm'));
    if (base.proj) out.push(row('弾の速さ', base.proj.speed, g.proj.speed, (x) => Math.round(x) + 'm/秒'));
    out.push(row('走る速さ', base.move || 1, g.move || 1, (x) => '×' + x.toFixed(2)));
    out.push(row('ひろがり', base.spread || 0, g.spread || 0, (x) => x.toFixed(1) + '°', true));
    /* からだに つく こうか（銃 2つ ぶん） */
    const g1 = CS.gunWith ? CS.gunWith(s.gun, s.gm) : null, g2 = s.gun2 && CS.gunWith ? CS.gunWith(s.gun2, s.gm2) : null;
    const pm = P().playerMods(g2 ? [g1, g2] : [g1]);
    const hp0 = (CS.RULES && CS.RULES.hp) || 200;
    const hp = Math.round((hp0 + pm.hpAdd) * pm.hpMul);
    out.push(row('体力', hp0, hp));
    return { html: out.join(''), pm: pm };
  }

  function bodyText(g, pm) {
    const L = [];
    const pr = g.proj;
    if (pr) {
      if (pr.homing > 0) L.push('弾が てきを おいかける');
      if (pr.wallPierce > 0) L.push('かべを ' + pr.wallPierce + 'まい すりぬける');
      if (pr.bounce > 0) L.push('かべで ' + pr.bounce + '回 はねる');
      if (pr.pierce) L.push('てきを つらぬく');
      if (pr.radius > 0 && pr.splashDmg > 0) L.push('ばくはつ（はんい ' + pr.radius.toFixed(1) + 'm）');
      if (pr.chain) L.push('いなずまが ' + pr.chain.n + '人に とぶ');
      if (pr.heal > 0) L.push('みかたを ' + Math.round(pr.heal) + ' 回復');
      if (pr.knock > 0) L.push('ふきとばす');
    }
    if (g.lifesteal > 0) L.push('ダメージの ' + Math.round(g.lifesteal * 100) + '% 回復');
    if (g.onHit && g.onHit.slow) L.push('当たると 足が おそくなる');
    if (g.onHit && g.onHit.burn) L.push('当たると もえる');
    const bad = [];
    if (pm.noRegen) bad.push('じぶんで 回復しない');
    if (pm.takeMul > 1) bad.push('うける ダメージ ×' + pm.takeMul);
    if (pm.hpMul < 1) bad.push('体力 ×' + pm.hpMul);
    return (L.length ? 'こうか: ' + L.join(' ・ ') : '') + (bad.length ? '<br><span class="bad">からだ: ' + bad.join(' ・ ') + '（銃を もっているだけで かかる）</span>' : '');
  }

  function refresh() {
    if (!built || !CS.Parts) return;
    const c = cur(), def = gunDef(c.id);
    const total = P().total(c.mods), max = P().MAX_TOTAL;
    const slotName = c.slot === 1 ? 'サブ' : 'メイン';
    if (!def) {
      U.util.setText($('wsGun'), slotName + ': 銃が ないよ（下で えらんでね）');
      $('wsStats').innerHTML = ''; $('wsBody').innerHTML = '';
      $('wsGrid').innerHTML = '';
      U.util.setText($('wsCnt'), '0 / ' + max);
      $('wsBarI').style.width = '0%';
    } else {
      const g = P().build(def, c.mods);
      U.util.setText($('wsGun'), slotName + ': ' + def.name);
      U.util.setText($('wsCnt'), total + ' / ' + max);
      $('wsCnt').classList.toggle('full', total >= max);
      $('wsBarI').style.width = (total / max * 100) + '%';
      const st = stats(def, g);
      $('wsStats').innerHTML = st.html;
      $('wsBody').innerHTML = bodyText(g, st.pm) + (total ? '<br>リロード ×' + (1 + P().RELOAD_PER * total).toFixed(1) + '（部品 ' + total + 'こ）' : '');
      partsGrid(def, c.mods);
    }
    const tryB = $('wsTry');
    if (tryB) tryB.style.display = canTry() ? '' : 'none';
    buildPresets();
    drawPreview(0);
  }

  /* ---------------- おまかせ ---------------- */
  function randomMods() {
    const c = cur(), def = gunDef(c.id);
    if (!def) return;
    const L = P().LIST.filter((p) => p.ok(def));
    const o = {};
    let n = 0;
    const want = 4 + Math.floor(Math.random() * 8);
    for (let i = 0; i < 40 && n < want; i++) {
      const p = L[Math.floor(Math.random() * L.length)];
      if (!p) break;
      if (p.s) { if (o[p.id] || Math.random() < 0.6) continue; o[p.id] = 1; n++; }
      else { const k = 1 + Math.floor(Math.random() * 3); o[p.id] = (o[p.id] | 0) + k; n += k; }
    }
    U.util.sfx('ok');
    setMods(P().stringify(o));
  }

  /* ---------------- ためし撃ち（へやに いないとき） ---------------- */
  function canTry() {
    const g = CS.debug && CS.debug.game;
    return !!(g && g.mode === 'idle' && CS.UI.loadoutTarget === 'me');
  }
  function tryNow() {
    if (!canTry()) return;
    const ok = $('btnLoadoutOk');
    if (ok) ok.click();                  // いまの えらびを ほぞん
    setTimeout(function () { try { CS.debug.handlers.practice(); } catch (e) {} }, 0);
  }

  /* ---------------- 組み合わせ（10こ） ---------------- */
  function presets() {
    let L = CS.Settings.loadouts;
    if (!Array.isArray(L)) L = CS.Settings.loadouts = [];
    while (L.length < MAX_PRESETS) L.push(null);
    if (L.length > MAX_PRESETS) L.length = MAX_PRESETS;
    return L;
  }
  function presetText(p) {
    if (!p) return '（あき）';
    const nm = (id, m) => { const n = P().total(m || ''); return CS.UI.gunName(id) + (n ? '＋' + n : ''); };
    const b = CS.BombMap && CS.BombMap[p.b] ? CS.BombMap[p.b].name : '';
    return nm(p.g, p.gm) + (p.g2 ? ' / ' + nm(p.g2, p.gm2) : '') + (b ? ' ・ ' + b : '');
  }
  function buildPresets() {
    const grid = $('psGrid');
    if (!grid) return;
    const L = presets();
    grid.innerHTML = '';
    if (confirmI >= 0 && Date.now() - confirmT > 4000) confirmI = -1;
    L.forEach(function (p, i) {
      const card = D.createElement('div');
      card.className = 'psCard' + (p ? '' : ' empty');
      card.innerHTML = '<div class="nm"><i>' + (i + 1) + '</i><input type="text" maxlength="12" spellcheck="false" autocomplete="off"></div>' +
        '<div class="sm"></div><div class="rw"><button class="btn ghost" type="button" data-a="load">よびだす</button><button class="btn ghost" type="button" data-a="save"></button></div>';
      const inp = card.querySelector('input');
      inp.value = p ? p.n || '' : '';
      inp.placeholder = 'くみあわせ' + (i + 1);
      inp.disabled = !p;
      inp.addEventListener('change', function () {
        const q = presets()[i];
        if (!q) return;
        q.n = String(inp.value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12);
        CS.saveSettings();
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
      card.querySelector('.sm').textContent = presetText(p);
      const lb = card.querySelector('[data-a="load"]'), sb = card.querySelector('[data-a="save"]');
      lb.disabled = !p;
      sb.textContent = !p ? 'ここに ほぞん' : confirmI === i ? 'もう一度で うわがき' : 'うわがき';
      lb.addEventListener('click', function () { loadPreset(i); });
      sb.addEventListener('click', function () { savePreset(i); });
      grid.appendChild(card);
    });
  }
  function savePreset(i) {
    const L = presets(), s = sel();
    if (L[i] && confirmI !== i) { confirmI = i; confirmT = Date.now(); U.util.sfx('click'); buildPresets(); return; }
    confirmI = -1;
    if (!gunDef(s.gun)) return;
    const old = L[i];
    L[i] = {
      n: old && old.n ? old.n : 'くみあわせ' + (i + 1),
      g: s.gun, gm: P().clean(s.gm || '', gunDef(s.gun)),
      g2: s.gun2 || '', gm2: s.gun2 ? P().clean(s.gm2 || '', gunDef(s.gun2)) : '',
      b: s.bomb && CS.BombMap && CS.BombMap[s.bomb] ? s.bomb : (CS.Settings.bomb || 'frag')
    };
    CS.saveSettings();
    U.util.sfx('ok');
    CS.UI.toast((i + 1) + 'ばんに ほぞんしました');
    buildPresets();
  }
  function loadPreset(i) {
    const p = presets()[i], s = sel();
    if (!p || !gunDef(p.g)) return;
    s.gun = p.g;
    s.gm = P().clean(p.gm || '', gunDef(p.g));
    const g2 = p.g2 && gunDef(p.g2) && !gunDef(p.g2).solo && !gunDef(p.g).solo && !gunDef(p.g2).special ? p.g2 : '';
    s.gun2 = g2;
    s.gm2 = g2 ? P().clean(p.gm2 || '', gunDef(g2)) : '';
    if (p.b && CS.BombMap && CS.BombMap[p.b]) s.bomb = p.b;
    s.slot = 0;
    U.util.sfx('ok');
    CS.UI.toast('「' + (p.n || ('くみあわせ' + (i + 1))) + '」を よびだしたよ（「これにする」で きまり）');
    CS.UI.refreshLoadout();
  }

  /* ---------------- 3D プレビュー ---------------- */
  function startPreview() {
    const cv = $('wsCanvas');
    if (!cv) return;
    if (!r) {
      try { r = new CS.Renderer(cv); } catch (e) { r = null; }
      if (!r || !r.ok) { r = null; return; }
      r.setWorld(null);
    }
    lastT = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stopPreview() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    drawPreview(dt);
  }
  function drawPreview(dt) {
    if (!r || !r.ok || !CS.Parts) return;
    spin += spinV * (dt || 0);
    const c = cur(), def = gunDef(c.id);
    r.begin({ pos: [0, 0.05, 1.25], yaw: 0, pitch: -0.04, fov: 40, shake: 0 });
    if (def) {
      const g = P().build(def, c.mods);
      /* 銃の 長さに あわせて 大きさを かえる */
      let z0 = Infinity, z1 = -Infinity;
      for (const v of g.view) { z0 = Math.min(z0, v[2] - v[5] / 2); z1 = Math.max(z1, v[2] + v[5] / 2); }
      const len = Math.max(0.25, z1 - z0);
      r.gunModel(g, [0, 0, 0], Math.PI / 2 + spin, pitch * Math.cos(spin), Math.min(3, 1.25 / len));
      r.particle([0, -0.35, 0], 1.4, g.tracer || [0.5, 0.8, 1], 0.12);
    }
    r.end();
  }

  function init() {
    U = CS.UI;
    if (!$('partsSec') || !CS.Parts) return;
    buildDom();
    U.addScreen('scLoadout', function () { refresh(); startPreview(); }, stopPreview);
  }

  CS.Workshop = { refresh: refresh, presets: presets, MAX_PRESETS: MAX_PRESETS };
  CS.UI.addInit(init);
})();
