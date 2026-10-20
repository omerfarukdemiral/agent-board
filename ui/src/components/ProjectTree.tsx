// Left rail: Project → Sessions, with live state, agent counts and how many things wait for the user.
import { Eye, FolderGit2 } from 'lucide-react';
import { ago, cn, isLive } from '../lib';
import type { Project } from '../flow';
import type { Session } from '../types';

type Props = {
  projects: Project[];
  current: string | null; // project cwd
  session: string | null; // null = live sessions, 'all' = every session, else one session
  waitingBySession: Record<string, number>;
  notesBySession: Record<string, number>;
  now: number;
  onProject: (cwd: string) => void;
  onSession: (cwd: string, id: string | null) => void;
};

const agentCounts = (s: Session) => {
  const subs = Object.values(s.agents).filter((a) => a.id !== 'main');
  return { subs: subs.length, running: subs.filter((a) => a.status === 'running').length + (s.agents.main?.status === 'running' ? 1 : 0) };
};

function stateOf(s: Session, waiting: number, notes: number) {
  if (waiting) return { dot: 'bg-alert pulse-dot', label: 'seni bekliyor' };
  if (!isLive(s)) return { dot: 'bg-faint', label: notes ? `bitti · ${notes} not` : 'bitti' };
  if (notes && !agentCounts(s).running) return { dot: 'bg-ok', label: `${notes} not` };
  if (agentCounts(s).running) return { dot: 'bg-run pulse-dot', label: 'çalışıyor' };
  return { dot: 'bg-ok', label: 'boşta' };
}

export function ProjectTree({ projects, current, session, waitingBySession, notesBySession, now, onProject, onSession }: Props) {
  return (
    <nav aria-label="Projeler" className="space-y-1">
      <p className="px-2 pb-1 text-[11.5px] text-faint">Projeler</p>
      {projects.map((p) => {
        const waiting = p.sessions.reduce((n, s) => n + (waitingBySession[s.id] || 0), 0);
        const notes = p.sessions.reduce((n, s) => n + (notesBySession[s.id] || 0), 0);
        const active = p.cwd === current;
        return (
          <div key={p.cwd}>
            <button
              onClick={() => onProject(p.cwd)}
              title={p.cwd}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors', active ? 'bg-tile text-ink ring-line' : 'text-muted hover:text-ink')}
            >
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {waiting > 0 && <span className="rounded-full bg-alert/15 px-1.5 text-[10.5px] font-medium text-alert">{waiting}</span>}
              {!waiting && notes > 0 && <span className="rounded-full bg-tile px-1.5 text-[10.5px] text-muted ring-line">{notes}</span>}
              {p.live > 0 && !waiting && !notes && <span className="size-1.5 rounded-full bg-ok" />}
            </button>
            {active && (
              <ul className="mb-2 ml-3.5 mt-1 space-y-0.5 border-l border-line pl-2">
                <li className="flex gap-1">
                  <button
                    onClick={() => onSession(p.cwd, null)}
                    className={cn('flex-1 rounded-md px-2 py-1 text-left text-[12px]', session === null ? 'bg-tile text-ink' : 'text-faint hover:text-ink')}
                  >
                    {p.live ? `Canlı · ${p.live}` : 'Son oturum'}
                  </button>
                  <button
                    onClick={() => onSession(p.cwd, 'all')}
                    className={cn('flex-1 rounded-md px-2 py-1 text-left text-[12px]', session === 'all' ? 'bg-tile text-ink' : 'text-faint hover:text-ink')}
                  >
                    Tümü · {p.sessions.length}
                  </button>
                </li>
                {p.sessions.map((s) => {
                  const w = waitingBySession[s.id] || 0;
                  const st = stateOf(s, w, notesBySession[s.id] || 0);
                  const c = agentCounts(s);
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => onSession(p.cwd, s.id)}
                        className={cn('w-full rounded-md px-2 py-1 text-left', session === s.id ? 'bg-tile' : 'hover:bg-tile/60')}
                      >
                        <span className="flex items-center gap-1.5 text-[12px] text-ink">
                          <span className={cn('size-1.5 shrink-0 rounded-full', st.dot)} />
                          <span className="font-mono text-[11px]">#{s.id.slice(0, 4)}</span>
                          {s.via === 'transcript' && (
                            <span title="Transcript'ten izleniyor: onay ve mesaj için claude-board ile aç">
                              <Eye className="size-3 shrink-0 text-faint" />
                            </span>
                          )}
                          <span className={cn('truncate', w ? 'text-alert' : 'text-muted')}>{st.label}</span>
                          <span className="ml-auto shrink-0 text-[10.5px] text-faint">{ago(s.lastEventAt, now)}</span>
                        </span>
                        <span className="block pl-3 text-[11px] text-faint">
                          1 orkestratör{c.subs ? ` + ${c.subs} subagent` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
