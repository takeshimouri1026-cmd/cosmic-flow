/**
 * core/reflection.js
 * おへやちゃんの自己改善（提案→承認制）
 *
 * - runReflection(): 最近の会話ログを振り返り、改善案を behavior_proposals に保存して
 *   もうりにLINEで「こう変えてもいい？」と提案する。
 * - 承認の処理は brain.js 側（家族の返信を interpretProposalReply で解釈）で行う。
 * - 定期実行は server.js の scheduleDailyReflection() から。
 */

import db from '../db/index.js';
import { generateReflection } from '../services/claudeService.js';
import { pushMessage, textMessage } from '../services/lineClient.js';

const DISPLAY = { takeyuki: '威之', yorimi: '順美', hana: '花', oheya: 'おへや' };

function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
function setMeta(key, value) {
  db.prepare(`INSERT INTO meta (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

/**
 * 振り返りを実行する
 * @param {object} opts
 * @param {boolean} opts.manual - 手動トリガー（「ふりかえって」）かどうか
 * @returns {string|null} もうりに送ったメッセージ（手動時に返答へ使う）。提案なしならお知らせ文
 */
export async function runReflection({ manual = false } = {}) {
  const lastAt = getMeta('last_reflection_at');

  // 前回以降（初回は直近200件）のログを集める
  const rows = lastAt
    ? db.prepare(`SELECT person, text, timestamp, group_id FROM raw_logs
                  WHERE timestamp > ? ORDER BY id ASC LIMIT 400`).all(lastAt)
    : db.prepare(`SELECT person, text, timestamp, group_id FROM raw_logs
                  ORDER BY id DESC LIMIT 200`).all().reverse();

  // 会話として意味のある量がなければスキップ（手動時はやさしく報告）
  const dialogue = rows.filter(r => r.text && r.text.trim().length > 0);
  if (dialogue.length < 6) {
    setMeta('last_reflection_at', new Date().toISOString());
    return manual ? 'おっへや～、まだあんまり会話してないから、ふりかえりは今度にするね！' : null;
  }

  const conversationsText = dialogue
    .map(r => `${DISPLAY[r.person] ?? r.person}: ${r.text}`)
    .join('\n');

  const currentNotes = db.prepare(`SELECT note FROM behavior_notes WHERE status = 'active'`).all();

  const result = await generateReflection(conversationsText, currentNotes);
  setMeta('last_reflection_at', new Date().toISOString());

  if (!result) return manual ? 'おっへや～、うまくふりかえれなかった…ごめんね！' : null;

  const proposals = Array.isArray(result.proposals) ? result.proposals : [];

  // 提案がない時：良かった点だけ伝える（手動時のみ）
  if (proposals.length === 0) {
    const msg = `おっへや～、最近の会話ふりかえってみたよ！\n\n${result.good_points ?? ''}\n\n直したいとこは特になかった。このままがんばる！`;
    if (manual) return msg;
    return null; // 自動時は提案なしなら通知しない（うるさくしない）
  }

  // 提案を pending で保存
  const ids = [];
  const insert = db.prepare(`INSERT INTO behavior_proposals (note, rationale) VALUES (?, ?)`);
  for (const p of proposals) {
    if (!p?.note) continue;
    ids.push(insert.run(p.note, p.rationale ?? null).lastInsertRowid);
  }

  // もうりへの提案メッセージを組み立て
  const lines = proposals
    .filter(p => p?.note)
    .map((p, i) => `${i + 1}. ${p.note}\n（${p.rationale ?? ''}）`)
    .join('\n\n');
  const message =
    `おっへや～、最近の会話をふりかえってみたよ。\n\n` +
    `${result.good_points ?? ''}\n\n` +
    `それでね、もっとみんなが心地よくなるように、こう変えてみてもいい？\n\n${lines}\n\n` +
    `「①OK」「全部OK」「②はいらない」みたいに教えて！`;

  // 自動時はLINEでもうりに送る
  if (!manual) {
    const takeyuki = process.env.LINE_USER_TAKEYUKI;
    if (takeyuki) {
      try { await pushMessage(takeyuki, textMessage(message)); }
      catch (err) { console.error('[Reflection] もうりへの通知失敗:', err.message); }
    }
  }
  return message;
}

/**
 * 毎日決まった時刻(JST)に振り返りを回すスケジューラ
 * @param {number} hourJst - 実行時刻（JST, 0-23）
 */
export function scheduleDailyReflection(hourJst = 22) {
  const tick = () => {
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
    const next = new Date(nowJst);
    next.setUTCHours(hourJst, 0, 0, 0);
    if (next <= nowJst) next.setUTCDate(next.getUTCDate() + 1);
    const delay = next - nowJst;
    setTimeout(async () => {
      try {
        console.log('[Reflection] 定期振り返りを実行');
        await runReflection({ manual: false });
      } catch (err) {
        console.error('[Reflection] 実行エラー:', err.message);
      }
      tick(); // 翌日分を予約
    }, delay);
    console.log(`[Reflection] 次回振り返り予定まで約 ${Math.round(delay / 60000)} 分`);
  };
  tick();
}
