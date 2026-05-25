import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkBackend, runRouting } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import {
  algoColor,
  eventDurationMs,
  foldEvents,
  initialLayoutIndex,
} from "./graphVisual";
import type { AlgoKey, GraphEdge, GraphNode, SimEvent } from "./types";

type SpeedPreset = "slow" | "normal" | "fast";

function makeNodeId(existing: Set<string>): string {
  for (let i = 0; i < 26; i++) {
    const id = String.fromCharCode(65 + i);
    if (!existing.has(id)) return id;
  }
  let k = 27;
  while (existing.has(`N${k}`)) k++;
  return `N${k}`;
}

function algoLabel(a: string) {
  if (a === "bellman_ford") return "Bellman-Ford";
  if (a === "floyd_warshall") return "Floyd-Warshall";
  if (a === "johnson") return "Johnson";
  if (a === "dijkstra") return "Dijkstra";
  return a;
}

export default function App() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeWeight, setEdgeWeight] = useState("1");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [failedNodes, setFailedNodes] = useState<Set<string>>(() => new Set());
  const [failedEdges, setFailedEdges] = useState<Set<string>>(() => new Set());
  const [selectedMode, setSelectedMode] = useState<AlgoKey>("bellman_ford");
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingProgress, setPendingProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedPreset>("normal");
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [pathLoopT, setPathLoopT] = useState(0);

  const playbackRef = useRef({ step: 0, prog: 0 });
  const rafRef = useRef<number>(0);

  const [comparison, setComparison] = useState<
    | {
        results: {
          algo: string;
          success: boolean;
          error?: string;
          path?: string[];
          cost?: number;
          events: SimEvent[];
        }[];
        best: { algo: string; cost: number; path: string[] } | null;
      }
    | null
  >(null);
  const [lastSingle, setLastSingle] = useState<{
    algo: string;
    success: boolean;
    error?: string;
    path?: string[];
    cost?: number;
  } | null>(null);

  useEffect(() => {
    checkBackend().then(setBackendOk);
    const t = setInterval(() => checkBackend().then(setBackendOk), 8000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    playbackRef.current = { step: stepIndex, prog: pendingProgress };
  }, [stepIndex, pendingProgress]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    if (!playing || events.length === 0) return;

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;

      let { step, prog } = playbackRef.current;
      if (step >= events.length) {
        stopPlayback();
        setPendingProgress(0);
        return;
      }

      const ev = events[step];
      const dur = eventDurationMs(ev, speed);
      prog += dt / dur;

      while (prog >= 1 && step < events.length) {
        prog -= 1;
        step += 1;
      }

      playbackRef.current = { step, prog };
      setStepIndex(step);
      setPendingProgress(prog);

      if (step < events.length || prog > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stopPlayback();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, events, speed, stopPlayback]);

  const visual = useMemo(() => foldEvents(events, stepIndex), [events, stepIndex]);

  const pendingEvent =
    pendingProgress > 0 && stepIndex < events.length ? events[stepIndex] : null;

  const currentEventIndex =
    pendingProgress > 0 ? stepIndex : stepIndex > 0 ? stepIndex - 1 : -1;
  const currentEvent = currentEventIndex >= 0 ? events[currentEventIndex] : null;

  const visibleEvents = useMemo(
    () =>
      events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => event.type !== "distance"),
    [events],
  );

  const currentVisibleEventIndex = useMemo(() => {
    return (
      visibleEvents
        .map(({ index }) => index)
        .filter((i) => i <= currentEventIndex)
        .at(-1) ?? -1
    );
  }, [visibleEvents, currentEventIndex]);

  const pathLoopActive =
    !playing &&
    events.length > 0 &&
    stepIndex >= events.length &&
    Boolean(visual.finalPath && visual.finalPath.length >= 2);

  useEffect(() => {
    if (!pathLoopActive) return;
    let id: number;
    const loop = () => {
      setPathLoopT((t) => (t + 0.0028) % 1);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [pathLoopActive]);

  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const addNode = () => {
    const id = makeNodeId(nodeIds);
    const i = nodes.length;
    const { x, y } = initialLayoutIndex(i, Math.max(i + 1, 1), 400, 260, 160);
    setNodes((prev) => [...prev, { id, x, y }]);
    if (!source) setSource(id);
    if (!destination && id !== source) setDestination(id);
    setBanner(null);
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setFailedNodes((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
    setFailedEdges((prev) => {
      const n = new Set(prev);
      for (const k of n) {
        const [a, b] = k.split("→");
        if (a === id || b === id) n.delete(k);
      }
      return n;
    });
    if (source === id) setSource("");
    if (destination === id) setDestination("");
    if (edgeFrom === id) setEdgeFrom("");
    if (edgeTo === id) setEdgeTo("");
    setBanner(null);
  };

  const toggleFailNode = (id: string) => {
    setFailedNodes((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleFailEdge = (from: string, to: string) => {
    const k = `${from}→${to}`;
    setFailedEdges((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const addEdge = () => {
    const w = Number(edgeWeight);
    if (!edgeFrom || !edgeTo) {
      setBanner("Select both endpoints for the edge.");
      return;
    }
    if (!nodeIds.has(edgeFrom) || !nodeIds.has(edgeTo)) {
      setBanner("Unknown node in edge.");
      return;
    }
    if (!Number.isFinite(w)) {
      setBanner("Weight must be a valid number (positive or negative).");
      return;
    }
    setEdges((prev) => {
      const next = prev.filter((e) => !(e.from === edgeFrom && e.to === edgeTo));
      return [...next, { from: edgeFrom, to: edgeTo, weight: w }];
    });
    setBanner(null);
  };

  const runSimulation = async () => {
    setBanner(null);
    stopPlayback();
    if (nodes.length === 0) {
      setBanner("Add at least one node.");
      return;
    }
    if (!source || !destination) {
      setBanner("Choose source and destination.");
      return;
    }
    setBusy(true);
    try {
      const res = await runRouting({
        nodes,
        edges,
        source,
        destination,
        mode: selectedMode,
        failedNodes: [...failedNodes],
        failedEdges: [...failedEdges].map((k) => {
          const [from, to] = k.split("→");
          return { from, to };
        }),
      });
      if (!res.ok) {
        setEvents([]);
        setStepIndex(0);
        setPendingProgress(0);
        playbackRef.current = { step: 0, prog: 0 };
        setComparison(null);
        setLastSingle(null);
        setBanner(res.error);
        return;
      }
      if (res.mode === "all") {
        const flat: SimEvent[] = [];
        for (const r of res.results) {
          flat.push({
            algo: r.algo,
            type: "start",
            message: `── ${algoLabel(r.algo)} (comparison) ──`,
            data: { section: true },
          });
          flat.push(...r.events);
        }
        setEvents(flat);
        setComparison({
          results: res.results.map((r) => ({
            algo: r.algo,
            success: r.success,
            error: r.error,
            path: r.path,
            cost: r.cost,
            events: r.events,
          })),
          best: res.best,
        });
        setLastSingle(null);
      } else {
        setEvents(res.result.events);
        setComparison(null);
        setLastSingle({
          algo: res.result.algo,
          success: res.result.success,
          error: res.result.error,
          path: res.result.path,
          cost: res.result.cost,
        });
      }
      setStepIndex(0);
      setPendingProgress(0);
      playbackRef.current = { step: 0, prog: 0 };
    } finally {
      setBusy(false);
    }
  };

  const onNodeMove = (id: string, x: number, y: number) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  };

  const prevStep = () => {
    stopPlayback();
    const prev = Math.max(stepIndex - 1, 0);
    playbackRef.current = { step: prev, prog: 0 };
    setStepIndex(prev);
    setPendingProgress(0);
  };

  const stepOnce = () => {
    stopPlayback();
    const next = Math.min(stepIndex + 1, events.length);
    playbackRef.current = { step: next, prog: 0 };
    setStepIndex(next);
    setPendingProgress(0);
  };

  const resetSim = () => {
    stopPlayback();
    setStepIndex(0);
    setPendingProgress(0);
    playbackRef.current = { step: 0, prog: 0 };
    setEvents([]);
    setComparison(null);
    setLastSingle(null);
  };

  const togglePlay = () => {
    if (playing) {
      stopPlayback();
      return;
    }
    if (events.length === 0) return;
    if (stepIndex >= events.length) {
      playbackRef.current = { step: 0, prog: 0 };
      setStepIndex(0);
      setPendingProgress(0);
    }
    setPlaying(true);
  };

  /** Log shows full trace; styling reflects applied (stepIndex) vs upcoming. */
  const logScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logScrollRef.current;
    if (!el || visibleEvents.length === 0) return;
    const idx = currentVisibleEventIndex >= 0 ? currentVisibleEventIndex : visibleEvents[0]?.index ?? -1;
    if (idx < 0) return;
    const row = el.querySelector(`[data-log-idx="${idx}"]`) as HTMLElement | null;
    if (!row) return;
    const pad = 12;
    const rowTop = row.offsetTop;
    const rowBot = rowTop + row.offsetHeight;
    const viewTop = el.scrollTop;
    const viewBot = viewTop + el.clientHeight;
    if (rowTop < viewTop + pad) {
      el.scrollTo({ top: Math.max(0, rowTop - pad), behavior: "smooth" });
    } else if (rowBot > viewBot - pad) {
      el.scrollTo({ top: rowBot - el.clientHeight + pad, behavior: "smooth" });
    }
  }, [currentVisibleEventIndex, visibleEvents]);

  const calcOverlay = useMemo(() => {
    const overlayEvent = pendingProgress > 0 ? pendingEvent : currentEvent;
    if (events.length === 0 || !overlayEvent || overlayEvent.type === "distance") return null;
    const lines: string[] = [];
    lines.push(`${algoLabel(overlayEvent.algo)} · ${overlayEvent.type}`);
    if (overlayEvent.type === "relax") {
      const u = String(overlayEvent.data.from ?? "");
      const v = String(overlayEvent.data.to ?? "");
      const w = Number(overlayEvent.data.weight ?? overlayEvent.data.weightPrime ?? NaN);
      const dfRaw = overlayEvent.data.distFrom;
      const df =
        typeof dfRaw === "number" && Number.isFinite(dfRaw)
          ? dfRaw
          : visual.distances[u];
      if (df !== undefined && Number.isFinite(df) && Number.isFinite(w)) {
        const cand = df + w;
        const dv = visual.distances[v];
        lines.push(`Try: d(${u}) + w = ${df.toFixed(2)} + ${w} = ${cand.toFixed(2)}`);
        if (dv !== undefined && Number.isFinite(dv)) {
          lines.push(
            `Current d(${v}) = ${dv.toFixed(2)} → ${cand < dv - 1e-9 ? "improve ✓" : "skip"}`,
          );
        } else {
          lines.push(`Current d(${v}) = ∞ (tentative ${cand.toFixed(2)})`);
        }
      }
    }
    if (overlayEvent.type === "visit") {
      lines.push(`Scanning node ${String(overlayEvent.data.node ?? "")}`);
    }
    if (overlayEvent.type === "matrix_update") {
      lines.push(
        `Floyd: dist(${overlayEvent.data.i}→${overlayEvent.data.j}) via ${overlayEvent.data.k} = ${Number(
          overlayEvent.data.newDist,
        ).toFixed(2)}`,
      );
    }
    if (overlayEvent.type === "fw_k") {
      lines.push(`Floyd: use intermediate ${overlayEvent.data.k}`);
    }
    if (overlayEvent.type === "start") {
      lines.push("Reset tentative distances; algorithm begins.");
    }
    if (overlayEvent.type === "path_found") {
      lines.push("Highlighting shortest path on the graph.");
    }
    return lines.length ? lines : null;
  }, [currentEvent, pendingEvent, visual.distances, events.length]);

  const fwMatrixRows = useMemo(() => {
    const ids = [...nodes.map((n) => n.id)].sort();
    if (ids.length === 0 || ids.length > 8) return null;
    const m = visual.fwMatrix;
    if (Object.keys(m).length === 0) return null;
    return ids;
  }, [nodes, visual.fwMatrix]);

  return (
    <div className="app-shell flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden text-slate-100">
      <header className="relative z-10 shrink-0 border-b border-fuchsia-500/15 bg-gradient-to-r from-[#1a0f24]/95 via-[#120a18]/95 to-[#0f0a12]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1920px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-fuchsia-400/30 bg-gradient-to-br from-fuchsia-600/25 to-[#1a1020] shadow-[0_0_22px_rgba(192,38,211,0.22)]">
              <span className="text-xl text-fuchsia-200">⮂</span>
            </div>
            <div>
              <h1 className="font-display text-lg font-semibold tracking-tight text-white sm:text-xl">
                Smart Network Routing Visualizer
              </h1>
              <p className="text-xs text-slate-400">
                C++ shortest-path core · step replay · multi-color packet travel
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                backendOk
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
                  : backendOk === false
                    ? "bg-red-500/15 text-red-300 ring-1 ring-red-400/30"
                    : "bg-slate-500/15 text-slate-400"
              }`}
            >
              {backendOk === null
                ? "Backend …"
                : backendOk
                  ? "C++ backend online"
                  : "Start backend :8787"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row lg:gap-4">
        <aside className="order-2 flex min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden lg:order-1 lg:w-[300px] lg:shrink-0">
          <section className="rounded-2xl border border-white/10 bg-[#14101a]/90 p-4 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ring-1 ring-fuchsia-500/10">
            <h2 className="font-display text-sm font-semibold text-fuchsia-300">Network</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addNode}
                className="rounded-lg bg-fuchsia-500/20 px-3 py-2 text-sm font-medium text-fuchsia-200 ring-1 ring-fuchsia-400/40 transition hover:bg-fuchsia-500/30"
              >
                Add node
              </button>
            </div>
            <ul className="mt-3 max-h-40 space-y-1 overflow-auto text-sm">
              {nodes.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-night-850/90 px-2 py-1.5 ring-1 ring-white/5"
                >
                  <span className="font-medium text-slate-100">{n.id}</span>
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-wide text-rose-300/90">
                      <input
                        type="checkbox"
                        checked={failedNodes.has(n.id)}
                        onChange={() => toggleFailNode(n.id)}
                      />
                      fail
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteNode(n.id)}
                      className="rounded-md bg-rose-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-200 ring-1 ring-rose-400/35 hover:bg-rose-500/25"
                      title="Remove node and incident edges"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
              {nodes.length === 0 && (
                <li className="text-slate-500">No nodes — add nodes to begin.</li>
              )}
            </ul>

            <h3 className="mt-4 font-display text-xs font-semibold uppercase tracking-wide text-slate-500">
              Add edge
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                value={edgeFrom}
                onChange={(e) => setEdgeFrom(e.target.value)}
                className="rounded-lg border border-white/10 bg-night-950 px-2 py-2 text-sm"
              >
                <option value="">From</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
              <select
                value={edgeTo}
                onChange={(e) => setEdgeTo(e.target.value)}
                className="rounded-lg border border-white/10 bg-night-950 px-2 py-2 text-sm"
              >
                <option value="">To</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <input
                type="number"
                step="any"
                value={edgeWeight}
                onChange={(e) => setEdgeWeight(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-night-950 px-3 py-2 text-sm"
                placeholder="Weight (positive or negative)"
              />
              <p className="text-[10px] text-slate-500">Enter any numeric weight; negative values are allowed.</p>
              <button
                type="button"
                onClick={addEdge}
                className="shrink-0 rounded-lg bg-orange-500/20 px-3 py-2 text-sm font-medium text-orange-200 ring-1 ring-orange-400/40 hover:bg-orange-500/30"
              >
                Add
              </button>
            </div>
            <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-xs text-slate-400">
              {edges.map((e) => (
                <li key={`${e.from}-${e.to}`} className="flex justify-between gap-2">
                  <span>
                    {e.from} → {e.to} ({e.weight})
                  </span>
                  <label className="flex items-center gap-1 text-rose-300">
                    <input
                      type="checkbox"
                      checked={failedEdges.has(`${e.from}→${e.to}`)}
                      onChange={() => toggleFailEdge(e.from, e.to)}
                    />
                    fail
                  </label>
                </li>
              ))}
            </ul>

            <h3 className="mt-4 font-display text-xs font-semibold uppercase tracking-wide text-slate-500">
              Routing
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-lg border border-white/10 bg-night-950 px-2 py-2 text-sm"
              >
                <option value="">Source</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
              <select
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="rounded-lg border border-white/10 bg-night-950 px-2 py-2 text-sm"
              >
                <option value="">Destination</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
            </div>
            {source &&
              destination &&
              source === destination &&
              nodes.length > 1 && (
                <p className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200/95">
                  Source and destination are identical — cost stays 0. Choose another destination to see edges relax and packets move.
                </p>
              )}

            <button
              type="button"
              disabled={busy}
              onClick={runSimulation}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 via-violet-600 to-rose-700 py-3 font-display text-sm font-semibold text-white shadow-[0_0_28px_rgba(192,38,211,0.35)] transition hover:brightness-110 disabled:opacity-50"
            >
              {busy ? "Computing…" : "Run simulation"}
            </button>
            {banner && (
              <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-2 text-xs text-red-200">
                {banner}
              </p>
            )}
          </section>
        </aside>

        <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden lg:order-2">
          <section className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-[#14101a]/80 px-3 py-2.5 backdrop-blur-md ring-1 ring-fuchsia-500/10">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["bellman_ford", "Bellman-Ford", "text-cyan-300 border-cyan-400/45"],
                  ["dijkstra", "Dijkstra", "text-emerald-300 border-emerald-400/45"],
                  ["floyd_warshall", "Floyd-Warshall", "text-amber-300 border-amber-400/45"],
                  ["johnson", "Johnson", "text-orange-300 border-orange-400/45"],
                ] as const
              ).map(([key, label, cls]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedMode(key)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 transition sm:text-sm ${
                    selectedMode === key ? `${cls} bg-white/5 shadow-[0_0_16px_rgba(255,255,255,0.08)]` : "border border-white/10 text-slate-500"
                  }`}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSelectedMode("run_all")}
                className={`rounded-lg px-3 py-2 text-xs font-semibold ring-1 transition sm:text-sm ${
                  selectedMode === "run_all"
                    ? "border border-violet-400/50 bg-violet-500/15 text-violet-200 shadow-[0_0_16px_rgba(139,92,246,0.25)]"
                    : "border border-white/10 text-slate-500"
                }`}
              >
                Run all
              </button>
            </div>
            <div className="mx-1 hidden h-6 w-px bg-white/10 sm:block" />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={prevStep}
                disabled={events.length === 0 || stepIndex <= 0}
                className="rounded-lg border border-white/15 bg-night-850 px-3 py-2 text-xs font-medium hover:bg-night-800 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={stepOnce}
                disabled={events.length === 0 || stepIndex >= events.length}
                className="rounded-lg border border-white/15 bg-night-850 px-3 py-2 text-xs font-medium hover:bg-night-800 disabled:opacity-40"
              >
                Step
              </button>
              <button
                type="button"
                onClick={togglePlay}
                disabled={events.length === 0}
                className="rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                onClick={stepOnce}
                disabled={events.length === 0 || stepIndex >= events.length}
                className="rounded-lg border border-white/15 bg-night-850 px-3 py-2 text-xs font-medium hover:bg-night-800 disabled:opacity-40"
              >
                Forward
              </button>
              <button
                type="button"
                onClick={resetSim}
                className="rounded-lg border border-white/15 bg-night-850 px-3 py-2 text-xs font-medium hover:bg-night-800"
              >
                Stop
              </button>
              <select
                value={speed}
                onChange={(e) => setSpeed(e.target.value as SpeedPreset)}
                className="rounded-lg border border-white/10 bg-night-950 px-2 py-2 text-xs"
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </div>
            {events.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-slate-500">
                frame {stepIndex}/{events.length}
                {playing ? ` · ${(pendingProgress * 100).toFixed(0)}%` : ""}
              </span>
            )}
          </section>

          <section className="relative min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-fuchsia-500/20 bg-gradient-to-b from-[#1a1222]/80 to-[#0a060c]/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {calcOverlay && (
              <div className="absolute left-4 top-4 box-border w-full max-w-[22rem] rounded-xl border border-violet-500/25 bg-night-950/90 px-4 py-4 text-xs text-slate-200 shadow-lg backdrop-blur-md">
                <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-violet-300/90">
                  Current operation
                </p>
                {calcOverlay.map((line, i) => (
                  <p key={i} className={i === 0 ? "mt-2 font-semibold text-violet-100" : "mt-1 text-slate-300"}>
                    {line}
                  </p>
                ))}
              </div>
            )}

            {fwMatrixRows && (
              <div className="absolute bottom-3 left-3 z-20 max-h-48 overflow-auto rounded-xl border border-amber-500/25 bg-night-950/95 p-2 text-[10px] shadow-xl backdrop-blur-md">
                <p className="mb-1 font-display font-semibold uppercase tracking-wider text-amber-300/90">
                  Floyd matrix (partial)
                </p>
                <table className="border-collapse font-mono">
                  <thead>
                    <tr>
                      <th className="p-1 text-slate-500" />
                      {fwMatrixRows.map((c) => (
                        <th key={c} className="p-1 text-amber-200/80">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fwMatrixRows.map((r) => (
                      <tr key={r}>
                        <td className="p-1 text-amber-200/80">{r}</td>
                        {fwMatrixRows.map((c) => {
                          const v = visual.fwMatrix[r]?.[c];
                          const inf = v === undefined || !Number.isFinite(v) || v > 1e200;
                          return (
                            <td
                              key={c}
                              className={`border border-white/5 px-1.5 py-0.5 text-center ${
                                visual.matrixEdge?.i === r && visual.matrixEdge?.j === c
                                  ? "bg-amber-500/25 text-amber-100"
                                  : "text-slate-400"
                              }`}
                            >
                              {inf ? "∞" : (v as number).toFixed(0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="absolute inset-0">
              <GraphCanvas
                nodes={nodes}
                edges={edges}
                visual={visual}
                source={source}
                destination={destination}
                failedNodes={failedNodes}
                failedEdges={failedEdges}
                pathLoopT={pathLoopT}
                pendingEvent={pendingEvent}
                pendingProgress={pendingProgress}
                pathLoopActive={pathLoopActive}
                onNodeMove={onNodeMove}
              />
            </div>
            {visual.error && (
              <div className="pointer-events-none absolute left-4 top-28 z-30 max-w-sm rounded-xl border border-red-500/40 bg-red-950/90 px-4 py-3 text-sm text-red-100 shadow-lg">
                {visual.error}
              </div>
            )}
          </section>
        </main>

        <aside className="order-3 flex min-h-0 w-full flex-col lg:order-3 lg:w-[320px] lg:shrink-0">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#14101a]/90 p-4 shadow-xl backdrop-blur-xl ring-1 ring-rose-500/15">
            <h2 className="shrink-0 font-display text-sm font-semibold text-rose-200/90">Event log</h2>
            <p className="mt-0.5 shrink-0 text-[10px] text-slate-500">Scrolls here only — graph stays in view.</p>
            <div
              ref={logScrollRef}
              className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain pr-1 text-xs leading-relaxed [scrollbar-gutter:stable]"
            >
              {visibleEvents.length === 0 && (
                <p className="text-slate-500">Run a simulation to stream C++ events.</p>
              )}
              {visibleEvents.map(({ event: ev, index }, idx) => {
                const dot =
                  ev.algo === "bellman_ford"
                    ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                    : ev.algo === "dijkstra"
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]"
                    : ev.algo === "floyd_warshall"
                      ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
                      : ev.algo === "johnson"
                        ? "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.5)]"
                        : "bg-slate-400";
                const applied = index < currentVisibleEventIndex;
                const current = index === currentVisibleEventIndex;
                return (
                  <div
                    key={`${idx}-${ev.type}-${ev.message.slice(0, 24)}`}
                    data-log-idx={index}
                    className={`flex gap-2 rounded-lg px-2 py-1.5 transition ${
                      current
                        ? "bg-fuchsia-500/15 ring-1 ring-fuchsia-400/35"
                        : applied
                          ? "bg-white/[0.04] opacity-95"
                          : "opacity-35"
                    }`}
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-slate-100">{ev.message}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        {algoLabel(ev.algo)} · {ev.type}
                        {applied ? " · done" : current ? " · active" : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>

      <footer className="shrink-0 border-t border-white/10 bg-gradient-to-t from-[#0a060c] to-[#120a18]/98 px-4 py-2.5 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-1.5">
          {comparison ? (
            <div className="flex flex-col gap-1 font-mono text-[13px] leading-relaxed text-slate-300">
              {comparison.results.map((r) => (
                <p key={r.algo}>
                  <span style={{ color: algoColor(r.algo) }} className="font-semibold">
                    {algoLabel(r.algo)}
                  </span>
                  <span className="text-slate-500"> → </span>
                  <span className="text-slate-200">Steps: {r.events.length}</span>
                  {!r.success && (
                    <span className="ml-2 text-xs text-red-400/90">({r.error ?? "failed"})</span>
                  )}
                </p>
              ))}
            </div>
          ) : (
            <div className="font-mono text-[13px] text-slate-300">
              {lastSingle ? (
                !lastSingle.success ? (
                  <p className="text-red-400">
                    {algoLabel(lastSingle.algo)} → {lastSingle.error ?? "Failed"}
                  </p>
                ) : (
                  <>
                    <p>
                      <span style={{ color: algoColor(lastSingle.algo) }} className="font-semibold">
                        {algoLabel(lastSingle.algo)}
                      </span>
                      <span className="text-slate-500"> → </span>
                      <span className="text-slate-200">Steps: {events.length}</span>
                    </p>
                    {lastSingle.path && lastSingle.path.length >= 2 && lastSingle.cost !== undefined && (
                      <p className="text-slate-400">
                        Distance {lastSingle.path[0]} → {lastSingle.path[lastSingle.path.length - 1]} = {lastSingle.cost.toFixed(2)}
                      </p>
                    )}
                  </>
                )
              ) : (
                <p className="text-slate-500">No run yet.</p>
              )}
            </div>
          )}

          {comparison?.best && (
            <p className="border-t border-white/5 pt-1.5 font-display text-xs font-semibold text-amber-200/95">
              Best: {algoLabel(comparison.best.algo)} · cost {comparison.best.cost.toFixed(4)} ·{" "}
              {comparison.best.path.join(" → ")}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
