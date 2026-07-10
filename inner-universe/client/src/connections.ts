import type { GraphEdge, GraphNode } from "./types";

export type Direction = "in" | "out";

export interface Connection {
  edge: GraphEdge;
  otherKey: string;
  otherNode: GraphNode | undefined;
  direction: Direction;
}

export function connectionsOf(
  edges: GraphEdge[],
  nodeKey: string,
  nodeByKey: Map<string, GraphNode>
): Connection[] {
  return edges
    .filter((e) => e.source_key === nodeKey || e.target_key === nodeKey)
    .map((e) => {
      const direction: Direction = e.target_key === nodeKey ? "in" : "out";
      const otherKey = direction === "in" ? e.source_key : e.target_key;
      return { edge: e, otherKey, otherNode: nodeByKey.get(otherKey), direction };
    });
}

// §2.1・§13.5: 源流/流れの先はinfluenceの糸だけの群。example/resonanceは別群「あらわれ・響き」
export function groupConnections(conns: Connection[]): {
  incoming: Connection[];
  outgoing: Connection[];
  others: Connection[];
} {
  return {
    incoming: conns.filter((c) => c.edge.kind === "influence" && c.direction === "in"),
    outgoing: conns.filter((c) => c.edge.kind === "influence" && c.direction === "out"),
    others: conns.filter((c) => c.edge.kind !== "influence"),
  };
}
