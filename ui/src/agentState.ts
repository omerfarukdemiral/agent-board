import type { Agent } from './types';

// One look per agent state, shared by the schematic, the running list and the detail panel
export const AGENT_STATE = {
  running: { label: 'çalışıyor', text: 'text-run', dot: 'bg-run pulse-dot', ring: 'ring-run' },
  done: { label: 'bitti', text: 'text-ok', dot: 'bg-ok', ring: '' },
  error: { label: 'hata', text: 'text-err', dot: 'bg-err', ring: 'ring-err' },
  idle: { label: 'boşta', text: 'text-muted', dot: 'bg-faint', ring: '' },
  waiting: { label: 'seni bekliyor', text: 'text-alert', dot: 'bg-alert pulse-dot', ring: 'attention' },
} as const;
export type AgentState = keyof typeof AGENT_STATE;

export function agentState(a: Agent, sessionEnded: boolean, waiting: number): AgentState {
  if (waiting > 0) return 'waiting';
  // between turns the orchestrator is waiting for the user, not finished
  return a.id === 'main' && a.status === 'done' && !sessionEnded ? 'idle' : a.status;
}
