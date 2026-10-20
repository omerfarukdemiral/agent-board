// Permission requests from the PermissionRequest hook, answered from the board.
// The hook long-polls POST /permission; Claude shows its own terminal dialog at the same time,
// so whichever side answers first wins. A terminal answer is detected by the tool's next
// PreToolUse/PostToolUse (or the hook connection closing) and the board card is retired.
const crypto = require('crypto');
const store = require('./store');

const requests = new Map(); // id → request (without the held response)
const held = new Map(); // id → http.ServerResponse
const listeners = new Set();
const KEEP_RESOLVED = 50;

const emit = (req) => {
  for (const fn of listeners) fn({ type: 'request', request: req });
};

const sameInput = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

function settle(r, status, extra = {}) {
  if (r.status !== 'pending') return;
  Object.assign(r, { status, resolvedAt: Date.now() }, extra);
  held.delete(r.id);
  emit(r);
  store.addActivity(r.sessionId, activityItem(r));
  // trim old resolved requests
  const resolved = [...requests.values()].filter((x) => x.status !== 'pending');
  for (const x of resolved.slice(0, Math.max(0, resolved.length - KEEP_RESOLVED))) requests.delete(x.id);
}

function activityItem(r) {
  const label = { pending: 'bekliyor', allowed: 'board: izin verildi', denied: 'board: reddedildi', answered: 'board: cevaplandı', elsewhere: 'terminalde cevaplandı' }[r.status];
  return {
    id: `approval:${r.id}`,
    ts: r.createdAt,
    agentId: r.agentId,
    kind: 'approval',
    name: r.toolName,
    summary: label,
    status: r.status === 'pending' ? 'running' : r.status === 'denied' ? 'error' : 'success',
    duration: r.resolvedAt ? r.resolvedAt - r.createdAt : undefined,
  };
}

// POST /permission body = PermissionRequest hook payload. Holds `res` until decided.
function open(payload, res, pid) {
  const r = {
    pid: Number(pid) || null,
    id: crypto.randomUUID(),
    sessionId: payload.session_id,
    agentId: payload.agent_id || 'main',
    agentType: payload.agent_type || null,
    cwd: payload.cwd,
    toolName: payload.tool_name,
    toolInput: payload.tool_input || {},
    suggestions: payload.permission_suggestions || [],
    kind: payload.tool_name === 'AskUserQuestion' ? 'question' : 'permission',
    createdAt: Date.now(),
    status: 'pending',
  };
  // make sure the session exists on the board even if we missed its SessionStart
  store.ingest({ ...payload, hook_event_name: 'Notification', notification_type: 'permission_request', ts: r.createdAt });
  requests.set(r.id, r);
  held.set(r.id, res);
  res.on('close', () => {
    // hook process went away (terminal answered and Claude killed it, or it timed out)
    if (r.status === 'pending' && !res.writableEnded) settle(r, 'elsewhere');
  });
  emit(r);
  store.addActivity(r.sessionId, activityItem(r));
  return r;
}

// decision: { behavior: 'allow'|'deny', message?, answers?, remember? }
function decide(id, decision) {
  const r = requests.get(id);
  const res = held.get(id);
  if (!r || r.status !== 'pending' || !res) return { ok: false, error: 'request is no longer pending' };

  let out;
  if (decision.behavior === 'deny') {
    out = { behavior: 'deny', message: decision.message || 'Denied from agent-board.' };
  } else {
    out = { behavior: 'allow' };
    if (r.kind === 'question' && decision.answers) out.updatedInput = { ...r.toolInput, answers: decision.answers };
    if (decision.remember && r.suggestions.length) out.updatedPermissions = r.suggestions;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: out } }));
  settle(r, decision.behavior === 'deny' ? 'denied' : r.kind === 'question' ? 'answered' : 'allowed', {
    answers: decision.answers || null,
    message: out.message || null,
  });
  return { ok: true };
}

// Called for every hook event: once the agent moves on, the terminal must have answered.
store.subscribe((msg) => {
  if (msg.type !== 'activity' || msg.item.kind !== 'tool') return;
  for (const r of requests.values()) {
    if (r.status !== 'pending' || r.sessionId !== msg.sessionId || r.agentId !== msg.item.agentId) continue;
    if (r.toolName === msg.item.name && msg.item.status !== 'running' && sameInput(r.toolInput, msg.item.args)) settle(r, 'elsewhere');
  }
});

// Hook processes orphaned by a killed claude keep their connection open: retire those cards.
function sweepDead() {
  for (const r of requests.values()) {
    if (r.status !== 'pending' || !r.pid || store.alive(r.pid)) continue;
    const res = held.get(r.id);
    settle(r, 'elsewhere');
    if (res && !res.writableEnded) res.end();
  }
}

function onSessionEvent(sessionId, event) {
  // a finished turn or session can't have a live permission prompt
  if (!['Stop', 'SessionEnd', 'UserPromptSubmit'].includes(event)) return;
  for (const r of requests.values()) if (r.status === 'pending' && r.sessionId === sessionId) settle(r, 'elsewhere');
}

module.exports = {
  open,
  decide,
  onSessionEvent,
  sweepDead,
  list: () => [...requests.values()],
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
};
