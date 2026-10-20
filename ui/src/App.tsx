// Left menu (projects → sessions) next to one main area: Şimdi, a project, or a session.
// The URL carries where you are (?s=<session> or ?p=<project>), so back/forward and links work.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Menu, Moon, Network, Sun, X } from 'lucide-react';
import { requestLabel, cn, projectName } from './lib';
import type { ApprovalRequest } from './types';
import { useAttention, useBoard, useNow } from './useBoard';
import { Sidebar } from './components/Sidebar';
import { Home } from './views/Home';
import { SessionPage } from './views/SessionPage';

type Route = { session: string | null; project: string | null };

function readRoute(): Route {
  const q = new URLSearchParams(location.search);
  // older links used ?session= / ?project=
  const session = q.get('s') || q.get('session');
  return { session: session && session !== 'all' ? session : null, project: q.get('p') || (session ? null : q.get('project')) };
}

export default function App() {
  const { sessions, activity, requests, connected, channelPids, decide, sendMessage, ackInbox } = useBoard();
  const [route, setRoute] = useState<Route>(readRoute);
  const [menuOpen, setMenuOpen] = useState(false); // phones: the menu is a drawer
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('ab:theme', dark ? 'dark' : 'light');
    } catch {}
  }, [dark]);
  const [notifyPerm, setNotifyPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const go = useCallback((next: Route) => {
    const url = new URL(location.href);
    url.search = '';
    if (next.session) url.searchParams.set('s', next.session);
    else if (next.project) url.searchParams.set('p', next.project);
    history.pushState(null, '', url);
    setRoute(next);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const all = useMemo(() => Object.values(sessions), [sessions]);
  const allRequests = useMemo(() => Object.values(requests), [requests]);
  const pending = useMemo(() => allRequests.filter((r) => r.status === 'pending'), [allRequests]);
  const waitingBySession = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) m[r.sessionId] = (m[r.sessionId] || 0) + 1;
    for (const s of all) for (const it of Object.values(s.inbox || {})) if (it.status === 'unread' && it.kind !== 'info') m[s.id] = (m[s.id] || 0) + 1;
    return m;
  }, [pending, all]);
  const waitingTotal = Object.values(waitingBySession).reduce((a, b) => a + b, 0);
  const now = useNow(true);

  const session = route.session ? sessions[route.session] : null;
  useEffect(() => {
    const where = session ? `${projectName(session.cwd)} #${session.id.slice(0, 4)}` : route.project ? projectName(route.project) : 'Şimdi';
    document.title = `${waitingTotal ? `(${waitingTotal}) ` : ''}${where} · agent-board`;
  }, [session?.id, route.project, waitingTotal]);

  const label = useCallback((r: ApprovalRequest) => requestLabel(r), []);
  useAttention(pending, label);

  const home = () => go({ session: null, project: null });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-page/85 backdrop-blur-md">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button onClick={() => setMenuOpen((v) => !v)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink lg:hidden" aria-label="Menü">
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <button onClick={home} className="inline-flex shrink-0 items-center gap-2 text-[13px] font-semibold text-ink">
            <span className="grid size-6 place-items-center rounded-md bg-ink text-card">
              <Network className="size-3.5" />
            </span>
            agent-board
          </button>
          <span className="ml-auto" />
          {waitingTotal > 0 && (
            <button onClick={home} className="shrink-0 rounded-full bg-alert/15 px-2.5 py-0.5 text-[12px] font-medium text-alert hover:bg-alert/25">
              {waitingTotal} konu seni bekliyor
            </button>
          )}
          <span className={cn('size-2 shrink-0 rounded-full', connected ? 'bg-ok' : 'bg-err pulse-dot')} title={connected ? 'canlı akış bağlı' : 'sunucuya bağlanılamıyor'} />
          <button className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" onClick={() => setDark((v) => !v)} title={dark ? 'Açık tema' : 'Koyu tema'} aria-label={dark ? 'Açık tema' : 'Koyu tema'}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          {notifyPerm === 'default' && (
            <button className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" onClick={() => Notification.requestPermission().then(setNotifyPerm)} title="Karar beklenince masaüstü bildirimi gönder">
              <Bell className="size-4" />
            </button>
          )}
        </div>
      </header>

      <div className="grid lg:grid-cols-[256px_minmax(0,1fr)]">
        <aside
          className={cn(
            'scroll-thin border-line bg-page lg:sticky lg:top-[49px] lg:block lg:h-[calc(100vh-49px)] lg:overflow-y-auto lg:border-r',
            menuOpen ? 'fixed inset-x-0 bottom-0 top-[49px] z-20 block overflow-y-auto' : 'hidden'
          )}
        >
          <div className="p-3">
            <Sidebar
              sessions={all}
              waitingBySession={waitingBySession}
              now={now}
              current={route}
              onHome={home}
              onProject={(cwd) => go({ session: null, project: cwd })}
              onSession={(id) => go({ session: id, project: null })}
            />
          </div>
        </aside>
        <div className="min-w-0 px-4 py-5 lg:px-6">
      {session ? (
          <SessionPage
            session={session}
            requests={allRequests}
            activity={activity}
            waiting={waitingBySession[session.id] || 0}
            channelPids={channelPids}
            now={now}
            onHome={home}
            onProject={(cwd) => go({ session: null, project: cwd })}
            onSession={(id) => go({ session: id, project: null })}
            onDecide={decide}
            onAck={ackInbox}
            onSend={sendMessage}
          />
        ) : (
          <Home
            sessions={all}
            requests={allRequests}
            activity={activity}
            waitingBySession={waitingBySession}
            channelPids={channelPids}
            now={now}
            project={route.project}
            onSession={(id) => go({ session: id, project: null })}
            onDecide={decide}
            onAck={ackInbox}
            onReply={sendMessage}
          />
        )}
          </div>
      </div>
    </div>
  );
}
