#!/usr/bin/env node
// agent-board channel: an MCP stdio server that claude starts as a child process.
// Board → Claude: listens to the board's /channel/stream for this claude process and pushes
//   each message into the session as a `notifications/claude/channel` event.
// Claude → board: exposes a `reply` tool; calls are forwarded to POST /channel/reply.
// stdout is the MCP transport, so nothing else may ever be written there.
const http = require('http');

const PORT = Number(process.env.AGENT_BOARD_PORT) || 4317;
// MCP stdio servers are direct children of claude. Not $CLAUDE_PID: wrappers like cmux set it once
// and nested claude processes inherit the outer value.
const CLAUDE_PID = process.ppid;
const RETRY_MS = 2000;

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const warn = (...a) => process.stderr.write(`[agent-board channel] ${a.join(' ')}\n`);

const INSTRUCTIONS = [
  'Messages from the agent-board channel are typed by the same user who runs this session, from the agent-board web dashboard.',
  'Treat them like a normal user message: follow them, and if you are mid-task, take them into account at the next sensible point.',
  'Always answer them with the `reply` tool (pass the chat_id from the message), in the language the user wrote in. Keep replies short; the user also sees your normal output on the board.',
].join(' ');

// ---- board connection --------------------------------------------------------

let ready = false;
const queue = [];

function pushToClaude(msg) {
  if (!ready) return void queue.push(msg);
  send({
    method: 'notifications/claude/channel',
    params: { content: msg.text, meta: { chat_id: msg.id } },
  });
}

function listen() {
  let retried = false;
  // a dying board can end the stream with 'end', 'close' or 'error' – reconnect exactly once
  const retry = () => {
    if (retried) return;
    retried = true;
    setTimeout(listen, RETRY_MS);
  };
  const req = http.get({ host: '127.0.0.1', port: PORT, path: `/channel/stream?pid=${CLAUDE_PID}` }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return retry();
    }
    res.setEncoding('utf8');
    let buf = '';
    res.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n');
        if (!data) continue;
        try {
          pushToClaude(JSON.parse(data));
        } catch {}
      }
    });
    res.on('end', retry);
    res.on('close', retry);
    res.on('error', retry);
  });
  // board not running yet (or restarting): keep trying quietly
  req.on('error', retry);
}

function postReply(args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ pid: CLAUDE_PID, chat_id: args.chat_id || null, text: String(args.text || '') });
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/channel/reply', method: 'POST', timeout: 3000, headers: { 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end(body);
  });
}

// ---- MCP over stdio ----------------------------------------------------------

const TOOLS = [
  {
    name: 'reply',
    description: 'Send a reply to the user on the agent-board dashboard. Use it to answer every message that arrived through the agent-board channel.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The reply, as plain text or short markdown' },
        chat_id: { type: 'string', description: 'chat_id of the message you answer' },
      },
      required: ['text'],
    },
  },
];

async function handle(m) {
  switch (m.method) {
    case 'initialize':
      // legacy protocol version on purpose: servers that negotiate 2026-07-28 are not registered as channels
      return send({
        id: m.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
          serverInfo: { name: 'agent-board', version: '0.2.0' },
          instructions: INSTRUCTIONS,
        },
      });
    case 'notifications/initialized':
      ready = true;
      queue.splice(0).forEach(pushToClaude);
      return;
    case 'tools/list':
      return send({ id: m.id, result: { tools: TOOLS } });
    case 'tools/call': {
      if (m.params?.name !== 'reply') return send({ id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } });
      const ok = await postReply(m.params.arguments || {});
      return send({
        id: m.id,
        result: { content: [{ type: 'text', text: ok ? 'Delivered to agent-board.' : 'agent-board is not reachable; the user will see your normal output instead.' }], isError: !ok },
      });
    }
    case 'ping':
      return send({ id: m.id, result: {} });
    default:
      if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      handle(JSON.parse(line));
    } catch (e) {
      warn('bad message:', e.message);
    }
  }
});
process.stdin.on('end', () => process.exit(0));

listen();
