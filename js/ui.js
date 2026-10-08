/* ==========================================================================
   CUBE STRIKE — ui.js
   画面（タイトル / へやを作る / コードで参加 / ぶきをえらぶ / ロビー /
   リザルト / あそびかた / せってい / メニュー / コンピューターと対戦 /
   ボタンの配置・大きさ）と HUD。
   HUD は毎フレーム呼ばれるので「値が変わったときだけ」DOM を書き換える。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};
  const D = document;
  const $ = (id) => D.getElementById(id);

  /* 要素が無くても落ちないための空オブジェクト */
  const NIL = {
    style: { setProperty: function () {}, removeProperty: function () {} },
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    dataset: {}, children: [], value: '', textContent: '', innerHTML: '', disabled: false, scrollTop: 0, offsetWidth: 0,
    appendChild: function (n) { return n; }, removeChild: function (n) { return n; }, insertBefore: function (n) { return n; },
    addEventListener: function () {}, removeEventListener: function () {}, setAttribute: function () {},
    removeAttribute: function () {}, getAttribute: function () { return null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    scrollIntoView: function () {}, focus: function () {}, blur: function () {}, select: function () {}
  };
  const pick = (id) => $(id) || NIL;
  const qs = (el, sel) => {
    if (el && typeof el.querySelector === 'function') { const r = el.querySelector(sel); if (r) return r; }
    return NIL;
  };
  const qsa = (el, sel) => {
    if (el && typeof el.querySelectorAll === 'function') { const r = el.querySelectorAll(sel); if (r) return Array.prototype.slice.call(r); }
    return [];
  };
  const mk = (tag, cls, text) => {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };
  const clear = (el) => { if (el && el !== NIL) { while (el.firstChild) el.removeChild(el.firstChild); } };
  const clamp = CS.clamp || ((v, a, b) => (v < a ? a : v > b ? b : v));

  /* ---------- 小物 ---------- */
  let H = {};                       // main.js から渡されるハンドラ
  function call(name) {
    const f = H && H[name];
    if (typeof f !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 1);
    try { return f.apply(null, args); } catch (e) { if (window.console) console.error('[UI] ' + name, e); }
    return undefined;
  }
  function sfx(name) {
    const A = CS.Audio;
    if (A && typeof A.play === 'function') { try { A.play(name); } catch (e) {} }
  }
  function audioWake() {
    const A = CS.Audio;
    if (A && typeof A.init === 'function') { try { A.init(); } catch (e) {} }
  }
  function on(el, ev, fn, opts) {
    if (el && typeof el.addEventListener === 'function') el.addEventListener(ev, fn, opts || false);
  }
  function tap(id, fn, sound) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', function (e) {
      audioWake();
      sfx(sound || 'click');
      fn(e);
    });
  }
  const isTouchDevice = () => {
    try {
      if ('ontouchstart' in window) return true;
      if (navigator.maxTouchPoints > 0) return true;
      if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;  // iPadOS
    } catch (e) {}
    return false;
  };

  /* ==========================================================================
     HUD
     ========================================================================== */
  const E = {};                     // HUD 要素キャッシュ
  const L = {};                     // 前回の値
  const HUD_IDS = ['hud', 'crosshair', 'charge', 'hitmark', 'hpBox', 'hpBar', 'hpNum',
    'ammoBox', 'ammoNum', 'ammoMag', 'reloadTrack', 'reloadBar', 'bombBox', 'bombName', 'bombPips',
    'bombCdTrack', 'bombCdBar', 'teamScore', 'score0', 'score1', 'timer', 'toWin', 'killfeed', 'ping',
    'dmgDirs', 'vignette', 'respawn', 'respawnNum', 'respawnBy', 'respawnSub', 'board', 'centerMsg', 'protect',
    'scope', 'tags', 'clickToPlay', 'netWarn', 'zoneLine', 'lifeBox', 'towerBar', 'twFloor', 'twText',
    'bossBar', 'bossName', 'bossFill', 'shotWait', 'weakTag', 'gunLine', 'bjLine'];

  let cached = false;
  function cacheHud() {
    if (cached) return;
    cached = true;
    for (let i = 0; i < HUD_IDS.length; i++) E[HUD_IDS[i]] = pick(HUD_IDS[i]);
    E.cT = qs(E.crosshair, '.ct'); E.cB = qs(E.crosshair, '.cb');
    E.cL = qs(E.crosshair, '.cl'); E.cR = qs(E.crosshair, '.cr');
    E.chargeBar = qs(E.charge, 'b');
    E.waitBar = qs(E.shotWait, 'b'); E.waitTxt = qs(E.shotWait, 'span');
    /* ダメージ方向の弧（使い回し） */
    arcs.length = 0;
    for (let i = 0; i < 8; i++) {
      const a = mk('div', 'darc');
      E.dmgDirs.appendChild(a);
      arcs.push(a);
    }
  }

  const arcs = [];
  let arcNext = 0;
  const feedRows = [];
  const tagPool = [];
  let hudOn = false, respawnOn = false, boardSig = '', boardOn = false;
  let centerTimer = 0, toastTimer = 0;

  function hudShow(v) {
    cacheHud();
    const want = !!v;
    E.hud.classList.toggle('on', want);
    if (D.body) D.body.classList.toggle('in-match', want);
    if (want === hudOn) return;
    hudOn = want;
    /* しあいの出入りで残りかすを消す */
    clearFeed();
    for (let i = 0; i < arcs.length; i++) arcs[i].classList.remove('on');
    hudBoard(false);
    hudTags(null);
    hudRespawn(-1);
    hudCenter('');
    hudClickToPlay(false);
    if (!want) {
      /* しあいが終わったらメニューはオンライン用の表示にもどす（オフラインは次に始めるとき game が教える） */
      setMenuMode('online');
      setPractice(false);
      E.hud.classList.remove('scoped');
      E.scope.classList.remove('on');
      E.protect.classList.remove('on');
      E.netWarn.classList.remove('on');
      E.charge.classList.remove('on');
      E.shotWait.className = '';
      E.weakTag.classList.remove('on');
    }
    for (const k in L) delete L[k];
  }

  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /* 毎フレーム呼ばれる。変化したところだけ書く。 */
  function hudUpdate(s) {
    if (!s) return;
    cacheHud();

    /* ---- じぶんのチーム色 ---- */
    if (s.myTeam !== undefined && s.myTeam !== L.myTeam) {
      L.myTeam = s.myTeam;
      const col = (CS.TEAM_CSS && CS.TEAM_CSS[s.myTeam]) || '#7fd6ff';
      if (D.body && D.body.style && D.body.style.setProperty) D.body.style.setProperty('--team', col);
      E.score0.classList.toggle('mine', s.myTeam === 0);
      E.score1.classList.toggle('mine', s.myTeam === 1);
    }

    /* ---- たいりょく ---- */
    if (s.hp !== undefined) {
      const maxHp = s.maxHp || (CS.RULES ? CS.RULES.hp : 100);
      const hp = Math.max(0, Math.round(s.hp));
      if (hp !== L.hp || maxHp !== L.maxHp) {
        L.hp = hp; L.maxHp = maxHp;
        E.hpNum.textContent = hp;
        E.hpBar.style.transform = 'scaleX(' + clamp(hp / maxHp, 0, 1).toFixed(3) + ')';
        const low = hp <= maxHp * 0.35;
        if (low !== L.low) { L.low = low; E.hpBox.classList.toggle('low', low); }
        const vg = hp < maxHp * 0.45 ? clamp((maxHp * 0.45 - hp) / (maxHp * 0.45), 0, 1) * 0.9 : 0;
        const vq = Math.round(vg * 20) / 20;
        if (vq !== L.vg) { L.vg = vq; E.vignette.style.opacity = vq; }
      }
    }

    /* ---- だんすう ---- */
    if (s.ammo !== undefined && s.ammo !== L.ammo) {
      L.ammo = s.ammo;
      E.ammoNum.textContent = s.ammo;
      const empty = s.ammo <= 0;
      if (empty !== L.empty) { L.empty = empty; E.ammoBox.classList.toggle('empty', empty); }
    }
    if (s.mag !== undefined && s.mag !== L.mag) {
      L.mag = s.mag;
      E.ammoMag.textContent = '/ ' + s.mag;
    }
    if (s.reload !== undefined) {
      const rl = s.reload;
      const rOn = rl >= 0;
      if (rOn !== L.rOn) { L.rOn = rOn; E.reloadTrack.classList.toggle('on', rOn); }
      if (rOn) {
        const q = Math.round(clamp(rl, 0, 1) * 40) / 40;
        if (q !== L.rq) { L.rq = q; E.reloadBar.style.transform = 'scaleX(' + q.toFixed(3) + ')'; }
      }
    }

    /* ---- ボム ---- */
    if (s.bombName !== undefined && s.bombName !== L.bombName) {
      L.bombName = s.bombName;
      E.bombName.textContent = s.bombName || 'ボム';
    }
    if (s.bombMax !== undefined && s.bombMax !== L.bombMax) {
      L.bombMax = s.bombMax;
      clear(E.bombPips);
      for (let i = 0; i < (s.bombMax | 0); i++) E.bombPips.appendChild(mk('i'));
      L.bombCharges = -1;
    }
    if (s.bombCharges !== undefined && s.bombCharges !== L.bombCharges) {
      L.bombCharges = s.bombCharges;
      const pips = E.bombPips.children || [];
      for (let i = 0; i < pips.length; i++) pips[i].className = i < s.bombCharges ? 'on' : '';
    }
    if (s.bombCd !== undefined) {
      const cdOn = s.bombCd > 0 && s.bombCd < 1;
      if (cdOn !== L.cdOn) { L.cdOn = cdOn; E.bombCdTrack.classList.toggle('on', cdOn); }
      if (cdOn) {
        const q = Math.round(clamp(s.bombCd, 0, 1) * 30) / 30;
        if (q !== L.cdq) { L.cdq = q; E.bombCdBar.style.transform = 'scaleX(' + q.toFixed(3) + ')'; }
      }
    }

    /* ---- v5.4: 大ジャンプ（OK / あと なん秒） ---- */
    if (s.bj !== undefined) {
      const bj = s.bj < 0 ? -1 : s.bj <= 0 ? 0 : Math.ceil(s.bj);
      if (bj !== L.bj) {
        L.bj = bj;
        E.bjLine.textContent = bj < 0 ? '' : bj === 0 ? '大ジャンプ OK（ジャンプ 2回）' : '大ジャンプ あと ' + bj + '秒';
        E.bjLine.classList.toggle('ok', bj === 0);
      }
    }

    /* ---- スコア・のこり時間 ---- */
    if (s.score) {
      if (s.score[0] !== L.sc0) { L.sc0 = s.score[0]; E.score0.textContent = s.score[0]; }
      if (s.score[1] !== L.sc1) { L.sc1 = s.score[1]; E.score1.textContent = s.score[1]; }
    }
    if (s.goal !== undefined && s.goal !== L.goal) {
      L.goal = s.goal;
      E.toWin.textContent = s.goal;
    }
    /* エリア（とっているチームの色） */
    if (s.zone !== undefined && s.zone !== L.zone) {
      L.zone = s.zone;
      E.zoneLine.textContent = s.zone || '';
      E.zoneLine.style.display = s.zone ? 'block' : 'none';
    }
    if (s.zoneTeam !== undefined && s.zoneTeam !== L.zoneTeam) {
      L.zoneTeam = s.zoneTeam;
      E.zoneLine.style.color = s.zoneTeam >= 0 ? ((CS.TEAM_CSS && CS.TEAM_CSS[s.zoneTeam]) || '') : '';
    }
    /* のこり（ストック・塔のぼり） */
    const life = s.tower ? s.tower.lives : (s.stock !== undefined ? s.stock : -1);
    if (life !== L.life) {
      L.life = life;
      E.lifeBox.textContent = life >= 0 ? 'のこり ' + life : '';
      E.lifeBox.style.display = life >= 0 ? 'block' : 'none';
      E.lifeBox.classList.toggle('low', life >= 0 && life <= 1);
    }
    /* 塔のぼり */
    const tw = s.tower || null;
    if (!!tw !== L.twOn) { L.twOn = !!tw; E.towerBar.classList.toggle('on', !!tw); }
    if (tw) {
      const ft = tw.label || (tw.floor + 'F');      // v5: クリスタルまもりは「ウェーブ 3/10」
      if (ft !== L.twF) { L.twF = ft; E.twFloor.textContent = ft; }
      if (tw.text !== L.twT) { L.twT = tw.text; E.twText.textContent = tw.text || ''; }
      const b = tw.boss;
      const bOn = !!(b && b.hp > 0);
      if (bOn !== L.bOn) { L.bOn = bOn; E.bossBar.classList.toggle('on', bOn); }
      if (bOn) {
        if (b.name !== L.bN) { L.bN = b.name; E.bossName.textContent = b.name; }
        const q = Math.round(clamp(b.hp / (b.max || 1), 0, 1) * 200) / 200;
        if (q !== L.bQ) { L.bQ = q; E.bossFill.style.transform = 'scaleX(' + q.toFixed(3) + ')'; }
      }
    }
    if (s.time !== undefined) {
      const t = Math.max(0, Math.floor(s.time));
      if (t !== L.time) {
        L.time = t;
        E.timer.textContent = fmtTime(t);
        const w = t <= 60;
        if (w !== L.tw) { L.tw = w; E.timer.classList.toggle('warn', w); }
      }
    }

    /* ---- ping ---- */
    if (s.ping !== undefined) {
      const p = Math.max(0, Math.round(s.ping));
      if (p !== L.ping) {
        L.ping = p;
        E.ping.textContent = p + 'ms';
        const cls = p > 180 ? 'bad' : p > 90 ? 'mid' : '';
        if (cls !== L.pingCls) {
          L.pingCls = cls;
          E.ping.className = cls;
        }
      }
    }
    if (s.netWarn !== undefined) {
      const w = !!s.netWarn;
      if (w !== L.netWarn) { L.netWarn = w; E.netWarn.classList.toggle('on', w); }
    }

    /* ---- 照準（ひろがりで開く） ---- */
    if (s.spread !== undefined) {
      const gap = Math.round(clamp(s.spread, 0, 140) + 3);
      if (gap !== L.gap) {
        L.gap = gap;
        E.cT.style.transform = 'translateY(' + (-gap) + 'px)';
        E.cB.style.transform = 'translateY(' + gap + 'px)';
        E.cL.style.transform = 'translateX(' + (-gap) + 'px)';
        E.cR.style.transform = 'translateX(' + gap + 'px)';
      }
    }

    /* ---- スコープ / むてき / チャージ ---- */
    if (s.scope !== undefined) {
      const sc = !!s.scope;
      if (sc !== L.scope) {
        L.scope = sc;
        E.scope.classList.toggle('on', sc);
        E.hud.classList.toggle('scoped', sc);
      }
    }
    if (s.protect !== undefined || s.protectT !== undefined) {
      /* むてき: protectT（のこり秒）があれば「むてき 5秒」のように数字も出す */
      const pt = +s.protectT;
      const pr = s.protect !== undefined ? !!s.protect : pt > 0;
      if (pr !== L.protect) { L.protect = pr; E.protect.classList.toggle('on', pr); }
      if (pr) {
        const n = pt > 0 ? Math.ceil(pt - 1e-3) : 0;
        if (n !== L.protN) { L.protN = n; E.protect.textContent = n > 0 ? 'むてき ' + n + '秒' : 'むてき'; }
      }
    }
    if (s.charge !== undefined) {
      const cOn = s.charge >= 0;
      if (cOn !== L.chOn) { L.chOn = cOn; E.charge.classList.toggle('on', cOn); }
      if (cOn) {
        const q = Math.round(clamp(s.charge, 0, 1) * 30) / 30;
        if (q !== L.chq) {
          L.chq = q;
          E.chargeBar.style.transform = 'scaleX(' + q.toFixed(3) + ')';
          const full = q >= 1;
          if (full !== L.chFull) { L.chFull = full; E.charge.classList.toggle('full', full); }
        }
      }
    }
    /* v5: いまの銃と もう1つの銃（s.gunNow / s.gunOther / s.swapKey。もう1つが なければ いまの銃だけ） */
    if (s.gunNow !== undefined) {
      const sig = s.gunNow + '|' + (s.gunOther || '') + '|' + (s.swapKey || '');
      if (sig !== L.gunSig) {
        L.gunSig = sig;
        clear(E.gunLine);
        E.gunLine.appendChild(mk('b', null, s.gunNow || ''));
        if (s.gunOther) E.gunLine.appendChild(mk('small', null, '　' + (s.swapKey || '') + ' → ' + s.gunOther));
      }
    }
    /* v5: こうげき力ダウン（よわよわボム）・そのほかの じょうたい（s.status = 文字。'' = かくす） */
    if (s.status !== undefined) {
      const st = s.status || '';
      if (st !== L.status) {
        L.status = st;
        E.weakTag.textContent = st;
        E.weakTag.classList.toggle('on', !!st);
      }
    }
    /* 1発ごとに待つ銃: 次に撃てるまで。wait = 0..1（-1 = かくす）、waitMode = 'cool'（つぎの弾）/ 'rel'（リロード）/ 'ok'（撃てる） */
    if (s.wait !== undefined) {
      const wOn = s.wait >= 0, mode = wOn ? (s.waitMode || 'cool') : '';
      const cls = wOn ? 'on ' + mode : '';
      if (cls !== L.wCls) {
        L.wCls = cls;
        E.shotWait.className = cls;
        E.waitTxt.textContent = mode === 'ok' ? 'OK！' : mode === 'rel' ? 'リロード' : '';
      }
      if (wOn) {
        const q = Math.round(clamp(s.wait, 0, 1) * 48) / 48;
        if (q !== L.wq) { L.wq = q; E.waitBar.style.transform = 'scaleX(' + q.toFixed(3) + ')'; }
      }
    }
  }

  /* 当たった合図 */
  function hudHit(headshot, kill) {
    cacheHud();
    const e = E.hitmark;
    e.className = '';
    void e.offsetWidth;                              // アニメをやり直す
    e.className = (headshot ? 'hs ' : '') + (kill ? 'kill ' : '') + 'on';
  }

  /* どっちから撃たれたか（relAngle: 0=正面, + が左） */
  function hudDamageFrom(relAngle) {
    cacheHud();
    const a = arcs[arcNext % (arcs.length || 1)];
    arcNext++;
    if (!a) return;
    const deg = -(relAngle || 0) * 180 / Math.PI;
    a.classList.remove('on');
    void a.offsetWidth;
    a.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
    a.classList.add('on');
  }

  /* キルログ（最大5行・5秒で消える） */
  function weaponName(w) {
    if (!w) return '';
    const s = String(w);
    if (s.indexOf('bomb:') === 0) {
      const b = CS.BombMap && CS.BombMap[s.slice(5)];
      return b ? b.name : 'ボム';
    }
    const g = CS.GunMap && CS.GunMap[s];
    return g ? (g.short || g.name) : s;
  }
  function clearFeed() {
    cacheHud();
    for (let i = 0; i < feedRows.length; i++) {
      const r = feedRows[i];
      clearTimeout(r._t1); clearTimeout(r._t2);
      if (r.parentNode) r.parentNode.removeChild(r);
    }
    feedRows.length = 0;
  }
  function dropFeed(row) {
    clearTimeout(row._t1); clearTimeout(row._t2);
    const i = feedRows.indexOf(row);
    if (i >= 0) feedRows.splice(i, 1);
    if (row.parentNode) row.parentNode.removeChild(row);
  }
  function hudFeed(o) {
    if (!o) return;
    cacheHud();
    const row = mk('div', 'kf' + (o.me ? ' me' : ''));
    const k = mk('span', 'kn k' + ((o.kTeam | 0) === 1 ? 1 : 0), o.killer || '—');
    const w = mk('span', 'kw', (o.headshot ? '★ ' : '') + (weaponName(o.weapon) || 'ばくはつ'));
    const v = mk('span', 'kn k' + ((o.vTeam | 0) === 1 ? 1 : 0), o.victim || '');
    row.appendChild(k); row.appendChild(w); row.appendChild(v);
    E.killfeed.appendChild(row);
    feedRows.push(row);
    const cap = feedCap(row);
    while (feedRows.length > cap) dropFeed(feedRows[0]);
    row._t1 = setTimeout(function () { row.classList.add('fade'); }, 5000);
    row._t2 = setTimeout(function () { dropFeed(row); }, 5600);
  }
  /* キルログの行数の上限。PC は 5。タッチでは右下のボタン（リロード・ボム）に
     かからない行数まで（スマホよこ持ちでふつう 2〜3、タブレットは 5）。
     古い行から消すので、新しい行はいつも見える。 */
  const FEED_MAX = 5, FEED_TOUCH_FALLBACK = 3, FEED_GAP = 4;
  function feedCap(row) {
    if (!D.body || !D.body.classList.contains('touch')) return FEED_MAX;
    let cap = FEED_TOUCH_FALLBACK;
    try {
      const ko = CS.Input && CS.Input.touchKeepOut ? CS.Input.touchKeepOut() : null;
      const rh = row && row.offsetHeight;
      const top = E.killfeed && E.killfeed.getBoundingClientRect ? E.killfeed.getBoundingClientRect().top : NaN;
      if (ko && rh > 0 && isFinite(top) && ko.y0 > top) {
        cap = Math.floor((ko.y0 - 6 - top + FEED_GAP) / (rh + FEED_GAP));
      }
    } catch (e) { cap = FEED_TOUCH_FALLBACK; }
    return Math.max(1, Math.min(FEED_MAX, cap));
  }

  /* ふっかつ表示。mode: ''（ふつう）/ 'out'（ストックがなくなった）/ 'watch'（なかまを見ている）/ 'over'（塔のぼりのゲームオーバー） */
  const RS_TEXT = {
    '': ['ふっかつまで', null],
    out: ['のこりが なくなった', '✕'],
    watch: ['のこりが なくなった', 'おうえん中'],
    over: ['のこりが なくなった…', 'GAME OVER'],
    spec: ['トーナメント', 'かんせん中']        // v5.1: この しあいに でていない人
  };
  function hudRespawn(sec, killerName, mode) {
    cacheHud();
    if (sec === undefined || sec === null || sec < 0) {
      if (respawnOn) { respawnOn = false; E.respawn.classList.remove('on'); E.hud.classList.remove('dead'); L.rsN = -1; L.rsBy = null; L.rsMode = null; }
      return;
    }
    if (!respawnOn) { respawnOn = true; E.respawn.classList.add('on'); E.hud.classList.add('dead'); }
    const md = RS_TEXT[mode] ? mode : '';
    if (md !== L.rsMode) {
      L.rsMode = md; L.rsN = -1; L.rsBy = null;
      E.respawn.className = 'on' + (md ? ' out ' + md : '');
      E.respawnSub.textContent = RS_TEXT[md][0];
    }
    if (md) {
      const txt = RS_TEXT[md][1];
      if (txt !== L.rsN) { L.rsN = txt; E.respawnNum.textContent = txt; }
      const by = md === 'watch' ? 'なかまを おうえんしよう！' : md === 'out' ? 'しあいが 終わるまで まってね' : md === 'spec' ? 'しあいを 見て おうえんしよう' : '';
      if (by !== L.rsBy) { L.rsBy = by; E.respawnBy.textContent = by; }
      return;
    }
    const n = Math.max(0, Math.ceil(sec));
    if (n !== L.rsN) { L.rsN = n; E.respawnNum.textContent = n; }
    const by = killerName || '';
    if (by !== L.rsBy) {
      L.rsBy = by;
      clear(E.respawnBy);
      if (by) {
        E.respawnBy.appendChild(mk('b', null, by));
        E.respawnBy.appendChild(D.createTextNode(' にやられた'));
      } else {
        E.respawnBy.textContent = 'やられた…';
      }
    }
  }

  /* 中央の大きな文字 */
  function hudCenter(text, color, ms) {
    cacheHud();
    const e = E.centerMsg;
    clearTimeout(centerTimer);
    if (!text) { e.classList.remove('on'); e.classList.remove('pop'); return; }
    e.textContent = text;
    e.style.color = color || '#eaf4ff';
    e.classList.remove('pop');
    void e.offsetWidth;
    e.classList.add('on');
    e.classList.add('pop');
    centerTimer = setTimeout(function () { e.classList.remove('on'); }, Math.max(200, ms || 1400));
  }

  /* スコア表 */
  function hudBoard(v, rows) {
    cacheHud();
    const want = !!v;
    if (want !== boardOn) { boardOn = want; E.board.classList.toggle('on', want); }
    if (!want) return;
    rows = rows || [];
    let sig = '', hasStock = false;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.stock !== undefined) hasStock = true;
      sig += r.name + '\u0001' + r.team + '\u0001' + r.kills + '\u0001' + r.deaths + '\u0001' + r.ping + '\u0001' + (r.me ? 1 : 0) + '\u0001' + (r.alive === false ? 0 : 1) + '\u0001' + r.stock + '\u0002';
    }
    if (sig === boardSig) return;
    boardSig = sig;
    clear(E.board);
    if (hasStock) { hudBoardStock(rows); return; }
    const grid = mk('div', 'bGrid');
    for (let t = 0; t < 2; t++) {
      const col = mk('div', 'bTeam t' + t);
      const mine = rows.filter((r) => (r.team | 0) === t);
      let kills = 0;
      for (const r of mine) kills += (r.kills | 0);
      const h = mk('h4');
      h.appendChild(mk('span', null, ((CS.TEAM_NAMES && CS.TEAM_NAMES[t]) || (t ? 'あお' : 'あか')) + 'チーム'));
      h.appendChild(mk('span', null, kills + 'キル'));
      col.appendChild(h);
      const table = mk('table');
      const tb = mk('tbody');
      table.appendChild(tb);
      const hr = mk('tr');
      hr.appendChild(mk('th', null, 'なまえ'));
      hr.appendChild(mk('th', null, 'キル'));
      hr.appendChild(mk('th', null, 'デス'));
      hr.appendChild(mk('th', null, 'ping'));
      tb.appendChild(hr);
      mine.sort((a, b) => (b.kills | 0) - (a.kills | 0));
      for (const r of mine) {
        const tr = mk('tr', (r.me ? 'me ' : '') + (r.alive === false ? 'dead' : ''));
        tr.appendChild(mk('td', null, r.name || '—'));
        tr.appendChild(mk('td', null, r.kills | 0));
        tr.appendChild(mk('td', null, r.deaths | 0));
        tr.appendChild(mk('td', null, r.ping === undefined || r.ping === null ? '—' : (r.ping | 0) + 'ms'));
        tb.appendChild(tr);
      }
      if (!mine.length) {
        const tr = mk('tr');
        const td = mk('td', null, '—');
        td.setAttribute('colspan', '4');
        tr.appendChild(td);
        tb.appendChild(tr);
      }
      col.appendChild(table);
      grid.appendChild(col);
    }
    E.board.appendChild(grid);
  }

  /* ストックのときのスコア表（ping のかわりに のこり） */
  function hudBoardStock(rows) {
    const grid = mk('div', 'bGrid');
    for (let t = 0; t < 2; t++) {
      const col = mk('div', 'bTeam t' + t);
      const mine = rows.filter((r) => (r.team | 0) === t);
      let left = 0;
      for (const r of mine) left += Math.max(0, r.stock | 0);
      const h = mk('h4');
      h.appendChild(mk('span', null, ((CS.TEAM_NAMES && CS.TEAM_NAMES[t]) || '') + 'チーム'));
      h.appendChild(mk('span', null, 'のこり' + left));
      col.appendChild(h);
      const table = mk('table'), tb = mk('tbody');
      table.appendChild(tb);
      const hr = mk('tr');
      for (const s of ['なまえ', 'のこり', 'キル', 'デス']) hr.appendChild(mk('th', null, s));
      tb.appendChild(hr);
      for (const r of mine) {
        const tr = mk('tr', (r.me ? 'me ' : '') + ((r.stock | 0) <= 0 ? 'dead' : ''));
        tr.appendChild(mk('td', null, r.name || '—'));
        tr.appendChild(mk('td', null, String(Math.max(0, r.stock | 0))));
        tr.appendChild(mk('td', null, r.kills | 0));
        tr.appendChild(mk('td', null, r.deaths | 0));
        tb.appendChild(tr);
      }
      col.appendChild(table);
      grid.appendChild(col);
    }
    E.board.appendChild(grid);
  }

  /* なまえタグ（DOM を使い回す） */
  function hudTags(list) {
    cacheHud();
    list = list || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      let n = tagPool[i];
      if (!n) {
        n = mk('div', 'ntag');
        n._cls = 'ntag'; n._txt = ''; n._op = -1; n._hid = false;
        E.tags.appendChild(n);
        tagPool.push(n);
      }
      const cls = 'ntag t' + ((t.team | 0) === 1 ? 1 : 0);
      if (cls !== n._cls) { n._cls = cls; n.className = cls; }
      const txt = t.text === undefined || t.text === null ? '' : String(t.text);
      if (txt !== n._txt) { n._txt = txt; n.textContent = txt; }
      n.style.transform = 'translate(' + Math.round(t.x || 0) + 'px,' + Math.round(t.y || 0) + 'px) translate(-50%,-110%)';
      const d = t.dist || 0;
      const op = Math.round(clamp(d > 24 ? 1 - (d - 24) / 26 : 1, 0.28, 1) * 10) / 10;
      if (op !== n._op) { n._op = op; n.style.opacity = op; }
      if (n._hid) { n._hid = false; n.style.display = ''; }
    }
    for (let i = list.length; i < tagPool.length; i++) {
      const n = tagPool[i];
      if (!n._hid) { n._hid = true; n.style.display = 'none'; }
    }
  }

  /* ためし撃ちモード（HUD の見た目とメニューの文言を変える）。ためし撃ちはいつもオフライン */
  let practiceOn = false, menuMode = 'online';
  function setPractice(v) {
    practiceOn = !!v;
    if (D.body) D.body.classList.toggle('practice', practiceOn);
    refreshMenu();
  }

  /* しあい中メニューの表示。'offline'（コンピューター戦・ためし撃ち）はゲームが止まるので「ポーズ中」、
     'online' は止まらないのでそう書く。game.js が しあいを始めるときに教えてくれる。 */
  function setMenuMode(m) {
    menuMode = m === 'offline' ? 'offline' : 'online';
    if (D.body) D.body.classList.toggle('offline', menuMode === 'offline');
    refreshMenu();
  }
  function setText(el, t) { if (el && el._m !== t) { el._m = t; el.textContent = t; } }

  /* いまのルール（HUD の見た目を変える: body[data-rule]）。'' = しあいではない */
  let ruleMode = '';
  function setRuleMode(id) {
    ruleMode = id || '';
    if (D.body) {
      if (ruleMode) D.body.setAttribute('data-rule', ruleMode);
      else D.body.removeAttribute('data-rule');
    }
    refreshMenu();
  }

  function refreshMenu() {
    const off = menuMode === 'offline' || practiceOn;
    setText(pick('menuTitle'), off ? 'ポーズ中' : 'メニュー');
    const hint = pick('menuHint');
    const ht = off ? 'off' : 'on';
    if (hint._m !== ht) {
      hint._m = ht;
      clear(hint);
      if (off) {
        hint.appendChild(mk('b', null, 'ゲームは止まっています'));
        hint.appendChild(D.createTextNode('　「つづける」で再開'));
      } else {
        hint.appendChild(D.createTextNode('オンライン対戦は止まりません。'));
      }
    }
    setText(pick('btnQuit'), practiceOn ? 'ためし撃ちをやめる' : ruleMode === 'tower' ? '塔のぼりを やめる' : off ? 'やめて町へ' : 'へやを出る');
    if (typeof extraMenu === 'function') extraMenu(ruleMode);
  }
  let extraMenu = null;          // ui-extra.js が 塔のぼりのチップ一覧を出す

  function hudClickToPlay(v) {
    cacheHud();
    const want = !!v;
    if (want === L.ctp) return;
    L.ctp = want;
    E.clickToPlay.classList.toggle('on', want);
  }

  const hud = {
    show: hudShow,
    update: hudUpdate,
    hit: hudHit,
    damageFrom: hudDamageFrom,
    feed: hudFeed,
    respawn: hudRespawn,
    center: hudCenter,
    board: hudBoard,
    tags: hudTags,
    clickToPlay: hudClickToPlay
  };

  /* ==========================================================================
     画面きりかえ
     ========================================================================== */
  const SCREENS = ['scTitle', 'scCreate', 'scJoin', 'scLoadout', 'scLobby', 'scResult', 'scHow', 'scSettings', 'scMenu',
    'scCpu', 'scLayout', 'scFriends', 'scChat', 'scTower', 'scTowerPick', 'scTowerResult', 'scSkin', 'scMaps', 'scEdMenu'];
  const backTo = {};
  let pendingCode = '';
  const showHooks = {};          // 画面を出したときに呼ぶ（ほかのファイルが addScreen で登録）
  const hideHooks = {};

  function show(id) {
    if (id === 'scTitle' && pendingCode) {          // ?code=XXXXXX で来た人はいきなり参加画面へ
      pendingCode = '';
      show('scJoin');
      return;
    }
    /* ボタン配置エディターは openLayout() からだけ開く（編集モードの準備がいるので） */
    if (id === 'scLayout' && !layout.open) { openLayout(); return; }
    /* エディターを開いたままほかの画面へ（しあいが終わった・メニューを閉じた など）→ 変更はすてて閉じる */
    if (layout.open && id !== 'scLayout') closeLayout(false);
    if (id === 'scJoin') pendingCode = '';
    const prev = UI.current;
    for (let i = 0; i < SCREENS.length; i++) {
      const el = $(SCREENS[i]);
      if (el) el.classList.toggle('on', SCREENS[i] === id);
    }
    UI.current = id || null;
    if (prev && prev !== id && hideHooks[prev]) { try { hideHooks[prev](); } catch (e) { if (window.console) console.error('[UI] hide ' + prev, e); } }
    if (!id) return;
    const el = $(id);
    if (el) { try { el.scrollTop = 0; } catch (e) {} }
    if (showHooks[id]) { try { showHooks[id](); } catch (e) { if (window.console) console.error('[UI] show ' + id, e); } }
    if (id === 'scCreate') { buildMaps(); buildRuleUI('create'); }
    if (id === 'scLoadout') buildLoadout();
    if (id === 'scCpu') refreshCpu();
    if (id === 'scSettings') refreshSettings();
    if (id === 'scJoin') {
      const inCode = pick('inCode');
      if (!inCode.value) msg('joinMsg', '');
      try { if (!CS.isTouch || !CS.isTouch()) inCode.focus(); } catch (e) {}
    }
  }
  function open(id, from) { backTo[id] = from; show(id); }
  function back(id) { show(backTo[id] || 'scTitle'); }

  function toast(text) {
    const e = pick('toast');
    e.textContent = text || '';
    e.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { e.classList.remove('on'); }, 2200);
  }
  function msg(id, text, warn) {
    const e = $(id);
    if (!e) return;
    const t = text || '';
    if (e._m !== t) { e._m = t; e.textContent = t; }
    e.classList.toggle('warn', !!warn);
  }

  /* ==========================================================================
     ぶきの表示まわり
     ========================================================================== */
  /* CS2: 銃の なかまは weapons2.js（def.group） */
  const GUN_GROUPS = (CS.Weapons && CS.Weapons.GROUPS) || [{ key: 'rifle', label: 'じゅう', note: '' }];
  const TYPE_TAG = { hitscan: 'そくちゃく', projectile: 'とびだま', beam: 'ビーム', flame: 'ほのお' };
  function typeTag(def) {
    if (def.solo) return 'スナイパー系';
    if (def.group === 'support') return 'サポート';
    if (def.type === 'projectile' && def.proj && def.proj.fast) return 'はやい弾';
    return TYPE_TAG[def.type] || 'じゅう';
  }
  const GUN_STATS = [['power', 'いりょく'], ['rate', 'れんしゃ'], ['range', 'しゃてい'], ['mobility', 'きどう'], ['ease', 'あつかいやすさ']];
  const BOMB_STATS = [['power', 'いりょく'], ['area', 'はんい'], ['cooldown', 'クールダウン'], ['ease', 'あつかいやすさ']];

  function groupOf(def) {
    if (def.group) return def.group;
    if ((def.pellets | 0) > 1) return 'shot';
    if (def.type && def.type !== 'hitscan') return 'sp';
    if ((def.dmg || 0) >= 45) return 'heavy';
    if ((def.rpm || 0) >= 700) return 'rapid';
    return 'rifle';
  }
  function statBars(def, table, cls) {
    const box = mk('div', 'stats');
    const st = def.stats || {};
    for (let i = 0; i < table.length; i++) {
      const v = clamp(Math.round(st[table[i][0]] || 0), 0, 5);
      box.appendChild(mk('em', null, table[i][1]));
      const bar = mk('div', 'sbar' + (cls ? ' ' + cls : ''));
      const b = mk('b');
      b.style.width = (v / 5 * 100) + '%';
      bar.appendChild(b);
      box.appendChild(bar);
    }
    return box;
  }
  /* 銃の横からの絵（view のボックスをそのまま並べる） */
  function gunSvg(def) {
    const bx = def.view;
    if (!bx || !bx.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rects = [];
    for (let i = 0; i < bx.length; i++) {
      const b = bx[i];
      if (!b || b.length < 6) continue;
      const x = -b[2] - b[5] / 2, y = -b[1] - b[4] / 2, w = Math.abs(b[5]), h = Math.abs(b[4]);
      /* カードの背景が暗いので、少し持ち上げて見えるようにする */
      const lift = (v, d) => Math.round(clamp((v === undefined ? d : v) * 1.35 + 0.12, 0, 1) * 255);
      const col = 'rgb(' + lift(b[6], 0.7) + ',' + lift(b[7], 0.75) + ',' + lift(b[8], 0.85) + ')';
      rects.push('<rect x="' + x.toFixed(3) + '" y="' + y.toFixed(3) + '" width="' + w.toFixed(3) + '" height="' + h.toFixed(3) +
        '" rx="0.012" fill="' + col + '" stroke="rgba(255,255,255,.22)" stroke-width="0.006"/>');
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x + w > x1) x1 = x + w; if (y + h > y1) y1 = y + h;
    }
    if (!rects.length || !isFinite(x0)) return null;
    const pad = 0.02;
    const vb = (x0 - pad).toFixed(3) + ' ' + (y0 - pad).toFixed(3) + ' ' + (x1 - x0 + pad * 2).toFixed(3) + ' ' + (y1 - y0 + pad * 2).toFixed(3);
    return '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + rects.join('') + '</svg>';
  }
  function bombSvg(def) {
    const c = def.color || [1, 0.4, 0.7];
    const col = 'rgb(' + Math.round(clamp(c[0], 0, 1) * 255) + ',' + Math.round(clamp(c[1], 0, 1) * 255) + ',' + Math.round(clamp(c[2], 0, 1) * 255) + ')';
    return '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<rect x="6" y="6" width="20" height="20" rx="5" fill="' + col + '" stroke="rgba(255,255,255,.35)" stroke-width="1.4"/>' +
      '<rect x="11" y="11" width="4" height="4" rx="1" fill="rgba(255,255,255,.8)"/>' +
      '<rect x="18" y="11" width="4" height="4" rx="1" fill="rgba(255,255,255,.8)"/></svg>';
  }
  function describe(def) {
    const W = CS.Weapons;
    if (W && typeof W.describe === 'function') {
      try { const t = W.describe(def); if (t) return String(t); } catch (e) {}
    }
    if (def.dmg !== undefined && def.mag !== undefined) return 'ダメージ' + def.dmg + ' / ' + def.mag + '発';
    return '';
  }

  /* v5: gun2 = サブの銃、slot = いま えらんでいる わく（0 = メイン / 1 = サブ）。CS2: gm / gm2 = 部品 */
  const sel = { gun: '', bomb: '', gun2: '', slot: 0, gm: '', gm2: '' };
  const cleanMods = (str, id) => (CS.Parts && id && id !== 'random' ? CS.Parts.clean(str || '', gunDef(id)) : '');
  const gunNodes = {}, bombNodes = {};
  let mapsBuilt = false, gunsBuilt = false, bombsBuilt = false, loadoutReturn = 'scTitle';
  /* だれのぶきをえらんでいるか: 'me'（じぶん）/ 'enemy'（てきのCPU）/ 'ally'（なかまのCPU）。
     CPU のときは「おまかせ（'random' = 1人ずつランダム）」も えらべる */
  let loadoutTarget = 'me';
  const RND = 'random';
  const CPU_KEYS = { enemy: ['cpuEnemyGun', 'cpuEnemyBomb'], ally: ['cpuAllyGun', 'cpuAllyBomb'] };

  function gunDef(id) { return (CS.GunMap && CS.GunMap[id]) || (CS.Guns && CS.Guns[0]) || null; }
  function bombDef(id) { return (CS.BombMap && CS.BombMap[id]) || (CS.Bombs && CS.Bombs[0]) || null; }
  /* 保存されていた id が今の武器表に無いときは先頭に直す */
  function validGun(id) {
    if (CS.GunMap && CS.GunMap[id]) return id;
    if (CS.Guns && CS.Guns.length) return CS.Guns[0].id;
    return id;
  }
  function validBomb(id) {
    if (CS.BombMap && CS.BombMap[id]) return id;
    if (CS.Bombs && CS.Bombs.length) return CS.Bombs[0].id;
    return id;
  }

  function buildLoadout() {
    const guns = (CS.Guns && CS.Guns.length) ? CS.Guns : null;
    const bombs = (CS.Bombs && CS.Bombs.length) ? CS.Bombs : null;
    const gg = pick('gunGrid'), bg = pick('bombGrid');

    if (guns && !gunsBuilt) {
      gunsBuilt = true;
      clear(gg);
      /* おまかせ（CPU のぶきをえらぶときだけ見える） */
      const rs = mk('div', 'grp rndOnly');
      const rh = mk('h3', null, 'おまかせ');
      rh.appendChild(mk('span', null, 'CPUが 1人ずつ ちがう銃を持つ'));
      rs.appendChild(rh);
      const rg = mk('div', 'cgrid');
      rg.appendChild(randomCard('gun'));
      rs.appendChild(rg);
      gg.appendChild(rs);
      for (let gi = 0; gi < GUN_GROUPS.length; gi++) {
        const grp = GUN_GROUPS[gi];
        const list = guns.filter((d) => groupOf(d) === grp.key);
        if (!list.length) continue;
        const sec = mk('div', 'grp');
        const h = mk('h3', null, grp.label);
        h.appendChild(mk('span', null, grp.note));
        sec.appendChild(h);
        const grid = mk('div', 'cgrid');
        for (let i = 0; i < list.length; i++) grid.appendChild(gunCard(list[i]));
        sec.appendChild(grid);
        gg.appendChild(sec);
      }
    } else if (!guns && !gunsBuilt) {
      clear(gg);
      gg.appendChild(mk('div', 'hint', 'ぶきデータを読み込んでいます…'));
    }

    if (bombs && !bombsBuilt) {
      bombsBuilt = true;
      clear(bg);
      bg.appendChild(randomCard('bomb'));
      for (let i = 0; i < bombs.length; i++) bg.appendChild(bombCard(bombs[i]));
    } else if (!bombs && !bombsBuilt) {
      clear(bg);
      bg.appendChild(mk('div', 'hint', 'ボムデータを読み込んでいます…'));
    }
    refreshLoadoutSel();
  }

  function gunCard(def) {
    const card = mk('button', 'wcard');
    card.type = 'button';
    card.setAttribute('data-gun', def.id);
    const top = mk('div', 'top');
    const svg = gunSvg(def);
    if (svg) { const holder = mk('span'); holder.innerHTML = svg; top.appendChild(holder); }
    top.appendChild(mk('span', 'tag', typeTag(def)));
    card.appendChild(top);
    card.appendChild(mk('span', 'wn', def.name || def.id));
    card.appendChild(mk('span', 'wd', def.desc || ''));
    card.appendChild(mk('span', 'ws', describe(def)));
    card.appendChild(statBars(def, GUN_STATS));
    gunNodes[def.id] = card;
    card.addEventListener('click', function () {
      audioWake(); sfx('click');
      /* v5: じぶんの ぶき: 「サブ」の わくを えらんでいれば サブに。
         CS2: おなじ銃を 2つ もてる。スナイパー系（solo）を もつと 2つめは もてない。部品は つけられる ものだけ のこす */
      if (loadoutTarget !== 'me') sel.gun = def.id;
      else if (sel.slot === 1) {
        const main = gunDef(sel.gun);
        if (def.solo) {
          sel.gun = def.id; sel.gm = cleanMods(sel.gm, def.id); sel.gun2 = ''; sel.gm2 = ''; sel.slot = 0;
          toast('スナイパー系は 1つだけ。メインに して サブを はずしたよ');
        } else if (main && main.solo) {
          toast('スナイパー系を もっているので 2つめの 銃は もてないよ');
        } else { sel.gun2 = def.id; sel.gm2 = cleanMods(sel.gm2, def.id); }
      } else {
        sel.gun = def.id; sel.gm = cleanMods(sel.gm, def.id);
        if (def.solo && sel.gun2) { sel.gun2 = ''; sel.gm2 = ''; toast('スナイパー系なので サブの 銃は はずしたよ'); }
      }
      refreshLoadoutSel();
    });
    return card;
  }

  /* v5: メイン・サブの わく */
  function setSlot(s) {
    sel.slot = s === 1 ? 1 : 0;
    refreshLoadoutSel();
  }

  function bombCard(def) {
    const card = mk('button', 'wcard');
    card.type = 'button';
    card.setAttribute('data-bomb', def.id);
    const top = mk('div', 'top');
    const holder = mk('span');
    holder.innerHTML = bombSvg(def);
    top.appendChild(holder);
    top.appendChild(mk('span', 'tag', (def.charges || 1) + 'コ持ち'));
    card.appendChild(top);
    card.appendChild(mk('span', 'wn', def.name || def.id));
    card.appendChild(mk('span', 'wd', def.desc || ''));
    card.appendChild(mk('span', 'ws', 'ダメージ' + (def.dmg || 0) + ' / はんい' + (def.radius || 0) + 'm / ' + (def.cooldown || 0) + '秒でかいふく'));
    card.appendChild(statBars(def, BOMB_STATS));
    bombNodes[def.id] = card;
    card.addEventListener('click', function () {
      audioWake(); sfx('click');
      sel.bomb = def.id;
      refreshLoadoutSel();
    });
    return card;
  }

  /* 「おまかせ（ランダム）」のカード。kind = 'gun' | 'bomb' */
  function randomCard(kind) {
    const card = mk('button', 'wcard rnd' + (kind === 'bomb' ? ' rndOnly' : ''));
    card.type = 'button';
    card.setAttribute(kind === 'bomb' ? 'data-bomb' : 'data-gun', RND);
    const top = mk('div', 'top');
    top.appendChild(mk('span', 'dice', '？'));
    top.appendChild(mk('span', 'tag', 'ランダム'));
    card.appendChild(top);
    card.appendChild(mk('span', 'wn', 'おまかせ'));
    card.appendChild(mk('span', 'wd', kind === 'bomb' ? 'CPUが 1人ずつ ちがうボムを持つ' : 'CPUが 1人ずつ ちがう銃を持つ'));
    (kind === 'bomb' ? bombNodes : gunNodes)[RND] = card;
    card.addEventListener('click', function () {
      audioWake(); sfx('click');
      if (kind === 'bomb') sel.bomb = RND; else sel.gun = RND;
      refreshLoadoutSel();
    });
    return card;
  }

  function gunName(id) { if (id === RND) return 'おまかせ'; const g = gunDef(id); return (g && g.name) || id || 'ぶき'; }
  function bombName(id) { if (id === RND) return 'おまかせ'; const b = bombDef(id); return (b && b.name) || id || 'ボム'; }

  function refreshLoadoutSel() {
    const me = loadoutTarget === 'me';
    for (const id in gunNodes) {
      gunNodes[id].classList.toggle('sel', id === sel.gun);
      gunNodes[id].classList.toggle('sel2', me && !!sel.gun2 && id === sel.gun2);
    }
    for (const id in bombNodes) bombNodes[id].classList.toggle('sel', id === sel.bomb);
    /* v5: メイン・サブの わく */
    const slots = qsa(pick('scLoadout'), '.gunSlots .slot');
    for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('sel', (+slots[i].getAttribute('data-slot')) === sel.slot);
    const pn = (m) => { const n = CS.Parts ? CS.Parts.total(m || '') : 0; return n ? ' ＋' + n : ''; };
    setText(pick('slotName0'), gunName(sel.gun) + (me ? pn(sel.gm) : ''));
    const m0 = gunDef(sel.gun);
    setText(pick('slotName1'), sel.gun2 ? gunName(sel.gun2) + pn(sel.gm2) : (m0 && m0.solo && me ? 'もてない（スナイパー系）' : 'なし'));
    const sum = pick('loadoutSum');
    clear(sum);
    if (sel.gun) {
      sum.appendChild(mk('b', null, gunName(sel.gun) + (me ? pn(sel.gm) : '') + (me && sel.gun2 ? ' / ' + gunName(sel.gun2) + pn(sel.gm2) : '')));
      sum.appendChild(D.createTextNode(' ＋ '));
      sum.appendChild(mk('i', null, bombName(sel.bomb)));
      sum.appendChild(mk('br'));
      const g = sel.gun === RND ? null : gunDef(sel.gun);
      sum.appendChild(mk('small', null, g ? describe(g) : 'CPUが 1人ずつ ランダムにえらびます'));
    } else {
      sum.appendChild(D.createTextNode('ぶきをえらんでね'));
    }
    if (CS.Workshop && CS.Workshop.refresh) { try { CS.Workshop.refresh(); } catch (e) { if (window.console) console.error('[workshop]', e); } }
  }

  /* v5: サブの銃（ない・必殺技の銃 なら ''）。CS2: メインと おなじでも よい。スナイパー系が あれば '' */
  function validGun2(id, main) {
    const g = CS.GunMap && CS.GunMap[id], m = CS.GunMap && CS.GunMap[main];
    return g && !g.special && !g.solo && !(m && m.solo) ? id : '';
  }
  function setLoadoutLabel() {
    const g1 = validGun(CS.Settings.gun), g2 = validGun2(CS.Settings.gun2, g1);
    const pn = (m, id) => { const n = CS.Parts ? CS.Parts.total(cleanMods(m, id)) : 0; return n ? '＋' + n : ''; };
    const t = gunName(g1) + pn(CS.Settings.gm, g1) + (g2 ? ' / ' + gunName(g2) + pn(CS.Settings.gm2, g2) : '') + ' ＋ ' + bombName(validBomb(CS.Settings.bomb));
    setText(pick('loadoutLabel'), t);
    setText(pick('cpuGearLabel'), t);          // コンピューター戦の画面にも同じものを出す
  }

  /* CPU のぶき（保存データがこわれていたら おまかせ） */
  function cpuWeapon(target) {
    const k = CPU_KEYS[target], S = CS.Settings;
    const gun = S[k[0]] === RND || (CS.GunMap && CS.GunMap[S[k[0]]]) ? S[k[0]] : RND;
    const bomb = S[k[1]] === RND || (CS.BombMap && CS.BombMap[S[k[1]]]) ? S[k[1]] : RND;
    return { gun: gun, bomb: bomb };
  }
  function cpuWeaponLabel(w) {
    if (w.gun === RND && w.bomb === RND) return 'おまかせ（1人ずつランダム）';
    return gunName(w.gun) + ' ＋ ' + bombName(w.bomb);
  }
  function setCpuGearLabels() {
    setText(pick('cpuEnemyLabel'), cpuWeaponLabel(cpuWeapon('enemy')));
    setText(pick('cpuAllyLabel'), cpuWeaponLabel(cpuWeapon('ally')));
  }

  /* target: 'me'（じぶん・ふつう）/ 'enemy' / 'ally'（CPU のぶき。おまかせ も えらべる） */
  function openLoadout(returnTo, target) {
    loadoutReturn = returnTo || 'scTitle';
    loadoutTarget = CPU_KEYS[target] ? target : 'me';
    const cpu = loadoutTarget !== 'me';
    if (cpu) {
      const w = cpuWeapon(loadoutTarget);
      sel.gun = w.gun; sel.bomb = w.bomb;
    } else {
      sel.gun = validGun(CS.Settings.gun);
      sel.bomb = validBomb(CS.Settings.bomb);
      sel.gun2 = validGun2(CS.Settings.gun2, sel.gun);
      sel.gm = cleanMods(CS.Settings.gm, sel.gun);
      sel.gm2 = sel.gun2 ? cleanMods(CS.Settings.gm2, sel.gun2) : '';
    }
    sel.slot = 0;
    pick('scLoadout').classList.toggle('cpuPick', cpu);
    setText(pick('loadoutTitle'), loadoutTarget === 'enemy' ? 'てきのぶきをえらぶ' : loadoutTarget === 'ally' ? 'なかまのぶきをえらぶ' : 'ぶきをえらぶ');
    setText(pick('loadoutNote'), cpu ? '' + (loadoutTarget === 'enemy' ? 'てき' : 'なかま') + 'のCPUが みんな このぶきを持ちます' : 'しあい中は武器を変えられません');
    show('scLoadout');
    refreshLoadoutSel();
  }

  /* ==========================================================================
     へやを作る（マップカード）
     ========================================================================== */
  const state = { mode: '1v1', map: '' };

  function buildMaps() {
    mapsBuilt = buildMapCards(pick('mapGrid'), 'data-map', function () { return state.map; }, function (id) { state.map = id; });
  }

  /* えらべるマップ（いつものマップ ＋ じぶんで作ったマップ ＋ みんなのステージの ほぞんした・さいきん あそんだ もの） */
  function allMaps() {
    const list = ((CS.Maps && CS.Maps.list) || []).slice();
    if (CS.CustomMaps) { try { for (const d of CS.CustomMaps.defs()) list.push(d); } catch (e) {} }
    if (CS.Stages) { try { for (const d of CS.Stages.playable()) list.push(d); } catch (e) {} }
    return list;
  }

  /* マップカードを並べる（へやを作る・コンピューター戦で共用）。attr = カードにつける data 属性。
     マップ一覧がまだ無ければ「読み込み中」を出して false */
  function buildMapCards(grid, attr, getSel, setSel) {
    const list = allMaps();
    if (!list.length) {
      clear(grid);
      grid.appendChild(mk('div', 'hint', 'マップを読み込んでいます…'));
      return false;
    }
    clear(grid);
    let cur = getSel();
    if (!cur || !list.some((m) => m.id === cur)) { cur = list[0].id; setSel(cur); }
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const card = mk('button', 'mapCard' + (m.id === cur ? ' sel' : '') + (m.custom ? ' custom' : '') + (m.pub ? ' pub' : ''));
      card.type = 'button';
      card.setAttribute(attr, m.id);
      const th = mk('div', 'thumb');
      const cm = m.custom && CS.CustomMaps ? CS.CustomMaps.raw(m.id) : null;
      if (cm) {
        /* じぶんのマップ・みんなのステージ: 上から見た絵 */
        const cv = D.createElement('canvas');
        cv.className = 'mthumb';
        CS.CustomMaps.thumb(cm, cv);
        th.appendChild(cv);
      } else {
        /* サムネ：マップ名から作った適当なブロック配置 */
        const rnd = (CS.rng ? CS.rng(hashStr(m.id)) : Math.random);
        for (let k = 0; k < 10; k++) {
          const s = mk('span');
          const w = 6 + rnd() * 22, h = 4 + rnd() * 12;
          s.style.left = (rnd() * 88) + '%';
          s.style.top = (rnd() * 70 + 6) + '%';
          s.style.width = w + '%';
          s.style.height = h + 'px';
          s.style.color = k % 3 === 0 ? 'rgba(127,214,255,.75)' : k % 3 === 1 ? 'rgba(255,94,168,.6)' : 'rgba(150,175,230,.45)';
          th.appendChild(s);
        }
      }
      th.appendChild(mk('em', null, (m.en || m.id || '').toUpperCase()));
      card.appendChild(th);
      const mi = mk('div', 'mi');
      mi.appendChild(mk('div', 'mn', m.name || m.id));
      mi.appendChild(mk('small', 'md', m.desc || ''));
      card.appendChild(mi);
      card.addEventListener('click', function () {
        audioWake(); sfx('click');
        setSel(m.id);
        markMapCards(grid, attr, m.id);
      });
      grid.appendChild(card);
    }
    return true;
  }
  function markMapCards(grid, attr, id) {
    const cards = grid.children || [];
    for (let j = 0; j < cards.length; j++) {
      const c = cards[j];
      if (c && c.getAttribute && c.getAttribute(attr) !== null) c.classList.toggle('sel', c.getAttribute(attr) === id);
    }
  }
  function hashStr(s) {
    let h = 2166136261;
    s = String(s || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ==========================================================================
     ルール（へやを作る・コンピューター戦・ロビー）
     ========================================================================== */
  let lobbyRule = null;
  function ruleOf(where) {
    const S = CS.Settings;
    if (where === 'cpu') return CS.cleanRule(S.cpuRule, S.cpuRuleN);
    if (where === 'lobby') return lobbyRule || CS.cleanRule(S.rule, S.ruleN);
    return CS.cleanRule(S.rule, S.ruleN);
  }
  function setRuleOf(where, r) {
    r = CS.cleanRule(r);
    const S = CS.Settings;
    if (where === 'cpu') { S.cpuRule = r.id; S.cpuRuleN = r.n; saveSoon(); }
    else if (where === 'create') { S.rule = r.id; S.ruleN = r.n; saveSoon(); }
    else lobbyRule = r;
  }
  /* where: 'create' | 'cpu' | 'lobby'。ルールのカードと、数のボタン */
  const RULE_UI = { create: ['ruleGrid', 'ruleN'], cpu: ['cpuRuleGrid', 'cpuRuleN'], lobby: ['lobbyRuleGrid', 'lobbyRuleN'] };
  function buildRuleUI(where) {
    const ids = RULE_UI[where];
    if (!ids || !CS.RULESETS) return;
    const grid = pick(ids[0]), seg = pick(ids[1]);
    const cur = ruleOf(where);
    clear(grid);
    for (const id of CS.RULE_IDS) {
      const R = CS.RULESETS[id];
      const b = mk('button', 'ruleCard' + (id === cur.id ? ' sel' : ''));
      b.type = 'button';
      const top = mk('b');
      top.appendChild(mk('span', null, R.name));
      b.appendChild(top);
      b.appendChild(mk('small', null, R.desc));
      b.addEventListener('click', function () {
        audioWake(); sfx('click');
        setRuleOf(where, { id: id, n: R.opts.indexOf(cur.n) >= 0 ? cur.n : R.def });
        buildRuleUI(where);
      });
      grid.appendChild(b);
    }
    clear(seg);
    const R = CS.RULESETS[cur.id];
    for (const n of R.opts) {
      const b = mk('button', 'btn' + (n === cur.n ? ' sel' : ''), CS.ruleLabel({ id: cur.id, n: n }));
      b.type = 'button';
      b.addEventListener('click', function () { audioWake(); sfx('click'); setRuleOf(where, { id: cur.id, n: n }); buildRuleUI(where); });
      seg.appendChild(b);
    }
    if (where === 'cpu') cpuHint();
  }
  function ruleText(rule) {
    const r = CS.cleanRule(rule), R = CS.RULESETS[r.id];
    return R.name + '（' + CS.ruleLabel(r) + '）';
  }

  /* ==========================================================================
     ロビー
     ========================================================================== */
  function nameOfGun(id) { const g = CS.GunMap && CS.GunMap[id]; return g ? (g.short || g.name) : (id || '—'); }
  function nameOfBomb(id) { const b = CS.BombMap && CS.BombMap[id]; return b ? b.name : (id || '—'); }

  const MODE_PER = { '1v1': 1, '2v2': 2, '3v3': 3, 'tower': 4, 'defense': 4, 'tourney': 8 };
  function perTeam(mode) { return MODE_PER[mode] || 1; }
  function modeLabel(mode) {
    return mode === 'tower' ? 'みんなで塔のぼり' : mode === 'defense' ? 'みんなで クリスタルまもり' : mode === 'tourney' ? 'みんなで トーナメント' : perTeam(mode) + '対' + perTeam(mode);
  }
  function defDiffName(o) { const DF = CS.Defense, d = o && o.defense; return DF && d ? DF.diffOf(d.diff).name : 'ふつう'; }
  function defMapName(o) { const d = o && o.defense, m = d && CS.Maps && CS.Maps.get(d.map); return m ? m.name : ''; }
  function towerDiffName(o) {
    const D = CS.Tower && CS.Tower.DIFFS, t = o && o.tower;
    return D && t && D[t.diff] ? D[t.diff].name : 'ふつう';
  }

  /* 同じなまえの人がいたら 2人目から「(2)」「(3)」をつけて見分けられるようにする（表示だけ） */
  function lobbyNames(slots) {
    const out = new Map(), count = {}, taken = {};
    const all = [];
    for (let t = 0; t < 2; t++) {
      const row = (slots && slots[t]) || [];
      for (let i = 0; i < row.length; i++) if (row[i] && typeof row[i] === 'object') all.push(row[i]);
    }
    for (let i = 0; i < all.length; i++) taken[all[i].name || 'プレイヤー'] = 1;
    for (let i = 0; i < all.length; i++) {
      const base = all[i].name || 'プレイヤー';
      count[base] = (count[base] || 0) + 1;
      if (count[base] === 1) { out.set(all[i], base); continue; }
      let k = count[base], nm = base + '(' + k + ')';
      while (taken[nm]) { k++; nm = base + '(' + k + ')'; }
      count[base] = k;
      taken[nm] = 1;
      out.set(all[i], nm);
    }
    return out;
  }

  /* いっしょに遊んでいる人への「＋フレンド」（フレンドなら 、申請中なら そのしるし） */
  function friendChip(fc, name, after) {
    const hub = CS.Friends && CS.Friends.hub;
    if (!hub || !fc || fc === hub.code) return null;
    if (hub.isFriend(fc)) return mk('span', 'fchip on', 'フレンド');
    if (hub.isOut(fc)) return mk('span', 'fchip', '申請中…');
    const b = mk('button', 'fchip add', hub.isInc(fc) ? '＋OKする' : '＋フレンド');
    b.type = 'button';
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      audioWake(); sfx('ok');
      const r = hub.request(fc, name);
      toast(r.ok ? (r.why === 'accepted' ? name + ' と フレンドになりました' : name + ' に フレンド申請を送りました') : 'フレンド申請できませんでした');
      if (after) after();
    });
    return b;
  }

  let lastLobby = null;
  const BOT_LV_NAME = { easy: 'よわい', normal: 'ふつう', hard: 'つよい', flee: '逃げるだけ' };
  function renderLobby(o) {
    o = o || {};
    lastLobby = o;
    const code = o.code || '------';
    const eCode = pick('lobbyCode');
    if (eCode._m !== code) { eCode._m = code; eCode.textContent = code; }
    lobbyCode = code;

    const per = perTeam(o.mode);
    const defense = o.mode === 'defense', tourney = o.mode === 'tourney';
    const tower = o.mode === 'tower' || defense || tourney;      // みんなで（塔のぼり・クリスタルまもり・トーナメント）: 1つの ならび
    const mapDef = (CS.Maps && CS.Maps.get) ? CS.Maps.get(o.mapId) : null;
    const mapName = o.mapName || (mapDef && mapDef.name) || o.mapId || 'マップ';
    const rt = tourney ? (CS.Tourney ? CS.Tourney.describe(o.tourney) : '') : defense ? 'むずかしさ: ' + defDiffName(o) : tower ? 'むずかしさ: ' + towerDiffName(o) : ruleText(o.rule);
    const where = tourney ? '8人まで' : defense ? defMapName(o) + ' ・ 4人まで' : tower ? '4人まで' : mapName;
    /* v5.3: ランダムマッチ（ルールは きまり・じゅんびは じどう・そろったら じどうで はじまる） */
    const ranked = !!o.ranked;
    const head = ranked ? 'ランダムマッチ ' + modeLabel(o.mode) + '（' + (CS.Ranked ? CS.Ranked.tierName(o.ranked.tier) : '') + '）' : modeLabel(o.mode);
    const info = head + ' ・ ' + where + ' ・ ' + rt;
    const eInfo = pick('lobbyInfo');
    if (eInfo._m !== info) {
      eInfo._m = info;
      clear(eInfo);
      eInfo.appendChild(mk('b', null, head));
      eInfo.appendChild(D.createTextNode(' ・ ' + where + ' ・ '));
      eInfo.appendChild(mk('span', 'ruleTag', rt));
    }
    pick('btnLobbyRule').style.display = o.isHost && !tower && !ranked ? '' : 'none';
    if (!o.isHost || tower || ranked) pick('lobbyRulePanel').classList.remove('on');
    pick('btnReady').style.display = ranked ? 'none' : '';
    pick('team1').style.display = tower ? 'none' : '';

    const slots = o.slots || [[], []];
    const shown = lobbyNames(slots);
    let filled = 0, me = null;
    for (let t = 0; t < 2; t++) {
      const col = pick('team' + t);
      clear(col);
      if (tower && t === 1) continue;
      col.classList.toggle('n3', per >= 3);
      const row = slots[t] || [];
      const n = Math.max(per, row.length);
      let cnt = 0;
      for (let i = 0; i < n; i++) if (row[i]) cnt++;
      filled += cnt;
      const th = mk('div', 'th', tower ? 'なかま' : ((CS.TEAM_NAMES && CS.TEAM_NAMES[t]) || (t ? 'あお' : 'あか')) + 'チーム');
      th.appendChild(mk('small', null, cnt + '/' + n));
      col.appendChild(th);
      for (let i = 0; i < n; i++) {
        const p = row[i];
        if (p) {
          if (p.id === o.myId) me = p;
          const s = mk('div', 'slot' + (p.id === o.myId ? ' me' : '') + (p.bot ? ' cpu' : ''));
          const pn = mk('div', 'pn', shown.get(p) || p.name || 'プレイヤー');
          if (p.host || p.id === 'host' || (o.hostId && p.id === o.hostId)) pn.appendChild(mk('u', null, 'ホスト'));
          if (p.id === o.myId) pn.appendChild(mk('u', null, 'あなた'));
          s.appendChild(pn);
          /* v5: コンピューター（ホストは つよさを かえる・へらす ことが できる） */
          if (p.bot) {
            const cr = mk('div', 'cpuRow');
            const lvName = BOT_LV_NAME[p.bot] || 'ふつう';
            if (o.isHost) {
              const lv = mk('button', 'btn ghost sm', 'つよさ: ' + lvName);
              lv.type = 'button';
              lv.addEventListener('click', function (e) { e.stopPropagation(); audioWake(); sfx('click'); call('roomBot', 'lv', p.id); });
              const del = mk('button', 'btn ghost sm', 'はずす');
              del.type = 'button';
              del.addEventListener('click', function (e) { e.stopPropagation(); audioWake(); sfx('back'); call('roomBot', 'del', p.id); });
              cr.appendChild(lv); cr.appendChild(del);
            } else cr.appendChild(mk('span', 'cpuLv', 'コンピューター（' + lvName + '）'));
            s.appendChild(cr);
          }
          if (p.id !== o.myId && !p.bot) {
            const fc = friendChip(p.fc, p.name, function () { if (lastLobby) renderLobby(lastLobby); });
            if (fc) s.appendChild(fc);
          }
          s.appendChild(mk('div', 'pw', nameOfGun(p.gun) + ' ／ ' + nameOfBomb(p.bomb)));
          const pr = mk('div', 'pr');
          pr.appendChild(mk('span', p.ready ? 'ok' : 'ng', p.ready ? '✓ じゅんびOK' : '… まだ'));
          pr.appendChild(mk('span', 'pp', p.ping === undefined || p.ping === null ? '' : (p.ping | 0) + 'ms'));
          s.appendChild(pr);
          col.appendChild(s);
        } else if (tower) {
          col.appendChild(mk('div', 'slot empty', 'あき（友達を まっています）'));
        } else if (ranked) {
          col.appendChild(mk('div', 'slot empty', 'おなじ ランクの人を まっています…'));
        } else {
          const b = mk('button', 'slot empty', 'あき（ここに移動）');
          b.type = 'button';
          b.setAttribute('data-team', String(t));
          b.addEventListener('click', function () {
            audioWake(); sfx('click');
            call('team', t);
          });
          /* v5: ホストは あいている ところに コンピューターを 入れられる */
          if (o.isHost) {
            const w = mk('div', 'slotWrap');
            const add = mk('button', 'btn ghost sm addCpu', '＋ コンピューター');
            add.type = 'button';
            add.addEventListener('click', function () { audioWake(); sfx('ok'); call('roomBot', 'add', t); });
            w.appendChild(b); w.appendChild(add);
            col.appendChild(w);
          } else col.appendChild(b);
        }
      }
    }

    const iAmReady = !!(me && me.ready);
    const bReady = pick('btnReady');
    const rTxt = iAmReady ? 'まだ（じゅんびをやめる）' : 'じゅんびOK';
    if (bReady._m !== rTxt) { bReady._m = rTxt; bReady.textContent = rTxt; }
    bReady.classList.toggle('sel', iAmReady);
    readyState = iAmReady;

    const bStart = pick('btnStart');
    if (o.isHost && !ranked) {
      bStart.style.display = '';
      bStart.disabled = !o.canStart;
      const sTxt = tourney ? (o.canStart ? 'トーナメント開始！' : 'ぜんいん じゅんびOK で はじめられます')
        : defense ? (o.canStart ? 'スタート！' : 'ぜんいん じゅんびOK で はじめられます')
        : tower ? (o.canStart ? 'のぼる！' : 'ぜんいん じゅんびOK で のぼれます') : (o.canStart ? 'しあい開始！' : 'ぜんいん そろうと押せます');
      if (bStart._m !== sTxt) { bStart._m = sTxt; bStart.textContent = sTxt; }
    } else {
      bStart.style.display = 'none';
      bStart.disabled = true;
    }

    let m = o.msg || '';
    if (!m) {
      if (ranked) {
        m = filled < per * 2 ? 'おなじ ランクの人を まっています（あと ' + (per * 2 - filled) + '人）。そろうと じどうで はじまるよ。'
          : 'そろった！ まもなく はじまります';
      }
      else if (tourney) {
        if (!o.isHost) m = 'ホストが「トーナメント開始！」を押すと 表が できます。足りない人数は コンピューターが 入るよ。';
        else if (!o.canStart) m = 'コードを友達に送ろう（8人まで）。ぜんいん「じゅんびOK」で はじめられます。';
        else m = filled >= 2 ? filled + '人で トーナメント！ 足りない人数は コンピューター。' : '1人でも はじめられます。友達を まっても いいよ。';
      }
      else if (defense) {
        if (!o.isHost) m = 'ホストが「スタート！」を押すと はじまります。人数が 多いほど てきも ふえるよ。';
        else if (!o.canStart) m = 'コードを友達に送ろう（4人まで）。ぜんいん「じゅんびOK」で はじめられます（1人でも OK）。';
        else m = filled >= 2 ? filled + '人で クリスタルを まもろう！' : '1人でも はじめられます。友達を まっても いいよ。';
      }
      else if (tower) {
        if (!o.isHost) m = 'ホストが「のぼる！」を押すと はじまります。人数が 多いほど てきも つよくなるよ。';
        else if (!o.canStart) m = 'コードを友達に送ろう（4人まで）。ぜんいん「じゅんびOK」で のぼれます（1人でも OK）。';
        else m = filled >= 2 ? filled + '人で のぼろう！ チップは みんなに つくよ。' : '1人でも のぼれます。友達を まっても いいよ。';
      }
      else if (!o.isHost) m = 'ホストが「しあい開始」を押すとはじまります。';
      else if (filled < per * 2) m = 'コードを友達に送って、あと' + (per * 2 - filled) + '人 待とう。';
      else if (!o.canStart) m = 'ぜんいんの「じゅんびOK」を待っています。';
      else m = 'そろった！ しあい開始を押してね。';
    }
    msg('lobbyMsg', m, !!o.warn);
  }

  /* ==========================================================================
     リザルト
     ========================================================================== */
  function showResult(o) {
    o = o || {};
    const score = o.score || [0, 0];
    const w = o.winner === undefined || o.winner === null ? -1 : o.winner;
    const tCss = (CS.TEAM_CSS && CS.TEAM_CSS[w]) || '#7fd6ff';
    const tName = (CS.TEAM_NAMES && CS.TEAM_NAMES[w]) || '';
    const title = pick('resTitle');
    clear(title);
    let head, sub;
    if (w < 0) { head = 'DRAW'; sub = 'ひきわけ'; }
    else if (o.myTeam === undefined || o.myTeam === null) { head = 'WIN'; sub = tName + 'チームの勝ち'; }
    else if (w === o.myTeam) { head = 'WIN'; sub = tName + 'チームの勝ち！ やったね'; }
    else { head = 'LOSE'; sub = tName + 'チームの勝ち…つぎはやり返そう'; }
    title.style.color = w < 0 ? '#bcd0ea' : tCss;
    title.appendChild(D.createTextNode(head));
    title.appendChild(mk('small', null, sub));

    const sc = pick('resScore');
    clear(sc);
    sc.appendChild(mk('span', 's0', score[0] | 0));
    sc.appendChild(mk('span', 'dash', '-'));
    sc.appendChild(mk('span', 's1', score[1] | 0));
    const rule = o.rule ? CS.cleanRule(o.rule) : null;
    const unit = rule ? { kills: 'キル', time: 'キル', stock: 'のこり', area: 'カウント' }[rule.id] : '';
    setText(pick('resRule'), rule ? ruleText(rule) + (unit ? '　点 = ' + unit : '') : '');

    const rows = (o.rows || []).slice();
    rows.sort((a, b) => ((a.team | 0) - (b.team | 0)) || ((b.kills | 0) - (a.kills | 0)));
    const tblEl = pick('resTable');
    const showRows = function () {
      clear(tblEl);
      const tbl = mk('tbody');
      tblEl.appendChild(tbl);
      const hr = mk('tr');
      hr.appendChild(mk('th', null, 'プレイヤー'));
      hr.appendChild(mk('th', null, 'キル'));
      hr.appendChild(mk('th', null, 'デス'));
      tbl.appendChild(hr);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tr = mk('tr', r.me ? 'me' : '');
        const td = mk('td');
        const dot = mk('span', 'dot');
        dot.style.color = (CS.TEAM_CSS && CS.TEAM_CSS[r.team | 0]) || '#7fd6ff';
        td.appendChild(dot);
        td.appendChild(D.createTextNode(r.name || 'プレイヤー'));
        /* いっしょに遊んだ人に フレンド申請 */
        if (!r.me && !r.bot && r.fc) { const c = friendChip(r.fc, r.name, showRows); if (c) td.appendChild(c); }
        tr.appendChild(td);
        tr.appendChild(mk('td', null, r.kills | 0));
        tr.appendChild(mk('td', null, r.deaths | 0));
        tbl.appendChild(tr);
      }
    };
    showRows();
    /* コンピューター戦: 「もう一回」（おなじ設定）と「タイトルへ」 */
    resultCpu = !!o.cpu;
    if (o.cpu && typeof o.cpu === 'object') lastCpu = cleanCpu(o.cpu);   // game が設定を渡してきたらそれを使う
    const again = pick('btnAgain');
    const aTxt = resultCpu ? 'もう一回' : o.isHost ? 'ロビーへもどる（ぜんいん）' : 'ロビーへもどる';
    setText(again, aTxt);
    if (resultCpu) {
      const c = lastCpu || cleanCpu(null);
      msg('resMsg', 'おなじ設定（' + modeLabel(c.mode) + '・' + CPU_LEVEL_NAMES[c.level] + '）で もう一回！');
    } else {
      msg('resMsg', o.isHost ? 'もう一度あそぶなら、ロビーでぶきを変えられます。' : 'ホストがロビーへもどすと、みんな戻ります。');
    }
    show('scResult');
    if (!o.danced) sfx(w < 0 ? 'ok' : (o.myTeam !== undefined && w === o.myTeam) ? 'win' : 'lose');
  }

  /* ==========================================================================
     せってい
     ========================================================================== */
  let saveT = 0;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { if (CS.saveSettings) CS.saveSettings(); }, 250);
  }
  function bindRange(id, outId, key, fmt) {
    const el = $(id);
    if (!el) return;
    const out = pick(outId);
    const apply = function (save) {
      const v = parseFloat(el.value);
      if (!isNaN(v)) CS.Settings[key] = v;
      out.textContent = fmt ? fmt(CS.Settings[key]) : CS.Settings[key];
      call('settings', CS.Settings);
      if (save) { if (CS.saveSettings) CS.saveSettings(); } else saveSoon();
    };
    el.value = CS.Settings[key];
    out.textContent = fmt ? fmt(CS.Settings[key]) : CS.Settings[key];
    el.addEventListener('input', function () { apply(false); });
    el.addEventListener('change', function () { apply(true); });
    rangeBinds.push({ el: el, out: out, key: key, fmt: fmt });
  }
  const rangeBinds = [];
  function bindSwitch(id, key) {
    const el = $(id);
    if (!el) return;
    el.checked = !!CS.Settings[key];
    el.addEventListener('change', function () {
      CS.Settings[key] = !!el.checked;
      call('settings', CS.Settings);
      if (CS.saveSettings) CS.saveSettings();
      sfx('click');
    });
    switchBinds.push({ el: el, key: key });
  }
  const switchBinds = [];

  /* せってい画面を開くたびに、いまの CS.Settings を画面に写す（ほかの場所で変わっていてもずれない） */
  function refreshSettings() {
    const S = CS.Settings;
    for (let i = 0; i < rangeBinds.length; i++) {
      const b = rangeBinds[i];
      if (typeof S[b.key] !== 'number') continue;
      b.el.value = S[b.key];
      b.out.textContent = b.fmt ? b.fmt(S[b.key]) : S[b.key];
    }
    for (let i = 0; i < switchBinds.length; i++) switchBinds[i].el.checked = !!S[switchBinds[i].key];
    const q = $('setQuality');
    if (q) q.value = S.quality || 'auto';
    const ok = !!layoutApi();
    const b = pick('btnLayout');
    b.disabled = !ok;
    setText(pick('layoutBtnSub'), ok ? 'うつ・ジャンプなどの場所と大きさを変える' : 'この画面では使えません');
  }

  /* ==========================================================================
     コンピューターと対戦（オフライン）
     ========================================================================== */
  const CPU_MODES = ['1v1', '2v2', '3v3'];
  const CPU_LEVELS = ['flee', 'easy', 'normal', 'hard'];
  const CPU_LEVEL_NAMES = { flee: '逃げるだけ', easy: 'よわい', normal: 'ふつう', hard: 'つよい' };
  let cpuMapsBuilt = false, resultCpu = false, lastCpu = null;
  let cpuModeBtns = [], cpuLvBtns = [];

  function validCpuMap(id) {
    const list = allMaps();
    if (!list.length) return id || 'plaza';
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return id;
    return list[0].id;
  }
  /* 保存データがこわれていても、つかえる組み合わせにする */
  function cleanCpu(c) {
    const S = CS.Settings;
    c = c || {};
    const mode = CPU_MODES.indexOf(c.mode) >= 0 ? c.mode : CPU_MODES.indexOf(S.cpuMode) >= 0 ? S.cpuMode : '1v1';
    const level = CPU_LEVELS.indexOf(c.level) >= 0 ? c.level : CPU_LEVELS.indexOf(S.cpuLevel) >= 0 ? S.cpuLevel : 'normal';
    const mapId = validCpuMap(c.mapId || S.cpuMap);
    /* CPU のぶき: 渡されたもの → なければ せってい → こわれていたら おまかせ */
    const e = cpuWeapon('enemy'), a = cpuWeapon('ally');
    const gunOk = (v) => v === RND || !!(CS.GunMap && CS.GunMap[v]);
    const bombOk = (v) => v === RND || !!(CS.BombMap && CS.BombMap[v]);
    return {
      mode: mode, level: level, mapId: mapId,
      enemyGun: gunOk(c.enemyGun) ? c.enemyGun : e.gun, enemyBomb: bombOk(c.enemyBomb) ? c.enemyBomb : e.bomb,
      allyGun: gunOk(c.allyGun) ? c.allyGun : a.gun, allyBomb: bombOk(c.allyBomb) ? c.allyBomb : a.bomb,
      rule: c.rule ? CS.cleanRule(c.rule) : ruleOf('cpu')
    };
  }
  function cpuChoice() {
    const c = cleanCpu({ mode: CS.Settings.cpuMode, level: CS.Settings.cpuLevel, mapId: CS.Settings.cpuMap });
    CS.Settings.cpuMode = c.mode; CS.Settings.cpuLevel = c.level; CS.Settings.cpuMap = c.mapId;
    CS.Settings.cpuEnemyGun = c.enemyGun; CS.Settings.cpuEnemyBomb = c.enemyBomb;
    CS.Settings.cpuAllyGun = c.allyGun; CS.Settings.cpuAllyBomb = c.allyBomb;
    return c;
  }
  /* startCpu にわたす形 */
  function cpuArgs(c) {
    return {
      mode: c.mode, level: c.level, mapId: c.mapId,
      enemyGun: c.enemyGun, enemyBomb: c.enemyBomb, allyGun: c.allyGun, allyBomb: c.allyBomb,
      rule: c.rule ? CS.cleanRule(c.rule) : ruleOf('cpu')
    };
  }

  function refreshCpu() {
    cpuMapsBuilt = buildMapCards(pick('cpuMapGrid'), 'data-cpumap',
      function () { return CS.Settings.cpuMap; },
      function (id) { CS.Settings.cpuMap = id; saveSoon(); cpuHint(); });
    const c = cpuChoice();
    markCpu(c);
    buildRuleUI('cpu');
    setLoadoutLabel();
    setCpuGearLabels();
    cpuHint();
  }
  function markCpu(c) {
    /* 1対1 は なかまのCPU がいない */
    pick('cpuAllyRow').classList.toggle('off', c.mode === '1v1');
    for (let i = 0; i < cpuModeBtns.length; i++) {
      const b = cpuModeBtns[i];
      b.classList.toggle('sel', b.getAttribute('data-cpumode') === c.mode);
    }
    for (let i = 0; i < cpuLvBtns.length; i++) {
      const b = cpuLvBtns[i];
      const on = b.getAttribute('data-cpulv') === c.level;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (cpuMapsBuilt) markMapCards(pick('cpuMapGrid'), 'data-cpumap', c.mapId);
  }
  /* えらんだ組み合わせのひとこと */
  function cpuHint() {
    const c = cleanCpu(null);
    let t = '';
    if (c.level === 'flee') {
      t = c.mode === '1v1' ? 'てきは逃げ回るだけ。ねらう練習にどうぞ。'
        : 'てきは逃げ回るだけ。なかまのCPUは「ふつう」の強さで戦います。';
    } else if (c.mode !== '1v1') {
      t = 'なかまも てきも「' + CPU_LEVEL_NAMES[c.level] + '」のCPUです。';
    }
    msg('cpuMsg', t);
  }
  function bindCpu() {
    const root = $('scCpu');
    cpuModeBtns = qsa(root, '[data-cpumode]');
    cpuLvBtns = qsa(root, '[data-cpulv]');
    const pickOne = function (key, val) {
      audioWake(); sfx('click');
      if (!val) return;
      CS.Settings[key] = val;
      saveSoon();
      markCpu(cpuChoice());
      cpuHint();
    };
    for (let i = 0; i < cpuModeBtns.length; i++) {
      const b = cpuModeBtns[i];
      const v = b.getAttribute ? b.getAttribute('data-cpumode') : null;
      b.addEventListener('click', function () { pickOne('cpuMode', CPU_MODES.indexOf(v) >= 0 ? v : null); });
    }
    for (let i = 0; i < cpuLvBtns.length; i++) {
      const b = cpuLvBtns[i];
      const v = b.getAttribute ? b.getAttribute('data-cpulv') : null;
      b.addEventListener('click', function () { pickOne('cpuLevel', CPU_LEVELS.indexOf(v) >= 0 ? v : null); });
    }
    tap('btnCpu', function () { open('scCpu', 'scTitle'); }, 'ok');
    tap('btnCpuBack', function () { back('scCpu'); }, 'back');
    tap('btnCpuLoadout', function () { openLoadout('scCpu'); });
    tap('btnCpuEnemyLoadout', function () { openLoadout('scCpu', 'enemy'); });
    tap('btnCpuAllyLoadout', function () { openLoadout('scCpu', 'ally'); });
    tap('btnCpuGo', function () {
      const c = cpuChoice();
      if (CS.saveSettings) CS.saveSettings();
      lastCpu = c;
      if (!H || typeof H.cpu !== 'function') {          // つなぎ先が無いとき（ふつうは起きない）
        msg('cpuMsg', 'いま コンピューター戦をはじめられません', true);
        return;
      }
      msg('cpuMsg', 'じゅんびしています…');
      call('cpu', cpuArgs(c));
    }, 'go');
  }

  /* ==========================================================================
     ボタンの配置・大きさ（タッチ操作のエディター）
     CS.Input.editLayout(true, {onSelect}) でタッチボタンを全部出して、ドラッグで移動・タップで選択。
     このパネルで えらんだボタンの大きさ・ぜんぶの大きさ を変えて「ほぞん」か「やめる」。
     ========================================================================== */
  /* パネルに出す短い名前（せまい画面でも「〇〇の大きさ」が1行に入る長さ） */
  const CTRL_JA = { fire: 'うつ', jump: 'ジャンプ', slide: 'スライド', bomb: 'ボム', reload: 'リロード', sp: '必殺', stick: 'スティック' };
  const layout = { open: false, sel: null, drag: null };

  function layoutApi() {
    const I = CS.Input;
    if (!I) return null;
    const need = ['editLayout', 'getLayout', 'setControlScale', 'setGlobalScale', 'resetLayout', 'saveLayout', 'revertLayout'];
    for (let i = 0; i < need.length; i++) if (typeof I[need[i]] !== 'function') return null;
    return I;
  }
  function inputCall(name, a, b) {
    const I = layoutApi();
    if (!I) return undefined;
    try { return I[name](a, b); } catch (e) { if (window.console) console.error('[UI] Input.' + name, e); }
    return undefined;
  }
  function ctrlLabel(name) {
    const I = CS.Input;
    return CTRL_JA[name] || (I && I.CONTROL_LABELS && I.CONTROL_LABELS[name]) || String(name || '');
  }
  const pct = (v) => Math.round((+v || 0) * 100) + '%';
  function curLayout() {
    const l = inputCall('getLayout');
    return l && typeof l === 'object' ? l : null;
  }

  function openLayout() {
    if (layout.open) { show('scLayout'); return true; }
    const I = layoutApi();
    if (!I) { toast('この画面では ボタンの配置を変えられません'); return false; }
    layout.open = true;
    layout.sel = null;
    backTo.scLayout = 'scSettings';
    if (D.body) D.body.classList.add('layout-edit');
    const panel = pick('layPanel');
    panel.classList.remove('folded', 'moved', 'dragging');
    panel.style.left = ''; panel.style.top = '';
    setText(pick('btnLayFold'), 'たたむ');
    pick('btnLayFold').setAttribute('aria-expanded', 'true');
    const touch = !!(D.body && D.body.classList.contains('touch'));
    const tip = pick('layTip');
    clear(tip);
    tip.appendChild(mk('b', null, 'ドラッグ'));
    tip.appendChild(D.createTextNode('で動かす・'));
    tip.appendChild(mk('b', null, touch ? 'タップ' : 'クリック'));
    tip.appendChild(D.createTextNode('でえらんで 大きさを変える'));
    inputCall('editLayout', true, {
      onSelect: function (name) { layoutSelect(name); },
      onChange: function () { layoutSync(); }
    });
    show('scLayout');
    layoutSelect(null);
    layoutSync();
    return true;
  }

  /* save=true: ほぞん / false: すてる（やめる・よそへ移動） */
  function closeLayout(save) {
    if (!layout.open) return;
    layout.open = false;
    layout.drag = null;
    if (save) inputCall('saveLayout');
    else inputCall('revertLayout');
    inputCall('editLayout', false);
    if (D.body) D.body.classList.remove('layout-edit');
    pick('layPanel').classList.remove('dragging');
    if (save) call('settings', CS.Settings);
  }

  function layoutSelect(name) {
    const I = CS.Input;
    const known = !!name && (CTRL_JA[name] !== undefined || !!(I && I.CONTROL_LABELS && I.CONTROL_LABELS[name]));
    layout.sel = known ? name : null;
    const lab = pick('laySelName');
    setText(lab, layout.sel ? ctrlLabel(layout.sel) + 'の大きさ' : 'ボタンをえらんでね');
    lab.classList.toggle('on', !!layout.sel);
    pick('laySel').disabled = !layout.sel;
    layoutSync();
  }

  /* スライダーを いまの配置に合わせる */
  function layoutSync() {
    const l = curLayout();
    const all = pick('layAll');
    const g = l && typeof l.scale === 'number' ? l.scale : 1;
    all.value = g;
    setText(pick('layAllVal'), pct(g));
    const one = pick('laySel');
    if (layout.sel) {
      const c = l && l.btn && l.btn[layout.sel];
      const s = c && typeof c.s === 'number' ? c.s : 1;
      one.value = s;
      setText(pick('laySelVal'), pct(s));
    } else {
      one.value = 1;
      setText(pick('laySelVal'), '—');
    }
  }

  function bindLayout() {
    tap('btnLayout', function () { openLayout(); });
    const one = $('laySel'), all = $('layAll');
    if (one) {
      const f = function () {
        if (!layout.open || !layout.sel) return;
        const v = parseFloat(one.value);
        if (isNaN(v)) return;
        inputCall('setControlScale', layout.sel, v);
        setText(pick('laySelVal'), pct(v));
      };
      one.addEventListener('input', f);
      one.addEventListener('change', function () { f(); layoutSync(); });
    }
    if (all) {
      const f = function () {
        if (!layout.open) return;
        const v = parseFloat(all.value);
        if (isNaN(v)) return;
        inputCall('setGlobalScale', v);
        setText(pick('layAllVal'), pct(v));
      };
      all.addEventListener('input', f);
      all.addEventListener('change', function () { f(); layoutSync(); });
    }
    tap('btnLayoutReset', function () {
      if (!layout.open) return;
      inputCall('resetLayout');
      layoutSync();
      toast('はじめの配置にもどしました（「ほぞん」で決定）');
    });
    tap('btnLayoutSave', function () {
      if (!layout.open) return;
      closeLayout(true);
      show('scSettings');
      toast('ボタンの配置をほぞんしました');
    }, 'ok');
    tap('btnLayoutCancel', function () {
      if (!layout.open) return;
      closeLayout(false);
      show('scSettings');
    }, 'back');
    tap('btnLayFold', function () {
      const p = pick('layPanel');
      const folded = !p.classList.contains('folded');
      p.classList.toggle('folded', folded);
      setText(pick('btnLayFold'), folded ? 'ひらく' : 'たたむ');
      pick('btnLayFold').setAttribute('aria-expanded', folded ? 'false' : 'true');
      if (p.classList.contains('moved')) placePanel(parseFloat(p.style.left) || 0, parseFloat(p.style.top) || 0);
    });

    /* パネルは 見出しをドラッグして よけられる（ボタンの上にかぶったとき用） */
    const head = $('layHead'), panel = $('layPanel');
    if (head && panel) {
      on(head, 'pointerdown', function (e) {
        if (!layout.open || layout.drag) return;
        if (e.button !== undefined && e.button !== 0) return;
        const t = e.target;
        if (t && t.closest && t.closest('button')) return;         // 「たたむ」ボタンは押せるように
        let r = null;
        try { r = panel.getBoundingClientRect(); } catch (err) { r = null; }
        if (!r) return;
        layout.drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
        try { if (head.setPointerCapture) head.setPointerCapture(e.pointerId); } catch (err) {}
        panel.classList.add('dragging');
        if (e.cancelable) e.preventDefault();
      });
      on(head, 'pointermove', function (e) {
        const d = layout.drag;
        if (!d || e.pointerId !== d.id) return;
        placePanel(e.clientX - d.dx, e.clientY - d.dy);
      });
      const end = function (e) {
        const d = layout.drag;
        if (!d || (e && e.pointerId !== undefined && e.pointerId !== d.id)) return;
        layout.drag = null;
        panel.classList.remove('dragging');
      };
      on(head, 'pointerup', end);
      on(head, 'pointercancel', end);
      on(head, 'lostpointercapture', end);
    }
    /* 画面の向き・大きさが変わったらパネルは元の場所へ */
    on(window, 'resize', function () {
      if (!layout.open) return;
      const p = pick('layPanel');
      if (!p.classList.contains('moved')) return;
      p.classList.remove('moved');
      p.style.left = ''; p.style.top = '';
    });
    /* Esc = やめる */
    on(D, 'keydown', function (e) {
      if (!layout.open || !e) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeLayout(false);
        show('scSettings');
      }
    });
  }

  /* パネルを (x,y) へ。見出しはいつも画面の中に残す */
  function placePanel(x, y) {
    const p = pick('layPanel');
    const W = window.innerWidth || 800, Hh = window.innerHeight || 450;
    const w = p.offsetWidth || 300, h = p.offsetHeight || 60;
    const nx = clamp(x, 4, Math.max(4, W - w - 4));
    const ny = clamp(y, 4, Math.max(4, Hh - Math.min(h, 48) - 4));
    p.classList.add('moved');
    p.style.left = Math.round(nx) + 'px';
    p.style.top = Math.round(ny) + 'px';
  }

  /* ==========================================================================
     init
     ========================================================================== */
  let lobbyCode = '', readyState = false, lastTouch = 0;

  function setInputMode(touch) {
    if (!D.body) return;
    D.body.classList.toggle('touch', !!touch);
    D.body.classList.toggle('pc', !touch);
  }

  function init(h) {
    H = h || {};
    cacheHud();

    /* ---- 端末のタイプ ---- */
    setInputMode(isTouchDevice());
    on(D, 'touchstart', function () { lastTouch = Date.now(); setInputMode(true); }, { passive: true });
    on(D, 'mousedown', function (e) {
      if (Date.now() - lastTouch < 900) return;            // タッチから来た合成イベント
      if (e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      setInputMode(false);
    }, true);
    on(D, 'keydown', function (e) {
      /* スマホのソフトキーボードで なまえ を打っても PC あつかいにしない */
      if (e && isFormEl(e.target)) return;
      if (Date.now() - lastTouch > 900) setInputMode(false);
    }, true);

    /* ---- ダブルタップ拡大・長押しメニューを止める ----
       ボタン・入力欄へのタップは止めない（止めると 2 回目のタップの click が消えて、
       つづけて押したカードやボタンが反応しなくなる）。拡大は touch-action でも止まっている。 */
    on(D, 'touchend', function (e) {
      const t = Date.now();
      if (t - lastTouchEnd < 320 && e.cancelable && !isTapTarget(e.target)) e.preventDefault();
      lastTouchEnd = t;
    }, { passive: false });
    on(D, 'gesturestart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    on(D, 'gesturechange', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    on(D, 'contextmenu', function (e) {
      if (inGame(e.target)) { e.preventDefault(); return false; }
      return true;
    });
    on(D, 'dragstart', function (e) { if (inGame(e.target)) e.preventDefault(); });
    on(D, 'selectstart', function (e) { if (inGame(e.target)) e.preventDefault(); });
    /* 音は最初のタップ／クリックで起こす */
    const wake = function () { audioWake(); };
    on(D, 'pointerdown', wake, { passive: true });
    on(D, 'touchstart', wake, { passive: true });
    on(D, 'keydown', wake);

    /* ---- なまえ ---- */
    const inName = pick('inName');
    inName.value = CS.Settings.name || '';
    on(inName, 'input', function () {
      const v = String(inName.value || '').slice(0, 10);
      CS.Settings.name = v;
      saveSoon();
    });
    on(inName, 'change', function () {
      let v = String(inName.value || '').trim().slice(0, 10);
      if (!v) v = 'プレイヤー' + (10 + Math.floor(Math.random() * 90));
      inName.value = v;
      CS.Settings.name = v;
      if (CS.saveSettings) CS.saveSettings();
    });
    on(inName, 'keydown', function (e) { if (e.key === 'Enter') inName.blur(); });

    /* ---- タイトル ---- */
    tap('btnCreate', function () { open('scCreate', 'scTitle'); }, 'ok');
    tap('btnJoinOpen', function () { open('scJoin', 'scTitle'); }, 'ok');
    tap('btnLoadoutOpen', function () { openLoadout('scTitle'); });
    tap('btnPractice', function () { call('practice'); });
    tap('btnHow', function () { open('scHow', 'scTitle'); });
    tap('btnSettings', function () { open('scSettings', 'scTitle'); });

    /* ---- へやを作る ---- */
    const modeBtns = qsa($('scCreate'), '[data-mode]');
    for (let i = 0; i < modeBtns.length; i++) {
      const b = modeBtns[i];
      const m = b.getAttribute ? b.getAttribute('data-mode') : null;
      b.addEventListener('click', function () {
        audioWake(); sfx('click');
        if (m) state.mode = m;
        for (let j = 0; j < modeBtns.length; j++) {
          const o = modeBtns[j];
          o.classList.toggle('sel', o.getAttribute && o.getAttribute('data-mode') === state.mode);
        }
      });
    }
    tap('btnCreateGo', function () {
      if (!state.map) {
        const list = (CS.Maps && CS.Maps.list) || [];
        state.map = list.length ? list[0].id : 'plaza';
      }
      msg('createMsg', 'へやを作っています…');
      call('create', state.mode, state.map, ruleOf('create'));
    }, 'ok');
    tap('btnCreateBack', function () { back('scCreate'); }, 'back');

    /* ---- コードで参加 ---- */
    const inCode = pick('inCode');
    on(inCode, 'input', function () {
      const v = normalize(inCode.value);
      if (v !== inCode.value) inCode.value = v;
      if (v.length === 6) msg('joinMsg', '');
    });
    on(inCode, 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); joinGo(); } });
    tap('btnJoinGo', joinGo, 'ok');
    tap('btnJoinBack', function () { back('scJoin'); }, 'back');

    /* ---- ぶきをえらぶ ---- */
    tap('btnLoadoutOk', function () {
      if (loadoutTarget !== 'me') {
        /* CPU のぶき（おまかせ もあり） */
        const k = CPU_KEYS[loadoutTarget];
        if (sel.gun) CS.Settings[k[0]] = sel.gun;
        if (sel.bomb) CS.Settings[k[1]] = sel.bomb;
        if (CS.saveSettings) CS.saveSettings();
        setCpuGearLabels();
        show(loadoutReturn);
        return;
      }
      if (sel.gun && sel.gun !== RND) CS.Settings.gun = sel.gun;
      if (sel.bomb && sel.bomb !== RND) CS.Settings.bomb = sel.bomb;
      CS.Settings.gun2 = validGun2(sel.gun2, CS.Settings.gun);
      CS.Settings.gm = cleanMods(sel.gm, CS.Settings.gun);
      CS.Settings.gm2 = CS.Settings.gun2 ? cleanMods(sel.gm2, CS.Settings.gun2) : '';
      if (CS.saveSettings) CS.saveSettings();
      setLoadoutLabel();
      call('loadoutSaved', CS.Settings.gun, CS.Settings.bomb, CS.Settings.gun2, CS.Settings.gm, CS.Settings.gm2);
      show(loadoutReturn);
    }, 'ok');
    /* v5: メイン・サブの わく */
    const slotBtns = qsa($('scLoadout'), '.gunSlots .slot');
    for (let i = 0; i < slotBtns.length; i++) {
      const b = slotBtns[i];
      b.addEventListener('click', function () { sfx('click'); setSlot(+b.getAttribute('data-slot')); });
    }
    tap('btnLoadoutBack', function () {
      show(loadoutReturn);
    }, 'back');
    const jumps = qsa($('scLoadout'), '[data-jump]');
    for (let i = 0; i < jumps.length; i++) {
      const b = jumps[i];
      const target = b.getAttribute ? b.getAttribute('data-jump') : null;
      b.addEventListener('click', function () {
        sfx('click');
        const t = target && $(target);
        if (t && t.scrollIntoView) { try { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { t.scrollIntoView(); } }
      });
    }

    /* ---- ロビー ---- */
    tap('btnCopy', function () { copyCode(); });
    tap('btnShare', function () { shareCode(); });
    tap('btnReady', function () { call('ready', !readyState); });
    tap('btnStart', function () { call('start'); }, 'go');
    tap('btnLobbyLoadout', function () { openLoadout('scLobby'); });
    tap('btnLeave', function () { pick('lobbyRulePanel').classList.remove('on'); call('leave'); }, 'back');
    /* ホストだけ: ロビーで ルール・マップを変える */
    tap('btnLobbyRule', function () {
      const p = pick('lobbyRulePanel');
      const want = !p.classList.contains('on');
      if (want) {
        lobbyRule = lastLobby ? CS.cleanRule(lastLobby.rule) : null;
        buildRuleUI('lobby');
        const sel = pick('lobbyMap');
        clear(sel);
        for (const m of allMaps()) {
          const op = D.createElement('option');
          op.value = m.id; op.textContent = (m.pub ? '［みんな］' : m.custom ? '［じぶん］' : '') + m.name;
          if (lastLobby && m.id === lastLobby.mapId) op.selected = true;
          sel.appendChild(op);
        }
      }
      p.classList.toggle('on', want);
    });
    tap('btnLobbyRuleOk', function () {
      call('roomRule', ruleOf('lobby'), pick('lobbyMap').value);
      pick('lobbyRulePanel').classList.remove('on');
    }, 'ok');
    tap('btnLobbyRuleCancel', function () { pick('lobbyRulePanel').classList.remove('on'); }, 'back');

    /* ---- リザルト ---- */
    tap('btnAgain', function () {
      if (resultCpu) {
        const c = lastCpu || cpuChoice();
        /* cpuAgain が無ければ cpu で同じ設定をやり直す */
        call(H && typeof H.cpuAgain === 'function' ? 'cpuAgain' : 'cpu', cpuArgs(c));
      } else {
        call('again');
      }
    }, 'ok');
    tap('btnResTitle', function () { call('toTitle'); }, 'back');

    /* ---- コンピューターと対戦 ---- */
    bindCpu();

    /* ---- あそびかた ---- */
    tap('btnHowBack', function () { back('scHow'); }, 'back');

    /* ---- せってい ---- */
    bindRange('setSens', 'setSensVal', 'sens', (v) => (+v).toFixed(2));
    bindRange('setTouchSens', 'setTouchSensVal', 'touchSens', (v) => (+v).toFixed(2));
    bindRange('setFov', 'setFovVal', 'fov', (v) => String(Math.round(v)));
    bindRange('setVol', 'setVolVal', 'vol', (v) => String(Math.round(v * 100)));
    bindSwitch('setInvert', 'invertY');
    bindSwitch('setAutoJump', 'autoJump');
    const q = $('setQuality');
    if (q) {
      q.value = CS.Settings.quality || 'auto';
      q.addEventListener('change', function () {
        CS.Settings.quality = q.value || 'auto';
        call('settings', CS.Settings);
        if (CS.saveSettings) CS.saveSettings();
        sfx('click');
      });
    }
    tap('btnSettingsBack', function () { back('scSettings'); }, 'back');

    /* ---- ボタンの配置・大きさ ---- */
    bindLayout();

    /* ---- しあい中メニュー ---- */
    tap('btnResume', function () { call('resume'); }, 'ok');
    tap('btnMenuSettings', function () { open('scSettings', 'scMenu'); });
    tap('btnQuit', function () { call('quit'); }, 'back');

    /* ---- HUD：クリックでプレイ ---- */
    on(E.clickToPlay, 'click', function () {
      audioWake();
      const I = CS.Input;
      if (I && !I.locked && typeof I.requestLock === 'function') { try { I.requestLock(); } catch (e) {} }
    });

    /* ---- ?code=XXXXXX ---- */
    const qc = normalize(CS.query ? CS.query('code') : null);
    if (qc.length === 6) {
      pendingCode = qc;
      inCode.value = qc;
      msg('joinMsg', 'コードが入りました。「参加する」を押してね。');
    }

    /* 保存されていたぶきが今の一覧に無ければ直しておく */
    if (CS.Guns && CS.Guns.length) CS.Settings.gun = validGun(CS.Settings.gun);
    if (CS.Bombs && CS.Bombs.length) CS.Settings.bomb = validBomb(CS.Settings.bomb);
    cpuChoice();                                   // 前回のコンピューター戦の選択を点検
    setLoadoutLabel();
    refreshMenu();
    refreshSettings();
    hud.update({ hp: CS.RULES ? CS.RULES.hp : 100, maxHp: CS.RULES ? CS.RULES.hp : 100, spread: 0, ping: 0 });
    /* ほかのファイルの画面（塔のぼり・スキン・マップ・フレンド） */
    for (let i = 0; i < initHooks.length; i++) {
      try { initHooks[i](H); } catch (e) { if (window.console) console.error('[UI] init hook', e); }
    }
    return UI;
  }
  const initHooks = [];

  let lastTouchEnd = 0;

  function isFormEl(t) {
    const tn = t && t.tagName ? String(t.tagName).toUpperCase() : '';
    return tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || !!(t && t.isContentEditable);
  }

  /* 押せるもの（ボタン・入力欄・リンク・ラベル、またはその中） */
  function isTapTarget(t) {
    try {
      return !!(t && t.closest && t.closest('button,input,select,textarea,a,label'));
    } catch (e) { return false; }
  }

  function inGame(t) {
    if (D.body && D.body.classList && D.body.classList.contains('in-match')) return true;
    let n = t, guard = 0;
    while (n && guard++ < 12) {
      const id = n.id;
      if (id === 'cv' || id === 'hud' || id === 'touch') return true;
      n = n.parentNode;
    }
    return false;
  }

  function normalize(v) {
    if (!v) return '';
    if (CS.Net && typeof CS.Net.normalizeCode === 'function') {
      try { return CS.Net.normalizeCode(v); } catch (e) {}
    }
    return String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function joinGo() {
    const inCode = pick('inCode');
    const v = normalize(inCode.value);
    inCode.value = v;
    if (v.length < 6) { msg('joinMsg', '6文字のコードを入れてね', true); return; }
    msg('joinMsg', 'へやをさがしています…');
    call('join', v);
  }

  function copyCode() {
    const code = lobbyCode || pick('lobbyCode').textContent || '';
    writeClip(code, 'コードをコピーしました');
  }
  function shareCode() {
    const code = lobbyCode || pick('lobbyCode').textContent || '';
    const url = shareUrl(code);
    const text = 'CUBE STRIKE 2 であそぼう！ あいことば: ' + code;
    if (navigator.share) {
      try {
        const p = navigator.share({ title: 'CUBE STRIKE 2', text: text, url: url });
        if (p && p.catch) p.catch(function () {});
        return;
      } catch (e) {}
    }
    writeClip(url, 'さそいリンクをコピーしました');
  }
  function shareUrl(code) {
    let base = '';
    try { base = String(location.href).split('#')[0].split('?')[0]; } catch (e) {}
    return base + '?code=' + code;
  }
  function writeClip(text, okMsg) {
    let done = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(text);
        done = true;
        if (p && p.then) p.then(function () { toast(okMsg); }, function () { legacyClip(text, okMsg); });
        else toast(okMsg);
      }
    } catch (e) { done = false; }
    if (!done) legacyClip(text, okMsg);
  }
  function legacyClip(text, okMsg) {
    try {
      const ta = D.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      D.body.appendChild(ta);
      ta.select();
      const ok = D.execCommand ? D.execCommand('copy') : false;
      D.body.removeChild(ta);
      toast(ok ? okMsg : text);
    } catch (e) {
      toast(text);
    }
  }

  /* ==========================================================================
     公開 API
     ========================================================================== */
  const UI = CS.UI = {
    current: null,
    init: init,
    show: show,
    open: open,
    back: back,
    toast: toast,
    msg: msg,
    openLoadout: openLoadout,
    setLoadoutLabel: setLoadoutLabel,
    /* CS2: 武器こうぼう（workshop.js）から: いま えらんでいる ぶき・部品 */
    loadoutSel: sel,
    get loadoutTarget() { return loadoutTarget; },
    refreshLoadout: function () { refreshLoadoutSel(); },
    gunName: gunName,
    renderLobby: renderLobby,
    showResult: showResult,
    setPractice: setPractice,
    setMenuMode: setMenuMode,
    setRuleMode: setRuleMode,
    get ruleMode() { return ruleMode; },
    get menuMode() { return menuMode; },
    openLayout: openLayout,
    closeLayout: function (save) { if (!layout.open) return; closeLayout(!!save); show('scSettings'); },
    get layoutOpen() { return layout.open; },
    get lobby() { return lastLobby; },
    allMaps: allMaps,
    ruleText: ruleText,
    friendChip: friendChip,
    /* へやを作る画面を マップを えらんだ状態で 出す（みんなのステージから） */
    openCreate: function (mapId, from) { if (mapId) state.map = mapId; open('scCreate', from || 'scTitle'); },
    copyText: writeClip,
    /* ほかのファイル（ui-extra.js / friends-ui.js）から: 画面を出した・かくしたときに呼ぶもの */
    /* 同じ画面に いくつ登録しても 全部よぶ（登録した順） */
    addScreen: function (id, onShow, onHide) {
      if (SCREENS.indexOf(id) < 0) SCREENS.push(id);
      const chain = (prev, fn) => (prev ? function () { prev(); fn(); } : fn);
      if (onShow) showHooks[id] = chain(showHooks[id], onShow);
      if (onHide) hideHooks[id] = chain(hideHooks[id], onHide);
    },
    setMenuExtra: function (fn) { extraMenu = fn; },
    addInit: function (fn) { if (typeof fn === 'function') initHooks.push(fn); },
    /* 手伝い（同じ見た目・同じ音で作れるように） */
    util: { mk: mk, clear: clear, pick: pick, qs: qs, qsa: qsa, tap: tap, on: on, sfx: sfx, audioWake: audioWake, setText: setText, call: call, saveSoon: saveSoon },
    joinCode: function (code) {
      const inCode = pick('inCode');
      inCode.value = normalize(code);
      backTo.scJoin = 'scTitle';
      show('scJoin');
      joinGo();
    },
    hud: hud
  };
})();
