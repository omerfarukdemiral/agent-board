// The flow: every task (and every subagent without a task) as a card moving through four columns.
// Two groupings: task → agent (cards carry their agent) and agent → task (one swimlane per agent).
import { useState } from 'react';
import { Bot, Network } from 'lucide-react';
import { agentName, ago, cn } from '../lib';
import { COLUMNS, type Column, type FlowCard } from '../flow';

type Props = {
  cards: FlowCard[];
  grouping: 'task' | 'agent';
  multiSession: boolean;
  now: number;
  onOpen: (sessionId: string, agentId: string | null) => void;
};

const COL_TONE: Record<Column, string> = { todo: 'bg-faint', doing: 'bg-run', review: 'bg-alert', done: 'bg-ok' };
const DONE_LIMIT = 6;
const REASON: Record<string, string> = { approval: 'Onayın bekleniyor', review: 'Review istendi', decision: 'Kararını bekliyor', abandoned: 'Oturum kapandı, yarım kaldı' };

const order = (c: Column) => (a: FlowCard, b: FlowCard) => (c === 'done' ? b.since - a.since : a.since - b.since);

export function FlowBoard({ cards, grouping, multiSession, now, onOpen }: Props) {
  if (cards.length === 0) {
    return (
      <div className="grid min-h-[220px] place-items-center rounded-[22px] bg-tray px-6 text-center ring-line">
        <div>
          <p className="text-sm font-medium text-ink">Henüz akan iş yok</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-muted">Claude bir görev listesi açınca ya da subagent başlatınca kartlar burada sütunlar arasında ilerler.</p>
        </div>
      </div>
    );
  }
  return grouping === 'task' ? <Columns cards={cards} multiSession={multiSession} now={now} onOpen={onOpen} /> : <Lanes cards={cards} multiSession={multiSession} now={now} onOpen={onOpen} />;
}

function ColumnHead({ c, count }: { c: (typeof COLUMNS)[number]; count: number }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2 text-[12.5px] font-medium text-muted">
      <span className={cn('size-2 rounded-full', COL_TONE[c.id])} />
      <span className={cn(c.id === 'review' && count > 0 && 'text-alert')}>{c.label}</span>
      <span className="font-mono text-[11px] text-faint">{count}</span>
    </div>
  );
}

function Columns({ cards, multiSession, now, onOpen }: Omit<Props, 'grouping'>) {
  const [showAllDone, setShowAllDone] = useState(false);
  return (
    <div className="scroll-thin overflow-x-auto rounded-[22px] bg-tray p-2 ring-line">
      {/* phones: columns stack and empty ones step aside; wider screens get the four-column board */}
      <div className="flex flex-col gap-2 sm:grid sm:min-w-[760px] sm:grid-cols-4">
        {COLUMNS.map((c) => {
          const list = cards.filter((x) => x.column === c.id).sort(order(c.id));
          const shown = c.id === 'done' && !showAllDone ? list.slice(0, DONE_LIMIT) : list;
          return (
            <section key={c.id} className={cn('rounded-2xl p-2 sm:min-h-[180px]', !list.length && 'hidden sm:block', c.id === 'review' && list.length ? 'bg-alert/[0.06]' : 'bg-page/50')}>
              <ColumnHead c={c} count={list.length} />
              <div className="space-y-1.5">
                {shown.map((card) => (
                  <Card key={card.key} card={card} multiSession={multiSession} now={now} onOpen={onOpen} showAgent />
                ))}
                {list.length > shown.length && (
                  <button className="w-full rounded-lg py-1.5 text-[12px] text-faint hover:text-ink" onClick={() => setShowAllDone(true)}>
                    {list.length - shown.length} tane daha
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Lanes({ cards, multiSession, now, onOpen }: Omit<Props, 'grouping'>) {
  // one lane per (session, agent); unassigned tasks get their own lane at the end
  const lanes = new Map<string, FlowCard[]>();
  for (const c of cards) {
    const k = `${c.session.id}|${c.agentId ?? ''}`;
    lanes.set(k, [...(lanes.get(k) || []), c]);
  }
  const keys = [...lanes.keys()].sort((a, b) => {
    const [sa, ia] = a.split('|');
    const [sb, ib] = b.split('|');
    if (sa !== sb) return sa < sb ? -1 : 1;
    const rank = (id: string) => (id === 'main' ? 0 : id === '' ? 2 : 1);
    return rank(ia) - rank(ib);
  });
  return (
    <div className="scroll-thin overflow-x-auto rounded-[22px] bg-tray p-2 ring-line">
      <div className="min-w-[840px]">
        <div className="grid grid-cols-[140px_repeat(4,minmax(0,1fr))] gap-2 px-1 pt-1">
          <span />
          {COLUMNS.map((c) => (
            <ColumnHead key={c.id} c={c} count={cards.filter((x) => x.column === c.id).length} />
          ))}
        </div>
        <div className="space-y-2">
          {keys.map((k) => {
            const list = lanes.get(k)!;
            const s = list[0].session;
            const agentId = list[0].agentId;
            const agent = agentId ? s.agents[agentId] : null;
            return (
              <div key={k} className="grid grid-cols-[140px_repeat(4,minmax(0,1fr))] gap-2 rounded-2xl bg-page/50 p-2">
                <button className="flex min-w-0 items-start gap-2 rounded-lg p-1 text-left hover:bg-tile" onClick={() => onOpen(s.id, agentId)}>
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-tile text-muted ring-line">
                    {agentId === 'main' ? <Network className="size-3.5" /> : <Bot className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{agentId ? agentName(s, agentId) : 'Atanmamış'}</span>
                    <span className="flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-[11px] text-faint">
                      {agent && <span className={cn('size-1.5 rounded-full', agent.status === 'running' ? 'bg-run pulse-dot' : agent.status === 'error' ? 'bg-err' : 'bg-ok')} />}
                      {agent ? (agentId === 'main' ? 'orkestratör' : agent.type) : 'görev'}
                      {multiSession && <span className="font-mono">#{s.id.slice(0, 4)}</span>}
                    </span>
                  </span>
                </button>
                {COLUMNS.map((c) => (
                  <div key={c.id} className="min-w-0 space-y-1.5">
                    {list
                      .filter((x) => x.column === c.id)
                      .sort(order(c.id))
                      .map((card) => (
                        <Card key={card.key} card={card} multiSession={false} now={now} onOpen={onOpen} showAgent={false} />
                      ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({ card, multiSession, now, onOpen, showAgent }: { card: FlowCard; multiSession: boolean; now: number; onOpen: Props['onOpen']; showAgent: boolean }) {
  const agent = card.agentId ? card.session.agents[card.agentId] : null;
  const done = card.column === 'done';
  return (
    <button
      onClick={() => onOpen(card.session.id, card.agentId)}
      className={cn(
        'enter block w-full rounded-xl bg-card px-2.5 py-2 text-left ring-line transition-colors hover:bg-raise/70',
        card.column === 'review' && 'attention',
        card.column === 'doing' && 'shadow-[inset_0_0_0_1px_rgba(77,141,255,.3)]'
      )}
    >
      <span className={cn('line-clamp-2 text-[12.5px] leading-[18px]', done ? 'text-muted' : 'text-ink', card.error && 'text-err')}>
        {(card.taskId || multiSession) && (
          <span className="mr-1 font-mono text-[11px] text-faint">
            {multiSession && `${card.session.id.slice(0, 4)}`}
            {multiSession && card.taskId && '/'}
            {card.taskId && `#${card.taskId}`}
          </span>
        )}
        {card.title}
      </span>
      {card.reason && <span className={cn('mt-1 block text-[11px] font-medium', card.reason === 'abandoned' ? 'text-faint' : 'text-alert')}>{REASON[card.reason]}</span>}
      <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
        {showAgent &&
          (agent ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-tile px-1.5 py-px text-muted ring-line" title={`${agentName(card.session, card.agentId!)}${card.guessed ? ' · tahmini eşleşme' : ''}`}>
              {card.agentId === 'main' ? <Network className="size-3 shrink-0" /> : <Bot className="size-3 shrink-0" />}
              <span className="truncate">{agentName(card.session, card.agentId!)}</span>
            </span>
          ) : (
            <span className="text-faint">atanmamış</span>
          ))}
        {card.kind === 'agent' && <span className="shrink-0 rounded bg-tile px-1 text-[10px]">agent işi</span>}
        <span className="ml-auto shrink-0">{ago(card.since, now)}</span>
      </span>
    </button>
  );
}
