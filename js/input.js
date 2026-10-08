/* ==========================================================================
   CUBE STRIKE — input.js
   キーボード+マウス（ポインターロック）/ タッチ（仮想スティック+ボタン）/ ゲームパッド
   poll() で 1 フレーム分の入力をまとめて返す。視点移動はラジアンで累積（遅延なし）。
   v2: スライディング（Shift / C / スライドボタン / パッド B・R3）→ poll().slide（押した瞬間だけ true）
       と poll().slideHeld（押しているあいだ true。先に押してから走り出してもすべれるように）
       「うつ」ボタン 1 つで うつ + ねらう。方式は game.js が setGunMode({scoped}) で教える:
         ふつう : 押す→すぐ撃つ(fire, firePressed) / 0.3 秒おしつづけると ads / はなす→fireReleased, ads 解除
         スコープ: 押す→すぐ ads（fire=true のまま＝レールガンはためる、撃たない）/ はなす→firePressed+fireReleased
                  （その瞬間から 0.15 秒は ads を残す＝スコープのまま撃てる）。指のキャンセルでは撃たない
         PC は左クリック=うつ・右クリック=ねらう のまま。
       ボタンの配置・大きさの編集（タッチでもマウスでも。CS.Settings.touchLayout に保存）:
         getLayout / setLayout / resetLayout / saveLayout / revertLayout / editLayout(on,{onSelect,onChange})
         setControlScale(name,s) / setGlobalScale(k) / selectControl(name) / layoutDirty() / getLayoutRects()
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  const MOUSE_K = 0.0022;        // rad / px × sens
  const TOUCH_K = 0.0048;        // rad / px × touchSens
  const MOUSE_SPIKE = 300;       // これより大きい movementX/Y は無視（ロック直後の暴れ）
  const STICK_R = 60;            // 仮想スティック半径 px（画面の大きさ k・全体倍率・スティック倍率がかかる）
  const STICK_DEAD = 0.12;
  const STICK_ZONE = 0.45;       // スティック側の 45% がスティックの出る場所
  const PAD_LOOK = 2.6;          // rad/s × sens
  const PAD_DEAD_L = 0.18, PAD_DEAD_R = 0.15;
  const TOUCH_SMOOTH = 0.75;     // その場で 75% 反映、残りは次のフレームで必ず反映（遅れは最大1フレーム）
  const MOUSE_AFTER_TOUCH = 900; // タッチのあとこれだけは「マウスっぽいイベント」でマウス操作にもどさない（互換イベントよけ）
  const ADS_HOLD_MS = 300;       // 「うつ」をこれだけ押しつづけると ねらう（スコープ銃以外）
  const ADS_LINGER_MS = 150;     // スコープ銃: はなしたあと これだけ ねらいを残す（game.js の単発バッファ 0.15 s と同じ）
  const DRAG_SLOP = 6;          // 編集: これより動いたらドラッグ（それまではタップ）
  const MOUSE_ID = 'mouse';      // 編集中のマウスドラッグの id（タッチの identifier は数値）

  /* ボタンの初期位置（v1 と同じ）。d = 直径、r / b = 画面の右・下からボタンの外側までの距離。
     どれも px × k（画面の大きさ）× 全体倍率。そこに安全領域を足す。スライドは v1 の「ねらう」の場所。
     キルログ（右上）と重ならないよう、リロード・ボムは低め。ボムはうつボタンと 4px あける。 */
  const BTN_GEOM = {
    fire: { d: 84, r: 76, b: 76, fs: 14 },
    jump: { d: 64, r: 14, b: 14, fs: 12 },
    slide: { d: 62, r: 172, b: 87, fs: 12 },
    bomb: { d: 62, r: 87, b: 164, fs: 12 },
    reload: { d: 56, r: 178, b: 160, fs: 12 },
    sp: { d: 58, r: 12, b: 94, fs: 12 },           // v4: 必殺技（ジャンプの上）
    sw: { d: 50, r: 16, b: 162, fs: 11 }           // v5: 銃の もちかえ（必殺の上）
  };
  const BTN_NAMES = ['fire', 'jump', 'slide', 'bomb', 'reload', 'sp', 'sw'];
  const CTRL_NAMES = BTN_NAMES.concat(['stick']);
  const EDITABLE = { fire: 1, jump: 1, slide: 1, bomb: 1, reload: 1, sp: 1, sw: 1, stick: 1 };
  const CTRL_LABELS = { fire: 'うつ', jump: 'ジャンプ', slide: 'スライド', bomb: 'ボム', reload: 'リロード', sp: '必殺', sw: '銃の切替', stick: 'いどうスティック' };
  const STICK_HOME = { l: 0.07, b: 36 };  // スティックの休み位置: 左から 7%、下から 36px（v1）
  /* 右上の小さいボタン（CSS と同じ数字。動かせないので、よける相手として使う） */
  const SMALL_GEOM = { menu: { d: 46, r: 10, t: 10 }, board: { d: 46, r: 64, t: 10 } };
  const BIG_K = 1.18;            // 大きい画面（たて 620px 以上・よこ 900px 以上）での k
  const EDGE = 4;                // 安全領域の内側に残すすきま px
  const GAP = 3;                 // 重なりをほどくときのボタンどうしのすきま px
  const MIN_D = 36, MIN_STICK_D = 72;     // 小さくしすぎて押せなくならないように
  const S_MIN = 0.5, S_MAX = 2, G_MIN = 0.6, G_MAX = 1.6;

  const S = () => CS.Settings || {};
  const NO_KEYS = Object.freeze([]);
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (v) => String(Math.round(v * 10) / 10);

  /* ---------- 状態 ---------- */
  let canvas = null, touchRoot = null, inited = false;
  let enabled = false, editing = false;
  let adsScale = 1;

  const keys = new Set();          // 押されている e.code
  let tabHeld = false;
  let mouseFire = false, mouseAds = false;
  let lookX = 0, lookY = 0;        // マウス / パッド（ラジアン、sens 反映済み・反転前）
  let tLookX = 0, tLookY = 0;      // タッチ生の累積（ラジアン）
  let tCarryX = 0, tCarryY = 0;    // タッチ平滑化の持ち越し
  const edge = { firePressed: false, fireReleased: false, jump: false, slide: false, bomb: false, reload: false, menu: false, sp: false, sw: false };
  const edgeCodes = [];            // このフレームに押したキー（マップエディター用: 数字・F・Z・X）
  let wheelAcc = 0;                // マウスホイール（マップエディター用）
  let fireWas = false;             // 前回 syncFire() 時の「ふつうの引き金」
  let lockSupported = false, virtualLock = false, expectUnlock = false, lastUnlockMenuT = -1e9;
  /* v4: ポインターロックを ことわる画面（アプリの中のブラウザ など）。わかったら ロックなし（virtualLock）で あそぶ */
  let lockRefused = false;
  /* ロックなしのときの カーソル（画面の はしに あると 回りつづける） */
  const vm = { x: 0, y: 0, inside: false };
  const EDGE_TURN = 2.4;           // はしでの 回る速さ（ラジアン/秒）

  /* 「うつ」ボタン（タッチ）。押した瞬間の銃の方式をはなすまで使う */
  let gunScoped = false;           // game.js が setGunMode で教える
  const tf = { count: 0, active: false, scoped: false, t0: 0, noAds: false };
  /* スコープ銃: はなして撃つとき、スコープのまま撃てるよう ねらいを少し残す。
     adsLinger = 次の poll では必ず残す、adsLingerT = この時刻までは残す */
  let adsLinger = false, adsLingerT = 0;
  let fireActVis = false;

  // タッチ
  const touches = new Map();       // identifier -> {kind, x, y, btn}
  let stickId = null, stickCX = 0, stickCY = 0, stickVX = 0, stickVY = 0, stickR = STICK_R;
  let touchBoard = false;
  let ui = null, probe = null;     // DOM 参照
  const hud = { bombCharges: -1, bombMax: -1, cdStep: -1, empty: null, reloading: null, ads: false, canAds: null };

  // パッド
  let padSeen = false;
  const pad = { fire: false, ads: false, board: false, slide: false, jump: false, mx: 0, mz: 0, prev: [] };
  let lastPoll = 0;

  // レイアウト
  let work = null;                 // いま使っている（編集中の）レイアウト
  let saved = null;                // 保存ずみ（null = 初期配置）
  let geom = null;                 // work を今の画面に当てはめた結果（px）
  const keepOut = { x0: 0, y0: 0 };
  let keepOk = false;
  let editOpts = null, selected = null;
  const drags = new Map();         // 編集中のドラッグ: id -> {name, sx, sy, cx0, cy0, moved, prev}

  function gameActive() { return enabled && !editing; }

  /* ---------- 引き金 ---------- */
  /* ふつうの引き金: マウス左・パッド RT・「うつ」（スコープ銃以外）。押した瞬間 firePressed */
  function trigHeld() { return gameActive() && (mouseFire || pad.fire || (tf.active && !tf.scoped)); }
  function syncFire() {
    const f = trigHeld();
    if (f && !fireWas) edge.firePressed = true;
    if (!f && fireWas) edge.fireReleased = true;
    fireWas = f;
  }

  function touchFireDown() {
    tf.count++;
    if (tf.count !== 1) return;
    tf.active = true;
    tf.scoped = gunScoped;
    tf.t0 = now();
    tf.noAds = false;
    syncFire();
  }

  /* cancel = 指がキャンセルされた・画面が回った など（スコープ銃でも撃たない） */
  function touchFireUp(cancel) {
    if (tf.count <= 0) return;
    tf.count--;
    if (tf.count > 0) return;
    if (tf.active) {
      tf.active = false;
      if (tf.scoped) {
        edge.fireReleased = true;
        if (!cancel) {
          edge.firePressed = true;
          adsLinger = true;
          adsLingerT = now() + ADS_LINGER_MS;
        }
      }
    }
    syncFire();
  }

  function clearLinger() { adsLinger = false; adsLingerT = 0; }

  function cancelTouchFire() {
    if (tf.active && tf.scoped) edge.fireReleased = true;
    tf.count = 0;
    tf.active = false;
    clearLinger();
  }

  function touchAdsNow() {
    if (!tf.active || tf.noAds) return false;
    return tf.scoped ? true : (now() - tf.t0 >= ADS_HOLD_MS);
  }

  function clearEdges() {
    edge.firePressed = edge.fireReleased = edge.jump = edge.slide = edge.bomb = edge.reload = edge.menu = edge.sp = edge.sw = false;
    edgeCodes.length = 0;
    wheelAcc = 0;
  }
  function clearLook() { lookX = lookY = tLookX = tLookY = tCarryX = tCarryY = 0; }

  /* 全部はなす（blur / 画面回転 / 無効化） */
  function releaseAll() {
    keys.clear();
    tabHeld = false;
    mouseFire = false; mouseAds = false;
    for (const t of touches.values()) if (t.btn) setBtnOn(t.btn, false);
    touches.clear();
    cancelTouchFire();
    stickId = null; stickVX = stickVY = 0;
    showStick(false);
    pad.fire = false; pad.ads = false; pad.board = false; pad.slide = false; pad.jump = false; pad.mx = pad.mz = 0;
    syncFire();
    syncFireVisual(false);
  }

  /* スライディングのボタン・キーを押しつづけているか（キーボード Shift / C・タッチのスライド・パッド B / R3） */
  function slideHeld() {
    if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyC') || pad.slide) return true;
    if (ui && touches.size) for (const r of touches.values()) if (r.btn === ui.slide) return true;
    return false;
  }
  /* ジャンプを押しつづけているか（マップエディターで上へとぶ） */
  function jumpHeld() {
    if (keys.has('Space') || pad.jump) return true;
    if (ui && touches.size) for (const r of touches.values()) if (r.btn === ui.jump) return true;
    return false;
  }

  /* ---------- フォーカス判定 ---------- */
  function typingInField() {
    const a = document.activeElement;
    if (!a) return false;
    const tn = (a.tagName || '').toUpperCase();
    return tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || !!a.isContentEditable;
  }

  /* ---------- キーボード ---------- */
  const MOVE_CODES = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  function keyCode(e) {
    if (e.code) return e.code;
    const k = e.key || '';
    const map = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', q: 'KeyQ', e: 'KeyE', g: 'KeyG', r: 'KeyR', m: 'KeyM', c: 'KeyC', ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Shift: 'ShiftLeft' };
    return map[k.length === 1 ? k.toLowerCase() : k] || k;
  }

  const GAME_KEYS = { Space: 1, KeyQ: 1, KeyE: 1, KeyG: 1, KeyR: 1, KeyC: 1, ShiftLeft: 1, ShiftRight: 1, Tab: 1, Escape: 1, KeyM: 1 };
  /* スライディングのキー（押しっぱなしも見る: 先に押してから走り出してもすべれる） */
  const SLIDE_CODES = { ShiftLeft: 1, ShiftRight: 1, KeyC: 1 };
  /* poll().keys に入れるキー（マップエディター） */
  const EXTRA_CODES = { KeyF: 1, KeyZ: 1, KeyX: 1, KeyV: 1 };
  function onKeyDown(e) {
    if (!gameActive() || e.isComposing || typingInField()) return;
    if (e.ctrlKey || e.metaKey) return;
    const c = keyCode(e);
    if ((MOVE_CODES[c] || GAME_KEYS[c]) && realMouse(e)) setMouseMode();
    if (MOVE_CODES[c]) { keys.add(c); if (c.indexOf('Arrow') === 0) e.preventDefault(); return; }
    if ((EXTRA_CODES[c] || /^Digit[0-9]$/.test(c)) && !e.repeat) {
      if (c === 'KeyF') edge.sp = true;          // v4: 必殺技（エディター・町では keys の KeyF を使う）
      edgeCodes.push(c);
      return;
    }
    switch (c) {
      case 'Space':
        e.preventDefault();
        keys.add(c);
        if (!e.repeat) edge.jump = true;
        break;
      case 'ShiftLeft': case 'ShiftRight': case 'KeyC':
        keys.add(c);
        if (!e.repeat) edge.slide = true;
        break;
      case 'KeyQ': case 'KeyE': case 'KeyG':
        if (!e.repeat) edge.bomb = true;
        break;
      case 'KeyR':
        if (!e.repeat) edge.reload = true;
        break;
      case 'Tab':
        e.preventDefault();
        tabHeld = true;
        break;
      case 'Escape': case 'KeyM':
        if (e.repeat) break;
        // Esc でロックが外れた直後に keydown も来るブラウザがある → 二重にメニューを開閉しない
        if (c === 'Escape' && now() - lastUnlockMenuT < 400) break;
        edge.menu = true;
        if (virtualLock) setVirtualLock(false);
        break;
    }
  }

  function onKeyUp(e) {
    const c = keyCode(e);
    if (MOVE_CODES[c] || SLIDE_CODES[c] || c === 'Space') keys.delete(c);
    else if (c === 'Tab') { tabHeld = false; if (gameActive()) e.preventDefault(); }
  }

  /* ---------- ポインターロック ---------- */
  function setLocked(v) {
    if (Input.locked === v) return;
    Input.locked = v;
    if (typeof Input.onLockChange === 'function') {
      try { Input.onLockChange(v); } catch (err) { setTimeout(() => { throw err; }, 0); }
    }
  }

  function setVirtualLock(v) {
    virtualLock = v;
    /* ロックなしで あそんでいる間は キャンバスの上の カーソルを かくす（ねらいは まんなかの 照準） */
    if (canvas && canvas.style) canvas.style.cursor = v ? 'none' : '';
    setLocked(v);
  }

  /* ロックを ことわられた（WrongDocumentError = この画面では ロックできない）。ロックなしに きりかえる */
  function lockRefusedBy(err) {
    if (!err || err.name !== 'WrongDocumentError') return false;
    if (!lockRefused) {
      lockRefused = true;
      try { if (CS.UI && CS.UI.toast) CS.UI.toast('この画面では マウスを固定できません。そのまま マウスで 見回してね（画面の はしで 回りつづける）'); } catch (e) {}
    }
    if (enabled && !editing) setVirtualLock(true);
    return true;
  }

  function onLockChange() {
    const el = document.pointerLockElement;
    const locked = !!canvas && el === canvas;
    const was = Input.locked;
    if (!locked) {
      mouseFire = false; mouseAds = false; syncFire();
      if (was && gameActive() && !expectUnlock) { edge.menu = true; lastUnlockMenuT = now(); }
    }
    expectUnlock = false;
    setLocked(locked);
  }

  function onLockError() {
    expectUnlock = false;
    if (virtualLock) return;                  // ロックなしで あそんでいる（ことわられた あと）
    /* 2回目の たのみ（まだ返事まち）が 失敗しても、1回目で ロックできていれば そのまま */
    setLocked(!!canvas && document.pointerLockElement === canvas);
  }

  function requestLock() {
    if (!canvas || editing) return;
    if (!lockSupported || lockRefused) { if (enabled) setVirtualLock(true); return; }
    if (document.pointerLockElement === canvas) return;
    const plain = () => {
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(lockRefusedBy);
      } catch (err) { lockRefusedBy(err); }
    };
    try {
      // 生のマウス移動（OS の加速なし）が使えれば使う
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch((err) => { if (err && err.name === 'NotSupportedError') plain(); else lockRefusedBy(err); });
      }
    } catch (err) { if (!lockRefusedBy(err)) plain(); }
  }

  function exitLock() {
    if (virtualLock) { setVirtualLock(false); return; }
    if (lockSupported && canvas && document.pointerLockElement === canvas) {
      expectUnlock = true;
      try { document.exitPointerLock(); } catch (err) { expectUnlock = false; }
    }
  }

  /* ---------- マウス ---------- */
  function onMouseMove(e) {
    const dx = +e.movementX || 0, dy = +e.movementY || 0;
    if ((dx || dy) && realMouse(e)) setMouseMode();
    vm.x = +e.clientX || 0; vm.y = +e.clientY || 0; vm.inside = true;
    if (editing) {
      if (drags.has(MOUSE_ID)) {
        // ウィンドウの外でボタンをはなした（mouseup が来なかった）→ そこで決定
        if (e.buttons === 0) editEnd(MOUSE_ID, false);
        else editMove(MOUSE_ID, +e.clientX || 0, +e.clientY || 0);
      }
      return;
    }
    if (!enabled || !Input.locked) return;
    if (Math.abs(dx) > MOUSE_SPIKE || Math.abs(dy) > MOUSE_SPIKE) return;
    const k = MOUSE_K * (+S().sens || 1) * adsScale;
    lookX += dx * k;
    lookY -= dy * k;
  }

  function onMouseDown(e) {
    if (realMouse(e)) setMouseMode();
    if (editing) { editMouseDown(e); return; }
    if (!enabled) return;
    if (!Input.locked) {
      // キャンバスをクリック → ロック（撃たない）
      if (canvas && e.target === canvas && e.button === 0) requestLock();
      return;
    }
    // ロックなし: ボタンなど 画面の上の部品を おしたときは 撃たない（その部品が うごく）
    if (virtualLock && canvas && e.target !== canvas) return;
    if (e.button === 0) { mouseFire = true; syncFire(); }
    else if (e.button === 2) { mouseAds = true; }
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (drags.has(MOUSE_ID)) { if (e.button === 0) editEnd(MOUSE_ID, false); return; }
    if (e.button === 0) { if (mouseFire) { mouseFire = false; syncFire(); } }
    else if (e.button === 2) mouseAds = false;
  }

  function onContextMenu(e) {
    if (enabled && (Input.locked || Input.isTouch)) e.preventDefault();
    else if (editing && btnOf(e.target)) e.preventDefault();
  }

  /* ======================================================================
     タッチ UI
     ボタンの位置・大きさは JS（applyLayout）が px で入れる。CSS は見た目だけ。
     ====================================================================== */
  const STYLE = `
.ti-layer{position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:40;overflow:hidden;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none;-webkit-tap-highlight-color:transparent;
  --sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);
  font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif}
.ti-layer.ti-off{display:none}
.ti-probe{position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;box-sizing:content-box;
  padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
.ti-btn{position:absolute;left:0;top:0;width:62px;height:62px;pointer-events:auto;touch-action:none;box-sizing:border-box;border-radius:50%;
  display:flex;flex-direction:column;align-items:center;justify-content:center;white-space:nowrap;
  color:#e8f6ff;font-weight:800;font-size:12px;line-height:1.1;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.8);
  background:rgba(8,14,34,.38);border:2px solid rgba(127,214,255,.55);
  box-shadow:inset 0 0 14px rgba(127,214,255,.14),0 0 10px rgba(0,0,0,.25);
  transition:transform .06s ease-out,background-color .06s ease-out,opacity .15s}
.ti-btn span,.ti-btn small,.ti-btn i{pointer-events:none}
.ti-btn.ti-on{background:rgba(127,214,255,.34);transform:scale(.93)}
.ti-btn.ti-dim{opacity:.42}
.ti-fire{border-color:rgba(255,95,120,.8);box-shadow:inset 0 0 18px rgba(255,77,94,.25),0 0 14px rgba(255,77,94,.2);font-size:14px}
.ti-fire.ti-on{background:rgba(255,77,94,.38)}
.ti-fire.ti-act{border-color:#bfeaff;box-shadow:inset 0 0 18px rgba(127,214,255,.3),0 0 0 3px rgba(127,214,255,.45),0 0 18px rgba(127,214,255,.5)}
.ti-fire i{display:block;width:calc(30px * var(--u,1));height:calc(30px * var(--u,1));border-radius:50%;border:3px solid rgba(255,190,200,.9);box-sizing:border-box;margin-bottom:2px;position:relative}
.ti-fire i:after{content:"";position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#ffd6dc}
.ti-fire small{display:none;font-size:.64em;font-weight:700;opacity:.85;margin-top:1px}
.ti-fire.ti-scoped i{border-color:rgba(191,234,255,.95)}
.ti-fire.ti-scoped i:before{content:"";position:absolute;left:-6px;right:-6px;top:50%;height:2px;margin-top:-1px;background:rgba(191,234,255,.9)}
.ti-fire.ti-scoped i:after{width:2px;height:auto;top:-6px;bottom:-6px;margin:0 0 0 -1px;border-radius:0;background:rgba(191,234,255,.9)}
.ti-fire.ti-scoped small{display:block}
.ti-fire.ti-tiny small{display:none}
.ti-slide{border-color:rgba(140,255,190,.62)}
.ti-slide.ti-on{background:rgba(120,255,170,.3)}
.ti-bomb{border-color:rgba(255,196,90,.75)}
.ti-bomb.ti-on{background:rgba(255,196,90,.32)}
.ti-reload.ti-empty{border-color:#ffd166;background:rgba(255,209,102,.3);animation:ti-pulse .7s ease-in-out infinite alternate}
.ti-reload.ti-busy{opacity:.5}
@keyframes ti-pulse{from{box-shadow:0 0 4px rgba(255,209,102,.3)}to{box-shadow:0 0 18px rgba(255,209,102,.85)}}
.ti-sp{border-color:rgba(255,210,61,.45);color:#fff3c4}
.ti-sp .ti-spring circle{stroke:#ffd23d}
.ti-sp.ti-dim{opacity:.55}
.ti-sp.ti-ready{border-color:#ffe066;background:rgba(255,200,40,.3);animation:ti-sppulse .6s ease-in-out infinite alternate}
.ti-sp.ti-act{border-color:#7fd6ff;background:rgba(127,214,255,.28)}
.ti-sp.ti-act .ti-spring circle{stroke:#7fd6ff}
@keyframes ti-sppulse{from{box-shadow:0 0 6px rgba(255,210,61,.4)}to{box-shadow:0 0 24px rgba(255,210,61,1)}}
.ti-layer.ti-editor .ti-sp{display:none!important}
.ti-layer.ti-editor .ti-sw,.ti-sw.ti-noswap{display:none!important}
.ti-sw{border-color:rgba(255,210,138,.5);color:#ffe9c4}
.ti-small{left:auto;width:46px;height:46px;top:calc(var(--st) + 10px);font-size:20px;border-width:1.5px;background:rgba(8,14,34,.45)}
.ti-menu{right:calc(var(--sr) + 10px)}
.ti-board{right:calc(var(--sr) + 64px);font-size:11px;font-weight:800;letter-spacing:0}
.ti-board.ti-act{background:rgba(127,214,255,.38)}
.ti-badge{position:absolute;top:-4px;right:-4px;min-width:22px;height:22px;padding:0 5px;box-sizing:border-box;border-radius:11px;
  background:#ffc45a;color:#1a1204;font-size:13px;font-weight:900;line-height:22px;text-align:center;text-shadow:none;pointer-events:none}
.ti-badge.ti-zero{background:#5a6378;color:#dfe6f5}
.ti-ring{position:absolute;left:-2px;top:-2px;width:calc(100% + 4px);height:calc(100% + 4px);pointer-events:none;transform:rotate(-90deg)}
.ti-ring circle{fill:none;stroke:#ffc45a;stroke-width:4;stroke-linecap:round}
.ti-jump .ti-bjring circle{stroke:#6f8fb0}
.ti-jump.ti-bjok{border-color:rgba(143,240,164,.8)}
.ti-jump.ti-bjok .ti-bjring circle{stroke:#8ff0a4}
.ti-jump small{display:none;font-size:.72em;font-weight:700;color:#bff7cc;margin-top:1px}
.ti-jump.ti-bjok small{display:block}
.ti-stick,.ti-ghost{position:absolute;left:0;top:0;width:120px;height:120px;margin:0;border-radius:50%;box-sizing:border-box;pointer-events:none}
.ti-stick{border:2px solid rgba(127,214,255,.5);background:rgba(8,14,34,.25);will-change:transform}
.ti-stick.ti-hide,.ti-ghost.ti-hide{display:none}
.ti-knob{position:absolute;left:34px;top:34px;width:52px;height:52px;border-radius:50%;background:rgba(127,214,255,.45);
  border:2px solid rgba(200,238,255,.85);box-sizing:border-box;will-change:transform}
.ti-ghost{border:2px dashed rgba(127,214,255,.2);display:flex;align-items:center;justify-content:center;
  color:#dff3ff;font-size:12px;font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.ti-ghost span{display:none;pointer-events:none}
.ti-safe{position:absolute;left:0;top:0;display:none;border:1.5px dashed rgba(127,214,255,.28);border-radius:14px;box-sizing:border-box;pointer-events:none}
.ti-edit .ti-safe{display:block}
.ti-edit .ti-btn,.ti-edit .ti-ghost{transition:none;cursor:grab}
.ti-edit .ti-btn:not(.ti-small),.ti-edit .ti-ghost{outline:2px dashed rgba(200,238,255,.55);outline-offset:3px}
.ti-edit .ti-ghost{pointer-events:auto;touch-action:none;border:2px solid rgba(127,214,255,.6);background:rgba(8,14,34,.35)}
.ti-edit .ti-ghost span{display:block}
.ti-edit .ti-small{opacity:.3;pointer-events:none}
.ti-edit .ti-sel{outline:3px solid #7fd6ff;outline-offset:3px;box-shadow:0 0 20px rgba(127,214,255,.75)}
.ti-edit .ti-drag{cursor:grabbing;opacity:.85}
.ti-edit .ti-bad{outline:3px solid #ff4d5e;outline-offset:3px}
`;

  function mk(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  function makeButton(parent, cls, label, action) {
    const b = mk('div', 'ti-btn ' + cls, parent);
    b.__tiBtn = action;
    if (label != null) mk('span', '', b, label);
    return b;
  }

  function buildTouchUI() {
    if (!touchRoot || ui) return;
    try {
      const st = document.createElement('style');
      st.textContent = STYLE;
      (document.head || document.documentElement || touchRoot).appendChild(st);
    } catch (err) {}
    probe = mk('div', 'ti-probe', touchRoot);
    const layer = mk('div', 'ti-layer ti-off', touchRoot);
    const safe = mk('div', 'ti-safe', layer);
    const ghost = mk('div', 'ti-ghost', layer);
    ghost.__tiBtn = 'stick';
    mk('span', '', ghost, 'いどう');
    const stick = mk('div', 'ti-stick ti-hide', layer);
    const knob = mk('div', 'ti-knob', stick);

    const fire = makeButton(layer, 'ti-fire', null, 'fire');
    mk('i', '', fire);
    mk('span', '', fire, 'うつ');
    mk('small', '', fire, 'はなして うつ');
    const jump = makeButton(layer, 'ti-jump', 'ジャンプ', 'jump');
    const slide = makeButton(layer, 'ti-slide', 'スライド', 'slide');
    const bomb = makeButton(layer, 'ti-bomb', 'ボム', 'bomb');
    let ring = null, ringC = null;
    const RING_LEN = 2 * Math.PI * 30;
    try {
      const NS = 'http://www.w3.org/2000/svg';
      ring = document.createElementNS(NS, 'svg');
      ring.setAttribute('class', 'ti-ring');
      ring.setAttribute('viewBox', '0 0 64 64');
      ringC = document.createElementNS(NS, 'circle');
      ringC.setAttribute('cx', '32'); ringC.setAttribute('cy', '32'); ringC.setAttribute('r', '30');
      ringC.setAttribute('stroke-dasharray', RING_LEN.toFixed(2));
      ringC.setAttribute('stroke-dashoffset', RING_LEN.toFixed(2));
      ring.appendChild(ringC);
      bomb.appendChild(ring);
    } catch (err) { ring = ringC = null; }
    const badge = mk('b', 'ti-badge', bomb, '');
    /* v5.4: 大ジャンプの じゅんび（ジャンプボタンの まわりの リング。みどり = つかえる） */
    let bjRing = null;
    try {
      const NS = 'http://www.w3.org/2000/svg';
      const sv = document.createElementNS(NS, 'svg');
      sv.setAttribute('class', 'ti-ring ti-bjring');
      sv.setAttribute('viewBox', '0 0 64 64');
      bjRing = document.createElementNS(NS, 'circle');
      bjRing.setAttribute('cx', '32'); bjRing.setAttribute('cy', '32'); bjRing.setAttribute('r', '30');
      bjRing.setAttribute('stroke-dasharray', RING_LEN.toFixed(2));
      bjRing.setAttribute('stroke-dashoffset', RING_LEN.toFixed(2));
      sv.appendChild(bjRing);
      jump.appendChild(sv);
    } catch (err) { bjRing = null; }
    mk('small', '', jump, '2回で 大');
    const reload = makeButton(layer, 'ti-reload', 'リロード', 'reload');
    /* v4: 必殺技（まわりの リングが ゲージ） */
    const sp = makeButton(layer, 'ti-sp', '必殺', 'sp');
    const sw = makeButton(layer, 'ti-sw ti-noswap', '切替', 'sw');
    let spRing = null;
    try {
      const NS = 'http://www.w3.org/2000/svg';
      const sv = document.createElementNS(NS, 'svg');
      sv.setAttribute('class', 'ti-ring ti-spring');
      sv.setAttribute('viewBox', '0 0 64 64');
      spRing = document.createElementNS(NS, 'circle');
      spRing.setAttribute('cx', '32'); spRing.setAttribute('cy', '32'); spRing.setAttribute('r', '30');
      spRing.setAttribute('stroke-dasharray', RING_LEN.toFixed(2));
      spRing.setAttribute('stroke-dashoffset', RING_LEN.toFixed(2));
      sv.appendChild(spRing);
      sp.appendChild(sv);
    } catch (err) { spRing = null; }
    const menu = makeButton(layer, 'ti-small ti-menu', '≡', 'menu');
    const board = makeButton(layer, 'ti-small ti-board', 'スコア', 'board');

    ui = { layer, safe, ghost, stick, knob, fire, jump, slide, bomb, ring, ringC, RING_LEN, badge, reload, sp, spRing, sw, menu, board, bjRing };
    setClass(fire, 'ti-scoped', gunScoped);
  }

  function setClass(el, cls, on) {
    if (!el || !el.classList) return;
    if (on) el.classList.add(cls); else el.classList.remove(cls);
  }
  function setBtnOn(el, on) { setClass(el, 'ti-on', on); }
  function ctrlEl(name) { return !ui ? null : name === 'stick' ? ui.ghost : ui[name] || null; }

  function layerVisible() { return !!ui && (editing || (enabled && Input.isTouch)); }
  function updateTouchVisibility() {
    if (!ui) return;
    setClass(ui.layer, 'ti-off', !layerVisible());
    setClass(ui.layer, 'ti-edit', editing);
  }

  /* 「うつ」ボタンの ねらい中の光。ねらえない銃（canAds:false）は長押ししても光らせない */
  function syncFireVisual(tAds) {
    const v = !!((tAds && hud.canAds !== false) || hud.ads);
    if (v === fireActVis) return;
    fireActVis = v;
    setClass(ui && ui.fire, 'ti-act', v);
  }

  /* 右半分にあるボタンのかたまりの左上（CSS px）。銃（ビューモデル）やキルログがよけるのに使う。
     タッチ操作が出ていない・右半分にボタンがないときは null。値は配置を当てはめたときに計算ずみ。 */
  function touchKeepOut() {
    if (!layerVisible() || !keepOk) return null;
    return keepOut;
  }

  function showStick(on) {
    if (!ui) return;
    setClass(ui.stick, 'ti-hide', !on);
    setClass(ui.ghost, 'ti-hide', on);
    if (!on) ui.knob.style.transform = 'translate3d(0,0,0)';
  }

  function setTouchMode() {
    if (Input.isTouch) return;
    Input.isTouch = true;
    updateTouchVisibility();
    if (typeof Input.onModeChange === 'function') {
      try { Input.onModeChange(true); } catch (err) { setTimeout(() => { throw err; }, 0); }
    }
  }

  /* 逆向き: タッチのあと本物のマウス・キーボードが使われたらタッチ操作をかくす
     （タッチ対応ノート PC・キーボードつき iPad など）。タッチ直後の互換マウスイベントは無視 */
  let lastTouchT = -1e9;
  function setMouseMode() {
    if (!Input.isTouch) return;
    Input.isTouch = false;
    updateTouchVisibility();
    if (typeof Input.onModeChange === 'function') {
      try { Input.onModeChange(false); } catch (err) { setTimeout(() => { throw err; }, 0); }
    }
  }
  function realMouse(e) {
    if (!Input.isTouch || now() - lastTouchT <= MOUSE_AFTER_TOUCH) return false;
    if (e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return false;
    return true;
  }

  function btnOf(target) {
    let n = target, depth = 0;
    while (n && depth < 6) {
      if (n.__tiBtn) return n;
      n = n.parentNode; depth++;
    }
    return null;
  }

  /* メニュー画面のボタンなど、ゲーム外の UI へのタッチは横取りしない */
  function isForeignUI(target) {
    let n = target, depth = 0;
    while (n && n !== document.body && depth < 12) {
      if (ui && n === ui.layer) return false;
      const tn = (n.tagName || '').toUpperCase();
      if (tn === 'BUTTON' || tn === 'INPUT' || tn === 'SELECT' || tn === 'TEXTAREA' || tn === 'A' || tn === 'LABEL') return true;
      if (n.classList && n.classList.contains && (n.classList.contains('screen') || n.classList.contains('ti-pass'))) return true;
      n = n.parentNode; depth++;
    }
    return false;
  }

  function viewW() { return window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 800; }
  function viewH() { return window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 450; }

  /* ======================================================================
     レイアウト（ボタン配置・大きさ）
     layout = {v:1, scale, btn:{fire:{x,y,s,def}, ...}}
       x,y = 中心（画面の割合 0..1）、s = そのボタンの倍率、scale = 全体倍率
       def = まだ動かしていない（v1 の位置: 右下 / 左下のすみから px で決まる。どの画面の向きでもくずれない）
     保存形式は getLayout() と同じ（def のボタンは d:1 がつく。x,y はその画面での位置）
     ====================================================================== */
  function defaultLayout() {
    const btn = {};
    for (let i = 0; i < CTRL_NAMES.length; i++) btn[CTRL_NAMES[i]] = { x: 0, y: 0, s: 1, def: true };
    return { v: 1, scale: 1, btn: btn };
  }

  function cloneLayout(l) {
    const btn = {};
    for (let i = 0; i < CTRL_NAMES.length; i++) {
      const c = l.btn[CTRL_NAMES[i]];
      btn[CTRL_NAMES[i]] = { x: c.x, y: c.y, s: c.s, def: c.def };
    }
    return { v: 1, scale: l.scale, btn: btn };
  }

  function numOr(v, d) {
    if (typeof v === 'number') return isFinite(v) ? v : d;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return d;
  }
  const round2 = (v) => Math.round(v * 100) / 100;
  const round4 = (v) => Math.round(v * 10000) / 10000;
  const cleanScale = (v) => round2(clamp(numOr(v, 1), S_MIN, S_MAX));
  const cleanGlobal = (v) => round2(clamp(numOr(v, 1), G_MIN, G_MAX));

  /* 外から来たレイアウト（保存データ・setLayout）を安全な形に。こわれた所は初期値。
     d:1（初期位置のまま）のボタンは、ふつう x,y を見ない（x,y は保存した時の画面での位置で、
     画面の向きや大きさが変わると古くなるため）。
     lenient = setLayout から: getLayout() の結果の x,y を書きかえて渡した場合（d:1 が残っていても）は
     いまの画面での初期位置と 1% 以上ちがえば「動かした」とみなす（仕様の {x,y,s} だけで動かせるように）。 */
  const MOVED_TOL = 0.01;
  function sanitize(obj, lenient) {
    const out = defaultLayout();
    if (!obj || typeof obj !== 'object') return out;
    if (obj.v !== undefined && numOr(obj.v, 0) !== 1) return out;
    out.scale = cleanGlobal(obj.scale);
    const b = obj.btn && typeof obj.btn === 'object' ? obj.btn : null;
    if (!b) return out;
    const loose = [];
    for (let i = 0; i < CTRL_NAMES.length; i++) {
      const n = CTRL_NAMES[i], c = b[n];
      if (!c || typeof c !== 'object') continue;
      const o = out.btn[n];
      o.s = cleanScale(c.s);
      const x = numOr(c.x, NaN), y = numOr(c.y, NaN);
      if (!isFinite(x) || !isFinite(y)) continue;
      if (!c.d && !c.def) { o.x = clamp(x, 0, 1); o.y = clamp(y, 0, 1); o.def = false; }
      else if (lenient) loose.push([n, clamp(x, 0, 1), clamp(y, 0, 1)]);
    }
    if (loose.length) {
      const g = computeGeom(out);
      for (let i = 0; i < loose.length; i++) {
        const n = loose[i][0], x = loose[i][1], y = loose[i][2], it = g.items[n];
        if (Math.abs(x - it.cx / g.W) > MOVED_TOL || Math.abs(y - it.cy / g.H) > MOVED_TOL) {
          const o = out.btn[n];
          o.x = x; o.y = y; o.def = false;
        }
      }
    }
    return out;
  }

  /* 公開・保存用の形。x,y はいま画面に出ている中心（初期位置のボタンも、重なりをほどいた後の位置） */
  function exportLayout(l) {
    const g = computeGeom(l);
    const btn = {};
    for (let i = 0; i < CTRL_NAMES.length; i++) {
      const n = CTRL_NAMES[i], c = l.btn[n];
      let x = c.x, y = c.y;
      if (c.def) { const it = g.items[n]; x = it.cx / g.W; y = it.cy / g.H; }
      const o = { x: round4(clamp(x, 0, 1)), y: round4(clamp(y, 0, 1)), s: c.s };
      if (c.def) o.d = 1;
      btn[n] = o;
    }
    return { v: 1, scale: l.scale, btn: btn };
  }

  function sameLayout(a, b) {
    if (!a || !b) return a === b;
    if (a.scale !== b.scale) return false;
    for (let i = 0; i < CTRL_NAMES.length; i++) {
      const p = a.btn[CTRL_NAMES[i]], q = b.btn[CTRL_NAMES[i]];
      if (p.s !== q.s || p.def !== q.def) return false;
      if (!p.def && (Math.abs(p.x - q.x) > 1e-4 || Math.abs(p.y - q.y) > 1e-4)) return false;
    }
    return true;
  }

  /* ---------- 画面への当てはめ ---------- */
  function readInsets() {
    const o = { l: 0, t: 0, r: 0, b: 0 };
    if (!probe || typeof window.getComputedStyle !== 'function') return o;
    try {
      const cs = window.getComputedStyle(probe);
      const px = (v) => { const n = parseFloat(v); return n > 0 && n < 400 ? n : 0; };
      o.t = px(cs.paddingTop); o.r = px(cs.paddingRight); o.b = px(cs.paddingBottom); o.l = px(cs.paddingLeft);
    } catch (err) {}
    return o;
  }

  function baseK(W, H) { return (H >= 620 && W >= 900) ? BIG_K : 1; }

  /* 画面の大きさ・安全領域（レイアウトに関係なく決まる部分） */
  function geomFor(l) {
    const W = viewW(), H = viewH(), ins = readInsets();
    return {
      W: W, H: H, k: baseK(W, H), G: l.scale, ins: ins,
      rect: { l: ins.l + EDGE, t: ins.t + EDGE, r: W - ins.r - EDGE, b: H - ins.b - EDGE },
      items: {}, list: [], obst: []
    };
  }

  /* まだ動かしていないボタンの中心（v1 の位置。全体倍率で すみを中心に広がる） */
  function anchorOf(n, l, g) {
    const kG = g.k * l.scale;
    if (n === 'stick') return [g.ins.l + STICK_HOME.l * g.W + STICK_R * kG, g.H - g.ins.b - (STICK_HOME.b + STICK_R) * kG];
    const b = BTN_GEOM[n];
    return [g.W - g.ins.r - (b.r + b.d / 2) * kG, g.H - g.ins.b - (b.b + b.d / 2) * kG];
  }

  function radiusOf(n, l, g) {
    const stick = n === 'stick';
    const d = (stick ? STICK_R * 2 : BTN_GEOM[n].d) * g.k * l.scale * l.btn[n].s;
    const lo = stick ? MIN_STICK_D : MIN_D;
    const hi = Math.max(lo, Math.min(g.W, g.H) * (stick ? 0.6 : 0.45));
    return clamp(d, lo, hi) / 2;
  }

  function clampItem(g, it) {
    const R = g.rect;
    const x0 = R.l + it.r, x1 = R.r - it.r, y0 = R.t + it.r, y1 = R.b - it.r;
    it.cx = x0 <= x1 ? clamp(it.cx, x0, x1) : (R.l + R.r) / 2;
    it.cy = y0 <= y1 ? clamp(it.cy, y0, y1) : (R.t + R.b) / 2;
  }

  /* 重なりをほどく。only を指定すると、はじめはそのボタンだけを動かす（ほかは固定）。
     すみに追いこまれて動けないときは、後半で全員を動かす。右上の ≡ と スコア は動かさない。 */
  function relax(g, only) {
    const L = g.list, O = g.obst;
    for (let i = 0; i < L.length; i++) clampItem(g, L[i]);
    for (let pass = 0; pass < 40; pass++) {
      const strict = !!only && pass < 20;
      let moved = false;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        for (let j = i + 1; j < L.length; j++) {
          const b = L[j];
          let dx = b.cx - a.cx, dy = b.cy - a.cy, d = Math.hypot(dx, dy);
          const need = a.r + b.r + GAP;
          if (d >= need - 0.01) continue;
          let wa = 0.5, wb = 0.5;
          if (strict) {
            wa = a.name === only ? 1 : 0; wb = b.name === only ? 1 : 0;
            if (!wa && !wb) continue;
          }
          if (d < 0.01) { dx = -0.8; dy = -0.6; d = 1; }   // ぴったり重なり: 左上へ
          const push = need - d, ux = dx / d, uy = dy / d;
          a.cx -= ux * push * wa; a.cy -= uy * push * wa;
          b.cx += ux * push * wb; b.cy += uy * push * wb;
          moved = true;
        }
        if (strict && a.name !== only) continue;
        for (let j = 0; j < O.length; j++) {
          const o = O[j];
          let dx = a.cx - o.cx, dy = a.cy - o.cy, d = Math.hypot(dx, dy);
          const need = a.r + o.r + GAP;
          if (d >= need - 0.01) continue;
          if (d < 0.01) { dx = -0.6; dy = 0.8; d = 1; }
          a.cx += dx / d * (need - d); a.cy += dy / d * (need - d);
          moved = true;
        }
      }
      for (let i = 0; i < L.length; i++) clampItem(g, L[i]);
      if (!moved) break;
    }
  }

  function computeGeom(l) {
    const g = geomFor(l);
    for (let i = 0; i < CTRL_NAMES.length; i++) {
      const n = CTRL_NAMES[i], c = l.btn[n];
      let cx, cy;
      if (c.def) { const a = anchorOf(n, l, g); cx = a[0]; cy = a[1]; }
      else { cx = c.x * g.W; cy = c.y * g.H; }
      const it = { name: n, cx: cx, cy: cy, r: radiusOf(n, l, g) };
      g.items[n] = it;
      g.list.push(it);
    }
    for (const n in SMALL_GEOM) {
      const s = SMALL_GEOM[n];
      g.obst.push({ name: n, cx: g.W - g.ins.r - s.r - s.d / 2, cy: g.ins.t + s.t + s.d / 2, r: s.d / 2 });
    }
    relax(g, null);
    return g;
  }

  function setBox(el, x, y, d) {
    if (!el || !el.style) return;
    const s = el.style;
    s.left = fmt(x) + 'px';
    s.top = fmt(y) + 'px';
    s.width = fmt(d) + 'px';
    s.height = fmt(d) + 'px';
  }

  function placeEl(n, it) {
    if (!ui) return;
    if (n === 'stick') {
      stickR = it.r;
      const d = it.r * 2, kd = d * 52 / 120;
      setBox(ui.ghost, it.cx - it.r, it.cy - it.r, d);
      ui.stick.style.width = fmt(d) + 'px';
      ui.stick.style.height = fmt(d) + 'px';
      setBox(ui.knob, (d - kd) / 2, (d - kd) / 2, kd);
      return;
    }
    const el = ui[n];
    setBox(el, it.cx - it.r, it.cy - it.r, it.r * 2);
    const f = it.r * 2 / BTN_GEOM[n].d;
    el.style.fontSize = Math.max(8, Math.round(BTN_GEOM[n].fs * Math.min(1.5, f))) + 'px';
    try { if (el.style.setProperty) el.style.setProperty('--u', clamp(f, 0.5, 2).toFixed(3)); } catch (err) {}
    if (n === 'fire') setClass(el, 'ti-tiny', it.r * 2 < 70);
  }

  function applyLayout() {
    if (!work) work = defaultLayout();
    geom = computeGeom(work);
    if (geom.items.stick) stickR = geom.items.stick.r;
    if (ui) {
      for (let i = 0; i < CTRL_NAMES.length; i++) placeEl(CTRL_NAMES[i], geom.items[CTRL_NAMES[i]]);
      const R = geom.rect;
      setBox(ui.safe, R.l, R.t, 0);
      ui.safe.style.width = fmt(Math.max(0, R.r - R.l)) + 'px';
      ui.safe.style.height = fmt(Math.max(0, R.b - R.t)) + 'px';
      if (editing) markOverlaps();
    }
    let x0 = Infinity, y0 = Infinity;
    for (let i = 0; i < BTN_NAMES.length; i++) {
      const it = geom.items[BTN_NAMES[i]];
      if (it.cx < geom.W / 2) continue;
      x0 = Math.min(x0, it.cx - it.r);
      y0 = Math.min(y0, it.cy - it.r);
    }
    keepOk = x0 < Infinity;
    keepOut.x0 = keepOk ? x0 : geom.W;
    keepOut.y0 = keepOk ? y0 : geom.H;
  }

  function onViewport() {
    if (!inited) return;
    if (drags.size) finishDrags(true);
    applyLayout();
  }

  /* ---------- 編集 ---------- */
  function markOverlaps() {
    if (!ui || !geom) return;
    const L = geom.list, bad = {};
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        if (Math.hypot(L[i].cx - L[j].cx, L[i].cy - L[j].cy) < L[i].r + L[j].r - 0.5) bad[L[i].name] = bad[L[j].name] = 1;
      }
      for (let j = 0; j < geom.obst.length; j++) {
        const o = geom.obst[j];
        if (Math.hypot(L[i].cx - o.cx, L[i].cy - o.cy) < L[i].r + o.r - 0.5) bad[L[i].name] = 1;
      }
    }
    for (let i = 0; i < CTRL_NAMES.length; i++) setClass(ctrlEl(CTRL_NAMES[i]), 'ti-bad', editing && !!bad[CTRL_NAMES[i]]);
  }

  function call(fn, arg) {
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (err) { setTimeout(() => { throw err; }, 0); }
  }

  function select(name, fromUser) {
    if (name !== selected) {
      setClass(ctrlEl(selected), 'ti-sel', false);
      selected = name;
      setClass(ctrlEl(selected), 'ti-sel', true);
    }
    if (fromUser && editOpts) call(editOpts.onSelect, name);
  }

  function editStart(id, name, x, y) {
    if (drags.has(id) || !geom) return;
    for (const d of drags.values()) if (d.name === name) return;   // 同じボタンを 2 本の指で持たない
    const it = geom.items[name], c = work.btn[name];
    drags.set(id, { name: name, sx: x, sy: y, cx0: it.cx, cy0: it.cy, moved: false, prev: { x: c.x, y: c.y, s: c.s, def: c.def } });
    setClass(ctrlEl(name), 'ti-drag', true);
    select(name, true);
  }

  function editMove(id, x, y) {
    const d = drags.get(id);
    if (!d) return;
    const dx = x - d.sx, dy = y - d.sy;
    if (!d.moved) {
      if (dx * dx + dy * dy < DRAG_SLOP * DRAG_SLOP) return;
      d.moved = true;
    }
    const it = geom.items[d.name];
    it.cx = d.cx0 + dx; it.cy = d.cy0 + dy;
    clampItem(geom, it);
    const c = work.btn[d.name];
    c.x = it.cx / geom.W; c.y = it.cy / geom.H; c.def = false;
    placeEl(d.name, it);
    markOverlaps();
  }

  /* はなした: ほかと重なっていたら、動かしたボタンだけを すきまのある所へずらして決定 */
  function editEnd(id, cancel) {
    const d = drags.get(id);
    if (!d) return;
    drags.delete(id);
    setClass(ctrlEl(d.name), 'ti-drag', false);
    const c = work.btn[d.name];
    if (cancel) {
      c.x = d.prev.x; c.y = d.prev.y; c.def = d.prev.def;
      applyLayout();
      return;
    }
    if (!d.moved) return;
    relax(geom, d.name);
    const it = geom.items[d.name];
    c.x = clamp(it.cx / geom.W, 0, 1); c.y = clamp(it.cy / geom.H, 0, 1); c.def = false;
    applyLayout();
    if (editOpts) call(editOpts.onChange, exportLayout(work));
  }

  function finishDrags(cancel) {
    for (const id of Array.from(drags.keys())) editEnd(id, cancel);
  }

  function editTargetName(target) {
    const b = btnOf(target);
    return b && EDITABLE[b.__tiBtn] ? b.__tiBtn : null;
  }

  function editTouchStart(e) {
    if (e.touches && drags.size) {
      const live = new Set();
      for (let i = 0; i < e.touches.length; i++) live.add(e.touches[i].identifier);
      for (const id of Array.from(drags.keys())) if (id !== MOUSE_ID && !live.has(id)) editEnd(id, false);
    }
    const list = e.changedTouches || [];
    let handled = false;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], name = editTargetName(t.target || e.target);
      if (!name) continue;
      handled = true;
      editStart(t.identifier, name, t.clientX, t.clientY);
    }
    if (handled && e.cancelable) e.preventDefault();
  }

  function editMouseDown(e) {
    if (e.button !== 0) return;
    if (now() - lastTouchT < MOUSE_AFTER_TOUCH) return;          // タップのあとの互換マウスイベント
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    if (drags.has(MOUSE_ID)) editEnd(MOUSE_ID, false);             // 前のドラッグの mouseup を取りこぼしていた
    const name = editTargetName(e.target);
    if (!name) return;
    editStart(MOUSE_ID, name, +e.clientX || 0, +e.clientY || 0);
    if (e.cancelable !== false && e.preventDefault) e.preventDefault();
  }

  /* ======================================================================
     タッチ（しあい中）
     ====================================================================== */
  function pressButton(btn, id, t) {
    const a = btn.__tiBtn;
    setBtnOn(btn, true);
    const rec = { kind: 'btn', x: t.clientX, y: t.clientY, btn: btn };
    switch (a) {
      case 'fire':
        rec.kind = 'fire';
        touches.set(id, rec);
        touchFireDown();
        return;
      case 'jump': edge.jump = true; break;
      case 'slide': edge.slide = true; break;
      case 'bomb': edge.bomb = true; break;
      case 'reload': edge.reload = true; break;
      case 'sp': edge.sp = true; break;
      case 'sw': edge.sw = true; break;
      case 'menu': edge.menu = true; break;
      case 'board':
        touchBoard = !touchBoard;
        setClass(ui && ui.board, 'ti-act', touchBoard);
        break;
    }
    touches.set(id, rec);
  }

  /* スティックはスティック側（ふつうは左）で指が置かれた所に出る。
     スティックを右側に動かしたレイアウトなら、右側がスティックの場所になる */
  function inStickZone(x) {
    const w = viewW();
    const it = geom && geom.items.stick;
    if (!it) return x < w * STICK_ZONE;
    if (it.cx <= w / 2) return x < Math.max(w * STICK_ZONE, it.cx + it.r * 1.5);
    return x > Math.min(w * (1 - STICK_ZONE), it.cx - it.r * 1.5);
  }

  function startStick(id, x, y) {
    const R = geom ? geom.rect : { l: 0, t: 0, r: viewW(), b: viewH() };
    const x0 = R.l + stickR, x1 = R.r - stickR, y0 = R.t + stickR, y1 = R.b - stickR;
    stickCX = x0 <= x1 ? clamp(x, x0, x1) : (R.l + R.r) / 2;
    stickCY = y0 <= y1 ? clamp(y, y0, y1) : (R.t + R.b) / 2;
    stickId = id;
    stickVX = stickVY = 0;
    touches.set(id, { kind: 'stick', x: x, y: y, btn: null });
    if (ui) {
      ui.stick.style.transform = 'translate3d(' + fmt(stickCX - stickR) + 'px,' + fmt(stickCY - stickR) + 'px,0)';
      showStick(true);
    }
    moveStick(x, y);
  }

  function moveStick(x, y) {
    let dx = x - stickCX, dy = y - stickCY;
    const d = Math.hypot(dx, dy);
    if (d > stickR) { dx *= stickR / d; dy *= stickR / d; }
    if (ui) ui.knob.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
    const m = Math.min(1, d / stickR);
    if (m <= STICK_DEAD) { stickVX = stickVY = 0; return; }
    const s = (m - STICK_DEAD) / (1 - STICK_DEAD) / (d || 1);
    stickVX = (x - stickCX) * s;
    stickVY = -(y - stickCY) * s;
    const l = Math.hypot(stickVX, stickVY);
    if (l > 1) { stickVX /= l; stickVY /= l; }
  }

  function endTouch(id, cancel) {
    const rec = touches.get(id);
    if (!rec) return;
    touches.delete(id);
    if (rec.kind === 'stick') {
      if (stickId === id) { stickId = null; stickVX = stickVY = 0; showStick(false); }
      return;
    }
    if (rec.btn) {
      let still = false;
      for (const r of touches.values()) if (r.btn === rec.btn) still = true;
      if (!still) setBtnOn(rec.btn, false);
    }
    if (rec.kind === 'fire') touchFireUp(cancel);
  }

  function onTouchStart(e) {
    lastTouchT = now();
    setTouchMode();
    if (editing) { editTouchStart(e); return; }
    if (!enabled) return;
    const target = e.target;
    const btn = btnOf(target);
    if (!btn && isForeignUI(target)) return;
    if (e.cancelable) e.preventDefault();
    // touchend を取りこぼした指（iOS のジェスチャーなど）を片付ける（撃たずに）
    if (e.touches && touches.size) {
      const live = new Set();
      for (let i = 0; i < e.touches.length; i++) live.add(e.touches[i].identifier);
      for (const id of Array.from(touches.keys())) if (!live.has(id)) endTouch(id, true);
    }
    const list = e.changedTouches || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i], id = t.identifier;
      if (touches.has(id)) endTouch(id, true);
      const b = btnOf(t.target || target);
      if (b && b.__tiBtn !== 'stick') { pressButton(b, id, t); continue; }
      if (stickId === null && inStickZone(t.clientX)) startStick(id, t.clientX, t.clientY);
      else touches.set(id, { kind: 'look', x: t.clientX, y: t.clientY, btn: null });
    }
  }

  function onTouchMove(e) {
    lastTouchT = now();
    const list = e.changedTouches || [];
    let handled = false;
    if (editing) {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (drags.has(t.identifier)) { handled = true; editMove(t.identifier, t.clientX, t.clientY); }
      }
      if (handled && e.cancelable) e.preventDefault();
      return;
    }
    if (!enabled) return;
    const k = TOUCH_K * (+S().touchSens || 1) * adsScale;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], rec = touches.get(t.identifier);
      if (!rec) continue;
      handled = true;
      const x = t.clientX, y = t.clientY;
      if (rec.kind === 'stick') moveStick(x, y);
      else if (rec.kind === 'look' || rec.kind === 'fire') {
        tLookX += (x - rec.x) * k;
        tLookY -= (y - rec.y) * k;
      }
      rec.x = x; rec.y = y;
    }
    if (handled && e.cancelable) e.preventDefault();
  }

  function onTouchEnd(e) {
    lastTouchT = now();
    const cancel = e.type === 'touchcancel';
    const list = e.changedTouches || [];
    let handled = false;
    for (let i = 0; i < list.length; i++) {
      const id = list[i].identifier;
      if (drags.has(id)) { handled = true; editEnd(id, cancel); }
      if (touches.has(id)) { handled = true; endTouch(id, cancel); }
    }
    if (handled && (enabled || editing) && e.cancelable) e.preventDefault();
  }

  /* ---------- HUD バッジ ---------- */
  function setHud(h) {
    if (!h) return;
    let vis = false;
    if (h.canAds !== undefined && h.canAds !== hud.canAds) { hud.canAds = h.canAds; vis = true; }
    if (h.ads !== undefined && !!h.ads !== hud.ads) { hud.ads = !!h.ads; vis = true; }
    if (vis) syncFireVisual(touchAdsNow());
    if (!ui) return;
    if (h.bombCharges !== undefined || h.bombMax !== undefined) {
      const c = h.bombCharges !== undefined ? (h.bombCharges | 0) : hud.bombCharges;
      const mx = h.bombMax !== undefined ? (h.bombMax | 0) : hud.bombMax;
      if (c !== hud.bombCharges || mx !== hud.bombMax) {
        hud.bombCharges = c; hud.bombMax = mx;
        ui.badge.textContent = c >= 0 ? String(c) : '';
        setClass(ui.badge, 'ti-zero', c <= 0);
        setClass(ui.bomb, 'ti-dim', c <= 0);
      }
    }
    if (h.bombCd !== undefined || h.bombCharges !== undefined) {
      // bombCd = 次の 1 個が戻るまでの残り割合（1=使った直後, 0=戻った）。満タンならリングなし
      const full = hud.bombMax > 0 && hud.bombCharges >= hud.bombMax;
      const cd = full ? 0 : Math.min(1, Math.max(0, +h.bombCd || 0));
      const step = cd > 0 ? Math.round((1 - cd) * 60) : -1;
      if (step !== hud.cdStep && ui.ringC) {
        hud.cdStep = step;
        const off = step < 0 ? ui.RING_LEN : ui.RING_LEN * (1 - step / 60);
        ui.ringC.setAttribute('stroke-dashoffset', off.toFixed(2));
      }
    }
    if (h.ammo !== undefined || h.reloading !== undefined) {
      const reloading = !!h.reloading;
      const empty = !reloading && h.ammo !== undefined && h.ammo <= 0;
      if (empty !== hud.empty) { hud.empty = empty; setClass(ui.reload, 'ti-empty', empty); }
      if (reloading !== hud.reloading) { hud.reloading = reloading; setClass(ui.reload, 'ti-busy', reloading); }
    }
  }

  /* ======================================================================
     ゲームパッド
     ====================================================================== */
  function deadzone2(x, y, dz) {
    const m = Math.hypot(x, y);
    if (m <= dz) return null;
    const mm = Math.min(1, (m - dz) / (1 - dz));
    return [x / m * mm, y / m * mm, mm];
  }

  function readPad(dt) {
    pad.mx = pad.mz = 0;
    if (!padSeen || !navigator.getGamepads) return;
    let list;
    try { list = navigator.getGamepads(); } catch (err) { return; }
    let gp = null;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        if (g && g.connected !== false) { if (g.mapping === 'standard') { gp = g; break; } if (!gp) gp = g; }
      }
    }
    const prev = pad.prev;
    if (!gp) {
      pad.slide = false;
      if (pad.fire || pad.ads || pad.board) { pad.fire = pad.ads = pad.board = false; syncFire(); }
      prev.length = 0;
      return;
    }
    const act = gameActive();
    const ax = gp.axes || [], bt = gp.buttons || [];
    const val = (i) => { const b = bt[i]; return b ? (typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : +b) : 0; };
    const down = (i) => { const b = bt[i]; return !!b && (typeof b === 'object' ? (b.pressed || b.value > 0.5) : b > 0.5); };
    const pressedEdge = (i) => { const d = down(i); const was = !!prev[i]; prev[i] = d; return d && !was; };

    const ls = deadzone2(+ax[0] || 0, +ax[1] || 0, PAD_DEAD_L);
    if (ls && act) { pad.mx = ls[0]; pad.mz = -ls[1]; }
    const rs = deadzone2(+ax[2] || 0, +ax[3] || 0, PAD_DEAD_R);
    if (rs && act) {
      const curve = rs[2] * rs[2];                 // expo（小さい倒しで細かく）
      const k = PAD_LOOK * (+S().sens || 1) * adsScale * dt * curve / rs[2];
      lookX += rs[0] * k;
      lookY -= rs[1] * k;
    }
    const rt = val(7), lt = val(6);
    const fire = act && (pad.fire ? rt > 0.25 : rt > 0.35);
    if (fire !== pad.fire) { pad.fire = fire; syncFire(); }
    pad.ads = act && lt > 0.3;
    pad.board = act && down(8);
    pad.slide = act && (down(1) || down(11));
    pad.jump = act && down(0);
    const eA = pressedEdge(0), eB = pressedEdge(1), eX = pressedEdge(2), eY = pressedEdge(3), eLB = pressedEdge(4), eRB = pressedEdge(5),
      eStart = pressedEdge(9), eR3 = pressedEdge(11);
    if (act) {
      if (eA) edge.jump = true;
      if (eB || eR3) edge.slide = true;
      if (eX) edge.reload = true;
      if (eY) edge.sp = true;                    // v4: 必殺技
      if (eLB || eRB) edge.bomb = true;
      /* v5: 十字キー（どれでも）で 銃の もちかえ */
      const eD = pressedEdge(12) | pressedEdge(13) | pressedEdge(14) | pressedEdge(15);
      if (eD) edge.sw = true;
      if (eStart) edge.menu = true;
    }
  }

  /* ======================================================================
     公開 API
     ====================================================================== */
  const Input = CS.Input = {
    isTouch: false,
    locked: false,
    enabled: false,
    editing: false,
    hasGamepad: false,
    onLockChange: null,
    onModeChange: null,
    CONTROLS: CTRL_NAMES.slice(),
    CONTROL_LABELS: Object.assign({}, CTRL_LABELS),

    init: function (opts) {
      if (inited) return;
      inited = true;
      opts = opts || {};
      canvas = opts.canvas || null;
      touchRoot = opts.touchRoot || null;
      Input.isTouch = detectTouch();
      lockSupported = !!(canvas && typeof canvas.requestPointerLock === 'function' && 'pointerLockElement' in document);

      const on = (t, ev, fn, o) => { try { t.addEventListener(ev, fn, o); } catch (err) {} };
      on(window, 'keydown', onKeyDown);
      on(window, 'keyup', onKeyUp);
      on(document, 'mousemove', onMouseMove);
      on(document, 'mousedown', onMouseDown);
      on(window, 'mouseup', onMouseUp);
      on(document, 'contextmenu', onContextMenu);
      on(document, 'pointerlockchange', onLockChange);
      on(document, 'pointerlockerror', onLockError);
      /* カーソルが 画面の外へ出た（ロックなしの「はしで 回る」を止める） */
      on(document, 'mouseout', (e) => { if (!e.relatedTarget) vm.inside = false; });
      on(window, 'wheel', (e) => {
        if (!gameActive()) return;
        const d = +e.deltaY || 0;
        if (d) wheelAcc += d > 0 ? 1 : -1;
      }, { passive: true });
      const tOpt = { passive: false };
      on(document, 'touchstart', onTouchStart, tOpt);
      on(document, 'touchmove', onTouchMove, tOpt);
      on(document, 'touchend', onTouchEnd, tOpt);
      on(document, 'touchcancel', onTouchEnd, tOpt);
      on(document, 'gesturestart', (e) => { if ((enabled || editing) && e.cancelable) e.preventDefault(); }, tOpt);
      /* フォーカスが外れた: 押しっぱなしを全部はなす。編集中のドラッグは その場で決定 */
      const lost = () => { releaseAll(); vm.inside = false; if (drags.size) finishDrags(false); };
      on(window, 'blur', lost);
      on(document, 'visibilitychange', () => { if (document.hidden) lost(); });
      /* 画面の向き・大きさが変わったら配置をやりなおす（iOS は回転のあと少しおくれて安全領域が変わる） */
      const rotated = () => { releaseAll(); onViewport(); setTimeout(onViewport, 350); };
      on(window, 'orientationchange', rotated);
      on(window, 'resize', onViewport);
      try {
        if (window.screen && screen.orientation && screen.orientation.addEventListener) {
          screen.orientation.addEventListener('change', rotated);
        }
      } catch (err) {}
      on(window, 'gamepadconnected', () => { padSeen = true; Input.hasGamepad = true; });
      on(window, 'gamepaddisconnected', () => {
        let any = false;
        try { const l = navigator.getGamepads ? navigator.getGamepads() : []; for (let i = 0; l && i < l.length; i++) if (l[i]) any = true; } catch (err) {}
        Input.hasGamepad = any;
        if (!any) { pad.fire = pad.ads = pad.board = false; pad.prev.length = 0; syncFire(); }
      });
      if (canvas && canvas.style) {
        try { canvas.style.touchAction = 'none'; } catch (err) {}
      }
      buildTouchUI();
      const st = S().touchLayout;
      saved = st && typeof st === 'object' ? sanitize(st) : null;
      work = saved ? cloneLayout(saved) : defaultLayout();
      applyLayout();
      updateTouchVisibility();
      lastPoll = now();
    },

    enable: function (v) {
      v = !!v;
      if (v === enabled) { updateTouchVisibility(); return; }
      enabled = v;
      Input.enabled = v;
      releaseAll();
      clearEdges();
      clearLook();
      fireWas = false;
      if (!v) {
        touchBoard = false;
        if (ui) setClass(ui.board, 'ti-act', false);
        exitLock();
      }
      updateTouchVisibility();
    },

    requestLock: requestLock,

    poll: function () {
      const t = now();
      const dt = Math.min(0.05, Math.max(0, (t - lastPoll) / 1000));
      lastPoll = t;
      readPad(dt);

      const out = {
        mx: 0, mz: 0, lookX: 0, lookY: 0,
        fire: false, firePressed: false, fireReleased: false, ads: false,
        jump: false, jumpHeld: false, slide: false, slideHeld: false, bomb: false, reload: false, board: false, menu: false,
        special: false, keys: NO_KEYS, wheel: 0
      };
      if (!gameActive()) {
        clearEdges();
        clearLook();
        clearLinger();
        return out;
      }

      // 移動
      let mx = 0, mz = 0;
      if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
      mx += stickVX + pad.mx;
      mz += stickVY + pad.mz;
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      out.mx = mx; out.mz = mz;

      // ロックなし（virtualLock）: カーソルが 画面の はしに あると その向きへ 回りつづける
      if (virtualLock && vm.inside && !Input.isTouch) {
        const ek = (p, size) => { const e = Math.max(36, size * 0.06); return p < e ? -(1 - p / e) : p > size - e ? (p - (size - e)) / e : 0; };
        const ex = ek(vm.x, viewW()), ey = ek(vm.y, viewH());
        if (ex) lookX += clamp(ex, -1, 1) * EDGE_TURN * dt * adsScale;
        if (ey) lookY -= clamp(ey, -1, 1) * EDGE_TURN * 0.6 * dt * adsScale;
      }

      // 視点（タッチ: 75% を即反映、残りは次フレームで反映）
      const nx = tLookX * TOUCH_SMOOTH + tCarryX, ny = tLookY * TOUCH_SMOOTH + tCarryY;
      tCarryX = tLookX - tLookX * TOUCH_SMOOTH; tCarryY = tLookY - tLookY * TOUCH_SMOOTH;
      tLookX = tLookY = 0;
      const inv = S().invertY ? -1 : 1;
      out.lookX = lookX + nx;
      out.lookY = (lookY + ny) * inv;
      lookX = lookY = 0;

      // 引き金: ふつう（押した瞬間に撃つ）+ スコープ銃の「うつ」（押しているあいだ fire=ためる、はなした瞬間 firePressed）
      syncFire();
      const tAds = touchAdsNow();
      out.fire = fireWas || (tf.active && tf.scoped);
      out.firePressed = edge.firePressed;
      out.fireReleased = edge.fireReleased;
      const linger = adsLinger || (adsLingerT > 0 && t < adsLingerT);
      if (!linger) adsLingerT = 0;
      adsLinger = false;
      out.ads = mouseAds || pad.ads || tAds || linger;
      syncFireVisual(tAds);
      out.jump = edge.jump;
      out.jumpHeld = jumpHeld();
      out.slide = edge.slide;
      out.slideHeld = slideHeld();
      out.bomb = edge.bomb;
      out.reload = edge.reload;
      out.menu = edge.menu;
      out.special = edge.sp;
      out.swap = edge.sw;
      out.board = tabHeld || touchBoard || pad.board;
      out.keys = edgeCodes.length ? edgeCodes.slice() : NO_KEYS;
      out.wheel = wheelAcc;
      clearEdges();
      return out;
    },

    /* タッチボタンの文字を変える（マップエディター）。null でもとにもどす。{fire, jump, slide, bomb, reload} */
    setLabels: function (map) {
      if (!ui) return;
      const DEF = { fire: 'うつ', jump: 'ジャンプ', slide: 'スライド', bomb: 'ボム', reload: 'リロード' };
      for (const k in DEF) {
        const el = ui[k];
        if (!el) continue;
        const sp = el.querySelector ? el.querySelector('span') : null;
        const txt = map && map[k] ? map[k] : DEF[k];
        if (sp && sp.textContent !== txt) sp.textContent = txt;
      }
      setClass(ui.layer, 'ti-editor', !!map);
    },

    setHud: setHud,

    /* v5: 銃の もちかえボタンを 出す・かくす（銃が 2つ ないときは かくす） */
    setSwap: function (on) {
      if (!ui || !ui.sw) return;
      setClass(ui.sw, 'ti-noswap', !on);
    },

    /* v5.4: 大ジャンプ。k = じゅんびの ぐあい 0..1（1 = つかえる）、k < 0 = かくす */
    setBigJump: function (k) {
      if (!ui || !ui.jump) return;
      const q = !(k >= 0) ? -1 : Math.round(clamp(+k, 0, 1) * 40);
      if (q === ui._bjQ) return;
      ui._bjQ = q;
      if (ui.bjRing) ui.bjRing.setAttribute('stroke-dashoffset', (q < 0 ? ui.RING_LEN : ui.RING_LEN * (1 - q / 40)).toFixed(2));
      setClass(ui.jump, 'ti-bjok', q === 40);
    },

    /* v4: 必殺ボタン。k = リング（ゲージ 0..1、つかっている間は のこり）、ready = まんたん、act = つかっている */
    setSpecial: function (k, ready, act) {
      if (!ui || !ui.sp) return;
      const q = Math.round(clamp(+k || 0, 0, 1) * 40);
      if (ui.spRing && q !== ui._spQ) {
        ui._spQ = q;
        ui.spRing.setAttribute('stroke-dashoffset', (ui.RING_LEN * (1 - q / 40)).toFixed(2));
      }
      const st = act ? 'a' : ready ? 'r' : 'n';
      if (st !== ui._spSt) {
        ui._spSt = st;
        setClass(ui.sp, 'ti-ready', st === 'r');
        setClass(ui.sp, 'ti-act', st === 'a');
        setClass(ui.sp, 'ti-dim', st === 'n');
      }
    },

    /* 右半分のタッチボタンのかたまりの左上 {x0, y0}（CSS px）。タッチ操作が出ていなければ null。
       返すオブジェクトは使い回し（毎フレーム呼んでよい） */
    touchKeepOut: touchKeepOut,

    setAdsScale: function (k) {
      k = +k;
      adsScale = k > 0 ? Math.min(2, Math.max(0.05, k)) : 1;
    },

    /* 「うつ」ボタンの方式。scoped = 押して ねらい、はなして うつ（dmr / sniper / crossbow / rail）。
       押している最中に変わっても、その押し方は押した時の方式のまま。毎フレーム呼んでよい */
    setGunMode: function (m) {
      const s = !!(m && typeof m === 'object' ? m.scoped : m);
      if (s === gunScoped) return;
      gunScoped = s;
      setClass(ui && ui.fire, 'ti-scoped', s);
    },

    /* ねらいを解除（死亡・リスポーン時など）。スコープ銃で押したままなら、はなしても撃たない */
    resetAds: function () {
      if (tf.active) {
        if (tf.scoped) { tf.active = false; edge.fireReleased = true; }
        else tf.noAds = true;
      }
      clearLinger();
      syncFireVisual(false);
    },

    /* 押しっぱなしの入力を全部はなす */
    releaseAll: releaseAll,

    /* ---------- ボタン配置・大きさ ---------- */
    getLayout: function () { return exportLayout(work || defaultLayout()); },
    setLayout: function (obj) {
      finishDrags(true);
      work = sanitize(obj, true);
      applyLayout();
      return Input.getLayout();
    },
    resetLayout: function () {
      finishDrags(true);
      work = defaultLayout();
      applyLayout();
      return Input.getLayout();
    },
    saveLayout: function () {
      finishDrags(false);
      const out = exportLayout(work);
      saved = cloneLayout(work);
      if (CS.Settings) CS.Settings.touchLayout = out;
      try { if (typeof CS.saveSettings === 'function') CS.saveSettings(); } catch (err) {}
      return Input.getLayout();
    },
    revertLayout: function () {
      finishDrags(true);
      work = saved ? cloneLayout(saved) : defaultLayout();
      applyLayout();
      return Input.getLayout();
    },
    layoutDirty: function () { return !sameLayout(work, saved || defaultLayout()); },
    setControlScale: function (name, s) {
      if (!EDITABLE[name] || !work) return false;
      work.btn[name].s = cleanScale(s);
      applyLayout();
      return true;
    },
    setGlobalScale: function (k) {
      if (!work) work = defaultLayout();
      work.scale = cleanGlobal(k);
      applyLayout();
      return work.scale;
    },
    selectControl: function (name) {
      select(EDITABLE[name] ? name : null, false);
      return selected;
    },
    /* on: 全部のタッチ操作を出して（PC でも）、ドラッグで移動・タップで選択。ゲームの入力は止める。
       opts.onSelect(name) … ボタンを選んだ、opts.onChange(layout) … ドラッグで配置が変わった */
    editLayout: function (on, opts) {
      on = !!on;
      if (on) {
        editOpts = opts || {};
        if (!editing) {
          releaseAll();
          exitLock();
          editing = true;
          Input.editing = true;
          clearEdges();
          clearLook();
          fireWas = false;
        }
        updateTouchVisibility();
        applyLayout();
        return true;
      }
      if (!editing) return false;
      finishDrags(false);
      select(null, false);
      editing = false;
      Input.editing = false;
      editOpts = null;
      for (let i = 0; i < CTRL_NAMES.length; i++) setClass(ctrlEl(CTRL_NAMES[i]), 'ti-bad', false);
      releaseAll();
      clearEdges();
      clearLook();
      fireWas = false;
      updateTouchVisibility();
      applyLayout();
      return false;
    },
    /* いま画面に出ている配置（px）: {w, h, safe:{l,t,r,b}, items:[{name, x, y, r}]}（x,y = 中心） */
    getLayoutRects: function () {
      if (!geom) applyLayout();
      const items = [];
      for (let i = 0; i < geom.list.length; i++) {
        const it = geom.list[i];
        items.push({ name: it.name, x: it.cx, y: it.cy, r: it.r, fixed: false });
      }
      for (let i = 0; i < geom.obst.length; i++) {
        const o = geom.obst[i];
        items.push({ name: o.name, x: o.cx, y: o.cy, r: o.r, fixed: true });
      }
      const R = geom.rect;
      return { w: geom.W, h: geom.H, safe: { l: R.l - EDGE, t: R.t - EDGE, r: R.r + EDGE, b: R.b + EDGE }, items: items };
    }
  };

  function detectTouch() {
    let touch = false;
    try { touch = CS.isTouch ? CS.isTouch() : (('ontouchstart' in window) || navigator.maxTouchPoints > 0); } catch (err) {}
    if (!touch) return false;
    // タッチ対応ノート PC（主ポインターがマウス）ではマウス操作を優先。触れたら切り替わる
    try {
      if (window.matchMedia) {
        if (window.matchMedia('(pointer: coarse)').matches) return true;
        if (window.matchMedia('(any-pointer: fine)').matches) return false;
      }
    } catch (err) {}
    return true;
  }
})();
