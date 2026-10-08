/* ==========================================================================
   CUBE STRIKE — ui-extra.js
   v3 の画面: 塔のぼり（はじめる・とびらとチップをえらぶ・結果）/ 勝ったチームのダンスの文字 /
   マップをつくる（じぶんのマップ一覧・マップエディターの HUD とメニュー）。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);
  let U = null, H = null;

  const game = () => CS.debug && CS.debug.game;
  const editor = () => CS.editor;
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function stars(n) { return '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n)); }
  function button(text, cls, fn, sound) {
    const b = U.util.mk('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    b.addEventListener('click', function (e) { e.stopPropagation(); U.util.audioWake(); U.util.sfx(sound || 'click'); fn(e); });
    return b;
  }

  /* ======================================================================
     塔のぼり
     ====================================================================== */
  function refreshTower() {
    const T = CS.Tower, S = CS.Settings, mk = U.util.mk, clear = U.util.clear;
    if (!T) return;
    const best = S.towerBest || {}, bestCo = S.towerBestCoop || {};
    const seg = $('twDiff');
    clear(seg);
    for (const id of ['easy', 'normal', 'hard']) {
      const d = T.DIFFS[id];
      const b = mk('button', 'btn' + (S.towerDiff === id ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(mk('b', null, d.name));
      const bf = best[id] | 0, bc = bestCo[id] | 0;
      const one = bf > T.TOP ? 'せいは！' : bf ? 'さいこう ' + bf + 'F' : d.desc;
      b.appendChild(mk('small', null, one + (bc ? ' ・ みんなで ' + (bc > T.TOP ? 'せいは' : bc + 'F') : '')));
      b.addEventListener('click', function () { U.util.audioWake(); U.util.sfx('click'); S.towerDiff = id; U.util.saveSoon(); refreshTower(); });
      seg.appendChild(b);
    }
    const g = CS.Weapons.gun(S.gun), bm = CS.Weapons.bomb(S.bomb);
    U.util.setText($('twGearLabel'), g.name + ' ＋ ' + bm.name);
    const kinds = $('twKinds');
    if (kinds && !kinds.childNodes.length) {
      for (const k of ['elim', 'target', 'survive', 'boss']) {
        const K = T.KINDS[k];
        const c = mk('div', 'twKind');
        c.appendChild(mk('b', null, K.name));
        c.appendChild(mk('small', null, K.desc + (k === 'boss' ? '（10・20・30F）' : '')));
        kinds.appendChild(c);
      }
    }
  }

  /* チップのならび（もっているもの） */
  function chipRow(el, chips) {
    const mk = U.util.mk, clear = U.util.clear;
    clear(el);
    if (!chips || !chips.length) { el.appendChild(mk('span', 'hint', 'チップは まだ ありません')); return; }
    for (const c of chips) {
      const s = mk('span', 'tchip');
      s.appendChild(D.createTextNode(c.name + (c.n > 1 ? ' ×' + c.n : '')));
      el.appendChild(s);
    }
  }

  /* とびら（3つ）を出す。onChoose(i)。みんなで のぼるときは 一人ひとりが えらんで、チップは みんなに つく */
  function towerPick(info, choices, onChoose) {
    const T = CS.Tower, mk = U.util.mk, clear = U.util.clear;
    U.util.setText($('tpTitle'), (info.floor) + 'F クリア！');
    U.util.setText($('tpStat'), 'のこり ' + info.lives + ' ・ HP ' + info.maxHp + ' ・ たおした ' + info.kills + (info.coop ? ' ・ ' + info.n + '人で' : ''));
    const hint = $('tpHint');
    if (hint) {
      U.util.setText(hint, info.coop
        ? '一人ひとりが えらぶよ。えらんだ チップは みんなに つく！ つぎの かいは いちばん多く えらばれた とびら。★★★ は チップ 2こぶん'
        : '★が おおいほど てきが つよい。★★★ の とびらは チップが 2こぶん！');
    }
    const w = $('tpWait');
    if (w) { w.style.display = 'none'; U.util.setText(w, ''); }
    const q = $('btnTpQuit');
    if (q) {
      q.style.display = '';
      U.util.setText(q, info.coop ? (info.isHost ? 'みんなで やめる' : 'へやを出る') : 'ここで やめる');
    }
    const box = $('tpCards');
    clear(box);
    let chosen = false;
    choices.forEach(function (c, i) {
      const K = T.KINDS[c.kind], chip = T.CHIP_MAP[c.chip];
      const card = mk('button', 'tpCard s' + c.stars + (c.kind === 'boss' ? ' boss' : ''));
      card.type = 'button';
      card.setAttribute('data-i', String(i));
      const door = mk('div', 'tpDoor');
      door.appendChild(mk('b', null, c.floor + 'F'));
      door.appendChild(mk('span', null, K.name));
      door.appendChild(mk('em', null, stars(c.stars)));
      card.appendChild(door);
      card.appendChild(mk('small', 'tpKind', K.desc + (c.stars >= 3 ? '（てきが つよい）' : '')));
      const cp = mk('div', 'tpChip');
      cp.appendChild(mk('b', null, chip.name));
      if (c.mult > 1) cp.appendChild(mk('em', null, '×' + c.mult));
      card.appendChild(cp);
      card.appendChild(mk('small', 'tpDesc', chip.desc + (c.mult > 1 ? '（2こ ぶん）' : '')));
      card.addEventListener('click', function () {
        if (chosen) return;
        chosen = true;
        U.util.audioWake(); U.util.sfx('chip');
        onChoose(i);
      });
      box.appendChild(card);
    });
    chipRow($('tpChips'), info.chips);
    U.show('scTowerPick');
  }

  /* みんなで: えらんだあと「みんなを まっています」。o = {mine: えらんだ番号（-1 = まだ）, picked, need, left: のこり秒, host} */
  function towerPickWait(o) {
    const w = $('tpWait');
    if (!w || U.current !== 'scTowerPick') return;
    const cards = $('tpCards') ? $('tpCards').children : [];
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const mine = o.mine >= 0 && String(o.mine) === c.getAttribute('data-i');
      c.classList.toggle('picked', mine);
      c.classList.toggle('dim', o.mine >= 0 && !mine);
      c.disabled = o.mine >= 0;
    }
    let t = '';
    if (o.mine >= 0) t = '✓ えらんだ！ みんなを まっています（' + (o.picked | 0) + ' / ' + (o.need | 0) + '）';
    else if (o.need > 1) t = 'えらんだ人 ' + (o.picked | 0) + ' / ' + (o.need | 0);
    if (o.left > 0) t += (t ? ' ・ ' : '') + 'のこり ' + o.left + '秒で すすみます';
    w.style.display = t ? '' : 'none';
    U.util.setText(w, t);
  }

  function towerResult(info) {
    const mk = U.util.mk, clear = U.util.clear;
    const t = $('trTitle');
    clear(t);
    t.style.color = info.win ? '#ffd23d' : '#ffb3c0';
    t.appendChild(D.createTextNode(info.win ? 'CLEAR!' : 'GAME OVER'));
    t.appendChild(mk('small', null, info.win ? '塔を のぼりきった！ ' + info.diffName + ' せいは！' : info.floor + 'F で おわり…'));
    const f = $('trFloor');
    clear(f);
    f.appendChild(mk('b', null, (info.win ? info.top : info.floor) + 'F'));
    f.appendChild(mk('span', null, ' / ' + info.top + 'F'));
    const st = $('trStats');
    clear(st);
    const row = (k, v) => { const d = mk('div', 'trRow'); d.appendChild(mk('span', null, k)); d.appendChild(mk('b', null, v)); st.appendChild(d); };
    row('むずかしさ', info.diffName + (info.coop ? '（みんなで ' + info.n + '人）' : ''));
    if (info.coop && info.names && info.names.length) row('なかま', info.names.join('・'));
    row(info.coop ? 'さいこう記録（みんなで）' : 'さいこう記録', info.best > info.top ? 'せいは' : info.best + 'F' + (info.newBest ? ' きろくこうしん！' : ''));
    row(info.coop ? 'みんなで たおした数' : 'たおした数', String(info.kills));
    row('やられた数', String(info.deaths));
    row('じかん', fmtTime(info.time));
    chipRow($('trChips'), info.chips);
    /* ボタン: ひとり = もう一回 / 町へ。みんなで = ロビーへ（ホスト）/ へやを出て 町へ */
    const again = $('btnTrAgain'), home = $('btnTrTitle');
    if (info.coop) {
      again.style.display = info.isHost ? '' : 'none';
      U.util.setText(again, 'ロビーへ（もう一回）');
      U.util.setText(home, 'へやを出て 町へ');
      U.msg('trMsg', info.isHost ? '「ロビーへ」で みんな ロビーに もどって もう一回 のぼれるよ' : 'ホストが ロビーに もどると いっしょに もどります');
    } else {
      again.style.display = '';
      U.util.setText(again, 'もう一回');
      U.util.setText(home, '町へ');
      U.msg('trMsg', info.win ? 'おめでとう！ つぎは もっと むずかしく してみよう' : 'チップの えらびかたを かえて もう一回！');
    }
    lastTowerCoop = !!info.coop;
    U.show('scTowerResult');
    U.util.sfx(info.win ? 'win' : 'lose');
  }
  let lastTowerCoop = false;

  /* ======================================================================
     勝ったチームのダンス（文字だけ。絵は dance.js）
     ====================================================================== */
  function danceShow(on, info) {
    const el = $('danceOv');
    if (!el) return;
    if (!on) { el.classList.remove('on'); return; }
    const w = info.winner | 0;
    const tc = (CS.TEAM_CSS && CS.TEAM_CSS[w]) || '#7fd6ff';
    el.style.setProperty('--tc', tc);
    /* 負けたときの「LOSE」は 勝ったチームの色にしない */
    $('dvTitle').style.color = info.mine || info.tower ? '' : '#b8c4dc';
    U.util.setText($('dvTitle'), info.tower ? 'CLEAR!' : info.mine ? 'WIN!' : 'LOSE…');
    U.util.setText($('dvSub'), info.tower ? '塔を のぼりきった！' : ((CS.TEAM_NAMES && CS.TEAM_NAMES[w]) || '') + 'チームの勝ち！');
    U.util.setText($('dvNames'), (info.names || []).join('  ・  '));
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  /* ======================================================================
     マップをつくる
     ====================================================================== */
  let delArm = '';
  function renderMaps() {
    const CM = CS.CustomMaps, mk = U.util.mk, clear = U.util.clear;
    const list = CM.list();
    U.util.setText($('mapsCount'), '（' + list.length + ' / ' + CM.MAX_MAPS + '）');
    const box = $('myMaps');
    clear(box);
    if (!list.length) box.appendChild(mk('div', 'hint', 'まだ ありません。上の「あたらしく つくる」から はじめよう！'));
    for (const m of list) {
      const card = mk('div', 'myMap glass');
      const cv = D.createElement('canvas');
      cv.className = 'mthumb';
      CM.thumb(m, cv);
      card.appendChild(cv);
      const info = mk('div', 'mmInfo');
      info.appendChild(mk('b', null, m.name));
      const dt = new Date(m.t || 0);
      info.appendChild(mk('small', null, m.W + '×' + m.D + ' ・ ' + (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + dt.getHours() + ':' + String(dt.getMinutes()).padStart(2, '0')));
      /* みんなのステージに 公開中なら しるし（中身を かえたら「公開を更新」で みんなのも かわる） */
      const pubSid = CS.Stages ? CS.Stages.publishedOf(m.id) : '';
      if (pubSid) info.appendChild(mk('small', 'mmPub', '公開中'));
      card.appendChild(info);
      const btns = mk('div', 'mmBtns');
      btns.appendChild(button('へんしゅう', 'pink sm', function () { U.util.call('editMap', m.id); }, 'ok'));
      btns.appendChild(button('たたかう', 'sm', function () {
        CS.Settings.cpuMap = 'c:' + m.id;
        U.util.saveSoon();
        U.open('scCpu', 'scMaps');
      }));
      if (CS.Stages && U.publishMap) {
        btns.appendChild(button(pubSid ? '公開を更新' : '公開する', 'sm pubBtn', function () {
          U.publishMap(m.id, function () { if (U.current === 'scMaps') renderMaps(); });
        }, 'ok'));
      }
      btns.appendChild(button('コピー', 'ghost sm', function () {
        const c = Object.assign({}, m, { id: '', name: m.name.slice(0, 12) + 'のコピー' });
        const s = CM.save(Object.assign(c, { id: Math.random().toString(36).slice(2, 10) }));
        U.toast(s ? 'コピーしました' : 'マップが いっぱいです（' + CM.MAX_MAPS + 'こまで）');
        renderMaps();
      }));
      btns.appendChild(button(delArm === m.id ? 'ほんとうに けす？' : 'けす', 'ghost sm' + (delArm === m.id ? ' warn' : ''), function () {
        if (delArm !== m.id) { delArm = m.id; renderMaps(); setTimeout(function () { if (delArm === m.id) { delArm = ''; if (U.current === 'scMaps') renderMaps(); } }, 3000); return; }
        delArm = '';
        CM.remove(m.id);
        /* 公開していたステージは のこる（やめるのは「みんなのステージ」の じぶんの から） */
        U.toast(pubSid ? 'けしました（公開した ステージは のこっています）' : 'けしました');
        renderMaps();
      }, 'back'));
      card.appendChild(btns);
      box.appendChild(card);
    }
  }

  function buildTemplates() {
    const g = $('mkGrid');
    if (!g || g.childNodes.length) return;
    const items = [
      ['empty', 's', 'まっさら（小）', '24×24'], ['empty', 'm', 'まっさら（中）', '32×32'], ['empty', 'l', 'まっさら（大）', '40×40'],
      ['plaza', '', 'キューブ広場から', 'いまのマップを かえる'], ['towers', '', 'ツインタワーから', 'いまのマップを かえる'], ['depot', '', 'ブロック倉庫から', 'いまのマップを かえる']
    ];
    for (const it of items) {
      const b = U.util.mk('button', 'btn mkBtn');
      b.type = 'button';
      b.appendChild(U.util.mk('b', null, it[2]));
      b.appendChild(U.util.mk('small', null, it[3]));
      b.addEventListener('click', function () { U.util.audioWake(); U.util.sfx('ok'); U.util.call('newMap', it[0], it[1]); });
      g.appendChild(b);
    }
  }

  /* ---------- エディターの HUD ---------- */
  function editorShow(on, ed) {
    const el = $('edHud');
    if (!el) return;
    el.classList.toggle('on', !!on);
    if (D.body) D.body.classList.toggle('editing', !!on);
    if (on) buildBar(ed);
  }
  function buildBar(ed) {
    const bar = $('edBar');
    if (!bar) return;
    U.util.clear(bar);
    const pal = CS.CustomMaps.THEMES[ed.map.theme] ? CS.CustomMaps.THEMES[ed.map.theme].palette : CS.CustomMaps.THEMES.plaza.palette;
    ed.TOOLS.forEach(function (t, i) {
      const b = U.util.mk('button', 'edSlot');
      b.type = 'button';
      const sw = U.util.mk('i', 'edSw');
      if (t.kind === 'block') {
        const c = pal[t.b] || [0.5, 0.5, 0.5];
        sw.style.background = 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
        if (t.b === CS.BLOCK.GLOW) sw.classList.add('glow');
      } else {
        sw.classList.add('spawn');
        sw.style.background = CS.TEAM_CSS[t.team];
        sw.textContent = '⚑';
      }
      b.appendChild(sw);
      b.appendChild(U.util.mk('small', null, t.name));
      b.appendChild(U.util.mk('u', null, String((i + 1) % 10)));
      b.addEventListener('click', function (e) { e.stopPropagation(); U.util.audioWake(); ed.setTool(i); ed._hud(true); });
      bar.appendChild(b);
    });
  }
  function editorHud(s) {
    U.util.setText($('edName'), s.name);
    U.util.setText($('edState'), (s.fly ? 'とぶ' : 'あるく') + ' ・ ' + (s.sym ? 'たいしょう ON' : 'たいしょう OFF') + ' ・ スタート あか' + s.spawns[0] + ' あお' + s.spawns[1] + (s.dirty ? ' ・ ＊まだ ほぞんしていない' : ''));
    const slots = $('edBar') ? $('edBar').children : [];
    for (let i = 0; i < slots.length; i++) slots[i].classList.toggle('sel', i === s.tool);
    $('edSymBtn').classList.toggle('sel', !!s.sym);
    U.util.setText($('edFlyBtn'), s.fly ? 'とぶ' : 'あるく');
    $('edUndoBtn').disabled = !s.canUndo;
    U.util.setText($('edTool'), s.tools[s.tool].name);
  }
  function editorLock(v) {
    const el = $('edLock');
    if (el && el._v !== !!v) { el._v = !!v; el.classList.toggle('on', !!v); }
  }

  function refreshEdMenu() {
    const ed = editor();
    if (!ed || !ed.map) return;
    $('edNameIn').value = ed.map.name;
    const sel = $('edTheme');
    U.util.clear(sel);
    for (const id of CS.CustomMaps.THEME_IDS) {
      const o = D.createElement('option');
      o.value = id; o.textContent = CS.CustomMaps.THEMES[id].name;
      if (id === ed.map.theme) o.selected = true;
      sel.appendChild(o);
    }
    const pub = CS.Stages ? CS.Stages.publishedOf(ed.map.id) : '';
    U.msg('edMenuMsg', (ed.dirty ? '＊まだ ほぞんしていない へんこうが あります' : 'ほぞんずみ') + (pub ? ' ・ 公開中' : ''));
    const pb = $('btnEdPub');
    if (pb) { pb.style.display = CS.Stages && U.publishMap ? '' : 'none'; U.util.setText(pb, pub ? '公開を更新する（いまの中身で）' : 'みんなに公開する'); }
  }

  /* ======================================================================
     はじめ
     ====================================================================== */
  function init(h) {
    U = CS.UI; H = h;
    const tap = U.util.tap;

    /* 塔のぼり */
    U.addScreen('scTower', refreshTower);
    tap('btnTower', function () { U.open('scTower', 'scTitle'); }, 'ok');
    tap('btnTwBack', function () { U.back('scTower'); }, 'back');
    tap('btnTwLoadout', function () { U.openLoadout('scTower'); });
    tap('btnTwGo', function () {
      if (CS.saveSettings) CS.saveSettings();
      U.msg('twMsg', 'じゅんびしています…');
      U.util.call('tower', { diff: CS.Settings.towerDiff });
      U.msg('twMsg', '');
    }, 'go');
    /* v4: みんなで塔のぼり（へやを作る。むずかしさは ここで えらんだもの） */
    tap('btnTwCoop', function () {
      if (CS.saveSettings) CS.saveSettings();
      U.util.call('create', 'tower', null, null);
    }, 'ok');
    tap('btnTpQuit', function () {
      const g = game();
      if (!g || !g.tower) return;
      if (g.tower.coop && !g.isHost) { U.util.call('toTitle'); return; }     // ゲスト: へやを出る
      g._towerOver(false);
    }, 'back');
    tap('btnTrAgain', function () {
      const g = game();
      if (lastTowerCoop && g && g.room) { U.util.call('again'); return; }    // みんなで: ロビーへ
      U.util.call('tower', { diff: CS.Settings.towerDiff });
    }, 'ok');
    tap('btnTrTitle', function () { U.util.call('toTitle'); }, 'back');
    U.addScreen('scMenu', function () {
      const g = game();
      const box = $('menuChips');
      if (!box) return;
      const on = !!(g && g.tower && g._towerInfo);
      box.style.display = on ? '' : 'none';
      if (on) chipRow(box, g._towerInfo(false).chips);
    });

    /* ダンス: タップでスキップ */
    const dv = $('danceOv');
    if (dv) dv.addEventListener('click', function () { U.util.call('skipDance'); });

    /* マップをつくる */
    U.addScreen('scMaps', function () { buildTemplates(); renderMaps(); });
    tap('btnMaps', function () { U.open('scMaps', 'scTitle'); }, 'ok');
    tap('btnMapsBack', function () { U.back('scMaps'); }, 'back');
    U.addScreen('scEdMenu', refreshEdMenu);
    tap('btnEdResume', function () { U.util.call('edResume'); }, 'ok');
    tap('btnEdSave', function () { U.util.call('edSave'); refreshEdMenu(); }, 'ok');
    tap('btnEdTest', function () { U.util.call('edTest'); }, 'go');
    /* みんなに公開（いまの中身を ほぞんしてから） */
    tap('btnEdPub', function () {
      const ed = editor();
      if (!ed || !ed.map || !U.publishMap) return;
      if (!U.util.call('edSave')) return;
      refreshEdMenu();
      U.publishMap(ed.map.id, function () { if (U.current === 'scEdMenu') refreshEdMenu(); });
    }, 'ok');
    tap('btnEdExit', function () { U.util.call('edExit', true); }, 'ok');
    let discardArm = 0;
    tap('btnEdDiscard', function () {
      const ed = editor();
      if (ed && ed.dirty && !discardArm) {
        discardArm = 1;
        U.util.setText($('btnEdDiscard'), 'ほんとうに？ もう一度おすと すてます');
        setTimeout(function () { discardArm = 0; U.util.setText($('btnEdDiscard'), 'ほぞんしないで おわる'); }, 3000);
        return;
      }
      discardArm = 0;
      U.util.setText($('btnEdDiscard'), 'ほぞんしないで おわる');
      U.util.call('edExit', false);
    }, 'back');
    const nameIn = $('edNameIn');
    if (nameIn) nameIn.addEventListener('change', function () { const ed = editor(); if (ed) { ed.rename(nameIn.value); refreshEdMenu(); } });
    const th = $('edTheme');
    if (th) th.addEventListener('change', function () { const ed = editor(); if (ed) { ed.setTheme(th.value); buildBar(ed); refreshEdMenu(); } });
    /* HUD のボタン */
    const edBtn = function (id, fn) {
      const el = $(id);
      if (!el) return;
      el.addEventListener('click', function (e) { e.stopPropagation(); U.util.audioWake(); const ed = editor(); if (ed && ed.active && !ed.paused) { fn(ed); ed._hud(true); } });
    };
    edBtn('edMenuBtn', function () { if (CS.editor && CS.editor.onMenu) CS.editor.onMenu(); });
    edBtn('edUndoBtn', function (ed) { ed.undoLast(); });
    edBtn('edSymBtn', function (ed) { ed.toggleSym(); });
    edBtn('edFlyBtn', function (ed) { ed.toggleFly(); });
    const lock = $('edLock');
    if (lock) lock.addEventListener('click', function () { U.util.audioWake(); try { CS.Input.requestLock(); } catch (e) {} });
  }

  CS.UI.towerPick = towerPick;
  CS.UI.towerPickWait = towerPickWait;
  CS.UI.towerResult = towerResult;
  CS.UI.danceShow = danceShow;
  CS.UI.editorShow = editorShow;
  CS.UI.editorHud = editorHud;
  CS.UI.editorLock = editorLock;
  CS.UI.addInit(init);
})();
