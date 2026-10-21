// One session on one page, no tabs: what it is doing, the numbers, who is working and how far,
// the orchestration schematic, the task board. Decisions, the selected agent and the chat on the right.
import { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { AgentDetail } from '../components/AgentDetail';
import { ChatPanel } from '../components/ChatPanel';
import { FlowBoard } from '../components/FlowBoard';
import { Orchestration } from '../components/Orchestration';
import { ProjectInbox } from '../components/ProjectInbox';
import { RunningNow } from '../components/RunningNow';
import { BackgroundPanel } from '../components/SidePanels';
import { StatStrip } from '../components/StatStrip';
import { flowCards } from '../flow';
import { cn, nowDoing, projectName, sessionState, STATE_DOT, STATE_LABEL } from '../lib';
import type { ActivityItem, ApprovalRequest, Decision, Session } from '../types';

type Props = {
  session: Session;
  requests: ApprovalRequest[];
  activity: Record<string, ActivityItem[]>;
  waiting: number;
  channelPids: number[];
  now: number;
  onHome: () => void;
  onProject: (cwd: string) => void;
  onSession: (id: string) => void;
  onDecide: (id: string, d: Decision) => Promise<boolean>;
  onAck: (sessionId: string, id: string, status?: 'read' | 'answered') => Promise<boolean>;
  onSend: (sessionId: string, text: string) => Promise<boolean>;
};

export function SessionPage(p: Props) {
  const s = p.session;
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => setSelected(null), [s.id]);

  const st = sessionState(s, p.waiting, p.now);
  const doing = nowDoing(s, st);
  const pending = useMemo(() => p.requests.filter((r) => r.status === 'pending' && r.sessionId === s.id), [p.requests, s.id]);
  // the schematic already shows every agent; the board is for the task list only
  const cards = useMemo(() => flowCards([s], pending).filter((c) => c.kind === 'task'), [s, pending]);
  const waitingBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) m[r.agentId] = (m[r.agentId] || 0) + 1;
    return m;
  }, [pending]);
  const hasInbox = pending.length > 0 || Object.values(s.inbox || {}).some((i) => i.status === 'unread');
  const items = p.activity[s.id] || [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <main className="flex min-w-0 flex-col gap-5">
        <header>
          <nav className="flex items-center gap-1.5 text-[13px] text-muted">
            <button onClick={() => p.onProject(s.cwd)} className="hover:text-ink" title={s.cwd}>
              {projectName(s.cwd)}
            </button>
            <span className="text-faint">/</span>
            <span className="font-mono text-ink">#{s.id.slice(0, 4)}</span>
            {s.via === 'transcript' && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-tile px-2 py-0.5 text-[11px] text-muted" title="Onay ve mesaj için oturumu claude-board ile sürdür">
                <Eye className="size-3" /> yalnızca izleme
              </span>
            )}
          </nav>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn('inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[13px] font-medium', st === 'waiting' ? 'bg-alert/12 text-alert' : st === 'working' ? 'bg-run/12 text-run' : 'bg-tile text-muted')}>
              <span className={cn('size-2 rounded-full', STATE_DOT[st])} />
              {STATE_LABEL[st]}
            </span>
            <h1 className="min-w-0 flex-1 truncate font-mono text-[14px] text-ink" title={doing ?? undefined}>
              {doing ?? <span className="font-sans text-muted">{st === 'ended' ? 'Oturum kapandı' : 'Yeni mesaj bekliyor'}</span>}
            </h1>
          </div>
        </header>

        <StatStrip s={s} now={p.now} />
        <RunningNow s={s} now={p.now} waitingBy={waitingBy} onSelect={setSelected} />
        <Orchestration s={s} now={p.now} waitingBy={waitingBy} selected={selected} onSelect={setSelected} />
        {cards.length > 0 && (
          <section>
            <h2 className="mb-2 text-[13px] font-medium text-muted">Tasks</h2>
            <FlowBoard cards={cards} grouping="task" multiSession={false} now={p.now} onOpen={(_, agentId) => setSelected(agentId && agentId !== 'main' ? agentId : null)} />
          </section>
        )}
        <BackgroundPanel session={s} />
      </main>

      <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-[72px] xl:h-[calc(100vh-92px)]">
        {hasInbox && (
          <div className="scroll-thin min-h-0 shrink overflow-y-auto xl:max-h-[45%]">
            <ProjectInbox
              sessions={[s]}
              requests={p.requests.filter((r) => r.sessionId === s.id)}
              now={p.now}
              channelPids={p.channelPids}
              multiSession={false}
              onDecide={p.onDecide}
              onAck={p.onAck}
              onReply={p.onSend}
              onOpenSession={p.onSession}
            />
          </div>
        )}
        {selected && (
          <div className="scroll-thin min-h-0 shrink overflow-y-auto xl:max-h-[50%]">
            <AgentDetail s={s} id={selected} items={items} now={p.now} waiting={waitingBy[selected] || 0} onClose={() => setSelected(null)} />
          </div>
        )}
        <ChatPanel className="h-[70vh] min-h-[320px] xl:h-auto xl:flex-1" sessions={[s]} sessionId={s.id} onSession={() => {}} activity={p.activity} channelPids={p.channelPids} onSend={p.onSend} />
      </aside>
    </div>
  );
}
