/* ==========================================================================
   CUBE STRIKE - トーナメント（v5）
   人数を いれると、その人数で できる かちぬき戦（トーナメント表）を つくる。
   人数が 2・4・8・16… で ないときは、シードの 人が 1回戦を おやすみ（シード）。
   コンピューターどうしの しあいは、つよさで けっかだけ きめる。
   ・ひとりで: じぶん ＋ コンピューター。じぶんの しあいは 1対1（'cpu' の startCpu。cpu.tourney で しるし）。
     とちゅうで やめても、つづきから あそべる（CS.Settings.tnSave）。
   ・みんなで（v5.1）: へや（mode 'tourney'・8人まで）。足りない人数は コンピューター。
     表は ホストが もって {t:'tn'} で みんなへ。人が でる しあいは ホストが ひとつずつ はじめる
     （{t:'start'} の tn。でない人は spec = かんせん）。けっかは ホストが 表に かいて ロビーへ もどす
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS) return;

  const MIN_N = 2, MAX_N = 64;
  const LVS = ['easy', 'normal', 'hard'];
  const LV_NAME = { mix: 'まぜる', easy: 'よわい', normal: 'ふつう', hard: 'つよい' };
  const LV_POW = { easy: 1, normal: 1.8, hard: 3 };      // コンピューターどうしの かちやすさ
  const RULES = {
    k5: { name: '5キル', rule: { id: 'kills', n: 5 } },
    k10: { name: '10キル', rule: { id: 'kills', n: 10 } },
    s3: { name: 'ストック3', rule: { id: 'stock', n: 3 } }
  };
  const NAMES = [
    'ピコ', 'ボルト', 'ドット', 'ネオン', 'ギア', 'ビット', 'キュー', 'ロボ太', 'チップ', 'ノイズ',
    'ラッシュ', 'ミント', 'コメット', 'ブリッツ', 'サンダー', 'パルス', 'ジェット', 'ルビー', 'ソニック', 'タイタン',
    'ポップ', 'スパーク', 'レイ', 'ガンマ', 'デルタ', 'ノヴァ', 'クロウ', 'フォックス', 'ウルフ', 'ホーク',
    'ライガ', 'ハヤテ', 'カゲ', 'シオン', 'ユキ', 'モモ', 'ソラ', 'リク', 'カイ', 'ツバサ',
    'ヒカリ', 'レン', 'アオ', 'ベニ', 'キラ', 'ジン', 'マル', 'コロ'
  ];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clampN = (n) => clamp(Math.round(+n) || MIN_N, MIN_N, MAX_N);
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function $(id) { return document.getElementById(id); }
  function game() { return CS.debug && CS.debug.game; }
  function gunName(id) { const g = CS.GunMap && CS.GunMap[id]; return g ? (g.short || g.name) : ''; }
  function bombName(id) { const b = CS.BombMap && CS.BombMap[id]; return b ? b.name : ''; }
  function mapIds() { return (CS.Maps && CS.Maps.list ? CS.Maps.list : []).map((m) => m.id); }
  function mapName(id) { if (id === 'random') return 'おまかせ'; const m = CS.Maps && CS.Maps.get(id); return m ? m.name : id; }
  function pickMap(id) { const ids = mapIds(); return id === 'random' || ids.indexOf(id) < 0 ? ids[Math.floor(Math.random() * ids.length)] : id; }

  /* へやの せってい（人数・つよさ・ルール・マップ）を 正しい形に */
  function cleanOpts(o) {
    o = o && typeof o === 'object' ? o : {};
    return {
      n: clampN(o.n || 8), lv: LV_NAME[o.lv] ? o.lv : 'mix', rule: RULES[o.rule] ? o.rule : 'k5',
      map: o.map === 'random' || mapIds().indexOf(o.map) >= 0 ? o.map : 'random'
    };
  }
  function describe(o) {
    o = cleanOpts(o);
    return o.n + '人 ・ ' + RULES[o.rule].name + ' ・ あいて ' + LV_NAME[o.lv] + ' ・ マップ ' + mapName(o.map);
  }

  /* ======================================================================
     トーナメント表
     T = { n, size, lv, rule, map, me, online, people:[{name, lv, gun, bomb, me, hid}],
           rounds:[[{a, b, w, s}]], out, over, champ, counted, next }
     a・b・w は people の ばんごう。-1 = シード（あいて なし）、null = まだ きまっていない。
     hid = みんなで の ときの 人（へやの id）。me = ひとりで の ときの じぶん
     ====================================================================== */
  let T = null;
  let banner = null;          // 表の 上に出す ひとこと {text, cls}

  /* 2べき の 表の ならびかた（シード1 と 2 は けっしょうまで あたらない） */
  function seedOrder(size) {
    let o = [1];
    while (o.length < size) {
      const m = o.length * 2, next = [];
      for (const x of o) next.push(x, m + 1 - x);
      o = next;
    }
    return o;
  }

  /* humans = みんなで の 人 [{name, hid}]（なければ ひとりで: じぶん 1人） */
  function create(n, lv, rule, map, humans) {
    const online = Array.isArray(humans) && humans.length > 0;
    const hs = online ? humans : [{ name: String(CS.Settings.name || 'プレイヤー'), me: true }];
    n = Math.max(clampN(n), Math.min(MAX_N, hs.length));
    let size = 2;
    while (size < n) size *= 2;
    const taken = hs.map((h) => h.name);
    const names = shuffle(NAMES.filter((x) => taken.indexOf(x) < 0));
    const people = hs.map((h) => (h.me ? { name: h.name, me: true, lv: '', gun: CS.Settings.gun, bomb: CS.Settings.bomb } : { name: h.name, hid: h.hid, lv: '' }));
    for (let i = hs.length; i < n; i++) {
      const k = i - hs.length;
      const nm = names[k % names.length] + (k >= names.length ? String(Math.floor(k / names.length) + 1) : '');
      const L = lv === 'mix' ? LVS[Math.floor(Math.random() * LVS.length)] : lv;
      const lo = CS.Bots && CS.Bots.randomLoadout ? CS.Bots.randomLoadout(Math.random) : { gun: 'ar', bomb: 'frag' };
      people.push({ name: nm, lv: L, gun: lo.gun, bomb: lo.bomb });
    }
    /* シードは くじびき（人も） */
    const order = shuffle(people.map((_, i) => i));
    const pos = seedOrder(size);
    const r0 = [];
    for (let k = 0; k < size; k += 2) {
      const sa = pos[k], sb = pos[k + 1];
      r0.push({ a: sa <= n ? order[sa - 1] : -1, b: sb <= n ? order[sb - 1] : -1, w: null, s: '' });
    }
    const rounds = [r0];
    for (let m = size / 4; m >= 1; m /= 2) {
      const r = [];
      for (let i = 0; i < m; i++) r.push({ a: null, b: null, w: null, s: '' });
      rounds.push(r);
    }
    /* シード: あいてが いないので そのまま つぎへ */
    for (const m of r0) {
      if (m.a === -1) { m.w = m.b; m.s = 'シード'; }
      else if (m.b === -1) { m.w = m.a; m.s = 'シード'; }
    }
    T = { v: 1, n: n, size: size, lv: lv, rule: rule, map: map, me: online ? -1 : 0, online: online, people: people, rounds: rounds,
      out: -1, over: false, champ: -1, counted: false, next: null };
    propagate();
    banner = null;
    save();
  }

  function propagate() {
    for (let r = 1; r < T.rounds.length; r++) {
      const prev = T.rounds[r - 1];
      T.rounds[r].forEach((m, i) => {
        if (m.a === null && prev[2 * i].w !== null) m.a = prev[2 * i].w;
        if (m.b === null && prev[2 * i + 1].w !== null) m.b = prev[2 * i + 1].w;
      });
    }
    const fin = T.rounds[T.rounds.length - 1][0];
    if (fin.w !== null) { T.over = true; T.champ = fin.w; }
  }

  /* じぶんの ばんごう（みんなで は へやの id で さがす。いなければ -1） */
  function meIdx() {
    if (!T) return -1;
    if (!T.online) return T.me;
    const g = game(), id = g && g.myNetId;
    for (let i = 0; i < T.people.length; i++) if (T.people[i].hid && T.people[i].hid === id) return i;
    return -1;
  }
  const ready = (m) => m.w === null && m.a !== null && m.b !== null && m.a >= 0 && m.b >= 0;
  const mine = (m) => { const i = meIdx(); return i >= 0 && (m.a === i || m.b === i); };
  const isHuman = (i) => i >= 0 && !!(T.people[i] && (T.people[i].hid || T.people[i].me));

  /* コンピューターどうしの しあい: つよさで かちやすさが かわる */
  function simMatch(m) {
    const A = T.people[m.a], B = T.people[m.b];
    const pa = LV_POW[A.lv] || 1.8, pb = LV_POW[B.lv] || 1.8;
    const aWin = Math.random() < pa / (pa + pb);
    m.w = aWin ? m.a : m.b;
    const R = RULES[T.rule] || RULES.k5;
    const top = R.rule.id === 'stock' ? 1 + Math.floor(Math.random() * R.rule.n) : R.rule.n;
    const low = R.rule.id === 'stock' ? 0 : Math.floor(Math.random() * R.rule.n);
    m.s = aWin ? top + '-' + low : low + '-' + top;
  }
  function simRound(r, skip) {
    let did = 0;
    for (const m of T.rounds[r]) if (m !== skip && ready(m) && !mine(m)) { simMatch(m); did++; }
    propagate();
    return did;
  }

  /* じぶんの つぎの しあい（まけていたら null） */
  function myMatch() {
    if (T.out >= 0) return null;
    for (let r = 0; r < T.rounds.length; r++) {
      const row = T.rounds[r];
      for (let i = 0; i < row.length; i++) if (row[i].w === null && mine(row[i])) return { r: r, i: i, m: row[i] };
    }
    return null;
  }
  /* じぶんの しあいの あいてが きまるまで、まえの ラウンドの コンピューター戦を すすめる */
  function prepare() {
    for (let guard = 0; guard < 10; guard++) {
      const mm = myMatch();
      if (!mm || (mm.m.a !== null && mm.m.b !== null)) return;
      let did = 0;
      for (let r = 0; r < mm.r; r++) did += simRound(r, null);
      if (!did) return;
    }
  }
  /* まけたあと: のこりを 1ラウンドずつ */
  function nextRound() {
    for (let r = 0; r < T.rounds.length; r++) {
      if (T.rounds[r].some((m) => m.w === null)) { simRound(r, null); return; }
    }
  }

  function roundName(r) {
    const k = T.rounds.length - 1 - r;
    if (k === 0) return 'けっしょう';
    if (k === 1) return 'じゅんけっしょう';
    if (k === 2) return 'じゅんじゅんけっしょう';
    return (r + 1) + '回戦';
  }
  function winsToChamp(n) { let k = 0, s = 1; while (s < n) { s *= 2; k++; } return k; }

  /* ---- ほぞん（ひとりで だけ。とちゅうで やめても つづきから） ---- */
  function save() {
    if (!T || T.online) return;
    try { CS.Settings.tnSave = T; if (CS.saveSettings) CS.saveSettings(); } catch (e) {}
  }
  function load() {
    const s = CS.Settings.tnSave;
    if (!s || typeof s !== 'object' || s.v !== 1 || s.online || !Array.isArray(s.people) || !Array.isArray(s.rounds)) return null;
    if (!s.people.length || !s.rounds.length || !RULES[s.rule]) return null;
    for (const row of s.rounds) if (!Array.isArray(row)) return null;
    return s;
  }
  /* みんなで の 表が のこっていたら（へやを 出た）ひとりで の 表に もどす */
  function soloOnly() {
    const g = game();
    if (T && T.online && !(g && g.room && g.room.mode === 'tourney')) { T = load(); banner = null; }
  }

  /* ======================================================================
     ひとりで: じぶんの しあい
     ====================================================================== */
  function fight() {
    if (!T || T.online) return;
    prepare();
    const mm = myMatch();
    if (!mm || !ready(mm.m)) { render(); return; }
    const opp = T.people[mm.m.a === T.me ? mm.m.b : mm.m.a];
    const R = RULES[T.rule] || RULES.k5;
    U.util.call('cpu', { mode: '1v1', level: opp.lv, mapId: pickMap(T.map), enemyGun: opp.gun, enemyBomb: opp.bomb, rule: R.rule });
    const g = game();
    if (!g || g.mode !== 'match' || !g.cpu) return;
    g.cpu.tourney = { r: mm.r, i: mm.i };
    for (const p of g.players) if (p.team === 1 && p.clone < 0) p.name = opp.name;
    try { CS.UI.toast(roundName(mm.r) + '  あいて: ' + opp.name + '（' + LV_NAME[opp.lv] + '）'); } catch (e) {}
  }

  function onMatchResult(res) {
    const tr = res.cpu.tourney;
    const m = T && T.rounds[tr.r] && T.rounds[tr.r][tr.i];
    if (!m || m.w !== null || !mine(m)) { showBracket(); return; }
    const w = res.winner === undefined || res.winner === null ? -1 : res.winner;
    const my = res.myTeam | 0;
    const sc = res.score || [0, 0];
    if (w < 0) {
      banner = { text: 'ひきわけ… もういちど たたかおう', cls: '' };
    } else {
      const won = w === my;
      const oppIdx = m.a === T.me ? m.b : m.a;
      m.w = won ? T.me : oppIdx;
      const sMe = sc[my] | 0, sOp = sc[1 - my] | 0;
      m.s = m.a === T.me ? sMe + '-' + sOp : sOp + '-' + sMe;
      simRound(tr.r, m);                      // おなじ ラウンドの ほかの しあいも おわらせる
      if (!won) T.out = tr.r;
      if (won && T.over) banner = { text: 'ゆうしょう！ おめでとう！', cls: 'gold' };
      else if (won) banner = { text: roundName(tr.r) + ' かち！ つぎは ' + roundName(tr.r + 1), cls: 'win' };
      else banner = { text: roundName(tr.r) + ' で まけた… ' + T.people[oppIdx].name + ' の かち', cls: 'lose' };
      if (won && T.over && !T.counted) {
        T.counted = true;
        CS.Settings.tnWins = (CS.Settings.tnWins | 0) + 1;
      }
    }
    save();
    if (!res.danced) { try { CS.Audio.play(w < 0 ? 'ok' : w === my ? 'win' : 'lose'); } catch (e) {} }
    showBracket();
  }

  /* ======================================================================
     みんなで（へや）: 表は ホストが もつ。人が でる しあいを ひとつずつ はじめる
     ====================================================================== */
  const G = CS.Game && CS.Game.prototype;

  /* ホスト: コンピューターどうしを すすめて、つぎに 人が でる しあい（T.next）を きめる。
     へやを 出た 人は ふせんまけ */
  function hostAdvance(g) {
    const inRoom = (hid) => !!(g.room && g.room.players.some((p) => p.id === hid));
    for (let guard = 0; guard < 400; guard++) {
      let did = false;
      T.next = null;
      for (let r = 0; r < T.rounds.length && !T.next; r++) {
        const row = T.rounds[r];
        for (let i = 0; i < row.length; i++) {
          const m = row[i];
          if (!ready(m)) continue;
          const ha = isHuman(m.a), hb = isHuman(m.b);
          if (!ha && !hb) { simMatch(m); did = true; continue; }
          const ga = ha && !inRoom(T.people[m.a].hid), gb = hb && !inRoom(T.people[m.b].hid);
          if (ga || gb) { m.w = ga && !gb ? m.b : m.a; m.s = 'ふせん'; did = true; continue; }
          T.next = { r: r, i: i };
          break;
        }
      }
      propagate();
      if (T.next || !did || T.over) return;
    }
  }

  if (G) {
    /* ホスト: へやの 人で 表を 作って みんなへ（しあいは まだ） */
    G._tnStartCoop = function () {
      const room = this.room;
      if (!this.isHost || !room) return false;
      const o = cleanOpts(room.tourney);
      const humans = room.players.filter((p) => !p.bot).map((p) => ({ name: p.name, hid: p.id }));
      if (!humans.length) return false;
      create(o.n, o.lv, o.rule, o.map, humans);
      hostAdvance(this);
      room.started = true;
      this._tnSend();
      return true;
    };
    G._tnSend = function () { this._broadcast({ t: 'tn', s: T, b: banner }); };

    /* ホスト: つぎの しあいを はじめる（でない人は かんせん） */
    G._tnPlay = function () {
      const room = this.room;
      if (!this.isHost || !room || !T || !T.online || T.over || this.mode === 'match') return false;
      hostAdvance(this);
      if (!T.next) { this._tnSend(); return false; }
      const m = T.rounds[T.next.r][T.next.i];
      const rec = (hid) => room.players.find((p) => p.id === hid) || null;
      const players = [], spawns = [];
      const side = (idx, team) => {
        const P = T.people[idx], q = P.hid ? rec(P.hid) : null;
        if (q) players.push({ id: q.id, name: q.name, team: team, gun: q.gun, gun2: q.gun2 || '', gm: q.gm || '', gm2: q.gm2 || '', bomb: q.bomb, fc: q.fc || '', skin: q.skin || null });
        else {
          const skin = CS.Skins ? CS.Skins.random(Math.random, { teamColor: true, noPattern: true }) : null;
          players.push({ id: 'tc' + idx, name: P.name, team: team, gun: P.gun, gun2: '', bomb: P.bomb, skin: skin, bot: P.lv || 'normal' });
        }
        spawns.push(0);
      };
      side(m.a, 0);
      side(m.b, 1);
      let k = 1;
      for (const q of room.players) {
        if (q.bot || players.some((p) => p.id === q.id)) continue;
        players.push({ id: q.id, name: q.name, team: 0, gun: q.gun, gun2: q.gun2 || '', gm: q.gm || '', gm2: q.gm2 || '', bomb: q.bomb, fc: q.fc || '', skin: q.skin || null, spec: 1 });
        spawns.push(k++);
      }
      room.started = true;
      banner = null;
      this._broadcast({
        t: 'start', seed: (Math.random() * 0x7fffffff) | 0, map: pickMap(T.map), mode: '1v1', players: players, spawns: spawns,
        rule: (RULES[T.rule] || RULES.k5).rule, tn: { r: T.next.r, i: T.next.i }
      });
      return true;
    };

    /* ホスト: トーナメントを おわりに して へやの ロビーへ（みんな） */
    G._tnEnd = function () {
      if (!this.isHost || !this.room) return;
      T = load(); banner = null;
      this._broadcast({ t: 'tn', s: 0 });
      this.room.started = false;
      this._broadcastLobby();
    };

    /* みんなが受け取る: 表（s = 0 なら トーナメントおわり） */
    G._onTn = function (m) {
      if (!this.room || this.room.mode !== 'tourney') return;
      if (!m.s) {
        if (T && T.online) { T = load(); banner = null; }
        if (this.mode === 'lobby' && U) { U.show('scLobby'); const v = this.lobbyView(); if (v) U.renderLobby(v); }
        return;
      }
      if (!this.isHost) { const s = cleanState(m.s); if (!s) return; T = s; }
      banner = m.b && typeof m.b.text === 'string' ? { text: m.b.text.slice(0, 60), cls: String(m.b.cls || '').replace(/[^a-z]/g, '') } : null;
      /* しあい中・ダンス中は あとで（結果の かわりに 表を 出す） */
      if (this.mode === 'match' && (this.phase !== 'over' || this.dance)) return;
      showBracket();
    };
  }

  /* ゲスト: とどいた 表を たしかめる */
  function cleanState(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.people) || !Array.isArray(s.rounds)) return null;
    if (s.people.length < 1 || s.people.length > MAX_N || s.rounds.length < 1 || s.rounds.length > 7) return null;
    const n = s.people.length;
    const idx = (v, bye) => (v === null || v === undefined ? null : (Number.isInteger(v) && v >= (bye ? -1 : 0) && v < n ? v : null));
    const people = s.people.map((p) => ({
      name: String((p && p.name) || 'プレイヤー').slice(0, 12),
      hid: p && typeof p.hid === 'string' ? p.hid.slice(0, 64) : undefined,
      lv: p && LV_POW[p.lv] ? p.lv : '', gun: p && typeof p.gun === 'string' ? p.gun : '', bomb: p && typeof p.bomb === 'string' ? p.bomb : ''
    }));
    const rounds = [];
    for (const row of s.rounds) {
      if (!Array.isArray(row) || row.length > 32) return null;
      rounds.push(row.map((m) => ({ a: idx(m && m.a, true), b: idx(m && m.b, true), w: idx(m && m.w, false), s: String((m && m.s) || '').slice(0, 12) })));
    }
    const nx = s.next && Number.isInteger(s.next.r) && Number.isInteger(s.next.i) && rounds[s.next.r] && rounds[s.next.r][s.next.i] ? { r: s.next.r, i: s.next.i } : null;
    return {
      v: 1, online: true, n: n, size: s.size | 0, lv: LV_NAME[s.lv] ? s.lv : 'mix', rule: RULES[s.rule] ? s.rule : 'k5', map: s.map === 'random' || mapIds().indexOf(s.map) >= 0 ? s.map : 'random',
      me: -1, people: people, rounds: rounds, out: -1, over: !!s.over, champ: Number.isInteger(s.champ) && s.champ >= 0 && s.champ < n ? s.champ : -1, next: nx
    };
  }

  /* みんなで: しあいが おわった（ホストが 表に かいて、みんなを 表へ） */
  function onOnlineResult(res) {
    const g = game();
    const w = res.winner === undefined || res.winner === null ? -1 : res.winner;
    if (g && g.isHost && T && T.online) {
      const tr = res.tn;
      const m = T.rounds[tr.r] && T.rounds[tr.r][tr.i];
      if (m && ready(m)) {
        if (w < 0) banner = { text: 'ひきわけ… もういちど たたかおう', cls: '' };
        else {
          m.w = w === 0 ? m.a : m.b;
          const sc = res.score || [0, 0];
          m.s = (sc[0] | 0) + '-' + (sc[1] | 0);
          propagate();
          const wn = T.people[m.w].name;
          banner = T.over ? { text: wn + ' が ゆうしょう！', cls: 'gold' } : { text: roundName(tr.r) + '： ' + wn + ' の かち！', cls: 'win' };
        }
        hostAdvance(g);
      }
      g._tnSend();
      g.backToLobby();
      if (g.room) g.room.started = !T.over;
    }
    if (!res.danced) { try { CS.Audio.play('ok'); } catch (e) {} }
    showBracket();
  }

  /* ======================================================================
     画面
     ====================================================================== */
  let U = null;
  const sel = { n: 8, lv: 'mix', rule: 'k5', map: 'random' };

  const CSS = [
    '#tnCount{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;width:100%}',
    '#tnCount input{width:96px;height:52px;font-size:26px;font-weight:900;text-align:center;border-radius:12px;border:2px solid rgba(143,240,255,.45);background:rgba(8,14,28,.85);color:#fff}',
    '#tnCount .btn.pm{width:52px;min-width:52px;height:52px;font-size:24px;padding:0}',
    '#tnQuick{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;width:100%;margin-top:6px}',
    '#tnQuick .btn{min-width:56px;padding:6px 10px}',
    '#tnInfo{font-size:13px;color:#a9bddb;text-align:center;margin-top:6px}',
    '.tnSeg{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%}',
    '.tnSeg .btn{flex:1 1 110px;min-height:46px}',
    '.tnSeg .btn.sel,#tnQuick .btn.sel{border-color:#8ff0ff;box-shadow:0 0 0 2px rgba(143,240,255,.45)}',
    '#tnResume{display:none;width:100%;padding:10px 12px;border-radius:12px;background:rgba(255,210,61,.08);border:1px solid rgba(255,210,61,.35);font-size:13.5px;color:#ffe9a8}',
    '#tnResume.on{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}',
    '#tnHead{font-size:13px;color:#a9bddb;text-align:center}',
    '#tnBanner{display:none;font-size:clamp(18px,4.6vmin,28px);font-weight:900;text-align:center;letter-spacing:.04em}',
    '#tnBanner.on{display:block}',
    '#tnBanner.win{color:#8ff0ff}#tnBanner.lose{color:#ffb3c0}#tnBanner.gold{color:#ffd23d;text-shadow:0 0 18px rgba(255,210,61,.5)}',
    '#tnStatus{font-size:14px;text-align:center;color:#dfe8f7;line-height:1.6}',
    '#tnStatus b{color:#fff}#tnStatus em{font-style:normal;color:#ffd23d;font-weight:800}',
    '#tnBracket{position:relative;display:flex;gap:14px;width:100%;max-height:52vh;overflow:auto;padding:8px 4px 10px;border-radius:12px;background:rgba(4,8,18,.45);-webkit-overflow-scrolling:touch}',
    '.tnCol{display:flex;flex-direction:column;justify-content:space-around;gap:8px;min-width:150px;flex:0 0 auto}',
    '.tnCol h4{margin:0 0 2px;font-size:12px;color:#9fb4d4;text-align:center;letter-spacing:.06em}',
    '.tnM{border-radius:9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);overflow:hidden}',
    '.tnM.next{border-color:#ffd23d;box-shadow:0 0 0 2px rgba(255,210,61,.35)}',
    '.tnP{display:flex;align-items:center;gap:6px;padding:4px 8px;font-size:12.5px;min-height:24px;white-space:nowrap}',
    '.tnP + .tnP{border-top:1px solid rgba(255,255,255,.07)}',
    '.tnP .nm{flex:1;overflow:hidden;text-overflow:ellipsis}',
    '.tnP .lv{font-size:10px;padding:1px 5px;border-radius:6px;background:rgba(255,255,255,.08);color:#9fb4d4}',
    '.tnP .lv.hard{color:#ffb3c0}.tnP .lv.easy{color:#a8e6a0}.tnP .lv.hu{color:#8ff0ff}',
    '.tnP.win{color:#fff;font-weight:800}.tnP.lose{color:#6f7f99}.tnP.lose .nm{text-decoration:line-through}',
    '.tnP.bye{color:#56657d;font-style:italic}.tnP.tbd{color:#56657d}',
    '.tnP.me .nm{color:#ffd23d}',
    '.tnM .sc{font-size:10.5px;color:#9fb4d4;text-align:right;padding:0 8px 3px}',
    '#tnBtns{display:grid;gap:8px;width:100%}'
  ].join('\n');

  function buildScreens() {
    if ($('scTourney')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scTourney" class="screen"><div class="panel wide" style="max-width:720px">' +
      '<h2>トーナメント</h2>' +
      '<p class="lead">人数を いれると、その人数で できる <b>かちぬき戦</b>を つくるよ。足りない人数は コンピューター。' +
      'しあいは <b>1対1</b>。まけたら おわり、さいごまで かてば <b>ゆうしょう</b>！ 友達と <b>みんなで</b> も できる（8人まで）。</p>' +
      '<div id="tnResume"><span id="tnResumeText"></span><button id="btnTnResume" class="btn pink" type="button">つづける</button></div>' +
      '<h3>人数（じぶんも ふくめて ' + MIN_N + '〜' + MAX_N + '人）</h3>' +
      '<div id="tnCount"><button id="btnTnMinus" class="btn ghost pm" type="button">−</button>' +
      '<input id="inTnN" type="number" inputmode="numeric" min="' + MIN_N + '" max="' + MAX_N + '" step="1" value="8" aria-label="人数">' +
      '<button id="btnTnPlus" class="btn ghost pm" type="button">＋</button></div>' +
      '<div id="tnQuick"></div><div id="tnInfo"></div>' +
      '<h3>コンピューターの つよさ</h3><div id="tnLv" class="tnSeg"></div>' +
      '<h3>ルール（1対1）</h3><div id="tnRule" class="tnSeg"></div>' +
      '<h3>マップ</h3><div id="tnMap" class="tnSeg"></div>' +
      '<div class="cpuGears glass"><div class="cpuGear"><div class="gl"><small>じぶんの ぶき</small><span id="tnGearLabel"></span></div>' +
      '<button id="btnTnLoadout" class="btn ghost" type="button">ぶきをかえる</button></div></div>' +
      '<div id="tnMsg" class="msg"></div>' +
      '<div class="stack"><button id="btnTnMake" class="btn big pink" type="button">ひとりで トーナメント</button>' +
      '<button id="btnTnCoop" class="btn big" type="button">みんなで トーナメント<small>へやを作って コードを送ろう（8人まで）</small></button>' +
      '<button id="btnTnBack" class="btn ghost" type="button" data-back>もどる</button></div>' +
      '</div></section>' +
      '<section id="scTnBracket" class="screen"><div class="panel wide" style="max-width:980px">' +
      '<h2>トーナメント</h2><div id="tnHead"></div><div id="tnBanner"></div><div id="tnStatus"></div>' +
      '<div id="tnBracket"></div>' +
      '<div id="tnBtns"><button id="btnTnGo" class="btn big pink" type="button">たたかう！</button>' +
      '<button id="btnTnSkip" class="btn" type="button">けっかまで とばす</button>' +
      '<button id="btnTnAgain" class="btn" type="button">おなじ 人数で もういちど</button>' +
      '<button id="btnTnQuit" class="btn ghost" type="button">もどる</button></div>' +
      '</div></section>');
    U.addScreen('scTourney', refreshSetup);
    U.addScreen('scTnBracket', render);
    const tap = U.util.tap;
    tap('btnTnMinus', () => setN(sel.n - 1));
    tap('btnTnPlus', () => setN(sel.n + 1));
    const inp = $('inTnN');
    inp.addEventListener('change', () => setN(inp.value));
    inp.addEventListener('input', () => { const v = parseInt(inp.value, 10); if (v >= MIN_N && v <= MAX_N) { sel.n = v; info(); } });
    tap('btnTnLoadout', () => U.openLoadout('scTourney'));
    tap('btnTnBack', () => U.back('scTourney'), 'back');
    tap('btnTnResume', () => { T = load(); banner = null; if (T) showBracket(); else refreshSetup(); }, 'ok');
    const keep = () => {
      setN($('inTnN').value);
      CS.Settings.tnN = sel.n; CS.Settings.tnLv = sel.lv; CS.Settings.tnRule = sel.rule; CS.Settings.tnMap = sel.map;
      if (CS.saveSettings) CS.saveSettings();
    };
    tap('btnTnMake', () => {
      keep();
      create(sel.n, sel.lv, sel.rule, sel.map);
      showBracket();
    }, 'ok');
    /* v5.1: みんなで（へやを作る。せっていは いま えらんだもの） */
    tap('btnTnCoop', () => { keep(); U.util.call('create', 'tourney', null, null); }, 'ok');
    tap('btnTnGo', () => {
      if (!T) return;
      const g = game();
      if (T.online) { if (g && g.isHost && g._tnPlay) g._tnPlay(); return; }
      if (T.over) { banner = null; render(); return; }
      if (T.out >= 0) { nextRound(); banner = null; save(); render(); return; }
      fight();
    }, 'go');
    tap('btnTnSkip', () => {
      if (!T || T.online || T.out < 0) return;
      for (let g = 0; g < 10 && !T.over; g++) nextRound();
      banner = null; save(); render();
    });
    tap('btnTnAgain', () => {
      if (!T) return;
      const g = game();
      if (T.online) { if (g && g.isHost && g._tnStartCoop) { banner = null; g._tnStartCoop(); } return; }
      create(T.n, T.lv, T.rule, T.map);
      showBracket();
    }, 'ok');
    tap('btnTnQuit', () => {
      const g = game();
      if (T && T.online) {
        if (g && g.isHost) g._tnEnd();
        else U.util.call('leave');
        return;
      }
      if (g && g.mode === 'match') U.util.call('toTitle');
      else U.show('scTitle');
    }, 'back');

    /* タイトル画面の ボタン（町の スポットは これを おす） */
    const stack = document.querySelector('#scTitle .stack');
    if (stack && !$('btnTourney')) {
      const b = document.createElement('button');
      b.id = 'btnTourney'; b.type = 'button'; b.className = 'btn';
      b.innerHTML = 'トーナメント<small>人数を きめて かちぬき戦</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} U.open('scTourney', 'scTitle'); });
      /* クリスタルまもり の となりに ならべる */
      const df = $('btnDefense');
      if (df && df.parentNode && df.parentNode.classList.contains('row2') && df.parentNode.children.length < 2) df.parentNode.appendChild(b);
      else { const row = document.createElement('div'); row.className = 'row2'; row.appendChild(b); stack.appendChild(row); }
    }
  }

  function setN(v) {
    sel.n = clampN(v);
    const inp = $('inTnN');
    if (inp && String(inp.value) !== String(sel.n)) inp.value = sel.n;
    info();
  }
  function info() {
    const n = sel.n;
    let size = 2;
    while (size < n) size *= 2;
    const byes = size - n;
    const k = winsToChamp(n);
    const quick = $('tnQuick');
    if (quick) for (const b of quick.children) b.classList.toggle('sel', +b.getAttribute('data-n') === n);
    U.util.setText($('tnInfo'), n + '人 ・ ' + (byes ? 'シード ' + byes + '人（1回戦 おやすみ）・ ' : '') +
      (byes ? (k - 1) + '〜' + k : k) + '回 かてば ゆうしょう');
  }

  function segButtons(boxId, list, cur, onPick) {
    const box = $(boxId);
    box.innerHTML = '';
    for (const it of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (it.id === cur ? ' sel' : '');
      b.textContent = it.name;
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} onPick(it.id); refreshSetup(); });
      box.appendChild(b);
    }
  }

  function refreshSetup() {
    const S = CS.Settings;
    if (!sel._init) {
      sel._init = true;
      const o = cleanOpts({ n: S.tnN, lv: S.tnLv, rule: S.tnRule, map: S.tnMap });
      sel.n = o.n; sel.lv = o.lv; sel.rule = o.rule; sel.map = o.map;
    }
    const quick = $('tnQuick');
    if (!quick.children.length) {
      for (const n of [2, 4, 6, 8, 12, 16, 32, 64]) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn ghost sm'; b.textContent = n + '人';
        b.setAttribute('data-n', String(n));
        b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} setN(n); });
        quick.appendChild(b);
      }
    }
    setN(sel.n);
    segButtons('tnLv', ['mix', 'easy', 'normal', 'hard'].map((id) => ({ id: id, name: LV_NAME[id] })), sel.lv, (id) => { sel.lv = id; });
    segButtons('tnRule', Object.keys(RULES).map((id) => ({ id: id, name: RULES[id].name })), sel.rule, (id) => { sel.rule = id; });
    segButtons('tnMap', ['random'].concat(mapIds()).map((id) => ({ id: id, name: mapName(id) })), sel.map, (id) => { sel.map = id; });
    const g2 = S.gun2 && S.gun2 !== S.gun ? ' ／ ' + gunName(S.gun2) : '';
    U.util.setText($('tnGearLabel'), gunName(S.gun) + g2 + ' ＋ ' + bombName(S.bomb));
    /* つづき（ひとりで） */
    const saved = load();
    const box = $('tnResume');
    box.classList.toggle('on', !!saved);
    if (saved) {
      const t = saved;
      const st = t.over ? (t.champ === t.me ? 'ゆうしょう した' : 'おわった') : t.out >= 0 ? 'まけた あと' : 'とちゅう';
      U.util.setText($('tnResumeText'), 'つくった トーナメントが あります（' + t.n + '人・' + st + '）');
    }
    U.msg('tnMsg', (S.tnWins | 0) > 0 ? 'これまでの ゆうしょう: ' + (S.tnWins | 0) + '回' : '');
  }

  function showBracket() {
    if (U.current === 'scTnBracket') render();
    else U.show('scTnBracket');
  }

  function render() {
    soloOnly();
    if (!T) { T = load(); if (!T) { U.show('scTourney'); return; } }
    if (!T.online) prepare();
    const R = RULES[T.rule] || RULES.k5;
    const g = game();
    const host = !!(g && g.isHost);
    const myI = meIdx();
    U.util.setText($('tnHead'), (T.online ? 'みんなで ・ ' : '') + T.n + '人 ・ ' + R.name + ' ・ コンピューター ' + LV_NAME[T.lv] + ' ・ マップ ' + mapName(T.map));
    const bn = $('tnBanner');
    bn.className = banner ? 'on ' + (banner.cls || '') : '';
    bn.textContent = banner ? banner.text : '';

    const st = $('tnStatus');
    const go = $('btnTnGo'), skip = $('btnTnSkip'), again = $('btnTnAgain'), quit = $('btnTnQuit');
    let cur = null;
    if (T.online) {
      /* みんなで: つぎの しあいは ホストが はじめる */
      skip.style.display = 'none';
      U.util.setText(quit, host ? 'やめて へやの ロビーへ' : 'へやを 出る');
      if (T.over) {
        const c = T.people[T.champ];
        st.innerHTML = 'ゆうしょうは <b>' + esc(c ? c.name : '？') + '</b>' + (c && c.hid ? '' : '（コンピューター）') + (T.champ === myI && myI >= 0 ? ' <em>あなたです！</em>' : '');
        go.style.display = 'none';
        again.style.display = host ? '' : 'none';
        U.util.setText(again, 'おなじ メンバーで もういちど');
      } else {
        const nx = T.next && T.rounds[T.next.r] && T.rounds[T.next.r][T.next.i];
        cur = nx || null;
        const who = (i) => (i === null || i < 0 ? '？' : esc(T.people[i].name));
        st.innerHTML = nx ? 'つぎは <b>' + esc(roundName(T.next.r)) + '</b>：<b>' + who(nx.a) + '</b> vs <b>' + who(nx.b) + '</b>' +
          (mine(nx) ? ' <em>あなたの しあい！</em>' : ' ・ ほかの人は かんせん') : 'つぎの しあいを じゅんびしています…';
        go.style.display = '';
        go.disabled = !host || !nx;
        U.util.setText(go, host ? 'しあい開始！' : 'ホストが はじめるのを まっています');
        again.style.display = 'none';
      }
    } else {
      U.util.setText(quit, 'もどる');
      U.util.setText(again, 'おなじ 人数で もういちど');
      const mm = myMatch();
      cur = mm ? mm.m : null;
      if (T.over) {
        const c = T.people[T.champ];
        let wins = 0;
        for (const row of T.rounds) for (const m of row) if (m.w === T.me && m.s !== 'シード') wins++;
        st.innerHTML = c && c.me ? '<b>あなたが ゆうしょう！</b> ' + wins + '回 かちぬいた' :
          'ゆうしょうは <b>' + esc(c ? c.name : '？') + '</b>（' + esc(LV_NAME[c && c.lv] || '') + '）' + (T.out >= 0 ? '・ あなたは ' + esc(roundName(T.out)) + ' で まけた' : '');
        go.style.display = 'none';
        skip.style.display = 'none';
        again.style.display = '';
        if (c && c.me && !banner) { bn.className = 'on gold'; bn.textContent = 'ゆうしょう！'; }
      } else if (mm) {
        const oppI = mm.m.a === T.me ? mm.m.b : mm.m.a;
        const opp = oppI !== null && oppI >= 0 ? T.people[oppI] : null;
        st.innerHTML = 'つぎは <b>' + esc(roundName(mm.r)) + '</b>：あなた vs ' +
          (opp ? '<b>' + esc(opp.name) + '</b>（' + esc(LV_NAME[opp.lv]) + '・' + esc(gunName(opp.gun)) + '）' : '？');
        go.style.display = '';
        go.textContent = 'たたかう！';
        go.disabled = !opp;
        skip.style.display = 'none';
        again.style.display = 'none';
      } else {
        st.innerHTML = 'あなたは <b>' + esc(roundName(Math.max(0, T.out))) + '</b> で まけた… のこりの しあいを みよう';
        go.style.display = '';
        go.disabled = false;
        go.textContent = 'つぎの ラウンドを みる';
        skip.style.display = '';
        again.style.display = '';
      }
    }

    /* 表 */
    const box = $('tnBracket');
    box.innerHTML = '';
    let focus = null;
    T.rounds.forEach((row, r) => {
      const col = document.createElement('div');
      col.className = 'tnCol';
      const h = document.createElement('h4');
      h.textContent = roundName(r);
      col.appendChild(h);
      for (const m of row) {
        const el = document.createElement('div');
        el.className = 'tnM' + (m === cur ? ' next' : '');
        el.appendChild(personRow(m, m.a, myI));
        el.appendChild(personRow(m, m.b, myI));
        if (m.s && m.s !== 'シード') { const sc = document.createElement('div'); sc.className = 'sc'; sc.textContent = m.s; el.appendChild(sc); }
        col.appendChild(el);
        if (m === cur) focus = el;
      }
      box.appendChild(col);
    });
    /* つぎの しあいが 見えるように */
    if (focus) {
      box.scrollTop = Math.max(0, focus.offsetTop - box.clientHeight / 2 + focus.offsetHeight / 2);
      box.scrollLeft = Math.max(0, focus.offsetLeft - box.clientWidth / 2 + focus.offsetWidth / 2);
    } else if (T.over) {
      box.scrollLeft = box.scrollWidth;
    }
  }

  function personRow(m, idx, myI) {
    const d = document.createElement('div');
    if (idx === -1) { d.className = 'tnP bye'; d.innerHTML = '<span class="nm">（シード）</span>'; return d; }
    if (idx === null || idx === undefined) { d.className = 'tnP tbd'; d.innerHTML = '<span class="nm">？</span>'; return d; }
    const p = T.people[idx];
    let cls = 'tnP';
    if (m.w !== null && m.s !== 'シード') cls += m.w === idx ? ' win' : ' lose';
    if (idx === myI) cls += ' me';
    d.className = cls;
    const tag = idx === myI ? '<span class="lv hu">あなた</span>'
      : p.hid ? '<span class="lv hu">プレイヤー</span>'
      : '<span class="lv ' + esc(p.lv) + '">' + esc(LV_NAME[p.lv] || '') + '</span>';
    d.innerHTML = '<span class="nm">' + esc(p.name) + '</span>' + tag;
    return d;
  }

  function init() {
    U = CS.UI;
    buildScreens();
    /* 結果: トーナメントの しあい なら 表へ もどる */
    const orig = U.showResult;
    U.showResult = function (res) {
      if (res && res.tn && T && T.online) return onOnlineResult(res);
      if (res && res.cpu && res.cpu.tourney && T && !T.online) return onMatchResult(res);
      return orig.apply(U, arguments);
    };
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  CS.Tourney = {
    MIN_N: MIN_N, MAX_N: MAX_N, seedOrder: seedOrder, cleanOpts: cleanOpts, describe: describe,
    get state() { return T; }, create: create, fight: fight,
    /* みんなで トーナメントの とちゅう（へやに いる あいだ） */
    active: () => { const g = game(); return !!(T && T.online && g && g.room && g.room.mode === 'tourney'); }
  };
})();
