// Task list (TaskCreate/TaskUpdate/TodoWrite) and background work (workflows, background agents/shells).
// Task list look adapted from affectUI's free progress-tracker (MIT): tray, animated bar, drawn ticks.
import { useState } from 'react';
import { Check, Layers, ListTodo, Loader2 } from 'lucide-react';
import { agentName, cn } from '../lib';
import type { Session, Task } from '../types';

const ORDER: Record<string, number> = { in_progress: 0, pending: 1, completed: 2 };

export function TaskPanel({ session }: { session: Session }) {
  const tasks = Object.values(session.tasks).sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1) || a.updatedAt - b.updatedAt);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const progress = tasks.length ? done / tasks.length : 0;
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;
  // a finished list is history: one line, expandable
  if (done === tasks.length && !open)
    return (
      <button className="flex w-full items-center gap-2 rounded-2xl bg-tray px-3.5 py-2.5 text-left text-[13px] text-muted ring-line" onClick={() => setOpen(true)}>
        <Check className="size-4 text-ok" />
        {tasks.length} görevin hepsi tamamlandı
        <span className="ml-auto text-[11px] text-faint">göster</span>
      </button>
    );

  return (
    <section className="rounded-[22px] bg-tray p-1.5 ring-line">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-2 text-sm font-medium text-ink">
        <ListTodo className="size-4 text-muted" />
        Görevler
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">
          {done}/{tasks.length}
        </span>
      </header>
      <div className="rounded-2xl bg-card p-3 ring-line">
        <div className="h-1.5 overflow-hidden rounded-full bg-tile">
          <div className="h-full rounded-full bg-ok transition-[width] duration-500 ease-out-quint" style={{ width: `${progress * 100}%` }} />
        </div>
        <ul className="mt-2 space-y-0.5">
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} who={t.agentId !== 'main' ? agentName(session, t.agentId) : null} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function TaskRow({ t, who }: { t: Task; who: string | null }) {
  const active = t.status === 'in_progress';
  const done = t.status === 'completed';
  return (
    <li className="enter flex items-start gap-2.5 rounded-lg px-1 py-1.5">
      <span
        className={cn(
          'mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-full transition-colors duration-300',
          done ? 'bg-ok text-page' : active ? 'text-run' : 'text-faint ring-strong'
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : active ? <Loader2 className="size-[18px] animate-spin" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[13px] leading-5', done ? 'text-faint line-through decoration-faint/60' : 'text-ink')}>
          {active && t.activeForm ? t.activeForm : t.subject}
        </span>
        {who && <span className="block truncate text-[11px] text-faint">{who}</span>}
      </span>
    </li>
  );
}

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
      <ul className="space-y-1 rounded-2xl bg-card p-2 ring-line">
        {items.map((b, i) => (
          <li key={String(b.id ?? i)} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <span className="rounded-md bg-tile px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-muted ring-line">{b.type || 'task'}</span>
            <span className="truncate text-[13px] text-ink">{String(b.name || b.description || b.id || '')}</span>
            {b.status != null && <span className="ml-auto shrink-0 text-[11px] text-muted">{String(b.status)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
