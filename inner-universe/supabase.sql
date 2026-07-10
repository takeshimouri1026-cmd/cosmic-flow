-- inner-universe: フェーズ1 スキーマ
-- Supabase の SQL Editor で実行する

create extension if not exists pgcrypto;

create table if not exists universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  title text not null default '内的宇宙',
  pending_question text,
  version text default '1.0.0',
  created_at timestamptz default now()
);

create table if not exists clusters (
  universe_id uuid references universes(id) on delete cascade,
  key text,
  label text not null,
  color text not null,
  primary key (universe_id, key)
);

create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('belief','experience','knowledge','meta')),
  cluster text not null,
  size int not null check (size between 1 and 10),
  description text not null,
  status text not null default 'confirmed' check (status in ('confirmed','inferred')),
  source text not null default 'interview' check (source in ('seed','interview','booklog','council')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (universe_id, key)
);

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  source_key text not null,
  target_key text not null,
  strength real not null check (strength between 0 and 1),
  description text not null,
  inferred boolean not null default false,
  source text not null default 'interview',
  created_at timestamptz default now(),
  unique (universe_id, source_key, target_key)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,
  created_at timestamptz default now()
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  model text not null,
  content_md text not null,
  created_at timestamptz default now()
);

-- フェーズ1はシングルユーザー・サーバ経由アクセスのみのため RLS は無効のままでよい

-- フェーズ2a: 手入れモード（§13）
-- ユーザーが直接書き換えたノードはAIによる上書き(update_node)を拒否するためのフラグ
alter table nodes add column if not exists user_edited boolean not null default false;

-- フェーズ2a追補: 糸の意味論（§2.1）
-- 関係タイプ。既存エッジは全てデフォルトのinfluenceのまま（一括再分類はしない）
alter table edges add column if not exists kind text not null default 'influence'
  check (kind in ('influence','example','resonance'));

-- フェーズ2b: 探索モード（§12）
-- 探検ログ。どこを歩いたか自体が編集会議・好奇心エンジンの一級の入力になる
create table if not exists expeditions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  path jsonb not null,        -- [{node_key, edge_id, memo}...]
  narration text,             -- 「道のりを読み解く」で生成した内省ナレーション
  created_at timestamptz default now()
);
