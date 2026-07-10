import { useState } from "react";
import type { EdgeKind, GraphEdge, GraphNode } from "./types";

const TYPE_LABEL: Record<string, string> = {
  belief: "信念",
  experience: "経験",
  knowledge: "知識",
  meta: "メタ",
};

const KIND_LABEL: Record<EdgeKind, string> = {
  influence: "影響",
  example: "あらわれ",
  resonance: "響き合い",
};

interface Connection {
  edge: GraphEdge;
  otherKey: string;
  otherLabel: string;
  direction: "in" | "out";
}

interface Props {
  node: GraphNode | null;
  clusterLabel: string;
  clusterColor: string;
  connections: Connection[];
  onConfirm: (nodeId: string) => void;
  onReject: (nodeId: string) => void;
  onEditComment: (comment: string) => void;
  onDirectEdit: (field: "label" | "description", before: string, after: string) => Promise<void>;
  onCutEdge: (edge: GraphEdge) => Promise<void>;
  onReverseEdge: (edge: GraphEdge) => Promise<void>;
  onChangeEdgeKind: (edge: GraphEdge, kind: EdgeKind) => Promise<void>;
  onStartTie: () => void;
  tyingFromThisNode: boolean;
  onPlantNode: (name: string, comment: string) => Promise<void>;
  busy: boolean;
}

export default function DetailPanel({
  node,
  clusterLabel,
  clusterColor,
  connections,
  onConfirm,
  onReject,
  onEditComment,
  onDirectEdit,
  onCutEdge,
  onReverseEdge,
  onChangeEdgeKind,
  onStartTie,
  tyingFromThisNode,
  onPlantNode,
  busy,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [directEditing, setDirectEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [planting, setPlanting] = useState(false);
  const [plantName, setPlantName] = useState("");
  const [plantComment, setPlantComment] = useState("");

  if (!node) return null;

  const submitEdit = () => {
    if (!comment.trim()) return;
    onEditComment(comment.trim());
    setComment("");
    setEditing(false);
  };

  const startDirectEdit = () => {
    setLabelDraft(node.label);
    setDescDraft(node.description);
    setDirectEditing(true);
  };

  const submitDirectEdit = async () => {
    const nextLabel = labelDraft.trim();
    const nextDesc = descDraft.trim();
    if (nextLabel && nextLabel !== node.label) {
      await onDirectEdit("label", node.label, nextLabel);
    }
    if (nextDesc && nextDesc !== node.description) {
      await onDirectEdit("description", node.description, nextDesc);
    }
    setDirectEditing(false);
  };

  const submitPlant = async () => {
    if (!plantName.trim()) return;
    await onPlantNode(plantName.trim(), plantComment.trim());
    setPlantName("");
    setPlantComment("");
    setPlanting(false);
  };

  // §2.1・§13.5: 源流/流れの先はinfluenceの糸だけの群。example/resonanceは別群「あらわれ・響き」
  const incoming = connections.filter((c) => c.edge.kind === "influence" && c.direction === "in");
  const outgoing = connections.filter((c) => c.edge.kind === "influence" && c.direction === "out");
  const others = connections.filter((c) => c.edge.kind !== "influence");

  return (
    <div className="card show">
      <div className="badges">
        <span className="badge">{TYPE_LABEL[node.type] ?? node.type}</span>
        <span className="badge" style={{ borderColor: clusterColor, color: clusterColor }}>
          {clusterLabel}
        </span>
        {node.status === "inferred" && <span className="badge inferred">推定</span>}
        {node.user_edited && <span className="badge edited">本人編集済み</span>}
      </div>

      {!directEditing && (
        <>
          <h2>{node.label}</h2>
          <p>{node.description}</p>
        </>
      )}

      {directEditing && (
        <div className="edit-box">
          <input
            className="label-input"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="星の名前"
          />
          <textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            placeholder="説明"
            rows={3}
          />
          <div className="actions">
            <button disabled={busy} onClick={submitDirectEdit}>
              直す
            </button>
            <button disabled={busy} onClick={() => setDirectEditing(false)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {!directEditing && (
        <div className="actions">
          <button disabled={busy} onClick={startDirectEdit}>
            ✎ 星の言葉を直す
          </button>
          <button disabled={busy} onClick={onStartTie}>
            {tyingFromThisNode ? "…相手の星を選択中" : "＋この星から糸を張る"}
          </button>
        </div>
      )}

      {node.status === "inferred" && !editing && !directEditing && (
        <div className="actions">
          <button disabled={busy} onClick={() => onConfirm(node.id)}>
            ✓ 合ってる
          </button>
          <button disabled={busy} onClick={() => setEditing(true)}>
            ✎ ちょっと違う
          </button>
          <button disabled={busy} className="danger" onClick={() => onReject(node.id)}>
            ✕ 消す
          </button>
        </div>
      )}

      {editing && (
        <div className="edit-box">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="どう違うか教えてください。次のインタビュー発話として送られます"
            rows={2}
          />
          <div className="actions">
            <button disabled={busy} onClick={submitEdit}>
              送信
            </button>
            <button disabled={busy} onClick={() => setEditing(false)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {(incoming.length > 0 || outgoing.length > 0 || others.length > 0) && !directEditing && (
        <div className="connections">
          {incoming.length > 0 && (
            <div className="conn-group">
              <div className="conn-title">⬆ 源流</div>
              {incoming.map((c) => (
                <div className="conn-row" key={c.edge.id}>
                  <div className="conn-text">
                    <b>{c.otherLabel}</b>
                    <span>{c.edge.description}</span>
                  </div>
                  <select
                    className="conn-kind-select"
                    disabled={busy}
                    value={c.edge.kind}
                    onChange={(e) => onChangeEdgeKind(c.edge, e.target.value as EdgeKind)}
                  >
                    {(Object.keys(KIND_LABEL) as EdgeKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy} className="danger small" onClick={() => onCutEdge(c.edge)}>
                    ✂
                  </button>
                </div>
              ))}
            </div>
          )}
          {outgoing.length > 0 && (
            <div className="conn-group">
              <div className="conn-title">⬇ 流れの先</div>
              {outgoing.map((c) => (
                <div className="conn-row" key={c.edge.id}>
                  <div className="conn-text">
                    <b>{c.otherLabel}</b>
                    <span>{c.edge.description}</span>
                  </div>
                  <select
                    className="conn-kind-select"
                    disabled={busy}
                    value={c.edge.kind}
                    onChange={(e) => onChangeEdgeKind(c.edge, e.target.value as EdgeKind)}
                  >
                    {(Object.keys(KIND_LABEL) as EdgeKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button disabled={busy} className="danger small" onClick={() => onCutEdge(c.edge)}>
                    ✂
                  </button>
                </div>
              ))}
            </div>
          )}
          {others.length > 0 && (
            <div className="conn-group">
              <div className="conn-title">✦ あらわれ・響き</div>
              {others.map((c) => (
                <div className="conn-row" key={c.edge.id}>
                  <div className="conn-text">
                    <b>{c.otherLabel}</b>
                    <span>{c.edge.description}</span>
                  </div>
                  <select
                    className="conn-kind-select"
                    disabled={busy}
                    value={c.edge.kind}
                    onChange={(e) => onChangeEdgeKind(c.edge, e.target.value as EdgeKind)}
                  >
                    {(Object.keys(KIND_LABEL) as EdgeKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    className="small"
                    title="向きを入れ替える"
                    onClick={() => onReverseEdge(c.edge)}
                  >
                    ⇄
                  </button>
                  <button disabled={busy} className="danger small" onClick={() => onCutEdge(c.edge)}>
                    ✂
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!directEditing && !planting && (
        <div className="actions">
          <button disabled={busy} onClick={() => setPlanting(true)}>
            ＋隣に星を植える
          </button>
        </div>
      )}

      {planting && (
        <div className="edit-box">
          <input
            className="label-input"
            value={plantName}
            onChange={(e) => setPlantName(e.target.value)}
            placeholder="新しい星の名前"
          />
          <textarea
            value={plantComment}
            onChange={(e) => setPlantComment(e.target.value)}
            placeholder="一言(どういうものか)"
            rows={2}
          />
          <div className="actions">
            <button disabled={busy} onClick={submitPlant}>
              植える
            </button>
            <button disabled={busy} onClick={() => setPlanting(false)}>
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
