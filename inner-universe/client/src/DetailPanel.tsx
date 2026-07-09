import { useState } from "react";
import type { GraphNode } from "./types";

const TYPE_LABEL: Record<string, string> = {
  belief: "信念",
  experience: "経験",
  knowledge: "知識",
  meta: "メタ",
};

interface Props {
  node: GraphNode | null;
  clusterLabel: string;
  clusterColor: string;
  onConfirm: (nodeId: string) => void;
  onReject: (nodeId: string) => void;
  onEditComment: (comment: string) => void;
  busy: boolean;
}

export default function DetailPanel({ node, clusterLabel, clusterColor, onConfirm, onReject, onEditComment, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");

  if (!node) return null;

  const submitEdit = () => {
    if (!comment.trim()) return;
    onEditComment(comment.trim());
    setComment("");
    setEditing(false);
  };

  return (
    <div className="card show">
      <div className="badges">
        <span className="badge">{TYPE_LABEL[node.type] ?? node.type}</span>
        <span className="badge" style={{ borderColor: clusterColor, color: clusterColor }}>
          {clusterLabel}
        </span>
        {node.status === "inferred" && <span className="badge inferred">推定</span>}
      </div>
      <h2>{node.label}</h2>
      <p>{node.description}</p>

      {node.status === "inferred" && !editing && (
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
    </div>
  );
}
