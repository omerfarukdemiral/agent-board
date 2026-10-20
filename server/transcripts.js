// Watch-only sessions: any Claude Code session on this machine, read from its transcript.
// Sessions started with claude-board (hooks) are skipped; everything else that wrote to
// ~/.claude/projects recently is turned into the same events the hooks would have sent.
// No approvals or messages here: those need the hooks and the channel.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');

const ROOT = process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects') : path.join(os.homedir(), '.claude', 'projects');
const WINDOW_MS = (Number(process.env.AGENT_BOARD_TRANSCRIPT_HOURS) || 2) * 3600 * 1000;
const IDLE_END_MS = 15 * 60 * 1000; // no claude process found and no writes for this long: treat as closed
const SCAN_MS = 2500;

const files = new Map(); // transcript path → parser state
const known = new Map(); // sessionId → { main, ended }
let pids = new Map(); // sessionId → claude pid (from `--session-id` / `--resume` on the command line)

const tsOf = (e) => (e.timestamp ? Date.parse(e.timestamp) : Date.now());
const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
      : '';

const CHUNK = 4 * 1024 * 1024;
const INPUT_MAX = 4000;

// Next complete lines, at most CHUNK bytes at a time (transcripts reach hundreds of MB). null at EOF.
function readChunk(st) {
  let fd;
  try {
    fd = fs.openSync(st.file, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < st.offset) Object.assign(st, { offset: 0, rest: '' });
    if (size === st.offset) return null;
    const len = Math.min(CHUNK, size - st.offset);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.offset);
    st.offset += len;
    const lines = (st.rest + buf.toString('utf8')).split('\n');
    st.rest = lines.pop();
    return lines;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Only user and assistant lines matter; the rest (request blobs, snapshots…) can be megabytes each.
// Both carry their kind near the start, so this check is cheap and skips JSON.parse for the bulk.
const WANTED = /"type":"user"|"role":"assistant"/;
const wanted = (line) => WANTED.test(line.slice(0, 600));

// tool inputs are kept for the activity log and task tools; huge ones (Write contents) are cut
function slim(input) {
  const text = JSON.stringify(input || {});
  return text.length <= INPUT_MAX ? input : { _clipped: text.slice(0, INPUT_MAX) + '…' };
}

// One transcript line → zero or more hook-shaped events.
function translate(st, e) {
  if (!e || !e.type || e.isMeta) return [];
  const base = { session_id: st.sessionId, transcript_path: st.mainFile, cwd: e.cwd || st.cwd, ts: tsOf(e), via: 'transcript' };
  if (e.cwd) st.cwd = e.cwd;
  if (st.agentId) Object.assign(base, { agent_id: st.agentId, agent_type: st.agentType });
  const out = [];

  if (e.type === 'user') {
    const c = e.message && e.message.content;
    const results = Array.isArray(c) ? c.filter((x) => x.type === 'tool_result') : [];
    for (const r of results) {
      const call = st.tools.get(r.tool_use_id);
      if (!call) continue;
      out.push({
        ...base,
        hook_event_name: 'PostToolUse',
        tool_name: call.name,
        tool_input: call.input,
        tool_use_id: r.tool_use_id,
        tool_response: slim(e.toolUseResult !== undefined && results.length === 1 ? e.toolUseResult : { content: textOf(r.content), is_error: !!r.is_error }),
        duration_ms: Math.max(0, base.ts - call.ts),
      });
    }
    // a subagent's first "user" line is the brief from its parent, not something the user typed
    if (!results.length && !st.agentId) {
      const prompt = textOf(c).trim();
      if (prompt) out.push({ ...base, hook_event_name: 'UserPromptSubmit', prompt, prompt_id: e.promptId || e.uuid });
    }
  }

  if (e.type === 'assistant' && e.message) {
    const m = e.message;
    for (const b of m.content || []) {
      if (b.type === 'tool_use') {
        const input = slim(b.input);
        st.tools.set(b.id, { name: b.name, input, ts: base.ts });
        out.push({ ...base, hook_event_name: 'PreToolUse', tool_name: b.name, tool_input: input, tool_use_id: b.id });
      } else if (b.type === 'text' && b.text) {
        st.text.set(m.id, ((st.text.get(m.id) || '') + '\n' + b.text).trim());
      }
    }
    // end of a main turn: the final text is the reply
    if (!st.agentId && m.stop_reason === 'end_turn' && st.text.get(m.id)) {
      out.push({ ...base, hook_event_name: 'Stop', last_assistant_message: st.text.get(m.id), prompt_id: e.promptId || m.id });
    }
    if (m.stop_reason) st.text.delete(m.id);
  }
  return out;
}

// Feeds events to the store chunk by chunk, so a long transcript never sits in memory whole.
function parse(st, sink) {
  for (let lines = readChunk(st); lines; lines = readChunk(st)) {
    const events = [];
    for (const line of lines) {
      if (!line || !wanted(line)) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue; // unknown or half-written line: skip, never break
      }
      if (!st.started) {
        st.started = true;
        const first = { session_id: st.sessionId, transcript_path: st.mainFile, cwd: e.cwd || st.cwd, ts: tsOf(e), via: 'transcript' };
        if (st.agentId) events.push({ ...first, hook_event_name: 'SubagentStart', agent_id: st.agentId, agent_type: st.agentType });
        else events.push({ ...first, hook_event_name: 'SessionStart', source: 'transcript', claude_pid: pids.get(st.sessionId) });
      }
      if (e.cwd && !st.cwd) st.cwd = e.cwd;
      events.push(...translate(st, e));
    }
    sink(events);
  }
}

function stateFor(file, sessionId, mainFile, agentId) {
  let st = files.get(file);
  if (!st) {
    st = { file, sessionId, mainFile, agentId, agentType: null, offset: 0, rest: '', tools: new Map(), text: new Map(), started: false, stopped: false, cwd: null };
    files.set(file, st);
  }
  return st;
}

function readMeta(file) {
  try {
    return JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

function sessionFiles() {
  const out = [];
  const cutoff = Date.now() - WINDOW_MS;
  let dirs = [];
  try {
    dirs = fs.readdirSync(ROOT);
  } catch {
    return out;
  }
  for (const d of dirs) {
    const dir = path.join(ROOT, d);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const file = path.join(dir, n);
      try {
        const mtime = fs.statSync(file).mtimeMs;
        if (mtime >= cutoff) out.push({ file, sessionId: n.slice(0, -6), mtime });
      } catch {}
    }
  }
  return out;
}

function scanPids() {
  execFile('ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
    if (err) return;
    const next = new Map();
    for (const line of stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      if (!m || !/claude/.test(m[2])) continue;
      const id = m[2].match(/--(?:session-id|resume)[ =]([0-9a-f-]{36})/);
      if (id) next.set(id[1], Number(m[1]));
    }
    pids = next;
  });
}

function scan() {
  for (const { file, sessionId, mtime } of sessionFiles()) {
    const s = store.getSession(sessionId);
    if (s && s.via !== 'transcript') continue; // the hooks already report this one
    const first = !files.has(file);
    const main = stateFor(file, sessionId, file, null);
    const subDir = path.join(file.slice(0, -6), 'subagents');
    const run = () => {
      parse(main, store.ingestAll);
      let subs = [];
      try {
        subs = fs.readdirSync(subDir).filter((n) => n.endsWith('.jsonl'));
      } catch {}
      for (const n of subs) {
        const sf = path.join(subDir, n);
        const st = stateFor(sf, sessionId, file, n.replace(/^agent-|\.jsonl$/g, ''));
        const meta = readMeta(sf);
        if (meta && meta.agentType) st.agentType = meta.agentType;
        parse(st, store.ingestAll);
        if (meta && meta.finished && st.started && !st.stopped) {
          st.stopped = true;
          store.ingestAll([{ session_id: sessionId, transcript_path: file, ts: Date.now(), via: 'transcript', hook_event_name: 'SubagentStop', agent_id: st.agentId, agent_type: st.agentType, agent_transcript_path: sf }]);
        }
      }
    };
    // a long transcript is read in one quiet pass, then the page reloads once
    if (first) store.quietly(run);
    else run();

    const cur = store.getSession(sessionId);
    if (!cur) continue;
    const pid = pids.get(sessionId);
    if (pid && cur.pid !== pid) store.patchSession(sessionId, { pid });
    // no process to watch: call it closed after a long silence
    if (!pid && !cur.endedAt && Date.now() - mtime > IDLE_END_MS) {
      store.ingestAll([{ session_id: sessionId, ts: mtime, via: 'transcript', hook_event_name: 'SessionEnd', reason: 'transcript-idle' }]);
    }
    known.set(sessionId, { main: file });
  }
}

function start() {
  if (process.env.AGENT_BOARD_TRANSCRIPTS === '0') return;
  scanPids();
  setInterval(scanPids, 10000).unref();
  setTimeout(scan, 300).unref(); // after restore(), so hook sessions are known first
  setInterval(scan, SCAN_MS).unref();
}

module.exports = { start };
