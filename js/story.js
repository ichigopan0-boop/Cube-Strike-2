/* ==========================================================================
   CUBE STRIKE 2 — story.js
   CS2: ストーリーモード（ひとりで・5章 × 5ステージ）。お話の データは story-data.js
   ・ステージ 1〜4: 章の マップで ブラック兵を ウェーブごとに ぜんぶ たおす（'story' の しあい）
     2・4 は 職人ハンマが わたす 武器しばり。やられても なんかいでも ふっかつ
   ・ステージ 5: ストーリー専用ボス（raid.js の しくみを つかう。CS.Raid.addBoss で ボスを ふやす）
   ・むずかしい: ぜんぶ クリアすると あそべる。てきが つよく、時間せいげん（ふつう 3分・ボス 5分）
   ・会話: かお（16×16 ドット）＋ ふきだし。ときどき えらぶ（お話は かわらない）
   game.js からは: startStory / _stMapDef / _stSetup / _stTick / _stKill / _stHud / _stBotView / _stEndInfo / _stLava
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Game || !CS.StoryData) return;
  const G = CS.Game.prototype;
  const V = CS.V;
  const SD = CS.StoryData, CH = SD.CHAPTERS;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = Math.random;
  const r2 = (v) => Math.round(v * 100) / 100;
  const TAU = Math.PI * 2;
  const HALF = CS.PLAYER.half;
  const ST_POOL = 8;                 // てきの 入れもの
  const TIME_HARD = 180;             // むずかしい: ふつうの ステージの 時間
  const LAVA = 33;                   // マグマの ブロック（光る）
  const LAVA_DPS = 18;
  const LV_UP = { easy: 'normal', normal: 'hard', hard: 'hard' };
  const N_ST = CH.length * 5;

  /* ======================================================================
     章の マップ（48 × 16 × 48）。プレイヤーは 南、てきは 北から
     ====================================================================== */
  const MW = 48, MH = 16, MD = 48;
  const PL_SP = [[22, 44], [25, 44], [23, 45], [24, 43]];
  const EN_SP = [[6, 5], [24, 4], [41, 5], [8, 15], [39, 15], [16, 9], [31, 9], [24, 17]];
  function spawnsOf() {
    const y = 1 + HALF + 0.002;
    return [PL_SP.map((s) => ({ p: [s[0] + 0.5, y, s[1] + 0.5], yaw: 0 })), EN_SP.map((s) => ({ p: [s[0] + 0.5, y, s[1] + 0.5], yaw: Math.PI }))];
  }
  function buildStage(ch) {
    const g = new CS.MapKit.Grid(MW, MH, MD);
    const f = (x0, y0, z0, x1, y1, z1, b) => g.fill(x0, y0, z0, x1, y1, z1, b);
    g.shell(1, 2, null);
    let look;
    const tree = (x, z, h) => { f(x, 1, z, x, h, z, 4); f(x - 2, h + 1, z - 2, x + 2, h + 2, z + 2, 10); f(x - 1, h + 3, z - 1, x + 1, h + 3, z + 1, 10); };
    if (ch === 0) {
      /* ネオンの まち（夜）: ビルと 光る かんばん */
      f(1, 0, 1, MW - 2, 0, MD - 2, 1);
      f(19, 0, 1, 28, 0, MD - 2, 9); f(1, 0, 18, MW - 2, 0, 19, 9);
      const B = [[10, 2, 14, 6, 7], [18, 10, 21, 13, 5], [27, 2, 35, 6, 6], [43, 8, 46, 12, 8], [1, 9, 4, 13, 6], [26, 12, 29, 15, 4],
        [3, 22, 9, 27, 7], [38, 22, 44, 27, 6], [3, 31, 8, 37, 5], [39, 31, 45, 37, 7], [13, 24, 17, 28, 4], [30, 24, 34, 28, 4]];
      B.forEach((b, i) => {
        f(b[0], 1, b[1], b[2], b[4], b[3], 2);
        const n1 = 30 + (i % 4), n2 = 30 + ((i + 2) % 4);
        f(b[0], 3, b[1], b[2], 3, b[1], n1); f(b[0], 3, b[3], b[2], 3, b[3], n1); f(b[0], 3, b[1], b[0], 3, b[3], n1); f(b[2], 3, b[1], b[2], 3, b[3], n1);
        f(b[0], b[4], b[1], b[2], b[4], b[3], n2);
      });
      f(21, 1, 30, 23, 1, 31, 5); f(26, 1, 20, 27, 1, 22, 6); f(12, 1, 17, 14, 1, 18, 3); f(33, 1, 16, 35, 1, 17, 5); f(9, 1, 40, 11, 1, 41, 6); f(36, 1, 40, 38, 1, 41, 3);
      g.openShell(3, 7, 30);
      look = CS.MapKit.env('dusk', {
        palette: { 1: [0.12, 0.12, 0.17], 2: [0.17, 0.16, 0.24], 3: [1.0, 0.85, 0.3], 4: [0.4, 0.3, 0.2], 5: [0.9, 0.25, 0.35], 6: [0.25, 0.5, 0.95], 7: [0.3, 0.3, 0.38], 9: [0.22, 0.22, 0.28], 10: [0.2, 0.5, 0.25],
          30: [1.0, 0.35, 0.85], 31: [0.35, 0.9, 1.0], 32: [1.0, 0.85, 0.3], 33: [0.6, 1.0, 0.45] },
        sky: [0.06, 0.05, 0.14], skyTop: [0.01, 0.01, 0.05], ambSky: [0.42, 0.40, 0.58], ambGnd: [0.22, 0.2, 0.28], sunCol: [0.5, 0.45, 0.7], fogNear: 30, fogFar: 85
      });
    } else if (ch === 1) {
      /* ささやきの 森: 木・しげみ・まるた */
      f(1, 0, 1, MW - 2, 0, MD - 2, 1);
      f(21, 0, 18, 26, 0, MD - 2, 9); f(6, 0, 6, 41, 0, 8, 9);
      [[11, 4], [20, 7], [28, 6], [36, 3], [45, 9], [3, 11], [13, 13], [35, 11], [44, 19], [4, 21], [19, 21], [29, 22], [12, 27], [38, 26],
        [5, 33], [22, 31], [33, 33], [44, 33], [15, 38], [31, 39], [42, 42], [4, 42], [9, 30]].forEach((t, i) => tree(t[0], t[1], 3 + (i % 2)));
      [[9, 18], [27, 15], [17, 26], [32, 28], [7, 38], [40, 38], [24, 25]].forEach((b, i) => f(b[0], 1, b[1], b[0] + 1, 1 + (i % 2), b[1] + 1, 10));
      f(10, 1, 23, 14, 1, 23, 4); f(33, 1, 19, 37, 1, 19, 4); f(42, 1, 26, 44, 2, 28, 2); f(2, 1, 26, 3, 1, 27, 2);
      g.openShell(3, 4, 10);
      look = CS.MapKit.env('forest', { palette: { 1: [0.36, 0.6, 0.28], 2: [0.5, 0.5, 0.52], 4: [0.45, 0.3, 0.18], 9: [0.55, 0.45, 0.3], 10: [0.22, 0.5, 0.24] } });
    } else if (ch === 2) {
      /* ドカンの さばく: いせき・サボテン・すなの おか */
      f(1, 0, 1, MW - 2, 0, MD - 2, 1);
      f(10, 1, 12, 16, 3, 12, 12); f(13, 1, 12, 13, 3, 12, 0); f(31, 1, 12, 37, 3, 12, 12); f(34, 1, 12, 34, 3, 12, 0);
      f(20, 1, 20, 20, 4, 20, 12); f(27, 1, 20, 27, 3, 20, 12); f(20, 1, 27, 20, 2, 27, 12); f(27, 1, 27, 27, 4, 27, 12);
      [[4, 8], [44, 10], [9, 24], [40, 24], [14, 34], [34, 35], [3, 40], [45, 40]].forEach((c) => { f(c[0], 1, c[1], c[0], 3, c[1], 11); f(c[0] - 1, 2, c[1], c[0] - 1, 3, c[1], 11); f(c[0] + 1, 3, c[1], c[0] + 1, 3, c[1], 11); });
      f(2, 1, 18, 7, 1, 22, 9); f(40, 1, 30, 46, 1, 34, 9); f(22, 1, 10, 25, 2, 10, 12); f(17, 1, 33, 19, 2, 33, 12); f(29, 1, 33, 31, 2, 33, 12);
      g.openShell(3, 12, 12);
      look = CS.MapKit.env('desert', { palette: { 1: [0.88, 0.76, 0.5], 2: [0.75, 0.6, 0.4], 9: [0.8, 0.66, 0.42], 11: [0.3, 0.62, 0.3], 12: [0.78, 0.62, 0.42] } });
    } else if (ch === 3) {
      /* もえる 火山: マグマの 川（はしを わたる）・いわの はしら */
      f(1, 0, 1, MW - 2, 0, MD - 2, 1);
      f(1, 0, 13, MW - 2, 0, 14, LAVA); f(8, 0, 13, 10, 0, 14, 9); f(23, 0, 13, 25, 0, 14, 9); f(37, 0, 13, 39, 0, 14, 9);
      f(1, 0, 29, MW - 2, 0, 30, LAVA); f(4, 0, 29, 6, 0, 30, 9); f(16, 0, 29, 18, 0, 30, 9); f(30, 0, 29, 32, 0, 30, 9); f(42, 0, 29, 44, 0, 30, 9);
      f(12, 0, 20, 14, 0, 23, LAVA); f(34, 0, 20, 36, 0, 23, LAVA);
      f(5, 1, 24, 6, 5, 25, 2); f(41, 1, 24, 42, 6, 25, 2); f(20, 1, 36, 21, 4, 37, 2); f(28, 1, 7, 29, 5, 8, 2); f(14, 1, 5, 15, 2, 6, 2); f(33, 1, 38, 34, 2, 39, 2);
      f(9, 1, 34, 10, 2, 35, 2); f(37, 1, 18, 38, 2, 18, 2);
      g.openShell(3, 2, 2);
      look = CS.MapKit.env('sunset', {
        palette: { 1: [0.2, 0.17, 0.17], 2: [0.3, 0.24, 0.22], 9: [0.38, 0.32, 0.3], [LAVA]: [1.0, 0.45, 0.1] },
        sky: [0.42, 0.14, 0.08], skyTop: [0.12, 0.04, 0.05], fogNear: 30, fogFar: 95
      });
    } else {
      /* 黒い 城: 色の ない 大広間（中）。はしら・赤い じゅうたん・王の いす */
      for (let z = 1; z < MD - 1; z++) for (let x = 1; x < MW - 1; x++) f(x, 0, z, x, 0, z, ((x >> 1) + (z >> 1)) % 2 ? 1 : 9);
      f(22, 0, 1, 25, 0, MD - 2, 5);
      [[8, 8], [38, 8], [8, 20], [38, 20], [8, 32], [38, 32], [16, 14], [30, 14], [16, 26], [30, 26]].forEach((c) => { f(c[0], 1, c[1], c[0] + 1, 12, c[1] + 1, 2); f(c[0], 8, c[1], c[0] + 1, 8, c[1] + 1, 30); });
      f(1, 6, 1, MW - 2, 6, 1, 30); f(1, 6, MD - 2, MW - 2, 6, MD - 2, 30); f(1, 6, 1, 1, 6, MD - 2, 30); f(MW - 2, 6, 1, MW - 2, 6, MD - 2, 30);
      f(21, 1, 1, 26, 1, 2, 3); f(22, 2, 1, 25, 4, 1, 3); f(23, 5, 1, 24, 5, 1, 30);
      for (let x = 6; x <= 41; x += 7) f(x, 7, 1, x + 1, 11, 1, 5);
      look = {
        palette: { 1: [0.1, 0.09, 0.14], 2: [0.16, 0.14, 0.22], 3: [1.0, 0.8, 0.3], 5: [0.6, 0.1, 0.16], 9: [0.14, 0.12, 0.2], 30: [0.7, 0.35, 1.0] },
        sky: [0.04, 0.02, 0.08], skyTop: [0.01, 0.0, 0.03], ambSky: [0.45, 0.4, 0.55], ambGnd: [0.22, 0.18, 0.26], sunCol: [0.55, 0.45, 0.7],
        sun: V.norm([0.3, 0.85, 0.35]), fogNear: 35, fogFar: 90, outdoor: false
      };
    }
    /* でてくる ところは あけておく */
    for (const s of EN_SP.concat(PL_SP)) { f(s[0] - 1, 1, s[1] - 1, s[0] + 1, 3, s[1] + 1, 0); if (g.data[s[0] + MW * s[1]] === LAVA) f(s[0], 0, s[1], s[0], 0, s[1], 1); }
    return CS.MapKit.finish(g, spawnsOf(), look);
  }

  /* ======================================================================
     しあい（ステージ 1〜4）
     ====================================================================== */
  function stageOf(ch, st) { const c = CH[clamp(ch | 0, 0, CH.length - 1)]; return c.stages[clamp(st | 0, 0, 4)]; }
  const gruntSkins = {};
  function gruntSkin(hat) {
    if (gruntSkins[hat]) return gruntSkins[hat];
    const S = CS.Skins, base = SD.skinOf('grunt');
    return (gruntSkins[hat] = base && S ? S.clean(Object.assign({}, base, { h: hat || 'none' })) : null);
  }

  G.startStory = function (opt) {
    if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
    const ch = clamp(opt.ch | 0, 0, CH.length - 1), st = clamp(opt.st | 0, 0, 3), hard = !!opt.hard;
    const S = stageOf(ch, st), C = CH[ch];
    this._teardown();
    this.isHost = true;
    this.myNetId = 'host';
    this.offline = true;
    const fx = S.fixed;
    const me = {
      id: 'host', name: String(CS.Settings.name || 'プレイヤー'), team: 0, skin: this._mySkin(), fc: '',
      gun: fx ? fx.g : this._myGunId(), gun2: fx ? fx.g2 : this._myGun2Id(), gm: fx ? fx.gm : this._myGm(), gm2: fx ? fx.gm2 : this._myGm2(), bomb: fx ? fx.b : this._myBombId()
    };
    const players = [me], spawns = [0];
    for (let i = 0; i < ST_POOL; i++) {
      players.push({ id: 'se' + i, name: 'ブラック兵', team: 1, gun: C.guns[i % C.guns.length], bomb: 'frag', bot: hard ? LV_UP[C.lv] : C.lv, skin: gruntSkin(C.hat) });
      spawns.push(i);
    }
    const seed = (Math.random() * 0x7fffffff) | 0;
    this._broadcast({ t: 'start', seed: seed, map: 'story_' + C.id, mode: 'story', players: players, spawns: spawns, rule: { id: 'story' }, story: { ch: ch, st: st, hard: hard ? 1 : 0 } });
    return true;
  };

  G._stMapDef = function (sd) {
    const ch = clamp(sd.ch | 0, 0, CH.length - 1);
    return { id: 'story_' + CH[ch].id, name: CH[ch].name, build: () => buildStage(ch) };
  };

  G._stSetup = function (sd) {
    const ch = clamp(sd.ch | 0, 0, CH.length - 1), st = clamp(sd.st | 0, 0, 3);
    const S = stageOf(ch, st);
    this.story = {
      ch: ch, st: st, hard: !!sd.hard, waves: S.waves.slice(), wave: 0, state: 'break', t: 3, queue: 0, spawnT: 0, left: 0, seq: 0,
      kills: 0, time: 0, tlim: sd.hard ? TIME_HARD : 0, over: false, win: false, endT: -1
    };
    for (const p of this.players) {
      if (p.team !== 1) continue;
      p.alive = false; p.hp = 0; p.respawnAt = 0; p.noRegen = true;
    }
    const me = this.players[this.me];
    if (me && S.fixed) CS.UI.toast('武器しばり: ' + S.fixed.note);
  };

  G._stTick = function (dt) {
    const st = this.story;
    if (!st) return;
    if (st.over) {
      if (st.endT >= 0 && this.time >= st.endT) { st.endT = -1; this._sendEnd(st.win ? 0 : 1); }
      return;
    }
    if (this.phase !== 'live') return;
    st.time += dt;
    if (st.tlim > 0 && st.time >= st.tlim) {
      st.over = true; st.win = false; st.endT = this.time + 1.2;
      CS.UI.hud.center('時間ぎれ…', '#ffb3c0', 1600);
      return;
    }
    this._stLava(dt, st.ch);
    if (st.state === 'break') {
      st.t -= dt;
      if (st.t <= 0) this._stWave(st.wave + 1);
      return;
    }
    let alive = 0;
    for (const p of this.players) if (p.team === 1 && p.alive) alive++;
    st.left = st.queue + alive;
    st.spawnT -= dt;
    if (st.queue > 0 && st.spawnT <= 0 && alive < ST_POOL) {
      if (this._stSpawnOne()) { st.queue--; st.spawnT = 0.7; } else st.spawnT = 0.4;
    }
    if (st.queue <= 0 && alive === 0) {
      if (st.wave >= st.waves.length) {
        st.over = true; st.win = true; st.endT = this.time + 1.8;
        CS.UI.hud.center('ステージ クリア！', '#ffd23d', 2000);
        this._sfx('win');
        return;
      }
      st.state = 'break'; st.t = 2.5;
      CS.UI.hud.center('ウェーブ ' + st.wave + ' クリア！', '#8ff0c8', 1300);
      this._sfx('ok');
    }
  };

  G._stWave = function (w) {
    const st = this.story;
    st.wave = w; st.state = 'wave';
    st.queue = st.waves[w - 1] | 0; st.spawnT = 0; st.left = st.queue;
    CS.UI.hud.center('ウェーブ ' + w + ' / ' + st.waves.length + (w === st.waves.length ? '（さいご）' : ''), w === st.waves.length ? '#ffd23d' : '#ff9ac8', 1500);
    this._sfx('go');
  };

  /* てきを 1人 出す（たおされた 入れものを つかう） */
  G._stSpawnOne = function () {
    const st = this.story, C = CH[st.ch];
    let p = null;
    for (const q of this.players) if (q.team === 1 && !q.alive && q.connected && q.bot && typeof q.id === 'string' && q.id.indexOf('se') === 0) { p = q; break; }
    if (!p) return false;
    let lv = st.hard ? LV_UP[C.lv] : C.lv;
    if (st.wave === st.waves.length && st.st >= 2 && rnd() < 0.4) lv = LV_UP[lv];
    if (p.bot.level !== lv && CS.Bots) {
      p.bot.level = lv;
      p.bot.brain = CS.Bots.create({ level: lv, idx: p.idx, team: p.team, rng: CS.rng(((st.seq * 7919) + p.idx * 131) >>> 0) });
    }
    const gid = C.guns[(st.seq++ + st.wave) % C.guns.length];
    const gun = CS.gunWith ? CS.gunWith(gid, '') : CS.Weapons.gun(gid);
    p.gun = gun; p.guns = [gun]; p.slot = 0; p.gunId = gun.id;
    p.maxHp = Math.round(CS.RULES.hp * C.hp * (st.hard ? 1.3 : 1) * (1 + 0.06 * st.st));
    p.dmgMul = C.dmg * (st.hard ? 1.3 : 1);
    p.noRegen = true;
    p.skin = gruntSkin(C.hat);
    /* プレイヤーから はなれた ところ */
    const me = this.players[this.me];
    const sp = this.mapData.spawns[1];
    let cand = sp.filter((s) => !me || V.dist(s.p, me.lastReport) > 14);
    if (!cand.length) cand = sp;
    const s = cand[Math.floor(rnd() * cand.length)];
    this._hostRespawn(p, { p: s.p, yaw: s.yaw });
    p.protectUntil = this.time + 0.6;
    return true;
  };

  G._stKill = function (v, a) {
    const st = this.story;
    if (!st) return;
    if (v.team === 1) { v.respawnAt = 0; st.kills++; }
  };

  /* マグマの ゆか（ホスト）。章 3（火山）だけ */
  G._stLava = function (dt, ch) {
    if (ch !== 3 || !this.world) return;
    this._lavaT = (this._lavaT || 0) - dt;
    if (this._lavaT > 0) return;
    this._lavaT = 0.25;
    for (const p of this.players) {
      if (!p.alive || !p.connected || p.raidBoss || p.big > 0) continue;
      const q = p.lastReport;
      const b = this.world.get(Math.floor(q[0]), Math.floor(q[1] - HALF - 0.08), Math.floor(q[2]));
      if (b !== LAVA) continue;
      if (p.protect) { p.protect = false; p.protectUntil = 0; }
      this._hostApplyDamage(p, LAVA_DPS * 0.25, null, 'burn', false, null, null);
    }
  };

  G._stBotView = function (p, v) {
    v.avoidSpawn = false;
    const me = this.players[this.me];
    if (p.team === 1 && me && me.alive) v.chase = me.lastReport;
  };

  const fmtT = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60); };
  G._stHud = function (s) {
    const st = this.story;
    if (!st) return;
    const S = stageOf(st.ch, st.st);
    let text = st.wave === 0 ? 'まもなく てきが くる！' : st.state === 'break' ? 'つぎの ウェーブ まで ' + Math.ceil(st.t) + '秒' : 'ウェーブ ' + st.wave + '/' + st.waves.length + ' ・ てき のこり ' + st.left;
    if (st.tlim > 0) text += ' ・ のこり ' + fmtT(st.tlim - st.time);
    s.tower = { label: (st.ch + 1) + '-' + (st.st + 1) + ' ' + S.name + (st.hard ? '（むずかしい）' : ''), text: text, boss: null };
  };

  G._stEndInfo = function (w) {
    const st = this.story;
    if (!st) return null;
    const me = this.players[this.me];
    return { win: w === 0, ch: st.ch, st: st.st, hard: st.hard ? 1 : 0, time: Math.round(st.time), kills: st.kills, deaths: me ? me.deaths | 0 : 0 };
  };

  /* ======================================================================
     ストーリーの ボス（レイドの しくみ）
     ====================================================================== */
  const R = CS.Raid, H = R && R.H;
  if (R && H) {
    const WPN = H.WPN, AW = H.AW, AD = H.AD, CX = H.CX, CZ = H.CZ, FY = H.FLOOR_Y;
    const DF = (rd) => R.diffOf(rd.diff);
    const flatDir = (a, b) => { const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1; return [dx / l, 0, dz / l]; };
    const line = (game, boss, dir, d) => game._raidHz({ k: 'l', a: [boss.pos[0], FY + 0.05, boss.pos[2]], b: [boss.pos[0] + dir[0] * 30, FY + 0.05, boss.pos[2] + dir[2] * 30], d: d, w: boss.big * 2 });
    const tp = (game, boss, x, z) => {
      const spot = game._raidSpot(x, z, 1.5);
      const from = boss.pos.slice();
      boss.pos[0] = spot[0]; boss.pos[2] = spot[2];
      game._broadcast({ t: 'rp', e: 'tp', a: [r2(from[0]), r2(from[1]), r2(from[2])], b: [r2(boss.pos[0]), r2(boss.pos[1]), r2(boss.pos[2])] });
    };
    /* 歩いて ちかづく（dist まで） */
    const walk = (game, boss, tg, sp, dist, dt) => {
      const dx = tg.lastReport[0] - boss.pos[0], dz = tg.lastReport[2] - boss.pos[2], d = Math.hypot(dx, dz);
      const v = d > dist ? sp : d < dist - 2 ? -sp * 0.5 : 0;
      boss.vel[0] = dx / (d || 1) * v; boss.vel[2] = dz / (d || 1) * v; boss.vel[1] = 0;
      boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt;
      H.turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 5);
    };
    const shotgun = (game, boss, tg, n, deg) => {
      const o = [boss.pos[0], boss.pos[1] + 0.2, boss.pos[2]];
      const dir = game._raidAimAt(o, tg, 60, 0.6);
      for (let i = 0; i < n; i++) game._raidShoot(boss, WPN.bullet, o.slice(), V.spread(dir, deg, rnd), 60);
    };
    /* ジャンプして ふみつけ（着地で 円と リング） */
    const jumpAct = (game, rd, boss, B, dt) => {
      const act = rd.act;
      act.t += dt;
      const k = clamp(act.t / act.dur, 0, 1);
      boss.pos[0] = act.a[0] + (act.b[0] - act.a[0]) * k;
      boss.pos[2] = act.a[2] + (act.b[2] - act.a[2]) * k;
      boss.pos[1] = H.groundY(B) + Math.sin(Math.PI * k) * act.h;
      boss.vel[0] = (act.b[0] - act.a[0]) / act.dur; boss.vel[2] = (act.b[2] - act.a[2]) / act.dur;
      if (k >= 1) {
        rd.act = null;
        boss.vel[0] = boss.vel[1] = boss.vel[2] = 0;
        const p = [boss.pos[0], FY, boss.pos[2]];
        game._raidHz({ k: 'r', p: p, spd: 10, max: act.ring || 14, dmg: 24, w: 0.6, h: 0.85 });
        game._broadcast({ t: 'rp', e: 'slam', p: [r2(p[0]), r2(p[1]), r2(p[2])] });
        rd.atkT = (act.after || 1.2) * DF(rd).cd;
      }
    };

    /* ---------- テーマ・かざり ---------- */
    const decoNeon = (g) => {
      for (const b of [[2, 14, 4, 18], [39, 14, 41, 18], [2, 26, 4, 30], [39, 26, 41, 30]]) {
        g.fill(b[0], 1, b[1], b[2], 5, b[3], 2); g.fill(b[0], 3, b[1], b[2], 3, b[3], 30); g.fill(b[0], 5, b[1], b[2], 5, b[3], 31);
      }
      g.fill(20, 1, 20, 23, 1, 21, 4);
    };
    const decoForest = (g) => {
      const tree = (x, z) => { g.fill(x, 1, z, x, 4, z, 12); g.fill(x - 2, 5, z - 2, x + 2, 6, z + 2, 11); g.fill(x - 1, 7, z - 1, x + 1, 7, z + 1, 11); };
      [[6, 22], [37, 22], [22, 36], [15, 16], [29, 30], [9, 33], [35, 13]].forEach((t) => tree(t[0], t[1]));
      [[8, 18], [35, 26], [20, 31], [26, 15], [12, 28], [31, 34]].forEach((b) => g.fill(b[0], 1, b[1], b[0] + 1, 1, b[1] + 2, 11));
    };
    const decoDesert = (g) => {
      [[7, 20], [36, 24], [15, 34], [29, 14], [30, 33]].forEach((c) => { g.fill(c[0], 1, c[1], c[0], 3, c[1], 13); g.fill(c[0] - 1, 2, c[1], c[0] - 1, 3, c[1], 13); g.fill(c[0] + 1, 3, c[1], c[0] + 1, 3, c[1], 13); });
      [[17, 17, 19, 17], [25, 27, 27, 27], [9, 29, 11, 29], [33, 17, 35, 17]].forEach((w) => g.fill(w[0], 1, w[1], w[2], 2, w[3], 14));
    };
    const decoVolcano = (g) => {
      [[8, 20, 10, 22], [33, 22, 35, 24], [20, 33, 23, 34], [18, 13, 20, 14]].forEach((l) => g.fill(l[0], 0, l[1], l[2], 0, l[3], LAVA));
      [[14, 26], [29, 18], [6, 34], [37, 34]].forEach((c) => g.fill(c[0], 1, c[1], c[0] + 1, 4, c[1] + 1, 7));
    };
    const decoCastle = (g) => {
      g.fill(20, 1, 40, 23, 1, 42, 14); g.fill(20, 2, 42, 23, 4, 42, 14); g.fill(21, 5, 42, 22, 5, 42, 30);
      g.fill(21, 0, 8, 22, 0, 39, 13);
      for (const c of [[6, 16], [36, 16], [6, 30], [36, 30]]) { g.fill(c[0], 1, c[1], c[0] + 1, 9, c[1] + 1, 7); g.fill(c[0], 6, c[1], c[0] + 1, 6, c[1] + 1, 30); }
    };
    const minion = (hat) => Object.assign({}, SD.skinOf('grunt') || {}, { h: hat });

    const BOSSES = [
      {
        id: 'st_jet', name: 'ジェット', title: 'スピードの 四天王', hp: 3000, big: 0.85, bigH: 0.85, hover: 0, col: '#ff9a3d', skin: 'jet', gun: 'shotgun',
        desc: 'ダッシュの まえに 赤い 線が 出る。よこに よけよう', phaseMinions: [2, 3], minion: minion('cap'),
        theme: { floor: [0.10, 0.10, 0.16], wall: [0.16, 0.14, 0.24], trim: [0.35, 0.2, 0.5], neon: [1, 0.35, 0.85], sky: [0.06, 0.05, 0.14], skyTop: [0.01, 0.01, 0.05] },
        deco: decoNeon
      },
      {
        id: 'st_leaf', name: 'リーフ', title: 'かくれる 四天王', hp: 3400, big: 0.85, bigH: 0.85, hover: 0, col: '#34c77b', skin: 'leaf', gun: 'sniper',
        desc: '赤い 線は スナイパーの ねらい。線から はなれよう', phaseMinions: [2, 3], minion: minion('sprout'),
        theme: { floor: [0.24, 0.38, 0.2], wall: [0.28, 0.22, 0.15], trim: [0.22, 0.42, 0.2], neon: [0.6, 1, 0.45], sky: [0.45, 0.62, 0.55], skyTop: [0.2, 0.36, 0.42] },
        pal: { 11: [0.22, 0.5, 0.22], 12: [0.42, 0.28, 0.16] }, deco: decoForest
      },
      {
        id: 'st_bomba', name: 'ボンバ', title: 'ばくはつの 四天王', hp: 3800, big: 0.95, bigH: 0.95, hover: 0, col: '#e8b923', skin: 'bomba', gun: 'rocket',
        desc: '空から ばくだんが ふってくる。赤い 円から にげよう', phaseMinions: [2, 3], minion: minion('tophat'),
        theme: { floor: [0.82, 0.7, 0.46], wall: [0.7, 0.55, 0.36], trim: [0.6, 0.45, 0.28], neon: [1, 0.8, 0.3], sky: [0.85, 0.76, 0.6], skyTop: [0.35, 0.5, 0.8] },
        pal: { 13: [0.3, 0.6, 0.3], 14: [0.76, 0.6, 0.4] }, deco: decoDesert
      },
      {
        id: 'st_flame', name: 'フレイム', title: 'ほのおの 四天王', hp: 4200, big: 0.95, bigH: 0.95, hover: 0, col: '#ff4d5e', skin: 'flame', gun: 'flame',
        desc: 'ほのおの ブレスと もえる ゆか。マグマも ふまないで', phaseMinions: [2, 3], minion: minion('horn'),
        theme: { floor: [0.16, 0.12, 0.12], wall: [0.22, 0.14, 0.12], trim: [0.4, 0.16, 0.1], neon: [1, 0.45, 0.1], sky: [0.35, 0.1, 0.06], skyTop: [0.1, 0.03, 0.03] },
        pal: { [LAVA]: [1.0, 0.45, 0.1] }, deco: decoVolcano
      },
      {
        id: 'st_king', name: 'ブラックキューブ', title: 'やみの 王', hp: 6000, big: 2.0, bigH: 2.0, hover: 1.4, col: '#8a5cf6', skin: 'king', gun: false,
        desc: 'ぜんぶの わざを つかう さいごの ボス。分身が いる あいだは シールド', phaseMinions: [3, 4], minion: minion('antenna'),
        theme: { floor: [0.08, 0.07, 0.12], wall: [0.12, 0.1, 0.18], trim: [0.3, 0.15, 0.45], neon: [0.7, 0.35, 1.0], sky: [0.04, 0.02, 0.08], skyTop: [0.01, 0.0, 0.03] },
        pal: { 13: [0.5, 0.08, 0.14], 14: [1.0, 0.8, 0.3] }, deco: decoCastle
      }
    ];

    const AI = {
      /* ---------- ジェット: ダッシュ・ショットガン・ふみつけ ---------- */
      st_jet: function (rd, boss, dt) {
        const B = R.bossOf('st_jet'), Dd = DF(rd), ph = rd.phase;
        const tg = this._raidPick(boss);
        const act = rd.act;
        if (act && act.k === 'jump') { jumpAct(this, rd, boss, B, dt); return; }
        if (act && act.k === 'dash') {
          act.t += dt;
          if (act.t < act.wait) { boss.vel[0] = boss.vel[2] = 0; boss.yaw = Math.atan2(-act.dir[0], -act.dir[2]); return; }
          const sp = 22 + ph * 3;
          boss.pos[0] += act.dir[0] * sp * dt; boss.pos[2] += act.dir[2] * sp * dt;
          boss.vel[0] = act.dir[0] * sp; boss.vel[2] = act.dir[2] * sp;
          rd.contact = 30;
          const out = boss.pos[0] < 3.5 || boss.pos[0] > AW - 3.5 || boss.pos[2] < 3.5 || boss.pos[2] > AD - 3.5;
          if (act.t > act.wait + act.dur || out) {
            H.keepIn(boss.pos, 3.5); rd.contact = 0; boss.vel[0] = boss.vel[2] = 0;
            if (ph >= 2 && tg) shotgun(this, boss, tg, 5 + ph, 10);
            if (act.n > 1 && tg) {
              const dir = flatDir(boss.pos, tg.lastReport);
              rd.act = { k: 'dash', t: 0, wait: 0.5, dur: 1.0, dir: dir, n: act.n - 1 };
              line(this, boss, dir, 0.5);
            } else { rd.act = null; rd.atkT = (1.1 - ph * 0.15) * Dd.cd; }
          }
          return;
        }
        /* ふだん: あいての まわりを ぐるぐる */
        if (tg) {
          rd.mv.t += dt * (0.9 + ph * 0.25);
          const tx = tg.lastReport[0] + Math.cos(rd.mv.t) * 8, tz = tg.lastReport[2] + Math.sin(rd.mv.t) * 8;
          const dx = tx - boss.pos[0], dz = tz - boss.pos[2], d = Math.hypot(dx, dz);
          const sp = Math.min(d * 2, 7 + ph * 1.5);
          boss.vel[0] = dx / (d || 1) * sp; boss.vel[2] = dz / (d || 1) * sp;
          boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt;
          H.turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 8);
        }
        boss.pos[1] = H.groundY(B); boss.vel[1] = 0;
        H.keepIn(boss.pos, 3.5);
        rd.atkT -= dt;
        if (rd.atkT > 0 || !tg) return;
        const r = rnd();
        if (r < 0.4) {
          const dir = flatDir(boss.pos, tg.lastReport), wait = 0.85 - ph * 0.1;
          rd.act = { k: 'dash', t: 0, wait: wait, dur: 1.1, dir: dir, n: ph };
          line(this, boss, dir, wait);
          this._broadcast({ t: 'rp', e: 'say', s: 'ダッシュ！' });
        } else if (r < 0.78) {
          const n = 2 + ph;
          for (let i = 0; i < n; i++) this._raidLater(i * 0.4, () => { if (boss.alive && tg.alive) shotgun(this, boss, tg, 6, 9); });
          rd.atkT = (1.5 + n * 0.2 - ph * 0.2) * Dd.cd;
        } else {
          const b = [tg.lastReport[0], H.groundY(B), tg.lastReport[2]];
          H.keepIn(b, 3.5);
          rd.act = { k: 'jump', t: 0, dur: 0.9, a: boss.pos.slice(), b: b, h: 5, ring: 12, after: 1.0 };
          this._raidHz({ k: 'c', p: [b[0], FY, b[2]], r: 2.2, d: 0.9, dmg: 34, up: 9 });
        }
      },

      /* ---------- リーフ: ねらいうち・ツタ・はっぱの あらし・ワープ ---------- */
      st_leaf: function (rd, boss, dt) {
        const B = R.bossOf('st_leaf'), Dd = DF(rd), ph = rd.phase;
        const tg = this._raidPick(boss);
        boss.pos[1] = H.groundY(B); boss.vel[0] = boss.vel[1] = boss.vel[2] = 0;
        if (tg) H.turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 5);
        rd.atkT -= dt;
        if (rd.atkT > 0 || !tg) return;
        const r = rnd();
        if (r < 0.45) {
          const n = ph >= 3 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            this._raidLater(i * 1.0, () => {
              if (!boss.alive || !tg.alive) return;
              const o = [boss.pos[0], boss.pos[1] + 0.35, boss.pos[2]], q = tg.lastReport;
              const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
              this._raidHz({ k: 'b', o: o, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), yv: 0, d: 1.15 - ph * 0.12, dur: 0.18, w: 0.32, dmg: 46, len: 60, c: 0 });
            });
          }
          this._raidLater(1.5 + (n - 1), () => { if (boss.alive) { const s = HIDE[Math.floor(rnd() * HIDE.length)]; tp(this, boss, s[0], s[1]); } });
          rd.atkT = (2.4 + (n - 1) - ph * 0.25) * Dd.cd;
        } else if (r < 0.72) {
          const n = 3 + ph;
          for (let i = 0; i < n; i++) {
            this._raidLater(i * 0.35, () => {
              if (!tg.alive) return;
              const q = tg.lastReport;
              this._raidHz({ k: 'c', p: [q[0] + tg.vel[0] * 0.4, FY, q[2] + tg.vel[2] * 0.4], r: 1.5, d: 0.85, dmg: 24, up: 10, s: 1 });
            });
          }
          rd.atkT = (1.6 + n * 0.15 - ph * 0.2) * Dd.cd;
        } else if (ph >= 2 && r < 0.88) {
          const o = [boss.pos[0], boss.pos[1] + 0.2, boss.pos[2]], n = 10 + ph * 3, a0 = rnd() * TAU;
          for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; this._raidShoot(boss, WPN.orb, o.slice(), [Math.cos(a), 0.04, Math.sin(a)], 9); }
          rd.atkT = 1.6 * Dd.cd;
        } else {
          const s = HIDE[Math.floor(rnd() * HIDE.length)];
          tp(this, boss, s[0], s[1]);
          rd.atkT = 0.7 * Dd.cd;
        }
      },

      /* ---------- ボンバ: ばくだんの 雨・ミサイル・はねる ばくだん・きょだい ばくだん ---------- */
      st_bomba: function (rd, boss, dt) {
        const B = R.bossOf('st_bomba'), Dd = DF(rd), ph = rd.phase;
        const tg = this._raidPick(boss);
        const act = rd.act;
        boss.pos[1] = H.groundY(B);
        if (act && act.k === 'big') {
          act.t += dt; boss.vel[0] = boss.vel[2] = 0;
          if (act.t >= act.dur) { rd.act = null; rd.atkT = 1.2 * Dd.cd; }
          return;
        }
        if (tg) walk(this, boss, tg, 2.2 + ph * 0.4, 7, dt);
        H.keepIn(boss.pos, 3.5);
        rd.atkT -= dt;
        if (rd.atkT > 0 || !tg) return;
        const r = rnd();
        if (ph >= 3 && r < 0.2) {
          this._raidHz({ k: 'c', p: [boss.pos[0], FY, boss.pos[2]], r: 7, d: 2.3, dmg: 55, m: 2 });
          rd.act = { k: 'big', t: 0, dur: 2.5 };
          this._broadcast({ t: 'rp', e: 'say', s: 'きょだい ばくだんだボン！ にげろー！' });
        } else if (r < 0.45) {
          const n = 4 + ph * 2, q = tg.lastReport;
          for (let i = 0; i < n; i++) {
            const a = rnd() * TAU, rr = i === 0 ? 0 : 1 + rnd() * 4;
            const p = [clamp(q[0] + Math.cos(a) * rr, 3, AW - 3), FY, clamp(q[2] + Math.sin(a) * rr, 3, AD - 3)];
            this._raidHz({ k: 'c', p: p, r: 1.8, d: 1.15 + rnd() * 0.5, dmg: 28, m: 1 });
          }
          rd.atkT = (2.0 - ph * 0.25) * Dd.cd;
        } else if (r < 0.7) {
          const n = 2 + ph, o = [boss.pos[0], boss.pos[1] + 1.2, boss.pos[2]];
          for (let i = 0; i < n; i++) {
            const a = (i / n - 0.5) * 1.6 + boss.yaw;
            this._raidShoot(boss, WPN.missile, o.slice(), V.norm([-Math.sin(a), 0.7, -Math.cos(a)]), 14);
          }
          rd.atkT = (2.0 - ph * 0.2) * Dd.cd;
        } else {
          const o = [boss.pos[0], boss.pos[1] + 0.8, boss.pos[2]];
          for (let i = 0; i < 3; i++) {
            const dir = this._raidAimAt(o, tg, 22, 0.8);
            this._raidShoot(boss, WPN.fire, o.slice(), V.spread(V.norm([dir[0], dir[1] + 0.22, dir[2]]), 10, rnd), 22);
          }
          rd.atkT = (1.4 - ph * 0.15) * Dd.cd;
        }
      },

      /* ---------- フレイム: ほのおの ブレス・もえる ゆか・火の はしら・火の玉 ---------- */
      st_flame: function (rd, boss, dt) {
        const B = R.bossOf('st_flame'), Dd = DF(rd), ph = rd.phase;
        const tg = this._raidPick(boss);
        const act = rd.act;
        boss.pos[1] = H.groundY(B);
        if (act && act.k === 'breath') {
          act.t += dt; boss.vel[0] = boss.vel[2] = 0;
          if (act.t >= act.dur) { rd.act = null; rd.atkT = 1.0 * Dd.cd; }
          return;
        }
        if (tg) walk(this, boss, tg, 2.6 + ph * 0.6, 5, dt);
        H.keepIn(boss.pos, 3.5);
        rd.atkT -= dt;
        if (rd.atkT > 0 || !tg) return;
        const r = rnd();
        if (r < 0.35) {
          const q = tg.lastReport, yaw = Math.atan2(-(q[0] - boss.pos[0]), -(q[2] - boss.pos[2]));
          boss.yaw = yaw;
          const f = V.forward(yaw, 0);
          const o = [boss.pos[0] + f[0] * boss.big, boss.pos[1] + 0.1, boss.pos[2] + f[2] * boss.big];
          this._raidHz({ k: 'f', o: o, yaw: yaw, pitch: -0.08, d: 0.6, dur: 2.0 + ph * 0.3, len: 9 + ph, ang: 0.38, dps: 30 });
          rd.act = { k: 'breath', t: 0, dur: 2.8 + ph * 0.3 };
          this._broadcast({ t: 'rp', e: 'say', s: 'もえろーっ！' });
        } else if (r < 0.6) {
          const n = 2 + ph, q = tg.lastReport;
          for (let i = 0; i < n; i++) {
            const a = rnd() * TAU, rr = i === 0 ? 0.5 : 2 + rnd() * 3;
            this._raidHz({ k: 'z', p: [clamp(q[0] + Math.cos(a) * rr, 3, AW - 3), FY, clamp(q[2] + Math.sin(a) * rr, 3, AD - 3)], r: 2.0, d: 0.8, dur: 6, dps: 18 });
          }
          rd.atkT = (1.8 - ph * 0.2) * Dd.cd;
        } else if (ph >= 2 && r < 0.82) {
          const dir = flatDir(boss.pos, tg.lastReport);
          for (let i = 1; i <= 7; i++) {
            const p = [clamp(boss.pos[0] + dir[0] * i * 2.2, 2, AW - 2), FY, clamp(boss.pos[2] + dir[2] * i * 2.2, 2, AD - 2)];
            this._raidHz({ k: 'c', p: p, r: 1.4, d: 0.6 + i * 0.15, dmg: 28, up: 11 });
          }
          rd.atkT = (1.8 - ph * 0.2) * Dd.cd;
        } else {
          const o = [boss.pos[0], boss.pos[1] + 0.5, boss.pos[2]], n = 2 + ph;
          for (let i = 0; i < n; i++) {
            this._raidLater(i * 0.25, () => {
              if (!boss.alive || !tg.alive) return;
              const dir = this._raidAimAt(o, tg, 24, 0.7);
              this._raidShoot(boss, WPN.fire, [boss.pos[0], boss.pos[1] + 0.5, boss.pos[2]], V.spread(dir, 5, rnd), 24);
            });
          }
          rd.atkT = (1.5 - ph * 0.15) * Dd.cd;
        }
      },

      /* ---------- ブラックキューブ王: ぜんぶ ---------- */
      st_king: function (rd, boss, dt) {
        const B = R.bossOf('st_king'), Dd = DF(rd), ph = rd.phase;
        const tg = this._raidPick(boss);
        const act = rd.act;
        if (act && act.k === 'stomp') {
          act.t += dt;
          const k = clamp(act.t / act.dur, 0, 1);
          const up = k < 0.55 ? Math.sin(k / 0.55 * Math.PI / 2) * 3 : 3 * (1 - (k - 0.55) / 0.45) - B.hover * ((k - 0.55) / 0.45);
          boss.pos[1] = H.hoverY(B) + up;
          if (k >= 1) {
            rd.act = null;
            const p = [boss.pos[0], FY, boss.pos[2]];
            this._raidHz({ k: 'r', p: p, spd: 9, max: 24, dmg: 30, w: 0.6, h: 0.85, c: 2 });
            if (ph >= 2) this._raidLater(0.7, () => this._raidHz({ k: 'r', p: p, spd: 9, max: 24, dmg: 26, w: 0.6, h: 0.85, c: 2 }));
            this._broadcast({ t: 'rp', e: 'slam', p: [r2(p[0]), r2(p[1]), r2(p[2])] });
            rd.atkT = 1.4 * Dd.cd;
          }
          return;
        }
        if (act && act.k === 'sweep') {
          act.t += dt;
          if (act.t >= act.dur) { rd.act = null; rd.atkT = 1.0 * Dd.cd; }
          boss.yaw = CS.wrapAngle(act.yaw + act.yv * Math.max(0, act.t - 1.0));
          return;
        }
        /* ふわふわ 円を えがいて うごく */
        rd.mv.t += dt * (0.15 + ph * 0.05);
        const tx = CX + Math.cos(rd.mv.t) * 6, tz = CZ + 2 + Math.sin(rd.mv.t * 1.2) * 6;
        boss.vel[0] = (tx - boss.pos[0]) * 1.2; boss.vel[2] = (tz - boss.pos[2]) * 1.2; boss.vel[1] = 0;
        boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt;
        boss.pos[1] = H.hoverY(B) + Math.sin(this.time * 1.6) * 0.3;
        if (tg) H.turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 2);
        /* 分身が いる あいだは シールド */
        if (rd.clones) {
          if (this._raidAliveMinions() === 0 || this.time > rd.clones) { rd.clones = 0; this._raidShield(false); }
          else if (rd.shieldT < 0.5) rd.shieldT = 0.5;
        }
        rd.atkT -= dt;
        if (rd.atkT > 0 || !tg) return;
        const r = rnd();
        const c = [boss.pos[0], boss.pos[1], boss.pos[2]];
        if (r < 0.14) {
          tp(this, boss, 8 + rnd() * (AW - 16), 10 + rnd() * (AD - 18));
          rd.atkT = 0.8 * Dd.cd;
        } else if (r < 0.32) {
          const n = 1 + ph;
          for (let i = 0; i < n; i++) this._raidLater(i * 0.5, () => { if (boss.alive && tg.alive) this._raidShoot(boss, WPN.hole, [boss.pos[0], boss.pos[1], boss.pos[2]], this._raidAimAt(c, tg, 12, 0.6), 12); });
          rd.atkT = (2.2 + n * 0.3 - ph * 0.3) * Dd.cd;
        } else if (r < 0.5) {
          const q = tg.lastReport, yaw = Math.atan2(-(q[0] - c[0]), -(q[2] - c[2])) - 0.9;
          const yv = 0.9 + ph * 0.15;
          this._raidHz({ k: 'b', o: [c[0], FY + 0.9, c[2]], yaw: yaw, pitch: 0, yv: yv, d: 1.0, dur: 2.2 + ph * 0.4, w: 0.45, dmg: 24, len: 40, c: 1 });
          rd.act = { k: 'sweep', t: 0, dur: 3.2 + ph * 0.4, yaw: yaw, yv: yv };
          this._broadcast({ t: 'rp', e: 'say', s: 'ジャンプで とびこえろ！' });
        } else if (r < 0.66) {
          rd.act = { k: 'stomp', t: 0, dur: 1.3 };
          this._raidHz({ k: 'c', p: [c[0], FY, c[2]], r: B.big + 1.2, d: 1.3, dmg: 40, up: 10 });
        } else if (ph >= 2 && r < 0.78 && !rd.clones && this._raidAliveMinions() === 0) {
          if (this._raidMinions(2 + ph) > 0) {
            rd.clones = this.time + 10;
            this._raidShield(true, 10);
            this._broadcast({ t: 'rp', e: 'say', s: '分身を たおして シールドを こわせ！' });
          }
          rd.atkT = 2 * Dd.cd;
        } else if (ph >= 3 && r < 0.9) {
          const q = tg.lastReport;
          for (let i = 0; i < 9; i++) {
            const a = rnd() * TAU, rr = i === 0 ? 0 : 2 + rnd() * 7;
            this._raidHz({ k: 'c', p: [clamp(q[0] + Math.cos(a) * rr, 3, AW - 3), FY, clamp(q[2] + Math.sin(a) * rr, 3, AD - 3)], r: 2.0, d: 1.3 + rnd() * 0.9, dmg: 34, m: 2 });
          }
          rd.atkT = 2.4 * Dd.cd;
        } else {
          const n = 3 + ph, o = [c[0], c[1] + 1.5, c[2]];
          for (let i = 0; i < n; i++) { const a = i / n * TAU; this._raidShoot(boss, WPN.missile, o.slice(), V.norm([Math.cos(a), 0.6, Math.sin(a)]), 14); }
          rd.atkT = (2.0 - ph * 0.2) * Dd.cd;
        }
      }
    };
    const HIDE = [[6, 24], [38, 24], [22, 38], [10, 34], [34, 34], [10, 14], [34, 14]];

    /* かく: 大きな キューブの 人（スキンの かお・ぼうし つき） */
    function drawBoss(r, p, rd) {
      if (!p.alive) return;
      const B = R.bossOf(rd.boss);
      const rp = this._stRp || (this._stRp = {});
      rp.pos = p.rpos; rp.quat = p.rquat; rp.yaw = p.yaw; rp.pitch = 0; rp.team = 1;
      rp.gun = B.gun ? (CS.GunMap[B.gun] || null) : false; rp.flash = p.flash; rp.protect = !!p.shield; rp.hit = p.hitFx; rp.alpha = 1;
      rp.spin = 0; rp.charge = 0; rp.side = 0; rp.slide = 0; rp.skin = SD.skinOf(B.skin); rp.boss = rd.boss === 'st_king'; rp.tank = false;
      rp.scale = B.big * 2 / 0.98;
      r.player(rp);
      const t3 = this._stT3 || (this._stT3 = [0, 0, 0]);
      t3[0] = p.rpos[0]; t3[1] = H.FLOOR_Y + 0.08; t3[2] = p.rpos[2];
      r.particle(t3, B.big * 3, CS.Skins.hexRgb(B.col, [1, 1, 1]), 0.16);
    }
    for (const b of BOSSES) R.addBoss(b, AI[b.id], drawBoss);
  }

  /* ======================================================================
     セーブ（ふつう・むずかしい それぞれ、じゅんばんに クリアした かず）
     ====================================================================== */
  function prog() {
    const S = CS.Settings;
    let s = S.story;
    if (!s || typeof s !== 'object') s = S.story = { n: 0, h: 0 };
    s.n = clamp(s.n | 0, 0, N_ST); s.h = clamp(s.h | 0, 0, N_ST);
    return s;
  }
  function markClear(ch, st, hard) {
    const s = prog(), idx = ch * 5 + st, k = hard ? 'h' : 'n';
    const before = s.n;
    if (idx === s[k]) s[k] = idx + 1;
    if (CS.saveSettings) CS.saveSettings();
    return !hard && before < N_ST && s.n >= N_ST;      // むずかしいが あそべるように なった
  }

  /* ======================================================================
     かお（キャンバスに かく）
     ====================================================================== */
  function hexOf(c) { return Array.isArray(c) ? 'rgb(' + c.slice(0, 3).map((v) => Math.round(clamp(+v || 0, 0, 1) * 255)).join(',') + ')' : c; }
  function shade(hex, k) { const c = CS.Skins.hexRgb(hex, [1, 1, 1]); return hexOf([c[0] * k, c[1] * k, c[2] * k]); }
  function drawPortrait(cv, sk, fallback) {
    const g = cv.getContext('2d'), W = cv.width, Hh = cv.height, S = CS.Skins;
    g.clearRect(0, 0, W, Hh);
    if (!S) return;
    sk = sk || { c: '', c2: '#ffffff', d: S.DEFAULT_D, h: 'none' };
    const body = sk.c || fallback || '#ff4d5e';
    const size = Math.round(W * 0.78), x0 = Math.round((W - size) / 2), y0 = Hh - size - 6;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0 + 5, y0 + 6, size, size);
    g.fillStyle = shade(body, 0.7); g.fillRect(x0, y0, size, size);
    const pad = Math.round(size * 0.06);
    g.fillStyle = body; g.fillRect(x0 + pad, y0 + pad, size - pad * 2, size - pad * 2);
    const cell = (size - pad * 2) / 16;
    const rects = S.faceRects(sk.d)[0] || [];
    for (const rc of rects) {
      const P = S.PIX[rc[4]];
      if (!P) continue;
      g.fillStyle = rc[4] === '8' ? shade(body, 1.25) : hexOf(P);
      g.fillRect(x0 + pad + rc[0] * cell, y0 + pad + rc[1] * cell, rc[2] * cell + 0.6, rc[3] * cell + 0.6);
    }
    const hat = S.HATS[sk.h];
    if (hat && hat.boxes.length) {
      const L = hat.boxes.slice().sort((a, b) => b[2] - a[2]);
      for (const b of L) {
        const col = b[6] === 'c' ? body : b[6] === 'c2' ? (sk.c2 || '#ffffff') : hexOf(b[6]);
        g.fillStyle = col;
        g.fillRect(x0 + size / 2 + (b[0] - b[3] / 2) * size, y0 - (b[1] + b[4] / 2) * size, b[3] * size, b[4] * size);
      }
    }
  }

  /* ======================================================================
     会話（ふきだし）
     ====================================================================== */
  const DLG = { on: false, q: [], i: 0, cb: null, full: '', n: 0, timer: 0, choice: false };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function sfx(n) { try { CS.Audio.play(n || 'click'); } catch (e) {} }

  function dlgOpen(lines, cb) {
    DLG.q = (lines || []).slice(); DLG.i = 0; DLG.cb = cb || null; DLG.on = true; DLG.choice = false;
    $('stDlg').classList.add('on');
    dlgShow();
  }
  function dlgClose() {
    DLG.on = false;
    clearInterval(DLG.timer);
    $('stDlg').classList.remove('on');
    const cb = DLG.cb;
    DLG.cb = null;
    if (cb) cb();
  }
  function dlgShow() {
    clearInterval(DLG.timer);
    const it = DLG.q[DLG.i];
    if (!it) { dlgClose(); return; }
    const box = $('stDlg'), ch = $('stChoices');
    ch.innerHTML = '';
    if (!Array.isArray(it)) {
      /* えらぶ */
      DLG.choice = true;
      box.classList.add('choose');
      it.c.forEach((c, k) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn big stCh';
        b.innerHTML = '<kbd>' + (k + 1) + '</kbd> ' + esc(c[0]);
        b.addEventListener('click', (e) => { e.stopPropagation(); dlgPick(k); });
        ch.appendChild(b);
      });
      return;
    }
    DLG.choice = false;
    box.classList.remove('choose');
    const who = it[0];
    const C = who === 'me' ? null : SD.CHARS[who];
    const name = who === 'me' ? String(CS.Settings.name || 'あなた') : C ? C.name : '';
    const side = who === 'me' ? 0 : C ? C.side : 0;
    box.classList.toggle('right', side === 1);
    $('stName').textContent = name;
    $('stName').style.background = who === 'me' ? '#ff4d5e' : C ? shade(C.c, 0.8) : '#555';
    drawPortrait($('stFace'), who === 'me' ? (CS.Skins.mine ? CS.Skins.mine() : null) : SD.skinOf(who), who === 'me' ? '#ff4d5e' : null);
    DLG.full = String(it[1] || ''); DLG.n = 0;
    const tx = $('stText');
    tx.textContent = '';
    $('stNext').style.visibility = 'hidden';
    DLG.timer = setInterval(() => {
      DLG.n = Math.min(DLG.full.length, DLG.n + 1);
      tx.textContent = DLG.full.slice(0, DLG.n);
      if (DLG.n >= DLG.full.length) { clearInterval(DLG.timer); $('stNext').style.visibility = ''; }
    }, 28);
  }
  function dlgNext() {
    if (!DLG.on || DLG.choice) return;
    if (DLG.n < DLG.full.length) {
      clearInterval(DLG.timer); DLG.n = DLG.full.length; $('stText').textContent = DLG.full; $('stNext').style.visibility = '';
      return;
    }
    sfx('click');
    DLG.i++;
    dlgShow();
  }
  function dlgPick(k) {
    const it = DLG.q[DLG.i];
    if (!DLG.on || !DLG.choice || !it || !it.c[k]) return;
    sfx('ok');
    const c = it.c[k];
    DLG.q.splice(DLG.i, 1, ['me', c[0]], ...c[1]);
    dlgShow();
  }

  /* ======================================================================
     画面: ストーリー（章・ステージを えらぶ）・しっぱい
     ====================================================================== */
  let U = null, selCh = 0, hardSel = false, cur = null;
  const CSS = [
    '#stDiff{display:flex;gap:8px;justify-content:center;width:100%}#stDiff .btn{flex:1 1 140px;min-height:46px}',
    '#stDiff .btn.sel{border-color:#ffd28a;box-shadow:0 0 0 2px rgba(255,210,138,.45)}',
    '#stChs{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;width:100%}',
    '.stChB{cursor:pointer;padding:8px 4px;border-radius:12px;font:inherit;color:#eaf4ff;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;gap:2px;align-items:center}',
    '.stChB b{font-size:12px}.stChB small{font-size:10.5px;color:#9fb4d4}.stChB.sel{border-color:var(--c);box-shadow:0 0 0 2px var(--c)}.stChB.lock{opacity:.4;cursor:default}',
    '#stInfo{width:100%;text-align:left;font-size:13px;color:#cfe0f5;line-height:1.6;background:rgba(255,255,255,.04);border-radius:12px;padding:8px 12px;border:1px solid rgba(255,255,255,.1)}',
    '#stInfo b{color:#ffe08a}',
    '#stStages{display:grid;gap:6px;width:100%}',
    '.stSt{display:grid;grid-template-columns:44px 1fr auto;gap:2px 10px;align-items:center;text-align:left;cursor:pointer;padding:8px 12px;border-radius:12px;font:inherit;color:#eaf4ff;',
    '  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14)}',
    '.stSt .no{font-size:18px;font-weight:900;color:#ffe08a;grid-column:1;grid-row:1/3}.stSt b{font-size:14px;grid-column:2;grid-row:1}.stSt small{font-size:11px;color:#9fb4d4;grid-column:2;grid-row:2}',
    '.stSt .tag{font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(255,255,255,.1);grid-column:3;grid-row:1/3;white-space:nowrap}',
    '.stSt .tag.boss{background:#b8324a}.stSt .tag.fix{background:#2b5fb8}.stSt.clear .tag::after{content:" ★";color:#ffd23d}',
    '.stSt.lock{opacity:.4;cursor:default}.stSt.next{border-color:#ffd28a;box-shadow:0 0 0 2px rgba(255,210,138,.4)}',
    '#stDlg{position:fixed;inset:0;z-index:80;display:none;font-family:inherit}#stDlg.on{display:block}',
    '#stDlg .dim{position:absolute;inset:0;background:linear-gradient(transparent 40%,rgba(5,8,18,.75))}',
    '#stBox{position:absolute;left:50%;bottom:calc(18px + var(--safeB,0px));transform:translateX(-50%);width:min(860px,calc(100vw - 24px));display:flex;gap:14px;align-items:flex-end}',
    '#stDlg.right #stBox{flex-direction:row-reverse}',
    '#stFace{width:120px;height:150px;flex:0 0 auto;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))}',
    '#stBubble{position:relative;flex:1;min-height:110px;background:rgba(250,252,255,.96);color:#1a2236;border-radius:18px;padding:22px 18px 16px;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:pointer}',
    '#stName{position:absolute;top:-14px;left:16px;color:#fff;font-weight:900;font-size:14px;padding:3px 14px;border-radius:10px;letter-spacing:.06em}',
    '#stDlg.right #stName{left:auto;right:16px}',
    '#stText{margin:0;font-size:clamp(15px,2.3vmin,19px);line-height:1.7;font-weight:700;min-height:3.4em;white-space:pre-wrap}',
    '#stNext{position:absolute;right:16px;bottom:8px;color:#ff4d8a;animation:stB .6s ease-in-out infinite alternate}@keyframes stB{to{transform:translateY(4px)}}',
    '#stChoices{position:absolute;left:50%;bottom:calc(150px + var(--safeB,0px));transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;width:min(520px,calc(100vw - 40px))}',
    '#stDlg.choose #stBubble{opacity:.6}',
    '.stCh kbd{font:inherit;color:#ffe08a;margin-right:4px}',
    '#stSkip{position:absolute;top:calc(14px + var(--safeT,0px));right:14px;min-height:36px;padding:4px 14px;border-radius:10px;font:inherit;font-size:13px;color:#fff;background:rgba(10,16,32,.7);border:1px solid rgba(255,255,255,.3);cursor:pointer}',
    'body[data-rule=story] #teamScore{display:none}',
    '@media (max-width:600px){#stFace{width:84px;height:105px}#stBubble{min-height:96px;padding:20px 12px 12px}}'
  ].join('\n');

  function buildScreens() {
    if ($('scStory')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scStory" class="screen"><div class="panel wide" style="max-width:820px">' +
      '<h2>ストーリー</h2>' +
      '<p class="lead">ブラックキューブから <b>せかいの 色</b>を とりもどせ！ 5つの 章・25ステージ。やられても なんかいでも ふっかつ できるよ。</p>' +
      '<div id="stDiff"></div><div id="stChs"></div><div id="stInfo"></div><div id="stStages"></div>' +
      '<div class="stack"><button id="btnStLoadout" class="btn ghost" type="button">ぶき・部品を えらぶ</button>' +
      '<button id="btnStBack" class="btn ghost" type="button" data-back>もどる</button></div>' +
      '</div></section>' +
      '<section id="scStoryFail" class="screen"><div class="panel" style="max-width:520px">' +
      '<h2 id="stFailT">しっぱい…</h2><p id="stFailM" class="lead"></p>' +
      '<div class="stack"><button id="btnStRetry" class="btn big pink" type="button">もう一回</button>' +
      '<button id="btnStList" class="btn ghost" type="button">ストーリーへ</button></div></div></section>' +
      '<div id="stDlg"><div class="dim"></div><div id="stChoices"></div><div id="stBox"><canvas id="stFace" width="120" height="150"></canvas>' +
      '<div id="stBubble"><div id="stName"></div><p id="stText"></p><span id="stNext">▼</span></div></div>' +
      '<button id="stSkip" type="button">スキップ ▶▶</button></div>');
    U.addScreen('scStory', refresh);
    U.addScreen('scStoryFail', null);
    const tap = (id, fn, snd) => { const el = $(id); if (el) el.addEventListener('click', (e) => { e.stopPropagation(); sfx(snd); fn(); }); };
    tap('btnStLoadout', () => U.openLoadout('scStory'));
    tap('btnStBack', () => U.show('scTitle'), 'back');
    tap('btnStRetry', () => { if (cur) U.util.call('story', cur); }, 'ok');
    tap('btnStList', () => { quitGame(); U.show('scStory'); }, 'back');
    $('stBubble').addEventListener('click', (e) => { e.stopPropagation(); dlgNext(); });
    $('stDlg').addEventListener('click', () => dlgNext());
    tap('stSkip', () => { if (DLG.on) dlgClose(); }, 'back');
    window.addEventListener('keydown', (e) => {
      if (!DLG.on) return;
      const k = e.code || e.key;
      if (k === 'Space' || k === 'Enter' || k === 'KeyE' || k === 'NumpadEnter') { e.preventDefault(); e.stopPropagation(); dlgNext(); }
      else if (/^Digit[1-4]$/.test(k)) { e.preventDefault(); e.stopPropagation(); dlgPick(k.charCodeAt(5) - 49); }
      else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); dlgClose(); }
    }, true);
    /* タイトル画面の ボタン */
    const stack = document.querySelector('#scTitle .stack');
    if (stack && !$('btnStory')) {
      const b = document.createElement('button');
      b.id = 'btnStory'; b.type = 'button'; b.className = 'btn big pink';
      b.innerHTML = 'ストーリー<small>ブラックキューブから せかいを すくえ</small>';
      b.addEventListener('click', () => { sfx('click'); U.show('scStory'); });
      stack.insertBefore(b, stack.children[1] || null);
    }
  }

  function quitGame() { const g = CS.debug && CS.debug.game; if (g && g.mode !== 'idle') { try { g.quit(); } catch (e) {} } }

  function refresh() {
    const s = prog(), hardOk = s.n >= N_ST;
    if (!hardOk) hardSel = false;
    const done = hardSel ? s.h : s.n;
    const S = CS.Settings;
    if (S.storyCh != null) selCh = clamp(S.storyCh | 0, 0, CH.length - 1);
    if (selCh * 5 > done) selCh = Math.floor(Math.min(done, N_ST - 1) / 5);
    /* むずかしさ */
    const dg = $('stDiff');
    dg.innerHTML = '';
    for (const h of [false, true]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (hardSel === h ? ' sel' : '');
      b.innerHTML = h ? (hardOk ? 'むずかしい<small> 時間せいげん つき</small>' : '🔒 むずかしい<small> ぜんぶ クリアで あそべる</small>') : 'ふつう';
      if (h && !hardOk) b.disabled = true;
      b.addEventListener('click', () => { sfx('click'); hardSel = h; refresh(); });
      dg.appendChild(b);
    }
    /* 章 */
    const cg = $('stChs');
    cg.innerHTML = '';
    CH.forEach((C, i) => {
      const open = i * 5 <= done;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stChB' + (i === selCh ? ' sel' : '') + (open ? '' : ' lock');
      b.style.setProperty('--c', C.col);
      const cnt = clamp(done - i * 5, 0, 5);
      b.innerHTML = '<b>' + (open ? (i + 1) + '章' : '🔒') + '</b><small>' + esc(open ? C.name : '？？？') + '</small><small>' + (open ? '★' + cnt + '/5' : '') + '</small>';
      if (open) b.addEventListener('click', () => { sfx('click'); selCh = i; S.storyCh = i; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      cg.appendChild(b);
    });
    const C = CH[selCh];
    $('stInfo').innerHTML = '<b>' + (selCh + 1) + '章 ' + esc(C.name) + '</b> ・ ボス: ' + esc(C.bossName) + '<br>' + esc(C.desc) +
      (hardSel ? '<br>むずかしい: てきが つよく、ステージは ' + (TIME_HARD / 60) + '分・ボスは 5分 の 時間せいげん' : '');
    const sg = $('stStages');
    sg.innerHTML = '';
    C.stages.forEach((st, k) => {
      const idx = selCh * 5 + k, open = idx <= done, clear = idx < done;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stSt' + (open ? '' : ' lock') + (clear ? ' clear' : '') + (idx === done ? ' next' : '');
      const tag = st.kind === 'boss' ? '<span class="tag boss">ボス</span>' : st.fixed ? '<span class="tag fix">武器しばり</span>' : '<span class="tag">てきを たおす</span>';
      const sub = st.kind === 'boss' ? 'ボス: ' + C.bossName + '（じぶんの 武器で）' : st.fixed ? '武器: ' + st.fixed.note : 'ウェーブ ' + st.waves.length + 'かい ・ じぶんの 武器で';
      b.innerHTML = '<span class="no">' + (selCh + 1) + '-' + (k + 1) + '</span><b>' + esc(open ? st.name : '？？？') + '</b>' + tag + '<small>' + esc(open ? sub : 'まえの ステージを クリアしよう') + '</small>';
      if (open) b.addEventListener('click', () => { sfx('ok'); play(selCh, k); });
      sg.appendChild(b);
    });
  }

  function play(ch, st) {
    cur = { ch: ch, st: st, hard: hardSel ? 1 : 0 };
    const S = stageOf(ch, st);
    dlgOpen(S.pre, () => U.util.call('story', cur));
  }

  /* しあいが おわった（ステージ・ボス） */
  function onEnd(info) {
    const S = stageOf(info.ch, info.st);
    cur = { ch: info.ch, st: info.st, hard: info.hard ? 1 : 0 };
    if (!info.win) {
      $('stFailT').textContent = info.hard ? '時間ぎれ…' : 'しっぱい…';
      $('stFailM').textContent = (info.ch + 1) + '-' + (info.st + 1) + ' ' + S.name + ' ・ もう一回 ちょうせん しよう！';
      U.show('scStoryFail');
      try { CS.Audio.play('lose'); } catch (e) {}
      return;
    }
    const unlocked = markClear(info.ch, info.st, info.hard);
    const last = info.ch === CH.length - 1 && info.st === 4;
    const lines = S.post.slice();
    if (last && info.hard) lines.push(['elder', 'むずかしいも ぜんぶ クリア！ きみは でんせつの ヒーローじゃ！']);
    U.show(null);
    setTimeout(() => {
      dlgOpen(lines, () => {
        quitGame();
        if (info.st === 4 && info.ch < CH.length - 1) selCh = info.ch + 1;
        CS.Settings.storyCh = selCh;
        if (CS.saveSettings) CS.saveSettings();
        U.show('scStory');
        if (unlocked) U.toast('「むずかしい」が あそべるように なった！');
      });
    }, 400);
  }

  function init() {
    U = CS.UI;
    buildScreens();
    const orig = U.showResult;
    U.showResult = function (res) {
      if (res && res.story) return onEnd(res.story);
      if (res && res.raid && res.raid.story) return onEnd(Object.assign({}, res.raid.story, { win: res.raid.win }));
      return orig.apply(U, arguments);
    };
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  /* main.js から: ステージを はじめる */
  function start(game, opt) {
    const ch = clamp(opt.ch | 0, 0, CH.length - 1), st = clamp(opt.st | 0, 0, 4), hard = !!opt.hard;
    const S = stageOf(ch, st);
    if (S.kind === 'boss') return game.startRaid({ boss: CH[ch].boss, diff: hard ? 'hard' : 'normal', ally: 0, story: { ch: ch, st: st, hard: hard ? 1 : 0 } });
    return game.startStory({ ch: ch, st: st, hard: hard });
  }

  CS.Story = { start: start, buildStage: buildStage, drawPortrait: drawPortrait, dialog: dlgOpen, prog: prog, N: N_ST };
})();
