import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropicClient.js";
import { supabase } from "./db.js";
import { buildGraphDigest, findEdgeByPair, getGraph, getQuestions, getUniverse } from "./graph.js";
import { loadMessages, saveMessage } from "./messages.js";
import { INTERVIEW_TOOLS } from "./tools.js";
import { INTERVIEWER_SYSTEM_PROMPT } from "./systemPrompt.js";
import type { GraphEdge, GraphNode, Question } from "./types.js";

export type SseSend = (event: Record<string, unknown>) => void;

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8000;

async function execAddNode(
  universeId: string,
  input: {
    key: string;
    label: string;
    type: string;
    cluster: string;
    size: number;
    description: string;
    status: string;
  }
): Promise<{ ok: true; node: GraphNode } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("nodes")
    .insert({
      universe_id: universeId,
      key: input.key,
      label: input.label,
      type: input.type,
      cluster: input.cluster,
      size: input.size,
      description: input.description,
      status: input.status,
      source: "interview",
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, node: data as GraphNode };
}

async function execAddEdge(
  universeId: string,
  input: {
    source_key: string;
    target_key: string;
    kind: string;
    strength: number;
    description: string;
    inferred: boolean;
  }
): Promise<{ ok: true; edge: GraphEdge } | { ok: false; error: string }> {
  if (input.kind !== "influence" && input.kind !== "example" && input.kind !== "resonance") {
    return { ok: false, error: `kind は 'influence' / 'example' / 'resonance' のいずれか（受け取った値: ${input.kind}）` };
  }
  if (input.kind === "resonance") {
    const reverse = await findEdgeByPair(universeId, input.target_key, input.source_key);
    if (reverse) {
      return {
        ok: false,
        error: `既に逆向きの糸 ${input.target_key}->${input.source_key} が存在します。resonanceは向きを問わないので新しく張る必要はありません`,
      };
    }
  }
  const { data, error } = await supabase
    .from("edges")
    .insert({
      universe_id: universeId,
      source_key: input.source_key,
      target_key: input.target_key,
      kind: input.kind,
      strength: input.strength,
      description: input.description,
      inferred: input.inferred,
      source: "interview",
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, edge: data as GraphEdge };
}

async function execUpdateNode(
  universeId: string,
  input: {
    key: string;
    label: string | null;
    size: number | null;
    cluster: string | null;
    description: string | null;
    status: string | null;
  }
): Promise<{ ok: true; node: GraphNode } | { ok: false; error: string }> {
  const { data: existing, error: fetchErr } = await supabase
    .from("nodes")
    .select("user_edited")
    .eq("universe_id", universeId)
    .eq("key", input.key)
    .single();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (existing.user_edited && (input.label !== null || input.description !== null)) {
    return {
      ok: false,
      error:
        "このノードの言葉は本人が直接編集済みです（user_edited=true）。label/descriptionは上書きできません。変えるべきだと思うなら、応答の中で本人に提案してください。",
    };
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== null) patch.label = input.label;
  if (input.size !== null) patch.size = input.size;
  if (input.cluster !== null) patch.cluster = input.cluster;
  if (input.description !== null) patch.description = input.description;
  // スキーマ側でenum制約を掛けられない（union型+enumはAPIが400を返す）ためここで検証
  if (input.status !== null) {
    if (input.status !== "confirmed" && input.status !== "inferred") {
      return { ok: false, error: `status は 'confirmed' か 'inferred'（受け取った値: ${input.status}）` };
    }
    patch.status = input.status;
  }

  const { data, error } = await supabase
    .from("nodes")
    .update(patch)
    .eq("universe_id", universeId)
    .eq("key", input.key)
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, node: data as GraphNode };
}

async function execRemoveEdge(
  universeId: string,
  input: { source_key: string; target_key: string; reason: string }
): Promise<{ ok: true; edgeId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("edges")
    .delete()
    .eq("universe_id", universeId)
    .eq("source_key", input.source_key)
    .eq("target_key", input.target_key)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: `糸 ${input.source_key}→${input.target_key} は見つかりませんでした` };
  return { ok: true, edgeId: data.id as string };
}

// 質問の泉（§14.3）: present=trueは既存のaskedをopenに還してから新規をaskedでinsert
// （「提示は常に1つ」をサーバが保証。答えなかった質問は自動的に泉へ戻る）。present=falseは貯めるだけ
async function execQueueQuestion(
  universeId: string,
  input: { question: string; rationale: string; related_keys: string[]; present: boolean }
): Promise<{ ok: true; question: Question } | { ok: false; error: string }> {
  // strict:falseのツールのためサーバ側で形を検証する（tools.ts参照: 実APIのschema複雑度上限の回避）
  if (typeof input.question !== "string" || !input.question.trim()) {
    return { ok: false, error: "question は空でない文字列が必要です" };
  }
  if (typeof input.present !== "boolean") {
    return { ok: false, error: "present は true/false のいずれかが必要です" };
  }
  if (input.related_keys !== undefined && !Array.isArray(input.related_keys)) {
    return { ok: false, error: "related_keys は文字列の配列が必要です" };
  }
  if (input.present) {
    const { error: revertErr } = await supabase
      .from("questions")
      .update({ status: "open" })
      .eq("universe_id", universeId)
      .eq("status", "asked");
    if (revertErr) return { ok: false, error: revertErr.message };
  }
  const { data, error } = await supabase
    .from("questions")
    .insert({
      universe_id: universeId,
      question: input.question,
      rationale: input.rationale || null,
      evidence: { node_keys: input.related_keys ?? [] },
      status: input.present ? "asked" : "open",
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, question: data as Question };
}

async function runToolUse(
  universeId: string,
  block: Anthropic.ToolUseBlock,
  send: SseSend
): Promise<Anthropic.ToolResultBlockParam> {
  const input = block.input as Record<string, unknown>;
  try {
    switch (block.name) {
      case "add_node": {
        const result = await execAddNode(universeId, input as never);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        send({ type: "node_added", node: result.node });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: `星「${result.node.label}」(${result.node.key}) を追加しました`,
        };
      }
      case "add_edge": {
        const result = await execAddEdge(universeId, input as never);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        send({ type: "edge_added", edge: result.edge });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: `糸 ${result.edge.source_key}→${result.edge.target_key} を張りました`,
        };
      }
      case "update_node": {
        const result = await execUpdateNode(universeId, input as never);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        send({ type: "node_updated", node: result.node });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: `星「${result.node.label}」(${result.node.key}) を更新しました`,
        };
      }
      case "remove_edge": {
        const result = await execRemoveEdge(universeId, input as never);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        send({ type: "edge_removed", edge_id: result.edgeId });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: `糸 ${(input as { source_key: string }).source_key}→${(input as { target_key: string }).target_key} を切りました`,
        };
      }
      case "queue_question": {
        const result = await execQueueQuestion(universeId, input as never);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        const present = result.question.status === "asked";
        send({ type: "question_queued", question: result.question.question, present });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: present ? "この質問を締めの質問として保存しました" : "質問を泉に貯めました",
        };
      }
      default:
        return {
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: `unknown tool: ${block.name}`,
        };
    }
  } catch (err) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: err instanceof Error ? err.message : String(err),
    };
  }
}

function withCache<T extends { text: string; type: "text" }>(block: T): T & { cache_control: { type: "ephemeral" } } {
  return { ...block, cache_control: { type: "ephemeral" as const } };
}

export async function runInterviewTurn(
  universeId: string,
  turnBody: string,
  send: SseSend,
  questionId?: string | null
) {
  await getUniverse(universeId);
  const history = await loadMessages(universeId);

  const { nodes, edges } = await getGraph(universeId);
  const springQuestions = await getQuestions(universeId);
  const askedQuestion = springQuestions.find((q) => q.status === "asked")?.question ?? null;
  const openQuestions = springQuestions.filter((q) => q.status === "open");
  const digest = buildGraphDigest(nodes, edges, askedQuestion, openQuestions);

  // 泉から質問を選んで答えに来た場合、その文脈をAIに渡す（§14.3）
  let answeringQuestion: Question | null = null;
  if (questionId) {
    const { data, error } = await supabase.from("questions").select("*").eq("id", questionId).maybeSingle();
    if (error) throw error;
    answeringQuestion = data as Question | null;
  }
  const answeringBlock = answeringQuestion
    ? `<answering_question>${answeringQuestion.question}</answering_question>\n`
    : "";

  const firstUserContent = `${digest}\n${answeringBlock}${turnBody}`;

  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: firstUserContent },
  ];

  await saveMessage(universeId, "user", firstUserContent);

  const system: Anthropic.TextBlockParam[] = [
    withCache({ type: "text", text: INTERVIEWER_SYSTEM_PROMPT }),
  ];

  let turnUserBlocks: Anthropic.MessageParam[] = messages;

  for (let iteration = 0; iteration < 8; iteration++) {
    // cache_control on the last block of the running message list (incremental caching)
    const cachedMessages = markLastBlockCached(turnUserBlocks);

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools: INTERVIEW_TOOLS,
      messages: cachedMessages,
    });

    stream.on("text", (delta) => {
      send({ type: "text", text: delta });
    });

    // ここでSSEにerrorを流すとroutes側のcatchと二重になる。ログのみに留め、
    // finalMessage()のrejectをroutes側で一元的にエラーイベント化する
    stream.on("error", (err) => {
      console.error("interview stream error:", err instanceof Error ? err.message : err);
    });

    const finalMessage = await stream.finalMessage();

    // persist assistant turn (content as-is, incl. tool_use)
    await saveMessage(universeId, "assistant", finalMessage.content);
    turnUserBlocks = [...turnUserBlocks, { role: "assistant", content: finalMessage.content }];

    if (finalMessage.stop_reason !== "tool_use") {
      if (answeringQuestion) {
        await supabase.from("questions").update({ status: "answered" }).eq("id", answeringQuestion.id);
      }
      send({ type: "done" });
      return;
    }

    const toolUseBlocks = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      results.push(await runToolUse(universeId, block, send));
    }

    const toolResultMessage: Anthropic.MessageParam = { role: "user", content: results };
    await saveMessage(universeId, "user", results);
    turnUserBlocks = [...turnUserBlocks, toolResultMessage];
  }

  send({ type: "error", message: "ツール呼び出しの上限に達しました" });
  send({ type: "done" });
}

function markLastBlockCached(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const content = last.content;
  if (typeof content === "string") {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        content: [withCache({ type: "text", text: content })],
      },
    ];
  }
  if (content.length === 0) return messages;
  const lastBlock = content[content.length - 1];
  const cachedBlock = { ...lastBlock, cache_control: { type: "ephemeral" as const } };
  return [
    ...messages.slice(0, -1),
    { ...last, content: [...content.slice(0, -1), cachedBlock] },
  ];
}
