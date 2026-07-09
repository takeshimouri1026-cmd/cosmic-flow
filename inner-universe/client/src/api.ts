import type { GraphState, InterviewEvent, Universe } from "./types";

const APP_SECRET = import.meta.env.VITE_APP_SHARED_SECRET as string | undefined;

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(APP_SECRET ? { "x-app-secret": APP_SECRET } : {}),
    ...extra,
  };
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchDefaultUniverse(): Promise<Universe> {
  const res = await fetch("/api/default-universe", { headers: headers() });
  const data = await asJson<{ universe: Universe }>(res);
  return data.universe;
}

export async function fetchGraph(universeId: string): Promise<GraphState> {
  const res = await fetch(`/api/universe/${universeId}/graph`, { headers: headers() });
  return asJson<GraphState>(res);
}

export async function confirmNode(nodeId: string) {
  const res = await fetch(`/api/nodes/${nodeId}/confirm`, { method: "POST", headers: headers() });
  return asJson(res);
}

export async function rejectNode(nodeId: string) {
  const res = await fetch(`/api/nodes/${nodeId}/reject`, { method: "POST", headers: headers() });
  return asJson(res);
}

export async function streamInterview(
  universeId: string,
  text: string,
  onEvent: (event: InterviewEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`/api/universe/${universeId}/interview`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
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
