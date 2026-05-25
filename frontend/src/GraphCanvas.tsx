import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode, SimEvent } from "./types";
import {
  algoColor,
  pathColorForSegment,
  type VisualState,
} from "./graphVisual";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  visual: VisualState;
  source: string;
  destination: string;
  failedNodes: Set<string>;
  failedEdges: Set<string>;
  /** 0–1 along final path when looping after replay */
  pathLoopT: number;
  pendingEvent: SimEvent | null;
  pendingProgress: number;
  pathLoopActive: boolean;
  onNodeMove: (id: string, x: number, y: number) => void;
};

function edgeKey(from: string, to: string) {
  return `${from}→${to}`;
}

function edgeCurveParams(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const curve = 0.08 * len;
  return {
    cx1: x1 + dx * 0.35 + nx * curve,
    cy1: y1 + dy * 0.35 + ny * curve,
    cx2: x1 + dx * 0.65 + nx * curve,
    cy2: y1 + dy * 0.65 + ny * curve,
  };
}

function cubicPoint(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + tt * t * x3,
    y: uu * u * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + tt * t * y3,
  };
}

function cubicTangent(
  t: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  const u = 1 - t;
  return {
    x: 3 * u * u * (x1 - x0) + 6 * u * t * (x2 - x1) + 3 * t * t * (x3 - x2),
    y: 3 * u * u * (y1 - y0) + 6 * u * t * (y2 - y1) + 3 * t * t * (y3 - y2),
  };
}

function drawPacket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  radius = 15,
) {
  ctx.save();
  const grd = ctx.createRadialGradient(x, y, 1, x, y, radius);
  grd.addColorStop(0, "rgba(255,255,255,0.98)");
  grd.addColorStop(0.22, color);
  grd.addColorStop(0.55, color);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function GraphCanvas({
  nodes,
  edges,
  visual,
  source,
  destination,
  failedNodes,
  failedEdges,
  pathLoopT,
  pendingEvent,
  pendingProgress,
  pathLoopActive,
  onNodeMove,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const dragRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const [hover, setHover] = useState<{
    kind: "node" | "edge";
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const contentSize = useMemo(() => {
    const padding = 140;
    const maxX = nodes.reduce((max, n) => Math.max(max, n.x), 0);
    const maxY = nodes.reduce((max, n) => Math.max(max, n.y), 0);
    return {
      w: Math.max(size.w, maxX + padding, 640),
      h: Math.max(size.h, maxY + padding, 420),
    };
  }, [nodes, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    return () => ro.disconnect();
  }, []);

  const nodeById = useCallback(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = contentSize.w * dpr;
    c.height = contentSize.h * dpr;
    c.style.width = `${contentSize.w}px`;
    c.style.height = `${contentSize.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, contentSize.w, contentSize.h);

    const map = nodeById();
    const ac = algoColor(visual.lastAlgo);

    const pathPairs: { from: string; to: string; seg: number }[] = [];
    if (visual.finalPath && visual.finalPath.length >= 2) {
      for (let i = 0; i < visual.finalPath.length - 1; i++) {
        pathPairs.push({
          from: visual.finalPath[i],
          to: visual.finalPath[i + 1],
          seg: i,
        });
      }
    }

    const pathKey = (a: string, b: string) => edgeKey(a, b);
    const pathSegIndex = new Map<string, number>();
    for (const p of pathPairs) {
      pathSegIndex.set(pathKey(p.from, p.to), p.seg);
    }

    const drawEdge = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      w: number,
      opts: {
        highlight: boolean;
        relax: boolean;
        failed: boolean;
        dash?: boolean;
        stroke: string;
        glow?: number;
        label?: string;
      },
    ) => {
      const { cx1, cy1, cx2, cy2 } = edgeCurveParams(x1, y1, x2, y2);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, x2, y2);
      if (opts.failed) {
        ctx.strokeStyle = "rgba(248,113,113,0.55)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
      } else if (opts.relax) {
        ctx.strokeStyle = opts.stroke;
        ctx.lineWidth = 4.5;
        ctx.shadowColor = opts.stroke;
        ctx.shadowBlur = opts.glow ?? 18;
        ctx.setLineDash([12, 7]);
      } else if (opts.highlight) {
        ctx.strokeStyle = opts.stroke;
        ctx.lineWidth = 4;
        ctx.shadowColor = opts.stroke;
        ctx.shadowBlur = opts.glow ?? 14;
        ctx.setLineDash(opts.dash ? [14, 9] : []);
      } else {
        ctx.strokeStyle = "rgba(148,163,184,0.32)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      const tx = mx + nx * 10;
      const ty = my + ny * 10;
      ctx.font = "12px DM Sans, system-ui";
      ctx.fillStyle = opts.failed ? "rgba(248,113,113,0.9)" : "rgba(226,232,240,0.88)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(w), tx, ty);
      if (opts.label) {
        ctx.font = "10px DM Sans, system-ui";
        ctx.fillStyle = opts.failed ? "rgba(248,113,113,0.9)" : "rgba(186,230,253,0.95)";
        ctx.fillText(opts.label, tx, ty + 14);
      }

      const ang = Math.atan2(y2 - y1, x2 - x1);
      const ah = 10;
      const aw = 6;
      const bx = x2 - Math.cos(ang) * 22;
      const by = y2 - Math.sin(ang) * 22;
      const arrowFill = opts.failed
        ? "rgba(248,113,113,0.8)"
        : opts.highlight || opts.relax
        ? opts.stroke
        : "rgba(148,163,184,0.55)";
      ctx.fillStyle = arrowFill;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ah * Math.cos(ang) + aw * Math.sin(ang), by - ah * Math.sin(ang) - aw * Math.cos(ang));
      ctx.lineTo(bx - ah * Math.cos(ang) - aw * Math.sin(ang), by - ah * Math.sin(ang) + aw * Math.cos(ang));
      ctx.closePath();
      ctx.fill();
      if (opts.highlight || opts.relax) {
        const t = 0.56;
        const mid = cubicPoint(t, x1, y1, cx1, cy1, cx2, cy2, x2, y2);
        const tangent = cubicTangent(t, x1, y1, cx1, cy1, cx2, cy2, x2, y2);
        const ang2 = Math.atan2(tangent.y, tangent.x);
        const mx = 8;
        const my = 5;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(mid.x - mx * Math.cos(ang2) + my * Math.sin(ang2), mid.y - mx * Math.sin(ang2) - my * Math.cos(ang2));
        ctx.lineTo(mid.x - mx * Math.cos(ang2) - my * Math.sin(ang2), mid.y - mx * Math.sin(ang2) + my * Math.cos(ang2));
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    for (const e of edges) {
      const a = map.get(e.from);
      const b = map.get(e.to);
      if (!a || !b) continue;
      const ek = edgeKey(e.from, e.to);
      const failed = failedEdges.has(ek);
      const seg = pathSegIndex.get(ek);
      const onPath = seg !== undefined;
      const strokeColor = onPath ? pathColorForSegment(seg) : ac;
      const relax =
        visual.relaxEdge &&
        visual.relaxEdge.from === e.from &&
        visual.relaxEdge.to === e.to;
      const relaxMeta =
        visual.relaxMeta &&
        visual.relaxMeta.from === e.from &&
        visual.relaxMeta.to === e.to
          ? visual.relaxMeta
          : null;
      const candidateDistance =
        relaxMeta && relaxMeta.distFrom !== null
          ? relaxMeta.distFrom + e.weight
          : null;
      drawEdge(a.x, a.y, b.x, b.y, e.weight, {
        highlight: onPath,
        relax: Boolean(relax && !onPath),
        failed,
        dash: onPath || failed,
        stroke: strokeColor,
        glow: onPath ? 16 : 18,
        label: failed
          ? "disabled"
          : candidateDistance !== null
          ? `d=${candidateDistance.toFixed(1)}`
          : undefined,
      });
    }

    if (visual.highlightCycle) {
      const ce = edges.find(
        (x) =>
          x.from === visual.highlightCycle!.from && x.to === visual.highlightCycle!.to,
      );
      if (ce) {
        const a = map.get(ce.from);
        const b = map.get(ce.to);
        if (a && b) {
          ctx.save();
          ctx.strokeStyle = "#f87171";
          ctx.lineWidth = 4;
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 18;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    if (visual.matrixEdge) {
      const { i, j } = visual.matrixEdge;
      const e = edges.find((x) => x.from === i && x.to === j);
      if (e) {
        const a = map.get(e.from);
        const b = map.get(e.to);
        if (a && b) {
          ctx.save();
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 3;
          ctx.shadowColor = "#fbbf24";
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    const packetOnEdge = (from: string, to: string, t: number, color: string) => {
      const a = map.get(from);
      const b = map.get(to);
      if (!a || !b) return;
      const { cx1, cy1, cx2, cy2 } = edgeCurveParams(a.x, a.y, b.x, b.y);
      const p = cubicPoint(Math.max(0, Math.min(1, t)), a.x, a.y, cx1, cy1, cx2, cy2, b.x, b.y);
      drawPacket(ctx, p.x, p.y, color, 16);
    };

    if (
      pendingEvent?.type === "relax" &&
      pendingProgress > 0 &&
      pendingProgress <= 1
    ) {
      const from = String(pendingEvent.data.from ?? "");
      const to = String(pendingEvent.data.to ?? "");
      const pal = algoColor(pendingEvent.algo);
      const ease = 1 - Math.pow(1 - pendingProgress, 2);
      packetOnEdge(from, to, ease, pal);
    }

    if (pathLoopActive && visual.finalPath && visual.finalPath.length >= 2) {
      const p = visual.finalPath;
      const segs = p.length - 1;
      const f = (pathLoopT % 1) * segs;
      const si = Math.min(segs - 1, Math.floor(f));
      const t = f - si;
      const col = pathColorForSegment(si);
      packetOnEdge(p[si], p[si + 1], t, col);
    }

    for (const n of nodes) {
      const isSrc = n.id === source;
      const isDst = n.id === destination;
      const failed = failedNodes.has(n.id);
      const active = visual.activeNode === n.id || visual.fwFocus === n.id;
      const visited = visual.visited.has(n.id);
      const pulseVisit =
        pendingEvent?.type === "visit" &&
        String(pendingEvent.data.node ?? "") === n.id &&
        pendingProgress > 0;

      const r = isSrc || isDst ? 26 : 22;
      ctx.save();
      if (failed) {
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 16;
        ctx.strokeStyle = "#f87171";
      } else if (pulseVisit) {
        const pulse = 0.5 + 0.5 * Math.sin(pendingProgress * Math.PI);
        ctx.shadowColor = algoColor(pendingEvent.algo);
        ctx.shadowBlur = 12 + 16 * pulse;
        ctx.strokeStyle = algoColor(pendingEvent.algo);
      } else if (active) {
        ctx.shadowColor = ac;
        ctx.shadowBlur = 20;
        ctx.strokeStyle = ac;
      } else if (visited) {
        ctx.shadowColor = "rgba(56,189,248,0.35)";
        ctx.shadowBlur = 10;
        ctx.strokeStyle = "rgba(56,189,248,0.55)";
      } else {
        ctx.strokeStyle = "rgba(148,163,184,0.45)";
        ctx.shadowBlur = 0;
      }
      ctx.lineWidth = failed ? 3 : 2;
      const fill = failed ? "#3f0d0d" : isSrc ? "#0c1e2e" : isDst ? "#2a1a0c" : "#111827";
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = failed ? "#fecaca" : "#f8fafc";
      ctx.font = `600 ${isSrc || isDst ? 15 : 14}px Outfit, system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.id, n.x, n.y);

      const d = visual.distances[n.id];
      if (d !== undefined && Number.isFinite(d)) {
        ctx.font = "11px DM Sans, system-ui";
        ctx.fillStyle = "rgba(186,230,253,0.95)";
        ctx.fillText(`d=${d.toFixed(1)}`, n.x, n.y + r + 14);
      }
      ctx.restore();
    }
  }, [
    nodes,
    edges,
    visual,
    size,
    source,
    destination,
    failedNodes,
    failedEdges,
    pathLoopT,
    pendingEvent,
    pendingProgress,
    pathLoopActive,
    nodeById,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pickNode = (mx: number, my: number) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const d = Math.hypot(mx - n.x, my - n.y);
      if (d <= 28) return n;
    }
    return null;
  };

  const onDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const n = pickNode(mx, my);
    if (n) dragRef.current = { id: n.id, ox: mx - n.x, oy: my - n.y };
  };

  const onMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const d = dragRef.current;
    if (d) {
      onNodeMove(d.id, mx - d.ox, my - d.oy);
      setHover(null);
      return;
    }
    const n = pickNode(mx, my);
    if (n) {
      const dist = visual.distances[n.id];
      const rm = visual.relaxMeta;
      let extra = "";
      if (rm && (rm.from === n.id || rm.to === n.id)) {
        extra = rm.from === n.id ? ` · relaxing out (w=${rm.weight})` : ` · relax target`;
      }
      setHover({
        kind: "node",
        text: `Node ${n.id}${dist !== undefined ? ` · best d=${dist.toFixed(2)}` : ""}${extra}`,
        x: e.clientX,
        y: e.clientY,
      });
      return;
    }
    const map = nodeById();
    let best: { e: GraphEdge; d: number } | null = null;
    for (const ed of edges) {
      const a = map.get(ed.from);
      const b = map.get(ed.to);
      if (!a || !b) continue;
      const px = mx - a.x;
      const py = my - a.y;
      const lx = b.x - a.x;
      const ly = b.y - a.y;
      const t = Math.max(0, Math.min(1, (px * lx + py * ly) / (lx * lx + ly * ly || 1)));
      const qx = a.x + t * lx;
      const qy = a.y + t * ly;
      const dist = Math.hypot(mx - qx, my - qy);
      if (dist < 10 && (!best || dist < best.d)) best = { e: ed, d: dist };
    }
    if (best) {
      setHover({
        kind: "edge",
        text: `${best.e.from} → ${best.e.to} · w=${best.e.weight}`,
        x: e.clientX,
        y: e.clientY,
      });
    } else setHover(null);
  };

  const onUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-[360px] w-full overflow-auto rounded-xl ring-1 ring-white/10"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 70% 55% at 50% 35%, rgba(168,85,247,0.14), transparent), linear-gradient(rgba(244,63,94,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(147,51,234,0.06) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 28px 28px, 28px 28px",
        }}
      />
      <canvas
        ref={canvasRef}
        className="block cursor-grab active:cursor-grabbing"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={() => {
          onUp();
          setHover(null);
        }}
      />
      {hover && (
        <div
          className="pointer-events-none fixed z-50 rounded-lg border border-cyan-400/25 bg-night-900/95 px-2.5 py-1.5 text-xs text-slate-100 shadow-[0_0_20px_rgba(56,189,248,0.25)]"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}
