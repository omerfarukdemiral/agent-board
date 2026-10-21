import { cn } from '../lib';

// One progress bar style for the whole board. pct: 0..1, or null for "running, no estimate".
export function Bar({ pct, tone = 'run', className }: { pct: number | null; tone?: 'run' | 'ok' | 'alert'; className?: string }) {
  const fill = { run: 'bg-run', ok: 'bg-ok', alert: 'bg-alert' }[tone];
  return (
    <span className={cn('relative block h-1.5 overflow-hidden rounded-full bg-tile', className)}>
      {pct == null ? (
        <span className={cn('bar-indeterminate absolute inset-y-0 w-1/3 rounded-full', fill)} />
      ) : (
        <span className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-700', fill)} style={{ width: `${Math.max(2, Math.round(pct * 100))}%` }} />
      )}
    </span>
  );
}

// Finished (failed shown apart) and running share of a whole, in one bar
export function SplitBar({ done, running, failed = 0, total, className }: { done: number; running: number; failed?: number; total: number; className?: string }) {
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <span className={cn('flex h-1.5 overflow-hidden rounded-full bg-tile', className)}>
      <span className="bg-ok transition-[width] duration-700" style={{ width: w(done - failed) }} />
      {failed > 0 && <span className="bg-err transition-[width] duration-700" style={{ width: w(failed) }} />}
      <span className="bg-run transition-[width] duration-700" style={{ width: w(running) }} />
    </span>
  );
}
