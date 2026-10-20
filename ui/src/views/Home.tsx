// "Şimdi": one look at the whole machine. What waits for me, what is working, what is idle.
// Sessions are grouped by project; a project header narrows the page to that project and adds
// its combined task board.
import { useMemo, useState } from 'react';
import { ArrowLeft, Bot, ChevronRight, FolderGit2, Network } from 'lucide-react';
import { FlowBoard } from '../components/FlowBoard';
import { ProjectInbox } from '../components/ProjectInbox';
import { flowCards, projectsOf, type Project } from '../flow';
import { ago, cn, duration, nowDoing, projectName, runningCount, sessionCost, sessionState, STATE_DOT, STATE_LABEL, usd, type SessionState } from '../lib';
import type { ActivityItem, ApprovalRequest, Decision, Session } from '../types';

type Props = {
  sessions: Session[];
  requests: ApprovalRequest[];
  activity: Record<string, ActivityItem[]>;
  waitingBySession: Record<string, number>;
  channelPids: number[];
  now: number;
  project: string | null; // narrowed to one project (cwd)
  onProject: (cwd: string | null) => void;
  onSession: (id: string) => void;
  onDecide: (id: string, d: Decision) => Promise<boolean>;
  onAck: (sessionId: string, id: string, status?: 'read' | 'answered') => Promise<boolean>;
  onReply: (sessionId: string, text: string) => Promise<boolean>;
};

const ORDER: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };
const STALE_MS = 6 * 3600 * 1000; // open but quiet this long: still listed, just out of the way

export function Home(p: Props) {
  const [showEnded, setShowEnded] = useState(false);
  const projects = useMemo(() => projectsOf(p.sessions), [p.sessions]);
  const state = (s: Session) => sessionState(s, p.waitingBySession[s.id] || 0, p.now);
  const focus = p.project ? projects.find((x) => x.cwd === p.project) || null : null;
  const shown = focus ? [focus] : projects;

  const stale = (s: Session) => state(s) === 'idle' && p.now - s.lastEventAt > STALE_MS;
  const recent = (s: Session) => state(s) !== 'ended' && !stale(s);
  const open = shown.filter((pr) => pr.sessions.some(recent));
  const staleSessions = shown.flatMap((pr) => pr.sessions.filter(stale)).sort((a, b) => b.lastEventAt - a.lastEventAt);
  const closed = shown.filter((pr) => !pr.sessions.some(recent) && !pr.sessions.some(stale));
  const [showStale, setShowStale] = useState(false);
  const scopeSessions = shown.flatMap((pr) => pr.sessions);
  const ids = new Set(scopeSessions.map((s) => s.id));
  const attention =
    p.requests.some((r) => r.status === 'pending' && ids.has(r.sessionId)) ||
    scopeSessions.some((s) => Object.values(s.inbox || {}).some((i) => i.status === 'unread'));
  const counts = { working: 0, waiting: 0, idle: 0 } as Record<SessionState, number>;
  for (const s of scopeSessions) counts[state(s)] = (counts[state(s)] || 0) + 1;

  return (
    <div className={cn('mx-auto grid max-w-[1500px] gap-6 px-4 py-6', attention && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
      <main className="min-w-0 space-y-7">
        <header>
          {focus ? (
            <button onClick={() => p.onProject(null)} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
              <ArrowLeft className="size-3.5" /> Tüm projeler
            </button>
          ) : null}
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">{focus ? focus.name : 'Şimdi'}</h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {counts.waiting > 0 && <span className="text-alert">{counts.waiting} oturum seni bekliyor · </span>}
            {counts.working || 0} oturum çalışıyor · {counts.idle || 0} oturum boşta
            {!attention && <span className="text-faint"> · bekleyen karar yok</span>}
          </p>
        </header>

        {open.length === 0 && (
          <div className="rounded-2xl bg-tray px-5 py-10 text-center ring-line">
            <p className="text-sm font-medium text-ink">Açık oturum yok</p>
            <p className="mt-1.5 text-[13px] text-muted">
              Bir projede <code className="font-mono text-ink">claude</code> ya da <code className="font-mono text-ink">claude-board</code> başlat; burada belirir.
            </p>
          </div>
        )}

        {open.map((pr) => (
          <ProjectBlock key={pr.cwd} pr={pr} focus={!!focus} state={state} {...p} />
        ))}

        {focus && <ProjectBoard pr={focus} {...p} />}

        {staleSessions.length > 0 && (
          <section>
            <button onClick={() => setShowStale((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
              <ChevronRight className={cn('size-4 transition-transform', showStale && 'rotate-90')} />
              Uzun süredir sessiz açık oturumlar · {staleSessions.length}
            </button>
            {showStale && (
              <ul className="mt-3 overflow-hidden rounded-2xl bg-tray/60 ring-line">
                {staleSessions.map((s) => (
                  <SessionRow key={s.id} s={s} st="idle" now={p.now} activity={p.activity[s.id]} project={focus ? undefined : projectName(s.cwd)} onOpen={() => p.onSession(s.id)} />
                ))}
              </ul>
            )}
          </section>
        )}

        {closed.length > 0 && (
          <section>
            <button onClick={() => setShowEnded((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
              <ChevronRight className={cn('size-4 transition-transform', showEnded && 'rotate-90')} />
              Kapanmış projeler · {closed.length}
            </button>
            {showEnded && (
              <div className="mt-3 space-y-5">
                {closed.map((pr) => (
                  <ProjectBlock key={pr.cwd} pr={pr} focus={!!focus} state={state} {...p} />
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {attention && (
      <aside className="order-first min-w-0 lg:order-none lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto scroll-thin">
        <ProjectInbox
          sessions={scopeSessions}
          requests={p.requests.filter((r) => ids.has(r.sessionId))}
          now={p.now}
          channelPids={p.channelPids}
          multiSession
          onDecide={p.onDecide}
          onAck={p.onAck}
          onReply={p.onReply}
          onOpenSession={p.onSession}
        />
      </aside>
      )}
    </div>
  );
}

function ProjectBlock({ pr, focus, state, now, waitingBySession, onProject, onSession, activity }: Props & { pr: Project; focus: boolean; state: (s: Session) => SessionState }) {
  const [showEnded, setShowEnded] = useState(focus);
  const sorted = [...pr.sessions].sort((a, b) => ORDER[state(a)] - ORDER[state(b)] || b.lastEventAt - a.lastEventAt);
  const active = sorted.filter((s) => state(s) === 'waiting' || state(s) === 'working');
  const idle = sorted.filter((s) => state(s) === 'idle' && now - s.lastEventAt <= STALE_MS);
  const ended = sorted.filter((s) => state(s) === 'ended');
  // open by default only where something is happening; the choice is remembered per project
  const [open, setOpen] = useRemembered(`ab:open:${pr.cwd}`, focus || active.length > 0);
  const show = focus || open;
  const cost = pr.sessions.reduce((n, x) => n + sessionCost(x), 0);
  return (
    <section className="rounded-2xl">
      <div className="mb-2.5 flex items-center gap-2">
        {!focus && (
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Kapat' : 'Aç'} className="grid size-6 place-items-center rounded-md text-faint hover:bg-tile hover:text-ink">
            <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
          </button>
        )}
        <button disabled={focus} onClick={() => onProject(pr.cwd)} title={`${pr.cwd} · proje görünümü`} className="group flex min-w-0 items-center gap-2 text-left disabled:cursor-default">
          <FolderGit2 className="size-4 shrink-0 text-muted" />
          <span className="truncate text-[15px] font-semibold text-ink group-enabled:group-hover:underline">{pr.name}</span>
        </button>
        {/* closed: one line says enough */}
        <span className="min-w-0 truncate text-[12px] text-faint">
          {active.length > 0 && <span className="text-run">{active.length} çalışıyor · </span>}
          {active.length + idle.length} açık oturum{ended.length ? ` · ${ended.length} kapanmış` : ''}
          {!show && ` · ${ago(pr.lastEventAt, now)}`}
        </span>
        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted">{usd(cost)}</span>
      </div>
      {show && (<>

      {active.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
          {active.map((s) => (
            <SessionCard key={s.id} s={s} st={state(s)} now={now} waiting={waitingBySession[s.id] || 0} onOpen={() => onSession(s.id)} />
          ))}
        </div>
      )}

      {idle.length > 0 && (
        <ul className={cn('overflow-hidden rounded-2xl bg-tray ring-line', active.length > 0 && 'mt-2.5')}>
          {idle.map((s) => (
            <SessionRow key={s.id} s={s} st="idle" now={now} activity={activity[s.id]} onOpen={() => onSession(s.id)} />
          ))}
        </ul>
      )}

      {ended.length > 0 && (active.length > 0 || idle.length > 0) && (
        <button onClick={() => setShowEnded((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-[12px] text-faint hover:text-ink">
          <ChevronRight className={cn('size-3.5 transition-transform', showEnded && 'rotate-90')} />
          kapanmış · {ended.length}
        </button>
      )}
      {ended.length > 0 && (showEnded || (!active.length && !idle.length)) && (
        <ul className="mt-2 overflow-hidden rounded-2xl bg-tray/60 ring-line">
          {ended.map((s) => (
            <SessionRow key={s.id} s={s} st="ended" now={now} activity={activity[s.id]} onOpen={() => onSession(s.id)} />
          ))}
        </ul>
      )}
      </>)}
    </section>
  );
}

// per-viewer UI memory (open/closed); storage can be unavailable, so it only ever helps
function useRemembered(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw === '1';
    } catch {
      return fallback;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {}
  };
  return [v, set];
}

function SessionCard({ s, st, now, waiting, onOpen }: { s: Session; st: SessionState; now: number; waiting: number; onOpen: () => void }) {
  const doing = nowDoing(s, st);
  const { subs, running } = runningCount(s);
  const tasks = Object.values(s.tasks);
  const done = tasks.filter((t) => t.status === 'completed').length;
  return (
    <button
      onClick={onOpen}
      className={cn(
        'enter block rounded-2xl bg-card p-4 text-left ring-line transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-raise/60',
        st === 'waiting' && 'attention',
        st === 'working' && 'shadow-[inset_0_0_0_1px_rgba(77,141,255,.3)]'
      )}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <span className={cn('size-2 rounded-full', STATE_DOT[st])} />
        <span className={cn('font-medium', st === 'waiting' ? 'text-alert' : 'text-run')}>{st === 'waiting' ? `${waiting} karar seni bekliyor` : STATE_LABEL[st]}</span>
        <span className="font-mono text-faint">#{s.id.slice(0, 4)}</span>
        <span className="ml-auto tabular-nums text-faint">{duration(now - s.startedAt)}</span>
      </div>
      <p className="mt-2.5 truncate font-mono text-[12.5px] text-ink" title={doing ?? undefined}>
        <span className="mr-1.5 font-sans text-[11.5px] text-faint">şu an</span>
        {doing || 'düşünüyor…'}
      </p>
      <div className="mt-3 flex items-center gap-3 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1">
          <Network className="size-3.5" />1
        </span>
        <span className="inline-flex items-center gap-1">
          <Bot className="size-3.5" />
          {subs}
          {running > 0 && <span className="text-run">({running} çalışıyor)</span>}
        </span>
        {tasks.length > 0 && (
          <span className="inline-flex min-w-0 flex-1 items-center gap-2">
            <span className="h-1 min-w-[40px] flex-1 overflow-hidden rounded-full bg-tile">
              <span className="block h-full rounded-full bg-ok" style={{ width: `${(done / tasks.length) * 100}%` }} />
            </span>
            <span className="shrink-0 tabular-nums">
              {done}/{tasks.length}
            </span>
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-ink">{usd(sessionCost(s))}</span>
      </div>
    </button>
  );
}

const lastWords = (items?: ActivityItem[]) => {
  const it = [...(items || [])].reverse().find((x) => x.kind === 'reply' || x.kind === 'board-reply' || x.kind === 'prompt' || x.kind === 'board-message');
  // plain text: markdown marks and pipes read as noise in a one-line preview
  return it ? String(it.summary || '').replace(/[*_`#>|]+/g, '').replace(/\s+/g, ' ').trim() : null;
};

function SessionRow({ s, st, now, activity, project, onOpen }: { s: Session; st: SessionState; now: number; activity?: ActivityItem[]; project?: string; onOpen: () => void }) {
  const last = lastWords(activity);
  return (
    <li className="border-t border-line first:border-t-0">
      <button onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-tile/60">
        <span className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[st])} />
        {project && <span className="shrink-0 text-[12.5px] font-medium text-ink">{project}</span>}
        <span className="shrink-0 font-mono text-[12px] text-ink">#{s.id.slice(0, 4)}</span>
        <span className="shrink-0 text-[12px] text-muted">
          {STATE_LABEL[st]} · {ago(s.lastEventAt, now)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">{last}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted">{usd(sessionCost(s))}</span>
      </button>
    </li>
  );
}

// a narrowed project shows all its work in one board (Project → Görevler → Agent'lar)
function ProjectBoard({ pr, requests, now, onSession }: Props & { pr: Project }) {
  const live = pr.sessions.filter((s) => !s.endedAt);
  const scope = live.length ? live : pr.sessions.slice(0, 1);
  const pending = requests.filter((r) => r.status === 'pending');
  const cards = flowCards(scope, pending);
  if (!cards.length) return null;
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-semibold text-ink">Projedeki işler</h2>
      <FlowBoard cards={cards} grouping="task" multiSession={scope.length > 1} now={now} onOpen={(sid) => onSession(sid)} />
    </section>
  );
}
