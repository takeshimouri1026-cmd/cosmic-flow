export type NodeType = "belief" | "experience" | "knowledge" | "meta";
export type NodeStatus = "confirmed" | "inferred";
export type EdgeKind = "influence" | "example" | "resonance";

export interface GraphNode {
  id: string;
  universe_id: string;
  key: string;
  label: string;
  type: NodeType;
  cluster: string;
  size: number;
  description: string;
  status: NodeStatus;
  source: string;
  user_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  universe_id: string;
  source_key: string;
  target_key: string;
  kind: EdgeKind;
  strength: number;
  description: string;
  inferred: boolean;
  source: string;
  created_at: string;
}

export interface Cluster {
  universe_id: string;
  key: string;
  label: string;
  color: string;
}

export interface Universe {
  id: string;
  owner_id: string | null;
  title: string;
  pending_question: string | null;
  version: string;
  created_at: string;
}

export interface ExpeditionStep {
  node_key: string;
  edge_id: string | null;
  memo: string | null;
}

export interface Expedition {
  id: string;
  universe_id: string;
  path: ExpeditionStep[];
  narration: string | null;
  created_at: string;
}

export type QuestionStatus = "open" | "asked" | "answered" | "dismissed";

export interface Question {
  id: string;
  universe_id: string;
  question: string;
  rationale: string | null;
  evidence: { node_keys?: string[] } | null;
  status: QuestionStatus;
  priority: number | null;
  created_at: string;
}

// 対話の航跡（§14.3）: messagesを蒸留した表示アイテム
export type TranscriptItem =
  | { type: "user_text"; text: string; created_at: string }
  | { type: "action"; summary: string; created_at: string }
  | { type: "picked_question"; question: string; created_at: string }
  | { type: "ai_text"; text: string; created_at: string }
  | { type: "star_born"; label: string; created_at: string }
  | { type: "thread_tied"; source_key: string; target_key: string; created_at: string }
  | { type: "star_updated"; key: string; created_at: string }
  | { type: "thread_cut"; created_at: string }
  | { type: "question_queued"; present: boolean; created_at: string };
