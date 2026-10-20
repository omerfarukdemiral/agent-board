// Orchestration canvas: the orchestrator in the middle, subagents on a ring around it, nested agents
// further out in their parent's direction. Pan by dragging or two-finger scroll, zoom with pinch,
// Ctrl/⌘ + wheel, double-click or the buttons; "Sığdır" fits everything.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus, Scan } from 'lucide-react';
import { childrenOf, cn, displayName, usd } from '../lib';
import type { Agent, Session } from '../types';
import { AgentCard } from './AgentCard';

type Props = { session: Session; now: number; waitingBy: Record<string, number>; selected: string | null; onSelect: (id: string | null) => void };
type Node = { agent: Agent; x: number; y: number; parent: string | null; depth: number };

const W = 248; // card width (15.5rem)
const H = 92; // card height, approx.
const GAP = 290; // arc length kept per card along a ring
const SQUASH = 0.55; // rings are ellipses: wide cards need more room sideways than up and down
const MIN_K = 0.15;
const MINI_BELOW = 0.55; // below this zoom full cards turn into labels that stay readable
const MAX_K = 1.6;

// radial layout: ring 1 sized to fit its agents, deeper rings step outwards around their parent
function layout(session: Session): Node[] {
  const main = session.agents.main;
  if (!main) return [];
  const nodes: Node[] = [{ agent: main, x: 0, y: 0, parent: null, depth: 0 }];
  const first = childrenOf(session, 'main');
  if (!first.length) return nodes;
  const perim = (rx: number) => 2 * Math.PI * Math.sqrt((rx * rx + (rx * SQUASH) ** 2) / 2);
  let rx = 340;
  while (perim(rx) < first.length * GAP) rx += 40;
  const place = (a: Agent, angle: number, depth: number, parent: string, radius: number) => {
    nodes.push({ agent: a, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * SQUASH, parent, depth });
    const kids = depth < 6 ? childrenOf(session, a.id) : [];
    if (!kids.length) return;
    const outer = radius + 300;
    const step = GAP / outer;
    kids.forEach((k, i) => place(k, angle + (i - (kids.length - 1) / 2) * step, depth + 1, a.id, outer));
  };
  // the first subagent sits straight below the orchestrator, the rest follow clockwise
  first.forEach((a, i) => place(a, Math.PI / 2 + (i * 2 * Math.PI) / first.length, 1, 'main', rx));
  return nodes;
}

export function AgentCanvas({ session, now, waitingBy, selected, onSelect }: Props) {
  // agents whose parent we never saw still hang off the orchestrator
  const s = useMemo(() => {
    const orphans = Object.values(session.agents).filter((a) => a.id !== 'main' && a.parentId && !session.agents[a.parentId]);
    return orphans.length ? { ...session, agents: { ...session.agents, ...Object.fromEntries(orphans.map((o) => [o.id, { ...o, parentId: 'main' }])) } } : session;
  }, [session]);
  const nodes = useMemo(() => layout(s), [s]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.agent.id, n])), [nodes]);

  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [tall, setTall] = useState(false);
  const touched = useRef(false); // the user moved or zoomed: stop auto-fitting
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - W / 2 - 24;
    const maxX = Math.max(...xs) + W / 2 + 24;
    const minY = Math.min(...ys) - H / 2 - 24;
    const maxY = Math.max(...ys) + H / 2 + 24;
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
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: `${22 * view.k}px ${22 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0 }} width="1" height="1" aria-hidden="true">
            {nodes
              .filter((n) => n.parent)
              .map((n) => {
                const p = byId[n.parent!];
                if (!p) return null;
                const running = n.agent.status === 'running';
                const mx = (p.x + n.x) / 2;
                const my = (p.y + n.y) / 2;
                return (
                  <path
                    key={n.agent.id}
                    d={`M ${p.x} ${p.y} Q ${mx * 0.9} ${my * 0.9} ${n.x} ${n.y}`}
                    fill="none"
                    stroke={running ? 'rgba(77,141,255,.75)' : 'rgba(255,255,255,.14)'}
                    strokeWidth={running ? 1.6 : 1}
                    strokeDasharray={running ? '5 5' : undefined}
                  />
                );
              })}
          </svg>
          {nodes.map((n) =>
            view.k < MINI_BELOW ? (
              <MiniNode key={n.agent.id} n={n} k={view.k} waiting={waitingBy[n.agent.id] || 0} sessionEnded={!!s.endedAt} selected={selected === n.agent.id} onSelect={() => onSelect(selected === n.agent.id ? null : n.agent.id)} />
            ) : (
            <div key={n.agent.id} className="absolute" style={{ left: n.x - (n.depth === 0 ? 152 : W / 2), top: n.y - H / 2 }}>
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
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-xl bg-page/85 p-1 ring-line backdrop-blur" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
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
  const status = waiting ? 'waiting' : main && a.status === 'done' && !sessionEnded ? 'idle' : a.status;
  const dot = { running: 'bg-run pulse-dot', done: 'bg-ok', error: 'bg-err', idle: 'bg-faint', waiting: 'bg-alert pulse-dot' }[status];
  const f = 1 / k; // world units per screen pixel
  return (
    <button
      onClick={onSelect}
      title={`${main ? 'Orchestrator' : displayName(a)} · ${a.toolCalls} araç · ${usd(a.costUsd)}`}
      className={cn(
        'absolute flex items-center rounded-[1em] bg-card text-left ring-line transition-colors hover:bg-raise',
        status === 'waiting' && 'attention',
        status === 'running' && 'shadow-[inset_0_0_0_1px_rgba(77,141,255,.5)]',
        selected && 'shadow-[inset_0_0_0_2px_rgba(255,255,255,.5)]'
      )}
      // width stays the card's footprint so labels never overlap; only type and height scale with zoom
      style={{
        left: n.x - (main ? 152 : W / 2),
        top: n.y - Math.min(19 * f, H / 2),
        width: main ? 304 : W,
        height: Math.min(38 * f, H),
        padding: `0 ${Math.min(10 * f, 24)}px`,
        gap: Math.min(7 * f, 18),
        fontSize: (main ? 12.5 : 11.5) * f,
      }}
    >
      <span className={cn('shrink-0 rounded-full', dot)} style={{ width: 7 * f, height: 7 * f }} />
      {/* name gets both lines; cost and tool count live in the tooltip at this zoom */}
      <span className={cn('line-clamp-2 min-w-0 flex-1 leading-[1.15]', main ? 'font-semibold text-ink' : 'text-text')}>{main ? 'Orchestrator' : displayName(a)}</span>
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
