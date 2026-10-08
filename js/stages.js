/* ==========================================================================
   CUBE STRIKE — stages.js
   みんなのステージ（v3.1）: じぶんで作ったマップ（ステージ）を 公開して、だれでも あそべるようにする。
   サーバーは使わず、サイトの隠しチャットと同じ 無料の公開 MQTT ブローカー（登録不要）の
   「retained（のこしておく）メッセージ」を 本棚のように使う。
   ・ステージ1つ = トピック ROOT + <sid> の retained メッセージ（JSON）。ROOT + '+' を購読すると 公開中のものが ぜんぶ届く
   ・2つのブローカーに 同じものを のせる（どちらかが止まっても 見られる）
   ・なりすまし・かいざん よけ: ステージは 作った人の ECDSA(P-256) キーで署名する。sid の頭は 公開キーのハッシュ。
     ほかの人は 書きかえられない。「公開をやめる」も 本人の署名つきの「けした」しるし（del）を のせる
   ・片方のブローカーから消えていたら、もう片方にある版を 見た人のブラウザが そっと のせなおす（自然に なおる）。
     両方から消えても、作った本人が「みんなのステージ」を開けば のせなおされる
   ・サイトの管理者は BLOCKED に sid を入れて デプロイすれば、そのステージを みんなから かくせる
   あそぶときは 'p:<sid>' という マップID で、CPU戦でも へやを作る（友達）でも使える
   （へやでは ホストが中身を start にのせて送るので、ゲストが持っていなくても あそべる）。
   ========================================================================== */
(function () {
  'use strict';
  const CS = window.CS;

  const MQTT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mqtt/4.3.7/mqtt.min.js';
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  /* ?stagetest=xxx で ためし用の べつの本棚を使う（本物の「みんなのステージ」を よごさずに ためせる） */
  const TEST = String((CS.query && CS.query('stagetest')) || '').replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
  const ROOT = 'neoarc/cubestrike2/stages/' + (TEST ? 'test-' + TEST : 'v1') + '/';
  const FMT = 1;
  const STORE_KEY = 'cubestrike2_stages' + (TEST ? '_test' : '');
  const KEY_KEY = 'cubestrike2_stagekey';
  const CONNECT_MS = 12000;
  const MIN_WAIT = 1500, QUIET_MS = 1000, MAX_WAIT = 8000;   // retained が とどきおわるのを待つ
  const MAX_CACHE = 80;          // ブラウザに のこしておく ステージの数（じぶんの・ほぞんした のは べつ）
  const MAX_RECORDS = 800;       // 1回に うけとる数の上限（いたずら よけ）
  const MAX_BYTES = 200000;      // 1ステージの大きさの上限
  const HEAL_MAX = 6;            // 1回に のせなおす数
  const RECENT_MAX = 5;

  /* サイトの管理者用: みんなから かくしたい ステージの ID（くわしく画面に出る ID）をここに入れて デプロイ */
  const BLOCKED = [];

  const subtle = (window.crypto && window.crypto.subtle) || null;
  const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
  const dec = typeof TextDecoder === 'function' ? new TextDecoder() : null;
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  const unb64 = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const hex = (u8) => Array.from(u8, (x) => (x < 16 ? '0' : '') + x.toString(16)).join('');
  const rid = () => Math.random().toString(36).slice(2, 10);
  const SID_RE = /^[0-9a-f]{10}-[a-z0-9]{1,12}$/;

  function clip(s, n) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  }

  /* ---------------- ブラウザの保存 ---------------- */
  let store = null;
  function load() {
    if (store) return store;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { d = null; }
    store = { v: 1, tag: '', recs: {}, seen: {}, saved: [], hidden: [], recent: [], mine: {} };
    if (d && typeof d === 'object') {
      if (typeof d.tag === 'string' && /^[0-9a-f]{10}$/.test(d.tag)) store.tag = d.tag;
      if (d.recs && typeof d.recs === 'object') {
        for (const sid in d.recs) { const r = shape(d.recs[sid]); if (r && r.sid === sid) store.recs[sid] = r; }
      }
      const ids = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && SID_RE.test(x)).slice(0, 200) : []);
      store.saved = ids(d.saved); store.hidden = ids(d.hidden); store.recent = ids(d.recent).slice(0, RECENT_MAX);
      if (d.seen && typeof d.seen === 'object') for (const k in d.seen) if (store.recs[k]) store.seen[k] = +d.seen[k] || 0;
      if (d.mine && typeof d.mine === 'object') for (const k in d.mine) if (typeof d.mine[k] === 'string' && SID_RE.test(d.mine[k])) store.mine[k] = d.mine[k];
    }
    return store;
  }
  let saveT = 0;
  function persist() {
    clearTimeout(saveT); saveT = 0;
    const s = load();
    /* 古いものから すてる（じぶんの・ほぞんした・さいきん あそんだ のは のこす） */
    const keep = {};
    for (const k in s.mine) keep[s.mine[k]] = 1;
    for (const k of s.saved.concat(s.recent)) keep[k] = 1;
    const others = Object.keys(s.recs).filter((k) => !keep[k] && !(s.tag && k.indexOf(s.tag + '-') === 0));
    if (others.length > MAX_CACHE) {
      others.sort((a, b) => (s.seen[b] || s.recs[b].t) - (s.seen[a] || s.recs[a].t));
      for (const k of others.slice(MAX_CACHE)) { delete s.recs[k]; delete s.seen[k]; }
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function persistSoon() { if (!saveT) saveT = setTimeout(persist, 400); }

  /* ---------------- 署名のキー（このブラウザで1つ） ---------------- */
  let keyP = null;
  async function ownerTag(raw) { return hex(new Uint8Array(await subtle.digest('SHA-256', raw))).slice(0, 10); }
  function myKey() {
    if (keyP) return keyP;
    keyP = (async function () {
      if (!subtle || !enc) throw new Error('nocrypto');
      const EC = { name: 'ECDSA', namedCurve: 'P-256' };
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(KEY_KEY)); } catch (e) { saved = null; }
      let priv = null, raw = null;
      if (saved && saved.d && typeof saved.pub === 'string') {
        try { priv = await subtle.importKey('jwk', saved.d, EC, false, ['sign']); raw = unb64(saved.pub); } catch (e) { priv = null; }
      }
      if (!priv) {
        const kp = await subtle.generateKey(EC, true, ['sign', 'verify']);
        const jwk = await subtle.exportKey('jwk', kp.privateKey);
        raw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
        try { localStorage.setItem(KEY_KEY, JSON.stringify({ d: jwk, pub: b64(raw) })); } catch (e) {}
        priv = kp.privateKey;
      }
      const tag = await ownerTag(raw);
      const s = load();
      if (s.tag !== tag) { s.tag = tag; persist(); }
      return { priv: priv, pub: b64(raw), tag: tag };
    })();
    keyP.catch(function () { keyP = null; });
    return keyP;
  }

  /* 署名するもの（この順番・この形で。受けとった側も 同じ文字列を作って たしかめる） */
  function canon(r) {
    return JSON.stringify([FMT, r.sid, r.rev, r.t, r.del ? 1 : 0, r.name || '', r.by || '', r.W | 0, r.H | 0, r.D | 0, r.rle || '', r.sp || null, r.theme || '']);
  }
  async function sign(r, key) {
    r.pk = key.pub;
    const s = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.priv, enc.encode(canon(r)));
    r.sig = b64(new Uint8Array(s));
    return r;
  }
  const pkCache = new Map();
  async function verify(r) {
    if (!subtle || !enc) return true;                 // とても古いブラウザ: たしかめられないので そのまま
    try {
      let k = pkCache.get(r.pk);
      if (!k) {
        if (pkCache.size > 2000) pkCache.clear();
        const raw = unb64(r.pk);
        k = { key: await subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), tag: await ownerTag(raw) };
        pkCache.set(r.pk, k);
      }
      if (r.sid.indexOf(k.tag + '-') !== 0) return false;   // ほかの人の sid を名のっている
      return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.key, unb64(r.sig), enc.encode(canon(r)));
    } catch (e) { return false; }
  }

  /* 受けとったものの 形をたしかめる（値は かえない。署名は もとの値で たしかめるので） */
  function shape(o) {
    if (!o || typeof o !== 'object' || o.f !== FMT) return null;
    if (typeof o.sid !== 'string' || !SID_RE.test(o.sid)) return null;
    if (typeof o.pk !== 'string' || typeof o.sig !== 'string' || o.pk.length > 200 || o.sig.length > 200) return null;
    if (!(o.rev >= 0 && o.rev <= 1e6 && (o.rev | 0) === o.rev) || !(o.t > 0)) return null;
    const r = { f: FMT, sid: o.sid, rev: o.rev, t: +o.t, pk: o.pk, sig: o.sig };
    if (o.del) { r.del = 1; return r; }
    if (typeof o.name !== 'string' || typeof o.by !== 'string' || o.name.length > 16 || o.by.length > 10) return null;
    const m = CS.CustomMaps.clean({ id: 'x', name: o.name, W: o.W, H: o.H, D: o.D, rle: o.rle, sp: o.sp, theme: o.theme });
    if (!m || m.W !== o.W || m.H !== o.H || m.D !== o.D || m.theme !== o.theme) return null;
    if (!Array.isArray(o.sp) || o.sp.length !== 2) return null;
    Object.assign(r, { name: o.name, by: o.by, W: o.W, H: o.H, D: o.D, rle: o.rle, sp: o.sp, theme: o.theme });
    return r;
  }
  /* b は a より新しいか */
  function newer(a, b) {
    if (!a) return true;
    if (b.rev !== a.rev) return b.rev > a.rev;
    return b.t > a.t;
  }

  /* ---------------- 本体 ---------------- */
  const Stages = new CS.Emitter();
  Stages.status = 'idle';               // 'idle' | 'connecting' | 'online' | 'error'
  Stages.ROOT = ROOT;
  Stages.BROKERS = BROKERS;
  Stages.BLOCKED = BLOCKED;

  function setStatus(s) { if (Stages.status !== s) { Stages.status = s; Stages.emit('status', s); Stages.emit('change'); } }

  /* 手もとに入れる（新しければ）。true = 入れた */
  function merge(r) {
    const s = load();
    const cur = s.recs[r.sid];
    s.seen[r.sid] = Date.now();
    if (!newer(cur, r)) return false;
    s.recs[r.sid] = r;
    persistSoon();
    Stages.emit('change');
    return true;
  }

  /* ---- MQTT ---- */
  let libP = null;
  function lib() {
    if (window.mqtt) return Promise.resolve(window.mqtt);
    if (libP) return libP;
    libP = new Promise(function (res, rej) {
      const sc = document.createElement('script');
      sc.src = MQTT_CDN; sc.async = true;
      sc.onload = function () { if (window.mqtt) res(window.mqtt); else { libP = null; rej(new Error('mqtt')); } };
      sc.onerror = function () { libP = null; rej(new Error('mqtt')); };
      document.head.appendChild(sc);
    });
    return libP;
  }
  function openLink(url) {
    return new Promise(function (res) {
      let c = null;
      try { c = window.mqtt.connect(url, { clientId: 'csst_' + rid(), clean: true, reconnectPeriod: 0, connectTimeout: CONNECT_MS, keepalive: 30 }); }
      catch (e) { res(null); return; }
      c.csUrl = url;
      let fin = false;
      const done = function (ok) {
        if (fin) return;
        fin = true;
        if (!ok) { try { c.end(true); } catch (e) {} }
        res(ok ? c : null);
      };
      c.once('connect', function () { done(true); });
      c.once('error', function () { done(false); });
      c.once('close', function () { done(false); });
      setTimeout(function () { done(false); }, CONNECT_MS + 1000);
    });
  }
  function pub(c, r) {
    return new Promise(function (res) {
      if (!c || !c.connected) { res(false); return; }
      let fin = false;
      const done = function (ok) { if (!fin) { fin = true; res(ok); } };
      try { c.publish(ROOT + r.sid, JSON.stringify(r), { qos: 1, retain: true }, function (err) { done(!err); }); }
      catch (e) { done(false); return; }
      setTimeout(function () { done(false); }, 10000);
    });
  }

  /* 見ているあいだの つながり（みんなのステージの画面を開いているあいだ）。gen は とじるたびに ふえる */
  const sess = { links: [], running: null, gen: 0 };

  function closeSession() {
    sess.gen++;
    for (const c of sess.links) { if (c) { try { c.end(true); } catch (e) {} } }
    sess.links = [];
    if (!sess.running) setStatus('idle');
  }

  /* 1つのブローカーの retained を ぜんぶ うけとる（とどいたものから 手もとに入れる）。
     → そのブローカーにあった版 {sid: {rev, t}}。とちゅうで切れた・返事がないときは null */
  function collect(c, pending) {
    return new Promise(function (res) {
      const seen = {};
      const t0 = Date.now();
      let last = t0, start = 0, count = 0, fin = false, tick = 0;
      const done = function (ok) {
        if (fin) return;
        fin = true;
        clearInterval(tick);
        res(ok ? seen : null);
      };
      c.on('message', function (topic, msg) {
        last = Date.now();
        if (topic.indexOf(ROOT) !== 0 || !msg || !msg.length || msg.length > MAX_BYTES || !dec) return;
        if (++count > MAX_RECORDS) return;
        let o = null;
        try { o = JSON.parse(dec.decode(msg)); } catch (e) { return; }
        const r = shape(o);
        if (!r || r.sid !== topic.slice(ROOT.length)) return;
        if (!r.del && !CS.CustomMaps.decode(r.rle, r.W * r.H * r.D)) return;   // ブロックの中身が こわれている
        const p = verify(r).then(function (ok) {
          if (!ok) return;
          const was = seen[r.sid];
          if (!was || newer(was, r)) seen[r.sid] = { rev: r.rev, t: r.t };
          merge(r);
        });
        pending.add(p);
        p.then(function () { pending.delete(p); });
      });
      tick = setInterval(function () {
        const now = Date.now();
        if (!c.connected) { done(false); return; }
        if (!start) { if (now - t0 > CONNECT_MS) done(false); return; }       // subscribe の返事が来ない
        if ((now - start > MIN_WAIT && now - last > QUIET_MS) || now - start > MAX_WAIT) done(true);
      }, 200);
      try {
        c.subscribe(ROOT + '+', { qos: 0 }, function (err) { if (err) done(false); else start = Date.now(); });
      } catch (e) { done(false); }
    });
  }

  /* 公開されているステージを ぜんぶ とってくる（さいごに ブローカーから消えていた分を のせなおす）。
     2つのブローカーは べつべつに進めて、はやいほうが おわったら もう 'online'（一覧は とどいた分から出る）。
     さっき（1分いない）とってきたばかりなら、force でないかぎり 手もとの分だけ */
  let lastOk = 0;
  function refresh(force) {
    if (sess.running) return sess.running;
    if (!force && lastOk && Date.now() - lastOk < 60000) return Promise.resolve(list().length);
    sess.running = (async function () {
      setStatus('connecting');
      try { await lib(); } catch (e) { setStatus('error'); return list().length; }
      closeSession();
      const gen = sess.gen, pending = new Set(), links = [], got = [];
      let any = false;
      await Promise.all(BROKERS.map(async function (url, i) {
        const c = await openLink(url);
        if (!c) return;
        if (gen !== sess.gen) { try { c.end(true); } catch (e) {} return; }   // とちゅうで 画面が とじられた
        sess.links.push(c);
        links[i] = c;
        got[i] = await collect(c, pending);
        if (!got[i]) return;
        any = true;
        await Promise.all(Array.from(pending));
        if (gen === sess.gen) setStatus('online');
      }));
      await Promise.all(Array.from(pending));
      persist();
      if (gen !== sess.gen) { setStatus('idle'); return list().length; }
      if (!any) { setStatus('error'); return list().length; }
      setStatus('online');
      lastOk = Date.now();
      heal(links, got);
      return list().length;
    })().finally(function () { sess.running = null; });
    return sess.running;
  }

  /* ブローカーに なかった・古かった ものを のせなおす（じぶんの → 「けした」しるし → 新しい順）。
     のせなおすのは じぶんのステージと、もう片方のブローカーに いま 同じ版が あったものだけ
     （ブローカーの返事は おくれることがあるので、手もとの古い版で 新しい版を 上書きしないように） */
  function heal(links, got) {
    const s = load();
    const mineTag = s.tag ? s.tag + '-' : '#';
    const confirmed = function (r) {
      if (r.sid.indexOf(mineTag) === 0) return true;
      return got.some(function (g) { const w = g && g[r.sid]; return !!w && w.rev === r.rev && w.t === r.t; });
    };
    const recs = Object.keys(s.recs).map(function (k) { return s.recs[k]; })
      .filter(function (r) { return BLOCKED.indexOf(r.sid) < 0 && confirmed(r); });
    const score = function (r) { return (r.sid.indexOf(mineTag) === 0 ? 2e13 : 0) + (r.del ? 1e13 : 0) + r.t; };
    recs.sort(function (a, b) { return score(b) - score(a); });
    links.forEach(function (c, i) {
      const seen = got[i];
      if (!c || !seen) return;
      let n = 0;
      for (const r of recs) {
        if (n >= HEAL_MAX) break;
        const was = seen[r.sid];
        if (was && !newer(was, r)) continue;
        pub(c, r);
        n++;
      }
    });
  }

  /* 公開したものを 2つのブローカーに のせる（見ている つながりがあれば それを使う）。
     どちらかに のったら すぐ返す（おそいほうは うしろで つづける）。→ のせられた数（0 = どちらもダメ） */
  function pushAll(r) {
    return lib().then(function () {
      return new Promise(function (res) {
        let left = BROKERS.length, ok = 0, fin = false;
        const finish = function () { if (!fin) { fin = true; res(ok); } };
        BROKERS.forEach(function (url) {
          const live = sess.links.find(function (c) { return c && c.connected && c.csUrl === url; });
          (live ? Promise.resolve(live) : openLink(url)).then(function (c) {
            return pub(c, r).then(function (good) {
              if (c && !live) setTimeout(function () { try { c.end(false); } catch (e) {} }, 500);
              return good;
            });
          }).then(function (good) {
            if (good) { ok++; finish(); }
            if (--left === 0) finish();
          });
        });
      });
    });
  }

  /* ---------------- 公開する・やめる ---------------- */
  /* じぶんのマップ（CS.CustomMaps の id）を公開（2回目からは 更新）。→ 公開したステージ */
  async function publish(mapId) {
    const m = CS.CustomMaps.get(mapId);
    if (!m) throw new Error('nomap');
    const key = await myKey();
    const s = load();
    const sid = s.mine[m.id] && s.mine[m.id].indexOf(key.tag + '-') === 0 ? s.mine[m.id] : key.tag + '-' + m.id;
    const prev = s.recs[sid];
    const r = {
      f: FMT, sid: sid, rev: prev ? prev.rev + 1 : 1, t: Date.now(),
      name: clip(m.name, 16) || 'ステージ', by: clip(CS.Settings && CS.Settings.name, 10) || 'プレイヤー',
      W: m.W, H: m.H, D: m.D, rle: m.rle, sp: m.sp, theme: m.theme
    };
    await sign(r, key);
    if (JSON.stringify(r).length > MAX_BYTES) throw new Error('big');
    const n = await pushAll(r);
    if (!n) throw new Error('net');
    s.mine[m.id] = sid;
    merge(r);
    persist();
    return r;
  }
  async function unpublish(sid) {
    const key = await myKey();
    const s = load();
    const cur = s.recs[sid];
    if (!cur || sid.indexOf(key.tag + '-') !== 0) throw new Error('notmine');
    const r = { f: FMT, sid: sid, rev: cur.rev + 1, t: Date.now(), del: 1 };
    await sign(r, key);
    const n = await pushAll(r);
    if (!n) throw new Error('net');
    for (const k in s.mine) if (s.mine[k] === sid) delete s.mine[k];
    merge(r);
    persist();
    return true;
  }

  /* ---------------- しらべる ---------------- */
  function visible(r) {
    const s = load();
    return !!r && !r.del && BLOCKED.indexOf(r.sid) < 0 && s.hidden.indexOf(r.sid) < 0;
  }
  function get(sid) {
    if (typeof sid === 'string' && sid.indexOf('p:') === 0) sid = sid.slice(2);
    const r = load().recs[sid];
    return visible(r) ? r : null;
  }
  /* 見られるステージ（新しい順） */
  function list() {
    const s = load(), out = [];
    for (const k in s.recs) if (visible(s.recs[k])) out.push(s.recs[k]);
    out.sort(function (a, b) { return b.t - a.t; });
    return out;
  }
  function isMine(sid) { const s = load(); return !!s.tag && sid.indexOf(s.tag + '-') === 0; }
  /* じぶんのマップ（CS.CustomMaps の id）が 公開中なら その sid */
  function publishedOf(mapId) {
    const s = load();
    const sid = s.mine[mapId];
    if (!sid) return '';
    const r = s.recs[sid];
    return r && !r.del ? sid : '';
  }
  function toMap(r) {
    return { id: 'x' + r.sid.slice(0, 8), name: r.name, W: r.W, H: r.H, D: r.D, rle: r.rle, sp: r.sp, theme: r.theme, t: r.t };
  }
  /* マップの定義（CS.Maps.get('p:<sid>') から使う） */
  function def(id) {
    const r = get(id);
    if (!r) return null;
    const m = CS.CustomMaps.clean(toMap(r));
    if (!m) return null;
    return {
      id: 'p:' + r.sid, name: r.name, en: 'STAGE', desc: 'by ' + r.by + ' ・ みんなのステージ', custom: true, pub: true, by: r.by,
      W: r.W, D: r.D, build: function () { return CS.CustomMaps.build(m) || CS.Maps.list[0].build(); }
    };
  }
  function wireOf(id) {
    const r = get(id);
    return r ? { name: r.name, W: r.W, H: r.H, D: r.D, rle: r.rle, sp: r.sp, theme: r.theme } : null;
  }
  /* マップをえらぶ画面に出すもの（ほぞんした ＋ さいきん あそんだ） */
  function playable() {
    const s = load(), out = [], seen = {};
    for (const sid of s.recent.concat(s.saved)) {
      if (seen[sid]) continue;
      seen[sid] = 1;
      const d = def(sid);
      if (d) out.push(d);
    }
    return out;
  }
  function toggle(listName, sid, on) {
    const s = load(), L = s[listName];
    const i = L.indexOf(sid);
    if (on === undefined) on = i < 0;
    if (on && i < 0) L.unshift(sid); else if (!on && i >= 0) L.splice(i, 1);
    persist();
    Stages.emit('change');
    return on;
  }
  /* CPU戦・へやで つかった（マップをえらぶ画面に のこす） */
  function noteRecent(sid) {
    const s = load();
    const i = s.recent.indexOf(sid);
    if (i >= 0) s.recent.splice(i, 1);
    s.recent.unshift(sid);
    if (s.recent.length > RECENT_MAX) s.recent.length = RECENT_MAX;
    persist();
  }
  function shareUrl(sid) {
    let base = '';
    try { base = String(location.href).split('#')[0].split('?')[0]; } catch (e) {}
    return base + '?stage=' + sid;
  }

  Object.assign(Stages, {
    refresh: refresh, close: closeSession, publish: publish, unpublish: unpublish,
    list: list, get: get, def: def, wireOf: wireOf, playable: playable, isMine: isMine, publishedOf: publishedOf,
    mapOf: function (id) { const r = get(id); return r ? CS.CustomMaps.clean(toMap(r)) : null; },
    save: function (sid, on) { return toggle('saved', sid, on); },
    hide: function (sid, on) { return toggle('hidden', sid, on); },
    isSaved: function (sid) { return load().saved.indexOf(sid) >= 0; },
    noteRecent: noteRecent, shareUrl: shareUrl,
    canPublish: function () { return !!(subtle && enc); },
    _load: function () { store = null; return load(); },
    _shape: shape, _verify: verify, _canon: canon
  });
  Object.defineProperty(Stages, 'tag', { get: function () { return load().tag; } });   // Object.assign だと その時の値に なってしまう
  CS.Stages = Stages;
})();
