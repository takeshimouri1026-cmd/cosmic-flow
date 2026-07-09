import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import UniverseScene from "./UniverseScene";
import DetailPanel from "./DetailPanel";
import InterviewPanel from "./InterviewPanel";
import { confirmNode, fetchDefaultUniverse, fetchGraph, rejectNode, streamInterview } from "./api";
import type { GraphEdge, GraphNode, GraphState, InterviewEvent } from "./types";

interface ChatLine {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}

export default function App() {
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bornKey, setBornKey] = useState<string | null>(null);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prefill, setPrefill] = useState("");
  const streamingTextRef = useRef("");

  const loadAll = useCallback(async () => {
    try {
      const universe = await fetchDefaultUniverse();
      const g = await fetchGraph(universe.id);
      setGraph(g);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const applyEvent = useCallback((event: InterviewEvent) => {
    if (event.type === "text") {
      streamingTextRef.current += event.text;
      setChatLines((prev) => {
        const next = [...prev];
        if (next.length && next[next.length - 1].role === "assistant" && next[next.length - 1].streaming) {
          next[next.length - 1] = { role: "assistant", text: streamingTextRef.current, streaming: true };
        } else {
          next.push({ role: "assistant", text: streamingTextRef.current, streaming: true });
        }
        return next;
      });
      return;
    }
    if (event.type === "node_added") {
      setGraph((g) => (g ? { ...g, nodes: [...g.nodes, event.node] } : g));
      setBornKey(event.node.key);
      window.setTimeout(() => setBornKey((k) => (k === event.node.key ? null : k)), 2500);
      return;
    }
    if (event.type === "edge_added") {
      setGraph((g) => (g ? { ...g, edges: [...g.edges, event.edge] } : g));
      return;
    }
    if (event.type === "node_updated") {
      setGraph((g) =>
        g ? { ...g, nodes: g.nodes.map((n) => (n.id === event.node.id ? event.node : n)) } : g
      );
      return;
    }
    if (event.type === "pending_question") {
      setGraph((g) => (g ? { ...g, universe: { ...g.universe, pending_question: event.question } } : g));
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      return;
    }
    if (event.type === "done") {
      streamingTextRef.current = "";
      setChatLines((prev) => prev.map((l) => ({ role: l.role, text: l.text })));
      setStreaming(false);
    }
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      if (!graph) return;
      setChatLines((prev) => [...prev, { role: "user", text }]);
      setStreaming(true);
      streamingTextRef.current = "";
      try {
        await streamInterview(graph.universe.id, text, applyEvent);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStreaming(false);
      }
    },
    [graph, applyEvent]
  );

  const handleConfirm = useCallback(async (nodeId: string) => {
    setBusy(true);
    try {
      const { node } = (await confirmNode(nodeId)) as { node: GraphNode };
      setGraph((g) => (g ? { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? node : n)) } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleReject = useCallback(
    async (nodeId: string) => {
      setBusy(true);
      try {
        await rejectNode(nodeId);
        setGraph((g) =>
          g
            ? {
                ...g,
                nodes: g.nodes.filter((n) => n.id !== nodeId),
                edges: g.edges.filter((e) => {
                  const n = g.nodes.find((x) => x.id === nodeId);
                  if (!n) return true;
                  return e.source_key !== n.key && e.target_key !== n.key;
                }),
              }
            : g
        );
        setSelectedKey(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  if (error) {
    return (
      <div className="error-screen">
        <p>エラーが発生しました: {error}</p>
        <button onClick={() => { setError(null); loadAll(); }}>再読み込み</button>
      </div>
    );
  }

  if (!graph) {
    return <div className="loading-screen">宇宙を読み込んでいます…</div>;
  }

  const selectedNode: GraphNode | null = selectedKey ? graph.nodes.find((n) => n.key === selectedKey) ?? null : null;
  const selectedCluster = selectedNode ? graph.clusters.find((c) => c.key === selectedNode.cluster) : undefined;

  return (
    <>
      <UniverseScene
        clusters={graph.clusters}
        nodes={graph.nodes}
        edges={graph.edges as GraphEdge[]}
        onSelect={(n) => setSelectedKey(n?.key ?? null)}
        selectedKey={selectedKey}
        bornKey={bornKey}
      />

      <div className="hud">
        <h1>{graph.universe.title}</h1>
        <p className="sub">語るそばから、宇宙が育つ</p>
        <div className="legend">
          {graph.clusters.map((c) => (
            <span key={c.key}>
              <i style={{ background: c.color, color: c.color }} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      {selectedNode && (
        <DetailPanel
          node={selectedNode}
          clusterLabel={selectedCluster?.label ?? selectedNode.cluster}
          clusterColor={selectedCluster?.color ?? "#a78bfa"}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onEditComment={(comment) => setPrefill(comment)}
          busy={busy}
        />
      )}

      <InterviewPanel
        pendingQuestion={graph.universe.pending_question}
        onSend={handleSend}
        lines={chatLines}
        streaming={streaming}
        prefill={prefill}
        onPrefillConsumed={() => setPrefill("")}
      />
    </>
  );
}
