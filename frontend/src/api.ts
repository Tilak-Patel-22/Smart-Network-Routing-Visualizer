import type { AlgoKey, GraphEdge, GraphNode, RunResponse, SimEvent } from "./types";

export async function runRouting(payload: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: string;
  destination: string;
  mode: AlgoKey;
  failedNodes: string[];
  failedEdges: { from: string; to: string }[];
}): Promise<RunResponse> {
  const body = {
    nodes: payload.nodes.map((n) => n.id),
    edges: payload.edges.map((e) => ({
      from: e.from,
      to: e.to,
      weight: e.weight,
    })),
    source: payload.source,
    destination: payload.destination,
    mode: payload.mode === "run_all" ? "run_all" : payload.mode,
    failedNodes: payload.failedNodes,
    failedEdges: payload.failedEdges,
    maxEvents: 4000,
  };

  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    return { ok: false, error: String(data.error ?? "Request failed") };
  }

  if (body.mode === "run_all") {
    const results = (data.results as Record<string, unknown>[]).map((r) => ({
      algo: String(r.algo),
      success: Boolean(r.success),
      error: r.error ? String(r.error) : undefined,
      path: r.path as string[] | undefined,
      cost: typeof r.cost === "number" ? r.cost : undefined,
      events: (r.events as unknown[]) as SimEvent[],
    }));
    const bestRaw = data.best as Record<string, unknown> | null;
    const best = bestRaw
      ? {
          algo: String(bestRaw.algo),
          cost: Number(bestRaw.cost),
          path: bestRaw.path as string[],
        }
      : null;
    return { ok: true, mode: "all", results, best };
  }

  const r = data.result as Record<string, unknown>;
  const result = {
    algo: String(r.algo),
    success: Boolean(r.success),
    error: r.error ? String(r.error) : undefined,
    path: r.path as string[] | undefined,
    cost: typeof r.cost === "number" ? r.cost : undefined,
    events: (r.events as unknown[]) as SimEvent[],
  };
  return { ok: true, mode: "single", result };
}

export async function checkBackend(): Promise<boolean> {
  try {
    const r = await fetch("/api/health");
    return r.ok;
  } catch {
    return false;
  }
}
