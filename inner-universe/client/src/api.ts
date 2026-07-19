import { supabase } from "./supabaseClient";
import type {
  Cluster,
  EdgeKind,
  Expedition,
  ExpeditionStep,
  GraphState,
  InterviewEvent,
  Question,
  QuestionStatus,
  TranscriptItem,
  Universe,
} from "./types";

async function headers(extra?: Record<string, string>): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // セッション切れ（401）はサインアウトしてAuthGateのログイン画面に戻す（§15.5）
    if (res.status === 401) await supabase.auth.signOut();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDefaultUniverse(): Promise<Universe> {
  const res = await fetch("/api/default-universe", { headers: await headers() });
  const data = await asJson<{ universe: Universe }>(res);
  return data.universe;
}

export async function fetchGraph(universeId: string): Promise<GraphState> {
  const res = await fetch(`/api/universe/${universeId}/graph`, { headers: await headers() });
  return asJson<GraphState>(res);
}

export async function createCluster(universeId: string, label: string, color: string): Promise<{ cluster: Cluster }> {
  const res = await fetch(`/api/universe/${universeId}/clusters`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ label, color }),
  });
  return asJson(res);
}

export async function renameCluster(universeId: string, key: string, label: string): Promise<{ cluster: Cluster }> {
  const res = await fetch(`/api/universe/${universeId}/clusters/${key}`, {
    method: "PATCH",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ label }),
  });
  return asJson(res);
}

export async function confirmNode(nodeId: string) {
  const res = await fetch(`/api/nodes/${nodeId}/confirm`, { method: "POST", headers: await headers() });
  return asJson(res);
}

export async function rejectNode(nodeId: string) {
  const res = await fetch(`/api/nodes/${nodeId}/reject`, { method: "POST", headers: await headers() });
  return asJson(res);
}

export async function patchNode(nodeId: string, patch: { label?: string; description?: string }) {
  const res = await fetch(`/api/nodes/${nodeId}`, {
    method: "PATCH",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function createEdge(
  universeId: string,
  sourceKey: string,
  targetKey: string,
  description: string,
  opts?: { strength?: number; inferred?: boolean; kind?: EdgeKind }
) {
  const res = await fetch(`/api/edges`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      universe_id: universeId,
      source_key: sourceKey,
      target_key: targetKey,
      description,
      ...opts,
    }),
  });
  return asJson(res);
}

export async function deleteEdge(edgeId: string) {
  const res = await fetch(`/api/edges/${edgeId}`, { method: "DELETE", headers: await headers() });
  return asJson(res);
}

// 糸の関係を編む（§13.5）/ 強化する（§12.3）。LLMには流さない直接更新
export async function patchEdge(edgeId: string, patch: { kind?: EdgeKind; reverse?: boolean; reinforce?: boolean }) {
  const res = await fetch(`/api/edges/${edgeId}`, {
    method: "PATCH",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

// 探索モード（§12.5）: 経路の内省ナレーションを単発生成する
export async function narratePath(universeId: string, path: ExpeditionStep[]): Promise<{ narration: string }> {
  const res = await fetch(`/api/universe/${universeId}/narrate-path`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path }),
  });
  return asJson(res);
}

// 探索モード（§12.5）: 探検の終わりに経路とナレーションを保存する
export async function saveExpedition(
  universeId: string,
  path: ExpeditionStep[],
  narration: string | null
): Promise<{ expedition: Expedition }> {
  const res = await fetch(`/api/universe/${universeId}/expeditions`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ path, narration }),
  });
  return asJson(res);
}

export type UserAction =
  | { kind: "edit_node"; key: string; field: "label" | "description"; before: string; after: string }
  | { kind: "cut_edge"; source_key: string; target_key: string; reason: string }
  | { kind: "tie_edge"; source_key: string; target_key: string; description: string; edgeKind: EdgeKind }
  | { kind: "plant_node"; name: string; comment: string };

export async function streamAction(
  universeId: string,
  action: UserAction,
  onEvent: (event: InterviewEvent) => void
): Promise<void> {
  const res = await fetch(`/api/universe/${universeId}/interview`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action }),
  });
  await consumeSse(res, onEvent);
}

export async function streamInterview(
  universeId: string,
  text: string,
  onEvent: (event: InterviewEvent) => void,
  signal?: AbortSignal,
  questionId?: string | null
): Promise<void> {
  const res = await fetch(`/api/universe/${universeId}/interview`, {
    method: "POST",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, question_id: questionId ?? undefined }),
    signal,
  });
  await consumeSse(res, onEvent);
}

// 質問の泉（§14.4）
export async function fetchQuestions(universeId: string, all = false): Promise<{ questions: Question[] }> {
  const res = await fetch(`/api/universe/${universeId}/questions${all ? "?all=1" : ""}`, { headers: await headers() });
  return asJson(res);
}

export async function patchQuestion(questionId: string, status: QuestionStatus): Promise<{ question: Question }> {
  const res = await fetch(`/api/questions/${questionId}`, {
    method: "PATCH",
    headers: await headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status }),
  });
  return asJson(res);
}

// 対話の航跡（§14.4）
export async function fetchTranscript(
  universeId: string,
  opts?: { before?: string; limit?: number }
): Promise<{ items: TranscriptItem[] }> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`/api/universe/${universeId}/transcript${qs ? `?${qs}` : ""}`, { headers: await headers() });
  return asJson(res);
}

async function consumeSse(res: Response, onEvent: (event: InterviewEvent) => void): Promise<void> {
  if (!res.ok || !res.body) {
    if (res.status === 401) await supabase.auth.signOut();
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const json = line.slice("data: ".length);
      try {
        onEvent(JSON.parse(json) as InterviewEvent);
      } catch {
        // 不正なSSEチャンクは無視
      }
    }
  }
}
