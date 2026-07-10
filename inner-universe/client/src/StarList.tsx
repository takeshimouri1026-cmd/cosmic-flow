import { useState } from "react";
import type { Cluster, EdgeKind, GraphEdge, GraphNode } from "./types";
import { computeNetDegree, mixWithWhite, ringTierFor, sourceScoreFor } from "./sourceScore";

const KIND_LABEL: Record<EdgeKind, string> = {
  influence: "影響",
  example: "あらわれ",
  resonance: "響き合い",
};

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  onSelect: (key: string) => void;
  onReverseEdge: (edge: GraphEdge) => Promise<void>;
  onChangeEdgeKind: (edge: GraphEdge, kind: EdgeKind) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}

export default function StarList({ nodes, edges, clusters, onSelect, onReverseEdge, onChangeEdgeKind, onClose, busy }: Props) {
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const clusterMap = new Map(clusters.map((c) => [c.key, c]));
  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
  const netDegree = computeNetDegree(edges);

  const filtered = query.trim()
    ? nodes.filter((n) => n.label.toLowerCase().includes(query.trim().toLowerCase()))
    : nodes;

  const byCluster = new Map<string, GraphNode[]>();
  filtered.forEach((n) => {
    const list = byCluster.get(n.cluster) ?? [];
    list.push(n);
    byCluster.set(n.cluster, list);
  });
  byCluster.forEach((list) => list.sort((a, b) => sourceScoreFor(netDegree, b.key) - sourceScoreFor(netDegree, a.key)));

  const connectionsOf = (key: string) =>
    edges
      .filter((e) => e.source_key === key || e.target_key === key)
      .map((e) => {
        const direction: "in" | "out" = e.target_key === key ? "in" : "out";
        const otherKey = direction === "in" ? e.source_key : e.target_key;
        return { edge: e, otherKey, otherNode: nodeByKey.get(otherKey), direction };
      });

  return (
    <div className="star-list">
      <div className="star-list-header">
        <span>すべての星（{nodes.length}）</span>
        <button onClick={onClose}>✕</button>
      </div>
      <input
        autoFocus
        className="star-list-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="星の名前で探す…"
      />
      <div className="star-list-legend">
        <span>
          <i className="star-list-dot" style={{ background: "#888" }} />
          サブ
        </span>
        <span>
          <i className="star-list-dot source" style={{ background: "#888" }} />
          源流（色が濃く・輪が付く）
        </span>
      </div>
      <div className="star-list-body">
        {Array.from(byCluster.entries()).map(([clusterKey, list]) => {
          const cluster = clusterMap.get(clusterKey);
          return (
            <div key={clusterKey} className="star-list-group">
              <div className="star-list-group-title">{cluster?.label ?? clusterKey}</div>
              {list.map((n) => {
                const score = sourceScoreFor(netDegree, n.key);
                const tier = ringTierFor(netDegree, n.key);
                const dotColor = mixWithWhite(cluster?.color ?? "#a78bfa", 0.45 - 0.32 * score);
                const expanded = expandedKey === n.key;
                return (
                  <div key={n.key} className="star-list-entry">
                    <button
                      className="star-list-item"
                      onClick={() => setExpandedKey((cur) => (cur === n.key ? null : n.key))}
                    >
                      <i className={`star-list-dot${tier > 0 ? " source" : ""}`} style={{ background: dotColor }} />
                      <span className="star-list-item-label">{n.label}</span>
                      {n.status === "inferred" && <span className="star-list-badge">推定</span>}
                      <span className="star-list-chevron">{expanded ? "▲" : "▼"}</span>
                    </button>
                    {expanded && (
                      <div className="star-list-connections">
                        {connectionsOf(n.key).length === 0 && (
                          <div className="star-list-connections-empty">つながっている星はまだありません</div>
                        )}
                        {connectionsOf(n.key).map(({ edge, otherKey, otherNode, direction }) => {
                          const otherCluster = otherNode ? clusterMap.get(otherNode.cluster) : undefined;
                          return (
                            <div key={edge.id} className="star-list-conn-row">
                              <span className="star-list-conn-dir">
                                {edge.kind !== "influence" ? "✦" : direction === "in" ? "⬆" : "⬇"}
                              </span>
                              <button className="star-list-conn-main" onClick={() => onSelect(otherKey)}>
                                <i className="star-list-dot" style={{ background: otherCluster?.color ?? "#a78bfa" }} />
                                <span className="star-list-conn-label">{otherNode?.label ?? otherKey}</span>
                              </button>
                              <select
                                className="star-list-conn-kind"
                                disabled={busy}
                                value={edge.kind}
                                onChange={(e) => onChangeEdgeKind(edge, e.target.value as EdgeKind)}
                              >
                                {(Object.keys(KIND_LABEL) as EdgeKind[]).map((k) => (
                                  <option key={k} value={k}>
                                    {KIND_LABEL[k]}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="star-list-conn-flip"
                                disabled={busy}
                                title="源流と流れの先を入れ替える"
                                onClick={() => onReverseEdge(edge)}
                              >
                                ⇄
                              </button>
                            </div>
                          );
                        })}
                        <button className="star-list-goto" onClick={() => onSelect(n.key)}>
                          → 宇宙でこの星を見る
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="star-list-empty">見つかりません</div>}
      </div>
    </div>
  );
}
