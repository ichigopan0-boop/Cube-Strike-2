/* ==========================================================================
   CUBE STRIKE — tower.js
   塔のぼり（v3）: 30階の塔を のぼる。スプラトゥーンの「サイド・オーダー」みたいに、
   階をクリアするごとに「つぎの階（とびら）」と「パワーアップチップ」を 3つから1つえらぶ。
   ・階のしゅるい: ぜんめつ（てきを全部たおす）/ クリスタル（こわす）/ サバイバル（時間まで生きのこる）/ ボス（10・20・30階）
   ・のこり（残機）が 0 になったら おしまい。さいこう記録を むずかしさごとに保存
   ・クリアすると まんなかに光の柱。入ると つぎの とびらを えらぶ
   ・30階のボスをたおすと ダンス → 結果
   v4:
   ・階は ぜんぶ 屋外（5かいごとに そうげん → さばく → もり → ゆきやま → ゆうやけ → かざん）
   ・みんなで塔のぼり（オンライン・4人まで。へやの mode = 'tower'）:
       ホストが てき（コンピューター）を動かし、階の じょうほう（種・階・とびら・チップ）を start で みんなに配る。
       階のマップ・クリスタルは みんなが 同じ種から 作る（buildFloor は 種と plan だけで きまる）。
     - とびらは 一人ひとりが えらぶ。えらんだチップは みんなに つく（3人なら 3こ・★3 は 2こぶん）。
       つぎの階は いちばん多く えらばれた とびら（同じ数なら ホストの えらび → 先に えらんだ人）。
       えらばない人がいても 40秒で すすむ（その人は 左の とびら）
     - のこりは みんなで ひとつ（人数ぶん ふえる）。のこり0 で たおれた人は おうえん（なかまを見る）。
       ぜんいん おうえんに なったら おしまい。階をクリアすると みんな もどってくる
     - 人数が多いほど てきが ふえて・かたく・すこし つよくなる（ボスは もっと かたい）
   ・ひとりの塔のぼりも 同じ道すじ（start を じぶんだけに配る）。offline なので とびらを えらぶ間は 止まる
   CS.Tower = 階を作る道具（buildFloor / チップ / むずかしさ）。CS.Game.prototype に startTower などを足す。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const B = CS.BLOCK, RULES = CS.RULES, PLAYER = CS.PLAYER;
  const TOP = 30;
  const HALF = PLAYER.half;
  const PICK_TIME = 40;          // みんなで: 光の柱が出てから これだけで つぎへ すすむ
  const MAX_N = 4;               // みんなで: 4人まで
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  const DIFFS = {
    easy: { id: 'easy', name: 'かんたん', lives: 5, dmg: 0.55, hp: 0.8, desc: 'のこり5・てきが よわめ' },
    normal: { id: 'normal', name: 'ふつう', lives: 3, dmg: 0.8, hp: 1, desc: 'のこり3' },
    hard: { id: 'hard', name: 'むずかしい', lives: 2, dmg: 1.05, hp: 1.25, desc: 'のこり2・てきが タフ' }
  };
  const KINDS = {
    elim: { id: 'elim', name: 'ぜんめつ', desc: 'てきを ぜんぶ たおせ' },
    target: { id: 'target', name: 'クリスタル', desc: 'クリスタルを ぜんぶ こわせ' },
    survive: { id: 'survive', name: 'サバイバル', desc: '時間まで いきのこれ' },
    boss: { id: 'boss', name: 'ボス', desc: 'ボスを たおせ' }
  };

  /* ---------- パワーアップチップ（w = 出やすさ、max = もてる数、rare = ★2 以上のとびらだけ） ---------- */
  const CHIPS = [
    { id: 'dmg', name: 'こうげき', desc: 'ダメージ +15%', w: 10, apply: (m) => { m.dmg *= 1.15; } },
    { id: 'rate', name: 'れんしゃ', desc: 'うつ速さ +12%', w: 9, apply: (m) => { m.rate *= 1.12; } },
    { id: 'move', name: 'はやあし', desc: 'うごく速さ +8%', w: 7, max: 4, apply: (m) => { m.move *= 1.08; } },
    { id: 'hp', name: 'たいりょく', desc: 'さいだいHP +25', w: 9, apply: (m) => { m.hp += 25; } },
    { id: 'regen', name: 'かいふく', desc: '回復が はやく つよくなる', w: 7, max: 4, apply: (m) => { m.regenDelay = Math.max(1.5, m.regenDelay - 1); m.regenRate += 8; } },
    { id: 'reload', name: 'リロード', desc: 'リロード時間 -20%', w: 7, max: 4, apply: (m) => { m.reload *= 0.8; } },
    { id: 'mag', name: 'だんそう', desc: 'たまの数 +30%', w: 6, max: 4, apply: (m) => { m.mag *= 1.3; } },
    { id: 'bombcd', name: 'ボムじゅうでん', desc: 'ボムの回復 -25%', w: 6, max: 4, apply: (m) => { m.bombCd *= 0.75; } },
    { id: 'bomb', name: 'ボム+1', desc: 'ボムを 1こ多く もてる', w: 4, max: 3, rare: true, apply: (m) => { m.bombPlus += 1; } },
    { id: 'vamp', name: 'きゅうけつ', desc: 'てきをたおすと HP +20', w: 6, max: 5, apply: (m) => { m.heal += 20; } },
    { id: 'armor', name: 'よろい', desc: 'うけるダメージ -12%', w: 7, max: 5, apply: (m) => { m.armor *= 0.88; } },
    { id: 'jump', name: 'ジャンプ', desc: 'ジャンプ力 +12%', w: 4, max: 3, apply: (m) => { m.jump *= 1.12; } },
    { id: 'blast', name: 'ばくはつ', desc: 'ばくはつの はんい +20%', w: 4, max: 3, apply: (m) => { m.radius *= 1.2; } },
    { id: 'spgain', name: 'ひっさつチャージ', desc: '必殺ゲージが たまりやすい +40%', w: 6, max: 3, apply: (m) => { m.spGain *= 1.4; } },
    { id: 'life', name: 'のこり+1', desc: 'のこりが 1 ふえる', w: 3, rare: true, apply: (m, run) => { run.lives += 1; } }
  ];
  const CHIP_MAP = {};
  for (const c of CHIPS) CHIP_MAP[c.id] = c;

  function newMods() {
    return {
      dmg: 1, rate: 1, move: 1, reload: 1, mag: 1, hp: 0, regenDelay: RULES.regenDelay, regenRate: RULES.regenRate,
      bombCd: 1, bombPlus: 0, heal: 0, armor: 1, jump: 1, radius: 1, spGain: 1
    };
  }
  /* 届いた mods を 安全に（ありえない数は はばを きめる） */
  const MOD_LIM = {
    dmg: [0.5, 12], rate: [0.5, 6], move: [0.5, 3], reload: [0.05, 2], mag: [0.5, 12], hp: [0, 800],
    regenDelay: [1, 10], regenRate: [0, 200], bombCd: [0.02, 2], bombPlus: [0, 6], heal: [0, 400],
    armor: [0.05, 1], jump: [0.5, 3], radius: [0.5, 4], spGain: [0.5, 4]
  };
  function cleanMods(o) {
    const m = newMods();
    if (!o || typeof o !== 'object') return m;
    for (const k in MOD_LIM) if (typeof o[k] === 'number' && isFinite(o[k])) m[k] = clamp(o[k], MOD_LIM[k][0], MOD_LIM[k][1]);
    m.bombPlus = m.bombPlus | 0;
    return m;
  }
  function cleanChips(o) {
    const c = {};
    if (!o || typeof o !== 'object') return c;
    for (const k in o) if (CHIP_MAP[k]) c[k] = clamp(o[k] | 0, 0, 99);
    return c;
  }

  /* パワーアップ入りのぶきのコピー（もとの定義は変えない。id はそのまま） */
  function modGun(g, m) {
    const d = (k) => (m && m[k] > 0 ? m[k] : 1);
    const o = Object.assign({}, g);
    o.dmg = g.dmg * d('dmg');
    o.rpm = g.rpm * d('rate');
    if (g.burst) o.burst = { n: g.burst.n, rpm: g.burst.rpm * d('rate') };
    o.mag = Math.max(1, Math.round(g.mag * d('mag')));
    o.reload = g.reload * d('reload');
    o.move = (g.move || 1) * d('move');
    if (g.charge) o.charge = g.charge / d('rate');
    if (g.spinup) o.spinup = g.spinup / d('rate');
    if (g.proj) o.proj = Object.assign({}, g.proj, { splashDmg: g.proj.splashDmg * d('dmg'), radius: g.proj.radius * d('radius') });
    if (g.flame) o.flame = Object.assign({}, g.flame, { tick: g.flame.tick * d('rate') });
    return o;
  }
  function modBomb(b, m) {
    const d = (k) => (m && m[k] > 0 ? m[k] : 1);
    const o = Object.assign({}, b);
    o.dmg = b.dmg * d('dmg');
    o.radius = b.radius * d('radius');
    o.cooldown = b.cooldown * d('bombCd');
    o.charges = b.charges + ((m && m.bombPlus) | 0);
    if (b.cluster) o.cluster = Object.assign({}, b.cluster, { dmg: b.cluster.dmg * d('dmg'), radius: b.cluster.radius * d('radius') });
    return o;
  }

  /* ---------- 人数で てきが つよくなる（1人 = そのまま） ---------- */
  function scaleFor(n) {
    const k = clamp((n | 0) - 1, 0, MAX_N - 1);
    return {
      count: 1 + 0.5 * k,          // てきの数
      hp: 1 + 0.25 * k,            // てきの HP
      dmg: 1 + 0.06 * k,           // てきの こうげき
      boss: 1 + 0.6 * k,           // ボスの HP
      crystal: 1 + 0.3 * k,        // クリスタルの HP
      crystals: k,                 // クリスタルの 数（+）
      time: 5 * k,                 // サバイバルの 秒（+）
      lv: k >= 2 ? 1 : 0           // 3人から てきの うでまえ +1
    };
  }

  /* ---------- 階の中身 ---------- */
  const EARLY_GUNS = ['ar', 'smg', 'dual', 'shotgun', 'needler', 'plasma', 'burst', 'lmg', 'magnum', 'grenade'];
  const LATE_GUNS = ['ar', 'smg', 'lmg', 'minigun', 'burst', 'dmr', 'magnum', 'dual', 'shotgun', 'double', 'rocket', 'grenade', 'laser', 'plasma', 'crossbow', 'flame', 'needler', 'ricochet'];
  const EARLY_BOMBS = ['frag', 'smoke', 'impulse'];
  const BOSS = {
    10: { name: 'キングキューブ', gun: 'minigun', bomb: 'frag', hp: 900, dmg: 0.5 },
    20: { name: 'ダークキューブ', gun: 'rocket', bomb: 'cluster', hp: 1400, dmg: 0.7 },
    30: { name: 'タワーマスター', gun: 'burst', bomb: 'sticky', hp: 2000, dmg: 0.75 }
  };
  const ENEMY_NAMES = ['スライム', 'ゴースト', 'ガーゴ', 'ナイト', 'ゴーレム', 'シャドウ', 'ボルト', 'ゼロ', 'ミミック', 'ドラコ'];

  /* n = いっしょに のぼる人数（1〜4） */
  function plan(floor, kind, stars, diff, n) {
    const D = DIFFS[diff] || DIFFS.normal;
    const sc = scaleFor(n || 1);
    const lv = Math.min(2, (floor >= 12 ? 2 : floor >= 4 ? 1 : 0) + (stars >= 3 && floor >= 3 ? 1 : 0) + sc.lv);
    const p = {
      level: ['easy', 'normal', 'hard'][lv],
      hpMul: D.hp * (1 + 0.035 * (floor - 1)) * sc.hp,
      dmgMul: Math.min(1.5, D.dmg * (1 + 0.02 * (floor - 1)) * (stars >= 3 ? 1.1 : 1) * sc.dmg),
      enemies: 0, respawn: false, targets: 0, time: 0, boss: null, n: n || 1
    };
    const cnt = (v, cap) => Math.min(cap, Math.round(v * sc.count));
    if (kind === 'elim') p.enemies = cnt(Math.min(6, 2 + Math.floor(floor / 5) + (stars - 1)), 10);
    else if (kind === 'target') { p.targets = 3 + stars + sc.crystals; p.enemies = cnt(Math.min(4, 1 + Math.floor(floor / 8) + (stars >= 2 ? 1 : 0)), 7); p.respawn = true; }
    else if (kind === 'survive') { p.time = 25 + 10 * stars + sc.time; p.enemies = cnt(Math.min(5, 2 + Math.floor(floor / 8) + (stars >= 3 ? 1 : 0)), 8); p.respawn = true; }
    else if (kind === 'boss') {
      const b = BOSS[floor] || BOSS[30];
      p.boss = { name: b.name, gun: b.gun, bomb: b.bomb, hp: Math.round(b.hp * D.hp * sc.boss), dmg: b.dmg * D.dmg / 0.8 * sc.dmg };
      p.enemies = cnt(Math.min(3, Math.floor(floor / 10)), 5);
      p.respawn = true;
      p.level = floor >= 20 ? 'hard' : 'normal';
    }
    return p;
  }

  /* ---------- 階のマップ（v4: 屋外。5かいごとに けしきが かわる） ---------- */
  const THEMES = [
    { env: 'day', name: 'そうげん', fence: 9, cap: 14, pal: { 1: [0.44, 0.70, 0.35], 2: [0.74, 0.72, 0.66], 3: [0.84, 0.46, 0.34], 4: [0.66, 0.46, 0.26], 7: [0.60, 0.62, 0.64], 8: [1.0, 0.90, 0.58], 9: [0.28, 0.56, 0.26], 14: [0.20, 0.44, 0.20] } },
    { env: 'desert', name: 'さばく', fence: B.WALL, cap: B.TRIM, pal: { 1: [0.88, 0.78, 0.55], 2: [0.80, 0.62, 0.43], 3: [0.26, 0.64, 0.64], 4: [0.66, 0.46, 0.26], 7: [0.66, 0.60, 0.52], 8: [0.40, 0.95, 1.0] } },
    { env: 'forest', name: 'もり', fence: 9, cap: 14, pal: { 1: [0.34, 0.58, 0.28], 2: [0.50, 0.46, 0.40], 3: [0.30, 0.52, 0.30], 4: [0.56, 0.38, 0.22], 7: [0.52, 0.54, 0.50], 8: [1.0, 0.92, 0.55], 9: [0.24, 0.48, 0.22], 14: [0.18, 0.38, 0.18] } },
    { env: 'snow', name: 'ゆきやま', fence: B.WALL, cap: B.TRIM, pal: { 1: [0.92, 0.94, 0.98], 2: [0.62, 0.66, 0.74], 3: [0.36, 0.56, 0.86], 4: [0.58, 0.42, 0.28], 7: [0.70, 0.76, 0.84], 8: [0.70, 0.92, 1.0] } },
    { env: 'sunset', name: 'ゆうやけ', fence: B.WALL, cap: B.TRIM, pal: { 1: [0.56, 0.60, 0.34], 2: [0.72, 0.58, 0.46], 3: [0.88, 0.50, 0.30], 4: [0.66, 0.44, 0.22], 7: [0.62, 0.56, 0.50], 8: [1.0, 0.80, 0.35] } },
    { env: 'dusk', name: 'かざん', fence: B.WALL, cap: B.TRIM, pal: { 1: [0.30, 0.24, 0.26], 2: [0.40, 0.30, 0.30], 3: [0.90, 0.36, 0.24], 4: [0.52, 0.34, 0.24], 7: [0.46, 0.38, 0.40], 8: [1.0, 0.50, 0.30] } }
  ];
  const themeOf = (floor) => THEMES[Math.min(THEMES.length - 1, Math.floor((floor - 1) / 5))];
  /* 3×5 の数字（上の行から） */
  const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];

  function drawNumber(g, n, W, D) {
    const s = String(n), w = s.length * 4 - 1;
    let x = Math.floor((W - w) / 2) + w - 1;          // 部屋の中から見ると x が小さいほうが右
    const z = D - 1;
    for (let k = 0; k < s.length; k++) {
      const bits = DIGITS[+s[k]];
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (bits[row * 3 + col] === '1') g.fill(x - col, 8 - row, z, x - col, 8 - row, z, B.GLOW);
        }
      }
      x -= 4;
    }
  }

  function tryBuild(floor, seed, pl, attempt, plain) {
    const K = CS.MapKit;
    const rg = CS.rng(((seed >>> 0) ^ Math.imul(floor, 2654435761) ^ Math.imul(attempt + 1, 40503)) >>> 0);
    const n = pl.n || 1;
    const S = Math.min(40, 26 + 2 * Math.floor((floor - 1) / 5) + 2 * (n - 1));
    const W = S, D = S, H = 12;
    const g = new K.Grid(W, H, D);
    const theme = themeOf(floor);
    g.shell(B.FLOOR, B.WALL, B.TRIM);
    g.openShell(2, theme.fence, theme.cap);             // v4: 屋外（ひくい さく。上は 見えない かべ）
    const cx = Math.floor(W / 2), cz = Math.floor(D / 2);
    const busy = new Uint8Array(W * D);
    const mark = (x0, z0, x1, z1) => {
      for (let z = Math.max(0, z0); z <= Math.min(D - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) busy[x + W * z] = 1;
    };
    const free = (x0, z0, x1, z1) => {
      if (x0 < 1 || z0 < 1 || x1 > W - 2 || z1 > D - 2) return false;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (busy[x + W * z]) return false;
      return true;
    };
    mark(cx - 5, 1, cx + 5, 5);            // じぶんたちの出撃
    mark(cx - 3, cz - 3, cx + 3, cz + 3);  // まんなか（光の柱）
    mark(2, D - 6, W - 3, D - 2);          // てきの出撃

    /* 床のもよう: まんなかの輪と、手前から まんなかへの線 */
    for (let a = 0; a < 24; a++) {
      const t = a / 24 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(t) * 2.5), z = Math.round(cz + Math.sin(t) * 2.5);
      g.fill(x, 0, z, x, 0, z, B.GLOW);
    }
    g.fill(cx, 0, 2, cx, 0, cz - 4, B.GLOW);

    if (!plain) {
      const want = Math.min(16, 5 + Math.floor(floor / 3) + (n - 1));
      let placed = 0, guard = 0;
      while (placed < want && guard++ < 260) {
        const r = rg();
        let w, d, h, blk, plat = false;
        if (r < 0.22) { w = 2; d = 2; h = 3 + Math.floor(rg() * 4); blk = B.METAL; }
        else if (r < 0.5) { if (rg() < 0.5) { w = 3 + Math.floor(rg() * 3); d = 1; } else { w = 1; d = 3 + Math.floor(rg() * 3); } h = 1 + Math.floor(rg() * 2); blk = B.TRIM; }
        else if (r < 0.78) { w = 1 + Math.floor(rg() * 2); d = 1 + Math.floor(rg() * 2); h = 1 + Math.floor(rg() * 2); blk = B.CRATE; }
        else { w = 3 + Math.floor(rg() * 2); d = 3 + Math.floor(rg() * 2); h = 2; blk = B.WALL; plat = true; }
        const x0 = 2 + Math.floor(rg() * Math.max(1, W - 4 - w)), z0 = 6 + Math.floor(rg() * Math.max(1, D - 13 - d));
        const x1 = x0 + w - 1, z1 = z0 + d - 1;
        /* 180° まわした場所にも置く（左右・前後のバランス） */
        const mx0 = W - 1 - x1, mx1 = W - 1 - x0, mz0 = D - 1 - z1, mz1 = D - 1 - z0;
        const pad = plat ? 2 : 1;
        if (!free(x0 - pad, z0 - pad, x1 + pad, z1 + pad)) continue;
        const mirror = free(mx0 - pad, mz0 - pad, mx1 + pad, mz1 + pad) && !(mx0 <= x1 + pad && mx1 >= x0 - pad && mz0 <= z1 + pad && mz1 >= z0 - pad);
        const put = (ax0, az0, ax1, az1, flip) => {
          g.fill(ax0, 1, az0, ax1, h, az1, blk);
          if (plat) {
            g.fill(ax0, h, az0, ax1, h, az0, B.GLOW);
            /* 1段ずつ のぼれる段（手前がわ） */
            const sz = flip ? az1 + 1 : az0 - 1;
            const sx = ax0 + Math.floor((ax1 - ax0) / 2);
            g.fill(sx, 1, sz, sx + 1 > ax1 ? sx : sx + 1, 1, sz, B.CRATE);
          } else if (blk === B.METAL) {
            g.fill(ax0, Math.min(h, 3), az0, ax1, Math.min(h, 3), az1, B.GLOW);
          }
          mark(ax0 - 1, az0 - 1, ax1 + 1, az1 + 1);
        };
        put(x0, z0, x1, z1, false);
        if (mirror) put(mx0, mz0, mx1, mz1, true);
        placed++;
      }
    }
    drawNumber(g, floor, W, D);                          // 奥の さくの上に うかぶ 階の数字

    /* 出撃地点（セルのまんなか・床の上） */
    const cellFree = (x, z) => x > 0 && z > 0 && x < W - 1 && z < D - 1 && g.data[x + W * (z + D * 1)] === 0 && g.data[x + W * (z + D * 2)] === 0;
    const at = (x, z, yaw) => ({ p: [x + 0.5, 1 + HALF + 0.002, z + 0.5], yaw: yaw });
    const mine = [at(cx, 2, Math.PI), at(cx - 2, 2, Math.PI), at(cx + 2, 2, Math.PI), at(cx - 4, 2, Math.PI), at(cx + 4, 2, Math.PI)];
    const foes = [];
    for (let x = 3; x <= W - 4; x += 3) { if (cellFree(x, D - 3)) foes.push(at(x, D - 3, 0)); }
    for (let x = 4; x <= W - 5; x += 4) { if (cellFree(x, D - 5)) foes.push(at(x, D - 5, 0)); }
    for (const z of [cz + 3, cz + 6]) {
      if (cellFree(2, z)) foes.push(at(2, z, -Math.PI / 2));
      if (cellFree(W - 3, z)) foes.push(at(W - 3, z, Math.PI / 2));
    }
    if (foes.length < 3) return null;
    const map = K.finish(g, [mine, foes], K.env(theme.env, { palette: theme.pal }));

    /* 行き来できるか（ボットの道） */
    const world = new CS.World(map);
    let nav = null;
    try { nav = world.buildNav(); } catch (e) { return null; }
    const main = (p) => { const i = world.navNodeAt(p); return i >= 0 && !!nav.main[i]; };
    if (!main(mine[0].p)) return null;
    const center = [cx + 0.5, 1 + HALF + 0.002, cz + 0.5];
    if (!main(center)) return null;
    const ok = foes.filter((s) => main(s.p));
    if (ok.length < 3 && !plain) return null;
    map.spawns[1] = ok.length ? ok : foes;

    /* クリスタル: じぶんから 8m 以上、クリスタルどうし 4m 以上 はなれた 足場の上（むねの高さ） */
    const targets = [];
    if (pl.targets > 0 && nav.mainList && nav.mainList.length) {
      const q = [0, 0, 0];
      for (let k = 0; k < 400 && targets.length < pl.targets; k++) {
        const nd = nav.mainList[Math.floor(rg() * nav.mainList.length)];
        world.navPos(nd, q);
        if (Math.hypot(q[0] - mine[0].p[0], q[2] - mine[0].p[2]) < 8) continue;
        if (Math.hypot(q[0] - center[0], q[2] - center[2]) < 2) continue;
        let near = false;
        for (const t of targets) if (Math.hypot(t[0] - q[0], t[2] - q[2]) < 4) near = true;
        if (near) continue;
        if (world.solidAt(q[0], q[1] + 1.0, q[2])) continue;
        targets.push([q[0], q[1] + 0.55, q[2]]);
      }
    }
    return { map: map, center: center, targets: targets, plan: pl };
  }

  function buildFloor(floor, seed, pl) {
    for (let a = 0; a < 8; a++) {
      const r = tryBuild(floor, seed, pl, a, false);
      if (r) return r;
    }
    return tryBuild(floor, seed, pl, 99, true);
  }

  /* ---------- てき・ボスの見た目 ---------- */
  function enemySkin(floor, boss) {
    const S = CS.Skins;
    if (!S) return null;
    const face = (id) => { for (const f of S.FACES) if (f.id === id) return f.f; return S.DEFAULT_FACE; };
    if (boss) return S.clean({ c: '#23262f', c2: '#e8b923', f: face('cool'), h: 'crown', p: 'frame' });
    if (floor < 10) return S.clean({ c: '#6a4bc4', c2: '#ffd23d', f: face('angry'), h: 'horn', p: 'none' });
    if (floor < 20) return S.clean({ c: '#1f7a74', c2: '#8ff0c8', f: face('robot'), h: 'antenna', p: 'none' });
    return S.clean({ c: '#a3263a', c2: '#ffd23d', f: face('angry'), h: 'horn', p: 'cross' });
  }

  /* チップを1つ（used にあるもの・もてる数をこえるもの・★1 のとびらの レアチップ はのぞく） */
  function pickChip(run, stars, rg, used) {
    let total = 0;
    const pool = [];
    for (const c of CHIPS) {
      if (used[c.id]) continue;
      if (c.rare && stars < 2) continue;
      if (c.max && (run.chips[c.id] | 0) >= c.max) continue;
      pool.push(c); total += c.w;
    }
    if (!pool.length) return null;
    let r = rg() * total;
    for (const c of pool) { r -= c.w; if (r <= 0) return c; }
    return pool[pool.length - 1];
  }

  /* 届いた とびら（ゲスト）を 安全に */
  function cleanChoices(a) {
    const out = [];
    if (!Array.isArray(a)) return out;
    for (let i = 0; i < a.length && i < 3; i++) {
      const c = a[i] || {};
      if (!KINDS[c.kind] || !CHIP_MAP[c.chip]) continue;
      out.push({ kind: c.kind, stars: clamp(c.stars | 0, 1, 3), chip: c.chip, mult: clamp(c.mult | 0, 1, 2), floor: clamp(c.floor | 0, 1, TOP) });
    }
    return out;
  }

  CS.Tower = {
    TOP: TOP, DIFFS: DIFFS, KINDS: KINDS, CHIPS: CHIPS, CHIP_MAP: CHIP_MAP, THEMES: THEMES, MAX_N: MAX_N, PICK_TIME: PICK_TIME,
    newMods: newMods, modGun: modGun, modBomb: modBomb, plan: plan, buildFloor: buildFloor, scaleFor: scaleFor, themeOf: themeOf
  };

  /* ======================================================================
     Game に足す
     ====================================================================== */
  const G = CS.Game.prototype;
  const STATE_CODE = { fight: 0, clear: 1, dead: 2, over: 3, won: 4 };
  const bestKey = (run) => (run && run.coop ? 'towerBestCoop' : 'towerBest');
  function bestTable(key) {
    let b = CS.Settings[key];
    if (!b || typeof b !== 'object') b = CS.Settings[key] = { easy: 0, normal: 0, hard: 0 };
    return b;
  }

  /* ひとりで（オフライン）。opt = {diff: 'easy'|'normal'|'hard'} */
  G.startTower = function (opt) {
    opt = opt || {};
    if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
    const diff = DIFFS[opt.diff] ? opt.diff : 'normal';
    this._teardown();
    this.isHost = true;
    this.myNetId = 'host';
    this.offline = true;
    this.tower = this._towerNewRun(diff, false, [{
      id: 'host', name: String(CS.Settings.name || 'プレイヤー'), gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(),
      skin: this._mySkin(), fc: ''
    }]);
    this._towerFloor();
    return true;
  };

  /* みんなで（へやの ホストが 「のぼる！」）。へやの みんなが なかま */
  G._towerStartCoop = function () {
    if (!CS.Bots || typeof CS.Bots.create !== 'function' || !this.isHost || !this.room) return false;
    const D = this.room.tower && DIFFS[this.room.tower.diff] ? this.room.tower.diff : 'normal';
    const humans = this.room.players.slice(0, MAX_N).map((p) => ({
      id: p.id, name: p.name, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, skin: p.skin || null, fc: p.fc || ''
    }));
    if (!humans.length) return false;
    this.offline = false;
    this.tower = this._towerNewRun(D, true, humans);
    this._towerFloor();
    return true;
  };

  G._towerNewRun = function (diff, coop, humans) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const n = coop ? clamp(humans.length, 1, MAX_N) : 1;
    return {
      host: true, coop: !!coop, diff: diff, floor: 1, top: TOP, n: n, lives: DIFFS[diff].lives + (n - 1), seed: seed,
      mods: newMods(), chips: {}, kind: 'elim', stars: 1,
      kills: 0, deaths: 0, time: 0, state: 'fight', clearT: 0, deadT: 0,
      timeLeft: 0, portal: null, next: null, picks: {}, pickOrder: [], pickDeadline: 0,
      best0: bestTable(coop ? 'towerBestCoop' : 'towerBest')[diff] | 0, rg: CS.rng((seed ^ 0x9e3779b9) >>> 0),
      humans: humans, sp: {}, left: 0, myPick: -1, pickOpen: false, picked: 0, need: 0, pickLeft: 0, thp: 0
    };
  };

  /* ホスト: いまの階を 作って みんなに配る（start）。とどいた start で それぞれが _beginMatch */
  G._towerFloor = function () {
    const run = this.tower;
    let humans = run.humans;
    if (run.coop && this.room) {
      const ids = {};
      for (const p of this.room.players) ids[p.id] = 1;
      humans = humans.filter((h) => ids[h.id]);
      if (!humans.length) humans = run.humans.filter((h) => h.id === this.myNetId);
      if (!humans.length) humans = run.humans.slice(0, 1);
    }
    run.n = run.coop ? clamp(humans.length, 1, MAX_N) : 1;
    const built = this._towerBuilt(run);
    const pl = built.plan;
    run.timeLeft = pl.time;
    run.thp = Math.round((120 + run.floor * 8) * DIFFS[run.diff].hp * scaleFor(run.n).crystal);

    const players = [], spawns = [], slot = [0, 0];
    const add = (pd) => { players.push(pd); spawns.push(slot[pd.team]++); };
    for (const h of humans) add({ id: h.id, name: h.name, team: 0, gun: h.gun, gun2: h.gun2 || '', gm: h.gm || '', gm2: h.gm2 || '', bomb: h.bomb, skin: h.skin || null, fc: h.fc || '' });
    const rg = CS.rng(((run.seed ^ Math.imul(run.floor, 97)) >>> 0));
    const guns = run.floor < 8 ? EARLY_GUNS : LATE_GUNS;
    const skin = enemySkin(run.floor, false);
    const bl = run.floor < 6 ? EARLY_BOMBS : CS.Bombs.filter((b) => !b.noBot).map((b) => b.id);
    for (let i = 0; i < pl.enemies; i++) {
      const g = CS.Weapons.gun(guns[Math.floor(rg() * guns.length)]);
      const b = CS.Weapons.bomb(bl[Math.floor(rg() * bl.length)]);
      add({
        id: 'bot' + i, name: '' + ENEMY_NAMES[(i + run.floor) % ENEMY_NAMES.length], team: 1, gun: g.id, bomb: b.id,
        bot: pl.level, skin: skin, npc: 1, dm: r3(pl.dmgMul), hp: Math.round(RULES.hp * pl.hpMul), nr: pl.respawn ? 0 : 1
      });
    }
    if (pl.boss) {
      const g = CS.Weapons.gun(pl.boss.gun), b = CS.Weapons.bomb(pl.boss.bomb);
      add({
        id: 'boss', name: pl.boss.name, team: 1, gun: g.id, bomb: b.id, bot: 'hard', skin: enemySkin(run.floor, true),
        npc: 1, boss: 1, dm: r3(pl.boss.dmg), hp: pl.boss.hp, nr: 1, rr: 6
      });
    }
    this._broadcast({
      t: 'start', seed: (run.seed + run.floor * 131) | 0, mode: 'tower', players: players, spawns: spawns,
      rule: { id: 'tower' }, tower: this._towerWire()
    });
  };

  /* start に入れる 階の じょうほう（ゲストは これだけで 同じ階を作る） */
  G._towerWire = function () {
    const run = this.tower;
    return {
      coop: run.coop ? 1 : 0, floor: run.floor, seed: run.seed, kind: run.kind, stars: run.stars, diff: run.diff, n: run.n,
      lives: run.lives, mods: run.mods, chips: run.chips, kills: run.kills, deaths: run.deaths, time: r2(run.time),
      tl: run.timeLeft, thp: run.thp, sp: run.sp
    };
  };

  /* みんな: start の 階の じょうほうを うけとる（ホストは じぶんの run に 同じものが入っている） */
  G._towerSync = function (w) {
    let run = this.tower;
    if (!run || !this.isHost) run = this.tower = Object.assign(run || {}, { host: false });
    run.coop = !!w.coop;
    run.floor = clamp(w.floor | 0, 1, TOP);
    run.seed = w.seed | 0;
    run.kind = KINDS[w.kind] ? w.kind : 'elim';
    run.stars = clamp(w.stars | 0, 1, 3);
    run.diff = DIFFS[w.diff] ? w.diff : 'normal';
    run.n = clamp(w.n | 0, 1, MAX_N);
    run.top = TOP;
    run.lives = Math.max(0, w.lives | 0);
    run.mods = cleanMods(w.mods);
    run.chips = cleanChips(w.chips);
    run.kills = Math.max(0, w.kills | 0);
    run.deaths = Math.max(0, w.deaths | 0);
    run.time = Math.max(0, num(w.time));
    run.timeLeft = Math.max(0, num(w.tl));
    run.thp = clamp(w.thp | 0, 1, 99999);
    run.sp = w.sp && typeof w.sp === 'object' ? w.sp : {};
    run.state = 'fight'; run.portal = null; run.clearT = 0; run.deadT = 0;
    run.next = null; run.myPick = -1; run.pickOpen = false; run.picked = 0; run.need = 0; run.pickLeft = 0;
    if (this.isHost) { run.picks = {}; run.pickOrder = []; }
    const built = this._towerBuilt(run);
    run.center = built.center; run.plan = built.plan;
    run.left = 0;
    if (run.best0 === undefined) run.best0 = bestTable(bestKey(run))[run.diff] | 0;
    /* さいこう記録（この階まで来た） */
    const best = bestTable(bestKey(run));
    if (run.floor > (best[run.diff] | 0)) { best[run.diff] = run.floor; if (CS.saveSettings) CS.saveSettings(); }
  };

  /* 階を作る（同じ 種・階・とびら・人数なら 同じもの。1回作ったら おぼえておく） */
  G._towerBuilt = function (run) {
    const key = run.seed + ':' + run.floor + ':' + run.kind + ':' + run.stars + ':' + run.diff + ':' + run.n;
    if (this._twBuiltKey === key && this._twBuilt) return this._twBuilt;
    const pl = plan(run.floor, run.kind, run.stars, run.diff, run.n);
    this._twBuilt = buildFloor(run.floor, run.seed, pl);
    this._twBuiltKey = key;
    return this._twBuilt;
  };

  G._towerMapDef = function () {
    const run = this.tower;
    if (!run) return null;
    const b = this._towerBuilt(run);
    return { id: 'tower', name: run.floor + 'F', build: () => b.map };
  };

  /* みんな: ひとりぶんの ぶき・HP（チップの パワーアップ・てきの つよさ） */
  G._towerDefs = function (pd) {
    const run = this.tower;
    if (!run) return null;
    const gun = pd.npc ? CS.Weapons.gun(pd.gun) : CS.gunWith(pd.gun, CS.cleanMods(pd.gm, pd.gun)), bomb = CS.Weapons.bomb(pd.bomb);
    if (pd.npc) {
      const em = { dmg: clamp(num(pd.dm) || 1, 0.1, 5) };
      return {
        base: { gunDef: modGun(gun, em), bombDef: modBomb(bomb, em), maxHp: clamp(pd.hp | 0, 1, 99999) },
        extra: { noRespawn: !!pd.nr, boss: !!pd.boss, regenRate: pd.rr > 0 ? clamp(num(pd.rr), 0, 50) : undefined, npc: true }
      };
    }
    const m = run.mods;
    return {
      base: { gunDef: modGun(gun, m), gun2Def: CS.cleanGun2(pd.gun2, pd.gun) ? modGun(CS.gunWith(pd.gun2, CS.cleanMods(pd.gm2, pd.gun2)), m) : null, bombDef: modBomb(bomb, m), maxHp: RULES.hp + m.hp },
      extra: { armor: m.armor, healOnKill: m.heal, jumpMul: m.jump, regenDelay: m.regenDelay, regenRate: m.regenRate, spMul: m.spGain || 1 }
    };
  };

  /* みんな: クリスタル（_beginMatch から。種から 同じ場所に） */
  G._towerTargets = function () {
    const run = this.tower;
    const b = this._towerBuilt(run);
    this.targets.length = 0;
    for (const t of b.targets) {
      this.targets.push({
        base: [t[0], t[1], t[2]], pos: [t[0], t[1], t[2]], slide: 0, phase: 0, speed: 0,
        hp: run.thp, max: run.thp, dead: false, respawnAt: 0, hitT: 0, noRespawn: true, color: [0.55, 0.95, 1]
      });
    }
    run.total = b.plan.boss ? 1 : (b.plan.targets > 0 ? this.targets.length : b.plan.enemies);
    run.left = run.total;
  };

  /* みんな: 階の名前（_beginMatch の さいご。HUD を出したあとで） */
  G._towerTitle = function () {
    const run = this.tower;
    const K = KINDS[run.kind];
    const th = themeOf(run.floor);
    CS.UI.hud.center(run.floor + 'F  ' + K.name, run.kind === 'boss' ? '#ffd23d' : '#bff0ff', 1900);
    if (run.floor % 5 === 1) CS.UI.toast(th.name + ' の かい');
    this._sfx('count');
  };

  /* カウントダウン（階の名前を出しているので 数字は出さない） */
  G._towerCountdown = function (n) {
    if (n > 0) return;
    const K = KINDS[this.tower.kind];
    CS.UI.hud.center(K.desc + '！', '#7fd6ff', 1300);
    this._sfx('go');
  };

  /* のこり（てき・クリスタル）。ゲストは ホストから届いた数 */
  G._towerLeft = function () {
    const run = this.tower;
    if (!this.isHost) return run.left | 0;
    if (run.kind === 'target') { let n = 0; for (const t of this.targets) if (!t.dead) n++; return n; }
    if (run.kind === 'boss') { for (const p of this.players) if (p.boss && p.alive) return 1; return 0; }
    if (run.kind === 'elim') { let n = 0; for (const p of this.players) if (p.npc && p.alive) n++; return n; }
    return 0;
  };

  /* ホスト: 階ごとの しごと（_hostTick から） */
  G._towerTick = function (dt) {
    const run = this.tower;
    if (!run || this.phase !== 'live') return;
    if (run.state === 'fight' || run.state === 'clear') run.time += dt;
    if (run.state === 'fight') {
      if (run.kind === 'survive') {
        run.timeLeft = Math.max(0, run.timeLeft - dt);
        if (run.timeLeft <= 0) this._towerClear();
      } else if (this._towerLeft() === 0) this._towerClear();
    } else if (run.state === 'clear') {
      if (run.coop && this.time >= run.pickDeadline) this._towerAutoPick();
    } else if (run.state === 'dead') {
      run.deadT += dt;
      if (run.deadT > 2.4) this._towerOver(false);
    }
    if (run.state === 'fight') run.left = this._towerLeft();
  };

  /* みんな: 光の柱に入ったら とびらを えらぶ画面（フレームごと） */
  G._towerLocal = function (dt) {
    const run = this.tower;
    if (!run) return;
    if (!this.isHost && (run.state === 'fight' || run.state === 'clear')) run.time += dt;
    if (run.state !== 'clear') return;
    run.clearT += dt;
    if (run.pickLeft > 0) run.pickLeft = Math.max(0, run.pickLeft - dt);
    const P = run.portal, me = this.players[this.me];
    if (!P || !me || !me.alive || run.myPick >= 0 || run.pickOpen || !run.next || !run.next.length) return;
    if (run.clearT > 0.6 && Math.hypot(me.pos[0] - P[0], me.pos[2] - P[2]) < 1.25 && Math.abs(me.pos[1] - P[1]) < 1.8) this._towerOpenPick();
  };

  G._towerOpenPick = function () {
    const run = this.tower;
    run.pickOpen = true;
    if (this.offline) { this.hold = true; this._stopLoops(); }
    try { CS.Input.enable(false); } catch (e) {}
    this._sfx('chip');
    const self = this;
    if (CS.UI.towerPick) CS.UI.towerPick(this._towerInfo(false), run.next, function (i) { self.towerChoose(i); });
    this._towerPickUi();
  };

  /* とびらを えらんだ（じぶん）→ ホストへ */
  G.towerChoose = function (i) {
    const run = this.tower;
    if (!run || run.state !== 'clear' || !run.next || run.myPick >= 0 || !run.next[i]) return false;
    run.myPick = i;
    this._toHost({ t: 'twpk', i: this.me, c: i });
    this._towerPickUi();
    return true;
  };

  /* えらぶ画面の「みんなを まっています」 */
  G._towerPickUi = function () {
    const run = this.tower;
    if (!run || !run.coop || !CS.UI.towerPickWait) return;
    CS.UI.towerPickWait({ mine: run.myPick, picked: run.picked, need: run.need, left: Math.ceil(run.pickLeft || 0), host: this.isHost });
  };

  /* ホスト: だれかが えらんだ */
  G._hostTowerPick = function (msg, fromId) {
    const run = this.tower;
    if (!run || run.state !== 'clear' || !run.next) return;
    const idx = this._idxOf(fromId);
    const p = this.players[idx];
    if (!p || p.npc || (msg.i | 0) !== idx) return;
    const c = msg.c | 0;
    if (!run.next[c] || run.picks[p.id] !== undefined) return;
    run.picks[p.id] = c;
    run.pickOrder.push(p.id);
    if (this._towerAllPicked()) this._towerAdvance();
    else this._hostStatus();
  };

  /* つながっている なかま ぜんいんが えらんだか */
  G._towerAllPicked = function () {
    const run = this.tower;
    for (const p of this.players) if (!p.npc && p.connected && run.picks[p.id] === undefined) return false;
    return true;
  };
  G._towerPickCount = function () {
    const run = this.tower;
    let picked = 0, need = 0;
    for (const p of this.players) {
      if (p.npc || !p.connected) continue;
      need++;
      if (run.picks && run.picks[p.id] !== undefined) picked++;
    }
    return [picked, need];
  };

  /* ホスト: 時間ぎれ（えらんでいない人は 左の とびら） */
  G._towerAutoPick = function () {
    const run = this.tower;
    if (!run || run.state !== 'clear' || !run.next) return;
    for (const p of this.players) {
      if (p.npc || !p.connected || run.picks[p.id] !== undefined) continue;
      run.picks[p.id] = 0;
      run.pickOrder.push(p.id);
    }
    this._towerAdvance();
  };

  /* ホスト: みんなの チップを つけて、いちばん多い とびらの 階へ */
  G._towerAdvance = function () {
    const run = this.tower;
    if (!run || run.state !== 'clear' || !run.next) return;
    const votes = [0, 0, 0];
    for (const id of run.pickOrder) {
      const c = run.picks[id];
      const d = run.next[c];
      if (!d) continue;
      votes[c]++;
      const chip = CHIP_MAP[d.chip];
      for (let k = 0; k < (d.mult | 0 || 1); k++) {
        chip.apply(run.mods, run);
        run.chips[chip.id] = (run.chips[chip.id] | 0) + 1;
      }
    }
    let best = 0;
    for (let i = 1; i < 3; i++) if (votes[i] > votes[best]) best = i;
    const tied = [];
    for (let i = 0; i < 3; i++) if (votes[i] === votes[best]) tied.push(i);
    if (tied.length > 1) {
      const hp = run.picks[this.myNetId];
      if (tied.indexOf(hp) >= 0) best = hp;
      else for (const id of run.pickOrder) { if (tied.indexOf(run.picks[id]) >= 0) { best = run.picks[id]; break; } }
    }
    const c = run.next[best] || run.next[0];
    /* 必殺ゲージは つぎの階へ もちこす */
    for (const p of this.players) if (!p.npc) run.sp[p.id] = r2(p.sp || 0);
    run.floor = c.floor;
    run.kind = c.kind;
    run.stars = c.stars;
    run.next = null; run.picks = {}; run.pickOrder = [];
    this.hold = false;
    this._towerFloor();
  };

  /* ホスト: だれかが たおれた（_hostApplyDamage から） */
  G._towerKill = function (v, a) {
    const run = this.tower;
    if (!v.npc) {
      run.deaths++;
      /* クリアしたあとは ただで もどる */
      if (run.state !== 'fight') { v.respawnAt = this.time + 1.5; return; }
      run.lives--;
      if (run.lives <= 0) {
        run.lives = 0;
        v.respawnAt = 0;
        v.out = true;                   // のこり0: おうえん（なかまを見る）
        let up = 0;
        for (const p of this.players) if (!p.npc && p.connected && !p.out) up++;
        if (up === 0) { run.state = 'dead'; run.deadT = 0; }
      }
      return;
    }
    if (a && !a.npc) run.kills++;
    if (v.noRespawn || run.state !== 'fight') v.respawnAt = 0;
  };

  G._towerTargetDown = function () {
    const run = this.tower;
    if (!run || run.state !== 'fight' || !this.isHost) return;
    const left = this._towerLeft();
    run.left = left;
    if (left > 0) CS.UI.hud.center('クリスタル のこり ' + left, '#8ff0ff', 900);
  };

  /* ホスト: 階をクリア: てきは消える・なかまは もどってくる。まんなかに光の柱（30階なら ダンスでおしまい） */
  G._towerClear = function () {
    const run = this.tower;
    if (run.state !== 'fight') return;
    run.state = 'clear'; run.clearT = 0;
    for (const p of this.players) {
      if (!p.npc) continue;
      if (p.alive) { this._boom(p.rpos, 1.2, [0.75, 0.45, 1], false); p.alive = false; }
      p.respawnAt = 0;
      if (p.bot) this._stopBotLoops(p);
    }
    this.projectiles = this.projectiles.filter((q) => !(this.players[q.owner] && this.players[q.owner].npc));
    this.bombs = this.bombs.filter((q) => !(this.players[q.owner] && this.players[q.owner].npc));
    for (const p of this.players) {
      if (p.npc || !p.connected) continue;
      p.out = false;
      if (p.alive) p.hp = p.maxHp || RULES.hp;
      else this._hostRespawn(p);
    }
    if (run.floor >= TOP) { this._towerWin(); return; }
    run.next = this._towerChoices();
    run.picks = {}; run.pickOrder = [];
    run.pickDeadline = this.time + PICK_TIME;
    run.portal = [run.center[0], run.center[1], run.center[2]];
    this._broadcast({ t: 'twc', p: [r2(run.portal[0]), r2(run.portal[1]), r2(run.portal[2])], ch: run.next, dl: PICK_TIME });
  };

  /* みんな: 階をクリアした（光の柱・とびら） */
  G._onTowerClear = function (m) {
    const run = this.tower;
    if (!run || this.mode !== 'match') return;
    const p0 = Array.isArray(m.p) && m.p.length === 3 ? [num(m.p[0]), num(m.p[1]), num(m.p[2])] : run.center;
    run.state = 'clear'; run.clearT = 0; run.portal = p0;
    run.next = cleanChoices(m.ch);
    run.myPick = -1; run.pickOpen = false; run.pickLeft = run.coop ? clamp(num(m.dl) || PICK_TIME, 1, 120) : 0;
    if (!this.isHost) {
      for (const p of this.players) if (p.npc && p.alive) { this._boom(p.rpos, 1.2, [0.75, 0.45, 1], false); p.alive = false; }
      this.projectiles = this.projectiles.filter((q) => !(this.players[q.owner] && this.players[q.owner].npc));
      this.bombs = this.bombs.filter((q) => !(this.players[q.owner] && this.players[q.owner].npc));
    }
    CS.UI.hud.center(run.floor + 'F クリア！ 光の柱へ！', '#ffd23d', 2200);
    this._sfx('win');
    this._sfx('portal', run.portal);
  };

  /* つぎの階のとびら（3つ）: [{kind, stars, chip, mult, floor}] */
  G._towerChoices = function () {
    const run = this.tower;
    const nf = run.floor + 1;
    const boss = nf % 10 === 0;
    const rg = run.rg;
    const kinds = boss ? ['boss', 'boss', 'boss'] : ['elim', 'target', 'survive'];
    for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rg() * (i + 1)); const t = kinds[i]; kinds[i] = kinds[j]; kinds[j] = t; }
    const stars = boss ? [2, 2, 2] : [1, 2, 3];
    for (let i = stars.length - 1; i > 0; i--) { const j = Math.floor(rg() * (i + 1)); const t = stars[i]; stars[i] = stars[j]; stars[j] = t; }
    const out = [];
    const used = {};
    for (let i = 0; i < 3; i++) {
      const s = stars[i];
      const c = pickChip(run, s, rg, used) || pickChip(run, 3, rg, {}) || CHIPS[0];
      used[c.id] = 1;
      out.push({ kind: kinds[i], stars: s, chip: c.id, mult: s >= 3 ? 2 : 1, floor: nf });
    }
    return out;
  };

  /* ホスト: hs に のせる 塔のぼりの じょうほう */
  G._towerStatus = function (m) {
    const run = this.tower;
    const pc = this._towerPickCount();
    m.tw = [STATE_CODE[run.state] | 0, run.lives, Math.ceil(run.timeLeft), run.left | 0, run.kills, run.deaths,
      pc[0], pc[1], Math.max(0, Math.ceil(run.pickDeadline - this.time)), r2(run.time)];
    /* ホストの えらぶ画面も 数を かえる */
    run.picked = pc[0]; run.need = pc[1];
    if (run.state === 'clear') { run.pickLeft = Math.max(0, run.pickDeadline - this.time); if (run.pickOpen) this._towerPickUi(); }
  };

  /* ゲスト: hs の 塔のぼり（数だけ。ようすの かわりめは twc / start / twe が きめる） */
  G._towerApplyStatus = function (tw) {
    const run = this.tower;
    if (!Array.isArray(tw) || tw.length < 10) return;
    run.lives = Math.max(0, tw[1] | 0);
    run.timeLeft = Math.max(0, num(tw[2]));
    run.left = Math.max(0, tw[3] | 0);
    run.kills = Math.max(run.kills | 0, tw[4] | 0);
    run.deaths = Math.max(run.deaths | 0, tw[5] | 0);
    run.picked = Math.max(0, tw[6] | 0); run.need = Math.max(0, tw[7] | 0);
    if (run.state === 'clear') { run.pickLeft = Math.max(0, num(tw[8])); if (run.pickOpen) this._towerPickUi(); }
    run.time = Math.max(run.time, num(tw[9]));
  };

  G._towerInfo = function (win) {
    const run = this.tower;
    const best = bestTable(bestKey(run))[run.diff] | 0;
    const chips = [];
    for (const c of CHIPS) if (run.chips[c.id]) chips.push({ id: c.id, name: c.name, n: run.chips[c.id] });
    const me = this.players[this.me];
    const names = [];
    for (const p of this.players) if (!p.npc) names.push(p.name);
    return {
      win: !!win, floor: run.floor, top: TOP, diff: run.diff, diffName: DIFFS[run.diff].name,
      best: best, newBest: best > (run.best0 | 0), lives: run.lives, kills: run.kills, deaths: run.deaths,
      time: run.time, chips: chips, hp: me ? Math.round(me.hp) : 0, maxHp: me ? (me.maxHp || RULES.hp) : RULES.hp,
      mods: run.mods, coop: !!run.coop, n: run.n, names: names, isHost: this.isHost
    };
  };

  /* ホスト: おしまい（まけ / ここでやめる）→ みんなへ */
  G._towerOver = function (win) {
    const run = this.tower;
    if (!run || run.state === 'over' || run.state === 'won') return;
    if (!this.isHost) return;
    this._broadcast({ t: 'twe', w: win ? 1 : 0, k: run.kills, d: run.deaths, tm: r2(run.time), f: run.floor });
  };

  /* ホスト: 30階の ボスを たおした */
  G._towerWin = function () { this._towerOver(true); };

  /* みんな: おしまい（ダンス → 結果） */
  G._onTowerEnd = function (m) {
    const run = this.tower;
    if (!run || run.state === 'over' || run.state === 'won') return;
    const win = !!m.w;
    run.kills = Math.max(run.kills | 0, m.k | 0);
    run.deaths = Math.max(run.deaths | 0, m.d | 0);
    run.time = Math.max(run.time, num(m.tm));
    if (m.f) run.floor = clamp(m.f | 0, 1, TOP);
    run.state = win ? 'won' : 'over';
    this.phase = 'over';
    this.hold = false;
    for (const p of this.players) if (p.spK) this._endSpecial(p);
    if (win) {
      const best = bestTable(bestKey(run));
      best[run.diff] = Math.max(best[run.diff] | 0, TOP + 1);     // 31 = せいは
      if (CS.saveSettings) CS.saveSettings();
    }
    this._stopLoops();
    try { CS.Input.enable(false); } catch (e) {}
    CS.UI.hud.show(false);
    const info = this._towerInfo(win);
    this._emit('matchEnd', win ? 0 : 1);
    const done = () => { if (CS.UI.towerResult) CS.UI.towerResult(info); };
    if (win) { if (!this._startDance || !this._startDance(0, null, done)) done(); }
    else done();
  };

  /* ボットが向かう場所（いちばん近い なかま） */
  G._towerChase = function (p) {
    const run = this.tower;
    if (!run || run.state !== 'fight') return null;
    let best = null, bd = Infinity;
    for (const q of this.players) {
      if (q.npc || !q.alive || !q.connected) continue;
      const d = Math.hypot(q.lastReport[0] - p.pos[0], q.lastReport[2] - p.pos[2]);
      if (d < bd) { bd = d; best = q; }
    }
    return best ? best.lastReport : null;
  };

  /* HUD にわたすもの */
  G._towerHud = function (s) {
    const run = this.tower;
    const t = this._towerHudObj || (this._towerHudObj = {});
    s.tower = t;
    t.floor = run.floor; t.top = TOP; t.kind = run.kind; t.stars = run.stars; t.lives = run.lives; t.state = run.state;
    const K = KINDS[run.kind];
    if (run.state === 'clear') {
      t.text = '光の柱へ すすもう！';
      if (run.coop && run.need > 0) t.text += '（えらんだ ' + run.picked + '/' + run.need + ' ・ のこり ' + Math.ceil(run.pickLeft || 0) + '秒）';
    }
    else if (run.kind === 'survive') t.text = 'のこり ' + Math.ceil(run.timeLeft) + '秒';
    else if (run.kind === 'target') t.text = 'クリスタル のこり ' + this._towerLeft();
    else if (run.kind === 'elim') t.text = 'てき のこり ' + this._towerLeft();
    else t.text = K.desc;
    if (run.coop && run.n > 1 && run.state === 'fight') t.text += '　（' + run.n + '人で）';
    let boss = null;
    for (const p of this.players) if (p.boss) boss = p;
    t.boss = boss ? { name: boss.name, hp: Math.max(0, boss.hp), max: boss.maxHp || 1 } : null;
  };

  /* 光の柱 */
  G._drawTower = function (r) {
    const run = this.tower;
    const P = run.portal;
    if (!P) return;
    const t = this.time, k = Math.min(1, run.clearT * 1.5);
    const m = this._pm || (this._pm = CS.M4.create());
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    CS.M4.fromTRS(m, [P[0], P[1] + 3.5, P[2]], [0, 0, 0, 1], [1.1 * k, 8, 1.1 * k]);
    r.box(m, [1, 0.85, 0.35], { additive: true, alpha: 0.16 + 0.08 * pulse });
    CS.M4.fromTRS(m, [P[0], P[1] + 3.5, P[2]], [0, 0, 0, 1], [0.5 * k, 8, 0.5 * k]);
    r.box(m, [1, 1, 0.9], { additive: true, alpha: 0.25 + 0.1 * pulse });
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.6;
      this._addPart(P[0] + Math.cos(a) * rr, P[1] - 0.4, P[2] + Math.sin(a) * rr, 0, 2.5 + Math.random() * 2, 0,
        0.1 + Math.random() * 0.08, 1, 0.85 + Math.random() * 0.15, 0.4, 1.6, -0.5, 0.2, 0);
    }
    r.particle([P[0], P[1] - 0.45, P[2]], 2.6 + pulse * 0.4, [1, 0.8, 0.3], 0.5);
  };
})();
