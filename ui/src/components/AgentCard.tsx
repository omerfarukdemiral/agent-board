import { Bot, Clock, Network, Wrench } from 'lucide-react';
import { cn, compact, displayName, duration, modelLabel, prettyTool, usd } from '../lib';
import type { Agent } from '../types';
import { ThinkingLoader } from './affect/thinking-loader';

type Props = { agent: Agent; now: number; sessionEnded: boolean; waiting: number; selected?: boolean; onSelect?: () => void; fluid?: boolean };

const BADGE = {
  running: { label: 'Running', cls: 'bg-run/12 text-run', dot: 'bg-run pulse-dot' },
  done: { label: 'Done', cls: 'bg-ok/12 text-ok', dot: 'bg-ok' },
  error: { label: 'Error', cls: 'bg-err/12 text-err', dot: 'bg-err' },
  idle: { label: 'Idle', cls: 'bg-tile text-muted', dot: 'bg-faint' },
  waiting: { label: 'Seni bekliyor', cls: 'bg-alert/12 text-alert', dot: 'bg-alert pulse-dot' },
} as const;

export function AgentCard({ agent: a, now, sessionEnded, waiting, selected, onSelect, fluid }: Props) {
  const main = a.id === 'main';
  // between turns the orchestrator is waiting for the user, not finished
  let status: keyof typeof BADGE = main && a.status === 'done' && !sessionEnded ? 'idle' : a.status;
  if (waiting > 0) status = 'waiting';
  const b = BADGE[status];
  const t = a.tokens;
  const tip = `${a.toolCalls} araç · input ${compact(t.input + t.cacheRead + t.cacheWrite)} · output ${compact(t.output)} · cache read ${compact(t.cacheRead)}`;
  const live = status === 'running' || status === 'waiting';

  return (
    <button
      type="button"
      onClick={onSelect}
      title={tip}
      className={cn(
        'enter block w-[15.5rem] max-w-[calc(100vw-2rem)] rounded-[14px] bg-card px-3 py-2.5 text-left ring-line transition-[box-shadow,background-color] duration-300 hover:bg-raise/70',
        main && 'w-[19rem]',
        fluid && 'w-full max-w-none',
        status === 'running' && 'shadow-[inset_0_0_0_1px_rgba(77,141,255,.35)]',
        status === 'error' && 'shadow-[inset_0_0_0_1px_rgba(255,123,114,.4)]',
        status === 'waiting' && 'attention',
        selected && 'shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)]'
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md bg-tile ring-line', main ? 'text-ink' : 'text-muted')}>
          {main ? <Network className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={a.description ?? undefined}>
          {main ? 'Orchestrator' : displayName(a)}
        </span>
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-500', b.cls)}>
          <span className={cn('size-1.5 rounded-full', b.dot)} />
          {b.label}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-x-2.5 pl-8 text-[11px] tabular-nums text-muted">
        {!main && a.description && <span className="truncate">{a.type}</span>}
        {a.model && <span className="shrink-0 font-mono text-[10.5px]">{modelLabel(a.model)}</span>}
        <span className="inline-flex shrink-0 items-center gap-1">
          <Clock className="size-3" />
          {duration((a.endedAt ?? now) - a.startedAt)}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <Wrench className="size-3" />
          {a.toolCalls}
        </span>
        <span className="ml-auto shrink-0 text-[12px] font-medium text-ink">{usd(a.costUsd)}</span>
      </div>

      {live && (
        <div className="mt-2 flex h-7 items-center overflow-hidden rounded-md bg-tile px-2 ring-line">
          {status === 'waiting' ? (
            <span className="truncate text-[11.5px] text-alert">Onayın bekleniyor{a.currentTool ? ` · ${prettyTool(a.currentTool)}` : ''}</span>
          ) : (
            <ThinkingLoader variant="plain" size="sm" phases={[a.currentTool ? prettyTool(a.currentTool) : 'Düşünüyor']} className="min-w-0 truncate" />
          )}
        </div>
      )}
    </button>
  );
}
