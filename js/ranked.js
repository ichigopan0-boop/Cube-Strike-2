/* ==========================================================================
   CUBE STRIKE - ランダムマッチ（v5.3）
   おなじ ランク（tier）の人と じどうで 1対1・2対2・3対3。サーバーは つかわない。
   しくみ: ランク × 人数 ごとに きまった へやの コード（'QR' + 人数 + ランク + ばんごう + 版）を 4つ よういする。
     さがす人は ばんごう 0 から「その コードで へやを作る」→ だれかが もう 作っていたら（unavailable-id）「その へやに 入る」
     → いっぱい・はじまっていたら つぎの ばんごう。だれも いなければ じぶんが その へやで まつ。
     ひとりで まっている ホストは ときどき 下の ばんごうへ うつる（まっている へやが ばらけないように）。
   へやでは じゅんびOK は じどう。そろったら 3秒で じどうで はじまる。20秒 まっても そろわなければ ホストは
   コンピューターで うめられる。勝つと +25・負けると -15（CS.Settings.rank）。とちゅうで ぬけると 負けと おなじ。
   main.js の へやの しらせ（roomOpen / lobby / hostGone / error）は さがしている あいだ ここが うけとる（hook）。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Game) return;

  const TIERS = [
    { id: 'bronze', name: 'ブロンズ', min: 0, color: '#d9a06a', ch: 'B', cpu: 'easy' },
    { id: 'silver', name: 'シルバー', min: 200, color: '#cfd8e3', ch: 'C', cpu: 'normal' },
    { id: 'gold', name: 'ゴールド', min: 450, color: '#ffd23d', ch: 'G', cpu: 'normal' },
    { id: 'platinum', name: 'プラチナ', min: 750, color: '#7fe8dc', ch: 'P', cpu: 'hard' },
    { id: 'diamond', name: 'ダイヤ', min: 1100, color: '#8fb8ff', ch: 'D', cpu: 'hard' },
    { id: 'master', name: 'マスター', min: 1500, color: '#ff8ad8', ch: 'M', cpu: 'hard' }
  ];
  const MODES = {
    '1v1': { ch: 'A', per: 1, rule: { id: 'kills', n: 5 } },
    '2v2': { ch: 'B', per: 2, rule: { id: 'kills', n: 10 } },
    '3v3': { ch: 'C', per: 3, rule: { id: 'kills', n: 10 } }
  };
  const SLOT_CH = ['2', '3', '4', '6'];   // へやの ばんごう（コードに つかえる 文字）
  const WIN = 25, LOSE = 15;
  const FILL_AFTER = 20;     // 秒: これだけ まっても そろわなければ コンピューターで うめられる
  const MOVE_DOWN = 12;      // 秒: ひとりで まっている ホストが 下の ばんごうへ うつれるか ためす
  const START_DELAY = 3;     // そろってから はじまるまで（秒）
  const ROUNDS = 3;          // ぜんぶの ばんごうを ためす 回数

  const now = () => Date.now();
  function $(id) { return document.getElementById(id); }
  function game() { return CS.debug && CS.debug.game; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  /* ---- ランク ---- */
  function rankData() {
    let r = CS.Settings.rank;
    if (!r || typeof r !== 'object') r = CS.Settings.rank = {};
    r.pts = Math.max(0, Math.min(99999, Math.round(+r.pts || 0)));
    r.w = Math.max(0, r.w | 0); r.l = Math.max(0, r.l | 0);
    r.best = Math.max(r.pts, +r.best || 0);
    return r;
  }
  function tierOf(pts) { let t = TIERS[0]; for (const x of TIERS) if (pts >= x.min) t = x; return t; }
  function tierById(id) { for (const x of TIERS) if (x.id === id) return x; return TIERS[0]; }
  function tierName(id) { return tierById(id).name; }
  function codeFor(mode, tier, slot) {
    const C = CS.Net.CODE_CHARS;
    return 'QR' + MODES[mode].ch + tier.ch + SLOT_CH[slot] + C[(CS.VERSION | 0) % C.length];
  }
  /* 勝ち・負けを ランクに（d = ふえる点） */
  function applyDelta(d, won, lost) {
    const r = rankData();
    const before = tierOf(r.pts), p0 = r.pts;
    r.pts = Math.max(0, r.pts + d);
    d = r.pts - p0;                       // 0 より 下には ならないので ほんとうに かわった ぶん
    if (won) r.w++;
    if (lost) r.l++;
    r.best = Math.max(r.best, r.pts);
    if (CS.saveSettings) CS.saveSettings();
    const after = tierOf(r.pts);
    return { d: d, pts: r.pts, before: before, after: after, up: after.min > before.min, down: after.min < before.min };
  }

  /* ---- さがしかた（R = いまの ようす） ----
     phase: 'idle' / 'search'（へやを さがしている）/ 'room'（ランダムマッチの へやで まっている）/ 'match' / 'done'（結果） */
  let R = fresh();
  function fresh() {
    return { phase: 'idle', mode: '1v1', tier: TIERS[0], slot: 0, step: '', round: 0, t0: 0, waitT0: 0, lastMove: 0, startAt: 0,
      counted: false, moving: false, timer: 0, last: null };
  }
  function pickMap() { const l = CS.Maps.list; return l[Math.floor(Math.random() * l.length)].id; }

  function start(mode) {
    const g = game();
    if (!g || !MODES[mode]) return;
    clearTimeout(R.timer);
    R = fresh();
    R.phase = 'search'; R.mode = mode; R.tier = tierOf(rankData().pts); R.t0 = now();
    CS.Settings.rkMode = mode;
    if (CS.saveSettings) CS.saveSettings();
    if (U.current !== 'scRanked') U.show('scRanked');
    render();
    tryHost();
  }
  function tryHost() {
    if (R.phase !== 'search') return;
    R.step = 'host';
    const opts = Object.assign({ rule: MODES[R.mode].rule, code: codeFor(R.mode, R.tier, R.slot), ranked: { tier: R.tier.id } }, CS.netOpts || {});
    R.moving = true;
    try { game().createRoom(R.mode, pickMap(), opts); } finally { R.moving = false; }
    render();
  }
  function tryJoin() {
    if (R.phase !== 'search') return;
    R.step = 'join';
    game().joinRoom(codeFor(R.mode, R.tier, R.slot), CS.netOpts || {});
    render();
  }
  function nextSlot() {
    R.slot++;
    if (R.slot >= SLOT_CH.length) {
      R.slot = 0; R.round++;
      if (R.round >= ROUNDS) { fail('いまは へやが いっぱいです。すこし まってから もう一度 さがしてね'); return; }
      R.timer = setTimeout(tryHost, 1500);
      return;
    }
    tryHost();
  }
  function fail(text) {
    clearTimeout(R.timer);
    const mode = R.mode;
    R = fresh(); R.mode = mode;
    U.show('scRanked');
    render();
    U.msg('rkStatus', text, true);
  }
  function cancel() {
    const g = game();
    clearTimeout(R.timer);
    const mode = R.mode;
    R = fresh(); R.mode = mode;
    if (g && (g.room || g.net)) g.leaveRoom();
    render();
  }
  /* ひとりで まっている ホスト: いったん 出て ばんごう 0 から さがしなおす */
  function moveDown() {
    const g = game();
    R.moving = true;
    try { g.leaveRoom(); } finally { R.moving = false; }
    R.phase = 'search'; R.slot = 0; R.round = 0; R.step = '';
    tryHost();
  }

  /* main.js の へやの しらせ（true を かえすと main.js は なにもしない） */
  function hook(name, a, b) {
    const g = game();
    if (R.phase === 'search') {
      /* ホスト: へやが できた。ゲスト: つながっただけ（いっぱい・はじまっている かも）→ lobby が とどくまで まつ */
      if (name === 'roomOpen') {
        if (!(g && g.isHost)) return true;
        R.phase = 'room'; R.waitT0 = now(); R.lastMove = now(); R.startAt = 0;
        g.setReady(true);
        return false;                                  // ふつうに ロビーを 出す
      }
      /* ホストは つながった人に すぐ lobby を送る（入れるか きめる前）。じぶんが ならびに 入っていたら 入れた */
      if (name === 'lobby' && R.step === 'join') {
        const me = findMe(a);
        if (!me) return true;
        R.phase = 'room'; R.waitT0 = now(); R.lastMove = now(); R.startAt = 0;
        if (!me.ready && g) g.setReady(true);
        return false;
      }
      if (name === 'error') {
        if (R.step === 'host' && b === 'unavailable-id') { tryJoin(); return true; }     // もう だれかが まっている
        if (R.step === 'join') { nextSlot(); return true; }                               // いっぱい・はじまっている・いなくなった
        fail(a || 'つながりませんでした');
        return true;
      }
      if (name === 'hostGone') { nextSlot(); return true; }
      if (name === 'lobby') return true;              // さがしている あいだは ロビーを 出さない
      return false;
    }
    if (R.phase === 'room') {
      if (name === 'lobby') {
        /* じゅんびOK は じどう */
        const v = a, me = v && findMe(v);
        if (me && !me.ready && g) g.setReady(true);
        return false;
      }
      if (name === 'hostGone') { CS.UI.toast('へやが なくなったので もう一度 さがします'); start(R.mode); return true; }
      if (name === 'error') { fail(a || 'つながりませんでした'); return true; }
    }
    if (R.phase === 'match') {
      if (name === 'hostGone' || name === 'error') {
        const mode = R.mode;
        R = fresh(); R.mode = mode;
        U.show('scRanked'); render();
        U.msg('rkStatus', 'ホストが いなくなったので しあいは なしに なりました（ランクは かわりません）', true);
        return true;
      }
    }
    if (R.phase === 'done' && name === 'hostGone') return true;     // 結果を 見ている あいだは そのまま
    return false;
  }
  function findMe(v) {
    for (const row of v.slots || []) for (const p of row) if (p && p.id === v.myId) return p;
    return null;
  }

  /* まいかい（0.25秒ごと）: ホストは そろったら はじめる・ひとりなら 下へ うつる */
  function tick() {
    const g = game();
    if (!g) return;
    if (R.phase === 'room') {
      if (g.mode === 'match') { R.phase = 'match'; R.startAt = 0; return; }
      if (!g.room || g.mode !== 'lobby' || !g.room.ranked) return;
      const room = g.room, total = MODES[R.mode].per * 2;
      const full = room.players.length >= total;
      if (g.isHost) {
        const humans = room.players.filter((p) => !p.bot).length;
        if (!full && humans === 1 && R.slot > 0 && now() - R.lastMove > MOVE_DOWN * 1000) { R.lastMove = now(); moveDown(); return; }
        if (full && g.canStart()) {
          if (!R.startAt) R.startAt = now() + START_DELAY * 1000;
          const left = Math.ceil((R.startAt - now()) / 1000);
          if (left <= 0) { R.startAt = 0; g.startMatch(); return; }
          U.msg('lobbyMsg', 'そろった！ ' + left + '秒で はじまる');
        } else R.startAt = 0;
      }
      const fill = $('btnRkFill');
      if (fill) fill.style.display = g.isHost && !full && now() - R.waitT0 > FILL_AFTER * 1000 ? '' : 'none';
    } else {
      const fill = $('btnRkFill');
      if (fill && fill.style.display !== 'none') fill.style.display = 'none';
    }
    if (R.phase === 'search' && U.current === 'scRanked') render();
  }
  /* ホスト: あいている ところを コンピューターで うめる（ランクに あわせた つよさ） */
  function fillCpu() {
    const g = game();
    if (!g || !g.isHost || !g.room || !g.room.ranked || g.mode !== 'lobby') return;
    const per = MODES[R.mode].per;
    for (let t = 0; t < 2; t++) {
      for (let k = 0; k < per; k++) {
        const n = g.room.players.filter((p) => p.team === t).length;
        if (n >= per) break;
        if (!g.roomBot('add', t)) break;
        const p = g.room.players[g.room.players.length - 1];
        if (p && p.bot) p.bot = R.tier.cpu;
      }
    }
    g._broadcastLobby();
  }

  /* ---- とちゅうで ぬけたら 負けと おなじ ---- */
  const G = CS.Game.prototype;
  const origLeave = G.leaveRoom;
  G.leaveRoom = function () {
    if (!R.moving) {
      if (this.room && this.room.ranked && this.mode === 'match' && this.phase !== 'over' && !R.counted) {
        R.counted = true;
        const res = applyDelta(-LOSE, false, true);
        try { CS.UI.toast('とちゅうで ぬけたので ランク -' + LOSE + '（' + res.pts + 'pt）'); } catch (e) {}
      }
      if (R.phase !== 'search') { clearTimeout(R.timer); const mode = R.mode; R = fresh(); R.mode = mode; }
    }
    return origLeave.apply(this, arguments);
  };

  /* ======================================================================
     画面
     ====================================================================== */
  let U = null;
  const CSS = [
    '#btnRanked{border-color:#ffd23d;box-shadow:0 0 0 1px rgba(255,210,61,.35) inset}',
    '#btnRanked small{color:#ffe9a8}',
    '#rkCard{width:100%;display:grid;gap:6px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}',
    '#rkCard .tn{font-size:clamp(26px,6vmin,40px);font-weight:900;letter-spacing:.08em;line-height:1.1}',
    '#rkCard .pt{font-size:14px;color:#dfe8f7}#rkCard .pt b{font-size:20px;color:#fff}',
    '#rkCard .bar{height:10px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden}',
    '#rkCard .bar i{display:block;height:100%;border-radius:6px}',
    '#rkCard .sub{font-size:12.5px;color:#a9bddb}',
    '#rkMode{display:flex;gap:8px;width:100%}',
    '#rkMode .btn{flex:1;min-height:48px}',
    '#rkMode .btn.sel{border-color:#ffd23d;box-shadow:0 0 0 2px rgba(255,210,61,.45)}',
    '#rkTiers{display:flex;flex-wrap:wrap;gap:6px 10px;justify-content:center;font-size:12px;color:#9fb4d4}',
    '#rkTiers b{font-weight:800}',
    '#rkRes{display:none;font-size:15px;text-align:center;line-height:1.6}',
    '#rkRes.on{display:block}#rkRes b{font-size:20px}#rkRes .up{color:#ffd23d;font-weight:900}#rkRes .down{color:#ffb3c0}'
  ].join('\n');

  function buildScreens() {
    if ($('scRanked')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    const tierList = TIERS.map((t) => '<span><b style="color:' + t.color + '">' + esc(t.name) + '</b> ' + t.min + '〜</span>').join('');
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scRanked" class="screen"><div class="panel wide" style="max-width:640px">' +
      '<h2>ランダムマッチ</h2>' +
      '<div id="rkCard"></div>' +
      '<p class="lead">知らない人と じどうで たたかう。あいては <b>おなじ ランク</b>の人だけ。勝つと <b>+' + WIN + '</b>、負けると <b>-' + LOSE + '</b>' +
      '（とちゅうで ぬけても -' + LOSE + '）。' + FILL_AFTER + '秒 まっても そろわないときは コンピューターで うめられる。</p>' +
      '<h3>人数</h3><div id="rkMode"></div>' +
      '<div id="rkStatus" class="msg"></div>' +
      '<div class="stack"><button id="btnRkGo" class="btn big pink" type="button">さがす</button>' +
      '<button id="btnRkCancel" class="btn" type="button" style="display:none">さがすのを やめる</button>' +
      '<button id="btnRkBack" class="btn ghost" type="button" data-back>もどる</button></div>' +
      '<div id="rkTiers">' + tierList + '</div>' +
      '</div></section>');
    U.addScreen('scRanked', render);
    const tap = U.util.tap;
    tap('btnRkGo', () => start(CS.Settings.rkMode && MODES[CS.Settings.rkMode] ? CS.Settings.rkMode : '1v1'), 'go');
    tap('btnRkCancel', () => { cancel(); U.msg('rkStatus', 'さがすのを やめました'); }, 'back');
    tap('btnRkBack', () => { if (R.phase === 'search') cancel(); U.back('scRanked'); }, 'back');

    /* タイトル画面の いちばん上に */
    const create = $('btnCreate');
    if (create && !$('btnRanked')) {
      const b = document.createElement('button');
      b.id = 'btnRanked'; b.type = 'button'; b.className = 'btn big';
      b.innerHTML = 'ランダムマッチ<small>おなじ ランクの人と たたかう</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} U.open('scRanked', 'scTitle'); });
      create.parentNode.insertBefore(b, create);
    }
    /* ロビー: コンピューターで うめる（ランダムマッチの ホストだけ・まってから） */
    const leave = $('btnLeave');
    if (leave && !$('btnRkFill')) {
      const b = document.createElement('button');
      b.id = 'btnRkFill'; b.type = 'button'; b.className = 'btn';
      b.style.display = 'none';
      b.textContent = 'のこりを コンピューターで うめて はじめる';
      b.addEventListener('click', () => { try { CS.Audio.play('ok'); } catch (e) {} fillCpu(); });
      leave.parentNode.insertBefore(b, leave);
    }
    /* 結果: ランクの ふえた・へった */
    const resMsg = $('resMsg');
    if (resMsg && !$('rkRes')) {
      const d = document.createElement('div');
      d.id = 'rkRes';
      resMsg.parentNode.insertBefore(d, resMsg);
    }
    /* 結果の「もう一回」: ランダムマッチなら へやを出て もう一度 さがす（ふつうの 動きより 先に うけとる） */
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('#btnAgain') : null;
      if (!t || R.phase !== 'done') return;
      e.stopImmediatePropagation(); e.preventDefault();
      try { CS.Audio.play('go'); } catch (err) {}
      const mode = R.mode;
      const g = game();
      if (g) g.leaveRoom();
      start(mode);
    }, true);
  }

  function render() {
    if (!$('scRanked')) return;
    const r = rankData(), t = tierOf(r.pts);
    const i = TIERS.indexOf(t), next = TIERS[i + 1];
    const k = next ? (r.pts - t.min) / (next.min - t.min) : 1;
    $('rkCard').innerHTML =
      '<div class="tn" style="color:' + t.color + '">' + esc(t.name) + '</div>' +
      '<div class="pt"><b>' + r.pts + '</b> pt ・ ' + r.w + '勝 ' + r.l + '敗</div>' +
      '<div class="bar"><i style="width:' + Math.round(Math.max(0.03, Math.min(1, k)) * 100) + '%;background:' + t.color + '"></i></div>' +
      '<div class="sub">' + (next ? 'あと ' + (next.min - r.pts) + 'pt で ' + esc(next.name) : 'いちばん上の ランク！') + '</div>';
    const box = $('rkMode');
    const cur = CS.Settings.rkMode && MODES[CS.Settings.rkMode] ? CS.Settings.rkMode : '1v1';
    box.innerHTML = '';
    for (const m of ['1v1', '2v2', '3v3']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (m === cur ? ' sel' : '');
      b.textContent = m.replace('v', '対');
      b.disabled = R.phase === 'search';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} CS.Settings.rkMode = m; if (CS.saveSettings) CS.saveSettings(); render(); });
      box.appendChild(b);
    }
    const searching = R.phase === 'search';
    $('btnRkGo').style.display = searching ? 'none' : '';
    $('btnRkCancel').style.display = searching ? '' : 'none';
    if (searching) {
      const sec = Math.floor((now() - R.t0) / 1000);
      U.msg('rkStatus', R.mode.replace('v', '対') + '：' + R.tier.name + 'の 人を さがしています… ' + sec + '秒' + (R.step === 'join' ? '（へやに 入っています）' : ''));
    }
  }

  /* 結果に ランクの ふえた・へった を出す */
  function decorate(res) {
    const el = $('rkRes');
    if (!res || !res.ranked || (R.phase !== 'match' && R.phase !== 'room' && R.phase !== 'done')) { if (el) el.classList.remove('on'); return; }
    if (!R.counted) {
      R.counted = true;
      const w = res.winner === undefined || res.winner === null ? -1 : res.winner;
      const my = res.myTeam | 0;
      const won = w >= 0 && w === my, lost = w >= 0 && w !== my;
      R.last = applyDelta(won ? WIN : lost ? -LOSE : 0, won, lost);
    }
    R.phase = 'done';
    const L = R.last;
    if (el && L) {
      const sign = L.d > 0 ? '+' + L.d : L.d < 0 ? String(L.d) : '±0';
      el.innerHTML = 'ランク <b style="color:' + L.after.color + '">' + esc(L.after.name) + '</b> ' + L.pts + 'pt（' + sign + '）' +
        (L.up ? '<br><span class="up">ランクアップ！ ' + esc(L.after.name) + 'に あがった！</span>' : L.down ? '<br><span class="down">' + esc(L.after.name) + 'に さがった…</span>' : '');
      el.classList.add('on');
    }
    U.util.setText($('btnAgain'), 'もう一回 さがす');
    U.msg('resMsg', 'つぎも おなじ ランクの人と たたかうよ（' + R.mode.replace('v', '対') + '）');
  }

  function init() {
    U = CS.UI;
    buildScreens();
    const orig = U.showResult;
    U.showResult = function (res) {
      const out = orig.apply(U, arguments);
      decorate(res);
      return out;
    };
    setInterval(tick, 250);
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  CS.Ranked = {
    TIERS: TIERS, MODES: MODES, tierOf: tierOf, tierName: tierName, codeFor: codeFor, hook: hook,
    start: start, cancel: cancel, rank: rankData, get state() { return R; }
  };
})();
