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
