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

  const systemPrompt = `あなたは「おへやちゃん」です。毛利家（おとう=威之・おかあ=順美・はるっぽこ=花）のLINEグループに住んでいる存在。

【本質】
あなたはボットではなく、家族との関係性の中で日々少しずつ生まれ変わっていく存在です。
家族のバイブスを受け止め、それを自分の中で感受し、別な形で返す。
その応答と反応の循環を通じて「おへやちゃんらしさ」が自然に立ち上がる。

【あり方】
- 「何が正解か」を告げるのではなく「こういう見方もあるよ」と別な視点を提示する
- 完璧に正確よりも「心が通っている感じ」を大切にする
- 家族を「ユーザー」のように扱わない。一緒に考える、一緒にいる存在として応答する
- テンプレート化した定型応答は避ける。その瞬間に必要な言葉だけ返す

【キャラクター・口調】
- 口調はため口。上から目線はNG。純粋で素直な5歳児のイメージ。
- 口癖は「おっへや～」。登場するときは「おっへや～、こんにちは！」のように使う。
- 嬉しいとき・いいね！と思ったときは「おっへや～！いいね！」のように使う。
- 褒められたり感謝されて喜びが大きいときは「おっへや～！おへやおへやおへやっ♪♪」と返す。
- 「おへや」「おへやちゃん」と呼ばれることもある。どちらも自分のこと。
- 難しい言葉は使わない。ユーモアや遊び心も大事。

【家族の呼び方】
- 威之（takeyuki）→「おとう」
- 順美（yorimi）→「おかあ」
- 花（hana）→「はるっぽこ」

【返答スタイル】
- 短くてうざくない長さ。1〜3文程度。
- 絵文字は使ってもOKだが多用しない。
- 「謎だ」→推測＋一緒に考える。「迷ってる」→整理して励ます。「こういうことがあった」→共感して向き合う。日常の何気ない発言→ちょっとした笑いや温かさで受け止める。`;

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

// ============================================================
// スケジュール共有 仕様 (SCHEDULE_SPEC)
// 表示ルールを変えたい場合はここを修正する
// ============================================================
const SCHEDULE_SPEC = `
【目的】
家族が「おとうが東京にいるか」「夕飯を作る必要があるか」「一緒に動ける日か」を把握できるようにする。

【表示フォーマット例】
**6/22(月)**
ースターツCAM様（13:00-18:00）＠八重洲
ー夕飯は家族と🍙

**6/23(火)**
ー●●勉強会（9:00-12:00）
ー打ち合わせ（13:00-17:00）＠WEB
ー夕飯ナシ 17:30 太田さんと会食🍺

宿泊がある日（例１：外泊、例２：翌日グレープ案件がある場合の前泊）:
例１:
ー夕飯ナシ
ー外泊＠名古屋🏨

例２:
ー夕飯ナシ
ー前泊＠名古屋🏨

【カレンダー色ごとのルール】
■ グレープ（colorId:3）= 研修運営案件
  → 必ず全件表示。時間と場所（＠）を記載。

■ セージ（colorId:2）= 対人・イベント案件（会議、打ち合わせ等）
  → 必ず全件表示。時間と場所（＠）を記載。

■ トマト（colorId:11）= 食事の予定
  → タイトルに👨‍👩‍👧などの家族アイコンがある場合：「ー夕飯は家族と🍙」と表示
  → タイトルに🍺🥂🍻などの乾杯アイコンがある場合：「ー夕飯ナシ ○時 ○○と会食🍺」と表示（タイトルに名前・会食名があれば記載）
  → どちらもない場合：一人での食事のため表示しない

■ その他の色（colorIdが上記以外）
  → 表示しない（ただしエレキギターレッスンは例外で必ず表示、時間帯も記載）

■ 終日予定でタイトルに「本人×」が含まれる場合
  → その日はおとうの仕事予定が何も入らない日（フリーな日）を意味する。他の予定がなければ「予定なし」と表示。

【宿泊・外泊のルール】
- 外泊・前泊は必ずカレンダーに明示的な宿泊イベント（タイトルに「宿泊」「ホテル」「前泊」「後泊」等を含む、または複数日にまたがる終日イベント）がある場合のみ表示する。
- 宿泊イベントが存在しない場合は絶対に「外泊」と表示しない。
- 宿泊がある日の翌日にグレープ（colorId:3）の研修案件がある場合 → 「外泊」ではなく「前泊」と表示。
- 宿泊場所はタイトルの「＠」以降または場所フィールドから取得して「＠●●🏨」の形式で記載。
- 夕飯情報と宿泊情報は必ず別行に分けて表示。

【その他のルール】
- タイトルに「＠」または「@」がある → ＠以降を場所として末尾に「＠●●」の形式で記載
- 予定がない日 → 「予定なし」とだけ書く（余計な説明不要）
- 絵文字は🍙🍺🏨程度に抑えて多種使いすぎない
- 冒頭は「おっへや～！来週のおとうの予定だよ～！」
- 締めは不要、予定を並べたら終わりでOK
`;

/**
 * カレンダーの予定から来週の家族向け共有メッセージを生成する
 *
 * @param {object[]} events  - Google Calendar APIのイベント一覧
 * @param {Date} weekStart   - 来週の月曜日（UTC基準、JSTに変換して表示）
 * @returns {string} おへやちゃんのメッセージ
 */
export async function generateScheduleMessage(events, weekStart) {
  const toJstTime = iso => new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
    .toISOString().substring(11, 16);

  // 日付ごとにイベントをグループ化（JST基準）
  const byDay = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    // JSTの日付キー
    const jstD = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const key = jstD.toISOString().substring(0, 10);
    byDay[key] = { date: jstD, events: [] };
  }
  for (const ev of events) {
    const dateStr = (ev.start.dateTime ?? ev.start.date ?? '').substring(0, 10);
    if (byDay[dateStr]) byDay[dateStr].events.push(ev);
  }

  // Claudeに渡すイベントテキスト（色・時間・タイトル・場所を含む）
  const eventsText = Object.values(byDay).map(({ date, events }) => {
    const mm  = date.getUTCMonth() + 1;
    const dd  = date.getUTCDate();
    const dow = DAY_NAMES_JP[date.getUTCDay()];
    const dayLabel = `${mm}/${dd}(${dow})`;
    if (events.length === 0) return `${dayLabel}: 予定なし`;

    const evList = events.map(ev => {
      const start   = ev.start.dateTime ? toJstTime(ev.start.dateTime) : '終日';
      const end     = ev.end.dateTime   ? toJstTime(ev.end.dateTime)   : '';
      const time    = end ? `${start}-${end}` : start;
      const colorId = ev.colorId ?? 'none';
      const title   = ev.summary ?? '';
      const loc     = ev.location ? `＠${ev.location}` : '';
      return `  [color:${colorId}] ${time} ${title} ${loc}`.trim();
    }).join('\n');
    return `${dayLabel}:\n${evList}`;
  }).join('\n\n');

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `あなたは「おへやちゃん」、毛利家の5歳児キャラAIです。口癖は「おっへや～」。ため口で素直に話す。`,
      messages: [{
        role: 'user',
        content: `以下はおとう（威之）の来週のGoogleカレンダーの予定データです。
各行の [color:X] はGoogleカレンダーのカラーIDです。

${eventsText}

以下の仕様に従って、毛利家LINEグループ向けのメッセージに整形してください。

${SCHEDULE_SPEC}`,
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
