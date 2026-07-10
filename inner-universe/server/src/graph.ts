import { supabase } from "./db.js";
import type { Cluster, ExpeditionStep, GraphEdge, GraphNode, Universe } from "./types.js";

export async function getUniverse(universeId: string): Promise<Universe> {
  const { data, error } = await supabase
    .from("universes")
    .select("*")
    .eq("id", universeId)
    .single();
  if (error) throw error;
  return data as Universe;
}

export async function getGraph(universeId: string) {
  const [{ data: nodes, error: nErr }, { data: edges, error: eErr }, { data: clusters, error: cErr }] =
    await Promise.all([
      supabase.from("nodes").select("*").eq("universe_id", universeId).order("created_at"),
      supabase.from("edges").select("*").eq("universe_id", universeId).order("created_at"),
      supabase.from("clusters").select("*").eq("universe_id", universeId),
    ]);
  if (nErr) throw nErr;
  if (eErr) throw eErr;
  if (cErr) throw cErr;
  return {
    nodes: (nodes ?? []) as GraphNode[],
    edges: (edges ?? []) as GraphEdge[],
    clusters: (clusters ?? []) as Cluster[],
  };
}

export function buildGraphDigest(
  nodes: GraphNode[],
  edges: GraphEdge[],
  pendingQuestion: string | null
): string {
  const lines = nodes.map(
    (n) => `${n.key}\t${n.label}\t${n.type}\t${n.cluster}\tsize=${n.size}\t${n.status}`
  );
  const body = lines.length ? lines.join("\n") : "(まだ星がありません)";
  const edgeLines = edges.map(
    (e) => `${e.source_key}->${e.target_key}\t${e.kind}\tstrength=${e.strength}\t${e.description}`
  );
  const edgeBody = edgeLines.length ? edgeLines.join("\n") : "(まだ糸がありません)";
  const pending = pendingQuestion ? `\npending_question: ${pendingQuestion}` : "";
  return `<graph_digest>\n${body}\n--- edges (source->target, kind) ---\n${edgeBody}${pending}\n</graph_digest>`;
}

// 探索モード（§12.5）: 辿った経路を、ナレーション生成のためのテキストに組み立てる
export function buildPathText(nodes: GraphNode[], edges: GraphEdge[], path: ExpeditionStep[]): string {
  const nodeByKey = new Map(nodes.map((n) => [n.key, n]));
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  return path
    .map((step) => {
      const node = nodeByKey.get(step.node_key);
      const label = node?.label ?? step.node_key;
      const desc = node?.description ?? "";
      const edge = step.edge_id ? edgeById.get(step.edge_id) : undefined;
      const lines = [`${label} — ${desc}`];
      if (edge) lines.push(`  └(糸「${edge.description}」経由)`);
      if (step.memo) lines.push(`  メモ: 「${step.memo}」`);
      return lines.join("\n");
    })
    .join("\n");
}

// resonanceは向きに意味がないため、挿入時にサーバ側で逆向きの既存行もチェックして重複を防ぐ（§2.1）
export async function findEdgeByPair(
  universeId: string,
  sourceKey: string,
  targetKey: string,
  excludeId?: string
): Promise<{ id: string } | null> {
  let query = supabase
    .from("edges")
    .select("id")
    .eq("universe_id", universeId)
    .eq("source_key", sourceKey)
    .eq("target_key", targetKey);
  if (excludeId) query = query.neq("id", excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as { id: string } | null;
}
