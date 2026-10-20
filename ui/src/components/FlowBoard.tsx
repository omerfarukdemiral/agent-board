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
    <div className="flex items-center gap-2 px-1 pb-2.5 pt-0.5 text-[13px] font-medium text-text">
      <span className={cn('size-2 rounded-full', COL_TONE[c.id])} />
      <span className={cn(c.id === 'review' && count > 0 && 'text-alert')}>{c.label}</span>
      <span className="ml-auto rounded-full bg-tile px-1.5 text-[11px] tabular-nums text-muted ring-line">{count}</span>
    </div>
  );
}

function Columns({ cards, multiSession, now, onOpen }: Omit<Props, 'grouping'>) {
  const [showAllDone, setShowAllDone] = useState(false);
  return (
    <div className="scroll-thin overflow-x-auto rounded-[20px] bg-tray p-2 ring-line">
      {/* phones: columns stack and empty ones step aside; wider screens get the four-column board */}
      <div className="flex flex-col gap-2 sm:grid sm:min-w-[760px] sm:grid-cols-4">
        {COLUMNS.map((c) => {
          const list = cards.filter((x) => x.column === c.id).sort(order(c.id));
          const shown = c.id === 'done' && !showAllDone ? list.slice(0, DONE_LIMIT) : list;
          return (
            <section key={c.id} className={cn('rounded-2xl p-2 sm:min-h-[200px]', !list.length && 'hidden sm:block', c.id === 'review' && list.length ? 'bg-alert/[0.05] shadow-[inset_0_0_0_1px_rgba(251,138,60,.18)]' : 'bg-white/[0.015]')}>
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
  // session → agent lanes; a task shared by several subagents shows in the primary agent's lane
  const bySession = new Map<string, Map<string, FlowCard[]>>();
  for (const c of cards) {
    const lanes = bySession.get(c.session.id) || new Map<string, FlowCard[]>();
    const k = c.agentId ?? '';
    lanes.set(k, [...(lanes.get(k) || []), c]);
    bySession.set(c.session.id, lanes);
  }
  const rank = (id: string) => (id === 'main' ? 0 : id === '' ? 2 : 1);
  return (
    <div className="scroll-thin overflow-x-auto rounded-[20px] bg-tray p-2 ring-line">
      <div className="min-w-[880px]">
        <div className="grid grid-cols-[180px_repeat(4,minmax(0,1fr))] gap-2 px-1 pt-1">
          <span />
          {COLUMNS.map((c) => (
            <ColumnHead key={c.id} c={c} count={cards.filter((x) => x.column === c.id).length} />
          ))}
        </div>
        {[...bySession.entries()].map(([sid, lanes]) => {
          const s = lanes.values().next().value![0].session;
          const subs = Object.values(s.agents).filter((a) => a.id !== 'main');
          return (
            <section key={sid} className="mt-1">
              {multiSession && (
                <header className="flex items-center gap-2 px-2 pb-1 pt-2 text-[12px] text-muted">
                  <span className={cn('size-1.5 rounded-full', s.endedAt ? 'bg-faint' : subs.some((a) => a.status === 'running') || s.agents.main?.status === 'running' ? 'bg-run pulse-dot' : 'bg-ok')} />
                  <span className="font-mono text-ink">#{sid.slice(0, 4)}</span>
                  <span>1 orkestratör{subs.length ? ` + ${subs.length} subagent` : ''}</span>
                  <span className="h-px flex-1 bg-line" />
                </header>
              )}
              {[...lanes.keys()]
                .sort((a, b) => rank(a) - rank(b))
                .map((agentId) => {
                  const list = lanes.get(agentId)!;
                  const agent = agentId ? s.agents[agentId] : null;
                  return (
                    <div key={agentId} className="grid grid-cols-[180px_repeat(4,minmax(0,1fr))] gap-2 rounded-xl px-1 py-2 [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-line">
                      <button className="flex min-w-0 items-start gap-2 rounded-lg p-1 text-left hover:bg-tile" onClick={() => onOpen(s.id, agentId || null)}>
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-tile text-muted ring-line">
                          {agentId === 'main' ? <Network className="size-3.5" /> : <Bot className="size-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="line-clamp-2 text-[12.5px] font-medium leading-[17px] text-ink">{agentId ? agentName(s, agentId) : 'Atanmamış'}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate whitespace-nowrap text-[11px] text-faint">
                            {agent && <span className={cn('size-1.5 shrink-0 rounded-full', agent.status === 'running' ? 'bg-run pulse-dot' : agent.status === 'error' ? 'bg-err' : 'bg-ok')} />}
                            {agent ? (agentId === 'main' ? 'orkestratör' : agent.type) : 'görev'}
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
            </section>
          );
        })}
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
        'enter relative block w-full overflow-hidden rounded-xl bg-card py-2 pl-3.5 pr-2.5 text-left ring-line transition-[background-color,transform] duration-150 hover:-translate-y-px hover:bg-raise/70',
        card.column === 'review' && 'attention'
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', COL_TONE[card.column], card.column === 'done' && 'opacity-50', card.column === 'doing' && 'pulse-dot')} aria-hidden="true" />
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
              {card.helpers.length > 0 && (
                <span className="shrink-0 text-faint" title={card.helpers.map((h) => agentName(card.session, h)).join(', ')}>
                  +{card.helpers.length}
                </span>
              )}
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
