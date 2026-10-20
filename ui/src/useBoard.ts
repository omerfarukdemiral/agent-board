import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityItem, ApprovalRequest, Decision, Session } from './types';

const ACTIVITY_MAX = 400;
const token = () => document.querySelector<HTMLMetaElement>('meta[name="agent-board-token"]')?.content ?? '';

function upsert(list: ActivityItem[], item: ActivityItem) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) {
    const next = list.slice();
    next[i] = { ...next[i], ...item };
    return next;
  }
  const next = [...list, item];
  return next.length > ACTIVITY_MAX ? next.slice(-ACTIVITY_MAX) : next;
}

// Snapshot from /state, then small diffs from the SSE stream.
export function useBoard() {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [activity, setActivity] = useState<Record<string, ActivityItem[]>>({});
  const [requests, setRequests] = useState<Record<string, ApprovalRequest>>({});
  const [connected, setConnected] = useState(false);
  const [channelPids, setChannelPids] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch('/state')
        .then((r) => r.json())
        .then((d: { sessions: Session[]; activity: Record<string, ActivityItem[]>; requests: ApprovalRequest[]; channels?: number[] }) => {
          if (cancelled) return;
          setChannelPids(d.channels || []);
          setSessions(Object.fromEntries(d.sessions.map((s) => [s.id, s])));
          setActivity(d.activity || {});
          setRequests(Object.fromEntries((d.requests || []).map((r) => [r.id, r])));
        })
        .catch(() => {});

    load();
    const es = new EventSource('/stream');
    es.onopen = () => {
      setConnected(true);
      load(); // resync after reconnects (server restart)
    };
    es.onerror = () => setConnected(false);
    es.addEventListener('session', (e) => {
      const { session } = JSON.parse((e as MessageEvent).data) as { session: Session };
      setSessions((prev) => ({ ...prev, [session.id]: session }));
    });
    es.addEventListener('activity', (e) => {
      const { sessionId, item } = JSON.parse((e as MessageEvent).data) as { sessionId: string; item: ActivityItem };
      setActivity((prev) => ({ ...prev, [sessionId]: upsert(prev[sessionId] || [], item) }));
    });
    es.addEventListener('request', (e) => {
      const { request } = JSON.parse((e as MessageEvent).data) as { request: ApprovalRequest };
      setRequests((prev) => ({ ...prev, [request.id]: request }));
    });
    es.addEventListener('channels', (e) => setChannelPids((JSON.parse((e as MessageEvent).data) as { pids: number[] }).pids));
    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  const decide = useCallback(async (id: string, d: Decision) => {
    const r = await fetch('/decision', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-board-token': token() },
      body: JSON.stringify({ id, ...d }),
    });
    return r.ok;
  }, []);

  const sendMessage = useCallback(async (sessionId: string, text: string) => {
    const r = await fetch('/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-board-token': token() },
      body: JSON.stringify({ sessionId, text }),
    });
    return r.ok;
  }, []);

  const ackInbox = useCallback(async (sessionId: string, id: string, status: 'read' | 'answered' = 'read') => {
    const r = await fetch('/inbox/ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-board-token': token() },
      body: JSON.stringify({ sessionId, id, status }),
    });
    return r.ok;
  }, []);

  return { sessions, activity, requests, connected, channelPids, decide, sendMessage, ackInbox };
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// Desktop notification when Claude waits on a decision and the tab is in the background.
export function useAttention(pending: ApprovalRequest[], label: (r: ApprovalRequest) => string) {
  const notified = useRef(new Set<string>());
  useEffect(() => {
    if (!('Notification' in window)) return;
    for (const r of pending) {
      if (notified.current.has(r.id)) continue;
      notified.current.add(r.id);
      if (document.hidden && Notification.permission === 'granted') {
        const n = new Notification('Claude karar bekliyor', { body: label(r), tag: r.id });
        n.onclick = () => window.focus();
      }
    }
  }, [pending, label]);
}
