import { supabase } from "./db.js";
import type { Cluster, GraphEdge, GraphNode, Universe } from "./types.js";

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
  pendingQuestion: string | null
): string {
  const lines = nodes.map(
    (n) => `${n.key}\t${n.label}\t${n.type}\t${n.cluster}\tsize=${n.size}\t${n.status}`
  );
  const body = lines.length ? lines.join("\n") : "(まだ星がありません)";
  const pending = pendingQuestion ? `\npending_question: ${pendingQuestion}` : "";
  return `<graph_digest>\n${body}${pending}\n</graph_digest>`;
}
