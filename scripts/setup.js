#!/usr/bin/env node
// One-time setup after cloning: build the UI and put `claude-board` on PATH.
// Safe to re-run (e.g. after `git pull`).
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(os.homedir(), '.local', 'bin');
const LINK = path.join(BIN_DIR, 'claude-board');
const TARGET = path.join(ROOT, 'bin', 'claude-board');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

console.log('1/2 arayüz derleniyor…');
run('npm ci --no-audit --no-fund', path.join(ROOT, 'ui'));
run('npm run build', path.join(ROOT, 'ui'));

console.log(`2/2 claude-board → ${LINK}`);
fs.chmodSync(TARGET, 0o755);
fs.mkdirSync(BIN_DIR, { recursive: true });
let existing = null;
try {
  existing = fs.readlinkSync(LINK);
} catch {}
if (existing === TARGET) {
  console.log('    zaten bağlı');
} else if (fs.existsSync(LINK) && existing === null) {
  console.log(`    ${LINK} başka bir dosya, dokunulmadı. Elle bağla: ln -sf "${TARGET}" "${LINK}"`);
} else {
  fs.rmSync(LINK, { force: true });
  fs.symlinkSync(TARGET, LINK);
  console.log('    bağlandı');
}
if (!(process.env.PATH || '').split(path.delimiter).includes(BIN_DIR)) {
  console.log(`    uyarı: ${BIN_DIR} PATH'te değil. Shell profiline ekle: export PATH="$HOME/.local/bin:$PATH"`);
}

console.log(`
hazır. bir projede kullanmak için:
  cd ~/projem && claude-board

sadece izleme + onay (uyarı ekranı olmadan):
  claude --plugin-dir "${ROOT}"`);
