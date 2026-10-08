/* ==========================================================================
   CUBE STRIKE — maps.js
   CS.BLOCK（ブロックID）・CS.Maps（ボクセルマップ定義）・CS.World（当たり判定・メッシュ・ナビ）
   v2: ボクセル1個 = CS.VOXEL(1m) = プレイヤー1人ぶん。床（y=0 の層）の上面が高さ 1m。
   data の添字 = x + W*(z + D*y)。
   buildMesh() は非インデックスの Float32Array を返す:
     pos(xyz) / nrm(xyz) / col(rgb 0..1) / emi(頂点ごと発光 0..1) / count(頂点数、6の倍数)
     三角形は法線方向から見て反時計回り（CCW）。
   範囲外は全方向（上 H 以上・下 0 未満も）WALL 扱い。ただし raycast は上に抜けた光線を「当たりなし」にする。
   ナビ（ボット用）: buildNav() / navNodeAt() / navPos() / navPath() / navRandom()
     ノード = 下が固いブロックの空気セル（そこに立てる）。辺 kind: 0 歩く / 1 1段ジャンプ / 2 飛びおり。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  /* v4: BARRIER = 見えない かべ（屋外マップの ふちの さくの 上）。体は とおれない・弾と 目線は とおる・描かない */
  const BLOCK = CS.BLOCK = { AIR: 0, FLOOR: 1, WALL: 2, TRIM: 3, CRATE: 4, RED: 5, BLUE: 6, METAL: 7, GLOW: 8, BARRIER: 255 };
  const BARRIER = 255;

  const SKIN = 1e-4;      // 接触面からのすき間（m）
  const EPS = 1e-5;       // ボクセル単位の判定誤差
  const MAX_SUB = 0.2;    // 1サブステップの最大移動量（m）

  /* ナビのコスト: 歩く 1（ななめ √2）、1段ジャンプ 1+JUMP_EXTRA、飛びおり 1+DROP_PER×段数 */
  const NAV_JUMP_EXTRA = 1.5;
  const NAV_DROP_PER = 0.3;
  const NAV_DIAG = Math.SQRT2;
  const NAV_FIND_R = 1.5;       // navNodeAt の探索半径（m）

  /* ======================================================================
     World
     ====================================================================== */
  class World {
    constructor(map) {
      this.map = map;
      this.W = map.W; this.H = map.H; this.D = map.D;
      this.vs = CS.VOXEL;
      this.sizeX = this.W * this.vs; this.sizeY = this.H * this.vs; this.sizeZ = this.D * this.vs;
      this.data = map.data;
      this._WD = this.W * this.D;
      /* v4: 屋外マップ: マップの外（横）は 地面より上なら 空気（弾は 遠くまで とんでいく）。体は ふちで止まる（_ov） */
      this.open = !!map.outdoor && !map.editor;
      // raycast の結果（スカラーで保持してゴミを出さない）
      this._rt = 0; this._rax = 0; this._rsg = 0; this._rb = 0;
      this.nav = null;
    }

    get(ix, iy, iz) {
      if (ix < 0 || iy < 0 || iz < 0 || ix >= this.W || iy >= this.H || iz >= this.D) return BLOCK.WALL;
      return this.data[ix + this.W * (iz + this.D * iy)];
    }

    /* 弾・つぶ・ばくはつから見た「かたい」（見えない かべ は とおる） */
    solidAt(x, y, z) {
      const inv = 1 / this.vs;
      const ix = Math.floor(x * inv), iy = Math.floor(y * inv), iz = Math.floor(z * inv);
      if (iy >= this.H) return false;                    // 天井より上は 空（raycast と同じ）
      if (this.open && iy >= 1 && (ix < 0 || iz < 0 || ix >= this.W || iz >= this.D)) return false;
      const b = this.get(ix, iy, iz);
      return b !== 0 && b !== BARRIER;
    }

    /* 立方体（中心 x,y,z・半径 h）が固いボクセルと重なるか（接しているだけなら false） */
    _ov(x, y, z, h) {
      const inv = 1 / this.vs;
      const x0 = Math.floor((x - h) * inv + EPS), x1 = Math.floor((x + h) * inv - EPS);
      const y0 = Math.floor((y - h) * inv + EPS), y1 = Math.floor((y + h) * inv - EPS);
      const z0 = Math.floor((z - h) * inv + EPS), z1 = Math.floor((z + h) * inv - EPS);
      if (x0 < 0 || y0 < 0 || z0 < 0 || x1 >= this.W || y1 >= this.H || z1 >= this.D) return true;
      const W = this.W, WD = this._WD, data = this.data;
      for (let iy = y0; iy <= y1; iy++) {
        const oy = iy * WD;
        for (let iz = z0; iz <= z1; iz++) {
          const oz = oy + iz * W;
          for (let ix = x0; ix <= x1; ix++) if (data[oz + ix] !== 0) return true;
        }
      }
      return false;
    }

    overlapsBox(pos, half) { return this._ov(pos[0], pos[1], pos[2], half); }

    /* 1軸ぶん動かす。ぶつかったら面にぴったり止めて true */
    _axis(pos, h, a, d) {
      const old = pos[a];
      pos[a] = old + d;
      if (!this._ov(pos[0], pos[1], pos[2], h)) return false;
      const vs = this.vs;
      let np;
      if (d > 0) np = Math.floor((pos[a] + h) / vs - EPS) * vs - h - SKIN;
      else np = (Math.floor((pos[a] - h) / vs + EPS) + 1) * vs + h + SKIN;
      if (d > 0 ? np < old : np > old) np = old;
      pos[a] = np;
      if (np !== old && this._ov(pos[0], pos[1], pos[2], h)) pos[a] = old;
      return true;
    }

    /* 段差のぼり: 水平軸 a に d 進めたいが塞がれたとき、stepUp 以内の段なら上に乗る
       （v2 の既定 stepUp は 0 = 自動ではのぼらない。オートジャンプがオンなら game が 1段ぶんを渡す） */
    _step(pos, h, a, target, stepUp) {
      if (!(stepUp > 0)) return 0;
      const vs = this.vs, feet = pos[1] - h;
      let top = (Math.floor((feet + 1e-3) / vs) + 1) * vs;
      while (top - feet <= stepUp + 1e-3) {
        const ny = top + h + SKIN;
        const bx = a === 0 ? target : pos[0], bz = a === 2 ? target : pos[2];
        if (!this._ov(bx, ny, bz, h) && !this._ov(pos[0], ny, pos[2], h)) {
          const dy = ny - pos[1];
          pos[a] = target; pos[1] = ny;
          return dy;
        }
        top += vs;
      }
      return 0;
    }

    /* 立方体を速度 vel で dt 秒動かす（pos, vel を上書き）
       opts: {stepUp, canStep, out}  out を渡すと結果オブジェクトを再利用する */
    moveBox(pos, half, vel, dt, opts) {
      const res = (opts && opts.out) || {};
      res.grounded = false; res.hitX = false; res.hitY = false; res.hitZ = false; res.stepped = false; res.stepDy = 0;
      const h = half;
      if (!(dt > 0)) {
        res.grounded = vel[1] <= 0 && this._ov(pos[0], pos[1] - 0.02, pos[2], h);
        return res;
      }
      const stepUp = opts && opts.stepUp != null ? opts.stepUp : CS.PLAYER.stepUp;
      const forceStep = !!(opts && opts.canStep);

      // めり込んでいたら上へ押し出す（最大 1m）。無理ならそのまま動かす
      if (this._ov(pos[0], pos[1], pos[2], h)) {
        let freed = false;
        for (let k = 1; k <= 20; k++) {
          if (!this._ov(pos[0], pos[1] + k * 0.05, pos[2], h)) { pos[1] += k * 0.05; freed = true; break; }
        }
        if (!freed) {
          pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;
          return res;
        }
      }

      const mx = Math.max(Math.abs(vel[0]), Math.abs(vel[1]), Math.abs(vel[2])) * dt;
      const n = Math.max(1, Math.ceil(mx / MAX_SUB));
      const sdt = dt / n;
      let grounded = vel[1] <= 0 && this._ov(pos[0], pos[1] - 0.02, pos[2], h);

      for (let s = 0; s < n; s++) {
        // X
        let d = vel[0] * sdt;
        if (d !== 0) {
          const target = pos[0] + d;
          if (this._axis(pos, h, 0, d)) {
            const dy = (grounded || forceStep) && vel[1] <= 0.01 ? this._step(pos, h, 0, target, stepUp) : 0;
            if (dy > 0) { res.stepped = true; res.stepDy += dy; }
            else { res.hitX = true; vel[0] = 0; }
          }
        }
        // Z
        d = vel[2] * sdt;
        if (d !== 0) {
          const target = pos[2] + d;
          if (this._axis(pos, h, 2, d)) {
            const dy = (grounded || forceStep) && vel[1] <= 0.01 ? this._step(pos, h, 2, target, stepUp) : 0;
            if (dy > 0) { res.stepped = true; res.stepDy += dy; }
            else { res.hitZ = true; vel[2] = 0; }
          }
        }
        // Y
        d = vel[1] * sdt;
        if (d !== 0) {
          if (this._axis(pos, h, 1, d)) {
            res.hitY = true;
            if (d < 0) grounded = true;
            vel[1] = 0;
          } else if (d > 0) grounded = false;
          else grounded = this._ov(pos[0], pos[1] - 0.02, pos[2], h);
        }
      }
      res.grounded = grounded || (vel[1] <= 0 && this._ov(pos[0], pos[1] - 0.02, pos[2], h));
      return res;
    }

    /* 内部レイ（Amanatides–Woo）。当たれば true、結果は _rt/_rax/_rsg/_rb に入る */
    _ray(ox, oy, oz, dx, dy, dz, maxDist) {
      const vs = this.vs, inv = 1 / vs, W = this.W, H = this.H, D = this.D, WD = this._WD, data = this.data;
      let ix = Math.floor(ox * inv), iy = Math.floor(oy * inv), iz = Math.floor(oz * inv);
      const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;

      /* v4: 見えない かべ（BARRIER）は とおりぬける。屋外マップの 外（横）は 地面（y=0 の段）より上なら 空気 */
      const open = this.open;
      // 開始ボクセル
      let b;
      if (ix < 0 || iz < 0 || iy < 0 || ix >= W || iz >= D) b = open && iy >= 1 ? (iy >= H && sy >= 0 ? -1 : 0) : BLOCK.WALL;
      else if (iy >= H) { b = 0; if (sy >= 0) return false; }
      else b = data[ix + W * iz + WD * iy];
      if (b === -1) return false;
      if (b === BARRIER) b = 0;
      if (b !== 0) {
        const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
        if (ax >= ay && ax >= az) { this._rax = 0; this._rsg = -sx || -1; }
        else if (ay >= az) { this._rax = 1; this._rsg = -sy || -1; }
        else { this._rax = 2; this._rsg = -sz || -1; }
        this._rt = 0; this._rb = b;
        return true;
      }

      let tmx = sx > 0 ? ((ix + 1) * vs - ox) / dx : sx < 0 ? (ix * vs - ox) / dx : Infinity;
      let tmy = sy > 0 ? ((iy + 1) * vs - oy) / dy : sy < 0 ? (iy * vs - oy) / dy : Infinity;
      let tmz = sz > 0 ? ((iz + 1) * vs - oz) / dz : sz < 0 ? (iz * vs - oz) / dz : Infinity;
      const tdx = sx ? vs / Math.abs(dx) : Infinity, tdy = sy ? vs / Math.abs(dy) : Infinity, tdz = sz ? vs / Math.abs(dz) : Infinity;
      const cap = 4 * (W + H + D) + 8;

      for (let it = 0; it < cap; it++) {
        let t, axis;
        if (tmx < tmy) { if (tmx < tmz) { t = tmx; axis = 0; } else { t = tmz; axis = 2; } }
        else { if (tmy < tmz) { t = tmy; axis = 1; } else { t = tmz; axis = 2; } }
        if (!(t <= maxDist)) return false;
        let sg;
        if (axis === 0) { ix += sx; tmx += tdx; sg = -sx; }
        else if (axis === 1) { iy += sy; tmy += tdy; sg = -sy; }
        else { iz += sz; tmz += tdz; sg = -sz; }

        if (iy >= H) { if (sy >= 0) return false; continue; }
        if (ix < 0 || iz < 0 || iy < 0 || ix >= W || iz >= D) b = open && iy >= 1 ? 0 : BLOCK.WALL;
        else b = data[ix + W * iz + WD * iy];
        if (b !== 0 && b !== BARRIER) { this._rt = t; this._rax = axis; this._rsg = sg; this._rb = b; return true; }
      }
      return false;
    }

    /* origin から dir（正規化済み）へ maxDist まで。out を渡すと再利用 */
    raycast(origin, dir, maxDist, out) {
      const md = maxDist == null ? 1000 : maxDist;
      if (!this._ray(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], md)) return null;
      const t = this._rt;
      const r = out || { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 };
      r.t = t;
      r.p[0] = origin[0] + dir[0] * t; r.p[1] = origin[1] + dir[1] * t; r.p[2] = origin[2] + dir[2] * t;
      r.n[0] = 0; r.n[1] = 0; r.n[2] = 0; r.n[this._rax] = this._rsg;
      r.block = this._rb;
      return r;
    }

    /* a と b の間に固いボクセルがなければ true（raycast と同じ規則） */
    lineClear(a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-9) return !this.solidAt(a[0], a[1], a[2]);
      const il = 1 / len;
      return !this._ray(a[0], a[1], a[2], dx * il, dy * il, dz * il, len);
    }

    /* 見えている面だけのメッシュ。頂点色 = パレット × AO(0.55..1) × ブロックごとの微妙な色ゆらぎ(±4%) */
    buildMesh() {
      const W = this.W, H = this.H, D = this.D, WD = this._WD, data = this.data, vs = this.vs;
      const pal = (this.map && this.map.palette) || {};
      const GLOW = BLOCK.GLOW;
      /* 見えない かべ（BARRIER）は 描かない・となりの面も かくさない */
      const solid = (x, y, z) => {
        if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return 1;
        const v = data[x + W * z + WD * y];
        return v !== 0 && v !== BARRIER ? 1 : 0;
      };

      // 1回目: 面の数
      let faces = 0;
      for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const v0 = data[x + W * z + WD * y];
        if (v0 === 0 || v0 === BARRIER) continue;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          if (!solid(x + F[0], y + F[1], z + F[2])) faces++;
        }
      }
      const count = faces * 6;
      const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), emi = new Float32Array(count);
      const cx = [0, 0, 0, 0], cy = [0, 0, 0, 0], cz = [0, 0, 0, 0], ao = [0, 0, 0, 0];
      const CU = [0, 1, 1, 0], CV = [0, 0, 1, 1];
      let v = 0;

      const put = (k, f, r, g, b, e) => {
        const F = FACES[f];
        pos[v * 3] = cx[k] * vs; pos[v * 3 + 1] = cy[k] * vs; pos[v * 3 + 2] = cz[k] * vs;
        nrm[v * 3] = F[0]; nrm[v * 3 + 1] = F[1]; nrm[v * 3 + 2] = F[2];
        const a = ao[k];
        col[v * 3] = Math.min(1, r * a); col[v * 3 + 1] = Math.min(1, g * a); col[v * 3 + 2] = Math.min(1, b * a);
        emi[v] = e;
        v++;
      };

      for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const id = data[x + W * z + WD * y];
        if (id === 0 || id === BARRIER) continue;
        const base = pal[id] || DEFAULT_PAL[id] || DEFAULT_PAL[BLOCK.WALL];
        // ブロックごとの色ゆらぎ
        let hh = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
        hh = Math.imul(hh ^ (hh >>> 13), 0x5bd1e995); hh ^= hh >>> 15;
        const tint = 1 + (((hh >>> 8) & 255) / 255 - 0.5) * 0.08;
        const r = base[0] * tint, g = base[1] * tint, b = base[2] * tint;
        /* CS2: 30〜39 は いろいろな 色の ネオン（光る） */
        const glow = id === GLOW || (id >= 30 && id < 40), e = glow ? 1 : 0;

        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = x + F[0], ny = y + F[1], nz = z + F[2];
          if (solid(nx, ny, nz)) continue;
          const ux = F[3], uy = F[4], uz = F[5], wx = F[6], wy = F[7], wz = F[8];
          const ox = x + F[9], oy = y + F[10], oz = z + F[11];
          for (let k = 0; k < 4; k++) {
            const cu = CU[k], cv = CV[k];
            cx[k] = ox + cu * ux + cv * wx; cy[k] = oy + cu * uy + cv * wy; cz[k] = oz + cu * uz + cv * wz;
            if (glow) { ao[k] = 1; continue; }
            const su = cu * 2 - 1, sv = cv * 2 - 1;
            const s1 = solid(nx + su * ux, ny + su * uy, nz + su * uz);
            const s2 = solid(nx + sv * wx, ny + sv * wy, nz + sv * wz);
            const sc = solid(nx + su * ux + sv * wx, ny + su * uy + sv * wy, nz + su * uz + sv * wz);
            const lv = (s1 && s2) ? 0 : 3 - (s1 + s2 + sc);
            ao[k] = 0.55 + 0.15 * lv;
          }
          // AO の異方性を減らすため対角線を選ぶ
          if (ao[0] + ao[2] >= ao[1] + ao[3]) {
            put(0, f, r, g, b, e); put(1, f, r, g, b, e); put(2, f, r, g, b, e);
            put(0, f, r, g, b, e); put(2, f, r, g, b, e); put(3, f, r, g, b, e);
          } else {
            put(1, f, r, g, b, e); put(2, f, r, g, b, e); put(3, f, r, g, b, e);
            put(1, f, r, g, b, e); put(3, f, r, g, b, e); put(0, f, r, g, b, e);
          }
        }
      }
      return { pos, nrm, col, emi, count };
    }

    /* ======================================================================
       ナビゲーション（ボット用）
       nav = { count, x, y, z (Int16Array), start (Int32Array count+1), list (Int32Array),
               kind (Uint8Array 0 歩く / 1 ジャンプで1段のぼる / 2 飛びおり), cost (Float32Array),
               cell (Int32Array W*H*D: セル → ノード番号 / -1), main (Uint8Array: 出撃地点と行き来できる),
               mainList (Int32Array) }
       辺:
         歩く    同じ高さの 8 近傍ノード（ななめは両側の2セルが空気のときだけ）
         ジャンプ となりの列の 1 段上のノード（自分の頭の上 (x,y+1,z) が空気のとき）
         飛びおり となりの列が空気なら、その列を下へ落ちて最初に立てるノード
       ====================================================================== */
    buildNav() {
      if (this.nav) return this.nav;
      const W = this.W, H = this.H, D = this.D, WD = this._WD, data = this.data;
      const N = W * H * D;
      const cell = new Int32Array(N).fill(-1);
      // 1) ノード: 下が固い（y=0 なら範囲外の床）空気セル
      let count = 0;
      for (let y = 0; y < H; y++) {
        const oy = y * WD, by = oy - WD;
        for (let o = 0; o < WD; o++) {
          if (data[oy + o] !== 0) continue;
          if (y === 0 || data[by + o] !== 0) cell[oy + o] = count++;
        }
      }
      const nx = new Int16Array(count), ny = new Int16Array(count), nz = new Int16Array(count);
      for (let i = 0, c = 0; c < N; c++) {
        if (cell[c] < 0) continue;
        const y = (c / WD) | 0, r = c - y * WD, z = (r / W) | 0;
        nx[i] = r - z * W; ny[i] = y; nz[i] = z; i++;
      }
      // 2) 辺（1ノードあたり最大 8 本）
      const cap = Math.max(8, count * 8);
      const list = new Int32Array(cap), kind = new Uint8Array(cap), cost = new Float32Array(cap);
      const start = new Int32Array(count + 1);
      let e = 0;
      for (let i = 0; i < count; i++) {
        start[i] = e;
        const x = nx[i], y = ny[i], z = nz[i];
        const o = x + W * z + WD * y;
        const headFree = y + 1 < H && data[o + WD] === 0;
        for (let k = 0; k < 4; k++) {
          const dx = ORTH[k * 2], dz = ORTH[k * 2 + 1];
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= W || tz >= D) continue;
          const t = o + dx + dz * W;
          if (data[t] === 0) {
            if (cell[t] >= 0) { list[e] = cell[t]; kind[e] = 0; cost[e] = 1; e++; continue; }
            // 飛びおり: 列を下へ
            let yy = y - 1, tt = t - WD;
            while (yy >= 0 && cell[tt] < 0 && data[tt] === 0) { yy--; tt -= WD; }
            if (yy >= 0 && cell[tt] >= 0) { list[e] = cell[tt]; kind[e] = 2; cost[e] = 1 + NAV_DROP_PER * (y - yy); e++; }
          } else if (headFree) {
            const up = t + WD;
            if (cell[up] >= 0) { list[e] = cell[up]; kind[e] = 1; cost[e] = 1 + NAV_JUMP_EXTRA; e++; }
          }
        }
        for (let k = 0; k < 4; k++) {
          const dx = DIAG[k * 2], dz = DIAG[k * 2 + 1];
          const tx = x + dx, tz = z + dz;
          if (tx < 0 || tz < 0 || tx >= W || tz >= D) continue;
          const t = o + dx + dz * W;
          if (cell[t] >= 0 && data[o + dx] === 0 && data[o + dz * W] === 0) { list[e] = cell[t]; kind[e] = 0; cost[e] = NAV_DIAG; e++; }
        }
      }
      start[count] = e;
      const nav = {
        count, x: nx, y: ny, z: nz, start,
        list: list.slice(0, e), kind: kind.slice(0, e), cost: cost.slice(0, e),
        cell, W, H, D, main: new Uint8Array(count), mainList: null,
        // A* 用の作業領域（使い回し）
        _g: new Float32Array(count), _par: new Int32Array(count), _seen: new Uint32Array(count), _done: new Uint32Array(count),
        _hn: new Int32Array(e + 1), _hk: new Float32Array(e + 1), _gen: 0
      };
      this.nav = nav;
      // 3) 出撃地点と行き来できるノード（強連結成分）
      this._navMain(nav);
      return nav;
    }

    _navMain(nav) {
      const count = nav.count, start = nav.start, list = nav.list;
      let root = -1;
      const sp = this.map && this.map.spawns;
      if (sp && sp[0] && sp[0][0]) root = this._navFind(sp[0][0].p, NAV_FIND_R);
      if (root < 0) {
        // 出撃地点がなければ、いちばん低い段のまん中あたり
        let bd = Infinity;
        const cx = this.W / 2, cz = this.D / 2;
        for (let i = 0; i < count; i++) {
          const d = nav.y[i] * 1000 + Math.abs(nav.x[i] - cx) + Math.abs(nav.z[i] - cz);
          if (d < bd) { bd = d; root = i; }
        }
      }
      if (root < 0) { nav.mainList = new Int32Array(0); return; }
      // 前向き
      const fw = new Uint8Array(count), q = new Int32Array(count);
      let qh = 0, qt = 0;
      fw[root] = 1; q[qt++] = root;
      while (qh < qt) {
        const i = q[qh++];
        for (let k = start[i]; k < start[i + 1]; k++) { const j = list[k]; if (!fw[j]) { fw[j] = 1; q[qt++] = j; } }
      }
      // 逆向き（入ってくる辺の CSR を作る）
      const rs = new Int32Array(count + 1);
      for (let k = 0; k < list.length; k++) rs[list[k] + 1]++;
      for (let i = 0; i < count; i++) rs[i + 1] += rs[i];
      const rl = new Int32Array(list.length), fill = rs.slice(0, count);
      for (let i = 0; i < count; i++) for (let k = start[i]; k < start[i + 1]; k++) rl[fill[list[k]]++] = i;
      const bw = new Uint8Array(count);
      qh = 0; qt = 0;
      bw[root] = 1; q[qt++] = root;
      while (qh < qt) {
        const i = q[qh++];
        for (let k = rs[i]; k < rs[i + 1]; k++) { const j = rl[k]; if (!bw[j]) { bw[j] = 1; q[qt++] = j; } }
      }
      let n = 0;
      for (let i = 0; i < count; i++) if (fw[i] && bw[i]) { nav.main[i] = 1; n++; }
      const ml = new Int32Array(n);
      for (let i = 0, m = 0; i < count; i++) if (nav.main[i]) ml[m++] = i;
      nav.mainList = ml;
    }

    /* pos（立方体の中心・m）から半径 r 以内でいちばん近いノード。なければ -1 */
    _navFind(pos, r) {
      const nav = this.nav;
      if (!nav || !pos) return -1;
      const vs = this.vs, inv = 1 / vs, W = this.W, H = this.H, D = this.D, WD = this._WD, cell = nav.cell;
      const px = +pos[0], py = +pos[1], pz = +pos[2];
      if (!(px === px && py === py && pz === pz)) return -1;
      const fx = Math.floor(px * inv), fy = Math.floor(py * inv), fz = Math.floor(pz * inv);
      const oy = (CS.PLAYER.half + 0.002);
      // ふつうは自分のセル
      if (fx >= 0 && fy >= 0 && fz >= 0 && fx < W && fy < H && fz < D) {
        const c = cell[fx + W * fz + WD * fy];
        if (c >= 0) {
          const dx = (fx + 0.5) * vs - px, dy = fy * vs + oy - py, dz = (fz + 0.5) * vs - pz;
          if (dx * dx + dy * dy + dz * dz <= r * r) return c;
        }
      }
      const R = Math.ceil(r * inv) + 1;
      let best = -1, bd = r * r;
      for (let y = Math.max(0, fy - R); y <= Math.min(H - 1, fy + R); y++) {
        const dy = y * vs + oy - py;
        if (dy * dy > bd) continue;
        for (let z = Math.max(0, fz - R); z <= Math.min(D - 1, fz + R); z++) {
          const dz = (z + 0.5) * vs - pz;
          if (dy * dy + dz * dz > bd) continue;
          for (let x = Math.max(0, fx - R); x <= Math.min(W - 1, fx + R); x++) {
            const c = cell[x + W * z + WD * y];
            if (c < 0) continue;
            const dx = (x + 0.5) * vs - px, d = dx * dx + dy * dy + dz * dz;
            if (d < bd) { bd = d; best = c; }
          }
        }
      }
      return best;
    }

    /* 位置からノード（半径 1.5m 以内でいちばん近い）。なければ -1 */
    navNodeAt(pos) {
      if (!this.nav) this.buildNav();
      return this._navFind(pos, NAV_FIND_R);
    }

    /* ノード i に立った立方体の中心（m） */
    navPos(i, out) {
      const nav = this.nav || this.buildNav();
      const o = out || [0, 0, 0];
      if (!(i >= 0 && i < nav.count)) { o[0] = o[1] = o[2] = 0; return o; }
      const vs = this.vs;
      o[0] = (nav.x[i] + 0.5) * vs;
      o[1] = nav.y[i] * vs + CS.PLAYER.half + 0.002;
      o[2] = (nav.z[i] + 0.5) * vs;
      return o;
    }

    /* A*（オクタイル距離 + 上り下りの下限）。waypoints = 立方体の中心の列（出発ノードは含まない）| null
       avoid = ノードごとの しるし（Uint8Array）。しるしのあるノードに入るたびに avoidCost を足す（なるべく 通らない道になる） */
    navPath(fromPos, toPos, maxExpand, avoid, avoidCost) {
      const ac = avoid && avoidCost > 0 ? avoidCost : 0;
      const nav = this.nav || this.buildNav();
      let s = this._navFind(fromPos, NAV_FIND_R);
      if (s < 0) s = this._navBelow(fromPos);
      let t = this._navFind(toPos, NAV_FIND_R);
      if (t < 0) t = this._navBelow(toPos);
      if (s < 0 || t < 0) return null;
      if (s === t) return [this.navPos(t)];
      const lim = maxExpand > 0 ? maxExpand : 4000;
      const X = nav.x, Y = nav.y, Z = nav.z, start = nav.start, list = nav.list, cost = nav.cost;
      const g = nav._g, par = nav._par, seen = nav._seen, done = nav._done, hn = nav._hn, hk = nav._hk;
      let gen = ++nav._gen;
      if (gen >= 0xfffffff0) { seen.fill(0); done.fill(0); gen = nav._gen = 1; }
      const tx = X[t], ty = Y[t], tz = Z[t];
      const heur = (i) => {
        const dx = Math.abs(X[i] - tx), dz = Math.abs(Z[i] - tz), dy = ty - Y[i];
        return (dx > dz ? dx + (NAV_DIAG - 1) * dz : dz + (NAV_DIAG - 1) * dx) +
          (dy > 0 ? dy * NAV_JUMP_EXTRA : -dy * NAV_DROP_PER);
      };
      // 二分ヒープ（重複を許して、古いものは取り出すときに捨てる）
      let hs = 0;
      const push = (n, k) => {
        let i = hs++;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (hk[p] <= k) break;
          hn[i] = hn[p]; hk[i] = hk[p]; i = p;
        }
        hn[i] = n; hk[i] = k;
      };
      const pop = () => {
        const top = hn[0];
        const ln = hn[--hs], lk = hk[hs];
        let i = 0;
        for (;;) {
          let c = i * 2 + 1;
          if (c >= hs) break;
          if (c + 1 < hs && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= lk) break;
          hn[i] = hn[c]; hk[i] = hk[c]; i = c;
        }
        if (hs > 0) { hn[i] = ln; hk[i] = lk; }
        return top;
      };
      g[s] = 0; seen[s] = gen; par[s] = -1;
      push(s, heur(s));
      let expanded = 0, found = false;
      while (hs > 0) {
        const i = pop();
        if (done[i] === gen) continue;
        done[i] = gen;
        if (i === t) { found = true; break; }
        if (++expanded > lim) break;
        const gi = g[i];
        for (let k = start[i]; k < start[i + 1]; k++) {
          const j = list[k];
          if (done[j] === gen) continue;
          const ng = gi + cost[k] + (ac && avoid[j] ? ac : 0);
          if (seen[j] !== gen || ng < g[j]) {
            seen[j] = gen; g[j] = ng; par[j] = i;
            if (hs < hn.length) push(j, ng + heur(j));
          }
        }
      }
      if (!found) return null;
      const out = [];
      for (let i = t; i !== s && i >= 0; i = par[i]) out.push(this.navPos(i));
      out.reverse();
      return out;
    }

    /* 空中などでノードが見つからないとき: 真下の列を 8 段まで探す */
    _navBelow(pos) {
      const nav = this.nav;
      if (!nav || !pos) return -1;
      const inv = 1 / this.vs, W = this.W, D = this.D, WD = this._WD;
      const fx = Math.floor(pos[0] * inv), fz = Math.floor(pos[2] * inv);
      let fy = Math.min(this.H - 1, Math.floor(pos[1] * inv));
      if (fx < 0 || fz < 0 || fx >= W || fz >= D || !(fy >= 0)) return -1;
      for (let k = 0; k < 8 && fy >= 0; k++, fy--) {
        const o = fx + W * fz + WD * fy;
        if (nav.cell[o] >= 0) return nav.cell[o];
        if (this.data[o] !== 0) break;
      }
      return -1;
    }

    /* 出撃地点と行き来できるノードから1つ（rng は 0..1 を返す関数） */
    navRandom(rng) {
      const nav = this.nav || this.buildNav();
      const r = typeof rng === 'function' ? rng() : Math.random();
      const ml = nav.mainList;
      if (ml && ml.length) return ml[Math.min(ml.length - 1, Math.floor(r * ml.length))];
      return nav.count ? Math.min(nav.count - 1, Math.floor(r * nav.count)) : -1;
    }
  }
  CS.World = World;

  const ORTH = [1, 0, -1, 0, 0, 1, 0, -1];
  const DIAG = [1, 1, 1, -1, -1, 1, -1, -1];

  /* 面テーブル: 法線 n, 接線 u, v（u×v=n なので CCW）, 原点オフセット */
  const FACES = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0],
    [-1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0],
    [0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    [0, 0, -1, 0, 1, 0, 1, 0, 0, 0, 0, 0]
  ];

  const DEFAULT_PAL = {
    1: [0.16, 0.17, 0.30], 2: [0.33, 0.36, 0.46], 3: [0.45, 0.33, 0.66], 4: [0.66, 0.46, 0.24],
    5: [0.95, 0.30, 0.36], 6: [0.24, 0.58, 1.0], 7: [0.52, 0.58, 0.64], 8: [0.45, 0.95, 1.0]
  };

  /* ======================================================================
     マップ作成ヘルパー（座標はボクセル = m、範囲は両端を含む）
     sym  : 箱と、その 180° 回転（x→W-1-x, z→D-1-z）に同時に書く。RED⇔BLUE を入れかえる
     sym4 : sym に加えて左右反転（x→W-1-x）にも書く
     ====================================================================== */
  const B = BLOCK;
  const swapTeam = (b) => (b === B.RED ? B.BLUE : b === B.BLUE ? B.RED : b);

  class Grid {
    constructor(W, H, D) {
      this.W = W; this.H = H; this.D = D;
      this.data = new Uint8Array(W * H * D);
    }
    fill(x0, y0, z0, x1, y1, z1, b) {
      const W = this.W, H = this.H, D = this.D;
      const ax = Math.max(0, Math.min(x0, x1)), bx = Math.min(W - 1, Math.max(x0, x1));
      const ay = Math.max(0, Math.min(y0, y1)), by = Math.min(H - 1, Math.max(y0, y1));
      const az = Math.max(0, Math.min(z0, z1)), bz = Math.min(D - 1, Math.max(z0, z1));
      for (let y = ay; y <= by; y++) for (let z = az; z <= bz; z++) {
        const o = W * (z + D * y);
        for (let x = ax; x <= bx; x++) this.data[o + x] = b;
      }
      return this;
    }
    sym(x0, y0, z0, x1, y1, z1, b) {
      this.fill(x0, y0, z0, x1, y1, z1, b);
      this.fill(this.W - 1 - x1, y0, this.D - 1 - z1, this.W - 1 - x0, y1, this.D - 1 - z0, swapTeam(b));
      return this;
    }
    sym4(x0, y0, z0, x1, y1, z1, b) {
      this.sym(x0, y0, z0, x1, y1, z1, b);
      this.sym(this.W - 1 - x1, y0, z0, this.W - 1 - x0, y1, z1, b);
      return this;
    }
    /* z 方向にのぼる階段（1段 = 1ブロック）。幅 x0..x1、最初の段が zStart、dir(±1) 方向へ run ずつ、yBase..yTop まで積む */
    stairsZ(x0, x1, zStart, dir, yBase, yTop, run, b, four) {
      for (let L = yBase; L <= yTop; L++) {
        const za = zStart + dir * (L - yBase) * run, zb = za + dir * (run - 1);
        (four ? this.sym4 : this.sym).call(this, x0, yBase, za, x1, L, zb, b);
      }
      return this;
    }
    /* x 方向にのぼる階段 */
    stairsX(z0, z1, xStart, dir, yBase, yTop, run, b, four) {
      for (let L = yBase; L <= yTop; L++) {
        const xa = xStart + dir * (L - yBase) * run, xb = xa + dir * (run - 1);
        (four ? this.sym4 : this.sym).call(this, xa, yBase, z0, xb, L, z1, b);
      }
      return this;
    }
    /* 床（y=0）と外周の壁（上端まで）。trim を渡すと外周に2本の帯 */
    shell(floor, wall, trim) {
      const W = this.W, H = this.H, D = this.D;
      this.fill(0, 0, 0, W - 1, 0, D - 1, floor);
      this.fill(0, 0, 0, W - 1, H - 1, 0, wall).fill(0, 0, D - 1, W - 1, H - 1, D - 1, wall);
      this.fill(0, 0, 0, 0, H - 1, D - 1, wall).fill(W - 1, 0, 0, W - 1, H - 1, D - 1, wall);
      if (trim) {
        for (const y of [Math.round(H * 0.3), Math.round(H * 0.65)]) {
          this.fill(0, y, 0, W - 1, y, 0, trim).fill(0, y, D - 1, W - 1, y, D - 1, trim);
          this.fill(0, y, 0, 0, y, D - 1, trim).fill(W - 1, y, 0, W - 1, y, D - 1, trim);
        }
      }
      return this;
    }
    /* 陣地（チーム0 = z の小さい側）: 内側 x0..x1 × z 1..zf-1、正面の壁 z=zf、横の壁 x0-1 / x1+1。
       壁の高さ h（上の段は RED）。正面の出口 2つ（door: 左の出口の x 開始、左右対称）、横の出口 2つ */
    base(x0, x1, zf, h, door, doorW) {
      const xl = x0 - 1, xr = x1 + 1;
      this.sym(xl, 1, 1, xl, h - 1, zf, B.WALL).sym(xr, 1, 1, xr, h - 1, zf, B.WALL);
      this.sym(x0, 1, zf, x1, h - 1, zf, B.WALL);
      this.sym(xl, h, 1, xl, h, zf, B.RED).sym(xr, h, 1, xr, h, zf, B.RED);
      this.sym(x0, h, zf, x1, h, zf, B.RED);
      this.sym4(door, 1, zf, door + doorW - 1, 3, zf, B.AIR);             // 正面の出口（高さ3）
      this.sym4(door, 4, zf, door + doorW - 1, 4, zf, B.RED);             // 出口の上のしるし
      this.sym4(xl, 1, 2, xl, 3, 4, B.AIR);                                // 横の出口（幅3・高さ3）
      this.sym(x0, 0, 1, x1, 0, 1, B.RED);                                 // 床のアクセント
      return this;
    }
    /* v4: 屋外にする。外周（x=0 / x=W-1 / z=0 / z=D-1）の かべ（WALL・TRIM）を 高さ fenceH の さく（fence、いちばん上は cap）にして、
       その上は ぜんぶ 見えない かべ（BARRIER: 体は とおれない・弾と目線は とおる）。WALL・TRIM 以外（生け垣など）は そのまま */
    openShell(fenceH, fence, cap) {
      const W = this.W, H = this.H, D = this.D, data = this.data;
      for (let y = 1; y < H; y++) {
        for (let z = 0; z < D; z++) {
          for (let x = 0; x < W; x++) {
            if (x !== 0 && z !== 0 && x !== W - 1 && z !== D - 1) continue;
            const o = x + W * (z + D * y);
            if (y > fenceH) { data[o] = BARRIER; continue; }
            const v = data[o];
            if (v === B.WALL || v === B.TRIM) data[o] = y === fenceH && cap ? cap : fence;
          }
        }
      }
      return this;
    }
    /* 上を 見えない かべで ふさぐ（高いかべ・柱の 上に のれないように） */
    capBarrier(x0, y0, z0, x1, y1, z1, four) {
      return (four ? this.sym4 : this.sym).call(this, x0, y0, z0, x1, y1, z1, BARRIER);
    }
  }

  /* ======================================================================
     v4: 屋外の 空と 光（render.js の _setEnv が よむ）。scenery = まわりの けしき（render.js）
     ====================================================================== */
  const ENV = {
    day: { sky: [0.62, 0.80, 0.97], skyTop: [0.26, 0.50, 0.90], ambSky: [0.58, 0.62, 0.68], ambGnd: [0.34, 0.33, 0.30], sunCol: [0.80, 0.76, 0.66], sun: [0.35, 0.8, 0.25], fogNear: 55, fogFar: 150 },
    forest: { sky: [0.66, 0.82, 0.86], skyTop: [0.30, 0.55, 0.78], ambSky: [0.52, 0.60, 0.58], ambGnd: [0.30, 0.34, 0.26], sunCol: [0.78, 0.78, 0.62], sun: [0.4, 0.75, 0.3], fogNear: 40, fogFar: 125 },
    desert: { sky: [0.80, 0.84, 0.90], skyTop: [0.30, 0.52, 0.88], ambSky: [0.64, 0.62, 0.60], ambGnd: [0.42, 0.36, 0.28], sunCol: [0.92, 0.82, 0.62], sun: [0.25, 0.85, -0.2], fogNear: 55, fogFar: 160 },
    snow: { sky: [0.78, 0.86, 0.95], skyTop: [0.42, 0.60, 0.90], ambSky: [0.70, 0.74, 0.82], ambGnd: [0.52, 0.54, 0.58], sunCol: [0.80, 0.80, 0.82], sun: [0.3, 0.7, 0.4], fogNear: 35, fogFar: 120 },
    sunset: { sky: [0.98, 0.70, 0.50], skyTop: [0.36, 0.40, 0.78], ambSky: [0.60, 0.52, 0.56], ambGnd: [0.36, 0.28, 0.26], sunCol: [1.0, 0.70, 0.45], sun: [-0.7, 0.35, 0.3], fogNear: 45, fogFar: 140 },
    dusk: { sky: [0.46, 0.34, 0.52], skyTop: [0.14, 0.12, 0.30], ambSky: [0.46, 0.40, 0.56], ambGnd: [0.28, 0.20, 0.22], sunCol: [0.95, 0.52, 0.40], sun: [-0.6, 0.3, -0.4], fogNear: 35, fogFar: 120 }
  };
  /* finish() に わたす 空と光（配列は コピー）。extra で 上書き */
  function env(name, extra) {
    const e = ENV[name] || ENV.day, o = { outdoor: true, scenery: ENV[name] ? name : 'day' };
    for (const k in e) o[k] = Array.isArray(e[k]) ? (k === 'sun' ? normalize3(e[k]) : e[k].slice()) : e[k];
    return Object.assign(o, extra || {});
  }

  /* チーム0のスポーン [x, z, 立つ段 y, yaw] から両チーム分を作る（p = セル中央に立った立方体の中心） */
  function makeSpawns(g, list) {
    const vs = CS.VOXEL, h = CS.PLAYER.half;
    const t0 = [], t1 = [];
    for (const s of list) {
      const y = s[2] * vs + h + 0.002;
      const yaw = s[3] != null ? s[3] : Math.PI;
      t0.push({ p: [(s[0] + 0.5) * vs, y, (s[1] + 0.5) * vs], yaw: yaw });
      t1.push({ p: [(g.W - 0.5 - s[0]) * vs, y, (g.D - 0.5 - s[1]) * vs], yaw: CS.wrapAngle(yaw + Math.PI) });
    }
    return [t0, t1];
  }

  function finish(g, spawns, look) {
    return Object.assign({
      W: g.W, H: g.H, D: g.D, data: g.data, spawns: spawns,
      sun: normalize3([0.45, 0.85, 0.3])
    }, look);
  }

  function normalize3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /* ======================================================================
     キューブ広場（40×14×40）
     中央に高さ2の広場（4方向に1段ずつの階段）、柱のモノリス、左右のサイドレーン、角の見張り台
     ====================================================================== */
  function buildPlaza() {
    const g = new Grid(40, 14, 40), T = 13;
    g.shell(B.FLOOR, B.WALL, B.TRIM);

    // 床の光るライン
    g.sym4(5, 0, 12, 5, 0, 17, B.GLOW);
    g.sym(19, 0, 7, 20, 0, 10, B.GLOW);
    g.sym4(8, 0, 19, 11, 0, 19, B.GLOW);

    // --- 陣地（内側 x 12..27, z 1..5）
    g.base(12, 27, 6, 5, 13, 3);
    // 出口の前の目かくし（高さ3）
    g.sym4(12, 1, 9, 16, 2, 10, B.CRATE);
    g.sym4(12, 3, 9, 16, 3, 10, B.TRIM);

    // --- 中央の広場（上に立つと高さ3m）
    g.fill(14, 1, 14, 25, 1, 25, B.WALL);
    g.fill(14, 2, 14, 25, 2, 25, B.FLOOR);
    g.sym(14, 2, 14, 25, 2, 14, B.GLOW);
    g.sym(14, 2, 15, 14, 2, 24, B.TRIM);
    // 1段の階段（北・南・西・東）と、横から登れる木箱
    g.sym(18, 1, 12, 21, 1, 13, B.METAL);
    g.sym(12, 1, 18, 13, 1, 21, B.METAL);
    g.sym4(12, 1, 14, 13, 1, 15, B.CRATE);
    // まん中のモノリス（天井まで）
    g.fill(18, 3, 18, 21, T, 21, B.WALL);
    g.fill(18, 6, 18, 21, 6, 21, B.GLOW);
    g.fill(18, 10, 18, 21, 10, 21, B.TRIM);
    // 広場の上のカバー（高さ1: 立てば全身かくれる、ジャンプで撃ち合う）
    g.sym4(15, 3, 16, 16, 3, 16, B.TRIM);
    g.sym4(16, 3, 23, 16, 3, 23, B.CRATE);

    // --- 柱（高さ7。上は 見えない かべ）
    g.sym4(8, 1, 8, 9, 7, 9, B.METAL);
    g.sym4(8, 6, 8, 9, 6, 9, B.GLOW);
    g.sym4(8, 7, 8, 9, 7, 9, B.GLOW);
    g.capBarrier(8, 8, 8, 9, T, 9, true);

    // --- 角の見張り台（高さ2）と上り口
    g.sym4(1, 1, 7, 5, 2, 10, B.METAL);
    g.sym4(1, 2, 10, 5, 2, 10, B.GLOW);
    g.sym4(6, 1, 7, 6, 1, 8, B.CRATE);           // 陣地側から
    g.sym4(2, 1, 11, 3, 1, 12, B.CRATE);         // レーン側から
    g.sym4(1, 3, 7, 1, 3, 8, B.TRIM);            // 見張り台のかべ

    // --- サイドレーンの仕切り（高さ7の石のかべ。上は 見えない かべ）とカバー
    g.sym4(9, 1, 13, 10, 7, 16, B.WALL);
    g.sym4(9, 5, 13, 10, 5, 16, B.GLOW);
    g.sym4(9, 7, 13, 10, 7, 16, B.TRIM);
    g.capBarrier(9, 8, 13, 10, T, 16, true);
    g.sym4(3, 1, 15, 4, 1, 16, B.CRATE);
    g.sym4(5, 1, 19, 6, 2, 19, B.CRATE);         // 2段の木箱（レーンのまん中）
    g.sym4(7, 1, 19, 7, 1, 19, B.CRATE);         // その上り口
    g.sym4(1, 1, 22, 2, 1, 23, B.TRIM);

    // --- 中盤のカバー
    g.sym4(15, 1, 11, 16, 1, 11, B.CRATE);
    g.sym4(11, 1, 11, 11, 2, 11, B.CRATE);

    /* v4: 屋外（外周は 生け垣の さく。上は 見えない かべ） */
    g.openShell(3, 9, 14);

    const spawns = makeSpawns(g, [
      [13, 2, 1], [26, 2, 1], [16, 4, 1], [23, 4, 1], [18, 2, 1], [21, 2, 1], [15, 1, 1], [24, 1, 1]
    ]);
    return finish(g, spawns, env('day', {
      palette: {
        1: [0.44, 0.70, 0.35], 2: [0.78, 0.76, 0.70], 3: [0.84, 0.46, 0.34], 4: [0.66, 0.46, 0.26],
        5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.60, 0.62, 0.64], 8: [1.0, 0.90, 0.58],
        9: [0.28, 0.56, 0.26], 14: [0.20, 0.44, 0.20]
      },
      zone: { x0: 14, x1: 26, z0: 14, z1: 26, y0: 2.6, y1: 9 }      // エリア: まんなかの広場の上
    }));
  }

  /* ======================================================================
     ツインタワー（40×14×40）
     両陣地の前に2段のタワー、上の段どうしを中央の橋がつなぐ。下は木箱の広場
     ====================================================================== */
  function buildTowers() {
    const g = new Grid(40, 14, 40), T = 13;
    g.shell(B.FLOOR, B.WALL, B.TRIM);

    // 床の光るライン
    g.sym4(6, 0, 8, 6, 0, 18, B.GLOW);
    g.fill(19, 0, 15, 20, 0, 24, B.GLOW);

    // --- 陣地（内側 x 12..27, z 1..5）
    g.base(12, 27, 6, 5, 13, 3);

    // --- タワー 1段目（高さ2 → 立つと 3m）x 13..26, z 10..14
    g.sym(13, 1, 10, 26, 1, 14, B.WALL);
    g.sym(13, 2, 10, 26, 2, 14, B.FLOOR);
    g.sym(13, 2, 14, 26, 2, 14, B.GLOW);
    g.sym(18, 1, 9, 21, 1, 9, B.METAL);           // うしろの段（陣地から）
    g.sym4(11, 1, 11, 12, 1, 13, B.METAL);        // 横の段
    g.sym4(14, 1, 15, 16, 1, 16, B.METAL);        // 正面の段
    // --- タワー 2段目（さらに2 → 立つと 5m）x 17..22, z 10..12
    g.sym(17, 3, 10, 22, 4, 12, B.METAL);
    g.sym(17, 4, 12, 22, 4, 12, B.GLOW);
    g.sym4(15, 3, 10, 16, 3, 12, B.METAL);        // 1段目 → 2段目の段
    g.sym4(13, 3, 10, 13, 4, 10, B.TRIM);         // 1段目のすみのカバー
    // --- 中央の橋（2段目どうしをつなぐ、高さ5m）
    g.fill(18, 4, 13, 21, 4, 26, B.METAL);
    g.fill(18, 4, 15, 18, 4, 24, B.GLOW);
    g.fill(21, 4, 15, 21, 4, 24, B.GLOW);
    g.sym(18, 1, 19, 18, 3, 19, B.METAL);         // 橋の支柱
    g.sym(21, 1, 19, 21, 3, 19, B.METAL);
    g.sym(19, 5, 19, 19, 5, 19, B.CRATE);         // 橋の上の小さなカバー

    // --- 下の広場の木箱
    g.sym(19, 1, 17, 20, 1, 17, B.CRATE);         // 橋の下（高さ1だけ）
    g.sym4(10, 1, 18, 11, 2, 19, B.CRATE);        // 2段の山
    g.sym4(12, 1, 18, 12, 1, 18, B.CRATE);        // その上り口
    g.sym4(14, 1, 21, 15, 1, 21, B.TRIM);
    g.sym4(16, 1, 18, 16, 2, 18, B.CRATE);

    // --- サイドの道
    g.sym4(7, 1, 12, 8, 8, 13, B.WALL);           // 大きな柱（高さ8の岩。上は 見えない かべ）
    g.sym4(7, 7, 12, 8, 7, 13, B.GLOW);
    g.sym4(7, 8, 12, 8, 8, 13, B.TRIM);
    g.capBarrier(7, 9, 12, 8, T, 13, true);
    g.sym4(2, 1, 15, 4, 1, 18, B.METAL);          // 高さ1の台
    g.sym4(2, 1, 18, 4, 1, 18, B.GLOW);
    g.sym4(2, 2, 15, 2, 3, 16, B.CRATE);          // 台の上の木箱
    g.sym4(5, 1, 23, 6, 2, 24, B.CRATE);
    g.sym4(3, 1, 8, 4, 1, 9, B.CRATE);
    g.sym4(8, 1, 3, 9, 2, 4, B.CRATE);

    /* v4: 屋外（さばくの 谷。外周は 砂岩の さく） */
    g.openShell(3, B.WALL, B.TRIM);

    const spawns = makeSpawns(g, [
      [13, 2, 1], [26, 2, 1], [16, 4, 1], [23, 4, 1], [18, 2, 1], [21, 2, 1], [15, 1, 1], [24, 1, 1]
    ]);
    return finish(g, spawns, env('desert', {
      palette: {
        1: [0.88, 0.78, 0.55], 2: [0.80, 0.62, 0.43], 3: [0.26, 0.64, 0.64], 4: [0.66, 0.46, 0.26],
        5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.66, 0.60, 0.52], 8: [0.40, 0.95, 1.0]
      },
      zone: { x0: 15, x1: 25, z0: 15, z1: 25, y0: 0.5, y1: 9 }      // エリア: 橋の上と下
    }));
  }

  /* ======================================================================
     ブロック倉庫（46×14×36）
     木箱の迷路と3本のレーン（左・中央・右）、まん中をよこぎる高さ5mのキャットウォーク
     ====================================================================== */
  function buildDepot() {
    const g = new Grid(46, 14, 36), T = 13;
    g.shell(B.FLOOR, B.WALL, B.TRIM);

    // 床の光るライン・かべぎわの ライトの柱（v4: 屋外なので 屋根の梁は なし）
    g.sym4(22, 0, 7, 22, 0, 14, B.GLOW);
    g.sym4(6, 0, 7, 6, 0, 13, B.GLOW);
    g.sym4(1, 1, 9, 1, 7, 9, B.METAL);
    g.sym4(1, 4, 9, 1, 4, 9, B.GLOW);
    g.sym4(1, 8, 9, 1, 8, 9, B.GLOW);
    g.capBarrier(1, 9, 9, 1, T, 9, true);

    // --- 陣地（内側 x 16..29, z 1..5）
    g.base(16, 29, 6, 5, 17, 3);
    g.sym4(16, 1, 9, 20, 2, 10, B.CRATE);         // 出口の前の目かくし（高さ3）
    g.sym4(16, 3, 9, 20, 3, 10, B.TRIM);

    // --- キャットウォーク（高さ5m）x 2..43, z 16..19
    g.fill(2, 4, 16, 43, 4, 19, B.METAL);
    g.fill(2, 4, 16, 43, 4, 16, B.GLOW);
    g.fill(2, 4, 19, 43, 4, 19, B.GLOW);
    g.sym(9, 1, 16, 9, 3, 16, B.METAL);           // 支柱
    g.sym(9, 1, 19, 9, 3, 19, B.METAL);
    g.sym(22, 1, 16, 22, 3, 16, B.METAL);
    g.sym(22, 1, 19, 22, 3, 19, B.METAL);
    g.sym(15, 5, 17, 15, 5, 18, B.CRATE);         // キャットウォークの上のカバー
    g.sym(29, 5, 17, 29, 5, 17, B.CRATE);
    // 階段（1段ずつ）: 左はし（チーム0側）と木箱の山
    g.stairsZ(2, 4, 10, 1, 1, 3, 2, B.METAL);
    g.stairsZ(12, 13, 10, 1, 1, 3, 2, B.CRATE, true);

    // --- 木箱の迷路（チーム0側、左右対称）
    g.sym4(7, 1, 7, 9, 2, 8, B.CRATE);
    g.sym4(10, 1, 7, 10, 1, 8, B.CRATE);
    g.sym4(14, 1, 12, 15, 2, 14, B.CRATE);
    g.sym4(17, 1, 13, 19, 1, 13, B.TRIM);
    g.sym4(20, 1, 12, 21, 2, 12, B.CRATE);
    g.sym4(8, 1, 12, 9, 1, 13, B.CRATE);
    g.sym4(5, 1, 14, 6, 1, 14, B.TRIM);
    g.sym(26, 1, 14, 27, 1, 14, B.CRATE);         // 中央レーン（非対称の木箱）
    g.sym(24, 1, 17, 25, 1, 18, B.CRATE);         // キャットウォークの下
    g.sym(11, 1, 17, 12, 1, 18, B.TRIM);
    // 壁ぎわの台と箱
    g.sym(36, 1, 1, 42, 1, 3, B.METAL);
    g.sym(40, 2, 1, 42, 2, 1, B.CRATE);
    g.sym(2, 1, 3, 4, 2, 4, B.CRATE);
    g.sym(11, 1, 3, 12, 1, 4, B.CRATE);

    /* v4: 屋外（夕やけの コンテナ置き場。外周は コンクリートの さく） */
    g.openShell(3, B.WALL, B.TRIM);

    const spawns = makeSpawns(g, [
      [17, 2, 1], [28, 2, 1], [20, 4, 1], [25, 4, 1], [22, 2, 1], [23, 4, 1], [19, 1, 1], [26, 1, 1]
    ]);
    return finish(g, spawns, env('sunset', {
      palette: {
        1: [0.46, 0.46, 0.48], 2: [0.70, 0.68, 0.66], 3: [0.94, 0.54, 0.24], 4: [0.70, 0.50, 0.28],
        5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.48, 0.56, 0.64], 8: [1.0, 0.86, 0.40]
      },
      zone: { x0: 18, x1: 28, z0: 13, z1: 23, y0: 0.5, y1: 9 }      // エリア: まんなか（キャットウォークの上と下）
    }));
  }

  /* ======================================================================
     しゃげきじょう（24×12×36）: ひとりで武器をためす場所
     スポーンは z の奥、的は -z 方向にならぶ（的どうしは 2.5m 以上はなす）
     ====================================================================== */
  function buildRange() {
    const g = new Grid(24, 12, 36);
    g.shell(B.FLOOR, B.WALL, B.TRIM);
    g.fill(2, 1, 12, 6, 2, 15, B.METAL).fill(2, 2, 15, 6, 2, 15, B.GLOW);        // 左の台（高さ2）
    g.fill(17, 1, 12, 21, 2, 15, B.METAL).fill(17, 2, 15, 21, 2, 15, B.GLOW);    // 右の台
    g.fill(9, 1, 2, 14, 4, 5, B.WALL).fill(9, 4, 2, 14, 4, 5, B.METAL);          // 奥の塔（高さ4）
    g.fill(9, 3, 5, 14, 3, 5, B.GLOW);
    g.fill(7, 1, 13, 7, 1, 14, B.CRATE).fill(16, 1, 13, 16, 1, 14, B.CRATE);    // 台への段（ジャンプの練習）
    g.fill(17, 1, 3, 17, 1, 4, B.CRATE).fill(16, 1, 3, 16, 2, 4, B.CRATE).fill(15, 1, 3, 15, 3, 4, B.CRATE);   // 塔への階段
    g.fill(6, 1, 34, 17, 1, 34, B.TRIM).fill(6, 0, 33, 17, 0, 33, B.GLOW);      // うしろのカウンター
    for (const z of [26, 21, 16, 11, 6]) g.fill(1, 0, z, 22, 0, z, B.GLOW);     // 5m ごとの線
    g.fill(1, 1, 1, 22, 1, 1, B.RED).fill(1, 1, 34, 4, 1, 34, B.BLUE).fill(19, 1, 34, 22, 1, 34, B.BLUE);
    g.fill(1, 1, 22, 1, 2, 24, B.CRATE).fill(22, 1, 8, 22, 2, 10, B.CRATE);
    /* v4: 屋外の しゃげきじょう（外周は 木の さく） */
    g.openShell(2, B.CRATE, B.TRIM);
    const h = CS.PLAYER.half + 0.002;
    const spawn = () => ({ p: [12.5, 1 + h, 30.5], yaw: 0 });
    const map = finish(g, [[spawn()], [spawn()]], env('day', {
      palette: {
        1: [0.46, 0.70, 0.36], 2: [0.76, 0.72, 0.64], 3: [0.84, 0.46, 0.32], 4: [0.64, 0.45, 0.26],
        5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.62, 0.62, 0.64], 8: [1.0, 0.86, 0.45]
      }
    }));
    // 3の倍数+2 番目の的は左右にゆれる（game.js）
    map.targets = [
      [8.5, 1 + h, 25.5], [16.5, 1 + h, 25.5], [12.5, 1 + h, 21.5],
      [5.5, 1 + h, 18.5], [19.5, 1 + h, 18.5], [12.5, 1 + h, 11.5],
      [4.5, 3 + h, 13.5], [8.5, 2.6, 16.5], [19.5, 3 + h, 13.5],
      [11.5, 5 + h, 3.5], [16.5, 4.2, 8.5], [6.5, 3.4, 7.5]
    ];
    return map;
  }

  /* ======================================================================
     そよかぜ高原（48×16×48）: 青空の下の屋外ステージ
     まんなかを川が横切り、橋は3本（まんなかの橋は手すりつき）。
     それぞれの側に 木の生えた2段の丘 と 中に入れる小さな家。外周は のぼれない生け垣。
     ブロック 9〜14 はこのマップだけの色（葉・水・土・花・しっくい・こい葉）。どれも ふつうの固いブロック
     ====================================================================== */
  function buildMeadow() {
    const g = new Grid(48, 16, 48);
    const GRASS = B.FLOOR, STONE = B.WALL, ROOF = B.TRIM, WOOD = B.CRATE, PATH = B.METAL, LAMP = B.GLOW;
    const LEAF = 9, WATER = 10, DIRT = 11, FLOWER = 12, PLASTER = 13, LEAF2 = 14;
    const tree = (x, z, y0, big) => {                       // 木（sym で両側に）
      g.sym(x, y0, z, x, y0 + (big ? 3 : 2), z, WOOD);
      const ly = y0 + (big ? 3 : 2);
      g.sym(x - 1, ly, z - 1, x + 1, ly + 1, z + 1, LEAF);
      g.sym(x, ly + 2, z, x, ly + 2, z, LEAF2);
    };
    const lamp = (x, z) => { g.sym(x, 1, z, x, 2, z, STONE); g.sym(x, 3, z, x, 3, z, LAMP); };

    g.fill(0, 0, 0, 47, 0, 47, GRASS);
    // 外周の生け垣（高さ3。ジャンプでは のぼれない）
    g.fill(0, 1, 0, 47, 3, 0, LEAF).fill(0, 1, 47, 47, 3, 47, LEAF).fill(0, 1, 0, 0, 3, 47, LEAF).fill(47, 1, 0, 47, 3, 47, LEAF);
    g.fill(0, 4, 0, 47, 4, 0, LEAF2).fill(0, 4, 47, 47, 4, 47, LEAF2).fill(0, 4, 0, 0, 4, 47, LEAF2).fill(47, 4, 0, 47, 4, 47, LEAF2);

    // --- 川（z 22..25）と橋
    g.fill(1, 0, 22, 46, 0, 25, WATER);
    g.fill(21, 1, 21, 26, 1, 26, WOOD);                     // まんなかの橋
    g.fill(21, 2, 21, 21, 2, 26, WOOD).fill(26, 2, 21, 26, 2, 26, WOOD);   // 手すり（高さ1のカバー）
    g.sym4(5, 1, 21, 8, 1, 23, WOOD);                        // はしの橋 2本
    g.sym4(2, 0, 20, 4, 0, 20, FLOWER).sym4(10, 0, 20, 12, 0, 20, FLOWER).sym4(15, 0, 21, 16, 0, 21, FLOWER);

    // --- 陣地（内側 x 16..31, z 1..5）と道
    g.base(16, 31, 6, 4, 18, 3);
    g.sym(16, 0, 1, 31, 0, 5, PATH);
    g.sym4(18, 0, 7, 20, 0, 20, DIRT);                        // 正面の出口 → まんなかの橋
    g.sym4(7, 0, 3, 14, 0, 4, DIRT).sym4(6, 0, 3, 7, 0, 20, DIRT);   // 横の出口 → はしの橋
    lamp(17, 8); lamp(30, 8); lamp(9, 19); lamp(38, 19);

    // --- 丘（2段・上に大きな木）
    g.sym(2, 1, 11, 12, 1, 17, GRASS);
    g.sym(4, 2, 12, 10, 2, 16, GRASS);
    g.sym(3, 2, 11, 3, 2, 11, FLOWER).sym(11, 2, 17, 11, 2, 17, FLOWER);
    tree(7, 14, 3, true);

    // --- 家（中に入れる。前と後ろに入口、横に光る窓）
    g.sym(32, 1, 10, 37, 3, 14, PLASTER);
    g.sym(33, 1, 11, 36, 3, 13, B.AIR);
    g.sym(34, 1, 10, 35, 2, 10, B.AIR).sym(34, 1, 14, 35, 2, 14, B.AIR);
    g.sym(32, 2, 12, 32, 2, 12, LAMP).sym(37, 2, 12, 37, 2, 12, LAMP);
    g.sym(31, 4, 9, 38, 4, 15, ROOF);
    g.sym(33, 5, 10, 36, 5, 14, ROOF);
    g.sym(34, 6, 11, 35, 6, 13, ROOF);
    g.sym(33, 0, 15, 36, 0, 16, DIRT);

    // --- 木・岩・柵（カバー）
    tree(24, 15, 1, false);
    tree(42, 8, 1, false);
    tree(14, 9, 1, false);
    g.sym(28, 1, 17, 29, 2, 18, STONE);                      // 大きな岩
    g.sym(13, 1, 18, 14, 1, 19, STONE);
    g.sym(19, 1, 17, 19, 1, 17, STONE);
    g.sym(40, 1, 15, 44, 1, 15, WOOD);                       // 柵
    g.sym(40, 1, 16, 40, 1, 18, WOOD);
    g.sym(24, 1, 9, 26, 1, 9, WOOD);

    /* 生け垣の上は 見えない かべ（ロケットジャンプでも 外に出ない） */
    g.openShell(4, LEAF, LEAF2);

    const spawns = makeSpawns(g, [
      [17, 2, 1], [30, 2, 1], [20, 4, 1], [27, 4, 1], [22, 2, 1], [25, 2, 1], [19, 1, 1], [28, 1, 1]
    ]);
    return finish(g, spawns, env('day', {
      palette: {
        1: [0.40, 0.66, 0.32], 2: [0.66, 0.64, 0.60], 3: [0.74, 0.32, 0.24], 4: [0.58, 0.40, 0.22],
        5: [0.96, 0.30, 0.37], 6: [0.25, 0.60, 1.0], 7: [0.62, 0.60, 0.56], 8: [1.0, 0.86, 0.5],
        9: [0.27, 0.56, 0.25], 10: [0.30, 0.60, 0.90], 11: [0.64, 0.50, 0.33], 12: [1.0, 0.62, 0.78],
        13: [0.93, 0.91, 0.86], 14: [0.2, 0.44, 0.2]
      },
      zone: { x0: 19, x1: 29, z0: 19, z1: 29, y0: 0.5, y1: 8 }      // エリア: まんなかの橋のまわり
    }));
  }

  /* 塔のぼり（tower.js）・じぶんのマップ（custommaps.js）がマップを作るための道具 */
  CS.MapKit = { Grid: Grid, makeSpawns: makeSpawns, finish: finish, DEFAULT_PAL: DEFAULT_PAL, env: env, ENV: ENV, BARRIER: BARRIER };

  CS.Maps = {
    list: [
      { id: 'plaza', name: 'キューブ広場', en: 'CUBE PLAZA', desc: '青空の公園。まんなかの広場を とりあう、バランスのいいマップ', build: buildPlaza },
      { id: 'towers', name: 'ツインタワー', en: 'TWIN TOWERS', desc: 'さばくの谷。2つのタワーを橋がつなぐ。上をとるか、下をぬけるか', build: buildTowers },
      { id: 'depot', name: 'ブロック倉庫', en: 'BLOCK DEPOT', desc: '夕やけの コンテナ置き場。木箱の迷路と3本の道、上には長い橋', build: buildDepot },
      { id: 'meadow', name: 'そよかぜ高原', en: 'BREEZE HILLS', desc: '青空の屋外ステージ。川と3本の橋、木の丘と中に入れる家', build: buildMeadow }
    ],
    get(id) {
      for (const m of this.list) if (m.id === id) return m;
      return this.list[0];
    },
    practice: { id: 'range', name: 'しゃげきじょう', en: 'SHOOTING RANGE', desc: 'ひとりで武器とボムをためせる場所', build: buildRange }
  };
})();
