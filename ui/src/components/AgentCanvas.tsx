// Orchestration canvas as a swarm: the orchestrator in the middle, agents held to their parent by
// springs and kept apart by collisions. Working agents stay close, finished ones drift outwards,
// nested agents cluster around their parent. Pan by dragging or two-finger scroll, zoom with pinch,
// Ctrl/⌘ + wheel, double-click or the buttons; "Sığdır" fits everything.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus, Scan } from 'lucide-react';
import { childrenOf, cn, displayName, usd } from '../lib';
import type { Agent, Session } from '../types';
import { AGENT_STATE, AgentCard, agentState } from './AgentCard';

type Props = { session: Session; now: number; waitingBy: Record<string, number>; selected: string | null; onSelect: (id: string | null) => void };
type Node = { agent: Agent; x: number; y: number; w: number; h: number; parent: string | null; depth: number; live: boolean };

const W = 256; // card width (16rem)
const MAIN_W = 288; // orchestrator card (18rem)
const PAD = 46; // air between cards
const SY = 1.8; // cards are wide: vertical distance counts more than horizontal
const MIN_K = 0.15;
const MINI_BELOW = 0.55; // below this zoom full cards turn into labels that stay readable
const MAX_K = 1.6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// a stable pseudo-random number per agent, so the swarm keeps its shape between renders
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};

function layout(session: Session, waitingBy: Record<string, number>): Node[] {
  const main = session.agents.main;
  if (!main) return [];
  const ended = !!session.endedAt;
  const isLive = (a: Agent) => {
    const st = agentState(a, ended, waitingBy[a.id] || 0);
    return st === 'running' || st === 'waiting';
  };
  const nodes: Node[] = [{ agent: main, x: 0, y: 0, w: MAIN_W, h: isLive(main) ? 100 : 66, parent: null, depth: 0, live: isLive(main) }];
  const byId: Record<string, Node> = { main: nodes[0] };

  // seed: a sunflower spiral around each parent, nested agents pointing away from the middle
  const grow = (p: Node, depth: number) => {
    const kids = childrenOf(session, p.agent.id);
    const away = Math.atan2(p.y, p.x);
    kids.forEach((a, i) => {
      const live = isLive(a);
      const angle = depth === 1 ? i * GOLDEN + hash(a.id) * 0.6 : away + (i - (kids.length - 1) / 2) * 0.7;
      const r = (depth === 1 ? 240 + 60 * Math.sqrt(i) : 260) * (live ? 1 : 1.4);
      const n: Node = { agent: a, x: p.x + Math.cos(angle) * r, y: p.y + (Math.sin(angle) * r) / SY, w: W, h: live ? 100 : 66, parent: p.agent.id, depth, live };
      nodes.push(n);
      byId[a.id] = n;
      if (depth < 6) grow(n, depth + 1);
    });
  };
  grow(nodes[0], 1);

  // relax: springs to the parent (short for working agents), rectangles pushed apart
  const rest = (n: Node) => (n.depth > 1 ? 300 : n.live ? 330 : 480);
  const STEPS = 260;
  for (let it = 0; it < STEPS; it++) {
    const heat = 0.06 + 0.5 * (1 - it / STEPS);
    for (const n of nodes) {
      if (!n.parent) continue;
      const p = byId[n.parent];
      const dx = n.x - p.x;
      const dy = (n.y - p.y) * SY;
      const d = Math.hypot(dx, dy) || 1;
      const f = ((d - rest(n)) / d) * heat * 0.4;
      n.x -= dx * f;
      n.y -= (dy * f) / SY;
    }
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + PAD - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + PAD - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        if (!dx && !dy) dx = hash(b.agent.id) - 0.5 || 0.1;
        const d = Math.hypot(dx, dy * SY);
        const ux = dx / d;
        const uy = (dy * SY) / d / SY;
        // the distance along the line between them that clears the overlap on one axis
        const move = Math.min(ux ? ox / Math.abs(ux) : Infinity, uy ? oy / Math.abs(uy) : Infinity) * 0.5;
        const wa = a.depth === 0 ? 0 : b.depth === 0 ? 1 : 0.5; // the orchestrator stays put
        a.x -= ux * move * wa;
        a.y -= uy * move * wa;
        b.x += ux * move * (1 - wa);
        b.y += uy * move * (1 - wa);
      }
  }
  return nodes;
}

export function AgentCanvas({ session, now, waitingBy, selected, onSelect }: Props) {
  // agents whose parent we never saw still hang off the orchestrator
  const s = useMemo(() => {
    const orphans = Object.values(session.agents).filter((a) => a.id !== 'main' && a.parentId && !session.agents[a.parentId]);
    return orphans.length ? { ...session, agents: { ...session.agents, ...Object.fromEntries(orphans.map((o) => [o.id, { ...o, parentId: 'main' }])) } } : session;
  }, [session]);
  const nodes = useMemo(() => layout(s, waitingBy), [s, waitingBy]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.agent.id, n])), [nodes]);

  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [tall, setTall] = useState(false);
  const touched = useRef(false); // the user moved or zoomed: stop auto-fitting
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !nodes.length) return;
    const minX = Math.min(...nodes.map((n) => n.x - n.w / 2)) - 24;
    const maxX = Math.max(...nodes.map((n) => n.x + n.w / 2)) + 24;
    const minY = Math.min(...nodes.map((n) => n.y - n.h / 2)) - 24;
    const maxY = Math.max(...nodes.map((n) => n.y + n.h / 2)) + 24;
    const k = Math.max(MIN_K, Math.min(1, Math.min(el.clientWidth / (maxX - minX), el.clientHeight / (maxY - minY))));
    setView({ k, x: el.clientWidth / 2 - ((minX + maxX) / 2) * k, y: el.clientHeight / 2 - ((minY + maxY) / 2) * k });
  }, [nodes]);

  // first render, new agents (unless the user took over), session switch, size toggle
  useLayoutEffect(() => {
    if (!touched.current) fit();
  }, [fit, nodes.length]);
  useEffect(() => {
    touched.current = false;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, tall]);

  const zoomAt = (factor: number, px: number, py: number) => {
    touched.current = true;
    setView((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  };
  const zoomCenter = (factor: number) => {
    const el = box.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };

  // wheel: pinch / Ctrl+wheel zooms at the cursor, plain two-finger scroll pans; never scrolls the page
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // trackpad pinches send small deltas, mouse wheels big ones: cap a single step at ~35%
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
      else {
        touched.current = true;
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    d.moved = true;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    // a drag that ended on a card must not count as a click on it
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) {
      const stop = (ev: Event) => {
        ev.stopPropagation();
        window.removeEventListener('click', stop, true);
      };
      window.addEventListener('click', stop, true);
      setTimeout(() => window.removeEventListener('click', stop, true), 0);
    }
  };

  return (
    <div className="overflow-hidden rounded-[22px] bg-tray ring-line">
      <div
        ref={box}
        className={cn('relative cursor-grab touch-none select-none active:cursor-grabbing', tall ? 'h-[72vh]' : 'h-[440px]')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          const r = box.current!.getBoundingClientRect();
          zoomAt(1.6, e.clientX - r.left, e.clientY - r.top);
        }}
        style={{ backgroundImage: 'radial-gradient(var(--grid-dot) 1px, transparent 1px)', backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }} width="1" height="1" aria-hidden="true">
            {/* the swarm's core: a soft glow under the orchestrator */}
            <circle cx={0} cy={0} r={260} fill="url(#ab-core)" />
            <defs>
              <radialGradient id="ab-core">
                <stop offset="0" stopColor="var(--run)" stopOpacity="0.10" />
                <stop offset="1" stopColor="var(--run)" stopOpacity="0" />
              </radialGradient>
            </defs>
            {nodes
              .filter((n) => n.parent)
              .map((n) => {
                const p = byId[n.parent!];
                if (!p) return null;
                return (
                  <line
                    key={n.agent.id}
                    x1={p.x}
                    y1={p.y}
                    x2={n.x}
                    y2={n.y}
                    stroke={n.live ? 'var(--run)' : 'var(--edge)'}
                    strokeOpacity={n.live ? 0.55 : 1}
                    strokeWidth={n.live ? 1.5 : 1}
                    strokeDasharray={n.live ? '4 6' : undefined}
                    className={cn(n.live && 'edge-flow', 'transition-all duration-700')}
                  />
                );
              })}
          </svg>
          {nodes.map((n) =>
            view.k < MINI_BELOW ? (
              <MiniNode key={n.agent.id} n={n} k={view.k} waiting={waitingBy[n.agent.id] || 0} sessionEnded={!!s.endedAt} selected={selected === n.agent.id} onSelect={() => onSelect(selected === n.agent.id ? null : n.agent.id)} />
            ) : (
            <div key={n.agent.id} className="absolute transition-[left,top] duration-700 ease-out" style={{ left: n.x - n.w / 2, top: n.y - n.h / 2 }}>
              <AgentCard
                agent={n.agent}
                now={now}
                sessionEnded={!!s.endedAt}
                waiting={waitingBy[n.agent.id] || 0}
                selected={selected === n.agent.id}
                onSelect={() => onSelect(selected === n.agent.id ? null : n.agent.id)}
              />
            </div>
            )
          )}
        </div>

        {/* controls */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl bg-card/90 p-1 ring-card backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <CtlButton label="Uzaklaş" onClick={() => zoomCenter(1 / 1.25)}>
            <Minus className="size-4" />
          </CtlButton>
          <span className="w-11 text-center font-mono text-[11px] tabular-nums text-muted">{Math.round(view.k * 100)}%</span>
          <CtlButton label="Yakınlaş" onClick={() => zoomCenter(1.25)}>
            <Plus className="size-4" />
          </CtlButton>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <CtlButton
            label="Sığdır"
            onClick={() => {
              touched.current = false;
              fit();
            }}
          >
            <Scan className="size-4" />
          </CtlButton>
          <CtlButton label={tall ? 'Küçült' : 'Büyüt'} onClick={() => setTall((v) => !v)}>
            {tall ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </CtlButton>
        </div>
        <p className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-faint">
          {nodes.length} agent · sürükle: kaydır · sıkıştır / ⌘ + tekerlek: yakınlaş
        </p>
      </div>
    </div>
  );
}

// Zoomed out: a label whose text keeps a readable on-screen size whatever the zoom
function MiniNode({ n, k, waiting, sessionEnded, selected, onSelect }: { n: Node; k: number; waiting: number; sessionEnded: boolean; selected: boolean; onSelect: () => void }) {
  const a = n.agent;
  const main = n.depth === 0;
  const st = AGENT_STATE[agentState(a, sessionEnded, waiting)];
  const f = 1 / k; // world units per screen pixel
  return (
    <button
      onClick={onSelect}
      title={`${main ? 'Orkestratör' : displayName(a)} · ${st.label} · ${a.toolCalls} araç · ${usd(a.costUsd)}`}
      className={cn('absolute flex items-center rounded-[1em] bg-card text-left ring-card transition-[left,top,background-color] duration-700 hover:bg-raise', st.ring, selected && 'ring-selected')}
      // width stays the card's footprint so labels never overlap; only type and height scale with zoom
      style={{
        left: n.x - n.w / 2,
        top: n.y - Math.min(19 * f, n.h / 2),
        width: n.w,
        height: Math.min(38 * f, n.h),
        padding: `0 ${Math.min(10 * f, 24)}px`,
        gap: Math.min(7 * f, 18),
        fontSize: (main ? 13 : 12) * f,
      }}
    >
      <span className={cn('shrink-0 rounded-full', st.dot)} style={{ width: 7 * f, height: 7 * f }} />
      {/* name gets both lines; cost and tool count live in the tooltip at this zoom */}
      <span className={cn('line-clamp-2 min-w-0 flex-1 leading-[1.15]', main ? 'font-semibold text-ink' : 'text-text')}>{main ? 'Orkestratör' : displayName(a)}</span>
    </button>
  );
}

function CtlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={label} aria-label={label} onClick={onClick} className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-tile hover:text-ink">
      {children}
    </button>
  );
}
