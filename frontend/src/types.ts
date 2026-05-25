export type AlgoKey =
  | "bellman_ford"
  | "floyd_warshall"
  | "johnson"
  | "dijkstra"
  | "run_all";

export type GraphNode = {
  id: string;
  x: number;
  y: number;
};

export type GraphEdge = {
  from: string;
  to: string;
  weight: number;
};

export type SimEvent = {
  algo: string;
  type: string;
  message: string;
  data: Record<string, unknown>;
};

export type AlgoResult = {
  algo: string;
  success: boolean;
  error?: string;
  path?: string[];
  cost?: number;
  events: SimEvent[];
};

export type RunResponse =
  | {
      ok: true;
      mode: "single";
      result: AlgoResult;
    }
  | {
      ok: true;
      mode: "all";
      results: AlgoResult[];
      best: { algo: string; cost: number; path: string[] } | null;
    }
  | { ok: false; error: string };
