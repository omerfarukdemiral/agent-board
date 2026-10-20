// WP0 spike: append raw hook stdin to ~/.agent-board/raw.jsonl, always exit 0, no stdout
const fs = require('fs'), os = require('os'), path = require('path');
let buf = '';
process.stdin.on('data', d => (buf += d));
process.stdin.on('end', () => {
  try {
    const dir = path.join(os.homedir(), '.agent-board');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'raw.jsonl'), JSON.stringify({ t: Date.now(), env: { CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR }, raw: buf }) + '\n');
  } catch {}
  process.exit(0);
});
