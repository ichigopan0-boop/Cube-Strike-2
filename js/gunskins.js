/* ==========================================================================
   CUBE STRIKE — gunskins.js
   銃のスキン（見た目だけ。性能は変わらない）。
   ・えらんだスキンは CS.Settings.gunSkin（id）に保存。じぶんのスキン（CS.Skins.mine）の g に入れて
     しあいでも みんなに届く（ほかの人の銃も、そのスキンで見える）
   ・銃は色つきの箱の集まり。もとの色が「暗い本体」か「明るい・色のある部品」かで分けて ぬりかえる
     tint(def, r, g, b, i, t, out) → out = [r, g, b, 光りかた]
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  /* body = 本体の色 / acc = 部品の色 / em = 全体の光りかた / emA = 部品の光りかた
     mode: 'camo'（まだら）/ 'rainbow'（にじ色が流れる）/ 'wood'（木目）/ 'stripe'（しましま） */
  const LIST = [
    { id: 'none', name: 'いつもの', desc: 'もとの色', sw: ['#4c5566', '#7fd6ff'] },
    { id: 'gold', name: 'ゴールド', desc: 'きんぴかの王者', body: [1.0, 0.76, 0.24], acc: [1.0, 0.95, 0.72], em: 0.12, emA: 0.35, sw: ['#ffc23d', '#fff2b8'] },
    { id: 'midnight', name: 'ミッドナイト', desc: '夜空いろ・むらさきに光る', body: [0.1, 0.11, 0.17], acc: [0.62, 0.38, 1.0], emA: 0.75, sw: ['#1a1c2b', '#9e61ff'] },
    { id: 'sakura', name: 'さくら', desc: 'やさしい ももいろ', body: [1.0, 0.72, 0.84], acc: [1.0, 1.0, 1.0], emA: 0.2, sw: ['#ffb8d6', '#ffffff'] },
    { id: 'mint', name: 'ミント', desc: 'すっきり ミントグリーン', body: [0.56, 0.95, 0.8], acc: [0.18, 0.38, 0.33], sw: ['#8ff2cc', '#2e6155'] },
    { id: 'camo', name: 'めいさい', desc: '草むらに まぎれる', mode: 'camo', cols: [[0.3, 0.4, 0.22], [0.47, 0.4, 0.25], [0.2, 0.26, 0.16], [0.36, 0.33, 0.2]], sw: ['#4d6638', '#786640'] },
    { id: 'neon', name: 'ネオン', desc: '黒い本体に 光るライン', body: [0.07, 0.07, 0.1], acc: [0.2, 1.0, 0.9], emA: 1.0, sw: ['#111219', '#33ffe6'] },
    { id: 'rainbow', name: 'レインボー', desc: 'にじ色が ながれる', mode: 'rainbow', emA: 0.35, sw: ['#ff5a7a', '#5ac8ff'] },
    { id: 'ice', name: 'アイス', desc: 'こおりの 水いろ', body: [0.74, 0.9, 1.0], acc: [0.38, 0.7, 1.0], em: 0.1, emA: 0.45, sw: ['#bde6ff', '#61b3ff'] },
    { id: 'lava', name: 'マグマ', desc: '岩のすきまで マグマが光る', body: [0.16, 0.08, 0.06], acc: [1.0, 0.46, 0.1], emA: 0.95, sw: ['#2a1410', '#ff7519'] },
    { id: 'wood', name: 'もくめ', desc: 'あたたかい 木の銃', mode: 'wood', acc: [0.62, 0.64, 0.68], sw: ['#8a5a32', '#a0a3ab'] },
    { id: 'candy', name: 'キャンディ', desc: '赤と白の しましま', mode: 'stripe', cols: [[1.0, 0.3, 0.45], [1.0, 1.0, 1.0]], sw: ['#ff4d73', '#ffffff'] },
    /* v5.2: 弾が アイスバーに なる（bullet。game.js の _drawIceBar）。銃は バニラいろ */
    { id: 'icebar', name: 'アイスバー', desc: '撃った 弾が バニラの アイスバーに なる（カリカリつぶ つき）', body: [1.0, 0.97, 0.88], acc: [0.86, 0.64, 0.38],
      em: 0.05, emA: 0.12, bullet: 'icebar', sw: ['#fbeec8', '#d9a35f'] }
  ];
  const MAP = {};
  for (const s of LIST) MAP[s.id] = s;
  const IDS = LIST.map((s) => s.id);

  function clean(id) { return typeof id === 'string' && MAP[id] ? id : 'none'; }
  function get(id) { id = clean(id); return id === 'none' ? null : MAP[id]; }
  function mineId() { return clean(CS.Settings && CS.Settings.gunSkin); }

  function hsl(h, s, l, out) {
    h = ((h % 1) + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    out[0] = f(h + 1 / 3); out[1] = f(h); out[2] = f(h - 1 / 3);
    return out;
  }

  /* 箱 i（もとの色 r,g,b）を スキン def でぬりかえる。t = 時間（秒） */
  function tint(def, r, g, b, i, t, out) {
    out[0] = r; out[1] = g; out[2] = b; out[3] = 0;
    if (!def) return out;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const accent = sat > 0.3 || lum > 0.55;            // 色のある部品・明るい部品
    const shade = 0.72 + 0.56 * Math.min(1, lum * 1.6);   // もとの明るさの差を少し のこす
    let c = null;
    if (def.mode === 'rainbow') {
      hsl(i * 0.11 + t * 0.12, 0.85, accent ? 0.62 : 0.5, out);
      out[3] = accent ? (def.emA || 0) : 0.08;
      return out;
    } else if (def.mode === 'camo' || def.mode === 'stripe') {
      const cols = def.cols;
      let k = i % cols.length;
      if (def.mode === 'camo') { let hh = Math.imul(i + 7, 2654435761) >>> 0; k = (hh >>> 7) % cols.length; }
      c = cols[k];
    } else if (def.mode === 'wood') {
      if (accent) c = def.acc;
      else { const w = (i % 3) * 0.06; out[0] = 0.5 + w; out[1] = 0.32 + w * 0.7; out[2] = 0.17 + w * 0.4; return out; }
    } else {
      c = accent ? def.acc : def.body;
    }
    const k2 = accent ? 1 : shade;
    out[0] = Math.min(1, c[0] * k2); out[1] = Math.min(1, c[1] * k2); out[2] = Math.min(1, c[2] * k2);
    out[3] = Math.max(def.em || 0, accent ? (def.emA || 0) : 0);
    return out;
  }

  CS.GunSkins = { LIST: LIST, IDS: IDS, clean: clean, get: get, mineId: mineId, tint: tint };
})();
