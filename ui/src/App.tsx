import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, History } from 'lucide-react';
import { ActivityFeed } from './components/ActivityFeed';
import { AgentTree } from './components/AgentTree';
import { ApprovalInbox } from './components/ApprovalInbox';
import { BackgroundPanel, TaskPanel } from './components/SidePanels';
import { NumberTicker } from './components/affect/number-ticker';
import { ago, cn, isLive, projectName, requestLabel, totals } from './lib';
import type { ApprovalRequest, Session } from './types';
import { useAttention, useBoard, useNow } from './useBoard';

const paramSession = () => new URLSearchParams(location.search).get('session');

export default function App() {
  const { sessions, activity, requests, connected, channelPids, decide, sendMessage } = useBoard();
  const [selected, setSelected] = useState<string | null>(paramSession);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [notifyPerm, setNotifyPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const list = useMemo(() => Object.values(sessions).sort((a, b) => b.lastEventAt - a.lastEventAt), [sessions]);
  const live = list.filter(isLive);
  const allRequests = useMemo(() => Object.values(requests), [requests]);
  const pending = useMemo(() => allRequests.filter((r) => r.status === 'pending'), [allRequests]);

  const ended = list.filter((s) => !isLive(s));
  // without an explicit choice, follow the most recently active live session
  const current = (selected && sessions[selected]) || live[0] || list[0] || null;

  useEffect(() => setAgentFilter(null), [current?.id]);
  useEffect(() => {
    if (!current) return;
    const url = new URL(location.href);
    if (url.searchParams.get('session') !== current.id) {
      url.searchParams.set('session', current.id);
      history.replaceState(null, '', url);
    }
  }, [current?.id]);
  // one place owns the tab title: pending count first, then the project
  useEffect(() => {
    const name = current ? `${projectName(current.cwd)} · agent-board` : 'agent-board';
    document.title = pending.length ? `(${pending.length}) ${name}` : name;
  }, [current?.id, pending.length]);

  const label = useCallback((r: ApprovalRequest) => requestLabel(r), []);
  useAttention(pending, label);

  const t = current ? totals(current) : null;
  const now = useNow((t?.running ?? 0) > 0 || pending.length > 0);
  const waitingBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pending) if (r.sessionId === current?.id) m[r.agentId] = (m[r.agentId] || 0) + 1;
    return m;
  }, [pending, current?.id]);
  const pendingBySession = (id: string) => pending.filter((r) => r.sessionId === id).length;

  return (
    <div className="dark min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-2">
          <nav className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Oturumlar">
            {live.map((s) => (
              <SessionTab key={s.id} s={s} active={s.id === current?.id} pending={pendingBySession(s.id)} showId={live.filter((x) => x.cwd === s.cwd).length > 1} onClick={() => setSelected(s.id)} />
            ))}
            {current && !isLive(current) && <SessionTab s={current} active pending={0} showId onClick={() => {}} />}
            {ended.length > 0 && (
              <label className="relative ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-faint hover:text-ink">
                <History className="size-3.5" />
                Geçmiş
                <select
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value=""
                  onChange={(e) => e.target.value && setSelected(e.target.value)}
                  aria-label="Biten oturumlar"
                >
                  <option value="">Biten oturumlar</option>
                  {ended.map((s) => (
                    <option key={s.id} value={s.id}>
                      {projectName(s.cwd)} · {s.id.slice(0, 4)} · {ago(s.endedAt || s.lastEventAt, Date.now())}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </nav>

          {t && (
            <div className="flex shrink-0 items-center gap-4 text-xs tabular-nums text-muted">
              <span className="hidden sm:inline">
                <b className="font-semibold text-ink">{t.agents}</b> agent
                {t.running > 0 && (
                  <>
                    {' · '}
                    <b className="font-semibold text-run">{t.running}</b> çalışıyor
                  </>
                )}
              </span>
              <span className="inline-flex items-baseline gap-1" title="API eşdeğeri maliyet. Abonelikle kullanıyorsan bu gerçek fatura değildir.">
                <b className="text-sm font-semibold text-ink">
                  <NumberTicker value={Number(t.cost.toFixed(4))} format={{ style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 }} locale="en-US" />
                  {t.partial && '+'}
                </b>
              </span>
            </div>
          )}
          <span className={cn('size-2 shrink-0 rounded-full', connected ? 'bg-ok' : 'bg-err pulse-dot')} title={connected ? 'canlı akış bağlı' : 'sunucuya bağlanılamıyor'} />
          {notifyPerm === 'default' && (
            <button className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-tile hover:text-ink" onClick={() => Notification.requestPermission().then(setNotifyPerm)} title="Karar beklenince masaüstü bildirimi gönder">
              <Bell className="size-4" />
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {current ? (
          <div className="flex min-w-0 flex-col gap-4">
            <AgentTree session={current} now={now} waitingBy={waitingBy} selected={agentFilter} onSelect={setAgentFilter} />
            <div className="flex h-[min(70vh,760px)] flex-col">
              <ActivityFeed
                session={current}
                items={activity[current.id] || []}
                filter={agentFilter}
                onFilter={setAgentFilter}
                channel={!!current.pid && channelPids.includes(current.pid)}
                onSend={(text) => sendMessage(current.id, text)}
              />
            </div>
          </div>
        ) : (
          <div className="grid place-items-center rounded-[22px] bg-tray px-4 py-24 text-center ring-line">
            <div>
              <p className="text-sm font-medium">Henüz oturum yok</p>
              <p className="mt-2 text-xs text-muted">
                agent-board kurulu bir projede <code className="font-mono text-ink">claude</code> başlat. Kartlar burada canlı belirecek.
              </p>
            </div>
          </div>
        )}

        {/* on phones the inbox jumps above the tree while a decision is pending */}
        <aside
          className={cn(
            'scroll-thin flex min-w-0 flex-col gap-4 lg:sticky lg:top-[64px] lg:max-h-[calc(100vh-80px)] lg:overflow-y-auto',
            pending.length > 0 && 'order-first lg:order-none'
          )}
        >
          <ApprovalInbox requests={allRequests} sessions={sessions} now={now} onDecide={decide} onOpenSession={setSelected} />
          {current && <TaskPanel session={current} />}
          {current && <BackgroundPanel session={current} />}
        </aside>
      </main>
    </div>
  );
}

function SessionTab({ s, active, pending, showId, onClick }: { s: Session; active: boolean; pending: number; showId: boolean; onClick: () => void }) {
  const running = totals(s).running > 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] transition-colors',
        active ? 'bg-tile font-medium text-ink ring-line' : 'text-muted hover:text-ink'
      )}
      title={s.cwd}
    >
      <span className={cn('size-1.5 rounded-full', !isLive(s) ? 'bg-faint' : pending ? 'bg-alert pulse-dot' : running ? 'bg-run pulse-dot' : 'bg-ok')} />
      {projectName(s.cwd)}
      {showId && <span className="font-mono text-[10px] text-faint">{s.id.slice(0, 4)}</span>}
      {!isLive(s) && <span className="text-[10px] text-faint">bitti</span>}
      {pending > 0 && <span className="rounded-full bg-alert/15 px-1.5 text-[10.5px] font-medium text-alert">{pending}</span>}
    </button>
  );
}
