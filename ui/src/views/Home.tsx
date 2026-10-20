// Main area when no session is open.
// Şimdi: what waits for you, what is working, what moved last. Project: its sessions and task board.
// The left menu lists every project, so these pages don't repeat it.
import { useMemo, useState } from 'react';
import { Bot, ChevronRight, Network } from 'lucide-react';
import { FlowBoard } from '../components/FlowBoard';
import { ProjectInbox } from '../components/ProjectInbox';
import { flowCards } from '../flow';
import { ago, cn, duration, nowDoing, projectName, runningCount, sessionCost, sessionState, STATE_DOT, STATE_LABEL, usd, type SessionState } from '../lib';
import type { ActivityItem, ApprovalRequest, Decision, Session } from '../types';

type Props = {
  sessions: Session[];
  requests: ApprovalRequest[];
  activity: Record<string, ActivityItem[]>;
  waitingBySession: Record<string, number>;
  channelPids: number[];
  now: number;
  project: string | null;
  onSession: (id: string) => void;
  onDecide: (id: string, d: Decision) => Promise<boolean>;
  onAck: (sessionId: string, id: string, status?: 'read' | 'answered') => Promise<boolean>;
  onReply: (sessionId: string, text: string) => Promise<boolean>;
};

const ORDER: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };
const RECENT = 8;

export function Home(p: Props) {
  const [showEnded, setShowEnded] = useState(false);
  const state = (s: Session) => sessionState(s, p.waitingBySession[s.id] || 0, p.now);
  const scope = useMemo(() => (p.project ? p.sessions.filter((s) => s.cwd === p.project) : p.sessions), [p.sessions, p.project]);
  const ids = new Set(scope.map((s) => s.id));
  const sorted = [...scope].sort((a, b) => ORDER[state(a)] - ORDER[state(b)] || b.lastEventAt - a.lastEventAt);
  const busy = sorted.filter((s) => state(s) === 'working' || state(s) === 'waiting');
  const idle = sorted.filter((s) => state(s) === 'idle');
  const ended = sorted.filter((s) => state(s) === 'ended');
  const attention = p.requests.some((r) => r.status === 'pending' && ids.has(r.sessionId)) || scope.some((s) => Object.values(s.inbox || {}).some((i) => i.status === 'unread'));
  const counts = { working: busy.filter((s) => state(s) === 'working').length, waiting: busy.filter((s) => state(s) === 'waiting').length, idle: idle.length };
  const multiProject = !p.project;

  return (
    <div className={cn('grid gap-6', attention && 'xl:grid-cols-[minmax(0,1fr)_380px]')}>
      <div className="min-w-0 space-y-7">
        <header>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink" title={p.project ?? undefined}>
            {p.project ? projectName(p.project) : 'Şimdi'}
          </h1>
          <p className="mt-1 text-[13.5px] text-muted">
            {counts.waiting > 0 && <span className="text-alert">{counts.waiting} oturum seni bekliyor · </span>}
            {counts.working} oturum çalışıyor · {counts.idle} oturum boşta
            {!attention && <span className="text-faint"> · bekleyen karar yok</span>}
          </p>
        </header>

        <section>
          <h2 className="mb-2.5 text-[13px] font-medium text-muted">Çalışanlar</h2>
          {busy.length ? (
            <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
              {busy.map((s) => (
                <SessionCard key={s.id} s={s} st={state(s)} now={p.now} waiting={p.waitingBySession[s.id] || 0} project={multiProject ? projectName(s.cwd) : undefined} onOpen={() => p.onSession(s.id)} />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-tray px-4 py-3.5 text-[13px] text-faint ring-line">Şu an çalışan oturum yok.</p>
          )}
        </section>

        {idle.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-[13px] font-medium text-muted">{multiProject ? 'Son hareket edenler' : 'Boştaki oturumlar'}</h2>
            <ul className="overflow-hidden rounded-2xl bg-tray ring-line">
              {(multiProject ? idle.slice(0, RECENT) : idle).map((s) => (
                <SessionRow key={s.id} s={s} st="idle" now={p.now} activity={p.activity[s.id]} project={multiProject ? projectName(s.cwd) : undefined} onOpen={() => p.onSession(s.id)} />
              ))}
            </ul>
          </section>
        )}

        {p.project && <ProjectBoard scope={scope} {...p} />}

        {p.project && ended.length > 0 && (
          <section>
            <button onClick={() => setShowEnded((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
              <ChevronRight className={cn('size-4 transition-transform', showEnded && 'rotate-90')} />
              Kapanmış oturumlar · {ended.length}
            </button>
            {showEnded && (
              <ul className="mt-2.5 overflow-hidden rounded-2xl bg-tray/60 ring-line">
                {ended.map((s) => (
                  <SessionRow key={s.id} s={s} st="ended" now={p.now} activity={p.activity[s.id]} onOpen={() => p.onSession(s.id)} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      {attention && (
        <aside className="scroll-thin order-first min-w-0 xl:sticky xl:top-[72px] xl:order-none xl:max-h-[calc(100vh-92px)] xl:overflow-y-auto">
          <ProjectInbox
            sessions={scope}
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

function SessionCard({ s, st, now, waiting, project, onOpen }: { s: Session; st: SessionState; now: number; waiting: number; project?: string; onOpen: () => void }) {
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
        {project && <span className="truncate font-medium text-ink">{project}</span>}
        <span className="font-mono text-faint">#{s.id.slice(0, 4)}</span>
        <span className="ml-auto tabular-nums text-faint">{duration(now - s.startedAt)}</span>
      </div>
      <p className={cn('mt-1 text-[12px] font-medium', st === 'waiting' ? 'text-alert' : 'text-run')}>{st === 'waiting' ? `${waiting} karar seni bekliyor` : STATE_LABEL[st]}</p>
      <p className="mt-2 truncate font-mono text-[12.5px] text-ink" title={doing ?? undefined}>
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
        {project && <span className="max-w-[160px] shrink-0 truncate text-[12.5px] font-medium text-ink">{project}</span>}
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

// a project shows all its work in one board (Proje → Görevler → Agent'lar)
function ProjectBoard({ scope, requests, now, onSession }: Props & { scope: Session[] }) {
  const live = scope.filter((s) => !s.endedAt);
  const sessions = live.length ? live : scope.slice(0, 1);
  const cards = flowCards(sessions, requests.filter((r) => r.status === 'pending'));
  if (!cards.length) return null;
  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-medium text-muted">Projedeki işler</h2>
      <FlowBoard cards={cards} grouping="task" multiSession={sessions.length > 1} now={now} onOpen={(sid) => onSession(sid)} />
    </section>
  );
}
