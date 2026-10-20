#!/usr/bin/env node
// SessionStart: start the server if it is down, then open the board once.
// Reads the hook payload from stdin and forwards it to /event itself, so SessionStart needs a single command.
// Never writes stdout (SessionStart stdout would land in Claude's context). Always exit 0.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.AGENT_BOARD_PORT) || 4317;
const HOME = process.env.AGENT_BOARD_HOME || path.join(os.homedir(), '.agent-board');
const SERVER = path.join(__dirname, '..', 'server', 'index.js');
const done = () => process.exit(0);
setTimeout(done, 4000).unref();

function request(method, urlPath, body, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, timeout: timeoutMs, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(body);
  });
}

function startServer() {
  fs.mkdirSync(HOME, { recursive: true });
  const log = fs.openSync(path.join(HOME, 'server.log'), 'a');
  spawn(process.execPath, [SERVER], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
}

async function waitHealthy() {
  for (let i = 0; i < 20; i++) {
    const h = await request('GET', '/health', null, 200);
    if (h) return h;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

// Open once per session; skip when a board tab is already connected (it picks up new sessions live).
function shouldOpen(sessionId, health) {
  if (process.env.AGENT_BOARD_OPEN === '0') return false;
  if (process.env.AGENT_BOARD_OPEN === '1') return true;
  if (health && health.clients > 0) return false;
  const file = path.join(HOME, 'opened.json');
  let opened = {};
  try {
    opened = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (opened[sessionId]) return false;
  opened[sessionId] = Date.now();
  const cutoff = Date.now() - 7 * 864e5;
  for (const k of Object.keys(opened)) if (opened[k] < cutoff) delete opened[k];
  try {
    fs.writeFileSync(file, JSON.stringify(opened));
  } catch {}
  return true;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('error', done);
process.stdin.on('end', async () => {
  let payload = {};
  try {
    payload = JSON.parse(buf);
  } catch {}
  let health = await request('GET', '/health', null, 200);
  if (!health) {
    startServer();
    health = await waitHealthy();
  }
  if (health && payload.session_id) {
    payload.ts = Date.now();
    payload.claude_pid = process.ppid; // hooks run as direct children of claude
    await request('POST', '/event', JSON.stringify(payload), 300);
    // only auto-open for real startups, not /clear, resume or compaction restarts
    if ((payload.source || 'startup') === 'startup' && shouldOpen(payload.session_id, health)) {
      openBrowser(`http://localhost:${PORT}/?session=${encodeURIComponent(payload.session_id)}`);
    }
  }
  done();
});
