/* ==========================================================================
   CUBE STRIKE — specials.js
   必殺技（v4）: てきを たおすと 必殺ゲージが たまる（3キルで まんたん）。まんたんで F キー / 「必殺」ボタン。
     ・スナイパーマシンガン … 8秒、スコープつきの ちょう れんしゃ銃に もちかえる（当たれば 一発・遠くまで まっすぐ・弾は むげん）
     ・スーパーバリア     … 6秒、どんな こうげきも きかない（撃っても とけない）。HP も まんたんに
     ・ボムラッシュ       … 7秒、ボムが 0.4秒ごとに もどる（なげほうだい）
   しくみ（game.js）: ゲージは ホストが キルのたびに ふやす（kill / hs で みんなに届く）。
     つかうと {t:'spc'} → ホストが たしかめて みんなに {t:'spc', i, k, d} → それぞれの端末で こうか。
   ここには 定義・HUD（ゲージ）・ぶきをえらぶ画面の「必殺技」の らんだけを置く。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  /* ---------- スナイパーマシンガン（必殺技の銃。ぶきとしては えらべない: special） ----------
     当たれば 一発: ダメージ ONE_SHOT は いちばん かたい てき（塔のぼりの ボス 7000 くらい）より 大きい */
  const ONE_SHOT = 9999;
  const K = [0.12, 0.14, 0.19], Dk = [0.20, 0.23, 0.30], M = [0.34, 0.38, 0.47], L = [0.62, 0.67, 0.76];
  const GOLD = [1.0, 0.80, 0.28], LENS = [1.0, 0.95, 0.62];
  const b = (cx, cy, cz, sx, sy, sz, c) => [cx, cy, cz, sx, sy, sz, c[0], c[1], c[2]];
  const SPMG = Object.assign({}, CS.Guns[0], {
    id: 'sp_smg', name: 'スナイパーマシンガン', short: 'スナイパーMG', special: true,
    desc: '必殺技の銃。当たれば 一発。スコープつきで ちょう れんしゃ',
    type: 'hitscan', dmg: ONE_SHOT, hs: 1, rpm: 620, auto: true, burst: 0, pellets: 1,
    spread: 0.8, adsSpread: 0.0, moveSpread: 0, mag: 999, reload: 1,
    range: 220, falloff: null, recoil: [0.22, 0.08], zoom: 0.42, move: 1.0,
    spinup: 0, charge: 0, pierce: false, proj: null, flame: null, beam: null,
    tracer: [1.0, 0.86, 0.35], tracerWidth: 0.05, sfx: 'shot_spmg', muzzle2: null, viewSpin: null,
    view: [
      b(0, 0, -0.02, 0.09, 0.11, 0.34, Dk),          // 機関部
      b(0, -0.02, 0.22, 0.07, 0.12, 0.18, M),        // ストック
      b(0, 0.05, 0.21, 0.05, 0.02, 0.10, GOLD),      // ほほ当て
      b(0, 0.015, -0.40, 0.04, 0.04, 0.50, L),       // 長い銃身
      b(0, 0.015, -0.66, 0.07, 0.06, 0.07, GOLD),    // マズルブレーキ
      b(0, 0.11, -0.04, 0.06, 0.06, 0.30, K),        // スコープ
      b(0, 0.11, -0.20, 0.08, 0.08, 0.05, GOLD),
      b(0, 0.11, -0.226, 0.065, 0.065, 0.006, LENS), // レンズ
      b(0, -0.12, -0.08, 0.13, 0.13, 0.08, GOLD),    // ドラムマガジン
      b(0, -0.09, 0.07, 0.05, 0.10, 0.05, K),        // グリップ
      b(0.048, 0, -0.10, 0.006, 0.02, 0.30, GOLD),   // 光るライン
      b(0, -0.035, -0.30, 0.02, 0.06, 0.03, M)
    ],
    muzzle: [0, 0.015, -0.70],
    stats: { power: 5, rate: 5, range: 5, mobility: 3, ease: 5 }
  });
  if (CS.Weapons.bulletize) CS.Weapons.bulletize(SPMG);       // CS2: 弾は とんでいく
  CS.GunMap[SPMG.id] = SPMG;

  /* ---------- v5: 戦車の 大砲（必殺技「せんしゃ」のあいだ だけ。弾は むげん・じぶんは ばくふうで けがしない） ---------- */
  const OLIVE = [0.34, 0.42, 0.26], TRK = [0.14, 0.15, 0.17];
  const TANKGUN = Object.assign({}, CS.Guns[0], {
    id: 'sp_tank', name: 'せんしゃの たいほう', short: 'たいほう', special: true,
    desc: '必殺技の 大砲。大きな ばくはつ',
    type: 'projectile', dmg: 70, hs: 1, rpm: 55, auto: true, burst: 0, pellets: 1,
    spread: 0.3, adsSpread: 0, moveSpread: 0, mag: 999, reload: 1,
    range: 150, falloff: null, recoil: [3.5, 0.4], zoom: 0.8, move: 0.72,
    spinup: 0, charge: 0, pierce: false, flame: null, beam: null,
    proj: { speed: 42, grav: 3, size: 0.3, radius: 3.8, splashDmg: 90, splashMin: 0.3, bounce: 0, bounceDamp: 0, fuse: 0,
      homing: 0, homingCone: 0, selfMult: 0, contact: true, wallPierce: 0 },
    tracer: [1.0, 0.72, 0.3], tracerWidth: 0.08, sfx: 'shot_rocket', muzzle2: null, viewSpin: null,
    view: [
      b(0, -0.03, 0.08, 0.20, 0.11, 0.28, OLIVE),     // 砲台（前が 見えるように 小さめ）
      b(0, 0.0, -0.26, 0.075, 0.075, 0.46, Dk),       // 砲身
      b(0, 0.0, -0.50, 0.11, 0.11, 0.07, K),          // 砲口
      b(0, 0.035, 0.06, 0.14, 0.035, 0.18, OLIVE),
      b(0.105, -0.03, 0.08, 0.008, 0.03, 0.24, GOLD), // 光るライン
      b(-0.105, -0.03, 0.08, 0.008, 0.03, 0.24, GOLD)
    ],
    muzzle: [0, 0.0, -0.54],
    stats: { power: 5, rate: 2, range: 4, mobility: 1, ease: 5 }
  });
  CS.GunMap[TANKGUN.id] = TANKGUN;

  const LIST = [
    /* mark = ゲージの 輪の中に出す 短い文字（絵文字は 端末で 見た目が かわるので つかわない） */
    { id: 'smg', mark: 'MG', name: 'スナイパーマシンガン', short: 'スナイパーMG', dur: 8, color: '#ffd23d',
      desc: '8秒間 スコープつきの ちょう れんしゃ銃に！ 当たれば 一発で たおせる。弾は むげん' },
    { id: 'shield', mark: 'バリア', name: 'スーパーバリア', short: 'バリア', dur: 6, color: '#7fd6ff',
      desc: '6秒間 どんな こうげきも きかない。撃っても とけない。HPも まんたんに' },
    { id: 'rush', mark: 'ボム', name: 'ボムラッシュ', short: 'ボムラッシュ', dur: 7, color: '#ff9a3d',
      desc: '7秒間 ボムが なげほうだい（0.4秒で もどる）' },
    /* v5 */
    { id: 'tank', mark: 'タンク', name: 'せんしゃ', short: 'せんしゃ', dur: 10, color: '#a8d86a',
      desc: '10秒間 せんしゃに へんしん！ 大砲で 大ばくはつ。うける ダメージは 3分の1（ジャンプは できない）' },
    { id: 'bubble', mark: 'バブル', name: 'バブル', short: 'バブル', dur: 12, color: '#8fe3ff',
      desc: '12秒間 シャボン玉で 空に うかぶ（ジャンプで 上・スライドで 下）。こうげきに 1回 当たると われて おちる' },
    /* v5.1 */
    { id: 'clone', mark: 'コピー', name: 'コピー', short: 'コピー', dur: 15, color: '#ff9ad8',
      desc: '15秒間 じぶんの コピーが となりに あらわれて いっしょに たたかう（おなじ 見た目・おなじ 銃。塔のぼり・ためし撃ちでは つかえない）' },
    /* v5.2 */
    { id: 'icefield', mark: 'アイス', name: 'アイスフィールド', short: 'アイス', dur: 10, color: '#bfefff',
      desc: '10秒間 ぜんぶの 床が つるつるの 氷に！ あいての チームは すべって うまく うごけない（じぶんの チームは へいき）' }
  ];
  const MAP = {};
  for (const s of LIST) MAP[s.id] = s;
  const IDS = LIST.map((s) => s.id);

  const clean = (id) => (MAP[id] ? id : 'smg');
  const get = (id) => MAP[id] || null;
  const mineId = () => clean(CS.Settings && CS.Settings.special);

  /* ゲージ: 1キル ぶん（3キルで まんたん）。塔のぼりは てきが 多いので 少なめ */
  const GAIN = 0.34, GAIN_TOWER = 0.22, GAIN_BOSS = 0.5, GAIN_TARGET = 0.34;

  /* ======================================================================
     HUD（ゲージ）。タッチでは「必殺」ボタンが ゲージを かねるので かくす
     ====================================================================== */
  const CSS = [
    '#spBox{position:absolute;left:50%;bottom:calc(12px + var(--safeB));transform:translateX(-50%);width:74px;height:74px;display:flex;',
    '  flex-direction:column;align-items:center;justify-content:center;border-radius:50%;background:rgba(6,10,28,.55);pointer-events:none;',
    '  font-weight:900;letter-spacing:.06em;color:#dfe9ff;text-shadow:0 1px 2px #000;transition:transform .15s}',
    '#spBox svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}',
    '#spBox circle{fill:none;stroke-width:5}#spBox .bg{stroke:rgba(255,255,255,.14)}#spBox .fg{stroke:#ffd23d;stroke-linecap:round;transition:stroke-dashoffset .2s}',
    '#spBox b{position:relative;font-size:13px}#spBox small{position:relative;font-size:10px;color:#9fb4d4;margin-top:1px}',
    '#spBox em{position:relative;font-style:normal;font-size:11px;font-weight:900;line-height:1;letter-spacing:.02em}',
    '#spBox.ready{animation:spPulse .8s ease-in-out infinite alternate}#spBox.ready small{color:#fff3b0}',
    '#spBox.ready .fg{stroke:#fff06a}',
    '#spBox.act .fg{stroke:#7fd6ff}',
    '@keyframes spPulse{from{box-shadow:0 0 6px rgba(255,210,61,.4);transform:translateX(-50%) scale(1)}to{box-shadow:0 0 26px rgba(255,210,61,.95);transform:translateX(-50%) scale(1.07)}}',
    'body.touch #spBox{display:none}',
    '#spBanner{position:absolute;left:0;right:0;top:18%;text-align:center;pointer-events:none;opacity:0;transition:opacity .2s}',
    '#spBanner.on{opacity:1}',
    '#spBanner b{display:inline-block;font-size:clamp(22px,5.4vmin,42px);font-weight:900;letter-spacing:.1em;padding:6px 22px;border-radius:14px;',
    '  background:linear-gradient(90deg,rgba(255,200,60,.0),rgba(255,200,60,.35),rgba(255,200,60,0));color:#fff6c8;text-shadow:0 0 18px rgba(255,190,40,.9),0 2px 4px #000}',
    '#spBanner small{display:block;font-size:13px;color:#ffe9a8;letter-spacing:.08em;margin-top:2px;text-shadow:0 1px 3px #000}',
    '#hud.sp-smg #crosshair i{background:#ffd23d!important}',
    /* ぶきをえらぶ画面の「必殺技」 */
    '#spSec h3 span{font-size:11px;font-weight:500;color:#9fb4d4;letter-spacing:.04em;margin-left:8px}',
    '#spGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;width:100%}',
    '.spCard{cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 12px;border-radius:14px;text-align:left;',
    '  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);color:#eaf4ff;font-family:inherit}',
    '.spCard b{font-size:14.5px;letter-spacing:.04em}.spCard b i{font-style:normal;margin-right:6px}.spCard small{font-size:11px;color:#a9bddb;line-height:1.5}',
    '.spCard.sel{border-color:#ffd23d;box-shadow:0 0 0 2px rgba(255,210,61,.55),0 0 18px rgba(255,210,61,.25)}'
  ].join('\n');

  let E = null, cssDone = false;
  /* 見た目は 1回だけ入れる（ぶきをえらぶ画面を しあいより先に ひらいても カードが くずれないように） */
  function css() {
    if (cssDone) return;
    cssDone = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function dom() {
    if (E) return E;
    const hud = document.getElementById('hud');
    if (!hud) return null;
    css();
    const box = document.createElement('div');
    box.id = 'spBox';
    box.innerHTML = '<svg viewBox="0 0 64 64"><circle class="bg" cx="32" cy="32" r="28"></circle><circle class="fg" cx="32" cy="32" r="28"></circle></svg>' +
      '<em></em><b>必殺</b><small>F</small>';
    hud.appendChild(box);
    const ban = document.createElement('div');
    ban.id = 'spBanner';
    ban.innerHTML = '<b></b><small></small>';
    hud.appendChild(ban);
    const fg = box.querySelector('.fg');
    const LEN = 2 * Math.PI * 28;
    fg.setAttribute('stroke-dasharray', LEN.toFixed(2));
    fg.setAttribute('stroke-dashoffset', LEN.toFixed(2));
    E = { hud: hud, box: box, fg: fg, LEN: LEN, em: box.querySelector('em'), b: box.querySelector('b'), sm: box.querySelector('small'),
      ban: ban, banB: ban.querySelector('b'), banS: ban.querySelector('small'), last: {}, banT: 0 };
    return E;
  }

  /* 毎フレーム（game._hud から）。s = {sp: 0..1, kind: いま つかっている必殺技の id | null, left: のこり秒, dur, my: じぶんの必殺技 id} */
  function hud(s) {
    const e = dom();
    if (!e || !s) return;
    const L = e.last;
    const act = !!s.kind;
    const k = act ? Math.max(0, Math.min(1, (s.left || 0) / (s.dur || 1))) : Math.max(0, Math.min(1, s.sp || 0));
    const q = Math.round(k * 60) / 60;
    if (q !== L.q) { L.q = q; e.fg.setAttribute('stroke-dashoffset', (e.LEN * (1 - q)).toFixed(2)); }
    const ready = !act && (s.sp || 0) >= 0.999;
    const state = act ? 'act' : ready ? 'ready' : '';
    if (state !== L.state) {
      L.state = state;
      e.box.classList.toggle('ready', ready);
      e.box.classList.toggle('act', act);
    }
    const S = MAP[act ? s.kind : s.my] || LIST[0];
    const txt = act ? Math.ceil(s.left || 0) + '秒' : ready ? 'F で つかう' : Math.floor(k * 100) + '%';
    if (txt !== L.txt) { L.txt = txt; e.sm.textContent = txt; }
    if (S.mark !== L.mark) { L.mark = S.mark; e.em.textContent = S.mark; e.em.style.color = S.color; }
    const hk = act ? 'sp-' + s.kind : '';
    if (hk !== L.hk) { if (L.hk) e.hud.classList.remove(L.hk); if (hk) e.hud.classList.add(hk); L.hk = hk; }
    /* タッチの「必殺」ボタンにも（リング・光る・つかっている） */
    try { if (CS.Input.setSpecial) CS.Input.setSpecial(act ? k : Math.min(1, s.sp || 0), ready, act); } catch (err) {}
  }

  /* 「スナイパーマシンガン！」の大きな文字 */
  function banner(kind, who) {
    const e = dom();
    if (!e) return;
    const S = MAP[kind];
    if (!S) return;
    e.banB.textContent = S.name + '！';
    e.banS.textContent = who || '';
    e.banB.style.color = S.color;
    e.ban.classList.add('on');
    clearTimeout(e.banT);
    e.banT = setTimeout(function () { e.ban.classList.remove('on'); }, 1800);
  }

  /* ======================================================================
     ぶきをえらぶ画面の「必殺技」
     ====================================================================== */
  function buildPicker() {
    const bomb = document.getElementById('bombSec');
    if (!bomb) return;
    css();
    let sec = document.getElementById('spSec');
    if (!sec) {
      sec = document.createElement('div');
      sec.id = 'spSec'; sec.className = 'grp';
      sec.innerHTML = '<h3>必殺技<span>てきを 3回 たおすと ゲージ まんたん → F キー / 「必殺」ボタン</span></h3><div id="spGrid"></div>';
      bomb.parentNode.insertBefore(sec, bomb.nextSibling);
      const nav = document.querySelector('#scLoadout .lnav');
      if (nav) {
        const bt = document.createElement('button');
        bt.type = 'button'; bt.className = 'btn ghost'; bt.textContent = '必殺技（' + LIST.length + '）';
        bt.addEventListener('click', function () { try { sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (err) {} });
        nav.appendChild(bt);
      }
    }
    const grid = document.getElementById('spGrid');
    grid.innerHTML = '';
    const cur = mineId();
    for (const s of LIST) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'spCard' + (s.id === cur ? ' sel' : '');
      const t = document.createElement('b');
      t.style.color = s.color;
      t.appendChild(document.createTextNode(s.name));
      const d = document.createElement('small'); d.textContent = s.desc;
      c.appendChild(t); c.appendChild(d);
      c.addEventListener('click', function () {
        try { CS.Audio.play('click'); } catch (err) {}
        CS.Settings.special = s.id;
        if (CS.saveSettings) CS.saveSettings();
        buildPicker();
      });
      grid.appendChild(c);
    }
  }

  if (CS.UI && CS.UI.addInit) CS.UI.addInit(function () { CS.UI.addScreen('scLoadout', buildPicker); });

  CS.Specials = {
    LIST: LIST, IDS: IDS, MAP: MAP, GUN: SPMG, ONE_SHOT: ONE_SHOT,
    /* v5: 銃を もちかえる 必殺技（id → 銃） */
    GUNS: { smg: SPMG, tank: TANKGUN },
    GAIN: GAIN, GAIN_TOWER: GAIN_TOWER, GAIN_BOSS: GAIN_BOSS, GAIN_TARGET: GAIN_TARGET,
    clean: clean, get: get, mineId: mineId, hud: hud, banner: banner, buildPicker: buildPicker
  };
})();
