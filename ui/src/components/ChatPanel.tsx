// Chat dock: the conversation with one session (no tool noise), always one glance away.
// Shows the user's prompts and board messages, Claude's board replies and turn wrap-ups.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, MessageSquare, Radio, User } from 'lucide-react';
import { cn, isLive } from '../lib';
import type { ActivityItem, Session } from '../types';
import { Md } from './Md';

type Props = {
  sessions: Session[]; // candidates, most relevant first
  sessionId: string | null;
  onSession: (id: string) => void;
  activity: Record<string, ActivityItem[]>;
  channelPids: number[];
  onSend: (sessionId: string, text: string) => Promise<boolean>;
  className?: string;
};

const CHAT_KINDS = new Set(['prompt', 'board-message', 'board-reply', 'reply']);

export function ChatPanel({ sessions, sessionId, onSession, activity, channelPids, onSend, className }: Props) {
  const session = sessions.find((s) => s.id === sessionId) || sessions[0] || null;
  const items = useMemo(() => {
    const list = (session ? activity[session.id] || [] : []).filter((i) => CHAT_KINDS.has(i.kind)).sort((a, b) => a.ts - b.ts);
    // a turn answered on the board already says it; skip the terminal wrap-up that repeats it
    const out: ActivityItem[] = [];
    let answered = false;
    for (const it of list) {
      if (it.kind === 'prompt' || it.kind === 'board-message') answered = false;
      if (it.kind === 'board-reply') answered = true;
      if (it.kind === 'reply' && answered) continue;
      out.push(it);
    }
    return out.slice(-80);
  }, [session, activity]);

  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, session?.id]);

  const live = !!session && isLive(session);
  const channel = live && !!session?.pid && channelPids.includes(session.pid);
  const watchOnly = session?.via === 'transcript';
  const hint = !session
    ? 'Oturum yok.'
    : !live
      ? 'Bu oturum kapandı.'
      : watchOnly
        ? 'Bu oturum yalnızca izleniyor. Buradan yazmak için terminalde kapatıp claude-board ile devam ettir.'
        : !channel
          ? 'Bu oturum kanalsız açıldı; yazmak için claude-board ile başlat.'
          : null;

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-tray ring-line', className)}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <MessageSquare className="size-4 text-muted" />
        <span className="text-[13px] font-medium text-ink">Sohbet</span>
        {sessions.length > 1 && (
          <label className="relative ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted ring-line hover:text-ink">
            <span className={cn('size-1.5 rounded-full', live ? (channel ? 'bg-ok' : 'bg-faint') : 'bg-faint')} />
            <span className="font-mono">#{session?.id.slice(0, 4)}</span>
            <ChevronDown className="size-3.5" />
            <select className="absolute inset-0 cursor-pointer opacity-0" value={session?.id} onChange={(e) => onSession(e.target.value)} aria-label="Sohbet edilecek oturum">
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id.slice(0, 4)} · {isLive(s) ? 'canlı' : 'bitti'}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {items.length === 0 && <p className="py-6 text-center text-[12.5px] text-faint">Bu oturumda henüz konuşma yok.</p>}
        {items.map((it) => (
          <Bubble key={it.id} it={it} />
        ))}
      </div>

      {watchOnly && live && <ResumeHint id={session!.id} />}
      <Composer key={session?.id} disabled={!channel} hint={hint} onSend={(t) => (session ? onSend(session.id, t) : Promise.resolve(false))} />
    </section>
  );
}

function ResumeHint({ id }: { id: string }) {
  const cmd = `claude-board --resume ${id}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-2 mt-2 flex items-center gap-2 rounded-lg bg-tile px-2.5 py-1.5 ring-line">
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text">{cmd}</code>
      <button
        className="shrink-0 text-[11px] text-muted hover:text-ink"
        onClick={() => navigator.clipboard?.writeText(cmd).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
      >
        {copied ? 'Kopyalandı' : 'Kopyala'}
      </button>
    </div>
  );
}

function Bubble({ it }: { it: ActivityItem }) {
  const mine = it.kind === 'prompt' || it.kind === 'board-message';
  const text = String(it.summary || '');
  return (
    <div className={cn('enter flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-5 [overflow-wrap:anywhere]',
          mine ? 'rounded-br-md bg-run/15 text-ink shadow-[inset_0_0_0_1px_rgba(77,141,255,.25)]' : 'rounded-bl-md bg-card text-text ring-line'
        )}
      >
        <div className={cn('mb-0.5 flex items-center gap-1 text-[10.5px]', mine ? 'text-run' : 'text-faint')}>
          {it.kind === 'board-message' ? <Radio className="size-3" /> : mine ? <User className="size-3" /> : <Bot className="size-3" />}
          {it.kind === 'board-message' ? 'sen · board' : it.kind === 'prompt' ? 'sen · terminal' : it.kind === 'board-reply' ? 'Claude' : 'Claude · terminal'}
        </div>
        {mine ? <span className="whitespace-pre-wrap">{text}</span> : <Md text={text} />}
      </div>
    </div>
  );
}

function Composer({ disabled, hint, onSend }: { disabled: boolean; hint: string | null; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submit = async () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    setError(false);
    const ok = await onSend(t);
    setBusy(false);
    if (ok) setText('');
    else setError(true);
  };
  return (
    <div className="border-t border-line p-2">
      <div className="flex items-end gap-2 rounded-xl bg-card p-1.5 ring-line focus-within:shadow-[inset_0_0_0_1px_rgba(255,255,255,.22)]">
        <textarea
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          placeholder={disabled ? 'Mesaj gönderilemiyor' : "Claude'a yaz…"}
          className="scroll-thin max-h-32 min-h-[34px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button className="btn btn-primary grid !size-8 shrink-0 place-items-center !p-0" disabled={disabled || busy || !text.trim()} onClick={submit} aria-label="Gönder">
          <ArrowUp className="size-4" />
        </button>
      </div>
      <p className={cn('px-1.5 pt-1 text-[11px]', error ? 'text-err' : 'text-faint')}>{error ? 'Gönderilemedi: oturumun kanalı kopmuş olabilir.' : hint || 'Enter gönderir · Shift+Enter yeni satır'}</p>
    </div>
  );
}
