/* ==========================================================================
   CUBE STRIKE — render.js
   WebGL1 レンダラー（CS.Renderer）
   - ワールド: world.buildMesh() → {pos, nrm, col, count}（非インデックス Float32Array）。
     idx(Uint16/Uint32Array) + indexCount があればそれも受け付ける（読み込み時に展開するので
     OES_element_index_uint は不要）。任意で emi（頂点ごとの発光 0..1）も可。
     無ければ面の奥のボクセルが GLOW かどうかで発光を決める。巻き順は法線から自動で CCW にそろえる。
   - 動的な箱は CPU で頂点変換して、パスごと（不透明 / 半透明 / 加算 / ビューモデル）に
     1回の draw call でまとめて描く。バッファは使い回し、足りなければ2倍に伸ばす。
   - ビューモデルは視野60°の別投影（みじかいほうの辺が基準・たて長は下はしの帯へ）。
     ワールド座標に直してから描くので光の向きがそろう。
     s.avoid = {x0, y0}（CSS px）を渡すと、その右下（タッチボタン）を銃がよける。
   - v2: プレイヤーの体は CS.PLAYER.size × 0.98（1ブロックとほぼ同じ大きさ）。数値は
     すべて CS.PLAYER から読む。p.slide（0..1）でスライディング表示：転がりを止めて
     足もとをそのままに高さ CS.PLAYER.slide.hurtHeight までぺちゃんこにする。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};
  const M4 = CS.M4;

  /* ---------- 定数 ---------- */
  const NEAR = 0.1;
  const VM_FOV = 60 * Math.PI / 180;
  const VM_F = 1 / Math.tan(VM_FOV / 2);
  const VM_DROP_MAX = -0.07;    // タッチボタンをよけるとき、銃を下げてよい最大（m）
  const NO_AVOID = Object.freeze({ dx: 0, dy: 0 });
  const LIT_STRIDE = 16;        // pos3 nrm3 col4 edge4 mat2
  const ADD_STRIDE = 9;         // pos3 col4 uv2
  const WORLD_STRIDE = 24;      // bytes: pos f32×3 | nrm i8×3 | emi u8 | col u8×3 | pad | uv u8×2 | pad×2
  const MAX_VERTS = 1 << 21;    // 1パスあたりの頂点上限（暴走よけ）
  const DPR_CAP = { auto: 2, low: 1, med: 1.5, high: 2 };
  const PIXEL_CAP = { auto: 4.2e6, low: 1.3e6, med: 2.6e6, high: 4.2e6 };

  const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);   // NaN/undefined → 0
  const BODY_SCALE = 0.98;      // 体は 1ブロックの 98%（すき間が見えて重ならない）
  const IDQ = [0, 0, 0, 1];
  const ZERO3 = [0, 0, 0];
  const EMPTY = {};

  /* ---------- シェーダー（GLSL ES 1.00） ---------- */
  const VS_WORLD = [
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute vec3 aCol;',
    'attribute float aEmi;',
    'attribute vec2 aUV;',
    'uniform mat4 uVP;',
    'uniform vec3 uCam;',
    'uniform vec3 uSun;',
    'uniform vec3 uSunCol;',
    'uniform vec3 uAmbSky;',
    'uniform vec3 uAmbGnd;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform float uTime;',
    'uniform float uIce;',   // v5.2: アイスフィールド（0..1）: 上を むいた 面（床）が 氷の 色に
    'varying vec3 vCol;',
    'varying vec2 vUV;',
    'varying vec3 vInfo;',   // x: fog, y: emissive, z: distance
    'void main() {',
    '  vec3 amb = mix(uAmbGnd, uAmbSky, aNrm.y * 0.5 + 0.5);',
    '  float sun = max(dot(aNrm, uSun), 0.0);',
    '  vec3 lit = aCol * (amb + uSunCol * sun);',
    '  float ice = uIce * step(0.5, aNrm.y);',
    '  float glint = 0.5 + 0.5 * sin(uTime * 1.6 + aPos.x * 0.9 + aPos.z * 1.3);',
    '  vec3 iceCol = vec3(0.50, 0.76, 0.96) * (amb + uSunCol * sun) * 0.88 + vec3(0.05, 0.08, 0.10) * glint;',
    '  lit = mix(lit, iceCol, ice * 0.8);',
    '  float pulse = 1.3 + 0.2 * sin(uTime * 2.2 + (aPos.x + aPos.z) * 0.8);',
    '  vCol = mix(lit, aCol * pulse, aEmi);',
    '  vUV = aUV;',
    '  float d = distance(aPos, uCam);',
    '  float fog = clamp((d - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);',
    '  vInfo = vec3(fog * (1.0 - 0.45 * aEmi), aEmi, d);',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  const FS_WORLD = [
    'precision mediump float;',
    'uniform vec3 uSky;',
    'uniform vec3 uEdgeTint;',
    'uniform float uEdge;',
    'varying vec3 vCol;',
    'varying vec2 vUV;',
    'varying vec3 vInfo;',
    'void main() {',
    '  vec2 f = abs(fract(vUV) - 0.5);',
    '  float e = 0.5 - max(f.x, f.y);',                 // ボクセルの縁で 0
    '  float w = 0.018 + vInfo.z * 0.0035;',            // 遠いほど太く（ちらつき防止）
    '  float fade = (1.0 - smoothstep(14.0, 34.0, vInfo.z)) * uEdge;',
    '  float groove = (1.0 - smoothstep(w, w * 3.0, e)) * fade;',
    '  float core = (1.0 - smoothstep(0.0, w, e)) * fade;',
    '  vec3 c = vCol * (1.0 - 0.3 * groove);',
    '  c += (vCol * 0.7 + uEdgeTint) * core * (0.38 + 0.9 * vInfo.y);',
    '  gl_FragColor = vec4(mix(c, uSky, vInfo.x), 1.0);',
    '}'
  ].join('\n');

  const VS_LIT = [
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute vec4 aCol;',
    'attribute vec4 aEdge;',
    'attribute vec2 aMat;',
    'uniform mat4 uVP;',
    'uniform vec3 uCam;',
    'uniform vec3 uSun;',
    'uniform vec3 uSunCol;',
    'uniform vec3 uAmbSky;',
    'uniform vec3 uAmbGnd;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'varying vec4 vCol;',
    'varying vec4 vEdge;',
    'varying vec3 vInfo;',   // x: fog, y: frame width, z: emissive
    'void main() {',
    '  vec3 amb = mix(uAmbGnd, uAmbSky, aNrm.y * 0.5 + 0.5);',
    '  float sun = max(dot(aNrm, uSun), 0.0);',
    '  vec3 lit = aCol.rgb * (amb + uSunCol * sun);',
    '  vCol = vec4(mix(lit, aCol.rgb * 1.2, aMat.x), aCol.a);',
    '  vEdge = aEdge;',
    '  float d = distance(aPos, uCam);',
    '  float fog = clamp((d - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);',
    '  vInfo = vec3(fog * (1.0 - 0.5 * aMat.x), aMat.y, aMat.x);',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  const FS_LIT = [
    'precision mediump float;',
    'uniform vec3 uSky;',
    'varying vec4 vCol;',
    'varying vec4 vEdge;',
    'varying vec3 vInfo;',
    'void main() {',
    '  vec3 c = vCol.rgb;',
    '  float fw = vInfo.y;',
    '  if (fw > 0.0) {',
    '    float d = min(vEdge.z - abs(vEdge.x), vEdge.w - abs(vEdge.y));',   // 面の縁までの距離（m）
    '    float frame = 1.0 - smoothstep(fw * 0.8, fw, d);',
    '    float rim = 1.0 - smoothstep(0.0, fw * 0.25, abs(d - fw));',
    '    float lip = 1.0 - smoothstep(0.0, fw * 0.3, d);',
    '    c = c * (1.0 - 0.45 * frame) + c * (rim * 0.4 + lip * 0.3);',
    '  }',
    '  gl_FragColor = vec4(mix(c, uSky, vInfo.x), vCol.a);',
    '}'
  ].join('\n');

  const VS_ADD = [
    'attribute vec3 aPos;',
    'attribute vec4 aCol;',
    'attribute vec2 aUV;',
    'uniform mat4 uVP;',
    'uniform vec3 uCam;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'varying vec4 vCol;',
    'varying vec2 vUV;',
    'void main() {',
    '  float d = distance(aPos, uCam);',
    '  float fog = clamp((d - uFogNear) / max(uFogFar - uFogNear, 0.001), 0.0, 1.0);',
    '  vCol = vec4(aCol.rgb, aCol.a * (1.0 - 0.85 * fog));',
    '  vUV = aUV;',
    '  gl_Position = uVP * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  const FS_ADD = [
    'precision mediump float;',
    'varying vec4 vCol;',
    'varying vec2 vUV;',
    'void main() {',
    '  float a = clamp(1.0 - length(vUV), 0.0, 1.0);',
    '  float glow = a * a;',
    '  float core = glow * glow * glow;',
    '  vec3 c = vCol.rgb * glow + mix(vCol.rgb, vec3(1.0), 0.65) * core;',
    '  gl_FragColor = vec4(c * vCol.a, 1.0);',
    '}'
  ].join('\n');

  const VS_SKY = [
    'attribute vec2 aPos;',
    'uniform mat4 uInvVP;',
    'uniform vec3 uCam;',
    'uniform float uRayScale;',
    'varying vec3 vRay;',
    'void main() {',
    '  vec4 p = uInvVP * vec4(aPos, 1.0, 1.0);',
    '  vRay = (p.xyz / p.w - uCam) * uRayScale;',
    '  gl_Position = vec4(aPos, 0.99999, 1.0);',
    '}'
  ].join('\n');

  const FS_SKY = [
    'precision mediump float;',
    'uniform vec3 uSky;',
    'uniform vec3 uSkyTop;',
    'uniform vec3 uSun;',
    'uniform vec3 uSunCol;',
    'varying vec3 vRay;',
    'void main() {',
    '  vec3 d = normalize(vRay);',
    '  float h = d.y;',
    '  vec3 c = mix(uSky, uSkyTop, smoothstep(0.0, 0.6, h));',
    '  c *= 1.0 - 0.3 * (1.0 - smoothstep(-0.5, 0.0, h));',
    '  c += uSky * exp(-abs(h) * 9.0) * 0.45;',
    '  float s = max(dot(d, uSun), 0.0);',
    '  float s2 = s * s; float s4 = s2 * s2; float s8 = s4 * s4; float s16 = s8 * s8;',
    '  c += uSunCol * (s8 * 0.1 + s16 * s16 * 0.35);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  /* ---------- v4: 屋外マップの まわりの けしき（maps.js の env の scenery と同じ名前） ---------- */
  const SCENERY = {
    day: { hill: [[0.36, 0.58, 0.32], [0.30, 0.52, 0.30], [0.42, 0.62, 0.36]], hillH: [8, 26], prop: 'tree',
      trunk: [0.50, 0.34, 0.20], leaf: [0.26, 0.54, 0.24], leaf2: [0.20, 0.44, 0.20] },
    forest: { hill: [[0.24, 0.44, 0.26], [0.20, 0.38, 0.22]], hillH: [14, 34], prop: 'tree', dense: 1.6,
      trunk: [0.42, 0.28, 0.18], leaf: [0.20, 0.46, 0.22], leaf2: [0.16, 0.38, 0.18] },
    desert: { hill: [[0.86, 0.70, 0.48], [0.80, 0.60, 0.40], [0.74, 0.54, 0.36]], hillH: [10, 30], prop: 'cactus',
      leaf: [0.34, 0.58, 0.30], rock: [0.74, 0.56, 0.40] },
    snow: { hill: [[0.84, 0.88, 0.94], [0.74, 0.78, 0.86]], hillH: [16, 40], cap: [0.97, 0.98, 1.0], prop: 'pine',
      trunk: [0.42, 0.30, 0.22], leaf: [0.22, 0.40, 0.30], leaf2: [0.94, 0.96, 1.0] },
    sunset: { hill: [[0.70, 0.46, 0.36], [0.62, 0.40, 0.34], [0.56, 0.36, 0.34]], hillH: [8, 22], prop: 'container',
      cont: [[0.92, 0.52, 0.22], [0.30, 0.52, 0.72], [0.72, 0.26, 0.24], [0.36, 0.60, 0.40]], cloud: [1.0, 0.86, 0.78] },
    dusk: { hill: [[0.26, 0.20, 0.24], [0.32, 0.22, 0.24]], hillH: [14, 36], cap: [1.0, 0.42, 0.12], capE: 0.9, prop: 'rock',
      rock: [0.30, 0.24, 0.26], lava: [1.0, 0.42, 0.12], cloud: [0.55, 0.45, 0.60] }
  };
  /* さくの外に 1つ おく（add(x,y,z, sx,sy,sz, color, emissive)。y は 箱の中心、地面は 1m） */
  function propInto(add, S, x, z, rng) {
    const r = rng();
    if (S.prop === 'cactus') {
      if (r < 0.55) {
        const h = 2 + rng() * 2.5;
        add(x, 1 + h / 2, z, 0.7, h, 0.7, S.leaf);
        add(x + 0.7, 1 + h * 0.55, z, 0.7, 0.5, 0.5, S.leaf);
        add(x + 1.0, 1 + h * 0.7, z, 0.5, h * 0.4, 0.5, S.leaf);
      } else {
        const w = 1.2 + rng() * 2.4;
        add(x, 1 + w * 0.3, z, w, w * 0.6, w * 0.8, S.rock);
      }
    } else if (S.prop === 'pine') {
      const h = 2 + rng() * 2;
      add(x, 1 + h / 2, z, 0.6, h, 0.6, S.trunk);
      add(x, 1 + h + 0.4, z, 3.2, 1.4, 3.2, S.leaf);
      add(x, 1 + h + 1.6, z, 2.2, 1.2, 2.2, S.leaf);
      add(x, 1 + h + 2.6, z, 1.2, 1.0, 1.2, S.leaf2);
    } else if (S.prop === 'container') {
      const c = S.cont[Math.floor(rng() * S.cont.length)];
      const along = rng() < 0.5;
      add(x, 2.3, z, along ? 6 : 2.4, 2.6, along ? 2.4 : 6, c);
      if (rng() < 0.4) add(x, 4.9, z, along ? 6 : 2.4, 2.6, along ? 2.4 : 6, S.cont[Math.floor(rng() * S.cont.length)]);
    } else if (S.prop === 'rock') {
      const w = 1.5 + rng() * 3;
      add(x, 1 + w * 0.35, z, w, w * 0.7, w * 0.9, S.rock);
      if (rng() < 0.35) add(x + w * 0.2, 1.05, z + w * 0.6, w * 0.6, 0.1, 0.3, S.lava, 1);
    } else {
      const h = 2 + rng() * 2.2, s = 2.6 + rng() * 1.4;
      add(x, 1 + h / 2, z, 0.6, h, 0.6, S.trunk);
      add(x, 1 + h + s * 0.35, z, s, s * 0.7, s, S.leaf);
      add(x, 1 + h + s * 0.85, z, s * 0.6, s * 0.4, s * 0.6, S.leaf2);
    }
  }

  /* ---------- 単位立方体の表（面ごとに n, u, v。u×v = n で外から見て CCW） ---------- */
  const FACE_DEF = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1],    // +X  u=y v=z
    [-1, 0, 0, 0, 0, 1, 0, 1, 0],   // -X  u=z v=y
    [0, 1, 0, 0, 0, 1, 1, 0, 0],    // +Y  u=z v=x
    [0, -1, 0, 1, 0, 0, 0, 0, 1],   // -Y  u=x v=z
    [0, 0, 1, 1, 0, 0, 0, 1, 0],    // +Z  u=x v=y
    [0, 0, -1, 0, 1, 0, 1, 0, 0]    // -Z  u=y v=x
  ];
  const FACE_U = new Uint8Array([1, 2, 2, 0, 0, 1]);
  const FACE_V = new Uint8Array([2, 1, 0, 2, 1, 0]);
  const CUBE_POS = new Float32Array(108);
  const CUBE_POS_REV = new Float32Array(108);
  const CUBE_FACE = new Uint8Array(36);
  (function () {
    const SU = [-0.5, 0.5, 0.5, -0.5], SV = [-0.5, -0.5, 0.5, 0.5];
    const ORD = [0, 1, 2, 0, 2, 3], REV = [0, 2, 1, 0, 3, 2];
    for (let f = 0; f < 6; f++) {
      const d = FACE_DEF[f];
      for (let k = 0; k < 6; k++) {
        const i = f * 6 + k;
        CUBE_FACE[i] = f;
        for (let pass = 0; pass < 2; pass++) {
          const c = (pass ? REV : ORD)[k], out = pass ? CUBE_POS_REV : CUBE_POS;
          for (let a = 0; a < 3; a++) out[i * 3 + a] = d[a] * 0.5 + d[3 + a] * SU[c] + d[6 + a] * SV[c];
        }
      }
    }
  })();

  /* 銃モデルが無いとき用 */
  const DEFAULT_GUN = {
    id: '_default', zoom: 1, spinup: 0, tracer: [1, 0.9, 0.6], muzzle: [0, 0.015, -0.46], muzzle2: null, viewSpin: null,
    view: [
      [0, 0, -0.05, 0.08, 0.1, 0.32, 0.2, 0.23, 0.3],
      [0, 0.015, -0.33, 0.035, 0.035, 0.26, 0.34, 0.38, 0.47],
      [0, -0.1, 0.05, 0.05, 0.12, 0.06, 0.12, 0.14, 0.19],
      [0, -0.01, 0.2, 0.06, 0.09, 0.16, 0.34, 0.38, 0.47]
    ]
  };

  /* ---------- 4x4 逆行列（確保なし） ---------- */
  function invert4(out, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return false;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return true;
  }

  /* T(t) * Ry(yaw) * Rx(pitch) * Rz(roll) * S(sc) * T(-p) を o に書く */
  function poseMatrix(o, tx, ty, tz, yaw, pitch, roll, sc, px, py, pz) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    // A = Ry*Rx の列
    const a0x = cy, a0y = 0, a0z = -sy;
    const a1x = sy * sp, a1y = cp, a1z = cy * sp;
    const a2x = sy * cp, a2y = -sp, a2z = cy * cp;
    // R = A*Rz
    const r0x = cr * a0x + sr * a1x, r0y = cr * a0y + sr * a1y, r0z = cr * a0z + sr * a1z;
    const r1x = -sr * a0x + cr * a1x, r1y = -sr * a0y + cr * a1y, r1z = -sr * a0z + cr * a1z;
    o[0] = r0x * sc; o[1] = r0y * sc; o[2] = r0z * sc; o[3] = 0;
    o[4] = r1x * sc; o[5] = r1y * sc; o[6] = r1z * sc; o[7] = 0;
    o[8] = a2x * sc; o[9] = a2y * sc; o[10] = a2z * sc; o[11] = 0;
    o[12] = tx - (o[0] * px + o[4] * py + o[8] * pz);
    o[13] = ty - (o[1] * px + o[5] * py + o[9] * pz);
    o[14] = tz - (o[2] * px + o[6] * py + o[10] * pz);
    o[15] = 1;
    return o;
  }

  /* o = G * T(c) * S(s) */
  function boxInto(o, G, cx, cy, cz, sx, sy, sz) {
    o[0] = G[0] * sx; o[1] = G[1] * sx; o[2] = G[2] * sx; o[3] = 0;
    o[4] = G[4] * sy; o[5] = G[5] * sy; o[6] = G[6] * sy; o[7] = 0;
    o[8] = G[8] * sz; o[9] = G[9] * sz; o[10] = G[10] * sz; o[11] = 0;
    o[12] = G[0] * cx + G[4] * cy + G[8] * cz + G[12];
    o[13] = G[1] * cx + G[5] * cy + G[9] * cz + G[13];
    o[14] = G[2] * cx + G[6] * cy + G[10] * cz + G[14];
    o[15] = 1;
    return o;
  }

  /* 転がっている向き q から「yaw だけ・上が上」の向きへ t（0..1）だけ近づける。
     スライディングの表示用。配列を作らないよう out（長さ4）に書く。 */
  function flatQuat(out, q, yaw, t) {
    const h = yaw * 0.5;
    let bx = 0, by = Math.sin(h), bz = 0, bw = Math.cos(h);
    const ax = +q[0] || 0, ay = +q[1] || 0, az = +q[2] || 0, aw = q[3] == null ? 1 : (+q[3] || 0);
    if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    const s = 1 - t;
    const x = ax * s + bx * t, y = ay * s + by * t, z = az * s + bz * t, w = aw * s + bw * t;
    const l = Math.hypot(x, y, z, w) || 1;
    out[0] = x / l; out[1] = y / l; out[2] = z / l; out[3] = w / l;
    return out;
  }

  /* o = G * [ (ax,ay) を通る z 軸まわりに ang 回転 ] * T(c) * S(s) */
  function boxRotZ(o, G, cx, cy, cz, sx, sy, sz, ax, ay, ang) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = cx - ax, dy = cy - ay;
    const ncx = ax + c * dx - s * dy, ncy = ay + s * dx + c * dy;
    o[0] = (G[0] * c + G[4] * s) * sx; o[1] = (G[1] * c + G[5] * s) * sx; o[2] = (G[2] * c + G[6] * s) * sx; o[3] = 0;
    o[4] = (G[4] * c - G[0] * s) * sy; o[5] = (G[5] * c - G[1] * s) * sy; o[6] = (G[6] * c - G[2] * s) * sy; o[7] = 0;
    o[8] = G[8] * sz; o[9] = G[9] * sz; o[10] = G[10] * sz; o[11] = 0;
    o[12] = G[0] * ncx + G[4] * ncy + G[8] * cz + G[12];
    o[13] = G[1] * ncx + G[5] * ncy + G[9] * cz + G[13];
    o[14] = G[2] * ncx + G[6] * ncy + G[10] * cz + G[14];
    o[15] = 1;
    return o;
  }

  /* ---------- 伸びる頂点バッファ ---------- */
  class Batch {
    constructor(stride, verts) {
      this.stride = stride;
      this.cap = verts;
      this.data = new Float32Array(stride * verts);
      this.count = 0;
      this.vbo = null;
      this.gpuLen = 0;       // GPU 側に確保済みの要素数
      this._view = null;
      this._viewLen = -1;
    }
    /* n 頂点ぶん場所を取り、書き込み開始位置（float index）を返す。上限超えは -1 */
    reserve(n) {
      const need = this.count + n;
      if (need > this.cap) {
        if (need > MAX_VERTS) return -1;
        let c = this.cap * 2;
        while (c < need) c *= 2;
        const d = new Float32Array(c * this.stride);
        d.set(this.data.subarray(0, this.count * this.stride));
        this.data = d; this.cap = c;
        this._view = null; this._viewLen = -1;
      }
      const o = this.count * this.stride;
      this.count = need;
      return o;
    }
    view() {
      const len = this.count * this.stride;
      if (len !== this._viewLen) { this._view = this.data.subarray(0, len); this._viewLen = len; }
      return this._view;
    }
  }

  /* ---------- ワールドメッシュを GPU 用に詰める ---------- */
  function packWorldMesh(mesh, world) {
    const pos = mesh.pos, nrm = mesh.nrm || null, col = mesh.col || null, emiIn = mesh.emi || null;
    const vtot = Math.floor(pos.length / 3);
    const idx = mesh.idx || null;
    let triVerts;
    if (idx) triVerts = Math.min(mesh.indexCount != null ? mesh.indexCount : idx.length, idx.length);
    else triVerts = Math.min(mesh.count != null ? mesh.count : vtot, vtot);
    const tris = Math.max(0, Math.floor(triVerts / 3));
    const cc = col && vtot ? Math.max(1, Math.round(col.length / vtot)) : 0;
    const buf = new ArrayBuffer(tris * 3 * WORLD_STRIDE);
    const f32 = new Float32Array(buf), i8 = new Int8Array(buf), u8 = new Uint8Array(buf);
    const vs = (world && world.vs) || CS.VOXEL || 0.5, inv = 1 / vs;
    const GLOW = CS.BLOCK && CS.BLOCK.GLOW != null ? CS.BLOCK.GLOW : 8;
    const canGet = !!(world && typeof world.get === 'function');
    const tri = [0, 0, 0];
    let out = 0;
    for (let t = 0; t < tris; t++) {
      let ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (ia >= vtot || ib >= vtot || ic >= vtot) continue;
      const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
      const e1x = pos[ib * 3] - ax, e1y = pos[ib * 3 + 1] - ay, e1z = pos[ib * 3 + 2] - az;
      const e2x = pos[ic * 3] - ax, e2y = pos[ic * 3 + 1] - ay, e2z = pos[ic * 3 + 2] - az;
      const crx = e1y * e2z - e1z * e2y, cry = e1z * e2x - e1x * e2z, crz = e1x * e2y - e1y * e2x;
      let nx, ny, nz;
      if (nrm) {
        nx = nrm[ia * 3]; ny = nrm[ia * 3 + 1]; nz = nrm[ia * 3 + 2];
        if (crx * nx + cry * ny + crz * nz < 0) { const s = ib; ib = ic; ic = s; }   // CCW にそろえる
      } else {
        const l = Math.hypot(crx, cry, crz) || 1;
        nx = crx / l; ny = cry / l; nz = crz / l;
      }
      // 主軸
      const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
      let axis = 0;
      if (any >= anx && any >= anz) axis = 1; else if (anz >= anx && anz >= any) axis = 2;
      const sgn = (axis === 0 ? nx : axis === 1 ? ny : nz) < 0 ? -1 : 1;
      const ua = axis === 0 ? 1 : 0, va = axis === 2 ? 1 : 2;
      tri[0] = ia; tri[1] = ib; tri[2] = ic;
      let minU = Infinity, minV = Infinity, cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) {
        const p = tri[k] * 3;
        if (pos[p + ua] < minU) minU = pos[p + ua];
        if (pos[p + va] < minV) minV = pos[p + va];
        cx += pos[p]; cy += pos[p + 1]; cz += pos[p + 2];
      }
      const qu = Math.floor(minU * inv + 1e-3), qv = Math.floor(minV * inv + 1e-3);
      // 発光：面の奥のボクセルが GLOW か
      let emiTri = 0;
      if (!emiIn && canGet) {
        const h = vs * 0.5;
        const sx = cx / 3 - (axis === 0 ? sgn * h : 0), sy = cy / 3 - (axis === 1 ? sgn * h : 0), sz = cz / 3 - (axis === 2 ? sgn * h : 0);
        let b = 0;
        try { b = world.get(Math.floor(sx * inv), Math.floor(sy * inv), Math.floor(sz * inv)); } catch (e) { b = 0; }
        emiTri = b === GLOW ? 255 : 0;
      }
      for (let k = 0; k < 3; k++) {
        const v = tri[k], p = v * 3, o = out * WORLD_STRIDE;
        f32[o >> 2] = pos[p]; f32[(o >> 2) + 1] = pos[p + 1]; f32[(o >> 2) + 2] = pos[p + 2];
        i8[o + 12] = axis === 0 ? sgn : 0;
        i8[o + 13] = axis === 1 ? sgn : 0;
        i8[o + 14] = axis === 2 ? sgn : 0;
        u8[o + 15] = emiIn ? Math.max(0, Math.min(255, Math.round(emiIn[v] * 255))) : emiTri;
        if (cc) {
          const q = v * cc;
          u8[o + 16] = Math.max(0, Math.min(255, Math.round(col[q] * 255)));
          u8[o + 17] = Math.max(0, Math.min(255, Math.round(col[q + 1] * 255)));
          u8[o + 18] = Math.max(0, Math.min(255, Math.round(col[q + 2] * 255)));
        } else { u8[o + 16] = u8[o + 17] = u8[o + 18] = 160; }
        u8[o + 20] = Math.max(0, Math.min(255, Math.round(pos[p + ua] * inv - qu)));
        u8[o + 21] = Math.max(0, Math.min(255, Math.round(pos[p + va] * inv - qv)));
        out++;
      }
    }
    return { buf: out === tris * 3 ? buf : buf.slice(0, out * WORLD_STRIDE), verts: out };
  }

  /* ======================================================================
     CS.Renderer
     ====================================================================== */
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ok = false;
      this.lost = false;
      this.gl = null;
      this.view = M4.create();
      this.proj = M4.create();
      this.viewProj = M4.create();
      this.width = 1; this.height = 1;       // CSS px
      this.pixelRatio = 1;
      this.quality = 'auto';
      this.time = 0;
      this.frame = 0;
      this.world = null;
      this.worldVBO = null;
      this.worldCount = 0;
      this.camPos = new Float32Array(3);
      this.camRight = new Float32Array([1, 0, 0]);
      this.camUp = new Float32Array([0, 1, 0]);
      this.camFwd = new Float32Array([0, 0, -1]);
      this.stats = { calls: 0, world: 0, opaque: 0, transparent: 0, additive: 0, vm: 0, vmAdd: 0, sky: 0, verts: 0 };

      // 環境（setWorld で上書き）
      this._sky = new Float32Array([0.03, 0.04, 0.09]);
      this._skyTop = new Float32Array(3);
      this._sun = new Float32Array([0.4, 0.8, 0.3]);
      this._sunCol = new Float32Array([0.62, 0.6, 0.56]);
      this._ambSky = new Float32Array(3);
      this._ambGnd = new Float32Array(3);
      this._edgeTint = new Float32Array([0.05, 0.09, 0.13]);
      this._fogNear = 20; this._fogFar = 60; this._far = 150;
      this._setEnv(null);

      // 行列・一時領域
      this._eye = new Float32Array(3);
      this._camMat = M4.create();
      this._invVP = M4.create();
      this._vmProj = M4.create();
      this._vmVP = M4.create();
      this._G = M4.create();
      this._WG = M4.create();
      this._B = M4.create();
      this._mb = M4.create();
      this._mc = M4.create();
      this._n = new Float32Array(9);
      this._sz = new Float32Array(3);
      this._l = new Float32Array(3);
      this._tmp3 = new Float32Array(3);
      this._skinCache = new WeakMap();       // スキン → 色（CS.Skins.hexRgb の結果）
      this._fcC = [0, 0, 0]; this._fcS = [0, 0, 0];   // _faceRect の作業用
      this._Gh = M4.create();                // ぼうしの行列
      this._pq = new Float32Array(4);        // プレイヤーの向き（スライディングで使い回す）
      this._pp = new Float32Array(3);        // プレイヤーの体の中心（つぶれた時にずらす）
      this._ps = new Float32Array(3);        // プレイヤーの体の大きさ
      this._fMain = 1;
      /* ビューモデル投影（_vmProject）: S = みじかいほうの辺（バッファ px） */
      this._vmS = 1;
      this._vmAspK = 1;
      this._vmPitch = 0;
      this._vmAds = -1;
      this._Gm = M4.create();
      this._vmM = { maxX: 0, mx: 0 };
      this._vmCx = new Float32Array(8);
      this._vmCy = new Float32Array(8);
      this._aspect = 16 / 9;
      this._bw = 1; this._bh = 1;
      this._dirty = true;
      this._gunCache = new WeakMap();

      // バッチ
      this.opaque = new Batch(LIT_STRIDE, 4096);
      this.transparent = new Batch(LIT_STRIDE, 1024);
      this.additive = new Batch(ADD_STRIDE, 8192);
      this.vm = new Batch(LIT_STRIDE, 512);
      this.vmAdd = new Batch(ADD_STRIDE, 256);
      this._batches = [this.opaque, this.transparent, this.additive, this.vm, this.vmAdd];

      const touch = CS.isTouch ? !!CS.isTouch() : false;
      this._touch = touch;
      const attrs = {
        alpha: false, antialias: !touch, depth: true, stencil: false,
        premultipliedAlpha: true, preserveDrawingBuffer: false,
        powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false
      };
      let gl = null;
      try {
        gl = canvas && canvas.getContext ? (canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs)) : null;
      } catch (e) { gl = null; }
      this.gl = gl;
      this._enabledAttribs = 0;

      const q = CS.Settings && CS.Settings.quality ? CS.Settings.quality : 'auto';
      if (!gl) { this._applyQuality(q); return; }

      this._onLost = (e) => { if (e && e.preventDefault) e.preventDefault(); this.lost = true; };
      this._onRestored = () => {
        this.lost = false;
        this._resetGpu();
        this.ok = this._initGL();
        if (this.ok && this.world) this._uploadWorld(this.world);
        this._dirty = true;
      };
      this._onResize = () => { this._dirty = true; };
      try {
        canvas.addEventListener('webglcontextlost', this._onLost, false);
        canvas.addEventListener('webglcontextrestored', this._onRestored, false);
        window.addEventListener('resize', this._onResize);
        window.addEventListener('orientationchange', this._onResize);
        if (window.visualViewport) window.visualViewport.addEventListener('resize', this._onResize);
        if (typeof ResizeObserver === 'function') {
          this._ro = new ResizeObserver(this._onResize);
          this._ro.observe(canvas);
        }
      } catch (e) {}

      this.ok = this._initGL();
      this._applyQuality(q);
    }

    /* ---------- 画質・サイズ ---------- */
    setQuality(q) {
      this._applyQuality(q);
    }

    _applyQuality(q) {
      if (!(q in DPR_CAP)) q = 'auto';
      this.quality = q;
      this._dprCap = q === 'auto' ? (this._touch ? 1.25 : 2) : DPR_CAP[q];
      this._pixelCap = q === 'auto' && this._touch ? 2.2e6 : PIXEL_CAP[q];
      this.resize();
    }

    resize() {
      const c = this.canvas;
      let w = 0, h = 0;
      if (c) { w = c.clientWidth || 0; h = c.clientHeight || 0; }
      if (!w || !h) { w = window.innerWidth || 1; h = window.innerHeight || 1; }
      let dpr = Math.min(window.devicePixelRatio || 1, this._dprCap || 1);
      if (w * h * dpr * dpr > this._pixelCap) dpr = Math.sqrt(this._pixelCap / (w * h));
      const bw = Math.max(1, Math.min(4096, Math.round(w * dpr)));
      const bh = Math.max(1, Math.min(4096, Math.round(h * dpr)));
      if (c) {
        if (c.width !== bw) c.width = bw;
        if (c.height !== bh) c.height = bh;
      }
      this.width = w; this.height = h;
      this.pixelRatio = dpr;
      this._bw = bw; this._bh = bh;
      this._aspect = bw / bh;
      if (this.gl && !this.lost) this.gl.viewport(0, 0, bw, bh);
      this._dirty = false;
    }

    /* ---------- ワールド ---------- */
    setWorld(world) {
      this.world = world || null;
      this._setEnv(world ? world.map : null, world);
      this._buildScenery(world ? world.map : null, world);
      this.worldCount = 0;
      if (this.ok && !this.lost) this._uploadWorld(this.world);
    }

    /* ---------- v4: 屋外マップの まわりの けしき ----------
       マップの外の 地面（床の高さ）・遠くの 山・さくの外の 木（テーマで サボテン・もみの木・コンテナ・岩）・雲。
       setWorld で 箱の ならびを 作って、毎フレーム begin() で つむ（ワールドのメッシュは かえない） */
    _buildScenery(map, world) {
      this._scen = null;
      if (!map || !map.outdoor || !world) return;
      const W = world.sizeX, D = world.sizeZ;
      const S = SCENERY[map.scenery] || SCENERY.day;
      const pal = map.palette || {};
      const g0 = map.groundCol || S.ground || pal[1] || [0.42, 0.66, 0.34];
      let seed = 2166136261;
      const key = String(map.scenery || '') + W + 'x' + D;
      for (let i = 0; i < key.length; i++) { seed ^= key.charCodeAt(i); seed = Math.imul(seed, 16777619); }
      const rng = CS.rng ? CS.rng(seed >>> 0) : Math.random;
      const boxes = [];
      const add = (x, y, z, sx, sy, sz, c, e) => {
        const m = M4.create();
        M4.fromTRS(m, [x, y, z], IDQ, [sx, sy, sz]);
        boxes.push({ m: m, c: c, e: e || 0 });
      };
      /* 地面（上の面は 床と同じ 高さ 1m） */
      const R = 260, gc = [g0[0] * 0.9, g0[1] * 0.9, g0[2] * 0.9];
      add(W / 2, 0.5, -R / 2, W + 2 * R, 1, R, gc);
      add(W / 2, 0.5, D + R / 2, W + 2 * R, 1, R, gc);
      add(-R / 2, 0.5, D / 2, R, 1, D, gc);
      add(W + R / 2, 0.5, D / 2, R, 1, D, gc);
      /* 遠くの 山（ぐるっと 一周） */
      const cx = W / 2, cz = D / 2, base = Math.max(W, D) * 0.5;
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2 + rng() * 0.3;
        const dist = base + 55 + rng() * 60;
        const w = 30 + rng() * 45, d = 30 + rng() * 45, h = S.hillH[0] + rng() * (S.hillH[1] - S.hillH[0]);
        const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
        add(x, 1 + h / 2, z, w, h, d, S.hill[i % S.hill.length]);
        if (S.cap) add(x, 1 + h + 0.8, z, w * 0.5, 1.6, d * 0.5, S.cap, S.capE || 0);
      }
      /* さくの外の 木など（マップから 3〜22m） */
      const nT = Math.round(34 * (S.dense || 1));
      for (let i = 0; i < nT; i++) {
        const side = i % 4, t = rng(), off = 3 + rng() * 19;
        let x, z;
        if (side === 0) { x = -off; z = t * D; } else if (side === 1) { x = W + off; z = t * D; }
        else if (side === 2) { z = -off; x = t * W; } else { z = D + off; x = t * W; }
        propInto(add, S, x, z, rng);
      }
      /* 雲 */
      const clouds = [];
      if (!S.noCloud) {
        for (let i = 0; i < 12; i++) {
          const a = rng() * Math.PI * 2, r = base + 20 + rng() * 90;
          clouds.push({
            x: cx + Math.cos(a) * r, y: 42 + rng() * 22, z: cz + Math.sin(a) * r, v: 0.5 + rng() * 0.7,
            s: [10 + rng() * 16, 2 + rng() * 2, 6 + rng() * 10], s2: [6 + rng() * 8, 1.6 + rng() * 1.5, 4 + rng() * 6], o: rng() * 6 - 3
          });
        }
      }
      this._scen = { boxes: boxes, clouds: clouds, span: base * 2 + 260, cx: cx, cloud: S.cloud || [0.97, 0.98, 1.0] };
    }

    _drawScenery() {
      const sc = this._scen;
      if (!sc || !this.ok) return;
      const o = this._scOpt || (this._scOpt = { emissive: 0, frame: 0 });
      for (let i = 0; i < sc.boxes.length; i++) {
        const b = sc.boxes[i];
        o.emissive = b.e;
        this.box(b.m, b.c, o);
      }
      const t = this.time || 0, span = sc.span, half = span / 2;
      o.emissive = 0.5;
      for (let i = 0; i < sc.clouds.length; i++) {
        const c = sc.clouds[i];
        let x = c.x + t * c.v - sc.cx + half;
        x = ((x % span) + span) % span - half + sc.cx;
        M4.fromTRS(this._mc, [x, c.y, c.z], IDQ, c.s);
        this.box(this._mc, sc.cloud, o);
        M4.fromTRS(this._mc, [x + c.o, c.y + c.s[1] * 0.6, c.z + c.o * 0.4], IDQ, c.s2);
        this.box(this._mc, sc.cloud, o);
      }
    }

    /* ブロックを置いた・こわした（マップエディター）: 同じワールドのメッシュを作りなおす */
    refreshWorld() {
      if (this.ok && !this.lost && this.world) this._uploadWorld(this.world);
    }

    _setEnv(map, world) {
      const sky = map && map.sky ? map.sky : [0.03, 0.04, 0.09];
      for (let i = 0; i < 3; i++) {
        const s = +sky[i] || 0;
        this._sky[i] = s;
        this._skyTop[i] = s * 0.42;
        this._ambSky[i] = 0.5 + s * 0.8;
        this._ambGnd[i] = 0.26 + s * 0.4;
      }
      /* 屋外（昼）のマップ: 空の上のほうの色・環境光・日ざしの色を マップで決められる。
         決めていないマップは これまでどおり（空の色から作る） */
      const env3 = (key, dst) => {
        const v = map && Array.isArray(map[key]) ? map[key] : null;
        if (v) for (let i = 0; i < 3; i++) dst[i] = +v[i] || 0;
        return !!v;
      };
      env3('skyTop', this._skyTop);
      env3('ambSky', this._ambSky);
      env3('ambGnd', this._ambGnd);
      if (!env3('sunCol', this._sunCol)) { this._sunCol[0] = 0.62; this._sunCol[1] = 0.6; this._sunCol[2] = 0.56; }
      const sun = map && map.sun ? map.sun : [0.4, 0.8, 0.3];
      const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1;
      this._sun[0] = sun[0] / sl; this._sun[1] = sun[1] / sl; this._sun[2] = sun[2] / sl;
      this._fogNear = map && map.fogNear != null ? +map.fogNear : 20;
      this._fogFar = map && map.fogFar != null ? +map.fogFar : 60;
      if (!(this._fogFar > this._fogNear)) this._fogFar = this._fogNear + 1;
      const glow = map && map.palette ? map.palette[CS.BLOCK && CS.BLOCK.GLOW != null ? CS.BLOCK.GLOW : 8] : null;
      if (glow) { for (let i = 0; i < 3; i++) this._edgeTint[i] = 0.02 + (+glow[i] || 0) * 0.11; }
      else { this._edgeTint[0] = 0.05; this._edgeTint[1] = 0.09; this._edgeTint[2] = 0.13; }
      let diag = 60;
      if (world && world.sizeX) diag = Math.hypot(world.sizeX, world.sizeY || 0, world.sizeZ || 0);
      this._far = Math.max(80, diag * 1.3 + 10, this._fogFar * 1.3);
    }

    _uploadWorld(world) {
      const gl = this.gl;
      this.worldCount = 0;
      if (!gl || !world || typeof world.buildMesh !== 'function') return;
      let mesh = null;
      try { mesh = world.buildMesh(); } catch (e) { console.warn('[render] buildMesh failed', e); return; }
      if (!mesh || !mesh.pos) return;
      const packed = packWorldMesh(mesh, world);
      if (!this.worldVBO) this.worldVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.worldVBO);
      gl.bufferData(gl.ARRAY_BUFFER, packed.buf, gl.STATIC_DRAW);
      this.worldCount = packed.verts;
    }

    /* ---------- GL 初期化 ---------- */
    _resetGpu() {
      this.worldVBO = null;
      this.skyVBO = null;
      this._enabledAttribs = 0;
      for (const b of this._batches) { b.vbo = null; b.gpuLen = 0; }
    }

    _shader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        console.warn('[render] shader compile failed:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    }

    _program(vs, fs, attribs, uniforms) {
      const gl = this.gl;
      const v = this._shader(gl.VERTEX_SHADER, vs), f = this._shader(gl.FRAGMENT_SHADER, fs);
      if (!v || !f) return null;
      const p = gl.createProgram();
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      for (let i = 0; i < attribs.length; i++) gl.bindAttribLocation(p, i, attribs[i]);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
        console.warn('[render] program link failed:', gl.getProgramInfoLog(p));
        return null;
      }
      gl.deleteShader(v); gl.deleteShader(f);
      const u = {};
      for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
      return { p, u, n: attribs.length };
    }

    _initGL() {
      const gl = this.gl;
      if (!gl) return false;
      const LIGHT = ['uVP', 'uCam', 'uSun', 'uSunCol', 'uAmbSky', 'uAmbGnd', 'uFogNear', 'uFogFar'];
      this.pWorld = this._program(VS_WORLD, FS_WORLD, ['aPos', 'aNrm', 'aCol', 'aEmi', 'aUV'],
        LIGHT.concat(['uTime', 'uSky', 'uEdgeTint', 'uEdge', 'uIce']));
      this.pLit = this._program(VS_LIT, FS_LIT, ['aPos', 'aNrm', 'aCol', 'aEdge', 'aMat'], LIGHT.concat(['uSky']));
      this.pAdd = this._program(VS_ADD, FS_ADD, ['aPos', 'aCol', 'aUV'], ['uVP', 'uCam', 'uFogNear', 'uFogFar']);
      this.pSky = this._program(VS_SKY, FS_SKY, ['aPos'], ['uInvVP', 'uCam', 'uRayScale', 'uSky', 'uSkyTop', 'uSun', 'uSunCol']);
      if (!this.pWorld || !this.pLit || !this.pAdd || !this.pSky) return false;
      this.skyVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVBO);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      for (const b of this._batches) { b.vbo = gl.createBuffer(); b.gpuLen = 0; }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      gl.disable(gl.BLEND);
      gl.disable(gl.DITHER);
      this._enabledAttribs = 0;
      if (this._bw) gl.viewport(0, 0, this._bw, this._bh);
      return true;
    }

    _attribs(n) {
      const gl = this.gl;
      while (this._enabledAttribs < n) gl.enableVertexAttribArray(this._enabledAttribs++);
      while (this._enabledAttribs > n) gl.disableVertexAttribArray(--this._enabledAttribs);
    }

    _upload(b) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
      if (b.gpuLen < b.data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, b.data.byteLength, gl.DYNAMIC_DRAW);
        b.gpuLen = b.data.length;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.view());
    }

    /* ---------- フレーム ---------- */
    begin(cam) {
      this.frame++;
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      this.time = t;
      if (!this._dirty && (this.frame % 30) === 0 && this.canvas) {
        const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
        if (cw && ch && (cw !== this.width || ch !== this.height)) this._dirty = true;
      }
      if (this._dirty) this.resize();

      cam = cam || EMPTY;
      const pos = cam.pos || ZERO3;
      let yaw = +cam.yaw || 0, pitch = +cam.pitch || 0;
      let ex = +pos[0] || 0, ey = +pos[1] || 0, ez = +pos[2] || 0;
      const sh = clamp01(cam.shake);
      if (sh > 0) {
        const k = sh * sh;
        yaw += k * 0.02 * (Math.sin(t * 37.1) + 0.6 * Math.sin(t * 61.7 + 1.3));
        pitch += k * 0.02 * (Math.sin(t * 43.3 + 0.7) + 0.6 * Math.sin(t * 71.9 + 2.1));
        ex += k * 0.025 * Math.sin(t * 51.3 + 2.2);
        ey += k * 0.025 * Math.sin(t * 53.2 + 0.4);
        ez += k * 0.025 * Math.sin(t * 47.9 + 1.1);
      }
      const e = this._eye;
      e[0] = ex; e[1] = ey; e[2] = ez;
      this.camPos[0] = ex; this.camPos[1] = ey; this.camPos[2] = ez;

      const v = this.view;
      M4.viewFPS(v, e, yaw, pitch);
      const fov = Math.min(150, Math.max(10, +cam.fov || (CS.Settings && CS.Settings.fov) || 78)) * Math.PI / 180;
      this._fMain = 1 / Math.tan(fov / 2);
      M4.perspective(this.proj, fov, this._aspect, NEAR, this._far);
      M4.multiply(this.viewProj, this.proj, v);
      /* 銃（ビューモデル）は「みじかいほうの辺 S」を基準にする（くわしくは _vmProject） */
      this._vmS = Math.max(1, Math.min(this._bw, this._bh));
      this._vmAspK = Math.min(1, (this._bw / this._vmS) / 1.35);
      this._vmAds = -1;
      this._vmProject(0);
      if (!invert4(this._invVP, this.viewProj)) M4.identity(this._invVP);

      // カメラ→ワールド行列（ビュー行列の転置回転＋位置）
      const cm = this._camMat;
      cm[0] = v[0]; cm[1] = v[4]; cm[2] = v[8]; cm[3] = 0;
      cm[4] = v[1]; cm[5] = v[5]; cm[6] = v[9]; cm[7] = 0;
      cm[8] = v[2]; cm[9] = v[6]; cm[10] = v[10]; cm[11] = 0;
      cm[12] = ex; cm[13] = ey; cm[14] = ez; cm[15] = 1;
      this.camRight[0] = v[0]; this.camRight[1] = v[4]; this.camRight[2] = v[8];
      this.camUp[0] = v[1]; this.camUp[1] = v[5]; this.camUp[2] = v[9];
      this.camFwd[0] = -v[2]; this.camFwd[1] = -v[6]; this.camFwd[2] = -v[10];

      for (const b of this._batches) b.count = 0;
      const st = this.stats;
      st.calls = st.world = st.opaque = st.transparent = st.additive = st.vm = st.vmAdd = st.sky = st.verts = 0;
      /* v4: 屋外マップの まわりの けしき */
      if (this._scen) this._drawScenery();

      const gl = this.gl;
      if (this.ok && gl && !this.lost && !gl.isContextLost()) {
        gl.depthMask(true);
        gl.clearColor(this._sky[0], this._sky[1], this._sky[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      }
    }

    /* ---------- 箱を積む ---------- */
    cube(pos, quat, size, color, opts) {
      if (!this.ok || !pos) return;
      M4.fromTRS(this._mc, pos, quat || IDQ, size == null ? 1 : size);
      this.box(this._mc, color, opts);
    }

    box(mat, color, opts) {
      if (!this.ok || !mat) return;
      opts = opts || EMPTY;
      const c = color || ZERO3;
      const a = opts.alpha != null ? clamp01(opts.alpha) : (c.length > 3 ? clamp01(c[3]) : 1);
      if (a <= 0.003) return;
      const r = +c[0] || 0, g = +c[1] || 0, b = +c[2] || 0;
      if (opts.additive) { this._emitAddBox(this.additive, mat, r, g, b, a); return; }
      let fw = opts.frame;
      if (fw == null) {
        const sx = Math.hypot(mat[0], mat[1], mat[2]), sy = Math.hypot(mat[4], mat[5], mat[6]), sz = Math.hypot(mat[8], mat[9], mat[10]);
        fw = Math.min(0.06, Math.min(sx, sy, sz) * 0.09);
      }
      this._emitLit(a < 0.999 ? this.transparent : this.opaque, mat, r, g, b, a, clamp01(opts.emissive), fw > 0 ? fw : 0);
    }

    /* 光る線（カメラを向いた帯・両端丸め） */
    line(a, b, color, width, alpha) {
      if (!this.ok || !a || !b) return;
      const al = alpha == null ? 1 : clamp01(alpha);
      if (al <= 0.003) return;
      const c = color || ZERO3;
      this._lineInto(this.additive, a[0], a[1], a[2], b[0], b[1], b[2], +c[0] || 0, +c[1] || 0, +c[2] || 0, width > 0 ? width : 0.04, al);
    }

    particle(pos, size, color, alpha) {
      if (!this.ok || !pos) return;
      const al = alpha == null ? 1 : clamp01(alpha);
      if (al <= 0.003) return;
      const c = color || ZERO3;
      this._quadInto(this.additive, pos[0], pos[1], pos[2], size > 0 ? size : 0.1, +c[0] || 0, +c[1] || 0, +c[2] || 0, al);
    }

    /* ---------- プレイヤー（転がる立方体＋浮いた銃） ---------- */
    player(p) {
      if (!this.ok || !p || !p.pos) return;
      const t = this.time;
      const pos = p.pos;
      const team = p.team === 1 ? 1 : 0;
      const tc = (CS.TEAM_COLORS && CS.TEAM_COLORS[team]) || (team ? [0.24, 0.64, 1] : [1, 0.3, 0.37]);
      const alphaBase = p.alpha == null ? 1 : clamp01(p.alpha);
      if (alphaBase <= 0.01) return;
      const hit = clamp01(p.hit), flash = clamp01(p.flash);
      const prot = !!p.protect;
      const PL = CS.PLAYER || EMPTY;
      const half = PL.half > 0 ? PL.half : 0.48;                 // 当たり判定の半分
      const size = (PL.size > 0 ? PL.size : half * 2) * BODY_SCALE;  // 見た目の一辺
      const hx = size * 0.5;
      const yaw = +p.yaw || 0;
      const shimmer = 0.5 + 0.5 * Math.sin(t * 14 + pos[0] * 2.3 + pos[2] * 1.7);

      /* スライディング: 転がりを止めて（yaw だけの向きへ）、足もとはそのままに高さをつぶす */
      const slide = clamp01(p.slide);
      let q = p.quat || IDQ, bcy = pos[1], hy = hx;
      if (slide > 0) {
        const hurt = (PL.slide && PL.slide.hurtHeight > 0 ? PL.slide.hurtHeight : 0.55) * BODY_SCALE;
        hy = (size + (hurt - size) * slide) * 0.5;
        bcy = pos[1] - half + hy;                                // 足もと（pos.y - half）はそのまま
        q = flatQuat(this._pq, p.quat || IDQ, yaw, slide);
      }
      const ctr = this._pp; ctr[0] = pos[0]; ctr[1] = bcy; ctr[2] = pos[2];

      /* v5: 必殺技「せんしゃ」: 立方体の かわりに 小さな せんしゃ（当たり判定は いつもの 立方体と おなじ大きさ） */
      if (p.tank) { this._tank(p, pos, yaw, tc, alphaBase, hit, flash, half); return; }

      // 本体
      let r = tc[0] * 0.88, g = tc[1] * 0.88, b = tc[2] * 0.88;
      let em = 0.14, bodyA = alphaBase;
      if (prot) {
        const k = 0.28 + 0.22 * shimmer;
        r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k;
        em = 0.45 + 0.3 * shimmer;
        bodyA *= 0.4 + 0.22 * shimmer;
      }
      if (hit > 0) {
        const k = 0.8 * hit;
        r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k;
        if (hit * 0.9 > em) em = hit * 0.9;
      }
      this._ps[0] = size; this._ps[1] = hy * 2; this._ps[2] = size;
      M4.fromTRS(this._mc, ctr, q, this._ps);
      this._emitLit(bodyA < 0.999 ? this.transparent : this.opaque, this._mc, r, g, b, bodyA, em, Math.min(size, hy * 2) * 0.0765);

      const ePass = alphaBase < 0.999 ? this.transparent : this.opaque;
      const SK = CS.Skins;
      const skin = p.skin && SK && !(SK.isPlainBody || SK.isPlain)(p.skin) ? p.skin : null;
      if (skin) {
        /* スキン: 面のまんなかを からだの色に、もよう、ドットのかお（からだといっしょに転がる） */
        const lk = (prot ? 0.28 + 0.22 * shimmer : 0) + (hit > 0 ? 0.8 * hit : 0);
        this._skinBody(skin, this._mc, bodyA < 0.999 ? this.transparent : this.opaque, bodyA, em, tc, Math.min(1, lk), size, hy);
      } else {
        // 顔（-Z 面に光る目ふたつ）
        M4.fromTRS(this._mb, ctr, q, 1);
        const er = 1 + (tc[0] - 1) * 0.15, eg = 1 + (tc[1] - 1) * 0.15, eb = 1 + (tc[2] - 1) * 0.15;
        const ez = -(hx + 0.004);
        const ek = size, eh = Math.min(0.194 * ek, hy * 0.8);       // つぶれた時は目も低くする
        boxInto(this._B, this._mb, -0.174 * ek, hy * 0.17, ez, 0.133 * ek, eh, 0.024);
        this._emitLit(ePass, this._B, er, eg, eb, alphaBase, 1, 0);
        boxInto(this._B, this._mb, 0.174 * ek, hy * 0.17, ez, 0.133 * ek, eh, 0.024);
        this._emitLit(ePass, this._B, er, eg, eb, alphaBase, 1, 0);
      }
      /* ぼうし（転がらない。ブロックの上に うかぶ） */
      if (skin && skin.h !== 'none') this._hat(skin, pos[0], bcy + hy, pos[2], yaw, size, ePass, alphaBase, hit, t, tc);
      /* ボス: むらさきのオーラ */
      if (p.boss) {
        const k = 0.5 + 0.5 * Math.sin(t * 5);
        this._ps[0] = size * (1.18 + 0.06 * k); this._ps[1] = hy * 2 * (1.18 + 0.06 * k); this._ps[2] = this._ps[0];
        M4.fromTRS(this._mb, ctr, q, this._ps);
        this._emitAddBox(this.additive, this._mb, 0.75, 0.35, 1, (0.08 + 0.06 * k) * alphaBase);
      }

      // 無敵のゆらめき
      if (prot) {
        this._ps[0] = size * 1.08; this._ps[1] = hy * 2.16; this._ps[2] = size * 1.08;
        M4.fromTRS(this._mc, ctr, q, this._ps);
        this._emitAddBox(this.additive, this._mc, 0.55, 0.95, 1, (0.07 + 0.07 * shimmer) * alphaBase);
        for (let i = 0; i < 3; i++) {
          const ang = t * 3.1 + i * 2.0944;
          this._quadInto(this.additive, pos[0] + Math.cos(ang) * (size * 0.75), bcy + Math.sin(t * 2.3 + i * 1.7) * (size * 0.42), pos[2] + Math.sin(ang) * (size * 0.75),
            0.16, 0.7, 1, 1, 0.8 * alphaBase);
        }
      }

      // 銃（yaw/pitch に合わせる。転がらない）
      if (p.gun === false) return;
      const gun = this._resolveGun(p.gun);
      const info = this._gunInfo(gun);
      const pitch = Math.max(-1.55, Math.min(1.55, +p.pitch || 0));
      const sc = 0.8 * (p.gunScale > 0 ? Math.min(3, p.gunScale) : 1);     // gunScale: 町では 大きめに見せる
      const side = hx + 0.16 + Math.min(0.3, (info.maxX - info.minX) * 0.5 * sc);
      const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
      const G = poseMatrix(this._G, pos[0] + cyaw * side, bcy + 0.06, pos[2] - syaw * side,
        yaw, pitch, 0, sc, info.cx, info.m[1], info.cz);
      const gs = CS.GunSkins && p.skin ? CS.GunSkins.get(p.skin.g) : null;
      this._drawGunBoxes(G, info, alphaBase < 0.999 ? this.transparent : this.opaque, alphaBase,
        hit, Math.max(hit * 0.9, flash * 0.25), clamp01(p.charge), info.spin ? (+p.spin || 0) : 0, sc, gs);
      if (flash > 0.01 || p.charge > 0.01) {
        const m = (p.side === 1 && info.m2) ? info.m2 : info.m;
        const tp = this._tmp3;
        tp[0] = G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12];
        tp[1] = G[1] * m[0] + G[5] * m[1] + G[9] * m[2] + G[13];
        tp[2] = G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14];
        if (flash > 0.01) this._flashInto(this.additive, tp[0], tp[1], tp[2], flash * alphaBase, info.tracer, 2.4);
        if (p.charge > 0.01) this._chargeInto(this.additive, tp[0], tp[1], tp[2], clamp01(p.charge) * alphaBase, info.tracer, 2.0);
      }
    }

    /* v5: せんしゃ（車体と キャタピラは yaw だけ、砲身は pitch も） */
    _tank(p, pos, yaw, tc, a, hit, flash, half) {
      const pass = a < 0.999 ? this.transparent : this.opaque;
      const y0 = pos[1] - half;
      const H = this._tkH || (this._tkH = new Float32Array(16));
      const P = this._tkP || (this._tkP = new Float32Array(16));
      const B = this._B;
      const lk = hit > 0 ? 0.8 * hit : 0;
      const L = (v) => v + (1 - v) * lk;
      const em = Math.max(hit * 0.9, 0.08);
      const body = [0.30 + tc[0] * 0.22, 0.38 + tc[1] * 0.14, 0.22 + tc[2] * 0.14];
      const trk = [0.13, 0.14, 0.16], metal = [0.22, 0.25, 0.28];
      const put = (M, cx, cy, cz, sx, sy, sz, c, e) => { boxInto(B, M, cx, cy, cz, sx, sy, sz); this._emitLit(pass, B, L(c[0]), L(c[1]), L(c[2]), a, e == null ? em : e, 0.02); };
      poseMatrix(H, pos[0], y0, pos[2], yaw, 0, 0, 1, 0, 0, 0);
      put(H, -0.5, 0.2, 0, 0.26, 0.4, 1.34, trk);                 // キャタピラ
      put(H, 0.5, 0.2, 0, 0.26, 0.4, 1.34, trk);
      for (let i = -2; i <= 2; i++) { put(H, -0.64, 0.2, i * 0.26, 0.02, 0.16, 0.16, metal); put(H, 0.64, 0.2, i * 0.26, 0.02, 0.16, 0.16, metal); }
      put(H, 0, 0.48, 0.02, 0.86, 0.34, 1.18, body);              // 車体
      put(H, 0, 0.43, -0.64, 0.78, 0.2, 0.14, [body[0] * 0.85, body[1] * 0.85, body[2] * 0.85]);
      put(H, 0, 0.8, 0.06, 0.6, 0.28, 0.62, [body[0] * 1.12, body[1] * 1.12, body[2] * 1.12]);   // 砲塔
      put(H, 0, 0.95, 0.06, 0.62, 0.035, 0.64, tc, 0.7);          // チームの色の おび
      const pitch = Math.max(-0.35, Math.min(0.6, +p.pitch || 0));
      poseMatrix(P, pos[0], y0 + 0.82, pos[2], yaw, pitch, 0, 1, 0, 0, 0);
      put(P, 0, 0, -0.62, 0.13, 0.13, 0.9, metal);                // 砲身
      put(P, 0, 0, -1.1, 0.18, 0.18, 0.12, tc, 0.5);
      if (flash > 0.01) {
        const tp = this._tmp3;
        tp[0] = P[8] * -1.2 + P[12]; tp[1] = P[9] * -1.2 + P[13]; tp[2] = P[10] * -1.2 + P[14];
        this._flashInto(this.additive, tp[0], tp[1], tp[2], flash * a, [1, 0.72, 0.3], 3.2);
      }
    }

    /* ---------- スキン ---------- */
    /* スキンの色（skin ごとに1回だけ計算） */
    _skinRgb(skin) {
      let c = this._skinCache.get(skin);
      if (c) return c;
      const SK = CS.Skins;
      c = { body: skin.c ? SK.hexRgb(skin.c, [0, 0, 0]) : null, c2: SK.hexRgb(skin.c2, [0, 0, 0]) || [1, 1, 1] };
      this._skinCache.set(skin, c);
      return c;
    }

    /* 単位立方体の面 f（0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z）の上の四角。u,v は面の中の座標（-0.5..0.5）、off = 中心からのきょり */
    _faceRect(M, f, u0, v0, u1, v1, off, th, pass, r, g, b, a, em) {
      const ax = f >> 1, s = (f & 1) ? -1 : 1;
      const ua = ax === 0 ? 1 : 0, va = ax === 2 ? 1 : 2;
      const c = this._fcC, sz = this._fcS;
      c[ax] = s * off; sz[ax] = th;
      c[ua] = (u0 + u1) / 2; sz[ua] = u1 - u0;
      c[va] = (v0 + v1) / 2; sz[va] = v1 - v0;
      boxInto(this._B, M, c[0], c[1], c[2], sz[0], sz[1], sz[2]);
      this._emitLit(pass, this._B, r, g, b, a, em, 0);
    }

    /* M = からだの行列（単位立方体 → ワールド）。lk = 白くする量（被弾・むてき） */
    _skinBody(skin, M, pass, alpha, em, tc, lk, size, hy) {
      const SK = CS.Skins, col = this._skinRgb(skin);
      const PAN = SK.PANEL, T = 0.006 / Math.max(0.2, size);
      const W = (v) => v + (1 - v) * lk;
      /* 1) 面のまんなかを からだの色に（まわりの ふち は チームの色のまま） */
      if (col.body) {
        const r = W(col.body[0] * 0.88), g = W(col.body[1] * 0.88), b = W(col.body[2] * 0.88);
        for (let f = 0; f < 6; f++) this._faceRect(M, f, -PAN / 2, -PAN / 2, PAN / 2, PAN / 2, 0.5 + T * 0.5, T, pass, r, g, b, alpha, em);
      }
      /* 2) もよう（2つめの色） */
      const pat = SK.PATTERNS[skin.p];
      if (pat && pat.rects.length) {
        const r = W(col.c2[0] * 0.9), g = W(col.c2[1] * 0.9), b = W(col.c2[2] * 0.9);
        for (let f = 0; f < 6; f++) {
          for (let i = 0; i < pat.rects.length; i++) {
            const rc = pat.rects[i];
            this._faceRect(M, f, rc[0] * PAN, rc[1] * PAN, rc[2] * PAN, rc[3] * PAN, 0.5 + T * 1.5, T, pass, r, g, b, alpha, Math.max(em, 0.1));
          }
        }
      }
      /* 3) かお（-Z の面。見ている人の左 = +X） */
      const runs = SK.faceRuns(skin.f), FS = SK.FACE_SIZE, px = FS / 8;
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i], k = run[3], pc = SK.PIX[k];
        if (!pc) continue;
        let r = pc[0], g = pc[1], b = pc[2];
        if (k === '8') { r = 1 + (tc[0] - 1) * 0.55; g = 1 + (tc[1] - 1) * 0.55; b = 1 + (tc[2] - 1) * 0.55; }
        const x0 = FS / 2 - run[1] * px, x1 = x0 - run[2] * px;
        const y1 = FS / 2 - run[0] * px, y0 = y1 - px;
        boxInto(this._B, M, (x0 + x1) / 2, (y0 + y1) / 2, -(0.5 + T * 2.5), (x0 - x1) * 0.97, px * 0.97, T);
        this._emitLit(pass, this._B, W(r), W(g), W(b), alpha, Math.max(pc[3], em), 0);
      }
    }

    /* ぼうし（向きは yaw だけ。ブロックの上の面 (x, y, z) に のせる） */
    _hat(skin, x, y, z, yaw, size, pass, alpha, hit, t, tc) {
      const H = CS.Skins.HATS[skin.h];
      if (!H || !H.boxes.length) return;
      const col = this._skinRgb(skin);
      const bob = Math.sin(t * 2.4 + x * 0.7 + z * 0.3) * 0.015;
      const G = poseMatrix(this._Gh, x, y + 0.02 + bob, z, yaw, 0, 0, size, 0, 0, 0);
      const hk = 0.8 * clamp01(hit);
      const team = tc || [1, 0.3, 0.37];
      for (let i = 0; i < H.boxes.length; i++) {
        const bx = H.boxes[i];
        let c = bx[6];
        if (c === 'c') c = col.body || team;
        else if (c === 'c2') c = col.c2;
        let r = c[0], g = c[1], b = c[2];
        if (hk > 0) { r += (1 - r) * hk; g += (1 - g) * hk; b += (1 - b) * hk; }
        boxInto(this._B, G, bx[0], bx[1], bx[2], bx[3], bx[4], bx[5]);
        this._emitLit(pass, this._B, r, g, b, alpha, bx[7] || 0, Math.min(bx[3], bx[4], bx[5]) * size * 0.12);
      }
    }

    /* ---------- 自分の銃 ---------- */
    viewModel(gun, s) {
      if (!this.ok) return;
      s = s || EMPTY;
      gun = this._resolveGun(gun);
      const ads = clamp01(s.ads);
      if (ads >= 0.9 && gun.zoom > 0 && gun.zoom <= 0.45) return;   // スコープ表示中は隠す
      const info = this._gunInfo(gun);
      const G = this._vmPose(info, s, this._G);
      const WG = M4.multiply(this._WG, this._camMat, G);             // 銃ローカル → ワールド
      const flash = clamp01(s.flash), charge = clamp01(s.charge);
      /* 自分の銃のスキン（s.gunSkin があればそれ。なければ せってい） */
      const gs = CS.GunSkins ? CS.GunSkins.get(s.gunSkin !== undefined ? s.gunSkin : CS.GunSkins.mineId()) : null;
      this._drawGunBoxes(WG, info, this.vm, 1, 0, flash * 0.22, charge, info.spin ? (+s.spin || 0) : 0, 1, gs);
      if (flash > 0.01 || charge > 0.01) {
        const m = (s.side === 1 && info.m2) ? info.m2 : info.m;
        const tp = this._tmp3;
        tp[0] = WG[0] * m[0] + WG[4] * m[1] + WG[8] * (m[2] - 0.015) + WG[12];
        tp[1] = WG[1] * m[0] + WG[5] * m[1] + WG[9] * (m[2] - 0.015) + WG[13];
        tp[2] = WG[2] * m[0] + WG[6] * m[1] + WG[10] * (m[2] - 0.015) + WG[14];
        if (flash > 0.01) this._flashInto(this.vmAdd, tp[0], tp[1], tp[2], flash, info.tracer, 0.55);
        if (charge > 0.01) this._chargeInto(this.vmAdd, tp[0], tp[1], tp[2], charge, info.tracer, 0.4);
      }
    }

    /* ビューモデルの銃口のワールド座標（メイン投影で同じ画面位置に見える点） */
    muzzleWorld(gun, s, out) {
      out = out || [0, 0, 0];
      s = s || EMPTY;
      gun = this._resolveGun(gun);
      const info = this._gunInfo(gun);
      const G = this._vmPose(info, s, this._G);
      const m = (s.side === 1 && info.m2) ? info.m2 : info.m;
      const mx = G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12];
      const my = G[1] * m[0] + G[5] * m[1] + G[9] * m[2] + G[13];
      const vz = G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14];
      /* ビューモデル投影での画面位置（NDC）→ 同じ深さでメイン投影がそこへ映す点 */
      const P = this._vmProj, w = -vz > 1e-4 ? -vz : 1e-4;
      const nx = (P[0] * mx + P[8] * vz) / w, ny = (P[5] * my + P[9] * vz) / w;
      const fm = this._fMain || 1;
      const vx = nx * w * this._aspect / fm, vy = ny * w / fm;
      const c = this._camMat;
      out[0] = c[0] * vx + c[4] * vy + c[8] * vz + c[12];
      out[1] = c[1] * vx + c[5] * vy + c[9] * vz + c[13];
      out[2] = c[2] * vx + c[6] * vy + c[10] * vz + c[14];
      return out;
    }

    /* ビュー空間での銃口（テスト・デバッグ用） */
    _vmMuzzleView(gun, s, out) {
      out = out || [0, 0, 0];
      s = s || EMPTY;
      const info = this._gunInfo(this._resolveGun(gun));
      const G = this._vmPose(info, s, this._G);
      const m = (s.side === 1 && info.m2) ? info.m2 : info.m;
      out[0] = G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12];
      out[1] = G[1] * m[0] + G[5] * m[1] + G[9] * m[2] + G[13];
      out[2] = G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14];
      return out;
    }

    /* ビューモデルの投影（ads ごとに作る。同じ値なら作りなおさない）。
       ・大きさは「みじかいほうの辺 S」で決める。たての画角を固定すると、たて長の画面
         （タブレットのたて持ちなど）で銃だけが巨大になり、タッチボタンにかぶる。
       ・たて長のときは、銃の絵を「画面の下はし・高さ S の帯」に入れる（絵ごと下へずらす）。
         よこ長なら帯＝画面なので、ふつうの視野60°とまったく同じ。
       ・ずらした分だけ銃を上へ向けて（_vmPitch・銃口のまわりで回す）、銃身が照準（画面の中心）を向くようにする。
       ・ADS に近づくほどずれを 0 にもどす（のぞくときは画面の中心）。 */
    _vmProject(ads) {
      if (ads === this._vmAds) return;
      this._vmAds = ads;
      const bw = this._bw, bh = this._bh, S = this._vmS;
      const P = M4.perspective(this._vmProj, VM_FOV, 1, 0.01, 10);
      P[0] = VM_F * S / bw;
      P[5] = VM_F * S / bh;
      P[9] = (bh - S) / bh * (1 - ads);          // NDC で下へ（ndc.y = P5·y/(-z) − P9）
      this._vmPitch = Math.atan(P[9] / P[5]);
      M4.multiply(this._vmVP, P, this.view);
    }

    /* 腰だめ（ads 0・ゆれなし）の基本姿勢。_vmAvoid の計算用 */
    _vmBase(info, dx, dy, G) {
      const S = this._vmS, bh = this._bh;
      const aim0 = Math.atan((bh - S) / (VM_F * S));
      return this._poseAim(G, info, (info.m2 ? 0.03 : 0.2) * this._vmAspK + dx, -0.2 + dy, -0.13,
        info.m2 ? 0 : 0.05, 0.015, 0, aim0);
    }

    /* 基本姿勢の銃のシルエットについて、画面の y ≥ ty の帯にかかる部分の右はし x と、
       銃口の x（どちらもバッファ px）を res に入れる */
    _vmMeasure(info, dx, dy, ty, res) {
      const G = this._vmBase(info, dx, dy, this._Gm);
      const bw = this._bw, bh = this._bh, S = this._vmS;
      const P0 = VM_F * S / bw, P5 = VM_F * S / bh, off = (bh - S) / bh;
      const hw = bw * 0.5, hh = bh * 0.5;
      const X = this._vmCx, Y = this._vmCy, view = info.view;
      let maxX = -Infinity;
      for (let b = 0; b < view.length; b++) {
        const v = view[b];
        if (!v || v.length < 6) continue;
        for (let i = 0; i < 8; i++) {
          const lx = v[0] + (i & 1 ? 0.5 : -0.5) * v[3];
          const ly = v[1] + (i & 2 ? 0.5 : -0.5) * v[4];
          const lz = v[2] + (i & 4 ? 0.5 : -0.5) * v[5];
          const vx = G[0] * lx + G[4] * ly + G[8] * lz + G[12];
          const vy = G[1] * lx + G[5] * ly + G[9] * lz + G[13];
          const w = Math.max(0.02, -(G[2] * lx + G[6] * ly + G[10] * lz + G[14]));
          X[i] = hw * (1 + P0 * vx / w);
          Y[i] = hh * (1 - (P5 * vy / w - off));
        }
        /* 凸包のなかの点どうしの線分は凸包からはみ出さない → 全ペアを帯で切れば右はしが出る */
        for (let i = 0; i < 8; i++) {
          for (let j = i; j < 8; j++) {
            const x1 = X[i], y1 = Y[i], x2 = X[j], y2 = Y[j];
            let t0 = 0, t1 = 1;
            const dyy = y2 - y1;
            if (dyy > -1e-6 && dyy < 1e-6) { if (y1 < ty || y1 > bh) continue; }
            else {
              let ta = (ty - y1) / dyy, tb = (bh - y1) / dyy;
              if (ta > tb) { const q = ta; ta = tb; tb = q; }
              if (ta > t0) t0 = ta;
              if (tb < t1) t1 = tb;
              if (t0 > t1) continue;
            }
            const xa = x1 + (x2 - x1) * t0, xb = x1 + (x2 - x1) * t1;
            if (xa > maxX) maxX = xa;
            if (xb > maxX) maxX = xb;
          }
        }
      }
      const m = info.m;
      const mvx = G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12];
      const mw = Math.max(0.02, -(G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14]));
      res.maxX = maxX;
      res.mx = hw * (1 + P0 * mvx / mw);
      return res;
    }

    /* タッチボタンの右下のかたまり（av = {x0, y0}: CSS px、その右下がボタン）を銃がよける量。
       まず左へ（銃口が照準より左へ出ない範囲で）、それでもかかるなら下げる。
       銃・画面・av が変わったときだけ計算しなおす（ふだんは使い回し）。 */
    _vmAvoid(info, av) {
      if (!av || !(av.x0 > 0) || !(av.y0 > 0)) return NO_AVOID;
      const c = info.avoid || (info.avoid = { bw: -1, bh: -1, x0: -1, y0: -1, dx: 0, dy: 0 });
      const sc = this._bw / Math.max(1, this.width || this._bw);
      const x0 = Math.round(av.x0 * sc), y0 = Math.round(av.y0 * sc);
      if (c.bw === this._bw && c.bh === this._bh && c.x0 === x0 && c.y0 === y0) return c;
      c.bw = this._bw; c.bh = this._bh; c.x0 = x0; c.y0 = y0;
      const S = this._vmS, bw = this._bw;
      const margin = 0.03 * S;
      const tx = x0 - margin, ty = y0 - margin;
      const muzMin = bw * 0.5 + 0.06 * S;       // 銃口は照準より右に残す
      const res = this._vmM;
      const self = this;
      /* dy を決めたときに必要な dx（割線法）。{dx, clear} を返す */
      function solveDx(dy) {
        let a = 0, fa = self._vmMeasure(info, 0, dy, ty, res).maxX - tx;
        const ma = res.mx;
        if (fa <= 0) return { dx: 0, clear: true };
        let b = -0.03, fb = self._vmMeasure(info, b, dy, ty, res).maxX - tx;
        const mb = res.mx;
        /* 銃口が muzMin に来る dx（銃口の x は dx にほぼ比例） */
        const lim = Math.abs(mb - ma) > 1e-6 ? Math.min(0, (muzMin - ma) * (b - a) / (mb - ma)) : 0;
        for (let k = 0; k < 6 && Math.abs(fb) > 0.5; k++) {
          if (Math.abs(fb - fa) < 1e-6) break;
          let n = b - fb * (b - a) / (fb - fa);
          n = Math.max(-0.5, Math.min(0, n));
          a = b; fa = fb; b = n;
          fb = self._vmMeasure(info, b, dy, ty, res).maxX - tx;
        }
        const dx = Math.max(b, lim);
        const f = self._vmMeasure(info, dx, dy, ty, res).maxX - tx;
        return { dx: dx, clear: f <= 0.5 };
      }
      let r = solveDx(0);
      let dy = 0;
      if (!r.clear) {
        /* 下げる量を二分法で（見えなくなるほどは下げない） */
        const low = solveDx(VM_DROP_MAX);
        if (!low.clear) { r = low; dy = VM_DROP_MAX; }
        else {
          let lo = VM_DROP_MAX, hi = 0, best = low;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            const m = solveDx(mid);
            if (m.clear) { lo = mid; best = m; } else hi = mid;
          }
          r = best; dy = lo;
        }
      }
      c.dx = r.dx; c.dy = dy;
      return c;
    }

    /* 銃ローカル → ビュー空間の行列 */
    _vmPose(info, s, G) {
      const ads = clamp01(s.ads), nads = 1 - ads;
      this._vmProject(ads);
      const rec = clamp01(s.recoil);
      const t = this.time;
      const bob = s.bob;
      let bx = bob ? +bob[0] || 0 : 0, by = bob ? +bob[1] || 0 : 0;
      bx = Math.max(-0.06, Math.min(0.06, bx)); by = Math.max(-0.06, Math.min(0.06, by));
      const hipX = (info.m2 ? 0.03 : 0.2) * this._vmAspK;
      /* タッチボタンのかたまりをよける（腰だめのときだけ。ADS では中央へ） */
      const av = nads > 0 ? this._vmAvoid(info, s.avoid) : NO_AVOID;
      let px = (hipX + av.dx) * nads, py = -0.2 + av.dy * nads + 0.115 * ads, pz = -0.13 + 0.03 * ads;
      let yaw = (info.m2 ? 0 : 0.05) * nads, pitch = 0.015 * nads, roll = 0;
      // ゆらゆら
      px += Math.sin(t * 1.1) * 0.0025 * nads;
      py += Math.sin(t * 1.7) * 0.002 * nads;
      // 歩き揺れ
      const bk = 1 - 0.8 * ads;
      px += bx * bk; py += by * bk; roll -= bx * 1.2 * bk;
      // 反動
      pz += 0.055 * rec * (1 - 0.5 * ads);
      py += 0.012 * rec;
      pitch += 0.12 * rec * (1 - 0.6 * ads);
      // リロード：下げて傾ける
      const rl = s.reload;
      if (rl >= 0 && rl <= 1) {
        const k = Math.min(1, Math.sin(Math.PI * rl) * 1.6);
        py -= 0.17 * k; pz += 0.03 * k; px -= 0.03 * k;
        pitch -= 0.55 * k; roll += 0.65 * k;
      }
      // チャージ満タンで小さく震える
      const ch = clamp01(s.charge);
      if (ch > 0.95) { px += Math.sin(t * 91) * 0.0015; py += Math.sin(t * 83) * 0.0015; }
      return this._poseAim(G, info, px, py, pz, yaw, pitch, roll, this._vmPitch);
    }

    /* poseMatrix ＋「照準へ向ける」上向き aim。aim は銃口のまわりで回す
       （銃口の位置は動かさず、うしろ側が下がる → 見える大きさがほぼ変わらない） */
    _poseAim(G, info, px, py, pz, yaw, pitch, roll, aim) {
      poseMatrix(G, px, py, pz, yaw, pitch, roll, 1, info.ax, info.ay, info.maxZ);
      if (!(aim > 1e-6 || aim < -1e-6)) return G;
      const m = info.m;
      const x0 = G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12];
      const y0 = G[1] * m[0] + G[5] * m[1] + G[9] * m[2] + G[13];
      const z0 = G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14];
      poseMatrix(G, px, py, pz, yaw, pitch + aim, roll, 1, info.ax, info.ay, info.maxZ);
      G[12] += x0 - (G[0] * m[0] + G[4] * m[1] + G[8] * m[2] + G[12]);
      G[13] += y0 - (G[1] * m[0] + G[5] * m[1] + G[9] * m[2] + G[13]);
      G[14] += z0 - (G[2] * m[0] + G[6] * m[1] + G[10] * m[2] + G[14]);
      return G;
    }

    /* 銃の箱を G（銃ローカル→ワールド）で並べる */
    /* gs = 銃のスキン（CS.GunSkins の定義。null ならもとの色） */
    _drawGunBoxes(G, info, batch, alpha, hit, em0, charge, spin, sc, gs) {
      const view = info.view, tr = info.tracer, spinSet = info.spinSet;
      const hk = 0.8 * hit, ck = charge * 0.45;
      const em = Math.max(em0, charge * 0.6);
      const tint = gs && CS.GunSkins ? this._gsOut || (this._gsOut = [0, 0, 0, 0]) : null;
      for (let i = 0; i < view.length; i++) {
        const v = view[i];
        if (!v || v.length < 6) continue;
        let r = v.length > 8 ? v[6] : 0.3, g = v.length > 8 ? v[7] : 0.33, b = v.length > 8 ? v[8] : 0.4;
        let emi = em;
        if (tint) {
          CS.GunSkins.tint(gs, r, g, b, i, this.time, tint);
          r = tint[0]; g = tint[1]; b = tint[2];
          if (tint[3] > emi) emi = tint[3];
        }
        if (ck > 0) { r += (tr[0] - r) * ck; g += (tr[1] - g) * ck; b += (tr[2] - b) * ck; }
        if (hk > 0) { r += (1 - r) * hk; g += (1 - g) * hk; b += (1 - b) * hk; }
        const minDim = Math.min(v[3], v[4], v[5]) * sc;
        const fw = Math.min(0.007 * sc, minDim * 0.18);
        let spinThis = false;
        if (spin !== 0) spinThis = spinSet ? spinSet[i] === 1 : v[2] < info.midZ;
        if (spinThis) boxRotZ(this._B, G, v[0], v[1], v[2], v[3], v[4], v[5], info.spinX, info.spinY, spin);
        else boxInto(this._B, G, v[0], v[1], v[2], v[3], v[4], v[5]);
        this._emitLit(batch, this._B, r, g, b, alpha, emi, fw);
      }
    }

    _resolveGun(gun) {
      if (typeof gun === 'string') gun = CS.GunMap ? CS.GunMap[gun] : null;
      return gun && typeof gun === 'object' ? gun : DEFAULT_GUN;
    }

    _gunInfo(gun) {
      let info = this._gunCache.get(gun);
      if (info) return info;
      const view = Array.isArray(gun.view) && gun.view.length ? gun.view : DEFAULT_GUN.view;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const v of view) {
        if (!v || v.length < 6) continue;
        minX = Math.min(minX, v[0] - v[3] / 2); maxX = Math.max(maxX, v[0] + v[3] / 2);
        minY = Math.min(minY, v[1] - v[4] / 2); maxY = Math.max(maxY, v[1] + v[4] / 2);
        minZ = Math.min(minZ, v[2] - v[5] / 2); maxZ = Math.max(maxZ, v[2] + v[5] / 2);
      }
      if (!(maxX > minX)) { minX = -0.05; maxX = 0.05; minY = -0.05; maxY = 0.05; minZ = -0.4; maxZ = 0.1; }
      const mz = gun.muzzle && gun.muzzle.length >= 3 ? gun.muzzle : [(minX + maxX) / 2, (minY + maxY) / 2, minZ];
      const m2 = gun.muzzle2 && gun.muzzle2.length >= 3 ? gun.muzzle2 : null;
      let spinSet = null;
      if (Array.isArray(gun.viewSpin) && gun.viewSpin.length) {
        spinSet = new Uint8Array(view.length);
        for (const k of gun.viewSpin) if (k >= 0 && k < view.length) spinSet[k] = 1;
      }
      const tracer = gun.tracer && gun.tracer.length >= 3 ? gun.tracer : [1, 0.85, 0.5];
      info = {
        view, minX, maxX, minY, maxY, minZ, maxZ,
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, midZ: (minZ + maxZ) / 2,
        m: mz, m2,
        ax: m2 ? (mz[0] + m2[0]) / 2 : mz[0],
        ay: m2 ? (mz[1] + m2[1]) / 2 : mz[1],
        spin: !!(spinSet || gun.spinup > 0),
        spinSet,
        spinX: spinSet ? 0 : mz[0], spinY: spinSet ? 0 : mz[1],
        tracer
      };
      this._gunCache.set(gun, info);
      return info;
    }

    /* ---------- 頂点の書き出し ---------- */
    /* 照明つきの箱（36頂点） */
    _emitLit(batch, m, r, g, b, a, em, fw) {
      const m0 = m[0], m1 = m[1], m2 = m[2], m4 = m[4], m5 = m[5], m6 = m[6], m8 = m[8], m9 = m[9], m10 = m[10];
      // 面法線 = 隣の2列の外積（せん断にも正しい）
      let x0 = m5 * m10 - m6 * m9, y0 = m6 * m8 - m4 * m10, z0 = m4 * m9 - m5 * m8;   // c1×c2
      let x1 = m9 * m2 - m10 * m1, y1 = m10 * m0 - m8 * m2, z1 = m8 * m1 - m9 * m0;   // c2×c0
      let x2 = m1 * m6 - m2 * m5, y2 = m2 * m4 - m0 * m6, z2 = m0 * m5 - m1 * m4;     // c0×c1
      const det = m0 * x0 + m1 * y0 + m2 * z0;
      if (!(Math.abs(det) > 1e-12)) return;
      const o0 = batch.reserve(36);
      if (o0 < 0) return;
      const sg = det > 0 ? 1 : -1;
      let l = sg / (Math.hypot(x0, y0, z0) || 1); x0 *= l; y0 *= l; z0 *= l;
      l = sg / (Math.hypot(x1, y1, z1) || 1); x1 *= l; y1 *= l; z1 *= l;
      l = sg / (Math.hypot(x2, y2, z2) || 1); x2 *= l; y2 *= l; z2 *= l;
      const N = this._n;
      N[0] = x0; N[1] = y0; N[2] = z0; N[3] = x1; N[4] = y1; N[5] = z1; N[6] = x2; N[7] = y2; N[8] = z2;
      const S = this._sz, L = this._l;
      S[0] = Math.hypot(m0, m1, m2); S[1] = Math.hypot(m4, m5, m6); S[2] = Math.hypot(m8, m9, m10);
      const m12 = m[12], m13 = m[13], m14 = m[14];
      const P = det > 0 ? CUBE_POS : CUBE_POS_REV;
      const d = batch.data;
      let o = o0;
      for (let i = 0; i < 36; i++) {
        const lx = P[i * 3], ly = P[i * 3 + 1], lz = P[i * 3 + 2];
        const f = CUBE_FACE[i], ax = f >> 1, ns = (f & 1) ? -1 : 1;
        L[0] = lx; L[1] = ly; L[2] = lz;
        const ua = FACE_U[f], va = FACE_V[f];
        d[o] = m0 * lx + m4 * ly + m8 * lz + m12;
        d[o + 1] = m1 * lx + m5 * ly + m9 * lz + m13;
        d[o + 2] = m2 * lx + m6 * ly + m10 * lz + m14;
        d[o + 3] = N[ax * 3] * ns;
        d[o + 4] = N[ax * 3 + 1] * ns;
        d[o + 5] = N[ax * 3 + 2] * ns;
        d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a;
        d[o + 10] = L[ua] * S[ua];
        d[o + 11] = L[va] * S[va];
        d[o + 12] = S[ua] * 0.5;
        d[o + 13] = S[va] * 0.5;
        d[o + 14] = em;
        d[o + 15] = fw;
        o += LIT_STRIDE;
      }
    }

    /* 加算合成の箱（全面べた光り、36頂点） */
    _emitAddBox(batch, m, r, g, b, a) {
      const o0 = batch.reserve(36);
      if (o0 < 0) return;
      const d = batch.data;
      let o = o0;
      for (let i = 0; i < 36; i++) {
        const lx = CUBE_POS[i * 3], ly = CUBE_POS[i * 3 + 1], lz = CUBE_POS[i * 3 + 2];
        d[o] = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        d[o + 1] = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        d[o + 2] = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
        d[o + 7] = 0; d[o + 8] = 0;
        o += ADD_STRIDE;
      }
    }

    _addVert(d, o, x, y, z, r, g, b, a, u, v) {
      d[o] = x; d[o + 1] = y; d[o + 2] = z;
      d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
      d[o + 7] = u; d[o + 8] = v;
    }

    /* カメラを向いた四角（size = 一辺） */
    _quadInto(batch, x, y, z, size, r, g, b, a) {
      const o0 = batch.reserve(6);
      if (o0 < 0) return;
      const h = size * 0.5, R = this.camRight, U = this.camUp;
      const rx = R[0] * h, ry = R[1] * h, rz = R[2] * h, ux = U[0] * h, uy = U[1] * h, uz = U[2] * h;
      const d = batch.data, S = ADD_STRIDE;
      this._addVert(d, o0, x - rx - ux, y - ry - uy, z - rz - uz, r, g, b, a, -1, -1);
      this._addVert(d, o0 + S, x + rx - ux, y + ry - uy, z + rz - uz, r, g, b, a, 1, -1);
      this._addVert(d, o0 + S * 2, x + rx + ux, y + ry + uy, z + rz + uz, r, g, b, a, 1, 1);
      this._addVert(d, o0 + S * 3, x - rx - ux, y - ry - uy, z - rz - uz, r, g, b, a, -1, -1);
      this._addVert(d, o0 + S * 4, x + rx + ux, y + ry + uy, z + rz + uz, r, g, b, a, 1, 1);
      this._addVert(d, o0 + S * 5, x - rx + ux, y - ry + uy, z - rz + uz, r, g, b, a, -1, 1);
    }

    /* 帯（丸い端つき、18頂点） */
    _lineInto(batch, ax, ay, az, bx, by, bz, r, g, b, width, a) {
      let dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      const hw = width * 0.5;
      if (len < 1e-5) { this._quadInto(batch, ax, ay, az, width, r, g, b, a); return; }
      dx /= len; dy /= len; dz /= len;
      const cp = this.camPos, U = this.camUp;
      // 始点側の横方向
      let tx = cp[0] - ax, ty = cp[1] - ay, tz = cp[2] - az;
      let sax = dy * tz - dz * ty, say = dz * tx - dx * tz, saz = dx * ty - dy * tx;
      let sl = Math.hypot(sax, say, saz);
      if (sl < 1e-6) { sax = dy * U[2] - dz * U[1]; say = dz * U[0] - dx * U[2]; saz = dx * U[1] - dy * U[0]; sl = Math.hypot(sax, say, saz) || 1; }
      sax *= hw / sl; say *= hw / sl; saz *= hw / sl;
      // 終点側
      tx = cp[0] - bx; ty = cp[1] - by; tz = cp[2] - bz;
      let sbx = dy * tz - dz * ty, sby = dz * tx - dx * tz, sbz = dx * ty - dy * tx;
      sl = Math.hypot(sbx, sby, sbz);
      if (sl < 1e-6) { sbx = sax; sby = say; sbz = saz; sl = hw; }
      sbx *= hw / sl; sby *= hw / sl; sbz *= hw / sl;
      const ex = dx * hw, ey = dy * hw, ez = dz * hw;
      const o0 = batch.reserve(18);
      if (o0 < 0) return;
      const d = batch.data, S = ADD_STRIDE;
      const a0x = ax - ex, a0y = ay - ey, a0z = az - ez, b1x = bx + ex, b1y = by + ey, b1z = bz + ez;
      let o = o0;
      // 始点キャップ
      this._addVert(d, o, a0x - sax, a0y - say, a0z - saz, r, g, b, a, -1, -1); o += S;
      this._addVert(d, o, ax - sax, ay - say, az - saz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, ax + sax, ay + say, az + saz, r, g, b, a, 0, 1); o += S;
      this._addVert(d, o, a0x - sax, a0y - say, a0z - saz, r, g, b, a, -1, -1); o += S;
      this._addVert(d, o, ax + sax, ay + say, az + saz, r, g, b, a, 0, 1); o += S;
      this._addVert(d, o, a0x + sax, a0y + say, a0z + saz, r, g, b, a, -1, 1); o += S;
      // 本体
      this._addVert(d, o, ax - sax, ay - say, az - saz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, bx - sbx, by - sby, bz - sbz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, bx + sbx, by + sby, bz + sbz, r, g, b, a, 0, 1); o += S;
      this._addVert(d, o, ax - sax, ay - say, az - saz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, bx + sbx, by + sby, bz + sbz, r, g, b, a, 0, 1); o += S;
      this._addVert(d, o, ax + sax, ay + say, az + saz, r, g, b, a, 0, 1); o += S;
      // 終点キャップ
      this._addVert(d, o, bx - sbx, by - sby, bz - sbz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, b1x - sbx, b1y - sby, b1z - sbz, r, g, b, a, 1, -1); o += S;
      this._addVert(d, o, b1x + sbx, b1y + sby, b1z + sbz, r, g, b, a, 1, 1); o += S;
      this._addVert(d, o, bx - sbx, by - sby, bz - sbz, r, g, b, a, 0, -1); o += S;
      this._addVert(d, o, b1x + sbx, b1y + sby, b1z + sbz, r, g, b, a, 1, 1); o += S;
      this._addVert(d, o, bx + sbx, by + sby, bz + sbz, r, g, b, a, 0, 1);
    }

    /* マズルフラッシュ（光の玉＋星形の光条） */
    _flashInto(batch, x, y, z, f, tr, scale) {
      const cr = 1 + (tr[0] - 1) * 0.35, cg = 0.85 + (tr[1] - 0.85) * 0.5, cb = 0.55 + (tr[2] - 0.55) * 0.6;
      this._quadInto(batch, x, y, z, 0.34 * scale * (0.6 + 0.4 * f), cr, cg, cb, 0.75 * f);
      this._quadInto(batch, x, y, z, 0.12 * scale, 1, 0.97, 0.85, f);
      const R = this.camRight, U = this.camUp;
      const base = Math.floor(this.time * 24) * 2.39996;
      const len = 0.2 * scale * (0.5 + 0.5 * f);
      for (let i = 0; i < 3; i++) {
        const ang = base + i * 2.0944;
        const c = Math.cos(ang) * len, s = Math.sin(ang) * len;
        this._lineInto(batch, x, y, z, x + R[0] * c + U[0] * s, y + R[1] * c + U[1] * s, z + R[2] * c + U[2] * s,
          cr, cg, cb, 0.045 * scale, 0.8 * f);
      }
    }

    /* チャージの光 */
    _chargeInto(batch, x, y, z, ch, tr, scale) {
      const pulse = 1 + 0.12 * Math.sin(this.time * 48);
      this._quadInto(batch, x, y, z, (0.08 + 0.26 * ch) * scale * pulse, tr[0], tr[1], tr[2], 0.3 + 0.7 * ch);
      if (ch > 0.95) this._quadInto(batch, x, y, z, 0.12 * scale, 1, 1, 1, 0.8);
    }

    /* ---------- 描画 ---------- */
    _lightUniforms(P, vp) {
      const gl = this.gl, u = P.u;
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uCam, this.camPos);
      if (u.uSun !== undefined) {
        gl.uniform3fv(u.uSun, this._sun);
        gl.uniform3fv(u.uSunCol, this._sunCol);
        gl.uniform3fv(u.uAmbSky, this._ambSky);
        gl.uniform3fv(u.uAmbGnd, this._ambGnd);
      }
      gl.uniform1f(u.uFogNear, this._fogNear);
      gl.uniform1f(u.uFogFar, this._fogFar);
    }

    _drawLit(b) {
      const gl = this.gl;
      this._upload(b);
      const B = LIT_STRIDE * 4;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, B, 24);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, B, 40);
      gl.vertexAttribPointer(4, 2, gl.FLOAT, false, B, 56);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      this.stats.calls++;
      this.stats.verts += b.count;
    }

    _drawAdd(b) {
      const gl = this.gl;
      this._upload(b);
      const B = ADD_STRIDE * 4;
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, B, 12);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 28);
      gl.drawArrays(gl.TRIANGLES, 0, b.count);
      this.stats.calls++;
      this.stats.verts += b.count;
    }

    end() {
      const gl = this.gl;
      if (!this.ok || !gl || this.lost || gl.isContextLost()) return;
      const st = this.stats;

      // 1) ワールド（静的）
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      if (this.worldVBO && this.worldCount > 0) {
        const P = this.pWorld;
        gl.useProgram(P.p);
        this._lightUniforms(P, this.viewProj);
        gl.uniform1f(P.u.uTime, this.time % 3600);
        gl.uniform3fv(P.u.uSky, this._sky);
        gl.uniform3fv(P.u.uEdgeTint, this._edgeTint);
        gl.uniform1f(P.u.uEdge, 1);
        gl.uniform1f(P.u.uIce, clamp01(this.ice));          // v5.2: アイスフィールド
        gl.bindBuffer(gl.ARRAY_BUFFER, this.worldVBO);
        this._attribs(5);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, WORLD_STRIDE, 0);
        gl.vertexAttribPointer(1, 3, gl.BYTE, false, WORLD_STRIDE, 12);
        gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, WORLD_STRIDE, 16);
        gl.vertexAttribPointer(3, 1, gl.UNSIGNED_BYTE, true, WORLD_STRIDE, 15);
        gl.vertexAttribPointer(4, 2, gl.UNSIGNED_BYTE, false, WORLD_STRIDE, 20);
        gl.drawArrays(gl.TRIANGLES, 0, this.worldCount);
        st.calls++; st.world++; st.verts += this.worldCount;
      }

      // 2) 不透明な動的物体
      const lit = this.pLit;
      if (this.opaque.count > 0) {
        gl.useProgram(lit.p);
        this._lightUniforms(lit, this.viewProj);
        gl.uniform3fv(lit.u.uSky, this._sky);
        this._attribs(5);
        this._drawLit(this.opaque);
        st.opaque++;
      }

      // 3) 空（何も描かれていない所だけ）
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      {
        const P = this.pSky;
        gl.useProgram(P.p);
        gl.uniformMatrix4fv(P.u.uInvVP, false, this._invVP);
        gl.uniform3fv(P.u.uCam, this.camPos);
        gl.uniform1f(P.u.uRayScale, 1 / this._far);
        gl.uniform3fv(P.u.uSky, this._sky);
        gl.uniform3fv(P.u.uSkyTop, this._skyTop);
        gl.uniform3fv(P.u.uSun, this._sun);
        gl.uniform3fv(P.u.uSunCol, this._sunCol);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVBO);
        this._attribs(1);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        st.calls++; st.sky++;
      }

      // 4) 半透明
      gl.enable(gl.BLEND);
      if (this.transparent.count > 0) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(lit.p);
        this._lightUniforms(lit, this.viewProj);
        gl.uniform3fv(lit.u.uSky, this._sky);
        this._attribs(5);
        this._drawLit(this.transparent);
        st.transparent++;
      }

      // 5) 加算（弾道・粒子・光）
      const add = this.pAdd;
      if (this.additive.count > 0) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(add.p);
        this._lightUniforms(add, this.viewProj);
        this._attribs(3);
        this._drawAdd(this.additive);
        st.additive++;
      }

      // 6) ビューモデル（深度をクリアして別投影）
      if (this.vm.count > 0 || this.vmAdd.count > 0) {
        gl.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        if (this.vm.count > 0) {
          gl.disable(gl.BLEND);
          gl.enable(gl.CULL_FACE);
          gl.useProgram(lit.p);
          this._lightUniforms(lit, this._vmVP);
          gl.uniform3fv(lit.u.uSky, this._sky);
          this._attribs(5);
          this._drawLit(this.vm);
          st.vm++;
        }
        if (this.vmAdd.count > 0) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.disable(gl.CULL_FACE);
          gl.depthMask(false);
          gl.useProgram(add.p);
          this._lightUniforms(add, this._vmVP);
          this._attribs(3);
          this._drawAdd(this.vmAdd);
          st.vmAdd++;
        }
      }

      // 次のフレームのために戻す
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
    }

    /* 後片付け（任意） */
    dispose() {
      try {
        if (this.canvas && this._onLost) {
          this.canvas.removeEventListener('webglcontextlost', this._onLost, false);
          this.canvas.removeEventListener('webglcontextrestored', this._onRestored, false);
        }
        if (this._onResize) {
          window.removeEventListener('resize', this._onResize);
          window.removeEventListener('orientationchange', this._onResize);
          if (window.visualViewport) window.visualViewport.removeEventListener('resize', this._onResize);
        }
        if (this._ro) this._ro.disconnect();
      } catch (e) {}
      const gl = this.gl;
      if (gl && !this.lost) {
        for (const b of this._batches) if (b.vbo) gl.deleteBuffer(b.vbo);
        if (this.worldVBO) gl.deleteBuffer(this.worldVBO);
        if (this.skyVBO) gl.deleteBuffer(this.skyVBO);
      }
      this._resetGpu();
      this.ok = false;
    }
  }

  CS.Renderer = Renderer;
})();
