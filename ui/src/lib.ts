import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Agent, ApprovalRequest, Session } from './types';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export const projectName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;

export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 10) return 'şimdi';
  if (s < 60) return `${s} sn önce`;
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  return `${Math.floor(s / 3600)} sa önce`;
}

export function usd(v: number | null) {
  if (v == null) return '—';
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(v < 10 ? 3 : 2)}`;
}

export const compact = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`);

// "claude-sonnet-5-5" → "sonnet 5.5"
export function modelLabel(m: string | null) {
  if (!m) return null;
  const x = m.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/);
  return x ? `${x[1]} ${x[2]}${x[3] ? '.' + x[3] : ''}` : m;
}

export function totals(s: Session) {
  const agents = Object.values(s.agents);
  let cost = 0;
  let partial = false;
  for (const a of agents) {
    if (a.costUsd == null) partial = true;
    else cost += a.costUsd;
  }
  return { agents: agents.length, running: agents.filter((a) => a.status === 'running').length, cost, partial };
}

export function childrenOf(s: Session, id: string): Agent[] {
  return Object.values(s.agents)
    .filter((a) => a.parentId === id && a.id !== id)
    .sort((a, b) => a.startedAt - b.startedAt);
}

// Claude prefixes delegated work with its task id ("#3 Write tests"); the card already shows the id
export const displayName = (a: Agent) => (a.description || a.type).replace(/^#\d+\s*[:·-]?\s*/, '');

export function agentName(s: Session | undefined, id: string) {
  if (id === 'main') return 'Orkestratör';
  const a = s?.agents[id];
  return a ? displayName(a) : id.slice(0, 8);
}

export function requestLabel(r: ApprovalRequest) {
  if (r.kind === 'question') return r.toolInput.questions?.[0]?.question || 'Claude bir soru soruyor';
  return `${projectName(r.cwd)} · ${r.toolName} izni istiyor`;
}

export const isLive = (s: Session) => !s.endedAt;

// Same rule as the server: paths inside the project are shown relative to it
export function rel(text: string | undefined, cwd: string | undefined) {
  if (!text || !cwd) return text ?? '';
  let out = text;
  for (const r of [cwd, cwd.replace(/^\/private(?=\/)/, '')]) out = out.split(r + '/').join('').split(r).join('.');
  return out;
}

// ---- session state, one rule for every screen ------------------------------------------

export type SessionState = 'waiting' | 'working' | 'idle' | 'ended';
const QUIET_MS = 3 * 60 * 1000; // no event for this long: nothing is really running, whatever the last event said

export function sessionState(s: Session, waiting: number, now: number): SessionState {
  if (s.endedAt) return 'ended';
  if (waiting > 0) return 'waiting';
  const running = Object.values(s.agents).some((a) => a.status === 'running');
  return running && now - s.lastEventAt < QUIET_MS ? 'working' : 'idle';
}

export const STATE_LABEL: Record<SessionState, string> = { waiting: 'seni bekliyor', working: 'çalışıyor', idle: 'boşta', ended: 'kapandı' };
export const STATE_DOT: Record<SessionState, string> = { waiting: 'bg-alert pulse-dot', working: 'bg-run pulse-dot', idle: 'bg-ok', ended: 'bg-faint' };

// mcp__plugin_playwright_playwright__browser_click {…} → playwright · browser_click {…}
export const prettyTool = (text: string) =>
  text.replace(/\bmcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)/g, (_, server: string, tool: string) => `${server.split(/[_-]/).pop()} · ${tool}`);

// What the session is doing right now, as one short line
export function nowDoing(s: Session, state: SessionState): string | null {
  if (state !== 'working' && state !== 'waiting') return null;
  const running = Object.values(s.agents).filter((a) => a.status === 'running');
  const main = s.agents.main;
  const pick = (main?.status === 'running' && main.currentTool ? main : running.find((a) => a.currentTool)) || main;
  const action = pick?.currentTool || pick?.lastAction;
  return action ? prettyTool(rel(action, s.cwd)) : null;
}

// workflow runs are containers on the canvas; their agents count as subagents
export function runningCount(s: Session) {
  const subs = Object.values(s.agents).filter((a) => a.id !== 'main' && a.type !== 'workflow');
  return {
    subs: subs.length,
    running: subs.filter((a) => a.status === 'running').length,
    done: subs.filter((a) => a.status === 'done').length,
    workflows: Object.values(s.agents).filter((a) => a.type === 'workflow').length,
  };
}

export const sessionCost = (s: Session) => Object.values(s.agents).reduce((n, a) => n + (a.costUsd ?? 0), 0);
