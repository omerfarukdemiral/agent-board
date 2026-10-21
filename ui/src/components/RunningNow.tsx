// Agents working right now, each with how far it probably is.
import { duration, estimate, prettyTool, rel, usd, workers, displayName } from '../lib';
import type { Session } from '../types';
import { Bar } from './Bars';

export function RunningNow({ s, now, waitingBy, onSelect }: { s: Session; now: number; waitingBy: Record<string, number>; onSelect: (id: string) => void }) {
  const list = workers(s)
    .filter((a) => a.status === 'running')
    .sort((a, b) => (waitingBy[b.id] || 0) - (waitingBy[a.id] || 0) || a.startedAt - b.startedAt);
  if (!list.length) return null;

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-muted">Şu an çalışanlar · {list.length}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-card ring-card">
        {list.map((a) => {
          const est = estimate(a, s, now);
          const parent = a.parentId && a.parentId !== 'main' ? s.agents[a.parentId] : null;
          const where = parent?.workflow ? `${parent.description} › ${a.phase ?? ''}` : parent ? displayName(parent) : null;
          const waiting = waitingBy[a.id] > 0;
          return (
            <li key={a.id}>
              <button onClick={() => onSelect(a.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-left transition-colors hover:bg-raise sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{displayName(a)}</span>
                    {where && <span className="truncate text-[12px] text-faint">{where}</span>}
                  </span>
                  <span className={waiting ? 'block truncate text-[12px] text-alert' : 'block truncate font-mono text-[12px] text-muted'}>
                    {waiting ? 'Onayını bekliyor' : a.currentTool ? prettyTool(rel(a.currentTool, s.cwd)) : 'düşünüyor'}
                  </span>
                </span>
                <span className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
                  <Bar pct={est ? est.pct : null} tone={waiting || est?.over ? 'alert' : 'run'} />
                  <span className="mt-1 block text-[11px] tabular-nums text-faint">
                    {duration(now - a.startedAt)}
                    {est
                      ? est.over
                        ? ` · benzerlerinden uzun sürüyor`
                        : ` · %${Math.round(est.pct * 100)} · ~${duration(est.left)} kaldı`
                      : ` · ${a.toolCalls} araç`}
                  </span>
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-ink">{usd(a.costUsd)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
