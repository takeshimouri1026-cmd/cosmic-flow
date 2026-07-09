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
