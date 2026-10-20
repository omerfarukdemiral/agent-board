// Live activity: prompts, replies, subagent spawns and tool calls (affectUI ToolCallCard/ToolCallGroup, free/MIT).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, MessageSquare, Radio, ShieldQuestion, Terminal, User, X } from 'lucide-react';
import { agentName, cn } from '../lib';
import type { ActivityItem, Session } from '../types';
import { ToolCallCard, ToolCallGroup } from './affect/tool-call-card';
import { SegmentedControl } from './affect/segmented-control';

type Block = { key: string; kind: 'tools'; agentId: string; items: ActivityItem[] } | { key: string; kind: 'single'; item: ActivityItem };

const LIMIT = 160;
// the channel's own reply tool shows up as a chat bubble instead
const HIDDEN_TOOL = /^mcp__agent-board__/;

function toBlocks(items: ActivityItem[]): Block[] {
  const blocks: Block[] = [];
  for (const it of items) {
    const last = blocks[blocks.length - 1];
    if (it.kind === 'tool') {
      if (last && last.kind === 'tools' && last.agentId === it.agentId) last.items.push(it);
      else blocks.push({ key: it.id, kind: 'tools', agentId: it.agentId, items: [it] });
    } else blocks.push({ key: it.id, kind: 'single', item: it });
  }
  return blocks;
}

const tcStatus = (s: ActivityItem['status']) => (s === 'running' ? 'running' : s === 'error' ? 'error' : 'success');

type Props = {
  session: Session;
  items: ActivityItem[];
  filter: string | null;
  onFilter: (id: string | null) => void;
  channel: boolean;
  onSend: (text: string) => Promise<boolean>;
};

export function ActivityFeed({ session, items, filter: selected, onFilter, channel, onSend }: Props) {
  const filter = selected || 'all';
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const agentIds = useMemo(() => {
    const ids = new Set(items.map((i) => i.agentId));
    return ['main', ...[...ids].filter((id) => id !== 'main')];
  }, [items]);

  const visible = useMemo(() => {
    const sorted = items.filter((i) => !(i.kind === 'tool' && HIDDEN_TOOL.test(i.name || ''))).sort((a, b) => a.ts - b.ts);
    const f = filter === 'all' ? sorted : sorted.filter((i) => i.agentId === filter || i.childId === filter);
    return toBlocks(f.slice(-LIMIT));
  }, [items, filter]);

  // follow the tail unless the user scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const options = [
    { value: 'all', label: 'Tümü', count: items.length },
    ...(agentIds.includes(filter) || filter === 'all' ? agentIds : [...agentIds, filter]).slice(0, 10).map((id) => ({ value: id, label: <span className="inline-block max-w-[9rem] truncate align-bottom">{agentName(session, id)}</span> })),
  ];

  return (
    <section className="flex min-h-0 flex-col rounded-[22px] bg-tray p-1.5 ring-line">
      <header className="flex items-center gap-3 px-2 pb-1.5 pt-1">
        <span className="pl-1.5 text-sm font-medium text-ink">Etkinlik</span>
        <div className="scroll-thin min-w-0 flex-1 overflow-x-auto">
          <SegmentedControl size="sm" variant="underline" options={options} value={filter} onChange={(v) => onFilter(v === 'all' ? null : v)} aria-label="Agent filtresi" />
        </div>
      </header>
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-thin min-h-[320px] flex-1 space-y-2 overflow-y-auto rounded-2xl bg-page/60 p-3 ring-line"
      >
        {visible.length === 0 && <p className="py-10 text-center text-[13px] text-muted">Henüz etkinlik yok.</p>}
        {visible.map((b) => (b.kind === 'tools' ? <ToolBlock key={b.key} b={b} session={session} /> : <Single key={b.key} it={b.item} session={session} />))}
      </div>
      <Composer
        key={session.id}
        disabled={!channel || !!session.endedAt}
        hint={session.endedAt ? 'Oturum kapandı.' : !channel ? 'Bu oturum kanalsız açıldı. Buradan yazmak için oturumu claude-board ile başlat.' : null}
        onSend={(text) => {
          stick.current = true;
          return onSend(text);
        }}
      />
    </section>
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
    <div className="mt-1.5 rounded-2xl bg-card p-2 ring-line">
      <div className="flex items-end gap-2">
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
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          placeholder={disabled ? 'Mesaj gönderilemiyor' : "Claude'a yaz… (Enter gönderir, Shift+Enter yeni satır)"}
          className="scroll-thin max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-5 text-ink placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button className="btn btn-primary grid !size-8 shrink-0 place-items-center !p-0" disabled={disabled || busy || !text.trim()} onClick={submit} aria-label="Gönder">
          <ArrowUp className="size-4" />
        </button>
      </div>
      {(hint || error) && (
        <p className={cn('px-2 pb-0.5 pt-1 text-[11px]', error ? 'text-err' : 'text-faint')}>{error ? 'Gönderilemedi: oturumun kanalı kopmuş olabilir.' : hint}</p>
      )}
    </div>
  );
}

function ToolBlock({ b, session }: { b: Extract<Block, { kind: 'tools' }>; session: Session }) {
  const who = agentName(session, b.agentId);
  const running = b.items.some((i) => i.status === 'running');
  const cards = b.items.map((i) => (
    <ToolCallCard
      key={i.id}
      name={i.name || 'tool'}
      summary={i.summary}
      status={tcStatus(i.status)}
      args={i.args}
      result={i.result}
      startedAt={i.ts}
      duration={i.status === 'running' ? undefined : i.duration}
      openOnError
      maxCodeHeight={220}
    />
  ));
  return (
    <div className="enter">
      {b.agentId !== 'main' && (
        <div className="mb-1 flex items-center gap-1.5 pl-1 text-[11px] text-faint">
          <Bot className="size-3" />
          {who}
        </div>
      )}
      {cards.length === 1 ? cards[0] : <ToolCallGroup label={`${cards.length} araç kullandı`} runningLabel="Araç kullanıyor…" defaultOpen={running}>{cards}</ToolCallGroup>}
    </div>
  );
}

function Single({ it, session }: { it: ActivityItem; session: Session }) {
  switch (it.kind) {
    case 'prompt':
      return (
        <div className="enter flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-raise px-3.5 py-2 text-[13px] leading-5 text-ink ring-line [overflow-wrap:anywhere]">
            <div className="mb-0.5 flex items-center gap-1 text-[10.5px] text-faint">
              <User className="size-3" /> sen
            </div>
            {it.summary}
          </div>
        </div>
      );
    case 'board-message':
      return (
        <div className="enter flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-run/15 px-3.5 py-2 text-[13px] leading-5 text-ink shadow-[inset_0_0_0_1px_rgba(77,141,255,.3)] [overflow-wrap:anywhere]">
            <div className="mb-0.5 flex items-center gap-1 text-[10.5px] text-run">
              <Radio className="size-3" /> sen · board
            </div>
            <span className="whitespace-pre-wrap">{it.summary}</span>
          </div>
        </div>
      );
    case 'board-reply':
      return (
        <div className="enter flex justify-start">
          <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2 text-[13px] leading-5 text-ink ring-line [overflow-wrap:anywhere]">
            <div className="mb-0.5 flex items-center gap-1 text-[10.5px] text-faint">
              <Bot className="size-3" /> Claude · board'a cevap
            </div>
            <span className="whitespace-pre-wrap">{it.summary}</span>
          </div>
        </div>
      );
    case 'reply':
      return (
        <div className="enter flex gap-2">
          <MessageSquare className="mt-1 size-3.5 shrink-0 text-faint" />
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-text [overflow-wrap:anywhere]">{String(it.summary || '')}</p>
        </div>
      );
    case 'agent':
      return (
        <ToolCallCard
          className="enter"
          name={`Agent · ${it.name}`}
          summary={it.summary}
          status={tcStatus(it.status)}
          icon={<Bot />}
          result={it.result}
          startedAt={it.ts}
          duration={it.status === 'running' ? undefined : it.duration}
          maxCodeHeight={220}
        />
      );
    case 'notice':
      return (
        <div className="enter flex items-center gap-2 px-1 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          {it.status === 'error' ? <X className="size-3.5 text-err" /> : <Check className="size-3.5 text-ok" />}
          <span className="max-w-[80%] truncate">{it.summary}</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      );
    case 'approval': {
      const pending = it.status === 'running';
      return (
        <div className={cn('enter flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs ring-line', pending ? 'attention text-alert' : 'text-muted')}>
          {pending ? <ShieldQuestion className="size-3.5" /> : it.summary?.startsWith('terminal') ? <Terminal className="size-3.5" /> : it.status === 'error' ? <X className="size-3.5 text-err" /> : <Check className="size-3.5 text-ok" />}
          <span className="font-mono">{it.name}</span>
          <span>{pending ? 'onayını bekliyor' : it.summary}</span>
          <span className="ml-auto text-faint">{agentName(session, it.agentId)}</span>
        </div>
      );
    }
    default:
      return null;
  }
}
