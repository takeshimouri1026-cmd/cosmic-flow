import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import UniverseScene from "./UniverseScene";
import DetailPanel from "./DetailPanel";
import ChamberPanel from "./ChamberPanel";
import InterviewPanel from "./InterviewPanel";
import TiePicker from "./TiePicker";
import StarList from "./StarList";
import ClusterManager from "./ClusterManager";
import { connectionsOf } from "./connections";
import {
  confirmNode,
  createCluster,
  createEdge,
  deleteEdge,
  fetchDefaultUniverse,
  fetchGraph,
  narratePath,
  patchEdge,
  patchNode,
  rejectNode,
  renameCluster,
  saveExpedition,
  streamAction,
  streamInterview,
} from "./api";
import type { UserAction } from "./api";
import type { EdgeKind, ExpeditionStep, GraphEdge, GraphNode, GraphState, InterviewEvent } from "./types";

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
  const [tyingFrom, setTyingFrom] = useState<string | null>(null);
  const [lensCluster, setLensCluster] = useState<string | null>(null);
  const [lensInferred, setLensInferred] = useState(false);
  const [cutUndo, setCutUndo] = useState<GraphEdge | null>(null);
  const [starListOpen, setStarListOpen] = useState(false);
  const [clusterManagerOpen, setClusterManagerOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ key: string; nonce: number } | null>(null);
  const [chamberKey, setChamberKey] = useState<string | null>(null);
  const [expeditionPath, setExpeditionPath] = useState<ExpeditionStep[]>([]);
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [travelRequest, setTravelRequest] = useState<{
    edgeId: string;
    fromKey: string;
    toKey: string;
    nonce: number;
  } | null>(null);
  const streamingTextRef = useRef("");
  const cutUndoTimerRef = useRef<number | null>(null);

  // Setの参照を毎レンダー作り直すとUniverseScene側のカメラ演出が無限に再トリガーされるため、
  // 実際に条件が変わった時だけ再計算する
  const lensNodeKeys = useMemo(() => {
    if (!graph || (!lensCluster && !lensInferred)) return null;
    return new Set(
      graph.nodes
        .filter((n) => (!lensCluster || n.cluster === lensCluster) && (!lensInferred || n.status === "inferred"))
        .map((n) => n.key)
    );
  }, [graph, lensCluster, lensInferred]);

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
    if (event.type === "edge_removed") {
      setGraph((g) => (g ? { ...g, edges: g.edges.filter((e) => e.id !== event.edge_id) } : g));
      return;
    }
    if (event.type === "pending_question") {
      setGraph((g) => (g ? { ...g, universe: { ...g.universe, pending_question: event.question } } : g));
      return;
    }
    if (event.type === "error") {
      // 全画面エラーにせず、チャット欄の中で知らせる（宇宙は生きたまま）
      streamingTextRef.current = "";
      setChatLines((prev) => [
        ...prev.map((l) => ({ role: l.role, text: l.text })),
        { role: "assistant" as const, text: `⚠ ごめんなさい、応答の途中で問題が起きました。もう一度送ってみてください。（${event.message}）` },
      ]);
      setStreaming(false);
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
        const message = err instanceof Error ? err.message : String(err);
        setChatLines((prev) => [
          ...prev,
          { role: "assistant" as const, text: `⚠ 送信に失敗しました。少し待ってもう一度試してください。（${message}）` },
        ]);
      } finally {
        // done イベントが届かないまま接続が切れても入力欄が固まらないように
        setStreaming(false);
        streamingTextRef.current = "";
      }
    },
    [graph, applyEvent]
  );

  // 手入れモード（§13）: 操作は即時にDBへ反映済み。ここでは同じ操作を<user_action>として
  // インタビューエンジンに流し、宇宙（AI）の応答（近傍だけ読んだ短い提案）をチャットに届ける
  const runAction = useCallback(
    async (action: UserAction, summaryText: string) => {
      if (!graph) return;
      setChatLines((prev) => [...prev, { role: "user", text: summaryText }]);
      setStreaming(true);
      streamingTextRef.current = "";
      try {
        await streamAction(graph.universe.id, action, applyEvent);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setChatLines((prev) => [
          ...prev,
          { role: "assistant" as const, text: `⚠ 宇宙の応答に失敗しました。（${message}）` },
        ]);
      } finally {
        setStreaming(false);
        streamingTextRef.current = "";
      }
    },
    [graph, applyEvent]
  );

  const handleDirectEdit = useCallback(
    async (node: GraphNode, field: "label" | "description", before: string, after: string) => {
      setBusy(true);
      try {
        const { node: updated } = (await patchNode(node.id, { [field]: after })) as { node: GraphNode };
        setGraph((g) => (g ? { ...g, nodes: g.nodes.map((n) => (n.id === node.id ? updated : n)) } : g));
        const fieldLabel = field === "label" ? "名前" : "説明";
        await runAction(
          { kind: "edit_node", key: node.key, field, before, after },
          `（星「${before}」の${fieldLabel}を直した → 「${after}」）`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runAction]
  );

  // 糸を切った直後は数秒だけ「元に戻す」を出す。その間はAIに伝えず、
  // 猶予が過ぎてから初めて手入れの応答としてAIに流す（誤操作の取り消しを対話の履歴に残さないため）
  const handleCutEdge = useCallback(
    async (edge: GraphEdge) => {
      setBusy(true);
      try {
        await deleteEdge(edge.id);
        setGraph((g) => (g ? { ...g, edges: g.edges.filter((e) => e.id !== edge.id) } : g));
        setCutUndo(edge);
        cutUndoTimerRef.current = window.setTimeout(() => {
          cutUndoTimerRef.current = null;
          setCutUndo(null);
          runAction(
            { kind: "cut_edge", source_key: edge.source_key, target_key: edge.target_key, reason: "" },
            `（糸 ${edge.source_key}→${edge.target_key} を切った）`
          );
        }, 6000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runAction]
  );

  const handleUndoCut = useCallback(async () => {
    if (!cutUndo || !graph) return;
    if (cutUndoTimerRef.current !== null) {
      clearTimeout(cutUndoTimerRef.current);
      cutUndoTimerRef.current = null;
    }
    const edge = cutUndo;
    setCutUndo(null);
    setBusy(true);
    try {
      const { edge: restored } = (await createEdge(graph.universe.id, edge.source_key, edge.target_key, edge.description, {
        strength: edge.strength,
        inferred: edge.inferred,
        kind: edge.kind,
      })) as { edge: GraphEdge };
      setGraph((g) => (g ? { ...g, edges: [...g.edges, restored] } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [cutUndo, graph]);

  const handleTieEdge = useCallback(
    async (sourceKey: string, targetKey: string, description: string, edgeKind: EdgeKind) => {
      if (!graph) return;
      setBusy(true);
      try {
        const { edge } = (await createEdge(graph.universe.id, sourceKey, targetKey, description, {
          kind: edgeKind,
        })) as { edge: GraphEdge };
        setGraph((g) => (g ? { ...g, edges: [...g.edges, edge] } : g));
        await runAction(
          { kind: "tie_edge", source_key: sourceKey, target_key: targetKey, description, edgeKind },
          `（糸 ${sourceKey}→${targetKey} を張った:「${description}」）`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [graph, runAction]
  );

  const handlePlantNode = useCallback(
    async (name: string, comment: string) => {
      await runAction({ kind: "plant_node", name, comment }, `（新しい星を植えたい:「${name}」${comment}）`);
    },
    [runAction]
  );

  const handleRenameCluster = useCallback(
    async (key: string, label: string) => {
      if (!graph) return;
      setBusy(true);
      try {
        const { cluster } = await renameCluster(graph.universe.id, key, label);
        setGraph((g) => (g ? { ...g, clusters: g.clusters.map((c) => (c.key === key ? cluster : c)) } : g));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [graph]
  );

  const handleCreateCluster = useCallback(
    async (label: string, color: string) => {
      if (!graph) return;
      setBusy(true);
      try {
        const { cluster } = await createCluster(graph.universe.id, label, color);
        setGraph((g) => (g ? { ...g, clusters: [...g.clusters, cluster] } : g));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [graph]
  );

  // つながりの向き（源流/流れの先）を入れ替える。一覧でまとめて見直す時のための
  // 軽い操作なので、対話には流さずその場で反映するだけにする
  const handleReverseEdge = useCallback(async (edge: GraphEdge) => {
    setBusy(true);
    try {
      const { edge: reversed } = (await patchEdge(edge.id, { reverse: true })) as { edge: GraphEdge };
      setGraph((g) => (g ? { ...g, edges: g.edges.map((e) => (e.id === edge.id ? reversed : e)) } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  // 糸のkind（influence/example/resonance）を編み直す。§13.5: LLMには流さない直接更新
  const handleChangeEdgeKind = useCallback(async (edge: GraphEdge, kind: EdgeKind) => {
    setBusy(true);
    try {
      const { edge: updated } = (await patchEdge(edge.id, { kind })) as { edge: GraphEdge };
      setGraph((g) => (g ? { ...g, edges: g.edges.map((e) => (e.id === edge.id ? updated : e)) } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleSceneSelect = useCallback(
    (n: GraphNode | null) => {
      if (chamberKey) return; // 探索モード中はDOMシートが主導。3Dタップで裏の選択状態を変えない
      setSelectedKey(n?.key ?? null);
    },
    [chamberKey]
  );

  // 探索モード（§12）: この星に潜る
  const handleDive = useCallback((key: string) => {
    setChamberKey(key);
    setExpeditionPath([{ node_key: key, edge_id: null, memo: null }]);
    setNarration(null);
    setSelectedKey(null);
  }, []);

  // 通路をタップして辿る（§12.3）。実際のchamberKey更新はカメラ到着後（onArrived）で行う
  const handleTraverse = useCallback(
    (edge: GraphEdge) => {
      if (!chamberKey) return;
      const toKey = edge.source_key === chamberKey ? edge.target_key : edge.source_key;
      setTravelRequest({ edgeId: edge.id, fromKey: chamberKey, toKey, nonce: Date.now() });
    },
    [chamberKey]
  );

  const handleArrived = useCallback((toKey: string, edgeId: string) => {
    setChamberKey(toKey);
    setExpeditionPath((prev) => [...prev, { node_key: toKey, edge_id: edgeId, memo: null }]);
    setNarration(null);
  }, []);

  // パンくずタップで経路を巻き戻す（曲線移動ではなく瞬間ジャンプでよい）
  const handleJumpToBreadcrumb = useCallback(
    (index: number) => {
      const step = expeditionPath[index];
      if (!step) return;
      setExpeditionPath((prev) => prev.slice(0, index + 1));
      setChamberKey(step.node_key);
      setFocusRequest({ key: step.node_key, nonce: Date.now() });
      setNarration(null);
    },
    [expeditionPath]
  );

  const handleSetMemo = useCallback((memo: string) => {
    setExpeditionPath((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], memo: memo || null };
      return next;
    });
  }, []);

  // 「この糸、確かにある」（§12.3）。LLMを通さない直接更新
  const handleReinforceEdge = useCallback(async (edge: GraphEdge) => {
    setBusy(true);
    try {
      const { edge: updated } = (await patchEdge(edge.id, { reinforce: true })) as { edge: GraphEdge };
      setGraph((g) => (g ? { ...g, edges: g.edges.map((e) => (e.id === edge.id ? updated : e)) } : g));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleNarrate = useCallback(async () => {
    if (!graph) return;
    setNarrating(true);
    try {
      const { narration: text } = await narratePath(graph.universe.id, expeditionPath);
      setNarration(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setNarrating(false);
    }
  }, [graph, expeditionPath]);

  // 浮上。1回以上辿っていれば探検ログを保存する（1星だけ覗いて何もせず浮上した場合は保存しない）
  const handleSurface = useCallback(async () => {
    if (graph && expeditionPath.length > 1) {
      try {
        await saveExpedition(graph.universe.id, expeditionPath, narration);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    setChamberKey(null);
    setExpeditionPath([]);
    setNarration(null);
  }, [graph, expeditionPath, narration]);

  // レンズは「今どの問いで見ているか」の切り替えなので、選んでいる星があると
  // 効果がその星の近傍だけに埋もれて分かりにくくなる。切り替え時は選択を解除する
  const toggleLensCluster = useCallback((key: string) => {
    setLensCluster((prev) => (prev === key ? null : key));
    setSelectedKey(null);
  }, []);

  const toggleLensInferred = useCallback(() => {
    setLensInferred((v) => !v);
    setSelectedKey(null);
  }, []);

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

  const nodeByKey = new Map(graph.nodes.map((n) => [n.key, n]));
  const connections = selectedNode ? connectionsOf(graph.edges, selectedNode.key, nodeByKey) : [];

  const chamberNode: GraphNode | null = chamberKey ? nodeByKey.get(chamberKey) ?? null : null;
  const chamberConnections = chamberKey ? connectionsOf(graph.edges, chamberKey, nodeByKey) : [];
  const lastStep = expeditionPath[expeditionPath.length - 1];
  const arrivedEdge = lastStep?.edge_id ? graph.edges.find((e) => e.id === lastStep.edge_id) ?? null : null;
  const pathNodes = expeditionPath.map((step) => nodeByKey.get(step.node_key));

  return (
    <>
      <UniverseScene
        clusters={graph.clusters}
        nodes={graph.nodes}
        edges={graph.edges as GraphEdge[]}
        onSelect={handleSceneSelect}
        selectedKey={selectedKey}
        bornKey={bornKey}
        lensKeys={lensNodeKeys}
        focusRequest={focusRequest}
        chamberKey={chamberKey}
        travelRequest={travelRequest}
        onArrived={handleArrived}
      />

      {!chamberKey && (
        <div className="hud">
          <h1>{graph.universe.title}</h1>
          <p className="sub">語るそばから、宇宙が育つ</p>
          <div className="legend">
            {graph.clusters.map((c) => (
              <button
                key={c.key}
                className={`lens${lensCluster === c.key ? " active" : ""}`}
                onClick={() => toggleLensCluster(c.key)}
              >
                <i style={{ background: c.color, color: c.color }} />
                {c.label}
              </button>
            ))}
            <button className={`lens${lensInferred ? " active" : ""}`} onClick={toggleLensInferred}>
              <i style={{ background: "#ffd68a", color: "#ffd68a" }} />
              推定
            </button>
            <button className="lens" onClick={() => setStarListOpen(true)}>
              ☰ 一覧
            </button>
            <button className="lens" onClick={() => setClusterManagerOpen(true)}>
              ✎ クラスタ
            </button>
          </div>
        </div>
      )}

      {!chamberKey && starListOpen && (
        <StarList
          nodes={graph.nodes}
          edges={graph.edges as GraphEdge[]}
          clusters={graph.clusters}
          onClose={() => setStarListOpen(false)}
          onSelect={(key) => {
            setSelectedKey(key);
            setFocusRequest({ key, nonce: Date.now() });
            setStarListOpen(false);
          }}
          onReverseEdge={handleReverseEdge}
          onChangeEdgeKind={handleChangeEdgeKind}
          busy={busy}
        />
      )}

      {!chamberKey && clusterManagerOpen && (
        <ClusterManager
          clusters={graph.clusters}
          onClose={() => setClusterManagerOpen(false)}
          onRename={handleRenameCluster}
          onCreate={handleCreateCluster}
          busy={busy}
        />
      )}

      {!chamberKey && selectedNode && (
        <DetailPanel
          node={selectedNode}
          clusterLabel={selectedCluster?.label ?? selectedNode.cluster}
          clusterColor={selectedCluster?.color ?? "#a78bfa"}
          connections={connections}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onEditComment={(comment) => setPrefill(comment)}
          onDirectEdit={(field, before, after) => handleDirectEdit(selectedNode, field, before, after)}
          onCutEdge={handleCutEdge}
          onReverseEdge={handleReverseEdge}
          onChangeEdgeKind={handleChangeEdgeKind}
          onStartTie={() => setTyingFrom((cur) => (cur === selectedNode.key ? null : selectedNode.key))}
          tyingFromThisNode={tyingFrom === selectedNode.key}
          onPlantNode={handlePlantNode}
          onDive={() => handleDive(selectedNode.key)}
          busy={busy}
        />
      )}

      {chamberKey && chamberNode && (
        <ChamberPanel
          key={chamberKey}
          node={chamberNode}
          connections={chamberConnections}
          path={expeditionPath}
          pathNodes={pathNodes}
          arrivedEdge={arrivedEdge}
          narration={narration}
          narrating={narrating}
          busy={busy}
          onTraverse={handleTraverse}
          onJumpBreadcrumb={handleJumpToBreadcrumb}
          onSetMemo={handleSetMemo}
          onReinforce={handleReinforceEdge}
          onNarrate={handleNarrate}
          onSurface={handleSurface}
        />
      )}

      {!chamberKey && tyingFrom && (
        <TiePicker
          sourceLabel={graph.nodes.find((n) => n.key === tyingFrom)?.label ?? tyingFrom}
          candidates={graph.nodes.filter((n) => n.key !== tyingFrom)}
          clusters={graph.clusters}
          onCancel={() => setTyingFrom(null)}
          onConfirm={(targetKey, description, kind) => {
            handleTieEdge(tyingFrom, targetKey, description, kind);
            setTyingFrom(null);
          }}
        />
      )}

      {cutUndo && (
        <div className="undo-toast">
          <span>糸 {cutUndo.source_key}→{cutUndo.target_key} を切りました</span>
          <button onClick={handleUndoCut} disabled={busy}>
            元に戻す
          </button>
        </div>
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
