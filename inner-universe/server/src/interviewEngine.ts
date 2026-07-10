import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropicClient.js";
import { supabase } from "./db.js";
import { buildGraphDigest, getGraph, getUniverse } from "./graph.js";
import { loadMessages, saveMessage } from "./messages.js";
import { INTERVIEW_TOOLS } from "./tools.js";
import { INTERVIEWER_SYSTEM_PROMPT } from "./systemPrompt.js";
import type { GraphEdge, GraphNode } from "./types.js";

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
    strength: number;
    description: string;
    inferred: boolean;
  }
): Promise<{ ok: true; edge: GraphEdge } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("edges")
    .insert({
      universe_id: universeId,
      source_key: input.source_key,
      target_key: input.target_key,
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

async function execSetPendingQuestion(
  universeId: string,
  question: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from("universes")
    .update({ pending_question: question })
    .eq("id", universeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
      case "set_pending_question": {
        const question = String(input.question ?? "");
        const result = await execSetPendingQuestion(universeId, question);
        if (!result.ok) {
          return { type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error };
        }
        send({ type: "pending_question", question });
        return { type: "tool_result", tool_use_id: block.id, content: "次の質問を保存しました" };
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

export async function runInterviewTurn(universeId: string, userText: string, send: SseSend) {
  const universe = await getUniverse(universeId);
  const history = await loadMessages(universeId);

  const { nodes } = await getGraph(universeId);
  const digest = buildGraphDigest(nodes, universe.pending_question);
  const firstUserContent = `${digest}\n<user_message>${userText}</user_message>`;

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
