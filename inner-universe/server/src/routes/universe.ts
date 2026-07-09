import { Router } from "express";
import { supabase } from "../db.js";
import { getGraph, getUniverse } from "../graph.js";
import { runInterviewTurn } from "../interviewEngine.js";

export const universeRouter = Router();

// 同時1リクエストの連打防止（インタビューエンドポイントのみ）
const interviewLocks = new Set<string>();

universeRouter.get("/:id/graph", async (req, res) => {
  try {
    const [universe, graph] = await Promise.all([
      getUniverse(req.params.id),
      getGraph(req.params.id),
    ]);
    res.json({ universe, ...graph });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

universeRouter.post("/:id/interview", async (req, res) => {
  const universeId = req.params.id;
  const text = String(req.body?.text ?? "").trim();
  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (interviewLocks.has(universeId)) {
    res.status(429).json({ error: "前の発話がまだ処理中です" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  interviewLocks.add(universeId);
  try {
    await runInterviewTurn(universeId, text, send);
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    interviewLocks.delete(universeId);
    res.end();
  }
});

export const nodeRouter = Router();

nodeRouter.post("/:id/confirm", async (req, res) => {
  const { data, error } = await supabase
    .from("nodes")
    .update({ status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ node: data });
});

nodeRouter.post("/:id/reject", async (req, res) => {
  const { data: node, error: fetchErr } = await supabase
    .from("nodes")
    .select("id, key, universe_id")
    .eq("id", req.params.id)
    .single();
  if (fetchErr || !node) {
    res.status(404).json({ error: fetchErr?.message ?? "not found" });
    return;
  }
  await supabase
    .from("edges")
    .delete()
    .eq("universe_id", node.universe_id)
    .or(`source_key.eq.${node.key},target_key.eq.${node.key}`);
  const { error: delErr } = await supabase.from("nodes").delete().eq("id", node.id);
  if (delErr) {
    res.status(500).json({ error: delErr.message });
    return;
  }
  res.json({ ok: true });
});
