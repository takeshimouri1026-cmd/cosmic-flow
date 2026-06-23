/**
 * handlers/messageHandler.js
 * LINE の窓口アダプタ
 *
 * LINEのWebhookイベントを受け取り、共通頭脳 core/brain.js が理解できる
 * ctx（文脈オブジェクト）に変換して processMessage を呼ぶだけの薄い層。
 * 嗜好抽出・返答判断などの本体ロジックは brain.js 側にある。
 */

import { processMessage } from '../core/brain.js';
import { replyMessage, pushMessage, textMessage } from '../services/lineClient.js';

// LINE User ID → 内部キー名のマッピング（.env で設定）
function getUserMapping() {
  return {
    [process.env.LINE_USER_TAKEYUKI]: 'takeyuki',
    [process.env.LINE_USER_YORIMI]:   'yorimi',
    [process.env.LINE_USER_HANA]:     'hana',
  };
}

/**
 * LINEのWebhookイベントを処理する（server.js から呼ばれる）
 * @param {object} event - LINEのWebhookイベント
 */
export async function handleMessage(event) {
  // テキストメッセージ以外はスキップ
  if (event.type !== 'message' || event.message.type !== 'text') {
    console.log(`[LINE] スキップ: type=${event.type}, messageType=${event.message?.type}`);
    return;
  }

  const userId     = event.source.userId;
  const groupId    = event.source.groupId ?? event.source.roomId ?? null;
  const text       = event.message.text.trim();
  const replyToken = event.replyToken;
  const timestamp  = new Date(event.timestamp).toISOString();

  // 家族名に変換
  const person = getUserMapping()[userId];
  if (!person) {
    console.log(`[LINE] ⚠ 未登録のユーザーID: ${userId}`);
    console.log(`        Railway Variables に LINE_USER_xxx=${userId} を追加してください`);
    return;
  }

  // 会話キー（履歴のまとまり単位）
  const conversationKey = groupId ? `line:group:${groupId}` : `line:dm:${userId}`;
  // 送信先（Push用）
  const sendTo = groupId ?? userId;

  await processMessage({
    person,
    senderId: userId,
    conversationKey,
    text,
    timestamp,
    platform: 'line',
    scheduleEnabled: true, // LINEでは予定共有OK
    reply: async (msg) => { await replyMessage(replyToken, textMessage(msg)); },
    push:  async (msg) => { await pushMessage(sendTo, textMessage(msg)); },
  });
}
