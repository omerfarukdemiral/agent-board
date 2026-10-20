#!/usr/bin/env node
// agent-board server: hook intake, state snapshot, SSE stream, static ui. Binds to localhost only.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const approvals = require('./approvals');
const channels = require('./channels');

const PORT = Number(process.env.AGENT_BOARD_PORT) || 4317;
const UI_DIR = path.join(__dirname, '..', 'ui', 'dist');
const MAX_BODY = 5 * 1024 * 1024;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

const clients = new Set();
// Per-process secret for /decision. Only pages served by this server get it (injected into index.html),
// so another website open in the browser cannot approve tool calls.
const TOKEN = require('crypto').randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};

const broadcast = (msg) => {
  const line = `event: ${msg.type}\ndata: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
};
store.subscribe(broadcast);
approvals.subscribe(broadcast);
channels.subscribe(broadcast);

function readJson(req, cb) {
  let body = '';
  req.on('data', (d) => {
    body += d;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on('end', () => {
    try {
      cb(JSON.parse(body));
    } catch (e) {
      cb(null, e);
    }
  });
}

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(UI_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(UI_DIR)) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(UI_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ui build bulunamadı: cd ui && npm install && npm run build');
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  if (file.endsWith('index.html')) {
    const html = fs.readFileSync(file, 'utf8').replace('</head>', `<meta name="agent-board-token" content="${TOKEN}" /></head>`);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    return res.end(html);
  }
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  // DNS-rebinding guard: only answer to our own host names
  if (!ALLOWED_HOSTS.has(req.headers.host)) return json(res, 421, { error: 'bad host' });
  // browsers always send Origin on cross-site POSTs; hooks (curl/node) send none
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return json(res, 403, { error: 'bad origin' });
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, pid: process.pid, clients: clients.size, sessions: store.listSessions().length });
  }

  if (req.method === 'POST' && url.pathname === '/event') {
    return readJson(req, (p, err) => {
      // answer first so the hook can exit; process afterwards
      json(res, 202, { ok: true });
      if (err) return console.error('[agent-board] bad event:', err.message);
      store.ingest(p);
      approvals.onSessionEvent(p);
    });
  }

  // PermissionRequest hook: held open until the board decides or the hook goes away
  if (req.method === 'POST' && url.pathname === '/permission') {
    return readJson(req, (p) => {
      if (!p || !p.session_id || process.env.AGENT_BOARD_APPROVALS === '0') return res.end();
      req.socket.setTimeout(0);
      approvals.open(p, res, req.headers['x-claude-pid']);
    });
  }

  // channel/server.js (spawned by claude) listens here for board messages to its claude process
  if (req.method === 'GET' && url.pathname === '/channel/stream') {
    const pid = Number(url.searchParams.get('pid'));
    if (!pid) return json(res, 400, { error: 'pid required' });
    return channels.connect(pid, req, res);
  }

  if (req.method === 'POST' && url.pathname === '/channel/reply') {
    return readJson(req, (d) => {
      if (!d || !d.pid) return json(res, 400, { error: 'pid required' });
      const r = channels.reply(d);
      json(res, r.ok ? 200 : 404, r);
    });
  }

  // board → Claude message; same token rule as /decision
  if (req.method === 'POST' && url.pathname === '/message') {
    return readJson(req, (d) => {
      if (req.headers['x-agent-board-token'] !== TOKEN) return json(res, 403, { error: 'bad token' });
      const text = d && typeof d.text === 'string' ? d.text.trim() : '';
      if (!d || !d.sessionId || !text) return json(res, 400, { error: 'sessionId and text required' });
      const r = channels.sendMessage(d.sessionId, text.slice(0, 20000));
      json(res, r.ok ? 200 : 409, r);
    });
  }

  if (req.method === 'POST' && url.pathname === '/decision') {
    return readJson(req, (d) => {
      if (req.headers['x-agent-board-token'] !== TOKEN) return json(res, 403, { error: 'bad token' });
      if (!d || !d.id) return json(res, 400, { error: 'id required' });
      const r = approvals.decide(d.id, d);
      json(res, r.ok ? 200 : 409, r);
    });
  }

  if (req.method === 'GET' && url.pathname === '/state') {
    const id = url.searchParams.get('session');
    if (id) {
      const s = store.getSession(id);
      return s ? json(res, 200, { session: s, activity: store.getActivity(id) }) : json(res, 404, { error: 'session not found' });
    }
    const sessions = store.listSessions();
    return json(res, 200, {
      sessions,
      activity: Object.fromEntries(sessions.map((s) => [s.id, store.getActivity(s.id)])),
      requests: approvals.list(),
      channels: channels.pids(),
    });
  }

  if (req.method === 'GET' && url.pathname === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  json(res, 404, { error: 'not found' });
});

const restored = store.restore();
setInterval(() => {
  store.sweepDead();
  approvals.sweepDead();
}, 5000).unref();
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[agent-board] port ${PORT} dolu, başka bir sunucu çalışıyor olabilir`);
    process.exit(0);
  }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-board] http://localhost:${PORT} · ${restored} oturum geri yüklendi · veri: ${store.HOME}`);
});
