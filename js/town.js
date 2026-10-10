/* ==========================================================================
   CUBE STRIKE — town.js
   キューブタウン（v4）: 起動すると屋外の町から始まる。三人称で町を歩き、建物に入って遊ぶ。
     ・バトルロビー（へやを作る / コードで参加 / コンピューター戦）・ぶき屋（ぶき・銃のスキン）
       ・ブロック工房（スキン）・塔（塔のぼり）・訓練所（ためし撃ち / チュートリアル）
       ・マップ工房・みんなのステージ・フレンド掲示板・あそびかた・町の門（アーケードへ）
     ・メニュー（Esc / M / 「メニュー」ボタン）から各場所へワープ・そのまま開くこともできる
     ・住民（NPC）が歩き回り、近づくと話しかけてくる。お店には店員
     ・オンラインのフレンドは町にあらわれる。町にいるフレンドは その場で動く（friends.js の 'tw'）
       町の外にいるフレンドは 広場のベンチのそばに立ち、いまの状態を出す（へやにいれば E で参加）
     ・エモート 8種（1〜8キー / F / 「エモート」ボタン）。フレンドにも見える
     ・はじめての人: 町に来る前にチュートリアル（しゃげきじょうで 動き方・撃ち方を1つずつ）
   しくみ: 町の World はこのファイルで作る（ブロック 9〜20 は町だけの色）。描画は CS.Renderer をそのまま使う。
   ゲームが 'idle' のときだけ main.js が town.frame() を呼ぶ。しあい・ためし撃ち・エディター中は suspend()。
   タイトル画面（scTitle）を出そうとすると、かわりに町へ（CS.UI.addScreen の show フック）。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const V = CS.V, Q = CS.Q, M4 = CS.M4, PLAYER = CS.PLAYER;
  const clamp = CS.clamp;
  const TAU = Math.PI * 2;

  /* 保存された設定がまだない = はじめて遊ぶ人（core.js がまだ保存していない読み込み時点で調べる） */
  const FRESH = (function () { try { return localStorage.getItem('cubestrike2_settings') === null; } catch (e) { return false; } })();

  const wrap = CS.wrapAngle;
  const lerpAngle = (a, b, k) => a + wrap(b - a) * clamp(k, 0, 1);
  const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
  const yawQuat = (yaw) => Q.fromAxisAngle([0, 1, 0], yaw);
  const r2 = (v) => Math.round(v * 100) / 100;
  /* 色（h 0..1）→ [r, g, b] */
  const hsv = (h, s, v) => { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /* ======================================================================
     町のマップ（96×28×64）。CS2: ぜんぶ 新しい ネオンの 町（昼と 夜が かわる）
     まんなかに 広場（ホログラムの ふんすい）、東西・南北の 大通り。
     北: ゲームセンター（ロビー）・ストーリーの塔・塔のぼり・レイドの門
     西: 武器こうぼう・お絵かきアトリエ・訓練所 / 南: マップ工房・みんなのステージ・町の門 / 東: 城バトルの城
     ワープパッド: 乗ると ペアの パッドへ ジャンプで とんでいく
     ====================================================================== */
  const T = { GRASS: 1, STONE: 2, ROAD: 3, WOOD: 4, RED: 5, BLUE: 6, PAVE: 7, GLOW: 8, LEAF: 9, WATER: 10, WHITE: 11, PINKW: 12,
    GLASS: 13, LEAF2: 14, ROOFB: 15, METAL: 16, PURPLE: 17, DARK: 18, YELLOW: 19, BRICK: 20, ST1: 21, ST2: 22, DIRT: 23,
    N_PINK: 30, N_CYAN: 31, N_YEL: 32, N_GRN: 33, N_PUR: 34, N_ORG: 35, N_RED: 36, N_BLU: 37 };
  const NEONS = [30, 31, 32, 33, 34, 35, 36, 37];
  const PALETTE = {
    1: [0.40, 0.67, 0.33], 2: [0.70, 0.70, 0.72], 3: [0.26, 0.28, 0.34], 4: [0.58, 0.40, 0.23],
    5: [0.96, 0.32, 0.40], 6: [0.28, 0.60, 1.0], 7: [0.72, 0.74, 0.78], 8: [1.0, 0.88, 0.55],
    9: [0.28, 0.58, 0.26], 10: [0.32, 0.64, 0.92], 11: [0.90, 0.92, 0.95], 12: [1.0, 0.78, 0.86],
    13: [0.45, 0.62, 0.80], 14: [0.20, 0.45, 0.20], 15: [0.28, 0.46, 0.78], 16: [0.56, 0.60, 0.66],
    17: [0.52, 0.40, 0.80], 18: [0.20, 0.21, 0.27], 19: [1.0, 0.84, 0.32], 20: [0.72, 0.42, 0.30],
    21: [0.82, 0.80, 0.76], 22: [0.28, 0.26, 0.34], 23: [0.66, 0.52, 0.35],
    30: [1.0, 0.35, 0.85], 31: [0.35, 0.9, 1.0], 32: [1.0, 0.85, 0.3], 33: [0.45, 1.0, 0.5],
    34: [0.72, 0.45, 1.0], 35: [1.0, 0.55, 0.2], 36: [1.0, 0.3, 0.35], 37: [0.35, 0.55, 1.0]
  };
  const SPAWN = [48, 40.5];
  const CENTER = [48, 32];

  function buildTown() {
    const g = new CS.MapKit.Grid(96, 28, 64);
    const f = (x0, y0, z0, x1, y1, z1, b) => g.fill(x0, y0, z0, x1, y1, z1, b);
    const roof = (x0, z0, x1, z1, y, b, levels) => {
      for (let k = 0; k < levels; k++) { if (x0 + k > x1 - k || z0 + k > z1 - k) break; f(x0 + k, y + k, z0 + k, x1 - k, y + k, z1 - k, b); }
    };
    const lamp = (x, z) => { f(x, 1, z, x, 3, z, T.DARK); f(x, 4, z, x, 4, z, T.GLOW); };
    const tree = (x, z, h) => {
      f(x, 1, z, x, h, z, T.WOOD);
      f(x - 2, h, z - 1, x + 2, h + 1, z + 1, T.LEAF); f(x - 1, h, z - 2, x + 1, h + 1, z + 2, T.LEAF);
      f(x - 1, h + 2, z - 1, x + 1, h + 2, z + 1, T.LEAF2);
    };
    /* 建物の ネオンの おび（まわり 1しゅう） */
    const band = (x0, z0, x1, z1, y, c) => { f(x0, y, z0, x1, y, z0, c); f(x0, y, z1, x1, y, z1, c); f(x0, y, z0, x0, y, z1, c); f(x1, y, z0, x1, y, z1, c); };

    // --- 地面と まわりの生け垣
    f(0, 0, 0, 95, 0, 63, T.GRASS);
    f(0, 1, 0, 95, 4, 0, T.LEAF); f(0, 1, 63, 95, 4, 63, T.LEAF); f(0, 1, 0, 0, 4, 63, T.LEAF); f(95, 1, 0, 95, 4, 63, T.LEAF);
    f(1, 1, 1, 94, 1, 1, T.LEAF2); f(1, 1, 62, 94, 1, 62, T.LEAF2); f(1, 1, 1, 1, 1, 62, T.LEAF2); f(94, 1, 1, 94, 1, 62, T.LEAF2);

    // --- 大通り（東西・南北）と 歩道。まんなかに 光る 線
    f(2, 0, 29, 93, 0, 34, T.PAVE); f(2, 0, 30, 93, 0, 33, T.ROAD);
    f(45, 0, 2, 50, 0, 61, T.PAVE); f(46, 0, 2, 49, 0, 61, T.ROAD);
    for (let x = 3; x < 93; x++) if (x % 6 < 2 && (x < 37 || x > 58)) f(x, 0, 31, x, 0, 32, T.N_CYAN);
    for (let z = 3; z < 61; z++) if (z % 6 < 2 && (z < 21 || z > 42)) f(47, 0, z, 48, 0, z, T.N_PINK);

    // --- 広場（まるい。ふちは 光る わ）・ホログラムの ふんすい
    for (let z = 20; z <= 44; z++) for (let x = 36; x <= 60; x++) {
      const d = Math.hypot(x + 0.5 - CENTER[0], z + 0.5 - CENTER[1]);
      if (d <= 8.6) f(x, 0, z, x, 0, z, (x + z) % 2 ? T.PAVE : T.STONE);
      else if (d <= 9.5) f(x, 0, z, x, 0, z, Math.floor((Math.atan2(z - 32, x - 48) + Math.PI) / (Math.PI / 8)) % 2 ? T.N_PINK : T.N_CYAN);
    }
    f(45, 1, 29, 50, 1, 34, T.METAL);
    f(46, 1, 30, 49, 1, 33, 0);
    f(46, 0, 30, 49, 0, 33, T.WATER);
    f(47, 1, 31, 48, 3, 32, T.METAL);
    f(47, 4, 31, 48, 4, 32, T.N_CYAN);
    // ベンチ・プランター
    f(43, 1, 27, 44, 1, 27, T.WOOD); f(51, 1, 27, 52, 1, 27, T.WOOD); f(43, 1, 36, 44, 1, 36, T.WOOD); f(51, 1, 36, 52, 1, 36, T.WOOD);
    // ワープパッド（光る ゆか）
    for (const p of PADS) f(Math.floor(p.x) - 1, 0, Math.floor(p.z) - 1, Math.floor(p.x) + 1, 0, Math.floor(p.z) + 1, T.N_GRN);

    // --- 街灯
    [6, 14, 22, 30, 66, 74, 86].forEach((x) => { lamp(x, 29); lamp(x, 34); });
    [6, 14, 50, 56].forEach((z) => { lamp(45, z); lamp(50, z); });

    // --- ゲームセンター（北）: 大きな ホール。正面（南）が 大きく あいている。中に カウンターが 6つ
    f(34, 1, 3, 61, 9, 17, T.WHITE);
    f(35, 1, 4, 60, 8, 16, 0);
    f(35, 0, 4, 60, 0, 16, T.ROAD);
    for (let x = 36; x <= 59; x += 4) f(x, 0, 4, x, 0, 16, T.N_BLU);
    f(40, 1, 17, 55, 5, 17, 0);
    f(33, 10, 2, 62, 10, 18, T.DARK); f(33, 10, 18, 62, 10, 18, T.N_PINK); f(33, 10, 2, 33, 10, 18, T.N_CYAN); f(62, 10, 2, 62, 10, 18, T.N_CYAN);
    for (let x = 40; x <= 55; x++) { f(x, 6, 17, x, 6, 17, x % 2 ? T.N_PINK : T.N_CYAN); f(x, 8, 17, x, 8, 17, x % 2 ? T.N_CYAN : T.N_PINK); }
    f(41, 7, 17, 54, 7, 17, T.N_YEL);
    f(34, 7, 17, 39, 7, 17, T.N_PUR); f(56, 7, 17, 61, 7, 17, T.N_PUR);
    f(34, 3, 6, 34, 5, 14, T.GLASS); f(61, 3, 6, 61, 5, 14, T.GLASS);
    [36, 40, 44, 49, 53, 57].forEach((x, i) => { f(x, 1, 7, x + 2, 1, 7, T.METAL); f(x, 2, 7, x + 2, 2, 7, NEONS[i]); });
    for (let x = 36; x <= 58; x += 3) { f(x, 1, 4, x + 1, 3, 4, T.DARK); f(x, 2, 4, x + 1, 2, 4, NEONS[(x >> 1) % 8]); }
    f(43, 11, 8, 52, 13, 12, T.DARK); f(43, 12, 12, 52, 12, 12, T.N_YEL); f(44, 14, 10, 51, 14, 10, T.N_PINK);   // やねの かんばん

    // --- ストーリーの塔（北西）: 色の しま もようの 高い 塔。入口は 南
    const RB = [T.RED, T.YELLOW, T.GRASS, T.BLUE, T.PURPLE, T.PINKW];
    f(24, 1, 5, 30, 2, 11, T.STONE);
    for (let y = 3; y <= 18; y++) f(25, y, 6, 29, y, 10, RB[Math.floor((y - 3) / 2.6) % RB.length]);
    for (let y = 6; y <= 16; y += 5) band(25, 6, 29, 10, y, T.GLOW);
    f(24, 19, 5, 30, 19, 11, T.STONE); f(26, 20, 7, 28, 21, 9, T.GLOW); f(27, 22, 8, 27, 23, 8, T.N_YEL);
    f(26, 1, 10, 28, 3, 11, 0); f(26, 1, 7, 28, 2, 9, 0); f(26, 4, 11, 28, 4, 11, T.N_YEL);

    // --- 塔のぼり（北東）: むらさきの 塔（高さ 24）
    f(66, 1, 5, 72, 3, 11, T.STONE);
    f(67, 4, 6, 71, 22, 10, T.PURPLE);
    for (let y = 8; y <= 21; y += 4) band(67, 6, 71, 10, y, T.N_PUR);
    f(66, 23, 5, 72, 23, 11, T.GLOW); f(68, 24, 7, 70, 24, 9, T.PURPLE); f(69, 25, 8, 69, 25, 8, T.GLOW);
    f(68, 1, 9, 70, 3, 11, 0); f(68, 0, 9, 70, 0, 11, T.DARK);

    // --- レイドの門（北東のはし）: 光る 門の むこうに ボスが まっている
    f(76, 0, 4, 92, 0, 19, T.ST2); band(76, 4, 92, 19, 0, T.N_PUR);
    f(78, 1, 10, 80, 11, 12, T.ST2); f(88, 1, 10, 90, 11, 12, T.ST2); f(78, 12, 10, 90, 13, 12, T.ST2);
    f(78, 4, 10, 80, 4, 12, T.N_PUR); f(88, 4, 10, 90, 4, 12, T.N_PUR); f(78, 8, 10, 80, 8, 12, T.N_PINK); f(88, 8, 10, 90, 8, 12, T.N_PINK);
    f(81, 11, 11, 87, 11, 11, T.N_PUR);
    f(81, 1, 11, 87, 10, 11, T.N_PINK);
    f(80, 14, 11, 80, 14, 11, T.N_PINK); f(84, 14, 11, 84, 14, 11, T.N_PUR); f(88, 14, 11, 88, 14, 11, T.N_PINK);
    [[77, 5], [91, 5], [77, 18], [91, 18]].forEach((p) => { f(p[0], 1, p[1], p[0], 3, p[1], T.ST2); f(p[0], 4, p[1], p[0], 4, p[1], T.N_PUR); });

    // --- 武器こうぼう（西・北がわ）: レンガと 鉄。入口は 南（大通り がわ）
    f(4, 1, 17, 21, 7, 27, T.BRICK);
    f(5, 1, 18, 20, 7, 26, 0);
    f(5, 0, 18, 20, 0, 26, T.WOOD);
    f(11, 1, 27, 14, 4, 27, 0);
    f(3, 8, 16, 22, 8, 28, T.DARK); f(4, 9, 17, 21, 9, 27, T.METAL);
    f(6, 9, 19, 7, 12, 20, T.DARK);                                           // えんとつ
    f(5, 5, 27, 10, 5, 27, T.N_ORG); f(15, 5, 27, 20, 5, 27, T.N_ORG);
    f(9, 6, 27, 16, 6, 27, T.N_ORG); f(9, 5, 27, 10, 5, 27, T.N_ORG);          // 銃の かんばん
    f(8, 1, 21, 17, 1, 21, T.WOOD);                                           // カウンター
    f(5, 2, 18, 20, 4, 18, T.DARK); for (let x = 6; x <= 19; x += 2) f(x, 3, 18, x, 3, 18, NEONS[x % 8]);
    f(4, 3, 20, 4, 5, 24, T.GLASS); f(21, 3, 20, 21, 5, 24, T.GLASS);

    // --- お絵かきアトリエ（西・南がわ）: しろい かべに ペンキの もよう。入口は 北
    f(4, 1, 37, 21, 6, 47, T.WHITE);
    f(5, 1, 38, 20, 6, 46, 0);
    f(5, 0, 38, 20, 0, 46, T.PAVE);
    f(11, 1, 37, 14, 4, 37, 0);
    roof(3, 36, 22, 48, 7, T.PINKW, 3);
    [[5, 3, 37, T.RED], [7, 5, 37, T.BLUE], [16, 2, 37, T.YELLOW], [18, 4, 37, T.GRASS], [20, 2, 37, T.PURPLE], [4, 4, 40, T.RED], [4, 2, 44, T.BLUE], [21, 3, 41, T.YELLOW], [21, 5, 45, T.PURPLE]]
      .forEach((c) => f(c[0], c[1], c[2], c[0], c[1], c[2], c[3]));
    f(10, 5, 37, 15, 5, 37, T.N_PINK);
    [[7, 43, T.RED], [12, 44, T.BLUE], [17, 43, T.YELLOW]].forEach((c) => { f(c[0], 1, c[1], c[0], 2, c[1], T.WOOD); f(c[0], 3, c[1], c[0], 3, c[1], c[2]); });

    // --- 訓練所（南西）: 柵に かこまれた しゃげき場
    f(4, 0, 50, 24, 0, 61, T.DIRT);
    f(4, 1, 50, 24, 1, 50, T.WOOD); f(4, 1, 61, 24, 1, 61, T.WOOD); f(4, 1, 50, 4, 1, 61, T.WOOD); f(24, 1, 50, 24, 1, 61, T.WOOD);
    f(12, 1, 50, 16, 1, 50, 0);
    [6, 10, 14, 18, 22].forEach((x) => { f(x, 1, 59, x, 2, 59, T.WHITE); f(x, 2, 59, x, 2, 59, T.RED); });
    f(5, 1, 56, 9, 1, 56, T.WOOD);

    // --- マップ工房（南）: 木の 小屋。入口は 東。まわりに 色ブロック
    f(27, 1, 47, 39, 5, 57, T.WOOD);
    f(28, 1, 48, 38, 5, 56, 0);
    f(28, 0, 48, 38, 0, 56, T.PAVE);
    f(39, 1, 51, 39, 3, 53, 0);
    roof(26, 46, 40, 58, 6, T.YELLOW, 3);
    f(39, 4, 49, 39, 4, 55, T.N_YEL);
    f(29, 1, 49, 29, 1, 49, T.RED); f(30, 1, 49, 30, 2, 49, T.BLUE); f(31, 1, 49, 31, 1, 49, T.YELLOW); f(36, 1, 55, 37, 1, 55, T.PURPLE);
    f(41, 1, 47, 41, 2, 47, T.RED); f(42, 1, 48, 42, 1, 48, T.BLUE); f(41, 1, 57, 41, 1, 57, T.YELLOW);

    // --- みんなのステージ（南東）: 柱と 屋根の あずまや、大きな けいじ板
    f(56, 0, 46, 67, 0, 57, T.PAVE);
    [[56, 46], [67, 46], [56, 57], [67, 57]].forEach((p) => f(p[0], 1, p[1], p[0], 4, p[1], T.STONE));
    f(55, 5, 45, 68, 5, 58, T.ROOFB); f(57, 6, 47, 66, 6, 56, T.ROOFB); f(55, 5, 45, 68, 5, 45, T.N_BLU);
    f(58, 1, 57, 65, 4, 57, T.DARK); f(58, 4, 57, 65, 4, 57, T.GLOW);
    f(59, 2, 56, 60, 3, 56, T.GRASS); f(62, 2, 56, 63, 3, 56, T.BLUE); f(64, 2, 56, 64, 3, 56, T.RED);

    // --- 城バトルの城（南東）: 大きな 城。門は 北（大通り がわ）
    f(68, 0, 40, 91, 0, 60, T.PAVE);
    f(68, 1, 39, 91, 8, 39, T.ST1); f(68, 1, 60, 91, 8, 60, T.ST1); f(68, 1, 39, 68, 8, 60, T.ST1); f(91, 1, 39, 91, 8, 60, T.ST1);
    for (let x = 68; x <= 91; x += 2) { f(x, 9, 39, x, 9, 39, T.ST1); f(x, 9, 60, x, 9, 60, T.ST1); }
    for (let z = 41; z <= 58; z += 2) { f(68, 9, z, 68, 9, z, T.ST1); f(91, 9, z, 91, 9, z, T.ST1); }
    f(78, 1, 39, 82, 5, 39, 0);
    f(77, 6, 39, 83, 6, 39, T.ST2); f(78, 6, 39, 82, 6, 39, T.GLOW);
    f(73, 3, 38, 74, 7, 38, T.RED); f(86, 3, 38, 87, 7, 38, T.BLUE);
    f(73, 8, 38, 74, 8, 38, T.YELLOW); f(86, 8, 38, 87, 8, 38, T.YELLOW);
    [[66, 37], [89, 37], [66, 58], [89, 58]].forEach((c, i) => {
      f(c[0], 1, c[1], c[0] + 3, 12, c[1] + 3, T.ST1);
      f(c[0], 6, c[1], c[0] + 3, 6, c[1] + 3, T.ST2);
      roof(c[0], c[1], c[0] + 3, c[1] + 3, 13, i % 2 ? T.ROOFB : T.RED, 2);
    });
    f(75, 1, 47, 85, 13, 54, T.ST1);
    f(75, 7, 47, 85, 7, 54, T.ST2);
    f(77, 3, 47, 78, 5, 47, T.DARK); f(82, 3, 47, 83, 5, 47, T.DARK); f(78, 9, 47, 82, 11, 47, T.DARK);
    f(79, 1, 47, 81, 3, 47, T.WOOD);
    roof(75, 47, 85, 54, 14, T.RED, 4);
    f(80, 18, 50, 80, 22, 50, T.DARK); f(81, 21, 50, 82, 22, 50, T.RED); f(78, 21, 50, 79, 22, 50, T.BLUE);

    // --- けいじ板（広場の 北）: フレンド・あそびかた
    f(37, 1, 22, 37, 2, 22, T.WOOD); f(39, 1, 22, 39, 2, 22, T.WOOD); f(37, 3, 22, 39, 4, 22, T.DARK); f(37, 5, 22, 39, 5, 22, T.N_GRN);
    f(56, 1, 22, 56, 2, 22, T.WOOD); f(58, 1, 22, 58, 2, 22, T.WOOD); f(56, 3, 22, 58, 4, 22, T.BLUE); f(56, 5, 22, 58, 5, 22, T.N_CYAN);

    // --- 町の門（南）
    f(43, 1, 59, 44, 7, 60, T.STONE); f(51, 1, 59, 52, 7, 60, T.STONE);
    f(43, 8, 59, 52, 8, 60, T.DARK);
    f(45, 7, 59, 50, 7, 59, T.GLOW); f(43, 8, 59, 52, 8, 59, T.N_YEL);

    // --- 木と花
    [[31, 23, 4], [63, 23, 4], [24, 44, 3], [39, 47, 3], [57, 47, 3], [73, 25, 4], [92, 25, 4], [33, 40, 3], [62, 40, 3], [26, 60, 3], [40, 60, 3], [57, 61, 3], [10, 12, 4], [18, 8, 3], [60, 21, 3]]
      .forEach((t) => tree(t[0], t[1], t[2]));
    [[38, 37], [57, 27], [25, 25], [70, 27], [34, 27], [61, 36]].forEach((p) => { f(p[0], 0, p[1], p[0] + 1, 0, p[1] + 1, T.PINKW); });
    [[39, 26], [56, 37], [66, 27], [28, 37]].forEach((p) => { f(p[0], 0, p[1], p[0] + 1, 0, p[1] + 1, T.YELLOW); });

    const h = PLAYER.half + 0.002;
    const sp = { p: [SPAWN[0], 1 + h, SPAWN[1]], yaw: 0 };
    return CS.MapKit.finish(g, [[sp], [sp]], {
      palette: PALETTE,
      sky: SKY.day.sky.slice(), skyTop: SKY.day.skyTop.slice(),
      ambSky: SKY.day.ambSky.slice(), ambGnd: SKY.day.ambGnd.slice(), sunCol: SKY.day.sunCol.slice(),
      sun: V.norm(SKY.day.sun),
      fogNear: 50, fogFar: 140, outdoor: true
    });
  }

  /* ---------- 昼と 夜（ぐるっと 1しゅう CYCLE 秒） ---------- */
  const CYCLE = 300;
  const SKY = {
    day: { sky: [0.62, 0.80, 0.97], skyTop: [0.26, 0.50, 0.90], ambSky: [0.58, 0.62, 0.68], ambGnd: [0.34, 0.33, 0.30], sunCol: [0.80, 0.76, 0.66], sun: [0.3, 0.82, 0.35], fog: [50, 140], cloud: [0.97, 0.98, 1.0] },
    eve: { sky: [0.98, 0.62, 0.42], skyTop: [0.36, 0.36, 0.72], ambSky: [0.58, 0.48, 0.52], ambGnd: [0.34, 0.25, 0.24], sunCol: [1.0, 0.62, 0.40], sun: [-0.75, 0.32, 0.25], fog: [45, 130], cloud: [1.0, 0.78, 0.7] },
    night: { sky: [0.05, 0.06, 0.15], skyTop: [0.01, 0.01, 0.05], ambSky: [0.26, 0.28, 0.42], ambGnd: [0.11, 0.11, 0.17], sunCol: [0.22, 0.26, 0.42], sun: [0.3, 0.7, -0.4], fog: [40, 115], cloud: [0.22, 0.25, 0.36] },
    dawn: { sky: [0.88, 0.66, 0.70], skyTop: [0.30, 0.36, 0.72], ambSky: [0.52, 0.48, 0.58], ambGnd: [0.30, 0.26, 0.28], sunCol: [0.95, 0.72, 0.62], sun: [0.75, 0.32, 0.25], fog: [45, 130], cloud: [1.0, 0.85, 0.85] }
  };
  /* [時間（0..1）, 空] の ならび。あいだは なめらかに まぜる */
  const SKY_KEYS = [[0, 'day'], [0.40, 'day'], [0.48, 'eve'], [0.56, 'night'], [0.88, 'night'], [0.94, 'dawn'], [1, 'day']];
  function skyName(p) { return p < 0.42 ? 'ひる' : p < 0.53 ? 'ゆうがた' : p < 0.9 ? 'よる' : 'あさ'; }

  /* ---------- ワープパッド（ペアで とびあう） ---------- */
  const PADS = [
    { x: 41.5, z: 37.5, to: 1, name: '西の 大通り（武器こうぼう・アトリエ）' }, { x: 14.5, z: 31.5, to: 0, name: '広場' },
    { x: 54.5, z: 37.5, to: 3, name: '東の 大通り（城バトル・レイドの門）' }, { x: 81.5, z: 31.5, to: 2, name: '広場' },
    { x: 41.5, z: 26.5, to: 5, name: 'ストーリーの塔' }, { x: 27.5, z: 16.5, to: 4, name: '広場' },
    { x: 54.5, z: 26.5, to: 7, name: '塔のぼり' }, { x: 69.5, z: 17.5, to: 6, name: '広場' }
  ];
  const PAD_R = 0.95;

  /* ======================================================================
     場所（入れるところ）・エリア名・住民
     act: 押すボタンの id（タイトル画面と同じ動き）/ 'tutorial' / 'exit'
     ====================================================================== */
  const SPOTS = [
    { id: 'create', name: 'へやを作る', sub: 'ゲームセンター', x: 37.5, z: 10.5, act: 'btnCreate', col: [1.0, 0.4, 0.75] },
    { id: 'join', name: 'コードで参加', sub: 'ゲームセンター', x: 41.5, z: 10.5, act: 'btnJoinOpen', col: [0.35, 0.85, 1.0] },
    { id: 'cpu', name: 'コンピューター戦', sub: 'ゲームセンター', x: 45.5, z: 10.5, act: 'btnCpu', col: [1.0, 0.85, 0.3] },
    { id: 'ranked', name: 'ランダムマッチ', sub: 'おなじ ランクの人と', x: 50.5, z: 10.5, act: 'btnRanked', col: [0.45, 1.0, 0.5] },
    { id: 'tourney', name: 'トーナメント', sub: 'かちぬき戦', x: 54.5, z: 10.5, act: 'btnTourney', col: [0.72, 0.45, 1.0] },
    { id: 'defense', name: 'クリスタルまもり', sub: 'みんなで まもる', x: 58.5, z: 10.5, act: 'btnDefense', col: [1.0, 0.55, 0.2] },
    { id: 'weapon', name: '武器こうぼう', sub: '銃・部品・組み合わせ', x: 12.5, z: 24.5, act: 'btnLoadoutOpen', col: [1.0, 0.6, 0.25] },
    { id: 'skin', name: 'お絵かきアトリエ', sub: 'からだに 絵を かく', x: 12.5, z: 40.5, act: 'btnSkin', col: [1.0, 0.55, 0.8] },
    { id: 'story', name: 'ストーリー', sub: 'ブラックキューブから せかいを すくえ', x: 27.5, z: 13.5, act: 'btnStory', col: [1.0, 0.85, 0.35] },
    { id: 'tower', name: '塔のぼり', sub: 'ひとりで30かい', x: 69.5, z: 13.5, act: 'btnTower', col: [0.7, 0.55, 1.0] },
    { id: 'raid', name: 'ボスレイド', sub: 'みんなで 巨大ボスに いどむ', x: 84.0, z: 15.5, act: 'btnRaid', col: [0.85, 0.45, 1.0] },
    { id: 'castle', name: '城バトル', sub: '基地を とって 城を こわす', x: 80.0, z: 37.0, act: 'btnCastle', col: [1.0, 0.45, 0.4] },
    { id: 'practice', name: 'ためし撃ち', sub: '訓練所', x: 11.5, z: 53.5, act: 'btnPractice', col: [1.0, 0.45, 0.4] },
    { id: 'tutorial', name: 'チュートリアル', sub: '撃ち方を おさらい', x: 17.5, z: 53.5, act: 'tutorial', col: [0.45, 0.9, 1.0] },
    { id: 'maps', name: 'マップ工房', sub: 'マップをつくる', x: 35.5, z: 52.0, act: 'btnMaps', col: [1.0, 0.85, 0.35] },
    { id: 'stages', name: 'みんなのステージ', sub: '公開マップで あそぶ', x: 61.5, z: 51.0, act: 'btnStages', col: [0.4, 0.95, 0.6] },
    { id: 'friends', name: 'フレンド掲示板', sub: 'フレンド・チャット', x: 38.5, z: 24.5, act: 'btnFriends', col: [0.5, 1.0, 0.6] },
    { id: 'how', name: 'あそびかた', sub: '', x: 57.5, z: 24.5, act: 'btnHow', col: [0.6, 0.9, 1.0] },
    { id: 'exit', name: 'アーケードへ', sub: 'NEO ARCADE にもどる', x: 48.0, z: 60.0, act: 'exit', col: [1.0, 0.9, 0.6] }
  ];
  const SPOT_R = 1.7;
  const WARPS = [
    { id: 'plaza', name: '広場', x: SPAWN[0], z: SPAWN[1] },
    { id: 'game', name: 'ゲームセンター', x: 47.5, z: 13.0, open: 'btnCpu', openName: 'コンピューター戦' },
    { id: 'weapon', name: '武器こうぼう', x: 12.5, z: 25.0, open: 'btnLoadoutOpen' },
    { id: 'skin', name: 'お絵かきアトリエ', x: 12.5, z: 39.5, open: 'btnSkin' },
    { id: 'story', name: 'ストーリーの塔', x: 27.5, z: 15.0, open: 'btnStory', openName: 'ストーリー' },
    { id: 'tower', name: '塔のぼり', x: 69.5, z: 15.0, open: 'btnTower' },
    { id: 'raid', name: 'レイドの門', x: 84.0, z: 17.0, open: 'btnRaid', openName: 'ボスレイド' },
    { id: 'castle', name: '城バトルの城', x: 80.0, z: 36.0, open: 'btnCastle', openName: '城バトル' },
    { id: 'defense', name: 'クリスタルまもり', x: 58.5, z: 12.0, open: 'btnDefense' },
    { id: 'tourney', name: 'トーナメント', x: 54.5, z: 12.0, open: 'btnTourney' },
    { id: 'ranked', name: 'ランダムマッチ', x: 50.5, z: 12.0, open: 'btnRanked' },
    { id: 'training', name: '訓練所', x: 13.5, z: 52.5, open: 'btnPractice', openName: 'ためし撃ち' },
    { id: 'maps', name: 'マップ工房', x: 35.5, z: 52.0, open: 'btnMaps' },
    { id: 'stages', name: 'みんなのステージ', x: 61.5, z: 50.0, open: 'btnStages' },
    { id: 'friends', name: 'フレンド掲示板', x: 38.5, z: 26.0, open: 'btnFriends' },
    { id: 'gate', name: '町の門', x: 48.0, z: 57.5 }
  ];
  const AREAS = [
    ['ゲームセンター', 34, 3, 61, 17], ['武器こうぼう', 4, 17, 21, 27], ['お絵かきアトリエ', 4, 37, 21, 47], ['ストーリーの塔', 23, 4, 31, 15],
    ['塔のぼり', 65, 4, 73, 15], ['レイドの門', 76, 4, 92, 19], ['城バトルの城', 66, 35, 92, 61], ['訓練所', 4, 50, 24, 61],
    ['マップ工房', 27, 47, 39, 57], ['みんなのステージ', 56, 46, 67, 57], ['町の門', 42, 57, 53, 62], ['広場', 38, 22, 58, 42], ['ネオン大通り', 2, 29, 93, 34]
  ];
  /* 町の外にいるフレンドが立つところ（ベンチのそば。ふんすいの方を向く） */
  const FRIEND_SLOTS = [[43.5, 28.5], [52.5, 28.5], [43.5, 35.5], [52.5, 35.5], [40.5, 30.0], [55.5, 30.0], [40.5, 34.0], [55.5, 34.0]];
  const FST = { menu: 'オンライン', lobby: 'へやにいる', match: 'しあい中', cpu: 'コンピューター戦', tower: '塔のぼり中', practice: 'ためし撃ち中', edit: 'マップ作り中', town: '町にいる' };

  const TIPS = [
    'Shift を おしながら歩くと 走れるよ', '光る みどりの ワープパッドに のると ジャンプで とんでいけるよ', 'この 町は 夜に なると ネオンが きれいなんだ',
    '武器こうぼうで 銃に 部品を つけられるよ', 'お絵かきアトリエで からだの 6面に 絵が かけるよ', 'フレンドが 来ると この町に あらわれるよ',
    '1〜8キーで エモートできるよ', 'Esc で メニュー。ワープもできる', '銃は 57しゅるい、部品は 35しゅるい あるんだって',
    'ヘッドショットは ダメージが 大きいよ', 'ストーリーの塔で ブラックキューブの お話が 読めるよ', '城バトルは 1〜7 キーで 部隊を 買えるんだって',
    'ボムは 時間がたつと また使えるよ', 'こんにちは！ いい天気だね', 'レイドの門の むこうには 巨大な ボスが いるらしい…',
    'クリスタルまもりは 4人まで いっしょに できるよ', 'X キーで 2つめの 銃に 切りかえ', 'スナイパー系を もつと 銃は 1つだけ なんだって',
    'てきを 3回 たおすと 必殺技が つかえるよ', 'ジャンプして すぐ もう一回で 大ジャンプ！ 6ブロックの 高さまで とべるよ', '塔のぼりは 友達と いっしょにも のぼれるんだって'
  ];
  const WALKERS = ['タロウ', 'ハナコ', 'ポチ', 'ミント', 'ゴロー', 'サクラ', 'カクカク', 'ブロッキー', 'コロン', 'ルル'];
  /* sk = ストーリーの キャラの スキン（story-data.js）・need = ストーリーを ここまで クリアしたら あらわれる */
  const KEEPERS = [
    { name: 'ロビーのアオイ', x: 37.5, z: 6.0, yaw: Math.PI, lines: ['へやを作ると 6文字のコードが出るよ', 'コードを 友達に 送ってね'] },
    { name: 'ロビーのカイ', x: 41.5, z: 6.0, yaw: Math.PI, lines: ['友達の コードを 入れてね', 'フレンドの へやにも 入れるよ'] },
    { name: 'ロビーのロボ', x: 45.5, z: 6.0, yaw: Math.PI, lines: ['コンピューターと 対戦できるよ', '「逃げるだけ」は 練習に ぴったり'] },
    { name: 'ランクのリン', x: 50.5, z: 6.0, yaw: Math.PI, lines: ['おなじ ランクの人と たたかえるよ', 'かつと ランクが あがるの'] },
    { name: 'トーナメントのタイガ', x: 54.5, z: 6.0, yaw: Math.PI, lines: ['かちぬき戦で いちばんを めざせ！', 'たりない 人数は コンピューターが 入るぞ'] },
    { name: 'クリスタルのミズキ', x: 58.5, z: 6.0, yaw: Math.PI, lines: ['クリスタルを まもりぬいてね', '4人まで いっしょに あそべるよ'] },
    { name: 'ハンマ', sk: 'smith', x: 12.5, z: 19.6, yaw: Math.PI, lines: ['おう！ 部品を つけると つよく なるが リロードが のびるぜ', '組み合わせは 10こ まで ほぞん できる', '特殊部品は 1こ まで。つよいけど なにかが よわく なるぜ'] },
    { name: '工房のミミ', x: 12.5, z: 45.4, yaw: 0, lines: ['からだの 6面ぜんぶに 16×16 の ドットで 絵が かけるの', 'ぼうしも えらべるよ'] },
    { name: '長老', sk: 'elder', x: 24.5, z: 13.5, yaw: Math.PI, story: true },
    { name: '塔の番人', x: 72.5, z: 13.5, yaw: Math.PI, lines: ['塔は 30かい。10かいごとに ボスがいる', 'チップを えらんで 強くなれ', '友達と のぼると チップが みんなに つくぞ'] },
    { name: 'レイドの 門番', x: 80.5, z: 15.5, yaw: Math.PI, lines: ['この 門の むこうに 5たいの 巨大ボスが いる…', 'ひとりでも、友達と 4人でも いどめるぞ', '赤い 円や 線は ボスの こうげきの 予告だ。よけろ！'] },
    { name: '城の へいし', x: 76.5, z: 37.0, yaw: 0, lines: ['ここは 城バトルの 城だ！', 'あいての 城を こわしたら 勝ち。基地を とって お金を ためろ！', '友達と 1対1〜4対4 で たたかえるぞ'] },
    { name: 'コーチ', x: 14.5, z: 56.5, yaw: 0, lines: ['まとを 撃って 練習しよう', 'はじめてなら チュートリアルが おすすめ'] },
    { name: 'トンカチ', x: 31.5, z: 52.0, yaw: -Math.PI / 2, lines: ['マップ工房へ ようこそ！', '作った マップは 公開も できるぞ'] },
    { name: 'ステージ係', x: 61.5, z: 55.0, yaw: 0, lines: ['みんなが 作った マップで あそべるよ', 'いいねも おせるんだ'] },
    /* ストーリーを すすめると あそびに くる */
    { name: 'ジェット', sk: 'jet', need: 5, walk: 5.2, x: 30.5, z: 31.5, yaw: 0, lines: ['おれさまより はやい やつは いないぜ！ …きみ いがいはな！', 'ネオンの 町の パトロール中だ！'] },
    { name: 'リーフ', sk: 'leaf', need: 10, x: 32.5, z: 25.5, yaw: Math.PI / 2, lines: ['ふふ… 町は にぎやかで いいわね', 'スナイパーは かくれる 場所が だいじよ'] },
    { name: 'ボンバ', sk: 'bomba', need: 15, x: 42.5, z: 47.5, yaw: Math.PI / 2, lines: ['ボンボーン！ マップ工房で ばくはつ する マップを 作りたいボン！', 'ロケットは じぶんの ちかくで うつと あぶないボン'] },
    { name: 'フレイム', sk: 'flame', need: 20, x: 26.5, z: 52.5, yaw: -Math.PI / 2, lines: ['きたえろ！ もっと あつく！', 'かえんほうしゃきは ちかくの てきに つよいぜ'] },
    { name: 'ブラックキューブ', sk: 'king', need: 25, x: 53.5, z: 38.5, yaw: 0, lines: ['……この 町は、色が いっぱいだな', '……みんなと あそぶのは、たのしい'] }
  ];
  function storyN() { const s = CS.Settings && CS.Settings.story; return s && typeof s === 'object' ? s.n | 0 : 0; }
  function elderLines() {
    const n = storyN();
    return n >= 25 ? ['せかいに 色が もどった。きみの おかげじゃ！', '「むずかしい」にも ちょうせん してみるのじゃ'] :
      n > 0 ? ['その ちょうしじゃ！ つぎの ステージも たのんだぞ', 'ストーリーは やられても なんかいでも ふっかつ できるぞ'] :
      ['たいへんじゃ！ ブラックキューブが あばれておる…！', 'この 塔で お話を すすめてくれ。たのんだぞ！'];
  }

  /* ---------- エモート ---------- */
  const EMOTES = [
    { id: 'wave', name: 'あいさつ', dur: 1.6 },
    { id: 'dance', name: 'ダンス', dur: 2.4 },
    { id: 'yay', name: 'やったー', dur: 1.8 },
    { id: 'love', name: 'ハート', dur: 2.0 },
    { id: 'sleep', name: 'ねむい', dur: 2.6 },
    { id: 'spin', name: 'くるくる', dur: 1.6 },
    { id: 'angry', name: 'おこ', dur: 1.6 },
    { id: 'good', name: 'いいね', dur: 1.6 }
  ];
  const EMOTE_MAP = {};
  EMOTES.forEach((e) => { EMOTE_MAP[e.id] = e; });

  /* エモート中の見た目: 上下 dy・向き spin・かたむき tz / tx・左右ゆれ sx */
  function emotePose(id, t, out) {
    out.dy = 0; out.spin = 0; out.tz = 0; out.tx = 0; out.sx = 0;
    const s = Math.sin;
    switch (id) {
      case 'wave': out.dy = 0.22 * Math.abs(s(t * 7.5)); out.tz = s(t * 9) * 0.28; break;
      case 'dance': { const b = t / 0.3, ph = b - Math.floor(b); out.dy = 0.35 * s(Math.PI * ph); out.spin = Math.floor(b) * Math.PI / 2 + ph * Math.PI / 2; break; }
      case 'yay': { const k = clamp((t - 0.2) / 0.7, 0, 1); out.dy = 1.3 * s(Math.PI * k); out.tx = -TAU * k; break; }
      case 'love': out.dy = 0.1 + 0.1 * s(t * 5); out.tz = s(t * 3) * 0.12; break;
      case 'sleep': out.tz = 0.4 * clamp(t * 2, 0, 1); out.dy = 0.04 * s(t * 2.5); break;
      case 'spin': out.spin = t * 11 * (1 - t / 1.8); out.dy = 0.15 * s(Math.PI * clamp(t / 1.6, 0, 1)); break;
      case 'angry': out.sx = s(t * 45) * 0.07; out.dy = 0.05 * Math.abs(s(t * 20)); break;
      case 'good': out.dy = 0.4 * Math.abs(s(t * 4)); out.tx = -0.25 * s(t * 4); break;
    }
    return out;
  }

  /* ======================================================================
     見た目（CSS）
     ====================================================================== */
  const CSS = [
    /* z-index 14: タッチ操作の層（#touch 12）より上。そうしないと タブレット・スマホで エモート・メニューの ボタンが おせない */
    '#townHud{position:fixed;inset:0;z-index:14;pointer-events:none;font-family:inherit}',
    '#townHud[hidden],#twEmotes[hidden],#tutPanel[hidden],#tutDone[hidden]{display:none!important}',
    '#twTop{position:absolute;left:calc(12px + var(--safeL));top:calc(10px + var(--safeT));display:flex;flex-direction:column;gap:2px;',
    '  padding:8px 14px;border-radius:14px;background:rgba(6,12,30,.55);border:1px solid rgba(127,214,255,.25);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}',
    '#twTop b{font-size:14px;letter-spacing:.16em;color:#eaf6ff}#twPlace{font-size:12px;color:#9fd4ff;letter-spacing:.08em}',
    '#twFr{position:absolute;right:calc(12px + var(--safeR));top:calc(10px + var(--safeT));padding:7px 12px;border-radius:12px;font-size:12.5px;',
    '  background:rgba(6,12,30,.55);border:1px solid rgba(127,214,255,.25);color:#cfe6ff;letter-spacing:.06em}',
    '#twTags{position:absolute;inset:0;overflow:hidden}',
    '.twTag{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:3px;white-space:nowrap;will-change:transform}',
    '.twTag .nm{font-size:12px;font-weight:700;letter-spacing:.06em;color:#fff;padding:2px 8px;border-radius:9px;background:rgba(10,18,40,.62);text-shadow:0 1px 2px #000}',
    '.twTag .nm.fr{background:rgba(20,120,90,.75)}.twTag .nm.kp{background:rgba(120,70,20,.72)}',
    '.twTag .bb{font-size:12.5px;color:#10203a;background:#fff;padding:5px 10px;border-radius:12px;box-shadow:0 3px 10px rgba(0,0,0,.35);max-width:240px;white-space:normal;text-align:center;line-height:1.45}',
    '.twTag .em{font-size:13px;font-weight:900;letter-spacing:.06em;line-height:1;color:#2a1a00;background:#ffe066;padding:5px 11px;border-radius:12px;box-shadow:0 3px 10px rgba(0,0,0,.35)}',
    '.twTag.spot .nm{font-size:14px;padding:4px 12px;background:rgba(10,18,40,.72);border:1px solid rgba(255,255,255,.25)}',
    '.twTag.spot .ic{font-size:26px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}',
    '.twTag.spot small{font-size:10.5px;color:#bcd6f5;letter-spacing:.04em}',
    '#twPrompt{position:absolute;left:50%;bottom:calc(120px + var(--safeB));transform:translateX(-50%);padding:10px 18px;border-radius:14px;',
    '  font-size:15px;font-weight:700;letter-spacing:.06em;color:#fff;background:rgba(10,20,50,.78);border:1px solid rgba(127,214,255,.5);',
    '  box-shadow:0 0 22px rgba(90,170,255,.35);white-space:nowrap;opacity:0;transition:opacity .15s}',
    '#twPrompt.on{opacity:1}#twPrompt kbd{display:inline-block;min-width:26px;padding:1px 7px;margin-right:8px;border-radius:7px;background:#7fd6ff;color:#04121f;font-family:inherit;font-weight:900}',
    '#twHint{position:absolute;left:50%;bottom:calc(70px + var(--safeB));transform:translateX(-50%);font-size:12px;color:#d8e8ff;letter-spacing:.06em;',
    '  padding:6px 12px;border-radius:10px;background:rgba(6,12,30,.5);white-space:nowrap}',
    '#twBtns{position:absolute;right:calc(12px + var(--safeR));top:calc(52px + var(--safeT));display:flex;gap:8px;pointer-events:auto}',
    '#twBtns button,#twEmotes button{cursor:pointer;border-radius:12px;border:1px solid rgba(127,214,255,.4);background:rgba(10,20,50,.7);color:#eaf4ff;font-family:inherit}',
    '#twBtns button{height:44px;padding:0 14px;font-size:13px;font-weight:800;letter-spacing:.06em}',
    '#twEmotes{position:absolute;right:calc(12px + var(--safeR));top:calc(104px + var(--safeT));display:grid;grid-template-columns:repeat(4,68px);gap:6px;pointer-events:auto;',
    '  padding:8px;border-radius:14px;background:rgba(6,12,30,.72);border:1px solid rgba(127,214,255,.3)}',
    '#twEmotes button{height:52px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
    '#twEmotes button b{font-size:12.5px;letter-spacing:.02em}#twEmotes button small{font-size:9.5px;color:#a9c8ee}',
    '#twEmotes button:hover,#twBtns button:hover{border-color:#7fd6ff;box-shadow:0 0 14px rgba(127,214,255,.4)}',
    '#twMenu,#twWelcome{background:rgba(3,6,18,.58);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}',
    '#twMenu::before,#twWelcome::before{display:none}',
    '#twWelFirst{font-size:14px;font-weight:700;color:#ffd28a;letter-spacing:.06em}',
    '#twMenu .twWarp{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;width:100%}',
    '.twCard{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:13px;background:rgba(255,255,255,.05);border:1px solid rgba(127,214,255,.2);text-align:left}',
    '.twCard b{font-size:15px;letter-spacing:.06em}.twCard .rw{display:flex;flex-wrap:wrap;gap:6px}',
    /* 文字が 1〜2文字ずつ 折りかえさないように（せまいときは ボタンごと 下の段へ） */
    '.twCard button{flex:1 1 auto;min-width:0;min-height:36px;padding:6px 10px;font-size:12.5px;letter-spacing:.02em;white-space:nowrap}',
    '#twWelcome .panel{max-width:620px}#twWelcome ul{list-style:none;display:grid;gap:6px;text-align:left;font-size:13.5px;line-height:1.6;color:#cfe0f7;width:100%;max-width:460px}',
    '#twWelcome ul b{color:#fff}',
    /* 上の「ためし撃ち」の札・左上の HP とかさならないように: 少し下・はばは 64vw まで */
    '#tutPanel{position:fixed;left:50%;top:calc(64px + var(--safeT));transform:translateX(-50%);z-index:15;width:min(440px,64vw);pointer-events:none;',
    '  padding:12px 16px 14px;border-radius:16px;background:rgba(6,14,36,.82);border:1px solid rgba(127,214,255,.45);box-shadow:0 10px 30px rgba(0,0,0,.4);text-align:center}',
    '#tutPanel .tp{font-size:11px;letter-spacing:.2em;color:#7fd6ff}#tutPanel .tt{font-size:20px;font-weight:900;letter-spacing:.08em;color:#fff;margin:2px 0}',
    '#tutPanel .tk{font-size:13.5px;color:#d8e8ff;line-height:1.6}#tutPanel .bar{height:6px;border-radius:4px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden}',
    '#tutPanel .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#7fd6ff,#ff5ea8);transition:width .25s}',
    '#tutPanel .ok{font-size:13px;color:#8ff0c8;min-height:18px;margin-top:4px}',
    '#tutPanel button{pointer-events:auto;margin-top:8px;min-height:34px;padding:6px 14px;font-size:12px}',
    '#tutDone{position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(3,6,16,.7);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}',
    '#tutDone .panel{padding:22px;border-radius:18px;background:rgba(10,20,50,.9);border:1px solid rgba(127,214,255,.4);max-width:440px}',
    '#btnTown{background:linear-gradient(180deg,rgba(60,200,140,.55),rgba(10,80,60,.66));border-color:rgba(120,240,190,.6)}',
    '#gsSec h3 span{font-size:11px;font-weight:500;color:#9fb4d4;letter-spacing:.04em;margin-left:8px}',
    '#gsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;width:100%}',
    '.gsChip{cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:9px 10px;border-radius:12px;text-align:left;',
    '  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);color:#eaf4ff;font-family:inherit}',
    '.gsChip .sw{width:100%;height:18px;border-radius:6px}.gsChip b{font-size:13px;letter-spacing:.04em}.gsChip small{font-size:10.5px;color:#9fb4d4}',
    '.gsChip.sel{border-color:#7fd6ff;box-shadow:0 0 0 2px rgba(127,214,255,.5)}'
  ].join('\n');

  /* ======================================================================
     Town
     ====================================================================== */
  const NOINP = { mx: 0, mz: 0, lookX: 0, lookY: 0, jump: false, jumpHeld: false, slide: false, slideHeld: false, bomb: false, reload: false, menu: false, firePressed: false, keys: [] };
  const NAME_R = 18, SPOT_LABEL_R = 26;

  class Town {
    constructor(opts) {
      opts = opts || {};
      this.renderer = opts.renderer;
      this.game = opts.game;
      this.handlers = opts.handlers || {};
      this.active = false;
      this.world = null; this.map = null;
      this.me = { pos: [SPAWN[0], 1.5, SPAWN[1]], vel: [0, 0, 0], quat: [0, 0, 0, 1], yaw: 0, grounded: false, still: 0, emote: null };
      this.camYaw = 0; this.camPitch = -0.3; this.camDist = 5.2; this.camPos = [0, 0, 0];
      this.npcs = []; this.friends = new Map(); this.parts = []; this.clouds = [];
      this.t = 0; this.sendT = 0; this.lookT = 0; this.near = null; this.exitArm = 0;
      this.bjCd = 0; this.bjWin = 0; this.bjY = 0;      // v5.4: 大ジャンプ
      this.fly = null; this.padLock = -1; this.dayT = null; this.dayP = 0; this.night = 0;   // CS2: ワープパッド・昼と夜
      this.emoteSeq = 0;
      this.allowTitle = false;
      this._rc = { t: 0, p: [0, 0, 0], n: [0, 0, 0], block: 0 };
      this._mo = { out: { grounded: false, hitX: false, hitY: false, hitZ: false, stepped: false, stepDy: 0 }, stepUp: 1.05 };
      this._pose = { dy: 0, spin: 0, tz: 0, tx: 0, sx: 0 };
      this._built = false;
      this._everEntered = false;
      this._tags = []; this._tagN = 0;
      this._dom();
      this._hookUi();
      this._hookFriends();
    }

    /* ---------------- 町を作る ---------------- */
    _build() {
      this._built = true;
      this.map = buildTown();
      this.world = new CS.World(this.map);
      this.world.buildNav();
      const rng = CS.rng(20260926);
      /* 店員（ストーリーの キャラは ストーリーを すすめると あらわれる: _storyNpcs） */
      for (let i = 0; i < KEEPERS.length; i++) {
        const k = KEEPERS[i];
        if (k.sk || k.need) continue;
        this.npcs.push(this._npc(k.name, [k.x, 1 + PLAYER.half + 0.002, k.z], k.yaw, CS.Skins.random(rng), true, k.lines, rng));
      }
      this._storyNpcs();
      /* 歩く住民 */
      for (let i = 0; i < WALKERS.length; i++) {
        const node = this.world.navRandom(rng);
        const p = this.world.navPos(node, [0, 0, 0]);
        this.npcs.push(this._npc(WALKERS[i], p, rng() * TAU, CS.Skins.random(rng), false, null, rng));
      }
      /* 雲・まわりの山・木は render.js が 屋外マップに かく */
    }
    /* ストーリーの キャラ（長老・ハンマ・クリアすると 四天王と ブラックキューブ）。町に 入るたびに ふえる */
    _storyNpcs() {
      if (!this._built || !CS.StoryData) return;
      const n = storyN(), rng = CS.rng(4242 + n);
      for (const k of KEEPERS) {
        if (!k.sk || (k.need && n < k.need)) continue;
        let npc = this.npcs.find((q) => q.sid === k.sk);
        if (!npc) {
          npc = this._npc(k.name, [k.x, 1 + PLAYER.half + 0.002, k.z], k.yaw, CS.StoryData.skinOf(k.sk), !k.walk, k.lines || elderLines(), rng);
          npc.sid = k.sk; npc.team = 1;
          if (k.walk) npc.speed = k.walk;
          this.npcs.push(npc);
        }
        if (k.story) npc.lines = elderLines();
      }
    }
    _npc(name, pos, yaw, skin, keeper, lines, rng) {
      return {
        name: name, pos: [pos[0], pos[1], pos[2]], vel: [0, 0, 0], quat: yawQuat(yaw), yaw: yaw, home: yaw, skin: skin,
        team: rng() < 0.5 ? 0 : 1, keeper: !!keeper, lines: lines || TIPS, li: Math.floor(rng() * 20),
        path: null, pi: 0, wait: rng() * 3, stuck: 0, say: '', sayT: 0, talkCD: 0, emote: null, grounded: true,
        speed: 1.8 + rng() * 0.9, mo: { out: { grounded: false }, stepUp: 1.05 }
      };
    }
    _place(x, z, yaw) {
      const me = this.me, h = PLAYER.half + 0.002;
      me.pos[0] = x; me.pos[2] = z; me.pos[1] = 1 + h;
      /* ブロックの上なら上へ */
      for (let k = 0; k < 12 && this.world.overlapsBox(me.pos, PLAYER.half); k++) me.pos[1] += 1;
      me.vel[0] = me.vel[1] = me.vel[2] = 0;
      if (yaw != null) { me.yaw = yaw; this.camYaw = yaw; }
      me.quat = yawQuat(me.yaw);
    }

    /* ---------------- 出入り ---------------- */
    enter() {
      if (!this._built) this._build();
      if (CS.Tutorial && CS.Tutorial.active) CS.Tutorial.stop();
      if (!this._everEntered) { this._everEntered = true; this._place(SPAWN[0], SPAWN[1], 0); }
      this._storyNpcs();
      this.active = true;
      if (this.renderer && this.renderer.ok && this.renderer.world !== this.world) this.renderer.setWorld(this.world);
      try { CS.UI.hud.show(false); CS.UI.hud.clickToPlay(false); } catch (e) {}
      try { CS.Input.setLabels({ fire: 'エモート', jump: 'ジャンプ', slide: 'ダッシュ', bomb: 'はいる', reload: 'ワープ' }); } catch (e) {}
      this.hud.hidden = !!CS.UI.current;
      this.sendT = 0; this.lookT = 0;
      this._welcomeCheck();
    }
    /* ロビー（へやの画面）の うしろに 町を出すだけ（しあいから ロビーへ もどったとき・コードのリンクで来たとき） */
    wake() {
      if (this.active) return;
      if (!this._built) this._build();
      this.active = true;
    }
    suspend() {
      if (!this.active) return;
      this.active = false;
      this.hud.hidden = true;
      this.emoteBox.hidden = true;
      this.me.emote = null;
      try { CS.Input.setLabels(null); } catch (e) {}
      if (this._live) { this._live = false; this._sendGone(); }
    }
    goTown() {
      this.allowTitle = false;
      CS.UI.show(null);
      this.enter();
    }
    /* タイトル画面（これまでのメニュー）を見る */
    showTitle() {
      this.allowTitle = true;
      CS.UI.show('scTitle');
    }

    /* ---------------- 毎フレーム ----------------
       backdrop = true: ロビー（へやの画面）の うしろに 町を出すだけ。入力は さわらない・フレンドに位置を送らない */
    frame(dt, inp, backdrop) {
      if (!this.active || !this.world) return;
      this.t += dt;
      const uiOpen = !!backdrop || !!CS.UI.current;
      if (backdrop) {
        inp = NOINP;
        this.hud.hidden = true;
      } else if (uiOpen) {
        if (CS.Input.enabled) CS.Input.enable(false);
        inp = NOINP;
        this.hud.hidden = true;
      } else {
        /* メニューを閉じた同じ Esc で また開かないように、入力は 次のフレームから */
        if (!CS.Input.enabled) { CS.Input.enable(true); inp = NOINP; }
        this.hud.hidden = false;
        this._input(inp || NOINP);
      }
      if (uiOpen) this.emoteBox.hidden = true;
      if (this.renderer && this.renderer.world !== this.world) this.renderer.setWorld(this.world);
      this._dayNight(dt);
      if (!this._pads(dt, uiOpen ? NOINP : inp)) this._move(dt, uiOpen ? NOINP : inp);
      for (let i = 0; i < this.npcs.length; i++) this._updNpc(this.npcs[i], dt);
      this._updFriends(dt);
      this._updFx(dt);
      this._findNear();
      if (uiOpen) this.camYaw = wrap(this.camYaw + dt * 0.08);     // メニューの うしろで ゆっくり まわる
      this._camera(dt);
      this._draw();
      this._hudUpdate(uiOpen);
      if (backdrop) { if (this._live) { this._live = false; this._sendGone(); } }
      else { this._live = true; this._sendFriends(dt); }
    }

    _input(inp) {
      if (inp.menu) { this.openMenu(); return; }
      const keys = inp.keys || [];
      for (let i = 0; i < keys.length; i++) {
        const c = keys[i];
        const m = /^Digit([1-8])$/.exec(c);
        if (m) this.doEmote(EMOTES[+m[1] - 1].id);
        else if (c === 'KeyF') this.toggleEmotes();
      }
      if (inp.firePressed && CS.Input.isTouch) this.toggleEmotes();
      if (inp.reload) this.openMenu();
      if (inp.bomb) this.interact();
    }

    /* ---------------- じぶんの動き ---------------- */
    _move(dt, inp) {
      const me = this.me;
      this.camYaw = wrap(this.camYaw - (inp.lookX || 0));
      this.camPitch = clamp(this.camPitch + (inp.lookY || 0), -1.05, 0.35);
      const fw = V.flatForward(this.camYaw), rt = V.right(this.camYaw);
      let wx = fw[0] * inp.mz + rt[0] * inp.mx, wz = fw[2] * inp.mz + rt[2] * inp.mx;
      const wl = Math.hypot(wx, wz);
      if (wl > 1e-4) { wx /= wl; wz /= wl; }
      const wish = Math.min(1, wl);
      const run = inp.slideHeld ? 1.7 : 1;
      const speed = PLAYER.speed * run * wish;
      const vel = me.vel;
      const n = Math.max(1, Math.ceil(dt / 0.017)), sdt = dt / n;
      /* v5.4: 大ジャンプ（ジャンプして 上がっている あいだに もう一回） */
      const BJ = PLAYER.bigJump;
      if (this.bjCd > 0) this.bjCd -= dt;
      if (this.bjWin > 0) this.bjWin -= dt;
      if (inp.jump && me.grounded) { vel[1] = PLAYER.jump; me.grounded = false; this._sfx('jump'); this.bjWin = BJ.win; this.bjY = me.pos[1]; }
      else if (inp.jump && this.bjWin > 0 && this.bjCd <= 0 && vel[1] > -3) {
        vel[1] = Math.max(vel[1], Math.sqrt(2 * PLAYER.gravity * Math.max(1, this.bjY + BJ.h - me.pos[1])));
        this.bjWin = 0; this.bjCd = BJ.cd;
        this._sfx('bigjump');
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * TAU;
          this.parts.push({ x: me.pos[0], y: me.pos[1] - 0.38, z: me.pos[2], vx: Math.cos(a) * 3.5, vy: 0.5, vz: Math.sin(a) * 3.5, g: 2, life: 0.5, max: 0.5, s: 0.14, c: [0.85, 0.95, 1] });
        }
      }
      if (CS.Input.setBigJump) CS.Input.setBigJump(1 - clamp(this.bjCd / BJ.cd, 0, 1));
      for (let s = 0; s < n; s++) {
        if (me.grounded) {
          const sp = Math.hypot(vel[0], vel[2]);
          if (sp > 0.001) { const drop = Math.max(sp * PLAYER.friction * sdt, PLAYER.friction * 0.15 * sdt); const k = Math.max(0, sp - drop) / sp; vel[0] *= k; vel[2] *= k; }
        }
        if (speed > 0) {
          const ac = me.grounded ? PLAYER.accel : PLAYER.airAccel;
          const cur = vel[0] * wx + vel[2] * wz, add = speed - cur;
          if (add > 0) { let a = ac * speed * sdt; if (a > add) a = add; vel[0] += wx * a; vel[2] += wz * a; }
        }
        vel[1] -= PLAYER.gravity * sdt;
        if (vel[1] < -40) vel[1] = -40;
        const res = this.world.moveBox(me.pos, PLAYER.half, vel, sdt, this._mo);
        me.grounded = res.grounded;
      }
      const hs = Math.hypot(vel[0], vel[2]);
      if (wish > 0.1) { me.yaw = lerpAngle(me.yaw, yawTo(wx, wz), dt * 12); me.still = 0; }
      else me.still += dt;
      if (hs > 0.3 && !me.emote) me.quat = Q.roll(me.quat, vel[0], vel[2], dt, PLAYER.half);
      else if (me.still > 0.25) me.quat = Q.slerp(me.quat, yawQuat(me.yaw), 1 - Math.exp(-8 * dt));
      if (me.emote && (hs > 1.5 || this.t - me.emote.t0 > me.emote.dur)) me.emote = null;
      if (me.pos[1] < -4) this._place(SPAWN[0], SPAWN[1], 0);
    }

    /* 昼と 夜: 空・光・霧・雲の 色を まぜる（render.js の 環境の あたいを まいフレーム 書きかえる） */
    _dayNight(dt) {
      const r = this.renderer;
      if (this.dayT == null) this.dayT = CYCLE * 0.06;
      this.dayT = (this.dayT + dt) % CYCLE;
      const p = this.dayT / CYCLE;
      this.dayP = p;
      if (!r || !r._sky) return;
      let i = 0;
      while (i < SKY_KEYS.length - 2 && p > SKY_KEYS[i + 1][0]) i++;
      const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
      const k0 = b[0] > a[0] ? clamp((p - a[0]) / (b[0] - a[0]), 0, 1) : 0, k = k0 * k0 * (3 - 2 * k0);
      const A = SKY[a[1]], B = SKY[b[1]];
      const mix = (dst, x, y) => { for (let j = 0; j < 3; j++) dst[j] = x[j] + (y[j] - x[j]) * k; };
      mix(r._sky, A.sky, B.sky); mix(r._skyTop, A.skyTop, B.skyTop);
      mix(r._ambSky, A.ambSky, B.ambSky); mix(r._ambGnd, A.ambGnd, B.ambGnd); mix(r._sunCol, A.sunCol, B.sunCol);
      const sd = this._sd || (this._sd = [0, 0, 0]);
      mix(sd, A.sun, B.sun);
      const sl = Math.hypot(sd[0], sd[1], sd[2]) || 1;
      r._sun[0] = sd[0] / sl; r._sun[1] = sd[1] / sl; r._sun[2] = sd[2] / sl;
      r._fogNear = A.fog[0] + (B.fog[0] - A.fog[0]) * k; r._fogFar = A.fog[1] + (B.fog[1] - A.fog[1]) * k;
      if (r._scen) {
        /* 雲の 色は じぶん用の 配列に（render.js の けしきの 色を 書きかえない） */
        if (!r._scen.ownCloud) { r._scen.cloud = [1, 1, 1]; r._scen.ownCloud = true; }
        mix(r._scen.cloud, A.cloud, B.cloud);
      }
      /* 夜の 明るさ（0 = 昼 / 1 = 夜）: ネオンの 光を つよく 見せる */
      this.night = p < 0.4 ? 0 : p < 0.56 ? (p - 0.4) / 0.16 : p < 0.88 ? 1 : p < 0.96 ? 1 - (p - 0.88) / 0.08 : 0;
    }

    /* ワープパッド: のると ペアの パッドへ ジャンプで とぶ。とんでいる あいだは true（ふつうの 動きを しない） */
    _pads(dt, inp) {
      const me = this.me;
      if (this.fly) {
        this.camYaw = wrap(this.camYaw - (inp.lookX || 0));
        this.camPitch = clamp(this.camPitch + (inp.lookY || 0), -1.05, 0.35);
        const F = this.fly;
        F.t += dt / F.dur;
        const k = Math.min(1, F.t);
        me.pos[0] = F.a[0] + (F.b[0] - F.a[0]) * k;
        me.pos[2] = F.a[2] + (F.b[2] - F.a[2]) * k;
        me.pos[1] = F.a[1] + (F.b[1] - F.a[1]) * k + Math.sin(Math.PI * k) * F.h;
        me.vel[0] = me.vel[1] = me.vel[2] = 0;
        me.quat = Q.mul(yawQuat(me.yaw), Q.fromAxisAngle([1, 0, 0], -k * TAU));
        if (Math.random() < 0.7) this.parts.push({ x: me.pos[0], y: me.pos[1], z: me.pos[2], vx: 0, vy: 0, vz: 0, g: 0, life: 0.6, max: 0.6, s: 0.18, c: [0.45, 1, 0.5] });
        if (k >= 1) {
          this.fly = null;
          this.padLock = F.to;
          me.grounded = true; me.quat = yawQuat(me.yaw);
          for (let i = 0; i < 18; i++) {
            const a = i / 18 * TAU;
            this.parts.push({ x: me.pos[0], y: me.pos[1] - 0.4, z: me.pos[2], vx: Math.cos(a) * 3.5, vy: 1, vz: Math.sin(a) * 3.5, g: 3, life: 0.6, max: 0.6, s: 0.15, c: [0.45, 1, 0.5] });
          }
          this._sfx('land');
        }
        return true;
      }
      if (this.padLock >= 0) {
        const P = PADS[this.padLock];
        if (!P || Math.hypot(me.pos[0] - P.x, me.pos[2] - P.z) > 1.6) this.padLock = -1;
      }
      if (!me.grounded || me.emote) return false;
      for (let i = 0; i < PADS.length; i++) {
        if (i === this.padLock) continue;
        const P = PADS[i];
        if (Math.hypot(me.pos[0] - P.x, me.pos[2] - P.z) > PAD_R || Math.abs(me.pos[1] - 1.5) > 0.6) continue;
        const D = PADS[P.to];
        const d = Math.hypot(D.x - P.x, D.z - P.z);
        this.fly = { a: [P.x, me.pos[1], P.z], b: [D.x, 1 + PLAYER.half + 0.002, D.z], t: 0, dur: clamp(0.7 + d / 40, 0.9, 1.8), h: clamp(4 + d * 0.22, 5, 12), to: P.to };
        me.yaw = yawTo(D.x - P.x, D.z - P.z);
        this._sfx('bigjump');
        return true;
      }
      return false;
    }

    _camera(dt) {
      const me = this.me;
      const tgt = [me.pos[0], me.pos[1] + 0.85, me.pos[2]];
      const fw = V.forward(this.camYaw, this.camPitch);
      const back = [-fw[0], -fw[1], -fw[2]];
      const want = 5.2;
      const hit = this.world.raycast(tgt, back, want + 0.4, this._rc);
      const d = hit ? Math.max(0.7, hit.t - 0.35) : want;
      this.camDist += (d - this.camDist) * (d < this.camDist ? 1 : Math.min(1, dt * 3));
      const c = this.camPos;
      c[0] = tgt[0] + back[0] * this.camDist; c[1] = tgt[1] + back[1] * this.camDist; c[2] = tgt[2] + back[2] * this.camDist;
      const A = CS.Audio;
      if (A && A.listener) { A.listener.pos[0] = c[0]; A.listener.pos[1] = c[1]; A.listener.pos[2] = c[2]; A.listener.yaw = this.camYaw; }
      const cam = this._cam || (this._cam = { pos: c, yaw: 0, pitch: 0, fov: 70, shake: 0 });
      cam.pos = c; cam.yaw = this.camYaw; cam.pitch = this.camPitch;
      this.renderer.begin(cam);
    }

    /* ---------------- 住民 ---------------- */
    _updNpc(n, dt) {
      const me = this.me;
      const dx = me.pos[0] - n.pos[0], dz = me.pos[2] - n.pos[2], dist = Math.hypot(dx, dz);
      if (n.sayT > 0) n.sayT -= dt;
      if (n.talkCD > 0) n.talkCD -= dt;
      if (dist < 3.3 && n.talkCD <= 0 && this.active) {
        n.say = n.lines[n.li % n.lines.length]; n.li++; n.sayT = 4.5; n.talkCD = 10;
      }
      if (n.emote && this.t - n.emote.t0 > n.emote.dur) n.emote = null;
      if (n.keeper) {
        n.yaw = lerpAngle(n.yaw, dist < 6 ? yawTo(dx, dz) : n.home, dt * 4);
        n.quat = Q.slerp(n.quat, yawQuat(n.yaw), 1 - Math.exp(-10 * dt));
        return;
      }
      const w = this.world, v = n.vel;
      v[0] = 0; v[2] = 0;
      if (dist < 2.2) {
        /* プレイヤーのそばでは 止まって こっちを見る */
        n.yaw = lerpAngle(n.yaw, yawTo(dx, dz), dt * 5);
      } else if (n.wait > 0) {
        n.wait -= dt;
        if (!n.emote && Math.random() < dt * 0.06) n.emote = { id: EMOTES[Math.floor(Math.random() * EMOTES.length)].id, t0: this.t, dur: 2 };
      } else if (!n.path || n.pi >= n.path.length) {
        const tp = w.navPos(w.navRandom(), [0, 0, 0]);
        if (Math.hypot(tp[0] - n.pos[0], tp[2] - n.pos[2]) < 6) n.wait = 1;
        else { n.path = w.navPath(n.pos, tp, 6000) || null; n.pi = 0; if (!n.path || !n.path.length) { n.path = null; n.wait = 2; } }
        n.stuck = 0;
      } else {
        const wp = n.path[n.pi];
        const ex = wp[0] - n.pos[0], ez = wp[2] - n.pos[2], d = Math.hypot(ex, ez);
        if (d < 0.35) {
          n.pi++;
          if (n.pi >= n.path.length) { n.path = null; n.wait = 2 + Math.random() * 5; }
        } else {
          v[0] = ex / d * n.speed; v[2] = ez / d * n.speed;
          n.yaw = lerpAngle(n.yaw, yawTo(ex, ez), dt * 6);
          if (wp[1] > n.pos[1] + 0.5 && n.grounded) v[1] = PLAYER.jump;
          n.stuck += dt;
          if (n.stuck > 6) { n.path = null; n.wait = 1; }
        }
      }
      v[1] -= PLAYER.gravity * dt;
      const res = w.moveBox(n.pos, PLAYER.half, v, dt, n.mo);
      n.grounded = res.grounded;
      if (res.grounded && v[1] < 0) v[1] = 0;
      const hs = Math.hypot(v[0], v[2]);
      if (hs > 0.3 && !n.emote) { n.quat = Q.roll(n.quat, v[0], v[2], dt, PLAYER.half); if (n.path) n.stuck = Math.max(0, n.stuck - dt * 0.9); }
      else n.quat = Q.slerp(n.quat, yawQuat(n.yaw), 1 - Math.exp(-6 * dt));
      if (n.pos[1] < -4) { const p = w.navPos(w.navRandom()); n.pos[0] = p[0]; n.pos[1] = p[1]; n.pos[2] = p[2]; n.path = null; }
    }

    /* ---------------- フレンド ---------------- */
    _hookFriends() {
      const hub = CS.Friends && CS.Friends.hub;
      if (!hub || this._fhook) return;
      this._fhook = true;
      hub.on('town', (code, d) => {
        if (!d || typeof d !== 'object') return;
        let f = this.friends.get(code);
        if (!f) { f = { code: code, pos: null, tpos: [0, 0, 0], quat: [0, 0, 0, 1], yaw: 0, skin: null, last: 0, inTown: false, emote: null, es: -1 }; this.friends.set(code, f); }
        if (d.gone) { f.inTown = false; f.last = 0; return; }
        const x = +d.x, y = +d.y, z = +d.z;
        if (!(x >= 0 && x <= 96 && y >= -2 && y <= 30 && z >= 0 && z <= 64)) return;
        f.tpos[0] = x; f.tpos[1] = y; f.tpos[2] = z;
        if (!f.pos) f.pos = [x, y, z];
        if (isFinite(+d.yw)) f.yaw = wrap(+d.yw);
        if (d.look) f.skin = CS.Skins.clean(d.look);
        if (typeof d.gn === 'string' && CS.GunMap && Object.prototype.hasOwnProperty.call(CS.GunMap, d.gn)) f.gun = d.gn;
        if (typeof d.e === 'string' && EMOTE_MAP[d.e] && (d.es | 0) !== f.es) { f.es = d.es | 0; f.emote = { id: d.e, t0: this.t, dur: EMOTE_MAP[d.e].dur }; }
        f.inTown = true; f.last = this.t;
      });
    }
    _updFriends(dt) {
      const hub = CS.Friends && CS.Friends.hub;
      if (!hub) return;
      this._flT = (this._flT || 0) - dt;
      if (this._flT <= 0) {
        this._flT = 1;
        this._flist = hub.friendList().filter((x) => x.online);
        const alive = {};
        this._flist.forEach((x) => { alive[x.code] = 1; });
        for (const code of Array.from(this.friends.keys())) if (!alive[code]) this.friends.delete(code);
        let slot = 0;
        for (const x of this._flist) {
          let f = this.friends.get(x.code);
          if (!f) { f = { code: x.code, pos: null, tpos: [0, 0, 0], quat: [0, 0, 0, 1], yaw: 0, skin: null, last: 0, inTown: false, emote: null, es: -1 }; this.friends.set(x.code, f); }
          f.name = x.name || 'フレンド'; f.st = x.st || { s: 'menu' };
          if (!(f.inTown && this.t - f.last < 3)) {
            const s = FRIEND_SLOTS[slot % FRIEND_SLOTS.length]; slot++;
            f.tpos[0] = s[0]; f.tpos[2] = s[1]; f.tpos[1] = 1 + PLAYER.half + 0.002;
            f.yaw = yawTo(CENTER[0] - s[0], CENTER[1] - s[1]);
            if (!f.pos) f.pos = [f.tpos[0], f.tpos[1], f.tpos[2]];
            f.inTown = false;
          }
        }
      }
      for (const f of this.friends.values()) {
        if (!f.pos) continue;
        const dx = f.tpos[0] - f.pos[0], dy = f.tpos[1] - f.pos[1], dz = f.tpos[2] - f.pos[2];
        if (dx * dx + dy * dy + dz * dz > 36) { f.pos[0] = f.tpos[0]; f.pos[1] = f.tpos[1]; f.pos[2] = f.tpos[2]; }
        else { const k = Math.min(1, dt * 10); f.pos[0] += dx * k; f.pos[1] += dy * k; f.pos[2] += dz * k; }
        const hs = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
        if (hs > 0.6 && !f.emote) f.quat = Q.roll(f.quat, dx * 10, dz * 10, dt, PLAYER.half);
        else f.quat = Q.slerp(f.quat, yawQuat(f.yaw), 1 - Math.exp(-6 * dt));
        if (f.emote && this.t - f.emote.t0 > f.emote.dur) f.emote = null;
      }
    }
    _sendFriends(dt) {
      const hub = CS.Friends && CS.Friends.hub;
      if (!hub || hub.net !== 'online' || !this._flist || !this._flist.length) return;
      this.sendT -= dt;
      if (this.sendT > 0) return;
      this.sendT = 0.2;
      const me = this.me;
      const m = { x: r2(me.pos[0]), y: r2(me.pos[1]), z: r2(me.pos[2]), yw: r2(me.yaw) };
      if (me.emote) { m.e = me.emote.id; m.es = this.emoteSeq; }
      this.lookT -= 0.2;
      if (this.lookT <= 0) { this.lookT = 2; m.look = CS.Skins.mine() || CS.Skins.blank(); m.gn = CS.Settings.gun || 'ar'; }
      hub.sendTown(m);
    }
    _sendGone() {
      const hub = CS.Friends && CS.Friends.hub;
      if (hub && hub.net === 'online') { try { hub.sendTown({ gone: 1 }); } catch (e) {} }
    }

    /* ---------------- エモート ---------------- */
    doEmote(id) {
      const e = EMOTE_MAP[id];
      if (!e || !this.active) return;
      this.me.emote = { id: id, t0: this.t, dur: e.dur };
      this.emoteSeq++;
      this.sendT = 0;
      this.emoteBox.hidden = true;
      this._sfx('click');
    }
    toggleEmotes() { this.emoteBox.hidden = !this.emoteBox.hidden; }
    _emoteFx(ent, pos) {
      const e = ent.emote;
      if (!e) return;
      const t = this.t - e.t0, P = this.parts;
      const rnd = Math.random;
      if (e.id === 'love' && rnd() < 0.18) P.push({ x: pos[0] + (rnd() - 0.5) * 0.6, y: pos[1] + 0.7, z: pos[2] + (rnd() - 0.5) * 0.6, vx: 0, vy: 1.1, vz: 0, g: 0, life: 1.2, max: 1.2, s: 0.26, c: [1, 0.35, 0.6] });
      else if (e.id === 'yay' && t > 0.5 && t < 0.9 && rnd() < 0.8) {
        const C = [[1, 0.85, 0.25], [1, 1, 1], [1, 0.45, 0.75], [0.45, 0.95, 1], [0.6, 1, 0.5]];
        P.push({ x: pos[0], y: pos[1] + 1.3, z: pos[2], vx: (rnd() - 0.5) * 5, vy: 2 + rnd() * 3, vz: (rnd() - 0.5) * 5, g: 6, life: 1.4, max: 1.4, s: 0.12, c: C[Math.floor(rnd() * C.length)] });
      } else if (e.id === 'sleep' && rnd() < 0.05) P.push({ x: pos[0] + 0.3, y: pos[1] + 0.7, z: pos[2], vx: 0.25, vy: 0.5, vz: 0, g: 0, life: 1.6, max: 1.6, s: 0.18, c: [0.8, 0.9, 1] });
      else if (e.id === 'angry' && rnd() < 0.3) P.push({ x: pos[0] + (rnd() - 0.5) * 0.5, y: pos[1] + 0.6, z: pos[2] + (rnd() - 0.5) * 0.5, vx: (rnd() - 0.5), vy: 1.2, vz: (rnd() - 0.5), g: 0, life: 0.6, max: 0.6, s: 0.22, c: [1, 0.3, 0.2] });
      else if (e.id === 'good' && rnd() < 0.12) P.push({ x: pos[0], y: pos[1] + 0.9, z: pos[2], vx: (rnd() - 0.5) * 0.6, vy: 1.4, vz: (rnd() - 0.5) * 0.6, g: 0, life: 0.9, max: 0.9, s: 0.24, c: [1, 0.85, 0.3] });
      else if (e.id === 'dance' && rnd() < 0.1) P.push({ x: pos[0] + (rnd() - 0.5), y: pos[1] + 0.2, z: pos[2] + (rnd() - 0.5), vx: 0, vy: 0.8, vz: 0, g: 0, life: 0.8, max: 0.8, s: 0.16, c: [0.6, 0.85, 1] });
    }
    _updFx(dt) {
      /* ふんすいの水しぶき・武器こうぼうの えんとつの けむり */
      if (Math.random() < dt * 40) {
        const a = Math.random() * TAU, s = 0.7 + Math.random() * 0.8;
        this.parts.push({ x: CENTER[0], y: 4.6, z: CENTER[1], vx: Math.cos(a) * s, vy: 3.8 + Math.random() * 1.2, vz: Math.sin(a) * s, g: 9, life: 1.3, max: 1.3, s: 0.13, c: [0.6, 0.85, 1] });
      }
      if (Math.random() < dt * 6) this.parts.push({ x: 7 + Math.random() * 0.5, y: 13, z: 20 + Math.random() * 0.5, vx: 0.3, vy: 1.2, vz: 0.1, g: -0.2, life: 2.4, max: 2.4, s: 0.35, c: [0.6, 0.6, 0.65] });
      const P = this.parts;
      let j = 0;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0 || p.y < 0.8) continue;
        p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        P[j++] = p;
      }
      P.length = Math.min(j, 600);
    }

    /* ---------------- 近くの「入れるもの」 ---------------- */
    _findNear() {
      const me = this.me;
      let best = null, bd = Infinity;
      for (const s of SPOTS) {
        const d = Math.hypot(me.pos[0] - s.x, me.pos[2] - s.z);
        if (d < SPOT_R && d < bd && Math.abs(me.pos[1] - 1.5) < 1.2) { bd = d; best = { kind: 'spot', spot: s }; }
      }
      for (const f of this.friends.values()) {
        if (!f.pos) continue;
        const d = Math.hypot(me.pos[0] - f.pos[0], me.pos[2] - f.pos[2]);
        if (d < 2.0 && d < bd) { bd = d; best = { kind: 'friend', f: f }; }
      }
      if (this.exitArm > 0) this.exitArm -= 1 / 60;
      this.near = best;
    }
    interact() {
      const n = this.near;
      if (!n) return;
      if (n.kind === 'friend') {
        const st = n.f.st || {};
        if (st.s === 'lobby' && st.open && st.room && CS.UI.joinCode) { this._leaveInput(); CS.UI.joinCode(st.room); return; }
        this._leaveInput();
        const b = CS.$('btnFriends'); if (b) b.click();
        return;
      }
      const s = n.spot;
      this._sfx('ok');
      if (s.act === 'tutorial') { CS.Tutorial.start(); return; }
      if (s.act === 'exit') {
        if (this.exitArm > 0) { location.href = '../index.html'; return; }
        this.exitArm = 3;
        return;
      }
      const el = CS.$(s.act);
      if (el) { this._leaveInput(); el.click(); }
    }
    _leaveInput() { try { CS.Input.enable(false); } catch (e) {} this.emoteBox.hidden = true; }

    /* ---------------- 描く ---------------- */
    _drawEnt(ent, team, name) {
      const P = this._pose;
      const pos = ent.pos;
      let q = ent.quat;
      let px = pos[0], py = pos[1], pz = pos[2];
      if (ent.emote) {
        emotePose(ent.emote.id, this.t - ent.emote.t0, P);
        q = yawQuat(ent.yaw + P.spin);
        if (P.tz) q = Q.mul(q, Q.fromAxisAngle([0, 0, 1], P.tz));
        if (P.tx) q = Q.mul(q, Q.fromAxisAngle([1, 0, 0], P.tx));
        const r = V.right(ent.yaw);
        px += r[0] * P.sx; pz += r[2] * P.sx; py += P.dy;
        this._emoteFx(ent, pos);
      }
      const rp = this._rp || (this._rp = [0, 0, 0]);
      rp[0] = px; rp[1] = py; rp[2] = pz;
      /* 銃: じぶんとフレンドは いまの銃を持って歩く（銃のスキンが みんなに見える）。住民は 手ぶら */
      this.renderer.player({
        pos: rp, quat: q, yaw: ent.yaw + (ent.emote ? P.spin : 0), pitch: 0, team: team, gun: ent.gun || false, gunScale: 1.8, skin: ent.skin || null,
        flash: 0, protect: false, hit: 0, alpha: 1, spin: 0, charge: 0, side: 0, slide: 0
      });
    }
    _draw() {
      const r = this.renderer;
      const me = this.me;
      /* 入れる場所のしるし（光る輪と、うかぶ ひし形） */
      for (const s of SPOTS) {
        const d = Math.hypot(me.pos[0] - s.x, me.pos[2] - s.z);
        if (d > 45) continue;
        const on = this.near && this.near.spot === s;
        const k = 0.5 + 0.5 * Math.sin(this.t * 3 + s.x);
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU + this.t * 0.8;
          r.particle([s.x + Math.cos(a) * 1.25, 1.08, s.z + Math.sin(a) * 1.25], on ? 0.34 : 0.24, s.col, 0.55 + 0.35 * k);
        }
        const bob = Math.sin(this.t * 2 + s.z) * 0.12;
        const q = Q.fromAxisAngle([0, 1, 0], this.t * 1.5 + s.x);
        const qq = Q.mul(q, Q.fromAxisAngle([0, 0, 1], Math.PI / 4));
        r.cube([s.x, 2.9 + bob, s.z], Q.mul(qq, Q.fromAxisAngle([1, 0, 0], Math.PI / 4)), 0.34, s.col, { emissive: 0.9 });
      }
      /* ワープパッド（光る わと 上へ のぼる ひかり） */
      for (let i = 0; i < PADS.length; i++) {
        const P = PADS[i];
        if (Math.hypot(me.pos[0] - P.x, me.pos[2] - P.z) > 50) continue;
        for (let j = 0; j < 12; j++) {
          const a = j / 12 * TAU - this.t * 1.6;
          r.particle([P.x + Math.cos(a) * 1.15, 1.06, P.z + Math.sin(a) * 1.15], 0.24, [0.45, 1, 0.5], 0.75);
        }
        const up = (this.t * 1.4 + i * 0.37) % 1;
        r.particle([P.x, 1.1 + up * 2.6, P.z], 0.5 * (1 - up), [0.55, 1, 0.6], 0.6 * (1 - up));
        r.particle([P.x, 1.15, P.z], 1.6, [0.4, 1, 0.5], 0.18 + 0.12 * (this.night || 0));
      }
      /* 広場の ホログラム（色が かわる 大きな キューブ） */
      {
        const hue = (this.t * 0.08) % 1, hc = hsv(hue, 0.65, 1);
        const q = Q.mul(Q.fromAxisAngle([0, 1, 0], this.t * 0.6), Q.fromAxisAngle([1, 0, 1].map((v) => v * Math.SQRT1_2), 0.6));
        r.cube([CENTER[0], 7.2 + Math.sin(this.t * 1.3) * 0.25, CENTER[1]], q, 1.5, hc, { emissive: 0.7 + 0.3 * (this.night || 0) });
        for (let j = 0; j < 4; j++) {
          const a = this.t * 1.1 + j * TAU / 4;
          r.cube([CENTER[0] + Math.cos(a) * 2.2, 7.2 + Math.sin(this.t * 2 + j) * 0.4, CENTER[1] + Math.sin(a) * 2.2], q, 0.35, hsv((hue + j * 0.25) % 1, 0.7, 1), { emissive: 0.9 });
        }
        r.particle([CENTER[0], 7.2, CENTER[1]], 4.5, hc, 0.12 + 0.18 * (this.night || 0));
      }
      /* 住民・フレンド・じぶん */
      for (let i = 0; i < this.npcs.length; i++) this._drawEnt(this.npcs[i], this.npcs[i].team, this.npcs[i].name);
      for (const f of this.friends.values()) if (f.pos) this._drawEnt(f, 0, f.name);
      /* じぶん: スキン（銃のスキンこみ）と いまの銃。銃のスキンだけ変えたときも 見えるように g を入れる */
      const mine = CS.Skins.mine();
      this.me.skin = mine || (this._blankSkin || (this._blankSkin = CS.Skins.blank()));
      this.me.gun = CS.Settings.gun || 'ar';
      this._drawEnt(this.me, 1, '');
      /* つぶ */
      for (const p of this.parts) r.particle([p.x, p.y, p.z], p.s, p.c, Math.min(1, p.life / p.max * 1.5));
      r.end();
    }

    /* ---------------- 画面の上の表示 ---------------- */
    _dom() {
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      const html =
        '<div id="townHud" hidden>' +
        '<div id="twTags"></div>' +
        '<div id="twTop"><b>キューブタウン</b><span id="twPlace">広場</span></div>' +
        '<div id="twFr">フレンド 0人 オンライン</div>' +
        '<div id="twBtns"><button id="twEmoteBtn" type="button" title="エモート（F）">エモート</button><button id="twMenuBtn" type="button" title="メニュー（Esc）">メニュー</button></div>' +
        '<div id="twEmotes" hidden></div>' +
        '<div id="twPrompt"></div>' +
        '<div id="twHint"></div>' +
        '</div>';
      document.body.insertAdjacentHTML('beforeend', html);
      this.hud = CS.$('townHud');
      this.tagsEl = CS.$('twTags');
      this.promptEl = CS.$('twPrompt');
      this.hintEl = CS.$('twHint');
      this.placeEl = CS.$('twPlace');
      this.frEl = CS.$('twFr');
      this.emoteBox = CS.$('twEmotes');
      EMOTES.forEach((e, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<b>' + esc(e.name) + '</b><small>' + (i + 1) + '</small>';
        b.addEventListener('click', (ev) => { ev.stopPropagation(); this.doEmote(e.id); });
        this.emoteBox.appendChild(b);
      });
      CS.$('twEmoteBtn').addEventListener('click', (e) => { e.stopPropagation(); this.toggleEmotes(); });
      CS.$('twMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); this.openMenu(); });
    }
    _tag(i) {
      let el = this._tags[i];
      if (!el) {
        el = document.createElement('div');
        el.className = 'twTag';
        el.innerHTML = '<span class="ic"></span><span class="em"></span><span class="bb"></span><span class="nm"></span><small></small>';
        el._p = { ic: el.children[0], em: el.children[1], bb: el.children[2], nm: el.children[3], sm: el.children[4], sig: '' };
        this.tagsEl.appendChild(el);
        this._tags[i] = el;
      }
      return el;
    }
    _putTag(pos, kind, name, bubble, emoji, icon, sub) {
      const r = this.renderer;
      const s = M4.project(r.viewProj, pos, r.width, r.height);
      if (!s || s[0] < -80 || s[0] > r.width + 80 || s[1] < -40 || s[1] > r.height + 60) return;
      const el = this._tag(this._tagN++);
      const p = el._p;
      const sig = kind + '|' + name + '|' + bubble + '|' + emoji + '|' + icon + '|' + sub;
      if (p.sig !== sig) {
        p.sig = sig;
        el.className = 'twTag' + (kind === 'spot' ? ' spot' : '');
        p.ic.textContent = icon || ''; p.ic.style.display = icon ? '' : 'none';
        p.em.textContent = emoji || ''; p.em.style.display = emoji ? '' : 'none';
        p.bb.textContent = bubble || ''; p.bb.style.display = bubble ? '' : 'none';
        p.nm.textContent = name || ''; p.nm.style.display = name ? '' : 'none';
        p.nm.className = 'nm' + (kind === 'friend' ? ' fr' : kind === 'keeper' ? ' kp' : '');
        p.sm.textContent = sub || ''; p.sm.style.display = sub ? '' : 'none';
      }
      el.style.display = '';
      el.style.transform = 'translate(' + Math.round(s[0]) + 'px,' + Math.round(s[1]) + 'px) translate(-50%,-100%)';
    }
    _hudUpdate(uiOpen) {
      this._tagN = 0;
      if (!uiOpen) {
        const me = this.me;
        const dist = (p) => Math.hypot(p[0] - me.pos[0], p[2] - me.pos[2]);
        for (const s of SPOTS) {
          const d = Math.hypot(s.x - me.pos[0], s.z - me.pos[2]);
          if (d < SPOT_LABEL_R) this._putTag([s.x, 3.5, s.z], 'spot', s.name, '', '', '', s.sub);
        }
        for (const P of PADS) {
          const d = Math.hypot(P.x - me.pos[0], P.z - me.pos[2]);
          if (d < 14) this._putTag([P.x, 2.4, P.z], 'spot', 'ワープパッド', '', '', '', '→ ' + P.name);
        }
        for (const n of this.npcs) {
          if (dist(n.pos) > NAME_R) continue;
          const em = n.emote ? EMOTE_MAP[n.emote.id].name : '';
          this._putTag([n.pos[0], n.pos[1] + 0.85, n.pos[2]], n.keeper ? 'keeper' : 'npc', n.name, n.sayT > 0 ? n.say : '', em, '', '');
        }
        for (const f of this.friends.values()) {
          if (!f.pos) continue;
          const em = f.emote ? EMOTE_MAP[f.emote.id].name : '';
          const st = f.st || {};
          let bubble = '';
          if (!f.inTown) {
            bubble = FST[st.s] || 'オンライン';
            if (st.s === 'lobby' && st.open) bubble += '（E で参加）';
          }
          this._putTag([f.pos[0], f.pos[1] + 0.85, f.pos[2]], 'friend', '' + (f.name || 'フレンド'), bubble, em, '', '');
        }
        if (me.emote) this._putTag([me.pos[0], me.pos[1] + 0.9, me.pos[2]], 'me', '', '', EMOTE_MAP[me.emote.id].name, '', '');
      }
      for (let i = this._tagN; i < this._tags.length; i++) if (this._tags[i].style.display !== 'none') this._tags[i].style.display = 'none';

      /* 入れる場所の案内 */
      const n = this.near;
      let txt = '';
      const key = CS.Input.isTouch ? 'はいる' : 'E';
      if (!uiOpen && n) {
        if (n.kind === 'spot') {
          txt = n.spot.act === 'exit' && this.exitArm > 0 ? '<kbd>' + key + '</kbd>もう一度 押すと アーケードへ もどる'
            : '<kbd>' + key + '</kbd>' + esc(n.spot.name);
        } else {
          const st = n.f.st || {};
          txt = st.s === 'lobby' && st.open ? '<kbd>' + key + '</kbd>' + esc(n.f.name) + ' のへやに 参加する' : '<kbd>' + key + '</kbd>フレンド画面をひらく';
        }
      }
      if (this.promptEl._t !== txt) { this.promptEl._t = txt; this.promptEl.innerHTML = txt; }
      this.promptEl.classList.toggle('on', !!txt);

      /* 操作のヒント */
      let hint = '';
      if (!uiOpen) {
        if (CS.Input.isTouch) hint = '左で移動 ・ 右をドラッグで見回す ・ 右上の「エモート」「メニュー」';
        else if (!CS.Input.locked) hint = 'クリックでカメラ操作 ・ WASD 移動 ・ E 入る ・ 1〜8 エモート ・ Esc メニュー';
        else hint = 'WASD 移動 ・ Shift 走る ・ Space ジャンプ（2回で 大ジャンプ） ・ E 入る ・ F/1〜8 エモート ・ Esc メニュー';
      }
      if (this.hintEl._t !== hint) { this.hintEl._t = hint; this.hintEl.textContent = hint; this.hintEl.style.display = hint ? '' : 'none'; }

      /* 場所の名前・フレンドの人数 */
      const me = this.me;
      let place = 'キューブタウン';
      for (const a of AREAS) if (me.pos[0] >= a[1] && me.pos[0] <= a[3] + 1 && me.pos[2] >= a[2] && me.pos[2] <= a[4] + 1) { place = a[0]; break; }
      place += ' ・ ' + skyName(this.dayP || 0);
      if (this.placeEl._t !== place) { this.placeEl._t = place; this.placeEl.textContent = place; }
      const hub = CS.Friends && CS.Friends.hub;
      let ft;
      if (!hub || !hub.active) ft = 'フレンドは 掲示板から';
      else {
        const on = this._flist ? this._flist.length : 0;
        const inT = Array.from(this.friends.values()).filter((f) => f.inTown).length;
        ft = 'オンライン ' + on + '人' + (inT ? ' ・ 町に ' + inT + '人' : '');
      }
      if (this.frEl._t !== ft) { this.frEl._t = ft; this.frEl.textContent = ft; }
    }

    /* ---------------- メニュー（ワープ） ---------------- */
    openMenu() {
      this._leaveInput();
      CS.UI.show('twMenu');
    }
    /* 入力は frame() が 次のフレームで もどす（同じ Esc で また開かないように） */
    closeMenu() { CS.UI.show(null); }
    warp(w) {
      this.fly = null; this.padLock = -1;
      this._place(w.x, w.z, null);
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * TAU;
        this.parts.push({ x: w.x, y: 1.6, z: w.z, vx: Math.cos(a) * 3, vy: 1 + Math.random() * 3, vz: Math.sin(a) * 3, g: 4, life: 0.9, max: 0.9, s: 0.16, c: [0.5, 0.9, 1] });
      }
      this._sfx('ok');
      this.closeMenu();
    }
    _buildMenu() {
      const box = CS.$('twWarp');
      if (!box || box._built) return;
      box._built = true;
      for (const w of WARPS) {
        const c = document.createElement('div');
        c.className = 'twCard';
        c.innerHTML = '<b>' + esc(w.name) + '</b><div class="rw"></div>';
        const rw = c.querySelector('.rw');
        const b1 = document.createElement('button');
        b1.type = 'button'; b1.className = 'btn ghost'; b1.textContent = 'ワープ';
        b1.addEventListener('click', () => this.warp(w));
        rw.appendChild(b1);
        if (w.open) {
          const b2 = document.createElement('button');
          b2.type = 'button'; b2.className = 'btn ghost'; b2.textContent = w.openName ? w.openName : 'ひらく';
          b2.addEventListener('click', () => { const el = CS.$(w.open); CS.UI.show(null); if (el) el.click(); });
          rw.appendChild(b2);
        }
        box.appendChild(c);
      }
    }

    /* ---------------- 画面のつなぎこみ ---------------- */
    _hookUi() {
      const menu =
        '<section id="twMenu" class="screen"><div class="panel wide" style="max-width:780px">' +
        '<h2>メニュー</h2>' +
        '<h3>ワープ（「ひらく」で そのまま入れる）</h3><div id="twWarp" class="twWarp"></div>' +
        '<div class="nameRow" style="max-width:420px;margin-top:6px"><label for="twName">なまえ</label><input id="twName" type="text" maxlength="10" autocomplete="off" spellcheck="false"></div>' +
        '<div class="row"><button id="twTut" class="btn ghost" type="button">チュートリアル</button><button id="twHow" class="btn ghost" type="button">あそびかた</button>' +
        '<button id="twSet" class="btn ghost" type="button">せってい</button><button id="twFrB" class="btn ghost" type="button">フレンド</button></div>' +
        '<div class="row"><button id="twTitle" class="btn ghost" type="button">タイトル画面（これまでのメニュー）</button>' +
        '<button id="twArcade" class="btn ghost" type="button">← アーケードへ</button></div>' +
        '<button id="twClose" class="btn big pink" type="button" style="max-width:360px;width:100%">町にもどる</button>' +
        '</div></section>' +
        '<section id="twWelcome" class="screen"><div class="panel">' +
        '<h2>ようこそ、キューブタウンへ！</h2>' +
        '<p class="lead">ここが CUBE STRIKE 2 の町。バトルロビーや お店に <b>歩いて入って</b> 遊ぶよ。<br>フレンドが遊びに来ると、この町に あらわれる。</p>' +
        '<ul id="twWelList"></ul>' +
        '<div id="twWelFirst">はじめての人は、まず チュートリアルで 撃ち方を おぼえよう！</div>' +
        '<div class="stack"><button id="twWelTut" class="btn big pink" type="button">チュートリアルをはじめる<small>動き方・撃ち方を 1つずつ（3分くらい）</small></button>' +
        '<button id="twWelGo" class="btn" type="button">町を 歩いてみる</button></div>' +
        '</div></section>';
      document.body.insertAdjacentHTML('beforeend', menu);
      const U = CS.UI;
      U.addScreen('twMenu', () => {
        this._buildMenu();
        const n = CS.$('twName'); if (n) n.value = CS.Settings.name || '';
      });
      U.addScreen('twWelcome', null);
      /* タイトル画面を出そうとしたら 町へ（「タイトル画面」をえらんだときだけ そのまま出す） */
      U.addScreen('scTitle', () => {
        if (this.allowTitle) { this.allowTitle = false; return; }
        const m = this.game && this.game.mode;
        if (m === 'match' || m === 'practice') return;      // しあいの とちゅう（ふつうは来ない）: これまでのタイトルを出す
        U.show(null);
        this.enter();
      });
      const on = (id, fn) => { const el = CS.$(id); if (el) el.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} fn(); }); };
      on('twClose', () => this.closeMenu());
      on('twTut', () => { CS.UI.show(null); CS.Tutorial.start(); });
      on('twHow', () => { CS.UI.show(null); CS.$('btnHow').click(); });
      on('twSet', () => { CS.UI.show(null); CS.$('btnSettings').click(); });
      on('twFrB', () => { CS.UI.show(null); CS.$('btnFriends').click(); });
      on('twTitle', () => this.showTitle());
      on('twArcade', () => { location.href = '../index.html'; });
      on('twWelTut', () => { this._welcomeDone(); CS.UI.show(null); CS.Tutorial.start(); });
      on('twWelGo', () => { this._welcomeDone(); this.closeMenu(); });
      const nm = CS.$('twName');
      if (nm) {
        nm.addEventListener('change', () => {
          const v = String(nm.value || '').trim().slice(0, 10) || CS.Settings.name;
          nm.value = v; CS.Settings.name = v; CS.saveSettings();
          const t = CS.$('inName'); if (t) t.value = v;
        });
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') nm.blur(); });
      }
      /* メニュー・ようこそ画面の Esc */
      window.addEventListener('keydown', (e) => {
        const k = e.key || e.code;
        if ((k === 'Escape' || k === 'Esc') && CS.UI.current === 'twMenu') { e.preventDefault(); this.closeMenu(); }
      });
      /* タイトル画面に「町へ」ボタン */
      const stack = document.querySelector('#scTitle .stack');
      if (stack && !CS.$('btnTown')) {
        const b = document.createElement('button');
        b.id = 'btnTown'; b.type = 'button'; b.className = 'btn big';
        b.innerHTML = '町へもどる<small>キューブタウン</small>';
        b.addEventListener('click', () => this.goTown());
        stack.insertBefore(b, stack.firstChild);
      }
      /* ぶき屋: 銃のスキン */
      this._gunSkinUi();
    }
    _welcomeCheck() {
      if (CS.Settings.townSeen || CS.UI.current) return;
      const L = CS.$('twWelList');
      if (L) {
        const t = CS.Input.isTouch;
        L.innerHTML = t
          ? '<li><b>左のスティック</b>で歩く ・ 右がわを<b>ドラッグ</b>で見回す</li><li>建物の前の 光る輪で <b>「はいる」</b></li><li><b>エモート</b>ボタンで あいさつ ・ <b>メニュー</b>で ワープ</li>'
          : '<li><b>WASD</b> で歩く ・ 画面をクリックして <b>マウス</b>で見回す ・ <b>Shift</b> で走る</li><li>建物の前の 光る輪で <b>E</b> を押すと 入れる</li><li><b>1〜8</b> で エモート ・ <b>Esc</b> で メニュー（ワープもできる）</li>';
      }
      /* はじめての人は チュートリアルが一番上。やったことがある人は 町を歩くのが一番上 */
      const tut = CS.$('twWelTut'), go = CS.$('twWelGo');
      if (tut && go) {
        const first = FRESH && !CS.Settings.tutorialDone;
        const fl = CS.$('twWelFirst'); if (fl) fl.style.display = first ? '' : 'none';
        tut.className = first ? 'btn big pink' : 'btn';
        go.className = first ? 'btn' : 'btn big pink';
        const st = tut.parentNode;
        if (first) st.insertBefore(tut, go); else st.insertBefore(go, tut);
      }
      this._leaveInput();
      CS.UI.show('twWelcome');
    }
    _welcomeDone() { CS.Settings.townSeen = true; CS.saveSettings(); }

    _gunSkinUi() {
      const sec = CS.$('gunSec');
      if (!sec || CS.$('gsSec')) return;
      const div = document.createElement('div');
      div.id = 'gsSec'; div.className = 'grp';
      div.innerHTML = '<h3>銃のスキン<span>見た目だけ。しあいでも みんなに見える</span></h3><div id="gsGrid"></div>';
      sec.parentNode.insertBefore(div, sec);
      const nav = document.querySelector('#scLoadout .lnav');
      if (nav) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ghost'; b.textContent = '銃のスキン（' + CS.GunSkins.LIST.length + '）';
        b.addEventListener('click', () => { try { div.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} });
        nav.insertBefore(b, nav.firstChild);
      }
      const build = () => {
        const grid = CS.$('gsGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const cur = CS.GunSkins.mineId();
        for (const s of CS.GunSkins.LIST) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'gsChip' + (s.id === cur ? ' sel' : '');
          b.innerHTML = '<span class="sw" style="background:linear-gradient(90deg,' + s.sw[0] + ' 0 60%,' + s.sw[1] + ' 60% 100%)"></span><b>' + esc(s.name) + '</b><small>' + esc(s.desc) + '</small>';
          b.addEventListener('click', () => {
            try { CS.Audio.play('click'); } catch (e) {}
            CS.Settings.gunSkin = s.id; CS.saveSettings();
            if (this.handlers.look) { try { this.handlers.look(); } catch (e) {} }
            build();
          });
          grid.appendChild(b);
        }
      };
      CS.UI.addScreen('scLoadout', build);
    }

    _sfx(n) { try { CS.Audio.play(n); } catch (e) {} }
  }

  /* ======================================================================
     チュートリアル（しゃげきじょうで 1つずつ）
     ====================================================================== */
  /* ok(d): d = その手順を はじめてから ふえた分（前の手順で やったことは 数えない） */
  const STEPS = [
    { t: '歩いてみよう', k: 'W A S D で 前後左右に 動く', m: '左の スティックで 動く', ok: (d) => d.moved > 5 },
    { t: 'まわりを 見よう', k: '画面をクリックしてから マウスを動かして 見回す', m: '画面の 右がわを ドラッグして 見回す', ok: (d) => d.turned > 2.4 },
    { t: 'ジャンプ', k: 'スペースキーで ジャンプ（2回）', m: '「ジャンプ」ボタン（2回）', ok: (d) => d.jumps >= 2 },
    /* v5.4: 大ジャンプ */
    { t: '大ジャンプ', k: 'ジャンプして すぐ もう一回 スペース！ 6ブロックの 高さまで とべる', m: '「ジャンプ」を すばやく 2回！ 6ブロックの 高さまで とべる', ok: (d) => d.bigJumps >= 1 },
    { t: 'スライディング', k: '走りながら Shift（または C）で すべる', m: '走りながら「スライド」ボタンで すべる', ok: (d) => d.slides >= 1 },
    { t: 'まとを 撃とう', k: '左クリックで 撃つ。まとに 3回 当てよう', m: '「うつ」ボタンで 撃つ。まとに 3回 当てよう', ok: (d) => d.hits >= 3 },
    { t: 'ねらって 撃つ', k: '右クリックを おしている間、ねらいが せまくなる（1秒）', m: 'スマホでは「うつ」を おしている間 ねらえる銃もあるよ', ok: (d) => d.ads > 0.6, touchSkip: true },
    { t: 'リロード', k: 'R キーで 弾を つめなおす（弾が へっているとき）', m: '「リロード」ボタンで 弾を つめなおす（弾が へっているとき）', ok: (d) => d.reloads >= 1 },
    { t: 'ボムを 投げよう', k: 'Q か E で ボムを 投げる', m: '「ボム」ボタンで 投げる', ok: (d) => d.bombs >= 1 },
    { t: 'まとを たおそう', k: 'まとを 1つ こわそう', m: 'まとを 1つ こわそう', ok: (d) => d.kills >= 1 },
    /* v4: 必殺技（しあいでは てきを 3回 たおすと たまる。ここでは まんたんに してあげる） */
    { t: '必殺技を つかおう', k: 'ゲージ まんたん！ F キーで 必殺技！（しあいでは 3キルで たまる）', m: 'ゲージ まんたん！「必殺」ボタンで 必殺技！（しあいでは 3キルで たまる）',
      ok: (d) => d.special >= 1, enter: (me) => { me.sp = 1; } }
  ];
  const TUT_KEYS = ['moved', 'turned', 'jumps', 'bigJumps', 'slides', 'hits', 'ads', 'reloads', 'bombs', 'kills', 'special'];
  /* チュートリアルは いつも この ぶき（銃によっては「ねらう」が できないため） */
  const TUT_GEAR = { gun: 'ar', bomb: 'frag' };

  const Tutorial = {
    active: false, i: 0, s: null, base: null, d: null, prev: null,
    start() {
      if (!CS.main || !CS.debug) return;
      this.active = true; this.i = 0;
      this.s = {}; this.base = {}; this.d = {};
      TUT_KEYS.forEach((k) => { this.s[k] = 0; this.base[k] = 0; this.d[k] = 0; });
      this.prev = null;
      if (CS.town) CS.town.suspend();
      CS.debug.handlers.practice(TUT_GEAR);
      this._dom();
      this.panel.hidden = false; this.doneEl.hidden = true;
      this._render();
    },
    stop() {
      if (!this.active) return;
      this.active = false;
      CS.Settings.tutorialDone = true; CS.saveSettings();
      if (this.panel) this.panel.hidden = true;
      if (this.doneEl) this.doneEl.hidden = true;
    },
    toTown() {
      this.stop();
      const game = CS.debug && CS.debug.game;
      try { if (game) game.quit(); } catch (e) {}
      CS.UI.show('scTitle');
    },
    tick(game, dt) {
      if (!this.active) return;
      if (!game || game.mode !== 'practice') return;
      const me = game.players[game.me];
      if (!me) return;
      const s = this.s, p = this.prev;
      if (p) {
        const d = Math.hypot(me.pos[0] - p.x, me.pos[2] - p.z);
        if (d < 1.5) s.moved += d;
        s.turned += Math.abs(wrap(game.viewYaw - p.yaw)) + Math.abs(game.viewPitch - p.pitch);
        if (p.grounded && !me.grounded && me.vel[1] > 3) s.jumps++;
        if ((game.bjCd || 0) > p.bjCd + 1) s.bigJumps++;
        if (game.slideT > 0 && !(p.slide > 0)) s.slides++;
        if (game.gunState && game.gunState.reloadT >= 0 && !(p.reload >= 0)) s.reloads++;
        const bc = game.bombState ? game.bombState.charges : 0;
        if (bc < p.bombs || (game.bombs && game.bombs.length > p.nb)) s.bombs++;
        if (me.spK && !p.spk) s.special++;
      }
      if (game.adsT > 0.8) s.ads += dt;
      s.hits = game.practiceStats ? game.practiceStats.hits | 0 : 0;
      s.kills = game.practiceStats ? game.practiceStats.kills | 0 : 0;
      this.prev = {
        x: me.pos[0], z: me.pos[2], yaw: game.viewYaw, pitch: game.viewPitch, grounded: me.grounded, slide: game.slideT,
        reload: game.gunState ? game.gunState.reloadT : -1, bombs: game.bombState ? game.bombState.charges : 0, nb: game.bombs ? game.bombs.length : 0,
        spk: !!me.spK, bjCd: game.bjCd || 0
      };
      if (this.i >= STEPS.length) return;
      const st = STEPS[this.i], d = this.d;
      for (let k = 0; k < TUT_KEYS.length; k++) d[TUT_KEYS[k]] = s[TUT_KEYS[k]] - this.base[TUT_KEYS[k]];
      if (st.ok(d) || (st.touchSkip && CS.Input.isTouch)) {
        this.i++;
        for (let k = 0; k < TUT_KEYS.length; k++) this.base[TUT_KEYS[k]] = s[TUT_KEYS[k]];
        const nx = STEPS[this.i];
        if (nx && nx.enter) nx.enter(me);
        try { CS.Audio.play(this.i >= STEPS.length ? 'go' : 'ok'); } catch (e) {}
        if (this.i >= STEPS.length) this._finish();
        this._render();
      }
    },
    _finish() {
      try { CS.Input.enable(false); } catch (e) {}
      this.doneEl.hidden = false;
      this.panel.hidden = true;
      CS.Settings.tutorialDone = true; CS.saveSettings();
    },
    _render() {
      if (!this.panel) return;
      const i = Math.min(this.i, STEPS.length - 1), st = STEPS[i];
      const touch = CS.Input.isTouch;
      this.panel.querySelector('.tp').textContent = 'チュートリアル ' + (Math.min(this.i + 1, STEPS.length)) + ' / ' + STEPS.length;
      this.panel.querySelector('.tt').textContent = st.t;
      this.panel.querySelector('.tk').textContent = touch ? st.m : st.k;
      this.panel.querySelector('.bar i').style.width = (this.i / STEPS.length * 100) + '%';
      this.panel.querySelector('.ok').textContent = this.i > 0 && this.i < STEPS.length ? '✓ ' + STEPS[this.i - 1].t + ' できた！' : '';
    },
    _dom() {
      if (this.panel) return;
      document.body.insertAdjacentHTML('beforeend',
        '<div id="tutPanel" hidden><div class="tp"></div><div class="tt"></div><div class="tk"></div><div class="bar"><i></i></div><div class="ok"></div>' +
        '<button id="tutSkip" class="btn ghost" type="button">スキップして 町へ</button></div>' +
        '<div id="tutDone" hidden><div class="panel"><h2>チュートリアル クリア！</h2>' +
        '<p class="lead">動き方も 撃ち方も 必殺技も ばっちり。町に行って、コンピューター戦や 友達との対戦・みんなで塔のぼりで 遊んでみよう！</p>' +
        '<div class="stack"><button id="tutTown" class="btn big pink" type="button">町へ行く</button>' +
        '<button id="tutMore" class="btn ghost" type="button">もう少し 練習する</button></div></div></div>');
      this.panel = CS.$('tutPanel');
      this.doneEl = CS.$('tutDone');
      CS.$('tutSkip').addEventListener('click', () => this.toTown());
      CS.$('tutTown').addEventListener('click', () => this.toTown());
      CS.$('tutMore').addEventListener('click', () => {
        this.doneEl.hidden = true;
        this.active = false;
        try { CS.Input.enable(true); if (!CS.Input.isTouch) CS.Input.requestLock(); } catch (e) {}
      });
      window.addEventListener('keydown', (e) => {
        if (!this.doneEl.hidden && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.toTown(); }
      });
    }
  };

  CS.Tutorial = Tutorial;
  CS.Town = {
    SPOTS: SPOTS, WARPS: WARPS, EMOTES: EMOTES, build: buildTown,
    init: function (opts) { const t = new Town(opts); CS.town = t; return t; }
  };
})();
