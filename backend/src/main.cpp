#include <httplib.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <limits>
#include <map>
#include <queue>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();

struct Edge {
  int u;
  int v;
  double w;
  std::string from_id;
  std::string to_id;
};

struct Graph {
  int n = 0;
  std::vector<std::string> id_of;
  std::unordered_map<std::string, int> index_of;
  std::vector<Edge> edges;
  std::vector<std::vector<std::pair<int, double>>> adj;

  void rebuild_adj() {
    adj.assign(n, {});
    for (const auto &e : edges) {
      adj[e.u].push_back({e.v, e.w});
    }
  }
};

void push_event(json &events, const std::string &algo, const std::string &type,
                const std::string &message, const json &data = json::object()) {
  json ev;
  ev["algo"] = algo;
  ev["type"] = type;
  ev["message"] = message;
  ev["data"] = data;
  events.push_back(ev);
}

bool parse_graph(const json &body, Graph &g, std::string &err) {
  if (!body.contains("nodes") || !body["nodes"].is_array()) {
    err = "Graph incomplete: missing nodes array";
    return false;
  }
  if (!body.contains("edges") || !body["edges"].is_array()) {
    err = "Graph incomplete: missing edges array";
    return false;
  }
  g.id_of.clear();
  g.index_of.clear();
  g.edges.clear();
  int idx = 0;
  for (const auto &n : body["nodes"]) {
    if (!n.is_string()) {
      err = "Invalid input: node id must be string";
      return false;
    }
    std::string id = n.get<std::string>();
    if (id.empty()) {
      err = "Invalid input: empty node id";
      return false;
    }
    if (g.index_of.count(id)) {
      err = "Invalid input: duplicate node id";
      return false;
    }
    g.index_of[id] = idx++;
    g.id_of.push_back(id);
  }
  g.n = static_cast<int>(g.id_of.size());
  if (g.n == 0) {
    err = "Graph incomplete: no nodes";
    return false;
  }

  std::unordered_set<std::string> failed_nodes;
  if (body.contains("failedNodes") && body["failedNodes"].is_array()) {
    for (const auto &x : body["failedNodes"]) {
      if (x.is_string())
        failed_nodes.insert(x.get<std::string>());
    }
  }
  std::set<std::pair<std::string, std::string>> failed_edges;
  if (body.contains("failedEdges") && body["failedEdges"].is_array()) {
    for (const auto &e : body["failedEdges"]) {
      if (e.is_object() && e.contains("from") && e.contains("to") &&
          e["from"].is_string() && e["to"].is_string()) {
        failed_edges.insert({e["from"].get<std::string>(), e["to"].get<std::string>()});
      }
    }
  }

  for (const auto &e : body["edges"]) {
    if (!e.is_object() || !e.contains("from") || !e.contains("to") ||
        !e.contains("weight")) {
      err = "Invalid input: edge must have from, to, weight";
      return false;
    }
    std::string from = e["from"].get<std::string>();
    std::string to = e["to"].get<std::string>();
    if (!g.index_of.count(from) || !g.index_of.count(to)) {
      err = "Invalid input: edge references unknown node";
      return false;
    }
    if (failed_nodes.count(from) || failed_nodes.count(to))
      continue;
    if (failed_edges.count({from, to}))
      continue;
    double w;
    if (e["weight"].is_number()) {
      w = e["weight"].get<double>();
    } else {
      err = "Invalid input: weight must be number";
      return false;
    }
    if (!std::isfinite(w)) {
      err = "Invalid input: non-finite weight";
      return false;
    }
    int u = g.index_of[from];
    int v = g.index_of[to];
    g.edges.push_back(Edge{u, v, w, from, to});
  }
  g.rebuild_adj();
  return true;
}

bool parse_endpoints(const json &body, const Graph &g, int &src, int &dst,
                     std::string &err) {
  if (!body.contains("source") || !body["source"].is_string() ||
      !body.contains("destination") || !body["destination"].is_string()) {
    err = "Invalid input: source and destination required";
    return false;
  }
  std::string s = body["source"].get<std::string>();
  std::string t = body["destination"].get<std::string>();
  if (!g.index_of.count(s) || !g.index_of.count(t)) {
    err = "Invalid input: source or destination not in graph";
    return false;
  }
  src = g.index_of.at(s);
  dst = g.index_of.at(t);
  return true;
}

std::vector<int> reconstruct_bf(const std::vector<int> &parent, int src, int dst) {
  if (parent[dst] < 0 && dst != src)
    return {};
  std::vector<int> rev;
  int cur = dst;
  std::set<int> seen;
  while (true) {
    if (seen.count(cur))
      return {};
    seen.insert(cur);
    rev.push_back(cur);
    if (cur == src)
      break;
    if (parent[cur] < 0)
      return {};
    cur = parent[cur];
  }
  std::reverse(rev.begin(), rev.end());
  return rev;
}

json run_bellman_ford(const Graph &g, int src, int dst, int max_events) {
  const std::string algo = "bellman_ford";
  json events = json::array();
  json out;
  out["algo"] = algo;

  push_event(events, algo, "start", "Bellman-Ford algorithm started");

  std::vector<double> dist(g.n, kInf);
  std::vector<int> parent(g.n, -1);
  dist[src] = 0;

  push_event(events, algo, "visit",
             "Visiting node " + g.id_of[src],
             json{{"node", g.id_of[src]}, {"dist", 0}});

  int emitted = 0;
  const int passes = std::max(0, g.n - 1);
  for (int it = 0; it < passes; ++it) {
    bool any = false;
    for (const auto &e : g.edges) {
      if (emitted >= max_events)
        break;
      if (dist[e.u] == kInf)
        continue;
      push_event(events, algo, "relax",
                 "Relaxing edge " + e.from_id + " → " + e.to_id,
                 json{{"from", e.from_id},
                      {"to", e.to_id},
                      {"weight", e.w},
                      {"distFrom", dist[e.u]}});
      emitted++;
      double nd = dist[e.u] + e.w;
      if (nd < dist[e.v]) {
        dist[e.v] = nd;
        parent[e.v] = e.u;
        any = true;
        push_event(
            events, algo, "distance",
            "Updating distance to " + g.id_of[e.v] + ": " + std::to_string(nd),
            json{{"node", g.id_of[e.v]}, {"value", nd}, {"via", e.from_id}});
        emitted++;
      }
    }
    if (emitted >= max_events)
      break;
    if (!any)
      break;
  }

  for (const auto &e : g.edges) {
    if (dist[e.u] != kInf && dist[e.u] + e.w < dist[e.v] - 1e-12) {
      push_event(events, algo, "negative_cycle",
                 "Negative cycle detected",
                 json{{"edgeFrom", e.from_id}, {"edgeTo", e.to_id}});
      out["success"] = false;
      out["error"] = "Negative cycle detected";
      out["events"] = events;
      return out;
    }
  }

  if (dist[dst] == kInf) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  auto path_idx = reconstruct_bf(parent, src, dst);
  if (path_idx.empty()) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  json path = json::array();
  for (int v : path_idx)
    path.push_back(g.id_of[v]);

  push_event(events, algo, "path_found",
             "Final path found: " + path.dump(),
             json{{"path", path}, {"cost", dist[dst]}});

  out["success"] = true;
  out["path"] = path;
  out["cost"] = dist[dst];
  out["events"] = events;
  return out;
}

std::vector<int> reconstruct_fw(const std::vector<std::vector<int>> &next, int u,
                                  int v) {
  if (next[u][v] < 0)
    return {};
  std::vector<int> p = {u};
  while (u != v) {
    u = next[u][v];
    p.push_back(u);
  }
  return p;
}

json run_floyd_warshall(const Graph &g, int src, int dst, int max_events) {
  const std::string algo = "floyd_warshall";
  json events = json::array();
  json out;
  out["algo"] = algo;

  push_event(events, algo, "start", "Floyd-Warshall algorithm started");

  int n = g.n;
  std::vector<std::vector<double>> dist(
      n, std::vector<double>(n, kInf));
  std::vector<std::vector<int>> next(n, std::vector<int>(n, -1));

  for (int i = 0; i < n; ++i) {
    dist[i][i] = 0;
    next[i][i] = i;
  }
  for (const auto &e : g.edges) {
    if (e.w < dist[e.u][e.v]) {
      dist[e.u][e.v] = e.w;
      next[e.u][e.v] = e.v;
    }
  }

  int emitted = 0;
  for (int k = 0; k < n; ++k) {
    if (emitted >= max_events)
      break;
    push_event(events, algo, "fw_k",
               "Intermediate node " + g.id_of[k],
               json{{"k", g.id_of[k]}});
    emitted++;
    for (int i = 0; i < n; ++i) {
      for (int j = 0; j < n; ++j) {
        if (emitted >= max_events)
          break;
        if (dist[i][k] == kInf || dist[k][j] == kInf)
          continue;
        double nd = dist[i][k] + dist[k][j];
        if (nd < dist[i][j] - 1e-12) {
          dist[i][j] = nd;
          next[i][j] = next[i][k];
          push_event(events, algo, "matrix_update",
                     "Distance " + g.id_of[i] + " → " + g.id_of[j] + " improved via " +
                         g.id_of[k],
                     json{{"i", g.id_of[i]},
                          {"j", g.id_of[j]},
                          {"k", g.id_of[k]},
                          {"newDist", nd}});
          emitted++;
        }
      }
    }
  }

  for (int i = 0; i < n; ++i) {
    if (dist[i][i] < 0) {
      push_event(events, algo, "negative_cycle",
                 "Negative cycle detected (negative self-loop path)",
                 json{{"node", g.id_of[i]}});
      out["success"] = false;
      out["error"] = "Negative cycle detected";
      out["events"] = events;
      return out;
    }
  }

  if (dist[src][dst] == kInf) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  auto path_idx = reconstruct_fw(next, src, dst);
  if (path_idx.empty()) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  json path = json::array();
  for (int v : path_idx)
    path.push_back(g.id_of[v]);

  push_event(events, algo, "path_found", "Final path found",
             json{{"path", path}, {"cost", dist[src][dst]}});

  out["success"] = true;
  out["path"] = path;
  out["cost"] = dist[src][dst];
  out["events"] = events;
  return out;
}

json run_johnson(const Graph &g, int src, int dst, int max_events) {
  const std::string algo = "johnson";
  json events = json::array();
  json out;
  out["algo"] = algo;

  push_event(events, algo, "start", "Johnson's algorithm started");

  int n = g.n;
  int S = n;
  std::vector<Edge> edges_bf = g.edges;
  for (int i = 0; i < n; ++i) {
    edges_bf.push_back(
        Edge{S, i, 0.0, "__super__", g.id_of[i]});
  }

  std::vector<double> h(n + 1, kInf);
  h[S] = 0;

  for (int it = 0; it < n; ++it) {
    for (const auto &e : edges_bf) {
      if (h[e.u] == kInf)
        continue;
      double nd = h[e.u] + e.w;
      if (nd < h[e.v]) {
        h[e.v] = nd;
      }
    }
  }

  for (const auto &e : edges_bf) {
    if (h[e.u] != kInf && h[e.u] + e.w < h[e.v] - 1e-12) {
      push_event(events, algo, "negative_cycle",
                 "Negative cycle detected during reweighting phase",
                 json{});
      out["success"] = false;
      out["error"] = "Negative cycle detected";
      out["events"] = events;
      return out;
    }
  }

  int emitted = 0;

  push_event(events, algo, "reweight",
             "Graph reweighted for Dijkstra phase",
             json{});
  if (emitted < max_events)
    emitted++;

  std::vector<std::vector<std::pair<int, double>>> adjw(n);
  for (const auto &e : g.edges) {
    double w2 = e.w + h[e.u] - h[e.v];
    if (w2 < 0 && w2 > -1e-9)
      w2 = 0;
    adjw[e.u].push_back({e.v, w2});
    if (emitted < max_events) {
      push_event(events, algo, "reweight_edge",
                 "Edge " + e.from_id + " → " + e.to_id + " new weight " +
                     std::to_string(w2),
                 json{{"from", e.from_id}, {"to", e.to_id}, {"wPrime", w2}});
      emitted++;
    }
  }

  std::vector<double> dist(n, kInf);
  std::vector<int> par(n, -1);
  dist[src] = 0;

  using P = std::pair<double, int>;
  std::priority_queue<P, std::vector<P>, std::greater<P>> pq;
  pq.push({0, src});

  while (!pq.empty() && emitted < max_events) {
    auto [du, u] = pq.top();
    pq.pop();
    if (du > dist[u] + 1e-9)
      continue;
    double visit_display = dist[u] - h[src] + h[u];
    push_event(events, algo, "visit",
               "Visiting node " + g.id_of[u],
               json{{"node", g.id_of[u]}, {"dist", visit_display}});
    emitted++;
    for (const auto &pr : adjw[u]) {
      int v = pr.first;
      double w = pr.second;
      if (emitted >= max_events)
        break;
      push_event(events, algo, "relax",
                 "Relaxing edge " + g.id_of[u] + " → " + g.id_of[v],
                 json{{"from", g.id_of[u]}, {"to", g.id_of[v]}, {"weightPrime", w}});
      emitted++;
      double nd = dist[u] + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        par[v] = u;
        pq.push({nd, v});
        double reald = nd - h[src] + h[v];
        push_event(events, algo, "distance",
                   "Updating distance to " + g.id_of[v] + ": " + std::to_string(reald),
                   json{{"node", g.id_of[v]}, {"value", reald}});
        emitted++;
      }
    }
  }

  if (dist[dst] == kInf) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  auto path_idx = reconstruct_bf(par, src, dst);
  if (path_idx.empty()) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  double real_cost = dist[dst] - h[src] + h[dst];

  json path = json::array();
  for (int v : path_idx)
    path.push_back(g.id_of[v]);

  push_event(events, algo, "path_found", "Final path found",
             json{{"path", path}, {"cost", real_cost}});

  out["success"] = true;
  out["path"] = path;
  out["cost"] = real_cost;
  out["events"] = events;
  return out;
}

json run_dijkstra(const Graph &g, int src, int dst, int max_events) {
  const std::string algo = "dijkstra";
  json events = json::array();
  json out;
  out["algo"] = algo;

  for (const auto &e : g.edges) {
    if (e.w < 0) {
      push_event(events, algo, "start", "Dijkstra's algorithm (invalid graph)");
      push_event(events, algo, "no_path",
                 "Dijkstra requires non-negative edge weights",
                 json{{"reason", "negative_edge"}, {"from", e.from_id}, {"to", e.to_id},
                      {"weight", e.w}});
      out["success"] = false;
      out["error"] = "Dijkstra requires non-negative edge weights";
      out["events"] = events;
      return out;
    }
  }

  push_event(events, algo, "start", "Dijkstra's algorithm started");

  std::vector<double> dist(g.n, kInf);
  std::vector<int> par(g.n, -1);
  dist[src] = 0;

  using P = std::pair<double, int>;
  std::priority_queue<P, std::vector<P>, std::greater<P>> pq;
  pq.push({0, src});

  int emitted = 0;
  while (!pq.empty() && emitted < max_events) {
    auto [du, u] = pq.top();
    pq.pop();
    if (du > dist[u] + 1e-9)
      continue;
    push_event(events, algo, "visit",
               "Visiting node " + g.id_of[u],
               json{{"node", g.id_of[u]}, {"dist", dist[u]}});
    emitted++;
    for (const auto &pr : g.adj[u]) {
      int v = pr.first;
      double w = pr.second;
      if (emitted >= max_events)
        break;
      push_event(events, algo, "relax",
                 "Relaxing edge " + g.id_of[u] + " → " + g.id_of[v],
                 json{{"from", g.id_of[u]},
                      {"to", g.id_of[v]},
                      {"weight", w},
                      {"distFrom", dist[u]}});
      emitted++;
      double nd = dist[u] + w;
      if (nd < dist[v]) {
        dist[v] = nd;
        par[v] = u;
        pq.push({nd, v});
        push_event(events, algo, "distance",
                   "Updating distance to " + g.id_of[v] + ": " + std::to_string(nd),
                   json{{"node", g.id_of[v]}, {"value", nd}, {"via", g.id_of[u]}});
        emitted++;
      }
    }
  }

  if (dist[dst] == kInf) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  auto path_idx = reconstruct_bf(par, src, dst);
  if (path_idx.empty()) {
    push_event(events, algo, "no_path", "No valid path found", json{});
    out["success"] = false;
    out["error"] = "No valid path found";
    out["events"] = events;
    return out;
  }

  json path = json::array();
  for (int v : path_idx)
    path.push_back(g.id_of[v]);

  push_event(events, algo, "path_found", "Final path found",
             json{{"path", path}, {"cost", dist[dst]}});

  out["success"] = true;
  out["path"] = path;
  out["cost"] = dist[dst];
  out["events"] = events;
  return out;
}

json handle_request(const json &body) {
  json response;
  Graph g;
  std::string err;
  if (!parse_graph(body, g, err)) {
    response["ok"] = false;
    response["error"] = err;
    return response;
  }
  int src = 0, dst = 0;
  if (!parse_endpoints(body, g, src, dst, err)) {
    response["ok"] = false;
    response["error"] = err;
    return response;
  }

  std::string mode = body.value("mode", "bellman_ford");
  int max_events = 2000;
  if (body.contains("maxEvents") && body["maxEvents"].is_number_integer()) {
    max_events = std::max(50, body["maxEvents"].get<int>());
    max_events = std::min(max_events, 20000);
  }

  response["ok"] = true;

  if (mode == "run_all") {
    json results = json::array();
    auto bf = run_bellman_ford(g, src, dst, max_events);
    auto fw = run_floyd_warshall(g, src, dst, max_events);
    auto jn = run_johnson(g, src, dst, max_events);
    auto dk = run_dijkstra(g, src, dst, max_events);
    results.push_back(bf);
    results.push_back(fw);
    results.push_back(jn);
    results.push_back(dk);
    response["results"] = results;

    double best = kInf;
    json best_path;
    std::string best_algo;
    for (const auto &r : results) {
      if (r.value("success", false)) {
        double c = r["cost"].get<double>();
        if (c < best) {
          best = c;
          best_path = r["path"];
          best_algo = r["algo"].get<std::string>();
        }
      }
    }
    if (best < kInf) {
      response["best"] =
          json{{"algo", best_algo}, {"cost", best}, {"path", best_path}};
    } else {
      response["best"] = nullptr;
    }
  } else if (mode == "bellman_ford") {
    response["result"] = run_bellman_ford(g, src, dst, max_events);
  } else if (mode == "floyd_warshall") {
    response["result"] = run_floyd_warshall(g, src, dst, max_events);
  } else if (mode == "johnson") {
    response["result"] = run_johnson(g, src, dst, max_events);
  } else if (mode == "dijkstra") {
    response["result"] = run_dijkstra(g, src, dst, max_events);
  } else {
    response["ok"] = false;
    response["error"] = "Invalid mode";
  }
  return response;
}

} // namespace

int main() {
  httplib::Server svr;

  svr.set_default_headers({{"Access-Control-Allow-Origin", "*"},
                           {"Access-Control-Allow-Methods", "GET, POST, OPTIONS"},
                           {"Access-Control-Allow-Headers", "Content-Type"}});

  svr.Options(".*", [](const httplib::Request &, httplib::Response &res) {
    res.status = 204;
  });

  svr.Get("/api/health", [](const httplib::Request &, httplib::Response &res) {
    res.set_content("{\"ok\":true}", "application/json");
  });

  svr.Post("/api/run", [](const httplib::Request &req, httplib::Response &res) {
    try {
      json body = json::parse(req.body.empty() ? "{}" : req.body);
      json out = handle_request(body);
      res.set_content(out.dump(), "application/json");
    } catch (const std::exception &e) {
      json err;
      err["ok"] = false;
      err["error"] = std::string("Invalid JSON: ") + e.what();
      res.status = 400;
      res.set_content(err.dump(), "application/json");
    }
  });

  const char *port_env = std::getenv("ROUTING_PORT");
  int port = 8787;
  if (port_env) {
    try {
      port = std::atoi(port_env);
    } catch (...) {
    }
  }
  if (port <= 0 || port > 65535)
    port = 8787;

  std::printf("Smart Network Routing backend listening on http://127.0.0.1:%d\n",
              port);
  if (!svr.listen("127.0.0.1", port)) {
    std::fprintf(stderr, "Failed to bind port %d\n", port);
    return 1;
  }
  return 0;
}
