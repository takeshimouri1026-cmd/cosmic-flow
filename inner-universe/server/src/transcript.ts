import type Anthropic from "@anthropic-ai/sdk";
import type { TranscriptItem } from "./types.js";

// 対話の航跡（§14.3）: messages 1行を表示アイテム配列に蒸留する。
// 生のグラフダイジェスト・tool_use/tool_resultの生JSONはクライアントに出さない。
export function distillMessage(msg: {
  role: string;
  content: unknown;
  created_at: string;
}): TranscriptItem[] {
  const { role, content, created_at } = msg;
  const items: TranscriptItem[] = [];

  if (role === "user") {
    if (typeof content !== "string") return items; // tool_result（array content）はスキップ

    let text = content.replace(/<graph_digest>[\s\S]*?<\/graph_digest>\n?/, "");

    const actionMatch = text.match(/<user_action>([\s\S]*?)<\/user_action>/);
    if (actionMatch) {
      const summary = actionMatch[1].trim().split("\n")[0];
      items.push({ type: "action", summary, created_at });
      text = text.replace(/<user_action>[\s\S]*?<\/user_action>\n?/, "");
    }

    const answeringMatch = text.match(/<answering_question>([\s\S]*?)<\/answering_question>/);
    if (answeringMatch) {
      items.push({ type: "picked_question", question: answeringMatch[1].trim(), created_at });
      text = text.replace(/<answering_question>[\s\S]*?<\/answering_question>\n?/, "");
    }

    const userMessageMatch = text.match(/<user_message>([\s\S]*?)<\/user_message>/);
    const remaining = userMessageMatch ? userMessageMatch[1].trim() : text.trim();
    if (remaining) {
      items.push({ type: "user_text", text: remaining, created_at });
    }
    return items;
  }

  if (role === "assistant" && Array.isArray(content)) {
    for (const block of content as Anthropic.ContentBlock[]) {
      if (block.type === "text") {
        if (block.text.trim()) items.push({ type: "ai_text", text: block.text, created_at });
        continue;
      }
      if (block.type === "tool_use") {
        const input = block.input as Record<string, unknown>;
        switch (block.name) {
          case "add_node":
            items.push({ type: "star_born", label: String(input.label ?? ""), created_at });
            break;
          case "add_edge":
            items.push({
              type: "thread_tied",
              source_key: String(input.source_key ?? ""),
              target_key: String(input.target_key ?? ""),
              created_at,
            });
            break;
          case "update_node":
            items.push({ type: "star_updated", key: String(input.key ?? ""), created_at });
            break;
          case "remove_edge":
            items.push({ type: "thread_cut", created_at });
            break;
          case "queue_question":
            items.push({ type: "question_queued", present: Boolean(input.present), created_at });
            break;
        }
      }
    }
  }

  return items;
}
