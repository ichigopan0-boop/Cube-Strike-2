/* ==========================================================================
   CUBE STRIKE 2 — parts.js
   部品（パーツ）: 銃 1つ1つに 部品を つけて 強くできる（さいしょから ぜんぶ 使える）。
   ・ふつうの 部品（20しゅるい）は おなじものを いくつでも かさねられる。
   ・とくしゅ部品（15しゅるい）は つよい かわりに なにかが よわくなる。1つの 銃に 1こまで。
   ・1つの 銃に ぜんぶで 30こ まで。部品を 1こ つけるごとに リロードが +30%（30こで 10倍）。
   ・部品は 銃の 3Dモデルにも 見える（スコープ・サイレンサー・マガジン など）。
   部品の きろく（mods）は 文字列: 部品の id（英小文字2つ）＋ 数。例 "dm3rt2hm1"
   CS.Parts.build(def, mods) で 部品つきの 銃の 定義（コピー）を作る。おなじ組み合わせは おぼえておく。
   部品なしなら もとの 定義を そのまま かえす（id も そのまま）。
   からだに つく こうか（体力・回復しない・うける ダメージ）は playerMods(guns) で まとめる。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  const MAX_TOTAL = 30;
  const RELOAD_PER = 0.3;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const isProj = (g) => !!(g && g.type === 'projectile' && g.proj);
  const isFlame = (g) => !!(g && g.type === 'flame');
  const isBeam = (g) => !!(g && g.type === 'beam');
  const pw = (x, k) => Math.pow(x, k);

  /* 部品の色（モデル・アイコン） */
  const COL = {
    metal: [0.30, 0.33, 0.40], dark: [0.12, 0.13, 0.17], light: [0.62, 0.67, 0.76],
    red: [1.0, 0.25, 0.3], gold: [1.0, 0.8, 0.3], blue: [0.4, 0.75, 1.0], green: [0.45, 1.0, 0.55]
  };

  /* ======================================================================
     部品の いちらん
     ok(g): この銃に つけられるか / apply(g, k): k こ ぶんの こうか / pm: からだに つく こうか
     vis(v, k, add): 3Dモデル（v = 銃の 大きさ・銃口。add(cx,cy,cz,sx,sy,sz,色)）
     ====================================================================== */
  const LIST = [
    /* ---------------- ふつうの 部品（かさねられる） ---------------- */
    {
      id: 'dm', name: '強化バレル', icon: '力', col: [1.0, 0.55, 0.35], pros: 'ダメージ +7%（1こごと）',
      ok: () => true,
      apply: (g, k) => scaleDmg(g, 1 + 0.07 * k),
      vis: (v, k, add) => { for (let i = 0; i < Math.min(k, 4); i++) ring(add, v, v.mz + 0.04 + i * 0.035, 0.028, [1.0, 0.55, 0.35]); }
    },
    {
      id: 'rt', name: '連射モーター', icon: '速', col: [1.0, 0.85, 0.3], pros: '連射 +7%（1こごと）',
      ok: () => true,
      apply: (g, k) => scaleRate(g, 1 + 0.07 * k),
      vis: (v, k, add) => { const s = 0.04 + 0.012 * Math.min(k, 5); add(v.maxX + s / 2, v.cy, v.cz + 0.05, s, s, s * 1.4, [1.0, 0.85, 0.3]); }
    },
    {
      id: 'mg', name: '拡張マガジン', icon: '弾', col: [0.7, 0.75, 0.85], pros: '弾の数 +15%（1こごと）',
      ok: () => true,
      apply: (g, k) => { g.mag = Math.max(g.mag + k, Math.round(g.mag * (1 + 0.15 * k))); },
      vis: (v, k, add) => { const h = 0.08 + 0.03 * Math.min(k, 5); add(v.cx, v.minY - h / 2 + 0.02, v.cz - 0.04, 0.05, h, 0.07, [0.55, 0.6, 0.7]); }
    },
    {
      id: 'sc', name: 'スコープ', icon: '目', col: [0.5, 0.85, 1.0], pros: 'のぞくと 大きく見える・ねらいが まとまる',
      ok: (g) => !isFlame(g),
      apply: (g, k) => { g.zoom = Math.max(0.18, (g.zoom < 1 ? g.zoom : 0.92) * pw(0.88, k)); g.adsSpread = (g.adsSpread || 0) * pw(0.85, k); },
      vis: (v, k, add) => {
        const len = 0.14 + 0.04 * Math.min(k, 5), y = v.maxY + 0.045;
        add(v.cx, y, v.cz - 0.02, 0.05, 0.05, len, COL.dark);
        add(v.cx, y, v.cz - 0.02 - len / 2, 0.06, 0.06, 0.02, COL.metal);
        add(v.cx, y, v.cz - 0.02 - len / 2 - 0.011, 0.045, 0.045, 0.004, [0.5, 0.85, 1.0]);
        add(v.cx, v.maxY + 0.01, v.cz - 0.02, 0.02, 0.025, 0.04, COL.metal);
      }
    },
    {
      id: 'sl', name: 'サイレンサー', icon: '静', col: [0.55, 0.58, 0.66], pros: 'はんどう -12%・ひろがり -6%',
      ok: (g) => !isFlame(g),
      apply: (g, k) => { g.recoil[0] *= pw(0.88, k); g.recoil[1] *= pw(0.88, k); g.spread *= pw(0.94, k); },
      vis: (v, k, add) => { const len = 0.1 + 0.025 * Math.min(k, 6); muzzleExt(v, len, 0.05, COL.dark, add); }
    },
    {
      id: 'gp', name: 'グリップ', icon: '持', col: [0.6, 0.5, 0.4], pros: 'はんどう -18%',
      ok: () => true,
      apply: (g, k) => { g.recoil[0] *= pw(0.82, k); g.recoil[1] *= pw(0.82, k); },
      vis: (v, k, add) => { const h = 0.07 + 0.015 * Math.min(k, 4); add(v.cx, v.minY - h / 2 + 0.01, v.minZ * 0.55 + v.maxZ * 0.45 - 0.05, 0.035, h, 0.04, [0.4, 0.33, 0.27]); }
    },
    {
      id: 'ls', name: 'レーザーサイト', icon: '光', col: [1.0, 0.25, 0.3], pros: 'のぞかない ときの ひろがり -15%',
      ok: () => true,
      apply: (g, k) => { g.spread *= pw(0.85, k); },
      vis: (v, k, add) => { add(-v.maxX + -0.02, v.cy - 0.01, v.minZ * 0.5 + v.cz * 0.5, 0.03, 0.03, 0.08, COL.dark); add(-v.maxX - 0.02, v.cy - 0.01, v.minZ * 0.5 + v.cz * 0.5 - 0.045, 0.018, 0.018, 0.01, [1.0, 0.2, 0.25]); }
    },
    {
      id: 'lb', name: 'ロングバレル', icon: '長', col: [0.65, 0.7, 0.8], pros: 'しゃてい +12%・弾が はやく とおくまで',
      ok: () => true,
      apply: (g, k) => {
        g.range *= 1 + 0.12 * k;
        if (g.falloff) { g.falloff[0] *= 1 + 0.12 * k; g.falloff[1] *= 1 + 0.12 * k; }
        if (g.proj) g.proj.speed *= 1 + 0.08 * k;
        if (g.flame) g.flame.range *= 1 + 0.06 * k;
      },
      vis: (v, k, add) => { muzzleExt(v, 0.08 * Math.min(k, 5), 0.03, COL.light, add); }
    },
    {
      id: 'st', name: '軽量ストック', icon: '足', col: [0.5, 1.0, 0.7], pros: '走る はやさ +3.5%',
      ok: () => true,
      apply: (g, k) => { g.move *= 1 + 0.035 * k; },
      vis: (v, k, add) => { const len = 0.08 + 0.02 * Math.min(k, 5); add(v.cx, v.cy - 0.01, v.maxZ + len / 2, 0.03, 0.05, len, [0.45, 0.9, 0.65]); }
    },
    {
      id: 'hv', name: '高速弾', icon: '矢', col: [1.0, 0.95, 0.5], pros: '弾の はやさ +20%',
      ok: (g) => isProj(g),
      apply: (g, k) => { g.proj.speed *= 1 + 0.2 * k; },
      vis: (v, k, add) => { add(v.cx + 0.035, v.my, v.mz + 0.08, 0.02, 0.02, 0.1, [1.0, 0.95, 0.5]); }
    },
    {
      id: 'bc', name: '大口径', icon: '大', col: [1.0, 0.4, 0.25], pros: 'ダメージ +12%', cons: 'はんどう +10%',
      ok: () => true,
      apply: (g, k) => { scaleDmg(g, 1 + 0.12 * k); g.recoil[0] *= 1 + 0.1 * k; g.recoil[1] *= 1 + 0.1 * k; },
      vis: (v, k, add) => { const s = 0.06 + 0.012 * Math.min(k, 5); add(v.mx, v.my, v.mz + 0.015, s, s, 0.03, [0.9, 0.35, 0.22]); }
    },
    {
      id: 'dr', name: 'ドラムマガジン', icon: '丸', col: [0.75, 0.6, 0.4], pros: '弾の数 +35%', cons: '走る はやさ -2.5%',
      ok: () => true,
      apply: (g, k) => { g.mag = Math.max(g.mag + k, Math.round(g.mag * (1 + 0.35 * k))); g.move *= Math.max(0.5, 1 - 0.025 * k); },
      vis: (v, k, add) => { const s = 0.1 + 0.025 * Math.min(k, 4); add(v.cx, v.minY - s / 2 + 0.02, v.cz + 0.02, s * 0.9, s, s, [0.55, 0.42, 0.28]); }
    },
    {
      id: 'cl', name: '冷却装置', icon: '冷', col: [0.5, 0.9, 1.0], pros: '連射 +4%・はんどう -5%',
      ok: () => true,
      apply: (g, k) => { scaleRate(g, 1 + 0.04 * k); g.recoil[0] *= pw(0.95, k); g.recoil[1] *= pw(0.95, k); },
      vis: (v, k, add) => { for (let i = 0; i < Math.min(k, 4); i++) add(v.cx, v.maxY + 0.012, v.cz - 0.06 - i * 0.035, 0.07, 0.024, 0.012, [0.5, 0.9, 1.0]); }
    },
    {
      id: 'sb', name: 'スタビライザー', icon: '安', col: [0.7, 0.6, 1.0], pros: 'のぞいた ときの ひろがり -25%',
      ok: (g) => !isFlame(g),
      apply: (g, k) => { g.adsSpread = (g.adsSpread || 0) * pw(0.75, k); },
      vis: (v, k, add) => { add(v.cx, v.minY + 0.01, v.minZ * 0.7 + v.maxZ * 0.3, 0.09, 0.02, 0.05, [0.6, 0.5, 0.9]); }
    },
    {
      id: 'qc', name: 'クイックチャージ', icon: '溜', col: [0.45, 0.8, 1.0], pros: 'ためる時間・回りだす時間が みじかく',
      ok: (g) => g.charge > 0 || g.spinup > 0,
      apply: (g, k) => { if (g.charge > 0) g.charge *= pw(0.88, k); if (g.spinup > 0) g.spinup *= pw(0.85, k); },
      vis: (v, k, add) => { add(v.maxX + 0.02, v.cy + 0.02, v.maxZ - 0.08, 0.04, 0.06, 0.08, [0.45, 0.8, 1.0]); }
    },
    {
      id: 'bl', name: '爆風拡大', icon: '爆', col: [1.0, 0.6, 0.2], pros: 'ばくはつ・ブラックホール・回復の はんい +12%',
      ok: (g) => isProj(g) && (g.proj.radius > 0 || !!g.proj.field || g.proj.healR > 0),
      apply: (g, k) => {
        const p = g.proj;
        if (p.radius > 0) p.radius *= 1 + 0.12 * k;
        if (p.field) p.field.r *= 1 + 0.08 * k;
        if (p.healR > 0) p.healR *= 1 + 0.1 * k;
        if (p.cluster) p.cluster.radius *= 1 + 0.08 * k;
      },
      vis: (v, k, add) => { add(v.cx, v.maxY + 0.03, v.maxZ - 0.06, 0.06, 0.06, 0.06, [1.0, 0.6, 0.2]); }
    },
    {
      id: 'pe', name: '散弾追加', icon: '散', col: [1.0, 0.75, 0.4], pros: '散弾の つぶ +1', cons: 'ひろがり +4%',
      ok: (g) => (g.pellets | 0) > 1,
      apply: (g, k) => { g.pellets = (g.pellets | 0) + k; g.spread *= 1 + 0.04 * k; g.adsSpread *= 1 + 0.04 * k; },
      vis: (v, k, add) => { for (let i = 0; i < Math.min(k, 4); i++) add(v.maxX + 0.012, v.cy - 0.02, v.cz + 0.06 - i * 0.03, 0.012, 0.025, 0.02, [1.0, 0.75, 0.4]); }
    },
    {
      id: 'ft', name: '燃料タンク', icon: '炎', col: [1.0, 0.45, 0.15], pros: 'かえんの とどく きょり +10%',
      ok: (g) => isFlame(g),
      apply: (g, k) => { g.flame.range *= 1 + 0.1 * k; g.range = g.flame.range; },
      vis: (v, k, add) => { add(v.cx + 0.09, v.minY + 0.02, v.cz, 0.08, 0.1, 0.16, [0.9, 0.3, 0.12]); }
    },
    {
      id: 'en', name: 'エネルギーセル', icon: '電', col: [1.0, 0.35, 0.85], pros: 'ビームの ダメージ +6%・エネルギー +10%',
      ok: (g) => isBeam(g),
      apply: (g, k) => { g.dmg *= 1 + 0.06 * k; g.mag = Math.round(g.mag * (1 + 0.1 * k)); },
      vis: (v, k, add) => { add(v.cx, v.minY - 0.02, v.cz + 0.08, 0.06, 0.06, 0.1, [1.0, 0.35, 0.85]); }
    },
    {
      id: 'ap', name: 'アーマー板', icon: '盾', col: [0.6, 0.7, 0.8], pros: 'さいだいHP +6（からだに つく）', cons: '走る はやさ -1.5%',
      ok: () => true,
      apply: (g, k) => { g.move *= pw(0.985, k); },
      pm: (m, k) => { m.hpAdd += 6 * k; },
      vis: (v, k, add) => { add(v.cx - 0.045, v.cy, v.cz, 0.012, 0.08, 0.14, [0.55, 0.62, 0.72]); }
    },

    /* ---------------- とくしゅ部品（1こまで。つよいけど なにかが よわくなる） ---------------- */
    {
      id: 'hm', name: 'ホーミング弾', icon: '追', col: [1.0, 0.45, 0.9], s: true,
      pros: '弾が てきを おいかける', cons: '弾が おそくなる（45m/秒まで）・ダメージ ×0.7',
      ok: (g) => isProj(g),
      apply: (g) => { const p = g.proj; p.homing = Math.max(p.homing || 0, 4); p.homingCone = Math.max(p.homingCone || 0, 30); p.speed = Math.min(p.speed, 45); p.fast = false; scaleDmg(g, 0.7); },
      vis: (v, k, add) => special(v, add, [1.0, 0.45, 0.9], 0)
    },
    {
      id: 'wp', name: '壁貫通', icon: '貫', col: [0.75, 0.45, 1.0], s: true,
      pros: '弾が かべを 1まい すりぬける', cons: 'さいだいHPが はんぶん（からだに つく）',
      ok: (g) => isProj(g),
      apply: (g) => { g.proj.wallPierce = (g.proj.wallPierce || 0) + 1; },
      pm: (m) => { m.hpMul = Math.min(m.hpMul, 0.5); },
      vis: (v, k, add) => special(v, add, [0.75, 0.45, 1.0], 1)
    },
    {
      id: 'bo', name: '跳弾', icon: '跳', col: [0.7, 0.55, 1.0], s: true,
      pros: '弾が かべで 3回 はねる', cons: 'ダメージ ×0.8',
      ok: (g) => isProj(g),
      apply: (g) => { const p = g.proj; if (!(p.bounce > 0)) p.bounceDamp = 0.9; p.bounce = (p.bounce || 0) + 3; scaleDmg(g, 0.8); },
      vis: (v, k, add) => special(v, add, [0.7, 0.55, 1.0], 2)
    },
    {
      id: 'ex', name: '爆発弾', icon: '爆', col: [1.0, 0.5, 0.15], s: true,
      pros: '当たった所で ばくはつ', cons: 'じぶんも ばくふうで けがをする・連射 ×0.7',
      ok: (g) => isProj(g) && !(g.proj.healR > 0) && g.dmg > 0,
      apply: (g) => {
        const p = g.proj;
        p.radius = Math.max(p.radius || 0, 1.6);
        p.splashDmg = (p.splashDmg || 0) + g.dmg * 0.5;
        if (!(p.splashMin > 0)) p.splashMin = 0.3;
        p.selfMult = Math.max(p.selfMult || 0, 0.6);
        scaleRate(g, 0.7);
      },
      vis: (v, k, add) => special(v, add, [1.0, 0.5, 0.15], 3)
    },
    {
      id: 'pc', name: '貫通弾', icon: '突', col: [0.4, 0.95, 1.0], s: true,
      pros: '弾が てきを つらぬいて うしろの てきにも 当たる', cons: '弾の数 ×0.6',
      ok: (g) => isProj(g),
      apply: (g) => { g.proj.pierce = true; g.mag = Math.max(1, Math.round(g.mag * 0.6)); },
      vis: (v, k, add) => special(v, add, [0.4, 0.95, 1.0], 4)
    },
    {
      id: 'vp', name: '吸血', icon: '吸', col: [0.85, 0.1, 0.25], s: true,
      pros: 'あたえた ダメージの 20% 回復', cons: 'じぶんで 回復しなくなる（からだに つく）',
      ok: (g) => g.dmg > 0,
      apply: (g) => { g.lifesteal = 0.2; },
      pm: (m) => { m.noRegen = true; },
      vis: (v, k, add) => special(v, add, [0.85, 0.1, 0.25], 5)
    },
    {
      id: 'ms', name: 'マルチショット', icon: '多', col: [1.0, 0.85, 0.4], s: true,
      pros: '弾が 3つに ふえる（散弾は 2倍）', cons: '1つぶの ダメージ ×0.45・ひろがる',
      ok: (g) => isProj(g),
      apply: (g) => { g.pellets = (g.pellets | 0) > 1 ? (g.pellets | 0) * 2 : 3; scaleDmg(g, 0.45); g.spread += 2.5; g.adsSpread = (g.adsSpread || 0) + 2; },
      vis: (v, k, add) => special(v, add, [1.0, 0.85, 0.4], 6)
    },
    {
      id: 'fz', name: 'スロー弾', icon: '遅', col: [0.6, 0.9, 1.0], s: true,
      pros: '当たった てきの 足が 1.5秒 おそくなる', cons: 'ダメージ ×0.75',
      ok: (g) => g.dmg > 0,
      apply: (g) => { g.onHit = Object.assign({}, g.onHit || {}, { slow: { mul: 0.6, dur: 1.5 } }); scaleDmg(g, 0.75); },
      vis: (v, k, add) => special(v, add, [0.6, 0.9, 1.0], 7)
    },
    {
      id: 'fi', name: '炎上弾', icon: '燃', col: [1.0, 0.4, 0.1], s: true,
      pros: '当たった てきが もえる（2秒）', cons: 'しゃてい ×0.65',
      ok: (g) => g.dmg > 0 && !isFlame(g),
      apply: (g) => {
        g.onHit = Object.assign({}, g.onHit || {}, { burn: { dps: 8, dur: 2 } });
        g.range *= 0.65;
        if (g.falloff) { g.falloff[0] *= 0.65; g.falloff[1] *= 0.65; }
      },
      vis: (v, k, add) => special(v, add, [1.0, 0.4, 0.1], 8)
    },
    {
      id: 'gi', name: '巨大弾', icon: '巨', col: [0.95, 0.95, 0.6], s: true,
      pros: '弾が 大きくなって 当てやすい・ダメージ ×1.25', cons: '弾が おそい・走る はやさ ×0.85',
      ok: (g) => isProj(g),
      apply: (g) => { const p = g.proj; p.size *= 2.5; p.hitR = (p.hitR || 0) + 0.3; p.speed *= 0.55; scaleDmg(g, 1.25); g.move *= 0.85; g.tracerWidth = (g.tracerWidth || 0.03) * 2.2; },
      vis: (v, k, add) => special(v, add, [0.95, 0.95, 0.6], 9)
    },
    {
      id: 'bz', name: '狂戦士', icon: '狂', col: [1.0, 0.15, 0.15], s: true,
      pros: 'ダメージ ×1.6', cons: 'うける ダメージ ×1.4（からだに つく）',
      ok: (g) => g.dmg > 0,
      apply: (g) => scaleDmg(g, 1.6),
      pm: (m) => { m.takeMul = Math.max(m.takeMul, 1.4); },
      vis: (v, k, add) => special(v, add, [1.0, 0.15, 0.15], 10)
    },
    {
      id: 'kb', name: 'ノックバック弾', icon: '押', col: [0.7, 1.0, 0.9], s: true,
      pros: '当たった てきを ふきとばす', cons: '連射 ×0.75',
      ok: (g) => isProj(g),
      apply: (g) => { g.proj.knock = Math.max(g.proj.knock || 0, 7); scaleRate(g, 0.75); },
      vis: (v, k, add) => special(v, add, [0.7, 1.0, 0.9], 11)
    },
    {
      id: 'ch', name: 'チェイン弾', icon: '雷', col: [1.0, 0.95, 0.35], s: true,
      pros: '当たると いなずまが ちかくの てき 2人に とぶ', cons: '弾の数 ×0.7',
      ok: (g) => isProj(g) && g.dmg > 0,
      apply: (g) => { if (!g.proj.chain) g.proj.chain = { n: 2, r: 6, k: 0.5 }; g.mag = Math.max(1, Math.round(g.mag * 0.7)); },
      vis: (v, k, add) => special(v, add, [1.0, 0.95, 0.35], 12)
    },
    {
      id: 'hl', name: 'ヒール弾', icon: '癒', col: [0.4, 1.0, 0.6], s: true,
      pros: 'みかたに 当てると 回復する', cons: 'てきへの ダメージ ×0.5',
      ok: (g) => isProj(g) && !(g.proj.heal > 0) && g.dmg > 0,
      apply: (g) => { g.proj.heal = Math.max(1, Math.round(g.dmg * 0.5)); scaleDmg(g, 0.5); },
      vis: (v, k, add) => special(v, add, [0.4, 1.0, 0.6], 13)
    },
    {
      id: 'tb', name: 'ダッシュモジュール', icon: '翔', col: [0.4, 1.0, 1.0], s: true,
      pros: '走る はやさ ×1.2', cons: 'さいだいHP ×0.75（からだに つく）',
      ok: () => true,
      apply: (g) => { g.move *= 1.2; },
      pm: (m) => { m.hpMul = Math.min(m.hpMul, 0.75); },
      vis: (v, k, add) => special(v, add, [0.4, 1.0, 1.0], 14)
    }
  ];
  const MAP = {};
  LIST.forEach((p, i) => { p.order = i; p.s = !!p.s; MAP[p.id] = p; });

  /* ---------- こうかの 道具 ---------- */
  function scaleDmg(g, m) {
    g.dmg *= m;
    const p = g.proj;
    if (p) {
      if (p.splashDmg > 0) p.splashDmg *= m;
      if (p.field) p.field.dps *= m;
      if (p.cluster) p.cluster.splash *= m;
    }
  }
  function scaleRate(g, m) {
    g.rpm *= m;
    if (g.burst) g.burst.rpm *= m;
    if (g.flame) g.flame.tick *= m;
  }

  /* ---------- モデルの 道具 ---------- */
  /* 銃身の まわりの 輪（4まいの 板） */
  function ring(add, v, z, r, c) {
    add(v.mx, v.my + r, z, r * 2.2, 0.012, 0.022, c);
    add(v.mx, v.my - r, z, r * 2.2, 0.012, 0.022, c);
    add(v.mx + r, v.my, z, 0.012, r * 2.2, 0.022, c);
    add(v.mx - r, v.my, z, 0.012, r * 2.2, 0.022, c);
  }
  /* 銃口の 先に 筒を のばす（銃口も 前へ） */
  function muzzleExt(v, len, s, c, add) {
    if (!(len > 0)) return;
    add(v.mx, v.my, v.mz - len / 2, s, s, len, c);
    if (v.m2) add(v.m2x, v.m2y, v.mz - len / 2, s, s, len, c);
    v.mz -= len;
  }
  /* とくしゅ部品: 銃の よこに 光る しるし（ばしょは 部品ごとに ずらす）＋ 銃口に 光る 輪 */
  function special(v, add, c, i) {
    const z = v.maxZ - 0.05 - (i % 5) * 0.045, y = v.cy + (i >= 5 ? (i >= 10 ? -0.035 : 0.035) : 0);
    add(v.maxX + 0.018, y, z, 0.03, 0.03, 0.03, c);
    ring(add, v, v.mz + 0.01 + (v.sp++) * 0.012, 0.022 + v.sp * 0.006, c);
  }

  /* ======================================================================
     mods（文字列）の よみかき
     ====================================================================== */
  function parse(str) {
    const out = {};
    if (typeof str !== 'string' || !str) return out;
    const re = /([a-z]{2})(\d{1,3})/g;
    let m, guard = 0;
    while ((m = re.exec(str.slice(0, 200))) && guard++ < 60) {
      const id = m[1], n = Math.min(99, m[2] | 0);
      if (MAP[id] && n > 0) out[id] = (out[id] || 0) + n;
    }
    return out;
  }
  function stringify(obj) {
    let s = '';
    for (const p of LIST) { const n = obj[p.id] | 0; if (n > 0) s += p.id + n; }
    return s;
  }
  /* 正しい形に: つけられない 部品・とくしゅ部品の 2こめ・30こを こえた分を すてる */
  function clean(str, def) {
    const o = parse(str), out = {};
    let total = 0;
    /* とくしゅ部品（1こずつ）を 先に かぞえる */
    for (let pass = 0; pass < 2; pass++) {
      for (const p of LIST) {
        if (p.s !== (pass === 0)) continue;
        let n = o[p.id] | 0;
        if (n <= 0) continue;
        if (def && !p.ok(def)) continue;
        if (p.s) n = 1;
        n = Math.min(n, MAX_TOTAL - total);
        if (n <= 0) continue;
        out[p.id] = n;
        total += n;
      }
    }
    return stringify(out);
  }
  function total(str) { const o = parse(str); let n = 0; for (const k in o) n += o[k]; return n; }

  /* ======================================================================
     部品つきの 銃を 作る
     ====================================================================== */
  const cache = new Map();
  function copyDef(base) {
    const g = Object.assign({}, base);
    if (base.proj) {
      g.proj = Object.assign({}, base.proj);
      for (const k of ['chain', 'cluster', 'field', 'buff']) if (base.proj[k]) g.proj[k] = Object.assign({}, base.proj[k]);
    }
    g.recoil = base.recoil ? base.recoil.slice() : [0.5, 0.2];
    g.falloff = base.falloff ? base.falloff.slice() : null;
    g.burst = base.burst ? Object.assign({}, base.burst) : 0;
    if (base.flame) g.flame = Object.assign({}, base.flame, { burn: base.flame.burn ? Object.assign({}, base.flame.burn) : null });
    if (base.beam) g.beam = Object.assign({}, base.beam);
    if (base.onHit) g.onHit = Object.assign({}, base.onHit);
    g.view = (base.view || []).slice();
    g.muzzle = (base.muzzle || [0, 0, -0.4]).slice();
    g.muzzle2 = base.muzzle2 ? base.muzzle2.slice() : null;
    g.stats = Object.assign({}, base.stats || {});
    g._child = null;
    return g;
  }
  /* 銃の 大きさ（モデルの はこ から） */
  function bounds(def) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of def.view || []) {
      if (!v || v.length < 6) continue;
      x0 = Math.min(x0, v[0] - v[3] / 2); x1 = Math.max(x1, v[0] + v[3] / 2);
      y0 = Math.min(y0, v[1] - v[4] / 2); y1 = Math.max(y1, v[1] + v[4] / 2);
      z0 = Math.min(z0, v[2] - v[5] / 2); z1 = Math.max(z1, v[2] + v[5] / 2);
    }
    if (!(x1 > x0)) { x0 = -0.05; x1 = 0.05; y0 = -0.05; y1 = 0.05; z0 = -0.4; z1 = 0.1; }
    const m = def.muzzle || [0, 0, z0];
    /* 2ちょう（デュアル）の 銃は まんなかの 銃身を 右の 銃に */
    return {
      minX: x0, maxX: def.muzzle2 ? m[0] + 0.03 : x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1,
      cx: def.muzzle2 ? m[0] : (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2,
      mx: m[0], my: m[1], mz: m[2], m2: !!def.muzzle2, m2x: def.muzzle2 ? def.muzzle2[0] : 0, m2y: def.muzzle2 ? def.muzzle2[1] : 0,
      sp: 0
    };
  }

  function build(base, str) {
    if (!base || typeof str !== 'string' || !str) return base;
    const key = base.id + '|' + str;
    let g = cache.get(key);
    if (g) return g;
    const o = parse(clean(str, base));
    let n = 0;
    for (const k in o) n += o[k];
    if (!n) return base;
    g = copyDef(base);
    /* こうか（ふつうの 部品 → とくしゅ部品 の じゅん） */
    for (const p of LIST) { const k = o[p.id] | 0; if (k > 0) p.apply(g, k); }
    /* リロード: 1こごとに +30% */
    g.reload = Math.min(300, (base.reload || 1) * (1 + RELOAD_PER * n));
    /* はみださないように */
    g.rpm = clamp(g.rpm, 1, 3000);
    if (g.burst) g.burst.rpm = clamp(g.burst.rpm, 1, 3600);
    g.mag = clamp(Math.round(g.mag), 1, 999);
    g.zoom = clamp(g.zoom, 0.15, 1);
    g.move = clamp(g.move, 0.35, 1.8);
    g.spread = Math.max(0, g.spread); g.adsSpread = Math.max(0, g.adsSpread || 0);
    g.pellets = clamp(g.pellets | 0, 1, 40);
    if (g.proj) g.proj.speed = clamp(g.proj.speed, 5, 600);
    if (g.flame) g.flame.tick = clamp(g.flame.tick, 1, 40);
    /* 見た目（部品の はこ を たす） */
    const v = bounds(base);
    const add = (cx, cy, cz, sx, sy, sz, c) => { g.view.push([cx, cy, cz, sx, sy, sz, c[0], c[1], c[2]]); };
    for (const p of LIST) { const k = o[p.id] | 0; if (k > 0 && p.vis) p.vis(v, k, add); }
    const dz = v.mz - (base.muzzle ? base.muzzle[2] : v.mz);
    if (dz) { g.muzzle[2] += dz; if (g.muzzle2) g.muzzle2[2] += dz; }
    g.mods = stringify(o);
    g.partsN = n;
    g.base = base;
    if (cache.size > 300) cache.clear();
    cache.set(key, g);
    return g;
  }

  /* からだに つく こうか（もっている 銃 ぜんぶ から） */
  function playerMods(guns) {
    const m = { hpMul: 1, hpAdd: 0, noRegen: false, takeMul: 1 };
    for (const g of guns || []) {
      if (!g || !g.mods) continue;
      const o = parse(g.mods);
      for (const id in o) { const p = MAP[id]; if (p && p.pm) p.pm(m, o[id]); }
    }
    m.hpAdd = Math.min(60, m.hpAdd);
    return m;
  }

  /* 説明（ぶきの画面）: [{name, n, pros, cons, s}] */
  function describe(str) {
    const o = parse(str), out = [];
    for (const p of LIST) { const n = o[p.id] | 0; if (n > 0) out.push({ id: p.id, name: p.name, n: n, pros: p.pros || '', cons: p.cons || '', s: p.s }); }
    return out;
  }

  CS.Parts = {
    LIST: LIST, MAP: MAP, MAX_TOTAL: MAX_TOTAL, RELOAD_PER: RELOAD_PER,
    parse: parse, stringify: stringify, clean: clean, total: total, build: build,
    playerMods: playerMods, describe: describe
  };
})();
