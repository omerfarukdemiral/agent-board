import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Network } from 'lucide-react';
import { ActivityFeed } from './components/ActivityFeed';
import { AgentTree } from './components/AgentTree';
import { FlowBoard } from './components/FlowBoard';
import { ProjectInbox } from './components/ProjectInbox';
import { ProjectTree } from './components/ProjectTree';
import { BackgroundPanel } from './components/SidePanels';
import { NumberTicker } from './components/affect/number-ticker';
import { SegmentedControl } from './components/affect/segmented-control';
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
  // default scope is what is alive now; finished sessions are one click away ("Tüm oturumlar")
  const scope = useMemo(() => {
    if (!project) return [];
    if (focused) return project.sessions.filter((s) => s.id === focused);
    if (showAll) return project.sessions;
    const live = project.sessions.filter(isLive);
    return live.length ? live : project.sessions.slice(0, 1);
  }, [project, focused, showAll]);
  // orchestration needs one session: the chosen one, else the project's most recent live one
  const orch = (focused && sessions[focused]) || project?.sessions.find(isLive) || project?.sessions[0] || null;

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
  };
  // from a card or a lane down to the orchestration of that session, filtered to that agent
  const openAgent = (sid: string, agentId: string | null) => {
    setSessionId(sid);
    setView('orch');
    setAgentFilter(agentId && agentId !== 'main' ? agentId : null);
  };
  const waitingByAgent = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) if (r.sessionId === orch?.id) m[r.agentId] = (m[r.agentId] || 0) + 1;
    return m;
  }, [pending, orch?.id]);

  return (
    <div className="dark min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-2">
          <span className="inline-flex shrink-0 items-center gap-2 text-[13px] font-semibold text-ink">
            <Network className="size-4 text-muted" />
            agent-board
          </span>
          {/* phones: projects as a strip; desktop uses the left rail */}
          <div className="scroll-thin flex min-w-0 flex-1 gap-1 overflow-x-auto lg:hidden">
            {projects.map((p) => (
              <button
                key={p.cwd}
                onClick={() => pickProject(p.cwd)}
                className={cn('shrink-0 rounded-md px-2 py-1 text-[12.5px]', p.cwd === project?.cwd ? 'bg-tile text-ink ring-line' : 'text-muted')}
              >
                {p.name}
              </button>
            ))}
          </div>
          <span className="ml-auto" />
          {waitingTotal > 0 && <span className="hidden shrink-0 rounded-full bg-alert/15 px-2 py-0.5 text-[11.5px] font-medium text-alert sm:inline">{waitingTotal} konu seni bekliyor</span>}
          <span className={cn('size-2 shrink-0 rounded-full', connected ? 'bg-ok' : 'bg-err pulse-dot')} title={connected ? 'canlı akış bağlı' : 'sunucuya bağlanılamıyor'} />
          {notifyPerm === 'default' && (
            <button className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" onClick={() => Notification.requestPermission().then(setNotifyPerm)} title="Karar beklenince masaüstü bildirimi gönder">
              <Bell className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] gap-4 px-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)_370px]">
        <aside className="scroll-thin hidden lg:sticky lg:top-[60px] lg:block lg:max-h-[calc(100vh-76px)] lg:overflow-y-auto">
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
            }}
          />
        </aside>

        <main className="flex min-w-0 flex-col gap-3">
          {project ? (
            <>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold tracking-tight text-ink" title={project.cwd}>
                    {project.name}
                    {focused && <span className="ml-2 font-mono text-[13px] font-normal text-faint">#{focused.slice(0, 4)}</span>}
                  </h1>
                  <p className="mt-0.5 text-[12.5px] tabular-nums text-muted">
                    <b className="font-semibold text-ink">{counts.liveSessions}</b>
                    {counts.sessions !== counts.liveSessions && <span className="text-faint">/{counts.sessions}</span>} oturum canlı
                    <Sep />
                    <b className="font-semibold text-ink">{counts.liveSessions}</b> orkestratör
                    {counts.orchestratorsRunning > 0 && <span className="text-run"> ({counts.orchestratorsRunning} çalışıyor)</span>}
                    <Sep />
                    <b className="font-semibold text-ink">{counts.subagents}</b> subagent
                    {counts.subagentsRunning > 0 && <span className="text-run"> ({counts.subagentsRunning} çalışıyor)</span>}
                    <Sep />
                    <b className="font-semibold text-ink">{counts.tasks}</b> görev
                    <Sep />
                    <span title="API eşdeğeri maliyet. Abonelikle kullanıyorsan gerçek fatura değildir.">
                      <b className="font-semibold text-ink">
                        <NumberTicker value={Number(counts.cost.toFixed(4))} format={{ style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 }} locale="en-US" />
                      </b>
                    </span>
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {view === 'flow' && (
                    <SegmentedControl
                      size="sm"
                      aria-label="Gruplama"
                      value={grouping}
                      onChange={setGrouping}
                      options={[
                        { value: 'task', label: 'Görev → Agent' },
                        { value: 'agent', label: 'Agent → Görev' },
                      ]}
                    />
                  )}
                  <SegmentedControl
                    size="sm"
                    kind="tabs"
                    aria-label="Görünüm"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'flow', label: 'Akış', count: counts.review || undefined },
                      { value: 'orch', label: 'Orkestrasyon' },
                    ]}
                  />
                </div>
              </div>

              {view === 'flow' ? (
                <FlowBoard cards={cards} grouping={grouping} multiSession={scope.length > 1} now={now} onOpen={openAgent} />
              ) : orch ? (
                <>
                  {!focused && project.sessions.length > 1 && <p className="text-[12px] text-faint">En son oturum gösteriliyor (#{orch.id.slice(0, 4)}). Başka bir oturum için soldan seç.</p>}
                  <AgentTree session={orch} now={now} waitingBy={waitingByAgent} selected={agentFilter} onSelect={setAgentFilter} />
                  <div className="flex h-[min(68vh,740px)] flex-col">
                    <ActivityFeed
                      session={orch}
                      items={activity[orch.id] || []}
                      filter={agentFilter}
                      onFilter={setAgentFilter}
                      channel={!!orch.pid && channelPids.includes(orch.pid)}
                      onSend={(text) => sendMessage(orch.id, text)}
                    />
                  </div>
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

        <aside className={cn('scroll-thin flex min-w-0 flex-col gap-3 lg:sticky lg:top-[60px] lg:max-h-[calc(100vh-76px)] lg:overflow-y-auto', waitingTotal > 0 && 'order-first lg:order-none')}>
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
          {orch && view === 'orch' && <BackgroundPanel session={orch} />}
          <OtherProjectsWaiting projects={projects} current={project?.cwd} waitingBySession={waitingBySession} onOpen={pickProject} />
        </aside>
      </div>
    </div>
  );
}

const Sep = () => <span className="mx-1.5 text-faint">·</span>;

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
