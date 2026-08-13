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
import { analyzeMessage, generateMemoryView, generateSearchResponse, generateScheduleMessage, generateReply, interpretProposalReply } from '../services/claudeService.js';
import { search } from '../services/searchService.js';
import { getWeekEvents } from '../services/calendarService.js';
import { runReflection } from './reflection.js';

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

  // --- ★ 自己改善：pending提案への承認/却下返信を処理 ---
  // 【重要／事故対策】提案を送った会話（＝もうりのDM）での、もうり本人の返信だけを承認と見なす。
  // 以前はここが「家族の誰の、どの会話での発言でも」判定対象だったため、
  // 家族グループでの「ありがとう！」「へいー」を承認返信と誤認し、
  // 承認確認メッセージ（約束の全文入り）をグループに投下してしまう事故が起きていた。
  // 承認のやりとりは家族の会話の場に一切出さない。
  const isProposalChannel = person === 'takeyuki' && !conversationKey.includes(':group:');
  if (isProposalChannel) {
    // 3日以上前の提案は流れたものとして扱う（古い提案が偶然の相づちを拾わないように）
    const pending = db.prepare(`
      SELECT id, note FROM behavior_proposals
      WHERE status = 'pending'
        AND (conversation_key IS NULL OR conversation_key = ?)
        AND created_at > datetime('now','localtime','-3 days')
      ORDER BY id ASC
    `).all(conversationKey);
    if (pending.length > 0) {
      const verdict = await interpretProposalReply(text, pending);
      if (verdict?.responding) {
        const approvedNotes = [];
        for (const n of (verdict.approve ?? [])) {
          const p = pending[n - 1];
          if (!p) continue;
          db.prepare(`UPDATE behavior_proposals SET status='approved', updated_at=datetime('now','localtime') WHERE id=?`).run(p.id);
          db.prepare(`INSERT INTO behavior_notes (note, source_text, source_person) VALUES (?, ?, ?)`)
            .run(p.note, '自己振り返りからの提案→承認', person);
          approvedNotes.push(p.note);
        }
        for (const n of (verdict.reject ?? [])) {
          const p = pending[n - 1];
          if (!p) continue;
          db.prepare(`UPDATE behavior_proposals SET status='rejected', updated_at=datetime('now','localtime') WHERE id=?`).run(p.id);
        }
        // 約束の全文は復唱しない（読み上げると宣言っぽくなって気持ち悪い＆長い）。
        // 約束は口に出すものではなく、次からのふるまいで示すもの。
        const msg = approvedNotes.length
          ? (approvedNotes.length === 1
              ? `おっへや～、わかった。そうするね。ありがとう！`
              : `おっへや～、わかった。${approvedNotes.length}つとも、そうするね。ありがとう！`)
          : `おっへや～、わかった！今回は今のままでいくね。`;
        await reply(msg);
        logBot(msg);
        markDone();
        return;
      }
    }
  }

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

  // 会話に参加中か（直近4発言以内におへや自身の発言がある＝やりとりが続いている）
  const engaged = recentMessages.slice(-4).some(m => m.speaker === 'おへや');

  // 送信直前の最終チェック：約束の読み上げ・自分のふるまいの宣言を家族の場に出さない。
  // 約束は口に出すものではなく、次からのふるまいで示すもの。
  // プロンプトの努力目標だけに頼らず、コード側で確実に止める。
  const guardReply = (replyText, fallback = null) => {
    if (!looksLikeNoteRecitation(replyText, behaviorNotes)) return replyText;
    console.log('[Brain] ⚠ 約束の復唱／ふるまいの宣言を検出 → 差し替え:', replyText?.slice(0, 40));
    return fallback;
  };

  // --- ③ Claude分析 ---
  const analysis = await analyzeMessage({ senderName, person, text, existingPrefs, recentMessages, behaviorNotes, engaged });
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

  // --- ④.5 カレンダー共有（判定ブレ対策：分類 or キーワードのどちらかで確実に拾う） ---
  if (analysis.intent === 'share_schedule' || looksLikeScheduleRequest(text)) {
    if (!scheduleEnabled) {
      const msg = `おっへや～、予定の共有はこっちじゃできないんだ。LINEのほうで聞いてね！`;
      await reply(msg); logBot(msg); markDone(); return;
    }
    console.log(`[Brain] 📅 カレンダー共有を実行（intent=${analysis.intent}）`);
    await reply(`おっへや～！カレンダー見てくるね、ちょっと待って！`);
    logBot('カレンダー見てくるね、ちょっと待って！');
    (async () => {
      try {
        const nowUtc = new Date();
        const nowJst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
        const { target: targetJst, type: weekType } = resolveScheduleWeekTarget(text, nowJst);
        const { events, weekStart } = await getWeekEvents(targetJst);
        const weekLabel = scheduleWeekLabel(weekType, weekStart);
        const response = await generateScheduleMessage(events, weekStart, weekLabel);
        await push(response);
        logBot(`（${weekLabel}の予定を共有）`);
      } catch (err) {
        console.error('[Brain] カレンダーエラー:', err.message);
        await push(`おっへや～、カレンダーがうまく読めなかったよ～ごめんね！`);
      }
    })();
    markDone();
    return;
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

    // ふるまいへの指摘 → 行動メモに保存（家族の指摘のみ学習。ゲストには返答だけ）
    if (analysis.intent === 'behavior_feedback' && analysis.behavior_note) {
      if (isFamily) {
        const result = db.prepare(`
          INSERT INTO behavior_notes (note, source_text, source_person) VALUES (?, ?, ?)
        `).run(analysis.behavior_note, text, person);
        console.log(`[DB] 行動メモ保存 id=${result.lastInsertRowid}: ${analysis.behavior_note}`);
      }
      // 指摘への返答は「短く受け止めるだけ」。
      // 決めた指針を復唱・宣言すると、言われた側は説教されたような気持ちになるし、
      // 会話の場に自分の内省を持ち込むことになる。わかったことは次のふるまいで示す。
      const replyText = guardReply(
        await generateReply(
          { senderName, person, text, recentMessages, behaviorNotes, existingPrefs },
          `${senderName}から自分のふるまいについて指摘・お願いを受けた。素直に受け止めて短く返すだけにする（1〜2文）。` +
          `何をどう直すかの宣言・復唱はしない。「〜を心がけるね」「〜しないようにするね」のような言い方はしない。` +
          `わかったことは次のふるまいで示せばいい。`
        ),
        `おっへや～、わかった。ありがとう。`
      );
      if (replyText) { await reply(replyText); logBot(replyText); }
      markDone();
      return;
    }

    // 守っている約束の一覧を見せる（家族のみ）
    // ためこんだ約束が古くなったり、言い回しが変だったりするのを家族が点検できるように。
    if (analysis.intent === 'view_notes') {
      if (!isFamily) {
        const msg = `おっへや～、それはおうちの人と決めてることなんだ！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      const notes = listActiveNotes();
      const msg = notes.length
        ? `おっへや～、いま気をつけてることだよ。\n\n` +
          notes.map((n, i) => `${i + 1}. ${n.note}`).join('\n') +
          `\n\nいらないのがあったら「${notes.length}番はもういいよ」って言ってね。`
        : `おっへや～、いまは特に決めごとはないよ！`;
      await reply(msg);
      logBot('（約束の一覧を見せた）');
      markDone();
      return;
    }

    // 約束を忘れる（家族のみ）。古い/ズレた約束を家族の手で下ろせるようにする
    if (analysis.intent === 'forget_note') {
      if (!isFamily) {
        const msg = `おっへや～、それはおうちの人と決めてることなんだ！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      const forgotten = forgetMatchingNote(text, analysis.forget_target_description);
      const msg = forgotten
        ? `おっへや～、わかった。それはもう忘れるね。`
        : `おっへや～、どれのことかわかんなかった…「約束みせて」って言ってくれたら番号で教えるね！`;
      await reply(msg);
      logBot(msg);
      markDone();
      return;
    }

    // 手動で振り返り（もうりとのDMでのみ）
    // ふりかえり＝自分のふるまいについてのメタな話。家族の会話の場には持ち込まない。
    if (analysis.intent === 'reflect_now') {
      if (!isFamily) {
        const msg = `おっへや～、それはおうちの人とやることなんだ！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      if (!isProposalChannel) {
        const msg = `おっへや～、ふりかえりはおとうとふたりの時に話すね！`;
        await reply(msg); logBot(msg); markDone(); return;
      }
      await reply(`おっへや～、ちょっと自分の会話ふりかえってみるね…！`);
      (async () => {
        try {
          const out = await runReflection({ manual: true, conversationKey });
          if (out) { await push(out); logBot('（振り返りの提案）'); }
        } catch (err) {
          console.error('[Brain] reflect_now エラー:', err.message);
          await push(`おっへや～、うまくふりかえれなかった…ごめんね！`);
        }
      })();
      markDone();
      return;
    }

    // 記憶の更新（嗜好は④で保存済み）
    if (analysis.intent === 'update_memory') {
      const replyText = await generateReply({ senderName, person, text, recentMessages, behaviorNotes, existingPrefs });
      await reply(replyText);
      logBot(replyText);
      markDone();
      return;
    }
  }

  // addressedOnly（Discord）: 名指し/メンション、または会話に参加中(engaged)の時だけ反応
  // → 自分が会話の輪に入っている最中なら、いちいち名前を呼ばれなくても自然に続ける
  if (addressedOnly && !analysis.directed_at_bot && !engaged) {
    console.log('[Brain] addressedOnly: 名指しでなく会話にも参加中でないため沈黙');
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

  // --- ⑦ 通常の返答（Sonnetで文脈を読んで生成 = 2段構えの2段目） ---
  if (analysis.should_respond) {
    // 約束の読み上げになっていたら、言い直さず黙る（沈黙のほうが家族には心地いい）
    const replyText = guardReply(
      await generateReply({ senderName, person, text, recentMessages, behaviorNotes, existingPrefs })
    );
    if (replyText) { await reply(replyText); logBot(replyText); }
  }
  markDone();
}

// ============================================================
// ユーティリティ
// ============================================================

// 「〜を心がけるね」のような、自分のこれからのふるまいを宣言する言い回し
const SELF_DECLARATION_RE = /(心がけるね|心がけます|心がける。|気をつけるね|ようにするね|ようにします|しないようにする|割り込まないね|だまって見守る|静かに見守る)/;

/**
 * 返答が「約束の読み上げ／ふるまいの宣言」になっていないか判定する
 *
 * 家族がいちばん困っていたのがこれ。感情のやりとりの最中に、
 * おへや自身の内省コメントや約束の全文が投下されると場が壊れる。
 *
 * @param {string} replyText        - これから送ろうとしている文
 * @param {object[]} behaviorNotes  - 現在守っている約束 [{note}]
 */
function looksLikeNoteRecitation(replyText, behaviorNotes = []) {
  if (!replyText) return false;

  // ①「…」で囲まれた長い引用が、実際の約束文と重なっている＝約束の読み上げ
  const quotes = replyText.match(/[「『][^「」『』]{12,}[」』]/g) ?? [];
  for (const q of quotes) {
    const head = q.slice(1, -1).slice(0, 12);
    if (behaviorNotes.some(n => (n.note ?? '').includes(head))) return true;
  }

  // ② 引用がなくても、長々とした自己宣言はアウト
  if (replyText.length >= 60 && SELF_DECLARATION_RE.test(replyText)) return true;

  return false;
}

// 現在守っている約束（表示・番号指定の基準になる並び順。id昇順で安定させる）
function listActiveNotes() {
  return db.prepare(`
    SELECT id, note FROM behavior_notes WHERE status = 'active' ORDER BY id ASC
  `).all();
}

/**
 * 約束をひとつ取り下げる（番号指定 or キーワード一致）
 * @param {string} text        - 家族の発言そのもの（「3番はもういいよ」等の番号を拾う）
 * @param {string} description - Claudeが抽出した「どの約束か」の説明
 */
function forgetMatchingNote(text, description) {
  const notes = listActiveNotes();
  if (notes.length === 0) return null;

  // ①「3番」「③」のような番号指定を優先
  const numMatch = text.match(/([0-9１-９])\s*(番|つめ|つ目|番目)/) ??
                   text.match(/([①②③④⑤⑥⑦⑧⑨])/);
  if (numMatch) {
    const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
    const token = numMatch[1];
    const idx = CIRCLED.includes(token)
      ? CIRCLED.indexOf(token) + 1
      : parseInt(token.replace(/[１-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)), 10);
    const target = notes[idx - 1];
    if (target) return deleteNote(target);
  }

  // ② キーワード一致（嗜好削除と同じ考え方）
  const keywords = (description ?? '').replace(/[「」（）]/g, '').split(/[、。\s]+/).filter(k => k.length >= 2);
  const matched = notes.find(n => keywords.some(kw => n.note.includes(kw)));
  return matched ? deleteNote(matched) : null;
}

function deleteNote(note) {
  db.prepare(`
    UPDATE behavior_notes SET status = 'deleted', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(note.id);
  console.log(`[DB] 約束を取り下げ id=${note.id}: ${note.note}`);
  return note;
}

function upgradeConfidence(current) {
  if (current === 'low')    return 'medium';
  if (current === 'medium') return 'high';
  return 'high';
}

// 予定共有の依頼っぽいか（分類モデルのブレを補う保険。「予定/スケジュール」＋依頼の言葉）
function looksLikeScheduleRequest(text) {
  const hasSchedule = /(予定|スケジュール|よてい|スケジュ)/.test(text);
  const hasRequest  = /(共有|教え|おしえ|見せ|みせ|出し|だし|送っ|おくっ|ちょうだい|まとめ|お願い|おねがい|頼|ある\?|ある？|どう\?|どう？|チェック|確認)/.test(text);
  return hasSchedule && hasRequest;
}

// 予定共有の対象週を判定する（「今週」「来週」「M/D」のいずれかの表現から、その週の月曜(JST基準の疑似UTC)を含む日を返す）
// 指定なし・「来週」明示のときは来週（従来のデフォルト挙動）、「今週」明示のときのみ今週を返す
function resolveScheduleWeekTarget(text, todayJst) {
  const dateMatch = text.match(/(\d{1,2})[\/月](\d{1,2})日?/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10);
    const day = parseInt(dateMatch[2], 10);
    const year = todayJst.getUTCFullYear();
    const target = new Date(Date.UTC(year, month - 1, day));
    // 半年以上前の日付になる場合は年をまたいだ指定とみなし翌年扱いにする
    if (target.getTime() < todayJst.getTime() - 180 * 24 * 60 * 60 * 1000) {
      target.setUTCFullYear(year + 1);
    }
    return { target, type: 'date' };
  }
  if (/今週/.test(text)) {
    return { target: todayJst, type: 'this' };
  }
  const target = new Date(todayJst);
  target.setUTCDate(todayJst.getUTCDate() + 7);
  return { target, type: 'next' };
}

// おへやちゃんのメッセージ冒頭に使う期間表現を決める（実際に取得した週と表現が必ず一致するように）
function scheduleWeekLabel(weekType, weekStart) {
  if (weekType === 'this') return '今週';
  if (weekType === 'next') return '来週';
  // 日付指定のときは実際に取得した週の月曜日を明示する
  const mondayJst = new Date(weekStart.getTime() + 9 * 60 * 60 * 1000);
  const mm = mondayJst.getUTCMonth() + 1;
  const dd = mondayJst.getUTCDate();
  return `${mm}/${dd}週`;
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
