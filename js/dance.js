/* ==========================================================================
   CUBE STRIKE — dance.js
   しあいが終わったら、勝ったチームのブロックが 5秒ほどダンスする（v3）。
   CS.Game.prototype に _startDance / _danceFrame / _endDance / skipDance を足す。
   ・勝ったチームの出撃地点のあたりに 横にならべ、カメラは正面から（かべにじゃまされない向きをさがす）
   ・120BPM: ぴょんぴょん はねながら回る → 左右にゆれる → みんなで大ジャンプ＆一回転 → きめポーズ
   ・紙ふぶき・花火・音楽つき。画面のタップ / クリック / キーでスキップ → 結果の画面
   見た目だけ（通信なし）。それぞれの端末が同じ場所・同じ動きで出す。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const V = CS.V, Q = CS.Q, M4 = CS.M4, PLAYER = CS.PLAYER;
  const DUR = 5.2;               // ダンスの長さ（秒）
  const BEAT = 0.5;              // 120BPM
  const SPACE = 1.5;             // となりとの間
  const CAM_DIST = 3.6;          // カメラまでのきょり（人数で のばす）
  const CONF = [[1, 0.85, 0.25], [1, 1, 1], [1, 0.45, 0.75], [0.45, 0.95, 1], [0.6, 1, 0.5]];

  const G = CS.Game.prototype;
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));

  /* w = 勝ったチーム、res = 結果の画面にわたすもの、onEnd = 結果のかわりに呼ぶもの（塔のぼり） */
  G._startDance = function (w, res, onEnd) {
    const r = this.renderer, world = this.world, md = this.mapData;
    if (!r || !r.ok || !world || !md) return false;
    const team = this.players.filter((p) => p.team === w && (p.connected || p.bot) && !(p.clone >= 0) && !p.spec);
    if (!team.length) return false;
    /* 自分がいれば まんなかに */
    team.sort((a, b) => (b.idx === this.me) - (a.idx === this.me) || a.idx - b.idx);
    if (team.length === 3 && team[0].idx === this.me) { const t = team[0]; team[0] = team[1]; team[1] = t; }

    const sps = (md.spawns && (md.spawns[w] || md.spawns[0])) || [];
    const sp = sps[0] || { p: [md.W / 2, 1.5, md.D / 2], yaw: 0 };
    const base = [sp.p[0], sp.p[1], sp.p[2]];
    const eyeY = base[1] + 0.35;

    /* カメラの向き: 出撃地点の正面から ±180° まで、かべまでのきょりが いちばん長い向き（正面を少しひいき） */
    const want = CAM_DIST + 0.7 * (team.length - 1);
    const rc = { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 };
    let best = null;
    const tries = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.1, -2.1, Math.PI];
    for (let i = 0; i < tries.length; i++) {
      const a = sp.yaw + tries[i];
      const d = [-Math.sin(a) * 0.93, 0.36, -Math.cos(a) * 0.93];   // 少し上から
      const h = world.raycast([base[0], eyeY, base[2]], V.norm(d), want + 0.6, rc);
      const clear = h ? h.t : want + 0.6;
      const score = Math.min(clear, want) - Math.abs(tries[i]) * 0.35;
      if (!best || score > best.score) best = { score: score, a: a, clear: clear };
    }
    const dist = Math.max(1.8, Math.min(want, best.clear - 0.45));
    const cf = [-Math.sin(best.a), 0, -Math.cos(best.a)];          // ならびからカメラへ
    const cr = [Math.cos(best.a), 0, -Math.sin(best.a)];           // カメラから見て左右

    /* ならぶ場所（かべ・床にめりこまない所。だめなら少し前後にずらす） */
    const spots = [];
    const n = team.length;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * SPACE;
      let ok = null;
      const shifts = [0, 0.6, -0.6, 1.2, -1.2];
      for (let k = 0; k < shifts.length && !ok; k++) {
        const q = [base[0] + cr[0] * off + cf[0] * shifts[k], base[1], base[2] + cr[2] * off + cf[2] * shifts[k]];
        if (!world.overlapsBox(q, PLAYER.half) && world.overlapsBox([q[0], q[1] - 0.1, q[2]], PLAYER.half)) ok = q;
      }
      spots.push(ok || [base[0] + cr[0] * off * 0.3, base[1], base[2] + cr[2] * off * 0.3]);
    }

    const cx = base[0] + cf[0] * dist, cz = base[2] + cf[2] * dist;
    this.dance = {
      t: 0, dur: DUR, w: w, res: res, onEnd: onEnd || null, confT: 0, boomed: 0,
      dancers: team.map((p, i) => ({ p: p, i: i, pos: spots[i], yaw0: yawTo(cx - spots[i][0], cz - spots[i][2]) })),
      look: [base[0], base[1] + 0.2, base[2]],
      cam: [cx, base[1] + 0.35 + dist * 0.36, cz], camDir: cf, dist: dist,
      color: CS.TEAM_COLORS[w] || [1, 1, 1],
      rp: {}, q0: [0, 0, 0, 1], m: M4.create()
    };
    /* 残っている弾・ボム・けむりは消す */
    this.projectiles.length = 0;
    this.bombs.length = 0;
    this.smokes.length = 0;
    this.beam = null;
    const me = this.players[this.me];
    const mine = !!me && me.team === w;
    if (CS.UI.danceShow) {
      CS.UI.danceShow(true, {
        winner: w, mine: mine, tower: !!onEnd,
        names: team.map((p) => p.name)
      });
    }
    this._sfx('dance');
    return true;
  };

  G.skipDance = function () {
    if (this.dance && this.dance.t > 0.35) this._endDance(false);
  };

  G._endDance = function (cancel) {
    const d = this.dance;
    if (!d) return;
    this.dance = null;
    if (CS.UI.danceShow) CS.UI.danceShow(false);
    try { if (CS.Audio && CS.Audio.stopDance) CS.Audio.stopDance(); } catch (e) {}
    if (cancel) return;
    if (d.onEnd) { d.onEnd(); return; }
    CS.UI.showResult(Object.assign({ danced: true }, d.res));
  };

  /* ひとりぶんの ポーズ（t = はじまってからの秒） */
  function pose(d, dz, t, out) {
    const i = dz.i, beat = t / BEAT, bi = Math.floor(beat), ph = beat - bi;
    const dir = (i % 2) ? -1 : 1;
    let y = 0, spin = 0, tilt = 0, flip = 0, squash = 0, gunSpin = 0;
    if (t < 2) {
      /* ぴょんぴょん 4回はねて、1回ごとに 90° 回る（4回で ちょうど1回転） */
      y = 0.5 * Math.sin(Math.PI * ph);
      spin = dir * (bi + ease(ph * 1.4)) * Math.PI / 2;
      squash = ph < 0.18 ? (1 - ph / 0.18) * 0.45 : 0;
    } else if (t < 3.5) {
      /* 左右にゆれて、2拍めで くるっと1回転 */
      const u = t - 2, b2 = u / (BEAT * 2), k = Math.floor(b2), f = b2 - k;
      tilt = Math.sin(u * Math.PI * 2) * 0.38 * (i % 2 ? -1 : 1);
      y = 0.18 * Math.abs(Math.sin(u * Math.PI * 2));
      spin = dir * (k + ease((f - 0.5) / 0.45)) * Math.PI * 2;
      gunSpin = u * 6;
    } else if (t < 4.6) {
      /* みんなで 大ジャンプして 前に一回転 */
      const u = (t - 3.5) / 1.1;
      y = 1.35 * Math.sin(Math.PI * Math.min(1, u));
      flip = -ease(u) * Math.PI * 2;
      squash = u < 0.08 ? (1 - u / 0.08) * 0.5 : 0;
    } else {
      /* 着地して きめポーズ（ちょっと かたむく） */
      const u = t - 4.6;
      squash = u < 0.16 ? (1 - u / 0.16) * 0.6 : 0;
      tilt = ease(u / 0.3) * 0.22 * (i % 2 ? -1 : 1);
      y = 0;
    }
    const yaw = dz.yaw0 + spin;
    let q = Q.fromAxisAngle([0, 1, 0], yaw);
    if (flip) q = Q.mul(q, Q.fromAxisAngle([1, 0, 0], flip));
    if (tilt) q = Q.mul(q, Q.fromAxisAngle([0, 0, 1], tilt));
    out.pos[0] = dz.pos[0]; out.pos[1] = dz.pos[1] + y; out.pos[2] = dz.pos[2];
    out.quat = Q.normalize(q);
    out.yaw = yaw + gunSpin;
    out.slide = squash;
    return out;
  }

  G._danceFrame = function (dt) {
    const d = this.dance;
    d.t += dt;
    this.time += dt;
    const t = d.t;

    /* 紙ふぶき（上からふってくる光のつぶ）と、大ジャンプ・着地の花火 */
    d.confT -= dt;
    while (d.confT <= 0) {
      d.confT += 0.035;
      const c = Math.random() < 0.35 ? d.color : CONF[(Math.random() * CONF.length) | 0];
      const a = Math.random() * Math.PI * 2, rr = 1 + Math.random() * 3.2;
      this._addPart(d.look[0] + Math.cos(a) * rr, d.look[1] + 3.2 + Math.random() * 1.5, d.look[2] + Math.sin(a) * rr,
        (Math.random() - 0.5) * 1.2, -0.4 - Math.random() * 0.6, (Math.random() - 0.5) * 1.2,
        0.07 + Math.random() * 0.07, c[0], c[1], c[2], 2.2 + Math.random(), 0.6, 0.4, 0);
    }
    if (d.boomed < 1 && t >= 3.5) {
      d.boomed = 1;
      for (let k = 0; k < 3; k++) this._boom([d.look[0] + (k - 1) * 2.2, d.look[1] + 3.2 + k * 0.4, d.look[2]], 2, k === 1 ? [1, 0.85, 0.3] : d.color, true);
    }
    if (d.boomed < 2 && t >= 4.6) {
      d.boomed = 2;
      this._boom([d.look[0], d.look[1] + 3.6, d.look[2]], 2.5, [1, 1, 1], true);
      for (const dz of d.dancers) this._boom([dz.pos[0], dz.pos[1] - 0.4, dz.pos[2]], 1.2, d.color, false);
    }
    this._updateFx(dt);

    /* カメラ: 少しずつ近づいて、ゆっくり ゆれる */
    const r = this.renderer;
    const k = 1 - 0.14 * ease(t / DUR);
    const sway = Math.sin(t * 0.9) * 0.35;
    const cr = [-d.camDir[2], 0, d.camDir[0]];
    const cam = d.camObj || (d.camObj = { pos: [0, 0, 0], yaw: 0, pitch: 0, fov: 70, shake: 0 });
    cam.pos[0] = d.look[0] + (d.cam[0] - d.look[0]) * k + cr[0] * sway;
    cam.pos[1] = d.look[1] + (d.cam[1] - d.look[1]) * k + 0.08 * Math.sin(t * 1.3);
    cam.pos[2] = d.look[2] + (d.cam[2] - d.look[2]) * k + cr[2] * sway;
    /* ならびを画面の下のほうに（上は文字と大ジャンプの場所） */
    const lx = d.look[0] - cam.pos[0], ly = d.look[1] + 0.85 - cam.pos[1], lz = d.look[2] - cam.pos[2];
    cam.yaw = yawTo(lx, lz);
    cam.pitch = Math.atan2(ly, Math.hypot(lx, lz));
    cam.fov = 66;
    cam.shake = t > 4.6 && t < 4.8 ? 0.25 : 0;
    const A = CS.Audio;
    if (A && A.listener) { A.listener.pos[0] = cam.pos[0]; A.listener.pos[1] = cam.pos[1]; A.listener.pos[2] = cam.pos[2]; A.listener.yaw = cam.yaw; }
    r.begin(cam);

    /* ダンサー */
    const rp = d.rp;
    if (!rp.pos) rp.pos = [0, 0, 0];
    for (const dz of d.dancers) {
      const p = dz.p;
      pose(d, dz, t, rp);
      rp.pitch = 0; rp.team = p.team; rp.gun = p.gun; rp.flash = 0; rp.protect = false; rp.hit = 0;
      rp.alpha = 1; rp.spin = t * 20; rp.charge = 0; rp.side = 0; rp.skin = p.skin; rp.boss = !!p.boss;
      r.player(rp);
      /* 足もとの光 */
      r.particle([dz.pos[0], dz.pos[1] - 0.46, dz.pos[2]], 1.6, d.color, 0.25 + 0.15 * Math.sin(t * 8 + dz.i));
    }
    /* 粒 */
    const tp = this._tp, tc = this._tc;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      const a = p.life / p.max;
      tp[0] = p.x; tp[1] = p.y; tp[2] = p.z;
      tc[0] = p.r; tc[1] = p.g; tc[2] = p.b;
      r.particle(tp, p.s * (0.45 + 0.55 * a), tc, Math.min(1, a * 1.5));
    }
    r.end();

    if (t >= d.dur) this._endDance(false);
  };
})();
