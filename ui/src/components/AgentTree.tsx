import { childrenOf } from '../lib';
import type { Agent, Session } from '../types';
import { AgentCard } from './AgentCard';

type Props = { session: Session; now: number; waitingBy: Record<string, number>; selected: string | null; onSelect: (id: string | null) => void };

function Node({ agent, depth, ...p }: Props & { agent: Agent; depth: number }) {
  // guard against parent cycles from out-of-order events
  const kids = depth < 8 ? childrenOf(p.session, agent.id) : [];
  return (
    <div className="flex flex-col items-center">
      <AgentCard
        agent={agent}
        now={p.now}
        sessionEnded={!!p.session.endedAt}
        waiting={p.waitingBy[agent.id] || 0}
        selected={p.selected === agent.id}
        onSelect={() => p.onSelect(p.selected === agent.id ? null : agent.id)}
      />
      {kids.length > 0 && (
        <>
          <div className="tree-stem" />
          <div className="tree-children">
            {kids.map((k) => (
              <div key={k.id} className="tree-child" data-running={k.status === 'running'}>
                <Node agent={k} depth={depth + 1} {...p} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AgentTree(props: Props) {
  const { session } = props;
  const main = session.agents.main;
  // agents whose parent we never saw still get shown under main
  const orphans = Object.values(session.agents).filter((a) => a.id !== 'main' && a.parentId && !session.agents[a.parentId]);
  const s = orphans.length
    ? { ...session, agents: { ...session.agents, ...Object.fromEntries(orphans.map((o) => [o.id, { ...o, parentId: 'main' }])) } }
    : session;
  return (
    <div className="scroll-thin overflow-x-auto rounded-[22px] bg-tray p-1.5 ring-line">
      <div className="mx-auto w-max min-w-full rounded-2xl px-3 py-5">{main && <Node {...props} session={s} agent={main} depth={0} />}</div>
    </div>
  );
}
