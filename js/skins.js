/* ==========================================================================
   CUBE STRIKE 2 — skins.js
   じぶんのブロックのスキン。見た目だけで、当たり判定には関係しない。
   skin = { c: からだの色 '#rrggbb'（'' = チームの色）, c2: 2つめの色, d: お絵かき（6面 × 16×16 ドット・ちぢめた文字列）,
            h: ぼうし id, p: もよう id, g: 銃のスキン }
   CS2: 顔だけでなく からだの 6つの 面ぜんぶに 16×16 の ドットで 絵が かける。
   ・面の じゅんばん（d の 中）: 0 まえ（かお・-Z）/ 1 うしろ（+Z）/ 2 ひだり（+X: かおを 見て 左）/ 3 みぎ（-X）/ 4 うえ / 5 した
     てんかいず: うえ が まえ の 上・した が まえ の 下・ひだり みぎ が まえ の よこ・うしろ は みぎ の よこ
   ・1つの 面は 上の行から、見ている人の 左→右 に 256文字。'0' = ぬらない、ほかは PIX の 色
   ・ちぢめかた（pack）: おなじ 文字が 3つ いじょう つづくと 「文字 + '{' + 数(36しんすう) + '}'」
   ・チームがわかるように、各面のふち（12%）はチームの色のまま（render.js）
   ・ぼうしは転がらず、ブロックの上にうかぶ。もようは からだといっしょに転がる
   通信で届いたスキンは clean() を通してから使う。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  /* ---------- からだの色（えらべる色） ---------- */
  const COLORS = [
    '#ff4d5e', '#ff9a3d', '#ffd23d', '#9be35a', '#34c77b', '#2ec4b6', '#3da2ff', '#3050c8',
    '#8a5cf6', '#ff6fb5', '#e8eef8', '#8a94a8', '#23262f', '#9a6a3c', '#e8b923', '#8ff0c8'
  ];

  /* ---------- ドットの色（'t' はチームの色） ----------
     [r, g, b, 光りかた 0..1, なまえ] */
  const PIX = {
    '1': [1.0, 1.0, 1.0, 0.6, 'しろ'],
    '2': [0.05, 0.06, 0.09, 0, 'くろ'],
    '3': [1.0, 0.25, 0.30, 0.3, 'あか'],
    '4': [1.0, 0.88, 0.25, 0.5, 'きいろ'],
    '5': [1.0, 0.55, 0.80, 0.35, 'ピンク'],
    '6': [0.40, 0.90, 1.0, 0.5, 'みずいろ'],
    '7': [0.35, 0.90, 0.45, 0.3, 'みどり'],
    '9': [1.0, 0.60, 0.20, 0.35, 'オレンジ'],
    'a': [0.70, 0.45, 1.0, 0.4, 'むらさき'],
    'b': [0.55, 0.60, 0.70, 0, 'グレー'],
    'c': [0.80, 0.83, 0.88, 0.1, 'うすグレー'],
    'd': [0.28, 0.30, 0.36, 0, 'こいグレー'],
    'e': [0.60, 0.10, 0.15, 0.1, 'えんじ'],
    'f': [0.55, 0.36, 0.20, 0, 'ちゃいろ'],
    'g': [0.85, 0.68, 0.45, 0, 'はだいろ'],
    'h': [1.0, 0.80, 0.65, 0.1, 'ももいろ'],
    'i': [0.20, 0.35, 0.95, 0.2, 'あお'],
    'j': [0.10, 0.15, 0.45, 0, 'こん'],
    'k': [0.10, 0.50, 0.25, 0, 'ふかみどり'],
    'l': [0.75, 1.0, 0.35, 0.4, 'きみどり'],
    'm': [1.0, 0.25, 0.85, 0.5, 'マゼンタ'],
    'n': [1.0, 0.82, 0.30, 0.8, 'きんいろ'],
    'o': [0.60, 1.0, 0.90, 0.5, 'ミント'],
    '8': [1.0, 1.0, 1.0, 1, 'チーム']
  };
  const PIX_KEYS = ['1', 'c', 'b', 'd', '2', '3', 'e', '9', '4', 'n', 'l', '7', 'k', 'o', '6', 'i', 'j', 'a', 'm', '5', 'h', 'g', 'f', '8'];
  const PIX_RE = /^[0-9a-o]$/;

  const N = 16, AREA = N * N, FACES_N = 6;
  const FACE_NAMES = ['まえ（かお）', 'うしろ', 'ひだり', 'みぎ', 'うえ', 'した'];

  /* ---------- かおのプリセット（8行×8文字 → 16×16 にして まえの面へ） ---------- */
  const F = (rows) => rows.join('');
  const FACES = [
    { id: 'normal', name: 'いつもの', f: F(['........', '........', '..1..1..', '..1..1..', '........', '........', '........', '........']) },
    { id: 'smile', name: 'にっこり', f: F(['........', '........', '..1..1..', '.1.11.1.', '........', '.2....2.', '..2222..', '........']) },
    { id: 'cool', name: 'キリッ', f: F(['........', '.2....2.', '..2..2..', '.11..11.', '.11..11.', '........', '...22...', '........']) },
    { id: 'sleepy', name: 'ねむい', f: F(['........', '........', '........', '.11..11.', '........', '........', '...22...', '........']) },
    { id: 'heart', name: 'ハート', f: F(['........', '3.3..3.3', '333..333', '.3....3.', '........', '..2..2..', '...22...', '........']) },
    { id: 'star', name: 'キラキラ', f: F(['........', '........', '.4....4.', '444..444', '.4....4.', '........', '..2222..', '........']) },
    { id: 'robot', name: 'ロボ', f: F(['........', '........', '66666666', '61166116', '66666666', '........', '..2222..', '........']) },
    { id: 'cat', name: 'ねこ', f: F(['........', '........', '.1....1.', '.1....1.', '........', '22....22', '..2..2..', '...22...']) },
    { id: 'wow', name: 'びっくり', f: F(['........', '........', '.11..11.', '.11..11.', '........', '...22...', '...22...', '........']) },
    { id: 'wink', name: 'ウインク', f: F(['........', '........', '.....1..', '.111.1..', '........', '..2..2..', '...22...', '........']) },
    { id: 'angry', name: 'おこ', f: F(['........', '3......3', '.33..33.', '..1..1..', '..1..1..', '........', '..2222..', '.2....2.']) },
    { id: 'shy', name: 'てれる', f: F(['........', '........', '..1..1..', '..1..1..', '........', '55....55', '...22...', '........']) }
  ].map((x) => { x.f = x.f.replace(/\./g, '0'); x.big = up8(x.f); return x; });

  /* 8×8 → 16×16 */
  function up8(f8) {
    let s = '';
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) s += f8[(y >> 1) * 8 + (x >> 1)] || '0';
    return s;
  }
  const EMPTY_FACE = '0'.repeat(AREA);

  /* ---------- ちぢめる・もどす ---------- */
  function pack(raw) {
    let out = '', i = 0;
    while (i < raw.length) {
      const c = raw[i];
      let n = 1;
      while (i + n < raw.length && raw[i + n] === c && n < 1295) n++;
      out += n >= 3 ? c + '{' + n.toString(36) + '}' : c.repeat(n);
      i += n;
    }
    return out;
  }
  /* もどす。こわれていたら null */
  function unpack(s) {
    if (typeof s !== 'string' || s.length > 4000) return null;
    let out = '';
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (!PIX_RE.test(c)) return null;
      if (s[i + 1] === '{') {
        const e = s.indexOf('}', i + 2);
        if (e < 0) return null;
        const n = parseInt(s.slice(i + 2, e), 36);
        if (!(n >= 1 && n <= 1536)) return null;
        out += c.repeat(n);
        i = e + 1;
      } else { out += c; i++; }
      if (out.length > AREA * FACES_N) return null;
    }
    return out.length === AREA * FACES_N ? out : null;
  }
  const DEFAULT_RAW = FACES[0].big + EMPTY_FACE.repeat(FACES_N - 1);
  const DEFAULT_D = pack(DEFAULT_RAW);

  /* ---------- ぼうし ----------
     box = [cx, cy, cz, sx, sy, sz, 色, 光りかた]  単位 = ブロックの一辺、原点 = ブロックの上の面のまんなか。
     +y 上、-z が顔の向き。色: 'c'（からだの色）/ 'c2'（2つめの色）/ [r,g,b] */
  const WHITE = [0.95, 0.96, 1.0], PINK = [1.0, 0.6, 0.8], GOLD = [1.0, 0.8, 0.25], IVORY = [0.96, 0.92, 0.8];
  const BLACK = [0.08, 0.09, 0.12], LEAF = [0.35, 0.85, 0.4], GRAY = [0.55, 0.6, 0.68], RUBY = [1.0, 0.2, 0.35];
  const HATS = {
    none: { name: 'なし', boxes: [] },
    cat: {
      name: 'ねこみみ', boxes: [
        [-0.3, 0.06, 0.05, 0.24, 0.12, 0.12, 'c', 0], [0.3, 0.06, 0.05, 0.24, 0.12, 0.12, 'c', 0],
        [-0.3, 0.16, 0.05, 0.12, 0.1, 0.1, 'c', 0], [0.3, 0.16, 0.05, 0.12, 0.1, 0.1, 'c', 0],
        [-0.3, 0.07, -0.015, 0.12, 0.08, 0.02, PINK, 0.3], [0.3, 0.07, -0.015, 0.12, 0.08, 0.02, PINK, 0.3]
      ]
    },
    bunny: {
      name: 'うさみみ', boxes: [
        [-0.17, 0.25, 0.08, 0.13, 0.5, 0.08, WHITE, 0], [0.17, 0.25, 0.08, 0.13, 0.5, 0.08, WHITE, 0],
        [-0.17, 0.25, 0.035, 0.06, 0.38, 0.02, PINK, 0.3], [0.17, 0.25, 0.035, 0.06, 0.38, 0.02, PINK, 0.3]
      ]
    },
    horn: {
      name: 'ツノ', boxes: [
        [-0.28, 0.08, 0, 0.11, 0.16, 0.11, IVORY, 0], [0.28, 0.08, 0, 0.11, 0.16, 0.11, IVORY, 0],
        [-0.33, 0.2, 0, 0.08, 0.12, 0.08, IVORY, 0], [0.33, 0.2, 0, 0.08, 0.12, 0.08, IVORY, 0]
      ]
    },
    crown: {
      name: 'かんむり', boxes: [
        [0, 0.06, 0, 0.6, 0.12, 0.6, GOLD, 0.35],
        [-0.24, 0.17, -0.24, 0.1, 0.12, 0.1, GOLD, 0.35], [0.24, 0.17, -0.24, 0.1, 0.12, 0.1, GOLD, 0.35],
        [-0.24, 0.17, 0.24, 0.1, 0.12, 0.1, GOLD, 0.35], [0.24, 0.17, 0.24, 0.1, 0.12, 0.1, GOLD, 0.35],
        [0, 0.07, -0.305, 0.12, 0.07, 0.02, RUBY, 1]
      ]
    },
    antenna: {
      name: 'アンテナ', boxes: [
        [0, 0.18, 0, 0.045, 0.36, 0.045, GRAY, 0],
        [0, 0.42, 0, 0.13, 0.13, 0.13, 'c2', 1]
      ]
    },
    tophat: {
      name: 'シルクハット', boxes: [
        [0, 0.02, 0, 0.72, 0.04, 0.72, BLACK, 0],
        [0, 0.23, 0, 0.46, 0.38, 0.46, BLACK, 0],
        [0, 0.09, 0, 0.47, 0.07, 0.47, 'c2', 0.25]
      ]
    },
    cap: {
      name: 'キャップ', boxes: [
        [0, 0.06, 0.02, 0.64, 0.12, 0.64, 'c2', 0],
        [0, 0.02, -0.41, 0.5, 0.035, 0.24, 'c2', 0],
        [0, 0.13, 0.02, 0.08, 0.03, 0.08, WHITE, 0]
      ]
    },
    ribbon: {
      name: 'リボン', boxes: [
        [0.24, 0.07, 0, 0.1, 0.11, 0.1, 'c2', 0.2],
        [0.11, 0.08, 0, 0.17, 0.15, 0.07, 'c2', 0.2], [0.37, 0.08, 0, 0.17, 0.15, 0.07, 'c2', 0.2]
      ]
    },
    sprout: {
      name: 'はっぱ', boxes: [
        [0, 0.1, 0, 0.045, 0.2, 0.045, LEAF, 0],
        [-0.1, 0.2, 0, 0.17, 0.05, 0.1, LEAF, 0.15], [0.1, 0.23, 0, 0.17, 0.05, 0.1, LEAF, 0.15]
      ]
    },
    halo: {
      name: 'てんしのわ', boxes: [
        [0, 0.26, -0.2, 0.46, 0.045, 0.06, GOLD, 1], [0, 0.26, 0.2, 0.46, 0.045, 0.06, GOLD, 1],
        [-0.2, 0.26, 0, 0.06, 0.045, 0.34, GOLD, 1], [0.2, 0.26, 0, 0.06, 0.045, 0.34, GOLD, 1]
      ]
    }
  };
  const HAT_IDS = ['none', 'cat', 'bunny', 'horn', 'crown', 'antenna', 'tophat', 'cap', 'ribbon', 'sprout', 'halo'];

  /* ---------- もよう（からだの面の上。ふちの内側だけ） ---------- */
  const PATTERNS = {
    none: { name: 'なし', rects: [] },
    stripe: { name: 'しましま', rects: [[-0.5, 0.18, 0.5, 0.34], [-0.5, -0.08, 0.5, 0.08], [-0.5, -0.34, 0.5, -0.18]] },
    dots: { name: 'みずたま', rects: [[-0.32, 0.14, -0.14, 0.32], [0.14, 0.14, 0.32, 0.32], [-0.32, -0.32, -0.14, -0.14], [0.14, -0.32, 0.32, -0.14], [-0.09, -0.09, 0.09, 0.09]] },
    check: { name: 'チェック', rects: [[-0.5, 0, 0, 0.5], [0, -0.5, 0.5, 0]] },
    cross: { name: 'クロス', rects: [[-0.08, -0.5, 0.08, 0.5], [-0.5, -0.08, 0.5, 0.08]] },
    frame: { name: 'わく', rects: [[-0.5, 0.36, 0.5, 0.5], [-0.5, -0.5, 0.5, -0.36], [-0.5, -0.36, -0.36, 0.36], [0.36, -0.36, 0.5, 0.36]] },
    diag: { name: 'ななめ', rects: [[-0.5, 0.25, -0.25, 0.5], [-0.25, 0, 0, 0.25], [0, -0.25, 0.25, 0], [0.25, -0.5, 0.5, -0.25]] }
  };
  const PATTERN_IDS = ['none', 'stripe', 'dots', 'check', 'cross', 'frame', 'diag'];

  const HEX = /^#[0-9a-f]{6}$/;

  /* お絵かき（d）を 正しい形に。f（CS1 の 8×8 の かお）が あれば まえの面に する */
  function cleanD(s) {
    let raw = null;
    if (s && typeof s.d === 'string') raw = unpack(s.d);
    if (!raw && s && typeof s.f === 'string' && /^[0-9ab]{64}$/.test(s.f.toLowerCase())) raw = up8(s.f.toLowerCase()) + EMPTY_FACE.repeat(FACES_N - 1);
    if (!raw) raw = DEFAULT_RAW;
    return pack(raw);
  }

  function clean(s) {
    if (!s || typeof s !== 'object') return null;
    const c = typeof s.c === 'string' && HEX.test(s.c.toLowerCase()) ? s.c.toLowerCase() : '';
    const c2 = typeof s.c2 === 'string' && HEX.test(s.c2.toLowerCase()) ? s.c2.toLowerCase() : '#ffffff';
    const d = cleanD(s);
    const h = HATS[s.h] ? s.h : 'none';
    const p = PATTERNS[s.p] ? s.p : 'none';
    /* g = 銃のスキン（gunskins.js）。しあいでも いっしょに届く */
    const g = CS.GunSkins ? CS.GunSkins.clean(s.g) : 'none';
    return { c: c, c2: c2, d: d, h: h, p: p, g: g };
  }

  /* からだが いつもの見た目と同じか（そのときは からだの描き方も いつものまま） */
  function isPlainBody(s) {
    return !s || (!s.c && s.d === DEFAULT_D && s.h === 'none' && s.p === 'none');
  }
  /* 銃のスキンも ふくめて いつもどおりか（通信で送らなくてよいか） */
  function isPlain(s) {
    return isPlainBody(s) && (!s || !s.g || s.g === 'none');
  }

  function hexRgb(h, out) {
    out = out || [1, 1, 1];
    if (typeof h !== 'string' || !HEX.test(h)) return null;
    const n = parseInt(h.slice(1), 16);
    out[0] = ((n >> 16) & 255) / 255; out[1] = ((n >> 8) & 255) / 255; out[2] = (n & 255) / 255;
    return out;
  }

  /* お絵かきを 面ごとの 四角に まとめる（おなじ色の かたまりを 大きな 四角に。箱の数を へらす）。
     [面][...] = [列, 行, はば, たかさ, 色]。d（ちぢめた文字列）ごとに おぼえる */
  const rectCache = new Map();
  function faceRects(d) {
    let r = rectCache.get(d);
    if (r) return r;
    const raw = unpack(d) || DEFAULT_RAW;
    r = [];
    for (let f = 0; f < FACES_N; f++) {
      const g = raw.slice(f * AREA, (f + 1) * AREA).split('');
      const used = new Uint8Array(AREA);
      const list = [];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x, k = g[i];
          if (k === '0' || used[i]) continue;
          let w = 1;
          while (x + w < N && g[i + w] === k && !used[i + w]) w++;
          let h = 1;
          outer: while (y + h < N) {
            for (let q = 0; q < w; q++) { const j = (y + h) * N + x + q; if (g[j] !== k || used[j]) break outer; }
            h++;
          }
          for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) used[(y + yy) * N + x + xx] = 1;
          list.push([x, y, w, h, k]);
        }
      }
      r.push(list);
    }
    if (rectCache.size > 80) rectCache.clear();
    rectCache.set(d, r);
    return r;
  }

  function randomSkin(rng, opts) {
    const r = typeof rng === 'function' ? rng : Math.random;
    const pickOne = (a) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];
    opts = opts || {};
    return clean({
      c: opts.teamColor ? '' : pickOne(COLORS),
      c2: pickOne(COLORS),
      d: pack(pickOne(FACES).big + EMPTY_FACE.repeat(FACES_N - 1)),
      h: pickOne(HAT_IDS),
      p: opts.noPattern ? 'none' : pickOne(PATTERN_IDS)
    });
  }

  /* じぶんのスキン（せってい）。からだのスキン（Settings.skin）と 銃のスキン（Settings.gunSkin）をあわせる。
     どちらも いつもの見た目なら null */
  function mine() {
    const base = (CS.Settings && CS.Settings.skin && typeof CS.Settings.skin === 'object') ? CS.Settings.skin : blank();
    const s = clean(Object.assign({}, base, { g: CS.Settings ? CS.Settings.gunSkin : 'none' }));
    return s && !isPlain(s) ? s : null;
  }
  function blank() { return { c: '', c2: '#ffffff', d: DEFAULT_D, h: 'none', p: 'none' }; }

  CS.Skins = {
    COLORS: COLORS, PIX: PIX, PIX_KEYS: PIX_KEYS, FACES: FACES, N: N, FACES_N: FACES_N, FACE_NAMES: FACE_NAMES,
    DEFAULT_D: DEFAULT_D, DEFAULT_RAW: DEFAULT_RAW, EMPTY_FACE: EMPTY_FACE, DEFAULT_FACE: FACES[0].f,
    HATS: HATS, HAT_IDS: HAT_IDS, PATTERNS: PATTERNS, PATTERN_IDS: PATTERN_IDS,
    PANEL: 0.76,          // もよう・からだの色・お絵かきを ぬる面の大きさ（のこりの ふち がチームの色）
    clean: clean, isPlain: isPlain, isPlainBody: isPlainBody, hexRgb: hexRgb, faceRects: faceRects, random: randomSkin, mine: mine,
    blank: blank, pack: pack, unpack: unpack, up8: up8
  };
})();
