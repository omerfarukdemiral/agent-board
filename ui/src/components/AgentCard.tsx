import { Bot, Clock, Network, Wrench } from 'lucide-react';
import { cn, compact, displayName, duration, modelLabel, prettyTool, usd } from '../lib';
import type { Agent } from '../types';
import { ThinkingLoader } from './affect/thinking-loader';

type Props = { agent: Agent; now: number; sessionEnded: boolean; waiting: number; selected?: boolean; onSelect?: () => void; fluid?: boolean };

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

// Two lines that always fit the card: name and cost, then state and the numbers that move.
export function AgentCard({ agent: a, now, sessionEnded, waiting, selected, onSelect, fluid }: Props) {
  const main = a.id === 'main';
  const status = agentState(a, sessionEnded, waiting);
  const st = AGENT_STATE[status];
  const t = a.tokens;
  const tip = `${a.type ?? ''} · ${a.model ? modelLabel(a.model) : ''} · ${a.toolCalls} araç · input ${compact(t.input + t.cacheRead + t.cacheWrite)} · output ${compact(t.output)}`;
  const live = status === 'running' || status === 'waiting';

  return (
    <button
      type="button"
      onClick={onSelect}
      title={tip}
      className={cn(
        'enter block w-[16rem] max-w-[calc(100vw-2rem)] rounded-[14px] bg-card px-3 py-2.5 text-left ring-card transition-[box-shadow,background-color] duration-300 hover:bg-raise',
        main && 'w-[18rem]',
        fluid && 'w-full max-w-none',
        st.ring,
        selected && 'ring-selected'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', main ? 'bg-ink text-card' : 'bg-tile text-muted')}>
          {main ? <Network className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={a.description ?? undefined}>
          {main ? 'Orkestratör' : displayName(a)}
        </span>
        <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-ink">{usd(a.costUsd)}</span>
      </div>

      <div className="mt-1.5 flex min-w-0 items-center gap-x-2.5 pl-8 text-[12px] tabular-nums text-muted">
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 font-medium', st.text)}>
          <span className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
          <span className="truncate">{st.label}</span>
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <Clock className="size-3" />
          {duration((a.endedAt ?? now) - a.startedAt)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <Wrench className="size-3" />
          {a.toolCalls}
        </span>
      </div>

      {live && (
        <div className="mt-2 flex h-7 items-center overflow-hidden rounded-md bg-tray px-2 ring-line">
          {status === 'waiting' ? (
            <span className="truncate text-[12px] text-alert">Onayın bekleniyor{a.currentTool ? ` · ${prettyTool(a.currentTool)}` : ''}</span>
          ) : (
            <ThinkingLoader variant="plain" size="sm" phases={[a.currentTool ? prettyTool(a.currentTool) : 'Düşünüyor']} className="min-w-0 truncate" />
          )}
        </div>
      )}
    </button>
  );
}
