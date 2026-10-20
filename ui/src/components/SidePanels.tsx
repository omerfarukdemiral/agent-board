// Background work Claude reports at the end of a turn (workflows, background shells).
import { Layers } from 'lucide-react';
import type { Session } from '../types';

export function BackgroundPanel({ session }: { session: Session }) {
  // subagents already have a card in the tree; list only work that has no other home (workflows, shells…)
  const items = (session.background || []).filter((b) => !/agent/i.test(String(b.type || '')));
  if (!items.length) return null;
  return (
    <section className="rounded-[22px] bg-tray p-1.5 ring-line">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-2 text-sm font-medium text-ink">
        <Layers className="size-4 text-muted" />
        Arka plan işleri
        <span className="ml-auto font-mono text-xs text-muted">{items.length}</span>
      </header>
      <ul className="space-y-1 rounded-2xl bg-card p-2 ring-card">
        {items.map((b, i) => (
          <li key={String(b.id ?? i)} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="rounded-md bg-tile px-1.5 py-0.5 font-mono text-[11px] uppercase text-muted ring-line">{b.type || 'task'}</span>
            <span className="truncate text-[13px] text-ink">{String(b.name || b.description || b.id || '')}</span>
            {b.status != null && <span className="ml-auto shrink-0 text-[11px] text-muted">{String(b.status)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
