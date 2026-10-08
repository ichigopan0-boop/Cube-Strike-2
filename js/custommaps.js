/* ==========================================================================
   CUBE STRIKE — custommaps.js
   じぶんで作ったマップ（v3・マップエディター）の保存と読みこみ。
   保存: localStorage 'cubestrike2_maps' = {v:1, maps:[{id, name, W, H, D, rle, sp, theme, t}]}
     rle = ボクセル（x + W*(z + D*y)）を [ブロック, 回数(1..255)] の列にして base64
     sp  = 出撃地点 [[x,y,z]...] × 2チーム（立つセル。y は床の上のセル）
   マップの id は 'c:' + id（CS.Maps.get でも引ける）。オンラインでは ホストが start に中身（wire）をつけて送る。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const B = CS.BLOCK;
  const KEY = 'cubestrike2_maps';
  const MAX_MAPS = 12;
  const LIM = { W: [12, 64], H: [6, 24], D: [12, 64] };
  const MAX_SPAWNS = 4;
  const HALF = CS.PLAYER.half;

  /* 見た目（パレット・空・光）。v4: ぜんぶ 屋外（env = maps.js の 空と光・まわりの けしき）。
     id は 前のまま（ほぞんした マップが そのまま つかえる） */
  const THEMES = {
    plaza: {
      name: 'ひるの 公園', env: 'day',
      palette: { 1: [0.44, 0.70, 0.35], 2: [0.78, 0.76, 0.70], 3: [0.84, 0.46, 0.34], 4: [0.66, 0.46, 0.26], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.60, 0.62, 0.64], 8: [1.0, 0.90, 0.58] },
      sky: [0.62, 0.80, 0.97], fogNear: 55, fogFar: 150
    },
    towers: {
      name: 'さばく', env: 'desert',
      palette: { 1: [0.88, 0.78, 0.55], 2: [0.80, 0.62, 0.43], 3: [0.26, 0.64, 0.64], 4: [0.66, 0.46, 0.26], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.66, 0.60, 0.52], 8: [0.40, 0.95, 1.0] },
      sky: [0.80, 0.84, 0.90], fogNear: 55, fogFar: 160
    },
    depot: {
      name: 'コンテナ置き場', env: 'sunset',
      palette: { 1: [0.46, 0.46, 0.48], 2: [0.70, 0.68, 0.66], 3: [0.94, 0.54, 0.24], 4: [0.70, 0.50, 0.28], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.48, 0.56, 0.64], 8: [1.0, 0.86, 0.40] },
      sky: [0.98, 0.70, 0.50], fogNear: 45, fogFar: 140
    },
    sunset: {
      name: 'ゆうやけの 丘', env: 'sunset',
      palette: { 1: [0.56, 0.60, 0.34], 2: [0.72, 0.58, 0.46], 3: [0.88, 0.50, 0.30], 4: [0.66, 0.44, 0.22], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.62, 0.56, 0.50], 8: [1.0, 0.80, 0.35] },
      sky: [0.98, 0.70, 0.50], fogNear: 45, fogFar: 140
    },
    snow: {
      name: 'ゆきやま', env: 'snow',
      palette: { 1: [0.92, 0.94, 0.98], 2: [0.62, 0.66, 0.74], 3: [0.36, 0.56, 0.86], 4: [0.58, 0.42, 0.28], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.70, 0.76, 0.84], 8: [0.70, 0.92, 1.0] },
      sky: [0.78, 0.86, 0.95], fogNear: 35, fogFar: 120
    },
    forest: {
      name: 'もり', env: 'forest',
      palette: { 1: [0.34, 0.58, 0.28], 2: [0.50, 0.46, 0.40], 3: [0.30, 0.52, 0.30], 4: [0.56, 0.38, 0.22], 5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.52, 0.54, 0.50], 8: [1.0, 0.92, 0.55] },
      sky: [0.66, 0.82, 0.86], fogNear: 40, fogFar: 125
    }
  };
  const THEME_IDS = ['plaza', 'towers', 'depot', 'sunset', 'snow', 'forest'];

  /* ---------- 小物 ---------- */
  function randId() {
    let s = '';
    const c = 'abcdefghijkmnpqrstuvwxyz23456789';
    for (let i = 0; i < 8; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function clipName(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
    return s || 'じぶんのマップ';
  }
  /* 'c:' = じぶんのマップ、'p:' = みんなのステージ（stages.js）。どちらも 中身をつけて送る マップ */
  const isCustomId = (id) => typeof id === 'string' && (id.indexOf('c:') === 0 || id.indexOf('p:') === 0);
  const isPublicId = (id) => typeof id === 'string' && id.indexOf('p:') === 0;

  function encode(data) {
    const bytes = [];
    let i = 0;
    while (i < data.length) {
      const v = data[i];
      let n = 1;
      while (i + n < data.length && data[i + n] === v && n < 255) n++;
      bytes.push(v, n);
      i += n;
    }
    let s = '';
    for (let k = 0; k < bytes.length; k += 4096) s += String.fromCharCode.apply(null, bytes.slice(k, k + 4096));
    return btoa(s);
  }
  function decode(str, len) {
    if (typeof str !== 'string' || !(len > 0)) return null;
    let bin;
    try { bin = atob(str); } catch (e) { return null; }
    const out = new Uint8Array(len);
    let o = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) {
      const v = bin.charCodeAt(i), n = bin.charCodeAt(i + 1);
      if (v > 8 || n === 0 || o + n > len) return null;
      out.fill(v, o, o + n);
      o += n;
    }
    return o === len ? out : null;
  }

  /* 形がちゃんとしているマップだけ（こわれていたら null） */
  function clean(m) {
    if (!m || typeof m !== 'object') return null;
    const W = m.W | 0, H = m.H | 0, D = m.D | 0;
    if (W < LIM.W[0] || W > LIM.W[1] || H < LIM.H[0] || H > LIM.H[1] || D < LIM.D[0] || D > LIM.D[1]) return null;
    if (typeof m.rle !== 'string' || m.rle.length > 400000) return null;
    const sp = [[], []];
    if (Array.isArray(m.sp)) {
      for (let t = 0; t < 2; t++) {
        const L = Array.isArray(m.sp[t]) ? m.sp[t] : [];
        for (const c of L) {
          if (!Array.isArray(c) || c.length < 3) continue;
          const x = c[0] | 0, y = c[1] | 0, z = c[2] | 0;
          if (x < 0 || y < 1 || z < 0 || x >= W || y >= H || z >= D) continue;
          if (sp[t].length < MAX_SPAWNS) sp[t].push([x, y, z]);
        }
      }
    }
    return {
      id: typeof m.id === 'string' ? m.id.replace(/[^a-z0-9]/g, '').slice(0, 12) || randId() : randId(),
      name: clipName(m.name), W: W, H: H, D: D, rle: m.rle, sp: sp,
      theme: THEMES[m.theme] ? m.theme : 'plaza', t: +m.t || 0
    };
  }

  /* ---------- 保存 ---------- */
  let cache = null;
  function load() {
    if (cache) return cache;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    const maps = [];
    if (d && Array.isArray(d.maps)) for (const m of d.maps) { const c = clean(m); if (c && maps.length < MAX_MAPS) maps.push(c); }
    cache = maps;
    return cache;
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, maps: load() })); return true; } catch (e) { return false; }
  }
  function get(id) {
    if (isPublicId(id)) return null;
    if (isCustomId(id)) id = id.slice(2);
    for (const m of load()) if (m.id === id) return m;
    return null;
  }
  /* 上から見た絵などに使う 中身（じぶんのマップ でも みんなのステージ でも） */
  function raw(id) {
    if (isPublicId(id)) return CS.Stages ? CS.Stages.mapOf(id) : null;
    return get(id);
  }
  /* 保存（なければ足す）。いっぱいなら false */
  function save(m) {
    const c = clean(m);
    if (!c) return false;
    c.t = Date.now();
    const list = load();
    const i = list.findIndex((x) => x.id === c.id);
    if (i >= 0) list[i] = c;
    else { if (list.length >= MAX_MAPS) return false; list.unshift(c); }
    return persist() ? c : false;
  }
  function remove(id) {
    if (isCustomId(id)) id = id.slice(2);
    const list = load();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    persist();
    return true;
  }

  /* ---------- マップのデータにする（CS.World 用） ---------- */
  function standable(data, W, H, D, x, y, z) {
    if (x < 1 || z < 1 || x >= W - 1 || z >= D - 1 || y < 1 || y >= H) return false;
    const o = x + W * (z + D * y);
    return data[o] === 0 && data[o - W * D] !== 0;
  }
  /* 出撃地点がないチームは、じぶんの がわ（手前・奥）の まんなかに近い 立てる場所を さがす */
  function autoSpawns(data, W, H, D, team) {
    const out = [];
    const z0 = team === 0 ? 1 : D - 2, dz = team === 0 ? 1 : -1;
    for (let k = 0; k < Math.floor(D / 2) && out.length < 3; k++) {
      const z = z0 + dz * k;
      for (let j = 0; j < W && out.length < 3; j++) {
        const x = Math.floor(W / 2) + (j % 2 ? -1 : 1) * Math.ceil(j / 2);
        for (let y = 1; y < H; y++) {
          if (standable(data, W, H, D, x, y, z)) {
            if (out.every((c) => Math.abs(c[0] - x) + Math.abs(c[2] - z) >= 2)) out.push([x, y, z]);
            break;
          }
        }
      }
    }
    return out;
  }
  function build(m) {
    const data = decode(m.rle, m.W * m.H * m.D);
    if (!data) return null;
    const th = THEMES[m.theme] || THEMES.plaza;
    const spawns = [[], []];
    for (let t = 0; t < 2; t++) {
      let cells = m.sp[t].filter((c) => standable(data, m.W, m.H, m.D, c[0], c[1], c[2]));
      if (!cells.length) cells = autoSpawns(data, m.W, m.H, m.D, t);
      if (!cells.length) cells = [[Math.floor(m.W / 2), m.H - 1, t === 0 ? 2 : m.D - 3]];
      for (const c of cells) {
        const px = c[0] + 0.5, pz = c[2] + 0.5;
        spawns[t].push({ p: [px, c[1] + HALF + 0.002, pz], yaw: Math.atan2(-(m.W / 2 - px), -(m.D / 2 - pz)) });
      }
    }
    /* v4: 屋外の 空と光（maps.js の env）。まわりに 地面と けしきが 出る */
    const look = CS.MapKit && CS.MapKit.env ? CS.MapKit.env(th.env || 'day', { palette: th.palette }) : { palette: th.palette, sky: th.sky, fogNear: th.fogNear, fogFar: th.fogFar };
    return Object.assign({ W: m.W, H: m.H, D: m.D, data: data, spawns: spawns }, look);
  }
  function defOf(m, idOverride) {
    return {
      id: idOverride || 'c:' + m.id, name: m.name, en: 'MY MAP', desc: m.W + '×' + m.D + ' ・ じぶんで作ったマップ',
      custom: true, W: m.W, D: m.D,
      build: function () { return build(m) || CS.Maps.list[0].build(); }
    };
  }
  function def(id) {
    if (isPublicId(id)) return CS.Stages ? CS.Stages.def(id) : null;
    const m = get(id);
    return m ? defOf(m) : null;
  }
  function defs() { return load().map((m) => defOf(m)); }

  /* ---------- オンライン（ホスト → ゲスト） ---------- */
  function wireOf(id) {
    if (isPublicId(id)) return CS.Stages ? CS.Stages.wireOf(id) : null;
    const m = get(id);
    if (!m) return null;
    return { name: m.name, W: m.W, H: m.H, D: m.D, rle: m.rle, sp: m.sp, theme: m.theme };
  }
  function defFromWire(w, mapId) {
    const m = clean(Object.assign({ id: 'net' }, w || {}));
    if (!m || !decode(m.rle, m.W * m.H * m.D)) return null;
    return defOf(m, isCustomId(mapId) ? mapId : 'c:net');
  }

  /* ---------- あたらしいマップ ---------- */
  const SIZES = { s: [24, 12, 24], m: [32, 14, 32], l: [40, 14, 40] };
  /* tpl: 'empty'（かべと床だけ）/ 'plaza' / 'towers' / 'depot'（いまのマップをもとに） */
  function create(tpl, size, name) {
    let W, H, D, data, sp = [[], []], theme = 'plaza';
    const base = CS.Maps.list.find((x) => x.id === tpl);
    if (base) {
      const md = base.build();
      W = md.W; H = md.H; D = md.D; data = new Uint8Array(md.data);
      /* v4: いつものマップには エディターに ないブロックがある（見えない かべ 255・生け垣 9〜14 など）。
         見えない かべは 空気に、ほかは かべに する（じぶんのマップは 1〜8 だけ） */
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v > 8) data[i] = v === CS.BLOCK.BARRIER ? 0 : B.WALL;
      }
      theme = THEMES[tpl] ? tpl : 'plaza';
      for (let t = 0; t < 2; t++) {
        for (const s of (md.spawns[t] || []).slice(0, MAX_SPAWNS)) sp[t].push([Math.floor(s.p[0]), Math.floor(s.p[1] - HALF + 0.01), Math.floor(s.p[2])]);
      }
    } else {
      const sz = SIZES[size] || SIZES.m;
      W = sz[0]; H = sz[1]; D = sz[2];
      const g = new CS.MapKit.Grid(W, H, D);
      g.shell(B.FLOOR, B.WALL, B.TRIM);
      data = g.data;
      const cx = Math.floor(W / 2);
      sp = [[[cx, 1, 2], [cx - 3, 1, 2], [cx + 3, 1, 2]], [[cx, 1, D - 3], [cx - 3, 1, D - 3], [cx + 3, 1, D - 3]]];
    }
    const nm = name || (base ? base.name + 'のコピー' : 'あたらしいマップ');
    return { id: randId(), name: clipName(nm), W: W, H: H, D: D, rle: encode(data), sp: sp, theme: theme, t: Date.now() };
  }

  /* ---------- 上から見た小さな絵（マップカード用） ---------- */
  function thumb(m, canvas) {
    const data = decode(m.rle, m.W * m.H * m.D);
    if (!data || !canvas || !canvas.getContext) return false;
    const ctx = canvas.getContext('2d');
    const th = THEMES[m.theme] || THEMES.plaza;
    const W = m.W, H = m.H, D = m.D;
    canvas.width = W; canvas.height = D;
    const img = ctx.createImageData(W, D);
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        let top = 0, id = 0;
        for (let y = H - 1; y >= 0; y--) { const v = data[x + W * (z + D * y)]; if (v) { top = y; id = v; break; } }
        const c = th.palette[id] || [0.1, 0.1, 0.15];
        const k = 0.45 + 0.55 * (top / Math.max(1, H - 1)) + (id === B.GLOW ? 0.3 : 0);
        const o = (x + W * z) * 4;
        img.data[o] = Math.min(255, c[0] * 255 * k * 1.4); img.data[o + 1] = Math.min(255, c[1] * 255 * k * 1.4);
        img.data[o + 2] = Math.min(255, c[2] * 255 * k * 1.4); img.data[o + 3] = 255;
      }
    }
    for (let t = 0; t < 2; t++) {
      for (const c of m.sp[t]) {
        const o = (c[0] + W * c[2]) * 4;
        img.data[o] = t ? 60 : 255; img.data[o + 1] = t ? 160 : 77; img.data[o + 2] = t ? 255 : 94; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  CS.CustomMaps = {
    KEY: KEY, MAX_MAPS: MAX_MAPS, MAX_SPAWNS: MAX_SPAWNS, LIM: LIM, THEMES: THEMES, THEME_IDS: THEME_IDS, SIZES: SIZES,
    isCustomId: isCustomId, isPublicId: isPublicId, encode: encode, decode: decode, clean: clean,
    list: function () { return load().slice(); }, get: get, raw: raw, save: save, remove: remove,
    build: build, def: def, defs: defs, wireOf: wireOf, defFromWire: defFromWire, create: create, thumb: thumb,
    reload: function () { cache = null; return load(); }
  };

  /* CS.Maps.get でも じぶんのマップを引けるようにする */
  const baseGet = CS.Maps.get;
  CS.Maps.get = function (id) {
    if (isCustomId(id)) { const d = def(id); if (d) return d; }
    return baseGet.call(CS.Maps, id);
  };
})();
