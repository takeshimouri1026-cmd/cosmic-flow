import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  ReferenceLine, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { weekData, biorhythmAt, overallEnergy, awakeningScore, CYCLES } from "./biorhythm.js";
import { supabase } from "./supabase.js";

const API = import.meta.env.VITE_API_URL || "";

function toISODate(d) { return d.toISOString().slice(0, 10); }

export default function App({ session }) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  const [data, setData] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [logs, setLogs] = useState([]);
  const [logText, setLogText] = useState("");
  const [logDate, setLogDate] = useState(toISODate(new Date()));
  const [logSaved, setLogSaved] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const today = new Date();
  const userId = session.user.id;

  // プロフィール読み込み
  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", userId).single()
      .then(({ data }) => {
        if (data) {
          setProfile(data);
          setName(data.name || "");
          setBirth(data.birth_date || "");
        }
      });
    loadLogs();
  }, []);

  // ログ読み込み
  async function loadLogs() {
    const { data } = await supabase.from("logs").select("*")
      .eq("user_id", userId).order("log_date", { ascending: false });
    if (data) setLogs(data);
  }

  // プロフィール保存
  async function saveProfile() {
    await supabase.from("profiles").upsert({ id: userId, name, birth_date: birth });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  }

  // バイオリズム計算
  function analyze() {
    if (!birth) { setError("生年月日を入力してください。"); return; }
    setError("");
    const birthDate = new Date(birth);
    const week = weekData(birthDate, today);
    const b = biorhythmAt(birthDate, today);
    setData({ week, awakening: awakeningScore(b), overall: overallEnergy(b) });
    setAdvice(null);
    setAnalysis(null);
  }

  // 今週のアドバイス
  async function getAdvice() {
    setLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, name }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setAdvice(j);
    } catch (e) {
      setError(e.message || "通信に失敗しました。");
    } finally { setLoading(false); }
  }

  // ログ保存
  async function handleSaveLog() {
    if (!logText.trim()) return;
    await supabase.from("logs").upsert(
      { user_id: userId, log_date: logDate, text: logText.trim() },
      { onConflict: "user_id,log_date" }
    );
    setLogText("");
    setLogSaved(true);
    setTimeout(() => setLogSaved(false), 2000);
    loadLogs();
  }

  // ログ削除
  async function handleDeleteLog(id) {
    await supabase.from("logs").delete().eq("id", id);
    loadLogs();
  }

  // 過去ログ分析
  async function getAnalysis() {
    if (!data || logs.length === 0) return;
    setAnalysisLoading(true); setError("");
    try {
      const r = await fetch(`${API}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, name, logs: logs.map(l => ({ date: l.log_date, text: l.text })) }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setAnalysis(j);
    } catch (e) {
      setError(e.message || "通信に失敗しました。");
    } finally { setAnalysisLoading(false); }
  }

  return (
    <div className="min-h-screen text-stone-100 px-5 py-10 md:px-10">
      <header className="max-w-3xl mx-auto text-center mb-10">
        <div className="flex justify-end mb-2">
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs text-stone-500 hover:text-stone-300 transition"
          >
            ログアウト
          </button>
        </div>
        <p className="tracking-[0.4em] text-amber-300/70 text-xs mb-3">COSMIC FLOW</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-tight">
          宇宙のエネルギーと<br />あなたの今週の流れ
        </h1>
        <p className="text-stone-400 mt-4 text-sm">
          生年月日からバイオリズムと覚醒の波を読み解き、今週の過ごし方を提案します。
        </p>
      </header>

      {/* プロフィール入力 */}
      <div className="max-w-3xl mx-auto bg-white/5 backdrop-blur rounded-2xl p-6 border border-amber-200/10">
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <label className="flex-1 w-full">
            <span className="text-xs text-stone-400">お名前(任意)</span>
            <input
              className="mt-1 w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 威之"
            />
          </label>
          <label className="flex-1 w-full">
            <span className="text-xs text-stone-400">生年月日</span>
            <input
              type="date"
              className="mt-1 w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={saveProfile}
              className="bg-white/10 text-stone-200 font-medium rounded-lg px-4 py-2 hover:bg-white/20 transition whitespace-nowrap text-sm"
            >
              保存
            </button>
            <button
              onClick={analyze}
              className="bg-amber-300 text-stone-900 font-medium rounded-lg px-6 py-2 hover:bg-amber-200 transition whitespace-nowrap"
            >
              波を読む
            </button>
          </div>
        </div>
        {profileSaved && <p className="text-emerald-400 text-sm mt-2">プロフィールを保存しました ✓</p>}
        {error && <p className="text-rose-300 text-sm mt-3">{error}</p>}
      </div>

      {data && (
        <div className="max-w-3xl mx-auto mt-8 space-y-6">
          {/* スコア */}
          <div className="grid grid-cols-2 gap-4">
            <Stat label="今週の総合エネルギー" value={data.overall > 0 ? "上昇の流れ" : "内省の流れ"} sub={`指数 ${Math.round(data.overall * 100)}`} />
            <Stat label="覚醒スコア" value={`${data.awakening} / 100`} sub={data.awakening > 60 ? "波長が整いやすい" : "静けさが鍵"} />
          </div>

          {/* グラフ */}
          <div className="bg-white/5 rounded-2xl p-5 border border-amber-200/10">
            <h2 className="font-serif text-xl mb-3">今週のバイオリズム</h2>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.week}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                <XAxis
                  dataKey="label"
                  stroke="#a8a29e"
                  tick={{ fontSize: 11, fill: "#a8a29e" }}
                  tickFormatter={(v) => {
                    const d = data.week.find(w => w.label === v);
                    return d ? `${v}(${d.weekday})` : v;
                  }}
                  interval={0}
                />
                <YAxis domain={[-100, 100]} stroke="#a8a29e" width={30} />
                <Tooltip contentStyle={{ background: "#1c1917", border: "1px solid #44403c", borderRadius: 8 }} />
                <Legend formatter={(value) => <span style={{ color: "#d6d3d1", fontSize: 12 }}>{value}</span>} />
                <ReferenceLine x={data.week.find(d => d.offset === 0)?.label} stroke="#fbbf24" strokeDasharray="4 4" />
                <ReferenceLine y={0} stroke="#ffffff22" />
                <Line type="monotone" dataKey="physical" name="身体" stroke={CYCLES.physical.color} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="emotional" name="感情" stroke={CYCLES.emotional.color} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="intellectual" name="知性" stroke={CYCLES.intellectual.color} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="intuition" name="直感" stroke="#D4AF6A" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-stone-500 mt-2">点線(金色)が今日です。身体23日・感情28日・知性33日・直感38日の周期で計算しています。</p>
          </div>

          {/* アドバイス */}
          {!advice && (
            <button onClick={getAdvice} disabled={loading}
              className="w-full bg-gradient-to-r from-amber-300 to-amber-400 text-stone-900 font-medium rounded-xl py-3 hover:brightness-105 transition disabled:opacity-50">
              {loading ? "宇宙の流れを読み解いています…" : "今週のアドバイスを受け取る"}
            </button>
          )}
          {advice && (
            <div className="space-y-4">
              <Card title="今週の流れ" body={advice.flow} />
              <Card title="調子が良い日と過ごし方" body={advice.best_days} />
              <Card title="無理を避けたい日とケア" body={advice.care_days} />
              <Card title="今週おすすめの体験" body={advice.experience} />
              <Card title="波長を整える習慣" body={advice.ritual} highlight />
            </div>
          )}

          {/* ふりかえりログ入力 */}
          <div className="bg-white/5 rounded-2xl p-5 border border-amber-200/10 space-y-3">
            <h2 className="font-serif text-xl text-amber-200">週のふりかえりを記録する</h2>
            <div className="flex gap-3 items-center">
              <span className="text-xs text-stone-400 whitespace-nowrap">記録日</span>
              <input type="date"
                className="bg-black/30 rounded-lg px-3 py-1.5 border border-white/10 focus:border-amber-300/50 outline-none text-sm"
                value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </div>
            <textarea
              className="w-full bg-black/30 rounded-lg px-3 py-2 border border-white/10 focus:border-amber-300/50 outline-none text-sm resize-none"
              rows={4}
              placeholder="今週の気づき・体調・出来事・感情の変化などを自由に書いてください…"
              value={logText} onChange={(e) => setLogText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <button onClick={handleSaveLog} disabled={!logText.trim()}
                className="bg-amber-300 text-stone-900 font-medium rounded-lg px-5 py-2 hover:bg-amber-200 transition disabled:opacity-40 text-sm">
                保存する
              </button>
              {logSaved && <span className="text-emerald-400 text-sm">保存しました ✓</span>}
            </div>
          </div>

          {/* 過去ログ一覧 */}
          {logs.length > 0 && (
            <div className="bg-white/5 rounded-2xl p-5 border border-amber-200/10 space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="font-serif text-xl text-amber-200">過去のふりかえりログ</h2>
                <button onClick={() => setShowLogs(!showLogs)} className="text-xs text-stone-400 hover:text-stone-200 transition">
                  {showLogs ? "閉じる" : `${logs.length}件を表示`}
                </button>
              </div>
              {showLogs && (
                <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                  {logs.map((l) => (
                    <div key={l.id} className="bg-black/20 rounded-xl p-4 border border-white/5">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-xs text-amber-300/70">{l.log_date}</span>
                        <button onClick={() => handleDeleteLog(l.id)} className="text-xs text-stone-600 hover:text-rose-400 transition">削除</button>
                      </div>
                      <p className="text-sm text-stone-300 whitespace-pre-line leading-relaxed">{l.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={getAnalysis} disabled={analysisLoading}
                className="w-full bg-gradient-to-r from-violet-500 to-indigo-500 text-white font-medium rounded-xl py-3 hover:brightness-110 transition disabled:opacity-50 text-sm">
                {analysisLoading ? "過去のログを読み解いています…" : "過去のログから現状と今後を分析する"}
              </button>
            </div>
          )}

          {/* 分析結果 */}
          {analysis && (
            <div className="space-y-4">
              <p className="text-xs text-stone-500 text-center">— 過去ログ × バイオリズム 深掘り分析 —</p>
              <Card title="あなたの現在地" body={analysis.current_state} />
              <Card title="ログから見えるパターン" body={analysis.pattern} />
              <Card title="今後1ヶ月の流れ" body={analysis.forecast} />
              <Card title="今あなたに必要なこと" body={analysis.recommendation} highlight />
            </div>
          )}
        </div>
      )}

      <footer className="max-w-3xl mx-auto mt-16 text-center text-xs text-stone-600">
        バイオリズムは正弦波モデルに基づく自己内省のツールであり、医療・科学的予測ではありません。
      </footer>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-white/5 rounded-2xl p-5 border border-amber-200/10">
      <p className="text-xs text-stone-400">{label}</p>
      <p className="font-serif text-2xl mt-1 text-amber-200">{value}</p>
      <p className="text-xs text-stone-500 mt-1">{sub}</p>
    </div>
  );
}

function Card({ title, body, highlight }) {
  return (
    <div className={`rounded-2xl p-5 border ${highlight ? "bg-amber-300/10 border-amber-300/30" : "bg-white/5 border-amber-200/10"}`}>
      <h3 className="font-serif text-lg text-amber-200 mb-2">{title}</h3>
      <p className="text-stone-200 leading-relaxed text-sm whitespace-pre-line">{body}</p>
    </div>
  );
}
