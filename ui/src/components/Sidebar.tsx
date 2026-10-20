// Left menu: "Şimdi", then projects (collapsible, remembered) with their sessions.
// Busy projects sit on top and open; quiet and finished ones fold away at the bottom.
import { useState } from 'react';
import { ChevronRight, FolderGit2, LayoutDashboard } from 'lucide-react';
import { projectsOf, type Project } from '../flow';
import { ago, cn, sessionState, STATE_DOT, STATE_LABEL, type SessionState } from '../lib';
import type { Session } from '../types';

type Props = {
  sessions: Session[];
  waitingBySession: Record<string, number>;
  now: number;
  current: { session: string | null; project: string | null };
  onHome: () => void;
  onProject: (cwd: string) => void;
  onSession: (id: string) => void;
};

const STALE_MS = 6 * 3600 * 1000;
const ORDER: Record<SessionState, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };

export function useRemembered(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
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

export function Sidebar(p: Props) {
  const projects = projectsOf(p.sessions);
  const state = (s: Session) => sessionState(s, p.waitingBySession[s.id] || 0, p.now);
  const lively = (s: Session) => state(s) !== 'ended' && !(state(s) === 'idle' && p.now - s.lastEventAt > STALE_MS);
  const busy = (pr: Project) => pr.sessions.some((s) => state(s) === 'working' || state(s) === 'waiting');
  const active = projects.filter((pr) => pr.sessions.some(lively)).sort((a, b) => Number(busy(b)) - Number(busy(a)) || b.lastEventAt - a.lastEventAt);
  const quiet = projects.filter((pr) => !pr.sessions.some(lively));
  const [showQuiet, setShowQuiet] = useRemembered('ab:quiet-projects', false);
  const working = p.sessions.filter((s) => state(s) === 'working').length;
  const waiting = Object.values(p.waitingBySession).reduce((a, b) => a + b, 0);
  const home = !p.current.session && !p.current.project;

  return (
    <nav aria-label="Projeler" className="space-y-0.5 text-[13px]">
      <button onClick={p.onHome} className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors', home ? 'bg-tile text-ink ring-line' : 'text-muted hover:text-ink')}>
        <LayoutDashboard className="size-4 shrink-0" />
        <span className="flex-1 font-medium">Şimdi</span>
        {waiting > 0 ? <Badge tone="alert">{waiting}</Badge> : working > 0 ? <Badge tone="run">{working}</Badge> : null}
      </button>

      <p className="px-2 pb-1 pt-4 text-[12px] text-faint">Projeler</p>
      {active.map((pr) => (
        <ProjectItem key={pr.cwd} pr={pr} state={state} lively={lively} startOpen={busy(pr)} {...p} />
      ))}

      {quiet.length > 0 && (
        <>
          <button onClick={() => setShowQuiet(!showQuiet)} className="flex w-full items-center gap-1.5 px-2 pb-1 pt-4 text-left text-[12px] text-faint hover:text-ink">
            <ChevronRight className={cn('size-3.5 transition-transform', showQuiet && 'rotate-90')} />
            Sessiz ve kapanmış · {quiet.length}
          </button>
          {showQuiet && quiet.map((pr) => <ProjectItem key={pr.cwd} pr={pr} state={state} lively={() => true} startOpen={false} {...p} />)}
        </>
      )}
    </nav>
  );
}

function ProjectItem({ pr, state, lively, startOpen, current, waitingBySession, now, onProject, onSession }: Props & { pr: Project; state: (s: Session) => SessionState; lively: (s: Session) => boolean; startOpen: boolean }) {
  const [open, setOpen] = useRemembered(`ab:open:${pr.cwd}`, startOpen);
  const shown = pr.sessions.filter(lively).sort((a, b) => ORDER[state(a)] - ORDER[state(b)] || b.lastEventAt - a.lastEventAt);
  const rest = pr.sessions.length - shown.length;
  const [showRest, setShowRest] = useState(false);
  const waiting = pr.sessions.reduce((n, s) => n + (waitingBySession[s.id] || 0), 0);
  const working = pr.sessions.some((s) => state(s) === 'working');
  const selected = current.project === pr.cwd && !current.session;
  const list = showRest ? [...pr.sessions].sort((a, b) => ORDER[state(a)] - ORDER[state(b)] || b.lastEventAt - a.lastEventAt) : shown;

  return (
    <div>
      <div className={cn('group flex items-center rounded-lg transition-colors', selected ? 'bg-tile ring-line' : 'hover:bg-tile/50')}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Kapat' : 'Aç'} className="grid size-7 shrink-0 place-items-center text-faint hover:text-ink">
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        </button>
        <button onClick={() => onProject(pr.cwd)} title={pr.cwd} className={cn('flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left', selected ? 'text-ink' : 'text-text')}>
          <FolderGit2 className="size-3.5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-medium">{pr.name}</span>
          {waiting > 0 ? <Badge tone="alert">{waiting}</Badge> : working ? <span className="size-1.5 rounded-full bg-run pulse-dot" /> : null}
        </button>
      </div>
      {open && (
        <ul className="mb-1.5 ml-[13px] space-y-px border-l border-line pl-2">
          {list.map((s) => {
            const st = state(s);
            const on = current.session === s.id;
            return (
              <li key={s.id}>
                <button onClick={() => onSession(s.id)} className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors', on ? 'bg-tile text-ink' : 'text-muted hover:bg-tile/50 hover:text-ink')}>
                  <span className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[st])} />
                  <span className="font-mono text-[11px] text-ink">#{s.id.slice(0, 4)}</span>
                  <span className={cn('truncate', st === 'waiting' ? 'text-alert' : st === 'working' ? 'text-run' : '')}>{STATE_LABEL[st]}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-faint">{ago(s.lastEventAt, now)}</span>
                </button>
              </li>
            );
          })}
          {rest > 0 && (
            <li>
              <button onClick={() => setShowRest(!showRest)} className="px-2 py-0.5 text-[11px] text-faint hover:text-ink">
                {showRest ? 'gizle' : `+ ${rest} eski oturum`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'alert' | 'run'; children: React.ReactNode }) {
  return <span className={cn('rounded-full px-1.5 text-[11px] font-medium tabular-nums', tone === 'alert' ? 'bg-alert/15 text-alert' : 'bg-run/15 text-run')}>{children}</span>;
}
