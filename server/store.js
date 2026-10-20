// Session/agent state built from hook events. Persisted as an append-only jsonl per session.
// Emits small diffs: { type: 'session', session } (without the activity log) and { type: 'activity', sessionId, item }.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TranscriptMeter } = require('./cost');

const HOME = process.env.AGENT_BOARD_HOME || path.join(os.homedir(), '.agent-board');
const SESSIONS_DIR = path.join(HOME, 'sessions');
const RESTORE_MS = 24 * 3600 * 1000;
const ACTION_MAX = 80;
const ACTIVITY_MAX = 400;
const PAYLOAD_MAX = 4000;
const QUIET_TOOL = /^mcp__agent-board__/;

const sessions = new Map();
const activity = new Map(); // sessionId → item[] (kept out of the session object so diffs stay small)
const meters = new Map(); // `${sessionId}:${agentId}` → TranscriptMeter
const seen = new Set(); // idempotency keys
const listeners = new Set();
let replaying = false;

const short = (s, n = ACTION_MAX) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

// Keeps tool args/results inspectable without shipping huge payloads to the browser.
function clip(v) {
  if (v == null) return v;
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  if (text.length <= PAYLOAD_MAX) return v;
  return text.slice(0, PAYLOAD_MAX) + `… (+${text.length - PAYLOAD_MAX})`;
}

// Paths inside the project read better relative to it: /…/kitaplik/src/cli.js → src/cli.js
function relativize(text, cwd) {
  if (!text || !cwd) return text;
  const home = os.homedir();
  const roots = [cwd, cwd.replace(/^\/private(?=\/)/, '')];
  let out = text;
  for (const r of roots) out = out.split(r + '/').join('').split(r).join('.');
  return out.split(home + '/').join('~/');
}

function toolArg(input, cwd) {
  if (!input || typeof input !== 'object') return '';
  if (Array.isArray(input.questions) && input.questions[0]) return oneLine(input.questions.map((q) => q.question).join(' · '));
  if (input.taskId || input.task_id) return oneLine(`#${input.taskId || input.task_id}${input.status ? ` → ${input.status}` : ''}${input.subject ? ` ${input.subject}` : ''}`);
  if (Array.isArray(input.todos)) return `${input.todos.length} görev`;
  const arg =
    input.file_path || input.notebook_path || input.command || input.pattern || input.url || input.query || input.description || input.subject || input.prompt || input.skill;
  return relativize(oneLine(typeof arg === 'string' ? arg : JSON.stringify(input)), cwd);
}

const describeTool = (name, input, cwd) => short(`${name} ${toolArg(input, cwd)}`.trim());

function subagentDir(transcriptPath, sessionId) {
  return path.join(path.dirname(transcriptPath), sessionId, 'subagents');
}

function readMeta(session, agentId) {
  if (!session.transcriptPath) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(subagentDir(session.transcriptPath, session.id), `agent-${agentId}.meta.json`), 'utf8'));
  } catch {
    return null;
  }
}

function newAgent(id, fields) {
  return {
    id,
    parentId: null,
    type: 'orchestrator',
    description: null,
    model: null,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    toolCalls: 0,
    lastAction: null,
    currentTool: null,
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    costUsd: 0,
    ...fields,
  };
}

function ensureSession(p) {
  let s = sessions.get(p.session_id);
  if (!s) {
    s = {
      id: p.session_id,
      cwd: p.cwd,
      transcriptPath: p.transcript_path,
      startedAt: p.ts,
      endedAt: null,
      lastEventAt: p.ts,
      waiting: null, // 'input' when Claude waits for the next prompt
      background: [], // background tasks/workflows reported by Stop
      tasks: {}, // task list from TaskCreate/TaskUpdate/TodoWrite
      inbox: {}, // things Claude flagged for the user (channel `inbox` tool), keyed by id
      agents: {},
    };
    s.agents.main = newAgent('main', { startedAt: p.ts });
    sessions.set(s.id, s);
    activity.set(s.id, []);
  }
  if (!s.transcriptPath && p.transcript_path) s.transcriptPath = p.transcript_path;
  if (!s.inbox) s.inbox = {};
  // 'transcript' = only read from disk (no approvals/messages); any hook event upgrades it for good
  if (p.via === 'transcript') s.via = s.via || 'transcript';
  else if (p.hook_event_name !== 'BoardActivity' && p.hook_event_name !== 'BoardInbox') s.via = 'hook';
  if (!s.cwd && p.cwd) s.cwd = p.cwd;
  s.lastEventAt = Math.max(s.lastEventAt || 0, p.ts);
  return s;
}

function ensureAgent(s, id, p) {
  if (!s.agents[id]) s.agents[id] = newAgent(id, { parentId: 'main', type: p.agent_type || 'subagent', startedAt: p.ts });
  return s.agents[id];
}

function applyMeta(s, a) {
  const meta = readMeta(s, a.id);
  if (!meta) return;
  if (meta.parentAgentId) a.parentId = meta.parentAgentId;
  if (meta.agentType) a.type = meta.agentType;
  if (meta.description && meta.description !== a.description) {
    a.description = meta.description;
    linkTasks(s);
  }
}

function transcriptFor(s, agentId) {
  if (agentId === 'main') return s.transcriptPath;
  return s.transcriptPath && path.join(subagentDir(s.transcriptPath, s.id), `agent-${agentId}.jsonl`);
}

// Re-reads the agent's transcript (incrementally) and refreshes model/tokens/cost.
function refreshCost(s, a, file) {
  file = file || transcriptFor(s, a.id);
  if (!file) return;
  const key = `${s.id}:${a.id}`;
  let m = meters.get(key);
  if (!m || m.file !== file) meters.set(key, (m = new TranscriptMeter(file)));
  const sum = m.read().summary();
  if (!sum.messages) return;
  a.model = sum.model;
  a.tokens = sum.tokens;
  a.costUsd = sum.costUsd;
}

// --- activity log -----------------------------------------------------------

const changed = []; // activity items touched by the current reduce() call

function upsertActivity(s, item) {
  const list = activity.get(s.id);
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = { ...list[i], ...item };
  else {
    list.push(item);
    if (list.length > ACTIVITY_MAX) list.splice(0, list.length - ACTIVITY_MAX);
  }
  changed.push(i >= 0 ? list[i] : item);
}

function toolFailed(r) {
  if (!r || typeof r !== 'object') return false;
  return r.is_error === true || r.interrupted === true || r.status === 'failed' || r.success === false;
}

// --- tasks ------------------------------------------------------------------

// A task's assignee is a guess (Claude Code doesn't record who works on what). Strength order:
// explicit "#id" in a subagent's description > the subagent updating the task itself >
// word overlap between task and subagent description > whoever last moved the task.
const ASSIGN_RANK = { explicit: 4, self: 3, match: 2, updater: 1 };
// generic words say nothing about which agent does what ("tüm testleri npm test ile çalıştır" vs "Standings testleri")
const STOP = new Set(['the', 'and', 'for', 'with', 'ile', 'için', 've', 'bir', 'bu', 'şu', 'olan', 'yap', 'yaz', 'run', 'task', 'görev', 'test', 'tests', 'testler', 'testleri', 'npm', 'node', 'src', 'ekle', 'güncelle', 'dosya', 'dosyası', 'tüm']);
// paths count whole and by their parts, so "test/store.test.js" also matches "store.test.js"
function words(text) {
  const out = new Set();
  for (const w of String(text || '').toLocaleLowerCase('tr').split(/[^\p{L}\p{N}./_-]+/u)) {
    const base = w.includes('/') ? [w.slice(w.lastIndexOf('/') + 1)] : [];
    for (const part of [w, ...base, ...(/[/.]/.test(w) ? w.split(/[/.]/) : [])]) if (part.length > 2 && !STOP.has(part)) out.add(part);
  }
  return out;
}

function assign(t, agentId, how) {
  if (t.assignee && ASSIGN_RANK[t.assigneeBy] > ASSIGN_RANK[how]) return;
  t.assignee = agentId;
  t.assigneeBy = how;
}

function linkTasks(s) {
  const subs = Object.values(s.agents).filter((a) => a.id !== 'main' && a.description);
  // "#1 …" is explicit; several subagents may share one task (Claude splits work), so keep them all
  const explicit = new Set();
  for (const t of Object.values(s.tasks)) t.helpers = [];
  for (const a of subs.sort((x, y) => x.startedAt - y.startedAt)) {
    const m = a.description.match(/^\s*#(\d+)\b/) || a.description.match(/#(\d+)\b/);
    const t = m && s.tasks[m[1]];
    if (!t) continue;
    explicit.add(a.id);
    if (t.assigneeBy === 'explicit' && t.assignee && t.assignee !== a.id) t.helpers.push(a.id);
    else assign(t, a.id, 'explicit');
  }
  for (const t of Object.values(s.tasks)) {
    if (t.assignee && ASSIGN_RANK[t.assigneeBy] >= ASSIGN_RANK.match) continue;
    const tw = words(`${t.subject} ${t.activeForm || ''}`);
    let best = null;
    let score = 0;
    for (const a of subs) {
      if (explicit.has(a.id)) continue; // already tied to its own task
      const aw = words(a.description);
      let hit = 0;
      for (const w of aw) if (tw.has(w)) hit++;
      const sc = hit / Math.max(1, Math.min(tw.size, aw.size));
      if (hit >= 2 && sc > score) [best, score] = [a, sc];
    }
    if (best && score >= 0.4) assign(t, best.id, 'match');
  }
}

function applyTasks(s, p, agentId) {
  const input = p.tool_input || {};
  const res = p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {};
  const now = p.ts;
  const status = (t, st) => {
    if (!st || st === t.status) return;
    t.status = st;
    if (st === 'in_progress' && !t.startedAt) t.startedAt = now;
    if (st === 'completed') t.completedAt = now;
  };
  switch (p.tool_name) {
    case 'TodoWrite': {
      for (const k of Object.keys(s.tasks)) if (s.tasks[k].source === 'todo' && s.tasks[k].agentId === agentId) delete s.tasks[k];
      (input.todos || []).forEach((td, i) => {
        const id = `todo:${agentId}:${i}`;
        const t = { id, subject: td.content || td.subject || '', activeForm: td.activeForm || null, status: 'pending', agentId, source: 'todo', createdAt: now, updatedAt: now };
        status(t, td.status || 'pending');
        assign(t, agentId, agentId === 'main' ? 'updater' : 'self');
        s.tasks[id] = t;
      });
      break;
    }
    case 'TaskCreate': {
      const r = res.task || res;
      const id = String(r.id || r.taskId || p.tool_use_id);
      s.tasks[id] = {
        id,
        subject: input.subject || r.subject || '',
        description: input.description || null,
        activeForm: input.activeForm || null,
        status: 'pending',
        agentId, // creator
        assignee: null,
        source: 'task',
        createdAt: now,
        updatedAt: now,
      };
      break;
    }
    case 'TaskUpdate': {
      const id = String(input.taskId || input.task_id || input.id || '');
      if (!id) return;
      if (input.status === 'deleted') return void delete s.tasks[id];
      const t = (s.tasks[id] = s.tasks[id] || { id, subject: `#${id}`, status: 'pending', agentId, source: 'task', createdAt: now });
      status(t, input.status);
      if (input.subject) t.subject = input.subject;
      if (input.activeForm) t.activeForm = input.activeForm;
      if (input.owner) t.owner = input.owner;
      if (input.status) assign(t, agentId, agentId === 'main' ? 'updater' : 'self');
      t.updatedAt = now;
      break;
    }
    case 'TaskList': {
      const list = Array.isArray(res.tasks) ? res.tasks : null;
      if (!list) return;
      for (const r of list) {
        const id = String(r.id);
        const t = (s.tasks[id] = s.tasks[id] || { id, agentId, source: 'task', status: 'pending', createdAt: now });
        t.subject = r.subject || t.subject || '';
        status(t, r.status);
        t.updatedAt = now;
      }
      break;
    }
    default:
      return;
  }
  linkTasks(s);
}

// --- reducer ----------------------------------------------------------------

function idempotencyKey(p) {
  const id = p.agent_id || 'main';
  switch (p.hook_event_name) {
    case 'PreToolUse':
    case 'PostToolUse':
      return p.tool_use_id && `${p.session_id}:${p.hook_event_name}:${p.tool_use_id}`;
    case 'SubagentStart':
    case 'SubagentStop':
      return `${p.session_id}:${p.hook_event_name}:${id}`;
    default:
      return null;
  }
}

function reduce(p) {
  if (!p || !p.session_id || !p.hook_event_name) return null;
  p.ts = p.ts || Date.now();
  const key = idempotencyKey(p);
  if (key) {
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const s = ensureSession(p);
  const main = s.agents.main;
  const agentId = p.agent_id || 'main';
  const end = (a) => {
    a.status = 'done';
    a.endedAt = Math.max(a.endedAt || 0, p.ts);
    a.currentTool = null;
  };
  const touch = (a) => {
    if (a !== main && !a.description) applyMeta(s, a); // meta.json usually lands after SubagentStart
    if (a.status !== 'done' || a === main) a.status = 'running';
    if (a === main) main.endedAt = null;
  };

  switch (p.hook_event_name) {
    case 'SessionStart':
      // a fresh, resumed or cleared session sits at the prompt until UserPromptSubmit
      s.endedAt = null;
      if (p.claude_pid) s.pid = p.claude_pid;
      Object.assign(main, { status: 'done', endedAt: p.ts });
      s.waiting = 'input';
      break;

    case 'UserPromptSubmit':
      Object.assign(main, { status: 'running', endedAt: null });
      s.waiting = null;
      // our own channel messages are already in the log as 'board-message'
      if (/^\s*<channel source="agent-board"/.test(p.prompt || '')) break;
      // background agents report back through a synthetic prompt; show it as a system notice
      if (/^\s*<task-notification>/.test(p.prompt || '')) {
        const tag = (t) => ((p.prompt.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1] || '').trim();
        upsertActivity(s, { id: `notice:${p.prompt_id || p.ts}`, ts: p.ts, agentId: 'main', kind: 'notice', summary: tag('summary') || 'Arka plan görevi bildirimi', status: tag('status') === 'failed' ? 'error' : 'success' });
      } else {
        upsertActivity(s, { id: `prompt:${p.prompt_id || p.ts}`, ts: p.ts, agentId: 'main', kind: 'prompt', summary: short(oneLine(p.prompt || ''), 600), status: 'info' });
      }
      break;

    case 'SubagentStart': {
      const a = ensureAgent(s, p.agent_id, p);
      a.startedAt = Math.min(a.startedAt, p.ts);
      applyMeta(s, a);
      // no activity item here: the parent's Agent tool call already shows the spawn, and the
      // description (meta.json) usually isn't written yet. SubagentStop adds the result item.
      break;
    }

    case 'SubagentStop': {
      // claude's own short-lived helper agents end without a start, a type or a transcript: not user work
      if (!s.agents[p.agent_id] && !p.agent_type) return null;
      const a = ensureAgent(s, p.agent_id, p);
      end(a);
      applyMeta(s, a);
      refreshCost(s, a, p.agent_transcript_path);
      upsertActivity(s, {
        id: `agent:${a.id}`,
        ts: a.startedAt,
        agentId: a.parentId || 'main',
        kind: 'agent',
        name: a.type,
        summary: a.description || a.type,
        childId: a.id,
        status: 'success',
        duration: a.endedAt - a.startedAt,
        result: clip(p.last_assistant_message),
      });
      break;
    }

    case 'PreToolUse': {
      const a = p.agent_id ? ensureAgent(s, p.agent_id, p) : main;
      touch(a);
      s.waiting = null;
      // the channel's reply tool is plumbing, not an action worth showing on the card
      if (!QUIET_TOOL.test(p.tool_name)) {
        a.currentTool = describeTool(p.tool_name, p.tool_input, s.cwd);
        a.lastAction = a.currentTool;
      }
      upsertActivity(s, { id: `tool:${p.tool_use_id || p.ts}`, ts: p.ts, agentId, kind: 'tool', name: p.tool_name, summary: toolArg(p.tool_input, s.cwd), args: clip(p.tool_input), status: 'running' });
      break;
    }

    case 'PostToolUse': {
      const a = p.agent_id ? ensureAgent(s, p.agent_id, p) : main;
      touch(a);
      a.toolCalls += 1;
      a.currentTool = null;
      if (!QUIET_TOOL.test(p.tool_name)) a.lastAction = describeTool(p.tool_name, p.tool_input, s.cwd);
      const id = `tool:${p.tool_use_id || p.ts}`;
      const prev = activity.get(s.id).find((x) => x.id === id);
      upsertActivity(s, {
        id,
        ts: prev ? prev.ts : p.ts - (p.duration_ms || 0),
        agentId,
        kind: 'tool',
        name: p.tool_name,
        summary: toolArg(p.tool_input, s.cwd),
        args: clip(p.tool_input),
        result: clip(p.tool_response),
        status: toolFailed(p.tool_response) ? 'error' : 'success',
        duration: p.duration_ms != null ? p.duration_ms : prev ? p.ts - prev.ts : undefined,
      });
      applyTasks(s, p, agentId);
      // the channel can't tell which agent called its inbox tool; the hook can
      if (p.tool_name === 'mcp__agent-board__inbox' && agentId !== 'main') {
        const title = p.tool_input && p.tool_input.title;
        const it = Object.values(s.inbox).find((x) => x.title === String(title || '').slice(0, 300) && x.agentId === 'main' && p.ts - x.createdAt < 60000);
        if (it) it.agentId = agentId;
      }
      // An Agent call that returned tells us exactly who spawned whom.
      const child = p.tool_name === 'Agent' && p.tool_response && p.tool_response.agentId;
      if (child) {
        const c = ensureAgent(s, child, { agent_type: p.tool_response.agentType, ts: p.ts });
        c.parentId = a.id;
        if (p.tool_response.status === 'completed' || p.tool_response.status === 'failed') {
          if (c.status === 'running') end(c);
          if (p.tool_response.status === 'failed') c.status = 'error';
        }
        if (!c.description && p.tool_input && p.tool_input.description) {
          c.description = p.tool_input.description;
          linkTasks(s); // background agents return here right away; link before the first card renders twice
        }
      }
      break;
    }

    // items produced by the board itself (approvals, board ↔ Claude messages); persisted like hook events
    // inbox items Claude posted, or the user's read/answer marks on them
    case 'BoardInbox': {
      const it = p.item;
      if (!it || !it.id) return null;
      s.inbox[it.id] = { ...(s.inbox[it.id] || {}), ...it };
      break;
    }

    case 'BoardActivity':
      if (!p.item || !p.item.id) return null;
      upsertActivity(s, p.item);
      break;

    case 'Notification':
      if (p.notification_type === 'idle_prompt') s.waiting = 'input';
      break;

    case 'Stop':
    case 'StopFailure':
      end(main);
      if (p.hook_event_name === 'StopFailure') main.status = 'error';
      s.waiting = 'input';
      if (Array.isArray(p.background_tasks)) s.background = p.background_tasks.slice(0, 50);
      refreshCost(s, main);
      if (p.last_assistant_message) {
        upsertActivity(s, { id: `turn:${p.prompt_id || p.ts}`, ts: p.ts, agentId: 'main', kind: 'reply', summary: clip(p.last_assistant_message), status: 'info' });
      }
      break;

    case 'SessionEnd':
      s.endedAt = p.ts;
      s.waiting = null;
      for (const a of Object.values(s.agents)) if (a.status === 'running') end(a);
      refreshCost(s, main);
      break;

    default:
      return null;
  }
  return s;
}

function persist(p) {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.appendFileSync(path.join(SESSIONS_DIR, `${p.session_id}.jsonl`), JSON.stringify(p) + '\n');
  } catch {}
}

function emit(msg) {
  if (replaying) return;
  for (const fn of listeners) fn(msg);
}

function emitSession(s) {
  emit({ type: 'session', session: s });
}

// Throttled live cost refresh for agents that are mid-run.
const pending = new Map();
function scheduleRefresh(s, agentId) {
  const key = `${s.id}:${agentId}`;
  if (pending.has(key)) return;
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      const a = s.agents[agentId];
      if (!a) return;
      refreshCost(s, a);
      emitSession(s);
    }, 1000)
  );
}

function ingest(p) {
  changed.length = 0;
  const s = reduce(p);
  if (!s) return null;
  // transcript-derived events are re-read from the transcript after a restart; no copy needed
  if (p.via !== 'transcript') persist(p);
  // stop hooks can fire before the final assistant message is flushed: read again shortly after
  if (['PostToolUse', 'SubagentStop', 'Stop', 'SessionEnd'].includes(p.hook_event_name)) scheduleRefresh(s, p.agent_id || 'main');
  emitSession(s);
  for (const item of changed.splice(0)) emit({ type: 'activity', sessionId: s.id, item });
  return s;
}

const ingestAll = (events) => {
  for (const p of events) ingest(p);
};

// Bulk reads (a long transcript seen for the first time) skip per-event broadcasts;
// open pages get one "resync" and reload the snapshot instead.
function quietly(fn) {
  const was = replaying;
  replaying = true;
  try {
    fn();
  } finally {
    replaying = was;
    changed.length = 0;
  }
  if (!was) emit({ type: 'resync' });
}

function patchSession(id, fields) {
  const s = sessions.get(id);
  if (!s) return;
  Object.assign(s, fields);
  emitSession(s);
}

// Lets other modules (approvals, channels) add items to a session's activity log.
function addInbox(sessionId, item) {
  if (!sessions.has(sessionId)) return null;
  return ingest({ session_id: sessionId, hook_event_name: 'BoardInbox', item, ts: Date.now() });
}

function addActivity(sessionId, item) {
  if (!sessions.has(sessionId)) return;
  ingest({ session_id: sessionId, hook_event_name: 'BoardActivity', item, ts: item.ts || Date.now() });
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// Terminal tabs closed without SessionEnd (or a crashed claude) would stay "live" forever.
function sweepDead() {
  for (const s of sessions.values()) {
    if (s.endedAt || !s.pid || alive(s.pid)) continue;
    ingest({ session_id: s.id, hook_event_name: 'SessionEnd', reason: 'process-exit', ts: Date.now(), via: s.via === 'transcript' ? 'transcript' : undefined });
  }
}

function restore() {
  let files = [];
  try {
    files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return 0;
  }
  const cutoff = Date.now() - RESTORE_MS;
  replaying = true;
  for (const f of files) {
    const file = path.join(SESSIONS_DIR, f);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) continue;
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          reduce(JSON.parse(line));
        } catch {}
      }
    } catch {}
  }
  replaying = false;
  changed.length = 0;
  for (const s of sessions.values()) {
    for (const a of Object.values(s.agents)) refreshCost(s, a);
    // a session with no event for 6h and no SessionEnd is most likely dead (terminal closed)
    if (!s.endedAt && Date.now() - s.lastEventAt > 6 * 3600 * 1000) s.endedAt = s.lastEventAt;
  }
  return sessions.size;
}

module.exports = {
  ingestAll,
  quietly,
  patchSession,
  addInbox,
  alive,
  sweepDead,
  ingest,
  restore,
  addActivity,
  getSession: (id) => sessions.get(id) || null,
  getActivity: (id, limit = 150) => (activity.get(id) || []).slice(-limit),
  listSessions: () => [...sessions.values()].sort((a, b) => b.startedAt - a.startedAt),
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  HOME,
};
