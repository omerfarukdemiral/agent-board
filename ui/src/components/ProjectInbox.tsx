// Project inbox: everything that needs the user, in one place.
// Live decisions (permission requests, questions) on top, then what Claude flagged with its inbox tool:
// decisions it made that may be overridden, work waiting for review, and things worth knowing.
import { useState } from 'react';
import { AlertTriangle, CircleCheck, Info, MessageSquareReply, ScanEye, Scale } from 'lucide-react';
import { agentName, ago, cn } from '../lib';
import type { ApprovalRequest, Decision, InboxItem, Session } from '../types';
import { RecentList, RequestCard } from './ApprovalInbox';
import { Md } from './Md';

type Props = {
  sessions: Session[];
  requests: ApprovalRequest[];
  now: number;
  channelPids: number[];
  multiSession: boolean;
  onDecide: (id: string, d: Decision) => Promise<boolean>;
  onAck: (sessionId: string, id: string, status?: 'read' | 'answered') => Promise<boolean>;
  onReply: (sessionId: string, text: string) => Promise<boolean>;
  onOpenSession: (id: string) => void;
};

const KIND = {
  decision: { label: 'Karar', icon: Scale, cls: 'text-alert bg-alert/12' },
  review: { label: 'Review', icon: ScanEye, cls: 'text-run bg-run/12' },
  info: { label: 'Bilgi', icon: Info, cls: 'text-muted bg-tile' },
} as const;

export type Entry = { item: InboxItem; session: Session };

export function ProjectInbox({ sessions, requests, now, channelPids, multiSession, onDecide, onAck, onReply, onOpenSession }: Props) {
  const [showRead, setShowRead] = useState(false);
  const bySession = Object.fromEntries(sessions.map((s) => [s.id, s]));
  const pending = requests.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const recentDecisions = requests
    .filter((r) => r.status !== 'pending')
    .sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0))
    .slice(0, 6);
  const entries: Entry[] = sessions.flatMap((s) => Object.values(s.inbox || {}).map((item) => ({ item, session: s })));
  const unread = entries.filter((e) => e.item.status === 'unread').sort((a, b) => b.item.createdAt - a.item.createdAt);
  const read = entries.filter((e) => e.item.status !== 'unread').sort((a, b) => (b.item.readAt || 0) - (a.item.readAt || 0));
  const blocking = pending.length + unread.filter((e) => e.item.kind !== 'info').length;
  const notes = unread.length - unread.filter((e) => e.item.kind !== 'info').length;
  const open = pending.length + unread.length;

  return (
    <section className={cn('rounded-[22px] bg-tray ring-line', open ? 'p-1.5' : 'px-1.5 py-0.5')}>
      <header className={cn('flex items-center gap-2 px-3 text-sm font-medium', open ? 'pb-2 pt-2' : 'py-2', blocking ? 'text-alert' : 'text-muted')} aria-live="polite" title={open ? undefined : 'Claude izin istediğinde, bir kararı sana bıraktığında ya da okuman gereken bir şey olduğunda burada belirir.'}>
        {blocking ? <AlertTriangle className="size-4" /> : notes ? <Info className="size-4" /> : <CircleCheck className="size-4 text-ok" />}
        Inbox
        <span className="font-normal">
          {blocking ? `· ${blocking} konu seni bekliyor` : ''}
          {notes ? `${blocking ? ',' : '·'} ${notes} okunacak not` : ''}
          {!blocking && !notes ? '· bekleyen konu yok' : ''}
        </span>
      </header>

      {pending.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-2xl bg-card ring-line">
          {pending.map((r, i) => (
            <RequestCard key={r.id} r={r} session={bySession[r.sessionId]} now={now} first={i === 0} onDecide={onDecide} onOpenSession={onOpenSession} />
          ))}
        </div>
      )}

      {unread.length > 0 && (
        <div className="space-y-1.5">
          {unread.map((e) => (
            <ItemCard
              key={e.item.id}
              e={e}
              now={now}
              multiSession={multiSession}
              canReply={!!e.session.pid && channelPids.includes(e.session.pid) && !e.session.endedAt}
              onAck={onAck}
              onReply={onReply}
            />
          ))}
        </div>
      )}


      {(read.length > 0 || recentDecisions.length > 0) && (
        <div className="px-3 pb-1.5 pt-1">
          <button className="text-[11.5px] text-faint hover:text-ink" onClick={() => setShowRead((v) => !v)}>
            {showRead ? 'Geçmişi gizle' : `Geçmiş · ${read.length + recentDecisions.length}`}
          </button>
          {showRead && (
            <div className="mt-1">
              {read.map((e) => (
                <div key={e.item.id} className="flex items-center gap-2 py-1 text-xs text-faint">
                  <KindChip kind={e.item.kind} small />
                  <span className="truncate text-muted">{e.item.title}</span>
                  <span className="ml-auto shrink-0">{e.item.status === 'answered' ? 'cevaplandı' : 'okundu'}</span>
                </div>
              ))}
              <RecentList recent={recentDecisions} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function KindChip({ kind, small }: { kind: InboxItem['kind']; small?: boolean }) {
  const k = KIND[kind] ?? KIND.info;
  const Icon = k.icon;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-md font-medium', small ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-[11px]', k.cls)}>
      <Icon className={small ? 'size-3' : 'size-3.5'} />
      {k.label}
    </span>
  );
}

export function ItemCard({ e, now, multiSession, canReply, onAck, onReply }: { e: Entry; now: number; multiSession: boolean; canReply: boolean } & Pick<Props, 'onAck' | 'onReply'>) {
  const { item, session } = e;
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const long = (item.body || '').length > 280;
  const [expanded, setExpanded] = useState(!long);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await onReply(session.id, `Inbox "${item.title}"${item.taskId ? ` (#${item.taskId})` : ''} hakkında: ${text.trim()}`);
    if (ok) await onAck(session.id, item.id, 'answered');
    setBusy(false);
  };

  return (
    <article className={cn('enter rounded-2xl bg-card px-3.5 py-3 ring-line', item.kind === 'decision' && 'shadow-[inset_0_0_0_1px_rgba(251,138,60,.35)]')}>
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <KindChip kind={item.kind} />
        <span className="truncate">{agentName(session, item.agentId)}</span>
        {item.taskId && <span className="font-mono">#{item.taskId}</span>}
        {multiSession && <span className="font-mono">#{session.id.slice(0, 4)}</span>}
        <span className="ml-auto shrink-0">{ago(item.createdAt, now)}</span>
      </div>
      <h4 className="mt-1.5 text-[13.5px] font-medium leading-5 text-ink">{item.title}</h4>
      {item.body && (
        <div className={cn('mt-1 text-[12.5px] leading-[19px] text-text', !expanded && 'line-clamp-4')}>
          <Md text={item.body} />
        </div>
      )}
      {long && (
        <button className="mt-1 text-[11.5px] text-faint hover:text-ink" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Daralt' : 'Devamını oku'}
        </button>
      )}
      {replying ? (
        <div className="mt-2.5 space-y-2">
          <textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            placeholder="Claude'a cevabın…"
            className="w-full resize-none rounded-lg bg-tile px-2.5 py-2 text-[13px] text-ink placeholder:text-faint ring-line focus:outline-none"
          />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={send}>
              Gönder
            </button>
            <button className="btn" onClick={() => setReplying(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button className="btn" onClick={() => onAck(session.id, item.id)}>
            Okudum
          </button>
          <button
            className="btn inline-flex items-center gap-1.5"
            disabled={!canReply}
            title={canReply ? undefined : 'Bu oturum kanalsız ya da kapalı; cevap gönderilemez'}
            onClick={() => setReplying(true)}
          >
            <MessageSquareReply className="size-3.5" />
            Cevapla
          </button>
        </div>
      )}
    </article>
  );
}
