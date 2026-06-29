import React, { useState } from "react";
import { supabase } from "./supabase.js";

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleEmail(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage("確認メールを送りました。メールのリンクをクリックしてログインしてください。");
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) { setError(error.message); setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="tracking-[0.4em] text-amber-300/70 text-xs mb-3">COSMIC FLOW</p>
          <h1 className="font-serif text-3xl text-stone-100">
            {mode === "login" ? "ログイン" : "アカウント作成"}
          </h1>
        </div>

        <div className="bg-white/[0.04] backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-[0_0_50px_rgba(120,110,200,0.08)] space-y-4">
          {/* Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-white text-stone-800 font-medium rounded-xl py-3 hover:bg-stone-100 transition disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Googleでログイン
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-stone-500">または</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Email/Password */}
          <form onSubmit={handleEmail} className="space-y-3">
            <input
              type="email"
              placeholder="メールアドレス"
              className="w-full bg-black/30 rounded-lg px-4 py-2.5 border border-white/10 focus:border-amber-300/50 outline-none text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              placeholder="パスワード（8文字以上）"
              className="w-full bg-black/30 rounded-lg px-4 py-2.5 border border-white/10 focus:border-amber-300/50 outline-none text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-300 text-stone-900 font-medium rounded-xl py-3 hover:bg-amber-200 transition disabled:opacity-50"
            >
              {loading ? "処理中…" : mode === "login" ? "ログイン" : "アカウント作成"}
            </button>
          </form>

          {error && <p className="text-rose-300 text-sm text-center">{error}</p>}
          {message && <p className="text-emerald-400 text-sm text-center">{message}</p>}

          <p className="text-center text-sm text-stone-500">
            {mode === "login" ? "アカウントをお持ちでない方は" : "すでにアカウントをお持ちの方は"}
            <button
              onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}
              className="text-amber-300 ml-1 hover:underline"
            >
              {mode === "login" ? "新規登録" : "ログイン"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
