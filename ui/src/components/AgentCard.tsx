import { Bot, Clock, Network, Workflow, Wrench } from 'lucide-react';
import { cn, compact, displayName, duration, modelLabel, prettyTool, usd } from '../lib';
import type { Agent } from '../types';
import { ThinkingLoader } from './affect/thinking-loader';

// rollup: a workflow node shows what its agents spent
type Props = { agent: Agent; now: number; sessionEnded: boolean; waiting: number; selected?: boolean; onSelect?: () => void; fluid?: boolean; rollup?: { cost: number }; folded?: number };

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
export function AgentCard({ agent: a, now, sessionEnded, waiting, selected, onSelect, fluid, rollup, folded }: Props) {
  const main = a.id === 'main';
  const wf = a.workflow;
  const status = agentState(a, sessionEnded, waiting);
  const st = AGENT_STATE[status];
  const t = a.tokens;
  const tip = wf
    ? `workflow · ${wf.phases.join(' → ')}`
    : `${a.phase ? `faz: ${a.phase} · ` : ''}${a.type ?? ''} · ${a.model ? modelLabel(a.model) : ''} · ${a.toolCalls} araç · input ${compact(t.input + t.cacheRead + t.cacheWrite)} · output ${compact(t.output)}`;
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
        <span className={cn('grid size-6 shrink-0 place-items-center rounded-md', main ? 'bg-ink text-card' : wf ? 'bg-run/12 text-run' : 'bg-tile text-muted')}>
          {main ? <Network className="size-3.5" /> : wf ? <Workflow className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink" title={a.description ?? undefined}>
          {main ? 'Orkestratör' : displayName(a)}
        </span>
        <span className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-ink">{usd(rollup ? rollup.cost : a.costUsd)}</span>
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
        {wf ? (
          <span className="inline-flex shrink-0 items-center gap-1" title="biten / başlayan agent">
            <Bot className="size-3" />
            {wf.finished}/{wf.agents}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1">
            <Wrench className="size-3" />
            {a.toolCalls}
          </span>
        )}
      </div>

      {wf && wf.phases.length > 0 && (
        <ol className="mt-2 flex gap-1 pl-8" aria-label="Fazlar">
          {wf.phases.map((ph, i) => {
            const at = wf.current ? wf.phases.indexOf(wf.current) : -1;
            const done = status === 'done' || i < at;
            return <li key={ph} title={ph} className={cn('h-1 flex-1 rounded-full', done ? 'bg-ok' : i === at ? 'bg-run pulse-dot' : 'bg-tile')} />;
          })}
        </ol>
      )}
      {!!folded && <p className="mt-1.5 pl-8 text-[12px] text-faint">{folded} agent katlı · açmak için tıkla</p>}
      {live && (
        <div className="mt-2 flex h-7 items-center overflow-hidden rounded-md bg-tray px-2 ring-line">
          {status === 'waiting' ? (
            <span className="truncate text-[12px] text-alert">Onayın bekleniyor{a.currentTool ? ` · ${prettyTool(a.currentTool)}` : ''}</span>
          ) : (
            <ThinkingLoader variant="plain" size="sm" phases={[wf ? `Faz: ${wf.current ?? 'başlıyor'}` : a.currentTool ? prettyTool(a.currentTool) : 'Düşünüyor']} className="min-w-0 truncate" />
          )}
        </div>
      )}
    </button>
  );
}
