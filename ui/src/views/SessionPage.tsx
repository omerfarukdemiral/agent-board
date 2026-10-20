// One session in focus: a plain sentence of what it is doing, then agents / tasks / activity,
// and the conversation (with this session's open decisions on top) always on the right.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Eye, LayoutGrid, Network } from 'lucide-react';
import { ActivityFeed } from '../components/ActivityFeed';
import { AgentTree } from '../components/AgentTree';
import { ChatPanel } from '../components/ChatPanel';
import { FlowBoard } from '../components/FlowBoard';
import { ProjectInbox } from '../components/ProjectInbox';
import { BackgroundPanel } from '../components/SidePanels';
import { flowCards } from '../flow';
import { cn, duration, nowDoing, projectName, runningCount, sessionCost, sessionState, STATE_DOT, STATE_LABEL, usd } from '../lib';
import type { ActivityItem, ApprovalRequest, Decision, Session } from '../types';

type Tab = 'agents' | 'tasks' | 'activity';

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
  const [tab, setTab] = useState<Tab>('agents');
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  useEffect(() => {
    setTab('agents');
    setAgentFilter(null);
  }, [s.id]);

  const st = sessionState(s, p.waiting, p.now);
  const doing = nowDoing(s, st);
  const { subs, running } = runningCount(s);
  const pending = useMemo(() => p.requests.filter((r) => r.status === 'pending' && r.sessionId === s.id), [p.requests, s.id]);
  const cards = useMemo(() => flowCards([s], pending), [s, pending]);
  const tasks = Object.values(s.tasks);
  const waitingByAgent = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) m[r.agentId] = (m[r.agentId] || 0) + 1;
    return m;
  }, [pending]);
  const watchOnly = s.via === 'transcript';

  // clicking an agent on the canvas shows what it did
  const selectAgent = (id: string | null) => {
    setAgentFilter(id);
    if (id) setTab('activity');
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
      <main className="flex min-w-0 flex-col gap-4">
        <header>
          <nav className="flex items-center gap-1.5 text-[13px] text-muted">
            <button onClick={() => p.onProject(s.cwd)} className="hover:text-ink" title={s.cwd}>
              {projectName(s.cwd)}
            </button>
            <span className="text-faint">/</span>
            <span className="font-mono text-ink">#{s.id.slice(0, 4)}</span>
            {watchOnly && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-tile px-2 py-0.5 text-[11px] text-muted ring-line" title="Transcript'ten okunuyor; onay ve mesaj için claude-board ile devam ettir">
                <Eye className="size-3" /> yalnızca izleme
              </span>
            )}
          </nav>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cn('inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[13px] font-medium', st === 'waiting' ? 'bg-alert/12 text-alert' : st === 'working' ? 'bg-run/12 text-run' : 'bg-tile text-muted')}>
              <span className={cn('size-2 rounded-full', STATE_DOT[st])} />
              {STATE_LABEL[st]}
            </span>
            <h1 className="min-w-0 truncate font-mono text-[15px] text-ink">
              {doing ? (
                <>
                  <span className="mr-2 font-sans text-[13px] text-faint">şu an</span>
                  {doing}
                </>
              ) : (
                <span className="font-sans text-[15px] text-muted">{st === 'ended' ? 'Oturum kapandı.' : 'Yeni mesajını bekliyor.'}</span>
              )}
            </h1>
          </div>
          <p className="mt-2 text-[13px] tabular-nums text-muted">
            1 orkestratör · {subs} subagent{running > 0 && <span className="text-run"> ({running} çalışıyor)</span>}
            {tasks.length > 0 && ` · ${tasks.filter((t) => t.status === 'completed').length}/${tasks.length} görev`} · {duration((s.endedAt ?? p.now) - s.startedAt)} ·{' '}
            <span className="text-ink" title="API eşdeğeri; abonelikte gerçek fatura değildir">
              {usd(sessionCost(s))}
            </span>
          </p>
        </header>

        <div className="flex items-end gap-1 border-b border-line" role="tablist">
          <TabButton on={tab === 'agents'} onClick={() => setTab('agents')} icon={<Network className="size-4" />} label="Agent'lar" badge={subs + 1} />
          {tasks.length > 0 && <TabButton on={tab === 'tasks'} onClick={() => setTab('tasks')} icon={<LayoutGrid className="size-4" />} label="Görevler" badge={tasks.length} />}
          <TabButton on={tab === 'activity'} onClick={() => setTab('activity')} icon={<Activity className="size-4" />} label="Etkinlik" />
        </div>

        {tab === 'agents' && (
          <>
            <AgentTree session={s} now={p.now} waitingBy={waitingByAgent} selected={agentFilter} onSelect={selectAgent} />
            <p className="-mt-2 text-[12px] text-faint">Bir agent'a tıklayınca Etkinlik'te yalnızca onun yaptıkları görünür.</p>
            <BackgroundPanel session={s} />
          </>
        )}
        {tab === 'tasks' && <FlowBoard cards={cards} grouping="task" multiSession={false} now={p.now} onOpen={(_, agentId) => selectAgent(agentId && agentId !== 'main' ? agentId : null)} />}
        {tab === 'activity' && (
          <div className="flex h-[min(72vh,820px)] flex-col">
            <ActivityFeed session={s} items={p.activity[s.id] || []} filter={agentFilter} onFilter={setAgentFilter} />
          </div>
        )}
      </main>

      <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-[72px] xl:h-[calc(100vh-92px)]">
        <div className="scroll-thin min-h-0 shrink overflow-y-auto xl:max-h-[50%]">
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
        <ChatPanel className="min-h-[320px] flex-1" sessions={[s]} sessionId={s.id} onSession={() => {}} activity={p.activity} channelPids={p.channelPids} onSend={p.onSend} />
      </aside>
    </div>
  );
}

function TabButton({ on, onClick, icon, label, badge }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn('-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[14px] transition-colors', on ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
    >
      {icon}
      {label}
      {badge != null && <span className="rounded-full bg-tile px-1.5 text-[11px] text-muted ring-line">{badge}</span>}
    </button>
  );
}
