import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, Bot, ChevronRight, Coins, LayoutGrid, ListChecks, MessageSquare, Network, Radio, Rows3, X } from 'lucide-react';
import { ActivityFeed } from './components/ActivityFeed';
import { AgentTree } from './components/AgentTree';
import { ChatPanel } from './components/ChatPanel';
import { FlowBoard } from './components/FlowBoard';
import { ProjectInbox } from './components/ProjectInbox';
import { ProjectTree } from './components/ProjectTree';
import { BackgroundPanel } from './components/SidePanels';
import { NumberTicker } from './components/affect/number-ticker';
import { flowCards, headCounts, projectsOf, type Project } from './flow';
import { cn, isLive, requestLabel } from './lib';
import type { ApprovalRequest } from './types';
import { useAttention, useBoard, useNow } from './useBoard';

type View = 'flow' | 'orch';
const params = () => new URLSearchParams(location.search);

export default function App() {
  const { sessions, activity, requests, connected, channelPids, decide, sendMessage, ackInbox } = useBoard();
  const [projectCwd, setProjectCwd] = useState<string | null>(() => params().get('project'));
  const [sessionId, setSessionId] = useState<string | null>(() => params().get('session'));
  const [view, setView] = useState<View>(() => (params().get('view') === 'orch' ? 'orch' : 'flow'));
  const [grouping, setGrouping] = useState<'task' | 'agent'>('task');
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false); // phones: bottom sheet
  const [notifyPerm, setNotifyPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const all = useMemo(() => Object.values(sessions), [sessions]);
  const projects = useMemo(() => projectsOf(all), [all]);
  const allRequests = useMemo(() => Object.values(requests), [requests]);
  const pending = useMemo(() => allRequests.filter((r) => r.status === 'pending'), [allRequests]);

  // a deep link with only ?session= still lands in the right project
  const linked = sessionId ? sessions[sessionId] : null;
  const project = projects.find((p) => p.cwd === (projectCwd ?? linked?.cwd)) || projects[0] || null;
  const projectIds = useMemo(() => new Set(project?.sessions.map((s) => s.id) || []), [project]);
  const focused = sessionId && projectIds.has(sessionId) ? sessionId : null;
  const showAll = sessionId === 'all';
  // default scope is what is alive now; finished sessions are one click away
  const scope = useMemo(() => {
    if (!project) return [];
    if (focused) return project.sessions.filter((s) => s.id === focused);
    if (showAll) return project.sessions;
    const live = project.sessions.filter(isLive);
    return live.length ? live : project.sessions.slice(0, 1);
  }, [project, focused, showAll]);
  // orchestration and chat need one session: the chosen one, else the project's most recent live one
  const orch = (focused && sessions[focused]) || project?.sessions.find(isLive) || project?.sessions[0] || null;
  const chatSessions = useMemo(() => (project ? [...project.sessions.filter(isLive), ...project.sessions.filter((s) => !isLive(s))] : []), [project]);
  const chatSession = (chatId && projectIds.has(chatId) ? chatId : null) ?? orch?.id ?? null;

  const cards = useMemo(() => flowCards(scope, pending), [scope, pending]);
  const counts = headCounts(scope, cards);
  const waitingBySession = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) m[r.sessionId] = (m[r.sessionId] || 0) + 1;
    for (const s of all) for (const it of Object.values(s.inbox || {})) if (it.status === 'unread' && it.kind !== 'info') m[s.id] = (m[s.id] || 0) + 1;
    return m;
  }, [pending, all]);
  // info items don't block anyone: counted apart and shown quieter
  const notesBySession = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of all) for (const it of Object.values(s.inbox || {})) if (it.status === 'unread' && it.kind === 'info') m[s.id] = (m[s.id] || 0) + 1;
    return m;
  }, [all]);
  const waitingTotal = Object.values(waitingBySession).reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (!project) return;
    const url = new URL(location.href);
    url.searchParams.set('project', project.cwd);
    if (focused || showAll) url.searchParams.set('session', focused || 'all');
    else url.searchParams.delete('session');
    url.searchParams.set('view', view);
    history.replaceState(null, '', url);
  }, [project?.cwd, focused, showAll, view]);
  useEffect(() => {
    const name = project ? `${project.name} · agent-board` : 'agent-board';
    document.title = waitingTotal ? `(${waitingTotal}) ${name}` : name;
  }, [project?.name, waitingTotal]);

  const label = useCallback((r: ApprovalRequest) => requestLabel(r), []);
  useAttention(pending, label);
  const now = useNow(counts.subagentsRunning + counts.orchestratorsRunning > 0 || pending.length > 0 || counts.doing > 0);

  const pickProject = (cwd: string) => {
    setProjectCwd(cwd);
    setSessionId(null);
    setAgentFilter(null);
    setChatId(null);
  };
  // from a card or a lane down to the orchestration of that session, filtered to that agent
  const openAgent = (sid: string, agentId: string | null) => {
    setSessionId(sid);
    setChatId(sid);
    setView('orch');
    setAgentFilter(agentId && agentId !== 'main' ? agentId : null);
  };
  const waitingByAgent = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) if (r.sessionId === orch?.id) m[r.agentId] = (m[r.agentId] || 0) + 1;
    return m;
  }, [pending, orch?.id]);
  const runningInOrch = orch ? Object.values(orch.agents).filter((a) => a.status === 'running').length : 0;

  const chat = (className: string) => (
    <ChatPanel
      className={className}
      sessions={chatSessions}
      sessionId={chatSession}
      onSession={setChatId}
      activity={activity}
      channelPids={channelPids}
      onSend={sendMessage}
    />
  );

  return (
    <div className="dark min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-2.5">
          <span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-semibold text-ink">
            <span className="grid size-6 place-items-center rounded-md bg-tile ring-line">
              <Network className="size-3.5" />
            </span>
            agent-board
          </span>
          {/* phones: projects as a strip; desktop uses the left rail */}
          <div className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto lg:hidden">
            {projects.map((p) => (
              <button key={p.cwd} onClick={() => pickProject(p.cwd)} className={cn('shrink-0 rounded-md px-2 py-1 text-[12.5px]', p.cwd === project?.cwd ? 'bg-tile text-ink ring-line' : 'text-muted')}>
                {p.name}
              </button>
            ))}
          </div>
          <span className="ml-auto" />
          {waitingTotal > 0 && <span className="hidden shrink-0 rounded-full bg-alert/15 px-2.5 py-0.5 text-[11.5px] font-medium text-alert sm:inline">{waitingTotal} konu seni bekliyor</span>}
          <span className={cn('size-2 shrink-0 rounded-full', connected ? 'bg-ok' : 'bg-err pulse-dot')} title={connected ? 'canlı akış bağlı' : 'sunucuya bağlanılamıyor'} />
          {notifyPerm === 'default' && (
            <button className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" onClick={() => Notification.requestPermission().then(setNotifyPerm)} title="Karar beklenince masaüstü bildirimi gönder">
              <Bell className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-5 px-4 py-5 lg:grid-cols-[220px_minmax(0,1fr)_380px]">
        <aside className="scroll-thin hidden lg:sticky lg:top-[68px] lg:block lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto">
          <ProjectTree
            projects={projects}
            current={project?.cwd ?? null}
            session={focused ?? (showAll ? 'all' : null)}
            waitingBySession={waitingBySession}
            notesBySession={notesBySession}
            now={now}
            onProject={(cwd) => {
              pickProject(cwd);
              setView('flow');
            }}
            onSession={(cwd, id) => {
              setProjectCwd(cwd);
              setSessionId(id);
              setAgentFilter(null);
              if (id && id !== 'all') setChatId(id);
            }}
          />
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          {project ? (
            <>
              {/* breadcrumb + head counts */}
              <div>
                <nav className="flex items-center gap-1 text-[12px] text-faint" aria-label="Konum">
                  <span>Projeler</span>
                  <ChevronRight className="size-3" />
                  <span className="text-muted">{project.name}</span>
                  <ChevronRight className="size-3" />
                  {focused ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-tile px-1.5 py-0.5 font-mono text-ink ring-line">
                      #{focused.slice(0, 4)}
                      <button onClick={() => setSessionId(null)} className="text-faint hover:text-ink" aria-label="Oturum filtresini kaldır">
                        <X className="size-3" />
                      </button>
                    </span>
                  ) : (
                    <span>{showAll ? 'tüm oturumlar' : counts.liveSessions ? 'canlı oturumlar' : 'son oturum'}</span>
                  )}
                </nav>
                <h1 className="mt-1 truncate text-[22px] font-semibold tracking-tight text-ink" title={project.cwd}>
                  {project.name}
                </h1>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Pill icon={<Radio className="size-3.5" />} tone={counts.liveSessions ? 'ok' : undefined}>
                    <b>{counts.liveSessions}</b>
                    {counts.sessions !== counts.liveSessions && <span className="text-faint">/{counts.sessions}</span>} oturum canlı
                  </Pill>
                  <Pill icon={<Network className="size-3.5" />} tone={counts.orchestratorsRunning ? 'run' : undefined}>
                    <b>{counts.sessions}</b> orkestratör{counts.orchestratorsRunning > 0 && ` · ${counts.orchestratorsRunning} çalışıyor`}
                  </Pill>
                  <Pill icon={<Bot className="size-3.5" />} tone={counts.subagentsRunning ? 'run' : undefined}>
                    <b>{counts.subagents}</b> subagent{counts.subagentsRunning > 0 && ` · ${counts.subagentsRunning} çalışıyor`}
                  </Pill>
                  <Pill icon={<ListChecks className="size-3.5" />}>
                    <b>{counts.done}</b>/{counts.tasks + cards.filter((c) => c.kind === 'agent').length} iş bitti
                  </Pill>
                  <Pill icon={<Coins className="size-3.5" />} title="API eşdeğeri maliyet. Abonelikle kullanıyorsan gerçek fatura değildir.">
                    <b>
                      <NumberTicker value={Number(counts.cost.toFixed(4))} format={{ style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 }} locale="en-US" />
                    </b>
                  </Pill>
                </div>
              </div>

              {/* page tabs, with the view options of the active page on the right */}
              <div className="flex flex-wrap items-end gap-x-2 border-b border-line">
                <Tab active={view === 'flow'} onClick={() => setView('flow')} icon={<LayoutGrid className="size-4" />} label="Akış" badge={counts.review || undefined} tone="alert" />
                <Tab active={view === 'orch'} onClick={() => setView('orch')} icon={<Network className="size-4" />} label="Orkestrasyon" badge={runningInOrch || undefined} tone="run" />
                {view === 'flow' && (
                  <div className="mb-1.5 ml-auto flex items-center gap-2">
                    <span className="text-[11.5px] text-faint">Görünüm</span>
                    <div className="inline-flex rounded-lg bg-tile p-0.5 ring-line" role="radiogroup" aria-label="Gruplama">
                      <Toggle on={grouping === 'task'} onClick={() => setGrouping('task')} icon={<LayoutGrid className="size-3.5" />} label="Görevler" hint="Sütunlarda görevler; her kartta onu yapan agent" />
                      <Toggle on={grouping === 'agent'} onClick={() => setGrouping('agent')} icon={<Rows3 className="size-3.5" />} label="Agent'lar" hint="Her agent bir şerit; görevleri sütunlarda" />
                    </div>
                  </div>
                )}
                {view === 'orch' && orch && (
                  <span className="mb-2 ml-auto text-[11.5px] text-faint">
                    oturum <span className="font-mono text-muted">#{orch.id.slice(0, 4)}</span>
                    {!focused && project.sessions.length > 1 && ' · en son oturum, soldan değiştir'}
                  </span>
                )}
              </div>

              {view === 'flow' ? (
                <FlowBoard cards={cards} grouping={grouping} multiSession={scope.length > 1} now={now} onOpen={openAgent} />
              ) : orch ? (
                <>
                  <AgentTree session={orch} now={now} waitingBy={waitingByAgent} selected={agentFilter} onSelect={setAgentFilter} />
                  <div className="flex h-[min(64vh,720px)] flex-col">
                    <ActivityFeed session={orch} items={activity[orch.id] || []} filter={agentFilter} onFilter={setAgentFilter} />
                  </div>
                  <BackgroundPanel session={orch} />
                </>
              ) : null}
            </>
          ) : (
            <div className="grid place-items-center rounded-[22px] bg-tray px-4 py-24 text-center ring-line">
              <div>
                <p className="text-sm font-medium">Henüz oturum yok</p>
                <p className="mt-2 text-xs text-muted">
                  Bir projede <code className="font-mono text-ink">claude-board</code> başlat. Proje burada belirecek.
                </p>
              </div>
            </div>
          )}
        </main>

        {/* right rail: what needs you on top, the conversation always below it */}
        <aside className={cn('flex min-w-0 flex-col gap-3 lg:sticky lg:top-[68px] lg:h-[calc(100vh-88px)]', waitingTotal > 0 && 'order-first lg:order-none')}>
          <div className="scroll-thin flex min-h-0 shrink flex-col gap-3 overflow-y-auto lg:max-h-[58%]">
            {project && (
              <ProjectInbox
                sessions={project.sessions}
                requests={allRequests.filter((r) => projectIds.has(r.sessionId))}
                now={now}
                channelPids={channelPids}
                multiSession={project.sessions.length > 1}
                onDecide={decide}
                onAck={ackInbox}
                onReply={sendMessage}
                onOpenSession={(id) => openAgent(id, null)}
              />
            )}
            <OtherProjectsWaiting projects={projects} current={project?.cwd} waitingBySession={waitingBySession} onOpen={pickProject} />
          </div>
          {project && chat('hidden min-h-[300px] flex-1 lg:flex')}
        </aside>
      </div>

      {/* phones: chat as a bottom sheet */}
      {project && (
        <>
          <button
            onClick={() => setChatOpen(true)}
            className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-[13px] font-medium text-page shadow-lg lg:hidden"
          >
            <MessageSquare className="size-4" /> Sohbet
          </button>
          {chatOpen && (
            <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/50 lg:hidden" onClick={() => setChatOpen(false)}>
              <div className="h-[78vh] p-2" onClick={(e) => e.stopPropagation()}>
                {chat('flex h-full')}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Pill({ icon, children, tone, title }: { icon: ReactNode; children: ReactNode; tone?: 'ok' | 'run'; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-tray px-2.5 py-1 text-[12px] tabular-nums text-muted ring-line [&_b]:font-semibold [&_b]:text-ink',
        tone === 'run' && 'text-run',
        tone === 'ok' && '[&>svg]:text-ok'
      )}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}

function Tab({ active, onClick, icon, label, badge, tone }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number; tone: 'alert' | 'run' }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[14px] transition-colors',
        active ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
      )}
    >
      {icon}
      {label}
      {badge != null && <span className={cn('rounded-full px-1.5 text-[11px] font-medium', tone === 'alert' ? 'bg-alert/15 text-alert' : 'bg-run/15 text-run')}>{badge}</span>}
    </button>
  );
}

function Toggle({ on, onClick, icon, label, hint }: { on: boolean; onClick: () => void; icon: ReactNode; label: string; hint: string }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      title={hint}
      onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] transition-colors', on ? 'bg-raise font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,.4)]' : 'text-muted hover:text-ink')}
    >
      {icon}
      {label}
    </button>
  );
}

// the inbox is per project; other projects that need the user get a quiet pointer
function OtherProjectsWaiting({ projects, current, waitingBySession, onOpen }: { projects: Project[]; current?: string; waitingBySession: Record<string, number>; onOpen: (cwd: string) => void }) {
  const others = projects
    .filter((p) => p.cwd !== current)
    .map((p) => ({ p, n: p.sessions.reduce((a, s) => a + (waitingBySession[s.id] || 0), 0) }))
    .filter((x) => x.n > 0);
  if (!others.length) return null;
  return (
    <div className="rounded-2xl bg-tray px-3 py-2.5 ring-line">
      <p className="pb-1 text-[11.5px] text-faint">Diğer projeler</p>
      {others.map(({ p, n }) => (
        <button key={p.cwd} onClick={() => onOpen(p.cwd)} className="flex w-full items-center gap-2 py-0.5 text-left text-[12.5px] text-muted hover:text-ink">
          <span className="size-1.5 rounded-full bg-alert pulse-dot" />
          {p.name}
          <span className="ml-auto text-alert">{n} konu</span>
        </button>
      ))}
    </div>
  );
}
