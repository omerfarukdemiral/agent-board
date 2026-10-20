// One agent up close: what it is, what it cost, its last actions and what it reported back.
import { X } from 'lucide-react';
import { agentName, cn, compact, duration, modelLabel, prettyTool, rel, usd } from '../lib';
import type { ActivityItem, Session } from '../types';
import { AGENT_STATE, agentState } from '../agentState';
import { Md } from './Md';

export function AgentDetail({ s, id, items, now, waiting, onClose }: { s: Session; id: string; items: ActivityItem[]; now: number; waiting: number; onClose: () => void }) {
  const a = s.agents[id];
  if (!a) return null;
  const st = AGENT_STATE[agentState(a, !!s.endedAt, waiting)];
  const tools = items.filter((i) => i.agentId === id && i.kind === 'tool').slice(-8).reverse();
  const report = items.find((i) => i.kind === 'agent' && i.childId === id)?.result;
  const parent = a.parentId && a.parentId !== 'main' ? s.agents[a.parentId] : null;
  const t = a.tokens;

  return (
    <section className="enter rounded-2xl bg-card ring-card">
      <header className="flex items-start gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">{agentName(s, id)}</p>
          <p className="truncate text-[12px] text-muted">
            <span className={st.text}>{st.label}</span>
            {parent && ` · ${parent.workflow ? `${parent.description} › ${a.phase ?? ''}` : agentName(s, parent.id)}`}
            {a.model && ` · ${modelLabel(a.model)}`}
          </p>
        </div>
        <button onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" aria-label="Kapat">
          <X className="size-4" />
        </button>
      </header>
      <dl className="grid grid-cols-4 gap-2 border-b border-line px-3.5 py-2.5 text-[12px]">
        <Fact k="süre" v={duration((a.endedAt ?? now) - a.startedAt)} />
        <Fact k="araç" v={String(a.toolCalls)} />
        <Fact k="token" v={compact(t.input + t.output + t.cacheRead + t.cacheWrite)} />
        <Fact k="maliyet" v={usd(a.costUsd)} />
      </dl>
      {a.description && a.id !== 'main' && <p className="border-b border-line px-3.5 py-2 text-[12px] text-text">{a.description}</p>}
      {tools.length > 0 && (
        <ol className="space-y-1 px-3.5 py-2.5">
          {tools.map((it) => (
            <li key={it.id} className="flex items-baseline gap-2 text-[12px]">
              <span className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', it.status === 'running' ? 'bg-run pulse-dot' : it.status === 'error' ? 'bg-err' : 'bg-line-strong')} />
              <span className="shrink-0 font-medium text-ink">{prettyTool(it.name || '')}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={String(it.summary || '')}>
                {rel(String(it.summary || ''), s.cwd)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {report != null && report !== "" && (
        <div className="scroll-thin max-h-48 overflow-y-auto border-t border-line px-3.5 py-2.5 text-[12px] leading-5 text-text">
          <p className="mb-1 text-[11px] text-faint">Sonuç</p>
          <Md text={String(report)} />
        </div>
      )}
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-faint">{k}</dt>
      <dd className="truncate font-mono tabular-nums text-ink">{v}</dd>
    </div>
  );
}
