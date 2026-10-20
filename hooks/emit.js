#!/usr/bin/env node
// Hook → POST /event. Never blocks Claude: 300ms cap, no stdout, always exit 0.
const http = require('http');

const PORT = Number(process.env.AGENT_BOARD_PORT) || 4317;
const done = () => process.exit(0);
setTimeout(done, 300).unref();

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (buf += d));
process.stdin.on('error', done);
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(buf);
  } catch {
    return done();
  }
  if (process.env.AGENT_BOARD_NO_TOOLS === '1' && payload.hook_event_name === 'PostToolUse') return done();
  payload.ts = Date.now();
  const body = JSON.stringify(payload);
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/event', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    (res) => {
      res.resume();
      res.on('end', done);
    }
  );
  req.on('error', done);
  req.end(body);
});
