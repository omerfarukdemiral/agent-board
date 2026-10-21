// The session as a schematic: the orchestrator on top, then its branches. Plain subagents sit in a
// grid; every Workflow run is a row of phases (in order) with all of its agents, finished or not.
import { useEffect, useState } from 'react';
import { AgentCanvas } from './AgentCanvas';
import { Check, ChevronDown, ChevronRight, Network, Workflow } from 'lucide-react';
import { childrenOf, cn, displayName, duration, estimate, prettyTool, rel, usd, workflowProgress } from '../lib';
import type { Agent, Session } from '../types';
import { AGENT_STATE, agentState } from '../agentState';
import { Bar } from './Bars';

type Props = { s: Session; now: number; waitingBy: Record<string, number>; selected: string | null; onSelect: (id: string | null) => void };

type View = 'schema' | 'swarm';

export function Orchestration(p: Props) {
  const { s } = p;
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem('ab:orch-view') === 'swarm' ? 'swarm' : 'schema';
    } catch {
      return 'schema';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('ab:orch-view', view);
    } catch {}
  }, [view]);
  const main = s.agents.main;
  if (!main) return null;
  const kids = childrenOf(s, 'main');
  const direct = kids.filter((a) => !a.workflow);
  const runs = kids.filter((a) => a.workflow).sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt);

  return (
    <section>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-[13px] font-medium text-muted">Orchestration</h2>
        <ViewSwitch view={view} onView={setView} />
      </div>
      {view === 'swarm' ? (
        <AgentCanvas session={s} now={p.now} waitingBy={p.waitingBy} selected={p.selected} onSelect={p.onSelect} />
      ) : (
      <div className="rounded-2xl bg-tray p-3 ring-line sm:p-4">
        <OrchestratorBox {...p} a={main} />
        {kids.length > 0 && (
          <div className="ml-4 space-y-3 border-l-2 border-run/25 pt-3 pl-4 sm:ml-6 sm:pl-5">
            {direct.length > 0 && (
              <Branch>
                <p className="mb-2 text-[12px] text-muted">Subagents · {direct.length}</p>
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                  {direct.map((a) => (
                    <AgentTile key={a.id} {...p} a={a} />
                  ))}
                </div>
              </Branch>
            )}
            {runs.map((r) => (
              <Branch key={r.id}>
                <WorkflowBlock {...p} run={r} />
              </Branch>
            ))}
          </div>
        )}
      </div>
      )}
    </section>
  );
}

// Schema reads best; Swarm is the showcase (the swarm canvas). The choice is remembered.
function ViewSwitch({ view, onView }: { view: View; onView: (v: View) => void }) {
  return (
    <div className="ml-auto inline-flex rounded-lg bg-tile p-0.5 text-[12px]" role="tablist" aria-label="Görünüm">
      {(['schema', 'swarm'] as const).map((v) => (
        <button key={v} role="tab" aria-selected={view === v} onClick={() => onView(v)} className={cn('rounded-md px-2.5 py-1 transition-colors', view === v ? 'bg-card font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>
          {v === 'schema' ? 'Schema' : 'Swarm'}
        </button>
      ))}
    </div>
  );
}

// an elbow from the spine to the branch
function Branch({ children }: { children: React.ReactNode }) {
  return <div className="relative before:absolute before:-left-4 before:top-4 before:w-4 before:border-t-2 before:border-run/25 sm:before:-left-5 sm:before:w-5">{children}</div>;
}

function OrchestratorBox({ a, s, now, waitingBy, selected, onSelect }: Props & { a: Agent }) {
  const st = AGENT_STATE[agentState(a, !!s.endedAt, waitingBy.main || 0)];
  const doing = a.status === 'running' ? a.currentTool : null;
  return (
    <button
      onClick={() => onSelect(selected === 'main' ? null : 'main')}
      className={cn('flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-run px-4 py-3 text-left text-white shadow-sm transition-[filter] hover:brightness-105', selected === 'main' && 'outline outline-2 outline-offset-2 outline-run')}
    >
      <span className="inline-flex items-center gap-2 text-[14px] font-semibold">
        <Network className="size-4" />
        Orchestrator
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2 py-0.5 text-[12px]">
        <span className={cn('size-1.5 rounded-full bg-white', a.status === 'running' && 'pulse-dot')} />
        {st.label}
      </span>
      {doing && <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-white/85">{prettyTool(rel(doing, s.cwd))}</span>}
      <span className="ml-auto inline-flex shrink-0 gap-3 font-mono text-[12px] tabular-nums text-white/85">
        <span>{duration((a.endedAt ?? now) - a.startedAt)}</span>
        <span>{a.toolCalls} araç</span>
        <span className="text-white">{usd(a.costUsd)}</span>
      </span>
    </button>
  );
}

function AgentTile({ a, s, now, waitingBy, selected, onSelect }: Props & { a: Agent }) {
  const status = agentState(a, !!s.endedAt, waitingBy[a.id] || 0);
  const st = AGENT_STATE[status];
  const est = estimate(a, s, now);
  const kids = childrenOf(s, a.id);
  return (
    <div className="min-w-0">
      <button
        onClick={() => onSelect(selected === a.id ? null : a.id)}
        title={a.description ?? undefined}
        className={cn('block w-full rounded-xl bg-card px-3 py-2 text-left ring-card transition-colors hover:bg-raise', st.ring, selected === a.id && 'ring-selected')}
      >
        <span className="flex items-center gap-2">
          <span className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{displayName(a)}</span>
          <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink">{usd(a.costUsd)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2 pl-3.5 text-[12px] tabular-nums text-muted">
          <span className={st.text}>{st.label}</span>
          <span className="ml-auto">{duration((a.endedAt ?? now) - a.startedAt)}</span>
          <span>{a.toolCalls} araç</span>
        </span>
        {status === 'running' && <Bar className="mt-2" pct={est ? est.pct : null} tone={est?.over ? 'alert' : 'run'} />}
      </button>
      {kids.length > 0 && (
        <div className="ml-3 mt-1.5 space-y-1.5 border-l border-line pl-2.5">
          {kids.map((k) => (
            <AgentTile key={k.id} a={k} s={s} now={now} waitingBy={waitingBy} selected={selected} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

type Phase = { title: string; agents: Agent[] };

function WorkflowBlock({ run, s, now, waitingBy, selected, onSelect }: Props & { run: Agent }) {
  const [open, setOpen] = useState(true);
  const wf = run.workflow!;
  const agents = childrenOf(s, run.id);
  const prog = workflowProgress(run);
  const running = run.status === 'running';
  const finished = agents.filter((a) => a.status !== 'running').length;
  const cost = agents.reduce((n, a) => n + (a.costUsd ?? 0), 0);

  // phases in script order; agents whose phase isn't listed go to the end
  const phases: Phase[] = wf.phases.map((title) => ({ title, agents: [] }));
  for (const a of agents) {
    let ph = phases.find((x) => x.title === a.phase);
    if (!ph) phases.push((ph = { title: a.phase || 'Diğer', agents: [] }));
    ph.agents.push(a);
  }
  const at = wf.current ? wf.phases.indexOf(wf.current) : -1;

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left hover:bg-raise">
        <ChevronDown className={cn('size-4 shrink-0 text-faint transition-transform', !open && '-rotate-90')} />
        <Workflow className="size-4 shrink-0 text-run" />
        <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{run.description}</span>
        <span className={cn('text-[12px] font-medium', running ? 'text-run' : run.status === 'error' ? 'text-err' : 'text-ok')}>
          {running ? `Phase ${prog.at}/${prog.total} · ${wf.current ?? ''}` : run.outcome === 'stopped' ? 'yarıda kaldı' : run.status === 'error' ? 'hata' : 'bitti'}
        </span>
        <span className="ml-auto inline-flex shrink-0 gap-3 font-mono text-[12px] tabular-nums text-muted">
          <span>
            {finished}/{agents.length} agent
          </span>
          <span>{duration((run.endedAt ?? now) - run.startedAt)}</span>
          <span className="text-ink">{usd(cost)}</span>
        </span>
        <Bar className="basis-full" pct={prog.pct} tone={running ? 'run' : 'ok'} />
      </button>
      {open && (
        <div className="scroll-thin flex items-stretch gap-1.5 overflow-x-auto border-t border-line p-2.5">
          {phases.map((ph, i) => {
            const state = !running || i < at ? 'done' : i === at ? 'now' : ph.agents.length ? 'now' : 'next';
            return (
              <div key={ph.title} className="flex items-stretch gap-1.5">
                {i > 0 && <ChevronRight className="mt-3 size-4 shrink-0 text-faint" />}
                <PhaseColumn n={i + 1} ph={ph} state={state} s={s} now={now} waitingBy={waitingBy} selected={selected} onSelect={onSelect} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PhaseColumn({ n, ph, state, s, now, waitingBy, selected, onSelect }: Omit<Props, 'run'> & { n: number; ph: Phase; state: 'done' | 'now' | 'next' }) {
  const finished = ph.agents.filter((a) => a.status !== 'running').length;
  const start = Math.min(...ph.agents.map((a) => a.startedAt));
  const end = Math.max(...ph.agents.map((a) => a.endedAt ?? now));
  const cost = ph.agents.reduce((x, a) => x + (a.costUsd ?? 0), 0);
  return (
    <div className={cn('flex w-[232px] shrink-0 flex-col rounded-lg p-2', state === 'now' ? 'bg-run/[0.06] ring-run' : 'bg-tray ring-line', state === 'next' && 'opacity-60')}>
      <div className="flex items-center gap-1.5 text-[13px]">
        <span className="grid size-4 place-items-center">
          {state === 'done' ? <Check className="size-3.5 text-ok" /> : state === 'now' ? <span className="size-1.5 rounded-full bg-run pulse-dot" /> : <span className="size-1.5 rounded-full bg-line-strong" />}
        </span>
        <span className="text-faint">{n}</span>
        <span className={cn('min-w-0 flex-1 truncate font-medium', state === 'next' ? 'text-muted' : 'text-ink')}>{ph.title}</span>
        <span className="font-mono text-[12px] tabular-nums text-muted">{ph.agents.length ? `${finished}/${ph.agents.length}` : '—'}</span>
      </div>
      {ph.agents.length > 0 ? (
        <>
          <p className="mt-0.5 pl-[22px] font-mono text-[11px] tabular-nums text-faint">
            {duration(end - start)} · {usd(cost)}
          </p>
          <Bar className="mt-1.5" pct={finished / ph.agents.length} tone={finished === ph.agents.length ? 'ok' : 'run'} />
          <ul className="scroll-thin mt-2 max-h-[264px] space-y-1 overflow-y-auto pr-0.5">
            {ph.agents.map((a) => (
              <PhaseAgent key={a.id} a={a} s={s} now={now} waiting={waitingBy[a.id] || 0} selected={selected === a.id} onSelect={() => onSelect(selected === a.id ? null : a.id)} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 pl-[22px] text-[12px] text-faint">başlamadı</p>
      )}
    </div>
  );
}

function PhaseAgent({ a, s, now, waiting, selected, onSelect }: { a: Agent; s: Session; now: number; waiting: number; selected: boolean; onSelect: () => void }) {
  const status = agentState(a, !!s.endedAt, waiting);
  const st = AGENT_STATE[status];
  const est = estimate(a, s, now);
  return (
    <li>
      <button onClick={onSelect} title={`${displayName(a)} · ${a.toolCalls} araç · ${usd(a.costUsd)}`} className={cn('w-full rounded-md bg-card px-2 py-1.5 text-left ring-card hover:bg-raise', st.ring, selected && 'ring-selected')}>
        <span className="flex items-center gap-1.5 text-[12px]">
          <span className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
          <span className="min-w-0 flex-1 truncate text-ink">{displayName(a)}</span>
          <span className="shrink-0 tabular-nums text-muted">{duration((a.endedAt ?? now) - a.startedAt)}</span>
        </span>
        {status === 'running' && <Bar className="mt-1.5" pct={est ? est.pct : null} tone={est?.over ? 'alert' : 'run'} />}
        {status === 'waiting' && <span className="mt-1 block text-[11px] text-alert">onayını bekliyor</span>}
      </button>
    </li>
  );
}
