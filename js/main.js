/* ==========================================================================
   CUBE STRIKE — main.js
   起動・画面のつなぎこみ・入力・requestAnimationFrame ループ。
   CS.UI のハンドラ → CS.Game のメソッド、という一方向のつなぎ方にしている。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  let renderer = null, game = null, canvas = null, editor = null, hub = null, town = null;
  let menuOpen = false, running = false, rafId = 0;
  let lastT = 0;
  let presenceId = 0;
  /* ホストの時計（ふっかつ・回復・残り時間・hs）は rAF だけにまかせない。
     タブを裏にすると rAF は止まるが、通信は届きつづけるので、ホストの判定が止まると
     ゲストはたおされたまま生き返れなくなる。hostClock =「ホストの仕事を進めた実時間」。
     frame() が進めた分は loop() が足し、足りない分（rAF が止まった・カクついた）は beat() が進める。 */
  let beatId = 0, hostClock = 0;
  const BEAT_MS = 100;        // 実時間タイマーの間隔
  const BEAT_IDLE = 250;      // これ以上 frame() が進めていなければ beat() が進める

  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  let joinPending = false, createPending = false;

  const isLocal = !!CS.query('local');
  const lagMs = Math.max(0, Math.min(2000, +CS.query('lag') || 0));
  const netOpts = { local: isLocal, lag: lagMs };
  CS.netOpts = netOpts;       // v5.3: ランダムマッチ（ranked.js）も おなじ つなぎかたで
  /* v5.3: ランダムマッチが さがしている あいだは へやの しらせを ranked.js が うけとる（true なら ここでは なにもしない） */
  const rk = (name, a, b) => !!(CS.Ranked && CS.Ranked.hook && CS.Ranked.hook(name, a, b));

  /* ------------------------------------------------------------------
     WebGL が使えないとき
     ------------------------------------------------------------------ */
  function fatal(text, sub) {
    try {
      const d = document.createElement('div');
      d.setAttribute('style', 'position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;' +
        'justify-content:center;gap:14px;text-align:center;padding:24px;background:#04060f;color:#dfe9ff;' +
        'font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif');
      const h = document.createElement('div');
      h.setAttribute('style', 'font-size:22px;font-weight:800;letter-spacing:.12em;color:#7fd6ff');
      h.textContent = 'CUBE STRIKE 2';
      const p = document.createElement('p');
      p.setAttribute('style', 'font-size:15px;line-height:1.9;max-width:460px;color:#cfe0f7');
      p.textContent = text;
      const s = document.createElement('p');
      s.setAttribute('style', 'font-size:12px;line-height:1.8;color:#7f96ba;max-width:460px');
      s.textContent = sub || '';
      const a = document.createElement('a');
      a.href = '../index.html';
      a.setAttribute('style', 'margin-top:10px;font-size:14px;color:#7fd6ff;text-decoration:none;border:1px solid rgba(127,214,255,.5);' +
        'padding:10px 18px;border-radius:12px');
      a.textContent = '← アーケードへ戻る';
      d.appendChild(h); d.appendChild(p); d.appendChild(s); d.appendChild(a);
      document.body.appendChild(d);
    } catch (e) {
      if (window.console) console.error(text);
    }
  }

  /* ------------------------------------------------------------------
     メニュー（しあい中。オンラインは止まらない）
     ------------------------------------------------------------------ */
  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    try { CS.Input.enable(false); } catch (e) {}
    CS.UI.show('scMenu');
  }
  function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    CS.UI.show(null);
    if (inPlay()) {
      try { CS.Input.enable(true); } catch (e) {}
      if (!CS.Input.isTouch) { try { CS.Input.requestLock(); } catch (e) {} }
    }
  }
  function inPlay() {
    return game && (game.mode === 'match' || game.mode === 'practice') && game.phase !== 'over' && !game.hold;
  }

  /* ------------------------------------------------------------------
     マップエディター（しあいとは べつ。ゲームは 'idle' のまま）
     ------------------------------------------------------------------ */
  function editorPlay() {
    menuOpen = false;
    editor.paused = false;
    CS.UI.show(null);
    try { CS.Input.enable(true); } catch (e) {}
    if (!CS.Input.isTouch) { try { CS.Input.requestLock(); } catch (e) {} }
  }
  function openEditorMenu() {
    if (!editor || !editor.active || editor.paused) return;
    editor.paused = true;
    try { CS.Input.enable(false); } catch (e) {}
    CS.UI.show('scEdMenu');
  }
  function openEditor(m) {
    joinPending = createPending = false;
    menuOpen = false;
    game.leaveRoom();
    if (!m || !editor.open(m)) { CS.UI.toast('マップを ひらけませんでした'); CS.UI.show('scMaps'); return false; }
    editorPlay();
    return true;
  }

  /* ------------------------------------------------------------------
     フレンドに見せる「いまの状態」
     ------------------------------------------------------------------ */
  function presence() {
    if (editor && editor.active) return { s: 'edit' };
    if (!game) return { s: 'menu' };
    if (game.mode === 'lobby' && game.room) {
      const v = game.lobbyView() || {};
      const room = game.room;
      const st = {
        s: 'lobby', room: room.code, open: !room.started && (v.count | 0) < (v.max | 0),
        mode: room.mode, mapName: v.mapName || '', rule: room.rule, n: v.count | 0, max: v.max | 0
      };
      /* みんなで塔のぼり: マップ・ルールの かわりに むずかしさ */
      if (room.mode === 'tower') {
        const D = CS.Tower && CS.Tower.DIFFS, t = room.tower;
        st.mapName = '塔のぼり ' + (D && t && D[t.diff] ? D[t.diff].name : 'ふつう');
        delete st.rule;
      }
      /* v5.1: みんなで トーナメント */
      if (room.mode === 'tourney' && CS.Tourney) {
        st.mapName = 'トーナメント ' + (room.tourney ? room.tourney.n + '人' : '');
        delete st.rule;
      }
      /* CS2: みんなで ボスレイド */
      if (room.mode === 'raid' && CS.Raid) {
        const r = CS.Raid.cleanCfg(room.raid);
        st.mapName = 'ボスレイド ' + CS.Raid.bossOf(r.boss).name;
        delete st.rule;
      }
      /* CS2: 城バトル */
      if (room.mode === 'castle' && CS.Castle) {
        const c = CS.Castle.cleanCfg(room.castle);
        st.mapName = '城バトル ' + c.n + '対' + c.n;
        delete st.rule;
      }
      /* v5: みんなで クリスタルまもり */
      if (room.mode === 'defense') {
        const DF = CS.Defense, d = room.defense;
        st.mapName = 'クリスタルまもり ' + (DF && d ? DF.diffOf(d.diff).name : 'ふつう');
        delete st.rule;
      }
      return st;
    }
    if (game.mode === 'match') return { s: game.tower ? 'tower' : game.offline ? 'cpu' : 'match' };
    if (game.mode === 'practice') return { s: 'practice' };
    if (town && town.active && game.mode === 'idle') return { s: 'town' };
    return { s: 'menu' };
  }
  function activateFriends() { if (hub) { try { hub.activate(); } catch (e) {} } }

  /* ------------------------------------------------------------------
     せってい
     ------------------------------------------------------------------ */
  function applySettings() {
    const s = CS.Settings;
    if (renderer && renderer.ok) renderer.setQuality(s.quality || 'auto');
    try { CS.Audio.setVolume(typeof s.vol === 'number' ? s.vol : 0.8); } catch (e) {}
  }

  /* ------------------------------------------------------------------
     ハンドラ（CS.UI から呼ばれる）
     ------------------------------------------------------------------ */
  /* みんなのステージ（'p:<sid>'）で あそんだら「さいきん あそんだ」に のこす（マップをえらぶ画面に出る） */
  function noteStage(mapId) {
    if (CS.Stages && typeof mapId === 'string' && mapId.indexOf('p:') === 0) { try { CS.Stages.noteRecent(mapId.slice(2)); } catch (e) {} }
  }

  const handlers = {
    create: function (mode, mapId, rule) {
      CS.Audio.init();
      if (editor && editor.active) editor.close();
      noteStage(mapId);
      createPending = true;
      activateFriends();
      CS.UI.msg('createMsg', 'へやを作っています…');
      const code = game.createRoom(mode, mapId, Object.assign({ rule: rule }, netOpts));
      CS.UI.show('scLobby');
      CS.UI.renderLobby(game.lobbyView() || { code: code, mode: mode, mapId: mapId, isHost: true, myId: 'host', slots: [[], []], canStart: false });
    },
    join: function (code) {
      CS.Audio.init();
      if (editor && editor.active) editor.close();
      joinPending = true;
      activateFriends();
      CS.UI.msg('joinMsg', 'へやをさがしています…');
      if (!game.joinRoom(code, netOpts)) { joinPending = false; return; }
    },
    /* v5: クリスタルまもり（ひとりで）。opt = {diff, map} */
    defense: function (opt) {
      CS.Audio.init();
      joinPending = createPending = false;
      menuOpen = false;
      if (!game.startDefense || !game.startDefense(opt || {})) { CS.UI.toast('いま クリスタルまもりを はじめられません'); return; }
      startPlay();
    },
    /* CS2: ボスレイド（ひとりで＋コンピューターの なかま）。opt = {boss, diff, ally} */
    raid: function (opt) {
      CS.Audio.init();
      joinPending = createPending = false;
      menuOpen = false;
      if (!game.startRaid || !game.startRaid(opt || {})) { CS.UI.toast('いま ボスレイドを はじめられません'); return; }
      startPlay();
    },
    /* CS2: ホストだけ: ボスレイドの へやの せってい */
    roomRaid: function (cfg) { game.setRoomRaid(cfg); },
    /* CS2: 城バトル（じぶん＋なかまの CPU vs CPU）。opt = {n, time, lv} */
    castle: function (opt) {
      CS.Audio.init();
      joinPending = createPending = false;
      menuOpen = false;
      if (!game.startCastle || !game.startCastle(opt || {})) { CS.UI.toast('いま 城バトルを はじめられません'); return; }
      startPlay();
    },
    /* CS2: ホストだけ: 城バトルの へやの せってい */
    roomCastle: function (cfg) { game.setRoomCastle(cfg); },
    /* 塔のぼり。opt = {diff} */
    tower: function (opt) {
      CS.Audio.init();
      joinPending = createPending = false;
      menuOpen = false;
      if (!game.startTower(opt || {})) { CS.UI.toast('いま 塔のぼりを はじめられません'); return; }
      startPlay();
    },
    /* ホストだけ: ロビーでルール・マップを変える */
    roomRule: function (rule, mapId) { noteStage(mapId); game.setRoomRule(rule, mapId); },
    /* v5: ホストだけ: へやの コンピューター（'add' チーム / 'del' id / 'lv' id） */
    roomBot: function (op, a) { game.roomBot(op, a); },
    /* スキン・なまえを変えた（ロビーにいれば みんなに伝える） */
    look: function () { game.setLook(); if (hub) hub.setStatus(presence()); },
    skipDance: function () { if (game.skipDance) game.skipDance(); },
    /* マップエディター */
    editMap: function (id) {
      CS.Audio.init();
      const m = CS.CustomMaps.get(id);
      openEditor(m);
    },
    newMap: function (tpl, size) {
      CS.Audio.init();
      const m = CS.CustomMaps.create(tpl, size);
      const saved = CS.CustomMaps.save(m);
      if (!saved) { CS.UI.toast('マップは ' + CS.CustomMaps.MAX_MAPS + 'こ までです。どれかを けしてね'); return; }
      openEditor(saved);
    },
    edResume: function () { editorPlay(); },
    edSave: function () {
      const ok = editor.save();
      CS.UI.toast(ok ? 'ほぞんしました' : 'ほぞんできませんでした（マップがいっぱい？）');
      return !!ok;
    },
    edExit: function (save) {
      if (save) editor.save();
      editor.close();
      menuOpen = false;
      CS.UI.show('scMaps');
    },
    /* 作ったマップで すぐ たたかう（1対1・ふつう） */
    edTest: function () {
      const ok = editor.save();
      if (!ok) { CS.UI.toast('ほぞんできませんでした'); return; }
      const id = 'c:' + editor.map.id;
      editor.close();
      handlers.cpu({ mode: '1v1', level: 'normal', mapId: id, rule: { id: CS.Settings.cpuRule, n: CS.Settings.cpuRuleN } });
    },
    practice: function (opt) {
      CS.Audio.init();
      joinPending = createPending = false;
      game.startPractice(opt && typeof opt === 'object' ? opt : null);
      startPlay();
    },
    /* コンピューターと対戦（オフライン）。c = {mode, level, mapId, rule, ...} */
    cpu: function (c) {
      CS.Audio.init();
      if (editor && editor.active) editor.close();
      joinPending = createPending = false;
      menuOpen = false;
      noteStage(c && c.mapId);
      if (!game.startCpu(c || {})) {
        CS.UI.show('scCpu');
        CS.UI.msg('cpuMsg', 'いま コンピューター戦をはじめられません', true);
        return;
      }
      CS.UI.msg('cpuMsg', '');
      startPlay();
    },
    cpuAgain: function (c) { handlers.cpu(c); },
    loadoutSaved: function (gunId, bombId, gun2Id, gm, gm2) {
      CS.UI.setLoadoutLabel();
      game.setLoadout(gunId, bombId, gun2Id, gm, gm2);
    },
    ready: function (v) { game.setReady(v); },
    start: function () {
      if (!game.startMatch()) CS.UI.msg('lobbyMsg', 'ぜんいんが そろって「じゅんびOK」になると 始められます。', true);
    },
    team: function (t) { game.requestTeam(t); },
    leave: function () {
      joinPending = createPending = false;
      game.leaveRoom();
      CS.UI.show('scTitle');
    },
    again: function () {
      game.backToLobby();
      if (!game.isHost) CS.UI.msg('resMsg', 'ホストがロビーへもどすのを待っています…');
    },
    resume: function () { closeMenu(); },
    quit: function () {
      menuOpen = false;
      joinPending = createPending = false;
      game.quit();
      CS.UI.show('scTitle');
    },
    settings: function () { applySettings(); },
    toTitle: function () {
      joinPending = createPending = false;
      game.leaveRoom();
      CS.UI.show('scTitle');
    }
  };

  /* しあい / ためし撃ちの開始まわり */
  function startPlay() {
    menuOpen = false;
    CS.UI.show(null);
    try { CS.Input.enable(true); } catch (e) {}
    if (!CS.Input.isTouch) {
      CS.UI.hud.clickToPlay(!CS.Input.locked);
      try { CS.Input.requestLock(); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------------
     ゲーム側からの通知
     ------------------------------------------------------------------ */
  const hooks = {
    roomOpen: function () {
      joinPending = false;
      createPending = false;
      if (rk('roomOpen')) return;
      CS.UI.msg('joinMsg', '');
      CS.UI.msg('createMsg', '');
      if (CS.UI.current !== 'scLobby' && CS.UI.current !== 'scLoadout') CS.UI.show('scLobby');
      const v = game.lobbyView();
      if (v) CS.UI.renderLobby(v);
    },
    lobby: function (view) {
      if (!view) return;
      if (rk('lobby', view)) return;
      /* ロビーから開ける画面（ぶき・スキン・フレンド など）にいるときは ロビーへもどさない */
      const keep = { scLoadout: 1, scSettings: 1, scHow: 1, scSkin: 1, scFriends: 1, scChat: 1, scLayout: 1, scTnBracket: 1 };
      if (game.mode === 'lobby' && !keep[CS.UI.current]) {
        if (CS.UI.current !== 'scLobby') CS.UI.show('scLobby');
      }
      CS.UI.renderLobby(view);
    },
    matchStart: function () { startPlay(); },
    matchEnd: function () {
      /* メニューを開いたまま終わった: 閉じる（このあと ダンスか結果が出る） */
      if (menuOpen && (CS.UI.current === 'scMenu' || CS.UI.current === 'scSettings')) CS.UI.show(null);
      menuOpen = false;
    },
    /* いっしょに遊んだ人（フレンド申請できるように おぼえる） */
    recent: function (list) { if (hub) hub.noteRecent(list); },
    toLobby: function () {
      menuOpen = false;
      /* v5.1: みんなで トーナメントの とちゅうは ロビーの かわりに トーナメント表 */
      if (game.room && game.room.mode === 'tourney' && CS.Tourney && CS.Tourney.active()) { CS.UI.show('scTnBracket'); return; }
      CS.UI.show('scLobby');
      const v = game.lobbyView();
      if (v) CS.UI.renderLobby(v);
    },
    hostGone: function () {
      if (rk('hostGone')) return;
      menuOpen = false;
      CS.UI.hud.show(false);
      CS.UI.show('scTitle');
      CS.UI.toast('へやがなくなりました');
    },
    error: function (text, type) {
      if (rk('error', text, type)) return;
      menuOpen = false;
      CS.UI.hud.show(false);
      if (joinPending) {
        joinPending = false;
        createPending = false;
        CS.UI.show('scJoin');
        CS.UI.msg('joinMsg', text || 'つながりませんでした', true);
      } else if (createPending || CS.UI.current === 'scCreate') {
        createPending = false;
        CS.UI.show('scCreate');
        CS.UI.msg('createMsg', text || 'つながりませんでした', true);
      } else {
        CS.UI.show('scTitle');
        CS.UI.toast(text || 'つながりませんでした');
      }
      if (window.console && type) console.warn('[net]', type, text);
    }
  };

  /* ------------------------------------------------------------------
     ループ
     ------------------------------------------------------------------ */
  function loop(t) {
    rafId = requestAnimationFrame(loop);
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;          // タブが戻ったときの大ジャンプを止める
    step(dt);
    /* frame() がホストの仕事を dt 分すすめた（同じ時間を beat() で二重に進めない） */
    hostClock = Math.min(nowMs(), hostClock + dt * 1000);
  }

  /* 実時間タイマー: frame() が進めていない時間の分だけ、ホストの仕事をすすめる */
  function beat() {
    if (!game || !running) return;
    const t = nowMs();
    const lag = t - hostClock;
    if (!(lag >= BEAT_IDLE)) return;   // rAF が動いている
    hostClock = t;
    if (!game.isHost) return;
    try { game.hostTick(lag / 1000); } catch (e) { if (window.console) console.error('[main] hostTick', e); }
  }

  function step(dt) {
    const inp = CS.Input.poll();
    if (editor && editor.active) {
      if (town) town.suspend();
      editor.frame(dt, inp);
      CS.UI.hud.clickToPlay(false);
      if (CS.UI.editorLock) CS.UI.editorLock(!editor.paused && !CS.Input.isTouch && !CS.Input.locked);
      return;
    }
    /* 町（しあい・ためし撃ちの外）。へや（ロビー）の画面の うしろにも 町を出す */
    if (town && !game.dance && (game.mode === 'idle' || (game.mode === 'lobby' && !game.world))) {
      if (game.mode === 'lobby') { town.wake(); game.frame(dt, null); }
      town.frame(dt, inp, game.mode !== 'idle');
      CS.UI.hud.clickToPlay(false);
      return;
    }
    if (town) town.suspend();
    if (inp.menu) {
      if (menuOpen) closeMenu();
      else if (inPlay()) openMenu();
    }
    game.paused = menuOpen;
    if (menuOpen && inPlay()) {
      /* メニュー中は操作しない。オンラインのしあいは進む（止められない）。
         コンピューター戦・ためし撃ちは game.frame の中で止まる */
      game.frame(dt, null);
    } else {
      game.frame(dt, inp);
    }
    if (CS.Tutorial && CS.Tutorial.active) CS.Tutorial.tick(game, dt);
    if (inPlay() && !CS.Input.isTouch && !menuOpen) {
      CS.UI.hud.clickToPlay(!CS.Input.locked);
    } else {
      CS.UI.hud.clickToPlay(false);
    }
  }

  /* ------------------------------------------------------------------
     起動
     ------------------------------------------------------------------ */
  function boot() {
    canvas = CS.$('cv');
    if (!canvas) { fatal('画面を作れませんでした。ページを開きなおしてね。'); return; }

    renderer = new CS.Renderer(canvas);
    if (!renderer.ok) {
      fatal('このブラウザでは 3D（WebGL）が使えないみたい。',
        'ブラウザを最新にするか、べつのブラウザ（Chrome / Safari / Edge）で開いてみてね。');
      return;
    }

    game = new CS.Game({ renderer: renderer, canvas: canvas, hooks: hooks });
    editor = CS.editor = new CS.Editor({ renderer: renderer, onMenu: openEditorMenu });

    /* フレンド（一度でも使った人は 開いたときから待ち受ける）。?fid=xxx で べつの人としてためせる */
    if (CS.Friends) {
      const fid = CS.query('fid');
      hub = CS.Friends.hub = new CS.Friends.Hub({
        local: isLocal, key: 'cubestrike2_friends' + (fid ? '_' + String(fid).replace(/[^a-z0-9]/gi, '').slice(0, 8) : '')
      });
      if (hub.active) hub.start();
      presenceId = setInterval(function () { try { hub.setStatus(presence()); } catch (e) {} }, 1500);
    }

    CS.UI.init(handlers);
    CS.Input.init({ canvas: canvas, touchRoot: CS.$('touch') });
    CS.Input.enable(false);
    /* キューブタウン（起動すると 町から。タイトル画面を出そうとすると 町へ） */
    if (CS.Town) { try { town = CS.Town.init({ renderer: renderer, game: game, handlers: handlers }); } catch (e) { town = null; if (window.console) console.error('[town]', e); } }

    CS.Input.onLockChange = function (locked) {
      if (inPlay() && !menuOpen) CS.UI.hud.clickToPlay(!locked && !CS.Input.isTouch);
      else CS.UI.hud.clickToPlay(false);
    };
    /* タッチになったら「クリックでプレイ」を消す。マウスにもどったら step() が毎フレーム出しなおす */
    CS.Input.onModeChange = function (touch) { if (touch) CS.UI.hud.clickToPlay(false); };

    applySettings();

    /* 最初の操作で音を起こす */
    const wake = function () { try { CS.Audio.init(); } catch (e) {} };
    try {
      window.addEventListener('pointerdown', wake, { passive: true, capture: true });
      window.addEventListener('touchstart', wake, { passive: true, capture: true });
      window.addEventListener('keydown', wake, true);
    } catch (e) {}

    /* メニュー中の Esc（入力が止まっているので自前で拾う）。ダンス中はキーでスキップ */
    try {
      window.addEventListener('keydown', function (e) {
        const k = e.key || e.code;
        if (game && game.dance && !e.repeat) {
          if (k === ' ' || k === 'Enter' || k === 'Escape' || k === 'Esc') { e.preventDefault(); game.skipDance(); }
          return;
        }
        if (editor && editor.active && editor.paused && CS.UI.current === 'scEdMenu') {
          if (k === 'Escape' || k === 'Esc') { e.preventDefault(); editorPlay(); }
          return;
        }
        if (!menuOpen) return;
        if (k === 'Escape' || k === 'Esc' || k === 'm' || k === 'M') { e.preventDefault(); closeMenu(); }
      });
    } catch (e) {}

    /* タブが戻ったら時間の飛びをならす */
    try {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) lastT = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      });
      window.addEventListener('pagehide', function () { if (game) game.leaveRoom(); if (hub) hub.stop(); });
      window.addEventListener('beforeunload', function () { if (game) game.leaveRoom(); });
    } catch (e) {}

    CS.UI.show('scTitle');
    /* ?stage=<ID>（公開ステージのリンク）で来たら、そのステージを すぐ出す */
    if (CS.UI.openStageLink) { try { CS.UI.openStageLink(); } catch (e) {} }

    window.CS.debug = {
      game: game, renderer: renderer, input: CS.Input, ui: CS.UI, editor: editor, town: town,
      get hub() { return hub; },
      get world() { return game ? game.world : null; },
      get net() { return game ? game.net : null; },
      get players() { return game ? game.players : []; },
      openMenu: openMenu, closeMenu: closeMenu, step: step, handlers: handlers, presence: presence,
      local: isLocal, lag: lagMs
    };

    running = true;
    lastT = nowMs();
    hostClock = lastT;
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(loop);
    try { beatId = setInterval(beat, BEAT_MS); } catch (e) { beatId = 0; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  CS.main = {
    boot: boot, step: step, beat: beat, get running() { return running; },
    stop: function () {
      if (rafId) cancelAnimationFrame(rafId);
      if (beatId) { clearInterval(beatId); beatId = 0; }
      running = false;
    }
  };
})();
