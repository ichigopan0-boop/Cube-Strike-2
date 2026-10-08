/* ==========================================================================
   CUBE STRIKE — bots.js
   コンピューター（CPU）の頭脳。オフラインの「コンピューターと対戦」専用で、
   オンラインの部屋には絶対に出てこない（§0）。

   const brain = CS.Bots.create({level, rng, idx, team})
   brain.think(dt, view) -> input    // CS.Input.poll() と同じ形 + slide
   brain.onDamaged(fromIdx, fromPos) // だれかに撃たれた（fromPos は [x,y,z] か null）
   brain.onRespawn()                 // 復活した（道・ねらい・タイマーを全部リセット）

   view = { time, world, smoke(a,b)->bool,
            self:{idx, team, pos, vel, yaw, pitch, eye, grounded, alive, hp, protect, sliding,
                  gun, ammo, reloading, bomb, bombCharges},
            players:[{idx, team, pos, vel, alive, protect, sliding, hp, safeUntil}],   // 自分が入っていてもよい
            // ここから下は なくてもよい（ルールを考えて動くため）
            rule: 'kills'|'time'|'stock'|'area'|'tower', score:[a,b], timeLeft(秒), sudden(サドンデス),
            zone: エリアの箱 {x0,x1,y0,y1,z0,z1,cx,cz} | null, zoneOwner(-1|0|1), zoneFight, goals: エリアの中の足場 [[x,y,z]...],
            foeSpawn: {pts:[[x,y,z]...], r} 敵チームの出撃地点のまわり（敵の陣地）, avoidSpawn: そこへ入らない,
            chase: [x,y,z]（塔のぼり: いつも そこへ向かう）,
            prio: 見えたら 先に ねらう相手の idx（v5 キングバトル: あいての キング。-1 = なし） }
   リスキルしない: players[i].safeUntil が view.time より先で、その人が まだ じぶんの陣地にいるあいだは
   見えないことにする（ねらわない・追わない）。撃ってきたら やりかえす。
   返す input オブジェクトは brain が持っていて、次の think() で上書きして使い回す（毎フレームのゴミを出さない）。

   input は {mx, mz, lookX, lookY, fire, firePressed, fireReleased, ads, jump, bomb, reload, slide}
   （board / menu も false で入っているので poll() の返り値とそのまま差しかえられる）。
   jump / bomb / reload / slide / firePressed / fireReleased は「押した瞬間」だけ true。
   self.eye は中心からの高さ（0.3 など）でも [x,y,z] でもよい。view.time は使わず自前の時計で数える。

   ほかに公開しているもの（UI・デバッグ・テスト用）:
     CS.Bots.LEVELS / LEVEL_IDS / RANGES / rangeFor(gunDef) / randomLoadout(rng)->{gun,bomb}
     brain.level, brain.mode（'flee'|'fight'|'hunt'|'roam'|'retreat'）, brain.goal, brain.stats

   ルール: 壁ごし・スモークごしには見えない（world.lineClear + view.smoke）、視野 120°、
   撃たれたらそちらを向く、navPath の道をたどる（1ブロック上がりはジャンプ）、
   動けなくなったら ジャンプ → 横にずれる → 道を引き直す → 目的地を変える、
   銃ごとの得意な距離を保つ、安全なときにリロード。navPath は1体あたり 0.5秒に1回まで。
   しあいのルールも考える:
     エリア … ひまなときは いつもエリアへ。エリアの外で撃ちあいになったら、撃ちながら エリアへ向かう
              （とられている・だれもいない・とりあい中のとき）。エリアの中では エリアから出ないように戦い、
              エリアから遠くの敵は 追いかけない
     ストック … HP が へったら 下がって回復（のこり回数を だいじに）
     タイム・サドンデス … 負けていて のこり時間が少ないときは 敵をさがしに行く
     ぜんぶ … 敵の陣地（出撃地点のまわり）には 入らない。出てきたばかりの敵は ねらわない（リスキルしない）
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const clamp = CS.clamp, wrap = CS.wrapAngle;
  const DEG = Math.PI / 180;

  const PITCH_MAX = 1.4;       // game 側の上下の限界（1.45）より少し内側
  const REPATH_MIN = 0.5;      // navPath は 0.5秒に1回まで
  const VIEW_MAX = 60;         // これより遠い敵は見えない
  const MEMORY = 3.5;          // 見失った敵の場所を覚えている秒数
  const THROW_LIFT = 0.13;     // ボムは視線より少し上へ投げられる（game.js の投げ方と同じ）
  const SCOPED = { dmr: 1, sniper: 1, crossbow: 1, rail: 1 };   // 必ずのぞいてから撃つ銃
  const BODY_R = 0.44;         // 道のショートカットで見る体の半分の幅（体は 0.48。かべに触れていても内側に入らない）
  const ZONE_NEAR = 6;         // エリアのルール: エリアから これより遠い敵は 追いかけない
  const SAFE_HURT = 3;         // 出てきたばかりの敵でも、撃たれたら この秒数は やりかえす
  const STOCK_RETREAT = 30;    // ストックのルール: HP がこれより へったら 下がる（よわい・逃げるだけ はのぞく）
  const SEEK_TIME = 60;        // タイムのルール: 負けていて のこりが これより少ないと 敵をさがしに行く
  const ROAM_MARGIN = 3;       // ぶらぶら歩く先は 敵の陣地から さらに これだけ はなす
  const AVOID_COST = 10, AVOID_EXPAND = 9000;   // 道さがし: 敵の陣地の足場 1つごとの 遠まわり分 / そのときの 探す上限

  /* ---------- 強さ ----------
     reaction: 見つけてから撃ち始めるまで(秒) / aimErr: ねらいのブレ(度)。同じ相手を追い続けると
     aimMin 倍まで aimShrink 秒くらいで小さくなる / turn: 最大の旋回速度(rad/s) / gain: ねらいの追いつき方
     lead: 動く相手への先読み(0..1) / headBias: 少し上をねらう(m) / strafe: 撃ち合い中の横移動
     jumpRate, slideRate: 撃ち合い中(flee は逃げ中)の1秒あたりの回数 / near: 視野の外でも気づく距離
     hear: 足音で大体の場所がわかる距離(移動先を決めるだけ。撃つのは見えたときだけ)
     burst: [撃つ最短,最長, 休む最短,最長] 秒（null = 当たるあいだ撃ち続ける）
     semiSlow: 単発銃の連打のおそさ / adsRange: これより遠いとのぞく(0 = スコープ銃だけ)
     bombs: 0 なし / 1 ときどき / 2 かしこく / retreatHp: これより HP が減ったら下がって回復
     fleeRadius: flee がこの距離に敵が入ると逃げ道を引き直す
     keepProtect: 復活直後の無敵（5秒）を、遠い相手を撃ってムダにしない */
  const LEVELS = {
    flee: {
      id: 'flee', name: '逃げるだけ', desc: '相手は逃げ回るだけで撃ってこない',
      fire: false, bombs: 0, reaction: 0.25, aimErr: 0, aimMin: 1, aimShrink: 1, turn: 8, gain: 14,
      lead: 0, headBias: 0, strafe: 0, jumpRate: 0.7, slideRate: 0.5, fov: 120, near: 6, hear: 40,
      visEvery: 0.12, burst: null, semiSlow: 1, adsRange: 0, retreatHp: 0,
      bombEvery: 0, bombMin: 0, bombMax: 0, fleeRadius: 12, reloadFrac: 0, keepProtect: 0
    },
    easy: {
      id: 'easy', name: 'よわい', desc: 'ゆっくりねらって、ちょっとずつ撃つ',
      fire: true, bombs: 0, reaction: 0.8, aimErr: 7, aimMin: 0.6, aimShrink: 1.8, turn: 3, gain: 7,
      lead: 0.3, headBias: 0, strafe: 0, jumpRate: 0, slideRate: 0, fov: 120, near: 0, hear: 12,
      visEvery: 0.15, burst: [0.2, 0.4, 0.5, 0.9], semiSlow: 1.7, adsRange: 0, retreatHp: 0,
      bombEvery: 0, bombMin: 0, bombMax: 0, fleeRadius: 0, reloadFrac: 0.25, keepProtect: 0
    },
    normal: {
      id: 'normal', name: 'ふつう', desc: 'よけながら撃って、ときどきボムも投げる',
      fire: true, bombs: 1, reaction: 0.45, aimErr: 3.5, aimMin: 0.35, aimShrink: 1.3, turn: 6, gain: 12,
      lead: 0.8, headBias: 0.05, strafe: 0.8, jumpRate: 0.12, slideRate: 0.06, fov: 120, near: 3, hear: 18,
      visEvery: 0.1, burst: [0.45, 1.0, 0.2, 0.45], semiSlow: 1.25, adsRange: 14, retreatHp: 0,
      bombEvery: 12, bombMin: 6, bombMax: 18, fleeRadius: 0, reloadFrac: 0.35, keepProtect: 0
    },
    hard: {
      id: 'hard', name: 'つよい', desc: 'すばやくねらい、スライディングやボムも上手',
      fire: true, bombs: 2, reaction: 0.22, aimErr: 1.5, aimMin: 0.25, aimShrink: 0.8, turn: 10, gain: 22,
      lead: 1, headBias: 0.12, strafe: 1, jumpRate: 0.3, slideRate: 0.22, fov: 120, near: 5, hear: 24,
      visEvery: 0.07, burst: null, semiSlow: 1.05, adsRange: 10, retreatHp: 35,
      bombEvery: 7, bombMin: 4, bombMax: 20, fleeRadius: 0, reloadFrac: 0.5, keepProtect: 1
    }
  };

  /* ---------- 銃ごとの得意な距離 [近すぎ, ちょうどいい, 遠すぎ, 撃つ最大距離] (m) ---------- */
  const RANGES = {
    shotgun: [2, 5, 8, 16], double: [2, 4, 7, 12], flame: [2, 4, 6, 7.2],
    smg: [4, 9, 14, 28], dual: [4, 9, 14, 28], minigun: [6, 12, 18, 40], laser: [6, 14, 22, 40],
    ar: [8, 15, 24, 60], lmg: [8, 16, 26, 60], burst: [8, 16, 24, 60], plasma: [6, 13, 20, 50],
    needler: [6, 12, 18, 45], ricochet: [8, 15, 24, 60], magnum: [7, 13, 20, 50],
    dmr: [12, 20, 30, 80], sniper: [16, 26, 40, 120], rail: [14, 24, 38, 120], crossbow: [14, 22, 34, 90],
    rocket: [7, 13, 20, 50], grenade: [7, 12, 17, 26]
  };
  function rangeFor(g) {
    if (!g) return RANGES.ar;
    const r = RANGES[g.id];
    if (r) return r;
    /* 知らない銃は形から決めて、次からは使い回す（毎フレームの new を作らない） */
    let v;
    if (g.type === 'flame') { const f = (g.flame && g.flame.range) || 7; v = [2, f * 0.55, f * 0.85, f]; }
    else {
      const R = g.range > 0 ? g.range : 60;
      v = g.pellets > 1 ? [2, 5, 8, Math.min(R, 16)]
        : [Math.min(8, R * 0.2), Math.min(16, R * 0.35), Math.min(26, R * 0.55), R];
    }
    if (g.id) RANGES[g.id] = v;
    return v;
  }

  /* ---------- 小物 ---------- */
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);       // この向きを見ると (dx,dz) が正面
  /* 速さ v・重力 g で水平 x・高さ y の点に当てる低い方の仰角。届かなければ 45° */
  function ballistic(v, g, x, y) {
    if (!(g > 0) || !(v > 0)) return Math.atan2(y, Math.max(x, 1e-3));
    if (x < 0.05) return y >= 0 ? 1.2 : -1.2;
    const v2 = v * v, disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
    if (disc < 0) return Math.PI / 4;
    return Math.atan((v2 - Math.sqrt(disc)) / (g * x));
  }
  const d2h = (a, b) => { const x = a[0] - b[0], z = a[2] - b[2]; return x * x + z * z; };   // 水平きょりの2乗
  const set3 = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
  const cp3 = (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; };
  const hasNav = (w) => !!(w && typeof w.navPath === 'function' && typeof w.navRandom === 'function' && typeof w.navPos === 'function');
  /* エリアの箱の中か / 箱までの横のきょり（中なら 0） */
  const inBox = (z, p) => !!z && !!p && p[0] >= z.x0 && p[0] <= z.x1 && p[2] >= z.z0 && p[2] <= z.z1 && p[1] >= z.y0 && p[1] <= z.y1;
  function boxDist(z, p) {
    const dx = p[0] < z.x0 ? z.x0 - p[0] : p[0] > z.x1 ? p[0] - z.x1 : 0;
    const dz = p[2] < z.z0 ? z.z0 - p[2] : p[2] > z.z1 ? p[2] - z.z1 : 0;
    return Math.sqrt(dx * dx + dz * dz);
  }

  const NO_PLAYERS = [];
  const FLEE_SAMPLES = 12;            // 逃げ先をさがすときに見るノードの数
  const rr = (a, b, rnd) => a + (b - a) * rnd();

  /* ==========================================================================
     頭脳ひとつ分。think() は毎フレーム呼ばれるので、ここでは
       ・new を作らない（入れ物は全部コンストラクタで用意して使い回す）
       ・navPath は 0.5秒に1回だけ
       ・lineClear は「見えるか」と「道のショートカット」でほんの数回だけ
     を守る。
     ========================================================================== */
  class Brain {
    constructor(opt) {
      opt = opt || {};
      const cfg = LEVELS[opt.level] || LEVELS.normal;
      this.cfg = cfg;
      this.level = cfg.id;
      this.idx = opt.idx | 0;
      this.team = opt.team | 0;
      this.rng = (typeof opt.rng === 'function') ? opt.rng : CS.rng((this.idx * 2654435761 + 0x9E3779B9) >>> 0);

      /* 返す入力は1個だけ。毎回上書きして使い回す */
      this.input = {
        mx: 0, mz: 0, lookX: 0, lookY: 0,
        fire: false, firePressed: false, fireReleased: false, ads: false,
        jump: false, bomb: false, reload: false, slide: false, board: false, menu: false
      };
      /* 使い回す入れ物 */
      this._ev = [0, 0, 0];   // 目の位置
      this._tp = [0, 0, 0];   // 相手を最後に見た場所
      this._tv = [0, 0, 0];   // そのときの相手の速さ
      this._hp = [0, 0, 0];   // 音で気づいた場所
      this._gp = [0, 0, 0];   // 目的地
      this._bp = [0, 0, 0];   // ボムを落としたい場所
      this._pt = [0, 0, 0];   // その場かぎりの点
      this._lp = [0, 0, 0];   // 前に進めているか見るための位置
      this._fp = [0, 0, 0];   // いちばん近い敵の場所（逃げるとき用）
      this._q = [0, 0, 0];    // navPos の受け皿（out を無視する実装でも戻り値を使うので安全）
      this._wa = [0, 0, 0]; this._wb = [0, 0, 0];   // _wideClear の線のはし
      this._np = [0, 0, 0];   // 1歩先（エリア・敵の陣地の さかいを見る）
      this.foeKnown = false;

      this.goal = this._gp;             // 外から見たい人用（テスト・デバッグ）
      this.stats = { paths: 0, stuck: 0, shots: 0, bombs: 0, reloads: 0, jumps: 0, slides: 0 };
      this.t = 0;                       // 自前の時計（秒）。view.time の単位に左右されない
      this.tick = 0;
      this.path = null;
      this.mode = cfg.fire ? 'roam' : 'flee';
      this.reset();
    }

    /* 状態を全部まっさらに（復活したとき・作ったとき）。時計と成績はそのまま */
    reset() {
      const now = this.t;
      this.tgt = -1; this.tgtVis = false; this.tgtDist = 0; this.tgtProtect = false;
      this.seenT = -99; this.lostT = -99; this.seeT = -99; this.track = 0;
      this.hasMem = false; this.memT = -99;
      this.heard = false; this.heardT = -99;
      this.huntSrc = null;                // 追いかける場所（this._tp か this._hp）
      this.fireAt = 1e9; this.prevFire = false; this.semiCd = 0; this.shotT = -99;
      this.burstOn = false; this.burstT = 0; this.adsT = 0;
      this.nextBomb = now + 1.5 + this.rng() * 4; this.bombing = false; this.bombT = 0;
      this.reloadCd = 0;
      this.path = null; this.pi = 0; this.pathT = -99; this.planT = -99; this.hasGoal = false;
      this.progT = now; this.stuckLv = 0; this.sideT = -99; this.sideDir = 1;
      this.strafeDir = this.rng() < 0.5 ? -1 : 1; this.strafeT = -99;
      this.jumpT = -99; this.slideT = -99;
      this.ny = 0; this.np = 0; this.nyT = 0; this.npT = 0; this.nextNoise = -99;
      this.hurtT = -99; this.hurtIdx = -1; this.hasHurt = false;
      this.retreat = false; this.retreatT = -99;
      this.aimOff = Math.PI;
      this._dx = 0; this._dz = 0; this._jmp = false; this._mdx = 0; this._mdz = 0;
      this.mode = this.cfg.fire ? 'roam' : 'flee';
    }

    onRespawn() { this.reset(); }

    /* 撃たれた: そちらを向く。逃げる子・下がっている子はすぐ道を引き直す */
    onDamaged(fromIdx, fromPos) {
      const now = this.t;
      this.hurtT = now; this.hasHurt = true;
      this.hurtIdx = (typeof fromIdx === 'number') ? (fromIdx | 0) : -1;
      if (fromPos && fromPos.length >= 3) {
        cp3(this._hp, fromPos); this.heard = true; this.heardT = now;
        if (!this.tgtVis) {
          cp3(this._tp, fromPos); set3(this._tv, 0, 0, 0);
          this.hasMem = true; this.memT = now;
          if (this.tgt < 0 && this.hurtIdx >= 0) this.tgt = this.hurtIdx;
        }
      }
      if (!this.cfg.fire || this.retreat) { this.planT = -99; this.path = null; }
      this.seeT = -99;                 // すぐ周りを見直す
    }

    /* ------------------------------------------------------------------ */
    think(dt, view) {
      const inp = this._clear();
      if (!view || !view.self || !view.self.pos) return inp;
      const self = view.self;
      dt = (typeof dt === 'number' && dt > 0) ? (dt > 0.25 ? 0.25 : dt) : (1 / 60);
      const now = (this.t += dt);
      this.tick++;
      if (self.alive === false) { this.prevFire = false; return inp; }

      this._eyeOf(self, this._ev);
      /* 1) 見る（強さごとの間隔で。ずっと毎フレームは調べない） */
      if (now >= this.seeT) { this.seeT = now + this.cfg.visEvery; this._perceive(view, now); }
      if (this.tgtVis) this.track += dt;
      if (this.hasMem && now - this.memT > MEMORY) { this.hasMem = false; if (!this.tgtVis) this.tgt = -1; }
      if (this.heard && now - this.heardT > 6) this.heard = false;

      /* 2) いまの気分を決める */
      this._decide(view, now);
      /* 3) 動く（世界の向きを決める） */
      this._move(view, now, dt, inp);
      /* 4) ねらう */
      this._aim(view, now, dt, inp);
      /* 5) 向きが決まったので、進みたい方向を自分から見た mx/mz に直す */
      this._toLocal(self, inp);
      /* 6) 撃つ・投げる・リロード */
      this._act(view, now, dt, inp);

      /* 安全弁: 「逃げるだけ」は何があっても撃たない・投げない */
      if (!this.cfg.fire) { inp.fire = false; inp.firePressed = false; inp.fireReleased = false; inp.ads = false; }
      if (!this.cfg.bombs) inp.bomb = false;
      return inp;
    }

    _clear() {
      const i = this.input;
      i.mx = 0; i.mz = 0; i.lookX = 0; i.lookY = 0;
      i.fire = false; i.firePressed = false; i.fireReleased = false; i.ads = false;
      i.jump = false; i.bomb = false; i.reload = false; i.slide = false;
      i.board = false; i.menu = false;
      return i;
    }

    /* 目の位置。self.eye は [x,y,z] でも、中心からの高さ(0.3 など)でもよい。
       1ブロックの体なので「中心からの高さ」は 0.5 未満。それより大きい数はワールドの高さとみなす。 */
    _eyeOf(self, out) {
      const e = self.eye;
      if (e && e.length >= 3) { out[0] = e[0]; out[1] = e[1]; out[2] = e[2]; return out; }
      out[0] = self.pos[0];
      out[2] = self.pos[2];
      const h = (typeof e === 'number' && e === e) ? e : CS.PLAYER.eye;
      out[1] = h > 0.9 ? h : self.pos[1] + h;
      return out;
    }

    /* 目から (x,y,z) が見えるか。壁ごし・煙ごしはダメ */
    _los(view, eye, x, y, z) {
      const w = view.world, p = this._pt;
      p[0] = x; p[1] = y; p[2] = z;
      if (w && typeof w.lineClear === 'function' && !w.lineClear(eye, p)) return false;
      if (typeof view.smoke === 'function' && view.smoke(eye, p)) return false;
      return true;
    }

    _live(view, idx) {
      const list = view.players || NO_PLAYERS;
      for (let i = 0; i < list.length; i++) if (list[i] && list[i].idx === idx) return list[i];
      return null;
    }

    /* ---------- ルールを考えるための小物 ---------- */
    /* p は 敵の陣地（敵の出撃地点のまわり）の中か。エリアの中は ちがう（エリアが近いマップでも とりあえるように）。
       margin を足すと 陣地の まわりも ふくめる（ぶらぶら歩く先は 陣地の出口の前も えらばない） */
    _inFoeBase(view, p, margin) {
      const fs = view.foeSpawn;
      if (!fs || !fs.pts || !fs.pts.length || !p) return false;
      if (view.zone && inBox(view.zone, p)) return false;
      const r = fs.r + (margin || 0), r2 = r * r;
      for (let i = 0; i < fs.pts.length; i++) {
        const s = fs.pts[i], dx = p[0] - s[0], dz = p[2] - s[2];
        if (dx * dx + dz * dz < r2 && Math.abs(p[1] - s[1]) < 4) return true;
      }
      return false;
    }
    _avoid(view) { return !!view.avoidSpawn && !!view.foeSpawn; }
    /* 出てきたばかりで まだ じぶんの陣地にいる敵（リスキルしない）。撃ってきた相手には やりかえす */
    _safeFoe(view, p, now) {
      if (!(p.safeUntil > view.time)) return false;
      if (this.hasHurt && p.idx === this.hurtIdx && now - this.hurtT < SAFE_HURT) return false;
      return this._inFoeBase(view, p.pos);
    }
    /* そこへ 追いかけに行ってよいか（敵の陣地の中はダメ / エリアのルールでは エリアの近くだけ） */
    _huntOk(view, src) {
      if (this._avoid(view) && this._inFoeBase(view, src)) return false;
      if (view.zone && view.goals && view.goals.length && boxDist(view.zone, src) > ZONE_NEAR) return false;
      return true;
    }
    /* エリアのルール: エリアの外にいて、エリアへ向かうべきか
       （だれもいない・とられている・とりあい中。なかまが とっていても エリアから はなれすぎたら もどる） */
    _pushZone(view) {
      const z = view.zone, pos = view.self.pos;
      if (!z || !view.goals || !view.goals.length || inBox(z, pos)) return false;
      return view.zoneOwner !== this.team || !!view.zoneFight || boxDist(z, pos) > ZONE_NEAR;
    }
    /* タイムのルールで負けていて のこりが少ない / サドンデス（エリアのルールはのぞく）: 敵をさがしに行く */
    _wantSeek(view) {
      if (view.zone || view.rule === 'tower' || view.chase) return false;
      if (view.sudden) return true;
      const s = view.score;
      return view.rule === 'time' && view.timeLeft < SEEK_TIME && !!s && s[this.team] <= s[1 - this.team];
    }
    /* いちばん近い「ねらってよい」敵（さがしに行く先）。いなければ null */
    _seekFoe(view, now) {
      const self = view.self, list = view.players || NO_PLAYERS;
      let best = null, bd = 1e18;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.pos || p.team === self.team || p.alive === false) continue;
        if (this._safeFoe(view, p, now) || (this._avoid(view) && this._inFoeBase(view, p.pos))) continue;
        const d = d2h(self.pos, p.pos);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    /* ストックのルールでは ふつう・つよい も HP が へったら下がる */
    _retreatHp(view) {
      const cfg = this.cfg;
      if (view.rule === 'stock' && cfg.fire && cfg.id !== 'easy') return Math.max(cfg.retreatHp, STOCK_RETREAT);
      return cfg.retreatHp;
    }
    /* ぶらぶら歩く先: 敵の陣地と その出口の前（+ROAM_MARGIN m）は えらばない（何回か引きなおす） */
    _roamNode(view) {
      const world = view.world;
      if (!this._avoid(view)) return world.navRandom(this.rng);
      const pts = view.foeSpawn.pts;
      let best = -1, bestD = -1;
      for (let k = 0; k < 10; k++) {
        const n = world.navRandom(this.rng);
        if (n < 0) return -1;
        const q = world.navPos(n, this._q);
        if (!this._inFoeBase(view, q, ROAM_MARGIN)) return n;
        /* 小さいマップで みつからないときは 敵の陣地から いちばん遠いもの */
        let d = 1e9;
        for (let i = 0; i < pts.length; i++) d = Math.min(d, Math.hypot(q[0] - pts[i][0], q[2] - pts[i][2]));
        if (d > bestD) { bestD = d; best = n; }
      }
      return best;
    }

    /* ---------- 見る ---------- */
    _perceive(view, now) {
      const cfg = this.cfg, self = view.self, eye = this._ev;
      const cy = Math.cos(self.yaw), sy = Math.sin(self.yaw);
      const cp = Math.cos(self.pitch), sp = Math.sin(self.pitch);
      const fx = -sy * cp, fy = sp, fz = -cy * cp;         // 視線の向き
      const cosFov = Math.cos(cfg.fov * 0.5 * DEG);
      const list = view.players || NO_PLAYERS;
      let best = -1, bestScore = 1e9, bestD = 0, bestP = null;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.pos || p.idx === self.idx || p.team === self.team || p.alive === false) continue;
        if (this._safeFoe(view, p, now)) continue;        // 出てきたばかり（リスキルしない）: 見ない・追わない
        const dx = p.pos[0] - eye[0], dy = (p.pos[1] + 0.1) - eye[1], dz = p.pos[2] - eye[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > VIEW_MAX) continue;
        const inv = d > 1e-4 ? 1 / d : 0;
        let notice = (dx * fx + dy * fy + dz * fz) * inv >= cosFov || d <= cfg.near;
        if (!notice && this.hasHurt && p.idx === this.hurtIdx && now - this.hurtT < 2.5) notice = true;
        if (notice && this._los(view, eye, p.pos[0], p.pos[1] + 0.1, p.pos[2])) {
          let score = d;
          if (p.idx === this.tgt) score *= 0.7;          // いまの相手を優先（ふらふら乗りかえない）
          if (p.protect) score *= 2.5;                   // 無敵の相手はあとまわし
          if (view.prio >= 0 && p.idx === view.prio) score *= 0.45;   // v5: キングバトル: あいての キングを ねらう
          if (score < bestScore) { bestScore = score; best = p.idx; bestD = d; bestP = p; }
        } else if (d <= cfg.hear) {                      // 見えなくても足音でだいたいわかる
          cp3(this._hp, p.pos); this.heard = true; this.heardT = now;
        }
      }
      if (best >= 0) {
        if (best !== this.tgt || now - this.seenT > 0.7) {
          this.tgt = best; this.track = 0;
          this.fireAt = now + cfg.reaction * (0.8 + 0.4 * this.rng());
          this.burstT = 0; this.burstOn = false;
        }
        this.seenT = now; this.tgtVis = true; this.tgtDist = bestD; this.tgtProtect = !!bestP.protect;
        cp3(this._tp, bestP.pos);
        if (bestP.vel) cp3(this._tv, bestP.vel); else set3(this._tv, 0, 0, 0);
        this.hasMem = true; this.memT = now;
      } else if (this.tgtVis) {
        this.tgtVis = false; this.lostT = now;
      }
    }

    /* ---------- いまの気分 ---------- */
    _decide(view, now) {
      const cfg = this.cfg, self = view.self;
      if (!cfg.fire) { this.mode = 'flee'; return; }
      const rh = this._retreatHp(view);
      if (rh > 0 && typeof self.hp === 'number') {
        if (!this.retreat) {
          if (self.hp > 0 && self.hp < rh && !self.protect && (this.tgtVis || now - this.hurtT < 4)) {
            this.retreat = true; this.retreatT = now; this.planT = -99; this.path = null;
          }
        } else if (self.hp >= Math.min(100, rh + 35) || now - this.retreatT > 9) {
          this.retreat = false;
        }
      }
      if (this.retreat) { this.mode = 'retreat'; return; }
      if (this.tgtVis) { this.mode = 'fight'; return; }
      /* 覚えている場所・聞こえた場所へ（新しいほう）。敵の陣地の中や、エリアから遠い所へは 行かない */
      this.huntSrc = null;
      const memOk = this.hasMem && now - this.memT < MEMORY && this._huntOk(view, this._tp);
      const hearOk = this.heard && now - this.heardT < 4 && this._huntOk(view, this._hp);
      if (memOk && (!hearOk || this.memT >= this.heardT)) this.huntSrc = this._tp;
      else if (hearOk) this.huntSrc = this._hp;
      this.mode = this.huntSrc ? 'hunt' : 'roam';
    }

    /* ---------- 動く ---------- */
    _move(view, now, dt, inp) {
      const cfg = this.cfg, self = view.self, world = view.world, pos = self.pos;
      const mode = this.mode;
      let dx = 0, dz = 0, jump = false, pushed = false;
      if (mode === 'fight' && now >= this.strafeT) { this.strafeDir = this.rng() < 0.5 ? -1 : 1; this.strafeT = now + rr(0.6, 1.8, this.rng); }

      /* エリアのルール: エリアの外で撃ちあいになったら、撃ちながら エリアへ向かう（道をたどる。ねらいは _aim が敵へ） */
      if (mode === 'fight' && hasNav(world) && this._pushZone(view)) {
        this._planZone(view, now);
        if (this._follow(view, now)) {
          const st = cfg.strafe * 0.35 * this.strafeDir;   // 少しだけ よこに ゆれて 当たりにくく
          dx = this._dx - this._dz * st; dz = this._dz + this._dx * st; jump = this._jmp;
          pushed = true;
        }
      }

      if (mode === 'fight' && !pushed) {
        /* 銃ごとの得意な距離を保ちながら、横に動いて当たりにくくする */
        const tx = this._tp[0] - pos[0], tz = this._tp[2] - pos[2];
        const d = Math.sqrt(tx * tx + tz * tz) || 1e-4;
        const ux = tx / d, uz = tz / d;
        const R = rangeFor(self.gun);
        let fwd = 0;
        if (d < R[0]) fwd = -1;
        else if (d > R[2]) fwd = 1;
        else if (d > R[1] + 1) fwd = 0.45;
        else if (d < R[1] - 1) fwd = -0.35;
        const st = cfg.strafe * this.strafeDir;
        dx = ux * fwd - uz * st;
        dz = uz * fwd + ux * st;
        /* エリアの中にいたら エリアから出ない。敵の陣地には 入らない（リスキルしない）
           → 前後は やめて横だけ → 反対の横 → それでもダメなら 止まる（エリアでは まんなかへ） */
        const inZone = !!view.zone && inBox(view.zone, pos), inBase = this._inFoeBase(view, pos);
        if ((dx !== 0 || dz !== 0) && this._stepBad(view, pos, dx, dz, inZone, inBase)) {
          let sx = -uz * st, sz = ux * st;
          if (this._stepBad(view, pos, sx, sz, inZone, inBase)) { sx = -sx; sz = -sz; this.strafeDir = -this.strafeDir; }
          if (this._stepBad(view, pos, sx, sz, inZone, inBase)) {
            if (inZone) { sx = view.zone.cx - pos[0]; sz = view.zone.cz - pos[2]; } else { sx = 0; sz = 0; }
          }
          dx = sx; dz = sz;
        }
        /* がけの手前で止まる（撃ち合い中だけ。道をたどっているときは飛びおりもアリ） */
        if (world && typeof world.solidAt === 'function' && (dx !== 0 || dz !== 0) && self.grounded !== false) {
          const l = Math.hypot(dx, dz), ax = dx / l, az = dz / l;
          const px = pos[0] + ax * 0.95, pz = pos[2] + az * 0.95, fy = pos[1] - CS.PLAYER.half - 0.1;
          if (!world.solidAt(px, fy, pz) && !world.solidAt(px, fy - 1, pz) && !world.solidAt(px, fy - 2, pz)) {
            dx = -ax * 0.6 - az * 0.8; dz = -az * 0.6 + ax * 0.8;
            this.strafeDir = -this.strafeDir;
          }
        }
      } else if (mode !== 'fight') {
        this._plan(view, now);
        if (this._follow(view, now)) { dx = this._dx; dz = this._dz; jump = this._jmp; }
        /* 逃げているとき、敵がすぐそばなら道よりも「とにかく反対がわ」を優先する */
        if (mode === 'flee' || mode === 'retreat') {
          const th = this._threat(view);
          if (th < 7 && this.foeKnown) {
            const ax = pos[0] - this._fp[0], az = pos[2] - this._fp[2];
            const al = Math.hypot(ax, az);
            if (al > 1e-3) {
              const k = clamp((7 - th) / 5, 0, 1);
              dx = dx * (1 - 0.7 * k) + (ax / al) * 1.3 * k;
              dz = dz * (1 - 0.7 * k) + (az / al) * 1.3 * k;
            }
          }
        }
      }

      /* 進めていないとき: ジャンプ → 横にずれる → 道を引き直す → 目的地を変える
         （横にどれだけ進んだかで見る。その場でジャンプしただけを「進んだ」と数えると、ずっと抜け出せない） */
      const wantMove = (dx !== 0 || dz !== 0);
      if (wantMove) {
        const mx = pos[0] - this._lp[0], mz = pos[2] - this._lp[2];
        if (mx * mx + mz * mz > 0.2) { cp3(this._lp, pos); this.progT = now; this.stuckLv = 0; }
        else if (now - this.progT > 1.0) {
          this.progT = now; this.stats.stuck++; this.stuckLv++;
          if (this.stuckLv === 1) jump = true;
          else if (this.stuckLv === 2) { jump = true; this.sideT = now + 0.6; this.sideDir = this.rng() < 0.5 ? -1 : 1; }
          else if (this.stuckLv === 3) { this.path = null; this.planT = -99; }
          else { this.path = null; this.planT = -99; this.hasGoal = false; this.stuckLv = 0; this.strafeDir = -this.strafeDir; }
        }
      } else { cp3(this._lp, pos); this.progT = now; }

      if (now < this.sideT && wantMove) {         // 横にずれてみる
        const l = Math.hypot(dx, dz), ax = dx / l, az = dz / l;
        dx = ax * 0.35 - az * this.sideDir;
        dz = az * 0.35 + ax * this.sideDir;
      }

      /* よけるジャンプ・スライディング */
      if (!jump && cfg.jumpRate > 0 && self.grounded !== false && now - this.jumpT > 0.6 &&
        (mode === 'fight' || mode === 'flee' || mode === 'retreat')) {
        if (this.rng() < cfg.jumpRate * dt) jump = true;
      }
      if (jump && self.grounded !== false) { inp.jump = true; this.jumpT = now; this.stats.jumps++; }

      if (cfg.slideRate > 0 && wantMove && self.grounded !== false && !self.sliding && now - this.slideT > 1.8 &&
        (mode === 'fight' || mode === 'flee' || mode === 'retreat')) {
        const v = self.vel;
        const sp = v ? Math.hypot(v[0], v[2]) : 99;
        if (sp > 2.5 && this.rng() < cfg.slideRate * dt) { inp.slide = true; this.slideT = now; this.stats.slides++; }
      }

      this._mdx = dx; this._mdz = dz;
    }

    _toLocal(self, inp) {
      let dx = this._mdx, dz = this._mdz;
      const l = Math.hypot(dx, dz);
      if (l < 1e-4) { inp.mx = 0; inp.mz = 0; return; }
      dx /= l; dz /= l;
      const cy = Math.cos(self.yaw), sy = Math.sin(self.yaw);
      inp.mx = dx * cy - dz * sy;       // 右 = ( cos yaw, 0, -sin yaw)
      inp.mz = -dx * sy - dz * cy;      // 前 = (-sin yaw, 0, -cos yaw)
    }

    /* ---------- 目的地と道 ---------- */
    _plan(view, now) {
      const world = view.world, self = view.self, cfg = this.cfg;
      if (!hasNav(world)) { this.path = null; return; }
      if (now - this.pathT < REPATH_MIN) return;       // navPath は 0.5秒に1回まで
      const mode = this.mode;

      if (mode === 'flee' || mode === 'retreat') {
        const rad = mode === 'retreat' ? 14 : cfg.fleeRadius;
        let need = !this.path || this.pi >= this.path.length || now - this.planT > 3.0;
        if (!need && this.hasGoal && d2h(self.pos, this._gp) < 9) need = true;      // もうすぐ着く
        if (!need && rad > 0 && now - this.planT > 0.6) {
          const th = this._threat(view);
          /* 追われていても、いまの逃げ先がまだ敵から十分はなれているなら走り続ける
             （毎回ちがう方向へ引き直すと、その場でウロウロして追いつかれる） */
          if (th < rad && this.foeKnown && Math.sqrt(d2h(this._gp, this._fp)) < th + 5) need = true;
        }
        if (need) this._away(view, now);
        return;
      }

      if (mode === 'hunt') {
        const src = this.huntSrc || this._tp;
        if (!this.hasGoal || !this.path || this.pi >= this.path.length || d2h(this._gp, src) > 4) {
          cp3(this._gp, src); this.hasGoal = true; this.planT = now;
          this._repath(view, now);
        }
        return;
      }

      /* 塔のぼり: いつも プレイヤーのほうへ向かう（view.chase = [x,y,z]）。
         プレイヤーが出てきたばかりで 陣地にいるあいだは 入っていかない（リスキルしない） */
      const chase = view.chase;
      if (chase && chase.length >= 3 && !(this._avoid(view) && this._inFoeBase(view, chase))) {
        if (!this.hasGoal || !this.path || this.pi >= this.path.length || now - this.planT > 2.5 || d2h(this._gp, chase) > 9) {
          cp3(this._gp, chase); this.hasGoal = true; this.planT = now;
          this._repath(view, now);
        }
        return;
      }

      /* エリアのルール: ひまなときは いつもエリアへ。エリアの中では 足場を かえながら まもる */
      const goals = view.goals;
      if (view.zone && goals && goals.length) {
        if (!this.hasGoal || !this.path || this.pi >= this.path.length || !inBox(view.zone, this._gp) ||
          now - this.planT > 6 || d2h(self.pos, this._gp) < 4) {
          cp3(this._gp, goals[Math.min(goals.length - 1, Math.floor(this.rng() * goals.length))]);
          this.hasGoal = true; this.planT = now;
          this._repath(view, now);
        }
        return;
      }

      /* 負けていて のこり時間が少ない・サドンデス: いちばん近い敵を さがしに行く */
      if (this._wantSeek(view)) {
        const f = this._seekFoe(view, now);
        if (f) {
          if (!this.hasGoal || !this.path || this.pi >= this.path.length || now - this.planT > 2.5 || d2h(this._gp, f.pos) > 16) {
            cp3(this._gp, f.pos); this.hasGoal = true; this.planT = now;
            this._repath(view, now);
          }
          return;
        }
      }

      /* ぶらぶら歩く（敵の陣地には 入らない。いまの目的地が 陣地の中なら えらびなおす） */
      if (!this.hasGoal || !this.path || this.pi >= this.path.length ||
        now - this.planT > 12 || d2h(self.pos, this._gp) < 4 || (this._avoid(view) && this._inFoeBase(view, this._gp))) {
        const n = this._roamNode(view);
        if (n >= 0) {
          cp3(this._gp, world.navPos(n, this._q)); this.hasGoal = true; this.planT = now;
          this._repath(view, now);
        } else { this.pathT = now; }
      }
    }

    /* エリアの中の足場へ（撃ちあいながら エリアへ向かうとき） */
    _planZone(view, now) {
      if (now - this.pathT < REPATH_MIN) return;
      const goals = view.goals;
      if (!this.hasGoal || !this.path || this.pi >= this.path.length || !inBox(view.zone, this._gp) || now - this.planT > 8) {
        cp3(this._gp, goals[Math.min(goals.length - 1, Math.floor(this.rng() * goals.length))]);
        this.hasGoal = true; this.planT = now;
        this._repath(view, now);
      }
    }

    /* (dx,dz) の向きに 1歩すすむと、エリアから出てしまう（いまエリアの中）/ 敵の陣地に入ってしまう（いま外）か */
    _stepBad(view, pos, dx, dz, inZone, inBase) {
      const l = Math.hypot(dx, dz);
      if (l < 1e-4) return false;
      const q = this._np;
      q[0] = pos[0] + dx / l * 0.9; q[1] = pos[1]; q[2] = pos[2] + dz / l * 0.9;
      if (inZone && !inBox(view.zone, q)) return true;
      if (!inBase && this._avoid(view) && this._inFoeBase(view, q)) return true;
      return false;
    }

    _repath(view, now) {
      const world = view.world;
      this.pathT = now; this.stats.paths++;
      /* 敵の陣地の中は なるべく 通らない道（遠まわりでも）。陣地の中を通る道しかなければ 通る */
      const fs = view.foeSpawn, mask = this._avoid(view) && fs && fs.mask ? fs.mask : null;
      const p = mask ? world.navPath(view.self.pos, this._gp, AVOID_EXPAND, mask, AVOID_COST) : world.navPath(view.self.pos, this._gp);
      if (p && p.length) { this.path = p; this.pi = 0; return true; }
      this.path = null; this.pi = 0; return false;
    }

    /* いちばん近い敵との距離（見えていなくても、逃げるためだけに使う）。場所は this._fp に */
    _threat(view) {
      const self = view.self, list = view.players || NO_PLAYERS;
      let bd = 1e9, bp = null;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.pos || p.idx === self.idx || p.team === self.team || p.alive === false) continue;
        const d = d2h(self.pos, p.pos);
        if (d < bd) { bd = d; bp = p; }
      }
      if (bp) { cp3(this._fp, bp.pos); this.foeKnown = true; return Math.sqrt(bd); }
      this.foeKnown = false;
      return 1e9;
    }

    /* 敵から遠くて、できれば敵から見えないノードへ逃げる */
    _away(view, now) {
      const world = view.world, self = view.self, pos = self.pos;
      let have = this._threat(view) < 1e8;
      let ex = this._fp[0], ey = this._fp[1], ez = this._fp[2];
      if (!have && this.hasMem) { ex = this._tp[0]; ey = this._tp[1]; ez = this._tp[2]; have = true; }
      if (!have) {                       // だれもいない: 適当に歩く
        const n = world.navRandom(this.rng);
        if (n >= 0) { cp3(this._gp, world.navPos(n, this._q)); this.hasGoal = true; this.planT = now; this._repath(view, now); }
        else this.pathT = now;
        return;
      }
      const eye = this._pt;
      eye[0] = ex; eye[1] = ey + CS.PLAYER.eye; eye[2] = ez;
      /* 敵から見て自分のいる向き = いちばん逃げたい向き */
      const awl = Math.hypot(pos[0] - ex, pos[2] - ez) || 1;
      const awx = (pos[0] - ex) / awl, awz = (pos[2] - ez) / awl;
      const avoid = this._avoid(view);
      let bestS = -1e9, bx = 0, by = 0, bz = 0, found = false;
      for (let i = 0; i < FLEE_SAMPLES; i++) {
        const n = world.navRandom(this.rng);
        if (n < 0) continue;
        const q = world.navPos(n, this._q);
        const de = Math.hypot(q[0] - ex, q[2] - ez);
        const gx = q[0] - pos[0], gz = q[2] - pos[2];
        const ds = Math.hypot(gx, gz);
        let s = de - ds * 0.3;
        if (ds > 1e-3) s += ((gx / ds) * awx + (gz / ds) * awz) * 12;   // 敵と反対がわへ走る
        if (ds < 2.5) s -= 15;                                  // その場でウロウロしない
        if (de > 6) s += world.lineClear(eye, q) ? -6 : 10;     // 敵から見えない場所がうれしい
        if (avoid && this._inFoeBase(view, q)) s -= 25;         // 敵の陣地へは にげこまない
        if (s > bestS) { bestS = s; bx = q[0]; by = q[1]; bz = q[2]; found = true; }
      }
      if (!found) { this.pathT = now; return; }
      set3(this._gp, bx, by, bz); this.hasGoal = true; this.planT = now;
      this._repath(view, now);
    }

    /* 道をたどる。戻り値 false = 道がない */
    _follow(view, now) {
      this._dx = 0; this._dz = 0; this._jmp = false;
      const path = this.path, self = view.self, pos = self.pos, world = view.world;
      if (!path || this.pi >= path.length) return false;
      /* なめらかに: 先の点まで「体ごと」まっすぐ行ければ飛ばす（3フレームに1回だけ調べる）。
         体は約1ブロックの幅なので、まん中の線だけでなく左右のはしの線も見る（かべの角に引っかからない） */
      if ((this.tick % 3) === 0 && world && typeof world.lineClear === 'function') {
        const lim = Math.min(path.length - 1, this.pi + 3);
        for (let k = this.pi + 1; k <= lim; k++) {
          const q = path[k];
          if (Math.abs(q[1] - pos[1]) > 0.6) break;
          if (!this._wideClear(world, pos, q)) break;
          this.pi = k;
        }
      }
      let wp = path[this.pi];
      let dx = wp[0] - pos[0], dy = wp[1] - pos[1], dz = wp[2] - pos[2];
      let hd = Math.hypot(dx, dz);
      if (hd < 0.5 && Math.abs(dy) < 0.7) {
        this.pi++;
        if (this.pi >= path.length) { this.path = null; return false; }
        wp = path[this.pi];
        dx = wp[0] - pos[0]; dy = wp[1] - pos[1]; dz = wp[2] - pos[2]; hd = Math.hypot(dx, dz);
      }
      /* 1ブロック上がる辺（nav の kind 1）はジャンプでのぼる */
      if (dy > 0.55 && hd < 1.7 && self.grounded !== false) this._jmp = true;
      if (hd > 1e-4) { this._dx = dx / hd; this._dz = dz / hd; }
      return true;
    }

    /* a → b を体の幅（左右 BODY_R）ごと通れるか（まん中・右はし・左はしの3本の線） */
    _wideClear(world, a, b) {
      if (!world.lineClear(a, b)) return false;
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz);
      if (l < 1e-3) return true;
      const px = -dz / l * BODY_R, pz = dx / l * BODY_R;
      const A = this._wa, B = this._wb;
      A[0] = a[0] + px; A[1] = a[1]; A[2] = a[2] + pz;
      B[0] = b[0] + px; B[1] = b[1]; B[2] = b[2] + pz;
      if (!world.lineClear(A, B)) return false;
      A[0] = a[0] - px; A[2] = a[2] - pz;
      B[0] = b[0] - px; B[2] = b[2] - pz;
      return world.lineClear(A, B);
    }

    /* ---------- ねらう ---------- */
    _aim(view, now, dt, inp) {
      const cfg = this.cfg, self = view.self, eye = this._ev;
      let ax = 0, ay = 0, az = 0, has = false, bal = null, slow = 1, noisy = false;

      if (this.bombing) {
        ax = this._bp[0]; ay = this._bp[1]; az = this._bp[2]; has = true;
        const b = self.bomb;
        const hd = Math.hypot(ax - eye[0], az - eye[2]);
        bal = ballistic(b && b.throwSpeed > 0 ? b.throwSpeed : 16, b && b.grav > 0 ? b.grav : 18, hd, ay - eye[1]) - THROW_LIFT;
      } else if (this.tgtVis || (this.hasMem && now - this.memT < 1.2)) {
        const g = self.gun;
        const d = Math.hypot(this._tp[0] - eye[0], this._tp[1] - eye[1], this._tp[2] - eye[2]);
        /* 相手の場所は少し前に見たもの。動きを読むのが上手なほど（lead）そのぶん先をねらう */
        let tof = clamp(now - this.seenT, 0, 0.3);
        if (g && g.type === 'projectile' && g.proj && g.proj.speed > 0) tof += d / g.proj.speed;
        const lead = cfg.lead * tof;
        ax = this._tp[0] + this._tv[0] * lead;
        ay = this._tp[1] + this._tv[1] * lead + cfg.headBias;
        az = this._tp[2] + this._tv[2] * lead;
        /* ロケット（まっすぐ飛ぶ 大きな爆風）: 地面にいる相手は 足もとをねらう（よけられても 爆風が当たる）。
           足もとが 見えるときだけ（あいだの 低い箱に 当たって 手前で ばくはつしない） */
        if (g && g.type === 'projectile' && g.proj && g.proj.radius >= 2 && !(g.proj.grav > 0) && Math.abs(this._tv[1]) < 0.5) {
          const fy = this._tp[1] - CS.PLAYER.half + 0.12;
          if (this._los(view, eye, ax, fy, az)) ay = fy;
        }
        has = true; noisy = true;
        if (!this.tgtVis) slow = 0.6;
        if (g && g.type === 'projectile' && g.proj && g.proj.grav > 0 && g.proj.speed > 0) {
          bal = ballistic(g.proj.speed, g.proj.grav, Math.hypot(ax - eye[0], az - eye[2]), ay - eye[1]);
        }
      } else if (this._mdx !== 0 || this._mdz !== 0) {
        ax = eye[0] + this._mdx * 6; ay = eye[1]; az = eye[2] + this._mdz * 6;
        has = true; slow = 0.55;
      }
      if (!has) { this.aimOff = 0; return; }

      const dx = ax - eye[0], dy = ay - eye[1], dz = az - eye[2];
      const hd = Math.hypot(dx, dz);
      let wantYaw = yawTo(dx, dz);
      let wantPitch = (bal !== null) ? bal : Math.atan2(dy, Math.max(hd, 1e-3));
      if (noisy) {
        this._noise(now, dt);
        const sc = cfg.aimErr * DEG * (cfg.aimMin + (1 - cfg.aimMin) * Math.exp(-this.track / cfg.aimShrink));
        wantYaw += this.ny * sc; wantPitch += this.np * sc;
      }
      wantPitch = clamp(wantPitch, -PITCH_MAX, PITCH_MAX);
      const dYaw = wrap(wantYaw - self.yaw), dPitch = wantPitch - self.pitch;

      let sy = dYaw * cfg.gain * dt * slow, sp = dPitch * cfg.gain * dt * slow;
      if (Math.abs(sy) > Math.abs(dYaw)) sy = dYaw;
      if (Math.abs(sp) > Math.abs(dPitch)) sp = dPitch;
      const lim = cfg.turn * dt * slow, m = Math.hypot(sy, sp);     // 旋回の速さの上限
      if (m > lim && m > 1e-12) { const k = lim / m; sy *= k; sp *= k; }
      inp.lookX = -sy;                 // lookX>0 は右回り、yaw は左回りが+
      inp.lookY = sp;
      this.aimOff = Math.hypot(dYaw - sy, dPitch - sp);             // このあと残るズレ
    }

    /* ねらいのブレ（同じ相手を追い続けると小さくなる）。単位円のなかをゆっくり動く */
    _noise(now, dt) {
      if (now >= this.nextNoise) {
        const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng());
        this.nyT = Math.cos(a) * r; this.npT = Math.sin(a) * r;
        this.nextNoise = now + 0.3 + this.rng() * 0.5;      // ゆっくり動くズレ（速すぎると旋回でならされて消える）
      }
      const k = 1 - Math.exp(-dt * 7);
      this.ny += (this.nyT - this.ny) * k;
      this.np += (this.npT - this.np) * k;
    }

    /* 当たりそうだと思う角度のひろさ */
    _cone(g) {
      const d = Math.max(2, this.tgtDist);
      return Math.atan2(0.62, d) + (2 + this.cfg.aimErr * 0.3) * DEG;
    }

    /* ---------- 撃つ・投げる・リロード ---------- */
    _act(view, now, dt, inp) {
      const cfg = this.cfg, self = view.self, g = self.gun;
      this.semiCd -= dt;
      if (this.reloadCd > 0) this.reloadCd -= dt;

      /* --- のぞく --- */
      let wantAds = false;
      if (cfg.fire && g && this.tgtVis && this.mode === 'fight') {
        if (SCOPED[g.id]) wantAds = this.tgtDist > 6;
        else if (cfg.adsRange > 0 && g.zoom < 1) wantAds = this.tgtDist > cfg.adsRange;
      }
      inp.ads = wantAds;
      this.adsT = wantAds ? this.adsT + dt : 0;

      /* --- 撃つか決める --- */
      const ammo = (typeof self.ammo === 'number') ? self.ammo : 1;
      let want = false;
      if (cfg.fire && g && this.tgtVis && now >= this.fireAt && !self.reloading && ammo > 0 && !this.bombing &&
        !this.tgtProtect && this.tgtDist <= rangeFor(g)[3] && this.aimOff <= this._cone(g)) {
        want = true;
        if (this.mode === 'retreat' && this.tgtDist > 7) want = false;                 // 下がっているときは深追いしない
        /* 爆風で じぶんも いたい銃（ロケット・グレラン）は、爆風の中に入るほど 近い相手には 撃たない（下がってから） */
        if (want && g.proj && g.proj.radius > 0 && g.proj.selfMult > 0 && this.tgtDist < g.proj.radius + 0.5) want = false;
        /* 復活直後の無敵は、遠くの相手を撃ってムダにしない（撃つと無敵が切れる §13.8） */
        if (want && cfg.keepProtect && self.protect && this.tgtDist > rangeFor(g)[1]) want = false;
        if (want && SCOPED[g.id] && this.tgtDist > 6 && this.adsT < 0.18) want = false; // のぞいてから撃つ
        if (want && cfg.burst) {                                                        // 短く区切って撃つ
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burstOn = !this.burstOn;
            /* 回るまで・ためるまで 待つ銃（ミニガン・レールガン）は、そのぶん長く押す（押すたびに 撃つ前に はなしてしまわない） */
            const wind = (g.spinup > 0 ? g.spinup : 0) + (g.charge > 0 ? g.charge : 0);
            this.burstT = this.burstOn ? rr(cfg.burst[0], cfg.burst[1], this.rng) + wind : rr(cfg.burst[2], cfg.burst[3], this.rng);
          }
          if (!this.burstOn) want = false;
        }
        /* 最後にもう一度確かめる: 壁ごし・煙ごしには絶対に撃たない */
        if (want) {
          const p = this._live(view, this.tgt);
          if (!p || !p.pos || p.alive === false || !this._los(view, this._ev, p.pos[0], p.pos[1] + 0.1, p.pos[2])) {
            want = false; this.tgtVis = false; this.lostT = now;
          }
        }
      }

      /* --- 引き金（押しっぱなし / 単発） --- */
      const hold = !!(g && (g.auto || g.charge > 0 || g.type === 'flame' || g.type === 'beam'));
      if (want) {
        if (hold) inp.fire = true;
        else if (this.semiCd <= 0) { inp.fire = true; this.semiCd = (60 / (g.rpm > 0 ? g.rpm : 120)) * cfg.semiSlow; }
      }
      inp.firePressed = inp.fire && !this.prevFire;
      inp.fireReleased = !inp.fire && this.prevFire;
      this.prevFire = inp.fire;
      if (inp.fire) this.shotT = now;
      if (inp.firePressed) this.stats.shots++;

      /* --- ボム --- */
      if (cfg.bombs > 0 && self.bomb && (typeof self.bombCharges !== 'number' || self.bombCharges > 0)) {
        if (!this.bombing && now >= this.nextBomb && this.mode !== 'roam') {
          let ok = this.tgtVis;
          if (!ok && cfg.bombs >= 2 && this.hasMem && now - this.memT < 2.5) ok = true;   // 曲がり角の向こうへも
          if (ok) {
            const d = Math.sqrt(d2h(this._ev, this._tp));
            if (d >= cfg.bombMin && d <= cfg.bombMax) {
              cp3(this._bp, this._tp); this._bp[1] += 0.1;
              this.bombing = true; this.bombT = now + 0.7;
            } else this.nextBomb = now + 1.0;
          } else this.nextBomb = now + 1.0;
        }
        if (this.bombing) {
          let throwIt = this.aimOff < 0.09;
          if (!throwIt && now > this.bombT) throwIt = this.aimOff < 0.22;
          if (throwIt || now > this.bombT) {
            if (throwIt) { inp.bomb = true; this.stats.bombs++; }
            this.bombing = false;
            this.nextBomb = now + cfg.bombEvery * (0.7 + 0.6 * this.rng());
          }
        }
      } else this.bombing = false;

      /* --- リロード（危なくないときに） --- */
      if (cfg.fire && g && !self.reloading && this.reloadCd <= 0) {
        const mag = g.mag > 0 ? g.mag : 1;
        const safe = !this.tgtVis && (!this.hasMem || now - this.memT > 1.2);
        let want2 = false;
        if (ammo <= 0) want2 = true;
        else if (cfg.reloadFrac > 0 && ammo <= mag * cfg.reloadFrac && safe && now - this.shotT > 0.8) want2 = true;
        if (want2) { inp.reload = true; this.reloadCd = 1.0; this.stats.reloads++; }
      }
    }
  }

  /* ---------- 公開 ---------- */
  CS.Bots = {
    LEVELS,
    LEVEL_IDS: ['flee', 'easy', 'normal', 'hard'],
    RANGES,
    rangeFor,
    create(opt) { return new Brain(opt); },
    /* ボットの持ちもの（20丁と5個から適当に1つずつ） */
    randomLoadout(rnd) {
      const r = typeof rnd === 'function' ? rnd : Math.random;
      /* v5: noBot の ぶき（ワープボム・じばく系）は コンピューターに もたせない */
      const gs = (CS.Guns || []).filter((g) => !g.noBot), bs = (CS.Bombs || []).filter((b) => !b.noBot);
      const gun = (gs && gs.length) ? gs[Math.min(gs.length - 1, Math.floor(r() * gs.length))].id : 'ar';
      const bomb = (bs && bs.length) ? bs[Math.min(bs.length - 1, Math.floor(r() * bs.length))].id : 'frag';
      return { gun, bomb };
    }
  };
})();
