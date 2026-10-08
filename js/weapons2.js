/* ==========================================================================
   CUBE STRIKE 2 — weapons2.js
   CS2 の あたらしい 銃 36しゅるい（CS1 の 21しゅるい ＋ 36 = 57しゅるい）と、
   「ぜんぶの 銃の 弾が とんでいく」ための へんかん（bulletize）。
   ・CS1 で 一瞬で とどいていた銃（hitscan）は、とても速い 弾（proj.fast）に かわる。
     ビーム（レーザー）と かえん は 弾では ないので そのまま。
   ・group: ぶきをえらぶ画面の なかま（rifle / rapid / heavy / shot / sniper / sp / myst / support）
   ・solo: スナイパー系。これを もつと 2つめの 銃は もてない
   ・弾（proj）の あたらしい こうもく（game.js が つかう）
       fast    : 速い弾（線で かく。ほかの人の 画面では じぶんで かべ・人で 止まる）
       pierce  : 人を つらぬく（1人に 1回だけ 当たる）
       hitR    : 当たりの 大きさを ふやす（m）
       boomer  : この秒数で もどってくる（ブーメラン）
       chain   : {n, r, k} 当たった人から n人まで いなずまが とぶ（ダメージ ×k）
       cluster : {n, dmg, radius, splash, speed} ばくはつすると 子の弾が とびちる（はなび）
       field   : {r, dur, pull, dps} ばくはつした所に ブラックホール（すいこむ・すこしずつ ダメージ）
       heal    : みかたに 当たると その分 回復（てきには dmg）
       healR   : ばくはつの はんいの みかたを heal 回復
       buff    : {k:'guard'|'pow'|'spd', dur, mul} みかたに 当たると つよくする
       knock   : 当たった人を 弾の むきへ おす（m/秒）
       knockUp : 当たった人を 上へ うかせる（m/秒）
   ・銃の onHit: {slow:{mul,dur}, burn:{dps,dur}} 当たった てきへの こうか（ホストが きめる）
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Guns) return;

  const K = [0.12, 0.14, 0.19], D = [0.20, 0.23, 0.30], M = [0.34, 0.38, 0.47], L = [0.62, 0.67, 0.76];
  const W = [0.86, 0.88, 0.92], WOOD = [0.52, 0.34, 0.20], GOLD = [1.0, 0.80, 0.28];
  const b = (cx, cy, cz, sx, sy, sz, c) => [cx, cy, cz, sx, sy, sz, c[0], c[1], c[2]];
  const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  function P(o) {
    return Object.assign({
      speed: 40, grav: 0, size: 0.1, radius: 0, splashDmg: 0, splashMin: 0,
      bounce: 0, bounceDamp: 0, fuse: 0, homing: 0, homingCone: 0, selfMult: 0, contact: true,
      wallPierce: 0, fast: false, pierce: false, hitR: 0
    }, o);
  }
  const GUN_DEFAULTS = {
    type: 'projectile', hs: 1, auto: false, burst: 0, pellets: 1,
    spread: 0, adsSpread: 0, moveSpread: 0, falloff: null, recoil: [0.5, 0.2],
    zoom: 1, move: 1, spinup: 0, charge: 0, pierce: false,
    proj: null, flame: null, beam: null, tracerWidth: 0.03,
    muzzle2: null, viewSpin: null
  };
  const G = (o) => Object.assign({}, GUN_DEFAULTS, o);
  /* 速い弾（ふつうの銃） */
  const FB = (speed, o) => P(Object.assign({ speed: speed, size: 0.06, fast: true }, o || {}));

  /* ---------- CS1 の 銃の グループ ---------- */
  const GROUP1 = {
    ar: 'rifle', burst: 'rifle', dmr: 'rifle',
    smg: 'rapid', lmg: 'rapid', minigun: 'rapid', dual: 'rapid',
    sniper: 'sniper', magnum: 'heavy', rail: 'heavy', crossbow: 'heavy', giga: 'heavy',
    shotgun: 'shot', double: 'shot',
    rocket: 'sp', grenade: 'sp', laser: 'sp', plasma: 'sp', flame: 'sp', needler: 'sp', ricochet: 'sp'
  };
  /* CS1 で 一瞬で とどいていた銃の 弾の速さ（m/秒） */
  const BSPD = { ar: 170, smg: 150, lmg: 170, minigun: 160, burst: 180, dmr: 240, sniper: 360, magnum: 200, dual: 150, shotgun: 120, double: 110, rail: 420, sp_smg: 300 };

  /* 一瞬で とどく銃（hitscan）を 速い弾に かえる。ビーム・かえんは そのまま */
  function bulletize(g) {
    if (!g || g.type !== 'hitscan') return g;
    const sp = BSPD[g.id] || Math.max(110, Math.min(420, (g.range || 100) * 1.6));
    g.type = 'projectile';
    g.proj = FB(sp, { pierce: !!g.pierce, size: g.tracerWidth >= 0.07 ? 0.1 : 0.06 });
    return g;
  }

  /* ======================================================================
     あたらしい 36しゅるい
     ====================================================================== */
  const C = {
    pistol: [1.0, 0.86, 0.55], mpis: [1.0, 0.70, 0.45], carb: [0.65, 1.0, 0.55], battle: [1.0, 0.62, 0.40], bull: [0.55, 0.85, 1.0],
    pdw: [0.80, 0.70, 1.0], vec: [1.0, 0.45, 0.65], hmg: [1.0, 0.58, 0.28], ashot: [1.0, 0.82, 0.40], slug: [1.0, 0.92, 0.70],
    sawed: [1.0, 0.68, 0.38], lever: [0.95, 0.80, 0.50], bpis: [0.55, 1.0, 0.85], musket: [1.0, 0.95, 0.80], quad: [1.0, 0.45, 0.25],
    nail: [0.80, 0.85, 0.95], anti: [0.70, 0.95, 1.0], ssn: [0.60, 0.90, 1.0], silent: [0.70, 0.80, 1.0],
    bh: [0.62, 0.35, 1.0], thunder: [1.0, 0.95, 0.35], boomer: [1.0, 0.65, 0.30], bubble: [0.60, 0.92, 1.0], snow: [0.88, 0.96, 1.0],
    fire: [1.0, 0.45, 0.75], pod: [1.0, 0.55, 0.30], drill: [0.95, 0.75, 0.35], uki: [0.70, 1.0, 0.80], solar: [1.0, 0.75, 0.25],
    slime: [0.45, 1.0, 0.45], wind: [0.75, 1.0, 0.95],
    heal: [0.40, 1.0, 0.60], medic: [0.55, 1.0, 0.70], guard: [0.45, 0.80, 1.0], pow: [1.0, 0.45, 0.35], spd: [1.0, 0.95, 0.35]
  };

  const NEW = [
    /* ---------------- ふつうの銃の バリエーション ---------------- */
    G({
      id: 'pistol', name: 'ハンドガン', short: 'ハンドガン', group: 'heavy',
      desc: 'かるくて あつかいやすい 単発ピストル。サブの 銃に ぴったり',
      dmg: 34, rpm: 300, mag: 12, reload: 1.3, spread: 1.2, adsSpread: 0.4,
      range: 70, falloff: [15, 35, 0.65], recoil: [1.2, 0.3], zoom: 0.85, move: 1.1,
      proj: FB(170), tracer: C.pistol, sfx: 'shot_pistol',
      view: [b(0, 0.02, -0.08, 0.05, 0.06, 0.24, D), b(0, 0.015, -0.21, 0.03, 0.03, 0.06, L), b(0, -0.07, 0.04, 0.045, 0.12, 0.06, K),
        b(0, 0.055, -0.08, 0.012, 0.008, 0.18, C.pistol), b(0, -0.02, -0.04, 0.035, 0.02, 0.06, M)],
      muzzle: [0, 0.015, -0.245], stats: { power: 3, rate: 3, range: 3, mobility: 4, ease: 5 }
    }),
    G({
      id: 'mpistol', name: 'マシンピストル', short: 'マシピス', group: 'rapid',
      desc: 'ピストルなのに 連射できる。ちかくで あばれよう',
      dmg: 15, rpm: 900, auto: true, mag: 20, reload: 1.5, spread: 3.5, adsSpread: 2.0,
      range: 45, falloff: [10, 22, 0.55], recoil: [0.5, 0.5], zoom: 0.9, move: 1.12,
      proj: FB(140), tracer: C.mpis, sfx: 'shot_pistol',
      view: [b(0, 0.02, -0.07, 0.05, 0.06, 0.22, D), b(0, 0.015, -0.20, 0.03, 0.03, 0.05, L), b(0, -0.09, 0.03, 0.045, 0.16, 0.06, K),
        b(0, 0.055, -0.07, 0.012, 0.008, 0.16, C.mpis), b(0, -0.035, -0.13, 0.03, 0.05, 0.04, M)],
      muzzle: [0, 0.015, -0.225], stats: { power: 2, rate: 5, range: 1, mobility: 5, ease: 3 }
    }),
    G({
      id: 'carbine', name: 'カービン', short: 'カービン', group: 'rifle',
      desc: 'みじかい ライフル。走りまわっても 使いやすい',
      dmg: 27, rpm: 560, auto: true, mag: 30, reload: 2.0, spread: 2.2, adsSpread: 0.5,
      range: 85, falloff: [20, 40, 0.7], recoil: [0.8, 0.3], zoom: 0.8, move: 1.0,
      proj: FB(165), tracer: C.carb, sfx: 'shot_ar',
      view: [b(0, 0, -0.04, 0.075, 0.095, 0.30, D), b(0, -0.01, 0.19, 0.055, 0.085, 0.16, M), b(0, 0.015, -0.30, 0.032, 0.032, 0.20, M),
        b(0, -0.10, -0.07, 0.045, 0.12, 0.06, M), b(0, -0.085, 0.05, 0.04, 0.09, 0.05, K), b(0, 0.065, -0.04, 0.025, 0.025, 0.08, C.carb),
        b(0.04, 0, -0.04, 0.006, 0.018, 0.22, C.carb)],
      muzzle: [0, 0.015, -0.40], stats: { power: 3, rate: 4, range: 3, mobility: 4, ease: 4 }
    }),
    G({
      id: 'battle', name: 'バトルライフル', short: 'バトル', group: 'rifle',
      desc: 'おもい 弾を 連射。とおくでも つよいが はんどうが 大きい',
      dmg: 44, rpm: 380, auto: true, mag: 20, reload: 2.6, spread: 2.4, adsSpread: 0.3,
      range: 120, falloff: [35, 60, 0.75], recoil: [1.6, 0.4], zoom: 0.7, move: 0.88,
      proj: FB(190), tracer: C.battle, sfx: 'shot_dmr',
      view: [b(0, 0, -0.03, 0.085, 0.11, 0.36, D), b(0, -0.015, 0.23, 0.065, 0.11, 0.18, WOOD), b(0, 0.015, -0.38, 0.038, 0.038, 0.32, M),
        b(0, 0.005, -0.30, 0.07, 0.075, 0.18, WOOD), b(0, -0.11, -0.06, 0.05, 0.13, 0.07, K), b(0, -0.09, 0.07, 0.045, 0.1, 0.05, K),
        b(0, 0.08, -0.04, 0.035, 0.035, 0.14, C.battle)],
      muzzle: [0, 0.015, -0.545], stats: { power: 4, rate: 3, range: 4, mobility: 2, ease: 2 }
    }),
    G({
      id: 'bullpup', name: 'ブルパップ', short: 'ブルパップ', group: 'rifle',
      desc: 'マガジンが うしろの ライフル。連射が はやめ',
      dmg: 25, rpm: 720, auto: true, mag: 30, reload: 2.4, spread: 2.2, adsSpread: 0.6,
      range: 90, falloff: [22, 42, 0.7], recoil: [0.7, 0.35], zoom: 0.78, move: 0.95,
      proj: FB(170), tracer: C.bull, sfx: 'shot_ar',
      view: [b(0, 0, 0.04, 0.09, 0.12, 0.44, D), b(0, 0.02, -0.28, 0.035, 0.035, 0.18, M), b(0, -0.1, 0.16, 0.05, 0.11, 0.07, M),
        b(0, -0.09, -0.06, 0.045, 0.1, 0.05, K), b(0, 0.09, -0.02, 0.05, 0.05, 0.16, K), b(0, 0.09, -0.11, 0.04, 0.04, 0.01, C.bull),
        b(0.047, 0, 0.04, 0.006, 0.02, 0.32, C.bull)],
      muzzle: [0, 0.02, -0.375], stats: { power: 3, rate: 4, range: 3, mobility: 3, ease: 3 }
    }),
    G({
      id: 'pdw', name: 'PDW', short: 'PDW', group: 'rapid',
      desc: '50発の 大きな マガジン。ばらまいて おしきる',
      dmg: 13, rpm: 950, auto: true, mag: 50, reload: 2.0, spread: 3.0, adsSpread: 1.8,
      range: 50, falloff: [12, 26, 0.55], recoil: [0.35, 0.35], zoom: 0.85, move: 1.1,
      proj: FB(145), tracer: C.pdw, sfx: 'shot_smg',
      view: [b(0, 0, -0.02, 0.085, 0.12, 0.30, D), b(0, 0.06, -0.02, 0.06, 0.02, 0.26, C.pdw), b(0, 0.015, -0.22, 0.035, 0.035, 0.12, M),
        b(0, -0.10, 0.06, 0.045, 0.1, 0.05, K), b(0, 0, 0.20, 0.06, 0.08, 0.1, M), b(0, -0.08, -0.12, 0.04, 0.06, 0.05, K)],
      muzzle: [0, 0.015, -0.28], stats: { power: 2, rate: 5, range: 2, mobility: 4, ease: 3 }
    }),
    G({
      id: 'vector', name: 'ベクター', short: 'ベクター', group: 'rapid',
      desc: 'ものすごく はやい 連射。弾は すぐ なくなる',
      dmg: 11, rpm: 1200, auto: true, mag: 30, reload: 1.6, spread: 3.2, adsSpread: 2.0,
      range: 40, falloff: [10, 20, 0.5], recoil: [0.3, 0.45], zoom: 0.88, move: 1.12,
      proj: FB(140), tracer: C.vec, sfx: 'shot_smg',
      view: [b(0, 0.01, -0.05, 0.075, 0.09, 0.28, D), b(0, -0.07, -0.12, 0.07, 0.07, 0.1, M), b(0, -0.14, -0.08, 0.04, 0.16, 0.05, K),
        b(0, -0.09, 0.06, 0.04, 0.1, 0.05, K), b(0, 0.06, -0.05, 0.03, 0.02, 0.2, C.vec), b(0, 0.02, 0.15, 0.03, 0.05, 0.14, M)],
      muzzle: [0, 0.01, -0.20], stats: { power: 1, rate: 5, range: 1, mobility: 5, ease: 2 }
    }),
    G({
      id: 'hmg', name: 'ヘビーマシンガン', short: 'ヘビーMG', group: 'rapid',
      desc: '100発の おもい 弾。おそいけど 止まらない',
      dmg: 36, rpm: 450, auto: true, mag: 100, reload: 5.0, spread: 3.2, adsSpread: 1.2,
      range: 110, falloff: [35, 60, 0.75], recoil: [0.9, 0.5], zoom: 0.82, move: 0.7,
      proj: FB(175), tracer: C.hmg, sfx: 'shot_lmg',
      view: [b(0, 0, 0.02, 0.13, 0.15, 0.40, D), b(0, 0.02, -0.38, 0.06, 0.06, 0.40, M), b(0, 0.02, -0.6, 0.09, 0.09, 0.06, K),
        b(0, -0.15, -0.02, 0.14, 0.15, 0.16, dim(C.hmg, 0.5)), b(0, 0.12, -0.06, 0.04, 0.05, 0.16, K), b(0, -0.01, 0.29, 0.08, 0.12, 0.16, M),
        b(0.07, 0.02, -0.02, 0.006, 0.04, 0.34, C.hmg)],
      muzzle: [0, 0.02, -0.635], stats: { power: 4, rate: 3, range: 4, mobility: 1, ease: 4 }
    }),
    G({
      id: 'autoshot', name: 'オートショットガン', short: 'オートSG', group: 'shot',
      desc: '連射できる ショットガン。ちかくで ドドドッ',
      dmg: 9, rpm: 200, auto: true, pellets: 7, mag: 10, reload: 2.8, spread: 5.5, adsSpread: 4.5,
      range: 25, falloff: [6, 14, 0.3], recoil: [2.2, 0.8], zoom: 0.92, move: 0.98,
      proj: FB(120), tracer: C.ashot, sfx: 'shot_shotgun', tracerWidth: 0.02,
      view: [b(0, 0, -0.02, 0.09, 0.11, 0.30, D), b(0, 0.025, -0.30, 0.05, 0.05, 0.28, M), b(0, -0.12, -0.06, 0.08, 0.12, 0.1, dim(C.ashot, 0.6)),
        b(0, -0.09, 0.08, 0.045, 0.1, 0.05, K), b(0, -0.01, 0.22, 0.07, 0.1, 0.16, M), b(0, 0.07, -0.05, 0.02, 0.02, 0.2, C.ashot)],
      muzzle: [0, 0.025, -0.445], stats: { power: 4, rate: 3, range: 1, mobility: 3, ease: 4 }
    }),
    G({
      id: 'slug', name: 'スラッグショット', short: 'スラッグ', group: 'shot',
      desc: '1つぶの 大きな 弾。ショットガンなのに とおくまで とどく',
      dmg: 88, rpm: 70, mag: 5, reload: 2.6, spread: 1.0, adsSpread: 0.3,
      range: 60, falloff: [15, 40, 0.5], recoil: [5.0, 0.9], zoom: 0.82, move: 1.0,
      proj: FB(150, { size: 0.09 }), tracer: C.slug, sfx: 'shot_shotgun', tracerWidth: 0.05,
      view: [b(0, 0, 0, 0.08, 0.10, 0.24, D), b(0, -0.03, 0.22, 0.07, 0.12, 0.2, WOOD), b(0, 0.025, -0.31, 0.05, 0.05, 0.38, M),
        b(0, -0.03, -0.26, 0.07, 0.06, 0.14, WOOD), b(0, 0.06, -0.47, 0.015, 0.015, 0.015, C.slug), b(0, 0.07, -0.02, 0.03, 0.03, 0.12, C.slug)],
      muzzle: [0, 0.025, -0.50], stats: { power: 5, rate: 1, range: 3, mobility: 3, ease: 2 }
    }),
    G({
      id: 'sawed', name: 'ソードオフ', short: 'ソードオフ', group: 'shot',
      desc: 'みじかい 2れんじゅう。ほんとうに ちかい あいては 一撃',
      dmg: 14, rpm: 140, pellets: 10, mag: 2, reload: 1.9, spread: 10, adsSpread: 9,
      range: 14, falloff: [4, 10, 0.25], recoil: [6.0, 1.2], zoom: 0.95, move: 1.12,
      proj: FB(110), tracer: C.sawed, sfx: 'shot_double', tracerWidth: 0.02,
      view: [b(-0.025, 0.02, -0.16, 0.045, 0.045, 0.24, M), b(0.025, 0.02, -0.16, 0.045, 0.045, 0.24, M), b(0, 0.005, 0.0, 0.10, 0.08, 0.1, D),
        b(0, -0.07, 0.07, 0.06, 0.12, 0.08, WOOD), b(0, 0.05, -0.16, 0.012, 0.012, 0.22, C.sawed)],
      muzzle: [0, 0.02, -0.285], stats: { power: 5, rate: 1, range: 1, mobility: 5, ease: 2 }
    }),
    G({
      id: 'lever', name: 'レバーアクション', short: 'レバー', group: 'heavy',
      desc: 'むかしの ライフル。1発が おもくて とおくまで まっすぐ',
      dmg: 68, rpm: 110, mag: 7, reload: 3.2, spread: 1.0, adsSpread: 0.15,
      range: 120, falloff: null, recoil: [3.0, 0.5], zoom: 0.65, move: 0.95,
      proj: FB(210, { size: 0.07 }), tracer: C.lever, sfx: 'shot_magnum', tracerWidth: 0.04,
      view: [b(0, 0, 0, 0.07, 0.09, 0.22, GOLD), b(0, -0.02, 0.21, 0.06, 0.1, 0.2, WOOD), b(0, 0.02, -0.33, 0.035, 0.035, 0.46, M),
        b(0, -0.02, -0.25, 0.05, 0.05, 0.24, WOOD), b(0, -0.08, 0.05, 0.02, 0.05, 0.1, L), b(0, 0.055, -0.5, 0.01, 0.02, 0.02, C.lever)],
      muzzle: [0, 0.02, -0.56], stats: { power: 4, rate: 2, range: 4, mobility: 3, ease: 2 }
    }),
    G({
      id: 'bpistol', name: 'バーストピストル', short: 'Bピストル', group: 'heavy',
      desc: '3発 まとめて 撃つ ピストル。すばやく とどめを さそう',
      dmg: 22, rpm: 170, burst: { n: 3, rpm: 720 }, mag: 18, reload: 1.6, spread: 1.8, adsSpread: 0.6,
      range: 60, falloff: [14, 30, 0.6], recoil: [0.9, 0.3], zoom: 0.85, move: 1.08,
      proj: FB(160), tracer: C.bpis, sfx: 'shot_pistol',
      view: [b(0, 0.02, -0.08, 0.055, 0.065, 0.26, D), b(0, 0.015, -0.225, 0.035, 0.035, 0.05, C.bpis), b(0, -0.08, 0.04, 0.05, 0.13, 0.065, K),
        b(0, 0.058, -0.08, 0.014, 0.01, 0.18, C.bpis), b(0, -0.03, -0.16, 0.04, 0.035, 0.08, M)],
      muzzle: [0, 0.015, -0.255], stats: { power: 3, rate: 3, range: 2, mobility: 4, ease: 4 }
    }),
    G({
      id: 'musket', name: 'マスケット', short: 'マスケット', group: 'heavy',
      desc: 'ゆっくり とぶ 大きな 弾。弾は おちる。当たれば ほぼ 一撃',
      dmg: 160, rpm: 22, mag: 1, reload: 2.4, spread: 0.6, adsSpread: 0,
      range: 130, falloff: null, recoil: [4.0, 0.6], zoom: 0.6, move: 0.85,
      proj: P({ speed: 95, grav: 9, size: 0.1 }), tracer: C.musket, sfx: 'shot_sniper',
      view: [b(0, 0, 0.05, 0.06, 0.08, 0.3, WOOD), b(0, -0.03, 0.27, 0.07, 0.12, 0.18, WOOD), b(0, 0.02, -0.38, 0.03, 0.03, 0.62, M),
        b(0, -0.01, -0.22, 0.05, 0.04, 0.4, WOOD), b(0, 0.05, 0.04, 0.02, 0.03, 0.04, GOLD), b(0, 0.04, -0.68, 0.012, 0.02, 0.012, C.musket)],
      muzzle: [0, 0.02, -0.69], stats: { power: 5, rate: 1, range: 4, mobility: 2, ease: 1 }
    }),
    G({
      id: 'quadrkt', name: '4れんロケット', short: '4れんRKT', group: 'sp',
      desc: '小さな ロケットを 4発 つづけて 撃てる',
      dmg: 20, rpm: 180, mag: 4, reload: 3.0, spread: 1.5, adsSpread: 0.6,
      range: 110, falloff: null, recoil: [2.5, 0.5], zoom: 0.85, move: 1.0,
      proj: P({ speed: 34, size: 0.13, radius: 2.2, splashDmg: 45, splashMin: 0.25, selfMult: 0.5 }), tracer: C.quad, sfx: 'shot_rocket',
      view: [b(-0.05, 0.07, -0.12, 0.08, 0.08, 0.5, [0.24, 0.28, 0.22]), b(0.05, 0.07, -0.12, 0.08, 0.08, 0.5, [0.24, 0.28, 0.22]),
        b(-0.05, -0.02, -0.12, 0.08, 0.08, 0.5, [0.24, 0.28, 0.22]), b(0.05, -0.02, -0.12, 0.08, 0.08, 0.5, [0.24, 0.28, 0.22]),
        b(0, 0.025, -0.38, 0.19, 0.18, 0.03, C.quad), b(0, -0.12, 0.02, 0.045, 0.1, 0.05, K), b(0, 0.025, 0.16, 0.18, 0.17, 0.04, M)],
      muzzle: [0, 0.025, -0.40], stats: { power: 4, rate: 3, range: 3, mobility: 3, ease: 4 }
    }),
    G({
      id: 'nailgun', name: 'ネイルガン', short: 'ネイル', group: 'rapid',
      desc: 'クギを どんどん 撃ちだす。すこし おちるので 上を ねらって',
      dmg: 19, rpm: 700, auto: true, mag: 40, reload: 2.2, spread: 2.0, adsSpread: 1.0,
      range: 70, falloff: null, recoil: [0.4, 0.3], zoom: 0.85, move: 1.0,
      proj: P({ speed: 70, grav: 5, size: 0.06 }), tracer: C.nail, sfx: 'shot_needle',
      view: [b(0, 0.01, -0.04, 0.1, 0.13, 0.30, [0.85, 0.6, 0.2]), b(0, 0.02, -0.25, 0.045, 0.045, 0.14, M), b(0, -0.12, 0.06, 0.045, 0.12, 0.06, K),
        b(0, 0.1, -0.04, 0.06, 0.05, 0.22, M), b(0, 0.1, -0.04, 0.065, 0.015, 0.2, C.nail)],
      muzzle: [0, 0.02, -0.32], stats: { power: 3, rate: 4, range: 3, mobility: 3, ease: 3 }
    }),

    /* ---------------- スナイパー系（solo: これを もつと 2つめの 銃は もてない） ---------------- */
    G({
      id: 'antimat', name: '対物ライフル', short: '対物', group: 'sniper', solo: true,
      desc: 'かべを 1まい つらぬく ちょう おもい 弾。スナイパー系なので 銃は これ1つだけ',
      dmg: 260, rpm: 18, mag: 3, reload: 6.8, spread: 7.0, adsSpread: 0,
      range: 250, falloff: null, recoil: [8.0, 1.0], zoom: 0.25, move: 0.6,
      proj: FB(420, { size: 0.1, wallPierce: 1 }), tracer: C.anti, sfx: 'shot_sniper', tracerWidth: 0.09,
      view: [b(0, 0, 0, 0.1, 0.12, 0.34, D), b(0, -0.02, 0.27, 0.08, 0.14, 0.2, M), b(0, 0.015, -0.48, 0.04, 0.04, 0.62, L),
        b(0, 0.015, -0.81, 0.09, 0.07, 0.07, K), b(0, 0.12, -0.02, 0.065, 0.065, 0.34, K), b(0, 0.12, -0.2, 0.06, 0.06, 0.006, C.anti),
        b(0.035, -0.12, -0.6, 0.015, 0.14, 0.015, K), b(-0.035, -0.12, -0.6, 0.015, 0.14, 0.015, K), b(0, -0.11, 0.02, 0.07, 0.1, 0.12, M)],
      muzzle: [0, 0.015, -0.85], stats: { power: 5, rate: 1, range: 5, mobility: 1, ease: 1 }
    }),
    G({
      id: 'ssniper', name: 'セミオートスナイパー', short: 'セミスナ', group: 'sniper', solo: true,
      desc: 'つづけて 撃てる スナイパー。2発で たおせる。スナイパー系なので 銃は これ1つだけ',
      dmg: 92, rpm: 85, mag: 8, reload: 3.6, spread: 5.0, adsSpread: 0.05,
      range: 200, falloff: null, recoil: [3.2, 0.6], zoom: 0.35, move: 0.75,
      proj: FB(330, { size: 0.08 }), tracer: C.ssn, sfx: 'shot_dmr', tracerWidth: 0.06,
      view: [b(0, 0, 0, 0.085, 0.1, 0.3, D), b(0, -0.02, 0.24, 0.07, 0.13, 0.18, M), b(0, 0.015, -0.4, 0.032, 0.032, 0.5, L),
        b(0, 0.1, -0.02, 0.055, 0.055, 0.28, K), b(0, 0.1, -0.17, 0.05, 0.05, 0.006, C.ssn), b(0, -0.11, -0.04, 0.05, 0.11, 0.08, M),
        b(0.045, 0, 0, 0.006, 0.02, 0.24, C.ssn)],
      muzzle: [0, 0.015, -0.65], stats: { power: 4, rate: 2, range: 5, mobility: 2, ease: 2 }
    }),
    G({
      id: 'silent', name: 'サイレントスナイパー', short: 'サイレント', group: 'sniper', solo: true,
      desc: 'かるくて 走りやすい スナイパー。スナイパー系なので 銃は これ1つだけ',
      dmg: 115, rpm: 55, mag: 5, reload: 3.4, spread: 4.0, adsSpread: 0,
      range: 190, falloff: null, recoil: [2.6, 0.5], zoom: 0.4, move: 0.98,
      proj: FB(300, { size: 0.07 }), tracer: C.silent, sfx: 'shot_bow', tracerWidth: 0.05,
      view: [b(0, 0, 0, 0.075, 0.09, 0.28, K), b(0, -0.02, 0.22, 0.06, 0.11, 0.16, D), b(0, 0.015, -0.32, 0.03, 0.03, 0.36, M),
        b(0, 0.015, -0.56, 0.06, 0.06, 0.16, K), b(0, 0.095, -0.02, 0.05, 0.05, 0.24, K), b(0, 0.095, -0.145, 0.045, 0.045, 0.006, C.silent)],
      muzzle: [0, 0.015, -0.64], stats: { power: 4, rate: 2, range: 5, mobility: 4, ease: 2 }
    }),

    /* ---------------- ふしぎな 武器 ---------------- */
    G({
      id: 'blackhole', name: 'ブラックホールガン', short: 'ブラホ', group: 'myst',
      desc: 'ゆっくり とぶ 黒い玉。当たった所に ブラックホールが できて てきを すいこむ',
      dmg: 20, rpm: 40, mag: 2, reload: 3.5, spread: 0.5, adsSpread: 0,
      range: 60, falloff: null, recoil: [2.0, 0.4], zoom: 0.85, move: 0.95,
      proj: P({ speed: 18, size: 0.34, fuse: 2.6, field: { r: 5, dur: 3.5, pull: 15, dps: 22 } }), tracer: C.bh, sfx: 'shot_plasma',
      view: [b(0, 0, 0.05, 0.12, 0.13, 0.32, K), b(0, 0.01, -0.18, 0.16, 0.16, 0.14, C.bh), b(0, 0.01, -0.18, 0.08, 0.08, 0.15, [0.05, 0.02, 0.1]),
        b(0, 0.08, -0.34, 0.03, 0.03, 0.2, M), b(0, -0.06, -0.34, 0.03, 0.03, 0.2, M), b(0, -0.12, 0.08, 0.05, 0.11, 0.06, K)],
      muzzle: [0, 0.01, -0.44], stats: { power: 3, rate: 1, range: 2, mobility: 3, ease: 4 }
    }),
    G({
      id: 'thunder', name: 'いなずまガン', short: 'いなずま', group: 'myst',
      desc: '当たると いなずまが ちかくの てき 3人まで とびうつる',
      dmg: 38, rpm: 150, mag: 10, reload: 2.2, spread: 1.0, adsSpread: 0.3,
      range: 70, falloff: null, recoil: [1.2, 0.4], zoom: 0.85, move: 1.0,
      proj: FB(120, { size: 0.08, chain: { n: 3, r: 7, k: 0.6 } }), tracer: C.thunder, sfx: 'shot_rail', tracerWidth: 0.05,
      view: [b(0, 0, 0, 0.09, 0.11, 0.3, D), b(0.03, 0.01, -0.28, 0.02, 0.06, 0.26, C.thunder), b(-0.03, 0.01, -0.28, 0.02, 0.06, 0.26, C.thunder),
        b(0, 0.01, -0.28, 0.02, 0.02, 0.22, [1, 1, 1]), b(0, -0.1, 0.06, 0.045, 0.1, 0.05, K), b(0, 0.08, 0.02, 0.06, 0.04, 0.12, C.thunder)],
      muzzle: [0, 0.01, -0.42], stats: { power: 3, rate: 2, range: 3, mobility: 3, ease: 5 }
    }),
    G({
      id: 'boomer', name: 'ブーメラン', short: 'ブーメラン', group: 'myst',
      desc: 'なげると もどってくる。とちゅうの てきを ぜんぶ きる',
      dmg: 55, rpm: 80, mag: 2, reload: 1.2, spread: 0, adsSpread: 0,
      range: 40, falloff: null, recoil: [0.8, 0.2], zoom: 0.9, move: 1.08,
      proj: P({ speed: 26, size: 0.32, pierce: true, boomer: 0.6, hitR: 0.2 }), tracer: C.boomer, sfx: 'throw',
      view: [b(0.06, 0.02, -0.14, 0.26, 0.04, 0.08, C.boomer), b(-0.06, 0.02, -0.08, 0.08, 0.04, 0.2, C.boomer),
        b(0, -0.06, 0.04, 0.045, 0.12, 0.06, K), b(0.18, 0.02, -0.14, 0.04, 0.045, 0.06, dim(C.boomer, 0.6))],
      muzzle: [0, 0.02, -0.2], stats: { power: 4, rate: 2, range: 2, mobility: 4, ease: 3 }
    }),
    G({
      id: 'bubble', name: 'バブルガン', short: 'バブル', group: 'myst',
      desc: 'ふわふわ うかぶ シャボン玉。当たった てきは 上に うく',
      dmg: 12, rpm: 300, auto: true, mag: 24, reload: 2.0, spread: 4, adsSpread: 2.5,
      range: 40, falloff: null, recoil: [0.2, 0.2], zoom: 0.9, move: 1.05,
      proj: P({ speed: 14, grav: -2, size: 0.3, fuse: 2.5, knockUp: 6, hitR: 0.15 }), tracer: C.bubble, sfx: 'shot_plasma',
      view: [b(0, 0, 0.04, 0.1, 0.12, 0.26, [0.95, 0.55, 0.8]), b(0, 0.01, -0.16, 0.13, 0.13, 0.06, C.bubble), b(0, 0.01, -0.22, 0.08, 0.08, 0.06, W),
        b(0, 0.11, 0.0, 0.08, 0.08, 0.08, C.bubble), b(0, -0.1, 0.07, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.26], stats: { power: 1, rate: 4, range: 2, mobility: 4, ease: 4 }
    }),
    G({
      id: 'snowball', name: 'ゆきだまキャノン', short: 'ゆきだま', group: 'myst',
      desc: '当たった てきは 2秒間 うごきが おそくなる',
      dmg: 26, rpm: 150, mag: 6, reload: 2.0, spread: 1, adsSpread: 0.3,
      range: 60, falloff: null, recoil: [1.0, 0.3], zoom: 0.85, move: 1.0,
      proj: P({ speed: 40, grav: 10, size: 0.25 }), onHit: { slow: { mul: 0.55, dur: 2 } }, tracer: C.snow, sfx: 'throw',
      view: [b(0, 0, 0.02, 0.12, 0.12, 0.3, [0.35, 0.55, 0.85]), b(0, 0.01, -0.22, 0.14, 0.14, 0.16, W), b(0, 0.01, -0.31, 0.1, 0.1, 0.03, C.snow),
        b(0, -0.11, 0.08, 0.05, 0.1, 0.06, K)],
      muzzle: [0, 0.01, -0.33], stats: { power: 2, rate: 2, range: 2, mobility: 3, ease: 4 }
    }),
    G({
      id: 'fireworks', name: 'はなびランチャー', short: 'はなび', group: 'myst',
      desc: 'ドーンと はじけて 小さな はなびが とびちる',
      dmg: 15, rpm: 60, mag: 3, reload: 3.2, spread: 1, adsSpread: 0.3,
      range: 90, falloff: null, recoil: [2.2, 0.5], zoom: 0.85, move: 1.0,
      proj: P({ speed: 30, grav: 6, size: 0.18, fuse: 1.2, radius: 1.8, splashDmg: 30, splashMin: 0.3, selfMult: 0.3,
        cluster: { n: 6, dmg: 0, radius: 2.0, splash: 28, speed: 8 } }), tracer: C.fire, sfx: 'shot_grenade',
      view: [b(0, 0.02, -0.12, 0.13, 0.13, 0.5, [0.85, 0.3, 0.5]), b(0, 0.02, -0.38, 0.15, 0.15, 0.03, C.fire), b(0, 0.02, -0.12, 0.135, 0.03, 0.4, [1, 0.9, 0.3]),
        b(0, -0.1, 0.02, 0.045, 0.1, 0.05, K), b(0, 0.02, 0.14, 0.14, 0.14, 0.04, M)],
      muzzle: [0, 0.02, -0.40], stats: { power: 4, rate: 1, range: 3, mobility: 3, ease: 4 }
    }),
    G({
      id: 'mpod', name: 'ミサイルポッド', short: 'ミサイル', group: 'myst',
      desc: '4発の ミサイルが てきを おいかける',
      dmg: 10, rpm: 50, burst: { n: 4, rpm: 600 }, mag: 8, reload: 3.5, spread: 6, adsSpread: 4,
      range: 90, falloff: null, recoil: [1.2, 0.5], zoom: 0.85, move: 0.95,
      proj: P({ speed: 30, size: 0.12, homing: 3.5, homingCone: 35, radius: 1.5, splashDmg: 22, splashMin: 0.3, selfMult: 0.3 }), tracer: C.pod, sfx: 'shot_rocket',
      view: [b(0, 0.03, -0.08, 0.2, 0.16, 0.36, [0.3, 0.33, 0.28]), b(-0.05, 0.065, -0.265, 0.05, 0.05, 0.02, C.pod), b(0.05, 0.065, -0.265, 0.05, 0.05, 0.02, C.pod),
        b(-0.05, -0.005, -0.265, 0.05, 0.05, 0.02, C.pod), b(0.05, -0.005, -0.265, 0.05, 0.05, 0.02, C.pod), b(0, -0.1, 0.02, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.03, -0.28], stats: { power: 3, rate: 2, range: 3, mobility: 3, ease: 5 }
    }),
    G({
      id: 'drill', name: 'ドリルガン', short: 'ドリル', group: 'myst',
      desc: 'かべを 3まいまで つらぬく ドリル。かくれている てきに',
      dmg: 30, rpm: 240, auto: true, mag: 12, reload: 2.5, spread: 1.2, adsSpread: 0.6,
      range: 60, falloff: null, recoil: [0.9, 0.3], zoom: 0.85, move: 0.92,
      proj: P({ speed: 45, size: 0.12, wallPierce: 3 }), tracer: C.drill, sfx: 'shot_needle',
      view: [b(0, 0, 0.04, 0.11, 0.12, 0.3, [0.85, 0.65, 0.2]), b(0, 0.01, -0.18, 0.1, 0.1, 0.1, L), b(0, 0.01, -0.27, 0.07, 0.07, 0.08, L),
        b(0, 0.01, -0.34, 0.04, 0.04, 0.06, C.drill), b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.37], viewSpin: [1, 2, 3], spinup: 0, stats: { power: 3, rate: 3, range: 2, mobility: 3, ease: 4 }
    }),
    G({
      id: 'ukiuki', name: 'うきうきガン', short: 'うきうき', group: 'myst',
      desc: '当たった てきが ふわっと うきあがる。うかせて ねらい撃ち',
      dmg: 8, rpm: 400, auto: true, mag: 30, reload: 2.0, spread: 2.0, adsSpread: 1.0,
      range: 60, falloff: null, recoil: [0.3, 0.2], zoom: 0.88, move: 1.05,
      proj: FB(90, { size: 0.08, knockUp: 4 }), tracer: C.uki, sfx: 'shot_plasma',
      view: [b(0, 0, 0.02, 0.09, 0.11, 0.28, [0.25, 0.5, 0.4]), b(0, 0.01, -0.2, 0.06, 0.06, 0.16, C.uki), b(0, 0.12, 0.0, 0.03, 0.08, 0.03, C.uki),
        b(0, 0.18, 0.0, 0.08, 0.04, 0.08, C.uki), b(0, -0.1, 0.07, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.28], stats: { power: 1, rate: 4, range: 3, mobility: 4, ease: 4 }
    }),
    G({
      id: 'solar', name: 'ソーラーオーブ', short: 'ソーラー', group: 'myst',
      desc: 'ゆっくり すすむ 小さな たいよう。てきを つらぬいて もやす',
      dmg: 45, rpm: 40, mag: 2, reload: 3.0, spread: 0, adsSpread: 0,
      range: 60, falloff: null, recoil: [1.5, 0.3], zoom: 0.85, move: 0.95,
      proj: P({ speed: 16, size: 0.5, pierce: true, hitR: 0.25 }), onHit: { burn: { dps: 10, dur: 3 } }, tracer: C.solar, sfx: 'shot_plasma',
      view: [b(0, 0, 0.05, 0.12, 0.12, 0.28, [0.5, 0.25, 0.1]), b(0, 0.01, -0.16, 0.18, 0.18, 0.18, C.solar), b(0, 0.01, -0.16, 0.12, 0.12, 0.19, [1, 1, 0.8]),
        b(0, -0.1, 0.1, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.26], stats: { power: 4, rate: 1, range: 2, mobility: 3, ease: 4 }
    }),
    G({
      id: 'slime', name: 'スライムガン', short: 'スライム', group: 'myst',
      desc: 'ぽよんぽよん はねる スライム。当たると うごきが おそくなる',
      dmg: 14, rpm: 260, auto: true, mag: 20, reload: 2.2, spread: 2.5, adsSpread: 1.5,
      range: 50, falloff: null, recoil: [0.4, 0.3], zoom: 0.88, move: 1.0,
      proj: P({ speed: 35, grav: 8, size: 0.2, bounce: 3, bounceDamp: 0.75 }), onHit: { slow: { mul: 0.7, dur: 1.5 } }, tracer: C.slime, sfx: 'shot_grenade',
      view: [b(0, 0, 0.03, 0.1, 0.12, 0.28, [0.2, 0.45, 0.2]), b(0, 0.1, 0.02, 0.12, 0.08, 0.16, C.slime), b(0, 0.01, -0.2, 0.07, 0.07, 0.16, M),
        b(0, 0.01, -0.29, 0.09, 0.09, 0.03, C.slime), b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.31], stats: { power: 2, rate: 3, range: 2, mobility: 3, ease: 4 }
    }),
    G({
      id: 'wind', name: 'ふうりょくほう', short: 'かぜ', group: 'myst',
      desc: 'つよい かぜで てきを ふきとばす。おとすのに つかおう',
      dmg: 6, rpm: 100, pellets: 5, mag: 5, reload: 2.0, spread: 6, adsSpread: 5,
      range: 25, falloff: null, recoil: [2.0, 0.6], zoom: 0.95, move: 1.02,
      proj: FB(60, { size: 0.3, knock: 9, knockUp: 2 }), tracer: C.wind, sfx: 'smoke', tracerWidth: 0.08,
      view: [b(0, 0, 0.04, 0.1, 0.12, 0.26, [0.35, 0.55, 0.6]), b(0, 0.01, -0.16, 0.16, 0.16, 0.06, L), b(0, 0.01, -0.24, 0.22, 0.22, 0.1, C.wind),
        b(0, 0.01, -0.29, 0.18, 0.18, 0.01, [0.2, 0.3, 0.35]), b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.30], stats: { power: 1, rate: 2, range: 1, mobility: 4, ease: 4 }
    }),

    /* ---------------- 回復・サポート（コンピューターは つかわない） ---------------- */
    G({
      id: 'healgun', name: 'ヒールガン', short: 'ヒール', group: 'support', noBot: true,
      desc: 'みかたに 当てると 回復する。てきには すこし ダメージ',
      dmg: 5, rpm: 400, auto: true, mag: 40, reload: 2.0, spread: 1.5, adsSpread: 0.6,
      range: 60, falloff: null, recoil: [0.2, 0.1], zoom: 0.85, move: 1.05,
      proj: FB(90, { size: 0.08, heal: 9 }), tracer: C.heal, sfx: 'shot_plasma',
      view: [b(0, 0, 0.02, 0.09, 0.11, 0.3, W), b(0, 0.01, -0.22, 0.05, 0.05, 0.18, M), b(0, 0.09, 0.0, 0.08, 0.025, 0.025, C.heal),
        b(0, 0.09, 0.0, 0.025, 0.08, 0.025, C.heal), b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K), b(0, 0.01, -0.32, 0.07, 0.07, 0.03, C.heal)],
      muzzle: [0, 0.01, -0.34], stats: { power: 1, rate: 4, range: 3, mobility: 4, ease: 5 }
    }),
    G({
      id: 'medic', name: 'メディックランチャー', short: 'メディック', group: 'support', noBot: true,
      desc: 'はじけると まわりの みかたを まとめて 回復（じぶんも すこし）',
      dmg: 0, rpm: 70, mag: 3, reload: 2.5, spread: 0.5, adsSpread: 0.2,
      range: 70, falloff: null, recoil: [1.5, 0.3], zoom: 0.85, move: 1.0,
      proj: P({ speed: 24, grav: 12, size: 0.16, fuse: 1.5, heal: 35, healR: 3.5 }), tracer: C.medic, sfx: 'shot_grenade',
      view: [b(0, 0, 0.02, 0.1, 0.11, 0.24, W), b(0, -0.01, -0.12, 0.15, 0.15, 0.12, C.medic), b(0, 0.01, -0.28, 0.09, 0.09, 0.2, M),
        b(0, 0.01, -0.12, 0.155, 0.04, 0.04, [1, 1, 1]), b(0, -0.1, 0.07, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.39], stats: { power: 1, rate: 2, range: 3, mobility: 3, ease: 5 }
    }),
    G({
      id: 'guardgun', name: 'ガードガン', short: 'ガード', group: 'support', noBot: true,
      desc: 'みかたに 当てると 5秒間 うける ダメージが へる',
      dmg: 6, rpm: 250, auto: true, mag: 20, reload: 2.0, spread: 1.5, adsSpread: 0.6,
      range: 60, falloff: null, recoil: [0.3, 0.1], zoom: 0.85, move: 1.0,
      proj: FB(90, { size: 0.08, buff: { k: 'guard', dur: 5, mul: 0.6 } }), tracer: C.guard, sfx: 'shot_plasma',
      view: [b(0, 0, 0.02, 0.1, 0.12, 0.3, [0.2, 0.35, 0.6]), b(0, 0.01, -0.22, 0.05, 0.05, 0.16, M), b(0, 0.01, -0.12, 0.16, 0.14, 0.02, C.guard),
        b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.31], stats: { power: 1, rate: 3, range: 3, mobility: 3, ease: 5 }
    }),
    G({
      id: 'powergun', name: 'パワーガン', short: 'パワー', group: 'support', noBot: true,
      desc: 'みかたに 当てると 6秒間 こうげき力が 1.3倍',
      dmg: 6, rpm: 250, auto: true, mag: 20, reload: 2.0, spread: 1.5, adsSpread: 0.6,
      range: 60, falloff: null, recoil: [0.3, 0.1], zoom: 0.85, move: 1.0,
      proj: FB(90, { size: 0.08, buff: { k: 'pow', dur: 6, mul: 1.3 } }), tracer: C.pow, sfx: 'shot_plasma',
      view: [b(0, 0, 0.02, 0.1, 0.12, 0.3, [0.55, 0.15, 0.12]), b(0, 0.01, -0.22, 0.05, 0.05, 0.16, M), b(0, 0.1, -0.02, 0.06, 0.06, 0.06, C.pow),
        b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.31], stats: { power: 1, rate: 3, range: 3, mobility: 3, ease: 5 }
    }),
    G({
      id: 'speedgun', name: 'スピードガン', short: 'スピード', group: 'support', noBot: true,
      desc: 'みかたに 当てると 6秒間 足が はやくなる',
      dmg: 6, rpm: 250, auto: true, mag: 20, reload: 2.0, spread: 1.5, adsSpread: 0.6,
      range: 60, falloff: null, recoil: [0.3, 0.1], zoom: 0.85, move: 1.1,
      proj: FB(90, { size: 0.08, buff: { k: 'spd', dur: 6, mul: 1.35 } }), tracer: C.spd, sfx: 'shot_plasma',
      view: [b(0, 0, 0.02, 0.1, 0.12, 0.3, [0.55, 0.5, 0.12]), b(0, 0.01, -0.22, 0.05, 0.05, 0.16, M), b(0.06, 0.01, -0.02, 0.02, 0.06, 0.2, C.spd),
        b(-0.06, 0.01, -0.02, 0.02, 0.06, 0.2, C.spd), b(0, -0.1, 0.08, 0.045, 0.1, 0.05, K)],
      muzzle: [0, 0.01, -0.31], stats: { power: 1, rate: 3, range: 3, mobility: 5, ease: 5 }
    })
  ];

  /* CS1 の 銃に グループ。スナイパーは スナイパー系（solo） */
  for (const g of CS.Guns) {
    if (!g.group) g.group = GROUP1[g.id] || 'sp';
    if (g.id === 'sniper') { g.solo = true; g.desc = g.desc + '。スナイパー系なので 銃は これ1つだけ'; }
  }
  for (const g of NEW) { CS.Guns.push(g); CS.GunMap[g.id] = g; }
  for (const g of CS.Guns) bulletize(g);

  CS.Weapons.bulletize = bulletize;
  CS.Weapons.P = P;
  /* 銃の なかま（ぶきをえらぶ画面） */
  CS.Weapons.GROUPS = [
    { key: 'rifle', label: 'ライフル系', note: 'バランスよし。まよったらコレ' },
    { key: 'rapid', label: '連射系', note: 'たまをばらまいて押しきる' },
    { key: 'heavy', label: '一撃系', note: '当てれば大ダメージ' },
    { key: 'sniper', label: 'スナイパー系', note: 'これを もつと 銃は 1つだけ' },
    { key: 'shot', label: '散弾系', note: '近づいてドカン' },
    { key: 'sp', label: '特殊', note: 'ばくはつ・ビーム・ほのお' },
    { key: 'myst', label: 'ふしぎな武器', note: 'ブラックホール・いなずま・ブーメラン…' },
    { key: 'support', label: '回復・サポート', note: 'みかたを たすける（ボスレイドで 大活躍）' }
  ];
})();
