// 記録のエクスポート用ユーティリティ(期間フィルタ・テキスト整形・ダウンロード)

// 期間で絞り込む。from/to は "YYYY-MM-DD"(任意)。dateKey は各行の日付フィールド名。
export function filterByPeriod(items, dateKey, from, to) {
  return items.filter((it) => {
    const d = (it[dateKey] || "").slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// 「◯月分」の月初・月末を返す。month は "YYYY-MM"
export function monthRange(month) {
  if (!month) return { from: "", to: "" };
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(y, m, 0).getDate(); // 翌月0日=当月末日
  const to = `${month}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

// 気づきログをテキスト整形
export function logsToText(logs, name, from, to) {
  const header = [
    "═══════════════════════════════",
    "  Cosmic Flow ｜ 気づきの記録",
    name ? `  ${name} さん` : "",
    (from || to) ? `  期間: ${from || "最初"} 〜 ${to || "最新"}` : "  全期間",
    `  出力日: ${new Date().toLocaleString("ja-JP")}`,
    `  件数: ${logs.length}件`,
    "═══════════════════════════════",
    "",
  ].filter(Boolean).join("\n");

  const body = logs
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? -1 : 1))
    .map((l) => {
      const time = l.created_at
        ? new Date(l.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
        : "";
      return `── ${l.log_date}${time ? " " + time : ""} ──\n${l.text}\n`;
    })
    .join("\n");

  return header + "\n" + (body || "(この期間の記録はありません)") + "\n";
}

// これまでの物語(章)をテキスト整形
export function readingsToText(readings, name, from, to) {
  const header = [
    "═══════════════════════════════",
    "  Cosmic Flow ｜ あなたの宇宙の物語",
    name ? `  ${name} さん` : "",
    (from || to) ? `  期間: ${from || "最初"} 〜 ${to || "最新"}` : "  全期間",
    `  出力日: ${new Date().toLocaleString("ja-JP")}`,
    `  章数: ${readings.length}章`,
    "═══════════════════════════════",
    "",
  ].filter(Boolean).join("\n");

  const body = readings
    .slice()
    .sort((a, b) => a.chapter - b.chapter)
    .map((r) => {
      const date = r.created_at ? new Date(r.created_at).toLocaleDateString("ja-JP") : "";
      let block = `── 第${r.chapter}章「${r.title || ""}」${date ? "  " + date : ""} ──\n`;
      const c = r.content;
      if (c) {
        if (c.flow) block += `\n【今週の流れ】\n${c.flow}\n`;
        if (c.best_days) block += `\n【調子が良い日と過ごし方】\n${c.best_days}\n`;
        if (c.care_days) block += `\n【無理を避けたい日とケア】\n${c.care_days}\n`;
        if (c.experience) block += `\n【おすすめの体験】\n${c.experience}\n`;
        if (c.ritual) block += `\n【波長を整える習慣】\n${c.ritual}\n`;
      } else if (r.summary) {
        block += `\n${r.summary}\n`;
      }
      return block;
    })
    .join("\n");

  return header + "\n" + (body || "(この期間の章はありません)") + "\n";
}

// テキストをファイルとしてダウンロード
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
