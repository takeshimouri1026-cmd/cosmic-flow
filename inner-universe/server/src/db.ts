import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY が設定されていません");
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  // Node 20はネイティブWebSocket未対応のため、realtimeクライアント初期化用に明示的に渡す（実際にはrealtime機能は未使用）
  realtime: { transport: WebSocket as never },
});
