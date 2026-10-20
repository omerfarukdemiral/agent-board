#!/usr/bin/env node
// Channels spike: minimal MCP stdio server (no SDK) that declares claude/channel,
// pushes one message after a delay and logs everything, including reply tool calls.
const fs = require('fs');
const LOG = process.env.CHANNEL_SPIKE_LOG || '/tmp/channel-spike.log';
const log = (...a) => fs.appendFileSync(LOG, `[${(Date.now() / 1000).toFixed(1)}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

log('start', { pid: process.pid, ppid: process.ppid, env: Object.keys(process.env).filter((k) => /CLAUDE|SESSION/.test(k)) });

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log('bad line', line.slice(0, 200));
      continue;
    }
    handle(msg);
  }
});

function handle(m) {
  log('<-', m.method || 'response', m.method === 'initialize' ? m.params : m.id ?? '');
  if (m.method === 'initialize') {
    // legacy protocol version on purpose: servers that negotiate 2026-07-28 are not registered as channels
    send({
      id: m.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
        serverInfo: { name: 'agent-board-spike', version: '0.0.1' },
        instructions: 'Messages from this channel come from the user via the agent-board web dashboard. Answer them with the reply tool.',
      },
    });
  } else if (m.method === 'notifications/initialized') {
    setTimeout(() => {
      log('-> pushing channel message');
      send({ method: 'notifications/claude/channel', params: { content: 'Hello from agent-board! Please reply with exactly the word PINEAPPLE using the reply tool.', meta: { chat_id: '1', sender: 'board' } } });
    }, Number(process.env.CHANNEL_SPIKE_DELAY || 8000));
  } else if (m.method === 'tools/list') {
    send({
      id: m.id,
      result: {
        tools: [
          {
            name: 'reply',
            description: 'Send a reply back to the agent-board user.',
            inputSchema: { type: 'object', properties: { chat_id: { type: 'string' }, text: { type: 'string' } }, required: ['text'] },
          },
        ],
      },
    });
  } else if (m.method === 'tools/call') {
    log('REPLY TOOL CALLED', m.params);
    send({ id: m.id, result: { content: [{ type: 'text', text: 'delivered' }] } });
  } else if (m.id !== undefined && m.method) {
    send({ id: m.id, result: {} });
  }
}
process.stdin.on('end', () => log('stdin end'));
