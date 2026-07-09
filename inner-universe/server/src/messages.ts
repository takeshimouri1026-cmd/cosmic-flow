import type Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./db.js";

export interface StoredMessage {
  role: "user" | "assistant";
  content: Anthropic.MessageParam["content"];
}

export async function loadMessages(universeId: string): Promise<Anthropic.MessageParam[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("universe_id", universeId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content as Anthropic.MessageParam["content"],
  }));
}

export async function saveMessage(
  universeId: string,
  role: "user" | "assistant",
  content: Anthropic.MessageParam["content"]
) {
  const { error } = await supabase.from("messages").insert({
    universe_id: universeId,
    role,
    content,
  });
  if (error) throw error;
}
