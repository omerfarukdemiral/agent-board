// The session at a glance: agents, the workflow phase, tasks, time and money.
import type { ReactNode } from 'react';
import { duration, sessionCost, usd, workers, workflowProgress } from '../lib';
import type { Session } from '../types';
import { Bar, SplitBar } from './Bars';

export function StatStrip({ s, now }: { s: Session; now: number }) {
  const ws = workers(s);
  const running = ws.filter((a) => a.status === 'running').length;
  const done = ws.filter((a) => a.status !== 'running').length;
  const runs = Object.values(s.agents)
    .filter((a) => a.workflow)
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt);
  const run = runs[0];
  const tasks = Object.values(s.tasks);
  const tasksDone = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <Tile label="Agent'lar" value={ws.length ? `${done}/${ws.length}` : '—'} note={ws.length ? (running ? `${running} çalışıyor` : 'hepsi bitti') : 'subagent yok'}>
        {ws.length > 0 && <SplitBar done={done} running={running} total={ws.length} />}
      </Tile>
      {run ? (
        <WorkflowTile run={run} count={runs.length} />
      ) : (
        <Tile label="Görevler" value={tasks.length ? `${tasksDone}/${tasks.length}` : '—'} note={tasks.length ? `${tasks.length - tasksDone} açık` : 'görev listesi yok'}>
          {tasks.length > 0 && <Bar pct={tasksDone / tasks.length} tone="ok" />}
        </Tile>
      )}
      {run && tasks.length > 0 ? (
        <Tile label="Görevler" value={`${tasksDone}/${tasks.length}`} note={`${tasks.length - tasksDone} açık`}>
          <Bar pct={tasksDone / tasks.length} tone="ok" />
        </Tile>
      ) : (
        <Tile label="Süre" value={duration((s.endedAt ?? now) - s.startedAt)} note={s.endedAt ? 'oturum kapandı' : 'oturum açık'} />
      )}
      <Tile label="Maliyet" value={usd(sessionCost(s))} note={run && tasks.length > 0 ? duration((s.endedAt ?? now) - s.startedAt) : 'api eşdeğeri'} />
    </div>
  );
}

function WorkflowTile({ run, count }: { run: NonNullable<Session['agents'][string]>; count: number }) {
  const p = workflowProgress(run);
  const wf = run.workflow!;
  const done = run.status !== 'running';
  return (
    <Tile label={count > 1 ? `Workflow · ${count}` : 'Workflow'} value={done ? 'bitti' : `Faz ${p.at}/${p.total}`} note={done ? run.description ?? '' : `${wf.current ?? ''} · ${run.description ?? ''}`}>
      <Bar pct={p.pct} tone={done ? 'ok' : 'run'} />
    </Tile>
  );
}

function Tile({ label, value, note, children }: { label: string; value: string; note: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-card px-3.5 py-3 ring-card">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[20px] font-medium tabular-nums leading-7 text-ink">{value}</p>
      <p className="truncate text-[12px] text-muted" title={note}>
        {note}
      </p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
