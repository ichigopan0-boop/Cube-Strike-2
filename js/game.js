/* ==========================================================================
   CUBE STRIKE — game.js
   CS.Game: しあいの本体。ローカルの動き（転がるブロック）・20種の銃と5種のボム・
   弾とばくはつ・エフェクト・相手の補間・ホストの判定・通信・ためし撃ち・HUD。
   ・自分の動きと撃ったときの手ごたえは「その場で」出す（ラグを感じさせない）
   ・当たり判定は「撃った人の画面」で取る（favor the shooter）→ ホストがゆるく検算
   ・ホストも自分のメッセージを同じ道すじ（ループバック）で処理する
   v2:
   ・1対1 / 2対2 / 3対3（PER_TEAM）
   ・スライディング（CS.PLAYER.slide）。すべっている間は被弾の箱が低くなる（_hurt）
   ・歩いてもジャンプしても銃はぶれない（歩きゆれ・着地ゆれ・移動/空中のひろがり なし）
   ・コンピューター対戦（オフライン）: startCpu()。ボットは CS.Bots の頭脳が出す入力で、
     人間と同じ移動・射撃のコード（_updateLocal / _updateWeapon）を「持ち物の入れかえ」
     （_enterBot / _leaveBot）で動かす。判定はいつもどおりホスト（=自分）が行う。
     メニューを開くとゲームが止まる（ためし撃ちも同じ）。
   v3:
   ・ルール4種（this.rule = {id, n}）: kills（n キル）/ time（n 秒でキル数）/ stock（ひとり n 回）/ area（エリア n カウント）
     this.score は「ルールの点」（キル数・のこりストック・エリアのカウント）。ホストが決めて kill / hs で配る
   ・プレイヤーごとの さいだいHP（p.maxHp）・スキン（p.skin）・フレンドコード（p.fc）
   ・塔のぼり（tower.js）と 勝ったチームのダンス（dance.js）は Game.prototype に足す
   ・this.hold = true のあいだ（塔のぼりのチップえらびなど）オフラインのゲームは止まる
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const V = CS.V, Q = CS.Q, M4 = CS.M4;
  const RULES = CS.RULES, PLAYER = CS.PLAYER;
  const clamp = CS.clamp;
  const D2R = Math.PI / 180;

  /* ---------- 調整値 ---------- */
  const POSE_DT = 1 / 30;          // 位置の送信 30Hz
  const STATUS_DT = 0.2;           // ホストの状態同期 5Hz
  const LOBBY_PING_DT = 2;         // ロビーの ping 更新
  const SUB_DT = 1 / 120;          // 物理のサブステップ
  const SEMI_BUF = 0.15;           // 単発の入力バッファ
  const COYOTE = 0.1, JUMP_BUF = 0.1;
  const TAG_RANGE = 40;
  const MAX_PARTS = 320, MAX_TRACERS = 64;
  const COUNTDOWN = 3;
  const END_DELAY = 1.2;
  /* リスキルしない（コンピューター）: 出てきてから むてき＋この秒数は、じぶんの陣地
     （出撃地点から SPAWN_R m）にいるあいだ コンピューターに ねらわれない。撃つ・投げると おわり */
  const SAFE_EXTRA = 3, SPAWN_R = 5;
  const RATE_MULT = 1.6, RANGE_SLACK = 8, DMG_SLACK = 1.05;
  const PITCH_MAX = 1.45;
  /* 「つぎに 撃てるまで」のバーを出す銃: 1発の あいだが この秒数いじょう（スナイパー・クロスボウ・レールガン・
     ショットガン・ロケット・マグナム・ダブルバレル）。撃てるように なったあと「OK！」を出す秒数 */
  const WAIT_BAR_MIN = 0.5, WAIT_OK_T = 0.6;
  /* v5: かべを すりぬける弾が こえられる かべの あつさ（m） */
  const WALL_PIERCE_MAX = 4;
  /* v5: よわよわボムの こうげき力（きまっていないときの あたい）・ワープボムで 立てる場所を さがす ずれ */
  const WEAK_MUL = 0.5;
  /* v5: 必殺技「せんしゃ」の うける ダメージ・「バブル」の うく速さ（m/秒） */
  const TANK_ARMOR = 0.34, BUBBLE_RISE = 3.6;
  /* v5: せんしゃの あいだの カメラ（うしろ上から）の きょり */
  const TPS_DIST = 4.2;
  /* v5: 銃を もちかえてから 撃てるまで（秒） */
  const SWITCH_T = 0.35;
  /* 必殺技の つぶの色 */
  const SP_COLORS = { shield: [0.5, 0.85, 1], rush: [1, 0.6, 0.25], tank: [0.66, 0.85, 0.42], bubble: [0.6, 0.9, 1], smg: [1, 0.85, 0.3], clone: [1, 0.6, 0.85], icefield: [0.75, 0.95, 1] };
  /* v5.2: アイスフィールド: 氷の 床の すべりやすさ（ふつうは PLAYER.accel 40・friction 10） */
  const ICE = { accel: 1.0, friction: 0.5 };
  const spColor = (k) => SP_COLORS[k] || SP_COLORS.smg;
  const WARP_OFFS = [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45], [0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]];
  const SNAP_DIST = 3;
  const EXTRAP_MAX = 0.1;
  const SMOKE_BLOCK = 0.9;         // けむりが視界をさえぎる割合（半径×）
  /* 他人の弾・ボムを同時に持つ上限（ふつうの 3対3 でも届かない量。ずっと送りつけられても重くならない） */
  const MAX_FOREIGN_PROJ = 96, MAX_FOREIGN_BOMBS = 48;
  const HOST_CATCHUP_MAX = 5;      // hostTick が一度にすすめる最大秒（タブを裏にしたとき）
  const HOST_STEP = 0.25;          // hostTick の1ステップ
  /* うまったばくはつ点を外へ出すときに試す距離と向き（上 → 横 → 下） */
  const UNBURY_STEPS = [0.04, 0.1, 0.2, 0.35, 0.5];
  const UNBURY_DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];

  /* ---------- 人数 ---------- */
  /* v4: 'tower' = みんなで塔のぼり（あかチームだけ・4人まで。てきは ホストが動かす コンピューター） */
  /* v5.1: 'tourney' = みんなで トーナメント（8人まで。しあいは 1対1 を ひとつずつ。ほかの人は かんせん） */
  const PER_TEAM = { '1v1': 1, '2v2': 2, '3v3': 3, 'tower': 4, 'defense': 4, 'tourney': 8, 'raid': 4, 'castle': 4 };
  /* v5: みんなで あそぶ モード（ロビーでは みんな あかチーム） */
  const isCoopMode = (m) => m === 'tower' || m === 'defense' || m === 'tourney' || m === 'raid';
  const normMode = (m) => (PER_TEAM[m] ? m : '1v1');
  const perTeam = (m) => PER_TEAM[m] || 1;
  /* v5.1: しあいに でている人（コピーの いれもの・トーナメントの かんせんの人 は のぞく） */
  const inPlay = (p) => p.clone < 0 && !p.spec;
  /* CS2: スコア表・けっかに 出す人（城バトルの 部隊は のぞく） */
  const shown = (p) => inPlay(p) && !p.pool;
  /* v5.2: 銃のスキン「アイスバー」（弾が アイスバーに なる） */
  const iceBar = (p) => !!(p && p.skin && p.skin.g === 'icebar');
  const BOT_POSE_DT = 1 / 20;      // v4: ホストが動かす コンピューターの位置（みんなで塔のぼり）

  /* ---------- スライディング ---------- */
  const SLIDE = PLAYER.slide;
  const SLIDE_BUF = 0.12;          // ボタンの先押しを受けつける秒
  const SLIDE_TURN = 6;            // 曲がれる速さ（rad/s）× SLIDE.steer
  const SLIDE_MIN = 0.55;          // 走る速さのこの割合よりおそくなったら終わり

  /* オートジャンプで のぼれる段の高さ（1ブロックだけ。2ブロックは無理） */
  const STEP_UP = CS.VOXEL + 0.05;

  /* v5.4: 大ジャンプ（core.js の PLAYER.bigJump） */
  const BJ = PLAYER.bigJump;

  /* 押して のぞき、はなして撃つ銃（タッチの「うつ」ボタンの方式） */
  const SCOPED = { dmr: 1, sniper: 1, crossbow: 1, rail: 1 };

  /* ---------- コンピューター ---------- */
  const BOT_NAMES = ['ピコ', 'ボルト', 'ドット', 'ネオン', 'ギア', 'ビット', 'キュー', 'ロボ太', 'チップ', 'ノイズ'];
  /* ボットと自分で入れかえる「操作する人の持ち物」（_enterBot / _leaveBot） */
  const CTX_KEYS = ['viewYaw', 'viewPitch', 'recPitch', 'recYaw', 'adsT', 'eye', 'aim', 'jumpBufT', 'coyoteT', 'bjCd', 'bjWin', 'bjY',
    'gunState', 'bombState', 'vm', 'protectT', 'stepSmooth', 'shake', 'beam', '_emptyT',
    'slideT', 'slideCd', 'slideBufT', 'slideEye', 'slideArm'];
  const BOT_LOOPS = ['spin', 'flame', 'beam'];

  const r2 = (v) => Math.round(v * 100) / 100;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const rnd = Math.random;

  /* 光線 vs 箱（中心 c・半分の大きさ hx,hy,hz）。当たれば距離、外れれば -1 */
  function rayBox3(ox, oy, oz, dx, dy, dz, cx, cy, cz, hx, hy, hz, maxT) {
    let t0 = 0, t1 = maxT;
    let o = ox - cx;
    if (dx > -1e-9 && dx < 1e-9) { if (o < -hx || o > hx) return -1; }
    else { const iv = 1 / dx; let a = (-hx - o) * iv, b = (hx - o) * iv; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    o = oy - cy;
    if (dy > -1e-9 && dy < 1e-9) { if (o < -hy || o > hy) return -1; }
    else { const iv = 1 / dy; let a = (-hy - o) * iv, b = (hy - o) * iv; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    o = oz - cz;
    if (dz > -1e-9 && dz < 1e-9) { if (o < -hz || o > hz) return -1; }
    else { const iv = 1 / dz; let a = (-hz - o) * iv, b = (hz - o) * iv; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1; }
    return t0;
  }
  /* 光線 vs 立方体（中心 c・半径 h） */
  function rayBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, h, maxT) {
    return rayBox3(ox, oy, oz, dx, dy, dz, cx, cy, cz, h, h, h, maxT);
  }

  function shuffle(a, rg) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rg() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 線分と球（けむり）が交わるか */
  function segSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const fx = ax - cx, fy = ay - cy, fz = az - cz;
    const a = dx * dx + dy * dy + dz * dz;
    if (a < 1e-9) return fx * fx + fy * fy + fz * fz <= r * r;
    let t = -(fx * dx + fy * dy + fz * dz) / a;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
    return px * px + py * py + pz * pz <= r * r;
  }

  function falloff(f, d) {
    if (!f) return 1;
    if (d <= f[0]) return 1;
    if (d >= f[1]) return f[2];
    return 1 + (f[2] - 1) * (d - f[0]) / (f[1] - f[0]);
  }

  /* 銃のばくはつの吹きとばし量（m/s）。ボムは def.knock を使う */
  function projKnock(pr) {
    if (!pr || !(pr.radius > 0)) return 0;
    return Math.min(14, pr.radius * 2 + (pr.splashDmg || 0) * 0.08);
  }

  function clipName(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').slice(0, 10).trim();
    return s || 'プレイヤー';
  }
  /* フレンドコード（8文字）。ちがう形なら '' */
  function cleanFc(s) {
    if (!CS.Friends || typeof s !== 'string') return '';
    const c = CS.Friends.normCode(s);
    return c.length === CS.Friends.LEN ? c : '';
  }
  const cleanSkin = (s) => (CS.Skins ? CS.Skins.clean(s) : null);
  /* v5: 2つめの銃の id（ない・必殺技の銃 なら ''）。
     CS2: メインと おなじ銃でも よい（部品を かえられる）。スナイパー系（solo）を もつなら 2つめは もてない */
  function cleanGun2(id, main) {
    const g = typeof id === 'string' && CS.GunMap ? CS.GunMap[id] : null;
    const m = typeof main === 'string' && CS.GunMap ? CS.GunMap[main] : null;
    if (!g || g.special || g.solo || (m && m.solo)) return '';
    return g.id;
  }
  /* CS2: 部品の きろく（正しい形に。銃に つけられない 部品は すてる） */
  function cleanMods(str, gunId) {
    if (!CS.Parts || typeof str !== 'string' || !str || !gunId) return '';
    return CS.Parts.clean(str, CS.Weapons.gun(gunId));
  }
  /* CS2: 部品つきの 銃（部品なしなら もとの 定義） */
  function gunWith(id, mods) {
    const g = CS.Weapons.gun(id);
    return CS.Parts && mods ? CS.Parts.build(g, mods) : g;
  }
  CS.gunWith = gunWith;
  CS.cleanGun2 = cleanGun2;
  CS.cleanMods = cleanMods;

  /* ======================================================================
     プレイヤー記録
     pd.gunDef / pd.bombDef を渡すと その定義（塔のぼりのパワーアップ入りのコピー）を使う
     ====================================================================== */
  function makePlayer(pd) {
    /* CS2: コンピューターは 部品なし */
    const gm = pd.bot ? '' : cleanMods(pd.gm, pd.gun), gm2 = pd.bot ? '' : cleanMods(pd.gm2, pd.gun2);
    const gun = pd.gunDef || gunWith(pd.gun, gm), bomb = pd.bombDef || CS.Weapons.bomb(pd.bomb);
    /* v5: 2つめの銃（ない なら null）。guns[slot] が いま もっている銃 */
    const g2id = cleanGun2(pd.gun2, gun.id);
    const gun2 = g2id ? (pd.gun2Def || gunWith(g2id, gm2)) : null;
    /* CS2: 部品の からだに つく こうか（HP・回復しない・うける ダメージ） */
    const pm = CS.Parts ? CS.Parts.playerMods(gun2 ? [gun, gun2] : [gun]) : { hpMul: 1, hpAdd: 0, noRegen: false, takeMul: 1 };
    const maxHp = Math.max(1, Math.round(((pd.maxHp > 0 ? pd.maxHp : RULES.hp) + pm.hpAdd) * pm.hpMul));
    return {
      noRegen: !!pm.noRegen, takeMul: pm.takeMul > 0 ? pm.takeMul : 1,
      fx: { slow: 0, slowMul: 1, guard: 0, guardMul: 1, pow: 0, powMul: 1, spd: 0, spdMul: 1 },
      idx: pd.idx | 0, id: pd.id, name: clipName(pd.name), team: (pd.team | 0) === 1 ? 1 : 0,
      gun: gun, bomb: bomb, gunId: gun.id, bombId: bomb.id,
      guns: gun2 ? [gun, gun2] : [gun], slot: 0,
      fc: cleanFc(pd.fc), skin: cleanSkin(pd.skin),
      maxHp: maxHp, stock: -1, out: false,   // stock: ストックのこり（-1 = かぎりなし）、out: ストックが0になった
      hp: maxHp, alive: true, kills: 0, deaths: 0, ping: 0,
      connected: true, local: false, fade: 1, killer: -1,
      pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, quat: [0, 0, 0, 1],
      rpos: [0, 0, 0], rquat: [0, 0, 0, 1], ryaw: 0, rpitch: 0,
      grounded: true, firing: false, ads: false, reloading: false, spinning: false,
      sliding: false, slideK: 0,       // slideK: 0..1（見た目と被弾の箱の低さ）
      bot: null,                       // コンピューターなら {level, brain, ctx, view}
      flash: 0, hitFx: 0, protect: false, spin: 0, spinAng: 0, charge: 0, side: 0,
      buf: [], off: null, offs: [], jitter: 40, lastTs: -1, lastRecv: 0, gen: 0,
      /* ホスト用（safeUntil: この時間まで コンピューターは 陣地にいるこの人を ねらわない） */
      lastDmgT: -99, protectUntil: 0, safeUntil: 0, respawnAt: 0, burn: null,
      tokens: 8, tokenT: 0, bombTokens: 12, lastReport: [0, 0, 0],
      /* v4: 必殺技。sp = ゲージ 0..1、spK = つかっている必殺技（null = なし）、spEnd = おわる時刻（この端末の time）、
         spBase = もとの銃、spSave = もとの銃の じょうたい、shield = バリア中、spMul = ゲージの たまりやすさ */
      sp: 0, spK: null, spEnd: 0, spT0: -99, spBase: null, spSave: null, shield: false, spMul: 1, spGrace: 0, spGun: null,
      npc: false,
      clone: -1                        // v5.1: 必殺技「コピー」の いれもの なら 持ち主の ばんごう（ふつうの人は -1）
    };
  }

  /* ======================================================================
     CS.Game
     ====================================================================== */
  class Game {
    constructor(opts) {
      opts = opts || {};
      this.renderer = opts.renderer || null;
      this.canvas = opts.canvas || null;
      this.hooks = opts.hooks || {};

      this.mode = 'idle';            // 'idle' | 'lobby' | 'match' | 'practice'
      this.phase = 'idle';           // 'lobby' | 'countdown' | 'live' | 'over'
      this.net = null;
      this.isHost = false;
      this.myNetId = null;
      this.room = null;
      this.players = [];
      this.me = -1;
      this.world = null;
      this.mapData = null;
      this.mapId = '';
      this.matchMode = '1v1';
      this.targets = [];
      this.practiceStats = { hits: 0, damage: 0, kills: 0 };

      this.time = 0;                 // ゲーム内の通し秒
      this.matchTime = 0;            // しあい経過秒
      this.timeLeft = RULES.timeLimit;
      this.score = [0, 0];           // ルールの点（キル数 / のこりストック / エリアのカウント）
      this.countdown = 0;
      this.suddenDeath = false;
      this.endAt = -1;
      this.paused = false;
      this.hold = false;             // オフラインのゲームを止めておく（塔のぼりのチップえらび など）
      this.offline = false;          // コンピューター対戦（通信なし・止められる）
      this.cpu = null;               // {mode, level, mapId, rule}
      this._bot = null;              // いま動かしているボット（_enterBot 中だけ）
      this._pausedNow = false;

      /* ルール（v3） */
      this.rule = { id: 'kills', n: RULES.killsToWin };
      this.killsToWin = RULES.killsToWin;
      this.timeLimit = RULES.timeLimit;
      this.zone = null;              // エリア（ワールド座標の箱）
      this.zoneOwner = -1;           // いまエリアをとっているチーム（-1 = なし）
      this.zoneFight = false;        // とりあい中
      this._areaAcc = [0, 0];
      this.specIdx = -1;             // ストックがなくなったとき見ている なかま
      this.tower = null;             // 塔のぼり（tower.js）
      this.dance = null;             // 勝ったチームのダンス（dance.js）

      this.seq = 0;
      this.poseT = 0;
      this.statusT = 0;
      this.pingT = 0;
      this.shake = 0;
      this.stepSmooth = 0;
      this.adsT = 0;
      this.recPitch = 0; this.recYaw = 0;
      this.viewYaw = 0; this.viewPitch = 0;
      this.eye = [0, 0, 0];
      this.aim = [0, 0, -1];
      this.jumpBufT = -1; this.coyoteT = -1; this.bjCd = 0; this.bjWin = 0; this.bjY = 0;
      this.slideT = 0; this.slideCd = 0; this.slideBufT = -1; this.slideEye = 0; this.slideArm = false;
      this.protectT = 0;
      this._emptyT = 0;
      this._hb = { cy: 0, hh: 0 };   // _hurt() の結果
      this._hc = [0, 0, 0];
      this._smokeFn = (a, b) => this._inSmoke(a[0], a[1], a[2], b[0], b[1], b[2]);

      this.gunState = this._newGunState(CS.Guns[0]);
      this.bombState = { charges: 1, max: 1, t: 0, cd: 10 };
      this.vm = { bob: [0, 0], recoil: 0, reload: -1, ads: 0, flash: 0, spin: 0, charge: -1, side: 0, avoid: null };

      this.projectiles = [];
      this.bombs = [];
      this.smokes = [];
      this.fields = [];              // CS2: ブラックホール
      this.beam = null;
      this.projSeq = 0;
      this.bombSeq = 0;

      this._initFx();
      this._tp = [0, 0, 0]; this._tp2 = [0, 0, 0]; this._tc = [0, 0, 0];
      this._muz = [0, 0, 0]; this._dir = [0, 0, -1];
      this._bp = [0, 0, 0];
      this._rc = { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 };
      this._mv = { out: { grounded: false, hitX: false, hitY: false, hitZ: false, stepped: false, stepDy: 0 } };
      this._tagList = [];
      this._tagPool = [];
      this._sp = [0, 0, 0];
      this._hudS = {};
      this._hudI = {};
      this._oEm = { emissive: 0 };
      this._oCube = { emissive: 0, frame: 0.05 };
      this._oSmoke = { alpha: 0.3, frame: 0 };
      this._boardRows = [];
      this._dmgNums = [];
      this._netWarn = false;
      this._lastPing = 0;
      this._loops = {};
      this._noInput = { mx: 0, mz: 0, lookX: 0, lookY: 0, fire: false, firePressed: false, fireReleased: false, ads: false, jump: false, slide: false, bomb: false, reload: false, board: false, menu: false, special: false };
      this.hostBots = false;         // v4: この端末が コンピューターを動かす（オフライン・みんなで塔のぼりの ホスト）
      this.botPoseT = 0;
      this.iceUntil = [0, 0];        // v5.2: アイスフィールド: このチームが すべる 時刻まで
      this._iceK = 0;                // 氷の 床の 見た目（0..1。じわっと かわる）
    }

    _newGunState(g) {
      return {
        ammo: g.mag, cool: 0, reloadT: -1, reloadDur: g.reload || 1,
        burstLeft: 0, spin: 0, spinAng: 0, charge: -1, buf: 0, side: 0,
        flameT: 0, flameOn: false, beamT: 0, beamOn: false
      };
    }

    /* v5: じぶんの 銃（2つまで）の たま・リロードを まっさらに。いまの わく（slot）の 銃を もつ */
    _fillGuns(me) {
      const gs = me.guns && me.guns.length ? me.guns : [me.gun];
      this.gunStates = gs.map((g) => this._newGunState(g));
      const s = Math.min(me.slot | 0, gs.length - 1);
      me.slot = s;
      if (!me.spK || (me.spK !== 'smg' && me.spK !== 'tank')) me.gun = gs[s];
      this.gunState = this.gunStates[s];
    }

    /* v5: 銃を もちかえる（to = 0/1、なければ もう1つへ）。必殺技で 銃が かわっている あいだは できない */
    _switchGun(to) {
      const me = this.players[this.me];
      if (!me || !me.alive || !me.guns || me.guns.length < 2 || this.phase === 'over') return false;
      if (me.spK === 'smg' || me.spK === 'tank') return false;
      const s = to === undefined || to === null ? 1 - (me.slot | 0) : (to ? 1 : 0);
      if (s === (me.slot | 0)) return false;
      const w = this.gunState;
      if (w) { w.reloadT = -1; w.burstLeft = 0; w.charge = -1; w.spin = 0; w.beamOn = false; w.flameOn = false; }
      this.beam = null;
      this._loop('beam', 'beam', false); this._loop('flame', 'flame', false); this._loop('spin', 'spin', false);
      me.slot = s; me.gun = me.guns[s];
      if (!this.gunStates || !this.gunStates[s]) this._fillGuns(me);
      this.gunState = this.gunStates[s];
      this.gunState.cool = Math.max(this.gunState.cool, SWITCH_T);
      this.gunState.buf = 0;
      this.adsT = 0; this.vm.recoil = 1; this.vm.reload = -1;
      if (CS.Input.resetAds) CS.Input.resetAds();
      this._sfx('reload', null, 0.5);
      this._sendOwner({ t: 'gsw', i: this.me, s: s });
      return true;
    }

    /* v5: みんなが受け取る: ほかの人が 銃を もちかえた（見た目。当たりの しらべは どちらの銃でも うけつける） */
    _onGunSwitch(m) {
      const p = this.players[m.i | 0];
      if (!p || p.local || !p.guns || p.guns.length < 2) return;
      const s = (m.s | 0) === 1 ? 1 : 0;
      p.slot = s;
      if (p.spK === 'smg' || p.spK === 'tank') p.spBase = p.guns[s];
      else p.gun = p.guns[s];
    }

    _emit(name, a, b) {
      const f = this.hooks[name];
      if (typeof f === 'function') { try { f(a, b); } catch (e) { if (window.console) console.error('[game] ' + name, e); } }
    }

    /* ==================================================================
       1. Match setup（へや・マップ・開始）
       ================================================================== */
    get myPlayer() { return this.me >= 0 ? this.players[this.me] : null; }

    createRoom(mode, mapId, opts) {
      opts = opts || {};
      this._teardown();
      /* v5.3: ランダムマッチは きまった コード（opts.code）で 部屋を作る（ranked.js） */
      const fixed = opts.code ? CS.Net.normalizeCode(opts.code) : '';
      const code = fixed.length === 6 ? fixed : CS.Net.makeCode();
      this.isHost = true;
      this.myNetId = 'host';
      this.matchMode = normMode(mode);
      this.mapId = (CS.Maps.get(mapId) || CS.Maps.list[0]).id;
      this.room = {
        code: code, mode: this.matchMode, mapId: this.mapId, started: false,
        rule: CS.cleanRule(opts.rule),
        players: [{
          id: 'host', name: clipName(CS.Settings.name), team: 0,
          gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(), ready: false, ping: 0,
          fc: this._myFc(), skin: this._mySkin()
        }]
      };
      /* v4: みんなで塔のぼり（むずかしさ は 作った人が きめる） */
      if (this.matchMode === 'tower') {
        const D = CS.Tower && CS.Tower.DIFFS;
        const d = opts.diff || CS.Settings.towerDiff;
        this.room.tower = { diff: D && D[d] ? d : 'normal' };
      }
      /* v5: みんなで クリスタルまもり（むずかしさ・マップは 作った人が きめる） */
      if (this.matchMode === 'defense') {
        const DF = CS.Defense;
        const d = opts.diff || CS.Settings.defDiff;
        this.room.defense = { diff: DF && DF.DIFFS[d] ? d : 'normal', map: DF ? DF.mapOk(mapId || CS.Settings.defMap) : 'plaza' };
      }
      /* CS2: みんなで ボスレイド（ボス・むずかしさ・なかまの コンピューターは 作った人が きめる） */
      if (this.matchMode === 'raid' && CS.Raid) {
        const S = CS.Settings;
        this.room.raid = CS.Raid.cleanCfg(opts.raid || { boss: S.raidBoss, diff: S.raidDiff, ally: S.raidAlly == null ? 0 : S.raidAlly });
      }
      /* CS2: 城バトル（人数・時間・CPUの つよさは 作った人が きめる） */
      if (this.matchMode === 'castle' && CS.Castle) {
        const S = CS.Settings;
        this.room.castle = CS.Castle.cleanCfg(opts.castle || { n: S.csN, time: S.csTime, lv: S.csLv });
      }
      /* v5.1: みんなで トーナメント（人数・つよさ・ルール・マップは 作った人が きめる） */
      if (this.matchMode === 'tourney' && CS.Tourney) {
        const S = CS.Settings;
        this.room.tourney = CS.Tourney.cleanOpts(opts.tn || { n: S.tnN, lv: S.tnLv, rule: S.tnRule, map: S.tnMap });
      }
      /* v5.3: ランダムマッチ（ランク tier の 人どうし。ルールは きまり・じゅんびは じどう） */
      if (opts.ranked && !isCoopMode(this.matchMode)) this.room.ranked = { tier: String(opts.ranked.tier || '').slice(0, 12) };
      this.mode = 'lobby'; this.phase = 'lobby';
      this.net = CS.Net.create({ code: code, host: true, local: !!opts.local, lag: opts.lag || 0 });
      this._startNet();
      return code;
    }

    joinRoom(code, opts) {
      opts = opts || {};
      code = CS.Net.normalizeCode(code);
      if (code.length !== 6) { this._emit('error', '6文字のコードを入れてね'); return false; }
      this._teardown();
      this.isHost = false;
      this.myNetId = null;
      this.mode = 'lobby'; this.phase = 'lobby';
      this.room = { code: code, mode: '1v1', mapId: CS.Maps.list[0].id, started: false, players: [], rule: CS.cleanRule(null) };
      this.net = CS.Net.create({ code: code, host: false, local: !!opts.local, lag: opts.lag || 0 });
      this._startNet();
      return true;
    }

    _startNet() {
      const self = this;
      const net = this.net;
      net.start({
        onOpen: function () {
          self.myNetId = net.myId || (self.isHost ? 'host' : 'me');
          if (self.isHost) {
            self._emit('roomOpen', net.code);
            self._broadcastLobby();
          } else {
            net.send({
              t: 'hello', v: CS.VERSION, name: clipName(CS.Settings.name), gun: self._myGunId(), gun2: self._myGun2Id(),
              gm: self._myGm(), gm2: self._myGm2(), bomb: self._myBombId(),
              fc: self._myFc(), skin: self._mySkin()
            });
            self._emit('roomOpen', net.code);
          }
        },
        onPeerJoin: function (id) { if (self.isHost) self._broadcastLobby(); },
        onPeerLeave: function (id) { self._peerLeft(id); },
        onMsg: function (msg, fromId) {
          if (!msg || typeof msg !== 'object') return;
          if (self.isHost) self._hostMsg(msg, fromId);
          else self._clientMsg(msg);
        },
        onError: function (text, type) {
          self._teardown();
          self._emit('error', text, type);
        }
      });
    }

    _myGunId() { const g = CS.Weapons.gun(CS.Settings.gun); return g.id; }
    _myGun2Id() { return cleanGun2(CS.Settings.gun2, this._myGunId()); }
    /* CS2: じぶんの 部品 */
    _myGm() { return cleanMods(CS.Settings.gm, this._myGunId()); }
    _myGm2() { const g2 = this._myGun2Id(); return g2 ? cleanMods(CS.Settings.gm2, g2) : ''; }
    _myBombId() { const b = CS.Weapons.bomb(CS.Settings.bomb); return b.id; }
    _myFc() { return CS.Friends && CS.Friends.hub ? CS.Friends.hub.code : ''; }
    _mySkin() { return CS.Skins ? CS.Skins.mine() : null; }

    _peerLeft(id) {
      if (!this.isHost) {
        /* ホストが消えた */
        this._teardown();
        this._emit('hostGone');
        return;
      }
      if (this.room) {
        for (let i = 0; i < this.room.players.length; i++) {
          if (this.room.players[i].id === id) { this.room.players.splice(i, 1); break; }
        }
      }
      if (this.mode === 'match' || this.phase === 'countdown' || this.phase === 'live') {
        const p = this._byNetId(id);
        if (p) {
          p.connected = false; p.alive = false;
          this._broadcast({ t: 'left', i: p.idx });
          /* v5: キングが 出ていった → おなじ チームの だれかが キング */
          if (this.rule.id === 'king' && p.king) this._hostNewKing(p.team);
          this._hostCheckTeams();
        }
      }
      if (this.mode === 'lobby') this._broadcastLobby();
    }

    _byNetId(id) {
      for (let i = 0; i < this.players.length; i++) if (this.players[i].id === id) return this.players[i];
      return null;
    }
    _idxOf(id) { const p = this._byNetId(id); return p ? p.idx : -1; }

    /* ---- ロビー操作 ---- */
    setLoadout(gunId, bombId, gun2Id, gm, gm2) {
      if (this.mode === 'match' || this.mode === 'practice') return;   // しあい中は変えられない
      if (!this.net || !this.room) return;
      const gid = CS.Weapons.gun(gunId).id, g2 = cleanGun2(gun2Id, gid);
      const m = { t: 'set', gun: gid, gun2: g2, gm: cleanMods(gm, gid), gm2: g2 ? cleanMods(gm2, g2) : '', bomb: CS.Weapons.bomb(bombId).id };
      if (this.isHost) this._hostSet('host', m); else this.net.send(m);
    }

    setReady(v) {
      if (!this.room) return;
      const m = { t: 'set', ready: !!v };
      if (this.isHost) this._hostSet('host', m); else if (this.net) this.net.send(m);
    }

    /* スキン・なまえを へやの中で変えた（ロビーにいるときだけ伝える） */
    setLook() {
      if (!this.net || !this.room || this.mode !== 'lobby') return;
      const m = { t: 'set', skin: this._mySkin() || 0, name: clipName(CS.Settings.name) };
      if (this.isHost) this._hostSet('host', m); else this.net.send(m);
    }

    /* v5: ホストだけ: へやに コンピューターを 入れる・へらす・つよさを かえる（ロビーのあいだ）。
       op = 'add'（a = チーム）/ 'del'（a = id）/ 'lv'（a = id。よわい → ふつう → つよい → よわい） */
    roomBot(op, a) {
      const room = this.room;
      if (!this.isHost || !room || room.started || this.mode !== 'lobby' || isCoopMode(room.mode)) return false;
      const per = perTeam(room.mode);
      if (op === 'add') {
        const t = (a | 0) === 1 ? 1 : 0;
        let n = 0;
        for (const p of room.players) if (p.team === t) n++;
        if (n >= per || !CS.Bots) return false;
        const rg = Math.random;
        const lo = CS.Bots.randomLoadout(rg);
        const used = {};
        for (const p of room.players) used[p.name] = 1;
        let nm = '';
        for (const b of shuffle(BOT_NAMES.slice(), rg)) { const c = 'CPU・' + b; if (!used[c]) { nm = c; break; } }
        this._cpuSeq = (this._cpuSeq | 0) + 1;
        room.players.push({
          id: 'cpu' + this._cpuSeq, name: clipName(nm || 'CPU'), team: t, gun: lo.gun, gun2: '', bomb: lo.bomb, ready: true, ping: 0,
          fc: '', skin: CS.Skins ? CS.Skins.random(rg, { teamColor: true, noPattern: true }) : null, bot: 'normal'
        });
      } else if (op === 'del' || op === 'lv') {
        const i = room.players.findIndex((p) => p.id === a && p.bot);
        if (i < 0) return false;
        if (op === 'del') room.players.splice(i, 1);
        else { const L = ['easy', 'normal', 'hard']; const p = room.players[i]; p.bot = L[(L.indexOf(p.bot) + 1) % L.length]; }
      } else return false;
      this._broadcastLobby();
      return true;
    }

    /* CS2: ホストだけ: ボスレイドの へやの せってい（ロビーのあいだ） */
    setRoomRaid(cfg) {
      if (!this.isHost || !this.room || this.room.started || this.mode !== 'lobby' || this.room.mode !== 'raid' || !CS.Raid) return false;
      this.room.raid = CS.Raid.cleanCfg(cfg);
      for (const p of this.room.players) p.ready = false;
      this._broadcastLobby();
      return true;
    }

    /* CS2: ホストだけ: 城バトルの へやの せってい（ロビーのあいだ） */
    setRoomCastle(cfg) {
      if (!this.isHost || !this.room || this.room.started || this.mode !== 'lobby' || this.room.mode !== 'castle' || !CS.Castle) return false;
      this.room.castle = CS.Castle.cleanCfg(cfg);
      for (const p of this.room.players) p.ready = false;
      this._broadcastLobby();
      return true;
    }

    /* ホストだけ: へやのルール・マップを変える（ロビーのあいだ） */
    setRoomRule(rule, mapId) {
      if (!this.isHost || !this.room || this.room.started || this.mode !== 'lobby') return false;
      if (rule) this.room.rule = CS.cleanRule(rule);
      if (mapId) { const d = CS.Maps.get(mapId); if (d) this.room.mapId = this.mapId = d.id; }
      for (const p of this.room.players) p.ready = false;
      this._broadcastLobby();
      return true;
    }

    requestTeam(team) {
      if (!this.room) return;
      const m = { t: 'set', team: (team | 0) === 1 ? 1 : 0 };
      if (this.isHost) this._hostSet('host', m); else if (this.net) this.net.send(m);
    }

    canStart() {
      if (!this.isHost || !this.room || this.room.started) return false;
      const per = perTeam(this.room.mode);
      const n = [0, 0];
      for (const p of this.room.players) { n[p.team]++; if (!p.ready) return false; }
      /* みんなで塔のぼり: 1人から（ぜんいん じゅんびOK なら） */
      if (isCoopMode(this.room.mode)) return n[0] >= 1 && n[1] === 0;
      /* CS2: 城バトル: 1人から（あきは コンピューターが 入る） */
      if (this.room.mode === 'castle') return n[0] + n[1] >= 1 && n[0] <= per && n[1] <= per;
      return n[0] === per && n[1] === per;
    }

    startMatch() {
      if (!this.canStart()) return false;
      const room = this.room;
      room.started = true;
      if (room.mode === 'tower') {
        if (!this._towerStartCoop || !this._towerStartCoop()) { room.started = false; return false; }
        return true;
      }
      if (room.mode === 'defense') {
        if (!this._defStartCoop || !this._defStartCoop()) { room.started = false; return false; }
        return true;
      }
      if (room.mode === 'raid') {
        if (!this._raidStartCoop || !this._raidStartCoop()) { room.started = false; return false; }
        return true;
      }
      if (room.mode === 'castle') {
        if (!this._csStartRoom || !this._csStartRoom()) { room.started = false; return false; }
        return true;
      }
      /* v5.1: みんなで トーナメント: トーナメント表を 作って みんなへ（しあいは ホストが ひとつずつ はじめる） */
      if (room.mode === 'tourney') {
        if (!this._tnStartCoop || !this._tnStartCoop()) { room.started = false; return false; }
        return true;
      }
      const order = room.players.slice();
      const slot = [0, 0];
      const players = [], spawns = [];
      for (let i = 0; i < order.length; i++) {
        const p = order[i];
        players.push({ id: p.id, idx: i, name: p.name, team: p.team, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, fc: p.fc || '', skin: p.skin || null, bot: p.bot || undefined });
        spawns.push(slot[p.team]++);
      }
      const msg = {
        t: 'start', seed: (Math.random() * 0x7fffffff) | 0, map: room.mapId,
        mode: room.mode, players: players, spawns: spawns, rule: CS.cleanRule(room.rule)
      };
      /* じぶんで作ったマップは中身もいっしょに送る（ゲストは持っていない） */
      if (CS.CustomMaps && CS.CustomMaps.isCustomId(room.mapId)) {
        const w = CS.CustomMaps.wireOf(room.mapId);
        if (!w) { room.started = false; return false; }
        msg.cmap = w;
      }
      this._broadcast(msg);
      return true;
    }

    backToLobby() {
      if (this.isHost) {
        if (this.room) { this.room.started = false; for (const p of this.room.players) p.ready = false; }
        this._broadcast({ t: 'tolobby' });
      } else if (this.net) {
        /* ゲストは自分でロビーへもどらない。ホストの {t:'tolobby'} を待つ。
           先にもどってしまうと、ホストはまだ mode='match' なので
           そこで変えた ぶき／じゅんびOK が ぜんぶ捨てられてしまう。 */
        this.net.send({ t: 'set', ready: false });
      }
    }

    leaveRoom() {
      if (this.isHost && this.net) { try { this.net.send({ t: 'bye' }); } catch (e) {} }
      this._teardown();
    }

    /* ---- マップとワールド ---- */
    _loadWorld(def) {
      const md = def.build();
      this.mapData = md;
      this.world = new CS.World(md);
      if (this.renderer) this.renderer.setWorld(this.world);
    }

    /* start のマップ。塔のぼりは m.mapDef（その場で作った階）、じぶんのマップは m.cmap（ホストが中身を送る） */
    _mapDefFor(m) {
      if (m.mapDef && typeof m.mapDef.build === 'function') return m.mapDef;
      /* CS2: ボスレイドの アリーナ */
      if (m.raid && this._raidMapDef) { const d = this._raidMapDef(m.raid); if (d) return d; }
      /* CS2: 城バトルの 草原 */
      if (m.castle && this._csMapDef) { const d = this._csMapDef(m.castle); if (d) return d; }
      /* v4: 塔のぼりの階は みんなが 同じ種（seed・階・とびら）から 同じものを作る */
      if (m.tower && this._towerMapDef) { const d = this._towerMapDef(m.tower); if (d) return d; }
      const CM = CS.CustomMaps;
      if (CM && m.cmap) { const d = CM.defFromWire(m.cmap, m.map); if (d) return d; }
      if (CM && CM.isCustomId(m.map)) { const d = CM.def(m.map); if (d) return d; }
      return CS.Maps.get(m.map);
    }

    /* ---- ルール ---- */
    _setRule(r) {
      this.rule = r && (r.id === 'tower' || r.id === 'defense' || r.id === 'raid' || r.id === 'castle') ? { id: r.id, n: 0 } : CS.cleanRule(r);
      const id = this.rule.id;
      this.killsToWin = id === 'kills' ? this.rule.n : Infinity;
      this.timeLimit = id === 'tower' || id === 'defense' || id === 'raid' || id === 'castle' ? 0 : CS.ruleTime(this.rule);
      this.timeLeft = this.timeLimit;
      this.zone = id === 'area' ? this._makeZone() : null;
      this.zoneOwner = -1; this.zoneFight = false;
      this._areaAcc[0] = this._areaAcc[1] = 0;
      this.specIdx = -1;
    }

    /* ルールの点のはじめ（ストックは のこりの合計、ほかは 0） */
    _ruleScore() {
      const s = [0, 0];
      if (this.rule.id === 'stock') {
        for (const p of this.players) if (p.connected) s[p.team] += Math.max(0, p.stock);
      }
      return s;
    }

    /* エリア（ワールド座標の箱）。マップに zone がなければ まんなかの 8m 四方・高さぜんぶ */
    _makeZone() {
      const md = this.mapData;
      if (!md) return null;
      const vs = CS.VOXEL;
      let z = md.zone;
      if (!z) {
        const cx = md.W * vs / 2, cz = md.D * vs / 2;
        z = { x0: cx - 4, x1: cx + 4, z0: cz - 4, z1: cz + 4, y0: 0.5, y1: md.H * vs };
      }
      return { x0: z.x0, x1: z.x1, y0: z.y0, y1: z.y1, z0: z.z0, z1: z.z1, cx: (z.x0 + z.x1) / 2, cz: (z.z0 + z.z1) / 2 };
    }
    _inZone(p) {
      const z = this.zone, q = p.lastReport;
      return !!z && q[0] >= z.x0 && q[0] <= z.x1 && q[2] >= z.z0 && q[2] <= z.z1 && q[1] >= z.y0 && q[1] <= z.y1;
    }

    /* ---- しあい開始 ---- */
    _beginMatch(m) {
      /* v4: 塔のぼり（ひとりでも みんなでも）は 階の じょうほうを 先に うけとる（ぶきの パワーアップ・クリスタル） */
      if (m.tower && this._towerSync) this._towerSync(m.tower);
      /* コンピューターを動かすのは オフラインと ホスト（v5.1: 必殺技「コピー」も コンピューターなので いつも ホスト） */
      this.hostBots = this.offline || this.isHost;
      const mapDef = this._mapDefFor(m);
      this.mapId = mapDef.id;
      this.mapName = mapDef.name || '';
      this.matchMode = normMode(m.mode);
      this._loadWorld(mapDef);
      this.rng = CS.rng((m.seed | 0) >>> 0);
      this._setRule(m.rule);

      this.players = [];
      this.me = -1;
      const list = m.players || [];
      for (let i = 0; i < list.length; i++) {
        const pd = list[i];
        const base = { idx: i, id: pd.id, name: pd.name, team: pd.team, gun: pd.gun, gun2: pd.bot ? '' : pd.gun2, gm: pd.bot ? '' : pd.gm, gm2: pd.bot ? '' : pd.gm2, bomb: pd.bomb, fc: pd.fc, skin: pd.skin, bot: pd.bot || undefined };
        /* 塔のぼり: パワーアップ入りのぶき・HP（みんな同じ チップ・てきの つよさ から この端末で作る） */
        const td = m.tower && this._towerDefs ? this._towerDefs(pd) : null;
        if (td) Object.assign(base, td.base);
        const p = makePlayer(base);
        if (td) Object.assign(p, td.extra);
        if (pd.npc) p.npc = true;
        if (pd.bot) p.cpu = true;             // v5: コンピューター（ゲストの 画面でも わかる。位置は ホストが まとめて送る）
        if (m.tower && m.tower.sp && !pd.npc) p.sp = clamp(+m.tower.sp[pd.id] || 0, 0, 1);
        const sl = (m.spawns && m.spawns[i]) | 0;
        this._placeAtSpawn(p, sl);
        /* v5.1: トーナメントで この しあいに でない人は かんせん（出てこない・点に ならない） */
        if (pd.spec) { p.spec = true; p.out = true; p.alive = false; p.hp = 0; p.respawnAt = 0; }
        this.players.push(p);
        if (pd.id === this.myNetId) this.me = i;
        /* コンピューター（オフライン と みんなで塔のぼりの ホストだけが 動かす。ほかの端末では ふつうの あいて） */
        if (this.hostBots && pd.bot && CS.Bots) this._makeBot(p, pd.bot, m.seed);
      }
      /* v5.1: 必殺技「コピー」の いれもの（人 ひとりに 1つ。ふだんは いない。塔のぼりには ない）。
         どの端末でも おなじ じゅんばんで 作るので ばんごうが そろう。見た目・銃・ボムは 持ち主と おなじ */
      if (!m.tower) {
        const owners = this.players.slice();
        for (const o of owners) {
          if (o.cpu || o.npc || o.spec) continue;
          const i = this.players.length;
          const c = makePlayer({ idx: i, id: 'cl' + o.idx, name: o.name, team: o.team, gun: o.gunId, bomb: o.bombId, skin: o.skin });
          c.gun = o.guns[0]; c.guns = [c.gun]; c.bomb = o.bomb; c.maxHp = o.maxHp;
          c.clone = o.idx; c.cpu = true;
          this._placeAtSpawn(c, 0);
          c.alive = false; c.hp = 0; c.respawnAt = 0;
          this.players.push(c);
          if (this.hostBots && CS.Bots) this._makeBot(c, 'hard', m.seed);
        }
      }
      if (this.me < 0) this.me = 0;
      const me = this.players[this.me];
      me.local = true; me.rpos = me.pos; me.rquat = me.quat;
      if (this.rule.id === 'stock') for (const p of this.players) if (inPlay(p)) p.stock = this.rule.n;
      /* v5.1: トーナメントの しあい（どの しあいか） */
      this.tnMatch = m.tn ? { r: m.tn.r | 0, i: m.tn.i | 0 } : null;
      /* v5: キングバトル: チームに 1人ずつ キング */
      this._pickKings(m.seed);
      /* ボットの道さがし（あとで一瞬止まらないよう、先に作っておく）。エリアでは エリアの中の足場もおぼえる */
      this._goalNodes = null;
      /* チームごとの陣地（出撃地点のまわり）。コンピューターは 敵の陣地に入らない・出てきたばかりの人を ねらわない */
      this._spawnZones = [0, 1].map((t) => ({
        pts: ((this.mapData.spawns && this.mapData.spawns[t]) || []).map((s) => [s.p[0], s.p[1], s.p[2]]),
        r: SPAWN_R
      }));
      if (this.hostBots && this.world && typeof this.world.buildNav === 'function') {
        try {
          const nav = this.world.buildNav();
          const z = this.zone, q = [0, 0, 0];
          const inZ = () => !!z && q[0] >= z.x0 && q[0] <= z.x1 && q[2] >= z.z0 && q[2] <= z.z1 && q[1] >= z.y0 && q[1] <= z.y1;
          if (z && nav && nav.mainList) {
            const pts = [];
            for (let k = 0; k < nav.mainList.length; k++) {
              this.world.navPos(nav.mainList[k], q);
              if (inZ()) pts.push([q[0], q[1], q[2]]);
            }
            if (pts.length) this._goalNodes = pts;
          }
          /* 陣地の中の足場（コンピューターの道さがしで なるべく 通らない。エリアの中は のぞく） */
          if (nav && nav.count) {
            for (const zs of this._spawnZones) {
              const mask = new Uint8Array(nav.count), r2 = zs.r * zs.r;
              for (let i = 0; i < nav.count; i++) {
                this.world.navPos(i, q);
                if (inZ()) continue;
                for (const s of zs.pts) {
                  const dx = q[0] - s[0], dz = q[2] - s[2];
                  if (dx * dx + dz * dz < r2 && Math.abs(q[1] - s[1]) < 4) { mask[i] = 1; break; }
                }
              }
              zs.mask = mask;
            }
          }
        } catch (e) { if (window.console) console.error('[game] buildNav', e); }
      }

      this.mode = 'match';
      this.phase = 'countdown';
      this.countdown = m.tower ? 2 : COUNTDOWN;     // 塔のぼりは 階の名前を出すので みじかく
      this.matchTime = 0;
      this.timeLeft = this.timeLimit;
      this.score = this._ruleScore();
      this.suddenDeath = false;
      this.endAt = -1;
      this.hold = false;
      this.dance = null;
      this.iceUntil[0] = this.iceUntil[1] = 0;      // v5.2
      this.seq = 0; this.poseT = 0; this.statusT = 0; this._cdLast = undefined; this.botPoseT = 0;
      this.respawnT = -1; this.respawnKiller = '';
      this._resetLocal(me);
      this._clearEntities();
      /* 塔のぼり: クリスタル（みんな同じ場所・同じ HP） */
      if (m.tower && this._towerTargets) this._towerTargets();
      /* v5: クリスタルまもり: まもる クリスタル・てきは まだ いない */
      this.defense = null;
      if (m.def && this.rule.id === 'defense' && this._defSetup) this._defSetup(m.def);
      /* CS2: ボスレイド: ボス・ザコの じゅんび */
      this.raid = null;
      if (m.raid && this.rule.id === 'raid' && this._raidSetup) this._raidSetup(m.raid);
      /* CS2: 城バトル: 城の ブロック・基地・部隊の 入れもの */
      this.castle = null;
      if (this._csCleanup) this._csCleanup();
      if (m.castle && this.rule.id === 'castle' && this._csSetup) this._csSetup(m.castle);
      /* いっしょに遊んだ人（フレンド申請できるように おぼえる。コンピューターはのぞく） */
      if (!this.offline) {
        const people = [];
        for (const p of this.players) if (p.idx !== this.me && p.fc) people.push({ fc: p.fc, name: p.name });
        if (people.length) this._emit('recent', people);
      }
      this._emit('matchStart', this);
      CS.UI.hud.show(true);
      if (CS.UI.setMenuMode) CS.UI.setMenuMode(this.offline ? 'offline' : 'online');
      if (CS.UI.setRuleMode) CS.UI.setRuleMode(this.rule.id);
      CS.UI.show(null);
      if (!this.tower) { CS.UI.hud.center('3', '#ffffff', 900); this._sfx('count'); }
      else if (this._towerTitle) this._towerTitle();
      /* v5: キングバトル: だれが キングか */
      if (this.rule.id === 'king' && this.kings) {
        const mk = this._king(me.team);
        CS.UI.toast(me.king ? 'あなたが キング！ やられないように 気をつけて。あいての キングを たおせば 勝ち'
          : 'みかたの キングは ' + (mk ? mk.name : '？') + '。まもりながら あいての キング（王冠）を たおそう');
      }
      /* v5.1: トーナメントで この しあいに でない人 */
      if (me.spec) CS.UI.toast('かんせん中: ' + this.players.filter(inPlay).map((p) => p.name).join(' vs '));
    }

    /* ---- コンピューターと対戦（オフライン） ----
       opt = {mode:'1v1'|'2v2'|'3v3', level:'flee'|'easy'|'normal'|'hard', mapId,
              enemyGun, enemyBomb, allyGun, allyBomb}   // ぶきは id か 'random'（1人ずつランダム）
       自分はあかチーム。なかまのCPUはふつう以上（「逃げるだけ」のときも なかまは「ふつう」で戦う） */
    startCpu(opt) {
      opt = opt || {};
      if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
      const mode = normMode(opt.mode), per = perTeam(mode);
      const level = CS.Bots.LEVELS && CS.Bots.LEVELS[opt.level] ? opt.level : 'normal';
      const mapDef = CS.Maps.get(opt.mapId) || CS.Maps.list[0];
      /* v5: コンピューターに もたせない ぶき（noBot: ワープボム・ギガバースト）は おまかせに */
      const gunOr = (id) => (CS.GunMap[id] && !CS.GunMap[id].noBot ? id : 'random');
      const bombOr = (id) => (CS.BombMap[id] && !CS.BombMap[id].noBot ? id : 'random');
      this._teardown();
      this.isHost = true;
      this.myNetId = 'host';
      this.offline = true;
      this.cpu = {
        mode: mode, level: level, mapId: mapDef.id,
        enemyGun: gunOr(opt.enemyGun), enemyBomb: bombOr(opt.enemyBomb),
        allyGun: gunOr(opt.allyGun), allyBomb: bombOr(opt.allyBomb),
        rule: CS.cleanRule(opt.rule)
      };
      const cpu = this.cpu;
      const seed = (Math.random() * 0x7fffffff) | 0;
      const rg = CS.rng((seed ^ 0x5bd1e995) >>> 0);
      const names = shuffle(BOT_NAMES.slice(), rg);
      const allyLv = level === 'flee' ? 'normal' : level;
      const players = [], spawns = [], slot = [0, 0];
      const add = (pd) => { players.push(pd); spawns.push(slot[pd.team]++); };
      add({ id: 'host', name: clipName(CS.Settings.name), team: 0, gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(), skin: this._mySkin() });
      let k = 0;
      for (let t = 0; t < 2; t++) {
        const n = t === 0 ? per - 1 : per;
        for (let i = 0; i < n; i++, k++) {
          /* えらんだぶき。'random' のところだけ 1人ずつランダム */
          const lo = CS.Bots.randomLoadout(rg);
          const wantG = t === 0 ? cpu.allyGun : cpu.enemyGun, wantB = t === 0 ? cpu.allyBomb : cpu.enemyBomb;
          const gun = wantG !== 'random' ? wantG : lo.gun, bomb = wantB !== 'random' ? wantB : lo.bomb;
          /* コンピューターは からだはチームの色のまま、ぼうし・かおだけ 1人ずつちがう */
          const skin = CS.Skins ? CS.Skins.random(rg, { teamColor: true, noPattern: true }) : null;
          add({ id: 'bot' + k, name: '' + names[k % names.length], team: t, gun: gun, bomb: bomb, bot: t === 0 ? allyLv : level, skin: skin });
        }
      }
      this._beginMatch({ seed: seed, map: mapDef.id, mode: mode, players: players, spawns: spawns, rule: cpu.rule });
      return true;
    }

    _placeAtSpawn(p, slot) {
      const sp = this.mapData.spawns[p.team] || this.mapData.spawns[0];
      const s = sp[slot % sp.length] || sp[0];
      p.pos[0] = s.p[0]; p.pos[1] = s.p[1]; p.pos[2] = s.p[2];
      p.rpos[0] = s.p[0]; p.rpos[1] = s.p[1]; p.rpos[2] = s.p[2];
      p.vel[0] = p.vel[1] = p.vel[2] = 0;
      p.yaw = s.yaw; p.pitch = 0; p.ryaw = s.yaw; p.rpitch = 0;
      p.quat = [0, 0, 0, 1]; p.rquat = [0, 0, 0, 1];
      p.alive = true; p.hp = p.maxHp || RULES.hp;
      p.sliding = false; p.slideK = 0;
      p.buf.length = 0; p.off = null; p.offs.length = 0;
      p.lastReport[0] = s.p[0]; p.lastReport[1] = s.p[1]; p.lastReport[2] = s.p[2];
    }

    _resetLocal(me) {
      this.viewYaw = me.yaw; this.viewPitch = 0;
      this.recPitch = 0; this.recYaw = 0;
      this.adsT = 0; this.stepSmooth = 0;
      this.slideT = 0; this.slideCd = 0; this.slideBufT = -1; this.slideEye = 0;
      this.jumpBufT = -1; this.coyoteT = -1; this.bjCd = 0; this.bjWin = 0;
      this._fillGuns(me);
      this.bombState = { charges: me.bomb.charges, max: me.bomb.charges, t: 0, cd: me.bomb.cooldown };
      this.vm.flash = 0; this.vm.recoil = 0; this.vm.reload = -1; this.vm.ads = 0; this.vm.charge = -1; this.vm.spin = 0;
      this.vm.bob[0] = 0; this.vm.bob[1] = 0;
      this.shake = 0;
      me.protect = true;
      this.protectT = RULES.spawnProtect;
      if (CS.Input.resetAds) CS.Input.resetAds();
      if (CS.Input.setGunMode) CS.Input.setGunMode(!!SCOPED[me.gun.id]);
    }

    /* この端末で 動かす コンピューターに する（頭脳・持ち物）。位置は その場で 動かすので 補間しない */
    _makeBot(p, level, seed) {
      p.rpos = p.pos; p.rquat = p.quat;
      p.bot = {
        level: level,
        brain: CS.Bots.create({ level: level, idx: p.idx, team: p.team, rng: CS.rng(((seed | 0) + p.idx * 7919) >>> 0) }),
        ctx: this._newCtx(p),
        view: { time: 0, world: null, smoke: this._smokeFn, self: {}, players: null, goals: null },
        saveMe: -1, lo: null
      };
    }

    /* ボット1体ぶんの「操作する人の持ち物」（CTX_KEYS と同じ名前） */
    _newCtx(p) {
      return {
        viewYaw: p.yaw, viewPitch: 0, recPitch: 0, recYaw: 0, adsT: 0,
        eye: [p.pos[0], p.pos[1] + PLAYER.eye, p.pos[2]], aim: V.forward(p.yaw, 0),
        jumpBufT: -1, coyoteT: -1, bjCd: 0, bjWin: 0, bjY: 0,
        gunState: this._newGunState(p.gun),
        bombState: { charges: p.bomb.charges, max: p.bomb.charges, t: 0, cd: p.bomb.cooldown },
        vm: { bob: [0, 0], recoil: 0, reload: -1, ads: 0, flash: 0, spin: 0, charge: -1, side: 0, avoid: null },
        protectT: RULES.spawnProtect, stepSmooth: 0, shake: 0, beam: null, _emptyT: 0,
        slideT: 0, slideCd: 0, slideBufT: -1, slideEye: 0, slideArm: false
      };
    }

    _clearEntities() {
      this.projectiles.length = 0;
      this.fields.length = 0;
      this.bombs.length = 0;
      this.smokes.length = 0;
      this._dmgNums.length = 0;
      this.beam = null;
      for (let i = 0; i < MAX_PARTS; i++) this.parts[i].life = 0;
      for (let i = 0; i < MAX_TRACERS; i++) this.tracers[i].life = 0;
      this._stopLoops();
    }

    _stopLoops() {
      const A = CS.Audio;
      for (const k in this._loops) { if (this._loops[k]) { A.loop(k, this._loops[k], false); this._loops[k] = null; } }
      A.stopAll();
    }

    _loop(key, name, on, opts) {
      const A = CS.Audio;
      const bot = this._bot;
      if (bot) {
        /* ボットの音: ボットごとの鍵で、ボットの場所から鳴らす（転がる音は出さない） */
        if (name === 'roll') return;
        key = key + '#' + bot.idx;
        const o = bot.bot.lo || (bot.bot.lo = { pos: null, vol: 1, rate: 1 });
        o.pos = bot.pos;
        o.vol = opts && typeof opts.vol === 'number' ? opts.vol : 1;
        o.rate = opts && typeof opts.rate === 'number' ? opts.rate : 1;
        opts = o;
      }
      if (on) { this._loops[key] = name; A.loop(key, name, true, opts); }
      else if (this._loops[key]) { A.loop(key, this._loops[key], false); this._loops[key] = null; }
    }

    _sfx(name, pos, vol, rate) {
      const A = CS.Audio;
      if (!A || !A.play) return;
      if (!pos && this._bot) {
        if (name === 'empty') return;            // ボットの「カチッ」はうるさいだけ
        pos = this._bot.pos;                     // ボットの音はボットの場所から
      }
      if (pos) A.play(name, { pos: pos, vol: vol, rate: rate });
      else A.play(name, { vol: vol, rate: rate });
    }

    /* ---- ためし撃ち ---- */
    /* opt = {gun, bomb}（チュートリアルは いつも アサルトライフル＋フラグボム） */
    startPractice(opt) {
      opt = opt || {};
      this._teardown();
      this.isHost = true;
      this.myNetId = 'host';
      this.mode = 'practice';
      this.phase = 'live';
      this.mapId = CS.Maps.practice.id;
      this._loadWorld(CS.Maps.practice);
      this.rng = CS.rng(12345);
      const gun = opt.gun ? CS.Weapons.gun(opt.gun).id : this._myGunId(), bomb = opt.bomb ? CS.Weapons.bomb(opt.bomb).id : this._myBombId();
      const gun2 = opt.gun ? (opt.gun2 || '') : this._myGun2Id();     // チュートリアルは えらんだ銃
      const gm = opt.gun ? (opt.gm || '') : this._myGm(), gm2 = opt.gun ? (opt.gm2 || '') : this._myGm2();
      const p = makePlayer({ idx: 0, id: 'host', name: clipName(CS.Settings.name), team: 0, gun: gun, gun2: gun2, gm: gm, gm2: gm2, bomb: bomb, skin: this._mySkin() });
      p.local = true; p.rpos = p.pos; p.rquat = p.quat;
      this._setRule(null);
      this.players = [p];
      this.me = 0;
      this._placeAtSpawn(p, 0);
      this._resetLocal(p);
      this.protectT = 0; p.protect = false;
      this.respawnT = -1; this.respawnKiller = '';
      this._clearEntities();
      this._buildTargets();
      this.score = [0, 0];
      this.timeLeft = RULES.timeLimit;
      this.countdown = 0;
      this.practiceStats = { hits: 0, damage: 0, kills: 0 };
      CS.UI.hud.show(true);
      if (CS.UI.setPractice) CS.UI.setPractice(true);
      CS.UI.show(null);
      this._emit('matchStart', this);
    }

    _buildTargets() {
      this.targets.length = 0;
      const pts = (this.mapData && this.mapData.targets) || [];
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        this.targets.push({
          base: [q[0], q[1], q[2]], pos: [q[0], q[1], q[2]],
          slide: (i % 3 === 2) ? 0.7 : 0, phase: i * 1.1, speed: 0.55 + (i % 3) * 0.12,
          hp: 100, max: 100, dead: false, respawnAt: 0, hitT: 0
        });
      }
    }

    /* ---- 片づけ ---- */
    _teardown() {
      this._stopLoops();
      try { CS.Input.enable(false); } catch (e) {}
      try { CS.Input.setAdsScale(1); } catch (e) {}
      try { if (CS.Input.setSwap) CS.Input.setSwap(false); } catch (e) {}
      if (this.net) { try { this.net.close(); } catch (e) {} this.net = null; }
      this.players = [];
      this.me = -1;
      this.room = null;
      this.targets.length = 0;
      this._clearEntities();
      this.world = null;
      this.mapData = null;
      this.mode = 'idle';
      this.phase = 'idle';
      this.isHost = false;
      this.myNetId = null;
      this.paused = false;
      this.hold = false;
      this.offline = false;
      this.cpu = null;
      this._bot = null;
      this._pausedNow = false;
      this.score = [0, 0];
      this.countdown = 0;
      this.endAt = -1;
      this.suddenDeath = false;
      this.zone = null; this.zoneOwner = -1; this.zoneFight = false; this.specIdx = -1;
      this._goalNodes = null;
      if (this.dance && this._endDance) this._endDance(true);
      this.dance = null;
      this.tower = null;
      this.hostBots = false;
      this.kings = null; this.kingWin = -1;
      this.defense = null; this.tnMatch = null; this.raid = null; this.castle = null;
      this.iceUntil[0] = this.iceUntil[1] = 0;
      if (this.renderer) this.renderer.ice = 0;
      try { CS.UI.hud.show(false); } catch (e) {}
      try { if (CS.UI.setRuleMode) CS.UI.setRuleMode(''); } catch (e) {}
      if (this.renderer && this.renderer.ok) {
        try { this.renderer.setWorld(null); } catch (e) {}
      }
    }

    quit() { this.leaveRoom(); }

    /* ==================================================================
       2. LocalPlayer（移動・転がり・カメラ）
       ================================================================== */
    _updateLocal(dt, inp) {
      const me = this.players[this.me];
      if (!me) return;
      const locked = this.phase === 'countdown';

      /* ---- 視点 ---- */
      this.viewYaw = CS.wrapAngle(this.viewYaw - inp.lookX);
      this.viewPitch = clamp(this.viewPitch + inp.lookY, -PITCH_MAX, PITCH_MAX);
      /* 反動のもどり */
      const rec = Math.exp(-dt * 7);
      this.recPitch *= rec; this.recYaw *= rec;
      if (Math.abs(this.recPitch) < 1e-4) this.recPitch = 0;
      if (Math.abs(this.recYaw) < 1e-4) this.recYaw = 0;
      me.yaw = CS.wrapAngle(this.viewYaw + this.recYaw);
      me.pitch = clamp(this.viewPitch + this.recPitch, -PITCH_MAX, PITCH_MAX);

      const g = me.gun;
      const alive = me.alive && this.phase !== 'over';
      /* CS2: スロー（おそい）・スピードガン（はやい） */
      const fx = me.fx, ft = this.time;
      const fxMul = fx ? (fx.slow > ft ? fx.slowMul || 0.6 : 1) * (fx.spd > ft ? fx.spdMul || 1.35 : 1) : 1;
      const base = PLAYER.speed * (g.move || 1) * fxMul;       // 走る速さ
      /* v5: 必殺技 せんしゃ（ジャンプ・スライディング なし）・バブル（うかぶ。ジャンプで 上・スライドで 下） */
      const tank = me.spK === 'tank' && alive, bubble = me.spK === 'bubble' && alive;
      /* v5.1: こおりボムで こおっている あいだは うごけない（向きを かえる・撃つ ことは できる） */
      const frozen = alive && me.frozenUntil > this.time;
      /* v5.2: アイスフィールド: 氷の 床で すべる（止まりにくく、向きも かえにくい） */
      const icy = alive && this.iceUntil[me.team] > this.time;
      const noJump = tank || bubble || frozen;
      if (frozen) { me.vel[0] = 0; me.vel[2] = 0; if (this.slideT > 0) this._endSlide(); }

      /* ---- ジャンプ・スライディングの入力（少しだけ先押しを受けつける） ----
         v5.4: ジャンプして 上がっている あいだ（BJ.win 秒）に もう一回 おすと 大ジャンプ（つかったら BJ.cd 秒 まつ） */
      if (this.bjCd > 0) this.bjCd -= dt;
      if (this.bjWin > 0) this.bjWin -= dt;
      let bigJump = false;
      if (inp.jump && alive && !locked && !noJump && this.bjWin > 0 && this.bjCd <= 0 && !me.grounded && me.vel[1] > -3) { bigJump = true; this.bjWin = 0; }
      else if (inp.jump && alive && !locked && !noJump) this.jumpBufT = JUMP_BUF;
      else if (this.jumpBufT > 0) this.jumpBufT -= dt;
      if (noJump) { this.jumpBufT = -1; this.bjWin = 0; }
      if (inp.slide && alive && !locked && !noJump) this.slideBufT = SLIDE_BUF;
      else if (this.slideBufT > 0) this.slideBufT -= dt;
      /* 押しっぱなし: 押したら「待ち」にして、はなすまで待つ（先に押してから走り出しても すべれる）。
         1回すべったら、押しなおすまで次は出ない */
      if (inp.slide && !noJump) this.slideArm = true;
      if (!inp.slideHeld) this.slideArm = false;
      if (this.slideCd > 0) this.slideCd -= dt;

      /* ---- 進みたい向き ---- */
      let mx = alive && !locked && !frozen ? inp.mx : 0, mz = alive && !locked && !frozen ? inp.mz : 0;
      const fw = V.flatForward(me.yaw), rt = V.right(me.yaw);
      let wx = fw[0] * mz + rt[0] * mx, wz = fw[2] * mz + rt[2] * mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1e-5) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }
      const wish = Math.min(1, wl);
      const adsSlow = this.adsT > 0.1 ? (1 - 0.3 * this.adsT) : 1;
      const speed = base * adsSlow * wish;

      const vel = me.vel, pos = me.pos;

      /* ---- スライディング開始 ----
         地面にいて動いている（か、動こうとしている）とき。いまの速さか 走る速さ×1.8 の速いほうで、
         入力の向き（なければ いま進んでいる向き）へすべりだす */
      if ((this.slideBufT > 0 || this.slideArm) && this.slideT <= 0 && this.slideCd <= 0 && me.grounded && alive && !locked) {
        const hs0 = Math.hypot(vel[0], vel[2]);
        let dx = 0, dz = 0;
        if (wish > 0.2) { dx = wx; dz = wz; }
        else if (hs0 > base * 0.3) { dx = vel[0] / hs0; dz = vel[2] / hs0; }
        if (dx !== 0 || dz !== 0) {
          const sp = Math.max(hs0, base * SLIDE.speedMult);
          vel[0] = dx * sp; vel[2] = dz * sp;
          this.slideT = SLIDE.dur;
          this.slideBufT = -1;
          this.slideArm = false;
          this._sfx('slide');
          this._poseNow = true;
        }
      }

      /* v5.4: 大ジャンプ: とんだ 場所から BJ.h 上まで とどく 上むきの いきおい（いまの 高さから たりない ぶん） */
      if (bigJump) {
        const v = Math.sqrt(2 * PLAYER.gravity * Math.max(1, this.bjY + BJ.h - pos[1]));
        if (v > vel[1]) vel[1] = v;
        this.bjCd = BJ.cd; this.jumpBufT = -1; this.coyoteT = -1;
        this._sfx('bigjump');
        this._poseNow = true;
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2;
          this._addPart(pos[0], pos[1] - PLAYER.half + 0.1, pos[2], Math.cos(a) * 4, -0.5 - rnd(), Math.sin(a) * 4,
            0.12 + rnd() * 0.06, 0.85, 0.95, 1, 0.45 + rnd() * 0.2, 2, 2.2, 0);
        }
      }

      const n = Math.max(1, Math.ceil(dt / SUB_DT));
      const sdt = dt / n;
      let grounded = me.grounded, stepDy = 0, landV = 0, landed = false;
      /* オートジャンプ: 1ブロックの段差に進むと、とばずに その場で一段上へ乗る（moveBox の stepUp）。
         2ブロック以上の かべ や、頭の上がふさがっている所は のぼらない。ボットはいつもオン */
      const autoStep = alive && !locked && (this._bot ? true : !!CS.Settings.autoJump);
      this._mv.stepUp = autoStep ? STEP_UP : 0;

      for (let s = 0; s < n; s++) {
        const sliding = this.slideT > 0;
        if (grounded) {
          if (this.coyoteT < COYOTE) this.coyoteT = COYOTE;
          /* 摩擦（スライディング中はよくすべる。氷の 床は もっと） */
          const fr = icy ? Math.min(ICE.friction, SLIDE.friction) : sliding ? SLIDE.friction : PLAYER.friction;
          const sp = Math.hypot(vel[0], vel[2]);
          if (sp > 0.001) {
            const drop = Math.max(sp * fr * sdt, fr * 0.15 * sdt);
            const k = Math.max(0, sp - drop) / sp;
            vel[0] *= k; vel[2] *= k;
          }
        } else if (this.coyoteT > 0) this.coyoteT -= sdt;

        if (sliding && grounded) {
          /* スライディング中: 速さはそのまま、向きだけ少し曲げられる。うしろへ入れるとブレーキ */
          const sp = Math.hypot(vel[0], vel[2]);
          if (wish > 0 && sp > 0.05) {
            const ux = vel[0] / sp, uz = vel[2] / sp;
            const dot = ux * wx + uz * wz;
            if (dot < -0.3) {
              const k = Math.max(0, 1 - 3 * sdt);
              vel[0] *= k; vel[2] *= k;
            } else {
              let a = Math.atan2(ux * wz - uz * wx, dot);
              const lim = SLIDE_TURN * SLIDE.steer * sdt;
              if (a > lim) a = lim; else if (a < -lim) a = -lim;
              const c = Math.cos(a), sn = Math.sin(a);
              vel[0] = (ux * c - uz * sn) * sp;
              vel[2] = (ux * sn + uz * c) * sp;
            }
          }
        } else if (speed > 0) {
          /* 加速（バブル中は 空中でも 地面と おなじように うごける） */
          const ac = icy && grounded ? ICE.accel : ((grounded || bubble) ? PLAYER.accel : PLAYER.airAccel);
          const cur = vel[0] * wx + vel[2] * wz;
          const add = speed - cur;
          if (add > 0) {
            let a = ac * speed * sdt;
            if (a > add) a = add;
            vel[0] += wx * a; vel[2] += wz * a;
          }
        }

        /* ジャンプ（スライディング中なら いきおいのまま とぶ） */
        if (this.jumpBufT > 0 && (grounded || this.coyoteT > 0) && alive) {
          vel[1] = PLAYER.jump * (me.jumpMul || 1);
          grounded = false;
          this.jumpBufT = -1; this.coyoteT = -1;
          this.bjWin = BJ.win; this.bjY = pos[1];        // v5.4: このあと すぐ もう一回で 大ジャンプ
          if (this.slideT > 0) this._endSlide();
          this._sfx('jump');
          this._poseNow = true;
        }

        if (bubble) {
          /* v5: バブル: おちない。ジャンプを おしている間 上へ、スライドで 下へ。はなすと その高さで とまる */
          const tv = frozen ? 0 : !locked && inp.jumpHeld ? BUBBLE_RISE : (!locked && inp.slideHeld ? -BUBBLE_RISE : 0);
          vel[1] += (tv - vel[1]) * Math.min(1, sdt * 5);
          if (!grounded && speed <= 0) { const k = Math.max(0, 1 - 3 * sdt); vel[0] *= k; vel[2] *= k; }
        } else vel[1] -= PLAYER.gravity * sdt;
        if (vel[1] < -60) vel[1] = -60;

        const before = vel[1];
        const res = this.world.moveBox(pos, PLAYER.half, vel, sdt, this._mv);
        if (res.stepDy > 0) stepDy += res.stepDy;
        if (!grounded && res.grounded) { landed = true; landV = before; }
        grounded = res.grounded;
      }

      me.grounded = grounded;
      /* 段差にのぼった: 体は一瞬で上へ。目線だけ ほんの少し（0.1秒ほど）おくらせて、画面がガクッとしないようにする */
      if (stepDy > 0) { this.stepSmooth = Math.min(0.6, this.stepSmooth + stepDy); this._poseNow = true; }
      this.stepSmooth *= Math.exp(-dt * 24);
      if (this.stepSmooth < 0.001) this.stepSmooth = 0;

      /* 着地: 音だけ（画面も銃もゆらさない） */
      if (landed && landV < -2.5) {
        const k = clamp(-landV / 14, 0, 1);
        this._sfx('land', null, 0.4 + k * 0.6);
      }

      /* ---- スライディングの終わり: 時間切れ・おそくなった・地面からはなれた ---- */
      const hsp = Math.hypot(vel[0], vel[2]);
      if (this.slideT > 0) {
        this.slideT -= dt;
        if (this.slideT <= 0 || !grounded || !alive || hsp < base * SLIDE_MIN) this._endSlide();
      }
      const sliding = this.slideT > 0;
      me.sliding = sliding;
      me.slideK += ((sliding ? 1 : 0) - me.slideK) * Math.min(1, dt * 16);
      if (!sliding && me.slideK < 0.01) me.slideK = 0;

      /* ---- 転がり（スライディング中は転がらない） ---- */
      if (hsp > 0.3 && !sliding) me.quat = Q.roll(me.quat, vel[0], vel[2], dt, PLAYER.half);
      else me.quat = Q.settle(me.quat, 1 - Math.exp(-12 * dt));
      me.rquat = me.quat;
      me.rpos = me.pos;
      me.ryaw = me.yaw; me.rpitch = me.pitch;

      /* ---- 転がる音 ----
         ループは出しっぱなしにして rate だけ変える（0 なら無音）。
         しきい値で on/off すると、ゆっくり動いたときに毎フレーム作り直してしまう。 */
      const rollRate = (alive && grounded && hsp > 0.35 && !sliding) ? clamp(hsp / base, 0, 1.4) : 0;
      this._loop('roll', 'roll', alive && this.phase !== 'over', { rate: rollRate, vol: 0.55 });

      /* ---- 銃は歩いても・とんでも ゆらさない ---- */
      this.vm.bob[0] = 0; this.vm.bob[1] = 0;

      /* ---- 目の位置（スライディング中は低くなる） ---- */
      this.slideEye += ((sliding ? SLIDE.eyeDrop : 0) - this.slideEye) * Math.min(1, dt * 14);
      if (!sliding && this.slideEye < 0.001) this.slideEye = 0;
      this.eye[0] = pos[0];
      this.eye[1] = pos[1] + PLAYER.eye - this.stepSmooth - this.slideEye;
      this.eye[2] = pos[2];

      /* ---- むてき時間 ---- */
      if (this.protectT > 0) {
        this.protectT -= dt;
        if (this.protectT <= 0) { this.protectT = 0; me.protect = false; }
      }
    }

    _updateCamera(dt) {
      const me = this.players[this.me];
      const g = me ? me.gun : CS.Guns[0];
      const zoom = g.zoom > 0 ? g.zoom : 1;
      const fov = (CS.Settings.fov || 78) * (1 + (zoom - 1) * this.adsT);
      this.shake *= Math.exp(-dt * 3.2);
      if (this.shake < 0.002) this.shake = 0;
      const dir = V.forward(me ? me.yaw : 0, me ? me.pitch : 0);
      this.aim[0] = dir[0]; this.aim[1] = dir[1]; this.aim[2] = dir[2];
      this.fov = fov;
      /* ストックがなくなった: なかまの目線で見る */
      let eye = this.eye, yaw = me ? me.yaw : 0, pitch = me ? me.pitch : 0;
      const sp = this._spectateTarget();
      /* v5: 必殺技 せんしゃ の あいだは うしろから 見る（スプラトゥーンのような 3人称）。
         ねらいは 画面の まんなか（カメラの まんなかの線が 当たる所へ 目から 撃つ） */
      this.tps = !!(me && me.alive && me.spK === 'tank' && !sp);
      if (this.tps) {
        const piv = this._tpPiv || (this._tpPiv = [0, 0, 0]);
        piv[0] = me.pos[0]; piv[1] = me.pos[1] + 0.95; piv[2] = me.pos[2];
        const bk = this._tpBack || (this._tpBack = [0, 0, 0]);
        bk[0] = -dir[0]; bk[1] = -dir[1] + 0.32; bk[2] = -dir[2];
        const bl = Math.hypot(bk[0], bk[1], bk[2]) || 1;
        bk[0] /= bl; bk[1] /= bl; bk[2] /= bl;
        const rc = this.world ? this.world.raycast(piv, bk, TPS_DIST + 0.4, this._rc) : null;
        const want = rc ? Math.max(0.6, rc.t - 0.3) : TPS_DIST;
        this.tpsDist = this.tpsDist > 0 ? this.tpsDist + (want - this.tpsDist) * (want < this.tpsDist ? 1 : Math.min(1, dt * 4)) : want;
        const cp = this._tpCam || (this._tpCam = [0, 0, 0]);
        cp[0] = piv[0] + bk[0] * this.tpsDist; cp[1] = piv[1] + bk[1] * this.tpsDist; cp[2] = piv[2] + bk[2] * this.tpsDist;
        const rc2 = this._rc2 || (this._rc2 = { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 });
        const far = this.world ? this.world.raycast(cp, dir, 160, rc2) : null;
        const tt = far ? far.t : 160;
        let ax = cp[0] + dir[0] * tt - this.eye[0], ay = cp[1] + dir[1] * tt - this.eye[1], az = cp[2] + dir[2] * tt - this.eye[2];
        const al = Math.hypot(ax, ay, az);
        if (al > 1.5) { this.aim[0] = ax / al; this.aim[1] = ay / al; this.aim[2] = az / al; }
        eye = cp;
      } else this.tpsDist = 0;
      if (sp) {
        eye = this._specEye || (this._specEye = [0, 0, 0]);
        eye[0] = sp.rpos[0]; eye[1] = this._hurt(sp).cy + PLAYER.eye; eye[2] = sp.rpos[2];
        yaw = sp.ryaw; pitch = sp.rpitch;
      }
      this._viewEye = eye;
      /* 銃（ビューモデル）がよけるタッチボタンのかたまり（出ていなければ null） */
      this.vm.avoid = CS.Input.touchKeepOut ? CS.Input.touchKeepOut() : null;
      const A = CS.Audio;
      if (A && A.listener) {
        A.listener.pos[0] = eye[0]; A.listener.pos[1] = eye[1]; A.listener.pos[2] = eye[2];
        A.listener.yaw = yaw;
      }
      if (this.renderer) {
        const c = this._cam || (this._cam = { pos: this.eye, yaw: 0, pitch: 0, fov: 78, shake: 0 });
        c.pos = eye; c.yaw = yaw; c.pitch = pitch;
        c.fov = sp ? (CS.Settings.fov || 78) : fov; c.shake = sp ? 0 : this.shake;
        this.renderer.begin(c);
      }
    }

    /* ストックがなくなったあと 見ている なかま（いなければ null） */
    _spectateTarget() {
      const me = this.players[this.me];
      if (!me || !me.out || me.alive) { this.specIdx = -1; return null; }
      const any = !!me.spec;       // v5.1: トーナメントの かんせん: どちらの チームの人でも 見る
      let p = this.players[this.specIdx];
      if (!p || !p.alive || !p.connected || (!any && p.team !== me.team) || p === me || p.spec) {
        this.specIdx = -1; p = null;
        for (const q of this.players) {
          if (q !== me && q.alive && q.connected && (any || q.team === me.team) && inPlay(q)) { this.specIdx = q.idx; p = q; break; }
        }
      }
      return p;
    }

    /* ボットのねらいの向き（カメラ・音・描画はさわらない） */
    _botAim() {
      const me = this.players[this.me];
      const cp = Math.cos(me.pitch);
      this.aim[0] = -Math.sin(me.yaw) * cp; this.aim[1] = Math.sin(me.pitch); this.aim[2] = -Math.cos(me.yaw) * cp;
      this.shake *= 0.9;
    }

    /* スライディングをやめる（すべっていたときだけ呼ぶ）。終わってから少しのあいだは出せない */
    _endSlide() {
      this.slideT = 0;
      this.slideCd = SLIDE.cooldown;
    }

    /* 被弾の箱（立方体の中心 x,z はそのまま）。スライディング中は足もとを残して低くなる。
       結果 {cy: 箱の中心の高さ, hh: 高さの半分} は使い回し */
    /* CS2: よこの 大きさの 半分（ボスは 大きい） */
    _hx(q) { return q.big > 0 ? q.big : PLAYER.half; }

    _hurt(q) {
      const hb = this._hb, full = PLAYER.half;
      /* CS2: ボスレイドの ボス（大きな 箱。中心は rpos） */
      if (q.big > 0) { hb.cy = q.rpos[1]; hb.hh = q.bigH > 0 ? q.bigH : q.big; return hb; }
      const k = q.slideK > 0 ? (q.slideK < 1 ? q.slideK : 1) : 0;
      const hh = full + (SLIDE.hurtHeight * 0.5 - full) * k;
      hb.cy = q.rpos[1] - full + hh;
      hb.hh = hh;
      return hb;
    }

    /* ==================================================================
       3. Weapons / Combat
       ================================================================== */
    /* 弾のひろがり（度）。歩いても・走っても・ジャンプ中でも同じ（ぶれない）。のぞくと小さくなる */
    _spreadDeg(g) {
      return this.adsT > 0.5 ? (g.adsSpread || 0) : (g.spread || 0);
    }

    _updateWeapon(dt, inp) {
      const me = this.players[this.me];
      if (!me) return;
      const g = me.gun, w = this.gunState;
      const act = me.alive && this.phase === 'live' && !this.paused;

      if (w.cool > 0) w.cool -= dt;
      if (w.reloadT >= 0) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) { w.reloadT = -1; w.ammo = g.mag; }
      }

      /* ADS */
      const canAds = g.zoom > 0 && g.zoom < 1;
      const wantAds = act && inp.ads && canAds && w.reloadT < 0;
      this.adsT += ((wantAds ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
      if (this.adsT < 0.001) this.adsT = 0;
      if (!this._bot) {
        CS.Input.setAdsScale(this.adsT > 0.3 ? (0.45 + 0.55 * (g.zoom || 1)) : 1);
        /* タッチの「うつ」ボタン: スコープの銃は 押して のぞき・はなして うつ／ほかは 長押しで のぞく */
        if (CS.Input.setGunMode) CS.Input.setGunMode(!!SCOPED[g.id]);
      }

      /* 回転（ミニガン） */
      if (g.spinup > 0) {
        const want = act && inp.fire && w.ammo > 0 && w.reloadT < 0;
        const rate = dt / g.spinup;
        w.spin = clamp(w.spin + (want ? rate : -rate * 0.85), 0, 1);
        w.spinAng += w.spin * 24 * dt;
        this._loop('spin', 'spin', w.spin > 0.02, { rate: w.spin, vol: 0.7 });
      }

      /* 入力バッファ（単発） */
      if (inp.firePressed) w.buf = SEMI_BUF;
      else if (w.buf > 0) w.buf -= dt;

      if (act && inp.reload && w.reloadT < 0 && w.ammo < g.mag && w.burstLeft === 0) this._startReload();

      me.ads = this.adsT > 0.5;
      me.reloading = w.reloadT >= 0;
      me.spinning = w.spin > 0.05 || w.charge >= 0;

      /* --- 種類ごとの発射 --- */
      if (g.type === 'flame') { this._tickFlame(dt, inp, act); this._tickBeamLoop(false); }
      else {
        this._loop('flame', 'flame', false);
        if (g.type === 'beam') this._tickBeam(dt, inp, act);
        else this._tickShots(dt, inp, act);
      }

      /* 撃ちきったら自動リロード */
      if (act && w.ammo <= 0 && w.reloadT < 0 && (inp.fire || inp.firePressed)) this._startReload();

      /* ビューモデル */
      this.vm.flash = Math.max(0, this.vm.flash - dt * 9);
      this.vm.recoil = Math.max(0, this.vm.recoil - dt * 5.5);
      this.vm.reload = w.reloadT >= 0 ? clamp(1 - w.reloadT / (w.reloadDur || 1), 0, 1) : -1;
      this.vm.ads = this.adsT;
      this.vm.spin = w.spinAng;
      this.vm.charge = w.charge >= 0 ? clamp(w.charge, 0, 1) : 0;
      this.vm.side = w.side;
      me.flash = this.vm.flash;
      me.spin = w.spinAng;
      me.charge = w.charge >= 0 ? clamp(w.charge, 0, 1) : 0;
      me.side = w.side;
      me.firing = act && inp.fire && w.ammo > 0 && w.reloadT < 0 && (g.type === 'beam' || g.type === 'flame' ? true : this.vm.flash > 0.2);
    }

    _tickShots(dt, inp, act) {
      const me = this.players[this.me], g = me.gun, w = this.gunState;
      /* バースト継続 */
      if (w.burstLeft > 0) {
        if (w.cool <= 0) {
          if (w.ammo > 0) {
            this._fireOnce(g);
            w.burstLeft--;
            w.cool += 60 / (g.burst ? g.burst.rpm : g.rpm);
            if (w.burstLeft === 0) w.cool = 60 / g.rpm;
          } else { w.burstLeft = 0; this._startReload(); }
        }
        return;
      }
      if (!act) { if (w.charge >= 0) w.charge = -1; return; }

      /* チャージ銃は「押しっぱなし」でためる（単発でも押しっぱなしを見る） */
      if (g.charge > 0) {
        const hold = !!inp.fire || w.buf > 0;
        if (hold && w.ammo > 0 && w.reloadT < 0 && w.cool <= 0) {
          if (w.charge < 0) { w.charge = 0; this._sfx('charge'); }
          w.charge += dt / g.charge;
          if (w.charge >= 1) { this._fireOnce(g); w.charge = -1; w.cool = 60 / g.rpm; w.buf = 0; }
        } else if (w.charge >= 0) w.charge = -1;
        if (hold && w.ammo <= 0 && w.reloadT < 0) this._emptyClick();
        return;
      }

      /* 連射銃: おしっぱなし。1フレームより 短い クリック（押して すぐ はなす）でも 1発は 出す */
      const held = g.auto ? (inp.fire || inp.firePressed) : (w.buf > 0);

      if (!held) return;
      if (w.reloadT >= 0) return;
      if (w.ammo <= 0) { this._emptyClick(); return; }
      if (g.spinup > 0 && w.spin < 0.999) return;
      if (w.cool > 0) return;

      if (g.burst) {
        w.burstLeft = g.burst.n;
        w.buf = 0;
        w.cool = 0;
        this._tickShots(0, inp, act);
        return;
      }
      /* v5: ギガバースト: HP が たりないと 撃てない */
      if (g.hpCost > 0 && me.hp <= g.hpCost) { w.buf = 0; this._hpShort(g); return; }
      let shots = 0;
      const iv = 60 / g.rpm;
      while (w.cool <= 0 && shots < 3 && w.ammo > 0) {
        this._fireOnce(g);
        w.cool += iv;
        shots++;
        if (!g.auto) break;
      }
      w.buf = 0;
      if (w.cool < 0) w.cool = 0;
    }

    _tickBeam(dt, inp, act) {
      const me = this.players[this.me], g = me.gun, w = this.gunState;
      const on = act && inp.fire && w.ammo > 0 && w.reloadT < 0;
      const iv = 60 / g.rpm;
      if (on) {
        if (!w.beamOn) { w.beamOn = true; w.beamT = iv; }   // 押した瞬間から出る
        w.beamT += dt;
        let n = 0;
        while (w.beamT >= iv && w.ammo > 0 && n < 4) { w.beamT -= iv; this._fireOnce(g); n++; }
        this._drawBeamNow(g);
      } else {
        w.beamOn = false;
        w.beamT = 0;
        this.beam = null;
        if (act && inp.fire && w.ammo <= 0 && w.reloadT < 0) this._emptyClick();
      }
      this._tickBeamLoop(on);
    }

    _tickBeamLoop(on) { this._loop('beam', 'beam', !!on, { vol: 0.8, rate: 1 }); }

    _drawBeamNow(g) {
      const rc = this.world.raycast(this.eye, this.aim, g.range || 40, this._rc);
      const t = rc ? rc.t : (g.range || 40);
      const muz = this._ownMuzzle(g);
      this.beam = {
        a: [muz[0], muz[1], muz[2]],
        b: [this.eye[0] + this.aim[0] * t, this.eye[1] + this.aim[1] * t, this.eye[2] + this.aim[2] * t],
        c: g.tracer, w: (g.beam && g.beam.width) || 0.06
      };
    }

    _tickFlame(dt, inp, act) {
      const me = this.players[this.me], g = me.gun, w = this.gunState;
      const on = act && inp.fire && w.ammo > 0 && w.reloadT < 0;
      const iv = 1 / (g.flame.tick || 12);
      if (on) {
        if (!w.flameOn) { w.flameOn = true; w.flameT = iv; }   // 押した瞬間から出る
        w.flameT += dt;
        let n = 0;
        while (w.flameT >= iv && w.ammo > 0 && n < 4) {
          w.flameT -= iv;
          w.ammo--;
          this._flameTick(g);
          n++;
        }
        this._flameFx(g, dt);
        if (w.ammo <= 0) this._startReload();
      } else { w.flameOn = false; w.flameT = 0; }
      this._loop('flame', 'flame', on, { vol: 0.8 });
    }

    _emptyClick() {
      if (this.time - this._emptyT < 0.35) return;
      this._emptyT = this.time;
      this._sfx('empty');
    }

    _startReload() {
      const me = this.players[this.me], g = me.gun, w = this.gunState;
      if (w.reloadT >= 0 || w.ammo >= g.mag || !me.alive) return;
      w.reloadT = g.reload; w.reloadDur = g.reload;
      w.charge = -1; w.burstLeft = 0; w.buf = 0;
      this._sfx('reload');
    }

    _ownMuzzle(g) {
      if (this._bot) return this._remoteMuzzle(this._bot, this._muz);   // ボットは体の横の銃
      /* v5: せんしゃ（うしろから 見ている）: 大砲の 先から */
      if (this.tps) {
        const me = this.players[this.me];
        this._muz[0] = me.pos[0] + this.aim[0] * 1.25;
        this._muz[1] = me.pos[1] + 0.34 + this.aim[1] * 1.25;
        this._muz[2] = me.pos[2] + this.aim[2] * 1.25;
        return this._muz;
      }
      if (this.renderer && this.renderer.muzzleWorld) {
        return this.renderer.muzzleWorld(g, this.vm, this._muz);
      }
      this._muz[0] = this.eye[0] + this.aim[0] * 0.4;
      this._muz[1] = this.eye[1] + this.aim[1] * 0.4;
      this._muz[2] = this.eye[2] + this.aim[2] * 0.4;
      return this._muz;
    }

    /* 1発撃つ（hitscan / projectile / beam） */
    _fireOnce(g) {
      const me = this.players[this.me], w = this.gunState;
      w.ammo--;
      if (g.muzzle2) { w.side = w.side ? 0 : 1; this.vm.side = w.side; me.side = w.side; }
      this.vm.flash = 1; me.flash = 1;
      this.vm.recoil = Math.min(1, this.vm.recoil + (g.type === 'beam' ? 0.15 : 0.7));
      const rk = g.recoil || [0.5, 0.2];
      const adsK = 1 - 0.35 * this.adsT;
      this.recPitch += rk[0] * D2R * adsK;
      this.recYaw += (rnd() - 0.5) * 2 * rk[1] * D2R * adsK;
      this.shake = Math.min(1, this.shake + Math.min(0.35, rk[0] * 0.02));
      if (g.type !== 'beam') this._sfx(g.sfx);
      /* 無敵は撃った時点で解除（見た目もすぐ） */
      if (me.protect) { me.protect = false; this.protectT = 0; }
      me.safeUntil = 0;

      if (g.type === 'projectile') this._spawnOwnProj(g);
      else this._hitscan(g);
      /* v5: ギガバースト: 撃った人の HP を つかう（ホストが へらす） */
      if (g.hpCost > 0) this._toHost({ t: 'hit', i: this.me, w: g.id, cost: 1, hits: [] });
    }

    /* v5: HP が たりなくて 撃てない */
    _hpShort(g) {
      if (this._bot) return;
      if (this.time - (this._hpShortT || -9) < 1.2) return;
      this._hpShortT = this.time;
      this._emptyClick();
      CS.UI.hud.center('HPが たりない！（' + g.hpCost + 'より 多いと 撃てる）', '#ffb3c0', 1100);
    }

    _hitscan(g) {
      const me = this.players[this.me], w = this.gunState;
      const pellets = Math.max(1, g.pellets | 0);
      const sd = g.type === 'beam' ? 0 : this._spreadDeg(g);
      const range = g.range || 100;
      const muzA = this._ownMuzzle(g);
      const mx = muzA[0], my = muzA[1], mz = muzA[2];
      const ends = [];
      const acc = {};
      const eye = this.eye;
      let anyHit = false, anyHead = false;

      for (let i = 0; i < pellets; i++) {
        const dir = sd > 0 ? V.spread(this.aim, sd, rnd) : this.aim;
        const rc = this.world.raycast(eye, dir, range, this._rc);
        let wallT = rc ? rc.t : range;
        let endT = wallT, flag = rc ? 2 : 0;
        let nearest = -1, nearestT = wallT, nearestHead = false;

        for (let k = 0; k < this.players.length; k++) {
          const q = this.players[k];
          if (k === this.me || !q.alive || !q.connected || q.team === me.team) continue;
          const hb = this._hurt(q), hx = this._hx(q);
          const t = rayBox3(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], q.rpos[0], hb.cy, q.rpos[2],
            hx + 0.02, hb.hh + 0.02, hx + 0.02, wallT);
          if (t < 0) continue;
          const hy = eye[1] + dir[1] * t;
          const head = hy > hb.cy + hb.hh * (PLAYER.headZone / PLAYER.half);
          if (g.pierce) {
            this._addHit(acc, q, g, t, head);
            anyHit = true; if (head) anyHead = true;
          } else if (t < nearestT) { nearestT = t; nearest = k; nearestHead = head; }
        }
        if (!g.pierce && nearest >= 0) {
          this._addHit(acc, this.players[nearest], g, nearestT, nearestHead);
          anyHit = true; if (nearestHead) anyHead = true;
          endT = nearestT; flag = 1;
        }

        /* ためし撃ち・塔のぼりの的（こわせるのは じぶんだけ。ボットの弾は通りぬける） */
        if (this.targets.length && (this.defense ? !!this._bot : !this._bot)) {
          const tg = this._rayTargets(eye, dir, g.pierce ? wallT : Math.min(wallT, endT));
          if (tg.i >= 0) {
            const head = eye[1] + dir[1] * tg.t > this.targets[tg.i].pos[1] + PLAYER.headZone;
            const dist = tg.t;
            const dmg = g.dmg * falloff(g.falloff, dist) * (head ? (g.hs || 1) : 1);
            this._damageTarget(this.targets[tg.i], dmg, head);
            anyHit = true; if (head) anyHead = true;
            if (!g.pierce) { endT = tg.t; flag = 1; }
          }
        }

        const ex = eye[0] + dir[0] * endT, ey = eye[1] + dir[1] * endT, ez = eye[2] + dir[2] * endT;
        if (ends.length < 12) ends.push([r2(ex), r2(ey), r2(ez), flag]);
        if (flag === 2 && rc) this._sparks(ex, ey, ez, rc.n, g.tracer, 3);
        this._tracer(mx, my, mz, ex, ey, ez, g.tracer, g.tracerWidth || 0.03, g.type === 'beam' ? 0.06 : 0.09, g.type !== 'beam' && iceBar(me));
      }

      if (g.type !== 'beam') {
        this._sendOwner({ t: 'sh', i: this.me, w: g.id, o: [r2(mx), r2(my), r2(mz)], e: ends }, true);
      }
      this._claimHits(acc, g.id, 0, null, this.me, this._slotOf(this.me, g));
      if (anyHit) this._hitFeedback(anyHead);
    }

    _addHit(acc, q, g, dist, head) {
      const dmg = g.dmg * falloff(g.falloff, dist) * (head ? (g.hs || 1) : 1);
      const e = acc[q.idx] || (acc[q.idx] = { d: 0, h: 0 });
      e.d += dmg;
      if (head) e.h = 1;
    }

    /* at = ばくはつの場所（ボム用）。ホストはここからの距離で当たりを見る。
       owner = 撃った人（省略時は いま操作している人。自分の弾やボムが あとで当たったときは その持ち主） */
    _claimHits(acc, wName, burn, at, owner, slot, field) {
      const hits = [];
      for (const k in acc) {
        const e = acc[k];
        const kx = e.kx || 0, ky = e.ky || 0, kz = e.kz || 0;
        if (!(e.d > 0) && !kx && !ky && !kz) continue;
        hits.push([k | 0, e.d > 0 ? r2(e.d) : 0, e.h ? 1 : 0, r2(kx), r2(ky), r2(kz)]);
      }
      if (!hits.length) return;
      const m = { t: 'hit', i: owner === undefined ? this.me : owner, hits: hits, w: wName, burn: burn ? 1 : 0 };
      if (at) m.p = [r2(at[0]), r2(at[1]), r2(at[2])];
      if (slot >= 0) m.s = slot;                 // CS2: 何番目の 銃か（おなじ銃 2つで 部品が ちがう とき）
      if (field) m.f = 1;                         // CS2: ブラックホールの ダメージ（れんしゃチェックを かるく）
      this._toHost(m);
    }

    /* 当たった合図（自分が当てたときだけ。ボットの当たりでは出さない） */
    _hitFeedback(head, owner) {
      if (this._bot || (owner !== undefined && owner !== this.me)) return;
      CS.UI.hud.hit(!!head, false);
      this._sfx(head ? 'headshot' : 'hit');
    }

    _flameTick(g) {
      const me = this.players[this.me];
      const f = g.flame;
      const cone = Math.cos((f.cone || 14) * D2R);
      const acc = {};
      const c = this._hc;
      let any = false;
      for (let k = 0; k < this.players.length; k++) {
        const q = this.players[k];
        if (k === this.me || !q.alive || !q.connected || q.team === me.team) continue;
        const hb = this._hurt(q);
        c[0] = q.rpos[0]; c[1] = hb.cy; c[2] = q.rpos[2];
        const dx = c[0] - this.eye[0], dy = c[1] - this.eye[1], dz = c[2] - this.eye[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > f.range + this._hx(q) || d < 1e-4) continue;
        if ((dx * this.aim[0] + dy * this.aim[1] + dz * this.aim[2]) / d < cone && !(q.big > 0 && d < f.range)) continue;
        if (!this.world.lineClear(this.eye, c)) continue;
        acc[q.idx] = { d: g.dmg, h: 0 };
        any = true;
      }
      for (let i = 0; i < this.targets.length && (this.defense ? !!this._bot : !this._bot); i++) {
        const tg = this.targets[i];
        if (tg.dead) continue;
        const dx = tg.pos[0] - this.eye[0], dy = tg.pos[1] - this.eye[1], dz = tg.pos[2] - this.eye[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > f.range + PLAYER.half || d < 1e-4) continue;
        if ((dx * this.aim[0] + dy * this.aim[1] + dz * this.aim[2]) / d < cone) continue;
        if (!this.world.lineClear(this.eye, tg.pos)) continue;
        this._damageTarget(tg, g.dmg, false);
        any = true;
      }
      if (any) { this._claimHits(acc, g.id, 1, null, this.me, this._slotOf(this.me, g)); if (!this._bot) CS.UI.hud.hit(false, false); }
    }

    _flameFx(g, dt) {
      const muz = this._ownMuzzle(g);
      const n = Math.min(3, 1 + Math.floor(dt * 40));
      for (let i = 0; i < n; i++) {
        const d = V.spread(this.aim, 9, rnd);
        const sp = 9 + rnd() * 5;
        this._addPart(muz[0], muz[1], muz[2], d[0] * sp, d[1] * sp + 0.6, d[2] * sp,
          0.22 + rnd() * 0.2, 1, 0.55 + rnd() * 0.3, 0.18, 0.18 + rnd() * 0.14, -1.5, 3.2, 0);
      }
    }

    /* 相手の炎（見た目だけ） */
    _remoteFlameFx(p, dt) {
      const m = this._remoteMuzzle(p, this._tp2);
      const dir = V.forward(p.ryaw, p.rpitch);
      for (let i = 0; i < 2; i++) {
        const d = V.spread(dir, 10, rnd);
        const sp = 9 + rnd() * 5;
        this._addPart(m[0], m[1], m[2], d[0] * sp, d[1] * sp + 0.6, d[2] * sp,
          0.22 + rnd() * 0.18, 1, 0.55, 0.18, 0.2, -1.5, 3.2, 0);
      }
    }

    /* 相手（とボット）の体の横に浮いている銃の銃口。スライディング中は低くなる（render の銃と同じ高さ） */
    _remoteMuzzle(p, out) {
      const rt = V.right(p.ryaw), fw = V.forward(p.ryaw, p.rpitch);
      const side = PLAYER.half + 0.3;
      const hb = this._hurt(p);
      out[0] = p.rpos[0] + rt[0] * side + fw[0] * 0.45;
      out[1] = hb.cy + 0.06 + fw[1] * 0.45;
      out[2] = p.rpos[2] + rt[2] * side + fw[2] * 0.45;
      return out;
    }

    /* ==================================================================
       3b. 必殺技（v4）
       ゲージ（p.sp）は ホストが キルで ふやし、kill / hs で みんなへ。つかうと {t:'spc'} → ホストが たしかめて
       {t:'spc', i, k, d} を みんなへ。こうかは それぞれの端末で（銃の もちかえ・バリア・ボムラッシュ）。
       ================================================================== */
    /* ゲージを ふやす（つかっている間は ふえない）。ふえたら true */
    _addSp(p, g) {
      if (!p || !(g > 0) || p.spK) return false;
      const was = p.sp || 0;
      p.sp = Math.min(1, was + g);
      return p.sp !== was;
    }

    /* 1キルで ふえる量（塔のぼりの てきは ボスだけ） */
    _spGainFor(a) {
      const S = CS.Specials;
      if (!S || !a) return 0;
      if (this.tower) {
        if (a.npc) return a.boss ? S.GAIN_BOSS : 0;
        return S.GAIN_TOWER * (a.spMul || 1);
      }
      return S.GAIN * (a.spMul || 1);
    }

    /* その人の「操作する人の持ち物」（gunState など）の入れもの。この端末で動かしていない人は null */
    _spState(p) {
      if (this._bot) {
        if (p === this._bot) return this;
        if (p.idx === this._bot.bot.saveMe) return this._bot.bot.ctx;
        return p.bot ? p.bot.ctx : null;
      }
      if (p.idx === this.me) return this;
      return p.bot && this.hostBots ? p.bot.ctx : null;
    }

    /* スナイパーマシンガン（塔のぼりの なかまは チップの パワーアップ入り。弾は むげん） */
    /* v5: kind = 'smg'（スナイパーマシンガン）/ 'tank'（せんしゃの 大砲） */
    _spGun(p, kind) {
      const S = CS.Specials;
      const base = (S.GUNS && S.GUNS[kind]) || S.GUN;
      let g = base;
      if (this.tower && this.tower.mods && !p.npc && CS.Tower && CS.Tower.modGun) {
        g = CS.Tower.modGun(base, this.tower.mods);
        g.mag = base.mag;
      }
      return g;
    }

    /* 必殺技を つかう（いま操作している人。ゲージ まんたん・生きている・しあい中） */
    _trySpecial(kind) {
      const me = this.players[this.me];
      if (!me || !me.alive || me.spK || !(me.sp >= 0.999)) return false;
      if (this.phase !== 'live' || this.paused) return false;
      const S = CS.Specials && CS.Specials.get(kind);
      if (!S) return false;
      /* v5.1: コピーの いれものが ない（塔のぼり・ためし撃ち）ときは つかえない（ゲージは のこる） */
      if (S.id === 'clone' && !this._cloneOf(me)) {
        if (!this._bot && this.time - (this._noCloneT || -9) > 1.5) { this._noCloneT = this.time; CS.UI.hud.center('ここでは コピーは つかえない', '#ffb3c0', 1200); }
        return false;
      }
      this._toHost({ t: 'spc', i: this.me, k: S.id });
      return true;
    }

    /* ホスト: ゲージを たしかめて みんなへ */
    _hostSpecial(msg, fromId) {
      if ((this.mode !== 'match' && this.mode !== 'practice') || this.phase !== 'live') return;
      const idx = this._idxOf(fromId);
      const p = this.players[idx];
      if (!p || !p.alive || !p.connected || (msg.i | 0) !== idx || p.spK) return;
      const S = CS.Specials && CS.Specials.get(msg.k);
      if (!S || !(p.sp >= 0.999)) return;
      p.sp = 0;
      this._broadcast({ t: 'spc', i: idx, k: S.id, d: S.dur });
    }

    /* みんなが受け取る: 必殺技 はじまり */
    _onSpecial(m) {
      const p = this.players[m.i | 0];
      const S = CS.Specials && CS.Specials.get(m.k);
      if (!p || !S || !p.alive || (this.mode !== 'match' && this.mode !== 'practice')) return;
      if (p.spK) this._endSpecial(p);
      const dur = clamp(num(m.d) || S.dur, 1, 15);
      p.sp = 0; p.spK = S.id; p.spT0 = this.time; p.spEnd = this.time + dur; p.spDur = dur;
      if (S.id === 'smg' || S.id === 'tank') {
        p.spBase = p.gun;
        p.spGun = this._spGun(p, S.id);
        p.gun = p.spGun;
        const st = this._spState(p);
        if (st) {
          p.spSave = st.gunState;
          st.gunState = this._newGunState(p.gun);
          if (st === this && CS.Input.setGunMode) CS.Input.setGunMode(false);
        }
      } else if (S.id === 'shield') {
        p.shield = true;
        p.hp = p.maxHp || RULES.hp;
      } else if (S.id === 'bubble') {
        /* v5: うかびはじめ（この端末が 動かしている人だけ。ほかの人は 位置が とどく） */
        if (this._spState(p)) { p.vel[1] = Math.max(p.vel[1], BUBBLE_RISE); p.grounded = false; }
      } else if (S.id === 'clone' && this.isHost) {
        /* v5.1: コピー（ホストが となりに 出す。みんなには spawn で とどく） */
        this._hostCloneUp(p, dur);
      } else if (S.id === 'icefield') {
        /* v5.2: アイスフィールド: あいての チームが すべる（つかった人が やられても 時間まで つづく） */
        const ot = 1 - p.team;
        this.iceUntil[ot] = Math.max(this.iceUntil[ot], this.time + dur);
      }
      const me = this.players[this.me];
      const mine = p.idx === this.me;
      this._sfx('special', mine ? null : p.rpos);
      if (mine) { CS.Specials.banner(S.id, ''); this.shake = Math.min(1, this.shake + 0.3); }
      else if (me && p.team === me.team) CS.Specials.banner(S.id, p.name + ' の 必殺技');
      else CS.UI.hud.center(p.name + ' の ' + S.name + '！', '#ffb3c0', 1300);
      const c = spColor(S.id);
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2;
        this._addPart(p.rpos[0], p.rpos[1], p.rpos[2], Math.cos(a) * 5, 2 + rnd() * 3, Math.sin(a) * 5,
          0.14 + rnd() * 0.08, c[0], c[1], c[2], 0.6 + rnd() * 0.3, 3, 1.8, 0);
      }
    }

    /* v5: みんなが受け取る: 必殺技が とちゅうで おわった（バブルが われた） */
    _onSpecialCancel(m) {
      const p = this.players[m.i | 0];
      if (!p || !p.spK || p.spK !== m.k) return;
      this._endSpecial(p);
      if (m.k === 'bubble') {
        const c = p.rpos;
        for (let i = 0; i < 20; i++) {
          const d = V.norm([rnd() - 0.5, rnd() - 0.3, rnd() - 0.5]);
          this._addPart(c[0] + d[0] * 0.9, c[1] + d[1] * 0.9, c[2] + d[2] * 0.9, d[0] * 3, d[1] * 3, d[2] * 3,
            0.08 + rnd() * 0.06, 0.7, 0.95, 1, 0.45, 4, 1.4, 0);
        }
        this._sfx('bounce', p.idx === this.me ? null : c, 0.9);
        if (p.idx === this.me) CS.UI.hud.center('バブルが われた！', '#8fe3ff', 1100);
      }
    }

    /* 必殺技 おわり（時間ぎれ・たおれた・しあいが おわった） */
    _endSpecial(p) {
      if (!p || !p.spK) return;
      const k = p.spK;
      p.spK = null;
      if (k === 'smg' || k === 'tank') {
        if (p.spBase) p.gun = p.spBase;
        const st = this._spState(p);
        if (st) st.gunState = p.spSave || this._newGunState(p.gun);
        p.spSave = null; p.spBase = null;
        p.spGrace = this.time + 0.6;          // ホスト: おくれて届く 当たりも すこし うけつける
        if (st === this && CS.Input.setGunMode) CS.Input.setGunMode(!!SCOPED[p.gun.id]);
      } else if (k === 'shield') p.shield = false;
    }

    /* 時間ぎれを見る・見た目（ほかの人の まわりに 光） */
    _tickSpecials(dt) {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        /* v5: こうげき力ダウン中の人の まわりに むらさきの つぶ */
        if (p.weakUntil > this.time && p.alive && i !== this.me && rnd() < dt * 12) {
          this._addPart(p.rpos[0] + (rnd() - 0.5) * 0.9, p.rpos[1] + 0.2 + rnd() * 0.5, p.rpos[2] + (rnd() - 0.5) * 0.9,
            0, -0.6, 0, 0.08 + rnd() * 0.05, 0.72, 0.42, 1.0, 0.6, 0, 1.2, 0);
        }
        /* CS2: スロー・ガード・パワー・スピード の 光 */
        if (p.fx && p.alive && i !== this.me && rnd() < dt * 10) {
          const f = p.fx, t = this.time;
          const k = f.guard > t ? 'guard' : f.pow > t ? 'pow' : f.spd > t ? 'spd' : f.slow > t ? 'slow' : '';
          if (k) {
            const C = { guard: [0.45, 0.8, 1], pow: [1, 0.45, 0.35], spd: [1, 0.95, 0.35], slow: [0.75, 0.9, 1] }[k];
            this._addPart(p.rpos[0] + (rnd() - 0.5) * 0.9, p.rpos[1] - 0.3 + rnd() * 0.6, p.rpos[2] + (rnd() - 0.5) * 0.9, 0, 0.9, 0, 0.08 + rnd() * 0.05, C[0], C[1], C[2], 0.6, 0, 1.2, 0);
          }
        }
        if (!p.spK) continue;
        if (this.time >= p.spEnd || !p.connected) { this._endSpecial(p); continue; }
        if (!p.alive || i === this.me || rnd() > dt * 22) continue;
        const c = spColor(p.spK);
        const a = rnd() * Math.PI * 2, r = 0.65;
        this._addPart(p.rpos[0] + Math.cos(a) * r, p.rpos[1] - 0.3 + rnd() * 0.8, p.rpos[2] + Math.sin(a) * r,
          0, 1.2 + rnd(), 0, 0.09 + rnd() * 0.06, c[0], c[1], c[2], 0.5, 0, 1.5, 0);
      }
    }

    /* コンピューター: まんたんで 撃っているときに つかう（塔のぼりは ボスだけ・逃げるだけ は つかわない）。
       スナイパーマシンガンは 当たれば 一発なので コンピューターは つかわない（バリアか ボムラッシュ） */
    _botCanSpecial(p) {
      return !!(p.bot && p.bot.level !== 'flee' && (!this.tower || p.boss));
    }
    _botSpecialKind(p) {
      const smoke = p.bomb && p.bomb.effect === 'smoke';
      /* v5: せんしゃも つかう（バブルは うかぶ うごきが できないので つかわない） */
      const ks = smoke || p.boss ? ['shield'] : ['shield', 'rush', 'tank', 'icefield'];     // v5.2: アイスフィールドも
      return ks[p.idx % ks.length];
    }

    /* ==================================================================
       4. Projectiles & Bombs
       ================================================================== */
    _spawnOwnProj(g) {
      const me = this.players[this.me];
      const sd = this._spreadDeg(g);
      const muz = this._ownMuzzle(g);
      const pr = g.proj;
      const n = Math.max(1, g.pellets | 0);
      const id = this.me * 100000 + (this.projSeq % 99000);
      this.projSeq += n;
      const sp = pr.speed;
      /* 銃口（ビューモデル）は目より 1m ほど前・下にあるので、足もとを撃つと床の中に入る。
         床の中から出た弾は その場でばくはつして だれにも当たらない（ロケットジャンプもノーダメージ）。
         → 目から銃口までに壁・床があれば、その手前から出す（見た目の銃口はそのまま） */
      /* ボットは 目の前（ねらいの線の上）から出す。体の横（0.8m 右）の銃から まっすぐ出すと、
         ねらった所の 0.8m 横を とおって当たらない・物かげから のぞいているとき 横の銃の前の かべに当たる */
      if (this._bot) {
        muz[0] = this.eye[0] + this.aim[0] * 0.55; muz[1] = this.eye[1] + this.aim[1] * 0.55; muz[2] = this.eye[2] + this.aim[2] * 0.55;
      }
      const o = this._safeSpawn(muz, pr.size || 0.1);
      /* CS2: まっすぐ とぶ弾は「目から見た ねらいの点」へ 銃口から むける（照準の まんなかに 当たる） */
      const conv = !this._bot && !(pr.grav > 0) && !(pr.homing > 0);
      const slot = me.guns ? me.guns.indexOf(g) : -1;
      const vs = [];
      let v0 = null;
      for (let k = 0; k < n; k++) {
        let dir = sd > 0 ? V.spread(this.aim, sd, rnd) : this.aim;
        if (conv) {
          const range = g.range || 100;
          const rc = this.world.raycast(this.eye, dir, range, this._rc);
          let t = rc ? rc.t : range;
          const hit = this._segPlayer(this.eye, dir[0], dir[1], dir[2], t, this.me, true);
          if (hit) t = hit.t;
          if (t > 1.2) {
            const tx = this.eye[0] + dir[0] * t - o[0], ty = this.eye[1] + dir[1] * t - o[1], tz = this.eye[2] + dir[2] * t - o[2];
            const tl = Math.hypot(tx, ty, tz) || 1;
            dir = [tx / tl, ty / tl, tz / tl];
          }
        }
        const v = [dir[0] * sp + me.vel[0] * 0.2, dir[1] * sp + me.vel[1] * 0.2, dir[2] * sp + me.vel[2] * 0.2];
        this._addProj(this.me, id + k, g, o, v);
        const rv = [r2(v[0]), r2(v[1]), r2(v[2])];
        if (k === 0) v0 = rv; else vs.push(rv);
      }
      const m = { t: 'pj', i: this.me, id: id, g: g.id, o: [r2(o[0]), r2(o[1]), r2(o[2])], v: v0, ts: Math.round(CS.now()) };
      if (vs.length) m.vs = vs;
      if (slot >= 0) m.s = slot;
      /* 速い弾は 見た目だけ（当たりは 撃った人が きめる）なので とどかなくても よい */
      if (pr.fast) m.u = 1;
      this._sendOwner(m, !!pr.fast);
    }

    /* 目 → 銃口 のあいだで、かべ・床に入らない最後の点（新しい配列） */
    _safeSpawn(muz, size) {
      const e = this.eye, w = this.world;
      const dx = muz[0] - e[0], dy = muz[1] - e[1], dz = muz[2] - e[2];
      const d = Math.hypot(dx, dy, dz);
      if (!w || d < 1e-4) return [muz[0], muz[1], muz[2]];
      const dir = this._dir;
      dir[0] = dx / d; dir[1] = dy / d; dir[2] = dz / d;
      const rc = w.raycast(e, dir, d + size * 0.5, this._rc);
      let t = d;
      if (rc) t = Math.max(0, rc.t - size);
      const o = [e[0] + dir[0] * t, e[1] + dir[1] * t, e[2] + dir[2] * t];
      if (w.solidAt(o[0], o[1], o[2])) { o[0] = e[0]; o[1] = e[1]; o[2] = e[2]; }
      return o;
    }

    /* ばくはつの中心が かべ・床の中なら、すぐ外へ出した点（lineClear がいつも失敗しないように） */
    _unbury(pos) {
      const w = this.world;
      if (!w || !w.solidAt(pos[0], pos[1], pos[2])) return pos;
      const out = this._ub || (this._ub = [0, 0, 0]);
      for (let s = 0; s < UNBURY_STEPS.length; s++) {
        const k = UNBURY_STEPS[s];
        for (let i = 0; i < UNBURY_DIRS.length; i++) {
          const n = UNBURY_DIRS[i];
          out[0] = pos[0] + n[0] * k; out[1] = pos[1] + n[1] * k; out[2] = pos[2] + n[2] * k;
          if (!w.solidAt(out[0], out[1], out[2])) return out;
        }
      }
      return pos;
    }

    _addProj(owner, id, g, o, v) {
      const pr = g.proj;
      /* 他人の弾は上限つき（送りつけられても重くならない）。いちばん古い「他人の弾」から消す */
      if (owner !== this.me && this.projectiles.length >= MAX_FOREIGN_PROJ) this._dropOldestForeign(this.projectiles);
      const p = {
        id: id, owner: owner, gun: g, pr: pr, mine: this._isAuth(owner),
        pos: [o[0], o[1], o[2]], vel: [v[0], v[1], v[2]], prev: [o[0], o[1], o[2]],
        age: 0, fuse: pr.fuse || 0, bounces: 0, dead: false, hidden: false, waitT: -1,
        dist: 0, maxDist: (g.range || 120) + 12,
        hitSet: null, back: false, child: false            // CS2: つらぬいた人・ブーメランの もどり・はなびの 子
      };
      this.projectiles.push(p);
      return p;
    }

    /* 的（ためし撃ち・塔のぼり）をこわせる持ち主か（ボットの弾・ボムは的に当たらない） */
    _canHitTargets(owner) {
      const p = this.players[owner];
      /* v5: クリスタルまもり: まもる クリスタルは てき（コンピューター）の こうげきだけが 当たる */
      if (this.defense) return !!(p && p.bot);
      return !p || !p.bot;
    }

    /* この端末が当たり判定をする持ち主か（自分。コンピューターを動かす端末なら ボットも） */
    _isAuth(owner) {
      if (owner === this.me) return true;
      if (!this.hostBots) return false;
      const p = this.players[owner];
      return !!(p && p.bot);
    }

    _dropOldestForeign(list) {
      for (let i = 0; i < list.length; i++) {
        if (!list[i].mine) { list.splice(i, 1); return; }
      }
    }

    /* CS2: 爆発・はなび・ブラックホール・回復の ない 速い弾（ほかの人の 画面では じぶんで 止める。px を 送らない） */
    _plainFast(pr) { return !!(pr.fast && !(pr.radius > 0) && !pr.cluster && !pr.field && !(pr.healR > 0)); }

    _updateProjectiles(dt) {
      const list = this.projectiles;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        if (p.dead) { list.splice(i, 1); continue; }
        p.age += dt;
        if (p.waitT >= 0) {
          p.waitT -= dt;
          if (p.waitT <= 0) { this._projBoom(p, p.pos, false); list.splice(i, 1); }
          continue;
        }
        const pr = p.pr;
        /* ホーミング・ブーメラン */
        if (pr.homing > 0) this._homing(p, dt);
        if (pr.boomer > 0 && this._boomer(p, dt)) { list.splice(i, 1); continue; }
        if (pr.grav) p.vel[1] -= pr.grav * dt;
        /* 1回に すすむ きょり（まがる弾・はねる弾は こまかく。速い弾は 大きく） */
        const maxStep = (pr.homing > 0 || pr.boomer > 0 || pr.bounce > 0) ? 0.35 : 3;
        const enemyOnly = !(pr.heal > 0) && !pr.buff;
        const owner = this.players[p.owner];

        let remain = dt;
        let guard = 0;
        while (remain > 1e-5 && !p.dead && guard++ < 14) {
          const sp = Math.hypot(p.vel[0], p.vel[1], p.vel[2]);
          if (sp < 1e-4) break;
          const step = Math.min(remain, Math.max(0.0005, maxStep / sp));
          const dx = p.vel[0] * step, dy = p.vel[1] * step, dz = p.vel[2] * step;
          const len = Math.hypot(dx, dy, dz);
          const idx = 1 / (len || 1);
          p.prev[0] = p.pos[0]; p.prev[1] = p.pos[1]; p.prev[2] = p.pos[2];
          this._dir[0] = dx * idx; this._dir[1] = dy * idx; this._dir[2] = dz * idx;
          const reach = len + pr.size * 0.5;

          /* 相手・的（オーナーだけが判定） */
          if (p.mine && pr.contact) {
            const hit = this._segPlayer(p.prev, dx * idx, dy * idx, dz * idx, reach, p.owner, enemyOnly, p.hitSet, pr.hitR);
            let tg = -1, tgT = 0;
            if (this.targets.length && this._canHitTargets(p.owner)) {
              const r = this._rayTargets(p.prev, this._dir, hit ? hit.t : reach, p.tgSet);
              if (r.i >= 0) { tg = r.i; tgT = r.t; }
            }
            if (tg >= 0) {
              const hp = [p.prev[0] + dx * idx * tgT, p.prev[1] + dy * idx * tgT, p.prev[2] + dz * idx * tgT];
              this._damageTarget(this.targets[tg], p.gun.dmg * falloff(p.gun.falloff, p.dist + tgT), false);
              if (pr.pierce) { (p.tgSet || (p.tgSet = {}))[tg] = 1; this._hitFeedback(false, p.owner); }
              else { this._ownerDetonate(p, hp, null, true); break; }
            } else if (hit) {
              const hp = [p.prev[0] + dx * idx * hit.t, p.prev[1] + dy * idx * hit.t, p.prev[2] + dz * idx * hit.t];
              const ally = owner && hit.p.team === owner.team;
              if (ally) {
                /* 回復・サポートの 弾が みかたに 当たった */
                this._allyHit(p, hit.p, hp);
                if (pr.pierce) (p.hitSet || (p.hitSet = {}))[hit.p.idx] = 1;
                else { this._ownerDetonate(p, hp, null, false, true); break; }
              } else if (pr.pierce) {
                /* つらぬく弾: 当てて そのまま すすむ（1人に 1回） */
                (p.hitSet || (p.hitSet = {}))[hit.p.idx] = 1;
                const acc = {};
                this._addDirect(acc, p, hit, hp);
                this._claimHits(acc, p.gun.id, 0, null, p.owner, this._slotOf(p.owner, p.gun));
                this._hitFeedback(hit.head, p.owner);
              } else {
                this._ownerDetonate(p, hp, hit);
                break;
              }
            }
          } else if (!p.mine && pr.contact && pr.fast) {
            /* ほかの人の 速い弾: 見た目だけ 人で 止める（当たりは 撃った人が きめる） */
            const hit = this._segPlayer(p.prev, dx * idx, dy * idx, dz * idx, reach, p.owner, enemyOnly, p.hitSet, pr.hitR);
            if (hit) {
              const hp = [p.prev[0] + dx * idx * hit.t, p.prev[1] + dy * idx * hit.t, p.prev[2] + dz * idx * hit.t];
              if (pr.pierce) { (p.hitSet || (p.hitSet = {}))[hit.p.idx] = 1; this._hitFx(hp, hit.p.team); }
              else if (this._plainFast(pr)) { this._hitFx(hp, hit.p.team); p.dead = true; break; }
              else { p.pos[0] = hp[0]; p.pos[1] = hp[1]; p.pos[2] = hp[2]; this._foreignStop(p); break; }
            }
          }

          /* ブーメランの もどりは かべを すりぬける */
          const rc = p.back ? null : this.world.raycast(p.prev, this._dir, len + pr.size * 0.5, this._rc);
          if (rc) {
            const t = Math.max(0, rc.t - pr.size * 0.5);
            p.pos[0] = p.prev[0] + dx * idx * t;
            p.pos[1] = p.prev[1] + dy * idx * t;
            p.pos[2] = p.prev[2] + dz * idx * t;
            p.dist += t;
            /* ブーメラン: かべに 当たったら もどってくる */
            if (pr.boomer > 0) {
              const n = rc.n, d = p.vel[0] * n[0] + p.vel[1] * n[1] + p.vel[2] * n[2];
              p.vel[0] -= 2 * d * n[0]; p.vel[1] -= 2 * d * n[1]; p.vel[2] -= 2 * d * n[2];
              p.back = true; p.hitSet = null;
              this._sparks(p.pos[0], p.pos[1], p.pos[2], n, p.gun.tracer, 3);
              remain -= Math.max(step * (len > 1e-9 ? t / len : 1), step * 0.15);
              continue;
            }
            if (p.bounces < (pr.bounce || 0)) {
              p.bounces++;
              const n = rc.n;
              const d = p.vel[0] * n[0] + p.vel[1] * n[1] + p.vel[2] * n[2];
              p.vel[0] -= 2 * d * n[0]; p.vel[1] -= 2 * d * n[1]; p.vel[2] -= 2 * d * n[2];
              const dp = pr.bounceDamp > 0 ? pr.bounceDamp : 1;
              p.vel[0] *= dp; p.vel[1] *= dp; p.vel[2] *= dp;
              p.pos[0] += n[0] * 0.02; p.pos[1] += n[1] * 0.02; p.pos[2] += n[2] * 0.02;
              this._sfx(p.gun.id === 'ricochet' ? 'ricochet' : 'bounce', p.pos, pr.fast ? 0.35 : 0.7);
              this._sparks(p.pos[0], p.pos[1], p.pos[2], n, p.gun.tracer, 3);
              /* 進んだぶんだけ時間を消費（必ず少しは進める） */
              remain -= Math.max(step * (len > 1e-9 ? t / len : 1), step * 0.15);
              continue;
            }
            /* v5: かべを すりぬける弾（ホーミングニードル: 1回）。かべの むこうがわへ出す */
            if ((p.walls | 0) < (pr.wallPierce || 0)) {
              const ex = this._wallExit(p.pos, this._dir, WALL_PIERCE_MAX);
              if (ex) {
                p.walls = (p.walls | 0) + 1;
                this._sparks(p.pos[0], p.pos[1], p.pos[2], rc.n, p.gun.tracer, 2);
                p.dist += Math.hypot(ex[0] - p.pos[0], ex[1] - p.pos[1], ex[2] - p.pos[2]);
                p.pos[0] = ex[0]; p.pos[1] = ex[1]; p.pos[2] = ex[2];
                remain -= Math.max(step * (len > 1e-9 ? t / len : 1), step * 0.15);
                continue;
              }
            }
            if (p.mine) {
              if (this.castle && this._csRcVox) p.wv = this._csRcVox(rc);          // CS2: 城の ブロックに 当たった
              this._ownerDetonate(p, p.pos, null);
            } else if (this._plainFast(pr)) { this._sparks(p.pos[0], p.pos[1], p.pos[2], rc.n, p.gun.tracer, 3); p.dead = true; }
            else this._foreignStop(p);
            break;
          }
          p.pos[0] += dx; p.pos[1] += dy; p.pos[2] += dz;
          p.dist += len;
          remain -= step;
        }
        if (p.dead) { list.splice(i, 1); continue; }
        if (p.fuse > 0) {
          p.fuse -= dt;
          if (p.fuse <= 0) {
            if (p.mine) this._ownerDetonate(p, p.pos, null);
            else if (this._plainFast(pr)) p.dead = true;
            else this._foreignStop(p);
            if (p.dead) { list.splice(i, 1); continue; }
          }
        }
        if ((p.dist > p.maxDist && !(pr.boomer > 0)) || p.age > 8) {
          if (p.mine) this._ownerDetonate(p, p.pos, null);
          else { this._projBoom(p, p.pos, true); p.dead = true; }
          if (p.dead) { list.splice(i, 1); continue; }
        }
        /* しっぽ（ロケット・グレネード・プラズマ・大きな ふしぎな 弾） */
        if (!p.hidden && !pr.fast && (p.gun.id === 'rocket' || p.gun.id === 'grenade' || p.gun.id === 'plasma' || pr.size >= 0.15 || pr.radius > 0)) {
          this._addPart(p.pos[0], p.pos[1], p.pos[2], (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6 + 0.3, (rnd() - 0.5) * 0.6,
            0.12 + rnd() * 0.08, p.gun.tracer[0], p.gun.tracer[1], p.gun.tracer[2], 0.22, -0.4, 2.2, 0);
        }
      }
    }

    /* CS2: ブーメラン: もどる時間に なったら 持ち主へ。持ち主に とどいたら きえる（true） */
    _boomer(p, dt) {
      const pr = p.pr;
      if (!p.back && p.age >= pr.boomer) { p.back = true; p.hitSet = null; }
      if (!p.back) return false;
      const o = this.players[p.owner];
      if (!o || !o.alive) { p.dead = true; return true; }
      const tp = o.local ? o.pos : o.rpos;
      const tx = tp[0] - p.pos[0], ty = tp[1] + 0.1 - p.pos[1], tz = tp[2] - p.pos[2];
      const d = Math.hypot(tx, ty, tz);
      if (d < 1.0) { p.dead = true; return true; }
      const sp = Math.max(pr.speed * 1.15, Math.hypot(p.vel[0], p.vel[1], p.vel[2]));
      const k = Math.min(1, dt * 7);
      p.vel[0] += (tx / d * sp - p.vel[0]) * k; p.vel[1] += (ty / d * sp - p.vel[1]) * k; p.vel[2] += (tz / d * sp - p.vel[2]) * k;
      return false;
    }

    /* かべに 入った点 at から dir へ すすんで、かべの外に 出た点（新しい配列）。maxLen より あつい・地面の下 なら null */
    _wallExit(at, dir, maxLen) {
      const w = this.world;
      let inside = false;
      for (let s = 0.02; s <= maxLen; s += 0.08) {
        const x = at[0] + dir[0] * s, y = at[1] + dir[1] * s, z = at[2] + dir[2] * s;
        if (y < 0.05) return null;
        const solid = w.solidAt(x, y, z);
        if (!inside) { if (solid) inside = true; else if (s > 0.6) return null; continue; }
        if (!solid) {
          const e = s + 0.06;
          return [at[0] + dir[0] * e, at[1] + dir[1] * e, at[2] + dir[2] * e];
        }
      }
      return null;
    }

    _homing(p, dt) {
      const me = this.players[p.owner];
      if (!me) return;
      const cone = Math.cos((p.pr.homingCone || 30) * D2R);
      const sp = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1;
      const dx0 = p.vel[0] / sp, dy0 = p.vel[1] / sp, dz0 = p.vel[2] / sp;
      let best = null, bestD = 1e9;
      for (let k = 0; k < this.players.length; k++) {
        const q = this.players[k];
        if (k === p.owner || !q.alive || !q.connected || q.team === me.team) continue;
        const dx = q.rpos[0] - p.pos[0], dy = q.rpos[1] - p.pos[1], dz = q.rpos[2] - p.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.2 || d > 45) continue;
        if ((dx * dx0 + dy * dy0 + dz * dz0) / d < cone) continue;
        if (d < bestD) { bestD = d; best = q; }
      }
      for (let i = 0; i < this.targets.length && !best && this._canHitTargets(p.owner); i++) {
        const tg = this.targets[i];
        if (tg.dead) continue;
        const dx = tg.pos[0] - p.pos[0], dy = tg.pos[1] - p.pos[1], dz = tg.pos[2] - p.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.2 || d > 45) continue;
        if ((dx * dx0 + dy * dy0 + dz * dz0) / d < cone) continue;
        if (d < bestD) { bestD = d; best = tg; }
      }
      if (!best) return;
      const tp = best.rpos || best.pos;
      let tx = tp[0] - p.pos[0], ty = tp[1] - p.pos[1], tz = tp[2] - p.pos[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      const k = Math.min(1, p.pr.homing * dt);
      let nx = dx0 + (tx - dx0) * k, ny = dy0 + (ty - dy0) * k, nz = dz0 + (tz - dz0) * k;
      const nl = Math.hypot(nx, ny, nz) || 1;
      p.vel[0] = nx / nl * sp; p.vel[1] = ny / nl * sp; p.vel[2] = nz / nl * sp;
    }

    /* 線分と相手の当たり判定。skip = 当たらない人（{idx:1}）・extra = 当たりを 大きく（m） */
    _segPlayer(o, dx, dy, dz, len, ownerIdx, enemyOnly, skip, extra) {
      const owner = this.players[ownerIdx];
      const ex = 0.05 + (extra > 0 ? extra : 0);
      let best = null, bestT = len;
      for (let k = 0; k < this.players.length; k++) {
        const q = this.players[k];
        if (!q.alive || !q.connected) continue;
        if (k === ownerIdx) continue;
        if (enemyOnly && owner && q.team === owner.team) continue;
        if (skip && skip[k]) continue;
        const hb = this._hurt(q), hx = this._hx(q);
        const t = rayBox3(o[0], o[1], o[2], dx, dy, dz, q.rpos[0], hb.cy, q.rpos[2],
          hx + ex, hb.hh + ex, hx + ex, bestT);
        if (t < 0) continue;
        bestT = t;
        best = { p: q, t: t, head: (o[1] + dy * t) > hb.cy + hb.hh * (PLAYER.headZone / PLAYER.half) };
      }
      return best;
    }

    _rayTargets(o, d, maxT, skip) {
      let bi = -1, bt = maxT;
      for (let i = 0; i < this.targets.length; i++) {
        const tg = this.targets[i];
        if (tg.dead || (skip && skip[i])) continue;
        const t = rayBox(o[0], o[1], o[2], d[0], d[1], d[2], tg.pos[0], tg.pos[1], tg.pos[2], tg.half || 0.45, bt);
        if (t < 0) continue;
        bt = t; bi = i;
      }
      return { i: bi, t: bt };
    }

    /* CS2: 持ち主の 何番目の 銃か（ない なら -1） */
    _slotOf(ownerIdx, g) {
      const o = this.players[ownerIdx];
      return o && o.guns ? o.guns.indexOf(g) : -1;
    }

    /* CS2: 弾が てきに じかに 当たった ダメージ（きょりで へる）・ふきとばし・いなずま を acc に */
    _addDirect(acc, p, hit, pos) {
      const g = p.gun, pr = p.pr, q = hit.p;
      const e = acc[q.idx] || (acc[q.idx] = { d: 0, h: 0 });
      e.d += g.dmg * falloff(g.falloff, p.dist + (hit.t || 0)) * (hit.head ? (g.hs || 1) : 1);
      if (hit.head) e.h = 1;
      if (pr.knock > 0 || pr.knockUp > 0) {
        const sp = Math.hypot(p.vel[0], p.vel[2]) || 1;
        const kn = pr.knock || 0;
        e.kx = (e.kx || 0) + p.vel[0] / sp * kn;
        e.ky = (e.ky || 0) + (pr.knockUp || 0) + (kn > 0 ? 2 : 0);
        e.kz = (e.kz || 0) + p.vel[2] / sp * kn;
      }
      if (pr.chain) this._chain(acc, p, q, pos);
    }

    /* CS2: いなずま: 当たった人から ちかくの てきへ とびうつる（見た目は みんなへ 'sh'） */
    _chain(acc, p, first, pos) {
      const c = p.pr.chain, g = p.gun, owner = this.players[p.owner];
      const done = {}; done[first.idx] = 1;
      let from = [pos[0], pos[1], pos[2]];
      const ends = [], tp = [0, 0, 0];
      for (let k = 0; k < (c.n | 0); k++) {
        let best = null, bd = c.r || 6;
        for (const q of this.players) {
          if (!q.alive || !q.connected || done[q.idx] || q.idx === p.owner || (owner && q.team === owner.team) || !inPlay(q)) continue;
          const hb = this._hurt(q);
          tp[0] = q.rpos[0]; tp[1] = hb.cy; tp[2] = q.rpos[2];
          const d = V.dist(from, tp);
          if (d < bd && this.world.lineClear(from, tp)) { bd = d; best = q; }
        }
        if (!best) break;
        done[best.idx] = 1;
        const to = [best.rpos[0], this._hurt(best).cy, best.rpos[2]];
        const e = acc[best.idx] || (acc[best.idx] = { d: 0, h: 0 });
        e.d += g.dmg * (c.k || 0.5);
        this._tracer(from[0], from[1], from[2], to[0], to[1], to[2], g.tracer, 0.07, 0.22);
        this._hitFx(to, best.team);
        ends.push([r2(to[0]), r2(to[1]), r2(to[2]), 1]);
        from = to;
      }
      if (ends.length) this._sendOwner({ t: 'sh', i: p.owner, w: g.id, o: [r2(pos[0]), r2(pos[1]), r2(pos[2])], e: ends, z: 1 }, true);
    }

    /* CS2: 回復・サポートの 弾が みかたに 当たった（ホストへ） */
    _allyHit(p, q, at) {
      const pr = p.pr;
      const h = [[q.idx, pr.heal > 0 ? r2(pr.heal) : 0]];
      this._toHost({ t: 'hl', i: p.owner, w: p.gun.id, s: this._slotOf(p.owner, p.gun), h: h });
      this._healFx(at, pr.buff ? pr.buff.k : 'heal');
      if (!this._bot && p.owner === this.me) this._sfx('ok', null, 0.35);
    }
    /* CS2: ばくはつの はんいの みかたを 回復（じぶんも すこし） */
    _healSplash(p, pos) {
      const pr = p.pr, owner = this.players[p.owner];
      if (!owner) return;
      const h = [], c = this._hc;
      for (const q of this.players) {
        if (!q.alive || !q.connected || q.team !== owner.team || !inPlay(q)) continue;
        const hb = this._hurt(q);
        c[0] = q.rpos[0]; c[1] = hb.cy; c[2] = q.rpos[2];
        if (V.dist(c, pos) > pr.healR + PLAYER.half) continue;
        if (!this.world.lineClear(this._unbury(pos), c)) continue;
        h.push([q.idx, r2(q.idx === p.owner ? pr.heal * 0.5 : pr.heal)]);
        if (h.length >= 8) break;
      }
      if (h.length) this._toHost({ t: 'hl', i: p.owner, w: p.gun.id, s: this._slotOf(p.owner, p.gun), h: h });
      this._healFx(pos, 'heal', pr.healR);
    }
    /* 回復・サポートの 光（kind: heal / guard / pow / spd） */
    _healFx(pos, kind, r) {
      const C = { heal: [0.4, 1, 0.6], guard: [0.45, 0.8, 1], pow: [1, 0.45, 0.35], spd: [1, 0.95, 0.35], slow: [0.7, 0.9, 1] };
      const c = C[kind] || C.heal, n = r ? 22 : 10, rr = r || 0.6;
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        this._addPart(pos[0] + Math.cos(a) * rr * 0.5, pos[1], pos[2] + Math.sin(a) * rr * 0.5, Math.cos(a) * 1.5, 1.5 + rnd() * 1.5, Math.sin(a) * 1.5,
          0.1 + rnd() * 0.06, c[0], c[1], c[2], 0.6, 0, 1.6, 0);
      }
    }

    /* オーナーが弾を爆発/消滅させる（noDmg = みかたに 当たって 止まった 回復の 弾） */
    _ownerDetonate(p, at, hit, hitTarget, noDmg) {
      if (p.dead) return;
      p.dead = true;
      const pos = [at[0], at[1], at[2]];
      const pr = p.pr, g = p.gun;
      const acc = {};
      if (hit && hit.p && !noDmg) this._addDirect(acc, p, hit, pos);
      if (pr.radius > 0 && pr.splashDmg > 0) {
        this._splash(acc, pos, pr.radius, pr.splashDmg, pr.splashMin, projKnock(pr), pr.selfMult || 0, p.owner);
      }
      if (pr.healR > 0) this._healSplash(p, pos);
      if (hit && hit.p && !noDmg) this._hitFeedback(hit.head, p.owner);
      if (hitTarget) this._hitFeedback(false, p.owner);
      /* 的（ばくはつ） */
      if (pr.radius > 0 && pr.splashDmg > 0 && this.targets.length && this._canHitTargets(p.owner)) this._targetsAt(pos, pr.radius, pr.splashDmg, pr.splashMin);
      this._claimHits(acc, g.id, 0, null, p.owner, this._slotOf(p.owner, g));
      /* CS2: 城バトル: 城の ブロックへの ダメージ */
      if (this.castle && this._csWall) this._csWall(p, pos, hit, hitTarget);
      /* ふつうの 速い弾は ほかの人の 画面でも じぶんで 止まるので 知らせない */
      if (!this._plainFast(pr)) this._sendOwner({ t: 'px', i: p.owner, id: p.id, p: [r2(pos[0]), r2(pos[1]), r2(pos[2])] });
      this._projBoom(p, pos, false);
    }

    /* 自分のものではない弾が壁にぶつかった: px を 0.5 秒待つ */
    _foreignStop(p) {
      p.hidden = true;
      p.waitT = 0.5;
      p.vel[0] = p.vel[1] = p.vel[2] = 0;
    }

    _projBoom(p, pos, silent) {
      const pr = p.pr, g = p.gun;
      if (pr.radius > 0) {
        this._boom(pos, pr.radius, g.tracer, pr.radius >= 2);
        if (!silent) this._sfx(pr.radius >= 2 ? 'explode' : 'explode_small', pos);
        this._shakeAt(pos, pr.radius);
      } else if (pr.fast) {
        this._sparks(pos[0], pos[1], pos[2], null, g.tracer, 3);
      } else {
        this._sparks(pos[0], pos[1], pos[2], null, g.tracer, 5);
        if (!silent) this._sfx('hit', pos, 0.5);
      }
      /* 自分の爆風で自分を飛ばす（自分のクライアントが動きの権利を持つ。ボットの弾ならそのボット） */
      if (p.mine && pr.radius > 0) this._selfKnock(pos, pr.radius, projKnock(pr), p.owner);
      /* CS2: はなび: 子の弾が とびちる（みんな おなじ 種から おなじ ように） */
      if (pr.cluster && !p.child) this._clusterOut(p, pos);
      /* CS2: ブラックホール */
      if (pr.field && !p.child) this._fieldAt(p, pos);
    }

    /* CS2: はなびの 子の弾 */
    _clusterOut(p, pos) {
      const c = p.pr.cluster, g = p.gun;
      const cg = g._child || (g._child = Object.assign({}, g, {
        dmg: c.dmg || 0, pellets: 1,
        proj: CS.Weapons.P({ speed: c.speed || 8, grav: 12, size: 0.1, fuse: 0.7, radius: c.radius || 2, splashDmg: c.splash || 20, splashMin: 0.3, selfMult: p.pr.selfMult || 0 })
      }));
      const rg = CS.rng((Math.abs(p.id) * 2654435761) >>> 0);
      const COLS = [[1, 0.4, 0.7], [1, 0.9, 0.3], [0.4, 0.9, 1], [0.6, 1, 0.5], [1, 0.6, 0.25], [0.8, 0.5, 1]];
      for (let i = 0; i < (c.n | 0) && i < 12; i++) {
        const a = rg() * Math.PI * 2, e = 0.35 + rg() * 0.55, sp = (c.speed || 8) * (0.6 + rg() * 0.6);
        const v = [Math.cos(a) * sp * (1 - e * 0.5), sp * e + 2, Math.sin(a) * sp * (1 - e * 0.5)];
        const ch = this._addProj(p.owner, -(Math.abs(p.id) * 8 + i + 1), cg, [pos[0], pos[1] + 0.25, pos[2]], v);
        ch.child = true;
        ch.fuse = 0.5 + rg() * 0.45;
        const col = COLS[i % COLS.length];
        for (let k = 0; k < 3; k++) this._addPart(pos[0], pos[1], pos[2], v[0] * 0.6 + (rnd() - 0.5), v[1] * 0.6, v[2] * 0.6 + (rnd() - 0.5), 0.1, col[0], col[1], col[2], 0.6, 4, 1.2, 0);
      }
    }

    /* CS2: ブラックホール（すいこむのは その人を 動かしている 端末。ダメージは 撃った人の 端末） */
    _fieldAt(p, pos) {
      const f = p.pr.field;
      const owner = this.players[p.owner];
      if (this.fields.length >= 12) this.fields.shift();
      this.fields.push({
        pos: [pos[0], pos[1], pos[2]], r: f.r || 5, until: this.time + (f.dur || 3), dur: f.dur || 3, t0: this.time,
        pull: f.pull || 12, dps: f.dps || 15, tick: 0.2, owner: p.owner, team: owner ? owner.team : -1, gun: p.gun, mine: p.mine
      });
      this._sfx('portal', pos, 0.9);
    }

    _updateFields(dt) {
      const F = this.fields;
      for (let i = F.length - 1; i >= 0; i--) {
        const f = F[i];
        if (this.time >= f.until) { F.splice(i, 1); continue; }
        const k0 = Math.min(1, (this.time - f.t0) * 3);
        /* すいこむ（じぶんと この端末が 動かす コンピューター） */
        for (const q of this.players) {
          if (!q.alive || !q.connected || q.team === f.team || q.raidBoss) continue;
          if (!(q.local || (q.bot && this.hostBots))) continue;
          const dx = f.pos[0] - q.pos[0], dy = f.pos[1] - q.pos[1], dz = f.pos[2] - q.pos[2];
          const d = Math.hypot(dx, dy, dz);
          if (d > f.r || d < 0.3) continue;
          const k = f.pull * dt * k0 * (0.45 + 0.55 * (1 - d / f.r));
          q.vel[0] += dx / d * k; q.vel[1] += dy / d * k * 0.7 + (q.grounded ? 0 : 0); q.vel[2] += dz / d * k;
        }
        /* ダメージ（撃った人の 端末が 0.33秒ごとに） */
        if (f.mine && this.phase === 'live') {
          f.tick -= dt;
          if (f.tick <= 0) {
            f.tick = 0.33;
            const acc = {}, c = this._hc, dmg = f.dps * 0.33;
            for (const q of this.players) {
              if (!q.alive || !q.connected || q.team === f.team) continue;
              const hb = this._hurt(q);
              c[0] = q.rpos[0]; c[1] = hb.cy; c[2] = q.rpos[2];
              const d = V.dist(c, f.pos);
              if (d > f.r + this._hx(q)) continue;
              const e = acc[q.idx] || (acc[q.idx] = { d: 0, h: 0 });
              e.d += dmg * (0.5 + 0.5 * clamp(1 - d / f.r, 0, 1));
            }
            if (this.targets.length && this._canHitTargets(f.owner)) this._targetsAt(f.pos, f.r, dmg, 0.5);
            this._claimHits(acc, f.gun.id, 0, f.pos, f.owner, this._slotOf(f.owner, f.gun), true);
          }
        }
        /* 見た目: まわる つぶ */
        if (rnd() < dt * 50) {
          const a = rnd() * Math.PI * 2, rr = f.r * (0.6 + rnd() * 0.4), yy = (rnd() - 0.5) * f.r * 0.8;
          const px = f.pos[0] + Math.cos(a) * rr, pz = f.pos[2] + Math.sin(a) * rr, py = f.pos[1] + yy;
          const sp = 2.5;
          this._addPart(px, py, pz, (f.pos[0] - px) * sp + Math.sin(a) * 3, (f.pos[1] - py) * sp, (f.pos[2] - pz) * sp - Math.cos(a) * 3,
            0.09 + rnd() * 0.07, 0.62, 0.35, 1.0, 0.4, 0, 0, 0);
        }
      }
    }


    _shakeAt(pos, radius) {
      if (this._bot) return;
      const d = V.dist(this.eye, pos);
      const k = clamp(1 - d / (radius * 3 + 6), 0, 1);
      this.shake = Math.min(1, this.shake + k * 0.8);
    }

    /* 持ち主（ownerIdx、省略時は操作している人）を自分の爆風で飛ばす */
    _selfKnock(pos, radius, knock, ownerIdx) {
      if (!knock) return;
      const me = this.players[ownerIdx === undefined ? this.me : ownerIdx];
      if (!me || !me.alive) return;
      const dx = me.pos[0] - pos[0], dy = me.pos[1] - pos[1], dz = me.pos[2] - pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > radius + PLAYER.half) return;
      const k = clamp(1 - d / (radius + PLAYER.half), 0, 1);
      this._applyKnock(me, dx, dy, dz, d, knock * k);
    }

    _applyKnock(p, dx, dy, dz, d, power) {
      if (!(power > 0)) return;
      let nx, ny, nz;
      if (d < 0.05) { nx = 0; ny = 1; nz = 0; }
      else { nx = dx / d; ny = dy / d; nz = dz / d; if (ny < 0.35) ny = 0.35; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const s = Math.min(18, power);
      p.vel[0] += nx / l * s;
      p.vel[1] += ny / l * s;
      p.vel[2] += nz / l * s;
      if (p.vel[1] > 16) p.vel[1] = 16;
    }

    /* ばくはつの範囲ダメージ（オーナー側） */
    _splash(acc, pos, radius, dmg, minMult, knock, selfMult, ownerIdx) {
      const owner = this.players[ownerIdx];
      /* 床すれすれ（すねに当たった など）で中心が床の中だと、lineClear が必ず失敗してしまう */
      pos = this._unbury(pos);
      const c = this._hc;
      for (let k = 0; k < this.players.length; k++) {
        const q = this.players[k];
        if (!q.alive || !q.connected) continue;
        const hb = this._hurt(q);                     // スライディング中は低い所が中心
        c[0] = q.rpos[0]; c[1] = hb.cy; c[2] = q.rpos[2];
        const dx = c[0] - pos[0], dy = c[1] - pos[1], dz = c[2] - pos[2];
        const d = Math.hypot(dx, dy, dz), hx = this._hx(q);
        if (d > radius + hx) continue;
        if (!this.world.lineClear(pos, c) && !(q.big > 0)) continue;
        const f = clamp(1 - Math.max(0, d - hx) / radius, 0, 1);
        const mult = minMult + (1 - minMult) * f;
        const isSelf = k === ownerIdx;
        const friendly = owner && !isSelf && q.team === owner.team;
        let dv = 0;
        if (isSelf) dv = dmg * mult * (selfMult || 0);
        else if (!friendly) dv = dmg * mult;
        if (dv > 0) {
          const e = acc[q.idx] || (acc[q.idx] = { d: 0, h: 0 });
          e.d += dv;
        }
        if (knock > 0) {
          if (isSelf) continue;        // 自分は _selfKnock 側で即時に
          if (!friendly || knock >= 10) {
            const e = acc[q.idx] || (acc[q.idx] = { d: 0, h: 0 });
            let nx = dx, ny = dy, nz = dz;
            if (d < 0.05) { nx = 0; ny = 1; nz = 0; }
            const l = Math.hypot(nx, ny, nz) || 1;
            const s = Math.min(18, knock * f);
            e.kx = (e.kx || 0) + nx / l * s;
            e.ky = (e.ky || 0) + Math.max(ny / l, 0.35) * s;
            e.kz = (e.kz || 0) + nz / l * s;
          }
        }
      }
    }

    _targetsAt(pos, radius, dmg, minMult) {
      if (!this.targets.length) return;
      minMult = minMult == null ? 0.2 : minMult;
      pos = this._unbury(pos);
      for (let i = 0; i < this.targets.length; i++) {
        const tg = this.targets[i];
        if (tg.dead) continue;
        const d = V.dist(tg.pos, pos), th = tg.half || 0.45;
        if (d > radius + th) continue;
        if (!this.world.lineClear(pos, tg.pos)) continue;
        const f = clamp(1 - Math.max(0, d - th) / Math.max(0.2, radius), 0, 1);
        this._damageTarget(tg, dmg * (minMult + (1 - minMult) * f), false);
      }
    }

    /* ---- ボム ---- */
    _throwBomb() {
      const me = this.players[this.me];
      if (!me || !me.alive || this.phase !== 'live') return;
      const st = this.bombState;
      if (st.charges <= 0) { this._emptyClick(); return; }
      const b = me.bomb;
      st.charges--;
      if (st.charges < st.max && st.t <= 0) st.t = st.cd;
      const dir = V.norm([this.aim[0], this.aim[1] + 0.13, this.aim[2]]);
      const o = [this.eye[0] + dir[0] * 0.45, this.eye[1] + dir[1] * 0.45, this.eye[2] + dir[2] * 0.45];
      const v = [dir[0] * b.throwSpeed + me.vel[0], dir[1] * b.throwSpeed + me.vel[1] * 0.4, dir[2] * b.throwSpeed + me.vel[2]];
      const id = this.me * 100000 + (this.bombSeq++);
      this._addBomb(this.me, id, b, o, v, null);
      this._sendOwner({
        t: 'bt', i: this.me, id: id, b: b.id,
        o: [r2(o[0]), r2(o[1]), r2(o[2])], v: [r2(v[0]), r2(v[1]), r2(v[2])]
      });
      this._sfx('throw');
      if (me.protect) { me.protect = false; this.protectT = 0; }
      me.safeUntil = 0;
    }

    _addBomb(owner, id, def, o, v, mini) {
      if (owner !== this.me && this.bombs.length >= MAX_FOREIGN_BOMBS) this._dropOldestForeign(this.bombs);
      this.bombs.push({
        id: id, owner: owner, def: def, mini: !!mini, mine: this._isAuth(owner),
        pos: [o[0], o[1], o[2]], vel: [v[0], v[1], v[2]], prev: [o[0], o[1], o[2]],
        fuse: mini ? mini.fuse : (def.fuse || 0), impact: (def.fuse || 0) <= 0 && !mini,
        bounces: 0, stuck: false, stuckTo: -1, soff: [0, 0, 0], age: 0, dead: false, waitT: -1,
        radius: mini ? mini.radius : def.radius, dmg: mini ? mini.dmg : def.dmg
      });
    }

    _updateBombs(dt) {
      const list = this.bombs;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (b.dead) { list.splice(i, 1); continue; }
        b.age += dt;
        if (b.waitT >= 0) {
          b.waitT -= dt;
          if (b.waitT <= 0) { this._bombBoom(b, b.pos, false); list.splice(i, 1); }
          continue;
        }
        if (b.stuck) {
          if (b.stuckTo >= 0) {
            const q = this.players[b.stuckTo];
            if (q) { b.pos[0] = q.rpos[0] + b.soff[0]; b.pos[1] = q.rpos[1] + b.soff[1]; b.pos[2] = q.rpos[2] + b.soff[2]; }
          }
        } else {
          b.vel[1] -= (b.def.grav || 18) * dt;
          let remain = dt, guard = 0;
          while (remain > 1e-5 && !b.dead && guard++ < 5) {
            const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
            if (sp < 1e-4) break;
            const step = Math.min(remain, Math.max(0.0005, 0.3 / sp));
            const dx = b.vel[0] * step, dy = b.vel[1] * step, dz = b.vel[2] * step;
            const len = Math.hypot(dx, dy, dz), inv = 1 / (len || 1);
            b.prev[0] = b.pos[0]; b.prev[1] = b.pos[1]; b.prev[2] = b.pos[2];
            this._dir[0] = dx * inv; this._dir[1] = dy * inv; this._dir[2] = dz * inv;

            if (b.mine && (b.def.sticky || b.impact) && b.age > 0.05) {
              const hit = this._segPlayer(b.prev, dx * inv, dy * inv, dz * inv, len + b.def.size, b.owner, true);
              if (hit) {
                const hp = [b.prev[0] + dx * inv * hit.t, b.prev[1] + dy * inv * hit.t, b.prev[2] + dz * inv * hit.t];
                if (b.def.sticky) {
                  b.stuck = true; b.stuckTo = hit.p.idx;
                  b.soff[0] = hp[0] - hit.p.rpos[0]; b.soff[1] = hp[1] - hit.p.rpos[1]; b.soff[2] = hp[2] - hit.p.rpos[2];
                  b.pos[0] = hp[0]; b.pos[1] = hp[1]; b.pos[2] = hp[2];
                  this._sfx('stick', hp);
                  this._sendOwner({ t: 'bs', i: b.owner, id: b.id, s: hit.p.idx, p: [r2(hp[0]), r2(hp[1]), r2(hp[2])] });
                } else {
                  this._ownerBombBoom(b, hp);
                }
                break;
              }
            }

            const rc = this.world.raycast(b.prev, this._dir, len + b.def.size * 0.5, this._rc);
            if (rc) {
              const t = Math.max(0, rc.t - b.def.size * 0.5);
              b.pos[0] = b.prev[0] + dx * inv * t;
              b.pos[1] = b.prev[1] + dy * inv * t;
              b.pos[2] = b.prev[2] + dz * inv * t;
              if (b.def.sticky) {
                b.stuck = true; b.stuckTo = -1;
                b.vel[0] = b.vel[1] = b.vel[2] = 0;
                this._sfx('stick', b.pos);
                if (b.mine) this._sendOwner({ t: 'bs', i: b.owner, id: b.id, s: -1, p: [r2(b.pos[0]), r2(b.pos[1]), r2(b.pos[2])] });
                break;
              }
              if (b.impact) {
                if (b.mine) this._ownerBombBoom(b, b.pos); else this._foreignBombStop(b);
                break;
              }
              if (b.bounces < (b.def.bounce || 0)) {
                b.bounces++;
                const n = rc.n;
                const d = b.vel[0] * n[0] + b.vel[1] * n[1] + b.vel[2] * n[2];
                b.vel[0] -= 2 * d * n[0]; b.vel[1] -= 2 * d * n[1]; b.vel[2] -= 2 * d * n[2];
                const dp = b.def.bounceDamp > 0 ? b.def.bounceDamp : 0.4;
                b.vel[0] *= dp; b.vel[1] *= dp; b.vel[2] *= dp;
                b.pos[0] += n[0] * 0.02; b.pos[1] += n[1] * 0.02; b.pos[2] += n[2] * 0.02;
                if (Math.abs(d) > 1.5) this._sfx('bounce', b.pos, 0.6);
              } else {
                b.vel[0] *= 0.4; b.vel[2] *= 0.4; b.vel[1] = 0;
                b.pos[0] += rc.n[0] * 0.02; b.pos[1] += rc.n[1] * 0.02; b.pos[2] += rc.n[2] * 0.02;
              }
              remain -= step;
              continue;
            }
            b.pos[0] += dx; b.pos[1] += dy; b.pos[2] += dz;
            remain -= step;
          }
        }
        if (b.dead) { list.splice(i, 1); continue; }
        if (!b.impact) {
          b.fuse -= dt;
          if (b.fuse <= 0) {
            if (b.mine) this._ownerBombBoom(b, b.pos); else this._foreignBombStop(b);
            if (b.dead) { list.splice(i, 1); continue; }
          }
        } else if (b.age > 6) {
          if (b.mine) this._ownerBombBoom(b, b.pos); else { this._bombBoom(b, b.pos, true); b.dead = true; }
          if (b.dead) { list.splice(i, 1); continue; }
        }
      }
    }

    _foreignBombStop(b) { b.waitT = 0.5; b.vel[0] = b.vel[1] = b.vel[2] = 0; }

    _ownerBombBoom(b, at) {
      if (b.dead) return;
      b.dead = true;
      const pos = [at[0], at[1], at[2]];
      const def = b.def;
      const wName = 'bomb:' + def.id;
      const acc = {};
      const radius = b.radius, dmg = b.dmg;
      /* v5: ワープボム: 投げた人が おちた場所へ（ダメージなし） */
      if (def.effect === 'warp') {
        const who = this.players[b.owner];
        if (who && who.alive && this.phase === 'live') {
          const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
          const dir = sp > 0.01 ? [b.vel[0] / sp, b.vel[1] / sp, b.vel[2] / sp] : null;
          if (!this._warpPlayer(who, pos, dir) && who.idx === this.me && !this._bot) CS.UI.hud.center('そこには ワープできない', '#bfe8ff', 900);
        }
      }
      /* インパルスは自分にダメージなし（ふっとばしだけ） */
      const selfMult = def.effect === 'knock' ? 0 : 0.5;
      if (radius > 0 && dmg > 0) {
        this._splash(acc, pos, radius, dmg, def.minMult || 0.2, def.knock || 0, selfMult, b.owner);
        if (this._canHitTargets(b.owner)) this._targetsAt(pos, radius, dmg, def.minMult || 0.2);
      } else if (def.effect === 'knock' && radius > 0) {
        this._splash(acc, pos, radius, 0, 0, def.knock || 0, 0, b.owner);
      }
      this._claimHits(acc, wName, 0, pos, b.owner);
      if (this.castle && this._csBlast && radius > 0 && dmg > 0) this._csBlast(b.owner, pos, radius, dmg, def.minMult || 0.2);     // CS2: 城バトル
      this._sendOwner({ t: 'bx', i: b.owner, id: b.id, p: [r2(pos[0]), r2(pos[1]), r2(pos[2])] });
      this._bombBoom(b, pos, false);
    }

    /* 見た目 + 効果（すべてのクライアント） */
    _bombBoom(b, pos, silent) {
      const def = b.def;
      if (def.effect === 'smoke' && def.smoke && !b.mini) {
        this.smokes.push({ pos: [pos[0], pos[1], pos[2]], r: def.smoke.radius, t: 0, dur: def.smoke.dur });
        if (!silent) this._sfx('smoke', pos);
        for (let i = 0; i < 14; i++) {
          const d = V.norm([rnd() - 0.5, rnd() * 0.6, rnd() - 0.5]);
          this._addPart(pos[0], pos[1], pos[2], d[0] * 3, d[1] * 2.4, d[2] * 3, 0.5, 0.6, 0.63, 0.7, 1.4, -0.6, 1.4, 0);
        }
        return;
      }
      /* v5: ワープボム: 光の つぶだけ（ばくはつしない） */
      if (def.effect === 'warp') {
        this._warpFx(pos);
        if (!silent) this._sfx('spawn', pos, 0.8);
        return;
      }
      const radius = b.radius || def.radius || 2;
      this._boom(pos, radius, def.color, radius >= 2.5);
      if (!silent) this._sfx(def.sfx || 'explode', pos);
      this._shakeAt(pos, radius);
      if (b.mine) {
        const kn = def.effect === 'knock' ? (def.knock || 14) : (def.knock || 0) * 0.8;
        this._selfKnock(pos, radius, kn, b.owner);
      }
      /* クラスター: 決まった種から同じ位置に子を出す */
      if (def.effect === 'cluster' && def.cluster && !b.mini) {
        const rg = CS.rng((b.id * 2654435761) >>> 0);
        for (let i = 0; i < def.cluster.n; i++) {
          const a = rg() * Math.PI * 2, e = 0.45 + rg() * 0.5;
          const sp = 5 + rg() * 3;
          const o = [pos[0], pos[1] + 0.25, pos[2]];
          const v = [Math.cos(a) * sp * (1 - e * 0.5), sp * e + 2, Math.sin(a) * sp * (1 - e * 0.5)];
          const fuse = def.cluster.fuseMin + rg() * (def.cluster.fuseMax - def.cluster.fuseMin);
          /* 子爆弾の id は負の数（親の id とぶつからない別の番号空間） */
          this._addBomb(b.owner, -(Math.abs(b.id) * 8 + i + 1), def, o, v, { fuse: fuse, radius: def.cluster.radius, dmg: def.cluster.dmg });
        }
      }
    }

    /* ==================================================================
       5. Effects（粒・弾道・けむり）
       ================================================================== */
    _initFx() {
      this.parts = new Array(MAX_PARTS);
      for (let i = 0; i < MAX_PARTS; i++) {
        this.parts[i] = { life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.1, r: 1, g: 1, b: 1, grav: 0, drag: 0, coll: 0 };
      }
      this.partI = 0;
      this.tracers = new Array(MAX_TRACERS);
      for (let i = 0; i < MAX_TRACERS; i++) {
        this.tracers[i] = { life: 0, max: 1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 1, g: 1, b: 1, w: 0.03 };
      }
      this.tracerI = 0;
    }

    _addPart(x, y, z, vx, vy, vz, s, r, g, b, life, grav, drag, coll) {
      const p = this.parts[this.partI];
      this.partI = (this.partI + 1) % MAX_PARTS;
      p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
      p.s = s; p.r = r; p.g = g; p.b = b;
      p.life = life; p.max = life; p.grav = grav; p.drag = drag; p.coll = coll;
      return p;
    }

    /* ice = アイスバーの 弾（銃のスキン「アイスバー」）: 見えるように ゆっくり（45m/秒）とんで いく */
    _tracer(ax, ay, az, bx, by, bz, c, w, life, ice) {
      const t = this.tracers[this.tracerI];
      this.tracerI = (this.tracerI + 1) % MAX_TRACERS;
      t.ax = ax; t.ay = ay; t.az = az; t.bx = bx; t.by = by; t.bz = bz;
      t.r = c ? c[0] : 1; t.g = c ? c[1] : 0.9; t.b = c ? c[2] : 0.5;
      t.ice = !!ice;
      if (ice) life = clamp(Math.hypot(bx - ax, by - ay, bz - az) / 45, 0.12, 0.6);
      t.w = w; t.life = life; t.max = life;
    }

    /* v5.2: アイスバー（バニラの 本体・カリカリつぶ・木の 棒）。c = 先っぽ、d = とぶ 向き */
    _drawIceBar(r, c, dx, dy, dz, sc) {
      sc = sc || 1;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(clamp(dy, -1, 1));
      const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sp = Math.sin(pitch / 2), cp = Math.cos(pitch / 2);
      const q = this._ibq || (this._ibq = [0, 0, 0, 1]);
      q[0] = cy * sp; q[1] = sy * cp; q[2] = -sy * sp; q[3] = cy * cp;
      /* 横と 上の 向き（つぶを まわりに つける） */
      let rx = -dz, rz = dx;
      const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      const ux = -dy * rz, uy = dz * rx - dx * rz, uz = dy * rx;
      const o = this._oIceBar || (this._oIceBar = { emissive: 0.38, frame: 0.015 });
      const tp = this._ibp || (this._ibp = [0, 0, 0]);
      const at = (back, side, up) => {
        tp[0] = c[0] - dx * back + rx * side + ux * up;
        tp[1] = c[1] - dy * back + uy * up;
        tp[2] = c[2] - dz * back + rz * side + uz * up;
        return tp;
      };
      const CREAM = [1.0, 0.95, 0.8], CRUNCH = [0.9, 0.72, 0.46], WOOD = [0.8, 0.62, 0.4];
      for (let i = 0; i < 3; i++) r.cube(at((0.05 + i * 0.1) * sc, 0, 0), q, 0.13 * sc, CREAM, o);
      const bits = [[0.06, 0.07, 0.03], [0.15, -0.07, 0.04], [0.24, 0.05, -0.06], [0.11, -0.03, 0.075], [0.2, 0.02, 0.07], [0.27, -0.06, -0.02]];
      for (const b of bits) r.cube(at(b[0] * sc, b[1] * sc, b[2] * sc), q, 0.04 * sc, CRUNCH, o);
      r.cube(at(0.36 * sc, 0, 0), q, 0.05 * sc, WOOD, o);
      r.cube(at(0.42 * sc, 0, 0), q, 0.05 * sc, WOOD, o);
    }

    _sparks(x, y, z, n3, c, n) {
      const cr = c ? c[0] : 1, cg = c ? c[1] : 0.85, cb = c ? c[2] : 0.5;
      for (let i = 0; i < n; i++) {
        let dx = (rnd() - 0.5) * 2, dy = (rnd() - 0.5) * 2, dz = (rnd() - 0.5) * 2;
        if (n3) { dx += n3[0] * 1.4; dy += n3[1] * 1.4; dz += n3[2] * 1.4; }
        const sp = 2.5 + rnd() * 3.5;
        this._addPart(x + (n3 ? n3[0] * 0.02 : 0), y + (n3 ? n3[1] * 0.02 : 0), z + (n3 ? n3[2] * 0.02 : 0),
          dx * sp, dy * sp + 1, dz * sp, 0.05 + rnd() * 0.05, cr, cg, cb, 0.18 + rnd() * 0.16, 8, 1.2, 0);
      }
    }

    _boom(pos, radius, c, big) {
      const cr = c ? c[0] : 1, cg = c ? c[1] : 0.6, cb = c ? c[2] : 0.25;
      const n = big ? 22 : 12;
      for (let i = 0; i < n; i++) {
        const d = V.norm([rnd() - 0.5, rnd() - 0.3, rnd() - 0.5]);
        const sp = (2 + rnd() * 6) * (big ? 1.4 : 1);
        this._addPart(pos[0], pos[1], pos[2], d[0] * sp, d[1] * sp + 1.5, d[2] * sp,
          (big ? 0.2 : 0.13) + rnd() * 0.14, cr, cg * (0.7 + rnd() * 0.4), cb, 0.3 + rnd() * 0.35, 9, 1.6, 1);
      }
      for (let i = 0; i < (big ? 6 : 3); i++) {
        this._addPart(pos[0] + (rnd() - 0.5) * radius * 0.4, pos[1] + (rnd() - 0.5) * radius * 0.4, pos[2] + (rnd() - 0.5) * radius * 0.4,
          0, 0.6, 0, radius * (0.5 + rnd() * 0.5), 1, 0.95, 0.75, 0.16 + rnd() * 0.1, 0, 2, 0);
      }
    }

    _hitFx(pos, team) {
      const c = CS.TEAM_COLORS[team === 1 ? 1 : 0];
      for (let i = 0; i < 6; i++) {
        const d = V.norm([rnd() - 0.5, rnd() - 0.2, rnd() - 0.5]);
        this._addPart(pos[0], pos[1], pos[2], d[0] * 3, d[1] * 3 + 1.5, d[2] * 3,
          0.07 + rnd() * 0.06, c[0], c[1], c[2], 0.25, 9, 1.5, 0);
      }
    }

    _updateFx(dt) {
      const w = this.world;
      for (let i = 0; i < MAX_PARTS; i++) {
        const p = this.parts[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) continue;
        if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        if (p.grav) p.vy -= p.grav * dt;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        if (p.coll && w && w.solidAt(nx, ny, nz)) {
          p.vx *= -0.25; p.vy *= -0.25; p.vz *= -0.25;
          if (p.life > 0.2) p.life = 0.2;
        } else { p.x = nx; p.y = ny; p.z = nz; }
      }
      for (let i = 0; i < MAX_TRACERS; i++) {
        const t = this.tracers[i];
        if (t.life > 0) {
          t.life -= dt;
          /* v5.2: アイスバーが とどいた: カリカリの かけら */
          if (t.ice && t.life <= 0) {
            for (let k = 0; k < 6; k++) {
              this._addPart(t.bx, t.by, t.bz, (rnd() - 0.5) * 3, 1 + rnd() * 2, (rnd() - 0.5) * 3,
                0.04 + rnd() * 0.04, k % 2 ? 1.0 : 0.9, k % 2 ? 0.95 : 0.72, k % 2 ? 0.8 : 0.46, 0.5 + rnd() * 0.3, 9, 1, 1);
            }
          }
        }
      }
      for (let i = this.smokes.length - 1; i >= 0; i--) {
        const s = this.smokes[i];
        s.t += dt;
        if (s.t >= s.dur) this.smokes.splice(i, 1);
      }
      for (let i = this._dmgNums.length - 1; i >= 0; i--) {
        const d = this._dmgNums[i];
        d.t += dt;
        d.y += dt * 0.9;
        if (d.t > 1.1) this._dmgNums.splice(i, 1);
      }
    }

    _inSmoke(ax, ay, az, bx, by, bz) {
      for (let i = 0; i < this.smokes.length; i++) {
        const s = this.smokes[i];
        const grow = Math.min(1, s.t * 3) * Math.min(1, (s.dur - s.t) * 1.5 + 0.2);
        if (segSphere(ax, ay, az, bx, by, bz, s.pos[0], s.pos[1], s.pos[2], s.r * SMOKE_BLOCK * grow)) return true;
      }
      return false;
    }

    /* ==================================================================
       6. Remote players & interpolation
       ================================================================== */
    _recvPose(d) {
      const i = d[0] | 0;
      const p = this.players[i];
      if (!p || p.local) return;
      /* ふっかつ前に送られた位置は捨てる（spawn は信頼チャンネルなので先に届く。
         捨てないと、生き返った相手がたおれた場所に一瞬もどって見える） */
      if (d.length > 16 && (d[16] | 0) < (p.gen | 0)) return;
      /* 数でないもの（"NaN" や 1e999）は丸ごと捨てる。NaN が入ると補間位置がもどらなくなり、
         当たり判定（rayBox）が「どこを撃っても距離0で命中」になってしまう */
      if (d.length < 16) return;
      for (let k = 2; k < 15; k++) if (!isFinite(+d[k])) return;
      const ts = +d[2];
      if (ts <= p.lastTs && p.buf.length) return;    // 古いパケットは捨てる
      p.lastTs = ts;
      const now = CS.now();
      p.lastRecv = now;
      /* 時計のずれ（2秒の窓で最小値。下げは速く、上げはゆっくり） */
      const sample = now - ts;
      p.offs.push({ t: now, v: sample });
      while (p.offs.length && now - p.offs[0].t > 2000) p.offs.shift();
      let mn = Infinity;
      for (let k = 0; k < p.offs.length; k++) if (p.offs[k].v < mn) mn = p.offs[k].v;
      if (p.off === null) p.off = mn;
      else if (mn < p.off) p.off = mn;
      else p.off += (mn - p.off) * 0.03;
      const dev = Math.abs(sample - p.off);
      p.jitter += (dev - p.jitter) * 0.15;

      const s = {
        ts: ts, x: +d[3], y: +d[4], z: +d[5], yaw: +d[6], pitch: +d[7],
        vx: +d[8], vy: +d[9], vz: +d[10],
        qx: +d[11], qy: +d[12], qz: +d[13], qw: +d[14], flags: d[15] | 0
      };
      p.buf.push(s);
      if (p.buf.length > 40) p.buf.shift();
      p.grounded = !!(s.flags & 1);
      p.firing = !!(s.flags & 2);
      p.ads = !!(s.flags & 4);
      p.reloading = !!(s.flags & 8);
      p.spinning = !!(s.flags & 16);
      p.sliding = !!(s.flags & 32);
      p.lastReport[0] = s.x; p.lastReport[1] = s.y; p.lastReport[2] = s.z;
    }

    _interpolate(dt) {
      const now = CS.now();
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (p.local) continue;
        p.flash = Math.max(0, p.flash - dt * 7);
        p.hitFx = Math.max(0, p.hitFx - dt * 4);
        if (!p.connected) { p.fade = Math.max(0, p.fade - dt * 0.8); continue; }
        if (!p.buf.length) continue;
        /* スライディング（見た目と被弾の箱） */
        p.slideK += ((p.sliding && p.alive ? 1 : 0) - p.slideK) * Math.min(1, dt * 16);
        if (!p.sliding && p.slideK < 0.01) p.slideK = 0;
        const delay = clamp(33 + 2 * p.jitter, 50, 140);
        const rt = now - (p.off === null ? 0 : p.off) - delay;
        const buf = p.buf;
        let a = null, b = null;
        for (let k = buf.length - 1; k >= 0; k--) {
          if (buf[k].ts <= rt) { a = buf[k]; b = buf[k + 1] || null; break; }
        }
        let nx, ny, nz, nyaw, npitch;
        if (!a) {
          const f = buf[0];
          nx = f.x; ny = f.y; nz = f.z; nyaw = f.yaw; npitch = f.pitch;
          p.rquat[0] = f.qx; p.rquat[1] = f.qy; p.rquat[2] = f.qz; p.rquat[3] = f.qw;
        } else if (!b) {
          const e = Math.min(EXTRAP_MAX, Math.max(0, (rt - a.ts) / 1000));
          nx = a.x + a.vx * e; ny = a.y + a.vy * e; nz = a.z + a.vz * e;
          nyaw = a.yaw; npitch = a.pitch;
          p.rquat[0] = a.qx; p.rquat[1] = a.qy; p.rquat[2] = a.qz; p.rquat[3] = a.qw;
        } else {
          const span = b.ts - a.ts;
          const k = span > 0 ? clamp((rt - a.ts) / span, 0, 1) : 0;
          nx = a.x + (b.x - a.x) * k; ny = a.y + (b.y - a.y) * k; nz = a.z + (b.z - a.z) * k;
          nyaw = a.yaw + CS.wrapAngle(b.yaw - a.yaw) * k;
          npitch = a.pitch + (b.pitch - a.pitch) * k;
          const q = Q.slerp([a.qx, a.qy, a.qz, a.qw], [b.qx, b.qy, b.qz, b.qw], k);
          p.rquat[0] = q[0]; p.rquat[1] = q[1]; p.rquat[2] = q[2]; p.rquat[3] = q[3];
        }
        const err = Math.hypot(nx - p.rpos[0], ny - p.rpos[1], nz - p.rpos[2]);
        if (err > SNAP_DIST || !p.moved) {
          p.rpos[0] = nx; p.rpos[1] = ny; p.rpos[2] = nz; p.moved = true;
        } else {
          const s = Math.min(1, dt * 26);
          p.rpos[0] += (nx - p.rpos[0]) * s;
          p.rpos[1] += (ny - p.rpos[1]) * s;
          p.rpos[2] += (nz - p.rpos[2]) * s;
        }
        p.ryaw = nyaw; p.rpitch = npitch;
        p.pos[0] = p.rpos[0]; p.pos[1] = p.rpos[1]; p.pos[2] = p.rpos[2];
        p.yaw = nyaw; p.pitch = npitch;
        /* バッファの掃除 */
        while (buf.length > 2 && buf[1].ts < rt - 1000) buf.shift();

        /* 相手の連続音・炎 */
        if (p.alive && p.connected) {
          const g = p.gun;
          const key = 'p' + i;
          if (g.type === 'beam') {
            this._loop(key, 'beam', p.firing, { pos: p.rpos, vol: 0.7 });
            if (p.firing && p.flash < 0.55) p.flash = 0.55;    // ビームは sh を送らないので光らせる
          } else if (g.type === 'flame') {
            this._loop(key, 'flame', p.firing, { pos: p.rpos, vol: 0.7 });
            if (p.firing) { this._remoteFlameFx(p, dt); if (p.flash < 0.45) p.flash = 0.45; }
          } else if (g.spinup > 0) {
            this._loop(key, 'spin', p.spinning, { pos: p.rpos, rate: p.spinning ? 1 : 0, vol: 0.55 });
            if (p.spinning) p.spinAng += 24 * dt;
          } else this._loop(key, 'spin', false);
        } else this._loop('p' + i, 'spin', false);
      }
    }

    /* ==================================================================
       7. Host authority
       ================================================================== */
    _hostTick(dt) {
      if (!this.isHost) return;
      if (this.mode === 'lobby') {
        this.pingT += dt;
        if (this.pingT >= LOBBY_PING_DT) {
          this.pingT = 0;
          let changed = false;
          if (this.net && this.room) {
            for (const p of this.room.players) {
              if (p.id === 'host') continue;
              const v = this.net.rtt(p.id);
              const ms = isFinite(v) ? Math.round(v) : 0;
              if (Math.abs(ms - p.ping) > 4) { p.ping = ms; changed = true; }
            }
          }
          if (changed) this._broadcastLobby();
        }
        return;
      }
      if (this.mode !== 'match' && this.mode !== 'practice') return;
      const t = this.time;

      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.connected) continue;
        /* v5.1: コピーは 時間が きたら（持ち主が いなくなっても）きえる。ふっかつは しない */
        if (p.clone >= 0) {
          const o = this.players[p.clone];
          if (p.alive && (t >= p.cloneUntil || !o || !o.connected || this.phase === 'over')) this._broadcast({ t: 'cgo', i: p.idx });
          if (!p.alive) continue;
        }
        /* むてき（撃ったらその場で解除。pose の「撃ってる」ビットはビーム・炎もふくむ） */
        if (p.protectUntil > 0 && t >= p.protectUntil) { p.protectUntil = 0; p.protect = false; }
        if (p.protect && p.firing) { p.protect = false; p.protectUntil = 0; }
        if (p.firing) p.safeUntil = 0;                 // 撃ったら「出てきたばかり」も おわり
        if (!p.alive) {
          if (p.respawnAt > 0 && t >= p.respawnAt && this.phase === 'live') this._hostRespawn(p);
          continue;
        }
        if (this.net && !p.local) {
          const v = this.net.rtt(p.id);
          if (isFinite(v)) p.ping = Math.round(v);
        }
        /* やけど */
        if (p.burn) {
          if (t >= p.burn.until) p.burn = null;
          else {
            p.burn.acc += p.burn.dps * dt;
            if (p.burn.acc >= 1) {
              const d = Math.floor(p.burn.acc);
              p.burn.acc -= d;
              this._hostApplyDamage(p, d, this.players[p.burn.by] || null, 'burn', false, null, null);
            }
          }
        }
        /* 回復（塔のぼりのパワーアップで はやくなる） */
        const mh = p.maxHp || RULES.hp;
        if (p.alive && !p.noRegen && p.hp < mh && t - p.lastDmgT > (p.regenDelay || RULES.regenDelay)) {
          p.hp = Math.min(mh, p.hp + (p.regenRate || RULES.regenRate) * dt);
        }
        /* トークン（連射チェック） */
        p.tokens = Math.min(16, p.tokens + this._maxRateP(p) * RATE_MULT * dt);
        /* クラスターは親1＋子6で7通ぶん来るので、少し多めに持たせる（ボムラッシュ中は もっと） */
        p.bombTokens = Math.min(12, p.bombTokens + dt * (p.spK === 'rush' ? 7 : 2.5));
      }

      if (this.mode !== 'match') return;

      /* 塔のぼりは 階ごとの しごと（tower.js） */
      if (this.tower) {
        if (this._towerTick) this._towerTick(dt);
        this.statusT += dt;
        if (this.statusT >= STATUS_DT) { this.statusT = 0; this._hostStatus(); }
        return;
      }
      /* CS2: ボスレイドは ボスの しごと（raid.js） */
      if (this.raid) {
        if (this._raidTick) this._raidTick(dt);
        if (this.endAt >= 0 && t >= this.endAt) this.endAt = -1;
        this.statusT += dt;
        if (this.statusT >= STATUS_DT) { this.statusT = 0; this._hostStatus(); }
        return;
      }
      /* CS2: 城バトルは 城・基地・お金の しごと（castle.js）。時間ぎれも castle.js が きめる */
      if (this.castle) {
        if (this._csTick) this._csTick(dt);
        if (this.endAt >= 0 && t >= this.endAt) this.endAt = -1;
        this.statusT += dt;
        if (this.statusT >= STATUS_DT) { this.statusT = 0; this._hostStatus(); }
        return;
      }
      /* v5: クリスタルまもりは ウェーブの しごと（defense.js）。時間ぎれは ない */
      if (this.defense) {
        if (this._defTick) this._defTick(dt);
        if (this.endAt >= 0 && t >= this.endAt) this.endAt = -1;
        this.statusT += dt;
        if (this.statusT >= STATUS_DT) { this.statusT = 0; this._hostStatus(); }
        return;
      }

      if (this.phase === 'live') {
        this.matchTime += dt;
        this.timeLeft = Math.max(0, this.timeLimit - this.matchTime);
        if (this.zone) this._hostArea(dt);
        if (this.timeLeft <= 0 && !this.suddenDeath && this.endAt < 0 && this.rule.id === 'king') {
          /* v5: キングバトルの 時間ぎれ: キングの のこり HP の わりあいが 多いほうの 勝ち（おなじなら サドンデス） */
          const r0 = this._kingRatio(0), r1 = this._kingRatio(1);
          if (Math.abs(r0 - r1) < 0.005) { this.suddenDeath = true; this._broadcast({ t: 'sd' }); }
          else this._hostEnd(r0 > r1 ? 0 : 1);
        } else if (this.timeLeft <= 0 && !this.suddenDeath && this.endAt < 0) {
          if (this.score[0] === this.score[1]) {
            this.suddenDeath = true;
            this._broadcast({ t: 'sd' });
          } else {
            this._hostEnd(this.score[0] > this.score[1] ? 0 : 1);
          }
        }
      }

      if (this.endAt >= 0 && t >= this.endAt) {
        this.endAt = -1;
        let w = this.score[0] === this.score[1] ? -1 : (this.score[0] > this.score[1] ? 0 : 1);
        if (this.rule.id === 'king') w = this.kingWin;          // v5: キングを たおした チームの 勝ち
        this._sendEnd(w);
      }

      this.statusT += dt;
      if (this.statusT >= STATUS_DT) {
        this.statusT = 0;
        this._hostStatus();
      }
    }

    /* v5: 2つの銃の 速いほう（もちかえた すぐあとも 撃てるように） */
    _maxRateP(p) {
      let r = this._maxRate(p.gun);
      if (p.guns) for (const g of p.guns) r = Math.max(r, this._maxRate(g));
      return r;
    }

    _maxRate(g) {
      if (!g) return 10;
      if (g.type === 'flame') return (g.flame && g.flame.tick) || 12;
      return Math.max(1, (g.rpm || 60) / 60);
    }

    /* エリア: 片方のチームだけがエリアにいるあいだ、1秒に1カウント。両方いると とりあい（進まない） */
    _hostArea(dt) {
      const n = [0, 0];
      for (const p of this.players) if (p.alive && p.connected && this._inZone(p)) n[p.team]++;
      const owner = n[0] > 0 && n[1] === 0 ? 0 : (n[1] > 0 && n[0] === 0 ? 1 : -1);
      const fight = n[0] > 0 && n[1] > 0;
      if (owner !== this.zoneOwner || fight !== this.zoneFight) {
        this._broadcast({ t: 'zo', o: owner, f: fight ? 1 : 0 });     // _onZone が zoneOwner を書きかえる
        this.zoneOwner = owner; this.zoneFight = fight;
      }
      if (owner < 0 || this.endAt >= 0) return;
      this._areaAcc[owner] += dt;
      let got = false;
      while (this._areaAcc[owner] >= 1) { this._areaAcc[owner] -= 1; this.score[owner]++; got = true; }
      if (!got) return;
      this._hostStatus();
      if (this.score[owner] >= this.rule.n || (this.suddenDeath && this.score[0] !== this.score[1])) {
        this.endAt = this.time + END_DELAY;
      }
    }

    _hostStatus() {
      const hp = [], al = [], k = [], d = [], pr = [], sp = [];
      for (const p of this.players) {
        hp.push(Math.round(p.hp));
        al.push(p.alive ? 1 : 0);
        k.push(p.kills); d.push(p.deaths);
        pr.push(p.protect ? 1 : 0);
        sp.push(r2(p.sp || 0));
      }
      const m = { t: 'hs', hp: hp, al: al, sc: [this.score[0], this.score[1]], tl: Math.round(this.timeLeft), k: k, d: d, pr: pr, sp: sp };
      if (this.zone) { m.zo = this.zoneOwner; m.zf = this.zoneFight ? 1 : 0; }
      if (this.tower && this._towerStatus) this._towerStatus(m);
      if (this.defense && this._defStatus) this._defStatus(m);
      if (this.raid && this._raidStatus) this._raidStatus(m);
      if (this.castle && this._csStatus) this._csStatus(m);
      this._broadcast(m, true);
    }

    /* ---- hit 検算 ---- */
    _hostHit(msg, fromId) {
      if (this.mode !== 'match' && this.mode !== 'practice') return;
      if (this.phase !== 'live') return;
      const idx = fromId === 'host' ? this._idxOf('host') : this._idxOf(fromId);
      const a = this.players[idx];
      if (!a || !a.connected) return;
      if ((msg.i | 0) !== idx) return;
      if (!a.alive) return;
      const w = String(msg.w || '');
      let def = null, isBomb = false;
      if (w.indexOf('bomb:') === 0) { def = CS.BombMap[w.slice(5)]; isBomb = true; }
      else if (w === 'burn') def = null;
      else def = CS.GunMap[w];
      if (!def) return;
      if (isBomb) {
        if (def.id !== a.bomb.id) return;
        def = a.bomb;                         // 持っている定義そのもの（塔のぼりはパワーアップ入り）
      }
      /* CS2: 何番目の 銃か（おなじ銃 2つで 部品が ちがう とき） */
      else if (a.guns && msg.s !== undefined && a.guns[msg.s | 0] && a.guns[msg.s | 0].id === def.id) def = a.guns[msg.s | 0];
      else if (def.id === a.gun.id) def = a.gun;
      /* v5: 2つめの銃（もちかえ）・必殺技の まえに 持っていた銃 */
      else if (a.guns && a.guns[0] && def.id === a.guns[0].id) def = a.guns[0];
      else if (a.guns && a.guns[1] && def.id === a.guns[1].id) def = a.guns[1];
      else if (a.spBase && def.id === a.spBase.id) def = a.spBase;
      /* CS2: ボスレイドの ボスの こうげき */
      else if (a.raidBoss && def.raidBoss) def = def;
      /* v4: 必殺技の銃が おわった すぐあと（ゲストの時計は すこし おくれる）は まだ うけつける */
      else if (def.special && a.spGun && a.spGun.id === def.id && this.time < a.spGrace) def = a.spGun;
      else return;                            // 持ってない銃

      /* v5: ギガバースト: 撃った人の HP を つかう（じぶんだけ。連射チェックは しない） */
      if (msg.cost) {
        if (isBomb || !(def.hpCost > 0)) return;
        if (a.protect) { a.protect = false; a.protectUntil = 0; }
        a.safeUntil = 0;
        this._hostApplyDamage(a, def.hpCost, a, w, false, null, a.lastReport);
        return;
      }

      /* 連射チェック（CS2: 散弾は 1つぶずつ 来るので つぶの数で わる。ブラックホールの ダメージは かるく。ボスは しない） */
      if (a.raidBoss) { /* ボス */ }
      else if (isBomb) { if (a.bombTokens < 1) return; a.bombTokens -= 1; }
      else {
        const cost = msg.f ? 0.15 : 1 / Math.max(1, def.pellets | 0);
        if (a.tokens < cost) return;
        a.tokens -= cost;
      }

      /* 撃った人のむてきを解除 */
      if (a.protect) { a.protect = false; a.protectUntil = 0; }
      a.safeUntil = 0;

      const maxD = CS.Weapons.maxDamage(def) * DMG_SLACK;
      /* 距離チェックの基準点。ボムは「投げた人」ではなく「ばくはつした場所」から見る。
         投げたボムは 10m 以上とぶので、投げた人との距離で切るとぜんぶ無効になってしまう。 */
      let org = a.lastReport;
      let range = (def.range || 100) + RANGE_SLACK;
      if (isBomb) {
        /* 投げられる最大のとどく距離（ざっくり。でっちあげの座標よけ）。
           lastReport は「いまの」投げた人の位置なので、導火線のあいだに走った分も足す。
           インパルスは着弾で爆発（fuse 0）なので最低 1 秒、クラスターは子が さらに飛ぶ分も */
        const fly = Math.max(1, def.fuse || 1);
        const reach = ((def.throwSpeed || 16) + PLAYER.speed) * fly + def.radius +
          (def.cluster ? 8 * (def.cluster.fuseMax || 1) : 0);
        const bp = msg.p;
        if (bp && bp.length >= 3) {
          const b0 = this._bp; b0[0] = num(bp[0]); b0[1] = num(bp[1]); b0[2] = num(bp[2]);
          if (V.dist(a.lastReport, b0) <= reach + RANGE_SLACK) {
            org = b0;
            range = def.radius + PLAYER.half + RANGE_SLACK;
          } else range = reach + RANGE_SLACK;
        } else range = reach + RANGE_SLACK;
      }
      const hits = msg.hits || [];
      for (let i = 0; i < hits.length && i < 8; i++) {
        const h = hits[i];
        if (!h || h.length < 2) continue;
        const vi = h[0] | 0;
        const v = this.players[vi];
        if (!v || !v.connected || !v.alive) continue;
        const self = vi === idx;
        if (v.protect || v.shield) continue;          // むてき・スーパーバリア
        let dmg = num(h[1]);
        if (!self && v.team === a.team) dmg = 0;                // 味方うちは無し（ふっとばしだけ通す）
        if (!(dmg > 0)) {
          /* ダメージ 0（インパルスの吹きとばしだけ） */
          const kb0 = [num(h[3]), num(h[4]), num(h[5])];
          if (kb0[0] || kb0[1] || kb0[2]) this._broadcastKb(v, a, kb0, w);
          continue;
        }
        if (dmg > maxD) dmg = maxD;
        /* v5: よわよわボムを あびた人の こうげきは よわい・クリスタルまもりの てきは ウェーブで つよく なる */
        if (!self && a.weakUntil > this.time) dmg *= a.weakMul || WEAK_MUL;
        if (!self && a.dmgMul > 0) dmg *= a.dmgMul;
        /* CS2: パワーガンで つよく なっている */
        if (!self && a.fx && a.fx.pow > this.time) dmg *= a.fx.powMul || 1.3;
        const d = V.dist(org, v.lastReport);
        if (d > range + (v.big > 0 ? v.big : 0)) continue;
        const kb = (h[3] || h[4] || h[5]) ? [num(h[3]), num(h[4]), num(h[5])] : 0;
        const hp0 = v.hp;
        this._hostApplyDamage(v, dmg, a, w, h[2] === 1, kb, a.lastReport);
        /* CS2: 部品の こうか（吸血・スロー・炎上） */
        if (!isBomb && !self && v.team !== a.team) {
          const got = Math.max(0, hp0 - Math.max(0, v.hp));
          if (def.lifesteal > 0 && a.alive && got > 0) a.hp = Math.min(a.maxHp || RULES.hp, a.hp + got * def.lifesteal);
          const oh = def.onHit;
          if (oh && v.alive && !v.raidBoss) {
            if (oh.slow) this._hostFx(v, 'slow', oh.slow.dur, oh.slow.mul);
            if (oh.burn) v.burn = { dps: oh.burn.dps, until: this.time + oh.burn.dur, by: idx, acc: v.burn ? v.burn.acc : 0 };
          } else if (oh && oh.burn && v.alive) v.burn = { dps: oh.burn.dps, until: this.time + oh.burn.dur, by: idx, acc: v.burn ? v.burn.acc : 0 };
        }
        /* v5: よわよわボム: 当たった相手を よわくする */
        if (isBomb && def.effect === 'weak' && def.weak && !self && v.team !== a.team && v.alive) this._hostWeak(v, def.weak);
        /* v5.1: こおりボム: 当たった相手は しばらく うごけない */
        if (isBomb && def.effect === 'freeze' && def.freeze && !self && v.team !== a.team && v.alive) this._hostFreeze(v, def.freeze);
        if (msg.burn && def.flame && def.flame.burn && v.alive && !self && v.team !== a.team) {
          v.burn = { dps: def.flame.burn.dps, until: this.time + def.flame.burn.dur, by: idx, acc: v.burn ? v.burn.acc : 0 };
        }
      }
    }

    /* CS2: 回復・サポートの 弾（ホストが たしかめて みんなへ）。msg.h = [[人, 回復量], ...] */
    _hostHeal(msg, fromId) {
      if (this.mode !== 'match' && this.mode !== 'practice') return;
      if (this.phase !== 'live') return;
      const idx = this._idxOf(fromId);
      const a = this.players[idx];
      if (!a || !a.connected || !a.alive || (msg.i | 0) !== idx) return;
      const w = String(msg.w || '');
      let def = null;
      if (a.guns && msg.s !== undefined && a.guns[msg.s | 0] && a.guns[msg.s | 0].id === w) def = a.guns[msg.s | 0];
      else if (a.gun && a.gun.id === w) def = a.gun;
      else if (a.guns) for (const g of a.guns) if (g && g.id === w) def = g;
      if (!def || !def.proj) return;
      const pr = def.proj;
      if (a.tokens < 0.3) return;
      a.tokens -= 0.3;
      const cap = (pr.heal > 0 ? pr.heal : 0) * 1.05 + 0.01;
      const list = Array.isArray(msg.h) ? msg.h : [];
      for (let i = 0; i < list.length && i < 8; i++) {
        const h = list[i];
        if (!Array.isArray(h)) continue;
        const v = this.players[h[0] | 0];
        if (!v || !v.alive || !v.connected || v.team !== a.team || v.raidBoss) continue;
        const self = v === a;
        if (self && !(pr.healR > 0)) continue;
        if (V.dist(a.lastReport, v.lastReport) > (def.range || 60) + RANGE_SLACK + (pr.healR || 0)) continue;
        let amt = clamp(num(h[1]), 0, cap);
        if (self) amt = Math.min(amt, cap * 0.5);
        const mh = v.maxHp || RULES.hp;
        if (amt > 0 && v.hp < mh) {
          v.hp = Math.min(mh, v.hp + amt);
          this._broadcast({ t: 'dmg', v: v.idx, a: idx, hp: Math.round(v.hp), w: w, hs: 0, d: 0, heal: 1 });
        }
        if (pr.buff && !self) this._hostFx(v, pr.buff.k, pr.buff.dur, pr.buff.mul);
      }
    }

    /* CS2: こうか（slow / guard / pow / spd）を みんなへ */
    _hostFx(v, k, dur, mul) {
      if (!v || !v.fx || ['slow', 'guard', 'pow', 'spd'].indexOf(k) < 0) return;
      dur = clamp(num(dur) || 2, 0.2, 12); mul = clamp(num(mul) || 1, 0.2, 3);
      v.fx[k] = this.time + dur; v.fx[k + 'Mul'] = mul;
      this._broadcast({ t: 'fx', v: v.idx, k: k, d: r2(dur), m: r2(mul) });
    }
    _onFx(m) {
      const p = this.players[m.v | 0];
      const k = m.k;
      if (!p || !p.fx || ['slow', 'guard', 'pow', 'spd'].indexOf(k) < 0) return;
      if (this.mode !== 'match' && this.mode !== 'practice') return;
      const dur = clamp(num(m.d), 0, 12);
      const was = p.fx[k] > this.time;
      p.fx[k] = this.time + dur; p.fx[k + 'Mul'] = clamp(num(m.m) || 1, 0.2, 3);
      if (p.idx === this.me && !was) {
        const T = { slow: ['足が おそく なった！', '#bfe8ff'], guard: ['ガード！ うける ダメージ ダウン', '#8fd0ff'], pow: ['パワーアップ！ こうげき力 アップ', '#ffb08f'], spd: ['スピードアップ！', '#ffe98f'] };
        CS.UI.hud.center(T[k][0], T[k][1], 1000);
      }
      this._healFx(p.rpos, k);
    }

    /* v5: よわよわ（ホストが きめて みんなへ） */
    _hostWeak(v, wk) {
      const dur = clamp(num(wk.dur) || 6, 0.5, 20), mul = clamp(num(wk.mul) || WEAK_MUL, 0.1, 1);
      v.weakUntil = this.time + dur; v.weakMul = mul;
      this._broadcast({ t: 'wk', v: v.idx, d: dur, m: mul });
    }
    _onWeak(m) {
      const p = this.players[m.v | 0];
      if (!p || (this.mode !== 'match' && this.mode !== 'practice')) return;
      const dur = clamp(num(m.d), 0, 20);
      p.weakUntil = this.time + dur; p.weakMul = clamp(num(m.m) || WEAK_MUL, 0.1, 1);
      if (p.idx === this.me) {
        CS.UI.hud.center('こうげき力 ダウン！', '#c8a0ff', 1200);
        this._sfx('hurt');
      }
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        this._addPart(p.rpos[0], p.rpos[1] + 0.2, p.rpos[2], Math.cos(a) * 2.5, 1.5 + rnd(), Math.sin(a) * 2.5,
          0.1 + rnd() * 0.06, 0.72, 0.42, 1.0, 0.6, 2, 1.6, 0);
      }
    }

    /* v5.1: こおり（ホストが きめて みんなへ）。うごけないのは その人を 動かしている 端末が まもる */
    _hostFreeze(v, fz) {
      const dur = clamp(num(fz.dur) || 2, 0.3, 6);
      v.frozenUntil = this.time + dur;
      this._broadcast({ t: 'frz', v: v.idx, d: dur });
    }
    _onFreeze(m) {
      const p = this.players[m.v | 0];
      if (!p || (this.mode !== 'match' && this.mode !== 'practice')) return;
      const dur = clamp(num(m.d), 0, 6);
      p.frozenUntil = this.time + dur;
      if (p.idx === this.me) {
        CS.UI.hud.center('こおった！ ' + Math.round(dur) + '秒 うごけない', '#9fe6ff', 1200);
        this._sfx('hurt');
      }
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        this._addPart(p.rpos[0], p.rpos[1] + 0.1, p.rpos[2], Math.cos(a) * 2.8, 1 + rnd() * 1.5, Math.sin(a) * 2.8,
          0.1 + rnd() * 0.07, 0.75, 0.93, 1.0, 0.65, 4, 1.4, 0);
      }
    }

    /* v5: ワープボム: 持ち主を おちた場所へ（立てる場所を さがす。なければ ワープしない） */
    _warpPlayer(p, at, dir) {
      const w = this.world, h = PLAYER.half;
      const back = dir ? [-dir[0], -dir[1], -dir[2]] : [0, 0, 0];
      const c = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const bx = at[0] + back[0] * 0.35 * k, bz = at[2] + back[2] * 0.35 * k, by = at[1] + back[1] * 0.35 * k;
        for (const dy of [0, 0.3, 0.6, 1.0, 1.5, 2.0]) {
          for (const o of WARP_OFFS) {
            c[0] = bx + o[0]; c[1] = by + h + 0.04 + dy; c[2] = bz + o[1];
            if (c[1] < h + 0.5) continue;
            if (!w.overlapsBox(c, h)) {
              const from = [p.pos[0], p.pos[1], p.pos[2]];
              p.pos[0] = c[0]; p.pos[1] = c[1]; p.pos[2] = c[2];
              p.vel[0] = p.vel[1] = p.vel[2] = 0;
              p.grounded = false;
              if (p.idx === this.me && !this._bot) { this.stepSmooth = 0; this.slideT = 0; }
              this._warpFx(from);
              return true;
            }
          }
        }
      }
      return false;
    }
    _warpFx(pos) {
      for (let i = 0; i < 18; i++) {
        const d = V.norm([rnd() - 0.5, rnd() * 0.8, rnd() - 0.5]);
        this._addPart(pos[0], pos[1], pos[2], d[0] * 4, d[1] * 4, d[2] * 4, 0.1 + rnd() * 0.08, 0.3, 1.0, 0.85, 0.5, 0, 1.8, 0);
      }
    }

    _broadcastKb(v, a, kb, w) {
      this._broadcast({ t: 'dmg', v: v.idx, a: a ? a.idx : -1, hp: Math.round(v.hp), w: w, hs: 0, kb: kb, from: [r2(a.lastReport[0]), r2(a.lastReport[1]), r2(a.lastReport[2])] });
    }

    _hostApplyDamage(v, dmg, a, w, head, kb, from) {
      if (!v.alive) return;
      if (v.shield) return;                                      // v4: スーパーバリア（やけども きかない）
      /* v5: バブル: ほかの人の こうげきに 1回 当たると われる（その こうげきは きかない） */
      if (v.spK === 'bubble' && a && a !== v) { this._broadcast({ t: 'spx', i: v.idx, k: 'bubble' }); return; }
      /* v5: せんしゃ: うける ダメージは 3分の1 */
      if (v.spK === 'tank') dmg *= TANK_ARMOR;
      if (v.armor > 0 && v.armor !== 1) dmg *= v.armor;          // 塔のぼり: かたい
      /* CS2: ガードガン（うける ダメージ へる）・狂戦士の 部品（ふえる） */
      if (a && a !== v) {
        if (v.fx && v.fx.guard > this.time) dmg *= v.fx.guardMul || 0.6;
        if (v.takeMul > 0 && v.takeMul !== 1) dmg *= v.takeMul;
      }
      v.hp -= dmg;
      v.lastDmgT = this.time;
      const aIdx = a ? a.idx : -1;
      const fromP = from || (a ? a.lastReport : v.lastReport);
      if (v.hp <= 0) {
        /* v5.1: コピーが たおされても 点には ならない（ふっかつも しない）。コピーの てがらは 持ち主のもの */
        const isClone = v.clone >= 0;
        const cr = a && a.clone >= 0 ? (this.players[a.clone] || a) : a;
        v.hp = 0;
        v.alive = false;
        if (!isClone) v.deaths++;
        v.burn = null;
        v.respawnAt = isClone ? 0 : this.time + RULES.respawn;
        v.killer = aIdx;
        const selfKill = aIdx < 0 || aIdx === v.idx;
        let spMsg = null;
        if (!selfKill && cr && cr.team !== v.team && !isClone) {
          cr.kills++;
          if (this.rule.id === 'kills' || this.rule.id === 'time' || this.rule.id === 'king') this.score[cr.team]++;
          /* 塔のぼり: たおすと回復 */
          if (cr.healOnKill > 0 && cr.alive) cr.hp = Math.min(cr.maxHp || RULES.hp, cr.hp + cr.healOnKill);
          /* v4: 必殺ゲージ */
          if (this._addSp(cr, this._spGainFor(cr))) spMsg = [cr.idx, r2(cr.sp)];
        }
        /* ストック: のこりを1へらす。0になったら もう ふっかつしない */
        let stocks = null;
        if (this.rule.id === 'stock' && !isClone) {
          if (v.stock > 0) v.stock--;
          if (v.stock <= 0) { v.stock = 0; v.out = true; v.respawnAt = 0; }
          this.score = this._ruleScore();
          stocks = [];
          for (const p of this.players) stocks.push(p.stock);
        }
        if (this.tower && this._towerKill) this._towerKill(v, a);
        if (this.defense && this._defKill) this._defKill(v, a);      // v5: クリスタルまもりの てきは ふっかつ しない
        if (this.raid && this._raidKill) this._raidKill(v, a);        // CS2: ボスレイド（ライフ・ボスを たおした）
        if (this.castle && this._csKill) this._csKill(v, a);          // CS2: 城バトル（部隊は ふっかつ しない・お金）
        const k = [], d = [];
        for (const p of this.players) { k.push(p.kills); d.push(p.deaths); }
        const km = { t: 'kill', v: v.idx, a: aIdx, w: w, hs: head ? 1 : 0, sc: [this.score[0], this.score[1]], k: k, d: d };
        if (stocks) km.st = stocks;
        if (spMsg) km.sp = spMsg;
        if (v.out) km.out = 1;
        this._broadcast(km);
        if (kb) this._broadcast({ t: 'dmg', v: v.idx, a: aIdx, hp: 0, w: w, hs: head ? 1 : 0, kb: kb, from: [r2(fromP[0]), r2(fromP[1]), r2(fromP[2])] });
        this._hostCheckEnd();
      } else {
        /* d:1 = ダメージあり（ホスト自身の記録は先に減っているので、hp の差だけでは分からない） */
        this._broadcast({
          t: 'dmg', v: v.idx, a: aIdx, hp: Math.round(v.hp), w: w, hs: head ? 1 : 0, d: 1,
          kb: kb || 0, from: [r2(fromP[0]), r2(fromP[1]), r2(fromP[2])]
        });
      }
    }

    _hostCheckEnd() {
      if (this.endAt >= 0 || this.mode !== 'match' || this.phase === 'over' || this.tower || this.raid || this.castle) return;
      /* v5: キングバトル: キングが たおれた チームの 負け */
      if (this.rule.id === 'king') {
        const d0 = !this._kingAlive(0), d1 = !this._kingAlive(1);
        if (d0 || d1) { this.kingWin = d0 && d1 ? -1 : (d0 ? 1 : 0); this.endAt = this.time + END_DELAY; }
        return;
      }
      if (this.rule.id === 'stock') {
        /* のこっている人がいなくなったチームの負け（両方いっしょなら ひきわけ） */
        const left = [0, 0];
        for (const p of this.players) if (p.connected && !p.out && inPlay(p)) left[p.team]++;
        if (left[0] === 0 || left[1] === 0) { this.endAt = this.time + END_DELAY; return; }
      }
      if (this.suddenDeath) {
        if (this.score[0] !== this.score[1]) this.endAt = this.time + END_DELAY;
        return;
      }
      if (this.score[0] >= this.killsToWin || this.score[1] >= this.killsToWin) {
        this.endAt = this.time + END_DELAY;
      }
    }

    _hostCheckTeams() {
      if (this.mode !== 'match' || this.endAt >= 0 || this.phase === 'over') return;
      if (this.tower) return;
      /* CS2: 城バトル: 人が いなくなっても CPU と 部隊で つづく（だれも いなければ おわり） */
      if (this.castle) {
        let hu = 0;
        for (const p of this.players) if (p.connected && !p.cpu && !p.npc && inPlay(p)) hu++;
        if (!hu) this._sendEnd(-1);
        return;
      }
      const n = [0, 0];
      for (const p of this.players) if (p.connected && inPlay(p)) n[p.team]++;
      if (n[0] === 0 && n[1] === 0) { this._sendEnd(-1); return; }
      /* CS2: ボスレイド: なかまが いなくなったら まけ（ボスは いつも いる） */
      if (this.raid) { if (n[0] === 0 && this._raidFinish) this._raidFinish(false); return; }
      const kills = this.rule.id === 'kills';
      if (this.rule.id === 'stock') this.score = this._ruleScore();
      if (n[0] === 0) { if (kills) this.score[1] = Math.max(this.score[1], this.killsToWin); this._sendEnd(1); }
      else if (n[1] === 0) { if (kills) this.score[0] = Math.max(this.score[0], this.killsToWin); this._sendEnd(0); }
      else if (this.rule.id === 'stock') this._hostCheckEnd();
    }

    _hostEnd(winner) { this.endAt = -1; this._sendEnd(winner); }

    /* ======================================================================
       v5: キングバトル
       ====================================================================== */
    /* チームに 1人ずつ キング（みんな おなじ 種から おなじ人を えらぶ）。キングの HP は ルールの n */
    _pickKings(seed) {
      this.kings = [-1, -1]; this.kingWin = -1;
      if (this.rule.id !== 'king') return;
      const rg = CS.rng(((seed | 0) ^ 0x2468ace) >>> 0);
      const hp = this.rule.n || 200;
      for (let t = 0; t < 2; t++) {
        const c = this.players.filter((p) => p.team === t && inPlay(p));
        if (!c.length) continue;
        const k = c[Math.floor(rg() * c.length) % c.length];
        k.king = true; k.maxHp = hp; k.hp = hp;
        this.kings[t] = k.idx;
      }
    }
    _king(t) { return this.kings ? this.players[this.kings[t]] || null : null; }
    _kingAlive(t) { const k = this._king(t); return !!(k && k.alive && k.connected); }
    _kingRatio(t) { const k = this._king(t); return k && k.alive && k.connected ? clamp(k.hp / (k.maxHp || 1), 0, 1) : 0; }

    /* ホスト: キングが へやを 出た → おなじ チームの だれかが 新しい キング（みんなへ） */
    _hostNewKing(team) {
      const c = this.players.filter((p) => p.team === team && p.connected && inPlay(p));
      if (!c.length) return;
      const k = c[Math.floor(Math.random() * c.length)];
      this._broadcast({ t: 'king', tm: team, i: k.idx, hp: Math.round(k.alive ? k.hp : 0) });
    }
    _onKing(m) {
      const t = (m.tm | 0) === 1 ? 1 : 0, k = this.players[m.i | 0];
      if (!k || this.rule.id !== 'king' || !this.kings) return;
      const old = this._king(t);
      if (old) old.king = false;
      k.king = true;
      k.maxHp = this.rule.n || 200;
      if (k.alive) k.hp = Math.min(k.maxHp, Math.max(num(m.hp), k.hp));
      this.kings[t] = k.idx;
      const me = this.players[this.me];
      if (k.idx === this.me) CS.UI.hud.center('あなたが 新しい キング！', '#ffd23d', 1600);
      else if (me && me.team === t) CS.UI.hud.center(k.name + ' が 新しい キング', '#ffd23d', 1300);
    }

    /* 王冠（キングの 頭の上） */
    _drawCrown(r, pos) {
      const y = pos[1] + 0.78, t = this.time;
      const G = [1, 0.82, 0.25], o = this._oCrown || (this._oCrown = { emissive: 0.55 });
      r.cube([pos[0], y, pos[2]], null, 0.34, G, o);
      for (let i = 0; i < 4; i++) {
        const a = t * 0.8 + i * Math.PI / 2;
        r.cube([pos[0] + Math.cos(a) * 0.15, y + 0.2, pos[2] + Math.sin(a) * 0.15], null, 0.1, G, o);
      }
      r.particle([pos[0], y + 0.42, pos[2]], 0.5, [1, 0.9, 0.4], 0.35 + 0.15 * Math.sin(t * 4));
    }

    _sendEnd(winner) {
      const k = [], d = [];
      for (const p of this.players) { k.push(p.kills); d.push(p.deaths); }
      const m = { t: 'end', winner: winner, score: [this.score[0], this.score[1]], k: k, d: d };
      if (this.rule.id === 'stock') { m.st = []; for (const p of this.players) m.st.push(p.stock); }
      this._broadcast(m);
    }

    /* at = {p, yaw} を わたすと そこに 出す（v5.1: コピー）。なければ てきから いちばん とおい 出撃地点 */
    _hostRespawn(p, at) {
      const spawns = this.mapData.spawns[p.team] || this.mapData.spawns[0];
      let best = at || spawns[0], bestD = -1;
      for (let i = 0; i < spawns.length && !at; i++) {
        let mn = 1e9;
        for (const q of this.players) {
          if (!q.connected || !q.alive || q.team === p.team) continue;
          const d = V.dist(spawns[i].p, q.lastReport);
          if (d < mn) mn = d;
        }
        if (mn > bestD) { bestD = mn; best = spawns[i]; }
      }
      p.alive = true;
      p.hp = p.maxHp || RULES.hp;
      p.burn = null;
      p.respawnAt = 0;
      p.lastDmgT = this.time;
      p.protect = true;
      p.protectUntil = this.time + RULES.spawnProtect;
      p.safeUntil = this.time + RULES.spawnProtect + SAFE_EXTRA;
      p.lastReport[0] = best.p[0]; p.lastReport[1] = best.p[1]; p.lastReport[2] = best.p[2];
      this._broadcast({ t: 'spawn', i: p.idx, p: [r2(best.p[0]), r2(best.p[1]), r2(best.p[2])], yaw: r3(best.yaw) });
    }

    /* ======================================================================
       v5.1: 必殺技「コピー」: じぶんと おなじ 見た目・銃の コンピューターが となりに あらわれて いっしょに たたかう。
       いれものは しあいの はじめに 作ってある（_beginMatch）。ホストが 出して、時間が きたら けす
       ====================================================================== */
    _cloneOf(p) {
      for (let i = this.players.length - 1; i >= 0; i--) if (this.players[i].clone === p.idx) return this.players[i];
      return null;
    }
    _hostCloneUp(p, dur) {
      const c = this._cloneOf(p);
      if (!c || !c.bot) return;
      const at = this._cloneSpot(p);
      c.cloneUntil = this.time + dur;
      this._hostRespawn(c, { p: at, yaw: p.yaw });
      c.protectUntil = this.time + 0.5;           // 出てすぐ やられないように ほんの すこしだけ むてき
    }
    /* 持ち主の よこ・うしろの あいている ところ（なければ 持ち主の いる ところ） */
    _cloneSpot(p) {
      const w = this.world, h = PLAYER.half, q = p.lastReport;
      const rt = V.right(p.yaw), fw = V.flatForward(p.yaw);
      const offs = [[1.6, 0], [-1.6, 0], [0, -1.6], [1.4, -1.4], [-1.4, -1.4], [0, 1.6], [2.6, 0], [-2.6, 0]];
      const c = [0, 0, 0];
      for (const dy of [0, 0.5, 1.0]) {
        for (const o of offs) {
          c[0] = q[0] + rt[0] * o[0] + fw[0] * o[1];
          c[1] = q[1] + dy;
          c[2] = q[2] + rt[2] * o[0] + fw[2] * o[1];
          if (!w.overlapsBox(c, h) && w.lineClear(q, c)) return [c[0], c[1], c[2]];
        }
      }
      return [q[0], q[1], q[2]];
    }
    /* みんなが受け取る: コピーが きえた */
    _onCloneGone(m) {
      const p = this.players[m.i | 0];
      if (!p || p.clone < 0 || !p.alive) return;
      p.alive = false; p.hp = 0; p.firing = false;
      if (p.bot) this._stopBotLoops(p);
      const c = spColor('clone');
      for (let i = 0; i < 18; i++) {
        const d = V.norm([rnd() - 0.5, rnd() * 0.8, rnd() - 0.5]);
        this._addPart(p.rpos[0], p.rpos[1], p.rpos[2], d[0] * 3.5, d[1] * 3.5, d[2] * 3.5, 0.1 + rnd() * 0.08, c[0], c[1], c[2], 0.55, 1, 1.6, 0);
      }
      this._sfx('spawn', p.rpos, 0.6);
    }

    /* ==================================================================
       8. Net handlers（プロトコル）
       ================================================================== */
    _sendOwner(msg, unrel) {
      if (!this.net) return;
      this.net.send(msg, unrel ? { unreliable: true } : undefined);
    }

    _broadcast(msg, unrel) {
      if (this.net && this.isHost) this.net.send(msg, unrel ? { unreliable: true } : undefined);
      /* ボットを動かしている途中（ボットの弾が当たった など）なら、いったん自分にもどしてから受け取る。
         もどさないと this.me がそのボットのままで、自分がやられても「自分」だと分からない
         （ふっかつのカウントダウンが始まらない・被弾の向きが出ない など） */
      const bot = this._bot;
      if (bot) {
        this._leaveBot(bot);
        try { this._clientMsg(msg); } finally { this._enterBot(bot); }
      } else this._clientMsg(msg);
    }

    /* ホストへ。ホスト自身は直接処理する（コンピューター戦ではボットの分もここを通る。
       この端末の中だけの呼び出しなので、送り主はメッセージの i の人） */
    _toHost(msg) {
      if (this.isHost) {
        const p = this.players[msg.i | 0];
        this._hostMsg(msg, p && (p.bot || p.id === 'host') ? p.id : 'host');
      } else if (this.net) this.net.send(msg);
    }

    _relay(msg, fromId, unrel) {
      if (!this.net) return;
      const ids = this.net.peers();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i] === fromId) continue;
        this.net.send(msg, { to: ids[i], unreliable: !!unrel });
      }
    }

    /* ---- ホストが受け取る ---- */
    _hostMsg(msg, fromId) {
      const t = msg.t;
      if (t === 'hello') { this._hostHello(msg, fromId); return; }
      if (t === 'set') { this._hostSet(fromId, msg); return; }
      if (t === 'hit') { this._hostHit(msg, fromId); return; }
      if (t === 'hl') { this._hostHeal(msg, fromId); return; }        // CS2: 回復・サポート
      /* v4: 必殺技・クリスタル・塔のぼりの とびら */
      if (t === 'spc') { this._hostSpecial(msg, fromId); return; }
      if (t === 'tgh') { this._hostTargetHit(msg, fromId); return; }
      if (t === 'twpk') { if (this._hostTowerPick) this._hostTowerPick(msg, fromId); return; }
      /* CS2: 城バトル（ブロックの ダメージ・買いもの） */
      if (t === 'cbd' || t === 'cbuy') { if (this._csHostMsg) this._csHostMsg(msg, fromId); return; }
      /* しあい中の中継（そのまま流す） */
      if (t === 'p' || t === 'sh' || t === 'pj' || t === 'px' || t === 'bt' || t === 'bx' || t === 'bs' || t === 'gsw') {
        if (this.mode !== 'match') return;
        const idx = this._idxOf(fromId);
        if (idx < 0) return;
        const mi = t === 'p' ? (msg.d && msg.d[0] | 0) : (msg.i | 0);
        if (mi !== idx) return;
        /* ボムは pose の「撃ってる」ビットが立たないので、ここで むてき を解除する */
        if (t === 'bt') {
          const bp = this.players[idx];
          if (bp && bp.protect) { bp.protect = false; bp.protectUntil = 0; }
          if (bp) bp.safeUntil = 0;
        }
        const unrel = (t === 'p' || t === 'sh');
        this._relay(msg, fromId, unrel);
        this._clientMsg(msg);
      }
    }

    _hostHello(msg, fromId) {
      if (!this.room) return;
      if ((msg.v | 0) !== CS.VERSION) { this.net.send({ t: 'reject', why: 'version' }, { to: fromId }); return; }
      if (this.room.started || this.mode === 'match') { this.net.send({ t: 'reject', why: 'started' }, { to: fromId }); return; }
      for (const p of this.room.players) if (p.id === fromId) { this._broadcastLobby(); return; }
      const per = perTeam(this.room.mode);
      const n = [0, 0];
      for (const p of this.room.players) n[p.team]++;
      let team = -1;
      if (isCoopMode(this.room.mode)) team = n[0] < per ? 0 : -1;      // みんなで塔のぼり・クリスタルまもり: みんな あかチーム
      else if (n[0] <= n[1] && n[0] < per) team = 0;
      else if (n[1] < per) team = 1;
      else if (n[0] < per) team = 0;
      /* v5: まんいん でも コンピューターが いれば 1人 へらして 入れる */
      if (team < 0 && !isCoopMode(this.room.mode)) {
        for (let i = this.room.players.length - 1; i >= 0; i--) {
          if (this.room.players[i].bot) { team = this.room.players[i].team; this.room.players.splice(i, 1); break; }
        }
      }
      if (team < 0) { this.net.send({ t: 'reject', why: 'full' }, { to: fromId }); return; }
      const rec = {
        id: fromId, name: '', team: team,
        gun: CS.Weapons.gun(msg.gun).id, bomb: CS.Weapons.bomb(msg.bomb).id, ready: false, ping: 0,
        fc: cleanFc(msg.fc), skin: cleanSkin(msg.skin)
      };
      rec.gun2 = cleanGun2(msg.gun2, rec.gun);
      rec.gm = cleanMods(msg.gm, rec.gun); rec.gm2 = rec.gun2 ? cleanMods(msg.gm2, rec.gun2) : '';
      rec.name = this._uniqueName(clipName(msg.name), rec);
      this.room.players.push(rec);
      this._broadcastLobby();
    }

    /* 同じなまえの人がいたら「プレイヤー12(2)」のように番号をつける（ホストだけが決める）。
       なまえは 10 文字まで（しあい開始で clipName される）なので、長いときは元のなまえをけずる */
    _uniqueName(base, self) {
      const list = this.room ? this.room.players : [];
      const taken = (n) => { for (const q of list) if (q !== self && q.name === n) return true; return false; };
      if (!taken(base)) return base;
      for (let k = 2; k < 100; k++) {
        const suf = '(' + k + ')';
        const n = base.slice(0, Math.max(1, 10 - suf.length)) + suf;
        if (!taken(n)) return n;
      }
      return base;
    }

    _hostSet(fromId, msg) {
      if (!this.room) return;
      let p = null;
      for (const q of this.room.players) if (q.id === fromId) { p = q; break; }
      if (!p) return;
      let changed = false;
      if (msg.name !== undefined) {
        const nm = this._uniqueName(clipName(msg.name), p);
        if (nm !== p.name) { p.name = nm; changed = true; }
      }
      if (msg.skin !== undefined && !this.room.started) {
        const sk = cleanSkin(msg.skin);
        if (JSON.stringify(sk) !== JSON.stringify(p.skin || null)) { p.skin = sk; changed = true; }
      }
      if (!this.room.started && this.mode === 'lobby') {
        if (msg.gun !== undefined) { p.gun = CS.Weapons.gun(msg.gun).id; p.ready = false; changed = true; }
        if (msg.gun2 !== undefined) { p.gun2 = cleanGun2(msg.gun2, p.gun); changed = true; }
        if (msg.gm !== undefined) { p.gm = cleanMods(msg.gm, p.gun); p.ready = false; changed = true; }
        if (msg.gm2 !== undefined) { p.gm2 = p.gun2 ? cleanMods(msg.gm2, p.gun2) : ''; p.ready = false; changed = true; }
        if (msg.bomb !== undefined) { p.bomb = CS.Weapons.bomb(msg.bomb).id; p.ready = false; changed = true; }
        if (msg.team !== undefined && !isCoopMode(this.room.mode) && !this.room.ranked) {     // ランダムマッチは チームを かえない
          const t = (msg.team | 0) === 1 ? 1 : 0;
          const per = perTeam(this.room.mode);
          let n = 0;
          for (const q of this.room.players) if (q !== p && q.team === t) n++;
          if (t !== p.team && n < per) { p.team = t; p.ready = false; changed = true; }
        }
        if (msg.ready !== undefined) { p.ready = !!msg.ready; changed = true; }
      }
      if (changed) this._broadcastLobby();
    }

    _broadcastLobby() {
      if (!this.isHost || !this.room) return;
      const players = [];
      for (const p of this.room.players) {
        players.push({
          id: p.id, name: p.name, team: p.team, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, ready: !!p.ready, ping: p.ping | 0, bot: p.bot || undefined,
          fc: p.fc || '', skin: p.skin || null
        });
      }
      const def = CS.Maps.get(this.room.mapId);
      this._broadcast({
        t: 'lobby', code: this.room.code, mode: this.room.mode, map: this.room.mapId, players: players, hostId: 'host',
        rule: CS.cleanRule(this.room.rule), mapName: def && def.custom ? def.name : '',
        rd: this.room.raid ? Object.assign({}, this.room.raid) : 0,
        cs: this.room.castle ? Object.assign({}, this.room.castle) : 0,
        tw: this.room.tower ? { diff: this.room.tower.diff } : 0,
        df: this.room.defense ? { diff: this.room.defense.diff, map: this.room.defense.map } : 0,
        tn: this.room.tourney ? Object.assign({}, this.room.tourney) : 0,
        rk: this.room.ranked ? { tier: this.room.ranked.tier } : 0
      });
    }

    /* ---- みんなが受け取る ---- */
    _clientMsg(msg) {
      switch (msg.t) {
        case 'lobby': this._onLobby(msg); break;
        case 'start': this._beginMatch(msg); break;
        case 'cd': this._onCountdown(msg); break;
        case 'p': this._recvPose(msg.d || []); break;
        case 'sh': this._onShot(msg); break;
        case 'pj': this._onProjSpawn(msg); break;
        case 'px': this._onProjEnd(msg); break;
        case 'bt': this._onBombThrow(msg); break;
        case 'bx': this._onBombEnd(msg); break;
        case 'bs': this._onBombStick(msg); break;
        case 'dmg': this._onDamage(msg); break;
        case 'kill': this._onKill(msg); break;
        case 'spawn': this._onSpawn(msg); break;
        case 'hs': this._onStatus(msg); break;
        case 'zo': this._onZone(msg); break;
        case 'sd': this._onSudden(); break;
        case 'end': this._onEnd(msg); break;
        case 'tolobby': this._toLobby(); break;
        case 'left': this._onLeft(msg); break;
        case 'reject': this._onReject(msg); break;
        case 'bye': this._onBye(); break;
        /* v4 */
        case 'pb': this._onBotPoses(msg); break;
        case 'spc': this._onSpecial(msg); break;
        case 'tg': this._onTarget(msg); break;
        case 'twc': if (this._onTowerClear) this._onTowerClear(msg); break;
        case 'twe': if (this._onTowerEnd) this._onTowerEnd(msg); break;
        /* v5 */
        case 'wk': this._onWeak(msg); break;
        case 'frz': this._onFreeze(msg); break;                        // v5.1
        case 'cgo': this._onCloneGone(msg); break;                     // v5.1
        case 'spx': this._onSpecialCancel(msg); break;
        case 'gsw': this._onGunSwitch(msg); break;
        case 'king': this._onKing(msg); break;
        case 'fx': this._onFx(msg); break;                             // CS2: スロー・ガード・パワー・スピード
        case 'rh': case 'rp': if (this._onRaidMsg) this._onRaidMsg(msg); break;     // CS2: ボスレイド
        case 'dfw': if (this._onDefWave) this._onDefWave(msg); break;
        case 'cbx': case 'cev': if (this._csOnMsg) this._csOnMsg(msg); break;          // CS2: 城バトル
        case 'tn': if (this._onTn) this._onTn(msg); break;             // v5.1: トーナメント表
      }
    }

    /* v4: ホストが動かす コンピューターの位置（まとめて 20Hz） */
    _sendBotPoses() {
      if (!this.net || !this.isHost || this.mode !== 'match') return;
      const list = [];
      const ts = Math.round(CS.now());
      for (const p of this.players) {
        if (!p.bot || !p.connected) continue;
        if (p.clone >= 0 && !p.alive) continue;          // v5.1: 出ていない コピーは 送らない
        if (p.pool && !p.alive) continue;                // CS2: 出ていない 部隊も
        let f = 0;
        if (p.grounded) f |= 1;
        if (p.firing) f |= 2;
        if (p.ads) f |= 4;
        if (p.reloading) f |= 8;
        if (p.spinning) f |= 16;
        if (p.sliding) f |= 32;
        const q = p.quat;
        list.push([p.idx, 0, ts, r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch),
          r2(p.vel[0]), r2(p.vel[1]), r2(p.vel[2]), r3(q[0]), r3(q[1]), r3(q[2]), r3(q[3]), f, p.gen | 0]);
      }
      if (list.length) this.net.send({ t: 'pb', d: list }, { unreliable: true });
    }

    _onBotPoses(m) {
      if (this.isHost || this.mode !== 'match' || !Array.isArray(m.d)) return;
      for (let i = 0; i < m.d.length && i < 48; i++) {
        const d = m.d[i];
        if (!Array.isArray(d)) continue;
        const p = this.players[d[0] | 0];
        if (!p || p.local || !(p.npc || p.cpu)) continue;      // ホストが送れるのは コンピューターの位置だけ
        this._recvPose(d);
      }
    }

    _onLobby(m) {
      this.room = this.room || { code: m.code, players: [] };
      this.room.code = m.code;
      this.room.mode = normMode(m.mode);
      this.room.mapId = m.map;
      this.room.players = m.players || [];
      this.room.hostId = m.hostId || 'host';
      this.room.rule = CS.cleanRule(m.rule);
      this.room.mapName = typeof m.mapName === 'string' ? m.mapName.slice(0, 16) : '';
      const D = CS.Tower && CS.Tower.DIFFS;
      this.room.tower = this.room.mode === 'tower' ? { diff: m.tw && D && D[m.tw.diff] ? m.tw.diff : 'normal' } : null;
      const DF = CS.Defense;
      this.room.defense = this.room.mode === 'defense' && DF ? {
        diff: m.df && DF.DIFFS[m.df.diff] ? m.df.diff : 'normal',
        map: DF.mapOk(m.df && m.df.map)
      } : null;
      const TN = CS.Tourney;
      this.room.tourney = this.room.mode === 'tourney' && TN ? TN.cleanOpts(m.tn) : null;
      this.room.raid = this.room.mode === 'raid' && CS.Raid ? CS.Raid.cleanCfg(m.rd) : null;
      this.room.castle = this.room.mode === 'castle' && CS.Castle ? CS.Castle.cleanCfg(m.cs) : null;
      this.room.ranked = m.rk && typeof m.rk.tier === 'string' ? { tier: m.rk.tier.slice(0, 12) } : null;
      this.matchMode = this.room.mode;
      if (this.mode === 'idle') this.mode = 'lobby';
      this._emit('lobby', this.lobbyView());
    }

    lobbyView() {
      const room = this.room;
      if (!room) return null;
      const per = perTeam(room.mode);
      const tower = isCoopMode(room.mode);      // みんなで協力（塔のぼり・クリスタルまもり）は あかチームだけ
      const slots = [[], []];
      const list = room.players || [];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const t = (p.team | 0) === 1 && !tower ? 1 : 0;
        slots[t].push(p);
      }
      for (let t = 0; t < 2; t++) while (slots[t].length < (tower && t === 1 ? 0 : per)) slots[t].push(null);
      const def = CS.Maps.get(room.mapId);
      return {
        code: room.code, mode: room.mode, mapId: room.mapId, isHost: this.isHost,
        myId: this.myNetId, slots: slots, canStart: this.canStart(), hostId: room.hostId || 'host',
        rule: CS.cleanRule(room.rule), mapName: room.mapName || (def && def.name) || '',
        count: list.length, max: tower ? per : per * 2,
        tower: room.tower ? { diff: room.tower.diff } : null,
        defense: room.defense ? { diff: room.defense.diff, map: room.defense.map } : null,
        tourney: room.tourney ? Object.assign({}, room.tourney) : null,
        raid: room.raid ? Object.assign({}, room.raid) : null,
        castle: room.castle ? Object.assign({}, room.castle) : null,
        ranked: room.ranked ? { tier: room.ranked.tier } : null
      };
    }

    _onCountdown(m) {
      const n = m.n | 0;
      this.countdown = n;
      if (this.tower && this._towerCountdown) { this._towerCountdown(n); return; }
      if (n > 0) { CS.UI.hud.center(String(n), '#ffffff', 900); this._sfx('count'); }
      else { CS.UI.hud.center('スタート！', '#7fd6ff', 1000); this._sfx('go'); }
    }

    _onShot(m) {
      const p = this.players[m.i | 0];
      if (!p || p.local) return;
      const g = this._gunOf(p, m.w) || p.gun;
      const o = m.o || [0, 0, 0];
      /* CS2: いなずま（z）は 当たった所から とびうつる */
      if (m.z) this._sfx('shot_rail', o, 0.4);
      else { p.flash = 1; this._sfx(g.sfx, o); }
      const ends = m.e || [];
      for (let i = 0; i < ends.length && i < 12; i++) {
        const e = ends[i];
        this._tracer(o[0], o[1], o[2], e[0], e[1], e[2], g.tracer, g.tracerWidth || 0.03, 0.09, g.type !== 'beam' && iceBar(p));
        if (e[3] === 2) this._sparks(e[0], e[1], e[2], null, g.tracer, 2);
        else if (e[3] === 1) this._hitFx([e[0], e[1], e[2]], p.team === 0 ? 1 : 0);
      }
    }

    _onProjSpawn(m) {
      const i = m.i | 0;
      if (i === this.me) return;
      const p = this.players[i];
      const g = this._gunOf(p, m.g, m.s);
      if (!g || !g.proj) return;
      const vec = (a) => (Array.isArray(a) && a.length >= 3 ? [num(+a[0]), num(+a[1]), num(+a[2])] : null);
      const o = vec(m.o) || [0, 0, 0], v = vec(m.v) || [0, 0, 0];
      const id = num(m.id) | 0;
      this._addProj(i, id, g, o, v);
      /* CS2: 散弾（2つめ からの 弾） */
      if (Array.isArray(m.vs)) {
        for (let k = 0; k < m.vs.length && k < 40; k++) { const vk = vec(m.vs[k]); if (vk) this._addProj(i, id + k + 1, g, o, vk); }
      }
      if (p) { p.flash = 1; if (!p.local) this._sfx(g.sfx, o, 0.85); }
    }

    /* CS2: その人の 銃（部品つき）。s = 何番目の 銃か。見つからなければ もとの 定義 */
    _gunOf(p, id, s) {
      if (p) {
        const gs = p.guns;
        if (gs && s !== undefined && gs[s | 0] && gs[s | 0].id === id) return gs[s | 0];
        if (p.gun && p.gun.id === id) return p.gun;
        if (gs) for (const q of gs) if (q && q.id === id) return q;
        if (p.spGun && p.spGun.id === id) return p.spGun;
      }
      return (CS.GunMap && CS.GunMap[id]) || null;
    }

    _onProjEnd(m) {
      const id = m.id;
      const pos = m.p || [0, 0, 0];
      for (let k = 0; k < this.projectiles.length; k++) {
        const p = this.projectiles[k];
        if (p.id !== id || p.owner !== (m.i | 0)) continue;
        if (p.mine) return;
        p.dead = true;
        this._projBoom(p, pos, false);
        this.projectiles.splice(k, 1);
        return;
      }
    }

    _onBombThrow(m) {
      const i = m.i | 0;
      if (i === this.me) return;
      const def = CS.BombMap[m.b];
      if (!def) return;
      this._addBomb(i, m.id, def, m.o || [0, 0, 0], m.v || [0, 0, 0], null);
      this._sfx('throw', m.o);
    }

    _onBombStick(m) {
      const id = m.id, i = m.i | 0;
      for (let k = 0; k < this.bombs.length; k++) {
        const b = this.bombs[k];
        if (b.id !== id || b.owner !== i || b.mine) continue;
        const p = m.p || b.pos;
        b.stuck = true;
        b.stuckTo = m.s === undefined ? -1 : (m.s | 0);
        b.vel[0] = b.vel[1] = b.vel[2] = 0;
        b.waitT = -1;
        if (b.stuckTo >= 0 && this.players[b.stuckTo]) {
          const q = this.players[b.stuckTo];
          b.soff[0] = p[0] - q.rpos[0]; b.soff[1] = p[1] - q.rpos[1]; b.soff[2] = p[2] - q.rpos[2];
        }
        b.pos[0] = p[0]; b.pos[1] = p[1]; b.pos[2] = p[2];
        this._sfx('stick', p);
        return;
      }
    }

    _onBombEnd(m) {
      const id = m.id, i = m.i | 0;
      const pos = m.p || [0, 0, 0];
      for (let k = 0; k < this.bombs.length; k++) {
        const b = this.bombs[k];
        if (b.id !== id || b.owner !== i) continue;
        if (b.mine) return;
        b.dead = true;
        this._bombBoom(b, pos, false);
        this.bombs.splice(k, 1);
        return;
      }
    }

    _onDamage(m) {
      const v = this.players[m.v | 0];
      if (!v) return;
      const old = v.hp;
      v.hp = num(m.hp);
      /* CS2: 回復 */
      if (m.heal) {
        this._healFx(v.rpos, 'heal');
        if (v.idx === this.me && v.hp > old + 0.5) CS.UI.hud.center('+' + Math.round(v.hp - old) + ' 回復', '#8ff0a8', 600);
        return;
      }
      const hurt = m.d === 1 || v.hp < old - 0.01;
      if (hurt) v.hitFx = 1;
      if (v.idx === this.me) {
        const me = v;
        if (hurt) {
          me.protect = false; this.protectT = 0;
          this._sfx('hurt');
          this.shake = Math.min(1, this.shake + 0.15);
          if (m.from) {
            const dx = m.from[0] - me.pos[0], dz = m.from[2] - me.pos[2];
            CS.UI.hud.damageFrom(CS.wrapAngle(Math.atan2(-dx, -dz) - me.yaw));
          }
        }
        /* ふっとばしは自分のクライアントで即あてる（動きの権利は自分にある） */
        if (m.kb && m.kb.length === 3) {
          const l = Math.hypot(m.kb[0], m.kb[1], m.kb[2]);
          if (l > 0.01) this._applyKnock(me, m.kb[0], m.kb[1], m.kb[2], l, l);
        }
      } else {
        if (hurt) this._hitFx(v.rpos, v.team);
        /* ボット: 撃たれたらそちらを向く。ふっとばしもここで（動きはこの端末が決める）。CS2: ボスは うごかない */
        if (v.bot && !v.raidBoss) {
          if (hurt && v.alive) {
            const a = m.a | 0;
            try { v.bot.brain.onDamaged(a >= 0 && a !== v.idx ? a : -1, m.from || null); } catch (e) {}
          }
          if (m.kb && m.kb.length === 3) {
            const l = Math.hypot(m.kb[0], m.kb[1], m.kb[2]);
            if (l > 0.01) this._applyKnock(v, m.kb[0], m.kb[1], m.kb[2], l, l);
          }
        }
      }
    }

    _onKill(m) {
      const v = this.players[m.v | 0];
      const a = this.players[m.a | 0] || null;
      if (!v) return;
      v.alive = false; v.hp = 0;
      v.killer = m.a | 0;
      v.weakUntil = 0; v.frozenUntil = 0;
      /* v4: たおれたら 必殺技は おわり・ゲージ・のこり0（塔のぼり） */
      if (v.spK) this._endSpecial(v);
      if (m.sp && m.sp.length === 2) {
        const q = this.players[m.sp[0] | 0];
        if (q && !q.spK) q.sp = clamp(num(m.sp[1]), 0, 1);
      }
      if (m.out) v.out = true;
      if (m.sc) { this.score[0] = m.sc[0] | 0; this.score[1] = m.sc[1] | 0; }
      if (m.k) for (let i = 0; i < m.k.length && i < this.players.length; i++) this.players[i].kills = m.k[i] | 0;
      if (m.d) for (let i = 0; i < m.d.length && i < this.players.length; i++) this.players[i].deaths = m.d[i] | 0;
      if (m.st) {
        for (let i = 0; i < m.st.length && i < this.players.length; i++) {
          const s = m.st[i] | 0;
          this.players[i].stock = s;
          if (s <= 0 && this.rule.id === 'stock') this.players[i].out = true;
        }
      }
      this._boom(v.rpos, 1.1, CS.TEAM_COLORS[v.team], false);
      this._sfx('death', v.local ? null : v.rpos);
      const cn = (p) => (p.clone >= 0 ? p.name + '(コピー)' : p.name);      // v5.1
      CS.UI.hud.feed({
        killer: a ? cn(a) : '', kTeam: a ? a.team : v.team,
        victim: cn(v), vTeam: v.team, weapon: m.w, headshot: !!m.hs,
        me: v.idx === this.me || (a && a.idx === this.me)
      });
      if (a && a.idx === this.me && v.idx !== this.me) {
        CS.UI.hud.hit(!!m.hs, true);
        this._sfx('kill');
      }
      if (v.idx === this.me) {
        this._sfx('death');
        this.respawnKiller = a && a.idx !== this.me ? a.name : '';
        this.respawnT = v.out ? -1 : RULES.respawn;
        if (v.out) CS.UI.hud.center('のこり 0…', '#ffb3c0', 1600);
        if (CS.Input.resetAds) CS.Input.resetAds();
        this.gunState.burstLeft = 0;
        this.gunState.charge = -1;
        this.slideT = 0; this.slideBufT = -1;
        v.sliding = false;
        this._loop('roll', 'roll', false);
        this._loop('beam', 'beam', false);
        this._loop('flame', 'flame', false);
        this._loop('spin', 'spin', false);
      } else if (v.bot) {
        const c = v.bot.ctx;
        c.gunState.burstLeft = 0; c.gunState.charge = -1; c.beam = null;
        c.slideT = 0; c.slideBufT = -1;
        v.sliding = false; v.firing = false; v.spinning = false;
        this._stopBotLoops(v);
      }
      /* あと1キル（キルバトルだけ） */
      if (this.rule.id === 'kills' && !this.suddenDeath) {
        for (let t = 0; t < 2; t++) {
          if (this.score[t] === this.killsToWin - 1) {
            const mine = this.players[this.me] && this.players[this.me].team === t;
            CS.UI.hud.center(mine ? 'あと1キル！' : 'ピンチ！あと1キル', mine ? CS.TEAM_CSS[t] : '#ffb3c0', 1400);
          }
        }
      }
      /* ストック: 相手チームの のこりが 1 */
      if (this.rule.id === 'stock' && !this.suddenDeath && v.idx !== this.me) {
        const me = this.players[this.me];
        for (let t = 0; t < 2; t++) {
          if (this.score[t] === 1 && me) {
            const mine = me.team === t;
            CS.UI.hud.center(mine ? 'ピンチ！のこり1' : 'あいては のこり1！', mine ? '#ffb3c0' : CS.TEAM_CSS[me.team], 1400);
          }
        }
      }
    }

    /* エリアをとった・とられた */
    _onZone(m) {
      if (this.mode !== 'match' || !this.zone) return;
      const o = m.o === 0 || m.o === 1 ? m.o : -1;
      const was = this.zoneOwner;
      this.zoneOwner = o; this.zoneFight = !!m.f;
      const me = this.players[this.me];
      if (!me || this.phase !== 'live' || o === was || o < 0) return;
      const mine = o === me.team;
      CS.UI.hud.center(mine ? 'エリアをとった！' : 'エリアをとられた！', mine ? CS.TEAM_CSS[me.team] : '#ffb3c0', 1100);
      this._sfx(mine ? 'ok' : 'back');
    }

    _onSpawn(m) {
      const p = this.players[m.i | 0];
      if (!p) return;
      const q = m.p || [0, 0, 0];
      p.gen = (p.gen | 0) + 1;      // これより前に送られた位置は無効
      p.alive = true;
      p.out = false;                // 塔のぼり: 階をクリアすると のこり0 の人も もどってくる
      p.hp = p.maxHp || RULES.hp;
      p.protect = true;
      p.weakUntil = 0;              // v5: よわよわは ふっかつで なおる
      p.frozenUntil = 0;            // v5.1: こおりも
      if (p.fx) p.fx.slow = p.fx.guard = p.fx.pow = p.fx.spd = 0;     // CS2
      p.pos[0] = q[0]; p.pos[1] = q[1]; p.pos[2] = q[2];
      p.rpos[0] = q[0]; p.rpos[1] = q[1]; p.rpos[2] = q[2];
      p.vel[0] = p.vel[1] = p.vel[2] = 0;
      p.yaw = num(m.yaw); p.ryaw = p.yaw; p.pitch = 0; p.rpitch = 0;
      p.buf.length = 0; p.off = null; p.offs.length = 0; p.lastTs = -1; p.moved = false;
      p.lastReport[0] = q[0]; p.lastReport[1] = q[1]; p.lastReport[2] = q[2];
      this._sfx('spawn', p.local ? null : p.rpos);
      if (p.idx === this.me) {
        this.respawnT = -1;
        this._poseNow = true;       // 新しい場所をすぐ知らせる
        this.viewYaw = p.yaw; this.viewPitch = 0;
        this.recPitch = this.recYaw = 0;
        p.quat = [0, 0, 0, 1]; p.rquat = p.quat;
        this._fillGuns(p);
        this.bombState.charges = this.bombState.max;
        this.bombState.t = 0;
        this.protectT = RULES.spawnProtect;
        this.adsT = 0;
        this.slideT = 0; this.slideCd = 0; this.slideBufT = -1; this.slideEye = 0;
        p.sliding = false; p.slideK = 0;
        if (CS.Input.resetAds) CS.Input.resetAds();
      } else if (p.bot) {
        /* ボットの持ち物もまっさらに（自分と同じ） */
        const c = p.bot.ctx;
        p.rpos = p.pos;
        p.quat = [0, 0, 0, 1]; p.rquat = p.quat;
        p.sliding = false; p.slideK = 0; p.firing = false;
        c.viewYaw = p.yaw; c.viewPitch = 0; c.recPitch = 0; c.recYaw = 0; c.adsT = 0;
        c.gunState = this._newGunState(p.gun);
        c.bombState.charges = c.bombState.max; c.bombState.t = 0;
        c.protectT = RULES.spawnProtect;
        c.slideT = 0; c.slideCd = 0; c.slideBufT = -1; c.slideEye = 0; c.jumpBufT = -1; c.coyoteT = -1; c.bjCd = 0; c.bjWin = 0;
        c.beam = null; c.shake = 0;
        c.vm.flash = 0; c.vm.recoil = 0; c.vm.reload = -1; c.vm.ads = 0; c.vm.charge = -1;
        try { p.bot.brain.onRespawn(); } catch (e) {}
      }
    }

    _onStatus(m) {
      if (this.mode !== 'match') return;
      const hp = m.hp || [], al = m.al || [], k = m.k || [], d = m.d || [], pr = m.pr || [];
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        /* hs は順序なしなので、信頼チャンネルの kill / spawn を追いこすことがある。
           「たおれた」は kill（信頼チャンネル）だけが決める。ここで alive を false に
           すると、古い hs が ふっかつ直後の人をもう一度たおしてしまい、二度と戻れない。
           「生き返り」も位置つきの spawn だけが決める。 */
        const waitSpawn = !!al[i] && !p.alive;
        if (!waitSpawn) {
          if (hp[i] !== undefined && (!p.local || Math.abs(p.hp - hp[i]) > 0.6)) p.hp = hp[i];
          if (pr[i] !== undefined) {
            const on = !!pr[i];
            if (!p.local) p.protect = on;
            else if (!on && p.protect) { p.protect = false; this.protectT = 0; }
          }
        }
        /* キル・デスは しあい中は減らない（古い hs で巻きもどさない） */
        if (k[i] !== undefined && (k[i] | 0) > p.kills) p.kills = k[i] | 0;
        if (d[i] !== undefined && (d[i] | 0) > p.deaths) p.deaths = d[i] | 0;
        /* 必殺ゲージ（つかった すぐあとは 古い hs で もどさない） */
        if (m.sp && m.sp[i] !== undefined && !this.isHost && !p.spK && this.time - p.spT0 > 1.5) p.sp = clamp(num(m.sp[i]), 0, 1);
      }
      if (m.tw && this.tower && !this.isHost && this._towerApplyStatus) this._towerApplyStatus(m.tw);
      if (m.df && this.defense && !this.isHost && this._defApplyStatus) this._defApplyStatus(m.df);
      if (m.rd && this.raid && !this.isHost && this._raidApplyStatus) this._raidApplyStatus(m.rd);
      if (m.cs && this.castle && !this.isHost && this._csApplyStatus) this._csApplyStatus(m);
      if (m.sc && this.rule.id !== 'stock') {
        /* 点も同じ（古い hs がキルを打ち消さないように）。ストックは へるので kill だけで決める */
        const s0 = m.sc[0] | 0, s1 = m.sc[1] | 0;
        if (s0 > this.score[0]) this.score[0] = s0;
        if (s1 > this.score[1]) this.score[1] = s1;
      }
      if (m.tl !== undefined && !this.isHost) this.timeLeft = num(m.tl);
    }

    _onSudden() {
      this.suddenDeath = true;
      this.timeLeft = 0;
      CS.UI.hud.center('サドンデス！', '#ffd166', 2200);
      this._sfx('go');
    }

    _onEnd(m) {
      if (this.mode !== 'match' || this.phase === 'over') return;   // 2通目は無視
      this.phase = 'over';
      for (const p of this.players) if (p.spK) this._endSpecial(p);
      const w = m.winner === undefined || m.winner === null ? -1 : (m.winner | 0);
      if (m.score) { this.score[0] = m.score[0] | 0; this.score[1] = m.score[1] | 0; }
      if (m.k) for (let i = 0; i < m.k.length && i < this.players.length; i++) this.players[i].kills = m.k[i] | 0;
      if (m.d) for (let i = 0; i < m.d.length && i < this.players.length; i++) this.players[i].deaths = m.d[i] | 0;
      if (m.st) for (let i = 0; i < m.st.length && i < this.players.length; i++) this.players[i].stock = m.st[i] | 0;
      this._stopLoops();
      try { CS.Input.enable(false); } catch (e) {}
      CS.UI.hud.show(false);
      const rows = [];
      for (const p of this.players) {
        if (!shown(p)) continue;                         // v5.1: コピー・かんせんの人は 出さない（CS2: 城バトルの 部隊も）
        rows.push({
          name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, me: p.idx === this.me,
          stock: p.stock, fc: p.fc || '', bot: !!p.bot
        });
      }
      const me = this.players[this.me];
      const res = {
        winner: w, score: [this.score[0], this.score[1]], rows: rows, isHost: this.isHost, myTeam: me ? me.team : 0,
        rule: { id: this.rule.id, n: this.rule.n },
        cpu: this.offline && this.cpu ? Object.assign({}, this.cpu) : null,
        defense: this.defense && this._defEndInfo ? this._defEndInfo(w) : null,     // v5: クリスタルまもり
        raid: this.raid && this._raidEndInfo ? this._raidEndInfo(w) : null,         // CS2: ボスレイド
        castle: this.castle && this._csEndInfo ? this._csEndInfo(w) : null,        // CS2: 城バトル
        tn: this.tnMatch || null,                                                   // v5.1: みんなで トーナメント
        ranked: !!(this.room && this.room.ranked && !this.offline)                  // v5.3: ランダムマッチ
      };
      this._emit('matchEnd', w);
      /* 勝ったチームのダンス（5秒）→ そのあと結果。ひきわけは すぐ結果（クリスタルまもりで 負けたときも すぐ） */
      if (w >= 0 && !(res.defense && w !== 0) && !(res.raid && w !== 0) && this._startDance && this._startDance(w, res)) return;
      CS.UI.showResult(res);
    }

    _toLobby() {
      if (this.mode !== 'match' && this.mode !== 'lobby') return;
      if (this.dance && this._endDance) this._endDance(true);
      this.dance = null;
      this.zone = null; this.zoneOwner = -1; this.specIdx = -1;
      this._stopLoops();
      try { CS.Input.enable(false); } catch (e) {}
      CS.UI.hud.show(false);
      this._clearEntities();
      this.players = [];
      this.me = -1;
      this.world = null;
      this.mapData = null;
      this.tower = null; this.hostBots = false; this.hold = false;
      this.defense = null; this.kings = null; this.tnMatch = null; this.raid = null; this.castle = null;
      this.iceUntil[0] = this.iceUntil[1] = 0;
      if (this.renderer) this.renderer.ice = 0;
      this.targets.length = 0;
      if (this.renderer && this.renderer.ok) { try { this.renderer.setWorld(null); } catch (e) {} }
      this.mode = 'lobby';
      this.phase = 'lobby';
      this.score = [0, 0];
      this.suddenDeath = false;
      this.endAt = -1;
      /* ホストは tolobby を送る前に「じゅんびOK」を全部おろしている。
         ゲスト側でも同じようにしておく（次の lobby が届くまで ✓ が残らないように） */
      if (this.room) { this.room.started = false; for (const p of this.room.players) p.ready = false; }
      /* ゲスト: ホストの記録とじぶんの ぶき がちがっていたら伝えなおす
         （しあい中・結果画面で変えた分はホストに捨てられているので） */
      if (!this.isHost && this.net && this.room) {
        let rec = null;
        for (const p of this.room.players) if (p.id === this.myNetId) { rec = p; break; }
        const g = this._myGunId(), b = this._myBombId(), g2 = this._myGun2Id(), gm = this._myGm(), gm2 = this._myGm2();
        if (!rec || rec.gun !== g || rec.bomb !== b || (rec.gun2 || '') !== g2 || (rec.gm || '') !== gm || (rec.gm2 || '') !== gm2) this.net.send({ t: 'set', gun: g, gun2: g2, gm: gm, gm2: gm2, bomb: b });
      }
      this._emit('toLobby');
      if (this.isHost) this._broadcastLobby();
      else if (this.room) this._emit('lobby', this.lobbyView());
    }

    _onLeft(m) {
      const p = this.players[m.i | 0];
      if (!p) return;
      p.connected = false;
      p.alive = false;
      /* 撃ちっぱなし（炎・ビーム・ミニガン）のまま落ちた人の音を止める。
         _interpolate は切断した人を先に飛ばすので、そこでは止まらない */
      this._loop('p' + (m.i | 0), 'spin', false);
      CS.UI.toast(p.name + ' が いなくなりました');
    }

    _onReject(m) {
      const why = m.why;
      const text = why === 'full' ? 'へやがいっぱいです' : why === 'started' ? 'しあいが始まっています' : 'バージョンがちがいます';
      this._teardown();
      this._emit('error', text, why);
    }

    _onBye() {
      if (this.isHost) return;
      this._teardown();
      this._emit('hostGone');
    }

    /* 位置の送信 */
    _sendPose() {
      if (!this.net || this.mode !== 'match' || this.me < 0) return;
      const p = this.players[this.me];
      if (!p) return;
      let f = 0;
      if (p.grounded) f |= 1;
      if (p.firing) f |= 2;
      if (p.ads) f |= 4;
      if (p.reloading) f |= 8;
      if (p.spinning) f |= 16;
      if (p.sliding) f |= 32;
      const q = p.quat;
      this._sendOwner({
        t: 'p', d: [this.me, this.seq++, Math.round(CS.now()),
          r2(p.pos[0]), r2(p.pos[1]), r2(p.pos[2]), r3(p.yaw), r3(p.pitch),
          r2(p.vel[0]), r2(p.vel[1]), r2(p.vel[2]),
          r3(q[0]), r3(q[1]), r3(q[2]), r3(q[3]), f, p.gen | 0]
      }, true);
      p.lastReport[0] = p.pos[0]; p.lastReport[1] = p.pos[1]; p.lastReport[2] = p.pos[2];
    }

    /* ==================================================================
       9. Practice（ためし撃ち）
       ================================================================== */
    _updateTargets(dt) {
      for (let i = 0; i < this.targets.length; i++) {
        const tg = this.targets[i];
        if (tg.dead) {
          if (!tg.noRespawn && this.time >= tg.respawnAt) {
            tg.dead = false; tg.hp = tg.max;
            this._addPart(tg.pos[0], tg.pos[1], tg.pos[2], 0, 0, 0, 1.2, 0.5, 1, 0.8, 0.25, 0, 2, 0);
            this._sfx('spawn', tg.pos, 0.5);
          }
          continue;
        }
        tg.hitT = Math.max(0, tg.hitT - dt * 4);
        if (tg.slide > 0) tg.pos[0] = tg.base[0] + Math.sin(this.time * tg.speed + tg.phase) * tg.slide;
      }
    }

    _damageTarget(tg, dmg, head, remote) {
      if (!tg || tg.dead) return;
      dmg = Math.max(0, dmg);
      /* v5: よわよわボムを あびた人の こうげき（ホストへ送る前・ホストが じぶんで 当てたとき） */
      if (!remote) {
        const sh = this.players[this.me];
        if (sh && sh.weakUntil > this.time) dmg *= sh.weakMul || WEAK_MUL;
        if (sh && sh.dmgMul > 0) dmg *= sh.dmgMul;          // v5: クリスタルまもりの てき
      }
      if (tg.take > 0) dmg *= tg.take;                      // v5: クリスタルは かたい
      const coop = !!(this.tower && this.tower.coop);
      /* v4: みんなで塔のぼりの ゲスト: クリスタルの HP は ホストが きめる（手ごたえだけ出して ホストへ） */
      if (coop && !this.isHost) {
        tg.hitT = 1;
        this._pushDmgNum(tg, dmg, head);
        this._hitFx(tg.pos, 1);
        this._toHost({ t: 'tgh', i: this.me, g: this.targets.indexOf(tg), d: r2(dmg) });
        return;
      }
      tg.hp -= dmg;
      tg.hitT = 1;
      this.practiceStats.hits++;
      this.practiceStats.damage += dmg;
      if (!remote && !this.defense) this._pushDmgNum(tg, dmg, head);
      this._hitFx(tg.pos, 1);
      if (tg.hp <= 0) {
        tg.dead = true;
        tg.hp = 0;
        tg.respawnAt = this.time + 2;
        this.practiceStats.kills++;
        this._boom(tg.pos, tg.noRespawn ? 1.8 : 1, tg.color || [0.5, 1, 0.9], !!tg.noRespawn);
        this._sfx(tg.noRespawn ? 'explode' : 'explode_small', tg.pos, 0.6);
        /* ためし撃ち: まとを こわすと 必殺ゲージ */
        if (this.mode === 'practice') this._addSp(this.players[this.me], CS.Specials ? CS.Specials.GAIN_TARGET : 0.34);
        if (this.tower && this._towerTargetDown) this._towerTargetDown(tg);
      }
      /* みんなで塔のぼり・クリスタルまもり（v5）: ホストが きめた HP を みんなへ（まもりは こまめに 送りすぎない） */
      if (this.isHost && (coop || (this.defense && this.net))) {
        const now = this.time;
        if (!this.defense || tg.dead || now - (tg.sentT || -9) > 0.15) {
          tg.sentT = now;
          this._broadcast({ t: 'tg', g: this.targets.indexOf(tg), hp: Math.round(tg.hp), d: tg.dead ? 1 : 0 });
        }
      }
    }

    _pushDmgNum(tg, dmg, head) {
      /* スナイパーマシンガン（当たれば 一発）は 数字の かわりに「一発！」 */
      const one = CS.Specials && dmg >= CS.Specials.ONE_SHOT;
      this._dmgNums.push({
        x: tg.pos[0] + (rnd() - 0.5) * 0.3, y: tg.pos[1] + 0.4, z: tg.pos[2] + (rnd() - 0.5) * 0.3,
        text: one ? '一発！' : (head ? '★' : '') + Math.round(dmg), t: 0, head: !!head || one
      });
      if (this._dmgNums.length > 14) this._dmgNums.shift();
    }

    /* v4: ホスト: ゲストが クリスタルに 当てた（ぶきの さいだいダメージで おさえる） */
    _hostTargetHit(msg, fromId) {
      if (this.mode !== 'match' || this.phase !== 'live' || !this.tower) return;
      const idx = this._idxOf(fromId);
      const a = this.players[idx];
      if (!a || !a.alive || (msg.i | 0) !== idx) return;
      const tg = this.targets[msg.g | 0];
      if (!tg || tg.dead) return;
      const W = CS.Weapons;
      const cap = Math.max(W.maxDamage(a.gun), W.maxDamage(a.bomb)) * DMG_SLACK;
      const d = Math.min(num(msg.d), cap);
      if (!(d > 0)) return;
      this._damageTarget(tg, d, false, true);
    }

    /* v4: みんなが受け取る: クリスタルの HP（ホストが きめたもの） */
    _onTarget(m) {
      const tg = this.targets[m.g | 0];
      if (!tg || this.isHost) return;
      tg.hp = Math.max(0, num(m.hp));
      if (m.d && !tg.dead) {
        tg.dead = true;
        this._boom(tg.pos, tg.noRespawn ? 1.8 : 1, tg.color || [0.5, 1, 0.9], !!tg.noRespawn);
        this._sfx(tg.noRespawn ? 'explode' : 'explode_small', tg.pos, 0.6);
        if (this.tower && this.tower.state === 'fight') {
          let n = 0;
          for (const t of this.targets) if (!t.dead) n++;
          if (n > 0) CS.UI.hud.center('クリスタル のこり ' + n, '#8ff0ff', 900);
        }
      }
    }

    /* ==================================================================
       10. Render & HUD
       ================================================================== */
    _draw() {
      const r = this.renderer;
      if (!r) return;
      const me = this.players[this.me];

      /* 相手 */
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (i === this.me || i === this.specIdx) continue;
        if (!p.alive && p.connected) continue;
        if (p.fade <= 0.01) continue;
        /* CS2: ボスレイドの ボス */
        if (p.raidBoss) { if (this._raidDrawBoss) this._raidDrawBoss(r, p); continue; }
        /* CS2: 城バトルの 砲台 */
        if (p.turret && this._csDrawTurret) { this._csDrawTurret(r, p); continue; }
        const rp = this._rp || (this._rp = {});
        rp.pos = p.rpos; rp.quat = p.rquat; rp.yaw = p.ryaw; rp.pitch = p.rpitch; rp.team = p.team;
        rp.gun = p.gun; rp.flash = p.flash; rp.protect = p.protect || p.shield; rp.hit = p.hitFx;
        rp.alpha = p.connected ? 1 : p.fade; rp.spin = p.bot ? p.spin : p.spinAng;
        rp.charge = p.bot ? p.charge : 0; rp.side = p.side; rp.slide = p.slideK;
        rp.skin = p.skin; rp.boss = !!p.boss;
        rp.tank = p.spK === 'tank' && p.alive;            // v5: 必殺技 せんしゃ
        r.player(rp);
        /* v5: バブル: まわりに シャボン玉（大きな うすい 光と きらきら） */
        if (p.spK === 'bubble' && p.alive) this._drawBubble(r, p.rpos);
        /* v5.1: こおりボムで こおっている: 氷の かたまり */
        if (p.frozenUntil > this.time && p.alive) this._drawIce(r, p.rpos);
        /* v5: キングバトル: キングの 頭に 王冠 */
        if (p.king && p.alive) this._drawCrown(r, p.rpos);
        /* 相手のビーム */
        if (p.firing && p.gun.type === 'beam' && p.alive) {
          const m = this._remoteMuzzle(p, this._tp2);
          const dir = V.forward(p.ryaw, p.rpitch);
          const rc = this.world ? this.world.raycast(m, dir, p.gun.range || 40, this._rc) : null;
          const t = rc ? rc.t : (p.gun.range || 40);
          this._tp[0] = m[0] + dir[0] * t; this._tp[1] = m[1] + dir[1] * t; this._tp[2] = m[2] + dir[2] * t;
          r.line(m, this._tp, p.gun.tracer, (p.gun.beam && p.gun.beam.width) || 0.06, 0.9);
        }
      }

      /* 的（塔のぼりのクリスタルは 色つきで くるくる回る） */
      for (let i = 0; i < this.targets.length; i++) {
        const tg = this.targets[i];
        if (tg.dead) continue;
        const k = tg.hp / tg.max;
        if (tg.color) {
          const c = tg.color, h = tg.hitT;
          this._tc[0] = c[0] + (1 - c[0]) * h; this._tc[1] = c[1] * (0.55 + 0.45 * k) + (1 - c[1]) * h; this._tc[2] = c[2] + (1 - c[2]) * h;
          this._oCube.emissive = 0.35 + h * 0.6 + 0.15 * Math.sin(this.time * 4 + i);
          const q = this._tq || (this._tq = [0, 0, 0, 1]);
          const a = this.time * 1.4 + i, s = Math.sin(a * 0.5), qq = Q.normalize([0.35 * s, Math.sin(a), 0, Math.cos(a)]);
          q[0] = qq[0]; q[1] = qq[1]; q[2] = qq[2]; q[3] = qq[3];
          const tsz = tg.size || 0.8;
          r.cube(tg.pos, q, tsz, this._tc, this._oCube);
          r.particle(tg.pos, 1.8 * tsz / 0.8, c, 0.25 + 0.1 * Math.sin(this.time * 3 + i));
          continue;
        }
        this._tc[0] = 0.35 + 0.65 * tg.hitT + (1 - k) * 0.5;
        this._tc[1] = 0.85 * k + tg.hitT * 0.15;
        this._tc[2] = 0.75 * k + tg.hitT * 0.25;
        this._oCube.emissive = 0.15 + tg.hitT * 0.6;
        r.cube(tg.pos, null, 0.9, this._tc, this._oCube);
      }

      /* CS2: ボスレイドの 予告つき こうげき */
      if (this.raid && this._raidDraw) this._raidDraw(r);
      /* CS2: 城バトルの 基地・はた */
      if (this.castle && this._csDraw) this._csDraw(r);
      /* エリア */
      if (this.zone) this._drawZone(r);
      /* 塔のぼり（出口の光・ボスのしるし） */
      if (this.tower && this._drawTower) this._drawTower(r);

      /* 弾 */
      for (let i = 0; i < this.projectiles.length; i++) {
        const p = this.projectiles[i];
        if (p.hidden) continue;
        const s = Math.max(0.05, p.pr.size || 0.1);
        /* v5.2: 銃のスキン「アイスバー」の人の 弾 */
        if (iceBar(this.players[p.owner])) { this._drawIceBar(r, p.pos, p.vel[0], p.vel[1], p.vel[2], clamp(s / 0.1, 1.5, 2.6)); continue; }
        /* CS2: 速い弾は 光の 線（うしろへ のびる） */
        if (p.pr.fast) {
          const sp = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) || 1;
          const L = Math.min(1.8, sp * 0.011, p.dist + 0.05);
          this._tp[0] = p.pos[0] - p.vel[0] / sp * L; this._tp[1] = p.pos[1] - p.vel[1] / sp * L; this._tp[2] = p.pos[2] - p.vel[2] / sp * L;
          r.line(this._tp, p.pos, p.gun.tracer, Math.max(0.035, (p.gun.tracerWidth || 0.03) * 1.3), 0.95);
          r.particle(p.pos, Math.max(0.12, s * 2.2), p.gun.tracer, 0.85);
          continue;
        }
        this._oEm.emissive = 0.9;
        /* ブーメランは くるくる まわる */
        if (p.pr.boomer > 0) {
          const q = this._bmq || (this._bmq = [0, 0, 0, 1]);
          const a = p.age * 18, qq = Q.fromAxisAngle([0, 1, 0], a);
          q[0] = qq[0]; q[1] = qq[1]; q[2] = qq[2]; q[3] = qq[3];
          M4.fromTRS(this._bmM || (this._bmM = M4.create()), p.pos, q, [s * 1.6, s * 0.3, s * 0.5]);
          r.box(this._bmM, p.gun.tracer, this._oEm);
          continue;
        }
        /* ブラックホールの 玉は 黒い */
        if (p.pr.field) { r.cube(p.pos, null, s, [0.05, 0.02, 0.09], this._oDark || (this._oDark = { emissive: 0, frame: 0.01 })); r.particle(p.pos, s * 3.2, p.gun.tracer, 0.8); continue; }
        r.cube(p.pos, null, s, p.gun.tracer, this._oEm);
        r.particle(p.pos, s * 2.6, p.gun.tracer, 0.75);
      }

      /* ボム */
      for (let i = 0; i < this.bombs.length; i++) {
        const b = this.bombs[i];
        const def = b.def;
        const blink = b.impact ? 1 : (b.fuse < 0.6 ? (Math.sin(this.time * 40) > 0 ? 1 : 0.25) : 0.55);
        const s = b.mini ? def.size * 0.7 : def.size;
        this._oEm.emissive = 0.35 + 0.5 * blink;
        r.cube(b.pos, null, s, def.color, this._oEm);
        r.particle(b.pos, s * 2.2, def.color, 0.35 + 0.4 * blink);
      }

      /* けむり */
      for (let i = 0; i < this.smokes.length; i++) {
        const s = this.smokes[i];
        const grow = Math.min(1, s.t * 2.2);
        const fade = clamp((s.dur - s.t) / 1.5, 0, 1);
        const rr = s.r * grow;
        for (let k = 0; k < 9; k++) {
          const a = k * 2.399 + s.t * 0.25;
          const rad = rr * (0.18 + (k % 3) * 0.28);
          this._tp[0] = s.pos[0] + Math.cos(a) * rad;
          this._tp[1] = s.pos[1] + Math.sin(s.t * 0.7 + k) * rr * 0.28 + rr * 0.15;
          this._tp[2] = s.pos[2] + Math.sin(a) * rad;
          this._tc[0] = 0.5; this._tc[1] = 0.53; this._tc[2] = 0.6;
          this._oSmoke.alpha = 0.3 * fade;
          r.cube(this._tp, null, rr * (0.9 + (k % 3) * 0.2), this._tc, this._oSmoke);
        }
      }

      /* CS2: ブラックホール */
      for (let i = 0; i < this.fields.length; i++) {
        const f = this.fields[i];
        const life = clamp((f.until - this.time) / 0.4, 0, 1) * clamp((this.time - f.t0) * 4, 0, 1);
        const rr = f.r * 0.32 * life;
        const q = this._fq || (this._fq = [0, 0, 0, 1]);
        const qq = Q.normalize([Math.sin(this.time * 1.7) * 0.4, Math.sin(this.time * 2.3), 0.2, Math.cos(this.time * 2.3)]);
        q[0] = qq[0]; q[1] = qq[1]; q[2] = qq[2]; q[3] = qq[3];
        r.cube(f.pos, q, rr, [0.03, 0.01, 0.06], this._oFieldCore || (this._oFieldCore = { emissive: 0, frame: 0.02 }));
        r.particle(f.pos, f.r * 1.6 * life, [0.55, 0.3, 1.0], 0.28);
        r.particle(f.pos, f.r * 0.9 * life, [0.85, 0.6, 1.0], 0.35 + 0.1 * Math.sin(this.time * 9));
      }

      /* 粒 */
      for (let i = 0; i < MAX_PARTS; i++) {
        const p = this.parts[i];
        if (p.life <= 0) continue;
        const a = p.life / p.max;
        this._tp[0] = p.x; this._tp[1] = p.y; this._tp[2] = p.z;
        this._tc[0] = p.r; this._tc[1] = p.g; this._tc[2] = p.b;
        r.particle(this._tp, p.s * (0.45 + 0.55 * a), this._tc, a);
      }

      /* 弾道 */
      for (let i = 0; i < MAX_TRACERS; i++) {
        const t = this.tracers[i];
        if (t.life <= 0) continue;
        const a = t.life / t.max;
        /* v5.2: アイスバーの 弾: 線の かわりに アイスバーが とんで いく */
        if (t.ice) {
          const k = 1 - a;
          this._tp[0] = t.ax + (t.bx - t.ax) * k; this._tp[1] = t.ay + (t.by - t.ay) * k; this._tp[2] = t.az + (t.bz - t.az) * k;
          this._drawIceBar(r, this._tp, t.bx - t.ax, t.by - t.ay, t.bz - t.az, 1.5);
          continue;
        }
        this._tp[0] = t.ax; this._tp[1] = t.ay; this._tp[2] = t.az;
        this._tp2[0] = t.bx; this._tp2[1] = t.by; this._tp2[2] = t.bz;
        this._tc[0] = t.r; this._tc[1] = t.g; this._tc[2] = t.b;
        r.line(this._tp, this._tp2, this._tc, t.w * (0.5 + 0.5 * a), a);
      }

      /* 自分のビーム */
      if (this.beam) r.line(this.beam.a, this.beam.b, this.beam.c, this.beam.w, 0.95);

      /* ビューモデル（せんしゃの あいだは うしろから 見るので じぶんの せんしゃを かく） */
      if (me && me.alive && this.phase !== 'over') {
        if (this.tps) {
          const sp = this._selfRp || (this._selfRp = {});
          sp.pos = me.pos; sp.quat = me.quat; sp.yaw = me.yaw; sp.pitch = me.pitch; sp.team = me.team;
          sp.gun = me.gun; sp.flash = this.vm.flash; sp.protect = me.protect; sp.hit = 0; sp.alpha = 1;
          sp.spin = 0; sp.charge = 0; sp.side = 0; sp.slide = 0; sp.skin = me.skin; sp.tank = true;
          r.player(sp);
        } else r.viewModel(me.gun, this.vm);
      }
      r.end();
    }

    /* エリア: うすく光る箱と、ふちの線。とっているチームの色（とりあい中は黄色で点めつ） */
    _drawZone(r) {
      const z = this.zone;
      let c;
      if (this.zoneFight) c = (Math.sin(this.time * 10) > 0) ? [1, 0.85, 0.3] : [1, 1, 1];
      else if (this.zoneOwner >= 0) c = CS.TEAM_COLORS[this.zoneOwner];
      else c = [0.9, 0.95, 1];
      const m = this._zm || (this._zm = M4.create());
      const top = Math.min(z.y1, z.y0 + 4);
      M4.fromTRS(m, [z.cx, (z.y0 + top) / 2, z.cz], [0, 0, 0, 1], [z.x1 - z.x0, top - z.y0, z.z1 - z.z0]);
      r.box(m, c, { additive: true, alpha: 0.05 + 0.02 * Math.sin(this.time * 3) });
      const y = z.y0 + 0.03, w = 0.09, a = 0.8;
      const P = this._zp || (this._zp = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]);
      P[0][0] = z.x0; P[0][2] = z.z0; P[1][0] = z.x1; P[1][2] = z.z0; P[2][0] = z.x1; P[2][2] = z.z1; P[3][0] = z.x0; P[3][2] = z.z1;
      for (let i = 0; i < 4; i++) P[i][1] = y;
      for (let i = 0; i < 4; i++) {
        r.line(P[i], P[(i + 1) % 4], c, w, a);
        const up = this._tp2; up[0] = P[i][0]; up[1] = top; up[2] = P[i][2];
        r.line(P[i], up, c, w * 0.7, a * 0.6);
      }
    }

    _hud(dt) {
      const me = this.players[this.me];
      if (!me) return;
      const g = me.gun, w = this.gunState, b = me.bomb, bs = this.bombState;
      const ui = CS.UI.hud;

      /* ボムのクールダウン（進めるのは _tickBombCd） */
      const bombCd = bs.charges >= bs.max ? 0 : clamp(bs.t / (bs.cd || 1), 0, 1);

      /* ひろがり（px） */
      const sd = this._spreadDeg(g);
      const hpx = this.renderer ? this.renderer.height : 600;
      const fovR = (this.fov || 78) * D2R;
      const spread = clamp(Math.tan(sd * D2R) / Math.max(0.05, Math.tan(fovR / 2)) * hpx * 0.5, 0, 140);

      let ping = 0, warn = false;
      if (this.net) {
        const v = this.net.rtt();
        ping = isFinite(v) ? Math.round(v) : 0;
        warn = ping > 220;
      }
      me.ping = ping;

      const scoped = this.adsT >= 0.9 && g.zoom > 0 && g.zoom <= 0.45;
      const s = this._hudS;
      s.hp = me.hp; s.maxHp = me.maxHp || RULES.hp;
      const inf = me.spK === 'smg' || me.spK === 'tank';   // スナイパーマシンガン・せんしゃ: 弾は むげん
      s.ammo = inf ? '∞' : Math.max(0, w.ammo); s.mag = inf ? '∞' : g.mag;
      s.reload = w.reloadT >= 0 ? clamp(1 - w.reloadT / (w.reloadDur || 1), 0, 1) : -1;
      s.bombCharges = bs.charges; s.bombMax = bs.max; s.bombCd = bombCd; s.bombName = b.name;
      s.score = this.score; s.goal = this._goalText();
      s.time = this.mode === 'practice' ? this.time : this.timeLeft;   // ためし撃ちは経過時間を出す
      s.zone = this.zone ? (this.zoneFight ? 'エリア とりあい中！' : this.zoneOwner >= 0 ? 'エリア: ' + CS.TEAM_NAMES[this.zoneOwner] + 'チーム' : 'エリア: だれもいない') : '';
      s.zoneTeam = this.zone && !this.zoneFight ? this.zoneOwner : -1;
      /* v5: キングバトル: 両チームの キングの HP */
      if (this.rule.id === 'king' && this.kings) {
        const kt = (t) => { const k = this._king(t); return k ? (k.alive && k.connected ? Math.ceil(k.hp) + '/' + (k.maxHp | 0) : 'たおれた') : '-'; };
        s.zone = 'キング  ' + CS.TEAM_NAMES[0] + ' ' + kt(0) + '  ／  ' + CS.TEAM_NAMES[1] + ' ' + kt(1) + (me.king ? '  （あなたが キング）' : '');
        s.zoneTeam = me.king ? me.team : -1;
      }
      s.stock = this.rule.id === 'stock' ? Math.max(0, me.stock) : -1;
      s.ping = ping; s.myTeam = me.team; s.spread = spread;
      s.scope = scoped; s.protect = !!(me.protect || me.shield);
      s.protectT = me.shield ? Math.max(0, me.spEnd - this.time) : (me.protect && this.protectT > 0 ? this.protectT : 0);
      s.charge = w.charge >= 0 ? clamp(w.charge, 0, 1) : (g.spinup > 0 && w.spin > 0.02 ? w.spin : -1);
      /* 1発ごとに 待つ銃（スナイパー・マグナム など）: まんなかの 少し上に「つぎに 撃てるまで」のバー。
         まんたんで 撃てる。撃てるように なったら 少しのあいだ「OK！」 */
      const iv = g.rpm > 0 ? 60 / g.rpm : 0;
      const g0 = CS.GunMap[g.id] || g;                   // 塔のぼりの れんしゃチップで 速くなっても 出しつづける
      let wv = -1, wm = '';
      if (g0.rpm > 0 && 60 / g0.rpm >= WAIT_BAR_MIN && !inf && me.alive && this.phase !== 'over') {
        if (w.reloadT >= 0) { wv = clamp(1 - w.reloadT / (w.reloadDur || 1), 0, 1); wm = 'rel'; this._waitOkT = WAIT_OK_T; }
        else if (w.cool > 0) { wv = clamp(1 - w.cool / iv, 0, 1); wm = 'cool'; this._waitOkT = WAIT_OK_T; }
        else if (this._waitOkT > 0) { this._waitOkT -= dt; wv = 1; wm = 'ok'; }
      } else this._waitOkT = 0;
      s.wait = wv; s.waitMode = wm;
      /* v5: いまの銃と もう1つの銃 */
      const two = me.guns && me.guns.length > 1;
      const gnm = (x) => (x ? (x.name || '') + (x.partsN > 0 ? ' ＋' + x.partsN : '') : '');
      s.gunNow = gnm(g);
      s.gunOther = two ? gnm(me.guns[1 - (me.slot | 0)]) : '';
      s.swapKey = CS.Input.isTouch ? '切替' : 'X';
      if (CS.Input.setSwap) CS.Input.setSwap(two && me.alive && me.spK !== 'smg' && me.spK !== 'tank');
      /* v5: じょうたい（こうげき力ダウン・バブル など） */
      let stTxt = '';
      if (me.alive && me.frozenUntil > this.time) stTxt = 'こおっている ' + Math.ceil(me.frozenUntil - this.time) + '秒（うごけない）';
      else if (me.alive && me.weakUntil > this.time) stTxt = 'こうげき力 ダウン ' + Math.ceil(me.weakUntil - this.time) + '秒';
      else if (me.alive && me.spK === 'bubble') stTxt = 'バブル ' + Math.ceil(Math.max(0, me.spEnd - this.time)) + '秒（ジャンプで 上・スライドで 下）';
      else if (me.alive && me.spK === 'tank') stTxt = 'せんしゃ ' + Math.ceil(Math.max(0, me.spEnd - this.time)) + '秒（ダメージ 3分の1）';
      else if (me.alive && me.spK === 'clone') stTxt = 'コピー ' + Math.ceil(Math.max(0, me.spEnd - this.time)) + '秒';
      /* v5.2: アイスフィールド（すべる がわ・すべらせる がわ） */
      else if (me.alive && this.iceUntil[me.team] > this.time) stTxt = 'こおりの 床で すべる！ ' + Math.ceil(this.iceUntil[me.team] - this.time) + '秒';
      else if (me.alive && this.iceUntil[1 - me.team] > this.time) stTxt = 'アイスフィールド ' + Math.ceil(this.iceUntil[1 - me.team] - this.time) + '秒（あいてが すべる）';
      /* CS2: スロー・ガード・パワー・スピード */
      else if (me.alive && me.fx) {
        const f = me.fx, t = this.time, L = [];
        if (f.slow > t) L.push('足が おそい ' + Math.ceil(f.slow - t) + '秒');
        if (f.guard > t) L.push('ガード ' + Math.ceil(f.guard - t) + '秒');
        if (f.pow > t) L.push('パワーアップ ' + Math.ceil(f.pow - t) + '秒');
        if (f.spd > t) L.push('スピードアップ ' + Math.ceil(f.spd - t) + '秒');
        stTxt = L.join(' ・ ');
      }
      s.status = stTxt;
      /* v5.4: 大ジャンプ（じゅんびOK / あと なん秒）。-1 = 出さない */
      const bjShow = me.alive && this.phase !== 'over' && !me.spec;
      s.bj = bjShow ? Math.max(0, this.bjCd || 0) : -1;
      s.netWarn = warn;
      s.tower = null;
      if (this.tower && this._towerHud) this._towerHud(s);
      if (this.defense && this._defHud) this._defHud(s);          // v5: クリスタルまもり
      if (this.raid && this._raidHud) this._raidHud(s);             // CS2: ボスレイド
      if (this.castle && this._csHud) this._csHud(s);               // CS2: 城バトル
      ui.update(s);

      /* v4: 必殺技のゲージ（まんたんに なったら おしらせ） */
      if (CS.Specials) {
        const sh = this._spHud || (this._spHud = {});
        sh.sp = me.sp || 0; sh.kind = me.spK; sh.left = me.spK ? Math.max(0, me.spEnd - this.time) : 0;
        sh.dur = me.spDur || 8; sh.my = CS.Specials.mineId();
        CS.Specials.hud(sh);
        const ready = !me.spK && me.sp >= 0.999 && me.alive && this.phase === 'live';
        if (ready && !this._spReadyShown) {
          this._spReadyShown = true;
          this._sfx('spready');
          ui.center('必殺技 OK！ ' + (CS.Input.isTouch ? '「必殺」を タッチ' : 'F キー'), '#ffe066', 1400);
        } else if (!(me.sp >= 0.999)) this._spReadyShown = false;
      }

      const ih = this._hudI;
      ih.bombCharges = bs.charges; ih.bombMax = bs.max; ih.bombCd = bombCd;
      ih.ammo = w.ammo; ih.mag = g.mag; ih.reloading = w.reloadT >= 0;
      ih.ads = this.adsT > 0.5; ih.canAds = g.zoom > 0 && g.zoom < 1;
      CS.Input.setHud(ih);
      if (CS.Input.setBigJump) CS.Input.setBigJump(bjShow ? 1 - clamp((this.bjCd || 0) / BJ.cd, 0, 1) : -1);

      /* ふっかつ（ストックがなくなったら「おうえん」） */
      if (!me.alive) {
        if (me.out) ui.respawn(0, this.respawnKiller || '', me.spec ? 'spec' : this.tower ? 'over' : this.specIdx >= 0 ? 'watch' : 'out');
        else {
          this.respawnT = this.respawnT === undefined ? RULES.respawn : this.respawnT - dt;
          ui.respawn(Math.max(0, this.respawnT), this.respawnKiller || '');
        }
      } else ui.respawn(-1);

      /* なまえタグ */
      this._updateTags();

      /* スコア表 */
      const wantBoard = this.lastBoard;
      if (wantBoard) {
        const rows = this._boardRows;
        rows.length = 0;
        for (const p of this.players) {
          if (!shown(p)) continue;                       // v5.1: コピー・かんせんの人は スコア表に 出さない（CS2: 部隊も）
          rows.push({
            name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, ping: this.offline ? null : p.ping, me: p.idx === this.me,
            alive: p.alive && p.connected, stock: this.rule.id === 'stock' ? Math.max(0, p.stock) : undefined
          });
        }
        ui.board(true, rows);
      } else ui.board(false);
    }

    /* v5: シャボン玉 */
    _drawBubble(r, c) {
      const t = this.time;
      r.particle(c, 2.9, [0.45, 0.75, 1.0], 0.24);
      r.particle(c, 2.3, [0.75, 0.92, 1.0], 0.12);
      /* シャボン玉の ふち: カメラに 向いた 輪（つぶを 輪に ならべる） */
      const ce = this._viewEye || this.eye;
      let fx = c[0] - ce[0], fz = c[2] - ce[2];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const tp = this._bbp || (this._bbp = [0, 0, 0]);
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2 + t * 0.4;
        tp[0] = c[0] + (-fz) * Math.cos(a) * 1.1; tp[1] = c[1] + Math.sin(a) * 1.1; tp[2] = c[2] + fx * Math.cos(a) * 1.1;
        r.particle(tp, 0.22, [0.7, 0.9, 1], 0.55);
      }
      /* きらっと ひかる ところ */
      tp[0] = c[0] - fz * 0.45 - fx * 0.5; tp[1] = c[1] + 0.55; tp[2] = c[2] + fx * 0.45 - fz * 0.5;
      r.particle(tp, 0.4, [1, 1, 1], 0.8);
    }

    /* v5.1: 氷の かたまり（こおりボム） */
    _drawIce(r, c) {
      const o = this._oIce || (this._oIce = { alpha: 0.4, emissive: 0.35, frame: 0.05 });
      r.cube(c, null, 1.3, [0.72, 0.93, 1.0], o);
      const t = this.time, tp = this._icp || (this._icp = [0, 0, 0]);
      for (let i = 0; i < 3; i++) {
        const a = t * 1.3 + i * 2.1;
        tp[0] = c[0] + Math.cos(a) * 0.62; tp[1] = c[1] + 0.45 * Math.sin(t * 2 + i); tp[2] = c[2] + Math.sin(a) * 0.62;
        r.particle(tp, 0.18, [1, 1, 1], 0.7);
      }
    }

    /* 画面の上に出す「勝ちかた」 */
    _goalText() {
      const r = this.rule;
      if (this.suddenDeath) return r.id === 'area' ? 'サドンデス！先にカウント' : r.id === 'king' ? 'サドンデス！キングを たおせ' : 'サドンデス！次のキルで決着';
      if (r.id === 'king') return 'あいての キングを たおせ';
      if (r.id === 'defense') return 'クリスタルを まもれ';
      if (r.id === 'raid') return 'ボスを たおせ';
      if (r.id === 'castle') return 'あいての 城を こわせ';
      if (r.id === 'kills') return r.n + 'キルで勝ち';
      if (r.id === 'time') return 'たくさん倒せば勝ち';
      if (r.id === 'stock') return 'のこりの合計';
      if (r.id === 'area') return r.n + 'カウントで勝ち';
      return '';
    }

    /* ワールド座標 → 画面（確保なし）。画面外・背後なら false */
    _project(vp, x, y, z) {
      const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (w <= 0.05) return false;
      const nx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
      const ny = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
      this._sp[0] = (nx * 0.5 + 0.5) * this.renderer.width;
      this._sp[1] = (0.5 - ny * 0.5) * this.renderer.height;
      this._sp[2] = w;
      return true;
    }

    _tag(x, y, text, team, dist) {
      const n = this._tagList.length;
      let t = this._tagPool[n];
      if (!t) { t = { x: 0, y: 0, text: '', team: 0, dist: 0 }; this._tagPool.push(t); }
      t.x = x; t.y = y; t.text = text; t.team = team; t.dist = dist;
      this._tagList.push(t);
    }

    _updateTags() {
      const list = this._tagList;
      list.length = 0;
      const r = this.renderer;
      if (!r) { CS.UI.hud.tags(list); return; }
      const me = this.players[this.me];
      const vp = r.viewProj;
      const eye = this._viewEye || this.eye;
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (i === this.me || i === this.specIdx || !p.alive || !p.connected) continue;
        const d = V.dist(eye, p.rpos);
        if (d > TAG_RANGE) continue;
        const friend = p.team === me.team;
        const hb = this._hurt(p);
        const c = this._hc;
        c[0] = p.rpos[0]; c[1] = hb.cy; c[2] = p.rpos[2];
        if (!friend && !this.world.lineClear(eye, c)) continue;
        if (this._inSmoke(eye[0], eye[1], eye[2], c[0], c[1], c[2])) continue;
        if (!this._project(vp, c[0], hb.cy + hb.hh + (p.skin && p.skin.h !== 'none' ? 0.52 : 0.24), c[2])) continue;
        this._tag(this._sp[0], this._sp[1], (p.king ? 'キング・' : '') + p.name, p.team, friend ? Math.max(d, 26) : d);
      }
      /* ためし撃ちのダメージ表示 */
      for (let i = 0; i < this._dmgNums.length; i++) {
        const d = this._dmgNums[i];
        if (!this._project(vp, d.x, d.y, d.z)) continue;
        this._tag(this._sp[0], this._sp[1], d.text, d.head ? 1 : 0, 1 + d.t * 30);
      }
      CS.UI.hud.tags(list);
    }

    /* ==================================================================
       フレーム
       ================================================================== */
    /* rAF が止まっていても（タブを裏にしても）進めるホストの仕事。
       main.js の実時間タイマーが、frame() が来ていない時間の分だけ呼ぶ。
       カウントダウン・ふっかつ・むてき・回復・やけど・時間・hs・終わりの判定だけ。入力も描画もしない。 */
    hostTick(dt) {
      if (!this.isHost) return;
      if (this.offline) return;          // コンピューター戦は画面が止まればゲームも止まる
      if (this.mode !== 'match' && this.mode !== 'lobby') return;
      if (!(dt > 0)) return;
      if (dt > HOST_CATCHUP_MAX) dt = HOST_CATCHUP_MAX;
      while (dt > 1e-6) {
        const s = dt > HOST_STEP ? HOST_STEP : dt;
        dt -= s;
        this.time += s;
        if (this.mode === 'match' && this.world) this._tickCountdown(s);
        this._hostTick(s);
        if (this.mode === 'match') this._tickSpecials(s);
      }
    }

    /* カウントダウン（ホストは cd を送り、0 で live にする） */
    _tickCountdown(dt) {
      if (this.phase !== 'countdown') return;
      this.countdown -= dt;
      if (this.isHost) {
        const n = Math.ceil(this.countdown);
        if (this._cdLast === undefined) this._cdLast = COUNTDOWN + 1;
        if (n < this._cdLast && n >= 1) { this._cdLast = n; this._broadcast({ t: 'cd', n: n }); }
        if (this.countdown <= 0) {
          this._cdLast = undefined;
          this.phase = 'live';
          this.matchTime = 0;
          this._broadcast({ t: 'cd', n: 0 });
          for (const p of this.players) {
            p.protect = true;
            p.protectUntil = this.time + RULES.spawnProtect;
            /* 塔のぼりは 階のはじめから 敵が せめてくる（出てきたばかり は やられて もどったときだけ） */
            p.safeUntil = this.tower ? 0 : this.time + RULES.spawnProtect + SAFE_EXTRA;
            p.lastDmgT = this.time;
            if (p.bot) p.bot.ctx.protectT = RULES.spawnProtect;
          }
          this.protectT = RULES.spawnProtect;
        }
      } else if (this.countdown <= 0) {
        this.phase = 'live';
        this.protectT = RULES.spawnProtect;
        /* ホストと同じタイミングで むてき を入れなおす。
           _beginMatch で付けた分はカウントダウン中に切れてしまうため。 */
        for (const p of this.players) p.protect = true;
      }
    }

    /* ボムの回復（操作している人のぶん）。ボムラッシュ中は 0.4秒で 1こ もどる */
    _tickBombCd(dt) {
      const bs = this.bombState;
      const me = this.players[this.me];
      if (me && me.spK === 'rush' && bs.charges < bs.max && bs.t > 0.4) bs.t = 0.4;
      if (bs.charges < bs.max) {
        bs.t -= dt;
        if (bs.t <= 0) { bs.charges++; bs.t = bs.charges < bs.max ? bs.cd : 0; }
      } else bs.t = 0;
    }

    /* ==================================================================
       コンピューター（オフラインのときだけ）
       頭脳（CS.Bots）が出す入力で、自分と同じ _updateLocal / _updateWeapon を動かす。
       そのあいだは this.me と「操作する人の持ち物」（CTX_KEYS）をボットのものに入れかえる。
       ================================================================== */
    _swapCtx(ctx) {
      for (let i = 0; i < CTX_KEYS.length; i++) {
        const k = CTX_KEYS[i], t = this[k];
        this[k] = ctx[k]; ctx[k] = t;
      }
    }

    _enterBot(p) {
      const b = p.bot;
      this._swapCtx(b.ctx);
      b.saveMe = this.me;
      this.me = p.idx;
      this._bot = p;
    }

    _leaveBot(p) {
      const b = p.bot;
      this.me = b.saveMe;
      this._bot = null;
      this._swapCtx(b.ctx);
    }

    /* 頭脳にわたす「見えているもの」（入れものは使い回し） */
    _botView(p) {
      const b = p.bot, c = b.ctx, v = b.view, s = v.self;
      v.time = this.time; v.world = this.world; v.players = this.players;
      s.idx = p.idx; s.team = p.team; s.pos = p.pos; s.vel = p.vel; s.yaw = p.yaw; s.pitch = p.pitch;
      s.eye = c.eye; s.grounded = p.grounded; s.alive = p.alive; s.hp = p.hp; s.maxHp = p.maxHp || RULES.hp; s.protect = p.protect; s.sliding = p.sliding;
      s.gun = p.gun; s.ammo = c.gunState.ammo; s.reloading = c.gunState.reloadT >= 0;
      s.bomb = p.bomb; s.bombCharges = c.bombState.charges;
      /* 行きたい場所（エリアの中の足場 / 塔のぼりは プレイヤーのいる所） */
      v.goals = this._goalNodes;
      v.chase = this.tower && this._towerChase ? this._towerChase(p) : null;
      /* v5: キングバトル: あいての キングを ねらう。キングは じぶんの 陣地の そばで まつ。
         ほかの コンピューターは 3人に 2人が あいての キングを おいかける */
      v.prio = -1;
      const kingRule = this.rule.id === 'king' && !!this.kings;
      if (kingRule) {
        const ek = this._king(1 - p.team);
        if (ek && ek.alive) v.prio = ek.idx;
        if (p.king) { const zs = this._spawnZones && this._spawnZones[p.team]; v.chase = zs && zs.pts.length ? zs.pts[p.idx % zs.pts.length] : null; }
        else if (ek && ek.alive && p.idx % 3 !== 2) v.chase = ek.rpos;
      }
      /* ルール（エリア・点・のこり時間）と 敵の陣地 */
      v.rule = this.rule.id; v.score = this.score; v.sudden = this.suddenDeath;
      v.timeLeft = this.timeLimit > 0 ? this.timeLeft : 1e9;
      v.zone = this.zone; v.zoneOwner = this.zoneOwner; v.zoneFight = this.zoneFight;
      const foe = 1 - p.team;
      v.foeSpawn = this._spawnZones ? this._spawnZones[foe] : null;
      /* 陣地には入らない（塔のぼりは プレイヤーが出てきたばかりの あいだだけ） */
      v.avoidSpawn = (!this.tower && !kingRule) || this._freshTeam(foe);
      /* v5: クリスタルまもりの てき: クリスタルへ むかって こわしに いく */
      if (this.defense && p.team === 1 && this._defBotView) this._defBotView(p, v);
      /* CS2: 城バトル: 基地を とる・城を せめる・まもる */
      if (this.castle && this._csBotView) this._csBotView(p, v);
      return v;
    }

    /* そのチームに「出てきたばかり」の人がいるか */
    _freshTeam(team) {
      for (const q of this.players) if (q.team === team && q.alive && q.safeUntil > this.time) return true;
      return false;
    }

    _updateBots(dt) {
      const live = this.phase === 'live';
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (!p.bot || !p.connected || p.raidBoss) continue;      // CS2: ボスは raid.js が うごかす
        if (p.clone >= 0 && !p.alive) continue;          // v5.1: 出ていない コピーは 考えない
        let inp = this._noInput;
        if (live) {
          try { inp = p.bot.brain.think(dt, this._botView(p)) || this._noInput; }
          catch (e) { inp = this._noInput; if (window.console) console.error('[bot] think', e); }
          if (p.turret && this._csBotInput) inp = this._csBotInput(p, inp);      // CS2: 城バトルの 砲台は うごかない
        }
        this._enterBot(p);
        try {
          this._updateLocal(dt, inp);
          this._botAim();
          this._updateWeapon(dt, inp);
          if (inp.bomb && p.alive && live) this._throwBomb();
          /* v4: ゲージ まんたんで 撃っているときに 必殺技 */
          if (live && inp.fire && p.alive && !p.spK && p.sp >= 0.999 && this._botCanSpecial(p)) this._trySpecial(this._botSpecialKind(p));
          this._tickBombCd(dt);
        } catch (e) {
          if (window.console) console.error('[bot] update', e);
        } finally {
          this._leaveBot(p);
        }
      }
    }

    _stopBotLoops(p) {
      const A = CS.Audio;
      for (let i = 0; i < BOT_LOOPS.length; i++) {
        const key = BOT_LOOPS[i] + '#' + p.idx;
        if (this._loops[key]) { A.loop(key, this._loops[key], false); this._loops[key] = null; }
      }
    }

    frame(dt, inp) {
      if (this.mode === 'idle') return;
      if (!(dt > 0)) dt = 0;
      if (dt > 0.05) dt = 0.05;
      inp = inp || this._noInput;
      const me = this.players[this.me];
      if (!me || !this.world) {
        this.time += dt;
        /* ロビー中もホストの仕事（ping の更新など）は進める */
        if (this.isHost) this._hostTick(dt);
        return;
      }

      /* 勝ったチームのダンス（しあいは終わっている） */
      if (this.dance && this._danceFrame) { this._danceFrame(dt); return; }

      /* ポーズ（コンピューター戦・ためし撃ちでメニューを開いているとき・塔のぼりのチップえらび）: 絵だけ出して時間は止める */
      if ((this.paused || this.hold) && (this.offline || this.mode === 'practice') && this.phase !== 'over') {
        if (!this._pausedNow) { this._pausedNow = true; this._stopLoops(); }
        this.lastBoard = false;
        this._updateCamera(0);
        this._draw();
        this._hud(0);
        return;
      }
      this._pausedNow = false;
      this.time += dt;

      this.lastBoard = !!inp.board;

      /* カウントダウン */
      this._tickCountdown(dt);

      /* 1. じぶん */
      this._updateLocal(dt, inp);
      /* 2. カメラ（ここで begin → 銃口の位置が正しくなる） */
      this._updateCamera(dt);
      /* 3. 武器 */
      this._updateWeapon(dt, inp);
      if (inp.bomb && me.alive && this.phase === 'live') this._throwBomb();
      if (inp.special && me.alive && this.phase === 'live') this._trySpecial(CS.Specials ? CS.Specials.mineId() : 'smg');
      /* CS2: 城バトル（買いもの B・1〜7・V。買いもの中は 1・2 で 銃を もちかえない） */
      if (this.castle && this._csLocal) this._csLocal(dt, inp);
      /* v5: 銃の もちかえ（X・1・2 キー・マウスホイール・十字キー・タッチの「切替」） */
      if (me.alive && me.guns && me.guns.length > 1 && this.phase !== 'over') {
        const ks = inp.keys;
        if (ks && ks.length && !(this.castle && this.castle.shop)) {
          for (let i = 0; i < ks.length; i++) {
            const c = ks[i];
            if (c === 'KeyX') this._switchGun(); else if (c === 'Digit1') this._switchGun(0); else if (c === 'Digit2') this._switchGun(1);
          }
        }
        if (inp.swap) this._switchGun();
        if (inp.wheel && this.time - (this._wheelSwT || -9) > 0.25) { this._wheelSwT = this.time; this._switchGun(); }
      }
      this._tickBombCd(dt);
      /* 3b. コンピューター（オフライン と みんなで塔のぼりの ホスト） */
      if (this.hostBots && this.mode === 'match') {
        this._updateBots(dt);
        /* ホストの距離チェック用の「最後に知らせた位置」（ボットと オフラインの自分は 毎フレームそのまま） */
        for (let i = 0; i < this.players.length; i++) {
          const p = this.players[i];
          if (!p.bot && !this.offline) continue;
          p.lastReport[0] = p.pos[0]; p.lastReport[1] = p.pos[1]; p.lastReport[2] = p.pos[2];
        }
        /* ゲストへ ボットの位置 */
        if (this.net) {
          this.botPoseT += dt;
          if (this.botPoseT >= BOT_POSE_DT) { this.botPoseT = 0; this._sendBotPoses(); }
        }
      }
      /* 4. 弾・ボム・エフェクト */
      this._updateProjectiles(dt);
      this._updateFields(dt);
      this._updateBombs(dt);
      this._updateTargets(dt);
      this._updateFx(dt);
      /* 5. 相手の補間 */
      this._interpolate(dt);
      /* 6. ホストの判定・必殺技の時間・塔のぼり（光の柱・とびら） */
      this._hostTick(dt);
      this._tickSpecials(dt);
      if (this.tower && this._towerLocal) this._towerLocal(dt);
      if (this.raid && this._raidLocal) this._raidLocal(dt);
      /* 7. 送信 */
      if (this.mode === 'match' && this.net) {
        this.poseT += dt;
        if (this.poseT >= POSE_DT || this._poseNow) { this.poseT = 0; this._poseNow = false; this._sendPose(); }
      }
      /* v5.2: アイスフィールドの 床の 見た目（じわっと かわる）と 氷の つぶ */
      const iceOn = this.mode === 'match' && (this.iceUntil[0] > this.time || this.iceUntil[1] > this.time);
      this._iceK += ((iceOn ? 1 : 0) - this._iceK) * Math.min(1, dt * 3);
      if (this._iceK < 0.002) this._iceK = 0;
      if (this.renderer) this.renderer.ice = this._iceK;
      if (iceOn && rnd() < dt * 30) {
        const a = rnd() * Math.PI * 2, rr = 1.5 + rnd() * 9, e = this.eye;
        this._addPart(e[0] + Math.cos(a) * rr, e[1] + 2 + rnd() * 2, e[2] + Math.sin(a) * rr, (rnd() - 0.5) * 0.4, -1.1, (rnd() - 0.5) * 0.4,
          0.05 + rnd() * 0.05, 0.85, 0.96, 1.0, 0.75, 0, 2.6, 0);
      }
      /* 8. 描画 */
      this._draw();
      /* 9. HUD */
      this._hud(dt);
    }
  }

  CS.Game = Game;
})();
