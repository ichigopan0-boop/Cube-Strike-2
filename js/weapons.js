/* ==========================================================================
   CUBE STRIKE — weapons.js
   21種の銃（CS.Guns / CS.GunMap）と8種のボム（CS.Bombs / CS.BombMap）。v5: ギガバースト・よわよわボム・ワープボム を追加
   v5.1: アサルトの連射 1.7倍・ホーミングニードルを よわく・こおりボム を追加
   v2: どこに当てても同じダメージ（dmg は旧ヘッドショット値・hs は全部 1）。
       歩いてもジャンプしてもぶれないので moveSpread は全部 0。
   v3.2（バランス調整）: コンピューターどうしの 1対1 を よわい・ふつう・つよい で 総当たりさせて、
       勝率が まんなかに よるように 連射（rpm・バースト・かえんの回数・回りはじめ・ためる時間）・リロード・機動（move）を
       調整した（ダメージは そのまま）。stats.ease（あつかいやすさ）は つよいCPU と よわいCPU の 勝率の差から:
       差（つよい−よわい）≤ −15 → 5 / ≤ −5 → 4 / < 5 → 3 / < 15 → 2 / それ以上 → 1（よわくても勝てる銃ほど 大きい）。
       stats.rate / mobility も 新しい数値に あわせた。
   view: 銃のモデル（箱の並び）[cx,cy,cz, sx,sy,sz, r,g,b]
         銃ローカル座標・メートル。+x 右 / +y 上 / -z 前。原点は引き金のあたり。
   muzzle: 銃口（モデル最前面）。dual だけ左の銃口 muzzle2 を持つ（他は null）。
   viewSpin: 回転させる箱の番号（ミニガンの銃身。z 軸まわり、x=y=0 を中心）。他は null。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  /* ---------- モデル用の色 ---------- */
  const K = [0.12, 0.14, 0.19];   // いちばん暗い金属
  const D = [0.20, 0.23, 0.30];   // 暗い金属
  const M = [0.34, 0.38, 0.47];   // 中間
  const L = [0.62, 0.67, 0.76];   // 明るい金属
  const b = (cx, cy, cz, sx, sy, sz, c) => [cx, cy, cz, sx, sy, sz, c[0], c[1], c[2]];
  const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  /* ---------- 弾の設定（未使用項目は 0） ---------- */
  function P(o) {
    return Object.assign({
      speed: 40, grav: 0, size: 0.1, radius: 0, splashDmg: 0, splashMin: 0,
      bounce: 0, bounceDamp: 0, fuse: 0, homing: 0, homingCone: 0, selfMult: 0, contact: true,
      wallPierce: 0                      // v5: かべを すりぬける回数（あつさ 4m まで）
    }, o);
  }

  /* ---------- 銃の既定値（全項目をそろえる） ---------- */
  const GUN_DEFAULTS = {
    type: 'hitscan', hs: 1, auto: false, burst: 0, pellets: 1,
    spread: 0, adsSpread: 0, moveSpread: 0, falloff: null, recoil: [0.5, 0.2],
    zoom: 1, move: 1, spinup: 0, charge: 0, pierce: false,
    proj: null, flame: null, beam: null, tracerWidth: 0.03,
    muzzle2: null, viewSpin: null
  };
  const G = (o) => Object.assign({}, GUN_DEFAULTS, o);

  /* ---------- 21種の銃 ---------- */
  const C_AR = [1.0, 0.85, 0.45], C_SMG = [1.0, 0.74, 0.40], C_LMG = [1.0, 0.64, 0.30], C_MINI = [1.0, 0.55, 0.25];
  const C_BURST = [0.55, 1.0, 0.70], C_DMR = [0.60, 0.85, 1.0], C_SNP = [0.75, 0.95, 1.0], C_MAG = [1.0, 0.60, 0.35];
  const C_DUAL = [1.0, 0.90, 0.55], C_SG = [1.0, 0.80, 0.50], C_DBL = [1.0, 0.70, 0.40], C_RKT = [1.0, 0.50, 0.20];
  const C_GL = [0.60, 1.0, 0.30], C_RAIL = [0.45, 0.80, 1.0], C_LSR = [1.0, 0.30, 0.80], C_PLS = [0.40, 1.0, 0.95];
  const C_BOW = [0.90, 0.95, 1.0], C_FLM = [1.0, 0.55, 0.15], C_NDL = [1.0, 0.45, 0.90], C_RIC = [0.75, 0.55, 1.0];
  const C_GIGA = [1.0, 0.38, 0.18];

  CS.Guns = [
    G({
      id: 'ar', name: 'アサルトライフル', short: 'アサルト',
      desc: 'バランスのよい万能ライフル。うでを みがくほど 強くなる',
      type: 'hitscan', dmg: 33, hs: 1, rpm: 648, auto: true,      // v5.1: 連射 1.7倍（381 → 648）
      spread: 2.0, adsSpread: 0.4, moveSpread: 0, mag: 30, reload: 2.26,
      range: 100, falloff: [25, 45, 0.7], recoil: [0.9, 0.35], zoom: 0.8, move: 0.92,
      tracer: C_AR, sfx: 'shot_ar',
      view: [
        b(0, 0, -0.05, 0.08, 0.10, 0.34, D),         // 機関部
        b(0, -0.01, 0.22, 0.06, 0.09, 0.20, M),      // ストック
        b(0, 0.015, -0.36, 0.035, 0.035, 0.28, M),   // 銃身
        b(0, 0.005, -0.30, 0.065, 0.07, 0.16, K),    // ハンドガード
        b(0, -0.11, -0.08, 0.05, 0.14, 0.07, M),     // マガジン
        b(0, -0.09, 0.06, 0.045, 0.10, 0.05, K),     // グリップ
        b(0, 0.07, -0.05, 0.03, 0.03, 0.10, C_AR),   // サイト
        b(0.042, 0, -0.05, 0.006, 0.02, 0.26, C_AR)  // 光るライン
      ],
      muzzle: [0, 0.015, -0.50],
      stats: { power: 4, rate: 5, range: 4, mobility: 3, ease: 1 }
    }),
    G({
      id: 'smg', name: 'サブマシンガン', short: 'サブマシ',
      desc: '連射がとても速い。近くの撃ち合いと走り回りが得意',
      type: 'hitscan', dmg: 21, hs: 1, rpm: 649, auto: true,
      spread: 3.0, adsSpread: 1.2, moveSpread: 0, mag: 35, reload: 1.85,
      range: 60, falloff: [12, 25, 0.6], recoil: [0.55, 0.4], zoom: 0.85, move: 1.08,
      tracer: C_SMG, sfx: 'shot_smg',
      view: [
        b(0, 0, -0.02, 0.08, 0.11, 0.30, D),
        b(0, 0.02, -0.25, 0.04, 0.04, 0.16, M),
        b(0, 0.02, -0.305, 0.055, 0.055, 0.07, K),   // 先端のカバー
        b(0, -0.14, -0.07, 0.04, 0.19, 0.05, M),     // 長いマガジン
        b(0, -0.10, 0.08, 0.045, 0.10, 0.05, K),
        b(0, 0.01, 0.20, 0.02, 0.02, 0.14, M),       // 細いストック
        b(0, -0.02, 0.265, 0.05, 0.09, 0.02, K),
        b(0, 0.065, -0.02, 0.03, 0.02, 0.20, C_SMG)
      ],
      muzzle: [0, 0.02, -0.34],
      stats: { power: 3, rate: 4, range: 2, mobility: 4, ease: 2 }
    }),
    G({
      id: 'lmg', name: 'ライトマシンガン', short: 'ライトMG',
      desc: '80発の大容量。止まって撃てば弾幕でおしきれる',
      type: 'hitscan', dmg: 28, hs: 1, rpm: 503, auto: true,
      spread: 3.0, adsSpread: 1.0, moveSpread: 0, mag: 80, reload: 4.3,
      range: 100, falloff: [30, 55, 0.75], recoil: [0.7, 0.45], zoom: 0.8, move: 0.8,
      tracer: C_LMG, sfx: 'shot_lmg',
      view: [
        b(0, 0, 0, 0.11, 0.13, 0.36, D),
        b(0, -0.01, 0.27, 0.07, 0.11, 0.18, M),
        b(0, 0.02, -0.33, 0.08, 0.08, 0.30, M),      // 放熱カバー
        b(0, 0.02, -0.52, 0.035, 0.035, 0.08, L),
        b(0, -0.13, -0.04, 0.12, 0.13, 0.14, dim(C_LMG, 0.55)),  // 箱マガジン
        b(0, 0.10, -0.05, 0.03, 0.04, 0.14, K),      // 持ち手
        b(0.03, -0.07, -0.42, 0.015, 0.10, 0.015, K),  // 二脚
        b(-0.03, -0.07, -0.42, 0.015, 0.10, 0.015, K),
        b(0.057, 0.02, 0, 0.006, 0.03, 0.30, C_LMG)
      ],
      muzzle: [0, 0.02, -0.56],
      stats: { power: 4, rate: 3, range: 4, mobility: 2, ease: 3 }
    }),
    G({
      id: 'minigun', name: 'ミニガン', short: 'ミニガン',
      desc: '回りだすまで 2.5秒 ためる。始まれば弾の嵐！',
      type: 'hitscan', dmg: 13, hs: 1, rpm: 2450, auto: true,
      spread: 4.0, adsSpread: 3.0, moveSpread: 0, mag: 150, reload: 1.89,
      range: 80, falloff: [20, 40, 0.6], recoil: [0.3, 0.35], zoom: 0.9, move: 1.12, spinup: 2.5,
      tracer: C_MINI, sfx: 'shot_minigun',
      view: [
        b(0, 0, 0.08, 0.16, 0.16, 0.26, D),          // モーター部
        b(0.035, 0.035, -0.30, 0.03, 0.03, 0.52, L),  // 銃身×4
        b(-0.035, 0.035, -0.30, 0.03, 0.03, 0.52, L),
        b(0.035, -0.035, -0.30, 0.03, 0.03, 0.52, L),
        b(-0.035, -0.035, -0.30, 0.03, 0.03, 0.52, L),
        b(0, 0, -0.50, 0.13, 0.13, 0.035, M),        // 前の留め具
        b(0, 0, -0.20, 0.12, 0.12, 0.03, M),         // 中の留め具
        b(0, -0.14, 0.10, 0.10, 0.10, 0.14, dim(C_MINI, 0.6)),  // 弾薬箱
        b(0, 0, 0.26, 0.10, 0.10, 0.10, C_MINI)      // 後ろのモーター
      ],
      muzzle: [0, 0, -0.56],
      viewSpin: [1, 2, 3, 4, 5, 6],
      stats: { power: 3, rate: 5, range: 3, mobility: 5, ease: 4 }
    }),
    G({
      id: 'burst', name: 'バーストライフル', short: 'バースト',
      desc: '3発まとめてドドドン。ねらいが合えば一瞬で倒せる',
      type: 'hitscan', dmg: 42, hs: 1, rpm: 160, auto: false, burst: { n: 3, rpm: 360 },
      spread: 1.6, adsSpread: 0.3, moveSpread: 0, mag: 24, reload: 4.27,
      range: 100, falloff: null, recoil: [0.8, 0.25], zoom: 0.75, move: 0.75,
      tracer: C_BURST, sfx: 'shot_burst',
      view: [
        b(0, 0, 0.05, 0.09, 0.12, 0.42, D),          // ブルパップの長い胴
        b(0, 0.02, -0.30, 0.04, 0.04, 0.28, M),
        b(0, 0, -0.24, 0.075, 0.09, 0.12, M),
        b(0, -0.11, 0.14, 0.05, 0.12, 0.07, M),      // 後ろのマガジン
        b(0, -0.10, -0.04, 0.045, 0.10, 0.05, K),
        b(0, 0.09, -0.02, 0.04, 0.05, 0.18, K),      // キャリーハンドル
        b(0, 0.125, -0.02, 0.02, 0.015, 0.12, C_BURST),
        b(0, 0, 0.28, 0.10, 0.13, 0.03, C_BURST)
      ],
      muzzle: [0, 0.02, -0.44],
      stats: { power: 5, rate: 1, range: 4, mobility: 1, ease: 4 }
    }),
    G({
      id: 'dmr', name: 'マークスマン', short: 'マークス',
      desc: '一発が重い単発ライフル。中〜遠距離でたよれる',
      type: 'hitscan', dmg: 81, hs: 1, rpm: 178, auto: false,
      spread: 1.5, adsSpread: 0.1, moveSpread: 0, mag: 12, reload: 3.04,
      range: 150, falloff: null, recoil: [2.2, 0.4], zoom: 0.6, move: 0.83,
      tracer: C_DMR, sfx: 'shot_dmr', tracerWidth: 0.04,
      view: [
        b(0, 0, -0.02, 0.08, 0.10, 0.30, D),
        b(0, -0.02, 0.23, 0.07, 0.12, 0.20, M),
        b(0, 0.015, -0.37, 0.035, 0.035, 0.40, M),
        b(0, 0.005, -0.28, 0.06, 0.07, 0.22, K),
        b(0, 0.085, -0.04, 0.05, 0.05, 0.20, K),      // スコープ
        b(0, 0.085, -0.145, 0.045, 0.045, 0.01, C_DMR),
        b(0, -0.09, -0.04, 0.05, 0.08, 0.08, M),
        b(0, 0.015, -0.555, 0.05, 0.05, 0.04, L)      // マズルブレーキ
      ],
      muzzle: [0, 0.015, -0.575],
      stats: { power: 5, rate: 1, range: 5, mobility: 2, ease: 1 }
    }),
    G({
      id: 'sniper', name: 'スナイパー', short: 'スナイパー',
      desc: 'どこに当てても一撃！スコープでじっくりねらおう',
      type: 'hitscan', dmg: 190, hs: 1, rpm: 14, auto: false,
      spread: 6.0, adsSpread: 0.0, moveSpread: 0, mag: 5, reload: 6.16,
      range: 200, falloff: null, recoil: [6.0, 0.8], zoom: 0.3, move: 0.66,
      tracer: C_SNP, sfx: 'shot_sniper', tracerWidth: 0.07,
      view: [
        b(0, 0, 0, 0.085, 0.10, 0.28, D),
        b(0, -0.025, 0.225, 0.07, 0.13, 0.17, M),
        b(0, 0.05, 0.20, 0.05, 0.02, 0.12, C_SNP),    // ほほ当て
        b(0, 0.015, -0.38, 0.03, 0.03, 0.48, L),      // 長い銃身
        b(0, 0.015, -0.605, 0.055, 0.045, 0.05, M),
        b(0, 0.10, -0.02, 0.055, 0.055, 0.30, K),     // 大きなスコープ
        b(0, 0.10, -0.18, 0.075, 0.075, 0.05, M),
        b(0, 0.10, -0.206, 0.06, 0.06, 0.006, C_SNP),
        b(0.07, 0.01, 0.06, 0.06, 0.02, 0.02, L),     // ボルト
        b(0, -0.08, -0.02, 0.05, 0.07, 0.07, M)
      ],
      muzzle: [0, 0.015, -0.63],
      stats: { power: 5, rate: 1, range: 5, mobility: 1, ease: 1 }
    }),
    G({
      id: 'magnum', name: 'マグナム', short: 'マグナム',
      desc: '重い一発のリボルバー。2発あてれば決着',
      type: 'hitscan', dmg: 99, hs: 1, rpm: 112, auto: false,
      spread: 1.0, adsSpread: 0.3, moveSpread: 0, mag: 6, reload: 2.62,
      range: 90, falloff: null, recoil: [4.5, 0.9], zoom: 0.8, move: 0.96,
      tracer: C_MAG, sfx: 'shot_magnum', tracerWidth: 0.04,
      view: [
        b(0, 0, 0.02, 0.05, 0.08, 0.14, D),
        b(0, 0.005, -0.01, 0.075, 0.075, 0.09, M),    // シリンダー
        b(0, 0.02, -0.17, 0.04, 0.045, 0.24, L),
        b(0, 0.05, -0.16, 0.015, 0.015, 0.24, C_MAG),
        b(0, -0.09, 0.10, 0.05, 0.13, 0.06, dim(C_MAG, 0.45)),  // グリップ
        b(0, 0.055, 0.08, 0.02, 0.03, 0.03, K),       // 撃鉄
        b(0, 0.065, -0.27, 0.01, 0.02, 0.02, C_MAG)
      ],
      muzzle: [0, 0.02, -0.29],
      stats: { power: 5, rate: 1, range: 3, mobility: 3, ease: 1 }
    }),
    G({
      id: 'dual', name: 'デュアルピストル', short: 'デュアル',
      desc: '左右の2丁を交互に撃つ。走りながらでも強い',
      type: 'hitscan', dmg: 27, hs: 1, rpm: 471, auto: true,
      spread: 2.5, adsSpread: 1.5, moveSpread: 0, mag: 24, reload: 1.89,
      range: 60, falloff: [12, 26, 0.6], recoil: [1.0, 0.5], zoom: 0.9, move: 1.09,
      tracer: C_DUAL, sfx: 'shot_pistol',
      view: [
        b(0.13, 0.02, -0.13, 0.05, 0.055, 0.26, D),   // 右の銃
        b(0.13, 0.015, -0.29, 0.025, 0.025, 0.06, L),
        b(0.13, -0.075, 0.03, 0.045, 0.11, 0.06, K),
        b(0.13, 0.052, -0.13, 0.012, 0.008, 0.20, C_DUAL),
        b(-0.13, 0.02, -0.13, 0.05, 0.055, 0.26, D),  // 左の銃
        b(-0.13, 0.015, -0.29, 0.025, 0.025, 0.06, L),
        b(-0.13, -0.075, 0.03, 0.045, 0.11, 0.06, K),
        b(-0.13, 0.052, -0.13, 0.012, 0.008, 0.20, C_DUAL)
      ],
      muzzle: [0.13, 0.015, -0.32],
      muzzle2: [-0.13, 0.015, -0.32],
      stats: { power: 3, rate: 4, range: 2, mobility: 4, ease: 3 }
    }),
    G({
      id: 'shotgun', name: 'ショットガン', short: 'ショット',
      desc: '9粒の散弾。目の前の相手はほぼ一発',
      type: 'hitscan', dmg: 13, hs: 1, rpm: 78, auto: false, pellets: 9,
      spread: 6.0, adsSpread: 4.5, moveSpread: 0, mag: 6, reload: 2.32,
      range: 30, falloff: [6, 16, 0.3], recoil: [5.0, 1.0], zoom: 0.9, move: 1.02,
      tracer: C_SG, sfx: 'shot_shotgun', tracerWidth: 0.02,
      view: [
        b(0, 0, 0, 0.08, 0.10, 0.24, D),
        b(0, -0.03, 0.22, 0.07, 0.12, 0.20, M),
        b(0, 0.025, -0.31, 0.045, 0.045, 0.38, M),
        b(0, -0.025, -0.25, 0.04, 0.04, 0.26, K),     // チューブマガジン
        b(0, -0.03, -0.26, 0.065, 0.06, 0.14, dim(C_SG, 0.7)),  // ポンプ
        b(0, 0.055, -0.48, 0.012, 0.012, 0.012, C_SG),
        b(0.045, -0.01, 0.02, 0.01, 0.03, 0.08, C_SG)  // 予備の弾
      ],
      muzzle: [0, 0.025, -0.50],
      stats: { power: 5, rate: 1, range: 1, mobility: 3, ease: 2 }
    }),
    G({
      id: 'double', name: 'ダブルバレル', short: 'ダブル',
      desc: '2連発で超近距離最強。弾は2発だけ',
      type: 'hitscan', dmg: 16, hs: 1, rpm: 120, auto: false, pellets: 12,
      spread: 8.0, adsSpread: 6.0, moveSpread: 0, mag: 2, reload: 4.4,
      range: 22, falloff: [5, 12, 0.25], recoil: [7.0, 1.4], zoom: 0.92, move: 0.72,
      tracer: C_DBL, sfx: 'shot_double', tracerWidth: 0.02,
      view: [
        b(-0.025, 0.02, -0.25, 0.045, 0.045, 0.44, M),  // 横並びの銃身
        b(0.025, 0.02, -0.25, 0.045, 0.045, 0.44, M),
        b(0, 0.005, 0.02, 0.10, 0.08, 0.10, D),
        b(0, -0.04, 0.17, 0.07, 0.10, 0.20, dim(C_DBL, 0.45)),
        b(0, -0.03, -0.18, 0.08, 0.035, 0.18, K),
        b(0, 0.05, -0.25, 0.012, 0.012, 0.44, C_DBL),
        b(0, 0.005, -0.03, 0.105, 0.03, 0.015, C_DBL)
      ],
      muzzle: [0, 0.02, -0.47],
      stats: { power: 5, rate: 1, range: 1, mobility: 1, ease: 2 }
    }),
    G({
      id: 'rocket', name: 'ロケットランチャー', short: 'ロケット',
      desc: '爆風でまとめて吹き飛ばす。ロケットジャンプも',
      type: 'projectile', dmg: 30, hs: 1, rpm: 110, auto: false,
      spread: 0.5, adsSpread: 0, moveSpread: 0, mag: 2, reload: 1.35,
      range: 120, falloff: null, recoil: [4.0, 0.6], zoom: 0.85, move: 1.13,
      proj: P({ speed: 28, grav: 0, size: 0.18, radius: 3.0, splashDmg: 70, splashMin: 0.2, fuse: 0, selfMult: 0.5, contact: true }),
      tracer: C_RKT, sfx: 'shot_rocket',
      view: [
        b(0, 0.02, -0.12, 0.15, 0.15, 0.66, [0.22, 0.27, 0.24]),  // 太い筒
        b(0, 0.02, -0.46, 0.18, 0.18, 0.05, C_RKT),
        b(0, 0.02, -0.49, 0.08, 0.08, 0.03, [1.0, 0.75, 0.35]),   // 弾頭
        b(0, 0.02, 0.23, 0.17, 0.17, 0.05, M),
        b(0, 0.02, 0.30, 0.13, 0.13, 0.10, K),
        b(0, -0.11, -0.02, 0.045, 0.10, 0.05, K),
        b(0, -0.10, -0.24, 0.04, 0.08, 0.04, K),
        b(0, 0.12, -0.10, 0.03, 0.05, 0.08, C_RKT),
        b(0.077, 0.02, -0.12, 0.006, 0.03, 0.50, C_RKT)
      ],
      muzzle: [0, 0.02, -0.505],
      stats: { power: 5, rate: 3, range: 3, mobility: 5, ease: 5 }
    }),
    G({
      id: 'grenade', name: 'グレネードランチャー', short: 'グレラン',
      desc: 'はねる弾が1.6秒で爆発。人に当たると即ドカン',
      type: 'projectile', dmg: 20, hs: 1, rpm: 198, auto: false,
      spread: 1, adsSpread: 0.5, moveSpread: 0, mag: 4, reload: 1.35,
      range: 80, falloff: null, recoil: [3.0, 0.5], zoom: 0.85, move: 1.18,
      proj: P({ speed: 22, grav: 14, size: 0.12, radius: 2.8, splashDmg: 65, splashMin: 0.2, bounce: 3, bounceDamp: 0.5, fuse: 1.6, selfMult: 0.5, contact: true }),
      tracer: C_GL, sfx: 'shot_grenade',
      view: [
        b(0, 0, 0.02, 0.09, 0.10, 0.22, D),
        b(0, -0.01, -0.10, 0.16, 0.16, 0.12, M),      // ドラム
        b(0, -0.01, -0.10, 0.17, 0.03, 0.08, C_GL),
        b(0, 0.01, -0.28, 0.09, 0.09, 0.24, K),       // 太く短い銃身
        b(0, 0.01, -0.39, 0.105, 0.105, 0.03, C_GL),
        b(0, -0.03, 0.23, 0.06, 0.09, 0.20, M),
        b(0, -0.10, 0.06, 0.045, 0.10, 0.05, K),
        b(0, 0.08, -0.20, 0.03, 0.04, 0.02, L)
      ],
      muzzle: [0, 0.01, -0.405],
      stats: { power: 4, rate: 4, range: 3, mobility: 5, ease: 5 }
    }),
    G({
      id: 'rail', name: 'レールガン', short: 'レール',
      desc: 'ためてから撃つ貫通ビーム。一列に並べばまとめて',
      type: 'hitscan', dmg: 128, hs: 1, rpm: 65, auto: false,
      spread: 0, adsSpread: 0, moveSpread: 0, mag: 4, reload: 1.8,
      range: 200, falloff: null, recoil: [5.0, 0.5], zoom: 0.5, move: 1.02,
      charge: 0.31, pierce: true,
      tracer: C_RAIL, sfx: 'shot_rail', tracerWidth: 0.14,
      view: [
        b(0, 0, 0.05, 0.10, 0.12, 0.36, D),
        b(0, -0.02, 0.30, 0.08, 0.10, 0.14, M),
        b(0, 0.04, -0.33, 0.06, 0.025, 0.40, L),      // 上のレール
        b(0, -0.03, -0.33, 0.06, 0.025, 0.40, L),     // 下のレール
        b(0, 0.005, -0.30, 0.03, 0.03, 0.34, C_RAIL), // 光るコイル
        b(0, 0.005, -0.20, 0.09, 0.10, 0.03, M),
        b(0, 0.005, -0.38, 0.09, 0.10, 0.03, M),
        b(0, -0.10, 0.02, 0.06, 0.08, 0.12, C_RAIL),  // バッテリー
        b(0, 0.10, 0.02, 0.04, 0.04, 0.16, K)
      ],
      muzzle: [0, 0.005, -0.53],
      stats: { power: 5, rate: 2, range: 5, mobility: 3, ease: 2 }
    }),
    G({
      id: 'laser', name: 'レーザーライフル', short: 'レーザー',
      desc: '弾道ゼロのレーザー。当て続けて溶かそう',
      type: 'beam', dmg: 10, hs: 1, rpm: 1267, auto: true,
      spread: 0, adsSpread: 0, moveSpread: 0, mag: 100, reload: 2.43,
      range: 40, falloff: null, recoil: [0.08, 0.05], zoom: 0.8, move: 0.96,
      beam: { width: 0.06 },
      tracer: C_LSR, sfx: 'beam', tracerWidth: 0.06,
      view: [
        b(0, 0, 0, 0.09, 0.11, 0.38, [0.78, 0.80, 0.86]),  // 白い胴体
        b(0, 0.08, 0, 0.02, 0.05, 0.26, C_LSR),
        b(0, 0.01, -0.30, 0.05, 0.06, 0.22, K),
        b(0, 0.01, -0.42, 0.08, 0.08, 0.03, M),
        b(0, 0.01, -0.44, 0.04, 0.04, 0.02, C_LSR),   // レンズ
        b(0, -0.09, -0.02, 0.05, 0.07, 0.12, C_LSR),  // エネルギーセル
        b(0, -0.10, 0.10, 0.045, 0.10, 0.05, K),
        b(0.047, 0, 0, 0.006, 0.02, 0.30, C_LSR),
        b(0, 0, 0.24, 0.07, 0.09, 0.10, M)
      ],
      muzzle: [0, 0.01, -0.45],
      stats: { power: 3, rate: 5, range: 3, mobility: 3, ease: 3 }
    }),
    G({
      id: 'plasma', name: 'プラズマガン', short: 'プラズマ',
      desc: '速い光弾に小さな爆風つき。壁ぎわの相手に◎',
      type: 'projectile', dmg: 18, hs: 1, rpm: 377, auto: true,
      spread: 1.5, adsSpread: 0.8, moveSpread: 0, mag: 10, reload: 1.76,
      range: 80, falloff: null, recoil: [0.6, 0.3], zoom: 0.85, move: 1.09,
      proj: P({ speed: 45, grav: 0, size: 0.16, radius: 0.9, splashDmg: 10, splashMin: 0.3, fuse: 0, selfMult: 0, contact: true }),
      tracer: C_PLS, sfx: 'shot_plasma',
      view: [
        b(0, 0, 0.05, 0.11, 0.12, 0.30, D),
        b(0, 0.02, -0.12, 0.13, 0.13, 0.10, C_PLS),   // 光る球室
        b(0, 0.06, -0.28, 0.03, 0.03, 0.24, M),       // 上下のツメ
        b(0, -0.03, -0.28, 0.03, 0.03, 0.24, M),
        b(0, 0.015, -0.26, 0.03, 0.03, 0.14, C_PLS),
        b(0, -0.10, 0.10, 0.05, 0.10, 0.05, K),
        b(0, 0.03, 0.24, 0.08, 0.08, 0.08, dim(C_PLS, 0.6)),
        b(0, 0.075, 0.05, 0.07, 0.02, 0.18, M)
      ],
      muzzle: [0, 0.015, -0.40],
      stats: { power: 3, rate: 5, range: 3, mobility: 4, ease: 4 }
    }),
    G({
      id: 'crossbow', name: 'クロスボウ', short: 'ボウガン',
      desc: '重力で落ちる矢。当たればほぼ一撃の大ダメージ',
      type: 'projectile', dmg: 170, hs: 1, rpm: 24, auto: false,
      spread: 0.3, adsSpread: 0, moveSpread: 0, mag: 1, reload: 3,
      range: 150, falloff: null, recoil: [2.5, 0.3], zoom: 0.6, move: 0.72,
      proj: P({ speed: 70, grav: 6, size: 0.08, fuse: 0, contact: true }),
      tracer: C_BOW, sfx: 'shot_bow',
      view: [
        b(0, 0, 0.02, 0.06, 0.07, 0.56, M),           // 台じり
        b(0, 0.03, -0.24, 0.16, 0.035, 0.045, D),
        b(-0.15, 0.03, -0.21, 0.16, 0.03, 0.035, C_NDL),  // 左の弓
        b(0.15, 0.03, -0.21, 0.16, 0.03, 0.035, C_NDL),   // 右の弓
        b(0, 0.036, -0.16, 0.42, 0.008, 0.008, L),    // 弦
        b(0, 0.055, -0.20, 0.012, 0.012, 0.36, C_BOW),  // 矢
        b(0, 0.055, -0.385, 0.025, 0.025, 0.03, C_GL),
        b(0, 0.09, 0.06, 0.035, 0.035, 0.14, K),
        b(0, -0.08, 0.12, 0.04, 0.10, 0.05, K)
      ],
      muzzle: [0, 0.055, -0.40],
      stats: { power: 5, rate: 1, range: 4, mobility: 1, ease: 2 }
    }),
    G({
      id: 'flame', name: 'かえんほうしゃき', short: 'かえん',
      desc: '近づけば最強の炎。一瞬で焼きつくす',
      type: 'flame', dmg: 25, hs: 1, rpm: 426, auto: true,   // 1秒に7.1回あたる（1秒 約178ダメージ）。回数は flame.tick
      spread: 0, adsSpread: 0, moveSpread: 0, mag: 120, reload: 4.05,
      range: 7, falloff: null, recoil: [0.05, 0.08], zoom: 1, move: 0.81,
      flame: { range: 7, cone: 14, tick: 7.1, burn: { dps: 8, dur: 2 } },
      tracer: C_FLM, sfx: 'flame',
      view: [
        b(0, 0, 0.02, 0.08, 0.10, 0.34, D),
        b(0, 0.02, -0.30, 0.05, 0.05, 0.30, M),       // ノズル管
        b(0, 0.02, -0.47, 0.08, 0.08, 0.05, L),
        b(0, -0.03, -0.45, 0.02, 0.02, 0.03, [0.3, 0.7, 1.0]),  // 種火
        b(0, -0.12, -0.02, 0.12, 0.12, 0.24, [0.85, 0.25, 0.12]),  // 燃料タンク
        b(0, -0.12, -0.02, 0.125, 0.02, 0.245, [1.0, 0.85, 0.2]),
        b(0, -0.12, -0.15, 0.06, 0.06, 0.02, L),
        b(0, -0.08, 0.20, 0.045, 0.10, 0.05, K),
        b(0.07, -0.06, 0.05, 0.02, 0.02, 0.20, M),    // ホース
        b(0, 0.02, -0.22, 0.07, 0.07, 0.02, C_FLM)
      ],
      muzzle: [0, 0.02, -0.495],
      stats: { power: 5, rate: 4, range: 1, mobility: 2, ease: 5 }
    }),
    G({
      id: 'needler', name: 'ホーミングニードル', short: 'ニードル',
      desc: '相手を追いかけるハリ。かべを 1回 すりぬける',
      type: 'projectile', dmg: 9, hs: 1, rpm: 560, auto: true,     // v5.1: よわく（ダメージ 12→9・連射 660→560・追いかけ 5→3）
      spread: 2, adsSpread: 1, moveSpread: 0, mag: 20, reload: 1.6,
      range: 70, falloff: null, recoil: [0.5, 0.3], zoom: 0.9, move: 1.2,
      proj: P({ speed: 30, grav: 0, size: 0.07, homing: 3, homingCone: 24, fuse: 0, contact: true, wallPierce: 1 }),
      tracer: C_NDL, sfx: 'shot_needle',
      view: [
        b(0, 0, 0, 0.08, 0.10, 0.30, D),
        b(0, 0, -0.20, 0.05, 0.07, 0.12, M),
        b(0, 0.08, -0.06, 0.012, 0.08, 0.012, C_NDL),  // 背中のハリ
        b(0, 0.075, 0.02, 0.012, 0.07, 0.012, C_NDL),
        b(0.025, 0.07, -0.02, 0.012, 0.06, 0.012, C_NDL),
        b(-0.025, 0.07, 0.06, 0.012, 0.06, 0.012, C_NDL),
        b(0, 0.01, -0.32, 0.025, 0.025, 0.12, L),
        b(0, -0.10, 0.07, 0.045, 0.10, 0.05, K),
        b(0, 0, 0.20, 0.06, 0.08, 0.10, dim(C_NDL, 0.6))
      ],
      muzzle: [0, 0.01, -0.38],
      stats: { power: 1, rate: 4, range: 3, mobility: 5, ease: 4 }
    }),
    G({
      id: 'ricochet', name: 'リコシェライフル', short: 'リコシェ',
      desc: '壁で4回はねる弾。かくれた相手を角からねらえ',
      type: 'projectile', dmg: 55, hs: 1, rpm: 278, auto: true,
      spread: 0.8, adsSpread: 0.2, moveSpread: 0, mag: 16, reload: 1.6,
      range: 120, falloff: null, recoil: [1.6, 0.35], zoom: 0.7, move: 1.03,
      proj: P({ speed: 90, grav: 0, size: 0.06, bounce: 4, bounceDamp: 1.0, fuse: 0, contact: true }),
      tracer: C_RIC, sfx: 'shot_ricochet',
      view: [
        b(0, 0, 0.02, 0.08, 0.10, 0.34, D),
        b(0, -0.01, 0.27, 0.05, 0.10, 0.16, M),
        b(0, 0.02, -0.33, 0.035, 0.035, 0.36, L),
        b(0.05, 0.02, -0.30, 0.01, 0.08, 0.18, C_RIC),   // 横のヒレ
        b(-0.05, 0.02, -0.30, 0.01, 0.08, 0.18, C_RIC),
        b(0, 0.02, -0.50, 0.06, 0.06, 0.04, C_RIC),      // プリズム
        b(0, -0.09, -0.02, 0.05, 0.09, 0.10, M),
        b(0, 0.075, -0.02, 0.03, 0.03, 0.12, C_RIC),
        b(0, -0.09, 0.12, 0.045, 0.10, 0.05, K)
      ],
      muzzle: [0, 0.02, -0.52],
      stats: { power: 4, rate: 3, range: 4, mobility: 3, ease: 4 }
    }),
    /* v5: じぶんの HP を 50 つかって 大ばくはつの 弾を撃つ（hpCost）。HP が 50 より多いときだけ 撃てる。
       じぶんは ばくふうで けがを しない（selfMult 0）。コンピューターは つかわない（noBot） */
    G({
      id: 'giga', name: 'ギガバースト', short: 'ギガ',
      desc: 'HPを 50 つかって 大ばくはつの 弾！ HPが 50より 多いときだけ 撃てる',
      type: 'projectile', dmg: 60, hs: 1, rpm: 30, auto: false,
      spread: 0.4, adsSpread: 0, moveSpread: 0, mag: 1, reload: 2.4,
      range: 120, falloff: null, recoil: [6.0, 0.8], zoom: 0.85, move: 0.9,
      proj: P({ speed: 22, grav: 4, size: 0.34, radius: 7.0, splashDmg: 170, splashMin: 0.3, fuse: 0, selfMult: 0, contact: true }),
      hpCost: 50, noBot: true,
      tracer: C_GIGA, sfx: 'shot_rocket',
      view: [
        b(0, 0, 0.02, 0.16, 0.16, 0.44, D),           // 胴体
        b(0, 0.01, -0.34, 0.12, 0.12, 0.34, K),       // 太い筒
        b(0, 0.01, -0.53, 0.17, 0.17, 0.05, C_GIGA),  // 筒の先
        b(0, 0.01, -0.06, 0.18, 0.08, 0.14, C_GIGA),  // 光る エネルギー室
        b(0, -0.12, 0.10, 0.05, 0.10, 0.06, K),       // グリップ
        b(0, 0.12, -0.02, 0.04, 0.05, 0.18, M),       // 上の 持ち手
        b(0, -0.01, 0.30, 0.12, 0.13, 0.10, M),       // うしろ
        b(0.087, 0, -0.10, 0.006, 0.03, 0.40, C_GIGA)
      ],
      muzzle: [0, 0.01, -0.56],
      stats: { power: 5, rate: 1, range: 3, mobility: 2, ease: 2 }
    })
  ];

  CS.GunMap = {};
  for (const g of CS.Guns) CS.GunMap[g.id] = g;

  /* ---------- 5種のボム ----------
     v3: ボムのダメージは v2 の 1.5倍（フラグ 90→135 / ねんちゃく 100→150 / クラスター 40→60・子 35→52.5 / インパルス 20→30） */
  const BOMB_DEFAULTS = {
    charges: 1, cooldown: 10, throwSpeed: 15, grav: 18, bounce: 0, bounceDamp: 0, fuse: 1.5,
    sticky: false, radius: 3, dmg: 0, minMult: 0.2, effect: 'none', knock: 0,
    smoke: null, cluster: null, color: [1, 1, 1], size: 0.16, sfx: 'explode'
  };
  const B = (o) => Object.assign({}, BOMB_DEFAULTS, o);

  CS.Bombs = [
    B({
      id: 'frag', name: 'フラグボム', short: 'フラグ',
      desc: 'はねて転がり1.8秒でドカン。定番の手りゅう弾',
      charges: 2, cooldown: 10, throwSpeed: 16, grav: 18, bounce: 3, bounceDamp: 0.45, fuse: 1.8,
      sticky: false, radius: 3.5, dmg: 135, minMult: 0.2, effect: 'none', knock: 4,
      color: [0.45, 0.95, 0.40], size: 0.16, sfx: 'explode',
      view: [
        b(0, 0, 0, 0.14, 0.14, 0.14, [0.22, 0.36, 0.22]),
        b(0, 0, 0, 0.15, 0.04, 0.15, [0.45, 0.95, 0.40]),
        b(0, 0.09, 0, 0.05, 0.04, 0.05, L),
        b(0.04, 0.115, 0, 0.04, 0.012, 0.012, [1.0, 0.85, 0.3])
      ],
      stats: { power: 5, area: 4, cooldown: 3, ease: 4 }
    }),
    B({
      id: 'sticky', name: 'ねんちゃくボム', short: 'ねんちゃく',
      desc: '壁にも相手にもくっつく。つけたら逃げよう',
      charges: 1, cooldown: 12, throwSpeed: 15, grav: 18, bounce: 0, bounceDamp: 0, fuse: 1.5,
      sticky: true, radius: 3.0, dmg: 150, minMult: 0.25, effect: 'none', knock: 4,
      color: [1.0, 0.35, 0.85], size: 0.15, sfx: 'explode',
      view: [
        b(0, 0, 0, 0.13, 0.12, 0.13, [0.45, 0.14, 0.40]),
        b(0.05, -0.05, 0.05, 0.06, 0.04, 0.06, [1.0, 0.35, 0.85]),
        b(-0.05, 0.03, -0.05, 0.05, 0.05, 0.05, [1.0, 0.35, 0.85]),
        b(0, 0.07, 0, 0.04, 0.025, 0.04, [1.0, 0.2, 0.2])
      ],
      stats: { power: 5, area: 3, cooldown: 2, ease: 3 }
    }),
    B({
      id: 'cluster', name: 'クラスターボム', short: 'クラスター',
      desc: '爆発すると小さな爆弾が6こ飛び散る',
      charges: 1, cooldown: 14, throwSpeed: 14, grav: 18, bounce: 1, bounceDamp: 0.4, fuse: 1.2,
      sticky: false, radius: 2.5, dmg: 60, minMult: 0.3, effect: 'cluster', knock: 3,
      cluster: { n: 6, dmg: 52.5, radius: 2.0, fuseMin: 0.5, fuseMax: 0.9 },
      color: [1.0, 0.62, 0.20], size: 0.18, sfx: 'explode',
      view: [
        b(0, 0, 0, 0.10, 0.10, 0.10, [0.40, 0.26, 0.12]),
        b(0.06, 0.06, 0, 0.06, 0.06, 0.06, [1.0, 0.62, 0.20]),
        b(-0.06, 0.06, 0, 0.06, 0.06, 0.06, [1.0, 0.62, 0.20]),
        b(0, -0.06, 0.06, 0.06, 0.06, 0.06, [1.0, 0.62, 0.20]),
        b(0, -0.06, -0.06, 0.06, 0.06, 0.06, [1.0, 0.62, 0.20])
      ],
      stats: { power: 4, area: 5, cooldown: 2, ease: 3 }
    }),
    B({
      id: 'impulse', name: 'インパルスボム', short: 'インパルス',
      desc: '当たった所で爆風。相手も自分もふっとばす',
      charges: 2, cooldown: 7, throwSpeed: 18, grav: 14, bounce: 0, bounceDamp: 0, fuse: 0,
      sticky: false, radius: 4.0, dmg: 30, minMult: 0.5, effect: 'knock', knock: 14,
      color: [0.35, 0.90, 1.0], size: 0.16, sfx: 'explode_small',
      view: [
        b(0, 0, 0, 0.08, 0.08, 0.08, [0.35, 0.90, 1.0]),
        b(0, 0, 0, 0.15, 0.03, 0.15, [0.16, 0.22, 0.32]),
        b(0, 0, 0, 0.03, 0.15, 0.15, [0.16, 0.22, 0.32]),
        b(0, 0, 0, 0.15, 0.15, 0.03, [0.16, 0.22, 0.32])
      ],
      stats: { power: 2, area: 5, cooldown: 5, ease: 4 }
    }),
    B({
      id: 'smoke', name: 'スモークボム', short: 'スモーク',
      desc: 'けむりで視界をさえぎる。にげる時や近づく時に',
      charges: 2, cooldown: 15, throwSpeed: 15, grav: 18, bounce: 2, bounceDamp: 0.4, fuse: 1.0,
      sticky: false, radius: 0, dmg: 0, minMult: 0, effect: 'smoke', knock: 0,
      smoke: { radius: 5, dur: 8 },
      color: [0.75, 0.78, 0.85], size: 0.18, sfx: 'smoke',
      view: [
        b(0, 0, 0, 0.10, 0.18, 0.10, [0.42, 0.45, 0.52]),
        b(0, 0.10, 0, 0.08, 0.03, 0.08, [0.25, 0.27, 0.32]),
        b(0, 0.02, 0, 0.105, 0.03, 0.105, [0.75, 0.78, 0.85])
      ],
      stats: { power: 1, area: 5, cooldown: 1, ease: 5 }
    }),
    /* v5: 当たった相手の こうげき力を しばらく 半分にする（weak.mul・weak.dur 秒）。ホストが きめる */
    B({
      id: 'weak', name: 'よわよわボム', short: 'よわよわ',
      desc: '当たった相手は 7秒間 こうげき力が はんぶんに',
      charges: 2, cooldown: 12, throwSpeed: 16, grav: 18, bounce: 1, bounceDamp: 0.4, fuse: 1.2,
      sticky: false, radius: 3.4, dmg: 25, minMult: 0.6, effect: 'weak', knock: 2,
      weak: { mul: 0.5, dur: 7 },
      color: [0.72, 0.42, 1.0], size: 0.16, sfx: 'explode_small',
      view: [
        b(0, 0, 0, 0.14, 0.14, 0.14, [0.30, 0.16, 0.44]),
        b(0, 0, 0, 0.15, 0.035, 0.15, [0.72, 0.42, 1.0]),
        b(0, 0.09, 0, 0.05, 0.04, 0.05, L),
        b(0, -0.09, 0, 0.06, 0.03, 0.06, [0.72, 0.42, 1.0])
      ],
      stats: { power: 2, area: 4, cooldown: 3, ease: 4 }
    }),
    /* v5: 投げた場所へ ワープ（当たったところで とまる。ダメージなし）。コンピューターは つかわない（noBot） */
    B({
      id: 'warp', name: 'ワープボム', short: 'ワープ',
      desc: 'おちた場所へ じぶんが ワープする。にげる・うらを とる',
      charges: 1, cooldown: 9, throwSpeed: 19, grav: 16, bounce: 0, bounceDamp: 0, fuse: 0,
      sticky: false, radius: 0, dmg: 0, minMult: 0, effect: 'warp', knock: 0, noBot: true,
      color: [0.30, 1.0, 0.85], size: 0.15, sfx: 'spawn',
      view: [
        b(0, 0, 0, 0.12, 0.12, 0.12, [0.10, 0.30, 0.30]),
        b(0, 0, 0, 0.13, 0.13, 0.03, [0.30, 1.0, 0.85]),
        b(0, 0, 0, 0.03, 0.13, 0.13, [0.30, 1.0, 0.85]),
        b(0, 0, 0, 0.06, 0.06, 0.06, [0.85, 1.0, 1.0])
      ],
      stats: { power: 1, area: 1, cooldown: 4, ease: 3 }
    }),
    /* v5.1: 当たった相手は freeze.dur 秒 うごけない（向きを かえる・撃つ ことは できる）。ホストが きめる */
    B({
      id: 'ice', name: 'こおりボム', short: 'こおり',
      desc: '当たった相手は 2秒間 こおって うごけない',
      charges: 2, cooldown: 12, throwSpeed: 16, grav: 18, bounce: 1, bounceDamp: 0.4, fuse: 1.1,
      sticky: false, radius: 3.2, dmg: 20, minMult: 0.6, effect: 'freeze', knock: 0,
      freeze: { dur: 2 },
      color: [0.62, 0.9, 1.0], size: 0.16, sfx: 'explode_small',
      view: [
        b(0, 0, 0, 0.14, 0.14, 0.14, [0.78, 0.94, 1.0]),
        b(0, 0, 0, 0.15, 0.035, 0.15, [0.40, 0.72, 1.0]),
        b(0, 0, 0, 0.035, 0.15, 0.15, [0.40, 0.72, 1.0]),
        b(0, 0.09, 0, 0.05, 0.04, 0.05, L)
      ],
      stats: { power: 1, area: 4, cooldown: 3, ease: 4 }
    })
  ];

  CS.BombMap = {};
  for (const bm of CS.Bombs) CS.BombMap[bm.id] = bm;

  /* ---------- ヘルパー ---------- */
  const TYPE_LABEL = { hitscan: 'ヒットスキャン', projectile: '弾', beam: 'ビーム', flame: 'かえん' };

  CS.Weapons = {
    guns: CS.Guns,
    bombs: CS.Bombs,
    /* id から定義（見つからなければ先頭）。必殺技の銃（special）は ぶきとして えらべない */
    gun: (id) => { const g = CS.GunMap[id]; return g && !g.special ? g : CS.Guns[0]; },
    bomb: (id) => CS.BombMap[id] || CS.Bombs[0],
    /* UI 用の種類タグ */
    typeLabel: (def) => (def && TYPE_LABEL[def.type]) || '',
    /* 1発（1ティック）で与えうる最大ダメージ（ホストの検証用） */
    maxDamage(def) {
      if (!def) return 0;
      if (def.charges !== undefined) return Math.max(def.dmg || 0, def.cluster ? def.cluster.dmg : 0);
      let m = (def.pellets || 1) * def.dmg * Math.max(1, def.hs || 1);
      if (def.proj && def.proj.radius > 0) m += def.proj.splashDmg;
      return m;
    },
    /* 短い説明行（例: "ダメージ22 / 連射 / 30発"） */
    describe(def) {
      if (!def) return '';
      const a = [];
      if (def.charges !== undefined) {
        if (def.effect === 'smoke' && def.smoke) a.push('けむり' + def.smoke.dur + '秒');
        else if (def.effect === 'knock') a.push('ふっとばし' + (def.dmg ? '+ダメージ' + def.dmg : ''));
        else if (def.effect === 'cluster' && def.cluster) a.push('ダメージ' + def.dmg + '+子爆弾×' + def.cluster.n);
        else if (def.effect === 'weak' && def.weak) a.push('ダメージ' + def.dmg + '+こうげき力 はんぶん' + def.weak.dur + '秒');
        else if (def.effect === 'warp') a.push('ワープ（ダメージなし）');
        else if (def.effect === 'freeze' && def.freeze) a.push('ダメージ' + def.dmg + '+' + def.freeze.dur + '秒 うごけない');
        else a.push('ダメージ' + def.dmg);
        if (def.sticky) a.push('くっつく');
        a.push(def.charges + 'こ');
        a.push(def.cooldown + '秒で回復');
        return a.join(' / ');
      }
      if (def.pellets > 1) a.push('ダメージ' + def.dmg + '×' + def.pellets);
      else if (def.proj && def.proj.radius > 0 && def.proj.splashDmg > 0) a.push('ダメージ' + def.dmg + '+爆風' + def.proj.splashDmg);
      else if (def.type === 'flame') a.push('ダメージ' + def.dmg + '+やけど');
      else a.push('ダメージ' + def.dmg);
      if (def.burst) a.push(def.burst.n + '点バースト');
      else if (def.charge > 0) a.push('チャージ');
      else if (def.type === 'beam') a.push('ビーム');
      else if (def.type === 'flame') a.push('放射');
      else a.push(def.auto ? '連射' : '単発');
      if (def.type === 'flame') a.push('燃料' + def.mag);
      else if (def.type === 'beam') a.push('エネルギー' + def.mag);
      else a.push(def.mag + '発');
      return a.join(' / ');
    }
  };
})();
