import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, FolderGit2, Radio } from 'lucide-react';
import { ActivityFeed } from './components/ActivityFeed';
import { AgentTree } from './components/AgentTree';
import { ApprovalInbox } from './components/ApprovalInbox';
import { BackgroundPanel, TaskPanel } from './components/SidePanels';
import { NumberTicker } from './components/affect/number-ticker';
import { SegmentedControl } from './components/affect/segmented-control';
import { cn, isLive, projectName, requestLabel, totals } from './lib';
import type { ApprovalRequest } from './types';
import { useAttention, useBoard, useNow } from './useBoard';

const paramSession = () => new URLSearchParams(location.search).get('session');
const MAX_TABS = 8;

export default function App() {
  const { sessions, activity, requests, connected, channelPids, decide, sendMessage } = useBoard();
  const [selected, setSelected] = useState<string | null>(paramSession);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [notifyPerm, setNotifyPerm] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const list = useMemo(() => Object.values(sessions).sort((a, b) => b.lastEventAt - a.lastEventAt), [sessions]);
  const live = list.filter(isLive);
  const allRequests = useMemo(() => Object.values(requests), [requests]);
  const pending = useMemo(() => allRequests.filter((r) => r.status === 'pending'), [allRequests]);

  // tabs: live sessions first (most recently active), then recent finished ones
  const tabs = [...live, ...list.filter((s) => !isLive(s))].slice(0, MAX_TABS);
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
    document.title = `${projectName(current.cwd)} · agent-board`;
  }, [current?.id]);

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
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <FolderGit2 className="size-4 shrink-0 text-muted" />
            <h1 className="truncate text-sm font-semibold">{current ? projectName(current.cwd) : 'agent-board'}</h1>
            <span className={cn('inline-flex items-center gap-1 text-[11px]', connected ? 'text-ok' : 'text-err')} title={connected ? 'canlı akış bağlı' : 'sunucuya bağlanılamıyor'}>
              <Radio className="size-3" />
              {connected ? 'canlı' : 'bağlantı yok'}
            </span>
            {current?.waiting === 'input' && !pendingBySession(current.id) && <span className="rounded-full bg-tile px-2 py-0.5 text-[11px] text-muted ring-line">yeni mesajını bekliyor</span>}
          </div>
          {t && (
            <div className="flex items-center gap-5 text-xs tabular-nums text-muted">
              <span>
                <b className="font-semibold text-ink">{t.agents}</b> agent · <b className={cn('font-semibold', t.running ? 'text-run' : 'text-ink')}>{t.running}</b> çalışıyor
              </span>
              <span className="inline-flex items-baseline gap-1.5" title="Abonelikle kullanıyorsan bu gerçek fatura değildir">
                <b className="text-sm font-semibold text-ink">
                  <NumberTicker value={Number(t.cost.toFixed(4))} format={{ style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 4 }} locale="en-US" />
                  {t.partial && '+'}
                </b>
                <span className="text-[10px] uppercase tracking-wider text-faint">api eşdeğeri</span>
              </span>
            </div>
          )}
          {notifyPerm === 'default' && (
            <button className="btn ml-auto inline-flex items-center gap-1.5 !h-7 !text-xs" onClick={() => Notification.requestPermission().then(setNotifyPerm)}>
              <Bell className="size-3.5" /> Bildirimleri aç
            </button>
          )}
        </div>
        <nav className="scroll-thin mx-auto max-w-[1500px] overflow-x-auto px-3 pb-1 pt-1">
          {tabs.length > 0 && (
            <SegmentedControl
              size="sm"
              variant="underline"
              kind="tabs"
              aria-label="Oturumlar"
              value={current?.id}
              onChange={(id) => setSelected(id)}
              options={tabs.map((s) => ({
                value: s.id,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', !isLive(s) ? 'bg-faint' : totals(s).running ? 'bg-run pulse-dot' : 'bg-ok')} />
                    {projectName(s.cwd)}
                    <span className="font-mono text-[10px] text-faint">{s.id.slice(0, 4)}</span>
                  </span>
                ),
                badge: pendingBySession(s.id) ? <span className="text-alert">{pendingBySession(s.id)} onay</span> : undefined,
              }))}
            />
          )}
        </nav>
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
            'scroll-thin flex min-w-0 flex-col gap-4 lg:sticky lg:top-[104px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto',
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
