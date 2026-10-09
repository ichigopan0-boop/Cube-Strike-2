/* ==========================================================================
   CUBE STRIKE 2 — raid.js
   ボスレイド: みんなで きょだいな ボスを たおす（ひとり＋コンピューターの なかま でも・へやで 4人まで）
   ・ボスは 5たい: ギガキューブ / レーザーアイ / ミサイルとりで / ほのおドラゴン / ブラックキューブ
     HP が 2/3・1/3 に なると 形態が かわって こうげきが はげしくなる（すこしの あいだ シールド）
   ・ボスの こうげき: 弾（ほかの 銃と おなじ しくみ）と「予告つきの こうげき（hazard）」
       c 円（赤い 円 → ばくはつ）/ r 衝撃波の リング（ジャンプで よける）/ b レーザー（まわる・ねらう）
       f ほのおの ブレス / z もえる 床 / l 予告の 線（見た目だけ）
     hazard は ホストが きめて {t:'rh'} で みんなへ。ダメージは ホストが きめる（_hostApplyDamage）
   ・ボスは「プレイヤーの 入れもの」1つ（team 1・npc・raidBoss・big = 大きな 当たり判定）。
     ホストが うごかす（位置は コンピューターと おなじ 'pb' で みんなへ）。ザコは 入れもの 6つを つかいまわす
   ・みんなの ライフ（のこり回数）を つかいきる か 時間ぎれ で まけ。ボスを たおせば 勝ち
   game.js からは: startRaid / _raidStartCoop / _raidMapDef / _raidSetup / _raidTick / _raidKill / _raidStatus /
     _raidApplyStatus / _onRaidMsg / _raidHud / _raidLocal / _raidDraw / _raidDrawBoss / _raidEndInfo と CS.Raid を つかう
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Game) return;
  const G = CS.Game.prototype;
  const V = CS.V, Q = CS.Q, M4 = CS.M4;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v) => { v = +v; return isFinite(v) ? v : 0; };
  const r2 = (v) => Math.round(v * 100) / 100;
  const rnd = Math.random;
  const TAU = Math.PI * 2;

  const MAX_N = 4;           // プレイヤー＋なかまの コンピューター
  const POOL = 6;            // ザコの 入れもの
  const TIME = 420;          // 7分
  const PHASE_AT = [0.66, 0.33];
  const SHIELD_T = 2.5;      // 形態が かわる ときの シールド（秒）
  const FLOOR_Y = 1.0;       // アリーナの 床の 上の 面
  const AW = 44, AD = 44;    // アリーナの 大きさ
  const CX = AW / 2, CZ = AD / 2;

  const DIFFS = {
    easy: { id: 'easy', name: 'かんたん', hp: 0.65, dmg: 0.55, cd: 1.3, lives: 3, minion: 'easy', desc: 'こうげきが よわい・ライフが 多い' },
    normal: { id: 'normal', name: 'ふつう', hp: 1, dmg: 0.85, cd: 1, lives: 1, minion: 'easy', desc: 'ふつうの つよさ' },
    hard: { id: 'hard', name: 'むずかしい', hp: 1.4, dmg: 1.2, cd: 0.8, lives: -1, minion: 'normal', desc: 'ボスが タフで はげしい' }
  };
  function diffOf(id) { return DIFFS[id] || DIFFS.normal; }

  /* ---------- ボス ---------- */
  const BOSSES = {
    giga: {
      id: 'giga', name: 'ギガキューブ', title: 'あばれる 巨大ブロック', hp: 5200, big: 1.6, bigH: 1.6, hover: 0,
      desc: 'ジャンプして 地面を たたき、衝撃波（リング）を 出す。リングは ジャンプで よけよう', col: '#ff5a4d',
      theme: { floor: [0.24, 0.12, 0.10], wall: [0.30, 0.16, 0.14], trim: [0.55, 0.22, 0.12], neon: [1.0, 0.45, 0.2], sky: [0.22, 0.08, 0.06], skyTop: [0.08, 0.02, 0.02] }
    },
    eye: {
      id: 'eye', name: 'レーザーアイ', title: 'すべてを 見る 目', hp: 4600, big: 1.25, bigH: 1.25, hover: 4.2,
      desc: 'レーザーで ねらってくる。まわる レーザーは ジャンプで とびこえよう', col: '#5ac8ff',
      theme: { floor: [0.10, 0.14, 0.24], wall: [0.12, 0.18, 0.30], trim: [0.20, 0.35, 0.60], neon: [0.3, 0.85, 1.0], sky: [0.05, 0.10, 0.20], skyTop: [0.01, 0.03, 0.08] }
    },
    fort: {
      id: 'fort', name: 'ミサイルとりで', title: 'うごく ようさい', hp: 6400, big: 1.9, bigH: 1.1, hover: 0,
      desc: 'ミサイルと ほうげき（赤い 円）。円から すぐ はなれよう', col: '#8fbf5a',
      theme: { floor: [0.30, 0.28, 0.20], wall: [0.34, 0.32, 0.24], trim: [0.45, 0.42, 0.30], neon: [1.0, 0.85, 0.3], sky: [0.40, 0.36, 0.28], skyTop: [0.16, 0.18, 0.22] }
    },
    dragon: {
      id: 'dragon', name: 'ほのおドラゴン', title: 'そらを とぶ ほのおの りゅう', hp: 5000, big: 2.2, bigH: 1.2, hover: 6.5,
      desc: 'とびまわって 火の玉と ブレス。もえる 床に 気をつけて', col: '#ff8a2a',
      theme: { floor: [0.16, 0.12, 0.12], wall: [0.22, 0.16, 0.14], trim: [0.40, 0.18, 0.10], neon: [1.0, 0.55, 0.15], sky: [0.30, 0.10, 0.06], skyTop: [0.10, 0.03, 0.04] }
    },
    void: {
      id: 'void', name: 'ブラックキューブ', title: 'やみの 立方体', hp: 5600, big: 1.4, bigH: 1.4, hover: 2.4,
      desc: 'ワープして ブラックホールと トゲ。分身が いる あいだは シールド', col: '#a070ff',
      theme: { floor: [0.10, 0.08, 0.16], wall: [0.14, 0.10, 0.22], trim: [0.30, 0.18, 0.45], neon: [0.75, 0.4, 1.0], sky: [0.08, 0.04, 0.14], skyTop: [0.02, 0.01, 0.05] }
    }
  };
  const BOSS_IDS = ['giga', 'eye', 'fort', 'dragon', 'void'];
  function bossOf(id) { return BOSSES[id] || BOSSES.giga; }

  /* ---------- ボスの 弾（ぶきとしては えらべない） ---------- */
  const P = CS.Weapons.P;
  const BW = (o) => Object.assign({
    type: 'projectile', hs: 1, auto: false, burst: 0, pellets: 1, spread: 0, adsSpread: 0, moveSpread: 0, falloff: null,
    recoil: [0, 0], zoom: 1, move: 1, spinup: 0, charge: 0, pierce: false, flame: null, beam: null, tracerWidth: 0.05,
    muzzle: [0, 0, -0.3], muzzle2: null, viewSpin: null, view: [], rpm: 600, mag: 999, reload: 1, range: 160,
    special: true, raidBoss: true, noBot: true, sfx: 'shot_plasma', stats: {}
  }, o);
  const WPN = {
    cube: BW({ id: 'rb_cube', name: 'ボスの がれき', dmg: 20, tracer: [1.0, 0.5, 0.35], proj: P({ speed: 22, grav: 10, size: 0.4, hitR: 0.1 }) }),
    orb: BW({ id: 'rb_orb', name: 'ボスの 光の玉', dmg: 22, tracer: [0.55, 0.85, 1.0], proj: P({ speed: 14, size: 0.45, hitR: 0.15 }) }),
    missile: BW({ id: 'rb_missile', name: 'ボスの ミサイル', dmg: 8, tracer: [1.0, 0.7, 0.3], sfx: 'shot_rocket',
      proj: P({ speed: 17, size: 0.26, homing: 2.2, homingCone: 70, radius: 2.2, splashDmg: 26, splashMin: 0.3, fuse: 6 }) }),
    bullet: BW({ id: 'rb_bullet', name: 'ボスの きかんじゅう', dmg: 8, tracer: [1.0, 0.85, 0.4], sfx: 'shot_lmg', proj: P({ speed: 75, size: 0.08, fast: true }) }),
    fire: BW({ id: 'rb_fire', name: 'ボスの 火の玉', dmg: 12, tracer: [1.0, 0.5, 0.15], sfx: 'shot_rocket',
      proj: P({ speed: 24, grav: 4, size: 0.55, radius: 2.6, splashDmg: 30, splashMin: 0.3 }) }),
    hole: BW({ id: 'rb_hole', name: 'ボスの ブラックホール', dmg: 10, tracer: [0.7, 0.35, 1.0],
      proj: P({ speed: 12, size: 0.6, fuse: 2.2, field: { r: 4.5, dur: 3, pull: 12, dps: 16 } }) }),
    hz: BW({ id: 'rb_hz', name: 'ボスの こうげき', dmg: 999, tracer: [1, 0.4, 0.3], proj: P({ speed: 1 }) })
  };
  for (const k in WPN) CS.GunMap[WPN[k].id] = WPN[k];

  /* ======================================================================
     アリーナ（ボスごとに 色が ちがう）
     ====================================================================== */
  function buildArena(bossId) {
    const T = bossOf(bossId).theme;
    const g = new CS.MapKit.Grid(AW, 22, AD);
    const B = { FLOOR: 1, WALL: 2, TRIM: 3, CRATE: 4, METAL: 7, NEON: 30, NEON2: 31 };
    g.shell(B.FLOOR, B.WALL, B.TRIM);
    /* 床の 光る 線（十字と 外の わく） */
    g.fill(CX - 1, 0, 4, CX, 0, AD - 5, B.NEON); g.fill(4, 0, CZ - 1, AW - 5, 0, CZ, B.NEON);
    g.fill(6, 0, 6, AW - 7, 0, 6, B.NEON2); g.fill(6, 0, AD - 7, AW - 7, 0, AD - 7, B.NEON2);
    g.fill(6, 0, 6, 6, 0, AD - 7, B.NEON2); g.fill(AW - 7, 0, 6, AW - 7, 0, AD - 7, B.NEON2);
    /* 4本の 柱（上は 見えない かべ） */
    for (const p of [[11, 11], [AW - 13, 11], [11, AD - 13], [AW - 13, AD - 13]]) {
      g.fill(p[0], 1, p[1], p[0] + 1, 7, p[1] + 1, B.METAL);
      g.fill(p[0], 4, p[1], p[0] + 1, 4, p[1] + 1, B.NEON);
      g.fill(p[0], 8, p[1], p[0] + 1, 21, p[1] + 1, 255);
    }
    /* ひくい かべ（かくれる ところ） */
    const low = [[16, 8, 19, 8], [AW - 20, 8, AW - 17, 8], [16, AD - 9, 19, AD - 9], [AW - 20, AD - 9, AW - 17, AD - 9],
      [8, 17, 8, 20], [8, AD - 21, 8, AD - 18], [AW - 9, 17, AW - 9, 20], [AW - 9, AD - 21, AW - 9, AD - 18]];
    for (const w of low) { g.fill(w[0], 1, w[1], w[2], 1, w[3], B.CRATE); }
    /* すみの 高台（高さ2）と 木箱の 上り口 */
    for (const c of [[1, 1], [AW - 5, 1], [1, AD - 5], [AW - 5, AD - 5]]) {
      g.fill(c[0], 1, c[1], c[0] + 3, 2, c[1] + 3, B.TRIM);
      g.fill(c[0], 2, c[1], c[0] + 3, 2, c[1], B.NEON2);
    }
    g.fill(5, 1, 3, 5, 1, 3, B.CRATE); g.fill(AW - 6, 1, 3, AW - 6, 1, 3, B.CRATE);
    g.fill(5, 1, AD - 4, 5, 1, AD - 4, B.CRATE); g.fill(AW - 6, 1, AD - 4, AW - 6, 1, AD - 4, B.CRATE);
    /* かべの 上の 光る おび */
    g.fill(0, 6, 0, AW - 1, 6, 0, B.NEON2); g.fill(0, 6, AD - 1, AW - 1, 6, AD - 1, B.NEON2);
    g.fill(0, 6, 0, 0, 6, AD - 1, B.NEON2); g.fill(AW - 1, 6, 0, AW - 1, 6, AD - 1, B.NEON2);
    const h = CS.PLAYER.half + 0.002;
    const sp0 = [], sp1 = [];
    for (let i = 0; i < 6; i++) sp0.push({ p: [CX - 5 + i * 2 + 0.5, FLOOR_Y + h, 4.5], yaw: Math.PI });
    for (let i = 0; i < 6; i++) sp1.push({ p: [CX - 5 + i * 2 + 0.5, FLOOR_Y + h, AD - 4.5], yaw: 0 });
    const dimc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    /* CS2: ストーリーの ボスは 章ごとの かざり（森の 木・さばくの サボテン など） */
    const BB = bossOf(bossId);
    if (BB.deco) { try { BB.deco(g, B); } catch (e) { if (window.console) console.error('[raid] deco', e); } }
    return CS.MapKit.finish(g, [sp0, sp1], {
      palette: Object.assign({ 1: T.floor, 2: T.wall, 3: T.trim, 4: dimc(T.trim, 0.8), 7: dimc(T.wall, 1.4), 30: T.neon, 31: dimc(T.neon, 0.75) }, BB.pal || {}),
      sky: T.sky, skyTop: T.skyTop, ambSky: [0.55, 0.52, 0.6], ambGnd: [0.3, 0.26, 0.28], sunCol: [0.75, 0.68, 0.7],
      sun: V.norm([0.35, 0.85, 0.25]), fogNear: 45, fogFar: 140, outdoor: false
    });
  }

  /* ======================================================================
     はじめる
     ====================================================================== */
  function bestTable() {
    let b = CS.Settings.raidBest;
    if (!b || typeof b !== 'object') b = CS.Settings.raidBest = {};
    return b;
  }
  function cleanCfg(o) {
    o = o || {};
    const c = {
      boss: BOSSES[o.boss] ? o.boss : 'giga',
      diff: DIFFS[o.diff] ? o.diff : 'normal',
      ally: clamp(o.ally | 0, 0, MAX_N - 1)
    };
    /* CS2: ストーリーの ボス戦（ch = 章 0..4・st = ステージ・hard = むずかしい） */
    if (o.story && typeof o.story === 'object') c.story = { ch: clamp(o.story.ch | 0, 0, 9), st: clamp(o.story.st | 0, 0, 9), hard: o.story.hard ? 1 : 0 };
    return c;
  }
  const STORY_T = 300;       // ストーリーの むずかしい: ボス戦の 時間

  /* ひとりで（＋コンピューターの なかま） */
  G.startRaid = function (opt) {
    if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
    const c = cleanCfg(opt);
    this._teardown();
    this.isHost = true;
    this.myNetId = 'host';
    this.offline = true;
    const humans = [{ id: 'host', name: String(CS.Settings.name || 'プレイヤー'), gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(), skin: this._mySkin(), fc: '' }];
    this._raidStartWith(humans, c, false);
    return true;
  };

  /* みんなで（へやの ホストが「スタート」） */
  G._raidStartCoop = function () {
    if (!CS.Bots || !this.isHost || !this.room) return false;
    const c = cleanCfg(this.room.raid);
    const humans = this.room.players.filter((p) => !p.bot).slice(0, MAX_N).map((p) => ({
      id: p.id, name: p.name, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, skin: p.skin || null, fc: p.fc || ''
    }));
    if (!humans.length) return false;
    this.offline = false;
    this._raidStartWith(humans, c, true);
    return true;
  };

  const ALLY_NAMES = ['アルファ', 'ブラボー', 'チャーリー'];
  const MINION_NAMES = ['ザコA', 'ザコB', 'ザコC', 'ザコD', 'ザコE', 'ザコF'];
  G._raidStartWith = function (humans, c, coop) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const rg = CS.rng((seed ^ 0x7a1d) >>> 0);
    const D = diffOf(c.diff);
    const players = [], spawns = [], slot = [0, 0];
    const add = (pd) => { players.push(pd); spawns.push(slot[pd.team]++); };
    for (const h of humans) add({ id: h.id, name: h.name, team: 0, gun: h.gun, gun2: h.gun2 || '', gm: h.gm || '', gm2: h.gm2 || '', bomb: h.bomb, skin: h.skin || null, fc: h.fc || '' });
    const ally = Math.min(c.ally, MAX_N - humans.length);
    for (let i = 0; i < ally; i++) {
      const lo = CS.Bots.randomLoadout(rg);
      add({ id: 'ra' + i, name: 'CPU・' + ALLY_NAMES[i], team: 0, gun: lo.gun, bomb: lo.bomb, bot: c.diff === 'hard' ? 'hard' : 'normal', skin: CS.Skins ? CS.Skins.random(rg, { teamColor: true, noPattern: true }) : null });
    }
    add({ id: 'boss', name: bossOf(c.boss).name, team: 1, gun: 'ar', bomb: 'frag', npc: 1 });
    for (let i = 0; i < POOL; i++) {
      const lo = CS.Bots.randomLoadout(rg);
      add({ id: 'rm' + i, name: MINION_NAMES[i], team: 1, gun: lo.gun, bomb: lo.bomb, bot: D.minion, skin: minionSkin(c.boss, rg) });
    }
    this._broadcast({
      t: 'start', seed: seed, map: 'raid_' + c.boss, mode: 'raid', players: players, spawns: spawns,
      rule: { id: 'raid' }, raid: { boss: c.boss, diff: c.diff, n: humans.length, ally: ally, coop: coop ? 1 : 0, story: c.story || 0 }
    });
  };

  function minionSkin(bossId, rg) {
    const S = CS.Skins;
    if (!S) return null;
    if (BOSSES[bossId] && BOSSES[bossId].minion) return S.clean(BOSSES[bossId].minion);
    const col = { giga: '#a3263a', eye: '#1f5f9a', fort: '#4f6a2a', dragon: '#9a4a12', void: '#3a1f6a' }[bossId] || '#23262f';
    const f = S.FACES[[10, 2, 6, 10, 3][BOSS_IDS.indexOf(bossId)] || 10];
    return S.clean({ c: col, c2: '#ffd23d', f: f.f, h: rg() < 0.5 ? 'horn' : 'none', p: 'none' });
  }

  G._raidMapDef = function (rd) {
    const id = rd && BOSSES[rd.boss] ? rd.boss : 'giga';
    return { id: 'raid_' + id, name: bossOf(id).name + 'の アリーナ', build: () => buildArena(id) };
  };

  /* ======================================================================
     しあいの はじめ（みんな）
     ====================================================================== */
  G._raidSetup = function (rd) {
    const c = cleanCfg(rd);
    const B = bossOf(c.boss), D = diffOf(c.diff);
    const n = clamp((rd && rd.n) | 0, 1, MAX_N), ally = clamp((rd && rd.ally) | 0, 0, MAX_N - 1);
    const boss = this.players.find((p) => p.id === 'boss');
    if (!boss) return;
    const max = Math.round(B.hp * D.hp * (1 + 0.55 * (n - 1) + 0.35 * ally));
    this.raid = {
      boss: c.boss, diff: c.diff, n: n, ally: ally, coop: !!(rd && rd.coop), bossIdx: boss.idx,
      phase: 1, lives: c.story ? 99 : Math.max(2, 4 + 2 * n + D.lives), time: 0, left: TIME, over: false, win: false, endT: -1,
      story: c.story || null, tlim: c.story ? (c.story.hard ? STORY_T : 0) : TIME,
      hz: [], hzSeq: 0, queue: [], atkT: 3, act: null, pseq: 0, kills: 0, shieldT: 0, mv: { t: 0 }, deaths: 0
    };
    boss.raidBoss = true; boss.npc = true; boss.cpu = true;
    boss.big = B.big; boss.bigH = B.bigH;
    boss.maxHp = max; boss.hp = max; boss.noRegen = true; boss.dmgMul = D.dmg;
    boss.name = B.name;
    const y = FLOOR_Y + B.bigH + (B.hover || 0) + 0.02;
    boss.pos[0] = CX; boss.pos[1] = y; boss.pos[2] = CZ + 6;
    boss.rpos[0] = CX; boss.rpos[1] = y; boss.rpos[2] = CZ + 6;
    boss.yaw = 0; boss.ryaw = 0;
    boss.quat = Q.fromAxisAngle([0, 1, 0], 0); boss.rquat = boss.quat.slice();
    boss.alive = true;
    if (this.hostBots) {
      boss.rpos = boss.pos; boss.rquat = boss.quat;
      boss.bot = { raid: true, level: 'hard', brain: null, ctx: this._newCtx(boss), view: null, saveMe: -1, lo: null };
    }
    /* ザコは まだ いない */
    for (const p of this.players) if (p.team === 1 && !p.raidBoss) { p.alive = false; p.hp = 0; p.respawnAt = 0; }
  };

  /* ======================================================================
     ホスト: まいフレーム
     ====================================================================== */
  G._raidTick = function (dt) {
    const rd = this.raid;
    if (!rd || rd.over || this.phase !== 'live') return;
    const boss = this.players[rd.bossIdx];
    if (!boss) return;
    rd.time += dt;
    rd.left = rd.tlim > 0 ? Math.max(0, rd.tlim - rd.time) : 0;
    if (rd.endT >= 0) { if (this.time >= rd.endT) this._raidFinish(rd.win); return; }
    if (rd.tlim > 0 && rd.left <= 0) { this._raidFinish(false); return; }
    /* プレイヤー（コンピューターでない人）が ぜんいん のこり0 → まけ */
    let humans = 0, outs = 0;
    for (const p of this.players) if (p.team === 0 && !p.cpu && p.connected && p.clone < 0) { humans++; if (p.out) outs++; }
    if (humans > 0 && outs >= humans) { this._raidFinish(false); return; }
    if (!boss.alive) return;
    /* 形態 */
    const k = boss.hp / (boss.maxHp || 1);
    if (rd.phase < 3 && k < PHASE_AT[rd.phase - 1]) this._raidPhase(rd.phase + 1);
    if (rd.shieldT > 0) { rd.shieldT -= dt; if (rd.shieldT <= 0) this._raidShield(false); }
    /* じかんで うごく こと（キュー） */
    for (let i = rd.queue.length - 1; i >= 0; i--) {
      const q = rd.queue[i];
      if (this.time >= q.t) { rd.queue.splice(i, 1); try { q.fn(); } catch (e) { if (window.console) console.error('[raid]', e); } }
    }
    /* ボスの あたま */
    const ai = AI[rd.boss];
    if (ai) ai.call(this, rd, boss, dt);
    boss.quat = Q.normalize(Q.mul(Q.fromAxisAngle([0, 1, 0], boss.yaw), Q.fromAxisAngle([1, 0, 0], boss.tilt || 0)));
    boss.rquat = boss.quat;
    boss.lastReport[0] = boss.pos[0]; boss.lastReport[1] = boss.pos[1]; boss.lastReport[2] = boss.pos[2];
    /* 予告つき こうげきの ダメージ */
    this._raidHzHost(dt);
    /* CS2: ストーリーの 火山: マグマの ゆか */
    if (rd.story && this._stLava) this._stLava(dt, rd.story.ch);
    /* ぶつかる（とっしん中） */
    if (rd.contact > 0) {
      rd.contactT = (rd.contactT || 0) - dt;
      if (rd.contactT <= 0) {
        rd.contactT = 0.35;
        for (const v of this._raidTargets()) {
          const d = Math.hypot(v.lastReport[0] - boss.pos[0], v.lastReport[2] - boss.pos[2]);
          if (d < boss.big + 0.7 && Math.abs(v.lastReport[1] - boss.pos[1]) < boss.bigH + 1) {
            const dx = (v.lastReport[0] - boss.pos[0]) / (d || 1), dz = (v.lastReport[2] - boss.pos[2]) / (d || 1);
            this._raidHurt(v, rd.contact, [dx * 11, 7, dz * 11], boss.pos);
          }
        }
      }
    }
  };

  /* ねらえる なかま（生きている team 0） */
  G._raidTargets = function () {
    const L = this._rtL || (this._rtL = []);
    L.length = 0;
    for (const p of this.players) if (p.team === 0 && p.alive && p.connected && p.clone < 0) L.push(p);
    return L;
  };
  G._raidPick = function (boss) {
    const L = this._raidTargets();
    if (!L.length) return null;
    /* ちかい人ほど ねらわれやすい（ときどき とおい人も） */
    let best = null, bs = -1e9;
    for (const p of L) {
      const d = V.dist(p.lastReport, boss.pos);
      const s = -d + rnd() * 14 + (p.cpu ? -4 : 0);
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  };

  /* ダメージ（ボスの 予告つき こうげき・ぶつかる）。kb = ふきとばし */
  G._raidHurt = function (v, dmg, kb, from) {
    const rd = this.raid, boss = this.players[rd.bossIdx];
    if (!v || !v.alive || v.protect || v.shield) return;
    this._hostApplyDamage(v, dmg * diffOf(rd.diff).dmg, boss, WPN.hz.id, false, kb || 0, from || boss.pos);
  };

  /* 予告つき こうげきを 出す（ホスト → みんな） */
  G._raidHz = function (h) {
    const rd = this.raid;
    h.id = ++rd.hzSeq;
    const out = {};
    for (const k in h) {
      const v = h[k];
      out[k] = Array.isArray(v) ? v.map((x) => r2(x)) : typeof v === 'number' ? r2(v) : v;
    }
    if (this.net) this.net.send({ t: 'rh', h: out });
    this._raidAddHz(out);
  };
  G._raidAddHz = function (h) {
    const rd = this.raid;
    if (!rd || rd.hz.length > 80) return;
    const z = Object.assign({}, h, { t0: this.time, hit: {}, tick: 0, done: false });
    rd.hz.push(z);
    const p = z.p || z.o;
    if (p && (z.k === 'c' || z.k === 'b' || z.k === 'l')) this._sfx('charge', p, 0.35);
  };

  /* ホスト: 予告つき こうげきの ダメージ */
  G._raidHzHost = function (dt) {
    const rd = this.raid;
    const T = this._raidTargets();
    for (const z of rd.hz) {
      if (z.done) continue;
      const age = this.time - z.t0;
      const D = z.d || 0;
      if (z.k === 'c') {
        if (age < D) continue;
        z.done = true;
        for (const v of T) {
          const q = v.lastReport;
          if (Math.hypot(q[0] - z.p[0], q[2] - z.p[2]) <= z.r + 0.45 && Math.abs(q[1] - z.p[1]) < 3.2) {
            this._raidHurt(v, z.dmg, z.up ? [0, z.up, 0] : [(q[0] - z.p[0]) * 1.5, 5, (q[2] - z.p[2]) * 1.5], z.p);
          }
        }
      } else if (z.k === 'r') {
        if (age < D) continue;
        const rad = (age - D) * z.spd;
        if (rad > z.max + 1) { z.done = true; continue; }
        for (const v of T) {
          if (z.hit[v.idx]) continue;
          const q = v.lastReport;
          const hd = Math.hypot(q[0] - z.p[0], q[2] - z.p[2]);
          const feet = q[1] - CS.PLAYER.half;
          if (Math.abs(hd - rad) < (z.w || 0.6) + 0.45 && feet < z.p[1] + (z.h || 0.9)) {
            z.hit[v.idx] = 1;
            const dx = (q[0] - z.p[0]) / (hd || 1), dz = (q[2] - z.p[2]) / (hd || 1);
            this._raidHurt(v, z.dmg, [dx * 8, 6, dz * 8], z.p);
          }
        }
      } else if (z.k === 'b' || z.k === 'f') {
        if (age < D) continue;
        if (age > D + z.dur) { z.done = true; continue; }
        z.tick -= dt;
        if (z.tick > 0) continue;
        z.tick = 0.25;
        const o = z.o;
        for (const v of T) {
          if ((z.hit[v.idx] || -9) > this.time - (z.k === 'b' ? 0.45 : 0.24)) continue;
          const q = v.lastReport;
          if (z.k === 'b') {
            const dir = beamDir(z, age);
            const end = this._raidBeamLen(z, dir);
            const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
            const t = clamp(dx * dir[0] + dy * dir[1] + dz * dir[2], 0, end);
            const px = o[0] + dir[0] * t - q[0], py = o[1] + dir[1] * t - q[1], pz = o[2] + dir[2] * t - q[2];
            if (Math.hypot(px, py, pz) < (z.w || 0.4) + CS.PLAYER.half) { z.hit[v.idx] = this.time; this._raidHurt(v, z.dmg, 0, o); }
          } else {
            const dir = V.forward(z.yaw, z.pitch || 0);
            const dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
            const d = Math.hypot(dx, dy, dz);
            if (d > z.len || d < 0.1) continue;
            if ((dx * dir[0] + dy * dir[1] + dz * dir[2]) / d < Math.cos(z.ang || 0.35)) continue;
            if (!this.world.lineClear(o, q)) continue;
            z.hit[v.idx] = this.time;
            this._raidHurt(v, z.dps * 0.25, 0, o);
            if (v.alive && !v.raidBoss) v.burn = { dps: 8, until: this.time + 1.5, by: this.raid.bossIdx, acc: v.burn ? v.burn.acc : 0 };
          }
        }
      } else if (z.k === 'z') {
        if (age < D) continue;
        if (age > D + z.dur) { z.done = true; continue; }
        z.tick -= dt;
        if (z.tick > 0) continue;
        z.tick = 0.5;
        for (const v of T) {
          const q = v.lastReport;
          if (Math.hypot(q[0] - z.p[0], q[2] - z.p[2]) <= z.r + 0.3 && Math.abs(q[1] - CS.PLAYER.half - z.p[1]) < 1.2) this._raidHurt(v, z.dps * 0.5, 0, z.p);
        }
      } else if (z.k === 'l') {
        if (age > (z.d || 1) + 0.2) z.done = true;
      }
    }
  };
  function beamDir(z, age) {
    const a = z.yaw + (z.yv || 0) * Math.max(0, age - (z.d || 0));
    return V.forward(a, z.pitch || 0);
  }
  /* レーザーの 長さ（かべで 止まる） */
  G._raidBeamLen = function (z, dir) {
    const rc = this.world ? this.world.raycast(z.o, dir, z.len || 40, this._rc) : null;
    return rc ? rc.t : (z.len || 40);
  };

  /* ボスの 弾（ホスト → みんな） */
  G._raidShoot = function (boss, w, o, dir, sp) {
    const rd = this.raid;
    const id = boss.idx * 100000 + (rd.pseq++ % 99000);
    const s = sp || w.proj.speed;
    const v = [dir[0] * s, dir[1] * s, dir[2] * s];
    this._addProj(boss.idx, id, w, o, v);
    if (this.net) {
      const m = { t: 'pj', i: boss.idx, id: id, g: w.id, o: [r2(o[0]), r2(o[1]), r2(o[2])], v: [r2(v[0]), r2(v[1]), r2(v[2])] };
      if (w.proj.fast) m.u = 1;
      this.net.send(m, w.proj.fast ? { unreliable: true } : undefined);
    }
    if (rnd() < 0.5) this._sfx(w.sfx || 'shot_plasma', o, 0.7);
  };
  /* あとで やる */
  G._raidLater = function (sec, fn) { this.raid.queue.push({ t: this.time + sec, fn: fn }); };
  /* ねらう 向き（すこし 先読み） */
  G._raidAimAt = function (from, v, speed, lead) {
    const q = v.lastReport;
    const d = V.dist(from, q);
    const t = speed > 0 ? d / speed * (lead || 0.8) : 0;
    const tx = q[0] + v.vel[0] * t, ty = q[1] + v.vel[1] * t * 0.3, tz = q[2] + v.vel[2] * t;
    return V.norm([tx - from[0], ty - from[1], tz - from[2]]);
  };

  /* 形態が かわる */
  G._raidPhase = function (ph) {
    const rd = this.raid;
    rd.phase = ph;
    rd.atkT = SHIELD_T + 0.8;
    rd.act = null; rd.contact = 0;
    rd.queue.length = 0;
    this._raidShield(true, SHIELD_T);
    this._broadcast({ t: 'rp', e: 'ph', ph: ph });
    /* ザコを よぶ ボス */
    if (rd.boss === 'giga' || rd.boss === 'fort') this._raidMinions(ph === 2 ? 2 : 3);
    else if (bossOf(rd.boss).phaseMinions) this._raidMinions(bossOf(rd.boss).phaseMinions[ph - 2] | 0);
  };
  G._raidShield = function (on, t) {
    const rd = this.raid, boss = this.players[rd.bossIdx];
    if (!boss) return;
    rd.shieldT = on ? (t || SHIELD_T) : 0;
    if (!!boss.shield === !!on) return;
    this._broadcast({ t: 'rp', e: 'sh', on: on ? 1 : 0 });
  };

  /* ザコを n人 よぶ（ボスの まわり） */
  G._raidMinions = function (n) {
    const rd = this.raid, D = diffOf(rd.diff), boss = this.players[rd.bossIdx];
    let made = 0;
    for (const p of this.players) {
      if (made >= n) break;
      if (p.team !== 1 || p.raidBoss || p.alive || !p.connected || !p.bot) continue;
      if (p.bot.level !== D.minion && CS.Bots) {
        p.bot.level = D.minion;
        p.bot.brain = CS.Bots.create({ level: D.minion, idx: p.idx, team: p.team, rng: CS.rng(((rd.hzSeq * 7919) + p.idx * 131) >>> 0) });
      }
      p.maxHp = Math.round(CS.RULES.hp * 0.45);
      p.dmgMul = D.dmg * 0.6;
      const spot = this._raidSpot(boss.pos[0], boss.pos[2], 3 + rnd() * 4);
      this._hostRespawn(p, { p: spot, yaw: rnd() * TAU });
      p.protectUntil = this.time + 0.8;
      made++;
    }
    if (made) this._broadcast({ t: 'rp', e: 'mn', n: made });
    return made;
  };
  /* 立てる 場所（x, z の まわり） */
  G._raidSpot = function (x, z, r) {
    const w = this.world, h = CS.PLAYER.half, c = [0, 0, 0];
    for (let k = 0; k < 24; k++) {
      const a = rnd() * TAU, rr = r * (0.5 + rnd() * 0.5);
      c[0] = clamp(x + Math.cos(a) * rr, 3, AW - 3); c[2] = clamp(z + Math.sin(a) * rr, 3, AD - 3); c[1] = FLOOR_Y + h + 0.02;
      if (!w.overlapsBox(c, h)) return [c[0], c[1], c[2]];
    }
    return [CX, FLOOR_Y + h + 0.02, CZ];
  };
  /* アリーナの 中に おさめる */
  function keepIn(p, m) { p[0] = clamp(p[0], m, AW - m); p[2] = clamp(p[2], m, AD - m); }
  function turnTo(boss, tx, tz, k) {
    const want = Math.atan2(-(tx - boss.pos[0]), -(tz - boss.pos[2]));
    boss.yaw = boss.yaw + CS.wrapAngle(want - boss.yaw) * clamp(k, 0, 1);
  }
  const groundY = (B) => FLOOR_Y + B.bigH + 0.02;
  const hoverY = (B) => FLOOR_Y + B.bigH + (B.hover || 0) + 0.02;

  /* ======================================================================
     ボスの あたま（ホスト）。this = game。rd.atkT が 0 に なったら つぎの こうげき
     ====================================================================== */
  const DRAW = {};
  const AI = {
    /* ---------- ギガキューブ: ジャンプ → 衝撃波・がれき・とっしん ---------- */
    giga: function (rd, boss, dt) {
      const B = BOSSES.giga, Dd = diffOf(rd.diff), ph = rd.phase;
      const act = rd.act;
      if (act && act.k === 'jump') {
        act.t += dt;
        const k = clamp(act.t / act.dur, 0, 1);
        boss.pos[0] = act.a[0] + (act.b[0] - act.a[0]) * k;
        boss.pos[2] = act.a[2] + (act.b[2] - act.a[2]) * k;
        boss.pos[1] = groundY(B) + Math.sin(Math.PI * k) * act.h;
        boss.vel[0] = (act.b[0] - act.a[0]) / act.dur; boss.vel[2] = (act.b[2] - act.a[2]) / act.dur;
        boss.vel[1] = Math.cos(Math.PI * k) * Math.PI * act.h / act.dur;
        boss.tilt = Math.sin(TAU * k) * 0.25;
        if (k >= 1) {
          rd.act = null; boss.tilt = 0;
          boss.vel[0] = boss.vel[1] = boss.vel[2] = 0;
          const p = [boss.pos[0], FLOOR_Y, boss.pos[2]];
          this._raidHz({ k: 'r', p: p, spd: 9 + ph * 1.5, max: 22, dmg: 34, w: 0.6, h: 0.85 });
          if (ph >= 3) this._raidLater(0.55, () => this._raidHz({ k: 'r', p: p, spd: 9 + ph * 1.5, max: 22, dmg: 30, w: 0.6, h: 0.85 }));
          this._broadcast({ t: 'rp', e: 'slam', p: [r2(p[0]), r2(p[1]), r2(p[2])] });
          const n = 6 + ph * 2;
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + rnd() * 0.3;
            this._raidShoot(boss, WPN.cube, [boss.pos[0], boss.pos[1] + 0.5, boss.pos[2]], V.norm([Math.cos(a), 0.55, Math.sin(a)]), 13 + rnd() * 5);
          }
          rd.atkT = (1.6 - ph * 0.2) * Dd.cd;
        }
        return;
      }
      if (act && act.k === 'charge') {
        act.t += dt;
        if (act.t < act.wait) { boss.vel[0] = boss.vel[2] = 0; return; }
        const sp = 17;
        boss.pos[0] += act.dir[0] * sp * dt; boss.pos[2] += act.dir[2] * sp * dt;
        boss.vel[0] = act.dir[0] * sp; boss.vel[2] = act.dir[2] * sp;
        rd.contact = 40;
        const out = boss.pos[0] < 4 || boss.pos[0] > AW - 4 || boss.pos[2] < 4 || boss.pos[2] > AD - 4;
        if (act.t > act.wait + act.dur || out) {
          keepIn(boss.pos, 4); rd.act = null; rd.contact = 0; boss.vel[0] = boss.vel[2] = 0;
          this._raidHz({ k: 'r', p: [boss.pos[0], FLOOR_Y, boss.pos[2]], spd: 11, max: 14, dmg: 26, w: 0.6, h: 0.85 });
          rd.atkT = 1.2 * Dd.cd;
        }
        return;
      }
      /* ふだん: ちかい 人へ ゆっくり あるく */
      const tg = this._raidPick(boss);
      if (tg) {
        turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 3);
        const dx = tg.lastReport[0] - boss.pos[0], dz = tg.lastReport[2] - boss.pos[2], d = Math.hypot(dx, dz);
        const sp = d > 6 ? 2.2 + ph * 0.6 : 0;
        boss.pos[0] += dx / (d || 1) * sp * dt; boss.pos[2] += dz / (d || 1) * sp * dt;
        boss.vel[0] = dx / (d || 1) * sp; boss.vel[2] = dz / (d || 1) * sp; boss.vel[1] = 0;
      }
      boss.pos[1] = groundY(B);
      keepIn(boss.pos, 4);
      rd.atkT -= dt;
      if (rd.atkT > 0 || !tg) return;
      const r = rnd();
      if (ph >= 3 && r < 0.3) {
        const dir = V.norm([tg.lastReport[0] - boss.pos[0], 0, tg.lastReport[2] - boss.pos[2]]);
        rd.act = { k: 'charge', t: 0, wait: 0.9, dur: 2.2, dir: dir };
        this._raidHz({ k: 'l', a: [boss.pos[0], FLOOR_Y + 0.05, boss.pos[2]], b: [boss.pos[0] + dir[0] * 30, FLOOR_Y + 0.05, boss.pos[2] + dir[2] * 30], d: 0.9, w: boss.big * 2 });
        this._broadcast({ t: 'rp', e: 'say', s: 'とっしん！' });
      } else if (ph >= 2 && r < 0.5 && this._raidAliveMinions() < 3) {
        this._raidMinions(2);
        rd.atkT = 1.5 * Dd.cd;
      } else if (r < 0.75) {
        const tp = tg.lastReport;
        const b = [tp[0] + tg.vel[0] * 0.6, groundY(B), tp[2] + tg.vel[2] * 0.6];
        keepIn(b, 4);
        rd.act = { k: 'jump', t: 0, dur: 1.15 - ph * 0.08, a: boss.pos.slice(), b: b, h: 6 };
        this._raidHz({ k: 'c', p: [b[0], FLOOR_Y, b[2]], r: B.big + 0.8, d: rd.act.dur, dmg: 45, up: 9 });
      } else {
        /* がれきを なげる */
        const n = 5 + ph * 2;
        for (let i = 0; i < n; i++) {
          this._raidLater(i * 0.12, () => {
            if (!boss.alive) return;
            const o = [boss.pos[0], boss.pos[1] + 1.2, boss.pos[2]];
            const dir = this._raidAimAt(o, tg, 22, 0.8);
            const sd = V.spread(V.norm([dir[0], dir[1] + 0.18, dir[2]]), 7, rnd);
            this._raidShoot(boss, WPN.cube, o, sd, 22);
          });
        }
        rd.atkT = (2.0 - ph * 0.3) * Dd.cd;
      }
    },

    /* ---------- レーザーアイ: ねらう レーザー・まわる レーザー・光の玉 ---------- */
    eye: function (rd, boss, dt) {
      const B = BOSSES.eye, Dd = diffOf(rd.diff), ph = rd.phase;
      const mv = rd.mv;
      const tg = this._raidPick(boss);
      /* ふわふわ 円を えがいて うごく（スイープ中は とまる） */
      if (!(rd.act && rd.act.k === 'sweep')) {
        mv.t += dt * (0.18 + ph * 0.05);
        const tx = CX + Math.cos(mv.t) * 7, tz = CZ + Math.sin(mv.t * 1.3) * 7;
        boss.vel[0] = (tx - boss.pos[0]) * 1.5; boss.vel[2] = (tz - boss.pos[2]) * 1.5;
        boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt;
      } else { boss.vel[0] = boss.vel[2] = 0; }
      boss.pos[1] = hoverY(B) + Math.sin(this.time * 1.7) * 0.4;
      boss.vel[1] = 0;
      if (rd.act && rd.act.k === 'aim' && rd.act.dir) {
        boss.yaw = Math.atan2(-rd.act.dir[0], -rd.act.dir[2]);
        boss.tilt = -Math.asin(clamp(rd.act.dir[1], -1, 1));
      } else if (rd.act && rd.act.k === 'sweep') {
        boss.yaw = CS.wrapAngle(rd.act.yaw + rd.act.yv * Math.max(0, this.time - rd.act.t0 - rd.act.d));
        boss.tilt = 0.6;
      } else if (tg) {
        turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 4);
        const dy = tg.lastReport[1] - boss.pos[1], dh = Math.hypot(tg.lastReport[0] - boss.pos[0], tg.lastReport[2] - boss.pos[2]);
        boss.tilt = -Math.atan2(dy, dh) * 0.8;
      }
      if (rd.act && this.time > rd.act.end) rd.act = null;
      rd.atkT -= dt;
      if (rd.atkT > 0 || !tg || rd.act) return;
      const r = rnd();
      const eye = [boss.pos[0], boss.pos[1], boss.pos[2]];
      if (ph >= 2 && r < 0.35) {
        /* まわる レーザー（足もとの 高さ。ジャンプで とびこえる） */
        const yaw0 = rnd() * TAU, yv = (rnd() < 0.5 ? -1 : 1) * (0.75 + ph * 0.18);
        const o = [boss.pos[0], FLOOR_Y + 0.95, boss.pos[2]];
        const dur = 5.5 + ph;
        rd.act = { k: 'sweep', yaw: yaw0, yv: yv, t0: this.time, d: 1.4, end: this.time + 1.4 + dur };
        this._raidHz({ k: 'b', o: o, yaw: yaw0, yv: yv, pitch: 0, len: 40, w: 0.32, d: 1.4, dur: dur, dmg: 26, c: 1 });
        if (ph >= 3) this._raidHz({ k: 'b', o: o, yaw: yaw0 + Math.PI, yv: yv, pitch: 0, len: 40, w: 0.32, d: 1.4, dur: dur, dmg: 26, c: 1 });
        this._broadcast({ t: 'rp', e: 'say', s: 'レーザーを ジャンプで とびこえろ！' });
        rd.atkT = 1.2 * Dd.cd;
      } else if (r < 0.65) {
        /* ねらう レーザー */
        const dir = V.norm([tg.lastReport[0] - eye[0], tg.lastReport[1] - eye[1], tg.lastReport[2] - eye[2]]);
        const yaw = Math.atan2(-dir[0], -dir[2]), pitch = Math.asin(clamp(dir[1], -1, 1));
        rd.act = { k: 'aim', dir: dir, end: this.time + 2.3 };
        this._raidHz({ k: 'b', o: eye, yaw: yaw, yv: 0, pitch: pitch, len: 50, w: 0.55, d: 1.0, dur: 1.2, dmg: 22 });
        if (ph >= 3) {
          const t2 = this._raidPick(boss);
          if (t2 && t2 !== tg) {
            const d2 = V.norm([t2.lastReport[0] - eye[0], t2.lastReport[1] - eye[1], t2.lastReport[2] - eye[2]]);
            this._raidHz({ k: 'b', o: eye, yaw: Math.atan2(-d2[0], -d2[2]), yv: 0, pitch: Math.asin(clamp(d2[1], -1, 1)), len: 50, w: 0.55, d: 1.2, dur: 1.2, dmg: 22 });
          }
        }
        rd.atkT = (1.8 - ph * 0.25) * Dd.cd;
      } else {
        /* 光の玉（わ・ねらい） */
        const n = 8 + ph * 4;
        const ring = (off) => {
          for (let i = 0; i < n; i++) {
            const a = i / n * TAU + off;
            this._raidShoot(boss, WPN.orb, eye.slice(), V.norm([Math.cos(a), -0.22, Math.sin(a)]), 11 + ph * 2);
          }
        };
        ring(0);
        if (ph >= 2) this._raidLater(0.6, () => { if (boss.alive) ring(Math.PI / n); });
        for (let i = 0; i < 3 + ph; i++) {
          this._raidLater(0.25 + i * 0.18, () => {
            if (!boss.alive || !tg.alive) return;
            const o = [boss.pos[0], boss.pos[1], boss.pos[2]];
            this._raidShoot(boss, WPN.orb, o, V.spread(this._raidAimAt(o, tg, 16, 0.9), 4, rnd), 16);
          });
        }
        rd.atkT = (2.2 - ph * 0.3) * Dd.cd;
      }
    },

    /* ---------- ミサイルとりで: ミサイル・ほうげき・きかんじゅう ---------- */
    fort: function (rd, boss, dt) {
      const B = BOSSES.fort, Dd = diffOf(rd.diff), ph = rd.phase;
      const tg = this._raidPick(boss);
      if (tg) {
        turnTo(boss, tg.lastReport[0], tg.lastReport[2], dt * 1.2);
        const dx = tg.lastReport[0] - boss.pos[0], dz = tg.lastReport[2] - boss.pos[2], d = Math.hypot(dx, dz);
        const sp = d > 12 ? 1.3 : d < 6 ? -1.0 : 0;
        boss.vel[0] = dx / (d || 1) * sp; boss.vel[2] = dz / (d || 1) * sp; boss.vel[1] = 0;
        boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt;
      }
      boss.pos[1] = groundY(B);
      keepIn(boss.pos, 5);
      rd.atkT -= dt;
      if (rd.atkT > 0 || !tg) return;
      const r = rnd();
      const top = [boss.pos[0], boss.pos[1] + 1.4, boss.pos[2]];
      if (r < 0.32) {
        /* ミサイル */
        const n = 2 + ph * 2;
        for (let i = 0; i < n; i++) {
          this._raidLater(i * 0.22, () => {
            if (!boss.alive) return;
            const side = (i % 2 ? 1 : -1) * 1.1, rt = V.right(boss.yaw);
            const o = [top[0] + rt[0] * side, top[1] + 0.3, top[2] + rt[2] * side];
            const fw = V.flatForward(boss.yaw);
            this._raidShoot(boss, WPN.missile, o, V.norm([fw[0] * 0.5 + (rnd() - 0.5) * 0.6, 1, fw[2] * 0.5 + (rnd() - 0.5) * 0.6]), 15);
          });
        }
        rd.atkT = (2.2 - ph * 0.3) * Dd.cd;
      } else if (r < 0.7 || ph < 2) {
        /* ほうげき（赤い 円） */
        const T = this._raidTargets();
        const n = 3 + ph * 2;
        for (let i = 0; i < n; i++) {
          const v = T[i % T.length];
          const q = v.lastReport;
          const p = [q[0] + v.vel[0] * 0.8 + (i >= T.length ? (rnd() - 0.5) * 9 : (rnd() - 0.5) * 1.5), FLOOR_Y, q[2] + v.vel[2] * 0.8 + (i >= T.length ? (rnd() - 0.5) * 9 : (rnd() - 0.5) * 1.5)];
          keepIn(p, 2);
          this._raidHz({ k: 'c', p: p, r: 2.6, d: 1.7 + i * 0.12, dmg: 42, m: 1 });
        }
        this._broadcast({ t: 'rp', e: 'fire', p: [r2(top[0]), r2(top[1]), r2(top[2])] });
        rd.atkT = (2.4 - ph * 0.3) * Dd.cd;
      } else if (r < 0.88 || ph < 3) {
        /* きかんじゅうを なぎはらう */
        const base = Math.atan2(-(tg.lastReport[0] - boss.pos[0]), -(tg.lastReport[2] - boss.pos[2]));
        const n = 18 + ph * 4;
        for (let i = 0; i < n; i++) {
          this._raidLater(i * 0.07, () => {
            if (!boss.alive) return;
            const a = base + (i / n - 0.5) * 1.3;
            const o = [boss.pos[0], boss.pos[1] + 0.9, boss.pos[2]];
            const dy = (tg.lastReport[1] - o[1]) / Math.max(4, V.dist(o, tg.lastReport));
            this._raidShoot(boss, WPN.bullet, o, V.norm([-Math.sin(a), dy, -Math.cos(a)]), 75);
          });
        }
        rd.atkT = (2.4 - ph * 0.3) * Dd.cd;
      } else {
        /* じゅうたん ばくげき: ボスから あいてへ ならんだ 円 ＋ ザコ */
        const dir = V.norm([tg.lastReport[0] - boss.pos[0], 0, tg.lastReport[2] - boss.pos[2]]);
        for (let i = 0; i < 9; i++) {
          const p = [boss.pos[0] + dir[0] * (4 + i * 3.2), FLOOR_Y, boss.pos[2] + dir[2] * (4 + i * 3.2)];
          if (p[0] < 2 || p[0] > AW - 2 || p[2] < 2 || p[2] > AD - 2) break;
          this._raidHz({ k: 'c', p: p, r: 2.4, d: 1.3 + i * 0.15, dmg: 45, m: 1 });
        }
        if (this._raidAliveMinions() < 3) this._raidMinions(2);
        rd.atkT = 2.6 * Dd.cd;
      }
    },

    /* ---------- ほのおドラゴン: 火の玉・ブレス・きゅうこうか・いんせき ---------- */
    dragon: function (rd, boss, dt) {
      const B = BOSSES.dragon, Dd = diffOf(rd.diff), ph = rd.phase;
      const act = rd.act, mv = rd.mv;
      if (act && act.k === 'dive') {
        act.t += dt;
        if (act.t < act.wait) {
          /* はじまりの 場所へ */
          const k = Math.min(1, dt * 4);
          boss.pos[0] += (act.a[0] - boss.pos[0]) * k; boss.pos[2] += (act.a[2] - boss.pos[2]) * k; boss.pos[1] += (act.a[1] - boss.pos[1]) * k;
          boss.yaw = Math.atan2(-act.dir[0], -act.dir[2]);
          return;
        }
        const sp = 19;
        boss.pos[0] += act.dir[0] * sp * dt; boss.pos[2] += act.dir[2] * sp * dt;
        boss.pos[1] += (FLOOR_Y + B.bigH + 1.2 - boss.pos[1]) * Math.min(1, dt * 5);
        boss.vel[0] = act.dir[0] * sp; boss.vel[2] = act.dir[2] * sp;
        boss.tilt = -0.25;
        rd.contact = 35;
        act.trail -= sp * dt;
        if (act.trail <= 0) { act.trail = 2.6; this._raidHz({ k: 'z', p: [boss.pos[0], FLOOR_Y, boss.pos[2]], r: 2.0, d: 0, dur: 4 + ph, dps: 26 }); }
        const out = boss.pos[0] < 3 || boss.pos[0] > AW - 3 || boss.pos[2] < 3 || boss.pos[2] > AD - 3;
        if (act.t > act.wait + 3 || out) { rd.act = null; rd.contact = 0; boss.tilt = 0; rd.atkT = 1.2 * Dd.cd; }
        return;
      }
      if (act && act.k === 'breath') {
        boss.vel[0] = boss.vel[2] = 0;
        boss.yaw = act.yaw;
        if (this.time > act.end) { rd.act = null; rd.atkT = (1.6 - ph * 0.2) * Dd.cd; }
        return;
      }
      /* ふだん: アリーナの 上を 円を えがいて とぶ */
      mv.t += dt * (0.32 + ph * 0.06);
      const rr = 13;
      const tx = CX + Math.cos(mv.t) * rr, tz = CZ + Math.sin(mv.t) * rr;
      const ty = hoverY(B) + Math.sin(this.time * 1.3) * 0.6;
      boss.vel[0] = (tx - boss.pos[0]) * 2; boss.vel[2] = (tz - boss.pos[2]) * 2; boss.vel[1] = (ty - boss.pos[1]) * 2;
      boss.pos[0] += boss.vel[0] * dt; boss.pos[2] += boss.vel[2] * dt; boss.pos[1] += boss.vel[1] * dt;
      const tg = this._raidPick(boss);
      const fy = Math.atan2(-boss.vel[0], -boss.vel[2]);
      boss.yaw = boss.yaw + CS.wrapAngle(fy - boss.yaw) * Math.min(1, dt * 3);
      boss.tilt = 0;
      rd.atkT -= dt;
      if (rd.atkT > 0 || !tg) return;
      const r = rnd();
      const mouth = () => { const f = V.flatForward(boss.yaw); return [boss.pos[0] + f[0] * 3.4, boss.pos[1] + 0.4, boss.pos[2] + f[2] * 3.4]; };
      if (ph >= 2 && r < 0.3) {
        /* きゅうこうか: 線の 上を とんで もえる 床を のこす */
        const q = tg.lastReport;
        const dir = V.norm([q[0] - boss.pos[0], 0, q[2] - boss.pos[2]]);
        const a = [q[0] - dir[0] * 14, FLOOR_Y + B.bigH + 3, q[2] - dir[2] * 14];
        keepIn(a, 4);
        rd.act = { k: 'dive', t: 0, wait: 1.2, dir: dir, a: a, trail: 0 };
        this._raidHz({ k: 'l', a: [a[0], FLOOR_Y + 0.05, a[2]], b: [a[0] + dir[0] * 40, FLOOR_Y + 0.05, a[2] + dir[2] * 40], d: 1.2, w: 3 });
        this._broadcast({ t: 'rp', e: 'say', s: 'ドラゴンが つっこんでくる！' });
      } else if (r < 0.55) {
        /* ブレス */
        const o = mouth();
        const dir = V.norm([tg.lastReport[0] - o[0], tg.lastReport[1] - o[1], tg.lastReport[2] - o[2]]);
        const yaw = Math.atan2(-dir[0], -dir[2]), pitch = Math.asin(clamp(dir[1], -1, 1));
        rd.act = { k: 'breath', yaw: yaw, end: this.time + 2.6 };
        this._raidHz({ k: 'f', o: o, yaw: yaw, pitch: pitch, ang: 0.3, len: 14, d: 0.6, dur: 1.8, dps: 48 });
      } else if (ph >= 3 && r < 0.75) {
        /* いんせき */
        const T = this._raidTargets();
        for (let i = 0; i < 12; i++) {
          const v = i < T.length ? T[i] : null;
          const p = v ? [v.lastReport[0], FLOOR_Y, v.lastReport[2]] : [4 + rnd() * (AW - 8), FLOOR_Y, 4 + rnd() * (AD - 8)];
          this._raidHz({ k: 'c', p: p, r: 2.4, d: 1.5 + rnd() * 1.0, dmg: 40, m: 2 });
        }
        this._broadcast({ t: 'rp', e: 'say', s: 'いんせきが ふってくる！' });
        rd.atkT = 2.6 * Dd.cd;
      } else {
        /* 火の玉 */
        const n = 2 + ph;
        for (let i = 0; i < n; i++) {
          this._raidLater(i * 0.3, () => {
            if (!boss.alive || !tg.alive) return;
            const o = mouth();
            this._raidShoot(boss, WPN.fire, o, V.spread(this._raidAimAt(o, tg, 24, 1), 3, rnd), 24);
          });
        }
        rd.atkT = (1.9 - ph * 0.25) * Dd.cd;
      }
    },

    /* ---------- ブラックキューブ: ワープ・ブラックホール・トゲ・分身 ---------- */
    void: function (rd, boss, dt) {
      const B = BOSSES.void, Dd = diffOf(rd.diff), ph = rd.phase;
      const tg = this._raidPick(boss);
      boss.pos[1] = hoverY(B) + Math.sin(this.time * 2.1) * 0.3;
      boss.vel[0] = boss.vel[1] = boss.vel[2] = 0;
      boss.yaw = CS.wrapAngle(boss.yaw + dt * (0.6 + ph * 0.3));
      boss.tilt = Math.sin(this.time * 0.8) * 0.3;
      /* 分身が いる あいだは シールド（9秒まで） */
      if (rd.clones) {
        if (this._raidAliveMinions() === 0 || this.time > rd.clones) { rd.clones = 0; this._raidShield(false); }
        else if (rd.shieldT < 0.5) rd.shieldT = 0.5;
      }
      rd.atkT -= dt;
      if (rd.atkT > 0 || !tg) return;
      const r = rnd();
      const c = [boss.pos[0], boss.pos[1], boss.pos[2]];
      if (r < 0.25) {
        /* ワープ */
        const spot = this._raidSpot(4 + rnd() * (AW - 8), 4 + rnd() * (AD - 8), 2);
        const from = boss.pos.slice();
        boss.pos[0] = spot[0]; boss.pos[2] = spot[2];
        this._broadcast({ t: 'rp', e: 'tp', a: [r2(from[0]), r2(from[1]), r2(from[2])], b: [r2(boss.pos[0]), r2(boss.pos[1]), r2(boss.pos[2])] });
        rd.atkT = 0.7 * Dd.cd;
      } else if (r < 0.5) {
        /* ブラックホール */
        const T = this._raidTargets();
        const n = Math.min(T.length, 1 + ph);
        for (let i = 0; i < n; i++) {
          const v = T[i];
          this._raidShoot(boss, WPN.hole, c.slice(), this._raidAimAt(c, v, 12, 0.6), 12);
        }
        rd.atkT = (2.4 - ph * 0.3) * Dd.cd;
      } else if (ph >= 2 && r < 0.68 && !rd.clones && this._raidAliveMinions() === 0) {
        /* 分身（ザコ）。ぜんぶ たおすまで シールド */
        if (this._raidMinions(2 + ph) > 0) {
          rd.clones = this.time + 9;
          this._raidShield(true, 9);
          this._broadcast({ t: 'rp', e: 'say', s: '分身を たおして シールドを こわせ！' });
        }
        rd.atkT = 2 * Dd.cd;
      } else if (ph >= 3 && r < 0.8) {
        /* やみの リング（2れんぞく） */
        const p = [boss.pos[0], FLOOR_Y, boss.pos[2]];
        this._raidHz({ k: 'r', p: p, spd: 8, max: 24, dmg: 30, w: 0.6, h: 0.85, c: 2 });
        this._raidLater(0.8, () => this._raidHz({ k: 'r', p: p, spd: 8, max: 24, dmg: 30, w: 0.6, h: 0.85, c: 2 }));
        rd.atkT = 2.2 * Dd.cd;
      } else {
        /* トゲ（足もとの 円 → 上へ ふきとばす） */
        for (const v of this._raidTargets()) {
          const q = v.lastReport;
          this._raidHz({ k: 'c', p: [q[0] + v.vel[0] * 0.5, FLOOR_Y, q[2] + v.vel[2] * 0.5], r: 1.8, d: 1.15 - ph * 0.1, dmg: 32, up: 13, s: 1 });
        }
        rd.atkT = (1.8 - ph * 0.25) * Dd.cd;
      }
    }
  };

  G._raidAliveMinions = function () {
    let n = 0;
    for (const p of this.players) if (p.team === 1 && !p.raidBoss && p.alive) n++;
    return n;
  };

  /* ホスト: だれかが たおれた（_hostApplyDamage から） */
  G._raidKill = function (v, a) {
    const rd = this.raid;
    if (!rd) return;
    if (v.raidBoss) {
      v.respawnAt = 0;
      rd.win = true; rd.endT = this.time + 2.2;
      rd.hz.length = 0; rd.queue.length = 0; rd.contact = 0;
      /* ザコも いなくなる */
      for (const p of this.players) if (p.team === 1 && !p.raidBoss && p.alive) this._broadcast({ t: 'cgo', i: p.idx });
      this._broadcast({ t: 'rp', e: 'die' });
      return;
    }
    if (v.team === 1) { v.respawnAt = 0; rd.kills++; return; }
    /* プレイヤー: のこりライフを へらす。0 なら もう ふっかつ しない（コンピューターの なかまは へらさない） */
    if (v.cpu || v.clone >= 0) return;
    rd.deaths++;
    if (rd.story) return;                    // CS2: ストーリーは なんかいでも ふっかつ
    if (rd.lives > 0) rd.lives--;
    else { v.out = true; v.respawnAt = 0; }
  };

  G._raidFinish = function (win) {
    const rd = this.raid;
    if (!rd || rd.over) return;
    rd.over = true;
    this._sendEnd(win ? 0 : 1);
  };

  /* ======================================================================
     みんなへ: じょうたい（hs の なか）・できごと
     ====================================================================== */
  G._raidStatus = function (m) {
    const rd = this.raid;
    if (!rd) return;
    m.rd = [rd.phase, rd.lives, Math.ceil(rd.left), rd.kills | 0];
  };
  G._raidApplyStatus = function (a) {
    const rd = this.raid;
    if (!rd || !Array.isArray(a)) return;
    rd.phase = clamp(a[0] | 0, 1, 3);
    rd.lives = Math.max(0, a[1] | 0);
    rd.left = Math.max(0, num(a[2]));
    rd.kills = Math.max(0, a[3] | 0);
  };

  G._onRaidMsg = function (m) {
    const rd = this.raid;
    if (!rd || this.mode !== 'match') return;
    if (m.t === 'rh') {
      if (!this.isHost && m.h && typeof m.h === 'object') this._raidAddHz(m.h);
      return;
    }
    const boss = this.players[rd.bossIdx];
    const B = bossOf(rd.boss);
    switch (m.e) {
      case 'ph':
        rd.phase = clamp(m.ph | 0, 1, 3);
        CS.UI.hud.center(B.name + ' が ' + (rd.phase === 3 ? 'ほんきを だした！（さいごの 形態）' : 'おこった！（だい' + rd.phase + '形態）'), '#ff8a8a', 2000);
        this._sfx('special');
        this.shake = Math.min(1, this.shake + 0.5);
        if (boss) for (let i = 0; i < 30; i++) {
          const a = i / 30 * TAU;
          this._addPart(boss.rpos[0], boss.rpos[1], boss.rpos[2], Math.cos(a) * 9, (rnd() - 0.3) * 5, Math.sin(a) * 9, 0.25, 1, 0.4, 0.3, 0.8, 2, 1.4, 0);
        }
        break;
      case 'sh':
        if (boss) boss.shield = !!m.on;
        if (m.on) this._sfx('spawn', boss ? boss.rpos : null, 0.8);
        break;
      case 'slam': {
        const p = m.p || [CX, FLOOR_Y, CZ];
        this._boom([p[0], p[1] + 0.3, p[2]], 4, [1, 0.55, 0.3], true);
        this._sfx('explode', p);
        const me = this.players[this.me];
        if (me) this.shake = Math.min(1, this.shake + clamp(1 - V.dist(me.pos, p) / 30, 0, 1) * 0.9);
        break;
      }
      case 'fire': {
        const p = m.p;
        if (p) for (let i = 0; i < 10; i++) this._addPart(p[0], p[1], p[2], (rnd() - 0.5) * 3, 10 + rnd() * 6, (rnd() - 0.5) * 3, 0.2, 1, 0.7, 0.3, 0.6, 0, 0.5, 0);
        this._sfx('shot_grenade', p, 0.8);
        break;
      }
      case 'tp': {
        for (const q of [m.a, m.b]) {
          if (!Array.isArray(q)) continue;
          for (let i = 0; i < 24; i++) {
            const d = V.norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
            this._addPart(q[0], q[1], q[2], d[0] * 6, d[1] * 6, d[2] * 6, 0.18, 0.6, 0.35, 1, 0.6, 0, 1.6, 0);
          }
        }
        this._sfx('portal', m.b, 0.9);
        break;
      }
      case 'mn':
        CS.UI.hud.center('ザコが あらわれた！', '#ffb3c0', 1100);
        break;
      case 'say':
        if (typeof m.s === 'string') CS.UI.hud.center(m.s.slice(0, 40), '#ffd28a', 1500);
        break;
      case 'die':
        if (boss) {
          for (let k = 0; k < 4; k++) this._boom([boss.rpos[0] + (rnd() - 0.5) * 2, boss.rpos[1] + (rnd() - 0.5) * 2, boss.rpos[2] + (rnd() - 0.5) * 2], 4, [1, 0.8, 0.4], true);
          this._sfx('explode', boss.rpos);
        }
        rd.hz.length = 0;
        CS.UI.hud.center(B.name + ' を たおした！', '#ffd23d', 2400);
        this._sfx('win');
        break;
    }
  };

  /* ======================================================================
     みんな: まいフレーム（予告つき こうげきの 見た目・けす）
     ====================================================================== */
  G._raidLocal = function (dt) {
    const rd = this.raid;
    if (!rd) return;
    for (let i = rd.hz.length - 1; i >= 0; i--) {
      const z = rd.hz[i];
      const age = this.time - z.t0, D = z.d || 0;
      let life = D + 0.6;
      if (z.k === 'r') life = D + (z.max + 1) / (z.spd || 8);
      else if (z.k === 'b' || z.k === 'f' || z.k === 'z') life = D + (z.dur || 1) + 0.2;
      if (age > life) { rd.hz.splice(i, 1); continue; }
      /* ばくはつの 見た目（円） */
      if (z.k === 'c' && !z.boomed && age >= D) {
        z.boomed = true;
        if (z.s) {
          for (let k = 0; k < 14; k++) this._addPart(z.p[0] + (rnd() - 0.5) * z.r, z.p[1], z.p[2] + (rnd() - 0.5) * z.r, 0, 9 + rnd() * 6, 0, 0.18, 0.65, 0.4, 1, 0.5, 6, 0.5, 0);
          this._sfx('stick', z.p, 0.9);
        } else {
          this._boom([z.p[0], z.p[1] + 0.4, z.p[2]], z.r, z.m === 2 ? [1, 0.5, 0.2] : [1, 0.6, 0.3], z.r >= 2.4);
          this._sfx('explode_small', z.p, 0.9);
        }
        this._shakeAt(z.p, z.r);
      }
      /* いんせき・ほうだん: おちてくる */
      if (z.k === 'c' && z.m && age < D && rnd() < dt * 30) {
        const k = 1 - age / D, h = 18 * k;
        this._addPart(z.p[0] + k * 3, z.p[1] + h, z.p[2] + k * 2, 0, -4, 0, z.m === 2 ? 0.55 : 0.32, 1, z.m === 2 ? 0.45 : 0.7, 0.2, 0.25, 0, 0, 0);
      }
      /* ブレス・もえる 床の ほのお */
      if (z.k === 'f' && age >= D && age < D + z.dur) {
        const dir = V.forward(z.yaw, z.pitch || 0);
        for (let k = 0; k < 4; k++) {
          const d = V.spread(dir, (z.ang || 0.3) * 57, rnd);
          const sp = 12 + rnd() * 6;
          this._addPart(z.o[0], z.o[1], z.o[2], d[0] * sp, d[1] * sp + 0.5, d[2] * sp, 0.35 + rnd() * 0.25, 1, 0.45 + rnd() * 0.35, 0.12, 0.7, -1, 1.5, 0);
        }
      }
      if (z.k === 'z' && age >= D && rnd() < dt * 22) {
        const a = rnd() * TAU, rr = Math.sqrt(rnd()) * z.r;
        this._addPart(z.p[0] + Math.cos(a) * rr, z.p[1] + 0.1, z.p[2] + Math.sin(a) * rr, 0, 2 + rnd() * 2, 0, 0.22 + rnd() * 0.15, 1, 0.5 + rnd() * 0.3, 0.15, 0.6, -1, 1, 0);
      }
    }
  };

  /* 予告つき こうげき を かく */
  G._raidDraw = function (r) {
    const rd = this.raid;
    if (!rd) return;
    const t = this.time, tp = this._rdTp || (this._rdTp = [0, 0, 0]), tp2 = this._rdTp2 || (this._rdTp2 = [0, 0, 0]);
    for (const z of rd.hz) {
      const age = t - z.t0, D = z.d || 0;
      if (z.k === 'c') {
        if (age >= D) continue;
        const k = age / Math.max(0.01, D), blink = 0.55 + 0.45 * Math.sin(t * (10 + k * 20));
        const n = Math.max(14, Math.round(z.r * 9));
        const col = z.s ? [0.75, 0.4, 1] : [1, 0.25, 0.2];
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU;
          tp[0] = z.p[0] + Math.cos(a) * z.r; tp[1] = z.p[1] + 0.08; tp[2] = z.p[2] + Math.sin(a) * z.r;
          r.particle(tp, 0.32, col, 0.75 * blink);
        }
        /* うちがわが だんだん うまる */
        const m = Math.max(6, Math.round(z.r * k * 7));
        for (let i = 0; i < m; i++) {
          const a = i / m * TAU + t;
          tp[0] = z.p[0] + Math.cos(a) * z.r * k; tp[1] = z.p[1] + 0.06; tp[2] = z.p[2] + Math.sin(a) * z.r * k;
          r.particle(tp, 0.26, col, 0.5);
        }
        tp[0] = z.p[0]; tp[1] = z.p[1] + 0.1; tp[2] = z.p[2];
        r.particle(tp, z.r * 1.4, col, 0.12 + 0.1 * blink);
      } else if (z.k === 'r') {
        if (age < D) continue;
        const rad = (age - D) * z.spd;
        if (rad > z.max) continue;
        const n = clamp(Math.round(rad * 5), 12, 160);
        const col = z.c === 2 ? [0.7, 0.35, 1] : [1, 0.55, 0.25];
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU;
          tp[0] = z.p[0] + Math.cos(a) * rad; tp[1] = z.p[1] + 0.35; tp[2] = z.p[2] + Math.sin(a) * rad;
          r.particle(tp, 0.55, col, 0.8);
          tp[1] = z.p[1] + 0.75;
          r.particle(tp, 0.3, [1, 0.9, 0.6], 0.5);
        }
      } else if (z.k === 'b') {
        if (age > D + z.dur) continue;
        const dir = beamDir(z, age);
        const len = this._raidBeamLen(z, dir);
        tp[0] = z.o[0] + dir[0] * len; tp[1] = z.o[1] + dir[1] * len; tp[2] = z.o[2] + dir[2] * len;
        const col = z.c ? [0.35, 0.85, 1] : [1, 0.3, 0.45];
        if (age < D) r.line(z.o, tp, col, 0.06, 0.35 + 0.3 * Math.sin(t * 25));
        else {
          r.line(z.o, tp, col, (z.w || 0.4) * 2, 0.95);
          r.line(z.o, tp, [1, 1, 1], (z.w || 0.4) * 0.7, 0.9);
          r.particle(tp, 1.2, col, 0.8);
          r.particle(z.o, 1.4, col, 0.8);
        }
      } else if (z.k === 'l') {
        if (age > D) continue;
        const a = 0.25 + 0.25 * Math.sin(t * 18);
        r.line(z.a, z.b, [1, 0.3, 0.2], z.w || 2, a);
      } else if (z.k === 'z') {
        if (age < D) continue;
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = i / n * TAU + t * 0.5;
          tp2[0] = z.p[0] + Math.cos(a) * z.r; tp2[1] = z.p[1] + 0.08; tp2[2] = z.p[2] + Math.sin(a) * z.r;
          r.particle(tp2, 0.3, [1, 0.45, 0.1], 0.6);
        }
      }
    }
  };

  /* ======================================================================
     ボスを かく（みんな）
     ====================================================================== */
  /* ボスの まわりの 箱: [cx, cy, cz, sx, sy, sz, 色, 光] を ボスの 向き・場所で */
  G._rbBox = function (r, p, q, b) {
    const m = this._rbM || (this._rbM = M4.create());
    const c = Q.rotateVec(q, [b[0], b[1], b[2]]);
    const w = this._rbW || (this._rbW = [0, 0, 0]);
    w[0] = p.rpos[0] + c[0]; w[1] = p.rpos[1] + c[1]; w[2] = p.rpos[2] + c[2];
    M4.fromTRS(m, w, q, [b[3], b[4], b[5]]);
    const h = clamp(p.hitFx || 0, 0, 1) * 0.6;
    const col = b[6];
    const cc = this._rbC || (this._rbC = [0, 0, 0]);
    cc[0] = col[0] + (1 - col[0]) * h; cc[1] = col[1] + (1 - col[1]) * h; cc[2] = col[2] + (1 - col[2]) * h;
    const o = this._rbO || (this._rbO = { emissive: 0, frame: 0.03 });
    o.emissive = Math.max(b[7] || 0, h);
    o.frame = Math.min(0.05, Math.min(b[3], b[4], b[5]) * 0.08);
    r.box(m, cc, o);
  };

  G._raidDrawBoss = function (r, p) {
    const rd = this.raid;
    if (!rd || !p.alive) return;
    const t = this.time, ph = rd.phase;
    const q = p.rquat || [0, 0, 0, 1];
    const L = [];
    const add = (cx, cy, cz, sx, sy, sz, c, e) => L.push([cx, cy, cz, sx, sy, sz, c, e || 0]);
    const s = p.big, sh = p.bigH;
    /* CS2: ストーリーの ボス（story.js が かく） */
    if (DRAW[rd.boss]) { DRAW[rd.boss].call(this, r, p, rd); return; }
    switch (rd.boss) {
      case 'giga': {
        const body = ph >= 3 ? [0.7, 0.15, 0.1] : [0.85, 0.22, 0.18], dark = [0.25, 0.07, 0.06];
        add(0, 0, 0, s * 2, sh * 2, s * 2, body);
        add(0, sh * 0.98, 0, s * 2.04, 0.12, s * 2.04, dark);
        add(0, -sh * 0.98, 0, s * 2.04, 0.12, s * 2.04, dark);
        /* かお */
        add(-0.62, 0.35, -s - 0.02, 0.62, 0.5, 0.06, [1, 1, 0.95], 0.4); add(0.62, 0.35, -s - 0.02, 0.62, 0.5, 0.06, [1, 1, 0.95], 0.4);
        add(-0.55, 0.28, -s - 0.06, 0.26, 0.3, 0.05, [0.08, 0.02, 0.02]); add(0.55, 0.28, -s - 0.06, 0.26, 0.3, 0.05, [0.08, 0.02, 0.02]);
        add(-0.65, 0.78, -s - 0.04, 0.8, 0.16, 0.06, dark); add(0.65, 0.78, -s - 0.04, 0.8, 0.16, 0.06, dark);
        add(0, -0.55, -s - 0.03, 1.4, 0.3, 0.06, [0.15, 0.03, 0.03]);
        for (let i = 0; i < 4; i++) add(-0.52 + i * 0.35, -0.47, -s - 0.06, 0.16, 0.14, 0.04, [1, 1, 1]);
        if (ph >= 2) for (let i = 0; i < 3; i++) add(s + 0.01, -0.6 + i * 0.6, -0.3 + i * 0.3, 0.04, 0.12, 1.2, [1, 0.6, 0.15], 1);
        if (ph >= 3) for (let i = 0; i < 3; i++) add(-s - 0.01, 0.6 - i * 0.6, 0.3 - i * 0.2, 0.04, 0.12, 1.2, [1, 0.6, 0.15], 1);
        break;
      }
      case 'eye': {
        const white = [0.92, 0.94, 1], iris = ph >= 3 ? [1, 0.25, 0.35] : [0.25, 0.75, 1];
        add(0, 0, 0, s * 2, sh * 2, s * 2, white);
        add(0, 0, -s - 0.03, 1.5, 1.5, 0.08, iris, 0.6);
        add(0, 0, -s - 0.08, 0.6, 0.6, 0.06, [0.02, 0.02, 0.05]);
        add(0.22, 0.22, -s - 0.1, 0.18, 0.18, 0.04, [1, 1, 1], 1);
        const fin = Math.sin(t * 3) * 0.15;
        add(s + 0.3, fin, 0, 0.5, 0.25, 1.2, [0.3, 0.4, 0.6]); add(-s - 0.3, -fin, 0, 0.5, 0.25, 1.2, [0.3, 0.4, 0.6]);
        add(0, sh + 0.3, 0, 1.2, 0.25, 0.5, [0.3, 0.4, 0.6]); add(0, -sh - 0.3, 0, 1.2, 0.25, 0.5, [0.3, 0.4, 0.6]);
        break;
      }
      case 'fort': {
        const olive = [0.32, 0.42, 0.24], dark = [0.15, 0.17, 0.14], gold = [1, 0.8, 0.3];
        add(0, -0.25, 0, s * 2, sh * 1.4, s * 2.2, olive);
        add(-s + 0.15, -sh + 0.25, 0, 0.5, 0.6, s * 2.4, dark); add(s - 0.15, -sh + 0.25, 0, 0.5, 0.6, s * 2.4, dark);
        add(0, sh * 0.55, 0.2, s * 1.2, 0.7, s * 1.2, [0.38, 0.48, 0.28]);
        add(0, sh * 0.55, -s - 0.4, 0.32, 0.32, 1.6, dark);
        add(0, sh * 0.55, -s - 1.2, 0.45, 0.45, 0.2, gold, 0.4);
        for (const sx of [-1, 1]) {
          add(sx * (s * 0.8), sh * 0.8, 0.2, 0.7, 0.6, 0.9, [0.3, 0.32, 0.3]);
          for (let i = 0; i < 2; i++) add(sx * (s * 0.8) + (i - 0.5) * 0.3, sh * 0.8, -0.27, 0.18, 0.18, 0.06, [1, 0.3, 0.2], 0.8);
        }
        add(0, sh * 0.95, 0.2, 0.2, 0.3, 0.2, [1, 0.3, 0.2], 0.5 + 0.5 * Math.sin(t * 6));
        break;
      }
      case 'dragon': {
        const red = ph >= 3 ? [0.75, 0.15, 0.08] : [0.9, 0.35, 0.12], belly = [1, 0.75, 0.35], dark = [0.35, 0.1, 0.05];
        const flap = Math.sin(t * 6) * 0.6;
        const K = 1.5;
        const dadd = (cx, cy, cz, sx, sy, sz, c, e) => add(cx * K, cy * K, cz * K, sx * K, sy * K, sz * K, c, e);
        dadd(0, 0, 0, 1.4, 1.2, 3.0, red);
        dadd(0, -0.35, -0.2, 1.1, 0.5, 2.4, belly);
        dadd(0, 0.35, -1.9, 0.9, 0.8, 1.0, red);
        dadd(-0.25, 0.55, -2.35, 0.2, 0.2, 0.1, [1, 0.95, 0.4], 1); dadd(0.25, 0.55, -2.35, 0.2, 0.2, 0.1, [1, 0.95, 0.4], 1);
        dadd(-0.3, 0.95, -1.7, 0.15, 0.5, 0.15, [0.95, 0.9, 0.8]); dadd(0.3, 0.95, -1.7, 0.15, 0.5, 0.15, [0.95, 0.9, 0.8]);
        dadd(0, 0.1, 1.9, 0.6, 0.5, 1.0, red); dadd(0, 0.2, 2.7, 0.35, 0.35, 0.8, dark);
        /* はね（はばたく） */
        for (const sx of [-1, 1]) {
          dadd(sx * 1.6, 0.35 + sx * 0 + flap * 0.6, 0, 2.2, 0.1, 1.8, dark);
          dadd(sx * 2.9, 0.35 + flap * 1.3, 0.2, 0.9, 0.08, 1.3, [0.5, 0.15, 0.08]);
        }
        break;
      }
      case 'void': {
        const black = [0.05, 0.03, 0.09], glow = [0.7, 0.35, 1];
        add(0, 0, 0, s * 2, sh * 2, s * 2, black);
        const e = 0.6 + 0.4 * Math.sin(t * 4);
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
          add(a * s, b * sh, 0, 0.1, 0.1, s * 2.05, glow, e);
          add(a * s, 0, b * s, 0.1, sh * 2.05, 0.1, glow, e);
          add(0, a * sh, b * s, s * 2.05, 0.1, 0.1, glow, e);
        }
        add(0, 0.1, -s - 0.03, 0.9, 0.35, 0.06, ph >= 3 ? [1, 0.25, 0.4] : glow, 1);
        for (let i = 0; i < 3 + ph; i++) {
          const a = t * 1.5 + i * TAU / (3 + ph);
          L.push([Math.cos(a) * (s + 1.4), Math.sin(t * 2 + i) * 0.6, Math.sin(a) * (s + 1.4), 0.45, 0.45, 0.45, glow, 0.8, true]);
        }
        break;
      }
    }
    for (const b of L) {
      /* true（9番め）= まわらない（ボスの まわりを まわる 小さな 箱） */
      if (b[8]) { this._rbBox(r, p, [0, 0, 0, 1], b); continue; }
      this._rbBox(r, p, q, b);
    }
    /* シールド */
    if (p.shield) {
      const m = this._rbS || (this._rbS = M4.create());
      const k = 1.25 + 0.05 * Math.sin(t * 6);
      M4.fromTRS(m, p.rpos, q, [s * 2 * k + 0.4, sh * 2 * k + 0.4, s * 2 * k + 0.4]);
      r.box(m, [0.45, 0.85, 1], { additive: true, alpha: 0.12 + 0.06 * Math.sin(t * 9) });
    }
    /* 足もとの かげ（光） */
    const B = bossOf(rd.boss);
    const tp = this._rdTp3 || (this._rdTp3 = [0, 0, 0]);
    tp[0] = p.rpos[0]; tp[1] = FLOOR_Y + 0.08; tp[2] = p.rpos[2];
    r.particle(tp, s * 3, CS.Skins.hexRgb(B.col, [1, 1, 1]), 0.18);
  };

  /* ======================================================================
     HUD
     ====================================================================== */
  G._raidHud = function (s) {
    const rd = this.raid;
    if (!rd) return;
    const boss = this.players[rd.bossIdx], B = bossOf(rd.boss);
    const mm = Math.floor(rd.left / 60), ss = Math.floor(rd.left % 60);
    if (rd.story) {
      s.tower = {
        label: 'だい' + (rd.story.ch + 1) + 'しょう ボス' + (rd.story.hard ? '（むずかしい）' : ''),
        text: (rd.tlim > 0 ? 'のこり ' + mm + ':' + (ss < 10 ? '0' : '') + ss + ' ・ ' : '') + 'だい' + rd.phase + '形態' + (boss && boss.shield ? ' ・ シールド中！' : '') + ' ・ やられた ' + rd.deaths,
        boss: boss ? { name: B.name, hp: boss.alive ? Math.max(1, boss.hp) : 0, max: boss.maxHp } : null
      };
      return;
    }
    s.tower = {
      label: 'ボスレイド ' + diffOf(rd.diff).name,
      text: 'のこりライフ ' + rd.lives + ' ・ のこり ' + mm + ':' + (ss < 10 ? '0' : '') + ss + ' ・ だい' + rd.phase + '形態' + (boss && boss.shield ? ' ・ シールド中！' : ''),
      boss: boss ? { name: B.name, hp: boss.alive ? Math.max(1, boss.hp) : 0, max: boss.maxHp } : null
    };
  };

  /* しあいの おわりに 出す じょうほう（_onEnd から） */
  G._raidEndInfo = function (w) {
    const rd = this.raid;
    if (!rd) return null;
    const win = w === 0;
    const best = bestTable();
    const k = rd.boss + ':' + rd.diff;
    const t = Math.round(rd.time);
    let newBest = false;
    if (win && !rd.story && (!best[k] || t < best[k])) { best[k] = t; newBest = true; if (CS.saveSettings) CS.saveSettings(); }
    const boss = this.players[rd.bossIdx];
    return {
      win: win, boss: rd.boss, bossName: bossOf(rd.boss).name, diff: rd.diff, diffName: diffOf(rd.diff).name,
      time: t, best: best[k] || 0, newBest: newBest, phase: rd.phase, kills: rd.kills, deaths: rd.deaths,
      hpLeft: boss ? Math.max(0, Math.round(boss.hp / (boss.maxHp || 1) * 100)) : 0,
      coop: rd.coop, isHost: this.isHost, ally: rd.ally, story: rd.story ? Object.assign({}, rd.story) : null,
      names: this.players.filter((p) => p.team === 0 && p.clone < 0).map((p) => p.name)
    };
  };

  /* ======================================================================
     画面: ボスレイド（えらぶ）・けっか
     ====================================================================== */
  let U = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  const fmtT = (t) => Math.floor(t / 60) + ':' + ((t % 60) < 10 ? '0' : '') + (t % 60);

  const CSS = [
    '#rdBoss{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;width:100%}',
    '.rdCard{cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:10px;border-radius:14px;text-align:left;font-family:inherit;color:#eaf4ff;',
    '  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14)}',
    '.rdCard .ic{height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:#0a0a14}',
    '.rdCard b{font-size:15px;letter-spacing:.04em}.rdCard small{font-size:11px;color:#9fb4d4;line-height:1.45}.rdCard i{font-style:normal;font-size:11px;color:#ffd28a}',
    '.rdCard.sel{border-color:#ffd28a;box-shadow:0 0 0 2px rgba(255,210,138,.5);background:rgba(255,210,138,.08)}',
    '#rdDiff,#rdAlly{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%}',
    '#rdDiff .btn,#rdAlly .btn{flex:1 1 120px;min-height:50px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
    '#rdDiff .btn small,#rdAlly .btn small{font-size:11px;color:#9fb4d4}',
    '#rdDiff .btn.sel,#rdAlly .btn.sel{border-color:#ffd28a;box-shadow:0 0 0 2px rgba(255,210,138,.45)}',
    '#rdTitle{font-size:clamp(30px,7vmin,54px);font-weight:900;letter-spacing:.08em}',
    '#rdTitle small{display:block;font-size:14px;letter-spacing:.06em;margin-top:4px}',
    '#rdStats{display:grid;gap:6px;width:100%;max-width:440px}',
    'body[data-rule=raid] #teamScore,body[data-rule=raid] #timer{display:none}',
    '#lobbyRaid{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}#lobbyRaid .btn{min-height:36px;padding:5px 12px;font-size:12.5px}'
  ].join('\n');

  function buildScreens() {
    if ($('scRaid')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scRaid" class="screen"><div class="panel wide" style="max-width:900px">' +
      '<h2>ボスレイド</h2>' +
      '<p class="lead">みんなで <b>きょだいな ボス</b>を たおそう！ HP が へると ボスは 形態が かわって つよくなる。<br>' +
      'ひとりでも（コンピューターの なかまと）、友達と <b>4人まで</b> いっしょでも あそべる。</p>' +
      '<h3>ボス</h3><div id="rdBoss"></div>' +
      '<h3>むずかしさ</h3><div id="rdDiff"></div>' +
      '<h3>コンピューターの なかま</h3><div id="rdAlly"></div>' +
      '<div class="stack">' +
      '<button id="btnRdSolo" class="btn big pink" type="button">ひとりで いどむ<small>コンピューターの なかまと いっしょ</small></button>' +
      '<button id="btnRdCoop" class="btn big" type="button">みんなで いどむ<small>へやを作って コードを送ろう（4人まで）</small></button>' +
      '<button id="btnRdLoadout" class="btn ghost" type="button">ぶき・部品を えらぶ</button>' +
      '<button id="btnRdBack" class="btn ghost" type="button" data-back>もどる</button>' +
      '</div></div></section>' +
      '<section id="scRaidResult" class="screen"><div class="panel" style="max-width:560px">' +
      '<div id="rdTitle"></div><div id="rdStats"></div><div id="rdMsg" class="msg"></div>' +
      '<div class="stack"><button id="btnRdAgain" class="btn big pink" type="button">もう一回</button>' +
      '<button id="btnRdHome" class="btn ghost" type="button">町へ</button></div>' +
      '</div></section>');
    U.addScreen('scRaid', refresh);
    U.addScreen('scRaidResult', null);
    const tap = (id, fn, snd) => { const el = $(id); if (el) el.addEventListener('click', () => { try { CS.Audio.play(snd || 'click'); } catch (e) {} fn(); }); };
    tap('btnRdSolo', () => U.util.call('raid', cfgNow()), 'ok');
    tap('btnRdCoop', () => U.util.call('create', 'raid', 'raid_' + cfgNow().boss, null), 'ok');
    tap('btnRdLoadout', () => U.openLoadout('scRaid'));
    tap('btnRdBack', () => U.show('scTitle'), 'back');
    tap('btnRdAgain', () => {
      if (lastRes && lastRes.coop) { U.util.call('again'); return; }
      U.util.call('raid', lastRes ? { boss: lastRes.boss, diff: lastRes.diff, ally: lastRes.ally } : cfgNow());
    }, 'ok');
    tap('btnRdHome', () => {
      const g = CS.debug && CS.debug.game;
      if (g) { try { g.quit(); } catch (e) {} }
      U.show('scTitle');
    }, 'back');
    /* タイトル画面の ボタン（町の レイドの門は これを おす） */
    const stack = document.querySelector('#scTitle .stack');
    if (stack && !$('btnRaid')) {
      const b = document.createElement('button');
      b.id = 'btnRaid'; b.type = 'button'; b.className = 'btn big';
      b.innerHTML = 'ボスレイド<small>みんなで きょだいな ボスを たおす</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} U.show('scRaid'); });
      stack.insertBefore(b, stack.children[1] || null);
    }
  }

  function cfgNow() {
    const S = CS.Settings;
    return cleanCfg({ boss: S.raidBoss, diff: S.raidDiff, ally: S.raidAlly == null ? 2 : S.raidAlly });
  }

  function refresh() {
    const S = CS.Settings, c = cfgNow(), best = bestTable();
    S.raidBoss = c.boss; S.raidDiff = c.diff; S.raidAlly = c.ally;
    const bg = $('rdBoss');
    bg.innerHTML = '';
    for (const id of BOSS_IDS) {
      const B = BOSSES[id];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rdCard' + (c.boss === id ? ' sel' : '');
      const cleared = ['easy', 'normal', 'hard'].filter((d) => best[id + ':' + d]).map((d) => DIFFS[d].name);
      b.innerHTML = '<span class="ic" style="background:' + B.col + '">' + esc(B.name.slice(0, 1)) + '</span><b>' + esc(B.name) + '</b>' +
        '<small>' + esc(B.title) + '</small><small>' + esc(B.desc) + '</small>' + (cleared.length ? '<i>クリア: ' + esc(cleared.join('・')) + '</i>' : '');
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} S.raidBoss = id; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      bg.appendChild(b);
    }
    const dg = $('rdDiff');
    dg.innerHTML = '';
    for (const id of ['easy', 'normal', 'hard']) {
      const D = DIFFS[id];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (c.diff === id ? ' sel' : '');
      const bt = best[c.boss + ':' + id];
      b.innerHTML = '<b>' + esc(D.name) + '</b><small>' + (bt ? 'さいこう ' + fmtT(bt) : esc(D.desc)) + '</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} S.raidDiff = id; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      dg.appendChild(b);
    }
    const ag = $('rdAlly');
    ag.innerHTML = '';
    for (let n = 0; n < MAX_N; n++) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (c.ally === n ? ' sel' : '');
      b.innerHTML = '<b>' + (n ? n + '人' : 'なし') + '</b><small>' + (n ? 'みんなで ' + (n + 1) + '人' : 'ひとりで たたかう') + '</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} S.raidAlly = n; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      ag.appendChild(b);
    }
  }

  let lastRes = null;
  function showResult(res) {
    const r = res.raid;
    lastRes = r;
    const t = $('rdTitle');
    t.style.color = r.win ? '#ffd23d' : '#ffb3c0';
    t.innerHTML = (r.win ? 'RAID CLEAR!' : 'GAME OVER') + '<small>' + esc(r.bossName) + (r.win ? ' を たおした！（' + esc(r.diffName) + '）' : ' に まけてしまった…（のこりHP ' + r.hpLeft + '%）') + '</small>';
    const rows = [
      ['ボス', r.bossName + '（' + r.diffName + '）'],
      ['かかった時間', fmtT(r.time)],
      ['さいこう記録', r.best ? fmtT(r.best) + (r.newBest ? '  きろくこうしん！' : '') : '—'],
      ['たどりついた 形態', 'だい' + r.phase + '形態'],
      ['たおした ザコ', String(r.kills)],
      ['やられた 回数', String(r.deaths)]
    ];
    rows.splice(1, 0, ['なかま', r.names.join('・')]);
    $('rdStats').innerHTML = rows.map((x) => '<div class="dfRow"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('');
    const again = $('btnRdAgain'), home = $('btnRdHome');
    if (r.coop) {
      again.style.display = r.isHost ? '' : 'none';
      again.textContent = 'ロビーへ（もう一回）';
      home.textContent = 'へやを出て 町へ';
      U.msg('rdMsg', r.isHost ? '「ロビーへ」で みんな ロビーに もどって もう一回 あそべるよ' : 'ホストが ロビーに もどると いっしょに もどります');
    } else {
      again.style.display = '';
      again.textContent = 'もう一回';
      home.textContent = '町へ';
      U.msg('rdMsg', r.win ? 'おめでとう！ ほかの ボスや むずかしさにも いどんでみよう' : 'ボスの 予告（赤い 円・線）を よく見て よけよう。回復の 銃も おすすめ');
    }
    U.show('scRaidResult');
    try { CS.Audio.play(r.win ? 'win' : 'lose'); } catch (e) {}
  }

  /* ロビー: レイドの へやの せってい（ホストは かえられる） */
  function lobbyRaid(o) {
    const info = $('lobbyInfo');
    if (!info) return;
    let box = $('lobbyRaid');
    if (o.mode !== 'raid') { if (box) box.style.display = 'none'; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'lobbyRaid';
      info.parentNode.insertBefore(box, info.nextSibling);
    }
    box.style.display = '';
    const c = cleanCfg(o.raid);
    const sig = [c.boss, c.diff, c.ally, o.isHost ? 1 : 0].join('|');
    if (box._sig === sig) return;
    box._sig = sig;
    box.innerHTML = '';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn ghost'; b.textContent = label;
      if (o.isHost) b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} fn(); });
      else b.disabled = true;
      box.appendChild(b);
    };
    const set = (k, v) => { const n = Object.assign({}, c); n[k] = v; U.util.call('roomRaid', n); };
    btn('ボス: ' + bossOf(c.boss).name + (o.isHost ? ' ▶' : ''), () => set('boss', BOSS_IDS[(BOSS_IDS.indexOf(c.boss) + 1) % BOSS_IDS.length]));
    btn('むずかしさ: ' + diffOf(c.diff).name + (o.isHost ? ' ▶' : ''), () => { const L = ['easy', 'normal', 'hard']; set('diff', L[(L.indexOf(c.diff) + 1) % 3]); });
    btn('CPUの なかま: ' + c.ally + '人' + (o.isHost ? ' ▶' : ''), () => set('ally', (c.ally + 1) % MAX_N));
  }

  function init() {
    U = CS.UI;
    buildScreens();
    const orig = U.showResult;
    U.showResult = function (res) {
      if (res && res.raid) return showResult(res);
      return orig.apply(U, arguments);
    };
    const origL = U.renderLobby;
    U.renderLobby = function (o) {
      const r = origL.apply(U, arguments);
      try { lobbyRaid(o || {}); } catch (e) { if (window.console) console.error('[raid lobby]', e); }
      return r;
    };
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  CS.Raid = {
    BOSSES: BOSSES, BOSS_IDS: BOSS_IDS, DIFFS: DIFFS, MAX_N: MAX_N, POOL: POOL, TIME: TIME,
    diffOf: diffOf, bossOf: bossOf, cleanCfg: cleanCfg, buildArena: buildArena,
    /* CS2: ストーリーの ボスを ふやす（def = BOSSES と おなじ形・ai(rd, boss, dt)・draw(r, p, rd)。レイドの 一覧には 出ない） */
    addBoss: function (def, ai, draw) { BOSSES[def.id] = def; AI[def.id] = ai; if (draw) DRAW[def.id] = draw; },
    /* ボスの あたまを 作るための 道具 */
    H: { WPN: WPN, keepIn: keepIn, turnTo: turnTo, groundY: groundY, hoverY: hoverY, AW: AW, AD: AD, CX: CX, CZ: CZ, FLOOR_Y: FLOOR_Y, SHIELD_T: SHIELD_T }
  };
})();
