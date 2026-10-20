// Board ↔ Claude messaging through the agent-board channel (channel/server.js, one per claude process).
// Channel servers hold GET /channel/stream?pid=<claude pid> open; sessions know their claude pid
// from SessionStart, so a board message for a session is written to the stream with the same pid.
const crypto = require('crypto');
const store = require('./store');

const streams = new Map(); // claude pid → http.ServerResponse
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) fn({ type: 'channels', pids: [...streams.keys()] });
};

const sessionForPid = (pid) => store.listSessions().find((s) => s.pid === pid && !s.endedAt) || null;

function connect(pid, req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': connected\n\n');
  req.socket.setTimeout(0);
  const prev = streams.get(pid);
  if (prev && prev !== res) prev.end();
  streams.set(pid, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    if (streams.get(pid) === res) {
      streams.delete(pid);
      emit();
    }
  });
  emit();
}

// Board → Claude. Returns { ok } or { ok: false, error }.
function sendMessage(sessionId, text) {
  const s = store.getSession(sessionId);
  if (!s) return { ok: false, error: 'session not found' };
  const res = s.pid && streams.get(s.pid);
  if (!res) return { ok: false, error: 'no-channel' };
  const msg = { id: crypto.randomUUID().slice(0, 8), text };
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
  store.addActivity(sessionId, { id: `board-msg:${msg.id}`, ts: Date.now(), agentId: 'main', kind: 'board-message', summary: text, status: 'info' });
  return { ok: true, id: msg.id };
}

// Claude → board (the channel's reply tool).
function reply({ pid, chat_id, text }) {
  const s = sessionForPid(Number(pid));
  if (!s) return { ok: false, error: 'session not found' };
  store.addActivity(s.id, { id: `board-reply:${crypto.randomUUID().slice(0, 8)}`, ts: Date.now(), agentId: 'main', kind: 'board-reply', summary: text, replyTo: chat_id || null, status: 'info' });
  return { ok: true };
}

// Claude → board inbox (the channel's inbox tool)
const KINDS = new Set(['decision', 'review', 'info']);
function inbox({ pid, kind, title, body, task_id }) {
  const s = sessionForPid(Number(pid));
  if (!s || !title) return { ok: false, error: s ? 'title required' : 'session not found' };
  const item = {
    id: `inb_${crypto.randomUUID().slice(0, 8)}`,
    kind: KINDS.has(kind) ? kind : 'info',
    title: String(title).slice(0, 300),
    body: body ? String(body).slice(0, 6000) : null,
    taskId: task_id != null && task_id !== '' ? String(task_id).replace(/^#/, '') : null,
    agentId: 'main',
    createdAt: Date.now(),
    status: 'unread',
  };
  store.addInbox(s.id, item);
  return { ok: true, id: item.id };
}

module.exports = {
  inbox,
  connect,
  sendMessage,
  reply,
  pids: () => [...streams.keys()],
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
};
