/**
 * handlers/messageHandler.js
 * LINEメッセージを受け取って処理するメインロジック
 *
 * 処理の流れ：
 *  ① ユーザーIDを家族名に変換
 *  ② 生ログをDBに保存（まず記録する）
 *  ③ Claude APIでメッセージを分析（嗜好抽出 + 意図検出）
 *  ④ 嗜好があればDBに保存（または既存記録をマージ）
 *  ⑤ botへの指示（記憶の閲覧/削除）があれば対応
 *  ⑥ 返答すべき場面なら返答
 */

import db from '../db/index.js';
import { analyzeMessage, generateMemoryView } from '../services/claudeService.js';
import { replyMessage, textMessage } from '../services/lineClient.js';

// ============================================================
// 家族の設定
// ============================================================

// LINE User ID → 内部キー名のマッピング
// .env に LINE_USER_TAKEYUKI=U〇〇... と設定して使う
function getUserMapping() {
  return {
    [process.env.LINE_USER_TAKEYUKI]: 'takeyuki',
    [process.env.LINE_USER_YORIMI]:   'yorimi',
    [process.env.LINE_USER_HANA]:     'hana',
  };
}

// 内部キー名 → 表示名（日本語）
const DISPLAY_NAMES = {
  takeyuki: '威之',
  yorimi:   '順美',
  hana:     '花',
  family:   '家族全体',
};

// ============================================================
// メインの処理関数
// ============================================================

/**
 * LINEのWebhookイベントを受け取って処理する
 * server.js から呼ばれる。非同期で実行（200 OK返却後に動く）。
 *
 * @param {object} event - LINEのWebhookイベントオブジェクト
 */
export async function handleMessage(event) {
  // テキストメッセージ以外はスキップ（スタンプ・画像・音声などは今回対象外）
  if (event.type !== 'message' || event.message.type !== 'text') {
    console.log(`[Handler] スキップ: type=${event.type}, messageType=${event.message?.type}`);
    return;
  }

  const userId     = event.source.userId;
  const groupId    = event.source.groupId ?? event.source.roomId ?? null;
  const text       = event.message.text.trim();
  const replyToken = event.replyToken;
  const timestamp  = new Date(event.timestamp).toISOString();
  const today      = timestamp.split('T')[0]; // YYYY-MM-DD

  // --- ① 家族名に変換 ---
  const userMapping = getUserMapping();
  const person = userMapping[userId];

  if (!person) {
    // 未登録ユーザー → ログに表示してスキップ
    // このログを見て .env に LINE_USER_xxx=U〇〇〇 を設定する
    console.log(`[Handler] ⚠ 未登録のユーザーID: ${userId}`);
    console.log(`          .env に LINE_USER_TAKEYUKI=${userId} のように設定してください`);
    return;
  }

  const senderName = DISPLAY_NAMES[person];
  console.log(`\n[Handler] 📩 ${senderName}（${person}）: "${text}"`);
  console.log(`          グループID: ${groupId}`);

  // --- ② 生ログをDBに保存 ---
  const logRow = db.prepare(`
    INSERT INTO raw_logs (person, line_user_id, group_id, text, timestamp, processed)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(person, userId, groupId, text, timestamp);
  console.log(`[DB] 生ログ保存 id=${logRow.lastInsertRowid}`);

  // --- ③ Claude APIで分析 ---
  // その人の既存嗜好をコンテキストとして渡す（マージ判定に使う）
  const existingPrefs = db.prepare(`
    SELECT id, category, content, confidence
    FROM preferences
    WHERE person = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 30
  `).all(person);

  const analysis = await analyzeMessage({ senderName, person, text, existingPrefs });

  if (!analysis) {
    console.log('[Handler] Claude分析失敗 → スキップ');
    return;
  }

  console.log('[Claude] 分析結果:', JSON.stringify(analysis, null, 2));

  // --- ④ 嗜好をDBに保存（またはマージ） ---
  if (analysis.preference?.should_save) {
    const pref = analysis.preference;

    if (pref.matches_existing_id) {
      // 同じ意味の嗜好が既にある → confidenceを上げてsource_dateを更新（マージ）
      const upgraded = upgradeConfidence(pref.confidence);
      db.prepare(`
        UPDATE preferences
        SET confidence  = ?,
            source_date = ?,
            updated_at  = datetime('now', 'localtime')
        WHERE id = ? AND status = 'active'
      `).run(upgraded, today, pref.matches_existing_id);
      console.log(`[DB] 嗜好マージ id=${pref.matches_existing_id} → confidence=${upgraded}`);
    } else {
      // 新規登録
      const result = db.prepare(`
        INSERT INTO preferences (person, category, content, confidence, source_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(pref.person ?? person, pref.category, pref.content, pref.confidence, today);
      console.log(`[DB] 新規嗜好 id=${result.lastInsertRowid}: [${pref.category}] ${pref.content}`);
    }
  }

  // --- ⑤ botへの指示を処理 ---
  if (analysis.directed_at_bot) {
    console.log(`[Handler] botへの発言 intent=${analysis.intent}`);

    // 記憶の閲覧
    if (analysis.intent === 'view_memory') {
      const myPrefs = db.prepare(`
        SELECT category, content, confidence
        FROM preferences
        WHERE person = ? AND status = 'active'
        ORDER BY category, updated_at DESC
      `).all(person);

      const response = await generateMemoryView(senderName, myPrefs, person);
      await replyMessage(replyToken, textMessage(response));
      markProcessed(logRow.lastInsertRowid);
      return;
    }

    // 記憶の削除
    if (analysis.intent === 'delete_memory' && analysis.delete_target_description) {
      const deleted = deleteMatchingPreference(person, analysis.delete_target_description);
      if (deleted) {
        await replyMessage(replyToken, textMessage(
          `「${deleted.content}」という記録を消しました。`
        ));
      } else {
        await replyMessage(replyToken, textMessage(
          `該当する記憶が見つかりませんでした。\n何を忘れればよいか、もう少し詳しく教えていただけますか？`
        ));
      }
      markProcessed(logRow.lastInsertRowid);
      return;
    }

    // 記憶の更新（新しい情報として既に嗜好保存されているので追加処理なし）
    if (analysis.intent === 'update_memory') {
      // 新しい嗜好は ④ で既に保存済み
      if (analysis.response) {
        await replyMessage(replyToken, textMessage(analysis.response));
      }
      markProcessed(logRow.lastInsertRowid);
      return;
    }
  }

  // --- ⑥ 通常の返答（必要な場面のみ） ---
  if (analysis.should_respond && analysis.response) {
    await replyMessage(replyToken, textMessage(analysis.response));
  }

  markProcessed(logRow.lastInsertRowid);
}

// ============================================================
// ユーティリティ
// ============================================================

// 生ログを処理済みにマーク
function markProcessed(logId) {
  db.prepare('UPDATE raw_logs SET processed = 1 WHERE id = ?').run(logId);
}

// confidence を1段階上げる（low→medium→high）
function upgradeConfidence(current) {
  if (current === 'low')    return 'medium';
  if (current === 'medium') return 'high';
  return 'high';
}

/**
 * 削除対象の嗜好を説明文で検索してdeletedにする
 * Claude が返した delete_target_description をもとに最も近い嗜好を探す
 *
 * @param {string} person      - 誰の嗜好か
 * @param {string} description - 削除対象の説明
 * @returns {object|null} 削除した嗜好レコード、なければ null
 */
function deleteMatchingPreference(person, description) {
  const prefs = db.prepare(`
    SELECT * FROM preferences
    WHERE person = ? AND status = 'active'
    ORDER BY updated_at DESC
  `).all(person);

  if (prefs.length === 0) return null;

  // description のキーワードで部分一致検索（シンプルな実装）
  const keywords = description.replace(/[「」（）]/g, '').split(/[、。\s]+/).filter(k => k.length >= 2);
  const matched = prefs.find(p =>
    keywords.some(kw => p.content.includes(kw) || p.category.includes(kw))
  );

  if (!matched) return null;

  db.prepare(`
    UPDATE preferences
    SET status = 'deleted', updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(matched.id);

  console.log(`[DB] 嗜好削除 id=${matched.id}: ${matched.content}`);
  return matched;
}
