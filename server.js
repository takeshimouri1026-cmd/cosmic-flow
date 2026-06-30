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
  const { week, awakening, overall, name, natal } = req.body;

  // バイオリズム数値を文章化してモデルに渡す
  const summary = week
    .map(
      (d) =>
        `${d.label}(${d.weekday}): 身体${d.physical} 感情${d.emotional} 知性${d.intellectual} 直感${d.intuition}`
    )
    .join("\n");

  const natalBlock = natal
    ? `\n\n■ ${name || "相談者"}さんの出生図(ネイタル):\n${natal}\nこの星の配置(生まれ持った性質)も踏まえ、今週の過ごし方に自然に織り込んでください。`
    : "";

  const prompt = `あなたは宇宙のエネルギーの流れ・バイオリズム・西洋占星術を読み解くスピリチュアルなガイドです。
以下は${name || "相談者"}さんの今週のバイオリズム数値(-100〜100)です。

${summary}

今週の総合エネルギー傾向: ${overall > 0 ? "上昇" : "内省"}
覚醒スコア: ${awakening}/100${natalBlock}

この数値を宇宙のエネルギーの流れとして解釈し、以下を日本語で答えてください。
ただし占いを断定的な予言にせず、あくまで「こう過ごすと整いやすい」という提案にとどめてください。

必ず次のJSON形式のみで出力してください(前後の説明やマークダウン不要):
{
  "flow": "今週全体のエネルギーの流れを2〜3文で",
  "best_days": "特に調子が良さそうな日とその過ごし方",
  "care_days": "無理を避けたい日とセルフケア",
  "experience": "今週ぜひ体験すると良いこと(具体的に1〜2個)",
  "ritual": "覚醒や波長を整えるための簡単な習慣を1つ"
}`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
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

// 過去ログ × バイオリズム 深掘り分析
app.post("/api/analyze", async (req, res) => {
  const { week, awakening, overall, name, logs, natal } = req.body;

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

  const prompt = `あなたは宇宙のエネルギーの流れ・バイオリズム・西洋占星術を読み解くスピリチュアルなガイドです。
以下は${name || "相談者"}さんの情報です。

■ 今週のバイオリズム数値(-100〜100):
${summary}
今週の総合エネルギー傾向: ${overall > 0 ? "上昇" : "内省"}
覚醒スコア: ${awakening}/100
${natalBlock}
■ 過去のふりかえりログ(新しい順):
${logSummary}

上記のバイオリズム・出生図・過去のログを総合的に分析し、以下を日本語で答えてください。
出生図の性質と、ログに現れた実際の体験を結びつけると、より深い洞察になります。
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
