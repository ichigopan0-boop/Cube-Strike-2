/* ==========================================================================
   CUBE STRIKE — editor.js
   マップエディター（v3）: マイクラみたいに ブロックを おいたり こわしたりして、じぶんのマップを作る。
   ・とぶ（しょうとつなし・Space/Shift で上下）と あるく（ゲームと同じ動き）を F で切りかえ
   ・PC: 左クリック = こわす / 右クリック = おく / ホイール・1〜0 = えらぶ / Z = もどす / X = たいしょう
   ・タッチ: うつ→「おく」/ ボム→「こわす」/ リロード→「つぎ」/ ジャンプ・スライド→ 上・下
   ・ツールは ブロック8しゅ + あかスタート + あおスタート（チームの出撃地点。各チーム4つまで）
   ・たいしょう ON: 180° 回した場所にも同じものを置く（あか⇔あお も入れかえ）。フェアなマップが作りやすい
   ・いちばん下の床（y=0）は こわせない
   保存は CS.CustomMaps。CS.Editor は main.js が1つ作る（CS.editor）。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const V = CS.V, B = CS.BLOCK, PLAYER = CS.PLAYER;
  const REACH = 9;
  const FLY_SPEED = 8, WALK_SPEED = 5.4;
  const REPEAT_FIRST = 0.32, REPEAT = 0.16;
  const UNDO_MAX = 300;
  const EYE = 0.3;

  const TOOLS = [
    { kind: 'block', b: B.FLOOR, name: 'ゆか' },
    { kind: 'block', b: B.WALL, name: 'かべ' },
    { kind: 'block', b: B.TRIM, name: 'ライン' },
    { kind: 'block', b: B.CRATE, name: 'きばこ' },
    { kind: 'block', b: B.METAL, name: 'てつ' },
    { kind: 'block', b: B.GLOW, name: 'ひかる' },
    { kind: 'block', b: B.RED, name: 'あか' },
    { kind: 'block', b: B.BLUE, name: 'あお' },
    { kind: 'spawn', team: 0, name: 'あかスタート' },
    { kind: 'spawn', team: 1, name: 'あおスタート' }
  ];
  const swapTeam = (b) => (b === B.RED ? B.BLUE : b === B.BLUE ? B.RED : b);

  class Editor {
    constructor(opts) {
      opts = opts || {};
      this.renderer = opts.renderer || null;
      this.onMenu = opts.onMenu || null;         // Esc / ≡（main.js がメニューを開く）
      this.active = false;
      this.paused = false;
      this.map = null;
      this.world = null;
      this.data = null;
      this.pos = [0, 0, 0]; this.vel = [0, 0, 0];
      this.yaw = 0; this.pitch = 0;
      this.fly = true; this.sym = false; this.grounded = false;
      this.tool = 0;
      this.undo = [];
      this.dirty = false;
      this.hit = null;          // いまねらっているもの {cell:[x,y,z], place:[x,y,z]|null, n}
      this._rc = { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 };
      this._mv = { out: {}, stepUp: CS.VOXEL + 0.05 };
      this._eye = [0, 0, 0];
      this._cam = { pos: this._eye, yaw: 0, pitch: 0, fov: 78, shake: 0 };
      this._rep = { place: 0, brk: 0 };
      this._prevAds = false;
      this._hudSig = '';
      this.TOOLS = TOOLS;
    }

    /* m = CS.CustomMaps の地図（clean ずみ） */
    open(m) {
      const CM = CS.CustomMaps;
      const data = m && CM.decode(m.rle, m.W * m.H * m.D);
      if (!data) return false;
      this.map = { id: m.id, name: m.name, W: m.W, H: m.H, D: m.D, sp: [m.sp[0].map((c) => c.slice()), m.sp[1].map((c) => c.slice())], theme: m.theme };
      this.data = data;
      this._rebuildWorld();
      /* はじめは あかの出撃地点のうしろ上から、まんなかを見る */
      const W = m.W, D = m.D;
      this.pos[0] = W / 2; this.pos[1] = Math.min(m.H - 1.5, 6); this.pos[2] = 2.5;
      this.vel[0] = this.vel[1] = this.vel[2] = 0;
      this.yaw = Math.PI; this.pitch = -0.35;
      this.fly = true; this.sym = false; this.tool = 0;
      this.undo.length = 0;
      this.dirty = false;
      this.paused = false;
      this.active = true;
      this._hudSig = '';
      try { CS.Input.setGunMode(false); } catch (e) {}
      try { CS.Input.setLabels({ fire: 'おく', bomb: 'こわす', reload: 'つぎ', jump: 'うえ', slide: 'した' }); } catch (e) {}
      if (CS.UI.editorShow) CS.UI.editorShow(true, this);
      this._hud(true);
      return true;
    }

    close() {
      if (!this.active) return;
      this.active = false;
      this.paused = false;
      try { CS.Input.setLabels(null); } catch (e) {}
      try { CS.Input.enable(false); } catch (e) {}
      if (CS.UI.editorShow) CS.UI.editorShow(false);
      if (this.renderer && this.renderer.ok) { try { this.renderer.setWorld(null); } catch (e) {} }
      this.world = null;
    }

    _theme() { const T = CS.CustomMaps.THEMES; return T[this.map.theme] || T.plaza; }

    _rebuildWorld() {
      const th = this._theme(), m = this.map;
      /* v4: しあいと同じ 屋外の 空と光（エディターは きりを すこし遠く） */
      const look = CS.MapKit && CS.MapKit.env ? CS.MapKit.env(th.env || 'day', { palette: th.palette }) : { palette: th.palette, sky: th.sky, fogNear: th.fogNear, fogFar: th.fogFar };
      look.fogNear += 20; look.fogFar += 40;
      const md = Object.assign({
        W: m.W, H: m.H, D: m.D, data: this.data, spawns: [[{ p: [1.5, 1.5, 1.5], yaw: 0 }], [{ p: [1.5, 1.5, 1.5], yaw: 0 }]]
      }, look, { editor: true });          // editor: マップの外に 光線が ぬけない（まわりの かべに ブロックを おける）
      this.world = new CS.World(md);
      if (this.renderer && this.renderer.ok) this.renderer.setWorld(this.world);
    }

    setTheme(id) {
      if (!CS.CustomMaps.THEMES[id] || !this.map) return;
      this.map.theme = id;
      this.dirty = true;
      this._rebuildWorld();
    }
    rename(name) {
      if (!this.map) return;
      const s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
      if (s) { this.map.name = s; this.dirty = true; this._hudSig = ''; }
    }

    /* 保存。できたら 保存した地図、いっぱいなら false */
    save() {
      if (!this.map) return false;
      const m = this.map;
      const out = CS.CustomMaps.save({ id: m.id, name: m.name, W: m.W, H: m.H, D: m.D, rle: CS.CustomMaps.encode(this.data), sp: m.sp, theme: m.theme });
      if (out) this.dirty = false;
      return out;
    }

    /* ---------------- 1コマ ---------------- */
    frame(dt, inp) {
      if (!this.active) return;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;
      if (this.paused) { this._draw(); return; }
      if (inp.menu) { if (this.onMenu) this.onMenu(); this._draw(); return; }

      /* キー */
      const keys = inp.keys || [];
      for (let i = 0; i < keys.length; i++) {
        const c = keys[i];
        if (c.indexOf('Digit') === 0) { const d = +c.slice(5); this.setTool(d === 0 ? 9 : d - 1); }
        else if (c === 'KeyF') this.toggleFly();
        else if (c === 'KeyZ') this.undoLast();
        else if (c === 'KeyX') this.toggleSym();
      }
      if (inp.wheel) this.setTool((this.tool + (inp.wheel > 0 ? 1 : -1) + TOOLS.length) % TOOLS.length);
      if (inp.reload) this.setTool((this.tool + 1) % TOOLS.length);

      /* 見る */
      this.yaw = CS.wrapAngle(this.yaw - (inp.lookX || 0));
      this.pitch = CS.clamp(this.pitch + (inp.lookY || 0), -1.52, 1.52);

      this._move(dt, inp);
      this._aim();

      /* おく / こわす（押しっぱなしで くりかえす） */
      const touch = !!CS.Input.isTouch;
      let placeHeld, placeNow, brkHeld, brkNow;
      if (touch) {
        placeHeld = inp.fire; placeNow = inp.firePressed;
        brkHeld = false; brkNow = inp.bomb;
      } else {
        brkHeld = inp.fire; brkNow = inp.firePressed;
        placeHeld = inp.ads; placeNow = inp.ads && !this._prevAds;
      }
      this._prevAds = !!inp.ads;
      if (this._repeat('place', placeHeld, placeNow, dt)) this.act(true);
      if (this._repeat('brk', brkHeld, brkNow, dt)) this.act(false);

      this._draw();
      this._hud(false);
    }

    _repeat(k, held, now, dt) {
      if (now) { this._rep[k] = REPEAT_FIRST; return true; }
      if (!held) { this._rep[k] = 0; return false; }
      this._rep[k] -= dt;
      if (this._rep[k] <= 0) { this._rep[k] = REPEAT; return true; }
      return false;
    }

    _move(dt, inp) {
      const fw = V.flatForward(this.yaw), rt = V.right(this.yaw);
      let mx = inp.mx || 0, mz = inp.mz || 0;
      let wx = fw[0] * mz + rt[0] * mx, wz = fw[2] * mz + rt[2] * mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1) { wx /= wl; wz /= wl; }
      const m = this.map, p = this.pos, v = this.vel;
      if (this.fly) {
        const up = (inp.jumpHeld ? 1 : 0) - (inp.slideHeld ? 1 : 0);
        const k = Math.min(1, dt * 10);
        v[0] += (wx * FLY_SPEED - v[0]) * k;
        v[2] += (wz * FLY_SPEED - v[2]) * k;
        v[1] += (up * FLY_SPEED - v[1]) * k;
        p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
        p[0] = CS.clamp(p[0], 0.4, m.W - 0.4);
        p[1] = CS.clamp(p[1], 0.6, m.H + 10);
        p[2] = CS.clamp(p[2], 0.4, m.D - 0.4);
        this.grounded = false;
        return;
      }
      /* あるく: ゲームとほぼ同じ（1段はオートジャンプで のぼれる） */
      const k = Math.min(1, dt * (this.grounded ? 14 : 4));
      v[0] += (wx * WALK_SPEED - v[0]) * k;
      v[2] += (wz * WALK_SPEED - v[2]) * k;
      if (inp.jump && this.grounded) { v[1] = PLAYER.jump; this.grounded = false; }
      v[1] -= PLAYER.gravity * dt;
      if (v[1] < -40) v[1] = -40;
      if (p[1] > m.H - 0.5) p[1] = m.H - 0.5;
      const res = this.world.moveBox(p, PLAYER.half, v, dt, this._mv);
      this.grounded = res.grounded;
    }

    _eyePos() {
      this._eye[0] = this.pos[0]; this._eye[1] = this.pos[1] + EYE; this._eye[2] = this.pos[2];
      return this._eye;
    }

    _aim() {
      const eye = this._eyePos(), dir = V.forward(this.yaw, this.pitch);
      const m = this.map;
      const h = this.world.raycast(eye, dir, REACH, this._rc);
      if (!h) { this.hit = null; return; }
      const n = h.n;
      const cell = [Math.floor(h.p[0] - n[0] * 0.5), Math.floor(h.p[1] - n[1] * 0.5), Math.floor(h.p[2] - n[2] * 0.5)];
      const inside = (c) => c[0] >= 0 && c[1] >= 0 && c[2] >= 0 && c[0] < m.W && c[1] < m.H && c[2] < m.D;
      const place = [cell[0] + n[0], cell[1] + n[1], cell[2] + n[2]];
      this.hit = { cell: inside(cell) ? cell : null, place: inside(place) ? place : null, n: [n[0], n[1], n[2]], top: n[1] === 1 };
    }

    _idx(x, y, z) { const m = this.map; return x + m.W * (z + m.D * y); }
    _get(x, y, z) { const m = this.map; if (x < 0 || y < 0 || z < 0 || x >= m.W || y >= m.H || z >= m.D) return B.WALL; return this.data[this._idx(x, y, z)]; }
    _mirror(c) { const m = this.map; return [m.W - 1 - c[0], c[1], m.D - 1 - c[2]]; }

    /* その場所にブロックを置くと 自分にめりこむか */
    _blocksMe(c) {
      const p = this.pos, h = this.fly ? 0.25 : PLAYER.half;
      return Math.abs(c[0] + 0.5 - p[0]) < 0.5 + h && Math.abs(c[2] + 0.5 - p[2]) < 0.5 + h &&
        Math.abs(c[1] + 0.5 - p[1]) < 0.5 + (this.fly ? 0.3 : PLAYER.half);
    }

    /* おく（place=true）/ こわす（false）。ツールがスタートなら 出撃地点 */
    act(place) {
      const h = this.hit;
      if (!h) return false;
      const t = TOOLS[this.tool];
      if (t.kind === 'spawn') return this._spawnAct(place, t.team, h);
      const cells = [];
      if (place) {
        const c = h.place;
        if (!c || this._get(c[0], c[1], c[2]) !== B.AIR || this._blocksMe(c)) return false;
        cells.push([c, t.b]);
        if (this.sym) { const mc = this._mirror(c); if (mc[0] !== c[0] || mc[2] !== c[2]) cells.push([mc, swapTeam(t.b)]); }
      } else {
        const c = h.cell;
        if (!c || c[1] < 1) return false;                      // いちばん下の床は こわせない
        cells.push([c, B.AIR]);
        if (this.sym) { const mc = this._mirror(c); if (mc[0] !== c[0] || mc[2] !== c[2]) cells.push([mc, B.AIR]); }
      }
      const rec = { cells: [], sp: null };
      for (const [c, b] of cells) {
        if (c[1] < 1 && b === B.AIR) continue;
        const i = this._idx(c[0], c[1], c[2]);
        const old = this.data[i];
        if (old === b) continue;
        if (b !== B.AIR && old !== B.AIR) continue;
        rec.cells.push([i, old]);
        this.data[i] = b;
      }
      if (!rec.cells.length) return false;
      /* ブロックでふさがった出撃地点は けす */
      if (place) {
        const before = JSON.stringify(this.map.sp);
        for (let tm = 0; tm < 2; tm++) this.map.sp[tm] = this.map.sp[tm].filter((s) => this._get(s[0], s[1], s[2]) === B.AIR);
        if (JSON.stringify(this.map.sp) !== before) rec.sp = JSON.parse(before);
      }
      this._pushUndo(rec);
      this.renderer.refreshWorld();
      if (CS.Audio) CS.Audio.play(place ? 'place' : 'break', { pos: [h.place ? h.place[0] + 0.5 : this.pos[0], this.pos[1], h.place ? h.place[2] + 0.5 : this.pos[2]], vol: 0.8 });
      return true;
    }

    _spawnAct(place, team, h) {
      const m = this.map;
      const before = JSON.parse(JSON.stringify(m.sp));
      let changed = false;
      const cellOf = () => (h.cell ? [h.cell[0], h.cell[1] + 1, h.cell[2]] : null);
      if (place) {
        if (!h.top || !h.place) return false;
        const c = h.place;
        if (c[1] >= m.H || this._get(c[0], c[1], c[2]) !== B.AIR) return false;
        const add = (tm, cc) => {
          const same = (s) => s[0] === cc[0] && s[1] === cc[1] && s[2] === cc[2];
          if (m.sp[tm].some(same)) return;
          for (let o = 0; o < 2; o++) m.sp[o] = m.sp[o].filter((s) => !same(s));   // もう片方のチームのしるしは どける
          const L = m.sp[tm];
          L.push(cc);
          while (L.length > CS.CustomMaps.MAX_SPAWNS) L.shift();
          changed = true;
        };
        add(team, c.slice());
        if (this.sym) {
          const mc = this._mirror(c);
          if (this._get(mc[0], mc[1], mc[2]) === B.AIR && this._get(mc[0], mc[1] - 1, mc[2]) !== B.AIR) add(1 - team, mc);
        }
      } else {
        const c = cellOf();
        if (!c) return false;
        for (let tm = 0; tm < 2; tm++) {
          const n = m.sp[tm].length;
          m.sp[tm] = m.sp[tm].filter((s) => !(s[0] === c[0] && s[1] === c[1] && s[2] === c[2]));
          if (m.sp[tm].length !== n) changed = true;
        }
        if (this.sym) {
          const mc = this._mirror(c);
          for (let tm = 0; tm < 2; tm++) m.sp[tm] = m.sp[tm].filter((s) => !(s[0] === mc[0] && s[1] === mc[1] && s[2] === mc[2]));
        }
      }
      if (!changed) return false;
      this._pushUndo({ cells: [], sp: before });
      if (CS.Audio) CS.Audio.play(place ? 'spawn' : 'back', { vol: 0.6 });
      return true;
    }

    _pushUndo(rec) {
      this.undo.push(rec);
      if (this.undo.length > UNDO_MAX) this.undo.shift();
      this.dirty = true;
    }

    undoLast() {
      const rec = this.undo.pop();
      if (!rec) return false;
      for (let i = rec.cells.length - 1; i >= 0; i--) this.data[rec.cells[i][0]] = rec.cells[i][1];
      if (rec.sp) this.map.sp = rec.sp;
      if (rec.cells.length) this.renderer.refreshWorld();
      this.dirty = true;
      if (CS.Audio) CS.Audio.play('back', { vol: 0.6 });
      return true;
    }

    setTool(i) {
      i = i | 0;
      if (i < 0 || i >= TOOLS.length || i === this.tool) return;
      this.tool = i;
      if (CS.Audio) CS.Audio.play('click', { vol: 0.5 });
    }
    toggleFly() {
      this.fly = !this.fly;
      this.vel[0] = this.vel[1] = this.vel[2] = 0;
      if (CS.Audio) CS.Audio.play(this.fly ? 'jump' : 'land', { vol: 0.6 });
    }
    toggleSym() {
      this.sym = !this.sym;
      if (CS.Audio) CS.Audio.play('click', { vol: 0.6 });
    }

    /* ---------------- 描く ---------------- */
    _draw() {
      const r = this.renderer;
      if (!r || !r.ok) return;
      const cam = this._cam;
      cam.pos = this._eyePos(); cam.yaw = this.yaw; cam.pitch = this.pitch; cam.fov = CS.Settings.fov || 78; cam.shake = 0;
      const A = CS.Audio;
      if (A && A.listener) { A.listener.pos[0] = cam.pos[0]; A.listener.pos[1] = cam.pos[1]; A.listener.pos[2] = cam.pos[2]; A.listener.yaw = this.yaw; }
      r.begin(cam);
      const m = this.map, t = performance.now() / 1000;
      const T = TOOLS[this.tool];
      /* 出撃地点 */
      for (let tm = 0; tm < 2; tm++) {
        const c = CS.TEAM_COLORS[tm];
        for (let k = 0; k < m.sp[tm].length; k++) {
          const s = m.sp[tm][k];
          const p = [s[0] + 0.5, s[1] + 0.5, s[2] + 0.5];
          r.cube(p, null, 0.8, c, { alpha: 0.45, emissive: 0.6 });
          r.line([p[0], s[1] + 0.02, p[2]], [p[0], s[1] + 2.4, p[2]], c, 0.08, 0.7);
          r.particle([p[0], s[1] + 2.4 + 0.1 * Math.sin(t * 3 + k), p[2]], 0.5, c, 0.9);
        }
      }
      /* ねらっているブロックのふち・置くところ */
      const h = this.hit;
      if (h) {
        if (h.cell) this._outline(r, h.cell, [1, 1, 1], 0.035, 0.85);
        const show = (c, blk, team) => {
          const p = [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5];
          if (team !== undefined) { r.cube(p, null, 0.8, CS.TEAM_COLORS[team], { alpha: 0.35, emissive: 0.5 }); return; }
          const pal = this._theme().palette, col = pal[blk] || [0.6, 0.6, 0.7];
          r.cube(p, null, 1.0, col, { alpha: 0.32, emissive: 0.25 });
        };
        if (T.kind === 'block' && h.place) {
          show(h.place, T.b);
          if (this.sym) { const mc = this._mirror(h.place); show(mc, swapTeam(T.b)); }
        } else if (T.kind === 'spawn' && h.place && h.top) {
          show(h.place, 0, T.team);
          if (this.sym) show(this._mirror(h.place), 0, 1 - T.team);
        }
        if (this.sym && h.cell) this._outline(r, this._mirror(h.cell), [1, 0.85, 0.35], 0.03, 0.55);
      }
      /* たいしょうの まんなか・マップの上のふち */
      if (this.sym) r.line([m.W / 2, 0.05, m.D / 2], [m.W / 2, m.H, m.D / 2], [1, 0.85, 0.35], 0.07, 0.6);
      const top = m.H;
      const P = [[0, top, 0], [m.W, top, 0], [m.W, top, m.D], [0, top, m.D]];
      for (let i = 0; i < 4; i++) r.line(P[i], P[(i + 1) % 4], [0.5, 0.8, 1], 0.06, 0.35);
      r.end();
    }

    _outline(r, c, col, w, a) {
      const x0 = c[0] - 0.005, y0 = c[1] - 0.005, z0 = c[2] - 0.005, x1 = c[0] + 1.005, y1 = c[1] + 1.005, z1 = c[2] + 1.005;
      const E = this._oe || (this._oe = [[0, 0, 0], [0, 0, 0]]);
      const seg = (ax, ay, az, bx, by, bz) => { E[0][0] = ax; E[0][1] = ay; E[0][2] = az; E[1][0] = bx; E[1][1] = by; E[1][2] = bz; r.line(E[0], E[1], col, w, a); };
      seg(x0, y0, z0, x1, y0, z0); seg(x0, y1, z0, x1, y1, z0); seg(x0, y0, z1, x1, y0, z1); seg(x0, y1, z1, x1, y1, z1);
      seg(x0, y0, z0, x0, y1, z0); seg(x1, y0, z0, x1, y1, z0); seg(x0, y0, z1, x0, y1, z1); seg(x1, y0, z1, x1, y1, z1);
      seg(x0, y0, z0, x0, y0, z1); seg(x1, y0, z0, x1, y0, z1); seg(x0, y1, z0, x0, y1, z1); seg(x1, y1, z0, x1, y1, z1);
    }

    /* HUD（変わったときだけ） */
    _hud(force) {
      if (!CS.UI.editorHud) return;
      const m = this.map;
      const sig = [this.tool, this.fly, this.sym, this.dirty, this.undo.length > 0, m.name, m.sp[0].length, m.sp[1].length].join('|');
      if (!force && sig === this._hudSig) return;
      this._hudSig = sig;
      CS.UI.editorHud({
        tool: this.tool, tools: TOOLS, fly: this.fly, sym: this.sym, dirty: this.dirty, canUndo: this.undo.length > 0,
        name: m.name, spawns: [m.sp[0].length, m.sp[1].length], size: m.W + '×' + m.D + '×' + m.H
      });
    }
  }

  CS.Editor = Editor;
  CS.Editor.TOOLS = TOOLS;
})();
