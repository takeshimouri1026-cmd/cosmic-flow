import { useState } from "react";
import type { Cluster } from "./types";

const PALETTE = [
  "#a78bfa", // 紫
  "#f5a26a", // オレンジ
  "#7ee0b0", // 緑
  "#ec6fa3", // ピンク
  "#f0d264", // 黄
  "#6fc3ec", // 水色
  "#ec6f6f", // 赤
  "#b0b0d8", // グレー紫
];

interface Props {
  clusters: Cluster[];
  onClose: () => void;
  onRename: (key: string, label: string) => Promise<void>;
  onCreate: (label: string, color: string) => Promise<void>;
  busy: boolean;
}

export default function ClusterManager({ clusters, onClose, onRename, onCreate, busy }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(PALETTE[0]);

  const labelFor = (c: Cluster) => drafts[c.key] ?? c.label;

  const submitRename = async (c: Cluster) => {
    const label = labelFor(c).trim();
    if (!label || label === c.label) return;
    await onRename(c.key, label);
  };

  const submitCreate = async () => {
    if (!newLabel.trim()) return;
    await onCreate(newLabel.trim(), newColor);
    setNewLabel("");
  };

  return (
    <div className="cluster-manager">
      <div className="cluster-manager-header">
        <span>クラスタの管理</span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="cluster-manager-body">
        {clusters.map((c) => (
          <div key={c.key} className="cluster-manager-row">
            <i className="cluster-manager-dot" style={{ background: c.color }} />
            <input
              className="cluster-manager-input"
              value={labelFor(c)}
              onChange={(e) => setDrafts((d) => ({ ...d, [c.key]: e.target.value }))}
            />
            <button
              disabled={busy || labelFor(c).trim() === c.label || !labelFor(c).trim()}
              onClick={() => submitRename(c)}
            >
              保存
            </button>
          </div>
        ))}

        <div className="cluster-manager-new">
          <div className="cluster-manager-new-title">＋ 新しいクラスタを追加</div>
          <input
            className="cluster-manager-input"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="クラスタの名前"
          />
          <div className="cluster-manager-palette">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`cluster-manager-swatch${newColor === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => setNewColor(c)}
              />
            ))}
          </div>
          <button disabled={busy || !newLabel.trim()} onClick={submitCreate}>
            追加する
          </button>
        </div>
      </div>
    </div>
  );
}
