import { useState, type ReactNode } from "react";
import type { Connection } from "./connections";
import { groupConnections } from "./connections";
import type { ExpeditionStep, GraphEdge, GraphNode } from "./types";

interface Props {
  node: GraphNode;
  connections: Connection[];
  path: ExpeditionStep[];
  pathNodes: (GraphNode | undefined)[];
  arrivedEdge: GraphEdge | null;
  narration: string | null;
  narrating: boolean;
  busy: boolean;
  onTraverse: (edge: GraphEdge) => void;
  onJumpBreadcrumb: (index: number) => void;
  onSetMemo: (memo: string) => void;
  onReinforce: (edge: GraphEdge) => void;
  onNarrate: () => void;
  onSurface: () => void;
}

export default function ChamberPanel({
  node,
  connections,
  path,
  pathNodes,
  arrivedEdge,
  narration,
  narrating,
  busy,
  onTraverse,
  onJumpBreadcrumb,
  onSetMemo,
  onReinforce,
  onNarrate,
  onSurface,
}: Props) {
  const { incoming, outgoing, others } = groupConnections(connections);
  const lastStep = path[path.length - 1];
  const [memoDraft, setMemoDraft] = useState(lastStep?.memo ?? "");

  const submitMemo = () => {
    onSetMemo(memoDraft.trim());
  };

  return (
    <div className="card show chamber-panel">
      <div className="badges">
        <span className="badge">⛏ 探索モード</span>
      </div>
      <h2>{node.label}</h2>
      <p>{node.description}</p>

      <div className="actions">
        <button disabled={busy} onClick={onSurface}>
          ⬆ 宇宙に浮上
        </button>
      </div>

      {arrivedEdge && (
        <div className="actions">
          <button disabled={busy} onClick={() => onReinforce(arrivedEdge)}>
            この糸、確かにある
          </button>
        </div>
      )}

      <div className="chamber-guide">「なぜ私はこれを?」には源流方向が答えになる</div>

      <div className="connections">
        {incoming.length > 0 && (
          <div className="conn-group">
            <div className="conn-title">⬆ 源流へ</div>
            {incoming.map((c) => (
              <button
                key={c.edge.id}
                className="conn-row chamber-passage"
                disabled={busy}
                onClick={() => onTraverse(c.edge)}
              >
                <div className="conn-text">
                  <b>{c.otherNode?.label ?? c.otherKey}</b>
                  <span>{c.edge.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {outgoing.length > 0 && (
          <div className="conn-group">
            <div className="conn-title">⬇ 流れの先へ</div>
            {outgoing.map((c) => (
              <button
                key={c.edge.id}
                className="conn-row chamber-passage"
                disabled={busy}
                onClick={() => onTraverse(c.edge)}
              >
                <div className="conn-text">
                  <b>{c.otherNode?.label ?? c.otherKey}</b>
                  <span>{c.edge.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="conn-group">
            <div className="conn-title">✦ あらわれ・響き</div>
            {others.map((c) => (
              <button
                key={c.edge.id}
                className="conn-row chamber-passage"
                disabled={busy}
                onClick={() => onTraverse(c.edge)}
              >
                <div className="conn-text">
                  <b>{c.otherNode?.label ?? c.otherKey}</b>
                  <span>{c.edge.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {incoming.length === 0 && outgoing.length === 0 && others.length === 0 && (
          <div className="star-list-connections-empty">通路はまだありません</div>
        )}
      </div>

      {path.length > 1 && (
        <div className="chamber-breadcrumbs">
          {path
            .map((step, i) => (
              <button key={i} className="chamber-crumb" onClick={() => onJumpBreadcrumb(i)}>
                {pathNodes[i]?.label ?? step.node_key}
              </button>
            ))
            .reverse()
            .reduce<ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, " ← ", el]), [])}
        </div>
      )}

      <div className="edit-box chamber-memo">
        <textarea
          value={memoDraft}
          onChange={(e) => setMemoDraft(e.target.value)}
          onBlur={submitMemo}
          placeholder="✎ ふりかえりメモ（一言）"
          rows={2}
        />
      </div>

      <div className="actions">
        <button disabled={busy || narrating} onClick={onNarrate}>
          {narrating ? "…読み解いています" : "🕯 この道のりを読み解く"}
        </button>
      </div>
      {narration && <p className="chamber-narration">{narration}</p>}
    </div>
  );
}
