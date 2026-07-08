import React, { useState } from "react";
import { filterByPeriod, monthRange, downloadText } from "./exportUtils.js";

const API = import.meta.env.VITE_API_URL || "";

// kind: "logs" | "readings"
// items: 元データ配列 / dateKey: 期間フィルタに使う日付フィールド
// toText: (filtered, from, to) => string / defaultEmail: 宛先の初期値
// snapshotText を渡すと期間指定UIを隠し、その固定テキストをそのまま取り出す(分析結果など)
export default function ExportModal({ open, onClose, title, kind, items, dateKey, toText, defaultEmail, snapshotText }) {
  const [mode, setMode] = useState("month"); // month | range
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [email, setEmail] = useState(defaultEmail || "");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (!open) return null;

  function resolveRange() {
    if (mode === "month") return monthRange(month);
    return { from, to };
  }

  function build() {
    if (snapshotText != null) {
      // スナップショット(期間フィルタなし)。1件扱いで空チェックを通す
      return { filtered: [1], text: snapshotText };
    }
    const { from: f, to: t } = resolveRange();
    const filtered = filterByPeriod(items, dateKey, f, t);
    return { filtered, text: toText(filtered, f, t), f, t };
  }

  function handleDownload() {
    setErr(""); setMsg("");
    const { filtered, text } = build();
    if (filtered.length === 0) { setErr("この期間の記録はありません。"); return; }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`cosmic-flow_${kind}_${stamp}.txt`, text);
    setMsg("ダウンロードしました。");
  }

  async function handleEmail() {
    setErr(""); setMsg("");
    if (!email) { setErr("送信先メールアドレスを入力してください。"); return; }
    const { filtered, text } = build();
    if (filtered.length === 0) { setErr("この期間の記録はありません。"); return; }
    setSending(true);
    try {
      const r = await fetch(`${API}/api/export-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email, subject: `Cosmic Flow ｜ ${title}`, text }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setMsg("メールを送信しました。");
    } catch (e) {
      setErr(e.message || "メール送信に失敗しました。");
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0f0d24] rounded-2xl p-6 border border-white/10 shadow-[0_0_60px_rgba(120,110,200,0.15)] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="font-serif text-xl text-amber-200">{title}を取り出す</h3>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-300 text-xl leading-none">×</button>
        </div>

        {snapshotText != null && (
          <p className="text-xs text-stone-400">この分析の内容（生成時点のスナップショット）を取り出します。</p>
        )}

        {/* 期間の指定方法 */}
        {snapshotText == null && (
        <>
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setMode("month")}
            className={`flex-1 rounded-lg py-2 border transition ${mode === "month" ? "bg-amber-300/15 border-amber-300/40 text-amber-100" : "border-white/10 text-stone-400 hover:text-stone-200"}`}
          >
            月で指定
          </button>
          <button
            onClick={() => setMode("range")}
            className={`flex-1 rounded-lg py-2 border transition ${mode === "range" ? "bg-amber-300/15 border-amber-300/40 text-amber-100" : "border-white/10 text-stone-400 hover:text-stone-200"}`}
          >
            期間で指定
          </button>
        </div>

        {mode === "month" ? (
          <label className="block">
            <span className="text-xs text-stone-400">対象の月</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="mt-1 w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none" />
          </label>
        ) : (
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-xs text-stone-400">いつから</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none" />
            </label>
            <label className="flex-1">
              <span className="text-xs text-stone-400">いつまで</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none" />
            </label>
          </div>
        )}
        <p className="text-[11px] text-stone-500">期間を空欄にすると全期間が対象になります。</p>
        </>
        )}

        {/* 取り出し方 */}
        <div className="border-t border-white/10 pt-4 space-y-3">
          <button onClick={handleDownload}
            className="w-full bg-amber-300 text-stone-900 font-medium rounded-lg py-2.5 hover:bg-amber-200 transition text-sm">
            テキストファイルでダウンロード
          </button>

          <div className="flex gap-2">
            <input type="email" placeholder="送信先メールアドレス" value={email} onChange={(e) => setEmail(e.target.value)}
              className="flex-1 min-w-0 bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none text-sm" />
            <button onClick={handleEmail} disabled={sending}
              className="bg-white/10 text-stone-200 font-medium rounded-lg px-4 py-2 hover:bg-white/20 transition disabled:opacity-40 text-sm whitespace-nowrap">
              {sending ? "送信中…" : "メールで送る"}
            </button>
          </div>
        </div>

        {msg && <p className="text-emerald-400 text-sm text-center">{msg}</p>}
        {err && <p className="text-rose-300 text-sm text-center">{err}</p>}
      </div>
    </div>
  );
}
