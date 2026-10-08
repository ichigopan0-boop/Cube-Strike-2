/* ==========================================================================
   CUBE STRIKE — core.js
   名前空間・ルール定数・数学（ベクトル/行列/クォータニオン）・設定の保存
   座標系: 右手系・Y が上・単位はメートル。yaw=0 で -Z を向き、yaw が増えると左へ回る。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  CS.VERSION = 5;           // v5.1: 銃2つ・コピーの いれもの（プレイヤーの ばんごうが かわる）・トーナメント（v4 とはつながらない）

  /* ---------- ルール ---------- */
  CS.RULES = {
    killsToWin: 10,      // 相手チームを合計10回倒したら勝ち（キルバトルの基本）
    hp: 100,
    respawn: 3.0,        // 復活までの秒数
    spawnProtect: 5.0,   // 復活直後（と試合開始時）の無敵秒数。撃つかボムを投げると解除（リスキル予防）
    regenDelay: 5.0,     // 最後に被弾してから回復が始まるまで
    regenRate: 25,       // 毎秒の回復量
    timeLimit: 480       // 秒。時間切れで同点なら次のキルで決着
  };

  /* ---------- しあいのルール（v3） ----------
     n = ルールごとの数（キル数・秒・のこり回数・カウント）。time = 時間切れまでの秒（null なら n 秒）。
     kills : 先に n キルしたチームの勝ち（10キルがこれまでのルール）
     time  : n 秒のあいだに たくさん倒したチームの勝ち（同点ならサドンデス）
     stock : ひとり n 回まで。全員いなくなったチームの負け
     area  : まんなかのエリアを ひとりじめ しているあいだカウントが進む。先に n で勝ち */
  CS.RULESETS = {
    kills: { id: 'kills', name: 'キルバトル', desc: '先に きめた数だけ 倒したチームの勝ち', opts: [5, 10, 20], def: 10, time: 480 },
    time: { id: 'time', name: 'タイムバトル', desc: '時間内に たくさん倒したチームの勝ち', opts: [120, 180, 300], def: 180, time: null },
    stock: { id: 'stock', name: 'ストック', desc: 'ひとり のこり回数まで。全員いなくなったチームの負け', opts: [1, 3, 5], def: 3, time: 300 },
    area: { id: 'area', name: 'エリア', desc: 'まんなかのエリアを とっているあいだ カウントが進む', opts: [30, 60, 100], def: 60, time: 300 },
    /* v5: キングバトル。チームに 1人ずつ キング（n = キングの HP）。あいての キングを たおしたら 勝ち。
       時間ぎれ（5分）は キングの のこり HP の わりあいが 多いほうの 勝ち（おなじなら 次に キングを たおしたほう） */
    king: { id: 'king', name: 'キングバトル', desc: 'チームに 1人ずつ キング。あいての キングを たおしたら 勝ち！ じぶんの キングを まもろう', opts: [150, 200, 300], def: 200, time: 300 }
  };
  CS.RULE_IDS = ['kills', 'time', 'stock', 'area', 'king'];
  /* {id, n} を正しい形に（こわれていたらキルバトル10） */
  CS.cleanRule = function (id, n) {
    if (id && typeof id === 'object') { n = id.n; id = id.id; }
    const R = CS.RULESETS[id] || CS.RULESETS.kills;
    n = Math.round(+n);
    if (R.opts.indexOf(n) < 0) n = R.def;
    return { id: R.id, n: n };
  };
  /* ルールの短い説明（「10キル」「3分」「のこり3」「60カウント」） */
  CS.ruleLabel = function (rule) {
    const r = CS.cleanRule(rule);
    if (r.id === 'time') return (r.n % 60 ? (r.n / 60).toFixed(1) : r.n / 60) + '分';
    if (r.id === 'stock') return 'のこり' + r.n;
    if (r.id === 'area') return r.n + 'カウント';
    if (r.id === 'king') return 'キングHP' + r.n;
    return r.n + 'キル';
  };
  CS.ruleTime = function (rule) {
    const r = CS.cleanRule(rule), R = CS.RULESETS[r.id];
    return R.time == null ? r.n : R.time;
  };

  /* ---------- プレイヤー（ブロック） ----------
     プレイヤーはちょうど1ブロック。half は当たり判定（体と被弾）の半分の大きさで、
     1ブロックのすき間やトンネルをぎりぎり通れる。見た目は size×0.98 で描く。 */
  CS.PLAYER = {
    size: 1.0, half: 0.48,  // 立方体の一辺（見た目）と当たり判定の半分
    eye: 0.3,               // 中心から目の高さ
    speed: 5.2,             // m/s（武器の move 倍率がかかる）
    jump: 7.4,              // 初速 m/s（頂点 約1.37m: 1ブロックはのぼれる、2ブロックは無理）
    gravity: 20,
    /* v5.4 大ジャンプ: ジャンプして 上がっている あいだ（win 秒）に もう一回 おすと、とんだ 場所から h m 上まで とぶ
       （足が 6ブロックの かべの 上に とどく）。つかったら cd 秒 まつ */
    bigJump: { h: 6.3, win: 0.45, cd: 4 },
    accel: 40, airAccel: 12, friction: 10,
    stepUp: 0,              // ふだんは段差にのぼらない。オートジャンプがオンのときだけ game が1段ぶん渡す
    headZone: 0.16,         // 中心より 0.16m 上から上がヘッドショット判定
    /* スライディング: 速度 = max(今, 1.8×走る速さ)、低い摩擦で最大0.8秒、
       曲がりにくさ35%、目線が0.35m下がる、終わってから0.9秒は出せない、被弾の箱は高さ0.55 */
    slide: { speedMult: 1.8, dur: 0.8, friction: 2.0, steer: 0.35, cooldown: 0.9, eyeDrop: 0.35, hurtHeight: 0.55 }
  };

  CS.VOXEL = 1.0;           // 1ボクセル = 1m（プレイヤーと同じ大きさ）

  CS.TEAM_COLORS = [[1.0, 0.30, 0.37], [0.24, 0.64, 1.0]];
  CS.TEAM_CSS = ['#ff4d5e', '#3da2ff'];
  CS.TEAM_NAMES = ['あか', 'あお'];

  /* ---------- 小物 ---------- */
  CS.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  CS.lerp = (a, b, t) => a + (b - a) * t;
  CS.now = () => performance.now();
  CS.$ = (id) => document.getElementById(id);
  CS.wrapAngle = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
  CS.isTouch = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  CS.query = (k) => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };

  /* 再現できる乱数（mulberry32） */
  CS.rng = function (seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* 小さなイベント発行器 */
  CS.Emitter = class {
    constructor() { this._h = {}; }
    on(n, f) { (this._h[n] = this._h[n] || []).push(f); return this; }
    off(n, f) { const a = this._h[n]; if (a) this._h[n] = a.filter((x) => x !== f); return this; }
    emit(n, ...args) { const a = this._h[n]; if (a) for (const f of a.slice()) f(...args); }
  };

  /* ---------- 3次元ベクトル（通常の配列 [x,y,z]） ---------- */
  const V = CS.V = {
    make: (x = 0, y = 0, z = 0) => [x, y, z],
    copy: (a) => [a[0], a[1], a[2]],
    set: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    addScaled: (o, a, s) => { o[0] += a[0] * s; o[1] += a[1] * s; o[2] += a[2] * s; return o; },  // o += a*s（上書き）
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
    /* 視線方向。pitch>0 で上を見る */
    forward: (yaw, pitch) => [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)],
    right: (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)],
    /* 水平の前方向（移動用） */
    flatForward: (yaw) => [-Math.sin(yaw), 0, -Math.cos(yaw)],
    /* dir を中心に半角 deg のコーン内でランダムにずらす（rnd は 0..1 を返す関数） */
    spread: (dir, deg, rnd) => {
      if (!(deg > 0)) return [dir[0], dir[1], dir[2]];
      rnd = rnd || Math.random;
      const up = Math.abs(dir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
      const r = V.norm(V.cross(dir, up)), u = V.cross(r, dir);
      const a = rnd() * Math.PI * 2, m = Math.tan(deg * Math.PI / 180) * Math.sqrt(rnd());
      return V.norm([dir[0] + (r[0] * Math.cos(a) + u[0] * Math.sin(a)) * m,
                     dir[1] + (r[1] * Math.cos(a) + u[1] * Math.sin(a)) * m,
                     dir[2] + (r[2] * Math.cos(a) + u[2] * Math.sin(a)) * m]);
    }
  };

  /* ---------- 4x4 行列（列優先 Float32Array(16)、WebGL と同じ並び） ---------- */
  const M4 = CS.M4 = {
    create: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    identity: (o) => { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    /* o = a * b（o は a,b と同じでも可） */
    multiply: (o, a, b) => {
      const t = M4._tmp;
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      o.set(t); return o;
    },
    _tmp: new Float32Array(16),
    perspective: (o, fovYRad, aspect, near, far) => {
      const f = 1 / Math.tan(fovYRad / 2), nf = 1 / (near - far);
      o.fill(0);
      o[0] = f / aspect; o[5] = f;
      o[10] = (far + near) * nf; o[11] = -1;
      o[14] = 2 * far * near * nf;
      return o;
    },
    /* 一人称カメラのビュー行列（ロールなし） */
    viewFPS: (o, eye, yaw, pitch) => {
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const rx = cy, ry = 0, rz = -sy;                    // 右
      const ux = sp * sy, uy = cp, uz = sp * cy;          // 上
      const bx = cp * sy, by = -sp, bz = cp * cy;         // 後ろ（-前）
      o[0] = rx; o[4] = ry; o[8] = rz;  o[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
      o[1] = ux; o[5] = uy; o[9] = uz;  o[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
      o[2] = bx; o[6] = by; o[10] = bz; o[14] = -(bx * eye[0] + by * eye[1] + bz * eye[2]);
      o[3] = 0;  o[7] = 0;  o[11] = 0;  o[15] = 1;
      return o;
    },
    /* 平行移動 t・回転 q・拡大 s（数値 or [sx,sy,sz]） */
    fromTRS: (o, t, q, s) => {
      const sx = typeof s === 'number' ? s : s[0], sy = typeof s === 'number' ? s : s[1], sz = typeof s === 'number' ? s : s[2];
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
      o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
      o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
      o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
      return o;
    },
    transformPoint: (m, v) => {
      const x = v[0], y = v[1], z = v[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
              (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
              (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    },
    /* ワールド座標 → 画面ピクセル（CSS px）。カメラの後ろなら null */
    project: (viewProj, p, width, height) => {
      const m = viewProj, x = p[0], y = p[1], z = p[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.05) return null;
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      return [(nx * 0.5 + 0.5) * width, (0.5 - ny * 0.5) * height, w];
    }
  };

  /* ---------- クォータニオン [x,y,z,w] ---------- */
  const Q = CS.Q = {
    identity: () => [0, 0, 0, 1],
    copy: (q) => [q[0], q[1], q[2], q[3]],
    fromAxisAngle: (axis, ang) => { const s = Math.sin(ang / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(ang / 2)]; },
    /* a * b（b を先に回してから a） */
    mul: (a, b) => {
      const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
      return [ax * bw + aw * bx + ay * bz - az * by,
              ay * bw + aw * by + az * bx - ax * bz,
              az * bw + aw * bz + ax * by - ay * bx,
              aw * bw - ax * bx - ay * by - az * bz];
    },
    normalize: (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; },
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
    slerp: (a, b, t) => {
      let bx = b[0], by = b[1], bz = b[2], bw = b[3];
      let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
      if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
      let k0, k1;
      if (c > 0.9995) { k0 = 1 - t; k1 = t; }
      else { const o = Math.acos(c), so = Math.sin(o); k0 = Math.sin((1 - t) * o) / so; k1 = Math.sin(t * o) / so; }
      return Q.normalize([a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1]);
    },
    rotateVec: (q, v) => {
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
      return [v[0] + qw * tx + (qy * tz - qz * ty),
              v[1] + qw * ty + (qz * tx - qx * tz),
              v[2] + qw * tz + (qx * ty - qy * tx)];
    },
    /* 視線の向き（yaw→pitch の順）。ローカル -Z が視線方向になる */
    fromYawPitch: (yaw, pitch) => Q.mul(Q.fromAxisAngle([0, 1, 0], yaw), Q.fromAxisAngle([1, 0, 0], pitch)),
    /* 立方体が水平速度 (vx,vz) で dt 秒転がったあとの向き */
    roll: (q, vx, vz, dt, half) => {
      const sp = Math.hypot(vx, vz);
      if (sp < 1e-4) return q;
      const axis = [vz / sp, 0, -vx / sp];                // up × v
      const dq = Q.fromAxisAngle(axis, (sp * dt) / (half || CS.PLAYER.half));
      return Q.normalize(Q.mul(dq, q));
    },
    /* 最も近い「床にぴったり座る」向き（24通り）へ t だけ近づける */
    settle: (q, t) => {
      let best = CUBE_ROTS[0], bd = -1;
      for (const r of CUBE_ROTS) { const d = Math.abs(Q.dot(q, r)); if (d > bd) { bd = d; best = r; } }
      return Q.slerp(q, best, t);
    }
  };

  /* 立方体の24通りの向き */
  const CUBE_ROTS = (function () {
    const out = [], H = Math.PI / 2;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const q = Q.normalize(Q.mul(Q.fromAxisAngle([1, 0, 0], i * H), Q.mul(Q.fromAxisAngle([0, 1, 0], j * H), Q.fromAxisAngle([0, 0, 1], k * H))));
      if (!out.some((r) => Math.abs(Q.dot(r, q)) > 0.999)) out.push(q);
    }
    return out;
  })();
  CS.CUBE_ROTS = CUBE_ROTS;

  /* ---------- 設定（localStorage、失敗しても動く） ---------- */
  const SETTINGS_KEY = 'cubestrike2_settings';
  let touchDev = false;
  try { touchDev = !!CS.isTouch(); } catch (e) {}
  const DEFAULTS = {
    name: '', sens: 1.0, touchSens: 1.0, invertY: false, fov: 78,
    quality: 'auto', vol: 0.8, gun: 'ar', bomb: 'frag',
    gun2: 'magnum',          // v5: 2つめの銃（しあい中に もちかえ）
    autoJump: touchDev,      // 段差を自動でのぼる（タッチ端末は最初からオン）
    touchLayout: null,       // タッチボタンの配置（input.js が管理）
    cpuMode: '1v1', cpuLevel: 'normal', cpuMap: 'plaza',  // コンピューター戦の前回の選択
    /* CPU のぶき（'random' = 1人ずつランダム）。てき と なかま で べつべつ */
    cpuEnemyGun: 'random', cpuEnemyBomb: 'random', cpuAllyGun: 'random', cpuAllyBomb: 'random',
    /* v3 */
    rule: 'kills', ruleN: 10,          // へやを作るときのルール
    cpuRule: 'kills', cpuRuleN: 10,    // コンピューター戦のルール
    skin: null,                        // じぶんのブロックのスキン（CS.Skins.clean で整える。null = いつもの見た目）
    towerDiff: 'normal',               // 塔のぼりの むずかしさ
    towerBest: null                    // 塔のぼりの さいこう記録 {easy, normal, hard}（のぼった階）
  };
  CS.Settings = Object.assign({}, DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (s && typeof s === 'object') Object.assign(CS.Settings, s);
  } catch (e) {}
  if (typeof CS.Settings.autoJump !== 'boolean') CS.Settings.autoJump = DEFAULTS.autoJump;
  {
    const r = CS.cleanRule(CS.Settings.rule, CS.Settings.ruleN);
    CS.Settings.rule = r.id; CS.Settings.ruleN = r.n;
    const c = CS.cleanRule(CS.Settings.cpuRule, CS.Settings.cpuRuleN);
    CS.Settings.cpuRule = c.id; CS.Settings.cpuRuleN = c.n;
    const tb = CS.Settings.towerBest;
    const best = { easy: 0, normal: 0, hard: 0 };
    if (tb && typeof tb === 'object') for (const k in best) best[k] = Math.max(0, Math.min(999, (+tb[k] | 0)));
    CS.Settings.towerBest = best;
    if (['easy', 'normal', 'hard'].indexOf(CS.Settings.towerDiff) < 0) CS.Settings.towerDiff = 'normal';
  }
  CS.saveSettings = function () {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(CS.Settings)); } catch (e) {}
  };
  if (!CS.Settings.name) {
    CS.Settings.name = 'プレイヤー' + (10 + Math.floor(Math.random() * 90));
  }
})();
