/* ==========================================================================
   CUBE STRIKE — net.js
   通信: PeerJS（公開ブローカー + WebRTC P2P）と、テスト用の BroadcastChannel（?local=1）
   ホストが中継役。ゲスト→ホストは 2 本のチャンネル（'r' 信頼・順序あり / 'u' 順序なし・再送なし）。
   内部 ping（{__ping}/{__pong}）で RTT を測る。onMsg には渡さない。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS = window.CS || {};

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRTUVWXY2346789';
  const PING_MS = 1000;          // ping 間隔
  const DEAD_MS = 8000;          // これだけ何も届かなければ切断扱い
  const OPEN_TIMEOUT_MS = 15000; // ゲストの接続待ち上限
  const PROBE_MS = 250;          // ローカル: 同じコードのホストがいないか確かめる時間
  const RTT_ALPHA = 0.25;        // RTT の平滑化

  const ERR_JA = {
    'unavailable-id': 'そのコードは使われています。作り直してください',
    'peer-unavailable': '部屋が見つかりません。コードを確認してね',
    'network': 'ネットにつながらないか、中継サーバーが混んでいます',
    'server-error': 'ネットにつながらないか、中継サーバーが混んでいます',
    'socket-error': 'ネットにつながらないか、中継サーバーが混んでいます',
    'socket-closed': 'ネットにつながらないか、中継サーバーが混んでいます',
    'browser-incompatible': 'このブラウザは通信に対応していません',
    'timeout': '相手に届きませんでした。コードとネットを確認してね',
    'negotiation-failed': '相手に届きませんでした。コードとネットを確認してね'
  };
  function errText(type) {
    return ERR_JA[type] || ('つながりませんでした（' + (type || 'unknown') + '）');
  }

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

  function makeCode() {
    let s = '';
    do {
      s = '';
      for (let i = 0; i < 6; i++) s += CODE_CHARS[randInt(CODE_CHARS.length)];
    } while (s.indexOf('QR') === 0);      // v5.3: 'QR' で はじまる コードは ランダムマッチ用（ranked.js）
    return s;
  }

  /* 全角→半角（NFKC）、大文字化、使える文字だけ、最大6文字 */
  function normalizeCode(s) {
    s = String(s == null ? '' : s);
    try { if (s.normalize) s = s.normalize('NFKC'); } catch (e) {}
    s = s.toUpperCase();
    let out = '';
    for (let i = 0; i < s.length && out.length < 6; i++) {
      if (CODE_CHARS.indexOf(s[i]) >= 0) out += s[i];
    }
    return out;
  }

  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const noop = function () {};

  /* ======================================================================
     共通部分: ハンドラ・ping/RTT・無応答検出
     transport は次を実装する:
       t.startImpl()            接続開始
       t.rawSend(id, msg, unrel) 1 相手へ送る（id = 'host' か guestId）
       t.peers()                 今つながっている相手 id の配列
       t.dropPeer(id)            無応答の相手を切る（onPeerLeave は共通側で出す）
       t.closeImpl()             後始末
     ====================================================================== */
  function Session(opts) {
    opts = opts || {};
    this.isHost = !!opts.host;
    this.local = !!opts.local;
    this.lag = Math.max(0, +opts.lag || 0);
    let code = normalizeCode(opts.code);
    if (this.isHost && code.length !== 6) code = makeCode();
    this.code = code;
    this.myId = this.isHost ? 'host' : null;
    this.opened = false;
    this.closed = false;
    this.failed = false;
    this.h = { onOpen: noop, onPeerJoin: noop, onPeerLeave: noop, onMsg: noop, onError: noop };
    this._rtt = new Map();       // id -> ms
    this._seen = new Map();      // id -> 最後に何か届いた時刻
    this._timer = null;
    this._lastTick = 0;
  }

  Session.prototype.start = function (handlers) {
    if (this._started) return;
    this._started = true;
    const h = handlers || {};
    for (const k of ['onOpen', 'onPeerJoin', 'onPeerLeave', 'onMsg', 'onError']) {
      if (typeof h[k] === 'function') this.h[k] = h[k];
    }
    this.startImpl();
  };

  /* ---- transport から呼ばれる ---- */
  Session.prototype._call = function (name, a, b) {
    try { this.h[name](a, b); } catch (e) {
      // ゲーム側の例外で通信処理が止まらないようにする
      setTimeout(() => { throw e; }, 0);
    }
  };

  Session.prototype._opened = function () {
    if (this.opened || this.closed || this.failed) return;
    this.opened = true;
    this._startTimer();
    this._call('onOpen');
  };

  Session.prototype._fail = function (type) {
    if (this.failed || this.closed) return;
    this.failed = true;
    const text = errText(type);
    this._shutdown();
    this._call('onError', text, type);
  };

  Session.prototype._joined = function (id) {
    this._seen.set(id, now());
    this._call('onPeerJoin', id);
    this._ping(id);
  };

  Session.prototype._left = function (id) {
    this._seen.delete(id);
    this._rtt.delete(id);
    if (this.closed) return;
    this._call('onPeerLeave', id);
  };

  /* 受信した 1 メッセージ（ping/pong はここで吸収） */
  Session.prototype._recv = function (msg, fromId) {
    if (this.closed || msg == null) return;
    this._seen.set(fromId, now());
    if (typeof msg === 'object') {
      if (msg.__ping !== undefined) {
        this.rawSend(fromId, { __pong: msg.__ping }, true);
        return;
      }
      if (msg.__pong !== undefined) {
        const sample = now() - (+msg.__pong);
        if (sample >= 0 && sample < 60000) {
          const prev = this._rtt.get(fromId);
          this._rtt.set(fromId, prev === undefined ? sample : prev + (sample - prev) * RTT_ALPHA);
        }
        return;
      }
    }
    this._call('onMsg', msg, fromId);
  };

  Session.prototype._ping = function (id) {
    this.rawSend(id, { __ping: Math.round(now() * 10) / 10 }, true);
  };

  Session.prototype._startTimer = function () {
    if (this._timer) return;
    this._lastTick = now();
    this._timer = setInterval(() => this._tick(), PING_MS);
  };

  Session.prototype._tick = function () {
    if (this.closed) return;
    const t = now();
    const gap = t - this._lastTick;
    this._lastTick = t;
    const ids = this.peers();
    // タイマー自体が大きく遅れた（自分が裏にいた/止まっていた）→ 相手のせいにしない
    const slept = gap > PING_MS * 3;
    for (const id of ids) {
      if (slept) { this._seen.set(id, t); continue; }
      const seen = this._seen.get(id);
      if (seen !== undefined && t - seen > DEAD_MS) {
        this.dropPeer(id);
        continue;
      }
      this._ping(id);
    }
  };

  /* ---- 公開 API ---- */
  Session.prototype.send = function (msg, opts) {
    if (this.closed || !this.opened || msg == null) return;
    const unrel = !!(opts && opts.unreliable);
    if (this.isHost) {
      const to = opts && opts.to;
      if (to != null && to !== 'host') {
        this.rawSend(to, msg, unrel);
      } else if (to == null) {
        for (const id of this.peers()) this.rawSend(id, msg, unrel);
      }
    } else {
      this.rawSend('host', msg, unrel);
    }
  };

  Session.prototype.rtt = function (id) {
    if (id == null) {
      if (!this.isHost) id = 'host';
      else {
        let worst = 0;
        for (const pid of this.peers()) {
          const v = this._rtt.get(pid);
          worst = Math.max(worst, v === undefined ? Infinity : v);
        }
        return worst;
      }
    }
    if (this.isHost && id === 'host') return 0;
    const v = this._rtt.get(id);
    return v === undefined ? Infinity : v;
  };

  Session.prototype._shutdown = function () {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    try { this.closeImpl(); } catch (e) {}
  };

  Session.prototype.close = function () {
    if (this.closed) return;
    this.closed = true;
    this._shutdown();
    this._seen.clear();
    this._rtt.clear();
  };

  function inherit(Ctor) {
    Ctor.prototype = Object.create(Session.prototype);
    Ctor.prototype.constructor = Ctor;
    return Ctor;
  }

  /* ======================================================================
     PeerJS transport
     ====================================================================== */
  function hostPeerId(code) { return 'cubestrike2-' + code.toLowerCase(); }

  /* PeerJS 1.5.4 は reliable:false を createDataChannel(label,{ordered:false}) にするだけで
     maxRetransmits を付けない（= 順序なしだが再送は続く）。'u' を本当の「再送なし」にするため、
     peer.connect() の同期処理の間だけ createDataChannel に maxRetransmits:0 を足す。 */
  function withUnreliableChannels(fn) {
    let proto = null, orig = null;
    try {
      proto = window.RTCPeerConnection && window.RTCPeerConnection.prototype;
      orig = proto && proto.createDataChannel;
      if (typeof orig === 'function') {
        proto.createDataChannel = function (label, init) {
          if (init && init.ordered === false && init.maxRetransmits == null && init.maxPacketLifeTime == null) {
            init = Object.assign({}, init, { maxRetransmits: 0 });
          }
          return orig.call(this, label, init);
        };
      } else {
        proto = null;
      }
    } catch (e) { proto = null; }
    try { return fn(); } finally {
      if (proto) { try { proto.createDataChannel = orig; } catch (e) {} }
    }
  }

  const PeerSession = inherit(function PeerSession(opts) {
    Session.call(this, opts);
    this.peer = null;
    this._guests = new Map();   // host: id -> {r, u, joined}
    this._conns = { r: null, u: null };   // guest
    this._openTimer = null;
    this._reconnTimer = null;
    this._reconnDelay = 1000;
    this._pending = new Set();  // host: まだ開いていない接続
  });

  PeerSession.prototype.startImpl = function () {
    const P = window.Peer;
    if (typeof P !== 'function') { setTimeout(() => this._fail('browser-incompatible'), 0); return; }
    if (!this.isHost && this.code.length !== 6) { setTimeout(() => this._fail('peer-unavailable'), 0); return; }
    try {
      this.peer = this.isHost ? new P(hostPeerId(this.code), { debug: 0 }) : new P({ debug: 0 });
    } catch (e) {
      setTimeout(() => this._fail('browser-incompatible'), 0);
      return;
    }
    const peer = this.peer;
    peer.on('error', (err) => this._onPeerError(err));
    peer.on('close', noop);
    if (this.isHost) {
      peer.on('open', () => {
        this._reconnDelay = 1000;
        this._opened();
      });
      peer.on('connection', (conn) => this._hostConn(conn));
      peer.on('disconnected', () => this._scheduleReconnect());
    } else {
      this._openTimer = setTimeout(() => {
        if (!this.opened) this._fail(peer.open ? 'timeout' : 'network');
      }, OPEN_TIMEOUT_MS);
      peer.on('open', (id) => {
        if (this.closed || this.failed || this._conns.r) return;
        this.myId = id;
        this._guestConnect();
      });
      peer.on('disconnected', noop);   // P2P がつながれば中継サーバーは不要
    }
  };

  PeerSession.prototype._onPeerError = function (err) {
    if (this.closed || this.failed) return;
    const type = (err && err.type) || '';
    if (this.isHost) {
      if (!this.opened) { this._fail(type); return; }
      // 部屋ができたあとの中継サーバーの不調は再接続で直す（P2P はそのまま）
      if (this.peer && this.peer.disconnected) this._scheduleReconnect();
    } else if (!this.opened) {
      this._fail(type);
    }
  };

  PeerSession.prototype._scheduleReconnect = function () {
    if (this.closed || this.failed || !this.opened || this._reconnTimer) return;
    const delay = this._reconnDelay;
    this._reconnDelay = Math.min(15000, this._reconnDelay * 2);
    this._reconnTimer = setTimeout(() => {
      this._reconnTimer = null;
      const peer = this.peer;
      if (!peer || this.closed || peer.destroyed) return;
      if (!peer.disconnected) return;
      try { peer.reconnect(); } catch (e) { this._scheduleReconnect(); }
    }, delay);
  };

  /* ---- host ---- */
  PeerSession.prototype._hostConn = function (conn) {
    if (this.closed) { try { conn.close(); } catch (e) {} return; }
    const id = conn.peer, label = conn.label === 'u' ? 'u' : 'r';
    this._pending.add(conn);
    const giveUp = setTimeout(() => {
      if (!conn.open) { this._pending.delete(conn); try { conn.close(); } catch (e) {} }
    }, OPEN_TIMEOUT_MS + 5000);
    conn.on('error', noop);
    conn.on('open', () => {
      clearTimeout(giveUp);
      this._pending.delete(conn);
      if (this.closed) { try { conn.close(); } catch (e) {} return; }
      let g = this._guests.get(id);
      if (!g) { g = { r: null, u: null, joined: false }; this._guests.set(id, g); }
      const old = g[label];
      g[label] = conn;
      if (old && old !== conn) { try { old.close(); } catch (e) {} }
      if (label === 'r' && !g.joined) {
        g.joined = true;
        this._joined(id);
      }
    });
    conn.on('data', (d) => {
      const g = this._guests.get(id);
      if (!g || !g.joined || g[label] !== conn) return;
      this._recv(d, id);
    });
    conn.on('close', () => {
      clearTimeout(giveUp);
      this._pending.delete(conn);
      const g = this._guests.get(id);
      if (!g || g[label] !== conn) return;
      g[label] = null;
      if (label === 'r') this._removeGuest(id);
    });
  };

  PeerSession.prototype._removeGuest = function (id) {
    const g = this._guests.get(id);
    if (!g) return;
    this._guests.delete(id);
    const r = g.r, u = g.u;
    g.r = g.u = null;
    try { if (u) u.close(); } catch (e) {}
    try { if (r) r.close(); } catch (e) {}
    if (g.joined) this._left(id);
  };

  /* ---- guest ---- */
  PeerSession.prototype._guestConnect = function () {
    const peer = this.peer, hid = hostPeerId(this.code);
    let r, u;
    try {
      r = peer.connect(hid, { label: 'r', reliable: true, serialization: 'json' });
      u = withUnreliableChannels(() => peer.connect(hid, { label: 'u', reliable: false, serialization: 'json' }));
    } catch (e) {
      this._fail('negotiation-failed');
      return;
    }
    if (!r) { this._fail('network'); return; }
    this._conns.r = r;
    r.on('error', (err) => {
      if (!this.opened) this._fail((err && err.type) || 'negotiation-failed');
    });
    r.on('open', () => {
      if (this.closed || this.failed) { try { r.close(); } catch (e) {} return; }
      clearTimeout(this._openTimer); this._openTimer = null;
      this._seen.set('host', now());
      this._opened();
      this._ping('host');
    });
    r.on('data', (d) => { if (this._conns.r === r) this._recv(d, 'host'); });
    r.on('close', () => {
      if (this._conns.r !== r) return;
      this._hostGone();
    });
    if (u) {
      u.on('error', noop);
      u.on('open', () => {
        if (this.closed) { try { u.close(); } catch (e) {} return; }
        this._conns.u = u;
      });
      u.on('data', (d) => { if (this.opened && this._conns.u === u) this._recv(d, 'host'); });
      u.on('close', () => { if (this._conns.u === u) this._conns.u = null; });
    }
  };

  PeerSession.prototype._hostGone = function () {
    if (this.closed) return;
    const wasOpen = this.opened;
    const r = this._conns.r, u = this._conns.u;
    this._conns.r = this._conns.u = null;
    try { if (u) u.close(); } catch (e) {}
    try { if (r) r.close(); } catch (e) {}
    if (wasOpen) this._left('host');
    else this._fail('peer-unavailable');
  };

  /* ---- transport API ---- */
  PeerSession.prototype.peers = function () {
    if (!this.isHost) return this._conns.r ? ['host'] : [];
    const out = [];
    for (const [id, g] of this._guests) if (g.joined && g.r) out.push(id);
    return out;
  };

  PeerSession.prototype.rawSend = function (id, msg, unrel) {
    let c = null;
    if (this.isHost) {
      const g = this._guests.get(id);
      if (!g || !g.joined) return;
      c = (unrel && g.u && g.u.open) ? g.u : g.r;
    } else {
      if (id !== 'host') return;
      c = (unrel && this._conns.u && this._conns.u.open) ? this._conns.u : this._conns.r;
    }
    if (!c || !c.open) return;
    try { c.send(msg); } catch (e) {}
  };

  PeerSession.prototype.dropPeer = function (id) {
    if (this.isHost) this._removeGuest(id);
    else this._hostGone();
  };

  PeerSession.prototype.closeImpl = function () {
    clearTimeout(this._openTimer); this._openTimer = null;
    clearTimeout(this._reconnTimer); this._reconnTimer = null;
    for (const c of this._pending) { try { c.close(); } catch (e) {} }
    this._pending.clear();
    for (const g of this._guests.values()) {
      try { if (g.u) g.u.close(); } catch (e) {}
      try { if (g.r) g.r.close(); } catch (e) {}
      g.r = g.u = null;
    }
    this._guests.clear();
    const r = this._conns.r, u = this._conns.u;
    this._conns.r = this._conns.u = null;
    try { if (u) u.close(); } catch (e) {}
    try { if (r) r.close(); } catch (e) {}
    if (this.peer) {
      const p = this.peer;
      this.peer = null;
      try { if (!p.destroyed) p.destroy(); } catch (e) {}
    }
  };

  /* ======================================================================
     ローカル transport（BroadcastChannel、同じブラウザの別タブ）
     封筒: {k, s:送信元, to, u:0/1, m}
       k = 'probe' | 'here' | 'join' | 'welcome' | 'd' | 'bye'
     ?lag は受信側で遅らせる（信頼チャンネルは順序を守る）。probe/here は遅らせない。
     ====================================================================== */
  const LocalSession = inherit(function LocalSession(opts) {
    Session.call(this, opts);
    this.ch = null;
    this._key = this.isHost ? 'host' : ('g' + randKey());
    if (!this.isHost) this.myId = this._key;
    this._nonce = randKey() + randKey();
    this._state = 'idle';       // host: probing → hosting / guest: joining → joined
    this._guestSet = new Set(); // host: 参加済みゲスト
    this._timers = new Set();
    this._queue = [];           // 遅延配送キュー（due 昇順・安定）
    this._qTimer = null;
    this._qDue = 0;
    this._lastDue = new Map();  // 送信元ごとの信頼メッセージ最終配送時刻
  });

  function randKey() { return (randInt(2176782336) + 2176782336).toString(36).slice(1); }

  LocalSession.prototype._later = function (fn, ms) {
    const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
    this._timers.add(t);
    return t;
  };

  LocalSession.prototype._post = function (env) {
    if (!this.ch) return;
    env.ts = Date.now();   // 送信時刻（BroadcastChannel 自体の遅れを ?lag から差し引く）
    try { this.ch.postMessage(env); } catch (e) {}
  };

  LocalSession.prototype.startImpl = function () {
    if (typeof BroadcastChannel !== 'function') { setTimeout(() => this._fail('browser-incompatible'), 0); return; }
    if (this.code.length !== 6) { setTimeout(() => this._fail('peer-unavailable'), 0); return; }
    try {
      this.ch = new BroadcastChannel('cubestrike2_' + this.code);
    } catch (e) {
      setTimeout(() => this._fail('browser-incompatible'), 0);
      return;
    }
    this.ch.onmessage = (e) => this._onEnvelope(e && e.data);
    if (this.isHost) {
      this._state = 'probing';
      this._post({ k: 'probe', s: this._nonce });
      this._later(() => {
        if (this._state !== 'probing' || this.closed || this.failed) return;
        this._state = 'hosting';
        this._opened();
      }, PROBE_MS);
    } else {
      this._state = 'joining';
      const deadline = now() + 3000 + this.lag * 4;
      const tryJoin = () => {
        if (this._state !== 'joining' || this.closed || this.failed) return;
        if (now() > deadline) { this._fail('peer-unavailable'); return; }
        this._post({ k: 'join', s: this._key, to: 'host' });
        this._later(tryJoin, 400);
      };
      tryJoin();
    }
  };

  LocalSession.prototype._onEnvelope = function (env) {
    if (this.closed || !env || typeof env !== 'object' || env.s === this._key) return;
    const k = env.k;
    // ホストの重複チェック（遅延なし）
    if (k === 'probe') {
      if (!this.isHost || env.s === this._nonce) return;
      if (this._state === 'hosting') this._post({ k: 'here', to: env.s });
      else if (this._state === 'probing') {
        // 同時に作ったら nonce の小さい方が勝ち。後から作られたタブはこちらの probe を受け取れていないので、勝った側が知らせる
        if (env.s < this._nonce) this._fail('unavailable-id');
        else this._post({ k: 'here', to: env.s });
      }
      return;
    }
    if (k === 'here') {
      if (this.isHost && this._state === 'probing' && env.to === this._nonce) this._fail('unavailable-id');
      return;
    }
    if (this.isHost) {
      if (this._state !== 'hosting' || env.to !== 'host') return;
    } else {
      if (env.s !== 'host' || (env.to !== '*' && env.to !== this._key)) return;
    }
    if (this.lag > 0) this._enqueue(env);
    else this._handle(env);
  };

  LocalSession.prototype._enqueue = function (env) {
    const t = now();
    const transit = env.ts ? Math.min(this.lag * 0.5, Math.max(0, Date.now() - env.ts)) : 0;
    let due = t + this.lag * (0.75 + Math.random() * 0.5) - transit;
    if (!env.u) {
      const last = this._lastDue.get(env.s) || 0;
      if (due < last) due = last;
      this._lastDue.set(env.s, due);
    }
    const q = this._queue;
    let lo = 0, hi = q.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (q[mid].due <= due) lo = mid + 1; else hi = mid; }
    q.splice(lo, 0, { due: due, env: env });
    this._armQueue();
  };

  LocalSession.prototype._armQueue = function () {
    if (!this._queue.length) return;
    const head = this._queue[0].due;
    if (this._qTimer && this._qDue <= head) return;
    if (this._qTimer) clearTimeout(this._qTimer);
    this._qDue = head;
    this._qTimer = setTimeout(() => {
      this._qTimer = null;
      const q = this._queue, t = now() + 1;
      while (q.length && q[0].due <= t && !this.closed) this._handle(q.shift().env);
      if (!this.closed) this._armQueue();
    }, Math.max(0, head - now()));
  };

  LocalSession.prototype._handle = function (env) {
    if (this.closed || this.failed) return;
    const k = env.k;
    if (this.isHost) {
      const id = env.s;
      if (k === 'join') {
        this._post({ k: 'welcome', s: 'host', to: id });
        if (!this._guestSet.has(id)) { this._guestSet.add(id); this._joined(id); }
      } else if (k === 'd') {
        if (this._guestSet.has(id)) this._recv(env.m, id);
      } else if (k === 'bye') {
        if (this._guestSet.delete(id)) { this._lastDue.delete(id); this._left(id); }
      }
    } else {
      if (k === 'welcome') {
        if (this._state === 'joining') {
          this._state = 'joined';
          this._seen.set('host', now());
          this._opened();
          this._ping('host');
        }
      } else if (k === 'd') {
        if (this._state === 'joined') this._recv(env.m, 'host');
      } else if (k === 'bye') {
        if (this._state === 'joined') { this._state = 'gone'; this._left('host'); }
        else if (this._state === 'joining') this._fail('peer-unavailable');
      }
    }
  };

  LocalSession.prototype.peers = function () {
    if (this.isHost) return Array.from(this._guestSet);
    return this._state === 'joined' ? ['host'] : [];
  };

  LocalSession.prototype.rawSend = function (id, msg, unrel) {
    if (this.isHost) {
      if (!this._guestSet.has(id)) return;
    } else if (id !== 'host' || this._state !== 'joined') return;
    this._post({ k: 'd', s: this._key, to: id, u: unrel ? 1 : 0, m: msg });
  };

  LocalSession.prototype.dropPeer = function (id) {
    if (this.isHost) {
      if (this._guestSet.delete(id)) {
        this._lastDue.delete(id);
        this._post({ k: 'bye', s: 'host', to: id });
        this._left(id);
      }
    } else if (this._state === 'joined') {
      this._state = 'gone';
      this._left('host');
    }
  };

  LocalSession.prototype.closeImpl = function () {
    if (this.ch) {
      if (this.isHost ? this._state === 'hosting' : (this._state === 'joined' || this._state === 'joining')) {
        this._post(this.isHost ? { k: 'bye', s: 'host', to: '*' } : { k: 'bye', s: this._key, to: 'host' });
      }
      try { this.ch.onmessage = null; this.ch.close(); } catch (e) {}
      this.ch = null;
    }
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    if (this._qTimer) { clearTimeout(this._qTimer); this._qTimer = null; }
    this._queue.length = 0;
    this._guestSet.clear();
    this._state = 'closed';
  };

  /* ======================================================================
     公開
     ====================================================================== */
  CS.Net = {
    CODE_CHARS: CODE_CHARS,
    makeCode: makeCode,
    normalizeCode: normalizeCode,
    errorText: errText,
    hostPeerId: hostPeerId,
    create: function (opts) {
      opts = opts || {};
      return opts.local ? new LocalSession(opts) : new PeerSession(opts);
    }
  };
})();
