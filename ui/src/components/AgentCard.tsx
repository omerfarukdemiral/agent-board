import { Bot, Clock, Network, Wrench } from 'lucide-react';
import { cn, compact, duration, modelLabel, usd } from '../lib';
import type { Agent } from '../types';
import { ThinkingLoader } from './affect/thinking-loader';

type Props = { agent: Agent; now: number; sessionEnded: boolean; waiting: number; selected?: boolean; onSelect?: () => void };

const BADGE = {
  running: { label: 'Running', cls: 'bg-run/12 text-run', dot: 'bg-run pulse-dot' },
  done: { label: 'Done', cls: 'bg-ok/12 text-ok', dot: 'bg-ok' },
  error: { label: 'Error', cls: 'bg-err/12 text-err', dot: 'bg-err' },
  idle: { label: 'Idle', cls: 'bg-tile text-muted', dot: 'bg-faint' },
  waiting: { label: 'Seni bekliyor', cls: 'bg-alert/12 text-alert', dot: 'bg-alert pulse-dot' },
} as const;

export function AgentCard({ agent: a, now, sessionEnded, waiting, selected, onSelect }: Props) {
  const main = a.id === 'main';
  // between turns the orchestrator is waiting for the user, not finished
  let status: keyof typeof BADGE = main && a.status === 'done' && !sessionEnded ? 'idle' : a.status;
  if (waiting > 0) status = 'waiting';
  const b = BADGE[status];
  const elapsed = (a.endedAt ?? now) - a.startedAt;
  const t = a.tokens;
  const tokenTip = `input ${t.input} · output ${t.output} · cache write ${t.cacheWrite} · cache read ${t.cacheRead}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'enter block w-[17rem] max-w-[calc(100vw-2rem)] rounded-[14px] bg-card p-3 text-left ring-line transition-[box-shadow,background-color] duration-300 hover:bg-raise/70',
        main && 'w-[21rem]',
        status === 'running' && 'shadow-[inset_0_0_0_1px_rgba(77,141,255,.35)]',
        status === 'error' && 'shadow-[inset_0_0_0_1px_rgba(255,123,114,.4)]',
        status === 'waiting' && 'attention',
        selected && 'shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)]'
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-tile ring-line', main ? 'text-ink' : 'text-muted')}>
          {main ? <Network className="size-3.5" /> : <Bot className="size-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-ink">{main ? 'Orchestrator' : a.type}</span>
            <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-500', b.cls)}>
              <span className={cn('size-1.5 rounded-full', b.dot)} />
              {b.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted" title={a.description ?? undefined}>
            {main ? 'ana oturum' : a.description || a.id}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {a.model && <span className="rounded-md bg-tile px-1.5 py-0.5 font-mono text-[10.5px] text-muted ring-line">{modelLabel(a.model)}</span>}
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted">
          <Clock className="size-3" />
          {duration(elapsed)}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted">
          <Wrench className="size-3" />
          {a.toolCalls}
        </span>
        <span className="ml-auto text-[12px] font-medium tabular-nums text-ink" title={tokenTip}>
          {usd(a.costUsd)}
        </span>
      </div>

      <div className="mt-2.5 flex h-8 items-center gap-2 overflow-hidden rounded-lg bg-tile px-2 ring-line">
        {a.status === 'running' && a.currentTool ? (
          <ThinkingLoader variant="plain" size="sm" phases={[a.currentTool]} className="min-w-0 truncate" />
        ) : (
          <>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-faint">son</span>
            <span className="truncate font-mono text-[11px] text-text" title={a.lastAction ?? undefined}>
              {a.lastAction || '—'}
            </span>
          </>
        )}
      </div>

      {t.output + t.cacheRead + t.cacheWrite > 0 && (
        <div className="mt-2 flex justify-between font-mono text-[10px] tabular-nums text-faint" title={tokenTip}>
          <span>in {compact(t.input + t.cacheRead + t.cacheWrite)}</span>
          <span>out {compact(t.output)}</span>
          <span>cache {compact(t.cacheRead)}</span>
        </div>
      )}
    </button>
  );
}
