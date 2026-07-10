# Inner Universe

「内的宇宙マップ」をアプリの中で育てる。AI（Sonnet 5）とのインタビューに答えると、3D宇宙に新しい星が生まれ、光の糸が張られる。

設計の全体像は [DESIGN.md](DESIGN.md) を参照。このREADMEはフェーズ1（MVP）実装のセットアップ手順。

## 構成

```
inner-universe/
  client/   … React + Vite + Three.js（3Dビューア・インタビューUI）
  server/   … Express + TypeScript（API・Anthropic連携・Supabase接続）
  scripts/seed.ts … inner-cosmos/index.html の埋め込みデータをSupabaseへ移行
  supabase.sql     … テーブル作成SQL
```

本番はExpressが `client/dist` を静的配信しつつ同じオリジンで `/api/*` を提供する単一Webサービス構成（Render想定）。

## 1. Supabaseのセットアップ

1. Supabaseでプロジェクトを作成
2. SQL Editorで [supabase.sql](supabase.sql) を実行（universes / clusters / nodes / edges / messages / reports を作成）
3. Project Settings → API Keys から `Project URL` と Secret key（新キー体系の `sb_secret_...`。旧体系なら `service_role`）を控える（**Secret keyはサーバー専用。クライアントに出さない**）

## 2. 環境変数

`server/.env`（`server/.env.example` をコピー）:

```
PORT=3001
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...（Secret key。旧体系ならservice_roleのeyJ...）
APP_SHARED_SECRET=（任意の推測しにくい文字列。設定するとAPIに簡易認証がかかる）
```

`client/.env.local`（`client/.env.example` をコピー。`APP_SHARED_SECRET` を設定した場合のみ必要）:

```
VITE_APP_SHARED_SECRET=（server/.envと同じ値）
```

## 3. 既存データの移行（inner-cosmos → Supabase）

`inner-cosmos/index.html`（正データ）の `CLUSTERS` / `NODES` / `EDGES` をパースしてSupabaseへ投入する。
※ inner-cosmos側は継続インタビューで構造が変わることがある。seed前に変数宣言の形（`const NODES =` / `const EDGES =`）が現状のままか確認すること。

```bash
npm --prefix server install
npm run seed
```

初回実行時に universe を1件作成し、以後は再利用する（idempotent。既存キーはupsertで上書き）。`inner-cosmos/` 自体は触らずアーカイブとして残る。

## 3.5 フェーズ2a（手入れモード）のDB更新

既存のSupabaseプロジェクトに `nodes.user_edited` 列を追加する必要がある。SQL Editorで以下を実行（[supabase.sql](supabase.sql) 末尾に追記済みなので、まとめて再実行しても冪等）:

```sql
alter table nodes add column if not exists user_edited boolean not null default false;
```

## 3.6 フェーズ2a追補（糸の意味論）のDB更新

既存のSupabaseプロジェクトに `edges.kind` 列を追加する必要がある。SQL Editorで以下を実行（[supabase.sql](supabase.sql) 末尾に追記済みなので、まとめて再実行しても冪等）:

```sql
alter table edges add column if not exists kind text not null default 'influence'
  check (kind in ('influence','example','resonance'));
```

既存エッジは全てデフォルトの `influence` のままになる（一括再分類はしない。§2.1参照）。

## 3.7 フェーズ2b（探索モード）のDB更新

新規テーブル。既存テーブルへのALTERは無いので、Supabaseプロジェクトへの追加はこのテーブル作成だけで済む（[supabase.sql](supabase.sql) 末尾に追記済み。まとめて再実行しても冪等）:

```sql
create table if not exists expeditions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  path jsonb not null,
  narration text,
  created_at timestamptz default now()
);
```

## 4. ローカル開発

```bash
npm --prefix server install
npm --prefix client install

# ターミナル1: API サーバー（http://localhost:3001）
npm run dev:server

# ターミナル2: フロントエンド（http://localhost:5173、/api は3001へプロキシ）
npm run dev:client
```

ブラウザで http://localhost:5173 を開く。星をタップすると詳細パネル、下部のチャット欄でインタビューに答えると星が生まれる。

## 5. 本番ビルド

```bash
npm run build   # client と server の両方をビルド
npm start       # server/dist/index.js が client/dist を静的配信 + /api を提供
```

## 6. Renderへのデプロイ

1. Render で **New Web Service** を作成し、このリポジトリ（`inner-universe/` をルートディレクトリに指定 or monorepoならRoot Directoryに `inner-universe` を設定）
2. Build Command: `npm run build`
3. Start Command: `npm start`
4. Environment Variables に上記 `server/.env` の内容（`ANTHROPIC_API_KEY` / `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `APP_SHARED_SECRET`）を設定
5. `APP_SHARED_SECRET` を設定した場合、クライアントのビルド時に `VITE_APP_SHARED_SECRET` も同じ値で設定する（Vite の環境変数はビルド時に埋め込まれるため、Render の Environment Variables に追加した上でビルドし直す）
6. **ローカル開発と同じSupabaseプロジェクトを使う場合、seedの再実行は不要**（データはすでにSupabase側にある）。新しいSupabaseプロジェクトを使う場合のみ、ローカルから本番のSupabaseを向けて `npm run seed` を一度実行する

RenderのディスクはエフェメラルなためデータはSupabaseに保存される。デプロイ自体にファイルの永続化は不要。

## セキュリティ・コストメモ

- APIキー（Anthropic・Supabase service_role）はサーバーのみが保持し、クライアントには一切露出しない
- `APP_SHARED_SECRET` を設定すると全APIにヘッダ認証がかかる（URLが漏れても他人に書き換えられないように）
- `/api/universe/:id/interview` は同時1リクエストに制限（連打防止）
- プロンプトキャッシュ（system＋履歴）でインタビューの往復コストを抑える構成になっている
