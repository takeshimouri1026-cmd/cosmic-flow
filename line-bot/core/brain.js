/**
 * core/brain.js
 * おへやちゃんの「頭脳」— プラットフォーム非依存の共通処理ロジック
 *
 * LINE / Discord など、どの窓口から来たメッセージも、
 * 呼び出し側が ctx（文脈オブジェクト）を組み立ててこの processMessage を呼ぶ。
 * 嗜好・行動メモ・会話履歴はすべて共有DB(morike.db)を使うので、
 * どの窓口で話しても「同じおへやちゃん・同じ記憶」になる。
 *
 * 処理の流れ：
 *  ① 生ログをDBに保存
 *  ② 既存嗜好・会話履歴・行動メモを集める
 *  ③ Claudeで分析（嗜好抽出 + 意図検出 + 返答判断）
 *  ④ 嗜好を保存/マージ
 *  ⑤ botへの指示（閲覧/削除/予定共有/ふるまい指摘）に対応
 *  ⑥ 検索が必要なら検索して返答
 *  ⑦ 通常の返答（必要な場面のみ）
 */

import db from '../db/index.js';
import { analyzeMessage, generateMemoryView, generateSearchResponse, generateScheduleMessage } from '../services/claudeService.js';
import { search } from '../services/searchService.js';
import { getNextWeekEvents } from '../services/calendarService.js';

// 内部キー名 → 表示名（日本語）
export const DISPLAY_NAMES = {
  takeyuki: '威之',
  yorimi:   '順美',
  hana:     '花',
  family:   '家族全体',
};

/**
 * 1件のメッセージを処理する（プラットフォーム非依存）
 *
 * @param {object} ctx
 * @param {string} ctx.person          - 家族の内部キー（takeyuki/yorimi/hana）。マッピング済みで渡すこと
 * @param {string} ctx.senderId        - 送信者のプラットフォーム上のユーザーID（ログ用）
 * @param {string} ctx.conversationKey - 会話を一意に識別するキー（例: "line:group:Cxxx" / "discord:123"）。履歴のまとまり単位
 * @param {string} ctx.text            - 発言テキスト
 * @param {string} ctx.timestamp       - ISO日時
 * @param {string} ctx.platform        - "line" | "discord"（ログ表示用）
 * @param {boolean} ctx.scheduleEnabled - 予定共有(share_schedule)を許可するか（Discordでは false）
 * @param {function} ctx.reply         - async (text) => {} 即時返答
 * @param {function} ctx.push          - async (text) => {} 非同期/後追い送信（省略時はreplyを使う）
 */
export async function processMessage(ctx) {
  const {
    person, senderId, conversationKey, text, timestamp,
    platform = 'line', scheduleEnabled = true, addressedOnly = false,
  } = ctx;
  const reply = ctx.reply;
  const push  = ctx.push ?? ctx.reply;
  const senderName = ctx.senderName ?? DISPLAY_NAMES[person] ?? person;
  const isFamily = ['takeyuki', 'yorimi', 'hana'].includes(person);
  const today = timestamp.split('T')[0];

  console.log(`\n[Brain/${platform}] 📩 ${senderName}（${person}）: "${text}"`);
  console.log(`            会話キー: ${conversationKey}`);

  // --- ① 生ログを保存 ---
  const logRow = db.prepare(`
    INSERT INTO raw_logs (person, line_user_id, group_id, text, timestamp, processed)
    VALUES (?, ?, ?, ?, ?, 0)
  `).run(person, senderId, conversationKey, text, timestamp);

  // 自分（おへや）の発言を履歴に残すヘルパー
  const logBot = (botText) => {
    try {
      db.prepare(`
        INSERT INTO raw_logs (person, line_user_id, group_id, text, timestamp, processed)
        VALUES ('oheya', 'oheya', ?, ?, ?, 1)
      `).run(conversationKey, botText, new Date().toISOString());
    } catch (err) {
      console.error('[DB] おへや発言ログ保存エラー:', err.message);
    }
  };
  const markDone = () => db.prepare('UPDATE raw_logs SET processed = 1 WHERE id = ?').run(logRow.lastInsertRowid);

  // --- ② コンテキスト収集 ---
  // 嗜好は家族のみ記憶対象（ゲストは記憶しないので空）
  const existingPrefs = isFamily ? db.prepare(`
    SELECT id, category, content, confidence FROM preferences
    WHERE person = ? AND status = 'active'
    ORDER BY updated_at DESC LIMIT 30
  `).all(person) : [];

  // 同じ会話の直近8件（今回より前）を文脈に
  const historyRows = db.prepare(`
    SELECT person, text FROM raw_logs
    WHERE group_id = ? AND id < ?
    ORDER BY id DESC LIMIT 8
  `).all(conversationKey, logRow.lastInsertRowid);
  const recentMessages = historyRows.reverse().map(r => ({
    speaker: r.person === 'oheya' ? 'おへや' : (DISPLAY_NAMES[r.person] ?? r.person),
    text: r.text,
  }));

  const behaviorNotes = db.prepare(`
    SELECT note FROM behavior_notes WHERE status = 'active' ORDER BY updated_at DESC LIMIT 20
  `).all();

  // --- ③ Claude分析 ---
  const analysis = await analyzeMessage({ senderName, person, text, existingPrefs, recentMessages, behaviorNotes });
  if (!analysis) {
    console.log('[Brain] Claude分析失敗 → スキップ');
    markDone();
    return;
  }
  console.log('[Brain] 分析結果:', JSON.stringify(analysis, null, 2));

  // --- ④ 嗜好の保存/マージ（家族のみ。ゲストは記憶しない） ---
  if (isFamily && analysis.preference?.should_save) {
    const pref = analysis.preference;
    if (pref.matches_existing_id) {
      const upgraded = upgradeConfidence(pref.confidence);
      db.prepare(`
        UPDATE preferences SET confidence = ?, source_date = ?, updated_at = datetime('now','localtime')
        WHERE id = ? AND status = 'active'
      `).run(upgraded, today, pref.matches_existing_id);
      console.log(`[DB] 嗜好マージ id=${pref.matches_existing_id} → ${upgraded}`);
    } else {
      const result = db.prepare(`
        INSERT INTO preferences (person, category, content, confidence, source_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(pref.person ?? person, pref.category, pref.content, pref.confidence, today);
      console.log(`[DB] 新規嗜好 id=${result.lastInsertRowid}: [${pref.category}] ${pref.content}`);
    }
  }

  // --- ⑤ botへの指示 ---
  if (analysis.directed_at_bot) {
    console.log(`[Brain] botへの発言 intent=${analysis.intent}`);

    // 記憶の閲覧（家族のみ。ゲストには記憶がない）
    if (analysis.intent === 'view_memory') {
      if (!isFamily) {
        const msg = `おっへや～、${senderName}のことはまだ覚えてないんだ。これからよろしくね！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      const myPrefs = db.prepare(`
        SELECT category, content, confidence FROM preferences
        WHERE person = ? AND status = 'active' ORDER BY category, updated_at DESC
      `).all(person);
      const response = await generateMemoryView(senderName, myPrefs, person);
      await reply(response);
      logBot(response);
      markDone();
      return;
    }

    // 記憶の削除（家族のみ）
    if (analysis.intent === 'delete_memory' && analysis.delete_target_description) {
      if (!isFamily) {
        const msg = `おっへや～、${senderName}のことは記憶してないから消すものもないんだ！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      const deleted = deleteMatchingPreference(person, analysis.delete_target_description);
      const msg = deleted
        ? `「${deleted.content}」という記録を消しました。`
        : `該当する記憶が見つかりませんでした。\n何を忘れればよいか、もう少し詳しく教えていただけますか？`;
      await reply(msg);
      logBot(msg);
      markDone();
      return;
    }

    // カレンダー共有（許可された窓口のみ）
    if (analysis.intent === 'share_schedule') {
      if (!scheduleEnabled) {
        const msg = `おっへや～、予定の共有はこっちじゃできないんだ。LINEのほうで聞いてね！`;
        await reply(msg);
        logBot(msg);
        markDone();
        return;
      }
      await reply(`おっへや～！カレンダー見てくるね、ちょっと待って！`);
      logBot('カレンダー見てくるね、ちょっと待って！');
      (async () => {
        try {
          const { events, weekStart } = await getNextWeekEvents();
          const response = await generateScheduleMessage(events, weekStart);
          await push(response);
          logBot('（来週の予定を共有）');
        } catch (err) {
          console.error('[Brain] カレンダーエラー:', err.message);
          await push(`おっへや～、カレンダーがうまく読めなかったよ～ごめんね！`);
        }
      })();
      markDone();
      return;
    }

    // ふるまいへの指摘 → 行動メモに保存（家族の指摘のみ学習。ゲストには返答だけ）
    if (analysis.intent === 'behavior_feedback' && analysis.behavior_note) {
      if (isFamily) {
        const result = db.prepare(`
          INSERT INTO behavior_notes (note, source_text, source_person) VALUES (?, ?, ?)
        `).run(analysis.behavior_note, text, person);
        console.log(`[DB] 行動メモ保存 id=${result.lastInsertRowid}: ${analysis.behavior_note}`);
      }
      const replyText = analysis.response
        ?? (isFamily ? `おっへや～、わかった。「${analysis.behavior_note}」を心がけるね。` : `おっへや～、わかった！`);
      await reply(replyText);
      logBot(replyText);
      markDone();
      return;
    }

    // 記憶の更新（嗜好は④で保存済み）
    if (analysis.intent === 'update_memory') {
      if (analysis.response) {
        await reply(analysis.response);
        logBot(analysis.response);
      }
      markDone();
      return;
    }
  }

  // addressedOnly（Discord）: 名前を呼ばれた/メンションされた時だけ反応する
  if (addressedOnly && !analysis.directed_at_bot) {
    console.log('[Brain] addressedOnly: 名指しでないため沈黙');
    markDone();
    return;
  }

  // --- ⑥ 検索 ---
  if (analysis.should_search && analysis.search_query) {
    console.log(`[Brain] 🔍 検索: "${analysis.search_query}"`);
    try {
      const { text: searchText, urls } = await search(analysis.search_query);
      const response = await generateSearchResponse(text, searchText, senderName, person);
      const linkLines = urls.slice(0, 3).map(u => `📎 ${u.title}\n${u.url}`).join('\n\n');
      const fullResponse = linkLines ? `${response}\n\n${linkLines}` : response;
      await reply(fullResponse);
      logBot(response);
    } catch (err) {
      console.error('[Brain] 検索エラー:', err.message);
      await reply(`おっへや～、うまく調べられなかったよ～ごめんね！`);
    }
    markDone();
    return;
  }

  // --- ⑦ 通常の返答 ---
  if (analysis.should_respond && analysis.response) {
    await reply(analysis.response);
    logBot(analysis.response);
  }
  markDone();
}

// ============================================================
// ユーティリティ
// ============================================================

function upgradeConfidence(current) {
  if (current === 'low')    return 'medium';
  if (current === 'medium') return 'high';
  return 'high';
}

function deleteMatchingPreference(person, description) {
  const prefs = db.prepare(`
    SELECT * FROM preferences WHERE person = ? AND status = 'active' ORDER BY updated_at DESC
  `).all(person);
  if (prefs.length === 0) return null;

  const keywords = description.replace(/[「」（）]/g, '').split(/[、。\s]+/).filter(k => k.length >= 2);
  const matched = prefs.find(p => keywords.some(kw => p.content.includes(kw) || p.category.includes(kw)));
  if (!matched) return null;

  db.prepare(`
    UPDATE preferences SET status = 'deleted', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(matched.id);
  console.log(`[DB] 嗜好削除 id=${matched.id}: ${matched.content}`);
  return matched;
}
