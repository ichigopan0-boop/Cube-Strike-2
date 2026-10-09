/* ==========================================================================
   CUBE STRIKE 2 — castle.js
   CS2: 城バトル（あいての 城を こわしたら 勝ち）
   ・マップの 両はしに ブロックで できた 城。弾・ボムで ブロックが こわれる。城の ゲージが 0 に なると 城が くずれて 負け
   ・まんなかに 基地が 5つ。10秒 立つと せんりょう。基地が 多いほど チームの お金が ふえる（時間・たおしても ふえる）
   ・お金（チームで ひとつ）で 攻撃部隊・守備部隊・砲台・城の しゅうりを 買う（じぶんの 城か、とった 基地に いるとき）
   ・部隊は 入れもの（POOL）を 1チーム 10こ 作っておき、買ったら ホストが「ふっかつ」させる（クリスタルまもりと おなじ しくみ）
   ・ブロックの こわれは ホストが きめる: 撃った人が 'cbd' で ホストへ → ホストが 'cbx' で みんなへ（3秒ごとに 'hs' で ぜんぶ）
   ・CPU戦（じぶん＋なかまCPU vs CPU）と へや（1対1〜4対4・たりない ところは CPU）
   game.js からは: startCastle / _csStartRoom / _csMapDef / _csSetup / _csTick / _csKill / _csStatus / _csApplyStatus /
     _csOnMsg / _csHostMsg / _csLocal / _csDraw / _csDrawTurret / _csHud / _csBotView / _csBotInput / _csRcVox / _csWall /
     _csBlast / _csEndInfo / _csCleanup と CS.Castle を つかう
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Game) return;
  const G = CS.Game.prototype;
  const Q = CS.Q, M4 = CS.M4;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v) => { v = +v; return isFinite(v) ? v : 0; };
  const rnd = Math.random;
  const r1 = (v) => Math.round(v * 10) / 10;
  const TAU = Math.PI * 2;

  /* ---------- 大きさ・きまり ---------- */
  const MW = 104, MH = 22, MD = 52;          // マップ（ボクセル）
  const MAX_N = 4;                           // 1チーム 4人まで（たりない ところは CPU）
  const POOL = 12;                           // 部隊の 入れもの（1チーム）
  const MAX_UNITS = 10, MAX_TURRETS = 3;     // いちどに いられる 部隊・砲台
  const CAP_T = 10, CAP_R = 3.6, CAP_H = 3.2; // 基地: 10秒で せんりょう・はんけい・たかさ
  const BUY_R = 4.8;                         // 基地で 買える はんけい
  const BLOCK_HP = 50;                       // 城の ブロック 1こ の HP
  const FALL_K = 0.4;                        // ブロックが これだけ こわれたら 城が くずれる
  const START_MONEY = 300, MONEY_MAX = 99999;
  const INC_BASE = 3, INC_PER = 4;           // 1秒ごとの お金（いつも ＋ 基地 1つごと）
  const KILL_P = 40, KILL_U = 25;            // たおした お金（人・部隊）
  const BULLET_K = 1.0, SPLASH_K = 1.2;      // 城への ダメージ（ふつうの弾も ちゃんと こわれる・ばくはつ）
  /* さいしょから 出ている 部隊（チームごと・ただ）: [しゅるい, 0 = 攻撃 / 1 = 守備] */
  const START_UNITS = [['soldier', 0], ['soldier', 0], ['soldier', 1], ['sniper', 1]];
  const TIMES = [5, 10, 15, 0];
  const LVS = ['easy', 'normal', 'hard'];
  const LV_NAME = { easy: 'よわい', normal: 'ふつう', hard: 'つよい' };
  const TEAM_NAME = ['あか', 'あお'];
  const ST = [40, 42], TR = [41, 43];        // 城の いし・かざり（チームごと）
  const teamOfId = (id) => (id === 40 || id === 41 ? 0 : id === 42 || id === 43 ? 1 : -1);
  const HALF = CS.PLAYER.half;
  const GY = 1 + HALF + 0.002;               // 地面に 立った 立方体の 中心の 高さ

  /* 基地（ワールドの 座標。180°回して おなじ ならび: A⇔E・B⇔D・C） */
  const BASES = [
    { n: 'A', x: 30.5, z: 12.5 }, { n: 'B', x: 30.5, z: 39.5 }, { n: 'C', x: 52, z: 26 },
    { n: 'D', x: 73.5, z: 12.5 }, { n: 'E', x: 73.5, z: 39.5 }
  ];
  /* 攻撃部隊の 道（レーン 0 = 北・1 = まんなか・2 = 南）。チームごとに 手前の 基地から */
  const ROUTES = [[[0, 3], [2], [1, 4]], [[3, 0], [2], [4, 1]]];
  const LANE_Z = [18, 26, 34];

  /* チーム 0 の 座標 → チーム t の 座標（ワールド。180°回す） */
  const tx = (t, x) => (t ? MW - x : x), tz = (t, z) => (t ? MD - z : z);
  const castleC = (t) => [tx(t, 14.5), 4, tz(t, 26)];
  /* 部隊が 出てくる ところ（城の 正面の 中庭）・守備の ところ（城の 前） */
  const UNIT_SPOTS = [[18.5, 24.5], [18.5, 27.5], [17.5, 25.5], [17.5, 26.5]];
  const DEF_POSTS = [[24.5, 19.5], [24.5, 23.5], [24.5, 28.5], [24.5, 32.5], [26.5, 26]];

  /* ---------- 部隊 ---------- */
  const UNITS = {
    soldier: { id: 'soldier', name: 'ふつう兵', cost: 100, gun: 'ar', bomb: 'frag', hp: 200, dmg: 0.75, cs: 0.6, hat: 'cap', face: 1, desc: 'アサルトライフルで たたかう' },
    sniper: { id: 'sniper', name: 'スナイパー兵', cost: 150, gun: 'sniper', bomb: 'smoke', hp: 150, dmg: 0.7, cs: 0.6, hat: 'antenna', face: 3, desc: 'とおくから ねらいうち' },
    tank: { id: 'tank', name: 'タンク兵', cost: 300, gun: 'hmg', bomb: 'frag', hp: 750, dmg: 0.8, cs: 1.6, move: 0.72, hat: 'horn', pat: 'frame', face: 6, desc: 'おそいけど とても かたい。城に つよい' },
    bomber: { id: 'bomber', name: 'ボム兵', cost: 200, gun: 'grenade', bomb: 'frag', hp: 180, dmg: 0.8, cs: 1.0, hat: 'tophat', face: 2, desc: 'グレネードと ボムで 城を こわす' },
    healer: { id: 'healer', name: '回復兵', cost: 150, gun: 'pdw', bomb: 'smoke', hp: 180, dmg: 0.6, cs: 0.3, hat: 'halo', pat: 'cross', face: 4, heal: 14, desc: 'まわりの みかたを 回復する' },
    turret: { id: 'turret', name: '砲台', cost: 250, gun: 'lmg', bomb: 'weak', hp: 450, dmg: 0.6, cs: 0, turret: true, desc: 'いま いる ところに おく。うごかずに 撃つ' }
  };
  const ITEMS = ['soldier', 'sniper', 'tank', 'bomber', 'healer', 'turret', 'repair'];
  const REPAIR = { id: 'repair', name: '城の しゅうり', cost: 200, n: 40, desc: 'こわれた ブロックを 40こ もどす' };
  const itemOf = (id) => (id === 'repair' ? REPAIR : UNITS[id] || null);
  const BOT_NAMES = ['ピコ', 'ボルト', 'ドット', 'ネオン', 'ギア', 'ビット', 'キュー', 'ロボ太', 'チップ', 'ノイズ'];
  const WHY = {
    dead: 'やられている あいだは 買えないよ', zone: 'じぶんの 城か、とった 基地の 中で 買えるよ', money: 'お金が たりない',
    full: '部隊は ' + MAX_UNITS + 'たい までだよ', tfull: '砲台は ' + MAX_TURRETS + 'つ までだよ', place: 'そこには おけない',
    norep: '城は こわれていないよ', bad: '買えない', over: 'しあいは おわったよ', wait: 'しあいが はじまってから 買えるよ'
  };

  /* ======================================================================
     マップ（草原。両はしに 城・まんなかに 基地 5つ）
     ====================================================================== */
  function buildMap() {
    const g = new CS.MapKit.Grid(MW, MH, MD);
    const B = { GRASS: 1, ROCK: 2, LEAF: 3, WOOD: 4, PATH: 9, RING: 30, RING2: 31 };
    g.shell(B.GRASS, B.ROCK, null);
    const S = (x0, y0, z0, x1, y1, z1, b) => g.sym(x0, y0, z0, x1, y1, z1, b);
    /* 道（床の 色だけ） */
    S(22, 0, 24, 51, 0, 27, B.PATH);
    S(27, 0, 11, 51, 0, 13, B.PATH); S(27, 0, 38, 51, 0, 40, B.PATH);
    S(26, 0, 11, 28, 0, 40, B.PATH);
    S(2, 0, 18, 21, 0, 33, B.PATH);
    /* 基地の わ（床に 光る 線） */
    for (const b of BASES) {
      for (let z = Math.floor(b.z - 5); z <= Math.ceil(b.z + 5); z++) {
        for (let x = Math.floor(b.x - 5); x <= Math.ceil(b.x + 5); x++) {
          const d = Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z);
          if (d >= 2.9 && d <= 3.7) g.fill(x, 0, z, x, 0, z, B.RING);
          else if (d < 1.15) g.fill(x, 0, z, x, 0, z, B.RING2);
          else if (d < 2.9) g.fill(x, 0, z, x, 0, z, B.PATH);
        }
      }
      /* 基地の まわりの 木箱（ななめ 4つ） */
      for (const o of [[-6, -6], [5, -6], [-6, 5], [5, 5]]) {
        const x = Math.floor(b.x) + o[0], z = Math.floor(b.z) + o[1];
        g.fill(x, 1, z, x + 1, 1, z, B.WOOD);
        g.fill(x, 2, z, x, 2, z, B.WOOD);
      }
    }
    /* いわ（かくれる ところ）。S で あいての がわにも */
    S(36, 1, 19, 39, 3, 21, B.ROCK); S(37, 4, 20, 38, 4, 20, B.ROCK);
    S(36, 1, 30, 38, 2, 32, B.ROCK);
    S(43, 1, 5, 46, 3, 7, B.ROCK); S(44, 4, 6, 45, 4, 6, B.ROCK);
    S(41, 1, 44, 44, 2, 46, B.ROCK);
    S(46, 1, 18, 48, 3, 19, B.ROCK);
    S(33, 1, 15, 35, 1, 15, B.WOOD); S(33, 1, 36, 35, 1, 36, B.WOOD);
    S(41, 1, 25, 41, 2, 27, B.WOOD);
    S(22, 1, 7, 23, 2, 8, B.ROCK); S(22, 1, 43, 23, 2, 44, B.ROCK);
    /* 木 */
    const tree = (x, z) => { S(x, 1, z, x, 3, z, B.WOOD); S(x - 1, 4, z - 1, x + 1, 5, z + 1, B.LEAF); S(x, 6, z, x, 6, z, B.LEAF); };
    for (const p of [[14, 6], [6, 9], [18, 45], [8, 43], [36, 4], [39, 47], [47, 33], [32, 31]]) tree(p[0], p[1]);
    /* 城（あか: 左・あお: 右） */
    castle(g, 0); castle(g, 1);
    /* 外の さく（その上は 見えない かべ） */
    g.openShell(2, B.WOOD, B.WOOD);
    const spawns = CS.MapKit.makeSpawns(g, [[3, 20, 1, -Math.PI / 2], [3, 23, 1, -Math.PI / 2], [3, 28, 1, -Math.PI / 2], [3, 31, 1, -Math.PI / 2],
      [5, 21, 1, -Math.PI / 2], [5, 24, 1, -Math.PI / 2], [5, 27, 1, -Math.PI / 2], [5, 30, 1, -Math.PI / 2]]);
    return CS.MapKit.finish(g, spawns, Object.assign(CS.MapKit.env('day'), {
      palette: {
        1: [0.42, 0.66, 0.32], 2: [0.52, 0.53, 0.56], 3: [0.27, 0.52, 0.24], 4: [0.56, 0.39, 0.22], 9: [0.66, 0.57, 0.42],
        30: [0.95, 0.95, 0.85], 31: [1.0, 0.85, 0.35],
        40: [0.86, 0.72, 0.70], 41: [0.92, 0.30, 0.34], 42: [0.70, 0.76, 0.88], 43: [0.30, 0.55, 0.98]
      }
    }));
  }

  /* 城（チーム 0 の 座標で かいて、チーム 1 は 180°回す）。正面は +x（あいての ほう） */
  function castle(g, team) {
    const s = 40, tr = 41;
    const put = (x, y, z, id) => {
      if (team === 1) { x = MW - 1 - x; z = MD - 1 - z; if (id === 40) id = 42; else if (id === 41) id = 43; }
      if (x < 0 || y < 0 || z < 0 || x >= MW || y >= MH || z >= MD) return;
      g.data[x + MW * (z + MD * y)] = id;
    };
    const box = (x0, y0, z0, x1, y1, z1, id) => {
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, id);
    };
    /* 中庭の 床 */
    for (let z = 17; z <= 34; z++) for (let x = 8; x <= 21; x++) put(x, 0, z, 9);
    /* かべ（よこ・うしろ は 1まい、正面は 2まい。たかさ 6） */
    box(8, 1, 17, 21, 6, 17, s); box(8, 1, 34, 21, 6, 34, s);
    box(8, 1, 17, 8, 6, 34, s);
    box(20, 1, 17, 21, 6, 34, s);
    box(20, 5, 23, 21, 5, 28, tr); box(8, 5, 23, 8, 5, 28, tr);
    box(20, 1, 24, 21, 4, 27, 0); box(8, 1, 24, 8, 4, 27, 0);          // 門（正面・うしろ）
    /* かべの 上の ぎざぎざ */
    for (let z = 17; z <= 34; z += 2) put(21, 7, z, tr);
    for (let x = 9; x <= 19; x += 2) { put(x, 7, 17, tr); put(x, 7, 34, tr); }
    for (let z = 19; z <= 33; z += 2) put(8, 7, z, tr);
    /* すみの 塔（3×3・なかは からっぽ・たかさ 9） */
    for (const c of [[20, 16], [20, 33], [7, 16], [7, 33]]) {
      for (let y = 1; y <= 8; y++) {
        for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
          if (dx === 1 && dz === 1) continue;
          put(c[0] + dx, y, c[1] + dz, y === 7 ? tr : s);
        }
      }
      box(c[0], 9, c[1], c[0] + 2, 9, c[1] + 2, s);
      put(c[0], 10, c[1], tr); put(c[0] + 2, 10, c[1], tr); put(c[0], 10, c[1] + 2, tr); put(c[0] + 2, 10, c[1] + 2, tr);
    }
    /* かべの 上へ のぼる かいだん（中庭の 両がわ・はば 2） */
    for (let k = 0; k < 6; k++) { box(14 + k, 1, 18, 14 + k, 1 + k, 19, s); box(14 + k, 1, 32, 14 + k, 1 + k, 33, s); }
    /* まんなかの たてもの（天守。なかは からっぽ・正面に とびら） */
    for (let y = 1; y <= 8; y++) {
      for (let z = 22; z <= 29; z++) for (let x = 11; x <= 15; x++) {
        if (x !== 11 && x !== 15 && z !== 22 && z !== 29) continue;
        put(x, y, z, y === 5 ? tr : s);
      }
    }
    box(11, 9, 22, 15, 9, 29, s);
    for (let x = 11; x <= 15; x += 2) { put(x, 10, 22, tr); put(x, 10, 29, tr); }
    for (let z = 24; z <= 28; z += 2) { put(11, 10, z, tr); put(15, 10, z, tr); }
    box(15, 1, 25, 15, 3, 26, 0);
  }

  /* ======================================================================
     せってい
     ====================================================================== */
  function cleanCfg(o) {
    o = o || {};
    const tm = o.time == null ? 10 : o.time | 0;
    return {
      n: clamp((o.n | 0) || 3, 1, MAX_N),
      time: TIMES.indexOf(tm) >= 0 ? tm : 10,
      lv: LVS.indexOf(o.lv) >= 0 ? o.lv : 'normal'
    };
  }
  const timeName = (t) => (t > 0 ? t + '分' : 'なし');

  /* ======================================================================
     はじめる
     ====================================================================== */
  /* ひとりで（じぶん＋なかまの CPU vs CPU） */
  G.startCastle = function (opt) {
    if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
    const c = cleanCfg(opt);
    this._teardown();
    this.isHost = true;
    this.myNetId = 'host';
    this.offline = true;
    const me = { id: 'host', name: String(CS.Settings.name || 'プレイヤー'), team: 0, gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(), skin: this._mySkin(), fc: '' };
    this._csStartWith([me], c, false);
    return true;
  };

  /* へやで（ホストが「しあい開始」）。へやの コンピューターも そのまま 入る */
  G._csStartRoom = function () {
    if (!CS.Bots || !this.isHost || !this.room) return false;
    const c = cleanCfg(this.room.castle);
    const n = [0, 0];
    const list = this.room.players.map((p) => {
      n[p.team]++;
      return { id: p.id, name: p.name, team: p.team, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, skin: p.skin || null, fc: p.fc || '', bot: p.bot || undefined };
    });
    if (!list.length) return false;
    c.n = clamp(Math.max(c.n, n[0], n[1]), 1, MAX_N);
    this.offline = false;
    this._csStartWith(list, c, true);
    return true;
  };

  G._csStartWith = function (list, c, coop) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const rg = CS.rng((seed ^ 0x6a57e1) >>> 0);
    const players = [], spawns = [], slot = [0, 0];
    const add = (pd) => { players.push(pd); spawns.push(slot[pd.team]++); };
    const cnt = [0, 0], hum = [0, 0];
    for (const h of list) { add(Object.assign({}, h)); cnt[h.team]++; if (!h.bot) hum[h.team]++; }
    /* たりない ところは CPU（あいての つよさ。じぶんの チームの なかまは ふつう いじょう） */
    const lvFor = (t) => (coop || t === 1 || hum[t] === 0 ? c.lv : (c.lv === 'easy' ? 'normal' : c.lv));
    const names = BOT_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rg() * (i + 1)); const s = names[i]; names[i] = names[j]; names[j] = s; }
    let k = 0;
    for (let t = 0; t < 2; t++) {
      for (let i = cnt[t]; i < c.n; i++, k++) {
        const lo = CS.Bots.randomLoadout(rg);
        add({ id: 'cp' + t + '_' + i, name: 'CPU・' + names[k % names.length], team: t, gun: lo.gun, bomb: lo.bomb, bot: lvFor(t), skin: CS.Skins ? CS.Skins.random(rg, { teamColor: true, noPattern: true }) : null });
      }
    }
    /* 部隊の 入れもの（はじめは いない） */
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < POOL; i++) add({ id: 'cu' + t + '_' + i, name: '部隊', team: t, gun: 'ar', bomb: 'frag', bot: lvFor(t), skin: null });
    }
    this._broadcast({
      t: 'start', seed: seed, map: 'castle', mode: 'castle', players: players, spawns: spawns,
      rule: { id: 'castle' }, castle: { n: c.n, time: c.time, lv: c.lv, coop: coop ? 1 : 0 }
    });
  };

  G._csMapDef = function () {
    return { id: 'castle', name: '城バトルの 草原', build: buildMap };
  };

  /* ======================================================================
     しあいの はじめ（みんな）
     ====================================================================== */
  G._csSetup = function (c) {
    const cfg = cleanCfg(c);
    const data = this.world.data;
    const blocks = [[], []], ids = [[], []];
    for (let i = 0; i < data.length; i++) {
      const t = teamOfId(data[i]);
      if (t >= 0) { blocks[t].push(i); ids[t].push(data[i]); }
    }
    const kOf = new Map();
    for (let t = 0; t < 2; t++) for (let k = 0; k < blocks[t].length; k++) kOf.set(blocks[t][k], t * 65536 + k);
    const total = [blocks[0].length, blocks[1].length];
    const cs = this.castle = {
      cfg: cfg, coop: !!(c && c.coop), blocks: blocks, ids: ids, kOf: kOf, total: total, alive: total.slice(),
      fallAt: total.map((n) => Math.ceil(n * (1 - FALL_K))), bhp: new Map(),
      money: [START_MONEY, START_MONEY], earned: [0, 0], bought: [0, 0],
      bases: BASES.map(() => ({ owner: -1, capT: -1, prog: 0, fight: false })),
      over: false, endT: -1, winner: -1, why: '', ver: 0,
      incT: 0, statN: 0, outX: [], outR: [], flushT: 0, dmgOut: [], dmgT: 0, rl: {},
      meshDirty: false, meshT: 0, expDirty: [true, true], exp: [[], []], expT: [0, 0],
      ai: [{ t: 3 }, { t: 3 }], init: false, humans: [0, 0], threat: [0, 0], threatT: 0, healT: 0, laneSeq: [0, 0], spotSeq: [0, 0],
      shop: true, mode: 0, lostT: [-99, -99], fall: null, hudT: 0, gold: null, myTeam: 0, unitsHud: [0, 0]
    };
    for (const p of this.players) {
      if (typeof p.id === 'string' && p.id.indexOf('cu') === 0) {
        p.pool = true; p.alive = false; p.hp = 0; p.respawnAt = 0; p.cs = null; p.turret = false; p.noRegen = true;
      } else if (!p.cpu && !p.npc && p.clone < 0) cs.humans[p.team]++;
    }
    const me = this.players[this.me];
    cs.myTeam = me ? me.team : 0;
    this.timeLimit = cfg.time > 0 ? cfg.time * 60 : 0;
    this.timeLeft = this.timeLimit;
    this._csCleanup();
    if (me) CS.UI.toast('あいての 城を こわせ！ 基地を とると お金が ふえる。城か 基地で 1〜7 キー（左の メニュー）で 部隊を 買おう');
  };

  G._csCleanup = function () {
    const sh = document.getElementById('csShop');
    if (sh) { sh.classList.toggle('on', !!(this.castle && !this.castle.over && this.mode === 'match')); sh._m = ''; }
  };

  /* ======================================================================
     城の ブロック（みんな）
     ====================================================================== */
  /* ブロックを かえる（id = 0 で こわす）。こわれた かけらも ここで */
  G._csSetBlock = function (vi, id, quiet) {
    const cs = this.castle, w = this.world;
    if (!cs || !w) return;
    const tk = cs.kOf.get(vi);
    if (tk === undefined) return;
    const t = tk >> 16;
    const old = w.data[vi];
    if (old === id) return;
    w.data[vi] = id;
    if (!id && old) cs.alive[t]--;
    else if (id && !old) cs.alive[t]++;
    cs.meshDirty = true; cs.expDirty[t] = true;
    if (!id) {
      cs.lostT[t] = this.time;
      if (!quiet) {
        const x = vi % MW, z = Math.floor(vi / MW) % MD, y = Math.floor(vi / (MW * MD));
        const pal = this.mapData && this.mapData.palette;
        const col = (pal && pal[old]) || [0.8, 0.8, 0.8];
        for (let i = 0; i < 5; i++) {
          this._addPart(x + 0.2 + rnd() * 0.6, y + 0.2 + rnd() * 0.6, z + 0.2 + rnd() * 0.6,
            (rnd() - 0.5) * 5, rnd() * 4 + 1, (rnd() - 0.5) * 5, 0.14 + rnd() * 0.12, col[0], col[1], col[2], 0.9 + rnd() * 0.5, 1, 0.4, 1);
        }
        const tn = this.time;
        if (tn - (cs.breakSfxT || -9) > 0.07) { cs.breakSfxT = tn; this._sfx('break', [x + 0.5, y + 0.5, z + 0.5], 0.7); }
      }
    }
  };

  /* 城の のこり（0..1。くずれる ところが 0） */
  G._csRatio = function (t) {
    const cs = this.castle;
    if (!cs || cs.fallen && cs.fallen === t + 1) return 0;
    const f = cs.fallAt[t], tot = cs.total[t];
    return tot > f ? clamp((cs.alive[t] - f) / (tot - f), 0, 1) : 0;
  };

  /* 弾が かべに 当たった ところの ボクセル（rc = world.raycast の けっか） */
  G._csRcVox = function (rc) {
    if (!rc) return -1;
    const x = Math.floor(rc.p[0] - rc.n[0] * 0.5), y = Math.floor(rc.p[1] - rc.n[1] * 0.5), z = Math.floor(rc.p[2] - rc.n[2] * 0.5);
    if (x < 0 || y < 0 || z < 0 || x >= MW || y >= MH || z >= MD) return -1;
    return x + MW * (z + MD * y);
  };

  /* ばくはつの まわりの 城の ブロック（あいての チームの ものだけ） */
  G._csSphere = function (out, pos, r, dmg, minK, team) {
    const cs = this.castle, data = this.world.data;
    const x0 = Math.max(0, Math.floor(pos[0] - r)), x1 = Math.min(MW - 1, Math.floor(pos[0] + r));
    const y0 = Math.max(1, Math.floor(pos[1] - r)), y1 = Math.min(MH - 1, Math.floor(pos[1] + r));
    const z0 = Math.max(0, Math.floor(pos[2] - r)), z1 = Math.min(MD - 1, Math.floor(pos[2] + r));
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const vi = x + MW * (z + MD * y), id = data[vi];
      const t = teamOfId(id);
      if (t < 0 || t === team) continue;
      const d = Math.hypot(x + 0.5 - pos[0], y + 0.5 - pos[1], z + 0.5 - pos[2]);
      if (d > r + 0.45) continue;
      const k = 1 - (1 - minK) * clamp(d / Math.max(0.1, r), 0, 1);
      out.push(vi, r1(dmg * k));
      if (++n >= 90) return;
    }
    void cs;
  };

  /* 撃った人（この端末の じぶん・ボット）の 弾が おわった（_ownerDetonate から） */
  G._csWall = function (p, pos, hit, hitTarget) {
    const cs = this.castle;
    const wv = p.wv;
    p.wv = -1;
    if (!cs || cs.over) return;
    const pr = p.pr, g = p.gun, owner = this.players[p.owner];
    if (!owner || pr.heal > 0 || pr.buff) return;
    const mul = owner.csMul != null ? owner.csMul : 1;
    if (!(mul > 0)) return;
    const out = this._csTmp || (this._csTmp = []);
    out.length = 0;
    if (!hit && !hitTarget && wv >= 0 && teamOfId(this.world.data[wv]) === 1 - owner.team) {
      const d = (g.dmg || 0) * BULLET_K * mul;
      if (d > 0) out.push(wv, r1(d));
      /* こわれかけの かけら（見た目） */
      const pal = this.mapData && this.mapData.palette, col = (pal && pal[this.world.data[wv]]) || [0.8, 0.8, 0.8];
      for (let i = 0; i < 2; i++) this._addPart(pos[0], pos[1], pos[2], (rnd() - 0.5) * 3, rnd() * 3, (rnd() - 0.5) * 3, 0.07 + rnd() * 0.06, col[0], col[1], col[2], 0.6, 1, 0.4, 1);
    }
    if (pr.radius > 0 && pr.splashDmg > 0) this._csSphere(out, pos, pr.radius, pr.splashDmg * SPLASH_K * mul, pr.splashMin || 0.2, owner.team);
    if (out.length) this._csSend(p.owner, out);
  };

  /* ボムの ばくはつ（_ownerBombBoom から） */
  G._csBlast = function (oi, pos, radius, dmg, minK) {
    const cs = this.castle, owner = this.players[oi];
    if (!cs || cs.over || !owner || !(radius > 0) || !(dmg > 0)) return;
    const mul = owner.csMul != null ? owner.csMul : 1;
    if (!(mul > 0)) return;
    const out = this._csTmp || (this._csTmp = []);
    out.length = 0;
    this._csSphere(out, pos, radius, dmg * SPLASH_K * mul, minK || 0.2, owner.team);
    if (out.length) this._csSend(oi, out);
  };

  /* ホストへ（ホストなら そのまま）。ゲストは 0.1秒ごとに まとめて 送る */
  G._csSend = function (oi, out) {
    const cs = this.castle;
    if (this.isHost) { this._csDamage(oi, out); return; }
    if (oi !== this.me) return;
    for (let i = 0; i < out.length; i++) cs.dmgOut.push(out[i]);
  };

  /* ======================================================================
     ホスト: ブロックの ダメージ・こわれる・しゅうり
     ====================================================================== */
  G._csDamage = function (oi, h) {
    const cs = this.castle, w = this.world;
    if (!cs || cs.over || this.phase !== 'live') return;
    const o = this.players[oi];
    if (!o) return;
    for (let i = 0; i + 1 < h.length; i += 2) {
      const vi = h[i] | 0, d = Math.min(400, num(h[i + 1]));
      if (!(d > 0)) continue;
      const tk = cs.kOf.get(vi);
      if (tk === undefined) continue;
      const t = tk >> 16;
      if (t === o.team || !w.data[vi]) continue;
      const left = (cs.bhp.has(vi) ? cs.bhp.get(vi) : BLOCK_HP) - d;
      if (left > 0) { cs.bhp.set(vi, left); continue; }
      cs.bhp.delete(vi);
      this._csSetBlock(vi, 0, false);
      cs.outX.push(vi);
      if (cs.alive[t] <= cs.fallAt[t]) { this._csFall(t); return; }
    }
  };

  /* こわれた ブロックを もどす（ひくい ところから。人が いる ところは とばす） */
  G._csRepair = function (t) {
    const cs = this.castle, w = this.world, L = cs.blocks[t];
    const dead = [];
    for (let k = 0; k < L.length; k++) if (!w.data[L[k]]) dead.push(k);
    if (!dead.length && !cs.bhp.size) return 0;
    dead.sort((a, b) => L[a] - L[b]);       // y が ひくい ほど ばんごうが ちいさい
    let n = 0;
    for (let i = 0; i < dead.length && n < REPAIR.n; i++) {
      const k = dead[i], vi = L[k];
      const x = vi % MW, z = Math.floor(vi / MW) % MD, y = Math.floor(vi / (MW * MD));
      let blocked = false;
      for (const p of this.players) {
        if (!p.alive) continue;
        const q = p.lastReport;
        if (Math.abs(q[0] - x - 0.5) < HALF + 0.52 && Math.abs(q[1] - y - 0.5) < HALF + 0.52 && Math.abs(q[2] - z - 0.5) < HALF + 0.52) { blocked = true; break; }
      }
      if (blocked) continue;
      this._csSetBlock(vi, cs.ids[t][k], true);
      cs.outR.push(vi);
      n++;
    }
    /* きずついた ブロックも なおる */
    let healed = 0;
    for (const vi of Array.from(cs.bhp.keys())) { const tk = cs.kOf.get(vi); if (tk !== undefined && (tk >> 16) === t) { cs.bhp.delete(vi); healed++; } }
    return n || (healed ? 1 : 0);
  };

  /* 城が くずれた（みんな: くずれる えんしゅつ。ホスト: しあいを おえる） */
  G._csFall = function (t) {
    const cs = this.castle;
    if (!cs || cs.over) return;
    cs.over = true; cs.winner = 1 - t; cs.why = 'fall';
    cs.endT = this.time + 3.4;
    this._csFlush(0, true);
    this._broadcast({ t: 'cev', k: 'fall', tm: t });
  };

  /* ホスト: こわれた・もどった ブロックを みんなへ（0.1秒ごと） */
  G._csFlush = function (dt, now) {
    const cs = this.castle;
    cs.flushT -= dt;
    if (!now && cs.flushT > 0) return;
    cs.flushT = 0.1;
    if (!cs.outX.length && !cs.outR.length) return;
    cs.ver++;
    const m = { t: 'cbx', v: cs.ver };
    if (cs.outX.length) m.x = cs.outX.splice(0, cs.outX.length);
    if (cs.outR.length) m.r = cs.outR.splice(0, cs.outR.length);
    this._broadcast(m);
  };

  /* ======================================================================
     ホスト: まいフレーム
     ====================================================================== */
  G._csTick = function (dt) {
    const cs = this.castle;
    if (!cs) return;
    this._csFlush(dt);
    if (cs.over) {
      if (cs.endT >= 0 && this.time >= cs.endT) { cs.endT = -1; this._sendEnd(cs.winner); }
      return;
    }
    if (this.phase !== 'live') return;
    /* さいしょから 攻撃部隊・守備部隊が 出ている */
    if (!cs.init) {
      cs.init = true;
      for (let t = 0; t < 2; t++) for (const s of START_UNITS) this._csDoBuy(t, s[0], s[1], { k: 'castle', b: -1 }, null, -2, true);
    }
    this.matchTime += dt;
    if (this.timeLimit > 0) {
      this.timeLeft = Math.max(0, this.timeLimit - this.matchTime);
      if (this.timeLeft <= 0) {
        const a = this._csRatio(0), b = this._csRatio(1);
        cs.over = true; cs.why = 'time'; cs.winner = Math.abs(a - b) < 0.005 ? -1 : (a > b ? 0 : 1);
        cs.endT = this.time + 1.5;
        this._broadcast({ t: 'cev', k: 'tu', w: cs.winner });
        return;
      }
    }
    /* お金（1秒ごと） */
    cs.incT += dt;
    while (cs.incT >= 1) {
      cs.incT -= 1;
      for (let t = 0; t < 2; t++) {
        let nb = 0;
        for (const b of cs.bases) if (b.owner === t) nb++;
        this._csAddMoney(t, INC_BASE + INC_PER * nb);
      }
    }
    this._csCapture(dt);
    /* 回復兵（0.25秒ごと） */
    cs.healT -= dt;
    if (cs.healT <= 0) {
      cs.healT = 0.25;
      for (const h of this.players) {
        if (!h.pool || !h.alive || !h.cs || h.cs.type !== 'healer') continue;
        for (const q of this.players) {
          if (!q.alive || !q.connected || q.team !== h.team) continue;
          const mh = q.maxHp || CS.RULES.hp;
          if (q.hp >= mh) continue;
          const dx = q.lastReport[0] - h.pos[0], dz = q.lastReport[2] - h.pos[2];
          if (dx * dx + dz * dz > 36 || Math.abs(q.lastReport[1] - h.pos[1]) > 3) continue;
          q.hp = Math.min(mh, q.hp + UNITS.healer.heal * 0.25);
        }
      }
    }
    /* 城の そばの てき（CPU が まもりに もどる） */
    cs.threatT -= dt;
    if (cs.threatT <= 0) {
      cs.threatT = 0.5;
      for (let t = 0; t < 2; t++) {
        const c = castleC(t);
        let n = 0;
        for (const p of this.players) {
          if (!p.alive || p.team === t || p.turret) continue;
          const dx = p.lastReport[0] - c[0], dz = p.lastReport[2] - c[2];
          if (dx * dx + dz * dz < 20 * 20) n++;
        }
        cs.threat[t] = n;
      }
    }
    /* 人が いない チームは コンピューターが 買いものを する */
    for (let t = 0; t < 2; t++) if (cs.humans[t] === 0) this._csAi(t, dt);
  };

  G._csAddMoney = function (t, g) {
    const cs = this.castle;
    cs.money[t] = Math.min(MONEY_MAX, cs.money[t] + g);
    cs.earned[t] += g;
  };

  /* 基地の せんりょう（10秒 立つ。りょうほう いると とりあい中 = すすまない） */
  G._csCapture = function (dt) {
    const cs = this.castle;
    for (let b = 0; b < BASES.length; b++) {
      const B = BASES[b], s = cs.bases[b];
      let n0 = 0, n1 = 0;
      for (const p of this.players) {
        if (!p.alive || !p.connected || p.turret) continue;
        const q = p.lastReport;
        const dx = q[0] - B.x, dz = q[2] - B.z;
        if (dx * dx + dz * dz > CAP_R * CAP_R || q[1] > 1 + CAP_H) continue;
        if (p.team === 0) n0++; else n1++;
      }
      s.fight = n0 > 0 && n1 > 0;
      if (s.fight) continue;
      const t = n0 > 0 ? 0 : n1 > 0 ? 1 : -1;
      if (t < 0 || s.owner === t) {
        if (s.prog > 0) { s.prog = Math.max(0, s.prog - dt * (t < 0 ? 0.5 : 2)); if (!s.prog) s.capT = -1; }
        continue;
      }
      if (s.capT !== t) {
        /* あいての とちゅうの ぶんを へらしてから */
        if (s.capT >= 0 && s.prog > 0) { s.prog = Math.max(0, s.prog - dt * 2); continue; }
        s.capT = t; s.prog = 0;
      }
      s.prog += dt;
      if (s.prog >= CAP_T) {
        s.owner = t; s.prog = 0; s.capT = -1;
        this._broadcast({ t: 'cev', k: 'cap', b: b, o: t });
      }
    }
  };

  /* チームの 部隊の かず */
  G._csCount = function (t) {
    const c = this._csCnt || (this._csCnt = { units: 0, turrets: 0, def: 0 });
    c.units = 0; c.turrets = 0; c.def = 0;
    for (const p of this.players) {
      if (!p.pool || p.team !== t || !p.alive || !p.cs || !p.cs.type) continue;
      if (p.cs.type === 'turret') c.turrets++;
      else { c.units++; if (p.cs.mode === 1) c.def++; }
    }
    return c;
  };

  /* 買える ところ（じぶんの 城のまわり / じぶんの 基地）。なければ null */
  G._csZoneOf = function (t, q) {
    const x = t ? MW - q[0] : q[0], z = t ? MD - q[2] : q[2];
    if (x >= 0 && x <= 25.5 && z >= 12.5 && z <= 39.5) return { k: 'castle', b: -1 };
    const cs = this.castle;
    for (let b = 0; b < BASES.length; b++) {
      if (cs.bases[b].owner !== t) continue;
      const dx = q[0] - BASES[b].x, dz = q[2] - BASES[b].z;
      if (dx * dx + dz * dz <= BUY_R * BUY_R && q[1] < 1 + CAP_H + 1) return { k: 'base', b: b };
    }
    return null;
  };

  /* 買う（ホスト）。うまく いったら ''、だめなら りゆう */
  G._csDoBuy = function (t, u, mode, zone, pos, by, free) {
    const cs = this.castle;
    if (!cs || cs.over) return 'over';
    if (this.phase !== 'live') return 'wait';
    if (u === 'repair') {
      if (cs.money[t] < REPAIR.cost) return 'money';
      const n = this._csRepair(t);
      if (!n) return 'norep';
      cs.money[t] -= REPAIR.cost;
      this._csFlush(0, true);
      this._broadcast({ t: 'cev', k: 'buy', tm: t, u: u, by: by, n: n });
      return '';
    }
    const U = UNITS[u];
    if (!U) return 'bad';
    const cnt = this._csCount(t);
    if (U.turret ? cnt.turrets >= MAX_TURRETS : cnt.units >= MAX_UNITS) return U.turret ? 'tfull' : 'full';
    let slot = null;
    for (const p of this.players) if (p.pool && p.team === t && !p.alive && p.connected && !(p.cs && p.cs.type)) { slot = p; break; }
    if (!slot) return 'full';
    if (!free && cs.money[t] < U.cost) return 'money';
    let at = null;
    if (U.turret) {
      at = this._csTurretSpot(t, pos);
      if (!at) return 'place';
    } else if (zone && zone.k === 'base') {
      const B = BASES[zone.b], k = cs.spotSeq[t]++ % 4;
      at = [B.x + (k % 2 ? 1.2 : -1.2), GY, B.z + (k < 2 ? 1.2 : -1.2)];
    } else {
      const s = UNIT_SPOTS[cs.spotSeq[t]++ % UNIT_SPOTS.length];
      at = [tx(t, s[0]), GY, tz(t, s[1])];
    }
    if (!free) { cs.money[t] -= U.cost; cs.bought[t]++; }
    const lane = cs.laneSeq[t]++ % 3;
    this._broadcast({ t: 'cev', k: 'u', i: slot.idx, u: u, m: mode ? 1 : 0, b: zone && zone.k === 'base' ? zone.b : -1, ln: lane, by: free ? -2 : by });
    this._hostRespawn(slot, { p: at, yaw: t ? Math.PI / 2 : -Math.PI / 2 });
    slot.protectUntil = this.time + 1;
    return '';
  };

  /* 砲台を おく ところ（その人の 足もと。ブロックや ほかの 砲台と かさならない） */
  G._csTurretSpot = function (t, pos) {
    if (!pos) return null;
    const w = this.world;
    const tries = [[Math.floor(pos[0]) + 0.5, pos[1], Math.floor(pos[2]) + 0.5], [pos[0], pos[1], pos[2]]];
    for (const c of tries) {
      if (w.overlapsBox(c, HALF)) continue;
      let near = false;
      for (const p of this.players) {
        if (!p.pool || !p.alive || !p.turret) continue;
        const dx = p.pos[0] - c[0], dz = p.pos[2] - c[2];
        if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(p.pos[1] - c[1]) < 1) { near = true; break; }
      }
      if (!near) return c;
    }
    return null;
  };

  /* 部隊の 見た目・ぶき（みんな） */
  const skinCache = {};
  function unitSkin(u) {
    if (skinCache[u] !== undefined) return skinCache[u];
    const S = CS.Skins, U = UNITS[u];
    if (!S || !U) return (skinCache[u] = null);
    const f = S.FACES[U.face || 0] || S.FACES[0];
    return (skinCache[u] = S.clean({ c: '', c2: '#ffffff', d: S.pack(f.big + S.EMPTY_FACE.repeat(S.FACES_N - 1)), h: U.hat || 'none', p: U.pat || 'none' }));
  }
  G._csApplyUnit = function (p, u, mode, base, lane) {
    const U = UNITS[u];
    if (!p || !U) return;
    const cs = this.castle;
    p.cs = { type: u, mode: mode ? 1 : 0, base: base | 0, lane: lane | 0, t: this.time, planT: 0, goal: null, siege: false, psVi: -1, psT: 0, ps: null, post: (p.idx * 7) % DEF_POSTS.length, inp: null };
    p.name = U.name;
    p.turret = !!U.turret;
    let gun = CS.gunWith ? CS.gunWith(U.gun, '') : CS.Weapons.gun(U.gun);
    if (U.move) gun = Object.assign({}, gun, { move: U.move });
    p.gun = gun; p.guns = [gun]; p.slot = 0; p.gunId = gun.id;
    p.bomb = CS.Weapons.bomb(U.bomb || 'frag'); p.bombId = p.bomb.id;
    const lvK = cs && cs.cfg.lv === 'hard' ? 1.15 : cs && cs.cfg.lv === 'easy' ? 0.85 : 1;
    const enemyCpu = cs && !cs.coop && p.team === 1;
    p.maxHp = Math.round(U.hp * (enemyCpu ? lvK : 1));
    p.hp = p.maxHp;
    p.dmgMul = U.dmg * (enemyCpu ? lvK : 1);
    p.csMul = U.cs;
    p.noRegen = true;
    p.skin = unitSkin(u);
    if (p.bot && p.bot.ctx) {
      const c = p.bot.ctx;
      c.bombState = { charges: p.bomb.charges, max: p.bomb.charges, t: 0, cd: p.bomb.cooldown * (u === 'bomber' ? 0.6 : 1.5) };
      c.gunState = this._newGunState(p.gun);
    }
  };

  /* ホスト: たおれた（部隊は ふっかつ しない・お金） */
  G._csKill = function (v, a) {
    const cs = this.castle;
    if (!cs) return;
    if (v.pool) { v.respawnAt = 0; if (v.cs) v.cs.type = null; }
    const cr = a && a.clone >= 0 ? (this.players[a.clone] || a) : a;
    if (cr && cr.team !== v.team && !cs.over) {
      const g = v.pool ? KILL_U : (v.clone >= 0 ? 0 : KILL_P);
      if (g > 0) {
        this._csAddMoney(cr.team, g);
        this._broadcast({ t: 'cev', k: 'kg', tm: cr.team, g: g, a: cr.idx });
      }
    }
  };

  /* ======================================================================
     ホスト: コンピューターの 買いもの（人が いない チーム）
     ====================================================================== */
  const AI_PICK = [['soldier', 34], ['sniper', 14], ['tank', 16], ['bomber', 20], ['healer', 16]];
  G._csAi = function (t, dt) {
    const cs = this.castle, a = cs.ai[t];
    a.t -= dt;
    if (a.t > 0) return;
    const lv = cs.cfg.lv;
    a.t = (lv === 'hard' ? 1.6 : lv === 'easy' ? 4.5 : 2.6) + rnd() * 1.5;
    const m = cs.money[t], ratio = this._csRatio(t);
    const castle = { k: 'castle', b: -1 };
    /* しゅうり */
    if (ratio < 0.8 && cs.total[t] - cs.alive[t] >= 15 && m >= REPAIR.cost && (cs.threat[t] === 0 || ratio < 0.45) && rnd() < (lv === 'easy' ? 0.4 : 0.8)) {
      if (!this._csDoBuy(t, 'repair', 0, castle, null, -1)) return;
    }
    const reserve = ratio < 0.9 && lv !== 'easy' ? REPAIR.cost : 0;
    const cnt = this._csCount(t);
    /* 砲台（城の 前） */
    if (cnt.turrets < (lv === 'easy' ? 1 : 2) && m - reserve >= UNITS.turret.cost && rnd() < 0.2) {
      const s = DEF_POSTS[Math.floor(rnd() * 4)];
      const pos = [tx(t, s[0] - 1.5), GY, tz(t, s[1])];
      if (!this._csDoBuy(t, 'turret', 1, castle, pos, -1)) return;
    }
    if (cnt.units >= MAX_UNITS) return;
    let tot = 0;
    for (const e of AI_PICK) tot += e[1];
    let r = rnd() * tot, want = 'soldier';
    for (const e of AI_PICK) { r -= e[1]; if (r <= 0) { want = e[0]; break; } }
    if (m - reserve < UNITS[want].cost) return;
    const mode = (cs.threat[t] > 0 || cnt.def < 2) && rnd() < 0.55 ? 1 : (rnd() < 0.2 ? 1 : 0);
    /* 攻撃部隊は いちばん 前の じぶんの 基地から 出ることも ある */
    let zone = castle;
    if (mode === 0 && rnd() < 0.5) {
      let best = -1, bx = t ? 1e9 : -1e9;
      for (let b = 0; b < BASES.length; b++) {
        if (cs.bases[b].owner !== t) continue;
        const x = BASES[b].x;
        if (t ? x < bx : x > bx) { bx = x; best = b; }
      }
      if (best >= 0) zone = { k: 'base', b: best };
    }
    this._csDoBuy(t, want, mode, zone, null, -1);
  };

  /* ======================================================================
     ホストが 受け取る: 'cbd'（ブロックの ダメージ）・'cbuy'（買う）
     ====================================================================== */
  G._csHostMsg = function (msg, fromId) {
    const cs = this.castle;
    if (!cs || this.mode !== 'match') return;
    const idx = this._idxOf(fromId);
    if (idx < 0 || (msg.i | 0) !== idx) return;
    if (msg.t === 'cbd') {
      if (!Array.isArray(msg.h)) return;
      const h = msg.h.slice(0, 240);
      /* 1秒で 9000 まで（ずるを ふせぐ） */
      const now = this.time, rl = cs.rl[idx] || (cs.rl[idx] = { b: 9000, t: now });
      rl.b = Math.min(9000, rl.b + (now - rl.t) * 9000); rl.t = now;
      let sum = 0;
      for (let i = 1; i < h.length; i += 2) sum += Math.max(0, num(h[i]));
      if (sum > rl.b) return;
      rl.b -= sum;
      this._csDamage(idx, h);
    } else if (msg.t === 'cbuy') {
      const p = this.players[idx];
      let why = '';
      if (!p || !p.alive) why = 'dead';
      else {
        const zone = this._csZoneOf(p.team, p.lastReport);
        if (!zone) why = 'zone';
        else why = this._csDoBuy(p.team, String(msg.u || ''), msg.m ? 1 : 0, zone, p.lastReport, idx);
      }
      if (why) this._csTell(idx, { t: 'cev', k: 'no', why: why });
    }
  };
  G._csTell = function (idx, msg) {
    const p = this.players[idx];
    if (!p) return;
    if (idx === this.me) this._csOnMsg(msg);
    else if (this.net && !p.bot && p.id) this.net.send(msg, { to: p.id });
  };

  /* ======================================================================
     みんなへ: じょうたい（hs の なか）
     ====================================================================== */
  function packBits(cs, data) {
    const n = cs.blocks[0].length + cs.blocks[1].length;
    const bytes = new Uint8Array(Math.ceil(n / 8));
    let i = 0;
    for (let t = 0; t < 2; t++) for (const vi of cs.blocks[t]) { if (data[vi]) bytes[i >> 3] |= 1 << (i & 7); i++; }
    let s = '';
    for (let k = 0; k < bytes.length; k++) s += String.fromCharCode(bytes[k]);
    return btoa(s);
  }
  G._csStatus = function (m) {
    const cs = this.castle;
    if (!cs) return;
    const a = [cs.money[0], cs.money[1]];
    for (const b of cs.bases) a.push(b.owner + 1);
    for (const b of cs.bases) a.push(b.capT + 1);
    for (const b of cs.bases) a.push(Math.round(b.prog * 10));
    let f = 0;
    cs.bases.forEach((b, i) => { if (b.fight) f |= 1 << i; });
    a.push(f, cs.earned[0], cs.earned[1], cs.bought[0], cs.bought[1]);
    m.cs = a;
    cs.statN++;
    if (cs.statN % 15 === 0) { m.cb = packBits(cs, this.world.data); m.cv = cs.ver; }
  };
  G._csApplyStatus = function (m) {
    const cs = this.castle, a = m.cs;
    if (!cs || !Array.isArray(a) || a.length < 17) return;
    cs.money[0] = num(a[0]); cs.money[1] = num(a[1]);
    for (let b = 0; b < BASES.length; b++) {
      const s = cs.bases[b];
      s.owner = clamp((a[2 + b] | 0) - 1, -1, 1);
      s.capT = clamp((a[7 + b] | 0) - 1, -1, 1);
      s.prog = clamp(num(a[12 + b]) / 10, 0, CAP_T);
      s.fight = !!((a[17] | 0) & (1 << b));
    }
    if (a.length >= 22) { cs.earned[0] = num(a[18]); cs.earned[1] = num(a[19]); cs.bought[0] = a[20] | 0; cs.bought[1] = a[21] | 0; }
    if (typeof m.cb === 'string' && (m.cv | 0) >= cs.ver && !cs.fall) this._csApplyBits(m.cb);
  };
  G._csApplyBits = function (s) {
    const cs = this.castle, data = this.world.data;
    let bin;
    try { bin = atob(s); } catch (e) { return; }
    let i = 0;
    for (let t = 0; t < 2; t++) {
      const L = cs.blocks[t];
      for (let k = 0; k < L.length; k++, i++) {
        const on = ((bin.charCodeAt(i >> 3) || 0) >> (i & 7)) & 1;
        const vi = L[k];
        if (on && !data[vi]) this._csSetBlock(vi, cs.ids[t][k], true);
        else if (!on && data[vi]) this._csSetBlock(vi, 0, true);
      }
    }
  };

  /* ======================================================================
     みんなが 受け取る: 'cbx'（ブロック）・'cev'（できごと）
     ====================================================================== */
  G._csOnMsg = function (m) {
    const cs = this.castle;
    if (!cs || this.mode !== 'match') return;
    const me = this.players[this.me];
    const myT = me ? me.team : 0;
    if (m.t === 'cbx') {
      if (this.isHost) return;                  // ホストは もう かえてある
      if ((m.v | 0) > cs.ver) cs.ver = m.v | 0;
      if (Array.isArray(m.x)) for (let i = 0; i < m.x.length && i < 400; i++) this._csSetBlock(m.x[i] | 0, 0, false);
      if (Array.isArray(m.r)) {
        for (let i = 0; i < m.r.length && i < 400; i++) {
          const vi = m.r[i] | 0, tk = cs.kOf.get(vi);
          if (tk !== undefined) this._csSetBlock(vi, cs.ids[tk >> 16][tk & 65535], true);
        }
      }
      return;
    }
    switch (m.k) {
      case 'u': {
        const p = this.players[m.i | 0];
        if (!p || !p.pool) return;
        this._csApplyUnit(p, String(m.u), m.m, m.b, m.ln);
        break;
      }
      case 'buy': {
        const tm = (m.tm | 0) === 1 ? 1 : 0;
        if (tm !== myT) break;
        const it = itemOf(String(m.u));
        if (!it) break;
        const who = m.by >= 0 && this.players[m.by] ? this.players[m.by].name : 'CPU';
        if ((m.by | 0) === this.me && m.by != null) {
          CS.UI.hud.center(it.id === 'repair' ? '城を しゅうりした！' : it.name + ' を 買った！', '#ffe08a', 900);
          this._sfx(it.id === 'repair' || it.id === 'turret' ? 'place' : 'chip');
        } else CS.UI.toast(who + ' が ' + (it.id === 'repair' ? '城を しゅうりした' : it.name + ' を 買った'));
        break;
      }
      case 'no':
        CS.UI.hud.center(WHY[m.why] || WHY.bad, '#ffb3c0', 1100);
        this._sfx('empty');
        break;
      case 'cap': {
        const b = clamp(m.b | 0, 0, BASES.length - 1), o = (m.o | 0) === 1 ? 1 : 0, s = cs.bases[b];
        const was = s.owner;
        s.owner = o; s.prog = 0; s.capT = -1;
        const B = BASES[b];
        for (let i = 0; i < 20; i++) {
          const ang = rnd() * TAU, sp = 2 + rnd() * 3;
          const c = o ? [0.35, 0.6, 1] : [1, 0.35, 0.4];
          this._addPart(B.x, 1.4, B.z, Math.cos(ang) * sp, 3 + rnd() * 3, Math.sin(ang) * sp, 0.12, c[0], c[1], c[2], 1.2, 1, 0.5, 0);
        }
        if (o === myT) { CS.UI.hud.center('基地 ' + B.n + ' を とった！', '#8ff0c8', 1300); this._sfx('ok'); }
        else if (was === myT) { CS.UI.hud.center('基地 ' + B.n + ' を とられた…', '#ffb3c0', 1300); this._sfx('back'); }
        break;
      }
      case 'kg':
        if ((m.a | 0) === this.me) { cs.gold = { g: m.g | 0, t: this.time }; }
        break;
      case 'fall': {
        const t = (m.tm | 0) === 1 ? 1 : 0;
        cs.over = true; cs.winner = 1 - t; cs.why = 'fall'; cs.fallen = t + 1;
        const L = [];
        for (const vi of cs.blocks[t]) if (this.world.data[vi]) L.push(vi);
        L.sort((a, b) => b - a);                 // 上から
        cs.fall = { t: t, list: L, i: 0, t0: this.time };
        CS.UI.hud.center(t === myT ? 'じぶんの 城が くずれた…' : 'あいての 城が くずれた！', t === myT ? '#ffb3c0' : '#ffd23d', 2600);
        this._sfx('explode');
        if (this.renderer && this.renderer.shake) { /* なし */ }
        this.shake = Math.max(this.shake || 0, 0.6);
        break;
      }
      case 'tu':
        cs.over = true; cs.why = 'time';
        CS.UI.hud.center('時間ぎれ！ 城の のこりで しょうぶ', '#ffd166', 1800);
        this._sfx('go');
        break;
    }
  };

  /* ======================================================================
     まいフレーム（みんな）: 買いもの・メッシュ・くずれる えんしゅつ
     ====================================================================== */
  G._csLocal = function (dt, inp) {
    const cs = this.castle;
    if (!cs) return;
    const me = this.players[this.me];
    /* キー: 1〜7 = 買う / V = 攻撃・守備（買いものの メニューは いつも 出ている。銃の もちかえは X・ホイール） */
    const ks = inp && inp.keys;
    if (ks && ks.length && me && this.phase !== 'over') {
      for (let i = 0; i < ks.length; i++) {
        const c = ks[i];
        if (c === 'KeyV') this._csMode(1 - cs.mode);
        else if (/^Digit[1-7]$/.test(c)) this._csBuy(ITEMS[(c.charCodeAt(5) - 49)]);
      }
    }
    const shEl = document.getElementById('csShop');
    if (shEl) shEl.classList.toggle('on', this.phase !== 'over' && !cs.over);
    /* ゲスト: ブロックの ダメージを ホストへ */
    if (!this.isHost && cs.dmgOut.length) {
      cs.dmgT -= dt;
      if (cs.dmgT <= 0) {
        cs.dmgT = 0.1;
        const h = cs.dmgOut.splice(0, Math.min(cs.dmgOut.length, 200));
        if (this.net) this.net.send({ t: 'cbd', i: this.me, h: h });
      }
    }
    /* 城が くずれる（上から じゅんばんに） */
    if (cs.fall) {
      const F = cs.fall, k = clamp((this.time - F.t0) / 2.4, 0, 1);
      const want = Math.ceil(F.list.length * k);
      let fx = 0;
      while (F.i < want) {
        const vi = F.list[F.i++];
        this._csSetBlock(vi, 0, fx++ > 24);
        if (F.i % 60 === 0) {
          const x = vi % MW, z = Math.floor(vi / MW) % MD, y = Math.floor(vi / (MW * MD));
          this._boom([x + 0.5, y + 0.5, z + 0.5], 2.5, [1, 0.7, 0.4], true);
          this._sfx('explode', [x + 0.5, y + 0.5, z + 0.5], 0.6);
        }
      }
      if (F.i >= F.list.length) cs.fall = null;
    }
    /* 城の メッシュを つくりなおす（0.2秒に 1回まで） */
    if (cs.meshDirty && this.time - cs.meshT > 0.2) {
      cs.meshDirty = false; cs.meshT = this.time;
      if (this.renderer && this.renderer.refreshWorld) { try { this.renderer.refreshWorld(); } catch (e) { if (window.console) console.error('[castle] mesh', e); } }
    }
  };

  /* （CS2: 買いものの メニューは いつも 出ている） */
  G._csShop = function () {};
  G._csMode = function (m) {
    const cs = this.castle;
    if (!cs) return;
    cs.mode = m ? 1 : 0;
    cs.hudT = 0;
    this._sfx('click', null, 0.5);
  };
  G._csBuy = function (u) {
    const cs = this.castle, me = this.players[this.me];
    if (!cs || !me || !u) return;
    const it = itemOf(u);
    if (!it) return;
    if (!me.alive) { CS.UI.hud.center(WHY.dead, '#ffb3c0', 900); return; }
    if (!this._csZoneOf(me.team, me.pos)) { CS.UI.hud.center(WHY.zone, '#ffb3c0', 1100); this._sfx('empty'); return; }
    if (cs.money[me.team] < it.cost) { CS.UI.hud.center(WHY.money, '#ffb3c0', 900); this._sfx('empty'); return; }
    this._toHost({ t: 'cbuy', i: this.me, u: u, m: cs.mode });
  };

  /* ======================================================================
     コンピューター（ホスト）: 基地を とる・城を せめる・まもる
     ====================================================================== */
  G._csBotView = function (p, v) {
    const cs = this.castle;
    if (!cs) return;
    v.avoidSpawn = false;
    if (!p.alive) return;
    const c = p.cs || (p.cs = { type: null, mode: 0, base: -1, lane: p.idx % 3, planT: 0, goal: null, siege: false, psVi: -1, psT: 0, ps: null, post: p.idx % DEF_POSTS.length });
    if (p.turret) { v.chase = null; return; }
    if (this.time >= c.planT) { this._csPlan(p, c); c.planT = this.time + 0.8; }
    v.chase = c.goal;
    if (c.siege) {
      const ps = this._csPseudo(p, c);
      if (ps) {
        const L = this._csList || (this._csList = []);
        L.length = 0;
        for (let i = 0; i < this.players.length; i++) L.push(this.players[i]);
        L.push(ps);
        v.players = L;
        v.prio = ps.idx;
      }
    }
  };

  G._csPlan = function (p, c) {
    const cs = this.castle, t = p.team, foe = 1 - t;
    const q = p.pos;
    let role;
    if (p.pool) role = c.mode === 1 ? 'def' : 'atk';
    else {
      role = p.idx % 2 === 0 ? 'cap' : 'atk';
      const cc = castleC(t);
      if (cs.threat[t] > 0 && Math.hypot(q[0] - cc[0], q[2] - cc[2]) < 45 && p.idx % 3 !== 0) role = 'def';
    }
    c.siege = false;
    const g = c.goal || (c.goal = [0, GY, 0]);
    if (role === 'def') {
      if (p.pool && c.base >= 0 && cs.bases[c.base].owner === t) {
        const B = BASES[c.base];
        g[0] = B.x + (rnd() - 0.5) * 2.5; g[1] = GY; g[2] = B.z + (rnd() - 0.5) * 2.5;
      } else {
        const s = DEF_POSTS[c.post % DEF_POSTS.length];
        g[0] = tx(t, s[0]) + (rnd() - 0.5) * 1.5; g[1] = GY; g[2] = tz(t, s[1]) + (rnd() - 0.5) * 1.5;
      }
      return;
    }
    if (role === 'cap') {
      let best = -1, bd = 1e9;
      for (let b = 0; b < BASES.length; b++) {
        if (cs.bases[b].owner === t) continue;
        const d = Math.hypot(BASES[b].x - q[0], BASES[b].z - q[2]);
        if (d < bd) { bd = d; best = b; }
      }
      if (best >= 0) { g[0] = BASES[best].x + (rnd() - 0.5) * 1.5; g[1] = GY; g[2] = BASES[best].z + (rnd() - 0.5) * 1.5; return; }
      role = 'atk';
    }
    /* 攻撃: レーンの 基地を じゅんばんに とって、さいごは あいての 城へ */
    const route = ROUTES[t][c.lane % 3];
    for (const b of route) {
      if (cs.bases[b].owner !== t) { g[0] = BASES[b].x + (rnd() - 0.5) * 1.5; g[1] = GY; g[2] = BASES[b].z + (rnd() - 0.5) * 1.5; break; }
      if (b === route[route.length - 1]) { g[0] = foe ? 76 : 28; g[1] = GY; g[2] = LANE_Z[c.lane % 3] + (rnd() - 0.5) * 3; }
    }
    const ec = castleC(foe);
    if (Math.hypot(q[0] - ec[0], q[2] - ec[2]) < 34) c.siege = true;
  };

  /* 城を ねらう ための 見えない 的（いちばん 近い 外がわの ブロックの まえ） */
  G._csPseudo = function (p, c) {
    const cs = this.castle, data = this.world.data, foe = 1 - p.team;
    if (!c.ps) c.ps = { idx: 90 + foe, team: foe, pos: [0, 0, 0], vel: [0, 0, 0], alive: true, protect: false, hp: 999, maxHp: 999, connected: true, safeUntil: 0, sliding: false };
    if (c.psVi >= 0 && data[c.psVi] && this.time < c.psT) return c.ps;
    const L = this._csExposed(foe);
    const q = p.pos;
    let best = -1, bs = 1e9;
    for (let i = 0; i < L.length; i++) {
      const vi = L[i];
      const x = vi % MW, z = Math.floor(vi / MW) % MD, y = Math.floor(vi / (MW * MD));
      const s = Math.hypot(x + 0.5 - q[0], z + 0.5 - q[2]) + Math.abs(y + 0.5 - q[1]) * 0.6 + (y > 6 ? 3 : 0);
      if (s < bs) { bs = s; best = vi; }
    }
    c.psVi = best; c.psT = this.time + 2.5;
    if (best < 0) return null;
    const x = best % MW, z = Math.floor(best / MW) % MD, y = Math.floor(best / (MW * MD));
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const D = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
    let bn = null, bd = -1e9;
    for (const n of D) {
      const nx = x + n[0], ny = y + n[1], nz = z + n[2];
      if (nx < 0 || ny < 1 || nz < 0 || nx >= MW || ny >= MH || nz >= MD) continue;
      if (data[nx + MW * (nz + MD * ny)]) continue;
      const d = n[0] * (q[0] - cx) + n[1] * (q[1] - cy) + n[2] * (q[2] - cz);
      if (d > bd) { bd = d; bn = n; }
    }
    if (!bn) bn = [0, 1, 0];
    const ps = c.ps;
    ps.pos[0] = cx + bn[0] * 0.62; ps.pos[1] = cy + bn[1] * 0.62 - 0.1; ps.pos[2] = cz + bn[2] * 0.62;
    return ps;
  };

  /* 外がわ（となりに 空気が ある）の 城の ブロック */
  G._csExposed = function (t) {
    const cs = this.castle, data = this.world.data;
    if (!cs.expDirty[t] || this.time < cs.expT[t]) return cs.exp[t];
    cs.expDirty[t] = false; cs.expT[t] = this.time + 0.3;
    const out = cs.exp[t];
    out.length = 0;
    const WD = MW * MD;
    for (const vi of cs.blocks[t]) {
      if (!data[vi]) continue;
      const x = vi % MW, z = Math.floor(vi / MW) % MD, y = Math.floor(vi / WD);
      if ((x > 0 && !data[vi - 1]) || (x < MW - 1 && !data[vi + 1]) || (z > 0 && !data[vi - MW]) || (z < MD - 1 && !data[vi + MW]) ||
        (y < MH - 1 && !data[vi + WD])) out.push(vi);
    }
    return out;
  };

  /* 砲台は うごかない（_updateBots から: 頭脳の 入力を なおす） */
  G._csBotInput = function (p, inp) {
    if (!p.turret || !p.cs) return inp;
    const o = p.cs.inp || (p.cs.inp = {});
    for (const k in inp) o[k] = inp[k];
    o.mx = 0; o.mz = 0; o.jump = false; o.slide = false; o.bomb = false; o.special = false;
    return o;
  };

  /* ======================================================================
     かく（みんな）: 基地の はた・天守の はた・回復兵・砲台
     ====================================================================== */
  const COL = [[1, 0.32, 0.38], [0.32, 0.58, 1]], GRAY = [0.82, 0.82, 0.86];
  G._csDraw = function (r) {
    const cs = this.castle;
    if (!cs) return;
    const t = this.time;
    const m = this._csM || (this._csM = M4.create());
    const o = this._csO || (this._csO = { emissive: 0, frame: 0.02 });
    const tp = this._csTp || (this._csTp = [0, 0, 0]);
    const IDQ = this._csQ || (this._csQ = [0, 0, 0, 1]);
    const box = (x, y, z, sx, sy, sz, c, e) => { M4.fromTRS(m, [x, y, z], IDQ, [sx, sy, sz]); o.emissive = e || 0; r.box(m, c, o); };
    for (let b = 0; b < BASES.length; b++) {
      const B = BASES[b], s = cs.bases[b];
      const oc = s.owner >= 0 ? COL[s.owner] : GRAY;
      box(B.x, 3, B.z, 0.14, 4, 0.14, [0.85, 0.85, 0.9]);
      const wave = Math.sin(t * 3 + b) * 0.08;
      box(B.x + 0.55, 4.6 + wave * 0.3, B.z, 1.0, 0.62, 0.06, oc, s.owner >= 0 ? 0.35 : 0.1);
      if (s.capT >= 0 && s.prog > 0) {
        const k = clamp(s.prog / CAP_T, 0, 1);
        box(B.x - 0.4, 1.2 + k * 3.2, B.z, 0.7, 0.45, 0.06, COL[s.capT], 0.5);
      }
      /* わ: とった ぶんだけ 色が つく */
      const n = 28, lit = s.capT >= 0 ? Math.round(n * clamp(s.prog / CAP_T, 0, 1)) : 0;
      const blink = s.fight ? 0.5 + 0.5 * Math.sin(t * 14) : 1;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU - Math.PI / 2;
        tp[0] = B.x + Math.cos(a) * CAP_R; tp[1] = 1.12; tp[2] = B.z + Math.sin(a) * CAP_R;
        const c = i < lit ? COL[s.capT] : (s.fight ? [1, 1, 1] : oc);
        r.particle(tp, i < lit ? 0.42 : 0.3, c, (i < lit ? 0.85 : 0.45) * blink);
      }
    }
    /* 天守の はた */
    for (let k = 0; k < 2; k++) {
      if (cs.fallen === k + 1) continue;
      const x = tx(k, 13.5), z = tz(k, 26);
      box(x, 11.5, z, 0.16, 3, 0.16, [0.9, 0.9, 0.95]);
      box(x + (k ? -0.7 : 0.7), 12.4 + Math.sin(t * 2.6 + k) * 0.05, z, 1.3, 0.8, 0.07, COL[k], 0.4);
    }
    /* 回復兵の みどりの 光 */
    for (const p of this.players) {
      if (!p.pool || !p.alive || !p.cs || p.cs.type !== 'healer') continue;
      for (let i = 0; i < 3; i++) {
        const a = t * 2 + i * TAU / 3;
        tp[0] = p.rpos[0] + Math.cos(a) * 0.8; tp[1] = p.rpos[1] + 0.2 + Math.sin(t * 3 + i) * 0.2; tp[2] = p.rpos[2] + Math.sin(a) * 0.8;
        r.particle(tp, 0.28, [0.45, 1, 0.55], 0.7);
      }
    }
  };

  G._csDrawTurret = function (r, p) {
    if (!p.alive) return;
    const m = this._csTm || (this._csTm = M4.create());
    const o = this._csTo || (this._csTo = { emissive: 0, frame: 0.03 });
    const IDQ = this._csQ || (this._csQ = [0, 0, 0, 1]);
    const h = clamp(p.hitFx || 0, 0, 1) * 0.6;
    const tint = (c) => [c[0] + (1 - c[0]) * h, c[1] + (1 - c[1]) * h, c[2] + (1 - c[2]) * h];
    const pos = p.rpos, tc = COL[p.team];
    M4.fromTRS(m, [pos[0], pos[1] - 0.22, pos[2]], IDQ, [0.95, 0.52, 0.95]); o.emissive = h; r.box(m, tint([0.3, 0.32, 0.36]), o);
    M4.fromTRS(m, [pos[0], pos[1] + 0.05, pos[2]], IDQ, [1.0, 0.1, 1.0]); o.emissive = 0.35; r.box(m, tc, o);
    const q = Q.fromYawPitch(p.ryaw || 0, p.rpitch || 0);
    const at = (lx, ly, lz) => { const v = Q.rotateVec(q, [lx, ly, lz]); return [pos[0] + v[0], pos[1] + 0.28 + v[1], pos[2] + v[2]]; };
    M4.fromTRS(m, at(0, 0, 0), q, [0.62, 0.38, 0.62]); o.emissive = h; r.box(m, tint([0.45, 0.47, 0.52]), o);
    M4.fromTRS(m, at(0, 0.02, -0.55), q, [0.16, 0.16, 0.75]); o.emissive = h; r.box(m, tint([0.18, 0.19, 0.22]), o);
    M4.fromTRS(m, at(0, 0.2, 0.05), q, [0.3, 0.08, 0.3]); o.emissive = 0.5; r.box(m, tc, o);
    if (p.flash > 0.05) r.particle(at(0, 0.02, -1.0), 0.45, [1, 0.85, 0.4], p.flash);
  };

  /* ======================================================================
     HUD（DOM）
     ====================================================================== */
  const fmtT = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60); };
  G._csHud = function (s) {
    const cs = this.castle;
    if (!cs) return;
    void s;
    const now = this.time;
    if (now - cs.hudT < 0.1 && cs.hudT > 0) return;
    cs.hudT = now;
    const me = this.players[this.me];
    const myT = me ? me.team : 0;
    const $ = (id) => document.getElementById(id);
    for (let t = 0; t < 2; t++) {
      const k = this._csRatio(t);
      const f = $('csF' + t), pc = $('csP' + t);
      if (f) f.style.width = Math.round(k * 100) + '%';
      if (pc) pc.textContent = Math.ceil(k * 100) + '%';
      const box = $('csC' + t);
      if (box) box.classList.toggle('hit', now - cs.lostT[t] < 1.2);
    }
    const tm = $('csTime');
    if (tm) tm.textContent = this.timeLimit > 0 ? fmtT(this.timeLeft) : '∞';
    const bs = $('csBases');
    if (bs) {
      for (let b = 0; b < BASES.length; b++) {
        const el = bs.children[b], st = cs.bases[b];
        if (!el) continue;
        const own = st.owner < 0 ? 'n' : st.owner === myT ? 'me' : 'foe';
        const cap = st.capT < 0 ? '' : st.capT === myT ? 'me' : 'foe';
        el.className = 'b ' + own + (st.fight ? ' fight' : '');
        el.style.setProperty('--k', String(st.capT >= 0 ? clamp(st.prog / CAP_T, 0, 1) : 0));
        el.setAttribute('data-cap', cap);
      }
    }
    let nb = 0;
    for (const b of cs.bases) if (b.owner === myT) nb++;
    const cnt = this._csCount(myT);
    const mo = $('csMoney');
    if (mo) {
      const g = cs.gold && now - cs.gold.t < 1.6 ? ' <em>+' + cs.gold.g + 'G</em>' : '';
      const txt = '<b>' + Math.floor(cs.money[myT]) + 'G</b><small>+' + (INC_BASE + INC_PER * nb) + '/秒</small>' + g +
        '<span>部隊 ' + cnt.units + '/' + MAX_UNITS + ' ・ 砲台 ' + cnt.turrets + '/' + MAX_TURRETS + '</span>';
      if (mo._m !== txt) { mo._m = txt; mo.innerHTML = txt; }
    }
    /* 基地の 中: せんりょうの ようす / 城が こうげきされている */
    let info = '';
    if (me && me.alive) {
      for (let b = 0; b < BASES.length; b++) {
        const B = BASES[b], st = cs.bases[b];
        const dx = me.pos[0] - B.x, dz = me.pos[2] - B.z;
        if (dx * dx + dz * dz > CAP_R * CAP_R) continue;
        if (st.fight) info = '基地 ' + B.n + ': とりあい中！ あいてを おいだそう';
        else if (st.owner === myT && !(st.capT >= 0 && st.prog > 0)) info = '基地 ' + B.n + ': じぶんの 基地（ここで 買える）';
        else if (st.capT === myT) info = '基地 ' + B.n + ' を せんりょう中… ' + Math.floor(st.prog) + ' / ' + CAP_T;
        else info = '基地 ' + B.n + ' を とりかえしている…';
        break;
      }
    }
    if (now - cs.lostT[myT] < 3 && !cs.over) info = '<b class="warn">城が こうげきされている！</b>' + (info ? ' ・ ' + info : '');
    const ie = $('csInfo');
    if (ie && ie._m !== info) { ie._m = info; ie.innerHTML = info; ie.style.display = info ? '' : 'none'; }
    const zone = me && me.alive ? this._csZoneOf(myT, me.pos) : null;
    /* 買いもの（いつも 出ている） */
    const sh = $('csShop');
    if (sh) {
      const alive = !!(me && me.alive);
      const sig = [Math.floor(cs.money[myT]), cs.mode, zone ? (zone.k + zone.b) : 0, cnt.units, cnt.turrets, alive ? 1 : 0].join('|');
      if (sh._m !== sig) {
        sh._m = sig;
        const it = sh.querySelectorAll('.csIt');
        it.forEach((el) => {
          const x = itemOf(el.getAttribute('data-u'));
          el.classList.toggle('ng', !x || cs.money[myT] < x.cost || !zone ||
            (x.turret ? cnt.turrets >= MAX_TURRETS : x.id !== 'repair' && cnt.units >= MAX_UNITS));
        });
        const md = $('csModeBtn');
        if (md) { md.textContent = cs.mode ? '守備部隊（その場を まもる）' : '攻撃部隊（あいての 城へ）'; md.classList.toggle('def', !!cs.mode); }
        const zs = $('csShopZone');
        if (zs) zs.textContent = !alive ? 'ふっかつ したら 買えるよ' : zone ? (zone.k === 'castle' ? 'じぶんの 城 → 部隊は 城から 出る' : '基地 ' + BASES[zone.b].n + ' → 部隊は ここから 出る') : 'ここでは 買えない（じぶんの 城か、とった 基地で）';
        sh.classList.toggle('far', !zone || !alive);
      }
    }
  };

  /* しあいの おわりに 出す じょうほう（_onEnd から） */
  G._csEndInfo = function (w) {
    const cs = this.castle;
    if (!cs) return null;
    this._csCleanup();
    const me = this.players[this.me];
    const myT = me ? me.team : 0;
    const nb = [0, 0];
    for (const b of cs.bases) if (b.owner >= 0) nb[b.owner]++;
    return {
      winner: w, win: w === myT, draw: w < 0, why: cs.why || 'time', myTeam: myT,
      ratio: [Math.round(this._csRatio(0) * 100), Math.round(this._csRatio(1) * 100)], bases: nb,
      bought: cs.bought.slice(), earned: cs.earned.slice(), kills: me ? me.kills | 0 : 0, deaths: me ? me.deaths | 0 : 0,
      coop: cs.coop, isHost: this.isHost, cfg: Object.assign({}, cs.cfg)
    };
  };

  /* ======================================================================
     画面: 城バトル（はじめる）・けっか・ロビーの せってい・HUD
     ====================================================================== */
  let U = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  const CSS = [
    '#csRules{display:grid;gap:4px;width:100%;text-align:left;font-size:13px;line-height:1.55;color:#cfe0f5;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 14px}',
    '#csRules b{color:#ffe08a}',
    '#csN,#csLv,#csTm{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%}',
    '#csN .btn,#csLv .btn,#csTm .btn{flex:1 1 90px;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
    '#csN .btn small,#csLv .btn small,#csTm .btn small{font-size:11px;color:#9fb4d4}',
    '#csN .btn.sel,#csLv .btn.sel,#csTm .btn.sel{border-color:#ffd28a;box-shadow:0 0 0 2px rgba(255,210,138,.45)}',
    '#csTitle{font-size:clamp(30px,7vmin,54px);font-weight:900;letter-spacing:.08em}',
    '#csTitle small{display:block;font-size:14px;letter-spacing:.06em;margin-top:4px}',
    '#csStats{display:grid;gap:6px;width:100%;max-width:440px}',
    '#lobbyCastle{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}#lobbyCastle .btn{min-height:36px;padding:5px 12px;font-size:12.5px}',
    'body[data-rule=castle] #teamScore{display:none}body[data-rule=castle] #netWarn{top:132px}',
    '#csUi{display:none;position:absolute;inset:0;pointer-events:none;font-family:inherit}',
    'body[data-rule=castle] #csUi{display:block}',
    '#csTop{position:absolute;top:8px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:flex-start}',
    '.csC{width:clamp(120px,24vw,230px);padding:5px 9px;border-radius:12px;background:rgba(8,12,24,.62);border:1px solid rgba(255,255,255,.14);color:#fff}',
    '.csC b{font-size:12px;letter-spacing:.05em}.csC span{float:right;font-weight:900;font-size:13px}',
    '.csC .tk{height:9px;border-radius:5px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:4px}',
    '.csC .tk i{display:block;height:100%;width:100%;transition:width .25s}',
    '#csC0 .tk i{background:linear-gradient(90deg,#ff5d6c,#ff9aa4)}#csC1 .tk i{background:linear-gradient(90deg,#4f8fff,#9cc3ff)}',
    '.csC.hit{animation:csHit .3s ease-in-out infinite alternate}@keyframes csHit{to{border-color:#fff;box-shadow:0 0 12px rgba(255,255,255,.6)}}',
    '#csMid{display:flex;flex-direction:column;align-items:center;gap:4px}',
    '#csTime{font-size:20px;font-weight:900;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.6);background:rgba(8,12,24,.62);border-radius:10px;padding:2px 12px}',
    '#csBases{display:flex;gap:4px}',
    '#csBases .b{position:relative;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff;',
    '  background:conic-gradient(var(--cc,#fff) calc(var(--k,0)*360deg),rgba(8,12,24,.75) 0);border:2px solid #9aa3b5}',
    '#csBases .b[data-cap=me]{--cc:rgba(143,240,200,.85)}#csBases .b[data-cap=foe]{--cc:rgba(255,140,150,.85)}',
    '#csBases .b.me{border-color:#8ff0c8;box-shadow:0 0 8px rgba(143,240,200,.6)}#csBases .b.foe{border-color:#ff7a88;box-shadow:0 0 8px rgba(255,122,136,.6)}',
    '#csBases .b.fight{animation:csHit .25s infinite alternate}',
    '#csMoney{position:absolute;top:66px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:baseline;white-space:nowrap;',
    '  background:rgba(8,12,24,.62);border:1px solid rgba(255,224,138,.35);border-radius:10px;padding:3px 12px;color:#ffe08a}',
    '#csMoney b{font-size:17px}#csMoney small{font-size:11px;color:#cfe0a0}#csMoney span{font-size:11.5px;color:#cfe0f5}#csMoney em{font-style:normal;color:#8ff0c8;font-weight:900}',
    '#csInfo{position:absolute;top:100px;left:50%;transform:translateX(-50%);font-size:13px;color:#fff;background:rgba(8,12,24,.55);border-radius:10px;padding:3px 12px;white-space:nowrap}',
    '#csInfo .warn{color:#ff9aa4;animation:csHit .3s infinite alternate}',
    '#csBuyBtn{display:none}',
    '#csShop{position:absolute;left:12px;top:132px;width:228px;display:none;pointer-events:auto;z-index:6;',
    '  background:rgba(8,12,24,.72);border:1px solid rgba(255,224,138,.45);border-radius:12px;padding:7px;color:#eaf4ff}',
    '#csShop.on{display:block}#csShop.far{opacity:.62}',
    '#csShop h4{margin:0 0 5px;font-size:12.5px;color:#ffe08a;display:flex;justify-content:space-between;align-items:baseline}',
    '#csShop h4 small{color:#9fb4d4;font-weight:400;font-size:10.5px}',
    '#csModeBtn{width:100%;margin-bottom:4px;min-height:28px;border-radius:8px;font:inherit;font-size:11.5px;font-weight:900;cursor:pointer;color:#fff;background:#b8324a;border:1px solid #ff9aa4}',
    '#csModeBtn.def{background:#2b5fb8;border-color:#9cc3ff}',
    '.csIt{display:grid;grid-template-columns:16px 1fr auto;gap:0 6px;align-items:center;width:100%;margin:2px 0;padding:3px 7px;border-radius:8px;font:inherit;color:#eaf4ff;text-align:left;cursor:pointer;',
    '  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14)}',
    '.csIt kbd{font:inherit;font-weight:900;color:#ffe08a;font-size:12px}.csIt b{font-size:12px}.csIt i{font-style:normal;color:#ffe08a;font-weight:900;font-size:12px}',
    '.csIt small{display:none}',
    '.csIt.ng{opacity:.45}',
    '#csShopZone{font-size:10.5px;color:#cfe0f5;margin-top:3px;line-height:1.35}',
    '@media (max-width:640px),(max-height:500px){#csMoney{top:62px}#csInfo{top:94px;font-size:12px}#csShop{top:118px;width:190px;transform:scale(.88);transform-origin:left top}}'
  ].join('\n');

  function buildScreens() {
    if ($('scCastle')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scCastle" class="screen"><div class="panel wide" style="max-width:820px">' +
      '<h2>城バトル</h2>' +
      '<p class="lead"><b>あいての 城を こわしたら 勝ち！</b> まんなかの 基地を とって お金を ためて、部隊を 買って せめこもう。</p>' +
      '<div id="csRules">' +
      '<div>・城は <b>ブロック</b>で できている。撃つと こわれて、ゲージが 0 に なると 城が くずれる（ボム・ロケットが よく きく）</div>' +
      '<div>・まんなかの <b>基地 5つ</b>は <b>10秒 立つと せんりょう</b>。基地が 多いほど <b>チームの お金</b>が ふえる（時間・たおしても ふえる）</div>' +
      '<div>・じぶんの 城か、とった 基地の 中で <b>1〜7 キー</b>で 買う（左に いつも メニューが 出ている・スマホは メニューを タップ）。<b>V</b> で 攻撃⇔守備。銃の もちかえは <b>X</b></div>' +
      '<div>・さいしょから 攻撃部隊 2たい・守備部隊 2たいが 出ている（あいても おなじ）</div>' +
      '<div>・部隊: ふつう兵 / スナイパー兵 / タンク兵 / ボム兵 / 回復兵 / 砲台 ・ 城の しゅうりも できる</div>' +
      '</div>' +
      '<h3>人数（1チーム）</h3><div id="csN"></div>' +
      '<h3>コンピューターの つよさ</h3><div id="csLv"></div>' +
      '<h3>時間</h3><div id="csTm"></div>' +
      '<div class="stack">' +
      '<button id="btnCsCpu" class="btn big pink" type="button">コンピューターと たたかう<small>じぶん＋なかまの CPU vs CPU</small></button>' +
      '<button id="btnCsRoom" class="btn big" type="button">へやを作る（友達と）<small>1対1〜4対4・あきは CPU が 入る</small></button>' +
      '<button id="btnCsLoadout" class="btn ghost" type="button">ぶき・部品を えらぶ</button>' +
      '<button id="btnCsBack" class="btn ghost" type="button" data-back>もどる</button>' +
      '</div></div></section>' +
      '<section id="scCastleResult" class="screen"><div class="panel" style="max-width:560px">' +
      '<div id="csTitle"></div><div id="csStats"></div><div id="csMsg" class="msg"></div>' +
      '<div class="stack"><button id="btnCsAgain" class="btn big pink" type="button">もう一回</button>' +
      '<button id="btnCsHome" class="btn ghost" type="button">町へ</button></div>' +
      '</div></section>');
    U.addScreen('scCastle', refresh);
    U.addScreen('scCastleResult', null);
    const tap = (id, fn, snd) => { const el = $(id); if (el) el.addEventListener('click', () => { try { CS.Audio.play(snd || 'click'); } catch (e) {} fn(); }); };
    tap('btnCsCpu', () => U.util.call('castle', cfgNow()), 'ok');
    tap('btnCsRoom', () => U.util.call('create', 'castle', 'castle', null), 'ok');
    tap('btnCsLoadout', () => U.openLoadout('scCastle'));
    tap('btnCsBack', () => U.show('scTitle'), 'back');
    tap('btnCsAgain', () => {
      if (lastRes && lastRes.coop) { U.util.call('again'); return; }
      U.util.call('castle', lastRes ? lastRes.cfg : cfgNow());
    }, 'ok');
    tap('btnCsHome', () => {
      const g = CS.debug && CS.debug.game;
      if (g) { try { g.quit(); } catch (e) {} }
      U.show('scTitle');
    }, 'back');
    /* タイトル画面の ボタン */
    const stack = document.querySelector('#scTitle .stack');
    if (stack && !$('btnCastle')) {
      const b = document.createElement('button');
      b.id = 'btnCastle'; b.type = 'button'; b.className = 'btn big';
      b.innerHTML = '城バトル<small>基地を とって 部隊を 買って 城を こわす</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} U.show('scCastle'); });
      const raid = $('btnRaid');
      stack.insertBefore(b, raid ? raid.nextSibling : (stack.children[1] || null));
    }
    /* HUD（しあい中） */
    const hud = $('hud');
    if (hud && !$('csUi')) {
      let shop = '<h4>部隊を 買う <small>1〜7 で 買う ・ V で きりかえ</small></h4><button id="csModeBtn" type="button"></button>';
      ITEMS.forEach((id, i) => {
        const it = itemOf(id);
        shop += '<button class="csIt" type="button" data-u="' + id + '"><kbd>' + (i + 1) + '</kbd><b>' + esc(it.name) + '</b><i>' + it.cost + 'G</i><small>' + esc(it.desc) + '</small></button>';
      });
      shop += '<div id="csShopZone"></div>';
      hud.insertAdjacentHTML('beforeend',
        '<div id="csUi">' +
        '<div id="csTop"><div class="csC" id="csC0"><b>あか の 城</b><span id="csP0">100%</span><div class="tk"><i id="csF0"></i></div></div>' +
        '<div id="csMid"><div id="csTime">10:00</div><div id="csBases">' + BASES.map((b) => '<i class="b n">' + b.n + '</i>').join('') + '</div></div>' +
        '<div class="csC" id="csC1"><b>あお の 城</b><span id="csP1">100%</span><div class="tk"><i id="csF1"></i></div></div></div>' +
        '<div id="csMoney"></div><div id="csInfo" style="display:none"></div>' +
        '<button id="csBuyBtn" type="button">かう (B)</button>' +
        '<div id="csShop">' + shop + '</div>' +
        '</div>');
      const game = () => CS.debug && CS.debug.game;
      $('csModeBtn').addEventListener('click', (e) => { e.stopPropagation(); const g = game(); if (g && g.castle) g._csMode(1 - g.castle.mode); });
      $('csShop').querySelectorAll('.csIt').forEach((el) => {
        el.addEventListener('click', (e) => { e.stopPropagation(); const g = game(); if (g && g.castle) g._csBuy(el.getAttribute('data-u')); });
      });
      for (const id of ['csBuyBtn', 'csShop']) {
        const el = $(id);
        for (const ev of ['pointerdown', 'touchstart', 'mousedown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
      }
    }
  }

  function cfgNow() {
    const S = CS.Settings;
    return cleanCfg({ n: S.csN, time: S.csTime, lv: S.csLv });
  }

  function refresh() {
    const S = CS.Settings, c = cfgNow();
    S.csN = c.n; S.csTime = c.time; S.csLv = c.lv;
    const row = (id, list, cur, label, sub, set) => {
      const el = $(id);
      el.innerHTML = '';
      for (const v of list) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn' + (cur === v ? ' sel' : '');
        b.innerHTML = '<b>' + esc(label(v)) + '</b>' + (sub ? '<small>' + esc(sub(v)) + '</small>' : '');
        b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} set(v); if (CS.saveSettings) CS.saveSettings(); refresh(); });
        el.appendChild(b);
      }
    };
    row('csN', [1, 2, 3, 4], c.n, (n) => n + '対' + n, (n) => n === 1 ? 'じぶんだけ' : 'なかま CPU ' + (n - 1) + '人', (v) => { S.csN = v; });
    row('csLv', LVS, c.lv, (v) => LV_NAME[v], (v) => v === 'easy' ? 'はじめてなら' : v === 'hard' ? 'てごわい' : 'ちょうどいい', (v) => { S.csLv = v; });
    row('csTm', TIMES, c.time, timeName, (v) => v ? '時間ぎれは 城の のこりで' : '城が くずれるまで', (v) => { S.csTime = v; });
  }

  let lastRes = null;
  function showResult(res) {
    const r = res.castle;
    lastRes = r;
    const t = $('csTitle');
    t.style.color = r.draw ? '#ffe08a' : r.win ? '#ffd23d' : '#ffb3c0';
    const sub = r.draw ? '城の のこりが おなじ' : r.why === 'fall' ? (r.win ? 'あいての 城を こわした！' : 'じぶんの 城が こわされた…') : '時間ぎれ（城の のこりで しょうぶ）';
    t.innerHTML = (r.draw ? 'ひきわけ' : r.win ? '勝ち！' : '負け…') + '<small>' + esc(sub) + '</small>';
    const my = r.myTeam, foe = 1 - my;
    const rows = [
      ['じぶんの 城（' + TEAM_NAME[my] + '）', r.ratio[my] + '%'],
      ['あいての 城（' + TEAM_NAME[foe] + '）', r.ratio[foe] + '%'],
      ['さいごの 基地', 'じぶん ' + r.bases[my] + ' ・ あいて ' + r.bases[foe]],
      ['チームが 買った 部隊', String(r.bought[my])],
      ['チームが もらった お金', Math.floor(r.earned[my]) + 'G'],
      ['じぶんの たおした かず', r.kills + ' ・ やられた ' + r.deaths]
    ];
    $('csStats').innerHTML = rows.map((x) => '<div class="dfRow"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('');
    const again = $('btnCsAgain'), home = $('btnCsHome');
    if (r.coop) {
      again.style.display = r.isHost ? '' : 'none';
      again.textContent = 'ロビーへ（もう一回）';
      home.textContent = 'へやを出て 町へ';
      U.msg('csMsg', r.isHost ? '「ロビーへ」で みんな ロビーに もどって もう一回 あそべるよ' : 'ホストが ロビーに もどると いっしょに もどります');
    } else {
      again.style.display = '';
      again.textContent = 'もう一回';
      home.textContent = '町へ';
      U.msg('csMsg', r.win ? 'おめでとう！ つよさや 人数を かえて また あそんでみよう' : '基地を とって お金を ふやそう。タンク兵・ボム兵は 城に つよい。城の しゅうりも わすれずに');
    }
    U.show('scCastleResult');
    try { CS.Audio.play(r.win ? 'win' : 'lose'); } catch (e) {}
  }

  /* ロビー: 城バトルの へやの せってい（ホストは かえられる） */
  function lobbyCastle(o) {
    const info = $('lobbyInfo');
    if (!info) return;
    let box = $('lobbyCastle');
    if (o.mode !== 'castle') { if (box) box.style.display = 'none'; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'lobbyCastle';
      info.parentNode.insertBefore(box, info.nextSibling);
    }
    box.style.display = '';
    const c = cleanCfg(o.castle);
    const sig = [c.n, c.time, c.lv, o.isHost ? 1 : 0].join('|');
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
    const set = (k, v) => { const n = Object.assign({}, c); n[k] = v; U.util.call('roomCastle', n); };
    btn('人数: ' + c.n + '対' + c.n + '（あきは CPU）' + (o.isHost ? ' ▶' : ''), () => set('n', c.n % MAX_N + 1));
    btn('時間: ' + timeName(c.time) + (o.isHost ? ' ▶' : ''), () => set('time', TIMES[(TIMES.indexOf(c.time) + 1) % TIMES.length]));
    btn('CPUの つよさ: ' + LV_NAME[c.lv] + (o.isHost ? ' ▶' : ''), () => set('lv', LVS[(LVS.indexOf(c.lv) + 1) % LVS.length]));
  }

  function init() {
    U = CS.UI;
    buildScreens();
    const orig = U.showResult;
    U.showResult = function (res) {
      if (res && res.castle) return showResult(res);
      return orig.apply(U, arguments);
    };
    const origL = U.renderLobby;
    U.renderLobby = function (o) {
      const r = origL.apply(U, arguments);
      try { lobbyCastle(o || {}); } catch (e) { if (window.console) console.error('[castle lobby]', e); }
      return r;
    };
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  CS.Castle = {
    UNITS: UNITS, ITEMS: ITEMS, REPAIR: REPAIR, BASES: BASES, MAX_N: MAX_N, POOL: POOL, MAX_UNITS: MAX_UNITS, MAX_TURRETS: MAX_TURRETS,
    TIMES: TIMES, LV_NAME: LV_NAME, cleanCfg: cleanCfg, timeName: timeName, buildMap: buildMap
  };
})();
