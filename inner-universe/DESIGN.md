# Inner Universe — アプリ設計書 v1.2

*2026-07-09 Fable 5設計。実装はSonnet 5のセッションがこのドキュメントを読んで行う。*
*v1.1: 外部情報源コネクタ（§10）と好奇心エンジン（§11）を追加、フェーズ計画を更新。*
*v1.2: 探索モード＝一人称の洞窟探検（§13）を追加。俯瞰（三人称）と探索（一人称）の2モード構成が確定。*

## 実装状況（2026-07-10 追記）

**フェーズ1（MVP）は実装・動作確認済み。** 詳細は [inner-universe/README.md](README.md) とメモリ `project_inner_universe.md` を参照。以下、設計からの差分・注意点のみ記す。

- 実装場所は本ドキュメントどおり `inner-universe/`（`client/` = React+Vite+Three.js、`server/` = Express+TS、`scripts/seed.ts`）
- **移行元データの構造が設計時から変わっている**: `inner-cosmos/index.html` は他セッションでの継続インタビューにより `GRAPH.nodes`/`GRAPH.edges`（ネスト構造）から、独立した `NODES`/`EDGES` 配列 + 明示的な `inferred` フィールドを持つ形に変化した（cluster key も `modernity`ではなく既に`modern`に統一済み）。`scripts/seed.ts` はこの現行構造をパースするように書かれている。**次に`inner-cosmos/index.html`の構造を変える場合はseed.tsも追従が必要。**
- **このPC特有の注意**: NortonアンチウイルスがTLSを中間検査しNode.jsの`fetch`（Supabase/Anthropic向け）が失敗する（`[[norton-ssl-interception]]`参照）。`server/src/index.ts`と`scripts/seed.ts`の先頭で`win-ca`パッケージを使い回避済み。新しいNode.jsエントリポイントを追加する際は同じ対策を入れること
- Node.js 20.18では`@supabase/supabase-js`のrealtimeクライアントがネイティブWebSocket必須のためエラーになる。`createClient`に`realtime: { transport: WebSocket }`（`ws`パッケージ）を渡して回避済み（realtime機能自体は未使用）
- Supabaseの新APIキー体系（Publishable/Secret key）を使用。`SUPABASE_SERVICE_KEY`には`sb_secret_...`形式のSecret keyを設定する（従来の`service_role`キーと役割は同じ）
- ローカル動作確認は完了（Supabase実データ・Anthropic APIキー設定済み、`npm run seed`→`dev:server`/`dev:client`で疎通確認済み）。ブラウザでの実際のインタビュー体験（星の誕生・確定/削除UI）はユーザー自身の環境での最終確認待ち
- フェーズ2着手時は、`inner-universe/client/src/UniverseScene.tsx`（3Dビューア）・`inner-universe/server/src/interviewEngine.ts`（インタビューSSEループ）が主な拡張ポイントになる（§12 探索モードはこの2ファイルに機能追加する形になる見込み）

## 0. コンセプト

「内的宇宙マップ」を、開発画面ではなく**アプリの中で育てる**。
ユーザーはアプリ内でAI（Sonnet 5）のインタビューに答える。答えるそばから、目の前の3D宇宙に新しい星が生まれ、光の糸が張られる。**語る体験と宇宙が育つ体験が同じ画面で起きる**ことが、このアプリの核。

将来は他のユーザーも自分の宇宙を持てるようにする（マルチテナント前提の設計、実装はフェーズ3）。

現状資産:
- `inner-cosmos/index.html` — 現行の正データ（ver.0.8、NODES/EDGES埋め込み）と3D描画実装。**移行元**
- `inner-cosmos/GROWING.md` — インタビュープロトコル。**システムプロンプトの原型**
- `inner-universe/index.html` — 別実装の古いビューア(v0.1)。**アプリ実装開始時にこのフォルダを作り直してよい**（デザインの参考にはなる）

## 1. 全体アーキテクチャ

```
[ブラウザ]
  React + Vite + Three.js
  ├─ UniverseView   … 3D宇宙（既存inner-cosmos実装を移植、データはAPIから取得）
  ├─ InterviewPanel … チャットUI（下部シート/サイドパネル）
  └─ ConfirmChip    … 推定ノードの「合ってる？」確定UI
        │  REST + SSE
        ▼
[Express サーバ]  ※APIキーはサーバのみが保持
  ├─ GET  /api/universe/:id/graph      … ノード・エッジ・クラスタ一式
  ├─ POST /api/universe/:id/interview  … ユーザー発話 → Sonnet 5 (SSEで返す)
  ├─ POST /api/nodes/:id/confirm|reject … 推定→確定 / 削除（LLM不要、直接DB）
  ├─ POST /api/universe/:id/council    … 編集会議（Opus 4.8、フェーズ2）
  └─ POST /api/universe/:id/booklog    … ブクログ取り込み（フェーズ2）
        │
        ▼
[Supabase (Postgres)]        [Anthropic API]
  universes / nodes / edges     claude-sonnet-5 (インタビュー)
  messages / reports            claude-opus-4-8 (編集会議)
```

- スタックはユーザーの既存パターン（Cosmic Flow = React/Express/Supabase/Render）に合わせる
- デプロイ: Render（Web Service 1つ。ExpressがビルドしたReactを静的配信 + API）
- RenderのディスクはエフェメラルなのでデータはSupabase必須

## 2. データモデル（Supabase）

```sql
create table universes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,                -- フェーズ3でauth.usersに紐付け。それまでnull
  title text not null default '内的宇宙',
  pending_question text,        -- 次のインタビュー質問（再開用）
  version text default '1.0.0',
  created_at timestamptz default now()
);

create table clusters (
  universe_id uuid references universes(id) on delete cascade,
  key text,                     -- 'cosmos' | 'modern' | ...
  label text not null,
  color text not null,          -- '#9d8cff'
  primary key (universe_id, key)
);

create table nodes (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  key text not null,            -- 'b1','e9','k4'… 人が読めるID（エッジ参照用）
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

create table edges (
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

create table messages (      -- インタビュー全文ログ（文脈復元とtranscript用）
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content jsonb not null,    -- Anthropic Messages形式のcontent（tool_use含む）をそのまま保存
  created_at timestamptz default now()
);

create table reports (       -- 編集会議の成果物
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  model text not null,
  content_md text not null,
  created_at timestamptz default now()
);
```

RLSはフェーズ3まで無効でよい（シングルユーザー・サーバ経由アクセスのみ）。

## 3. インタビューエンジン（核心部）

### 3.1 モデルとSDK

- `@anthropic-ai/sdk`（TypeScript）。APIキーは環境変数 `ANTHROPIC_API_KEY`（Render側で設定）
- インタビュー: **`claude-sonnet-5`**（ユーザー決定。適応思考はデフォルトON、`temperature`等は送らないこと — Sonnet 5では400になる）
- `max_tokens: 8000`、ストリーミング必須（`client.messages.stream`）

### 3.2 システムプロンプト

`GROWING.md` のプロトコルを移植して構成する。**キャッシュのため次の順序を厳守**（安定→可変）:

1. `system`（`cache_control: {type:"ephemeral"}` を最終ブロックに付与）:
   - インタビュアーの人格・原則（質問は一つずつ／熱量→size反映／既存構造との響き合いを必ず探す／確定と推定の区別／inferredの昇格ルール）
   - ツールの使い方の方針
   - **タイムスタンプや動的な値をここに入れない**（キャッシュ全滅するため）
2. `messages`: DBのmessages履歴をそのまま復元し、**最新のuserターンの先頭に現在のグラフダイジェストを注入**する:

```
<graph_digest>
（全ノードの key/label/type/cluster/size/status を1行ずつ + pending_question）
</graph_digest>
<user_message>ユーザーの発話</user_message>
```

グラフは毎ターン変わるので、**先頭(system)ではなく最新ターンに置く**のがキャッシュの要点。履歴側には過去ターンのダイジェストが残るが、プレフィックスは不変なのでキャッシュが効き続ける。履歴の最終ブロックにも `cache_control` を付け、ターンごとに増分キャッシュさせる。

### 3.3 ツール定義（構造化出力の代わりにtool useで宇宙を編集させる）

すべて `strict: true`（`additionalProperties: false` + `required` 必須）。

```ts
const tools = [
  {
    name: "add_node",
    description: "ユーザーの回答から新しい星（信念・経験・知識）をマップに追加する。本人が明言した事実は status=confirmed、こちらの解釈・仮説は status=inferred。「人生で一番」「絶大」等の熱量は size に反映（最大10）。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        key:         { type: "string", description: "一意な短いID。belief=b*, experience=e*, knowledge=k* の連番" },
        label:       { type: "string" },
        type:        { type: "string", enum: ["belief","experience","knowledge","meta"] },
        cluster:     { type: "string", enum: ["cosmos","modern","earth","relation","meta"] },
        size:        { type: "integer", description: "1〜10。影響力・熱量" },
        description: { type: "string", description: "タップ時に表示される説明。本人の言葉を活かす" },
        status:      { type: "string", enum: ["confirmed","inferred"] }
      },
      required: ["key","label","type","cluster","size","description","status"],
      additionalProperties: false
    }
  },
  {
    name: "add_edge",
    description: "影響関係の糸を張る。source→target=「sourceがtargetに影響した」。本人が語った関係はinferred=false、こちらの構造的な読みはinferred=true（description末尾に「（推定）」）。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        source_key: { type: "string" },
        target_key: { type: "string" },
        strength:   { type: "number", description: "0〜1" },
        description:{ type: "string" },
        inferred:   { type: "boolean" }
      },
      required: ["source_key","target_key","strength","description","inferred"],
      additionalProperties: false
    }
  },
  {
    name: "update_node",
    description: "既存ノードの修正・昇格。推定が本人の回答で裏付けられたら status を confirmed にし description を確定情報に書き換える。誤りが判明したら内容を訂正する。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        label: { type: ["string","null"] },
        size: { type: ["integer","null"] },
        cluster: { type: ["string","null"] },
        description: { type: ["string","null"] },
        status: { type: ["string","null"], enum: ["confirmed","inferred", null] }
      },
      required: ["key","label","size","cluster","description","status"],
      additionalProperties: false
    }
  },
  {
    name: "set_pending_question",
    description: "次のインタビュー質問を1つだけ保存する（質問は必ず一つずつ）。応答本文の最後にも同じ質問を書くこと。",
    strict: true,
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false
    }
  }
];
```

### 3.4 エージェントループとSSE

`POST /api/universe/:id/interview` の処理:

1. リクエスト受領 → `res` をSSE化（`Content-Type: text/event-stream`）
2. 履歴＋グラフダイジェスト＋ユーザー発話でプロンプト構築
3. `client.messages.stream(...)` を開始。イベント変換して即時フォワード:
   - `text_delta` → SSE `{type:"text", text}`（チャット吹き出しに逐次表示）
4. `stop_reason === "tool_use"` なら各tool_useを実行（＝**DBに書き込み**）、実行結果ごとにSSEで通知:
   - `add_node` 成功 → SSE `{type:"node_added", node}` → **フロントは新しい星の誕生アニメーション**（フェードイン＋カメラが一瞬向く）
   - `add_edge` 成功 → SSE `{type:"edge_added", edge}` → 光の糸が伸びるアニメーション
   - `update_node` → SSE `{type:"node_updated", node}`（inferred→confirmedなら星が明るくなる演出）
   - tool_result（全件を**1つの**userメッセージにまとめる）を積んでループ継続
5. `end_turn` で SSE `{type:"done"}`、assistantターン（tool_use含む`response.content`丸ごと）とuserターンをmessagesテーブルに保存

エラー時: tool実行失敗は `is_error: true` のtool_resultで返しモデルに回復させる。API側エラーはSDKの型付き例外（`Anthropic.RateLimitError` 等）で分岐し、SSEで `{type:"error", message}` を返す。

### 3.5 確定/削除UI（人間がループに入る場所）

- 3D上で `status=inferred` の星は点滅 or 破線リングで区別
- タップ→詳細パネルに「✓ 合ってる」「✎ ちょっと違う」「✕ 消す」
  - ✓ → `POST /api/nodes/:id/confirm`（DB直更新、LLM不要）
  - ✎ → 入力欄が開き、修正コメントがそのまま次のインタビュー発話として送られる（Sonnetが`update_node`で直す）
  - ✕ → 削除（関連エッジも削除）

## 4. 編集会議モード（フェーズ2）

- 画面の「編集会議を開く」ボタン → `POST /api/universe/:id/council`
- モデル: **`claude-opus-4-8`**（`thinking: {type:"adaptive"}` + `output_config: {effort:"high"}`。ストリーミング必須 — 長考になる）
- 入力: 全ノード・全エッジ・過去のreports。出力: 解釈エッセイ（ハブ分析／クラスタ再編提案／緊張関係／盲点／次に掘る場所）を`reports`に保存し、専用ページで読める
- クラスタ再編などの構造変更は提案として出し、ユーザーが承認したら適用
- 月1回程度の想定。Fable 5でやりたい場合はClaude Code側でやる手もある（コスト高のため、アプリ内デフォルトはOpus）

## 5. ブクログ取り込み（フェーズ2）

- `POST /api/universe/:id/booklog` → サーバが `https://booklog.jp/users/takeshimouri/all?page=N` を2〜4ページ取得（進捗ページ番号はuniverses拡張カラムかreportsに記録。既読: p1,2,5）
- Sonnet 5にページ内容＋グラフダイジェストを渡し、**既存構造と強く共鳴する本だけ** `add_node`/`add_edge`（status=inferred, source=booklog）で提案させる
- UIは「本棚から新しい星の候補が届きました」→ 1件ずつ 採用/見送り のカード（スワイプ式だと楽しい）

## 6. 移行（最初の実装タスクの一部）

1. `inner-cosmos/index.html`（ver.0.8）の `CLUSTERS` / `NODES` / `EDGES` をパースしてSupabaseにseed投入するスクリプト（`scripts/seed.ts`）を書く。source='seed'、既存の `inferred` フラグは status/inferred にマップ
2. `GROWING.md` のプロトコル＋メモリのインタビュー履歴（第1〜6回。要点はGROWING.md末尾）をシステムプロンプト素材として移植
3. 3D描画は `inner-cosmos/index.html` の実装（force layout・グロー・ラベル・選択ハイライト）をReactコンポーネントに移植。**見た目はすでに検証済みなので新規発明しない**
4. 移行完了後も `inner-cosmos/` は触らずアーカイブとして残す（アプリが安定するまでのバックアップ）

## 7. フェーズ計画

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| **1 (MVP)** ✅実装済み | seed移行、3Dビューア、インタビューSSE＋星誕生アニメ、確定/削除UI、Render+Supabaseデプロイ | スマホのブラウザでインタビューに答えると星が生まれ、翌日も残っている（**ローカル動作確認済み。Renderへの実デプロイは未実施**） |
| **2** | **探索モード（§12: 潜る・辿る・足あと・ふりかえりメモ・道のりを読み解く）**、質問キュー（§11の土台）、ブクログ取り込み、編集会議、transcript閲覧 | ある星に潜り、糸を辿って源流まで歩き、メモが残せる |
| **3** | コネクタ基盤（§10）＋easy系情報源（Googleカレンダー→Spotify/YouTube）、闇の穴＋仮説ゴースト星（§12.4） | 設定画面でON/OFFでき、探索中に「求めているドット」の仮説に出会える |
| **4** | 好奇心エンジン本格稼働（§11）、Garmin・SNS等の難コネクタ、Supabase Auth・複数宇宙・共有リンク | |

## 8. コストとセキュリティ

- APIキーはExpressのみ。クライアントに露出させない。CORSは自ドメインのみ
- フェーズ1はシングルユーザーだが、`/api` に簡易認証（環境変数の共有シークレットをヘッダで）を最初から入れる（URLが漏れても他人に宇宙を書き換えられないように）
- レート制御: interview エンドポイントは同時1リクエスト（連打防止）
- プロンプトキャッシュ（§3.2）でインタビューの往復コストを抑える。system＋履歴がキャッシュされれば、1ターンあたりの新規入力はダイジェスト＋発話のみ
- Sonnet 5は2026-08-31までイントロ価格（$2/$10 per MTok）

## 10. 外部情報源コネクタ（フェーズ3〜）

ユーザーが設定画面で情報源を**選択してつなぎ、いつでも切れる**仕組み。切ったら取り込みが止まり、希望すればそのソース由来の未確定データを一括削除できる。

### 10.1 テーブル

```sql
create table connectors (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  provider text not null,        -- 'google_calendar' | 'spotify' | 'youtube' | 'garmin' | 'booklog' | 'manual_journal' ...
  status text not null default 'connected' check (status in ('connected','paused','disconnected')),
  credentials jsonb,             -- OAuthトークン等。保存時にアプリ層で暗号化（環境変数の鍵でAES）
  settings jsonb,                -- 取り込み範囲などプロバイダ固有設定
  last_sync_at timestamptz,
  created_at timestamptz default now(),
  unique (universe_id, provider)
);

create table inputs (            -- 全情報源共通の「生インプット置き場」
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  connector_id uuid references connectors(id) on delete cascade,
  external_id text,              -- 重複取り込み防止
  occurred_at timestamptz,       -- 出来事の発生日時
  kind text,                     -- 'calendar_event' | 'track_played' | 'activity' | 'post' | 'journal' ...
  digest text not null,          -- LLMに渡す1〜2行の要約（作成時に生成 or ルールベース）
  payload jsonb,                 -- 原データ
  processed boolean default false,  -- 好奇心エンジンが消費したか
  created_at timestamptz default now(),
  unique (connector_id, external_id)
);
```

### 10.2 同期の仕組み

- Renderの**Cron Job**（または node-cron）で1日1〜2回、connected状態のコネクタごとに差分取得 → `inputs` に投入
- 取り込みはあくまで「素材」。**この段階ではLLMを呼ばない**（コストゼロで貯まる）。digestはルールベース生成を基本にする（例: カレンダー→「7/8 19:00 ○○さんと会食」）

### 10.3 プロバイダ別の現実的な難易度（実装順の根拠）

| 情報源 | 難易度 | 備考 |
|---|---|---|
| 手動ジャーナル/メモ貼り付け | ◎ 即日 | コネクタ基盤のテスト台。テキストボックス1つ |
| ブクログ | ◎ 済み同然 | 公開ページのフェッチ（§5をコネクタ形式に統合） |
| Googleカレンダー | ○ easy | Google OAuth2 + Calendar API。定番 |
| YouTube（高評価・再生リスト） | ○ easy | 同じGoogle OAuthに相乗り |
| Spotify（再生履歴） | ○ easy | OAuth容易。**音・響きクラスタ(b6)に直結する鉱脈** |
| note / ブログ / RSS | ○ easy | 公開フィードの取得 |
| Garmin | △ 要申請 | 公式Health/Activity APIはデベロッパープログラム承認制。まずは定期的なデータエクスポート(FIT/CSV)の手動アップロードで代替し、承認が取れたらAPI化 |
| X (Twitter) | △ 有料API | 読み取りも有料枠。自分の投稿ならアーカイブエクスポートのアップロードが現実的 |
| Instagram/Facebook | ✕〜△ | API制限が厳しい。データエクスポートのアップロード方式のみ現実的 |

方針: **OAuth接続型**（カレンダー/Spotify/YouTube）と**エクスポート・アップロード型**（Garmin/X/Instagram）の2方式をコネクタ基盤として最初から区別して設計する。後者はファイルをドロップすると `inputs` にパースされる。

### 10.4 プライバシー原則（設計に焼き込む）

- トークンは暗号化保存、クライアントには一切返さない
- コネクタを disconnect したら: 同期停止＋トークン破棄。「このソース由来の未確定の星も消す」オプションを提示
- `inputs` の原データはユーザー自身のSupabaseにのみ存在。LLMに渡すのはdigest中心
- どの星がどの情報源から生まれたかを常に表示（nodes.source を拡張して provider を記録）

## 11. 好奇心エンジン（AIが自分から聴きに来る）

「インプットがたまったら、AIがつながりの仮説を立て、内的知性を形にするために**知りたいことを自分から聴いてくる**」を実現する中核。

### 11.1 質問キュー（フェーズ2で先行導入）

```sql
create table questions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  question text not null,
  rationale text,                -- なぜ聞きたいか（仮説）。UIで「AIがこれを聞きたい理由」として表示
  evidence jsonb,                -- 根拠となったinputs/nodesのID群
  status text not null default 'open' check (status in ('open','asked','answered','dismissed')),
  priority int default 5,
  created_at timestamptz default now()
);
```

既存の `set_pending_question` ツールをこのテーブルに置き換え、インタビュアーには `queue_question`（複数登録可・ただし一度に**提示**するのは1つ）を持たせる。ユーザーは質問リストを眺めて「これに答えたい」を選べる。**質問は宝物なので捨てずに貯める**。

### 11.2 観測バッチ（フェーズ3〜4）

未処理の `inputs` が閾値（例: 20件）を超えるか週1回、バッチ実行:

1. 未処理inputsのdigest一覧＋グラフダイジェスト＋直近のreportsを `claude-opus-4-8`（adaptive thinking, effort high, ストリーミング）に渡す
2. ツールで出力させる:
   - `add_node` / `add_edge`（status=inferred, source=provider名）— 生活ログと既存の星の**共鳴仮説**（例:「毎週木曜夜にギター練習の予定が入っている → k1ソロギター修行は現在進行形の実践」）
   - `queue_question` — 仮説を確定/棄却するための質問、および「内的知性を形にする上でまだ観測できていない領域」への質問（例:「カレンダーに山歩きが増えていますが、b9自然との調和と関係ありますか？」）
3. 処理済みフラグを立て、結果サマリを`reports`に記録
4. ユーザーには通知バッジ:「新しい仮説の星が2つ、聞きたいことが3つ届いています」

### 11.3 体験としてのまとめ

- **日常**: 生活が勝手に `inputs` に貯まる（コストほぼゼロ）
- **週次**: 観測バッチが仮説の星（点滅）と質問を届ける
- **気が向いた時**: アプリを開き、届いた質問に音声入力で答える → 星が確定し、新しい糸が張られる
- **月次**: 編集会議が宇宙全体を読み直す

インタビュー主導（人が語る）と観測主導（生活が語る）の両輪になる。

## 12. 探索モード — 一人称の洞窟探検（フェーズ2の主役）

現行の3Dは「自分の知性を外から眺める標本」（三人称・俯瞰）。ここに**一人称モード**を足す。ある星に潜り込み、因果の糸を洞窟の通路のように辿り、「この経験があったからこれが生まれていたのか」というメタ認知のふりかえりを、**歩く体験として**行う。

### 13.1 2つのモード

| | 俯瞰モード（既存） | 探索モード（新規） |
|---|---|---|
| 視点 | 宇宙の外から全体を見る | 星の内側に立ち、隣の星への通路だけが見える |
| 問い | 「私はどういう構造か」 | 「なぜ私はこれを大切に思うのか」 |
| カメラ | オービット＋自動漂流 | 星から星へ、糸に沿って移動 |

星の詳細パネルに **「⛏ この星に潜る」** ボタン → 探索モードへ。いつでも「宇宙に浮上」で俯瞰に戻れる。

### 13.2 潜る（チェンバー表現）

- カメラがその星の位置までズームイン。星は目の前の**発光する空間（チェンバー）**になる
- 表示するのは: この星の説明文＋**直接つながる星々だけ**。それぞれが「通路の先の光」として周囲に浮かぶ。他の全ノードはフォグの彼方に沈める（既存のFogExp2を強める＋非隣接ノードのopacityを落とすだけで実現可能）
- 各通路には**エッジのdescriptionを浮かべる**（「抑圧が剥がれた先に開けた宇宙の体感」等）。通路の向きを区別する:
  - **⬆ 源流へ**（incoming: この星を形づくったもの）——「なんで?」を掘る方向
  - **⬇ 流れの先へ**（outgoing: この星が生んだもの）
- 「なんで私はこれを?」という問いには源流方向が答えになる、というガイドをUIに薄く出す

### 13.3 辿る（トラバース）

- 通路の先の光をタップ → カメラが**エッジの曲線に沿って移動**（既存の `QuadraticBezierCurve3.getPoint(t)` をカメラパスに流用。パルス演出と同じ数学）→ 次のチェンバーに到着
- **足あと**: 通ってきた経路は明るい糸として残り、画面下にパンくず（b4 ← e9 ← e2 …）。タップでその地点に戻れる
- チェンバーごとに **「✎ ここでのふりかえりメモ」**: 「なるほどそうかも」と思ったことをその場で書ける（音声入力前提の1行メモ）。メモは:
  - `inputs`（kind='reflection'）として保存 → 好奇心エンジンの素材になる
  - そのエッジ上での納得なら「この糸、確かにある」ワンタップで **strength を強化／inferredを確定**（探索そのものがマップを育てる）

### 13.4 闇の穴 — 求めているドットの仮説（フェーズ3〜）

チェンバーには通路のほかに、**まだ照らされていない穴**を表示する。ルールベースで検出できる構造的空白（LLM不要・クライアント計算）:

- 信念なのに源流エッジが少ない（形成史が空白）
- サイズが大きいのに他クラスタとつながっていない
- 語彙上は近いのに糸が無い星のペア（編集会議が候補を事前計算）

穴をタップ → **「この闇に何がありそうか、一緒に考える」** → Sonnetに現在地・経路・周辺構造を渡し、仮説を生成:

> 「b6『音や響きが大事』の源流は幼少期とギターの2本だけです。あなたはここに、まだ語っていない“声”や“場の響き”の経験を求めていませんか？——例えばファシリテーター として12年間、部屋の空気の変化を聴き続けた経験は、ここにつながりませんか？」

- 仮説に手応えがあれば **`status='hypothetical'` のゴースト星**（輪郭だけの暗い星）としてその場に生成し、確かめるための質問を質問キューへ（§11）
- ゴースト星は後のインタビューで実体化（confirmed）するか、消える。nodes.statusのcheck制約に `'hypothetical'` を追加

### 13.5 同行者ナレーション（コスト設計）

移動のたびにLLMを呼ぶと高くつき、テンポも壊れる。呼ぶのは明示アクションの時だけ:

- **「🕯 この道のりを読み解く」ボタン**: 現在の経路（星とエッジのdescription列）＋ふりかえりメモをSonnet 5に渡し、3〜5文の内省ナレーションを生成（「あなたは委ねる信念から出発して、鬱の転換点を通り、小学校の抵抗まで遡ってきました。この道筋が示すのは…」）。通常の探索・移動は完全にクライアント内で完結（APIコストゼロ）
- 探検の終わりに経路＋メモを `expeditions` として保存:

```sql
create table expeditions (
  id uuid primary key default gen_random_uuid(),
  universe_id uuid references universes(id) on delete cascade,
  path jsonb not null,        -- [{node_key, edge_id, memo}...]
  narration text,             -- 生成した読み解き
  created_at timestamptz default now()
);
```

探検ログは編集会議・好奇心エンジンの一級の入力になる（**どこを歩いたか自体が、何を気にしているかの表れ**）。

### 13.6 フェーズ配置

- フェーズ2: 潜る・辿る・足あと・ふりかえりメモ・「道のりを読み解く」（13.1〜13.3, 13.5）
- フェーズ3: 闇の穴の構造検出＋仮説ゴースト星（13.4）

## 13. 実装セッションへの指示（このドキュメントの使い方）

新しいClaude Codeチャット（Sonnet 5）で:

> inner-universe/DESIGN.md を読んで、フェーズ1を実装して。プロジェクトは inner-universe/ 配下に作り直してよい（既存のindex.htmlは prototype-v0.html にリネームして残す）。Supabaseのテーブル作成SQLとRenderデプロイ手順もREADMEに書くこと。

実装上の注意（Claude API周り、2026-07時点の正確な仕様）:
- モデルID: `claude-sonnet-5` / `claude-opus-4-8`（日付サフィックスを付けない）
- Sonnet 5に `temperature` / `top_p` / `top_k` / `budget_tokens` を送ると400。thinkingは未指定でadaptiveが走る
- ツールの `strict: true` はツール定義のトップレベル（`tool_choice`ではない）
- 並列tool_useの結果は**1つの**userメッセージにまとめて返す
- `cache_control: {type:"ephemeral"}` はブロック単位。最大4箇所。systemの最終ブロック＋messages末尾に置く
- SDKの型（`Anthropic.MessageParam` 等）を使い、独自interfaceを定義しない
