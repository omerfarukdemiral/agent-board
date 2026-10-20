import { childrenOf, cn } from '../lib';
import type { Agent, Session } from '../types';
import { AgentCanvas } from './AgentCanvas';
import { AgentCard } from './AgentCard';

type Props = { session: Session; now: number; waitingBy: Record<string, number>; selected: string | null; onSelect: (id: string | null) => void };

// Phones: an indented list, so nothing has to be panned
function List({ agent, depth, ...p }: Props & { agent: Agent; depth: number }) {
  const kids = depth < 8 ? childrenOf(p.session, agent.id) : [];
  return (
    <>
      <div className={cn(depth > 0 && 'border-l border-line-strong pl-3')} style={{ marginLeft: depth > 1 ? (depth - 1) * 12 : 0 }}>
        <AgentCard
          fluid
          agent={agent}
          now={p.now}
          sessionEnded={!!p.session.endedAt}
          waiting={p.waitingBy[agent.id] || 0}
          selected={p.selected === agent.id}
          onSelect={() => p.onSelect(p.selected === agent.id ? null : agent.id)}
        />
      </div>
      {kids.map((k) => (
        <List key={k.id} agent={k} depth={depth + 1} {...p} />
      ))}
    </>
  );
}

export function AgentTree(props: Props) {
  const main = props.session.agents.main;
  return (
    <>
      <div className="hidden sm:block">
        <AgentCanvas {...props} />
      </div>
      <div className="flex flex-col gap-2 rounded-[22px] bg-tray p-2 ring-line sm:hidden">{main && <List {...props} agent={main} depth={0} />}</div>
    </>
  );
}
