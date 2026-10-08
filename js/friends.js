/* ==========================================================================
   CUBE STRIKE — friends.js
   フレンド（v3）。サーバーは使わない。PeerJS の公開ブローカーに「じぶんのフレンドコード」の名前で
   待ち受けて、フレンドどうしが P2P でつながる（へやの通信 net.js とは べつの Peer）。
   ・フレンドコード: 8文字（ABCD-EFGH と表示）。はじめて使うときに作って localStorage に保存
   ・申請 → 相手が OK するとフレンド。いっしょに遊んだ人（recent）からも申請できる
   ・つながっているフレンドの いまの状態（タイトル / へやにいる / しあい中 …）がわかる
   ・へやにいるとき オンラインのフレンドを さそえる。フレンドのへやに 参加もできる
   ・チャットはフレンドどうしだけ。相手がオフラインなら、つぎにつながったときに届ける
   プロトコル（JSON。フレンドのつながりの上。hi の前は ほかのものを受けとらない）:
     {t:'hi', v:1, code, name, rel, st}  rel = 'f' フレンド / 'r' 申請中 / 'i' 申請を受けている / 'x' 知らない
     {t:'acc'} 申請OK / {t:'dec'} ことわる・やめる / {t:'st', st, name} 状態
     {t:'msg', id, text} → {t:'ack', id} / {t:'inv', room, mode, mapName, rule} さそい
     {t:'ping'} {t:'pong'} / {t:'bye'}
   同じ相手とのつながりが2本できたら、コードの小さい人が開いたほうを残す（両方が同じ答えを出す）。
   ?local=1 のときは BroadcastChannel（同じブラウザの中だけ）でためせる。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  const CHARS = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
  const LEN = 8;
  const PREFIX = 'cubestrike2-f-';
  const PROTO = 1;
  const TICK_MS = 3000;
  const POLL_MS = 90000;           // オフラインのフレンド・送った申請に つなぎなおす間隔（開いたときは すぐ全員につなぐ）
  const POLL_INC_MS = 180000;      // 受けた申請が まだ生きているか たしかめる間隔
  const PING_MS = 15000;
  const DEAD_MS = 60000;           // これだけ何も来なければ切る
  const OPEN_WAIT_MS = 25000;      // つながって hi が来るまでの上限
  const RETRY_MS = 30000;          // ブローカーにつながらない・同じコードを別のタブが使っているとき
  const MAX_FRIENDS = 50, MAX_RECENT = 20, MAX_CHAT = 60, MAX_TEXT = 80, MAX_INC = 30, MAX_OUT = 30;
  const INVITE_TTL = 5 * 60 * 1000;
  const MSG_BURST = 6, MSG_WINDOW = 10000;   // 受けとるチャットは 10秒に 6通まで
  const STATES = { menu: 1, lobby: 1, match: 1, cpu: 1, tower: 1, practice: 1, edit: 1, town: 1 };

  const now = () => Date.now();
  function randInt(n) {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const a = new Uint32Array(1);
        window.crypto.getRandomValues(a);
        return a[0] % n;
      }
    } catch (e) {}
    return Math.floor(Math.random() * n);
  }
  function makeCode() { let s = ''; for (let i = 0; i < LEN; i++) s += CHARS[randInt(CHARS.length)]; return s; }
  function randId() { return (randInt(2176782336) + 2176782336).toString(36).slice(1) + (randInt(46656) + 46656).toString(36).slice(1); }
  /* 全角→半角、大文字、使える文字だけ、最大8文字（「ABCD-EFGH」の - もすてる） */
  function normCode(s) {
    s = String(s == null ? '' : s);
    try { if (s.normalize) s = s.normalize('NFKC'); } catch (e) {}
    s = s.toUpperCase();
    let out = '';
    for (let i = 0; i < s.length && out.length < LEN; i++) if (CHARS.indexOf(s[i]) >= 0) out += s[i];
    return out;
  }
  function fmtCode(c) { c = normCode(c); return c.length === LEN ? c.slice(0, 4) + '-' + c.slice(4) : c; }
  function peerIdOf(code) { return PREFIX + code.toLowerCase(); }
  function codeOfPeer(id) {
    if (typeof id !== 'string' || id.indexOf(PREFIX) !== 0) return '';
    const c = normCode(id.slice(PREFIX.length));
    return c.length === LEN ? c : '';
  }
  function clipName(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 10).trim();
    return s || 'プレイヤー';
  }
  const LINE_SEP = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');   // 行区切り（U+2028/2029）
  function cleanText(s) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(LINE_SEP, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  }
  function clip(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n); }

  function cleanRoomInfo(o, out) {
    const room = CS.Net && CS.Net.normalizeCode ? CS.Net.normalizeCode(o.room) : '';
    if (room.length === 6) out.room = room;
    if (typeof o.mode === 'string' && /^([1-3]v[1-3]|tower|defense|tourney)$/.test(o.mode)) out.mode = o.mode;
    if (typeof o.mapName === 'string') out.mapName = clip(o.mapName, 16);
    if (o.rule && CS.cleanRule) out.rule = CS.cleanRule(o.rule);
    return out;
  }
  function cleanStatus(st) {
    const o = { s: 'menu' };
    if (!st || typeof st !== 'object') return o;
    if (STATES[st.s]) o.s = st.s;
    if (o.s === 'lobby') {
      cleanRoomInfo(st, o);
      o.open = !!st.open && !!o.room;
      o.n = Math.max(0, Math.min(6, st.n | 0));
      o.max = Math.max(0, Math.min(6, st.max | 0));
    }
    return o;
  }

  /* ======================================================================
     つながり方（transport）: start(id) / connect(peerId) → conn / destroy()
     conn は PeerJS の DataConnection と同じ形（peer, open, send, close, on('open'|'data'|'close'|'error')）
     hub へは _tpOpen / _tpIncoming(conn) / _tpUnavailable(peerId) / _tpError(kind) / _tpDisconnected で知らせる
     ====================================================================== */
  class PeerTransport {
    constructor(hub) { this.hub = hub; this.peer = null; this.dead = false; this._rt = null; this._delay = 2000; }
    start(id) {
      const P = window.Peer;
      if (typeof P !== 'function') { setTimeout(() => this.hub._tpError(this, 'unsupported'), 0); return; }
      let peer;
      try { peer = new P(id, { debug: 0 }); } catch (e) { setTimeout(() => this.hub._tpError(this, 'unsupported'), 0); return; }
      this.peer = peer;
      peer.on('open', () => { if (this.dead) return; this._delay = 2000; this.hub._tpOpen(this); });
      peer.on('connection', (c) => {
        if (this.dead) { try { c.close(); } catch (e) {} return; }
        this.hub._tpIncoming(this, c);
      });
      peer.on('disconnected', () => { if (this.dead) return; this.hub._tpDisconnected(this); this._reconnect(); });
      peer.on('close', () => {});
      peer.on('error', (err) => {
        if (this.dead) return;
        const type = (err && err.type) || '';
        if (type === 'peer-unavailable') {
          const m = /peer\s+(\S+)/i.exec((err && err.message) || '');
          this.hub._tpUnavailable(this, m ? m[1] : '');
          return;
        }
        if (type === 'unavailable-id') { this.hub._tpError(this, 'dup'); return; }
        if (type === 'browser-incompatible') { this.hub._tpError(this, 'unsupported'); return; }
        /* 中継サーバーが落ちた・ネットが切れた: 開いたあとなら つなぎなおす。開く前なら作りなおし */
        if (peer.destroyed || !peer.open) this.hub._tpError(this, 'net');
        else if (peer.disconnected) this._reconnect();
      });
    }
    _reconnect() {
      if (this._rt || this.dead) return;
      const d = this._delay;
      this._delay = Math.min(60000, d * 2);
      this._rt = setTimeout(() => {
        this._rt = null;
        const p = this.peer;
        if (!p || this.dead || p.destroyed || !p.disconnected) return;
        try { p.reconnect(); } catch (e) { this._reconnect(); }
      }, d);
    }
    connect(id) {
      if (!this.peer || this.dead || this.peer.destroyed) return null;
      return this.peer.connect(id, { reliable: true, serialization: 'json', label: 'fr' });
    }
    destroy() {
      this.dead = true;
      clearTimeout(this._rt); this._rt = null;
      if (this.peer) { const p = this.peer; this.peer = null; try { if (!p.destroyed) p.destroy(); } catch (e) {} }
    }
  }

  /* ---- テスト用: 同じブラウザの中だけ（BroadcastChannel） ---- */
  const LOCAL_CH = 'cubestrike2_friends_local';
  class LocalConn extends CS.Emitter {
    constructor(tp, peer, cid) { super(); this.tp = tp; this.peer = peer; this.cid = cid; this.open = false; this.closed = false; }
    send(m) {
      if (!this.open || this.closed) return;
      this.tp._post({ k: 'd', from: this.tp.id, to: this.peer, cid: this.cid, m: JSON.parse(JSON.stringify(m)) });
    }
    close() {
      if (this.closed) return;
      this.closed = true; this.open = false;
      this.tp._post({ k: 'close', from: this.tp.id, to: this.peer, cid: this.cid });
      this.tp.conns.delete(this.cid);
      setTimeout(() => this.emit('close'), 0);
    }
    _open() { if (this.closed || this.open) return; this.open = true; this.emit('open'); }
    _data(m) { if (this.open && !this.closed) this.emit('data', m); }
    _remote() { if (this.closed) return; this.closed = true; this.open = false; this.tp.conns.delete(this.cid); this.emit('close'); }
  }
  class LocalTransport {
    constructor(hub) { this.hub = hub; this.id = ''; this.ch = null; this.conns = new Map(); this.ready = false; this.dead = false; this.nonce = randId(); }
    start(id) {
      this.id = id;
      if (typeof BroadcastChannel !== 'function') { setTimeout(() => this.hub._tpError(this, 'unsupported'), 0); return; }
      try { this.ch = new BroadcastChannel(LOCAL_CH); } catch (e) { setTimeout(() => this.hub._tpError(this, 'unsupported'), 0); return; }
      this.ch.onmessage = (e) => this._on(e && e.data);
      this._post({ k: 'probe', from: id, nonce: this.nonce });
      setTimeout(() => {
        if (this.dead || this.taken) return;
        this.ready = true;
        this.hub._tpOpen(this);
      }, 250);
    }
    _post(m) { if (this.ch) { try { this.ch.postMessage(m); } catch (e) {} } }
    _on(m) {
      if (!m || this.dead) return;
      if (m.k === 'probe') { if (this.ready && m.from === this.id) this._post({ k: 'taken', to: m.nonce }); return; }
      if (m.k === 'taken') { if (m.to === this.nonce && !this.ready && !this.taken) { this.taken = true; this.hub._tpError(this, 'dup'); } return; }
      if (m.to !== this.id || !this.ready) return;
      if (m.k === 'conn') {
        const c = new LocalConn(this, m.from, m.cid);
        this.conns.set(m.cid, c);
        this._post({ k: 'acc', from: this.id, to: m.from, cid: m.cid });
        this.hub._tpIncoming(this, c);
        c._open();
        return;
      }
      const c = this.conns.get(m.cid);
      if (!c || c.peer !== m.from) return;
      if (m.k === 'acc') c._open();
      else if (m.k === 'd') c._data(m.m);
      else if (m.k === 'close') c._remote();
    }
    connect(peer) {
      if (!this.ready || this.dead) return null;
      const cid = randId() + randId();
      const c = new LocalConn(this, peer, cid);
      this.conns.set(cid, c);
      this._post({ k: 'conn', from: this.id, to: peer, cid: cid });
      setTimeout(() => {
        if (c.open || c.closed || this.dead) return;
        c.closed = true;
        this.conns.delete(cid);
        this.hub._tpUnavailable(this, peer);
      }, 1500);
      return c;
    }
    destroy() {
      this.dead = true;
      for (const c of Array.from(this.conns.values())) { try { c.close(); } catch (e) {} }
      this.conns.clear();
      if (this.ch) { try { this.ch.onmessage = null; this.ch.close(); } catch (e) {} this.ch = null; }
    }
  }

  /* ======================================================================
     Hub（フレンドの本体）
     イベント: 'change'（リスト・状態）/ 'net'（ブローカーとのつながり）/ 'request'(code,name) /
               'accepted'(code,name) / 'declined'(code,was) / 'chat'(code, incoming) / 'invite'(inv)
     ====================================================================== */
  class Hub extends CS.Emitter {
    constructor(opts) {
      super();
      opts = opts || {};
      this.key = opts.key || 'cubestrike2_friends';
      this.local = !!opts.local;
      this.nameFn = typeof opts.name === 'function' ? opts.name : () => clipName(CS.Settings && CS.Settings.name);
      this.net = 'off';                // 'off' | 'connecting' | 'online' | 'dup' | 'offline' | 'unsupported'
      this.links = new Map();          // code → いま使っている つながり
      this.extra = new Set();          // hi がまだ来ていない（だれだか まだわからない）つながり
      this.tryAt = new Map();          // code → 次につなぎに行く時刻
      this.invites = [];               // もらった さそい {code, name, room, mode, mapName, rule, t}
      this.myStatus = { s: 'menu' };
      this.tp = null;
      this._timer = null;
      this._lastTick = 0;
      this._retryT = null;
      this._retryDelay = RETRY_MS;
      this._saveT = null;
      this._stSig = '';
      this.data = this._load();
    }

    /* ---------------- 保存 ---------------- */
    _load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(this.key)); } catch (e) { d = null; }
      const out = { v: 1, code: '', active: 0, friends: [], out: [], inc: [], recent: [], blocked: [], chats: {}, unread: {} };
      if (d && typeof d === 'object') {
        const code = normCode(d.code);
        if (code.length === LEN) out.code = code;
        out.active = d.active ? 1 : 0;
        const people = (arr, max) => {
          const res = [], seen = {};
          if (!Array.isArray(arr)) return res;
          for (const p of arr) {
            if (!p || typeof p !== 'object') continue;
            const c = normCode(p.code);
            if (c.length !== LEN || seen[c] || c === out.code) continue;
            seen[c] = 1;
            res.push({ code: c, name: p.name ? clipName(p.name) : '', t: +p.t || 0 });
            if (res.length >= max) break;
          }
          return res;
        };
        out.friends = people(d.friends, MAX_FRIENDS);
        const isF = {};
        for (const f of out.friends) isF[f.code] = 1;
        out.out = people(d.out, MAX_OUT).filter((p) => !isF[p.code]);
        out.inc = people(d.inc, MAX_INC).filter((p) => !isF[p.code]);
        out.recent = people(d.recent, MAX_RECENT);
        if (Array.isArray(d.blocked)) out.blocked = d.blocked.map(normCode).filter((c) => c.length === LEN).slice(0, 100);
        if (d.chats && typeof d.chats === 'object') {
          for (const k in d.chats) {
            const c = normCode(k);
            if (c.length !== LEN || !isF[c] || !Array.isArray(d.chats[k])) continue;
            out.chats[c] = d.chats[k].filter((m) => m && typeof m.text === 'string').slice(-MAX_CHAT).map((m) => ({
              me: m.me ? 1 : 0, text: cleanText(m.text), t: +m.t || 0, id: clip(m.id, 16), pend: m.pend ? 1 : 0
            }));
          }
        }
        if (d.unread && typeof d.unread === 'object') {
          for (const k in d.unread) { const c = normCode(k); if (c.length === LEN && isF[c]) out.unread[c] = Math.max(0, Math.min(99, d.unread[k] | 0)); }
        }
      }
      if (!out.code) out.code = makeCode();
      try { localStorage.setItem(this.key, JSON.stringify(out)); } catch (e) {}
      return out;
    }
    _save() {
      clearTimeout(this._saveT); this._saveT = null;
      try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
    }
    _saveSoon() {
      if (this._saveT) return;
      this._saveT = setTimeout(() => { this._saveT = null; this._save(); }, 300);
    }

    /* ---------------- しらべる ---------------- */
    get code() { return this.data.code; }
    get codeText() { return fmtCode(this.data.code); }
    get active() { return !!this.data.active; }
    _find(list, code) { for (let i = 0; i < list.length; i++) if (list[i].code === code) return i; return -1; }
    isFriend(code) { return this._find(this.data.friends, code) >= 0; }
    isOut(code) { return this._find(this.data.out, code) >= 0; }
    isInc(code) { return this._find(this.data.inc, code) >= 0; }
    isBlocked(code) { return this.data.blocked.indexOf(code) >= 0; }
    _live(code) {
      const l = this.links.get(code);
      return l && !l.dead && l.hi && l.conn && l.conn.open ? l : null;
    }
    online(code) { return !!this._live(normCode(code)) && this.isFriend(normCode(code)); }
    statusOf(code) { const l = this._live(normCode(code)); return l ? l.st : null; }
    nameOf(code) {
      code = normCode(code);
      const lists = [this.data.friends, this.data.out, this.data.inc, this.data.recent];
      for (const L of lists) { const i = this._find(L, code); if (i >= 0) return L[i].name; }
      return '';
    }
    /* UI 用のまとめ（オンラインが先・なまえ順） */
    friendList() {
      const out = [];
      for (const f of this.data.friends) {
        const l = this._live(f.code);
        out.push({ code: f.code, name: f.name, online: !!l, st: l ? l.st : null, unread: this.data.unread[f.code] | 0 });
      }
      out.sort((a, b) => (b.online - a.online) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return out;
    }
    chat(code) { return this.data.chats[normCode(code)] || []; }
    unreadTotal() { let n = 0; for (const k in this.data.unread) n += this.data.unread[k] | 0; return n; }
    badge() { return this.unreadTotal() + this.data.inc.length + this.invites.length; }

    /* ---------------- 動かす ---------------- */
    /* 使いはじめ（フレンド画面を開いた・オンラインで遊んだ）。つぎからは 開いたときに自動でつながる */
    activate() {
      if (!this.data.active) { this.data.active = 1; this._save(); }
      this.start();
    }
    start() {
      if (this._timer) return;
      this._timer = setInterval(() => this._tick(), TICK_MS);
      this._lastTick = now();
      this._open();
    }
    stop() {
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      clearTimeout(this._retryT); this._retryT = null;
      for (const l of Array.from(this.links.values())) { this._send(l, { t: 'bye' }); this._drop(l, false, true); }
      for (const l of Array.from(this.extra)) this._drop(l, false, true);
      if (this.tp) { this.tp.destroy(); this.tp = null; }
      this._setNet('off');
    }
    _open() {
      if (this.tp) { this.tp.destroy(); this.tp = null; }
      this._setNet('connecting');
      const T = this.local ? LocalTransport : PeerTransport;
      this.tp = new T(this);
      this.tp.start(peerIdOf(this.data.code));
    }
    _retry() {
      if (this._retryT || !this._timer) return;
      const d = this._retryDelay;
      this._retryDelay = Math.min(180000, d * 1.6);
      this._retryT = setTimeout(() => { this._retryT = null; if (this._timer) this._open(); }, d);
    }
    _setNet(s) {
      if (this.net === s) return;
      this.net = s;
      this.emit('net', s);
      this.emit('change');
    }

    /* ---- transport から ---- */
    _tpOpen(tp) {
      if (tp !== this.tp) return;
      this._retryDelay = RETRY_MS;
      this._setNet('online');
      for (const k of this.tryAt.keys()) this.tryAt.set(k, 0);
      this._tick();
    }
    _tpDisconnected(tp) { /* P2P はそのまま。新しく来るつながりだけ受けられない（transport が つなぎなおす） */ }
    _tpError(tp, kind) {
      if (tp !== this.tp) return;
      this.tp.destroy(); this.tp = null;
      for (const l of Array.from(this.links.values())) this._drop(l, false, true);
      for (const l of Array.from(this.extra)) this._drop(l, false, true);
      if (kind === 'unsupported') { this._setNet('unsupported'); return; }
      this._setNet(kind === 'dup' ? 'dup' : 'offline');
      this._retry();
    }
    _tpIncoming(tp, conn) {
      if (tp !== this.tp) { try { conn.close(); } catch (e) {} return; }
      const code = codeOfPeer(conn.peer);
      if (!code || code === this.data.code) { try { conn.close(); } catch (e) {} return; }
      const l = this._link(code, conn, false);
      this.extra.add(l);
    }
    _tpUnavailable(tp, peerId) {
      if (tp !== this.tp) return;
      const code = codeOfPeer(peerId);
      const l = code ? this.links.get(code) : null;
      if (l && !l.hi) this._drop(l, false, true);
    }

    /* ---- つながり ---- */
    _link(code, conn, out) {
      const l = { code: code, conn: conn, out: out, hi: false, dead: false, st: null, name: '', last: now(), pingT: now(), rate: [], invT: 0, timer: null };
      l.timer = setTimeout(() => { if (!l.hi) this._drop(l, false, true); }, OPEN_WAIT_MS);
      conn.on('open', () => { if (!l.dead) { l.last = now(); this._hello(l); } });
      conn.on('data', (d) => { if (!l.dead) { l.last = now(); this._data(l, d); } });
      conn.on('close', () => this._drop(l, true));
      conn.on('error', () => {});
      if (conn.open) this._hello(l);
      return l;
    }
    _connect(code) {
      if (this.net !== 'online' || !this.tp || this.links.has(code)) return;
      let conn = null;
      try { conn = this.tp.connect(peerIdOf(code)); } catch (e) { conn = null; }
      if (!conn) return;
      this.links.set(code, this._link(code, conn, true));
    }
    _send(l, m) {
      if (!l || l.dead || !l.conn || !l.conn.open) return false;
      try { l.conn.send(m); return true; } catch (e) { return false; }
    }
    _rel(code) {
      if (this.isFriend(code)) return 'f';
      if (this.isOut(code)) return 'r';
      if (this.isInc(code)) return 'i';
      return 'x';
    }
    _hello(l) {
      if (l.sentHi) return;
      l.sentHi = true;
      this._send(l, { t: 'hi', v: PROTO, code: this.data.code, name: this.nameFn(), rel: this._rel(l.code), st: this.myStatus });
    }
    _drop(l, byClose, silent) {
      if (!l || l.dead) return;
      l.dead = true;
      clearTimeout(l.timer);
      this.extra.delete(l);
      const live = l.hi;
      if (this.links.get(l.code) === l) {
        this.links.delete(l.code);
        this.tryAt.set(l.code, now() + POLL_MS * (0.5 + Math.random() * 0.5));
      }
      if (!byClose) { try { l.conn.close(); } catch (e) {} }
      if (live && !silent) this.emit('change');
    }
    /* hi が来た: 本採用。同じ相手とのつながりが2本なら、コードの小さい人が開いたほうを残す */
    _adopt(l) {
      this.extra.delete(l);
      const cur = this.links.get(l.code);
      if (!cur || cur === l || cur.dead) { this.links.set(l.code, l); return true; }
      const init = (x) => (x.out ? this.data.code : x.code);
      const a = init(cur), b = init(l);
      const keep = a !== b ? (a < b ? cur : l) : l;
      const drop = keep === cur ? l : cur;
      this.links.set(l.code, keep);
      this._drop(drop, false, true);
      return keep === l;
    }

    _data(l, d) {
      if (!d || typeof d !== 'object') return;
      const t = d.t;
      if (t === 'ping') { this._send(l, { t: 'pong' }); return; }
      if (t === 'pong') return;
      if (t === 'hi') { if (!l.hi) this._onHi(l, d); return; }
      if (!l.hi) return;
      if (t === 'bye') { this._drop(l); return; }
      if (t === 'dec') { this._onDec(l); return; }
      if (t === 'acc') { this._onAcc(l); return; }
      if (!this.isFriend(l.code)) return;          // ここから下は フレンドだけ
      if (t === 'st') {
        l.st = cleanStatus(d.st);
        if (d.name !== undefined) this._rename(l.code, clipName(d.name));
        this.emit('change');
      } else if (t === 'msg') this._onMsg(l, d);
      else if (t === 'ack') this._onAck(l, d);
      else if (t === 'inv') this._onInv(l, d);
      else if (t === 'tw') this.emit('town', l.code, d);     // 町での 位置・エモート（town.js がたしかめて使う）
    }

    _onHi(l, d) {
      const code = normCode(d.code);
      if (code !== l.code || (d.v | 0) !== PROTO) { this._drop(l, false, true); return; }   // なりすまし・ちがう版
      l.hi = true;
      l.name = clipName(d.name);
      l.st = cleanStatus(d.st);
      if (!this._adopt(l)) return;
      this._hello(l);
      const rel = d.rel;
      if (this.isBlocked(code)) { this._send(l, { t: 'dec' }); this._drop(l, false, true); return; }
      if (this.isFriend(code)) {
        if (rel === 'x') { this._unfriend(code); this.emit('declined', code, 'friend'); this._drop(l, false, true); this.emit('change'); return; }
        if (rel === 'r') this._send(l, { t: 'acc' });
        this._rename(code, l.name);
        this._flush(l);
        this.emit('change');
        return;
      }
      if (this.isOut(code)) {
        this._rename(code, l.name);
        if (rel === 'f' || rel === 'r') {
          this._befriend(code, l.name);
          if (rel === 'r') this._send(l, { t: 'acc' });
          this._flush(l);
          this.emit('accepted', code, l.name);
        }
        /* 'x' = 相手はまだ こちらの hi を読んでいない。'i' = 相手が考え中 */
        this.emit('change');
        return;
      }
      if (this.isInc(code)) {
        if (rel === 'x') { this._unlist(this.data.inc, code); this._drop(l, false, true); }
        else if (rel === 'f') { this._unlist(this.data.inc, code); this._befriend(code, l.name); this._flush(l); }
        else this._rename(code, l.name);
        this._saveSoon();
        this.emit('change');
        return;
      }
      /* 知らない人 */
      if (rel === 'r') {
        if (this.data.inc.length >= MAX_INC) { this._send(l, { t: 'dec' }); this._drop(l, false, true); return; }
        this.data.inc.unshift({ code: code, name: l.name, t: now() });
        this._saveSoon();
        this.emit('request', code, l.name);
        this.emit('change');
        return;
      }
      if (rel === 'f' || rel === 'i') this._send(l, { t: 'dec' });
      this._drop(l, false, true);
    }

    _onAcc(l) {
      const code = l.code;
      if (!this.isOut(code) && !this.isInc(code)) return;
      this._unlist(this.data.inc, code);
      this._befriend(code, l.name);
      this._send(l, { t: 'st', st: this.myStatus, name: this.nameFn() });
      this._flush(l);
      this.emit('accepted', code, l.name);
      this.emit('change');
    }
    _onDec(l) {
      const code = l.code;
      let was = '';
      if (this.isFriend(code)) { this._unfriend(code); was = 'friend'; }
      if (this._unlist(this.data.out, code)) was = was || 'out';
      if (this._unlist(this.data.inc, code)) was = was || 'inc';
      this._saveSoon();
      if (was) this.emit('declined', code, was);
      this._drop(l, false, true);
      this.emit('change');
    }
    _onMsg(l, d) {
      const text = cleanText(d.text), id = clip(d.id, 16);
      if (!text) return;
      const t = now();
      l.rate = l.rate.filter((x) => t - x < MSG_WINDOW);
      if (l.rate.length >= MSG_BURST) return;
      l.rate.push(t);
      const log = this.data.chats[l.code] || (this.data.chats[l.code] = []);
      if (id) {
        for (let i = log.length - 1; i >= 0 && i >= log.length - 30; i--) {
          if (!log[i].me && log[i].id === id) { this._send(l, { t: 'ack', id: id }); return; }   // もう受けとった（ack が届かなかった）
        }
      }
      log.push({ me: 0, text: text, t: t, id: id, pend: 0 });
      while (log.length > MAX_CHAT) log.shift();
      this.data.unread[l.code] = Math.min(99, (this.data.unread[l.code] | 0) + 1);
      this._saveSoon();
      if (id) this._send(l, { t: 'ack', id: id });
      this.emit('chat', l.code, true);
      this.emit('change');
    }
    _onAck(l, d) {
      const id = clip(d.id, 16), log = this.data.chats[l.code];
      if (!id || !log) return;
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].me && log[i].id === id) { if (log[i].pend) { log[i].pend = 0; this._saveSoon(); this.emit('chat', l.code, false); } return; }
      }
    }
    _onInv(l, d) {
      const t = now();
      if (t - l.invT < 3000) return;
      l.invT = t;
      const inv = cleanRoomInfo(d, { code: l.code, name: this.nameOf(l.code) || l.name, t: t });
      if (!inv.room) return;
      this.invites = this.invites.filter((v) => v.code !== l.code);
      this.invites.unshift(inv);
      if (this.invites.length > 10) this.invites.length = 10;
      this.emit('invite', inv);
      this.emit('change');
    }
    /* 送っていなかったチャットを送る */
    _flush(l) {
      const log = this.data.chats[l.code];
      if (!log) return;
      for (const m of log) if (m.me && m.pend) this._send(l, { t: 'msg', id: m.id, text: m.text });
    }

    _unlist(list, code) { const i = this._find(list, code); if (i < 0) return false; list.splice(i, 1); return true; }
    _rename(code, name) {
      if (!name) return;
      for (const L of [this.data.friends, this.data.out, this.data.inc]) {
        const i = this._find(L, code);
        if (i >= 0 && L[i].name !== name) { L[i].name = name; this._saveSoon(); }
      }
    }
    _befriend(code, name) {
      this._unlist(this.data.out, code);
      this._unlist(this.data.inc, code);
      if (!this.isFriend(code)) {
        if (this.data.friends.length >= MAX_FRIENDS) return false;
        this.data.friends.push({ code: code, name: clipName(name || this.nameOf(code)), t: now() });
      }
      const b = this.data.blocked.indexOf(code);
      if (b >= 0) this.data.blocked.splice(b, 1);
      this._saveSoon();
      return true;
    }
    _unfriend(code) {
      this._unlist(this.data.friends, code);
      delete this.data.chats[code];
      delete this.data.unread[code];
      this.invites = this.invites.filter((v) => v.code !== code);
      this._saveSoon();
    }

    /* ---------------- 定期のしごと ---------------- */
    _tick() {
      const t = now();
      const slept = this._lastTick && t - this._lastTick > TICK_MS * 4;   // タブが裏にいて タイマーが止まっていた
      this._lastTick = t;
      if (this.invites.length) {
        const n = this.invites.length;
        this.invites = this.invites.filter((v) => t - v.t < INVITE_TTL);
        if (n !== this.invites.length) this.emit('change');
      }
      if (this.net !== 'online') return;
      const all = Array.from(this.links.values()).concat(Array.from(this.extra));
      for (const l of all) {
        if (l.dead) continue;
        if (slept) { l.last = t; continue; }
        if (l.hi && t - l.last > DEAD_MS) { this._drop(l); continue; }
        if (l.hi && t - l.pingT > PING_MS) { l.pingT = t; this._send(l, { t: 'ping' }); }
      }
      let budget = 2;
      const want = (list, every) => {
        for (const p of list) {
          if (budget <= 0) return;
          if (this.links.has(p.code)) continue;
          const at = this.tryAt.has(p.code) ? this.tryAt.get(p.code) : 0;
          if (t < at) continue;
          this.tryAt.set(p.code, t + every * (0.8 + Math.random() * 0.4));
          this._connect(p.code);
          budget--;
        }
      };
      want(this.data.friends, POLL_MS);
      want(this.data.out, POLL_MS);
      want(this.data.inc, POLL_INC_MS);
    }

    /* ---------------- UI から ---------------- */
    /* フレンドコードで申請 → {ok, why}（why: 'sent' | 'accepted' | 'code' | 'self' | 'friend' | 'full'） */
    request(codeIn, nameHint) {
      const code = normCode(codeIn);
      if (code.length !== LEN) return { ok: false, why: 'code' };
      if (code === this.data.code) return { ok: false, why: 'self' };
      if (this.isFriend(code)) return { ok: false, why: 'friend' };
      if (this.data.friends.length >= MAX_FRIENDS) return { ok: false, why: 'full' };
      const b = this.data.blocked.indexOf(code);
      if (b >= 0) this.data.blocked.splice(b, 1);
      if (this.isInc(code)) { this.accept(code); return { ok: true, why: 'accepted' }; }
      if (!this.isOut(code)) {
        this.data.out.unshift({ code: code, name: nameHint ? clipName(nameHint) : (this.nameOf(code) || ''), t: now() });
        if (this.data.out.length > MAX_OUT) this.data.out.length = MAX_OUT;
      }
      this.activate();
      this._save();
      const l = this.links.get(code);
      if (l) this._drop(l, false, true);        // 前のつながり（rel が古い）は すてて つなぎなおす
      this.tryAt.set(code, 0);
      this._connect(code);
      this.emit('change');
      return { ok: true, why: 'sent' };
    }
    accept(code) {
      code = normCode(code);
      if (!this.isInc(code)) return false;
      const name = this.nameOf(code);
      this._unlist(this.data.inc, code);
      if (!this._befriend(code, name)) { this.emit('change'); return false; }
      this._save();
      const l = this._live(code);
      if (l) { this._send(l, { t: 'acc' }); this._send(l, { t: 'st', st: this.myStatus, name: this.nameFn() }); this._flush(l); }
      else this.tryAt.set(code, 0);
      this.emit('change');
      return true;
    }
    decline(code) {
      code = normCode(code);
      if (!this._unlist(this.data.inc, code)) return false;
      if (!this.isBlocked(code)) { this.data.blocked.push(code); if (this.data.blocked.length > 100) this.data.blocked.shift(); }
      this._save();
      const l = this.links.get(code);
      if (l) { this._send(l, { t: 'dec' }); this._drop(l, false, true); }
      this.emit('change');
      return true;
    }
    cancel(code) {
      code = normCode(code);
      if (!this._unlist(this.data.out, code)) return false;
      this._save();
      const l = this.links.get(code);
      if (l) { this._send(l, { t: 'dec' }); this._drop(l, false, true); }
      this.emit('change');
      return true;
    }
    remove(code) {
      code = normCode(code);
      if (!this.isFriend(code)) return false;
      this._unfriend(code);
      this._save();
      const l = this.links.get(code);
      if (l) { this._send(l, { t: 'dec' }); this._drop(l, false, true); }
      this.emit('change');
      return true;
    }
    sendChat(code, text) {
      code = normCode(code);
      text = cleanText(text);
      if (!text || !this.isFriend(code)) return false;
      const m = { me: 1, text: text, t: now(), id: randId(), pend: 1 };
      const log = this.data.chats[code] || (this.data.chats[code] = []);
      log.push(m);
      while (log.length > MAX_CHAT) log.shift();
      this._saveSoon();
      const l = this._live(code);
      if (l) this._send(l, { t: 'msg', id: m.id, text: text });
      else this.tryAt.set(code, 0);
      this.emit('chat', code, false);
      return true;
    }
    markRead(code) {
      code = normCode(code);
      if (!this.data.unread[code]) return;
      delete this.data.unread[code];
      this._saveSoon();
      this.emit('change');
    }
    /* へやに さそう。info = {room, mode, mapName, rule} */
    invite(code, info) {
      code = normCode(code);
      const l = this._live(code);
      if (!l || !this.isFriend(code) || !info) return false;
      const m = cleanRoomInfo(info, { t: 'inv' });
      if (!m.room) return false;
      return this._send(l, m);
    }
    dropInvite(inv) {
      const n = this.invites.length;
      this.invites = this.invites.filter((v) => v !== inv && !(inv && v.code === inv.code && v.room === inv.room));
      if (n !== this.invites.length) this.emit('change');
    }
    /* いまの じぶんの状態（main.js が ときどき呼ぶ）。変わったときだけフレンドに知らせる */
    setStatus(st) {
      const s = cleanStatus(st);
      const name = this.nameFn();
      const sig = JSON.stringify(s) + '|' + name;
      if (sig === this._stSig) return;
      this._stSig = sig;
      this.myStatus = s;
      for (const l of this.links.values()) {
        if (l.hi && this.isFriend(l.code)) this._send(l, { t: 'st', st: s, name: name });
      }
    }
    /* 町にいるあいだ: つながっているフレンド全員に 位置などを送る（town.js が 0.2秒ごとに呼ぶ）。送れた人数 */
    sendTown(m) {
      if (!m || typeof m !== 'object') return 0;
      m.t = 'tw';
      let n = 0;
      for (const l of this.links.values()) {
        if (l.hi && this.isFriend(l.code) && this._send(l, m)) n++;
      }
      return n;
    }
    /* いっしょに遊んだ人をおぼえる。list = [{fc, name}] */
    noteRecent(list) {
      if (!Array.isArray(list)) return;
      let changed = false;
      for (const p of list) {
        const code = normCode(p && p.fc);
        if (code.length !== LEN || code === this.data.code) continue;
        this._unlist(this.data.recent, code);
        this.data.recent.unshift({ code: code, name: clipName(p.name), t: now() });
        changed = true;
      }
      if (!changed) return;
      if (this.data.recent.length > MAX_RECENT) this.data.recent.length = MAX_RECENT;
      this._saveSoon();
      this.emit('change');
    }
  }

  CS.Friends = {
    LEN: LEN, CHARS: CHARS, PREFIX: PREFIX, MAX_TEXT: MAX_TEXT, MAX_FRIENDS: MAX_FRIENDS,
    normCode: normCode, fmtCode: fmtCode, peerIdOf: peerIdOf, codeOfPeer: codeOfPeer, cleanStatus: cleanStatus,
    Hub: Hub,
    hub: null           // main.js が作る
  };
})();
