import React, { useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  ReferenceLine, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { weekData, biorhythmAt, overallEnergy, awakeningScore, CYCLES } from "./biorhythm.js";
import { supabase } from "./supabase.js";
import { setMood } from "./cosmicMood.js";
import { computeNatal, PREFECTURES } from "./natal.js";
import { moonPhase, nextCosmicEvent, computeTransits } from "./cosmicEvents.js";
import ExportModal from "./ExportModal.jsx";
import { logsToText, readingsToText, analysisToText } from "./exportUtils.js";

const API = import.meta.env.VITE_API_URL || "";

// ローカル時刻でYYYY-MM-DD(toISOStringはUTC変換で日付がずれるため使わない)
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// その週の月曜日(週の始まり)を返す。物語は「週に1章」進む
function weekStartOf(d) {
  const day = d.getDay(); // 0=日
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return toISODate(m);
}

// 画面タブ（見る=今週 / やる=記録 / 静的情報=わたし）
const TABS = [
  { id: "week", label: "今週" },
  { id: "journal", label: "記録" },
  { id: "me", label: "わたし" },
];

export default function App({ session }) {
  const [profile, setProfile] = useState(null);
  const [name, setName] = useState("");
  const [birth, setBirth] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [birthPlace, setBirthPlace] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);

  const [data, setData] = useState(null);
  const [natal, setNatal] = useState(null);
  const [showNatal, setShowNatal] = useState(false);
  const [transits, setTransits] = useState(null);
  const [sky, setSky] = useState(null); // { moon, event } 今この瞬間の空
  const [advice, setAdvice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [logs, setLogs] = useState([]);
  const [logText, setLogText] = useState("");
  const [logDate, setLogDate] = useState(toISODate(new Date()));
  const [logSaved, setLogSaved] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [echo, setEcho] = useState(null); // 宇宙の返歌
  const [readings, setReadings] = useState([]); // これまでの物語(章)
  const [exportKind, setExportKind] = useState(null); // "logs" | "readings" | "analysis" | null

  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [tab, setTab] = useState("week"); // 計算後に表示する画面

  const today = new Date();
  const userId = session.user.id;

  // dev限定: ?preview で全カード状態をサンプル描画（視覚磨き込み用・本番無効）
  const PREVIEW = import.meta.env.DEV &&
    (new URLSearchParams(window.location.search).has("preview") ||
      (typeof localStorage !== "undefined" && localStorage.getItem("cf_preview") === "1"));
  useEffect(() => {
    if (!PREVIEW) return;
    const iso = "1985-10-26";
    setName("威之"); setBirth(iso); setBirthTime("07:30"); setBirthPlace("東京都");
    const bd = new Date(iso);
    const b = biorhythmAt(bd, today);
    setData({ week: weekData(bd, today), awakening: awakeningScore(b), overall: overallEnergy(b) });
    try { const n = computeNatal(iso, "07:30", "東京都"); setNatal(n); setTransits(computeTransits(iso, "07:30", n?.coords)); } catch { /* noop */ }
    setAdvice({
      chapter: 3, chapter_title: "静寂の航路",
      flow: "今週は、外へ広げるよりも内側を整える流れです。身体の波はゆるやかに満ち、感情は少し内へ向きます。焦らず、静けさの中で次の一歩の輪郭を確かめてください。",
      best_days: "水曜と木曜は知性の波が高く、考えごとや対話がよく進みます。大切な判断はこの二日に。",
      care_days: "月曜は身体の波が低めです。予定を詰めず、早めに休むことを自分に許してください。",
      experience: "夜、灯りを落として星の音楽を聴く時間を。宇宙の呼吸に自分の呼吸を重ねてみましょう。",
      ritual: "眠る前の三分、今日ありがたかったことを一つだけ心に浮かべる。それだけで波長は静かに整います。",
    });
    setAnalysis({
      generatedAt: today.toLocaleString("ja-JP"),
      current_state: "あなたは今、静かな転換点にいます。過去の記録には「立ち止まって考えたい」という言葉が繰り返し現れています。",
      pattern: "感情の波が低い週に、内省的な気づきが多く生まれています。落ち込みではなく、深まりの時間として機能しているようです。",
      forecast: "今後一ヶ月は知性の波が上向きます。温めてきた考えが形になりやすい時期です。",
      recommendation: "小さく始めること。完璧を待たず、今日できる一歩を選んでみてください。",
    });
  }, []);

  // プロフィール読み込み
  useEffect(() => {
    supabase.from("profiles").select("*").eq("id", userId).single()
      .then(({ data }) => {
        if (data) {
          setProfile(data);
          setName(data.name || "");
          setBirth(data.birth_date || "");
          setBirthTime(data.birth_time ? data.birth_time.slice(0, 5) : "");
          setBirthPlace(data.birth_place || "");
        }
      });
    loadLogs();
    loadReadings();
    // 今この瞬間の空(月相・次の宇宙イベント)を計算
    try {
      const moon = moonPhase(new Date());
      const event = nextCosmicEvent(new Date());
      setSky({ moon, event });
      // イベントが近いほど背景の呼吸・輝きを高める(0〜1)
      if (event) {
        const proximity = Math.max(0, Math.min(1, (7 - event.daysUntil) / 7));
        setMood({ eventProximity: proximity });
      }
    } catch { /* 計算失敗時は空表示なし */ }
  }, []);

  // これまでの物語(章)を読み込み
  async function loadReadings() {
    const { data } = await supabase.from("readings").select("*")
      .eq("user_id", userId).order("chapter", { ascending: true });
    if (data) setReadings(data);
  }

  // ログ読み込み
  async function loadLogs() {
    const { data } = await supabase.from("logs").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false });
    if (data) setLogs(data);
  }

  // プロフィール保存
  async function saveProfile() {
    await supabase.from("profiles").upsert({
      id: userId, name, birth_date: birth,
      birth_time: birthTime || null, birth_place: birthPlace || null,
    });
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2000);
  }

  // 今の空(月相・次イベント)をモデルへ渡す短い要約
  function skySummary() {
    if (!sky) return undefined;
    let s = `今の月: ${sky.moon.name}(${sky.moon.moonSign})— ${sky.moon.theme}`;
    if (sky.event) {
      s += `\n次の宇宙イベント: ${sky.event.name}(あと${sky.event.daysUntil}日)— ${sky.event.theme}`;
      if (sky.event.daysUntil <= 1) s += "（まさに今日〜明日、この宇宙のエネルギーが高まっています）";
    }
    return s;
  }

  // バイオリズム計算
  function analyze() {
    if (!birth) { setError("生年月日を入力してください。"); return; }
    setError("");
    const birthDate = new Date(birth);
    const week = weekData(birthDate, today);
    const b = biorhythmAt(birthDate, today);
    const aw = awakeningScore(b);
    const ov = overallEnergy(b);
    setData({ week, awakening: aw, overall: ov });
    setMood({ awakening: aw, overall: ov, active: true }); // 宇宙がこの人のリズムで脈打つ
    // 出生図(ネイタル)を算出。失敗してもアプリは止めない
    let n = null;
    try {
      n = computeNatal(birth, birthTime, birthPlace);
      setNatal(n);
    } catch {
      setNatal(null);
    }
    // トランジット(今日の天体 × 出生図)
    try {
      setTransits(computeTransits(birth, birthTime, n?.coords));
    } catch {
      setTransits(null);
    }
    setShowNatal(false); // 星の配置は既定で折りたたむ（見たい時に開く）
    setAdvice(null);
    setAnalysis(null);
    setTab("week"); // 計算したら「今週」を表示
  }

  // 今週のアドバイス(物語は週に1章。同じ週はその章を再表示)
  async function getAdvice() {
    setLoading(true); setError("");
    try {
      const ws = weekStartOf(new Date());
      const existing = readings.find((r) => r.week_start === ws);

      // 今週の章がすでにあり内容も保存済みなら、そのまま開く(API呼び出しなし)
      if (existing?.content) {
        setAdvice({ ...existing.content, chapter: existing.chapter });
        setLoading(false);
        return;
      }

      // 過去の章(今週を除く)を「これまでの物語」として渡す
      const pastChapters = readings.filter((r) => r.week_start !== ws);
      const r = await fetch(`${API}/api/advice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data, name,
          natal: natal?.summary,
          transit: transits?.summary,
          sky: skySummary(),
          history: pastChapters.slice(-5).map((r) => ({
            chapter: r.chapter, title: r.title, summary: r.summary,
            date: new Date(r.created_at).toLocaleDateString("ja-JP"),
          })),
        }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      const chapter = existing ? existing.chapter : pastChapters.length + 1;
      setAdvice({ ...j, chapter });
      // この章を物語として記録(次回の続きの材料になる)
      if (j.story_summary) {
        if (existing) {
          // 内容未保存の既存章(移行期)を更新
          await supabase.from("readings").update({
            title: j.chapter_title || `第${chapter}章`,
            summary: j.story_summary, content: j, week_start: ws,
          }).eq("id", existing.id);
        } else {
          await supabase.from("readings").insert({
            user_id: userId, chapter,
            title: j.chapter_title || `第${chapter}章`,
            summary: j.story_summary, content: j, week_start: ws,
          });
        }
        loadReadings();
      }
    } catch (e) {
      setError(e.message || "通信に失敗しました。");
    } finally { setLoading(false); }
  }

  // 宇宙の返歌を受け取る(演出。失敗しても静かに無視)
  async function fetchEcho(text) {
    try {
      const r = await fetch(`${API}/api/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, sky: sky ? `${sky.moon.name}(${sky.moon.moonSign})` : undefined }),
      });
      const j = await r.json();
      if (j.echo) setEcho(j.echo);
    } catch { /* 返歌は無くても成立する */ }
  }

  // ログ保存
  async function handleSaveLog() {
    if (!logText.trim()) return;
    setError("");
    const savedText = logText.trim();
    const { error } = await supabase.from("logs").insert(
      { user_id: userId, log_date: logDate, text: logText.trim() }
    );
    if (error) {
      setError("ログの保存に失敗しました：" + error.message);
      return;
    }
    setLogText("");
    setLogSaved(true);
    setTimeout(() => setLogSaved(false), 2000);
    loadLogs();
    setEcho(null);
    fetchEcho(savedText); // 宇宙からの返歌(非同期・待たない)
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
        body: JSON.stringify({ ...data, name, natal: natal?.summary, transit: transits?.summary, sky: skySummary(), logs: logs.map(l => ({ date: l.log_date, text: l.text })) }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setAnalysis({ ...j, generatedAt: new Date().toLocaleString("ja-JP") });
    } catch (e) {
      setError(e.message || "通信に失敗しました。");
    } finally { setAnalysisLoading(false); }
  }

  // 分析結果を取り出す(生成時点のスナップショット)
  function exportAnalysis() {
    setExportKind("analysis");
  }

  // プロフィール入力フォーム（初回オンボーディングと「わたし」タブで共用）
  const profileCard = (
    <div className="panel p-6 md:p-7">
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <label className="flex-1 w-full min-w-0">
            <span className="text-[11px] t-faint block text-center mb-1.5">お名前(任意)</span>
            <input
              className="field appearance-none text-center"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 威之"
            />
          </label>
          <label className="flex-1 w-full min-w-0">
            <span className="text-[11px] t-faint block text-center mb-1.5">生年月日</span>
            <input
              type="date"
              className="field appearance-none text-center"
              value={birth}
              onChange={(e) => setBirth(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <label className="flex-1 w-full min-w-0">
            <span className="text-[11px] t-faint flex items-center justify-center gap-2 mb-1.5">
              出生時刻(任意・占星術の精度が上がります)
              {birthTime && (
                <button
                  type="button"
                  onClick={() => setBirthTime("")}
                  className="t-gold hover:t-gold-b underline"
                >
                  クリア
                </button>
              )}
            </span>
            <input
              type="time"
              className="field appearance-none text-center"
              value={birthTime}
              onChange={(e) => setBirthTime(e.target.value)}
            />
          </label>
          <label className="flex-1 w-full min-w-0">
            <span className="text-[11px] t-faint block text-center mb-1.5">出生地(任意)</span>
            <select
              className="field appearance-none text-center"
              style={{ textAlignLast: "center" }}
              value={birthPlace}
              onChange={(e) => setBirthPlace(e.target.value)}
            >
              <option value="">選択しない</option>
              {Object.keys(PREFECTURES).map((p) => (
                <option key={p} value={p} className="bg-stone-900">{p}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-3 justify-end pt-1">
          <button onClick={saveProfile} className="btn btn-ghost px-4 py-2 whitespace-nowrap text-sm">
            保存
          </button>
          <button onClick={analyze} className="btn btn-gold px-7 py-2.5 whitespace-nowrap">
            波を読む
          </button>
        </div>
      </div>
      {profileSaved && <p className="text-emerald-300/90 text-sm mt-3 text-right">プロフィールを保存しました ✓</p>}
    </div>
  );

  // 今この瞬間の空（月相・次の宇宙イベント）
  const skyCards = sky && (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="panel lift flex-1 px-5 py-4 flex items-center gap-4">
        <span className="text-3xl" style={{ filter: "drop-shadow(0 0 12px rgba(233,200,140,0.35))" }}>{sky.moon.emoji}</span>
        <div className="min-w-0">
          <p className="text-[11px] t-faint tracking-wide">今の月</p>
          <p className="t-gold font-serif text-[1.05rem] leading-snug">{sky.moon.name}・{sky.moon.moonSign}</p>
          <p className="text-[11px] t-dim mt-0.5">{sky.moon.theme}</p>
        </div>
      </div>
      {sky.event && (
        <div className="panel lift flex-1 px-5 py-4 flex items-center gap-4">
          <span className="text-3xl" style={{ filter: "drop-shadow(0 0 12px rgba(150,140,240,0.4))" }}>{sky.event.emoji}</span>
          <div className="min-w-0">
            <p className="text-[11px] t-faint tracking-wide">
              次の宇宙イベント
              {sky.event.daysUntil <= 0 ? "・今日" : `・あと${sky.event.daysUntil}日`}
            </p>
            <p className="t-gold font-serif text-[1.05rem] leading-snug">{sky.event.name}</p>
            <p className="text-[11px] t-dim mt-0.5">
              {sky.event.theme}{sky.event.symbolic ? "（と言われています）" : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen text-stone-100 px-5 py-8 md:px-10">
      {/* ヘッダー：初回はヒーロー、計算後はコンパクト */}
      <header className={`max-w-3xl mx-auto text-center ${data ? "mb-6" : "mb-12"}`}>
        <div className="flex justify-end mb-2">
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-xs t-dim hover:t-soft transition"
          >
            ログアウト
          </button>
        </div>
        <p className="tracking-[0.5em] t-gold text-[11px] mb-3 pl-[0.5em]" style={{ opacity: 0.8 }}>
          ✦ COSMIC FLOW ✦
        </p>
        {data ? (
          <h1 className="font-serif text-2xl md:text-3xl leading-tight t-ink">
            宇宙のエネルギーと<br className="sm:hidden" />あなたの今週の流れ
          </h1>
        ) : (
          <>
            <h1 className="font-serif text-[2.5rem] md:text-6xl leading-[1.25] t-ink reveal">
              宇宙のエネルギーと<br />あなたの今週の流れ
            </h1>
            <p className="t-soft mt-5 text-sm leading-relaxed reveal" style={{ animationDelay: "120ms" }}>
              生年月日からバイオリズムと覚醒の波を読み解き、今週の過ごし方を提案します。
            </p>
          </>
        )}
      </header>

      {/* ── 初回（未計算）：ここで生年月日を入れて「波を読む」だけ ── */}
      {!data && (
        <div className="max-w-3xl mx-auto space-y-6 reveal" style={{ animationDelay: "200ms" }}>
          {skyCards}
          {profileCard}
          {error && <p className="text-rose-300 text-sm text-center">{error}</p>}
        </div>
      )}

      {/* ── 計算後：タブで「今週 / 記録 / わたし」に分割 ── */}
      {data && (
        <div className="max-w-3xl mx-auto">
          {/* タブバー（上部に固定） */}
          <nav className="sticky top-3 z-20 mb-7">
            <div className="flex gap-1 rounded-full p-1 border border-white/10"
              style={{
                background: "rgba(12,9,32,0.55)",
                backdropFilter: "blur(20px) saturate(1.2)",
                WebkitBackdropFilter: "blur(20px) saturate(1.2)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 34px -14px rgba(0,0,0,0.6)",
              }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 rounded-full py-2 text-sm transition-all duration-300 ${
                    tab === t.id ? "font-medium" : "t-soft hover:t-ink"
                  }`}
                  style={tab === t.id ? {
                    background: "linear-gradient(180deg, var(--gold-bright), var(--gold-deep))",
                    color: "#241a08",
                    boxShadow: "0 6px 18px -8px rgba(233,200,140,0.6), inset 0 1px 0 rgba(255,255,255,0.45)",
                  } : undefined}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </nav>

          {error && (
            <p className="text-rose-300 text-sm text-center mb-4 bg-rose-500/10 border border-rose-400/20 rounded-lg py-2 px-3">
              {error}
            </p>
          )}

          {/* ═══ 今週タブ：状況とアドバイス（最優先で見たいもの） ═══ */}
          {tab === "week" && (
            <div className="space-y-6 reveal">
              {skyCards}

              {/* スコア */}
              <div className="grid grid-cols-2 gap-4">
                <Stat label="今週の総合エネルギー" value={data.overall > 0 ? "上昇の流れ" : "内省の流れ"} sub={`指数 ${Math.round(data.overall * 100)}`} tone={data.overall > 0 ? "warm" : "cool"} />
                <Stat label="覚醒スコア" value={`${data.awakening} / 100`} sub={data.awakening > 60 ? "波長が整いやすい" : "静けさが鍵"} tone="warm" />
              </div>

              {/* グラフ */}
              <div className="panel p-5 md:p-6">
                <h2 className="font-serif text-xl mb-4 flex items-center gap-2.5 t-ink">
                  <span className="marker" />今週のバイオリズム
                </h2>
                <div style={{ filter: "drop-shadow(0 2px 10px rgba(140,130,220,0.18))" }}>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.week} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="todayBand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(233,200,140,0.16)" />
                        <stop offset="100%" stopColor="rgba(233,200,140,0)" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid horizontal vertical={false} stroke="rgba(255,255,255,0.055)" />
                    <XAxis
                      dataKey="label"
                      stroke="rgba(255,255,255,0.10)"
                      tick={{ fontSize: 11, fill: "#8E88A6" }}
                      tickLine={false}
                      tickFormatter={(v) => {
                        const d = data.week.find(w => w.label === v);
                        return d ? `${v}(${d.weekday})` : v;
                      }}
                      interval={0}
                    />
                    <YAxis domain={[-100, 100]} stroke="rgba(255,255,255,0.10)" width={30}
                      tick={{ fontSize: 11, fill: "#6E6888" }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ stroke: "rgba(233,200,140,0.3)", strokeWidth: 1 }}
                      contentStyle={{
                        background: "rgba(14,10,32,0.92)",
                        border: "1px solid rgba(233,200,140,0.25)",
                        borderRadius: 12,
                        backdropFilter: "blur(8px)",
                        boxShadow: "0 12px 30px -12px rgba(0,0,0,0.7)",
                      }}
                      labelStyle={{ color: "#E9C88C", fontFamily: "'Hiragino Mincho ProN', serif" }}
                      itemStyle={{ fontSize: 12 }}
                    />
                    <Legend formatter={(value) => <span style={{ color: "#B4AEC8", fontSize: 12 }}>{value}</span>} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.14)" />
                    <ReferenceLine
                      x={data.week.find(d => d.offset === 0)?.label}
                      stroke="rgba(243,217,160,0.55)"
                      strokeWidth={1.5}
                      label={{ value: "今日", position: "top", fill: "#F3D9A0", fontSize: 11 }}
                    />
                    <Line type="monotone" dataKey="physical" name="身体" stroke={CYCLES.physical.color} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="emotional" name="感情" stroke={CYCLES.emotional.color} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="intellectual" name="知性" stroke={CYCLES.intellectual.color} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="intuition" name="直感" stroke="#D4AF6A" strokeWidth={1.5} strokeDasharray="3 4" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
                </div>
                <p className="text-xs t-dim mt-3 leading-relaxed">金の縦線が今日です。身体23日・感情28日・知性33日・直感38日の周期で計算しています。</p>
              </div>

              {/* アドバイス（今週の物語） */}
              {!advice && (
                <div className="flex justify-end">
                  <button onClick={getAdvice} disabled={loading} className="btn btn-gold px-6 py-3">
                    {loading ? "宇宙の流れを読み解いています…" : "今週のアドバイスを受け取る"}
                  </button>
                </div>
              )}
              {advice && (
                <div className="space-y-4">
                  {advice.chapter_title && (
                    <div className="text-center py-3 reveal">
                      <p className="text-[11px] t-faint tracking-[0.35em] pl-[0.35em]">あなたの宇宙の物語</p>
                      <p className="font-serif text-[1.6rem] md:text-3xl t-gold-b mt-2 leading-tight"
                        style={{ textShadow: "0 0 28px rgba(233,200,140,0.28)" }}>
                        第{advice.chapter}章
                      </p>
                      <p className="font-serif text-xl md:text-2xl t-gold mt-1">「{advice.chapter_title}」</p>
                      <div className="mx-auto mt-4 h-px w-24" style={{ background: "linear-gradient(90deg, transparent, rgba(233,200,140,0.5), transparent)" }} />
                    </div>
                  )}
                  <Card title="今週の流れ" body={advice.flow} />
                  <Card title="調子が良い日と過ごし方" body={advice.best_days} />
                  <Card title="無理を避けたい日とケア" body={advice.care_days} />
                  <Card title="今週おすすめの体験" body={advice.experience} />
                  <Card title="波長を整える習慣" body={advice.ritual} highlight />
                </div>
              )}
            </div>
          )}

          {/* ═══ 記録タブ：やりたいアクションを集約 ═══ */}
          {tab === "journal" && (
            <div className="space-y-6 reveal">
              {/* ふりかえりログ入力 */}
              <div className="panel p-5 md:p-6 space-y-3">
                <h2 className="font-serif text-xl t-gold flex items-center gap-2.5">
                  <span className="marker" />気づきを記録する
                </h2>
                <p className="text-xs t-faint pl-[1.25rem]">思い立ったときに、いつでも何度でも書き残せます。</p>
                <div className="flex gap-3 items-center">
                  <span className="text-xs t-faint whitespace-nowrap">記録日</span>
                  <input type="date"
                    className="field text-sm w-auto"
                    value={logDate} onChange={(e) => setLogDate(e.target.value)} />
                </div>
                <textarea
                  className="field text-sm resize-none leading-relaxed"
                  rows={4}
                  placeholder="気づき・体調・出来事・感情の変化などを自由に書いてください…"
                  value={logText} onChange={(e) => setLogText(e.target.value)}
                />
                <div className="flex items-center justify-end gap-3">
                  {logSaved && <span className="text-emerald-300/90 text-sm">保存しました ✓</span>}
                  <button onClick={handleSaveLog} disabled={!logText.trim()} className="btn btn-gold px-5 py-2 text-sm">
                    保存する
                  </button>
                </div>
                {echo && (
                  <p className="text-center font-serif t-gold-b text-[15px] pt-2 pb-1 animate-[fadeIn_2s_ease]"
                    style={{ textShadow: "0 0 20px rgba(233,200,140,0.3)" }}>
                    ✨ {echo}
                  </p>
                )}
              </div>

              {/* 過去ログ一覧 */}
              {logs.length > 0 ? (
                <div className="panel p-5 md:p-6 space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="font-serif text-xl t-gold flex items-center gap-2.5">
                      <span className="marker" />これまでの記録
                    </h2>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setShowLogs(!showLogs)} className="text-xs t-faint hover:t-soft transition">
                        {showLogs ? "閉じる" : `${logs.length}件を表示`}
                      </button>
                      <button onClick={() => setExportKind("logs")} className="btn btn-outline text-xs px-4 py-2">
                        取り出す
                      </button>
                    </div>
                  </div>
                  {showLogs && (
                    <div className="space-y-3 max-h-80 overflow-y-auto pr-1 thin-scroll">
                      {logs.map((l) => (
                        <div key={l.id} className="inset p-4">
                          <div className="flex justify-between items-start mb-1.5">
                            <span className="text-xs t-gold">
                              {l.log_date}
                              {l.created_at && (
                                <span className="t-dim ml-2">
                                  {new Date(l.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </span>
                            <button onClick={() => handleDeleteLog(l.id)} className="text-xs t-dim hover:text-rose-400 transition">削除</button>
                          </div>
                          <p className="text-sm t-soft whitespace-pre-line leading-relaxed">{l.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button onClick={getAnalysis} disabled={analysisLoading} className="btn btn-violet px-6 py-3 text-sm">
                      {analysisLoading ? "過去のログを読み解いています…" : "過去のログから現状と今後を分析する"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm t-faint py-8">
                  まだ記録がありません。上の欄から最初の気づきを書き残してみましょう。
                </p>
              )}

              {/* 分析結果 */}
              {analysis && (
                <div className="space-y-4 reveal">
                  <div className="flex justify-between items-center gap-3">
                    <p className="text-xs t-faint">— 過去ログ × バイオリズム 深掘り分析（{analysis.generatedAt}時点）—</p>
                    <button onClick={exportAnalysis} className="btn btn-outline text-xs px-4 py-2 whitespace-nowrap">
                      取り出す
                    </button>
                  </div>
                  <Card title="あなたの現在地" body={analysis.current_state} />
                  <Card title="ログから見えるパターン" body={analysis.pattern} />
                  <Card title="今後1ヶ月の流れ" body={analysis.forecast} />
                  <Card title="今あなたに必要なこと" body={analysis.recommendation} highlight />
                </div>
              )}

              {/* 物語(章)を取り出す */}
              {readings.length > 0 && (
                <div className="panel lift p-5 md:p-6 flex justify-between items-center gap-4">
                  <div>
                    <h2 className="font-serif text-lg t-gold flex items-center gap-2.5">
                      <span className="marker" />あなたの宇宙の物語
                    </h2>
                    <p className="text-xs t-faint mt-1 pl-[1.25rem]">これまで{readings.length}章を紡いできました</p>
                  </div>
                  <button onClick={() => setExportKind("readings")} className="btn btn-outline text-xs px-4 py-2 whitespace-nowrap">
                    取り出す
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ═══ わたしタブ：プロフィール＋星の配置（静的情報） ═══ */}
          {tab === "me" && (
            <div className="space-y-6 reveal">
              {profileCard}

              {/* ネイタル(出生図) */}
              {natal && (
                <div className="panel p-5 md:p-6">
                  <div className="flex justify-between items-center gap-3">
                    <h2 className="font-serif text-xl t-gold flex items-center gap-2.5">
                      <span className="marker" />あなたの星の配置
                    </h2>
                    <button onClick={() => setShowNatal(!showNatal)} className="text-xs t-faint hover:t-soft transition whitespace-nowrap">
                      {showNatal ? "閉じる" : `${natal.sun}・${natal.moon}… 見る`}
                    </button>
                  </div>
                  {showNatal && (
                  <div className="mt-5">
                  <p className="text-xs t-faint mb-4 leading-relaxed">
                    生まれた瞬間、空のどこにどの星があったか——それがあなたの「生まれ持った性質」を映します。
                    とくに大切なのが次の3つです。
                  </p>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <NatalSign label="太陽 ☀" sign={natal.sun} hint="本質・意志" />
                    <NatalSign label="月 ☽" sign={natal.moon} hint="感情・内面" />
                    <NatalSign label="上昇宮 ↑" sign={natal.ascendant || "—"} hint={natal.ascendant ? "第一印象・生き方" : "出生時刻が必要"} />
                  </div>

                  <div className="inset p-4 text-xs t-soft leading-relaxed space-y-1.5 mb-4">
                    <p><span className="t-gold">太陽（{natal.sun}）</span>＝あなたの core。意志・目指す方向・人生の主題を表します。</p>
                    <p><span className="t-gold">月（{natal.moon}）</span>＝素の自分。安心する条件や、感情がどう動くかを表します。</p>
                    <p>
                      <span className="t-gold">上昇宮{natal.ascendant ? `（${natal.ascendant}）` : ""}</span>
                      ＝他人から見える第一印象・生き方の雰囲気。
                      {natal.ascendant ? "" : "出生時刻を入れると算出されます。"}
                    </p>
                    <p className="t-dim pt-1">
                      下の惑星（水星=思考、金星=愛・好み、火星=行動力…）は、より細かな性質の彩りです。
                      ※これは「決まった運命」ではなく、自分を見つめ直すための鏡としてご覧ください。
                    </p>
                  </div>

                  <p className="text-xs t-faint mb-2">すべての天体</p>
                  <div className="flex flex-wrap gap-2">
                    {natal.bodies.map((b) => (
                      <span key={b.name} className="chip">
                        {b.name} <span className="t-gold">{b.sign}</span>
                      </span>
                    ))}
                  </div>
                  {(!natal.hasTime || !natal.hasPlace) && (
                    <p className="text-xs t-dim mt-3">
                      {!natal.hasTime && "出生時刻"}{!natal.hasTime && !natal.hasPlace && "・"}{!natal.hasPlace && "出生地"}を入力すると、より正確な配置が読み取れます。
                    </p>
                  )}
                  </div>
                  )}
                </div>
              )}

              {/* トランジット(今の天体 × 出生図)：生まれ持った星に、今どの天体が触れているか */}
              {transits && (transits.hits.length > 0 || transits.mercuryRetrograde) && (
                <div className="panel p-5 md:p-6">
                  <h2 className="font-serif text-xl t-gold mb-1.5 flex items-center gap-2.5">
                    <span className="marker" />いま宇宙があなたに触れていること
                  </h2>
                  <p className="text-xs t-faint mb-4 leading-relaxed pl-[1.25rem]">
                    空を動く天体が、あなたの生まれ持った星に重なる時期です。今の人生のテーマとして、ゆっくりと響きます。
                  </p>
                  <div className="space-y-2">
                    {transits.hits.map((h, i) => (
                      <p key={i} className="text-sm t-soft inset px-3.5 py-2.5">✦ {h}</p>
                    ))}
                    {transits.mercuryRetrograde && (
                      <p className="text-sm px-3.5 py-2.5 rounded-[0.9rem] border"
                        style={{ color: "#F3D9A0", background: "rgba(233,200,140,0.06)", borderColor: "rgba(233,200,140,0.22)" }}>
                        ☿ 現在は水星逆行中——見直し・再確認・再会に向く時期です。
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <footer className="max-w-3xl mx-auto mt-16 pt-6 text-center text-xs t-dim border-t border-white/[0.05]">
        バイオリズムは正弦波モデルに基づく自己内省のツールであり、医療・科学的予測ではありません。
      </footer>

      {/* 取り出しモーダル */}
      <ExportModal
        open={exportKind === "logs"}
        onClose={() => setExportKind(null)}
        title="気づきの記録"
        kind="logs"
        items={logs}
        dateKey="log_date"
        toText={(filtered, f, t) => logsToText(filtered, name, f, t)}
        defaultEmail={session.user.email}
      />
      <ExportModal
        open={exportKind === "readings"}
        onClose={() => setExportKind(null)}
        title="宇宙の物語"
        kind="readings"
        items={readings}
        dateKey="created_at"
        toText={(filtered, f, t) => readingsToText(filtered, name, f, t)}
        defaultEmail={session.user.email}
      />
      <ExportModal
        open={exportKind === "analysis"}
        onClose={() => setExportKind(null)}
        title="深掘り分析"
        kind="analysis"
        snapshotText={analysis ? analysisToText(analysis, name) : ""}
        defaultEmail={session.user.email}
      />
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  // 上昇=金 / 内省=菫。値の色で「今の流れ」を一目で伝える
  const valueColor = tone === "cool" ? "text-[#B9AEEC]" : "t-gold-b";
  return (
    <div className="panel p-5 overflow-hidden">
      <span
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: tone === "cool"
          ? "linear-gradient(#8b7cf0,#5b4fb0)"
          : "linear-gradient(var(--gold-bright),var(--gold-deep))" }}
      />
      <p className="text-[11px] tracking-wider t-faint uppercase">{label}</p>
      <p className={`font-serif text-[1.4rem] sm:text-[1.7rem] leading-tight mt-1.5 ${valueColor}`}>{value}</p>
      <p className="text-xs t-dim mt-1">{sub}</p>
    </div>
  );
}

function NatalSign({ label, sign, hint }) {
  return (
    <div className="inset p-3 text-center">
      <p className="text-[11px] t-faint">{label}</p>
      <p className="font-serif text-lg t-gold mt-1">{sign}</p>
      <p className="text-[10px] t-dim mt-0.5">{hint}</p>
    </div>
  );
}

function Card({ title, body, highlight }) {
  return (
    <div className={`${highlight ? "panel-sacred" : "panel"} p-5 md:p-6`}>
      <h3 className={`font-serif text-[1.15rem] mb-2.5 flex items-center gap-2.5 ${highlight ? "t-gold-b" : "t-gold"}`}>
        <span className="marker" />{title}
      </h3>
      <p className="t-soft leading-[1.95] text-[15px] whitespace-pre-line pl-[1.25rem]">{body}</p>
    </div>
  );
}
