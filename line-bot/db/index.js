/**
 * db/index.js
 * SQLiteデータベースの接続とテーブル初期化
 *
 * better-sqlite3 は「同期型」のSQLiteライブラリ。
 * async/awaitなしでシンプルに書けるので家族規模には最適。
 * 将来Postgresに移行するときも、このファイルだけ差し替えればOK。
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'morike.db');

// dataディレクトリがなければ作成
mkdirSync(DATA_DIR, { recursive: true });

// DB接続（ファイルがなければ自動作成される）
const db = new Database(DB_PATH);

// パフォーマンス設定
db.pragma('journal_mode = WAL');  // 書き込みと読み込みを並行処理できるモード
db.pragma('foreign_keys = ON');   // 外部キー制約を有効化

// ============================================================
// テーブル作成（IF NOT EXISTS なので2回目以降は何もしない）
// ============================================================
db.exec(`
  -- 家族の嗜好テーブル
  -- 「誰が」「何カテゴリの」「どんな好み/苦手を持っているか」を記録する
  CREATE TABLE IF NOT EXISTS preferences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    person      TEXT NOT NULL CHECK(person IN ('takeyuki', 'yorimi', 'hana', 'family')),
    category    TEXT NOT NULL,
    -- food / restaurant / travel / activity / schedule / dislike など
    content     TEXT NOT NULL,
    -- 人間が読んで自然な文（例: 「辛い料理が苦手」「スパニッシュ料理が好き」）
    confidence  TEXT NOT NULL DEFAULT 'medium'
                CHECK(confidence IN ('high', 'medium', 'low')),
    -- 同じ傾向が何度も確認されるほど high になる
    source_date TEXT NOT NULL,
    -- この嗜好の根拠になった発言の日付（YYYY-MM-DD）
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active', 'deleted')),
    -- 削除は物理削除せずフラグで管理（deleted にするだけ）
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 生ログテーブル（嗜好抽出の元データ 兼 会話履歴）
  -- 家族とおへやちゃん自身の発言を保持し、直近の文脈把握に使う
  CREATE TABLE IF NOT EXISTS raw_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    person       TEXT NOT NULL,
    line_user_id TEXT NOT NULL,
    group_id     TEXT,
    text         TEXT NOT NULL,
    timestamp    TEXT NOT NULL,
    processed    INTEGER NOT NULL DEFAULT 0
    -- 0: 未処理, 1: 処理済み（数日後にクリーンアップ対象）
  );

  -- 行動メモテーブル（おへやちゃんの「ふるまい」への指摘を記憶する）
  -- 「もっと静かにして」「連打しないで」などの指摘をここに保存し、
  -- 毎回システムプロンプトに読み込んで行動に反映する。
  -- 嗜好(preferences)とは別物：これは"場のルール・自分の在り方"の記憶。
  CREATE TABLE IF NOT EXISTS behavior_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note        TEXT NOT NULL,
    -- おへやちゃん自身の言葉で言い換えた行動指針（例:「家族の会話が続いている間は割り込まない」）
    source_text TEXT,
    -- 元になった家族の発言
    source_person TEXT,
    -- 誰からの指摘か
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active', 'deleted')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 自己改善の「提案」テーブル（毎晩の振り返りで生成 → もうりが承認したら behavior_notes へ）
  CREATE TABLE IF NOT EXISTS behavior_proposals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    note        TEXT NOT NULL,   -- 提案するふるまいの指針
    rationale   TEXT,            -- なぜそう提案するのか（振り返りの根拠）
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  -- 汎用メタ情報（最後に振り返った日時など）
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

console.log('[DB] SQLite接続OK →', DB_PATH);

export default db;
