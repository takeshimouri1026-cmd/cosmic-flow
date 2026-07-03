process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// モデル応答からJSONを安全に取り出す（前後の説明やマークダウンが混ざっても拾う）
function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // 最初の { から最後の } までを抜き出して再試行
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("JSON parse failed");
  }
}

// 今週のアドバイスを生成
app.post("/api/advice", async (req, res) => {
  const { week, awakening, overall, name, natal, transit, sky, history } = req.body;

  // バイオリズム数値を文章化してモデルに渡す
  const summary = week
    .map(
      (d) =>
        `${d.label}(${d.weekday}): 身体${d.physical} 感情${d.emotional} 知性${d.intellectual} 直感${d.intuition}`
    )
    .join("\n");

  const natalBlock = natal
    ? `\n\n■ ${name || "相談者"}さんの出生図(ネイタル):\n${natal}\nこの星の配置(生まれ持った性質)も踏まえてください。`
    : "";
  const transitBlock = transit ? `\n\n■ 今のトランジット(空の天体があなたの出生図に触れていること):\n${transit}\nこれは「今の人生のテーマ」として自然に織り込んでください。` : "";
  const skyBlock = sky ? `\n\n■ 今この瞬間の空:\n${sky}\n月のリズムや近づく宇宙イベントのエネルギーも、過ごし方の助言にそっと反映してください。` : "";

  // これまでの物語(過去のリーディング要約)。あれば「続きの章」として紡ぐ
  const chapter = (history?.length || 0) + 1;
  const historyBlock = history && history.length
    ? `\n\n■ これまでの${name || "相談者"}さんの宇宙の物語(あなたが以前に紡いだ章の要約・古い順):\n${history
        .map((h) => `第${h.chapter}章「${h.title}」(${h.date}): ${h.summary}`)
        .join("\n")}\n今回はこの物語の第${chapter}章です。前章までの流れを受けて「物語の続き」として自然につながるように紡いでください。前章のテーマがどう展開したか・季節や星の巡りがどう移ったかに、さりげなく触れると深まります。`
    : `\n\n今回は${name || "相談者"}さんの宇宙の物語の記念すべき第1章(始まりの章)です。`;

  const prompt = `あなたは宇宙のエネルギーの流れ・バイオリズム・西洋占星術を読み解くスピリチュアルなガイドです。
${name || "相談者"}さんの毎週のリーディングを「ひとつづきの物語」として章立てで紡いでいます。
以下は今週のバイオリズム数値(-100〜100)です。

${summary}

今週の総合エネルギー傾向: ${overall > 0 ? "上昇" : "内省"}
覚醒スコア: ${awakening}/100${natalBlock}${transitBlock}${skyBlock}${historyBlock}

これらを宇宙のエネルギーの流れとして総合的に解釈し、以下を日本語で答えてください。
ただし占いを断定的な予言にせず、あくまで「こう過ごすと整いやすい」という提案にとどめてください。

必ず次のJSON形式のみで出力してください(前後の説明やマークダウン不要):
{
  "chapter_title": "この章の短いタイトル(8文字前後・詩的に。例:静かな種まき)",
  "flow": "今週全体のエネルギーの流れを2〜3文で(物語の章の書き出しとして)",
  "best_days": "特に調子が良さそうな日とその過ごし方",
  "care_days": "無理を避けたい日とセルフケア",
  "experience": "今週ぜひ体験すると良いこと(具体的に1〜2個)",
  "ritual": "覚醒や波長を整えるための簡単な習慣を1つ",
  "story_summary": "この章の要約を1〜2文で(次章を紡ぐとき、あなた自身が読み返すためのメモ)"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000, // 物語形式で応答が長くなったため余裕を持たせる(1024だとJSONが途切れる)
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    res.json(extractJSON(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "アドバイスの生成に失敗しました。APIキーと接続を確認してください。" });
  }
});

// 宇宙の返歌: 気づきの記録に、宇宙が一行だけ返す
app.post("/api/echo", async (req, res) => {
  const { text, sky } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });

  const prompt = `あなたは「宇宙」そのものとして、人のつぶやきに一行だけ返す存在です。
ある人が今日、こんな気づきを記録しました:

「${text}」
${sky ? `\n(いまの空: ${sky})\n` : ""}
この記録に対して、宇宙からの返歌を一行だけ日本語で返してください。
- 詩的で、短く(30字以内)、押し付けがましくなく
- 助言ではなく、そっと寄り添う・映し返す言葉
- 記録の中の比喩や情景を拾えるとよい
- 絵文字・記号・鉤括弧は使わない
- 語尾は「だよ」「だね」「ね」「よ」などの口語・話しかけ調を避け、体言止めや静かな余韻で終える。宇宙＝天からの神託のように、凛として静かな響きにする
  (良い例:「十六夜の光も、ひとつの瞑想」「その疲れは、種が土を押し上げる音」)
  (避ける例:「〜だよ」「〜だね」「〜してごらん」)

必ず次のJSON形式のみで出力してください:
{"echo": "返歌の一行"}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const t = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    res.json(extractJSON(t));
  } catch (err) {
    console.error(err);
    // 返歌は演出なので、失敗しても静かに何も返さない
    res.json({ echo: null });
  }
});

// 過去ログ × バイオリズム 深掘り分析
app.post("/api/analyze", async (req, res) => {
  const { week, awakening, overall, name, logs, natal, transit, sky } = req.body;

  const summary = week
    .map(
      (d) =>
        `${d.label}(${d.weekday}): 身体${d.physical} 感情${d.emotional} 知性${d.intellectual} 直感${d.intuition}`
    )
    .join("\n");

  const logSummary = logs
    .slice(0, 10)
    .map((l) => `【${l.date}】\n${l.text}`)
    .join("\n\n");

  const natalBlock = natal ? `\n■ 出生図(ネイタル・生まれ持った性質):\n${natal}\n` : "";
  const transitBlock = transit ? `\n■ 今のトランジット(今の人生のテーマ):\n${transit}\n` : "";
  const skyBlock = sky ? `\n■ 今この瞬間の空:\n${sky}\n` : "";

  const prompt = `あなたは宇宙のエネルギーの流れ・バイオリズム・西洋占星術を読み解くスピリチュアルなガイドです。
以下は${name || "相談者"}さんの情報です。

■ 今週のバイオリズム数値(-100〜100):
${summary}
今週の総合エネルギー傾向: ${overall > 0 ? "上昇" : "内省"}
覚醒スコア: ${awakening}/100
${natalBlock}${transitBlock}${skyBlock}
■ 過去のふりかえりログ(新しい順):
${logSummary}

上記のバイオリズム・出生図・今のトランジット・月のリズム・過去のログを総合的に分析し、以下を日本語で答えてください。
出生図の性質、今空で起きているトランジット、そしてログに現れた実際の体験を結びつけると、より深い洞察になります。
新月の頃に始めたいと書いていた/満月の頃に手放したい等、月のリズムとログの符合があれば触れてください。
ログに書かれた実際の体験・感情・出来事をバイオリズムと照らし合わせ、具体的で個人的な洞察を提供してください。
断定的な予言は避け、「〜の傾向があります」「〜すると整いやすいかもしれません」という表現にとどめてください。

必ず次のJSON形式のみで出力してください(前後の説明やマークダウン不要):
{
  "current_state": "ログとバイオリズムから見えるあなたの現在地(3〜4文)",
  "pattern": "過去のログに繰り返し現れるパターンや傾向(具体的なログの内容に言及して)",
  "forecast": "今後1ヶ月のエネルギーの流れと過ごし方の提案(2〜3文)",
  "recommendation": "今のあなたに最も必要なこと・大切にしてほしいこと(具体的に1〜2個)"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    res.json(extractJSON(text));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "アドバイスの生成に失敗しました。APIキーと接続を確認してください。" });
  }
});

// 本番ビルドの静的ファイルを配信
app.use(express.static(join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
