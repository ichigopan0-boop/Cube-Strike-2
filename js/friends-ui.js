/* ==========================================================================
   CUBE STRIKE — friends-ui.js
   フレンドの画面（v3）: フレンド一覧（オンラインかどうか・いまの状態）/ コードで申請 / 申請のOK・ことわる /
   いっしょに遊んだ人 / チャット / へやに さそう・フレンドのへやに 参加 / おしらせ（ポップアップ）。
   中身は friends.js の CS.Friends.hub。ここは見せるだけ。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;
  const D = document;
  const $ = (id) => D.getElementById(id);

  const ST_TEXT = {
    menu: 'オンライン', lobby: 'へやにいる', match: 'しあい中', cpu: 'コンピューター戦', tower: '塔のぼり中',
    practice: 'ためし撃ち中', edit: 'マップを作っている', town: '町にいる'
  };
  const QUICK = ['あそぼう！', 'いまから いける？', 'へやに きて！', 'ありがとう！', 'GG！', 'またね！'];
  const NET_TEXT = {
    off: 'フレンドの通信は まだ はじまっていません',
    connecting: 'つないでいます…',
    online: '● オンライン（フレンドから あなたが見えます）',
    dup: 'ほかのタブで CUBE STRIKE 2 を開いています（そちらを閉じてね）',
    offline: '中継サーバーに つながりません。あとで もう一度 ためします',
    unsupported: 'このブラウザでは フレンド機能が使えません'
  };

  let U = null, hub = null, handlers = null;
  let chatCode = '';          // いま開いているチャットの相手
  let renderT = 0;
  let removeArm = 0;
  let pop = null;             // いま出しているポップアップ {kind, data}
  let popTimer = 0;

  function fc(code) { return CS.Friends.fmtCode(code); }
  function nameOf(p) { return p && p.name ? p.name : fc(p ? p.code : ''); }
  function inMatch() { return !!(D.body && D.body.classList.contains('in-match')); }
  function game() { return CS.debug && CS.debug.game; }
  function inLobby() { const g = game(); return !!(g && g.mode === 'lobby' && g.room && g.room.code); }

  function statusText(f) {
    if (!f.online) return 'オフライン';
    const st = f.st || { s: 'menu' };
    let t = ST_TEXT[st.s] || 'オンライン';
    if (st.s === 'lobby' && st.max) t += '（' + (st.n | 0) + '/' + st.max + '人）';
    return t;
  }
  function canJoin(f) {
    const st = f && f.st;
    return !!(f && f.online && st && st.s === 'lobby' && st.open && st.room);
  }
  function roomInfo() {
    const g = game();
    if (!g || !g.room) return null;
    const v = g.lobbyView() || {};
    /* みんなで塔のぼり: マップと ルールの かわりに むずかしさ */
    if (g.room.mode === 'tower') return { room: g.room.code, mode: 'tower', mapName: towerLabel(g.room) };
    if (g.room.mode === 'defense') return { room: g.room.code, mode: 'defense', mapName: defLabel(g.room) };
    if (g.room.mode === 'tourney') return { room: g.room.code, mode: 'tourney', mapName: g.room.tourney ? g.room.tourney.n + '人' : '' };
    if (g.room.mode === 'raid' && CS.Raid) return { room: g.room.code, mode: 'raid', mapName: CS.Raid.bossOf(CS.Raid.cleanCfg(g.room.raid).boss).name };
    if (g.room.mode === 'castle' && CS.Castle) { const c = CS.Castle.cleanCfg(g.room.castle); return { room: g.room.code, mode: 'castle', mapName: c.n + '対' + c.n }; }
    return { room: g.room.code, mode: g.room.mode, mapName: v.mapName || '', rule: g.room.rule };
  }
  function towerLabel(room) {
    const D = CS.Tower && CS.Tower.DIFFS, t = room && room.tower;
    return 'むずかしさ ' + (D && t && D[t.diff] ? D[t.diff].name : 'ふつう');
  }
  function defLabel(room) {
    const DF = CS.Defense, d = room && room.defense;
    return 'むずかしさ ' + (DF && d ? DF.diffOf(d.diff).name : 'ふつう');
  }
  function modeText(m) { return m === 'tower' ? 'みんなで塔のぼり' : m === 'defense' ? 'みんなで クリスタルまもり' : m === 'tourney' ? 'みんなで トーナメント' : m === 'raid' ? 'みんなで ボスレイド' : m === 'castle' ? '城バトル' : m ? m.replace('v', '対') : ''; }

  /* ---------------- 描く（まとめて） ---------------- */
  function renderSoon() {
    if (renderT) return;
    renderT = setTimeout(function () { renderT = 0; renderAll(); }, 40);
  }
  function renderAll() {
    badge();
    if (U.current === 'scFriends') renderFriends();
    if (U.current === 'scChat') renderChat(false);
    if (U.current === 'scLobby') renderLobbyInvite();
  }

  function badge() {
    const n = hub ? hub.badge() : 0;
    const b = $('frBadge');
    if (b) { b.textContent = n > 9 ? '9+' : String(n); b.style.display = n > 0 ? '' : 'none'; }
  }

  function button(text, cls, fn, sound) {
    const b = U.util.mk('button', 'btn ' + (cls || ''), text);
    b.type = 'button';
    b.addEventListener('click', function (e) { e.stopPropagation(); U.util.audioWake(); U.util.sfx(sound || 'click'); fn(e); });
    return b;
  }

  function renderFriends() {
    const mk = U.util.mk, clear = U.util.clear;
    U.util.setText($('frMyCode'), hub.codeText);
    U.util.setText($('frNet'), NET_TEXT[hub.net] || '');
    const netEl = $('frNet');
    if (netEl) netEl.classList.toggle('warn', hub.net !== 'online' && hub.net !== 'connecting');

    /* 受けた申請・さそい */
    const rb = $('frReqBox');
    clear(rb);
    const reqs = hub.data.inc, invs = hub.invites;
    if (reqs.length || invs.length) {
      const box = mk('div', 'glass frBox hot');
      box.appendChild(mk('h3', null, 'おしらせ'));
      for (const inv of invs) {
        const row = mk('div', 'frRow');
        const who = mk('div', 'frWho');
        who.appendChild(mk('b', null, '' + (inv.name || fc(inv.code)) + ' から さそい'));
        who.appendChild(mk('small', null, [modeText(inv.mode), inv.mapName || '', inv.rule && inv.mode !== 'tower' && inv.mode !== 'defense' && inv.mode !== 'tourney' && inv.mode !== 'raid' && inv.mode !== 'castle' ? U.ruleText(inv.rule) : ''].filter(Boolean).join(' ・ ')));
        row.appendChild(who);
        row.appendChild(button('参加する', 'pink sm', function () { joinInvite(inv); }, 'ok'));
        row.appendChild(button('けす', 'ghost sm', function () { hub.dropInvite(inv); }, 'back'));
        box.appendChild(row);
      }
      for (const p of reqs) {
        const row = mk('div', 'frRow');
        const who = mk('div', 'frWho');
        who.appendChild(mk('b', null, '' + nameOf(p) + ' から フレンド申請'));
        who.appendChild(mk('small', null, fc(p.code)));
        row.appendChild(who);
        row.appendChild(button('OK', 'green sm', function () { hub.accept(p.code); U.toast(nameOf(p) + ' と フレンドになりました'); }, 'ok'));
        row.appendChild(button('ことわる', 'ghost sm', function () { hub.decline(p.code); }, 'back'));
        box.appendChild(row);
      }
      rb.appendChild(box);
    }

    /* フレンド */
    const list = hub.friendList();
    const on = list.filter((f) => f.online).length;
    U.util.setText($('frCount'), list.length ? '（' + list.length + '人・オンライン ' + on + '人）' : '');
    const fl = $('frList');
    clear(fl);
    if (!list.length) fl.appendChild(mk('div', 'hint frEmpty', 'まだ フレンドがいません。コードを送りあうか、いっしょに遊んだ人に 申請してね。'));
    const lobby = inLobby();
    for (const f of list) {
      const row = mk('div', 'frRow frFriend' + (f.online ? ' on' : ''));
      row.appendChild(mk('i', 'frDot'));
      const who = mk('div', 'frWho');
      who.appendChild(mk('b', null, f.name || fc(f.code)));
      who.appendChild(mk('small', null, statusText(f)));
      row.appendChild(who);
      const chat = button('チャット' + (f.unread ? ' ' + f.unread : ''), 'sm' + (f.unread ? ' pink' : ' ghost'), function () { openChat(f.code); });
      row.appendChild(chat);
      if (lobby && f.online) row.appendChild(button('さそう', 'sm', function () { invite(f.code); }, 'ok'));
      else if (canJoin(f)) row.appendChild(button('参加', 'green sm', function () { joinFriend(f); }, 'ok'));
      row.addEventListener('click', function () { U.util.sfx('click'); openChat(f.code); });
      fl.appendChild(row);
    }

    /* 送った申請 */
    const ob = $('frOutBox');
    clear(ob);
    if (hub.data.out.length) {
      const box = mk('div', 'frBox');
      box.appendChild(mk('h3', null, '送った申請（相手が OK すると フレンドに）'));
      for (const p of hub.data.out) {
        const row = mk('div', 'frRow');
        const who = mk('div', 'frWho');
        who.appendChild(mk('b', null, nameOf(p)));
        who.appendChild(mk('small', null, fc(p.code) + ' ・ へんじ まち'));
        row.appendChild(who);
        row.appendChild(button('とりけす', 'ghost sm', function () { hub.cancel(p.code); }, 'back'));
        box.appendChild(row);
      }
      ob.appendChild(box);
    }

    /* いっしょに遊んだ人 */
    const rl = $('frRecent');
    clear(rl);
    const rec = hub.data.recent.filter((p) => !hub.isFriend(p.code));
    if (!rec.length) rl.appendChild(mk('div', 'hint frEmpty', 'オンラインで いっしょに遊んだ人が ここに出ます。'));
    for (const p of rec) {
      const row = mk('div', 'frRow');
      const who = mk('div', 'frWho');
      who.appendChild(mk('b', null, nameOf(p)));
      who.appendChild(mk('small', null, fc(p.code) + ' ・ ' + ago(p.t)));
      row.appendChild(who);
      if (hub.isOut(p.code)) row.appendChild(mk('span', 'fchip', '申請中…'));
      else row.appendChild(button('＋フレンド申請', 'sm', function () { request(p.code, p.name); }, 'ok'));
      rl.appendChild(row);
    }
  }

  function ago(t) {
    const s = Math.max(0, (Date.now() - (+t || 0)) / 1000);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + '分まえ';
    if (s < 86400) return Math.round(s / 3600) + '時間まえ';
    return Math.round(s / 86400) + '日まえ';
  }

  /* ---------------- チャット ---------------- */
  function openChat(code) {
    chatCode = CS.Friends.normCode(code);
    removeArm = 0;
    U.open('scChat', U.current === 'scChat' ? 'scFriends' : (U.current || 'scFriends'));
  }
  function renderChat(scroll) {
    const mk = U.util.mk, clear = U.util.clear;
    const f = hub.friendList().find((x) => x.code === chatCode);
    if (!f) { U.show('scFriends'); return; }
    U.util.setText($('chatName'), f.name || fc(f.code));
    U.util.setText($('chatSt'), statusText(f) + ' ・ ' + fc(f.code));
    $('chatSt').classList.toggle('on', f.online);
    $('btnChatInv').style.display = inLobby() && f.online ? '' : 'none';
    $('btnChatJoin').style.display = !inLobby() && canJoin(f) ? '' : 'none';
    U.util.setText($('btnChatRemove'), removeArm ? 'もう一度おすと フレンドをやめます' : 'フレンドをやめる');
    const log = $('chatLog');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    clear(log);
    const msgs = hub.chat(chatCode);
    if (!msgs.length) log.appendChild(mk('div', 'hint chatEmpty', f.online ? 'メッセージを送ってみよう！' : 'いまオフラインです。送ったメッセージは 相手がオンラインになったら とどきます。'));
    for (const m of msgs) {
      const b = mk('div', 'bub ' + (m.me ? 'me' : 'them'));
      b.appendChild(mk('span', null, m.text));
      const tm = new Date(m.t || 0);
      b.appendChild(mk('small', null, (m.me && m.pend ? 'まだ とどいていない ・ ' : '') + tm.getHours() + ':' + String(tm.getMinutes()).padStart(2, '0')));
      log.appendChild(b);
    }
    if (scroll || atBottom) log.scrollTop = log.scrollHeight;
    hub.markRead(chatCode);
  }
  function sendChat(text) {
    const inp = $('inChat');
    const t = text != null ? text : (inp ? inp.value : '');
    if (!String(t).trim()) return;
    if (hub.sendChat(chatCode, t)) {
      if (text == null && inp) inp.value = '';
      U.util.sfx('click');
      renderChat(true);
    }
  }

  /* ---------------- さそう・参加する ---------------- */
  function invite(code) {
    const info = roomInfo();
    if (!info) { U.toast('へやに入ってから さそってね'); return; }
    if (hub.invite(code, info)) U.toast(hub.nameOf(code) + ' を さそいました');
    else U.toast('いまは さそえません（オフライン？）');
  }
  function joinFriend(f) {
    if (!canJoin(f)) { U.toast('いまは 参加できません'); return; }
    U.joinCode(f.st.room);
  }
  function joinInvite(inv) {
    hub.dropInvite(inv);
    hidePop();
    const g = game();
    if (g && g.room && g.room.code === inv.room) { U.toast('もう そのへやに います'); return; }
    if (inMatch()) { U.toast('しあいが終わってから 参加してね'); return; }
    U.joinCode(inv.room);
  }
  function request(code, name) {
    const r = hub.request(code, name);
    const WHY = {
      sent: '申請を送りました（相手が OK すると フレンドに）', accepted: 'フレンドになりました！',
      code: 'フレンドコードは 8文字です', self: 'それは あなたのコードです', friend: 'もう フレンドです', full: 'フレンドが いっぱいです'
    };
    U.toast(WHY[r.why] || '申請できませんでした');
    return r;
  }

  /* ---------------- ロビー: オンラインのフレンドを さそう ---------------- */
  function renderLobbyInvite() {
    const mk = U.util.mk, clear = U.util.clear;
    const list = hub.friendList();
    const online = list.filter((f) => f.online);
    U.util.setText($('btnLobbyInvite'), 'フレンドをさそう' + (online.length ? '（' + online.length + '人オンライン）' : ''));
    const box = $('lobbyInvList');
    if (!box || !$('lobbyInvite').classList.contains('on')) return;
    clear(box);
    if (!list.length) { box.appendChild(mk('div', 'hint', 'まだ フレンドがいません（タイトルの「フレンド」から作れます）')); return; }
    if (!online.length) { box.appendChild(mk('div', 'hint', 'いま オンラインのフレンドは いません')); }
    for (const f of online) {
      const row = mk('div', 'frRow on');
      row.appendChild(mk('i', 'frDot'));
      const who = mk('div', 'frWho');
      who.appendChild(mk('b', null, f.name));
      who.appendChild(mk('small', null, statusText(f)));
      row.appendChild(who);
      row.appendChild(button('さそう', 'pink sm', function () { invite(f.code); }, 'ok'));
      box.appendChild(row);
    }
  }

  /* ---------------- おしらせ（ポップアップ） ---------------- */
  function showPop(kind, data, text, yes, no) {
    const el = $('frPop');
    if (!el) return;
    pop = { kind: kind, data: data };
    U.util.setText($('frPopText'), text);
    U.util.setText($('frPopYes'), yes);
    U.util.setText($('frPopNo'), no);
    el.classList.add('on');
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 20000);
    U.util.sfx('notify');
  }
  function hidePop() {
    pop = null;
    clearTimeout(popTimer);
    const el = $('frPop');
    if (el) el.classList.remove('on');
  }

  function onInvite(inv) {
    renderSoon();
    const who = inv.name || fc(inv.code);
    if (inMatch()) { U.toast('' + who + ' から さそいが来ました（あとで フレンドの画面から 参加できます）'); return; }
    showPop('inv', inv, '' + who + ' が へやに さそっています' + (inv.mapName ? '（' + inv.mapName + '）' : ''), '参加する', 'あとで');
  }
  function onRequest(code, name) {
    renderSoon();
    if (inMatch()) { U.toast('' + name + ' から フレンド申請が来ました'); return; }
    showPop('req', { code: code, name: name }, '' + name + ' から フレンド申請が来ました', 'OK', 'あとで');
  }
  function onChat(code, incoming) {
    renderSoon();
    if (!incoming) return;
    if (U.current === 'scChat' && chatCode === code) { U.util.sfx('notify'); return; }
    const who = hub.nameOf(code) || fc(code);
    if (inMatch()) return;
    const log = hub.chat(code);
    const last = log[log.length - 1];
    U.toast('' + who + '：' + (last ? last.text : ''));
    U.util.sfx('notify');
  }

  /* ---------------- はじめ ---------------- */
  function init(h) {
    U = CS.UI; handlers = h;
    hub = CS.Friends && CS.Friends.hub;
    if (!hub) {
      const b = $('btnFriends');
      if (b) b.style.display = 'none';
      const li = $('btnLobbyInvite');
      if (li) li.style.display = 'none';
      return;
    }
    const tap = U.util.tap;
    U.addScreen('scFriends', function () { hub.activate(); renderFriends(); });
    U.addScreen('scChat', function () { renderChat(true); });
    tap('btnFriends', function () { U.open('scFriends', 'scTitle'); }, 'ok');
    tap('btnFrBack', function () { U.back('scFriends'); }, 'back');
    tap('btnFrCopy', function () { copy(hub.codeText, 'フレンドコードを コピーしました'); });
    tap('btnFrShare', function () {
      const text = 'CUBE STRIKE 2 の フレンドコード: ' + hub.codeText;
      if (navigator.share) { try { const p = navigator.share({ title: 'CUBE STRIKE 2', text: text }); if (p && p.catch) p.catch(function () {}); return; } catch (e) {} }
      copy(text, 'フレンドコードを コピーしました');
    });
    const inFc = $('inFc');
    const add = function () {
      const r = request(inFc.value);
      if (r.ok) inFc.value = '';
      U.msg('frMsg', r.ok ? '' : ({ code: '8文字のコードを入れてね', self: 'それは あなたのコードです', friend: 'もう フレンドです', full: 'フレンドが いっぱいです' }[r.why] || ''), !r.ok);
    };
    tap('btnFrAdd', add, 'ok');
    if (inFc) {
      inFc.addEventListener('input', function () {
        const c = CS.Friends.normCode(inFc.value);
        const v = c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c;
        if (v !== inFc.value) inFc.value = v;
      });
      inFc.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    }

    /* チャット */
    tap('btnChatBack', function () { U.back('scChat'); }, 'back');
    tap('btnChatSend', function () { sendChat(); });
    tap('btnChatInv', function () { invite(chatCode); }, 'ok');
    tap('btnChatJoin', function () { const f = hub.friendList().find((x) => x.code === chatCode); joinFriend(f); }, 'ok');
    tap('btnChatRemove', function () {
      if (!removeArm) { removeArm = 1; renderChat(false); setTimeout(function () { removeArm = 0; if (U.current === 'scChat') renderChat(false); }, 3000); return; }
      const name = hub.nameOf(chatCode);
      hub.remove(chatCode);
      removeArm = 0;
      U.toast(name + ' と フレンドを やめました');
      U.show('scFriends');
    }, 'back');
    const inChat = $('inChat');
    if (inChat) inChat.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); } });
    const q = $('chatQuick');
    if (q) {
      for (const t of QUICK) {
        const b = U.util.mk('button', 'qchip', t);
        b.type = 'button';
        b.addEventListener('click', function () { U.util.audioWake(); sendChat(t); });
        q.appendChild(b);
      }
    }

    /* ロビー */
    tap('btnLobbyInvite', function () {
      const p = $('lobbyInvite');
      p.classList.toggle('on');
      hub.activate();
      renderLobbyInvite();
    });
    U.addScreen('scLobby', function () { renderLobbyInvite(); });

    /* ポップアップ */
    tap('frPopYes', function () {
      const p = pop;
      hidePop();
      if (!p) return;
      if (p.kind === 'inv') joinInvite(p.data);
      else if (p.kind === 'req') { hub.accept(p.data.code); U.toast(p.data.name + ' と フレンドになりました'); }
    }, 'ok');
    tap('frPopNo', function () { hidePop(); }, 'back');

    hub.on('change', renderSoon);
    hub.on('net', renderSoon);
    hub.on('invite', onInvite);
    hub.on('request', onRequest);
    hub.on('chat', onChat);
    hub.on('accepted', function (code, name) { renderSoon(); U.toast('' + (name || fc(code)) + ' と フレンドになりました'); U.util.sfx('ok'); });
    hub.on('declined', function (code, was) {
      renderSoon();
      if (was === 'out') U.toast((hub.nameOf(code) || fc(code)) + ' への申請は とどきませんでした');
    });
    badge();
  }

  function copy(text, okMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const p = navigator.clipboard.writeText(text);
        if (p && p.then) { p.then(function () { U.toast(okMsg); }, function () { U.toast(text); }); return; }
      }
    } catch (e) {}
    U.toast(text);
  }

  CS.UI.addInit(init);
})();
