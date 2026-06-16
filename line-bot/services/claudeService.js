/**
 * services/claudeService.js
 * Claude API を使った2つの処理
 *
 * 1. analyzeMessage   - 発言から嗜好を抽出 + botへの意図を検出 + 応答を生成
 * 2. generateMemoryView - 記憶一覧を読みやすく整形して返す
 *
 * コスト削減のために claude-haiku-4-5 を使用。
 * 高品質な応答が必要な場面は claude-sonnet-4-6 に切り替えるとよい。
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CALL_NAMES = {
  takeyuki: 'おとう',
  yorimi:   'おかあ',
  hana:     'はるっぽこ',
};

/**
 * メッセージを分析する
 *
 * @param {object} params
 * @param {string} params.senderName       - 送信者の表示名（例: 威之）
 * @param {string} params.person           - 送信者のキー（例: takeyuki）
 * @param {string} params.text             - 発言テキスト
 * @param {object[]} params.existingPrefs  - 送信者の既存嗜好リスト（DBから取得）
 *
 * @returns {object|null} 分析結果JSON、またはパース失敗時はnull
 */
export async function analyzeMessage({ senderName, person, text, existingPrefs }) {
  // 既存嗜好を文字列にして Claude のコンテキストに渡す
  const prefsContext = existingPrefs.length > 0
    ? existingPrefs.map(p => `  id:${p.id} [${p.category}] ${p.content}（確信度:${p.confidence}）`).join('\n')
    : '  （まだ記録なし）';

  const systemPrompt = `あなたは「おへやちゃん」、毛利家のLINEグループに住んでいる素直な5歳児のようなAIです。
家族の会話を見守り、好みをこっそり覚えて、役立つときだけひょっこり顔を出します。

【キャラクター設定】
- 口調はため口。上から目線はNG。純粋で素直な5歳児のイメージ。
- 口癖は「おっへや～」。登場するときは「おっへや～、こんにちは！」のように使う。
- 嬉しいとき・いいね！と思ったときは「おっへや～！いいね！」のように使う。
- 「おへや」「おへやちゃん」と呼ばれることもある。どちらも自分のこと。

【家族の呼び方】
- 威之（takeyuki）→「おとう」
- 順美（yorimi）→「おかあ」
- 花（hana）→「はるっぽこ」

【返答スタイル】
- 短くてうざくない長さ。1〜3文程度。
- 絵文字は使ってもOKだが多用しない。
- 難しい言葉は使わない。5歳児らしい素直な表現で。`;

  const userPrompt = `今、${senderName}（呼び名: ${CALL_NAMES[person] ?? senderName}）が次のメッセージを送りました：
「${text}」

${senderName}の現在の記録済み嗜好：
${prefsContext}

以下のJSON形式のみで出力してください（前後の説明・マークダウン不要）：

{
  "preference": {
    "should_save": false,
    "person": "${person}",
    "category": "food",
    "content": "...",
    "confidence": "medium",
    "matches_existing_id": null
  },
  "directed_at_bot": false,
  "intent": null,
  "delete_target_description": null,
  "should_respond": false,
  "response": null
}

各フィールドの意味：
- preference.should_save: この発言から記録すべき嗜好があれば true（なければ false で他フィールドは無視）
- preference.person: 誰の嗜好か（${person}/family のいずれか）
- preference.category: food/restaurant/travel/activity/schedule/dislike のいずれか
- preference.content: 自然な日本語の文（例:「辛い料理が苦手」「焼肉が好き」）
- preference.confidence: high/medium/low
- preference.matches_existing_id: 既存の嗜好と同じ意味なら既存のid番号、なければ null（マージ用）
- directed_at_bot: おへやちゃん（自分）に話しかけているメッセージなら true。「おへや」「おへやちゃん」と呼ばれた場合も true。
- intent: directed_at_bot が true のとき → view_memory/delete_memory/update_memory/question/chat のいずれか
- delete_target_description: delete_memory のとき、消すべき嗜好の内容説明（例:「辛いのが苦手という記録」）
- should_respond: 返答すべきなら true（基本は false。ただし以下の場合は true にする）
  - 店/旅行/予定で迷っている場面、名指しで意見を求められた場合
  - 「おはよう」「こんにちは」「ただいま」など、明確に挨拶の言葉をかけられた場合
  - たまに（10〜15%の確率で）、会話の流れに合ったひとこと・ポツリとした面白いつぶやきで癒しを提供したい場合
- response: should_respond が true のとき、返答する文章。おへやちゃんのキャラクターで、短く自然に。挨拶なら「おっへや～、こんにちは！」のように口癖を使う。`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = raw.replace(/```json\n?|```\n?/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Claude] analyzeMessage エラー:', err.message);
    return null;
  }
}

/**
 * 記憶一覧を読みやすい文章に整形する
 *
 * @param {string} senderName   - 家族の名前（表示用）
 * @param {object[]} preferences - DBから取得した嗜好リスト
 * @returns {string} 整形済みのテキスト
 */
export async function generateMemoryView(senderName, preferences, person) {
  const callName = CALL_NAMES[person] ?? senderName;
  if (preferences.length === 0) {
    return `おっへや～、${callName}のこと…まだあんまり覚えてないや。これからよろしく！`;
  }

  const prefsText = preferences
    .map(p => `[${p.category}] ${p.content}（確信度: ${p.confidence}）`)
    .join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `あなたは「おへやちゃん」、毛利家の5歳児キャラAIです。
以下は${callName}について覚えていることです。
おへやちゃんらしいため口・素直な言葉で箇条書きにまとめて伝えてください。
冒頭は「おっへや～、${callName}のこと覚えてるよ！」で始めてください。

${prefsText}`,
      }],
    });

    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (err) {
    console.error('[Claude] generateMemoryView エラー:', err.message);
    // フォールバック：整形なしで返す
    return `${senderName}さんについて覚えていること：\n${preferences.map(p => `• ${p.content}`).join('\n')}`;
  }
}
