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
