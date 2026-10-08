/* ==========================================================================
   CUBE STRIKE — stages-ui.js
   「みんなのステージ」の画面（v3.1）と、じぶんのステージを公開するときの たしかめ。
   ・ならび: あたらしい順 / ★ほぞん / じぶんの。なまえ・作った人で さがせる
   ・くわしく: CPUと あそぶ / へやを作って 友達と / ★ほぞん / リンクをコピー / コピーして へんしゅう / かくす / 公開をやめる（じぶんのだけ）
   ・?stage=<ID> の リンクで来たら、そのステージを すぐ出す
   中身は stages.js の CS.Stages。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);
  let U = null;
  let filter = 'new';            // 'new' | 'saved' | 'mine'
  let query = '';
  let detail = '';               // くわしく を出している sid
  let wantSid = '';              // リンクで来た sid（とどいたら くわしく を出す）
  let unpubArm = '';
  let renderT = 0;

  const S = () => CS.Stages;
  function fmtDate(t) { const d = new Date(t || 0); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function thumb(cv, r) {
    const m = CS.CustomMaps.clean({ id: 'x', name: r.name, W: r.W, H: r.H, D: r.D, rle: r.rle, sp: r.sp, theme: r.theme });
    if (m) CS.CustomMaps.thumb(m, cv);
  }

  /* ---------------- 一覧 ---------------- */
  function renderSoon() {
    if (renderT) return;
    renderT = setTimeout(function () { renderT = 0; if (U.current === 'scStages') { render(); if (detail) renderDetail(); } }, 60);
  }

  function statusText(n) {
    const st = S().status;
    if (st === 'connecting') return 'みんなのステージを よみこんでいます…';
    if (st === 'error') return 'つながりませんでした（ネットを たしかめてね）。前に見たステージだけ 出しています';
    return '' + n + ' この ステージ';
  }

  function render() {
    const mk = U.util.mk, clear = U.util.clear;
    let list = S().list();
    const total = list.length;
    if (filter === 'saved') list = list.filter((r) => S().isSaved(r.sid));
    else if (filter === 'mine') list = list.filter((r) => S().isMine(r.sid));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => (r.name + ' ' + r.by).toLowerCase().indexOf(q) >= 0);
    U.msg('stStatus', statusText(total), S().status === 'error');
    const tabs = D.querySelectorAll('[data-stf]');
    for (let i = 0; i < tabs.length; i++) tabs[i].classList.toggle('sel', tabs[i].getAttribute('data-stf') === filter);
    const grid = $('stGrid');
    clear(grid);
    if (!list.length) {
      const empty = filter === 'mine' ? 'まだ 公開した ステージは ありません。「ステージをつくる」で 作って「公開する」を おしてね。'
        : filter === 'saved' ? '★ で ほぞんした ステージが ここに出ます。'
          : q ? 'みつかりませんでした。' : S().status === 'connecting' ? '' : 'まだ ステージが ありません。さいしょの 1こを 公開してみよう！';
      if (empty) grid.appendChild(mk('div', 'hint stEmpty', empty));
      return;
    }
    for (const r of list.slice(0, 120)) {
      const card = mk('button', 'stCard');
      card.type = 'button';
      const cv = D.createElement('canvas');
      cv.className = 'mthumb';
      thumb(cv, r);
      card.appendChild(cv);
      const info = mk('div', 'stInfo');
      info.appendChild(mk('b', null, r.name));
      info.appendChild(mk('small', null, 'by ' + r.by));
      info.appendChild(mk('small', 'stMeta', r.W + '×' + r.D + ' ・ ' + fmtDate(r.t)));
      card.appendChild(info);
      if (S().isMine(r.sid)) card.appendChild(mk('i', 'stBadge mine', 'じぶん'));
      else if (S().isSaved(r.sid)) card.appendChild(mk('i', 'stBadge', '★'));
      card.addEventListener('click', function () { U.util.audioWake(); U.util.sfx('click'); openDetail(r.sid); });
      grid.appendChild(card);
    }
  }

  /* ---------------- くわしく ---------------- */
  function openDetail(sid) {
    detail = sid;
    unpubArm = '';
    renderDetail();
  }
  function closeDetail() {
    detail = '';
    const el = $('stDetail');
    if (el) el.classList.remove('on');
  }
  function renderDetail() {
    const r = S().get(detail);
    const el = $('stDetail');
    if (!r) { closeDetail(); return; }
    el.classList.add('on');
    thumb($('stDThumb'), r);
    U.util.setText($('stDName'), r.name);
    U.util.setText($('stDBy'), 'つくった人: ' + r.by);
    U.util.setText($('stDMeta'), r.W + '×' + r.D + '×' + r.H + ' ・ ' + fmtDate(r.t) + ' ・ ID ' + r.sid);
    const mine = S().isMine(r.sid);
    U.util.setText($('btnStSave'), S().isSaved(r.sid) ? '★ ほぞんずみ' : '☆ ほぞん');
    $('btnStSave').classList.toggle('sel', S().isSaved(r.sid));
    $('btnStHide').style.display = mine ? 'none' : '';
    $('btnStUnpub').style.display = mine ? '' : 'none';
    U.util.setText($('btnStUnpub'), unpubArm === r.sid ? 'ほんとうに やめる？（もう一度おす）' : '公開をやめる');
  }

  function playCpu(sid) {
    S().noteRecent(sid);
    CS.Settings.cpuMap = 'p:' + sid;
    U.util.saveSoon();
    closeDetail();
    U.open('scCpu', 'scStages');
  }
  function playRoom(sid) {
    S().noteRecent(sid);
    closeDetail();
    if (U.openCreate) U.openCreate('p:' + sid, 'scStages');
  }
  function copyToEdit(sid) {
    const r = S().get(sid);
    if (!r) return;
    const name = (r.name.length > 12 ? r.name.slice(0, 12) : r.name) + 'のコピー';
    const saved = CS.CustomMaps.save({ id: Math.random().toString(36).slice(2, 10), name: name, W: r.W, H: r.H, D: r.D, rle: r.rle, sp: r.sp, theme: r.theme });
    if (!saved) { U.toast('じぶんのステージが いっぱいです（' + CS.CustomMaps.MAX_MAPS + 'こまで）'); return; }
    closeDetail();
    U.toast('コピーしました。じぶんの ステージとして へんしゅうできます');
    U.util.call('editMap', saved.id);
  }
  function copyText(text, okMsg) {
    if (U.copyText) { U.copyText(text, okMsg); return; }
    U.toast(text);
  }

  /* ---------------- 公開する（じぶんのステージ・エディターから） ---------------- */
  let confirmCb = null;
  function confirmBox(o, cb) {
    confirmCb = cb;
    U.util.setText($('cfTitle'), o.title || '');
    U.util.setText($('cfText'), o.text || '');
    U.util.setText($('cfOk'), o.ok || 'OK');
    U.util.setText($('cfNo'), o.no || 'やめる');
    $('csConfirm').classList.add('on');
  }
  function closeConfirm() { confirmCb = null; $('csConfirm').classList.remove('on'); }

  const ERR = {
    net: 'つながりませんでした。ネットを たしかめて、もう一度 ためしてね',
    big: 'ステージが 大きすぎて 公開できません',
    nocrypto: 'このブラウザでは 公開できません（ブラウザを 新しくしてね）',
    nomap: 'ステージが 見つかりません（先に ほぞんしてね）',
    notmine: 'じぶんの ステージでは ありません'
  };
  function errText(e) { return ERR[e && e.message] || '公開できませんでした'; }

  /* mapId = じぶんのマップの id。done(ok) は おわったら */
  function publishMap(mapId, done) {
    const m = CS.CustomMaps.get(mapId);
    if (!m) { U.toast(ERR.nomap); if (done) done(false); return; }
    if (!S().canPublish()) { U.toast(ERR.nocrypto); if (done) done(false); return; }
    const again = !!S().publishedOf(m.id);
    const name = String(CS.Settings.name || 'プレイヤー').slice(0, 10);
    confirmBox({
      title: again ? '公開を 更新する？' : 'みんなに 公開する？',
      text: '「' + m.name + '」を 公開すると、世界中の だれでも あそべるように なります（コンピューター戦でも、へやを作って 友達とでも）。' +
        'ステージの なまえ と あなたの プレイヤー名「' + name + '」が みんなに 見えます。' + (again ? ' いまの 中身で 上書きします。' : ''),
      ok: again ? '更新する' : '公開する'
    }, function () {
      U.toast('公開しています…');
      S().publish(m.id).then(function () {
        U.toast(again ? '公開を 更新しました！' : '公開しました！「みんなのステージ」に のりました');
        U.util.sfx('ok');
        if (done) done(true);
      }, function (e) {
        U.toast(errText(e));
        if (done) done(false);
      });
    });
  }

  /* ?stage=<ID> で来た */
  function openStageLink() {
    const sid = String(CS.query ? CS.query('stage') || '' : '').toLowerCase();
    if (!/^[0-9a-f]{10}-[a-z0-9]{1,12}$/.test(sid)) return false;
    wantSid = sid;
    U.open('scStages', 'scTitle');
    if (S().get(sid)) openDetail(sid);
    return true;
  }

  /* ---------------- はじめ ---------------- */
  function init() {
    U = CS.UI;
    if (!S() || !CS.CustomMaps) { const b = $('btnStages'); if (b) b.style.display = 'none'; return; }
    const tap = U.util.tap;
    U.addScreen('scStages', function () {
      render();
      S().refresh().then(function () {
        if (wantSid) {
          const sid = wantSid;
          wantSid = '';
          if (S().get(sid)) openDetail(sid);
          else U.toast('そのステージは 見つかりませんでした（公開が やめられたのかも）');
        }
        renderSoon();
      });
    }, function () { closeDetail(); closeConfirm(); S().close(); });
    tap('btnStages', function () { U.open('scStages', 'scTitle'); }, 'ok');
    tap('btnStBack', function () { U.back('scStages'); }, 'back');
    tap('btnStReload', function () { S().refresh(true).then(renderSoon); renderSoon(); });
    const tabs = D.querySelectorAll('[data-stf]');
    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { U.util.audioWake(); U.util.sfx('click'); filter = this.getAttribute('data-stf'); render(); });
    }
    const q = $('stSearch');
    if (q) q.addEventListener('input', function () { query = String(q.value || '').slice(0, 16); render(); });

    tap('btnStClose', closeDetail, 'back');
    tap('btnStCpu', function () { if (detail) playCpu(detail); }, 'go');
    tap('btnStRoom', function () { if (detail) playRoom(detail); }, 'ok');
    tap('btnStSave', function () { if (!detail) return; const on = S().save(detail); U.toast(on ? '★ ほぞんしました（マップを えらぶ画面にも 出ます）' : 'ほぞんを やめました'); renderDetail(); render(); });
    tap('btnStLink', function () { if (detail) copyText(S().shareUrl(detail), 'リンクを コピーしました。友達に 送ってね'); });
    tap('btnStCopy', function () { if (detail) copyToEdit(detail); });
    tap('btnStHide', function () { if (!detail) return; S().hide(detail, true); U.toast('このステージを かくしました'); closeDetail(); render(); }, 'back');
    tap('btnStUnpub', function () {
      if (!detail) return;
      if (unpubArm !== detail) { unpubArm = detail; renderDetail(); return; }
      const sid = detail;
      unpubArm = '';
      S().unpublish(sid).then(function () { U.toast('公開を やめました'); closeDetail(); render(); }, function (e) { U.toast(errText(e)); });
    }, 'back');
    /* 外側を おすと とじる */
    const dt = $('stDetail');
    if (dt) dt.addEventListener('click', function (e) { if (e.target === dt) closeDetail(); });

    /* たしかめ */
    tap('cfOk', function () { const cb = confirmCb; closeConfirm(); if (cb) cb(); }, 'ok');
    tap('cfNo', closeConfirm, 'back');
    /* Esc: たしかめ・くわしく を とじるだけ（うしろの画面の Esc＝エディターにもどる などは しない） */
    window.addEventListener('keydown', function (e) {
      const k = e.key || e.code;
      if (k !== 'Escape' && k !== 'Esc') return;
      const cf = $('csConfirm'), dt = $('stDetail');
      if (cf && cf.classList.contains('on')) { e.preventDefault(); e.stopPropagation(); closeConfirm(); }
      else if (dt && dt.classList.contains('on')) { e.preventDefault(); e.stopPropagation(); closeDetail(); }
    }, true);

    S().on('change', function () {
      /* リンクで来た ステージが とどいたら すぐ くわしく を出す（ぜんぶ とどくのを 待たない） */
      if (wantSid && U.current === 'scStages' && S().get(wantSid)) { const sid = wantSid; wantSid = ''; openDetail(sid); }
      renderSoon();
    });
  }

  CS.UI.publishMap = publishMap;
  CS.UI.openStageLink = openStageLink;
  CS.UI.addInit(init);
})();
