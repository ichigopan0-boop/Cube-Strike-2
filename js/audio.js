/* ==========================================================================
   CUBE STRIKE — audio.js
   WebAudio だけで作る効果音（音声ファイルなし）。
   CS.Audio.init() をユーザー操作の中で呼ぶまでは play()/loop() は何もしない。
   play(name, {pos, vol, rate}) … pos があれば距離減衰（4m まで最大 / 60m で無音）＋左右パン
   loop(key, name, on, {pos, vol, rate}) … beam / flame / spin / roll のループ音
     spin: rate = 回転の割合 0..1（高いほど音程が上がる）
     roll: rate = 速さ / 基本速度（0 で無音、1 前後が普通に転がる音）
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  const NAMES = [
    'shot_ar', 'shot_smg', 'shot_lmg', 'shot_minigun', 'shot_burst', 'shot_dmr', 'shot_sniper', 'shot_magnum',
    'shot_pistol', 'shot_shotgun', 'shot_double', 'shot_rocket', 'shot_grenade', 'shot_rail', 'charge',
    'shot_plasma', 'shot_bow', 'shot_needle', 'shot_ricochet', 'ricochet', 'beam', 'flame', 'spin',
    'reload', 'empty', 'hit', 'headshot', 'kill', 'hurt', 'death', 'jump', 'land', 'roll', 'slide', 'throw',
    'bounce', 'stick', 'explode', 'explode_small', 'smoke', 'spawn', 'click', 'ok', 'back', 'count',
    'go', 'win', 'lose', 'dance', 'chip', 'portal', 'place', 'break', 'notify',
    'shot_spmg', 'special', 'spready', 'bigjump'
  ];
  const LOOP_NAMES = ['beam', 'flame', 'spin', 'roll'];

  const MAX_VOICES = 24;
  const MAX_LOOPS = 12;
  const FULL_DIST = 4, SILENT_DIST = 60;
  const NOISE_SEC = 2;
  const MASTER = 0.9;

  let ctx = null, master = null, noise = null, hooked = false, volume = null;
  const voices = [];        // 再生中のワンショット
  const dying = [];         // 打ち切り中（あとで切断）
  const loops = new Map();  // key → ループ
  const last = {};          // 同じ音の連打まとめ用

  const A = CS.Audio = {
    names: NAMES,
    loopNames: LOOP_NAMES,
    listener: { pos: [0, 0, 0], yaw: 0 }
  };
  Object.defineProperty(A, 'ready', { get: () => !!(ctx && ctx.state === 'running') });

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fq = (f) => clamp(f, 20, 18000);

  /* ---------- 初期化 ---------- */
  A.init = function () {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        if (volume == null) volume = clamp(CS.Settings && typeof CS.Settings.vol === 'number' ? CS.Settings.vol : 0.8, 0, 1);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4;
        comp.attack.value = 0.003; comp.release.value = 0.18;
        master = ctx.createGain();
        master.gain.value = volume * MASTER;
        master.connect(comp);
        comp.connect(ctx.destination);
        makeNoise();
        unlock();
        hook();
      }
      resume();
      return true;
    } catch (e) {
      return false;
    }
  };

  A.setVolume = function (v) {
    volume = clamp(+v || 0, 0, 1);
    if (!ctx || !master) return;
    try { master.gain.setTargetAtTime(volume * MASTER, ctx.currentTime, 0.02); } catch (e) { master.gain.value = volume * MASTER; }
  };

  function resume() {
    try {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) {}
  }

  /* iOS 用：無音を1サンプル鳴らして解錠 */
  function unlock() {
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
      const s = ctx.createBufferSource();
      s.buffer = buf; s.connect(ctx.destination); s.start(0);
    } catch (e) {}
  }

  /* タブ切り替え・タップで復帰 */
  function hook() {
    if (hooked || typeof document === 'undefined') return;
    hooked = true;
    try {
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        try {
          if (document.hidden) { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); }
          else resume();
        } catch (e) {}
      });
      const g = () => { if (ctx && ctx.state !== 'running' && !document.hidden) resume(); };
      for (const ev of ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown']) {
        window.addEventListener(ev, g, { passive: true, capture: true });
      }
    } catch (e) {}
  }

  /* ノイズバッファを一度だけ作る（白・ピンク・ブラウン） */
  function makeNoise() {
    const sr = ctx.sampleRate || 44100, n = Math.floor(sr * NOISE_SEC);
    const w = ctx.createBuffer(1, n, sr), p = ctx.createBuffer(1, n, sr), br = ctx.createBuffer(1, n, sr);
    const dw = w.getChannelData(0), dp = p.getChannelData(0), db = br.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, lb = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1;
      dw[i] = x;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.96900 * b2 + x * 0.1538520;
      b3 = 0.86650 * b3 + x * 0.3104856; b4 = 0.55000 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.0168980;
      dp[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
      lb = (lb + 0.02 * x) / 1.02;
      db[i] = lb * 3.5;
    }
    noise = { w: w, p: p, b: br };
  }

  /* ---------- 位置 → 音量・パン ---------- */
  const SP = { g: 1, pan: 0, dist: 0 };
  function spatial(opts) {
    SP.g = 1; SP.pan = 0; SP.dist = 0;
    const pos = opts && opts.pos;
    if (!pos) return SP;
    const L = A.listener || {}, lp = L.pos || [0, 0, 0];
    const dx = pos[0] - lp[0], dy = pos[1] - lp[1], dz = pos[2] - lp[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    SP.dist = d;
    if (d >= SILENT_DIST) { SP.g = 0; return SP; }
    if (d > FULL_DIST) { const k = 1 - (d - FULL_DIST) / (SILENT_DIST - FULL_DIST); SP.g = k * k; }
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h > 0.3) {
      const yaw = L.yaw || 0;
      const side = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / h;   // 右方向との内積
      SP.pan = clamp(side * 0.8 * Math.min(1, h / 2), -1, 1);
    }
    return SP;
  }
  const distCut = (d) => fq(16000 * Math.pow(0.12, clamp((d - 8) / (SILENT_DIST - 8), 0, 1)));

  /* ---------- ワンショットの声 ---------- */
  function disconnect(v) {
    for (const n of v.chain) { try { n.disconnect(); } catch (e) {} }
  }
  function prune(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].end + 0.05 < now) { disconnect(voices[i]); voices.splice(i, 1); }
    }
    for (let i = dying.length - 1; i >= 0; i--) {
      if (dying[i].end < now) { disconnect(dying[i]); dying.splice(i, 1); }
    }
  }
  function kill(v) {
    const now = ctx.currentTime;
    try { v.out.gain.cancelScheduledValues(now); v.out.gain.setTargetAtTime(0, now, 0.012); } catch (e) {}
    for (const s of v.srcs) { try { s.stop(now + 0.07); } catch (e) {} }
    v.end = now + 0.12;
    dying.push(v);
  }
  function newVoice(opts, rate) {
    const sp = spatial(opts);
    const vol = (opts && typeof opts.vol === 'number' ? opts.vol : 1) * sp.g;
    if (vol < 0.003) return null;
    const now = ctx.currentTime;
    prune(now);
    while (voices.length >= MAX_VOICES) kill(voices.shift());
    const out = ctx.createGain();
    out.gain.value = vol;
    const chain = [out];
    let tail = out;
    if (sp.dist > 8) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = distCut(sp.dist);
      tail.connect(f); tail = f; chain.push(f);
    }
    if (sp.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = sp.pan;
      tail.connect(p); tail = p; chain.push(p);
    }
    tail.connect(master);
    const v = { out: out, chain: chain, srcs: [], t: now + 0.004, end: now + 0.05, r: rate };
    voices.push(v);
    return v;
  }

  /* 音量エンベロープ（立ち上がり → 指数で減衰） */
  function env(param, t, vol, att, dur) {
    if (att > dur * 0.9) att = dur * 0.9;
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0002, vol), t + att);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /* 発振器: 周波数 f0→f1 を dur 秒で */
  function tone(v, type, f0, f1, dur, vol, dl, att, lp) {
    const t = v.t + (dl || 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(fq(f0 * v.r), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(fq(f1 * v.r), t + dur);
    const g = ctx.createGain();
    env(g.gain, t, vol, att || 0.002, dur);
    o.connect(g);
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = fq(lp);
      g.connect(f); f.connect(v.out);
    } else {
      g.connect(v.out);
    }
    o.start(t);
    o.stop(t + dur + 0.03);
    v.srcs.push(o);
    if (t + dur + 0.03 > v.end) v.end = t + dur + 0.03;
  }

  /* ノイズ: kind 'w'|'p'|'b'、フィルター種類と周波数 f0→f1 */
  function nz(v, kind, dur, vol, dl, ftype, f0, f1, q, att) {
    const t = v.t + (dl || 0);
    const s = ctx.createBufferSource();
    s.buffer = noise[kind];
    const f = ctx.createBiquadFilter();
    f.type = ftype;
    f.Q.value = q || 0.7;
    f.frequency.setValueAtTime(fq(f0 * v.r), t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(fq(f1 * v.r), t + dur);
    const g = ctx.createGain();
    env(g.gain, t, vol, att || 0.002, dur);
    s.connect(f); f.connect(g); g.connect(v.out);
    const off = Math.random() * Math.max(0, NOISE_SEC - dur - 0.1);
    s.start(t, off, dur + 0.05);
    v.srcs.push(s);
    if (t + dur + 0.05 > v.end) v.end = t + dur + 0.05;
  }

  /* ---------- 効果音の中身 ---------- */
  const S = {
    shot_ar(v) {
      nz(v, 'w', 0.03, 0.35, 0, 'highpass', 4500, 3000);
      nz(v, 'p', 0.16, 0.75, 0, 'lowpass', 3800, 700, 0.9);
      tone(v, 'sine', 190, 55, 0.12, 0.6);
      tone(v, 'triangle', 420, 160, 0.05, 0.12);
    },
    shot_smg(v) {
      nz(v, 'w', 0.02, 0.25, 0, 'highpass', 5000, 3500);
      nz(v, 'p', 0.09, 0.55, 0, 'bandpass', 2600, 1200, 0.8);
      tone(v, 'sine', 240, 90, 0.07, 0.4);
    },
    shot_lmg(v) {
      nz(v, 'w', 0.03, 0.35, 0, 'highpass', 4000, 2800);
      nz(v, 'p', 0.20, 0.8, 0, 'lowpass', 2600, 450, 0.9);
      tone(v, 'sine', 150, 48, 0.15, 0.7);
      tone(v, 'triangle', 110, 60, 0.05, 0.12);
    },
    shot_minigun(v) {
      nz(v, 'w', 0.015, 0.15, 0, 'highpass', 5000, 4000);
      nz(v, 'p', 0.06, 0.45, 0, 'bandpass', 2000, 900, 0.9);
      tone(v, 'sine', 170, 80, 0.05, 0.3);
    },
    shot_burst(v) {
      nz(v, 'w', 0.025, 0.3, 0, 'highpass', 5500, 4000);
      nz(v, 'p', 0.11, 0.65, 0, 'lowpass', 4500, 1100, 1.2);
      tone(v, 'sine', 210, 70, 0.09, 0.5);
      tone(v, 'triangle', 900, 500, 0.04, 0.08);
    },
    shot_dmr(v) {
      nz(v, 'w', 0.04, 0.45, 0, 'highpass', 4000, 2500);
      nz(v, 'p', 0.28, 0.85, 0, 'lowpass', 4200, 500, 0.8);
      tone(v, 'sine', 130, 42, 0.20, 0.8);
      nz(v, 'b', 0.35, 0.25, 0.03, 'lowpass', 600, 200, 0.7, 0.02);
    },
    shot_sniper(v) {
      nz(v, 'w', 0.05, 0.55, 0, 'highpass', 3500, 2000);
      nz(v, 'p', 0.50, 1.0, 0, 'lowpass', 5200, 260, 0.8);
      tone(v, 'sine', 95, 28, 0.55, 1.0);
      tone(v, 'triangle', 210, 60, 0.18, 0.35);
      nz(v, 'b', 0.9, 0.45, 0.02, 'lowpass', 900, 120, 0.7, 0.03);
      nz(v, 'p', 0.45, 0.22, 0.14, 'bandpass', 1400, 600, 1.0, 0.02);   // こだま
      tone(v, 'sine', 1800, 1650, 0.25, 0.04, 0.01, 0.01);
    },
    shot_magnum(v) {
      nz(v, 'w', 0.04, 0.5, 0, 'highpass', 3800, 2400);
      nz(v, 'p', 0.32, 0.95, 0, 'lowpass', 3200, 380, 0.8);
      tone(v, 'sine', 115, 38, 0.28, 0.9);
      nz(v, 'p', 0.30, 0.18, 0.10, 'bandpass', 1100, 500, 1.0, 0.02);
    },
    shot_pistol(v) {
      nz(v, 'w', 0.02, 0.28, 0, 'highpass', 5000, 3500);
      nz(v, 'p', 0.08, 0.5, 0, 'bandpass', 3000, 1400, 0.8);
      tone(v, 'sine', 280, 110, 0.06, 0.35);
      tone(v, 'triangle', 1300, 900, 0.025, 0.06);
    },
    shot_shotgun(v) {
      nz(v, 'w', 0.05, 0.5, 0, 'highpass', 3000, 2000);
      nz(v, 'p', 0.38, 1.0, 0, 'lowpass', 2600, 280, 0.8);
      tone(v, 'sine', 105, 34, 0.28, 0.95);
      nz(v, 'b', 0.45, 0.35, 0.02, 'lowpass', 500, 120, 0.7, 0.02);
      // ポンプ「ガシャッ」
      nz(v, 'w', 0.04, 0.22, 0.38, 'bandpass', 1800, 1600, 3);
      tone(v, 'triangle', 600, 380, 0.04, 0.1, 0.38);
      nz(v, 'w', 0.05, 0.25, 0.50, 'bandpass', 1400, 1200, 3);
      tone(v, 'triangle', 520, 320, 0.05, 0.1, 0.50);
    },
    shot_double(v) {
      nz(v, 'w', 0.06, 0.55, 0, 'highpass', 2800, 1800);
      nz(v, 'p', 0.48, 1.0, 0, 'lowpass', 2300, 220, 0.8);
      tone(v, 'sine', 85, 28, 0.38, 1.0);
      nz(v, 'b', 0.6, 0.45, 0.02, 'lowpass', 450, 100, 0.7, 0.02);
    },
    shot_rocket(v) {
      tone(v, 'sine', 110, 50, 0.18, 0.7);
      nz(v, 'p', 0.06, 0.4, 0, 'lowpass', 2000, 600);
      nz(v, 'w', 0.55, 0.5, 0, 'bandpass', 500, 2400, 1.2, 0.03);
      nz(v, 'w', 0.45, 0.18, 0.05, 'highpass', 3000, 6000, 0.7, 0.05);
    },
    shot_grenade(v) {
      tone(v, 'sine', 320, 110, 0.13, 0.75);
      nz(v, 'p', 0.10, 0.35, 0, 'lowpass', 1500, 400);
      tone(v, 'triangle', 160, 90, 0.08, 0.3);
    },
    shot_rail(v) {
      tone(v, 'sawtooth', 2200, 90, 0.32, 0.22, 0, 0.002, 3000);
      tone(v, 'sine', 70, 28, 0.5, 1.0);
      nz(v, 'w', 0.30, 0.5, 0, 'highpass', 7000, 1800, 0.7, 0.003);
      nz(v, 'p', 0.50, 0.5, 0, 'lowpass', 3000, 200, 0.8);
      tone(v, 'square', 3200, 260, 0.12, 0.05, 0, 0.002, 5000);
      tone(v, 'sine', 1500, 1480, 0.6, 0.06, 0.02, 0.01);
      nz(v, 'b', 0.8, 0.35, 0.03, 'lowpass', 700, 100, 0.7, 0.04);
    },
    charge(v) {
      tone(v, 'sine', 180, 1400, 0.55, 0.3, 0, 0.45);
      tone(v, 'triangle', 360, 2800, 0.55, 0.08, 0, 0.45);
      nz(v, 'w', 0.5, 0.06, 0, 'bandpass', 800, 5000, 4, 0.4);
    },
    shot_plasma(v) {
      tone(v, 'sine', 1100, 240, 0.16, 0.45);
      tone(v, 'square', 550, 140, 0.10, 0.08, 0, 0.002, 2500);
      nz(v, 'w', 0.06, 0.25, 0, 'bandpass', 2400, 900, 1.5);
      tone(v, 'sine', 120, 60, 0.08, 0.3);
    },
    shot_bow(v) {
      tone(v, 'triangle', 190, 150, 0.22, 0.45);
      tone(v, 'triangle', 380, 300, 0.12, 0.12);
      nz(v, 'w', 0.07, 0.3, 0, 'bandpass', 1600, 3200, 1.5);
      tone(v, 'sine', 90, 60, 0.08, 0.35);
    },
    shot_needle(v) {
      tone(v, 'square', 1600, 2600, 0.05, 0.07, 0, 0.002, 4000);
      tone(v, 'sine', 2400, 1300, 0.07, 0.25);
      nz(v, 'w', 0.03, 0.15, 0, 'highpass', 5000, 4000);
    },
    shot_ricochet(v) {
      nz(v, 'w', 0.025, 0.35, 0, 'highpass', 5000, 3500);
      nz(v, 'p', 0.10, 0.55, 0, 'bandpass', 3000, 1300, 1.0);
      tone(v, 'sine', 230, 80, 0.08, 0.45);
      tone(v, 'triangle', 1500, 1000, 0.10, 0.12);
    },
    ricochet(v) {
      tone(v, 'sine', 2800, 1500, 0.22, 0.2, 0, 0.005);
      tone(v, 'triangle', 2100, 1400, 0.18, 0.1, 0.01);
      nz(v, 'w', 0.02, 0.2, 0, 'highpass', 4000, 3000);
    },
    beam(v) {   // ループ以外で鳴らされたとき用の短い版
      tone(v, 'sawtooth', 190, 170, 0.12, 0.12, 0, 0.005, 1500);
      tone(v, 'sine', 380, 360, 0.12, 0.2, 0, 0.005);
    },
    flame(v) {
      nz(v, 'b', 0.25, 0.5, 0, 'lowpass', 800, 500, 0.7, 0.02);
      nz(v, 'w', 0.2, 0.15, 0, 'bandpass', 1800, 1200, 0.8, 0.02);
    },
    spin(v) {
      tone(v, 'sawtooth', 90, 250, 0.4, 0.15, 0, 0.1, 900);
    },
    reload(v) {
      nz(v, 'w', 0.035, 0.35, 0, 'bandpass', 1800, 1700, 2.5);
      tone(v, 'triangle', 750, 420, 0.04, 0.2);
      nz(v, 'w', 0.04, 0.3, 0.16, 'bandpass', 2400, 2200, 2.5);
      tone(v, 'triangle', 520, 300, 0.05, 0.22, 0.16);
      nz(v, 'w', 0.05, 0.4, 0.42, 'bandpass', 1500, 1300, 2);
      tone(v, 'square', 1100, 700, 0.03, 0.06, 0.42, 0.002, 3000);
    },
    empty(v) {
      tone(v, 'square', 1300, 900, 0.03, 0.12, 0, 0.001, 4000);
      nz(v, 'w', 0.02, 0.15, 0, 'highpass', 3500, 3000);
    },
    hit(v) {
      tone(v, 'sine', 1650, 1400, 0.07, 0.45);
      tone(v, 'triangle', 3300, 3000, 0.03, 0.08);
      nz(v, 'w', 0.015, 0.1, 0, 'highpass', 6000, 5000);
    },
    headshot(v) {
      tone(v, 'sine', 2300, 2100, 0.16, 0.45);
      tone(v, 'sine', 3450, 3300, 0.12, 0.18);
      nz(v, 'w', 0.03, 0.2, 0, 'bandpass', 4500, 4000, 2);
      tone(v, 'sine', 1200, 900, 0.06, 0.25);
    },
    kill(v) {
      tone(v, 'triangle', 660, 660, 0.09, 0.35);
      tone(v, 'triangle', 990, 990, 0.09, 0.35, 0.07);
      tone(v, 'sine', 1320, 1320, 0.30, 0.4, 0.14);
      tone(v, 'sine', 1980, 1980, 0.25, 0.12, 0.14);
      tone(v, 'sine', 110, 55, 0.20, 0.45);
    },
    hurt(v) {
      tone(v, 'sine', 170, 70, 0.16, 0.7);
      nz(v, 'p', 0.10, 0.45, 0, 'lowpass', 900, 300);
      tone(v, 'triangle', 300, 140, 0.08, 0.15);
    },
    death(v) {
      tone(v, 'sawtooth', 420, 55, 0.7, 0.3, 0, 0.005, 1400);
      tone(v, 'sine', 200, 40, 0.6, 0.5);
      nz(v, 'b', 0.5, 0.5, 0, 'lowpass', 900, 150);
    },
    jump(v) {
      tone(v, 'sine', 240, 520, 0.11, 0.3, 0, 0.01);
      nz(v, 'w', 0.06, 0.1, 0, 'bandpass', 900, 2000, 1);
    },
    /* v5.4: 大ジャンプ（ぐーんと 上がる 音） */
    bigjump(v) {
      tone(v, 'sine', 220, 900, 0.34, 0.32, 0, 0.01);
      tone(v, 'triangle', 440, 1400, 0.26, 0.10, 0.03, 0.01);
      nz(v, 'w', 0.4, 0.22, 0, 'bandpass', 600, 3200, 1.2, 0.02);
    },
    land(v) {
      nz(v, 'b', 0.10, 0.5, 0, 'lowpass', 600, 150);
      tone(v, 'sine', 130, 55, 0.10, 0.5);
    },
    roll(v) {
      nz(v, 'b', 0.2, 0.4, 0, 'lowpass', 300, 150, 0.7, 0.03);
    },
    slide(v) {
      nz(v, 'w', 0.5, 0.3, 0, 'bandpass', 2600, 800, 1.2, 0.02);
      nz(v, 'b', 0.35, 0.35, 0, 'lowpass', 520, 170, 0.7, 0.01);
    },
    throw(v) {
      nz(v, 'w', 0.18, 0.4, 0, 'bandpass', 700, 2600, 1.4, 0.04);
      tone(v, 'sine', 300, 180, 0.05, 0.1);
    },
    bounce(v) {
      tone(v, 'sine', 330, 190, 0.06, 0.4);
      nz(v, 'w', 0.025, 0.2, 0, 'bandpass', 1600, 1400, 2);
    },
    stick(v) {
      tone(v, 'sine', 200, 85, 0.12, 0.5);
      nz(v, 'p', 0.14, 0.4, 0, 'lowpass', 700, 200);
      tone(v, 'square', 95, 70, 0.05, 0.08, 0, 0.002, 800);
      tone(v, 'sine', 900, 1300, 0.05, 0.1, 0.06);
    },
    explode(v) {
      nz(v, 'w', 0.06, 0.6, 0, 'highpass', 2500, 1500);
      nz(v, 'p', 1.0, 1.0, 0, 'lowpass', 2000, 140, 0.8, 0.004);
      tone(v, 'sine', 85, 26, 0.85, 1.0, 0, 0.004);
      tone(v, 'triangle', 55, 30, 0.5, 0.35);
      nz(v, 'b', 1.4, 0.7, 0.03, 'lowpass', 260, 60, 0.7, 0.05);
    },
    explode_small(v) {
      nz(v, 'w', 0.04, 0.4, 0, 'highpass', 3000, 2000);
      nz(v, 'p', 0.40, 0.75, 0, 'lowpass', 2600, 260, 0.8);
      tone(v, 'sine', 150, 45, 0.32, 0.7);
    },
    smoke(v) {
      nz(v, 'p', 0.05, 0.4, 0, 'lowpass', 1500, 1000);
      tone(v, 'sine', 180, 90, 0.07, 0.4);
      nz(v, 'w', 1.3, 0.35, 0.03, 'bandpass', 2600, 1200, 0.7, 0.08);
      nz(v, 'b', 1.0, 0.3, 0.03, 'lowpass', 500, 200, 0.7, 0.1);
    },
    spawn(v) {
      tone(v, 'sine', 523, 523, 0.18, 0.3);
      tone(v, 'sine', 784, 784, 0.18, 0.3, 0.06);
      tone(v, 'sine', 1047, 1047, 0.28, 0.3, 0.12);
      tone(v, 'triangle', 2093, 2093, 0.30, 0.06, 0.12);
      nz(v, 'w', 0.4, 0.08, 0, 'highpass', 6000, 8000, 0.7, 0.1);
    },
    click(v) {
      tone(v, 'triangle', 1800, 1300, 0.03, 0.25);
    },
    ok(v) {
      tone(v, 'sine', 880, 880, 0.09, 0.3);
      tone(v, 'sine', 1320, 1320, 0.14, 0.3, 0.07);
    },
    back(v) {
      tone(v, 'sine', 700, 460, 0.12, 0.3);
    },
    count(v) {
      tone(v, 'square', 880, 880, 0.16, 0.12, 0, 0.003, 2500);
      tone(v, 'sine', 880, 880, 0.18, 0.3);
    },
    go(v) {
      tone(v, 'square', 1320, 1320, 0.40, 0.12, 0, 0.003, 3000);
      tone(v, 'sine', 660, 660, 0.45, 0.35);
      tone(v, 'sine', 1320, 1320, 0.40, 0.25);
      tone(v, 'sine', 1760, 1760, 0.30, 0.1, 0.05);
    },
    win(v) {
      const n = [523, 659, 784, 1047];
      for (let i = 0; i < 4; i++) {
        const d = i === 3 ? 0.7 : 0.16;
        tone(v, 'sine', n[i], n[i], d, 0.32, i * 0.11);
        tone(v, 'triangle', n[i] * 2, n[i] * 2, d * 0.8, 0.06, i * 0.11);
      }
      tone(v, 'sine', 523, 523, 0.7, 0.18, 0.33);
    },
    lose(v) {
      const n = [494, 440, 392, 311];
      for (let i = 0; i < 4; i++) {
        tone(v, 'triangle', n[i], i === 3 ? n[i] * 0.97 : n[i], i === 3 ? 0.7 : 0.2, 0.35, i * 0.16, 0.005, 1800);
      }
    },
    /* 勝ったチームのダンス（120BPM・5秒）: ドラム＋ベース＋メロディ＋さいごの和音 */
    dance(v) {
      const E8 = 0.25;
      for (let b = 0; b < 10; b++) {
        const t = b * 0.5;
        tone(v, 'sine', 150, 45, 0.14, 0.55, t);                              // キック
        nz(v, 'w', 0.04, 0.12, t + E8, 'highpass', 7000, 6000);               // ハイハット
        if (b % 2 === 1) nz(v, 'p', 0.12, 0.28, t, 'bandpass', 1800, 1400, 1.2); // クラップ
      }
      /* ベース（8分）: C F G C | G C */
      const R = [65.4, 87.3, 98.0, 65.4, 98.0];
      for (let bar = 0; bar < 5; bar++) {
        for (let k = 0; k < 4; k++) {
          if (bar === 4 && k >= 2) break;
          const f = R[bar] * (k % 2 ? 2 : 1);
          tone(v, 'triangle', f, f, 0.2, 0.32, bar + k * E8, 0.004, 900);
        }
      }
      tone(v, 'triangle', 130.8, 130.8, 0.7, 0.34, 4.5, 0.004, 900);
      /* メロディ */
      const M = [659.3, 784, 1046.5, 784, 880, 1046.5, 880, 698.5, 784, 987.8, 1174.7, 987.8, 1046.5, 1318.5, 1568, 1318.5, 1174.7, 987.8];
      for (let i = 0; i < M.length; i++) {
        tone(v, 'square', M[i], M[i], 0.2, 0.09, i * E8, 0.004, 3200);
        tone(v, 'sine', M[i], M[i], 0.22, 0.12, i * E8);
      }
      const C = [523.3, 659.3, 784, 1046.5];
      for (let i = 0; i < C.length; i++) {
        tone(v, 'sine', C[i], C[i], 0.75, 0.16, 4.5 + i * 0.02, 0.01);
        tone(v, 'triangle', C[i] * 2, C[i] * 2, 0.6, 0.03, 4.5 + i * 0.02, 0.01);
      }
      nz(v, 'w', 0.9, 0.12, 4.5, 'highpass', 6000, 9000, 0.7, 0.02);          // シャーン
    },
    /* 塔のぼり: チップをとった */
    chip(v) {
      const n = [784, 988, 1175, 1568];
      for (let i = 0; i < n.length; i++) tone(v, 'sine', n[i], n[i], 0.16, 0.26, i * 0.06, 0.004);
      tone(v, 'triangle', 3136, 3136, 0.3, 0.05, 0.18, 0.01);
    },
    /* 塔のぼり: 光の柱があらわれた */
    portal(v) {
      tone(v, 'sine', 220, 880, 0.9, 0.28, 0, 0.3);
      tone(v, 'triangle', 330, 1320, 0.9, 0.08, 0.05, 0.3);
      nz(v, 'w', 1.1, 0.12, 0, 'bandpass', 800, 5000, 3, 0.4);
    },
    /* マップエディター: ブロックを おく / こわす */
    place(v) {
      tone(v, 'sine', 240, 150, 0.08, 0.4);
      nz(v, 'b', 0.08, 0.35, 0, 'lowpass', 900, 300);
    },
    break(v) {
      nz(v, 'p', 0.14, 0.45, 0, 'bandpass', 1500, 500, 1.1);
      tone(v, 'triangle', 420, 160, 0.09, 0.2);
    },
    /* フレンド: おしらせ */
    notify(v) {
      tone(v, 'sine', 1175, 1175, 0.1, 0.25);
      tone(v, 'sine', 1568, 1568, 0.18, 0.25, 0.09);
    },
    /* 必殺技: スナイパーマシンガンの 1発（するどく 高い音。れんしゃでも うるさくない） */
    shot_spmg(v) {
      nz(v, 'w', 0.03, 0.4, 0, 'highpass', 5200, 3600);
      nz(v, 'p', 0.12, 0.6, 0, 'bandpass', 3400, 1500, 1.1);
      tone(v, 'sine', 260, 95, 0.08, 0.45);
      tone(v, 'triangle', 1900, 1500, 0.05, 0.06);
    },
    /* 必殺技を つかった（ジャーン！） */
    special(v) {
      const n = [523.3, 659.3, 784, 1046.5, 1318.5];
      for (let i = 0; i < n.length; i++) {
        tone(v, 'square', n[i], n[i], 0.14, 0.07, i * 0.05, 0.004, 3600);
        tone(v, 'sine', n[i], n[i], 0.3, 0.16, i * 0.05);
      }
      tone(v, 'sine', 110, 55, 0.5, 0.5, 0, 0.01);
      nz(v, 'w', 0.7, 0.14, 0.05, 'bandpass', 1200, 7000, 2, 0.05);
    },
    /* 必殺技の ゲージが たまった（キラーン） */
    spready(v) {
      tone(v, 'sine', 1568, 1568, 0.12, 0.2);
      tone(v, 'sine', 2093, 2093, 0.2, 0.22, 0.08);
      tone(v, 'triangle', 3136, 3136, 0.3, 0.05, 0.14, 0.01);
    }
  };

  /* 撃つたびに音程を少し揺らす音 */
  const VARY = {};
  for (const k of NAMES) if (k.indexOf('shot_') === 0) VARY[k] = 1;
  VARY.hit = VARY.bounce = VARY.land = VARY.ricochet = VARY.explode = VARY.explode_small = VARY.hurt = 1;

  /* ---------- ワンショット再生 ---------- */
  A.play = function (name, opts) {
    if (!ctx || !noise || !master || ctx.state !== 'running' || !volume) return;
    const fn = S[name];
    if (!fn) return;
    try {
      const now = ctx.currentTime;
      const pos = opts && opts.pos;
      let lp = last[name];
      if (lp && now - lp.t < 0.012 &&
          (!pos || !lp.has || Math.abs(pos[0] - lp.x) + Math.abs(pos[1] - lp.y) + Math.abs(pos[2] - lp.z) < 1)) return;
      if (!lp) lp = last[name] = { t: 0, has: false, x: 0, y: 0, z: 0 };
      lp.t = now; lp.has = !!pos;
      if (pos) { lp.x = pos[0]; lp.y = pos[1]; lp.z = pos[2]; }
      let rate = opts && opts.rate > 0 ? opts.rate : 1;
      if (VARY[name]) rate *= 0.96 + Math.random() * 0.08;
      const v = newVoice(opts, rate);
      if (!v) return;
      fn(v);
      if (name === 'dance') danceVoice = v;
    } catch (e) {}
  };

  /* ダンスの音楽をスキップで止める */
  let danceVoice = null;
  A.stopDance = function () {
    const v = danceVoice;
    danceVoice = null;
    if (!v || !ctx) return;
    try { kill(v); } catch (e) {}
  };

  /* ---------- ループ音 ---------- */
  function loopNoise(L, kind) {
    const s = ctx.createBufferSource();
    s.buffer = noise[kind]; s.loop = true;
    s.start(ctx.currentTime, Math.random() * NOISE_SEC);
    L.srcs.push(s);
    return s;
  }
  function loopOsc(L, type, f) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = fq(f);
    o.start(ctx.currentTime);
    L.srcs.push(o);
    return o;
  }
  function gainNode(L, g) { const n = ctx.createGain(); n.gain.value = g; L.nodes.push(n); return n; }
  function filterNode(L, type, f, q) {
    const n = ctx.createBiquadFilter();
    n.type = type; n.frequency.value = fq(f); n.Q.value = q || 0.7;
    L.nodes.push(n); return n;
  }
  /* LFO で gain をゆらす（base ± depth） */
  function tremolo(L, base, rate, depth) {
    const trem = gainNode(L, base);
    const lfo = loopOsc(L, 'sine', rate);
    const lg = gainNode(L, depth);
    lfo.connect(lg); lg.connect(trem.gain);
    return { trem: trem, lfo: lfo };
  }
  const setT = (param, v, tc) => { try { param.setTargetAtTime(v, ctx.currentTime, tc || 0.05); } catch (e) { param.value = v; } };

  /* 各ループの組み立て。戻り値 update(rate) → 音量倍率 */
  const LOOPS = {
    beam(L) {
      const t = tremolo(L, 0.75, 24, 0.22);
      const f = filterNode(L, 'lowpass', 1500, 3);
      const o1 = loopOsc(L, 'sawtooth', 180), o2 = loopOsc(L, 'sine', 362);
      const g1 = gainNode(L, 0.22), g2 = gainNode(L, 0.55);
      o1.connect(g1); g1.connect(f); o2.connect(g2); g2.connect(f);
      f.connect(t.trem);
      const n = loopNoise(L, 'w'), nf = filterNode(L, 'bandpass', 3000, 1), ng = gainNode(L, 0.1);
      n.connect(nf); nf.connect(ng); ng.connect(t.trem);
      t.trem.connect(L.in);
      return (r) => {
        const k = clamp(r, 0.25, 3);
        setT(o1.frequency, 180 * k); setT(o2.frequency, 362 * k); setT(f.frequency, fq(1500 * k));
        return 1;
      };
    },
    flame(L) {
      const t = tremolo(L, 0.8, 9, 0.22);
      const s1 = loopNoise(L, 'b'), f1 = filterNode(L, 'lowpass', 700, 0.7), g1 = gainNode(L, 1.1);
      s1.connect(f1); f1.connect(g1); g1.connect(t.trem);
      const s2 = loopNoise(L, 'w'), f2 = filterNode(L, 'bandpass', 1800, 0.8), g2 = gainNode(L, 0.22);
      s2.connect(f2); f2.connect(g2); g2.connect(t.trem);
      const c = tremolo(L, 0.08, 17, 0.07);   // パチパチ
      const s3 = loopNoise(L, 'p'), f3 = filterNode(L, 'highpass', 4000, 0.7);
      s3.connect(f3); f3.connect(c.trem); c.trem.connect(L.in);
      t.trem.connect(L.in);
      return (r) => {
        const k = clamp(r, 0.25, 3);
        setT(f1.frequency, fq(700 * k)); setT(f2.frequency, fq(1800 * k));
        return 1;
      };
    },
    spin(L) {
      const o1 = loopOsc(L, 'sawtooth', 60), f = filterNode(L, 'lowpass', 900, 2), g1 = gainNode(L, 0.3);
      o1.connect(f); f.connect(g1);
      const o2 = loopOsc(L, 'triangle', 121), g2 = gainNode(L, 0.15);
      o2.connect(g2);
      const n = loopNoise(L, 'p'), nf = filterNode(L, 'bandpass', 600, 2), ng = gainNode(L, 0.3);
      n.connect(nf); nf.connect(ng);
      const mix = gainNode(L, 1);
      g1.connect(mix); g2.connect(mix); ng.connect(mix); mix.connect(L.in);
      return (r) => {
        const k = clamp(r, 0, 1.5), fr = 45 + 210 * k;
        setT(o1.frequency, fr, 0.04); setT(o2.frequency, fr * 2.02, 0.04);
        setT(nf.frequency, fq(fr * 6), 0.04); setT(f.frequency, fq(500 + 900 * k), 0.04);
        return 0.25 + 0.75 * Math.min(1, k);
      };
    },
    roll(L) {
      const t = tremolo(L, 0.6, 5.8, 0.4);
      const s = loopNoise(L, 'b'), f = filterNode(L, 'lowpass', 240, 0.7), g = gainNode(L, 1.2);
      s.connect(f); f.connect(g); g.connect(t.trem);
      const s2 = loopNoise(L, 'p'), f2 = filterNode(L, 'bandpass', 350, 1.5), g2 = gainNode(L, 0.1);
      s2.connect(f2); f2.connect(g2); g2.connect(t.trem);
      t.trem.connect(L.in);
      return (r) => {
        const k = clamp(r, 0, 1.5);
        setT(f.frequency, fq(140 + 200 * k), 0.08);
        setT(t.lfo.frequency, Math.max(0.5, 5.8 * k), 0.08);   // 面が床をたたく間隔
        return Math.min(1, k);
      };
    }
  };

  function startLoop(name) {
    const L = { name: name, srcs: [], nodes: [], upd: null };
    L.in = gainNode(L, 1);
    L.out = gainNode(L, 0.0001);
    L.lp = filterNode(L, 'lowpass', 18000, 0.7);
    L.in.connect(L.out); L.out.connect(L.lp);
    let tail = L.lp;
    if (typeof ctx.createStereoPanner === 'function') {
      L.pan = ctx.createStereoPanner(); L.nodes.push(L.pan);
      tail.connect(L.pan); tail = L.pan;
    }
    tail.connect(master);
    L.upd = LOOPS[name](L);
    return L;
  }
  function updateLoop(L, opts) {
    const rate = opts && typeof opts.rate === 'number' ? opts.rate : 1;
    const mul = L.upd(rate);
    const sp = spatial(opts);
    const vol = (opts && typeof opts.vol === 'number' ? opts.vol : 1) * sp.g * mul;
    setT(L.out.gain, Math.max(0.0001, vol * 0.6), 0.04);
    setT(L.lp.frequency, sp.dist > 8 ? distCut(sp.dist) : 18000, 0.05);
    if (L.pan) setT(L.pan.pan, sp.pan, 0.03);
  }
  function stopLoop(key, L) {
    loops.delete(key);
    const now = ctx.currentTime;
    try { L.out.gain.cancelScheduledValues(now); L.out.gain.setTargetAtTime(0, now, 0.03); } catch (e) {}
    for (const s of L.srcs) { try { s.stop(now + 0.25); } catch (e) {} }
    const done = () => {
      for (const s of L.srcs) { try { s.disconnect(); } catch (e) {} }
      for (const n of L.nodes) { try { n.disconnect(); } catch (e) {} }
    };
    if (typeof setTimeout === 'function') setTimeout(done, 400); else done();
  }

  A.loop = function (key, name, on, opts) {
    if (!ctx || !noise || !master) return;
    try {
      let L = loops.get(key);
      if (!on) { if (L) stopLoop(key, L); return; }
      if (L && L.name !== name) { stopLoop(key, L); L = null; }
      if (!L) {
        if (!LOOPS[name] || loops.size >= MAX_LOOPS) return;
        L = startLoop(name);
        loops.set(key, L);
      }
      updateLoop(L, opts);
    } catch (e) {}
  };

  /* デバッグ用：いま鳴っている数 */
  A.stats = () => ({ voices: voices.length, dying: dying.length, loops: loops.size, state: ctx ? ctx.state : 'none' });

  /* すべてのループを止める（試合終了・退出時） */
  A.stopAll = function () {
    if (!ctx) return;
    try { for (const [k, L] of Array.from(loops)) stopLoop(k, L); } catch (e) {}
  };
})();
