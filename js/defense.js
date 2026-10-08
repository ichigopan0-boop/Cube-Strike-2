/* ==========================================================================
   CUBE STRIKE — defense.js
   v5: みんなで クリスタルまもり（ひとりでも・へやで 4人まで）
   ・マップの まんなかに 大きな クリスタル。コンピューターが ウェーブで せめてきて クリスタルを こわしに来る。
   ・10ウェーブ まもりきったら 勝ち。クリスタルが こわれたら 負け。プレイヤーは やられても ふっかつする。
   ・てきは ホストが 動かす（みんなで塔のぼりと おなじ しくみ）。てきの 入れものは 8人ぶん（POOL）で、
     ウェーブごとに たおされた てきを「ふっかつ」させて つぎの てきに する（つよさ・HP は ホストだけが 知っていればよい）。
   ・クリスタルの HP は ホストが きめて 'tg' で みんなへ。ウェーブの じょうたいは 'hs'（df）と 'dfw' で。
   game.js からは: startDefense / _defStartCoop / _defSetup / _defTick / _defKill / _defStatus / _defApplyStatus /
     _defHud / _defBotView / _defEndInfo と CS.Defense を つかう。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  if (!CS || !CS.Game) return;
  const G = CS.Game.prototype;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v) => { v = +v; return isFinite(v) ? v : 0; };

  const WAVES = 10;          // ぜんぶで なんウェーブ
  const POOL = 8;            // いちどに いられる てきの 数（入れもの）
  const MAX_N = 4;           // プレイヤーは 4人まで
  const FIRST_BREAK = 5;     // さいしょの ウェーブまで（秒）
  const BREAK_T = 8;         // ウェーブと ウェーブの あいだ（秒）
  const SPAWN_GAP = 1.1;     // てきが 1人ずつ 出てくる あいだ（秒）
  const CRYSTAL_HP = 2000;
  const CRYSTAL_TAKE = 0.12; // クリスタルが うける ダメージの わりあい（大きくて 当てやすいので へらす）
  const HEAL_BREAK = 0.2;    // ウェーブを のりきるたびに クリスタルが なおる わりあい
  const PSEUDO_IDX = 99;     // コンピューターから見た クリスタル（ねらう あいての ばんごう）
  const DIFFS = {
    easy: { id: 'easy', name: 'かんたん', hp: 0.8, dmg: 0.4, crystal: 1.4, desc: 'てきが よわめ・クリスタルが かたい' },
    normal: { id: 'normal', name: 'ふつう', hp: 1, dmg: 0.75, crystal: 1, desc: 'ふつうの つよさ' },
    hard: { id: 'hard', name: 'むずかしい', hp: 1.25, dmg: 1.0, crystal: 0.8, desc: 'てきが タフ・クリスタルが もろい' }
  };
  const MAP_IDS = ['plaza', 'towers', 'depot', 'meadow'];
  const ENEMY_NAMES = ['ゴブ', 'スラ', 'ガイコ', 'コウモ', 'オーク', 'ミノ', 'ゾン', 'ワーム', 'ドク', 'ヤミ'];

  /* ウェーブ w（1〜）の てきの 数・つよさ（n = プレイヤーの 人数） */
  const waveCount = (w, n) => Math.round((3 + w) * (1 + 0.5 * (n - 1)));
  /* てきの かしこさ: むずかしさで「つよい」が 出はじめる ウェーブが ちがう */
  const LV_STEPS = { easy: [5, 99], normal: [4, 9], hard: [2, 6] };
  const waveLevel = (w, diff) => {
    const s = LV_STEPS[diff] || LV_STEPS.normal;
    return w <= s[0] ? 'easy' : w <= s[1] ? 'normal' : 'hard';
  };
  const waveHp = (w, n, D) => Math.round(CS.RULES.hp * D.hp * (1 + 0.1 * (w - 1)) * (1 + 0.25 * (n - 1)));
  const waveDmg = (w, D) => D.dmg * (1 + 0.05 * (w - 1));

  function diffOf(id) { return DIFFS[id] || DIFFS.normal; }
  function mapOk(id) { return MAP_IDS.indexOf(id) >= 0 ? id : 'plaza'; }
  function bestTable() {
    let b = CS.Settings.defBest;
    if (!b || typeof b !== 'object') b = CS.Settings.defBest = { easy: 0, normal: 0, hard: 0 };
    return b;
  }

  /* ======================================================================
     はじめる
     ====================================================================== */
  /* ひとりで（オフライン）。opt = {diff, map} */
  G.startDefense = function (opt) {
    opt = opt || {};
    if (!CS.Bots || typeof CS.Bots.create !== 'function') return false;
    this._teardown();
    this.isHost = true;
    this.myNetId = 'host';
    this.offline = true;
    const humans = [{ id: 'host', name: String(CS.Settings.name || 'プレイヤー'), gun: this._myGunId(), gun2: this._myGun2Id(), gm: this._myGm(), gm2: this._myGm2(), bomb: this._myBombId(), skin: this._mySkin(), fc: '' }];
    this._defStartWith(humans, diffOf(opt.diff).id, mapOk(opt.map), false);
    return true;
  };

  /* みんなで（へやの ホストが「スタート」） */
  G._defStartCoop = function () {
    if (!CS.Bots || !this.isHost || !this.room) return false;
    const r = this.room.defense || {};
    const humans = this.room.players.filter((p) => !p.bot).slice(0, MAX_N).map((p) => ({
      id: p.id, name: p.name, gun: p.gun, gun2: p.gun2 || '', gm: p.gm || '', gm2: p.gm2 || '', bomb: p.bomb, skin: p.skin || null, fc: p.fc || ''
    }));
    if (!humans.length) return false;
    this.offline = false;
    this._defStartWith(humans, diffOf(r.diff).id, mapOk(r.map), true);
    return true;
  };

  G._defStartWith = function (humans, diff, mapId, coop) {
    const seed = (Math.random() * 0x7fffffff) | 0;
    const rg = CS.rng((seed ^ 0x51ed27) >>> 0);
    const players = [], spawns = [], slot = [0, 0];
    const add = (pd) => { players.push(pd); spawns.push(slot[pd.team]++); };
    for (const h of humans) add({ id: h.id, name: h.name, team: 0, gun: h.gun, gun2: h.gun2 || '', gm: h.gm || '', gm2: h.gm2 || '', bomb: h.bomb, skin: h.skin || null, fc: h.fc || '' });
    for (let i = 0; i < POOL; i++) {
      const lo = CS.Bots.randomLoadout(rg);
      const skin = CS.Skins ? CS.Skins.random(rg, { teamColor: true, noPattern: true }) : null;
      add({ id: 'df' + i, name: ENEMY_NAMES[i % ENEMY_NAMES.length], team: 1, gun: lo.gun, bomb: lo.bomb, bot: 'easy', skin: skin });
    }
    this._broadcast({
      t: 'start', seed: seed, map: mapId, mode: 'defense', players: players, spawns: spawns,
      rule: { id: 'defense' }, def: { diff: diff, n: humans.length, coop: coop ? 1 : 0 }
    });
  };

  /* ======================================================================
     しあいの はじめ（みんな）: クリスタルと てきの じゅんび
     ====================================================================== */
  G._defSetup = function (d) {
    const D = diffOf(d && d.diff);
    const n = clamp((d && d.n) | 0, 1, MAX_N);
    const max = Math.round(CRYSTAL_HP * D.crystal * (1 + 0.35 * (n - 1)));
    this.defense = {
      diff: D.id, n: n, coop: !!(d && d.coop), waves: WAVES, wave: 0, state: 'break', t: FIRST_BREAK,
      toSpawn: 0, spawnT: 0, left: 0, kills: 0, max: max, over: false, best0: bestTable()[D.id] | 0
    };
    const c = this._defCrystalPos();
    this.targets.length = 0;
    this.targets.push({
      base: c.slice(), pos: c.slice(), slide: 0, phase: 0, speed: 0,
      hp: max, max: max, dead: false, respawnAt: 0, hitT: 0, noRespawn: true,
      color: [0.45, 0.95, 1.0], size: 1.7, half: 0.85, crystal: true, take: CRYSTAL_TAKE
    });
    /* てきは まだ いない（ウェーブで ホストが 出す） */
    for (const p of this.players) if (p.team === 1) { p.alive = false; p.hp = 0; p.respawnAt = 0; }
    this._defPseudo = { idx: PSEUDO_IDX, team: 0, pos: this.targets[0].pos, rpos: this.targets[0].pos, vel: [0, 0, 0], alive: true, protect: false, connected: true, hp: max };
  };

  /* クリスタルの 場所: マップの まんなかに いちばん近い 立てる所（みんな おなじ ボクセルから おなじ場所） */
  G._defCrystalPos = function () {
    const md = this.mapData, w = this.world;
    const W = md.W, H = md.H, D = md.D;
    const cx = Math.floor(W / 2), cz = Math.floor(D / 2);
    const solid = (x, y, z) => { const b = w.get(x, y, z); return b !== 0; };
    for (let r = 0; r <= 14; r++) {
      let best = null, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 2 || z < 2 || x >= W - 2 || z >= D - 2) continue;
          for (let y = 1; y < H - 3; y++) {
            if (solid(x, y - 1, z) && !solid(x, y, z) && !solid(x, y + 1, z) && !solid(x, y + 2, z)) {
              const dd = dx * dx + dz * dz + y * 0.01;
              if (dd < bd) { bd = dd; best = [x + 0.5, y + 1.05, z + 0.5]; }
              break;
            }
          }
        }
      }
      if (best) return best;
    }
    return [W / 2, 2, D / 2];
  };

  /* ======================================================================
     ホスト: ウェーブ
     ====================================================================== */
  G._defTick = function (dt) {
    const d = this.defense;
    if (!d || d.over || this.phase !== 'live') return;
    const cr = this.targets[0];
    if (!cr || cr.dead) { this._defFinish(false); return; }
    if (d.state === 'break') {
      d.t -= dt;
      if (d.t <= 0) this._defStartWave(d.wave + 1);
      return;
    }
    let alive = 0;
    for (const p of this.players) if (p.team === 1 && p.alive) alive++;
    d.left = d.toSpawn + alive;
    d.spawnT -= dt;
    if (d.toSpawn > 0 && d.spawnT <= 0 && alive < POOL) {
      if (this._defSpawnOne()) { d.toSpawn--; d.spawnT = SPAWN_GAP; }
      else d.spawnT = 0.5;
    }
    if (d.toSpawn <= 0 && alive === 0) {
      if (d.wave >= d.waves) { this._defFinish(true); return; }
      d.state = 'break'; d.t = BREAK_T;
      /* クリスタルが すこし なおる */
      const heal = Math.round(d.max * HEAL_BREAK);
      if (heal > 0 && !cr.dead) {
        cr.hp = Math.min(d.max, cr.hp + heal);
        this._broadcast({ t: 'tg', g: 0, hp: Math.round(cr.hp), d: 0 });
      }
      this._broadcast({ t: 'dfw', w: d.wave, c: 1 });
    }
  };

  G._defStartWave = function (w) {
    const d = this.defense;
    d.wave = w; d.state = 'wave';
    d.toSpawn = waveCount(w, d.n); d.spawnT = 0; d.left = d.toSpawn;
    this._broadcast({ t: 'dfw', w: w, c: 0 });
  };

  /* たおされて いない てきの 入れものを 1つ つかって 出す（つよさは この ウェーブの ぶん） */
  G._defSpawnOne = function () {
    const d = this.defense, D = diffOf(d.diff);
    let p = null;
    for (const q of this.players) if (q.team === 1 && !q.alive && q.connected && q.bot) { p = q; break; }
    if (!p) return false;
    const lv = waveLevel(d.wave, d.diff);
    if (p.bot.level !== lv && CS.Bots) {
      p.bot.level = lv;
      p.bot.brain = CS.Bots.create({ level: lv, idx: p.idx, team: p.team, rng: CS.rng(((d.wave * 7919) + p.idx * 131) >>> 0) });
    }
    p.maxHp = waveHp(d.wave, d.n, D);
    p.dmgMul = waveDmg(d.wave, D);
    this._hostRespawn(p);
    return true;
  };

  /* ホスト: だれかが たおれた（_hostApplyDamage から）。てきは ふっかつ しない */
  G._defKill = function (v, a) {
    if (!this.defense || v.team !== 1) return;
    v.respawnAt = 0;
    this.defense.kills++;
  };

  G._defFinish = function (win) {
    const d = this.defense;
    if (!d || d.over) return;
    d.over = true;
    this._sendEnd(win ? 0 : 1);
  };

  /* ======================================================================
     みんなへ: じょうたい（hs の なか）と ウェーブの しらせ
     ====================================================================== */
  const STATE_CODE = { break: 0, wave: 1 };
  G._defStatus = function (m) {
    const d = this.defense;
    if (!d) return;
    m.df = [d.wave, STATE_CODE[d.state] | 0, d.left | 0, Math.ceil(Math.max(0, d.t)), d.kills | 0];
  };
  G._defApplyStatus = function (a) {
    const d = this.defense;
    if (!d || !Array.isArray(a)) return;
    d.wave = clamp(a[0] | 0, 0, WAVES);
    d.state = (a[1] | 0) === 1 ? 'wave' : 'break';
    d.left = Math.max(0, a[2] | 0);
    d.t = Math.max(0, num(a[3]));
    d.kills = Math.max(0, a[4] | 0);
  };
  /* ウェーブ c = 0: はじまり / 1: のりきった */
  G._onDefWave = function (m) {
    const d = this.defense;
    if (!d || this.mode !== 'match') return;
    const w = clamp(m.w | 0, 0, WAVES);
    d.wave = w;
    if ((m.c | 0) === 0) {
      d.state = 'wave';
      CS.UI.hud.center('ウェーブ ' + w + (w >= WAVES ? '（さいご）' : '') + '！', w >= WAVES ? '#ffd23d' : '#ff9ac8', 1600);
      this._sfx('go');
    } else {
      d.state = 'break'; d.t = BREAK_T;
      CS.UI.hud.center('ウェーブ ' + w + ' クリア！ クリスタルが すこし なおった', '#8ff0c8', 1600);
      this._sfx('ok');
    }
  };

  /* ======================================================================
     HUD（塔のぼりの 上の おびを つかう）
     ====================================================================== */
  G._defHud = function (s) {
    const d = this.defense;
    if (!d) return;
    const cr = this.targets[0];
    let text;
    if (d.wave === 0) text = 'クリスタルを まもれ！ ' + Math.ceil(d.t) + '秒で てきが くる';
    else if (d.state === 'break') text = 'つぎの ウェーブまで ' + Math.ceil(d.t) + '秒';
    else text = 'てき のこり ' + d.left + ' ・ たおした ' + d.kills;
    s.tower = {
      label: 'ウェーブ ' + d.wave + '/' + d.waves, text: text,
      boss: cr ? { name: 'クリスタル', hp: cr.dead ? 0 : Math.max(1, cr.hp), max: cr.max } : null
    };
  };

  /* ======================================================================
     コンピューター（ホスト）: クリスタルへ むかって こわしに いく
     ====================================================================== */
  G._defBotView = function (p, v) {
    const cr = this.targets[0];
    if (!cr || cr.dead) return;
    const ps = this._defPseudo;
    ps.alive = true; ps.pos = cr.pos; ps.rpos = cr.pos; ps.hp = cr.hp;
    const L = this._defList || (this._defList = []);
    L.length = 0;
    for (let i = 0; i < this.players.length; i++) L.push(this.players[i]);
    L.push(ps);
    v.players = L;
    /* はんぶんは クリスタル いちばん。のこりは クリスタルへ むかいながら、見つけた プレイヤーとも たたかう */
    if (p.idx % 2 === 0) v.prio = PSEUDO_IDX;
    v.chase = cr.pos;
    v.avoidSpawn = false;
  };

  /* しあいの おわりに 出す じょうほう（_onEnd から） */
  G._defEndInfo = function (w) {
    const d = this.defense;
    if (!d) return null;
    const win = w === 0;
    const reached = win ? d.waves : Math.max(0, d.wave - 1);
    const best = bestTable();
    const newBest = reached > (best[d.diff] | 0);
    if (newBest) { best[d.diff] = reached; if (CS.saveSettings) CS.saveSettings(); }
    let myKills = 0;
    const me = this.players[this.me];
    if (me) myKills = me.kills | 0;
    return {
      win: win, wave: win ? d.waves : d.wave, waves: d.waves, reached: reached, diff: d.diff, diffName: diffOf(d.diff).name,
      kills: d.kills, myKills: myKills, coop: d.coop, isHost: this.isHost, best: Math.max(best[d.diff] | 0, reached), newBest: newBest,
      names: this.players.filter((p) => p.team === 0 && !(p.clone >= 0)).map((p) => p.name)
    };
  };

  /* ======================================================================
     画面: クリスタルまもり（はじめる）・けっか
     ====================================================================== */
  let U = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  const CSS = [
    '#dfDiff,#dfMap{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;width:100%}',
    '#dfDiff .btn,#dfMap .btn{flex:1 1 150px;min-height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}',
    '#dfDiff .btn small,#dfMap .btn small{font-size:11px;color:#9fb4d4}',
    '#dfDiff .btn.sel,#dfMap .btn.sel{border-color:#8ff0ff;box-shadow:0 0 0 2px rgba(143,240,255,.45)}',
    '.dfRow{display:flex;justify-content:space-between;gap:12px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.04);font-size:14px}',
    '.dfRow b{color:#fff}',
    '#dfStats{display:grid;gap:6px;width:100%;max-width:420px}',
    '#dfTitle{font-size:clamp(30px,7vmin,54px);font-weight:900;letter-spacing:.08em}',
    '#dfTitle small{display:block;font-size:14px;letter-spacing:.06em;margin-top:4px}',
    'body[data-rule=defense] #teamScore,body[data-rule=defense] #timer{display:none}'
  ].join('\n');

  function buildScreens() {
    if ($('scDefense')) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('beforeend',
      '<section id="scDefense" class="screen"><div class="panel wide" style="max-width:720px">' +
      '<h2>クリスタルまもり</h2>' +
      '<p class="lead">まんなかの <b>クリスタル</b>を コンピューターの てきから まもろう！ ' + WAVES + 'ウェーブ まもりきったら 勝ち。<br>' +
      'ひとりでも、友達と <b>4人まで</b> いっしょでも あそべる（人数が 多いほど てきも ふえる）。</p>' +
      '<h3>むずかしさ</h3><div id="dfDiff"></div>' +
      '<h3>マップ</h3><div id="dfMap"></div>' +
      '<div class="stack">' +
      '<button id="btnDfSolo" class="btn big pink" type="button">ひとりで まもる</button>' +
      '<button id="btnDfCoop" class="btn big" type="button">みんなで まもる<small>へやを作って コードを送ろう（4人まで）</small></button>' +
      '<button id="btnDfBack" class="btn ghost" type="button" data-back>もどる</button>' +
      '</div></div></section>' +
      '<section id="scDefResult" class="screen"><div class="panel" style="max-width:560px">' +
      '<div id="dfTitle"></div><div id="dfStats"></div><div id="dfMsg" class="msg"></div>' +
      '<div class="stack"><button id="btnDfAgain" class="btn big pink" type="button">もう一回</button>' +
      '<button id="btnDfHome" class="btn ghost" type="button">町へ</button></div>' +
      '</div></section>');
    U.addScreen('scDefense', refresh);
    U.addScreen('scDefResult', null);
    const tap = (id, fn, snd) => { const el = $(id); if (el) el.addEventListener('click', () => { try { CS.Audio.play(snd || 'click'); } catch (e) {} fn(); }); };
    tap('btnDfSolo', () => U.util.call('defense', { diff: CS.Settings.defDiff, map: CS.Settings.defMap }), 'ok');
    tap('btnDfCoop', () => U.util.call('create', 'defense', CS.Settings.defMap, null), 'ok');
    tap('btnDfBack', () => U.show('scTitle'), 'back');
    tap('btnDfAgain', () => {
      const g = CS.debug && CS.debug.game;
      if (lastRes && lastRes.coop) { U.util.call('again'); return; }
      U.util.call('defense', { diff: lastRes ? lastRes.diff : CS.Settings.defDiff, map: CS.Settings.defMap });
      void g;
    }, 'ok');
    tap('btnDfHome', () => {
      const g = CS.debug && CS.debug.game;
      if (g) { try { g.quit(); } catch (e) {} }
      U.show('scTitle');
    }, 'back');
    /* タイトル画面の ボタン（町の スポットは これを おす） */
    const stack = document.querySelector('#scTitle .stack');
    if (stack && !$('btnDefense')) {
      const b = document.createElement('button');
      b.id = 'btnDefense'; b.type = 'button'; b.className = 'btn';
      b.innerHTML = 'クリスタルまもり<small>みんなで ' + WAVES + 'ウェーブ まもる</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} U.show('scDefense'); });
      const row = document.createElement('div');
      row.className = 'row2';
      row.appendChild(b);
      stack.appendChild(row);
    }
  }

  function refresh() {
    const S = CS.Settings, best = bestTable();
    if (!DIFFS[S.defDiff]) S.defDiff = 'normal';
    S.defMap = mapOk(S.defMap);
    const dg = $('dfDiff');
    dg.innerHTML = '';
    for (const id of ['easy', 'normal', 'hard']) {
      const D = DIFFS[id];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (S.defDiff === id ? ' sel' : '');
      const bw = best[id] | 0;
      b.innerHTML = '<b>' + esc(D.name) + '</b><small>' + (bw >= WAVES ? 'まもりきった！' : bw ? 'さいこう ウェーブ' + bw : esc(D.desc)) + '</small>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} S.defDiff = id; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      dg.appendChild(b);
    }
    const mg = $('dfMap');
    mg.innerHTML = '';
    for (const id of MAP_IDS) {
      const def = CS.Maps.get(id);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn' + (S.defMap === id ? ' sel' : '');
      b.innerHTML = '<b>' + esc(def ? def.name : id) + '</b>';
      b.addEventListener('click', () => { try { CS.Audio.play('click'); } catch (e) {} S.defMap = id; if (CS.saveSettings) CS.saveSettings(); refresh(); });
      mg.appendChild(b);
    }
  }

  let lastRes = null;
  function showResult(res) {
    const r = res.defense;
    lastRes = r;
    const t = $('dfTitle');
    t.style.color = r.win ? '#ffd23d' : '#ffb3c0';
    t.innerHTML = (r.win ? 'CLEAR!' : 'GAME OVER') + '<small>' + (r.win ? 'クリスタルを まもりきった！（' + esc(r.diffName) + '）' : 'ウェーブ ' + r.wave + ' で クリスタルが こわされた…') + '</small>';
    const rows = [
      ['むずかしさ', r.diffName + (r.coop ? '（みんなで ' + r.names.length + '人）' : '')],
      ['のりきった ウェーブ', r.reached + ' / ' + r.waves],
      ['さいこう記録', (r.best >= r.waves ? 'まもりきった' : 'ウェーブ' + r.best) + (r.newBest ? '  きろくこうしん！' : '')],
      [r.coop ? 'みんなで たおした数' : 'たおした数', String(r.kills)]
    ];
    if (r.coop) rows.splice(1, 0, ['なかま', r.names.join('・')]);
    $('dfStats').innerHTML = rows.map((x) => '<div class="dfRow"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('');
    const again = $('btnDfAgain'), home = $('btnDfHome');
    if (r.coop) {
      again.style.display = r.isHost ? '' : 'none';
      again.textContent = 'ロビーへ（もう一回）';
      home.textContent = 'へやを出て 町へ';
      U.msg('dfMsg', r.isHost ? '「ロビーへ」で みんな ロビーに もどって もう一回 あそべるよ' : 'ホストが ロビーに もどると いっしょに もどります');
    } else {
      again.style.display = '';
      again.textContent = 'もう一回';
      home.textContent = '町へ';
      U.msg('dfMsg', r.win ? 'おめでとう！ つぎは もっと むずかしく してみよう' : 'クリスタルの そばで まちぶせすると まもりやすいよ');
    }
    U.show('scDefResult');
    try { CS.Audio.play(r.win ? 'win' : 'lose'); } catch (e) {}
  }

  function init() {
    U = CS.UI;
    buildScreens();
    /* 結果: クリスタルまもり なら こちらの 画面 */
    const orig = U.showResult;
    U.showResult = function (res) {
      if (res && res.defense) return showResult(res);
      return orig.apply(U, arguments);
    };
  }
  if (CS.UI && CS.UI.addInit) CS.UI.addInit(init);

  CS.Defense = { DIFFS: DIFFS, WAVES: WAVES, POOL: POOL, MAX_N: MAX_N, MAP_IDS: MAP_IDS, diffOf: diffOf, mapOk: mapOk };
})();
