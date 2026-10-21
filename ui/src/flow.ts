// Derived views: projects (sessions grouped by folder), the task flow and the head counts.
import type { Agent, ApprovalRequest, InboxItem, Session, Task } from './types';
import { isLive, projectName } from './lib';

export type Project = { cwd: string; name: string; sessions: Session[]; live: number; lastEventAt: number };

export function projectsOf(sessions: Session[]): Project[] {
  const by = new Map<string, Session[]>();
  for (const s of sessions) by.set(s.cwd, [...(by.get(s.cwd) || []), s]);
  return [...by.entries()]
    .map(([cwd, list]) => {
      const sorted = list.sort((a, b) => b.lastEventAt - a.lastEventAt);
      return { cwd, name: projectName(cwd), sessions: sorted, live: sorted.filter(isLive).length, lastEventAt: sorted[0].lastEventAt };
    })
    .sort((a, b) => Number(b.live > 0) - Number(a.live > 0) || b.lastEventAt - a.lastEventAt);
}

export type Column = 'todo' | 'doing' | 'review' | 'done';
export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

export type FlowCard = {
  key: string;
  kind: 'task' | 'agent';
  session: Session;
  taskId?: string;
  title: string;
  agentId: string | null; // who does it
  helpers: string[]; // more agents on the same task
  guessed: boolean; // assignee inferred, not stated
  column: Column;
  reason?: 'approval' | 'review' | 'decision' | 'abandoned';
  since: number;
  error?: boolean;
};

const STATUS_COL: Record<string, Column> = { pending: 'todo', in_progress: 'doing', completed: 'done' };

export function flowCards(sessions: Session[], pending: ApprovalRequest[]): FlowCard[] {
  const cards: FlowCard[] = [];
  for (const s of sessions) {
    const waitingAgents = new Map<string, number>();
    for (const r of pending) if (r.sessionId === s.id) waitingAgents.set(r.agentId, Math.min(waitingAgents.get(r.agentId) ?? Infinity, r.createdAt));
    const flagged = new Map<string, InboxItem>();
    for (const it of Object.values(s.inbox || {})) if (it.taskId && it.status === 'unread' && it.kind !== 'info') flagged.set(it.taskId, it);

    const linked = new Set<string>();
    for (const t of Object.values(s.tasks) as Task[]) {
      const agentId = t.assignee ?? null;
      const helpers = t.helpers || [];
      if (agentId) linked.add(agentId);
      for (const h of helpers) linked.add(h);
      let column = STATUS_COL[t.status] ?? 'todo';
      let since = (column === 'done' ? t.completedAt : column === 'doing' ? t.startedAt : t.createdAt) ?? t.updatedAt;
      let reason: FlowCard['reason'];
      const waitSince = column === 'doing' ? [agentId, ...helpers].map((id) => (id ? waitingAgents.get(id) : undefined)).find((x) => x !== undefined) : undefined;
      const flag = flagged.get(t.id);
      if (waitSince !== undefined) [column, reason, since] = ['review', 'approval', waitSince];
      else if (flag) [column, reason, since] = ['review', flag.kind === 'decision' ? 'decision' : 'review', flag.createdAt];
      // nothing is "in progress" in a closed session: unfinished work goes back to the todo pile
      else if (s.endedAt && column !== 'done') [column, reason] = ['todo', 'abandoned'];
      cards.push({
        key: `${s.id}:t:${t.id}`,
        kind: 'task',
        session: s,
        taskId: t.id,
        title: column === 'doing' && t.activeForm && !s.endedAt ? t.activeForm : t.subject,
        agentId,
        helpers,
        guessed: t.assigneeBy === 'match' || t.assigneeBy === 'updater',
        column,
        reason,
        since,
      });
    }
    // subagents with no task still are work in flight: show them as their own cards
    for (const a of Object.values(s.agents) as Agent[]) {
      if (a.id === 'main' || linked.has(a.id)) continue;
      const waitSince = waitingAgents.get(a.id);
      const column: Column = waitSince !== undefined ? 'review' : a.status === 'running' ? 'doing' : 'done';
      cards.push({
        key: `${s.id}:a:${a.id}`,
        kind: 'agent',
        session: s,
        title: a.description || a.type,
        agentId: a.id,
        helpers: [],
        guessed: false,
        column,
        reason: waitSince !== undefined ? 'approval' : undefined,
        since: waitSince ?? (column === 'done' ? a.endedAt ?? a.startedAt : a.startedAt),
        error: a.status === 'error',
      });
    }
  }
  return cards;
}

export function headCounts(sessions: Session[], cards: FlowCard[]) {
  const live = sessions.filter(isLive);
  const subs = sessions.flatMap((s) => Object.values(s.agents).filter((a) => a.id !== 'main'));
  const by = (c: Column) => cards.filter((x) => x.column === c).length;
  let cost = 0;
  for (const s of sessions) for (const a of Object.values(s.agents)) cost += a.costUsd ?? 0;
  return {
    sessions: sessions.length,
    liveSessions: live.length,
    orchestratorsRunning: live.filter((s) => s.agents.main?.status === 'running').length,
    subagents: subs.length,
    subagentsRunning: subs.filter((a) => a.status === 'running').length,
    tasks: cards.filter((c) => c.kind === 'task').length,
    todo: by('todo'),
    doing: by('doing'),
    review: by('review'),
    done: by('done'),
    cost,
  };
}
