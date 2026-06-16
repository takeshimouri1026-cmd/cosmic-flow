/**
 * services/lineClient.js
 * LINE Messaging API への送信処理
 *
 * LINEのReply APIは「replyToken」を使って返信する。
 * replyTokenはWebhookイベントに1つついてくるが、30秒以内に1回しか使えない。
 * 返信が不要な場合（裏で記憶するだけ）はreplyTokenを使わずOK。
 */

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

// Authorization ヘッダーを生成（毎回呼ぶ）
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
  };
}

/**
 * replyToken を使ってグループに返信する
 * @param {string} replyToken - WebhookイベントのreplyToken
 * @param {object|object[]} messages - 送るメッセージオブジェクト（最大5件）
 */
export async function replyMessage(replyToken, messages) {
  const body = {
    replyToken,
    messages: Array.isArray(messages) ? messages : [messages],
  };

  const res = await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LINE Reply APIエラー: ${res.status} ${errText}`);
  }

  console.log('[LINE] 返信送信OK');
}

/**
 * テキストメッセージオブジェクトを作るヘルパー
 * @param {string} text - 送るテキスト
 */
export function textMessage(text) {
  return { type: 'text', text };
}
