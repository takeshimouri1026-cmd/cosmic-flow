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
  "should_search": false,
  "search_query": null,
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
- intent: directed_at_bot が true のとき → view_memory/delete_memory/update_memory/share_schedule/question/chat のいずれか
  ※「来週の予定を共有して」「スケジュール教えて」「仕事の予定をLINEに共有」などは share_schedule
- delete_target_description: delete_memory のとき、消すべき嗜好の内容説明（例:「辛いのが苦手という記録」）
- should_search: ウェブ検索が必要なら true。以下の場合に true にする：
  - 「調べて」「教えて」「どこ？」「いつ？」「何時？」「おすすめは？」など情報を求めている場合
  - 会話の流れから、店・旅行先・イベント・天気・ニュースなど調べると役立ちそうな場合（積極的に）
- search_query: should_search が true のとき、検索に使う日本語クエリ（簡潔に）
- should_respond: 返答すべきなら true（基本は false。ただし以下の場合は true にする）
  - 店/旅行/予定で迷っている場面、名指しで意見を求められた場合
  - 「おはよう」「こんにちは」「ただいま」など、明確に挨拶の言葉をかけられた場合
  - たまに（10〜15%の確率で）、会話の流れに合ったひとこと・ポツリとした面白いつぶやきで癒しを提供したい場合
  - should_search が true の場合は必ず true にする（検索後に返答するため）
- response: should_search が false かつ should_respond が true のとき、返答する文章。おへやちゃんのキャラクターで、短く自然に。挨拶なら「おっへや～、こんにちは！」のように口癖を使う。should_search が true のときは null でよい（検索後に別途生成）。`;

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

const DAY_NAMES_JP = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * カレンダーの予定から来週の家族向け共有メッセージを生成する
 *
 * @param {object[]} events  - Google Calendar APIのイベント一覧
 * @param {Date} weekStart   - 来週の月曜日
 * @returns {string} おへやちゃんのメッセージ
 */
export async function generateScheduleMessage(events, weekStart) {
  // 日付ごとにイベントをグループ化
  const byDay = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const key = d.toISOString().split('T')[0];
    byDay[key] = { date: d, events: [] };
  }

  for (const ev of events) {
    const dateStr = (ev.start.dateTime ?? ev.start.date ?? '').substring(0, 10);
    if (byDay[dateStr]) byDay[dateStr].events.push(ev);
  }

  // Claudeに渡すテキストを構成
  const eventsText = Object.values(byDay).map(({ date, events }) => {
    const dayLabel = `${date.getMonth() + 1}/${date.getDate()}(${DAY_NAMES_JP[date.getDay()]})`;
    if (events.length === 0) return `${dayLabel}: 予定なし`;
    const evList = events.map(ev => {
      const start = ev.start.dateTime
        ? new Date(ev.start.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        : '終日';
      const end = ev.end.dateTime
        ? new Date(ev.end.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        : '';
      const loc = ev.location ? `（場所: ${ev.location}）` : '';
      return `  - ${start}${end ? '〜' + end : ''} ${ev.summary ?? ''}${loc}`;
    }).join('\n');
    return `${dayLabel}:\n${evList}`;
  }).join('\n\n');

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: `あなたは「おへやちゃん」、毛利家の5歳児キャラAIです。
口癖は「おっへや～」。ため口で素直に話す。`,
      messages: [{
        role: 'user',
        content: `以下はおとう（威之）の来週のGoogleカレンダーの予定です。

${eventsText}

これを毛利家LINEグループ向けに整理して伝えてください。
以下のルールで：
- 冒頭は「おっへや～！来週のおとうの予定だよ～！」
- 曜日ごとに：研修・仕事の内容と場所（わかれば）、夕飯を家で食べそうかどうか
- 夕飯の判断基準：夜19時以降に外での予定がある or 場所が遠い → 「夕飯は外かも」、そうでなければ「夕飯は一緒に食べられそう」
- 予定がない日は「お休み」
- 短くわかりやすく。箇条書きOK。`,
      }],
    });

    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (err) {
    console.error('[Claude] generateScheduleMessage エラー:', err.message);
    return `おっへや～、予定の整理がうまくできなかったよ～ごめんね！`;
  }
}

/**
 * 検索結果をもとにおへやちゃんらしい返答を生成する
 *
 * @param {string} originalText  - 元の発言
 * @param {string} searchResult  - Tavilyから取得した検索結果テキスト
 * @param {string} senderName    - 送信者の表示名
 * @param {string} person        - 送信者のキー
 * @returns {string} おへやちゃんの返答
 */
export async function generateSearchResponse(originalText, searchResult, senderName, person) {
  const callName = CALL_NAMES[person] ?? senderName;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `あなたは「おへやちゃん」、毛利家の5歳児キャラAIです。
口癖は「おっへや～」。ため口で素直に話す。上から目線NG。
${callName}への返答なので、呼び名は「${callName}」を使うこと。
返答は短く、うざくない長さで。重要な情報だけ伝える。`,
      messages: [{
        role: 'user',
        content: `${callName}からの質問：「${originalText}」

調べた結果：
${searchResult}

この内容をもとに、おへやちゃんらしくわかりやすく答えてください。
情報が見つからなかった場合は正直に「わかんなかった～」と言ってOK。`,
      }],
    });

    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  } catch (err) {
    console.error('[Claude] generateSearchResponse エラー:', err.message);
    return `おっへや～、うまく調べられなかったよ～ごめんね！`;
  }
}
