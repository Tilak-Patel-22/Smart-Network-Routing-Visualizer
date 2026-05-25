import type { SimEvent } from "./types";

export type VisualState = {
  activeNode: string | null;
  relaxEdge: { from: string; to: string } | null;
  relaxMeta: { from: string; to: string; weight: number; distFrom: number | null } | null;
  visited: Set<string>;
  distances: Record<string, number>;
  finalPath: string[] | null;
  highlightCycle: { from: string; to: string } | null;
  fwFocus: string | null;
  matrixEdge: { i: string; j: string; k: string } | null;
  fwMatrix: Record<string, Record<string, number>>;
  lastAlgo: string | null;
  error: string | null;
};

export function foldEvents(events: SimEvent[], upToExclusive: number): VisualState {
  const s: VisualState = {
    activeNode: null,
    relaxEdge: null,
    relaxMeta: null,
    visited: new Set(),
    distances: {},
    finalPath: null,
    highlightCycle: null,
    fwFocus: null,
    matrixEdge: null,
    fwMatrix: {},
    lastAlgo: null,
    error: null,
  };

  const end = Math.max(0, Math.min(upToExclusive, events.length));
  for (let i = 0; i < end; i++) {
    const ev = events[i];
    s.lastAlgo = ev.algo ?? s.lastAlgo;
    switch (ev.type) {
      case "start":
        s.error = null;
        s.highlightCycle = null;
        s.activeNode = null;
        s.relaxEdge = null;
        s.relaxMeta = null;
        s.finalPath = null;
        s.distances = {};
        s.visited = new Set();
        s.fwFocus = null;
        s.matrixEdge = null;
        s.fwMatrix = {};
        break;
      case "visit": {
        const node = String(ev.data.node ?? "");
        s.activeNode = node;
        if (node) s.visited.add(node);
        s.relaxEdge = null;
        s.relaxMeta = null;
        const dv = ev.data.dist;
        if (typeof dv === "number" && Number.isFinite(dv)) {
          s.distances[node] = dv;
        }
        break;
      }
      case "relax": {
        const from = String(ev.data.from ?? "");
        const to = String(ev.data.to ?? "");
        s.relaxEdge = { from, to };
        const w = Number(ev.data.weight ?? ev.data.weightPrime ?? NaN);
        const df = ev.data.distFrom;
        s.relaxMeta = {
          from,
          to,
          weight: Number.isFinite(w) ? w : 0,
          distFrom: typeof df === "number" && Number.isFinite(df) ? df : null,
        };
        break;
      }
      case "distance": {
        const node = String(ev.data.node ?? "");
        const value = Number(ev.data.value);
        if (node && Number.isFinite(value)) s.distances[node] = value;
        break;
      }
      case "path_found": {
        const path = ev.data.path as string[] | undefined;
        s.finalPath = path && Array.isArray(path) ? [...path] : null;
        s.relaxEdge = null;
        s.relaxMeta = null;
        break;
      }
      case "negative_cycle": {
        s.error = "Negative cycle detected";
        const ef = String(ev.data.edgeFrom ?? "");
        const et = String(ev.data.edgeTo ?? "");
        if (ef && et) s.highlightCycle = { from: ef, to: et };
        break;
      }
      case "no_path":
        s.error = "No valid path found";
        s.finalPath = null;
        break;
      case "fw_k": {
        const k = String(ev.data.k ?? "");
        s.fwFocus = k || null;
        s.matrixEdge = null;
        break;
      }
      case "matrix_update": {
        const ii = String(ev.data.i ?? "");
        const jj = String(ev.data.j ?? "");
        const nd = Number(ev.data.newDist);
        s.matrixEdge = {
          i: ii,
          j: jj,
          k: String(ev.data.k ?? ""),
        };
        s.fwFocus = String(ev.data.k ?? "") || s.fwFocus;
        if (ii && jj && Number.isFinite(nd)) {
          if (!s.fwMatrix[ii]) s.fwMatrix[ii] = {};
          s.fwMatrix[ii][jj] = nd;
        }
        break;
      }
      case "reweight":
        s.relaxEdge = null;
        s.relaxMeta = null;
        break;
      case "reweight_edge":
        s.relaxEdge = null;
        s.relaxMeta = null;
        break;
      default:
        break;
    }
  }
  return s;
}

export function algoColor(algo: string | null): string {
  if (!algo) return "#94a3b8";
  if (algo === "bellman_ford") return "#38bdf8";
  if (algo === "floyd_warshall") return "#fbbf24";
  if (algo === "johnson") return "#fb923c";
  if (algo === "dijkstra") return "#4ade80";
  return "#a78bfa";
}

/** Distinct hues for multi-hop path travel */
export const PATH_TRAVEL_COLORS = [
  "#38bdf8",
  "#c084fc",
  "#fb923c",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#818cf8",
];

export function pathColorForSegment(segmentIndex: number): string {
  return PATH_TRAVEL_COLORS[segmentIndex % PATH_TRAVEL_COLORS.length];
}

export function eventDurationMs(ev: SimEvent, speed: "slow" | "normal" | "fast"): number {
  const base = (() => {
    switch (ev.type) {
      case "relax":
        return 620;
      case "visit":
        return 380;
      case "distance":
        return 260;
      case "matrix_update":
        return 480;
      case "fw_k":
        return 400;
      case "reweight_edge":
        return 200;
      case "path_found":
        return 900;
      case "negative_cycle":
      case "no_path":
        return 700;
      case "start":
        return 500;
      default:
        return 280;
    }
  })();
  const mul = speed === "slow" ? 1.65 : speed === "fast" ? 0.55 : 1;
  return base * mul;
}

export function initialLayoutIndex(i: number, n: number, cx: number, cy: number, r: number) {
  const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
