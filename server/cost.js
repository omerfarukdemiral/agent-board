// Transcript usage meter: incremental jsonl reader + pricing.
const fs = require('fs');
const path = require('path');

const PRICING = JSON.parse(fs.readFileSync(path.join(__dirname, 'pricing.json'), 'utf8'));
const PER_M = 1e6;

function priceFor(model) {
  if (!model) return null;
  if (PRICING[model]) return PRICING[model];
  // tolerate dated/suffixed ids, e.g. claude-opus-5-5-20260101
  const key = Object.keys(PRICING).find((k) => !k.startsWith('_') && model.startsWith(k));
  return key ? PRICING[key] : null;
}

// Splits usage into the four billed buckets. 5m/1h cache writes are priced differently.
function buckets(u) {
  const write = u.cache_creation_input_tokens || 0;
  const cc = u.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  const w5m = cc.ephemeral_5m_input_tokens != null ? cc.ephemeral_5m_input_tokens : write - w1h;
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite5m: w5m,
    cacheWrite1h: w1h,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

// Returns USD for one message, or null if any non-zero bucket has no known price.
function messageCost(model, b) {
  let p = priceFor(model);
  if (!p) return null;
  const prompt = b.input + b.cacheWrite5m + b.cacheWrite1h + b.cacheRead;
  if (p.longContext && prompt > p.longContext.thresholdTokens) p = p.longContext;
  const parts = [
    [b.input, p.in],
    [b.output, p.out],
    [b.cacheWrite5m, p.cacheWrite5m],
    [b.cacheWrite1h, p.cacheWrite1h],
    [b.cacheRead, p.cacheRead],
  ];
  let usd = 0;
  for (const [tokens, rate] of parts) {
    if (!tokens) continue;
    if (rate == null) return null;
    usd += (tokens * rate) / PER_M;
  }
  return usd;
}

class TranscriptMeter {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.rest = '';
    this.messages = new Map(); // message.id → { model, usage } — last write wins (streaming rewrites)
    this.costState = null;
  }

  // Reads only bytes appended since the last call, 4 MB at a time. Unparseable lines are skipped.
  read() {
    let fd;
    try {
      fd = fs.openSync(this.file, 'r');
      const size = fs.fstatSync(fd).size;
      if (size < this.offset) Object.assign(this, { offset: 0, rest: '', messages: new Map() });
      while (this.offset < size) {
        const len = Math.min(4 * 1024 * 1024, size - this.offset);
        const chunk = Buffer.alloc(len);
        fs.readSync(fd, chunk, 0, len, this.offset);
        this.offset += len;
        const lines = (this.rest + chunk.toString('utf8')).split('\n');
        this.rest = lines.pop();
        for (const line of lines) this.ingest(line);
      }
    } catch {
      // missing or unreadable transcript: keep whatever we had
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    return this;
  }

  ingest(line) {
    // usage lives on assistant lines and the cost-state line; skip the megabyte blobs unparsed
    if (!line || !/"role":"assistant"|"type":"cost-state"/.test(line.slice(0, 600))) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      return;
    }
    if (e.type === 'cost-state') this.costState = e;
    const m = e.type === 'assistant' && e.message;
    if (!m || !m.usage || !m.id || m.model === '<synthetic>') return;
    this.messages.set(m.id, { model: m.model, usage: m.usage });
  }

  summary() {
    const tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    let costUsd = 0;
    let model = null;
    for (const { model: mdl, usage } of this.messages.values()) {
      const b = buckets(usage);
      tokens.input += b.input;
      tokens.output += b.output;
      tokens.cacheWrite += b.cacheWrite5m + b.cacheWrite1h;
      tokens.cacheRead += b.cacheRead;
      model = mdl;
      const c = messageCost(mdl, b);
      costUsd = costUsd == null || c == null ? null : costUsd + c;
    }
    return { model, tokens, costUsd: this.messages.size ? costUsd : 0, messages: this.messages.size };
  }
}

module.exports = { TranscriptMeter, messageCost, buckets, priceFor };
