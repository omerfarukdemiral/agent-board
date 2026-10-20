#!/usr/bin/env node
// Prints a `.claude/settings.json` hooks block with this checkout's absolute paths,
// for projects that want the board without the plugin flag: npm run settings > .claude/settings.json
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const plugin = require(path.join(ROOT, 'hooks', 'hooks.json'));
const text = JSON.stringify(plugin, null, 2).replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT);
process.stdout.write(text + '\n');
