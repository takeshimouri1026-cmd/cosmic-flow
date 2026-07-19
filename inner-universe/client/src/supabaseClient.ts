import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が設定されていません");
}

// authだけ使う。DBの読み書きはこれまでどおり全部Express経由（§15.2）
export const supabase = createClient(url, key);
