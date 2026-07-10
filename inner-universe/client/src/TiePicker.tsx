import { useState } from "react";
import type { Cluster, EdgeKind, GraphNode } from "./types";

interface Props {
  sourceLabel: string;
  candidates: GraphNode[];
  clusters: Cluster[];
  onCancel: () => void;
  onConfirm: (targetKey: string, description: string, kind: EdgeKind) => void;
}

const KIND_OPTIONS: { kind: EdgeKind; sentence: (source: string, target: string) => string }[] = [
  { kind: "influence", sentence: (s, t) => `${s}が${t}を形づくった` },
  { kind: "example", sentence: (s, t) => `${s}は${t}のあらわれ` },
  { kind: "resonance", sentence: (s, t) => `${s}と${t}は響き合う` },
];

export default function TiePicker({ sourceLabel, candidates, clusters, onCancel, onConfirm }: Props) {
  const clusterColor = (cluster: string) => clusters.find((c) => c.key === cluster)?.color ?? "#a78bfa";
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<GraphNode | null>(null);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<EdgeKind>("influence");

  const filtered = query.trim()
    ? candidates.filter((n) => n.label.toLowerCase().includes(query.trim().toLowerCase()))
    : candidates;

  if (!target) {
    return (
      <div className="tie-picker">
        <div className="tie-picker-header">
          <span>「{sourceLabel}」から糸を張る相手を選ぶ</span>
          <button onClick={onCancel}>✕</button>
        </div>
        <input
          autoFocus
          className="tie-picker-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="星の名前で探す…"
        />
        <div className="tie-picker-list">
          {filtered.length === 0 && <div className="tie-picker-empty">見つかりません</div>}
          {filtered.map((n) => (
            <button key={n.key} className="tie-picker-item" onClick={() => setTarget(n)}>
              <i className="tie-picker-dot" style={{ background: clusterColor(n.cluster) }} />
              {n.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="tie-picker">
      <div className="tie-picker-header">
        <span>
          「{sourceLabel}」→「{target.label}」
        </span>
        <button onClick={onCancel}>✕</button>
      </div>
      <div className="tie-picker-kind">
        {KIND_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            className={`tie-picker-kind-opt${kind === opt.kind ? " active" : ""}`}
            onClick={() => setKind(opt.kind)}
          >
            {opt.sentence(sourceLabel, target.label)}
          </button>
        ))}
      </div>
      <textarea
        autoFocus
        className="tie-picker-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="どうつながっているか、一言で"
        rows={2}
      />
      <div className="tie-picker-actions">
        <button
          disabled={!description.trim()}
          onClick={() => onConfirm(target.key, description.trim(), kind)}
        >
          糸を張る
        </button>
        <button onClick={() => setTarget(null)}>星を選び直す</button>
      </div>
    </div>
  );
}
