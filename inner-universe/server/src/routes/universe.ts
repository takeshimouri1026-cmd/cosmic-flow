import { Router } from "express";
import { supabase } from "../db.js";
import { findEdgeByPair, getGraph, getUniverse } from "../graph.js";
import { runInterviewTurn } from "../interviewEngine.js";

const EDGE_KINDS = ["influence", "example", "resonance"] as const;
const EDGE_KIND_LABEL: Record<string, string> = {
  influence: "影響",
  example: "あらわれ",
  resonance: "響き合い",
};

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

// クラスタを新しく作る
universeRouter.post("/:id/clusters", async (req, res) => {
  const universeId = req.params.id;
  const label = String(req.body?.label ?? "").trim();
  const color = String(req.body?.color ?? "").trim();
  if (!label || !color) {
    res.status(400).json({ error: "label, color が必要です" });
    return;
  }
  const key = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from("clusters")
    .insert({ universe_id: universeId, key, label, color })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ cluster: data });
});

// クラスタの名称を書き換える
universeRouter.patch("/:id/clusters/:key", async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
  if (!label) {
    res.status(400).json({ error: "label が必要です" });
    return;
  }
  const { data, error } = await supabase
    .from("clusters")
    .update({ label })
    .eq("universe_id", req.params.id)
    .eq("key", req.params.key)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ cluster: data });
});

function buildActionBlock(action: Record<string, unknown>): string | null {
  const kind = String(action.kind ?? "");
  switch (kind) {
    case "edit_node": {
      const key = String(action.key ?? "");
      const field = action.field === "label" ? "名前" : "説明";
      const before = String(action.before ?? "");
      const after = String(action.after ?? "");
      if (!key || !after) return null;
      return `<user_action>星「${key}」の${field}を書き換えた。\nbefore: ${before}\nafter: ${after}</user_action>`;
    }
    case "cut_edge": {
      const sourceKey = String(action.source_key ?? "");
      const targetKey = String(action.target_key ?? "");
      const reason = String(action.reason ?? "（理由なし）");
      if (!sourceKey || !targetKey) return null;
      return `<user_action>糸 ${sourceKey}→${targetKey} を切った。理由: ${reason}</user_action>`;
    }
    case "tie_edge": {
      const sourceKey = String(action.source_key ?? "");
      const targetKey = String(action.target_key ?? "");
      const description = String(action.description ?? "");
      const edgeKind = String(action.edgeKind ?? "influence");
      if (!sourceKey || !targetKey || !description) return null;
      const kindLabel = EDGE_KIND_LABEL[edgeKind] ?? edgeKind;
      return `<user_action>糸 ${sourceKey}→${targetKey} を新しく張った（${kindLabel}）。説明: 「${description}」</user_action>`;
    }
    case "plant_node": {
      const name = String(action.name ?? "");
      const comment = String(action.comment ?? "");
      if (!name) return null;
      return `<user_action>新しい星を植えたいと思っている。名前: 「${name}」。一言: 「${comment}」。既存の構造にふさわしい形で実体化してほしい（add_nodeで追加し、関連する源流/流れの先の糸も提案してください）。</user_action>`;
    }
    default:
      return null;
  }
}

universeRouter.post("/:id/interview", async (req, res) => {
  const universeId = req.params.id;

  let turnBody: string;
  if (req.body?.action) {
    const block = buildActionBlock(req.body.action as Record<string, unknown>);
    if (!block) {
      res.status(400).json({ error: "invalid action" });
      return;
    }
    turnBody = block;
  } else {
    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    turnBody = `<user_message>${text}</user_message>`;
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
    await runInterviewTurn(universeId, turnBody, send);
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    interviewLocks.delete(universeId);
    res.end();
  }
});

export const nodeRouter = Router();

// 星の言葉を直す（手入れモード§13.2）。即時反映、user_edited=trueにしAIの上書きを禁じる
nodeRouter.patch("/:id", async (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim() : undefined;
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : undefined;
  if (!label && !description) {
    res.status(400).json({ error: "label または description が必要です" });
    return;
  }
  const patch: Record<string, unknown> = { user_edited: true, updated_at: new Date().toISOString() };
  if (label) patch.label = label;
  if (description) patch.description = description;

  const { data, error } = await supabase
    .from("nodes")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ node: data });
});

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

export const edgeRouter = Router();

// 糸を張る（手入れモード§13.2）。即時反映。説明はユーザーの一言そのまま
edgeRouter.post("/", async (req, res) => {
  const universeId = String(req.body?.universe_id ?? "");
  const sourceKey = String(req.body?.source_key ?? "");
  const targetKey = String(req.body?.target_key ?? "");
  const description = String(req.body?.description ?? "").trim();
  if (!universeId || !sourceKey || !targetKey || !description) {
    res.status(400).json({ error: "universe_id, source_key, target_key, description が必要です" });
    return;
  }
  const kind = typeof req.body?.kind === "string" ? req.body.kind : "influence";
  if (!EDGE_KINDS.includes(kind as (typeof EDGE_KINDS)[number])) {
    res.status(400).json({ error: `kind は ${EDGE_KINDS.join("/")} のいずれかです` });
    return;
  }
  // resonanceは向きに意味がないため、逆向きの既存行があれば重複として拒否する（§2.1）
  if (kind === "resonance") {
    const reverse = await findEdgeByPair(universeId, targetKey, sourceKey);
    if (reverse) {
      res.status(409).json({ error: `既に逆向きの糸 ${targetKey}→${sourceKey} があります。resonanceは向きを問いません` });
      return;
    }
  }
  // 「元に戻す」（切った糸の復元）は、切る前の strength/inferred をそのまま渡してくる
  const strength = typeof req.body?.strength === "number" ? req.body.strength : 0.6;
  const inferred = typeof req.body?.inferred === "boolean" ? req.body.inferred : false;
  const { data, error } = await supabase
    .from("edges")
    .insert({
      universe_id: universeId,
      source_key: sourceKey,
      target_key: targetKey,
      kind,
      strength,
      description,
      inferred,
      source: "manual",
    })
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ edge: data });
});

// 糸を切る（手入れモード§13.2）。即時反映
edgeRouter.delete("/:id", async (req, res) => {
  const { error } = await supabase.from("edges").delete().eq("id", req.params.id);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ ok: true });
});

// 糸の関係を編む（§13.5）: kindの変更・向きの反転。LLMには流さない直接更新
edgeRouter.patch("/:id", async (req, res) => {
  const { data: current, error: fetchErr } = await supabase
    .from("edges")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (fetchErr || !current) {
    res.status(404).json({ error: fetchErr?.message ?? "not found" });
    return;
  }

  const reverse = req.body?.reverse === true;
  const kindRaw = req.body?.kind;
  const patch: Record<string, unknown> = {};

  if (kindRaw !== undefined) {
    if (!EDGE_KINDS.includes(kindRaw as (typeof EDGE_KINDS)[number])) {
      res.status(400).json({ error: `kind は ${EDGE_KINDS.join("/")} のいずれかです` });
      return;
    }
    patch.kind = kindRaw;
  }

  const nextSourceKey = reverse ? current.target_key : current.source_key;
  const nextTargetKey = reverse ? current.source_key : current.target_key;
  const nextKind = (patch.kind as string | undefined) ?? current.kind;

  if (reverse) {
    const conflict = await findEdgeByPair(current.universe_id, nextSourceKey, nextTargetKey, current.id);
    if (conflict) {
      res.status(409).json({ error: `糸 ${nextSourceKey}→${nextTargetKey} は既に存在します` });
      return;
    }
    patch.source_key = nextSourceKey;
    patch.target_key = nextTargetKey;
  }
  if (nextKind === "resonance") {
    const reverseConflict = await findEdgeByPair(current.universe_id, nextTargetKey, nextSourceKey, current.id);
    if (reverseConflict) {
      res.status(409).json({ error: `既に逆向きの糸 ${nextTargetKey}→${nextSourceKey} があります。resonanceは向きを問いません` });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.json({ edge: current });
    return;
  }

  const { data, error } = await supabase
    .from("edges")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ edge: data });
});
