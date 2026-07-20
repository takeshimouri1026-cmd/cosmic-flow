# Inner Universe — アプリ設計書 v1.6

*2026-07-09 Fable 5設計。実装はSonnet 5のセッションがこのドキュメントを読んで行う。*
*v1.1: 外部情報源コネクタ（§10）と好奇心エンジン（§11）を追加、フェーズ計画を更新。*
*v1.2: 探索モード＝一人称の洞窟探検（§13）を追加。俯瞰（三人称）と探索（一人称）の2モード構成が確定。*
*v1.3 (2026-07-10): 手入れモード（§13）とレンズ（§13.4）を追加しフェーズ2aに設定。探索モードはフェーズ2bへ。§12内の節番号のズレ（13.x→12.x）を修正。*
*v1.4 (2026-07-11): 糸の意味論（§2.1）を追加——「源流」の定義を明文化し、edgesに関係タイプkind（influence/example/resonance）を導入。§3.3・§12・§13.5に反映。**フェーズ2a追補**として2b着手前に実装する。*
*v1.5 (2026-07-19): 質問の泉と対話の航跡（§14）を追加しフェーズ2cの実装仕様とした。`set_pending_question`を`queue_question`に置き換え（§11.1の先行導入）。旧§14（実装セッションへの指示）は§15へ。*
*v1.6 (2026-07-20): ログイン化 第一段階（§15）を追加しフェーズ2.5aの実装仕様とした。開放方針は「まだ本人のみ」と決定——認証基盤だけ先に作り、他ユーザーへの開放（招待制か一般公開かは未決のまま）は2.5bへ分離。旧§15（実装セッションへの指示）は§16へ。*

## 実装状況（2026-07-10 追記）

**フェーズ1（MVP）は実装・動作確認済み。** 詳細は [inner-universe/README.md](README.md) とメモリ `project_inner_universe.md` を参照。以下、設計からの差分・注意点のみ記す。

- 実装場所は本ドキュメントどおり `inner-universe/`（`client/` = React+Vite+Three.js、`server/` = Express+TS、`scripts/seed.ts`）
- **移行元データの構造が設計時から変わっている**: `inner-cosmos/index.html` は他セッションでの継続インタビューにより `GRAPH.nodes`/`GRAPH.edges`（ネスト構造）から、独立した `NODES`/`EDGES` 配列 + 明示的な `inferred` フィールドを持つ形に変化した（cluster key も `modernity`ではなく既に`modern`に統一済み）。`scripts/seed.ts` はこの現行構造をパースするように書かれている。**次に`inner-cosmos/index.html`の構造を変える場合はseed.tsも追従が必要。**
- **このPC特有の注意**: NortonアンチウイルスがTLSを中間検査しNode.jsの`fetch`（Supabase/Anthropic向け）が失敗する（`[[norton-ssl-interception]]`参照）。`server/src/index.ts`と`scripts/seed.ts`の先頭で`win-ca`パッケージを使い回避済み。新しいNode.jsエントリポイントを追加する際は同じ対策を入れること
- Node.js 20.18では`@supabase/supabase-js`のrealtimeクライアントがネイティブWebSocket必須のためエラーになる。`createClient`に`realtime: { transport: WebSocket }`（`ws`パッケージ）を渡して回避済み（realtime機能自体は未使用）
- Supabaseの新APIキー体系（Publishable/Secret key）を使用。`SUPABASE_SERVICE_KEY`には`sb_secret_...`形式のSecret keyを設定する（従来の`service_role`キーと役割は同じ）
- ローカル動作確認は完了（Supabase実データ・Anthropic APIキー設定済み、`npm run seed`→`dev:server`/`dev:client`で疎通確認済み）。ブラウザでの実際のインタビュー体験（星の誕生・確定/削除UI）はユーザー自身の環境での最終確認待ち
- フェーズ2着手時は、`inner-universe/client/src/UniverseScene.tsx`（3Dビューア）・`inner-universe/server/src/interviewEngine.ts`（インタビューSSEループ）が主な拡張ポイントになる（§12探索モード・§13手入れモードはこの2ファイル＋DetailPanel.tsxに機能追加する形になる見込み）
- フェーズ2a（§13手入れモード＋レンズ）・2a追補（§2.1糸の意味論=edges.kind）は実装・実API確認済み（2026-07-11。詳細はメモリ`project_inner_universe.md`）
- **フェーズ2b（§12探索モード、12.1〜12.3・12.5）も実装・実API確認済み（2026-07-11）**。エッジ描画は曲線化済み（`buildEdgeCurve`、inner-cosmos/index.htmlの実装を移植）。§12.4（闇の穴・仮説ゴースト星）はフェーズ3のまま未着手。§10の`inputs`/`connectors`基盤は未着手のため、ふりかえりメモは`expeditions.path`のjsonb内に直接保存する形にした（inputsテーブルへの橋渡しは§10着手時の課題として先送り）
- **フェーズ2c（§14: 質問の泉＋対話の航跡）も実装・実API確認済み（2026-07-19/20、検収基準§14.5の5点すべて確認）**。`pending_question`は本番universeでも`questions`テーブルへ移行済み。実装で発覚した罠: ツール5つ＋array型プロパティ＋全部`strict:true`の組み合わせで実APIが`400 Schema is too complex for compilation`を返す→`queue_question`のみ`strict:false`にしサーバ側で手動検証（`tools.ts`に注意コメントあり。**今後ツールを追加して400が出たらまずこれを疑う**）
- **フェーズ2.5a（§15: ログイン化 第一段階）は実装・実検収済み（2026-07-20、commit fe25fe0）**。検収基準§15.7の5点すべてを実Supabase Authで確認（未ログイン401・オーナーログインでインタビューSSE完走・別ユーザーは他人の宇宙にアクセス不可404・publishable keyのPostgREST直叩きはRLSで0行・`APP_SHARED_SECRET`参照ゼロ）。owner_id設定・サインアップ無効化・全8テーブルRLS有効化（ポリシー0本）はSupabaseダッシュボードで実施済み。**Render本番の環境変数は未反映の可能性が高い**（`APP_SHARED_SECRET`/`VITE_APP_SHARED_SECRET`を削除し`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`を追加して再ビルドが必要。README §3.9参照）。2.5b（他ユーザー開放）設計時はGoogleログイン対応（Cosmic Flow同様のGoogle＋メール/パスワード両対応）の要望あり

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

### 2.1 糸の意味論 — 「源流」の定義と関係タイプ kind（v1.4追加、フェーズ2a追補）

*2026-07-11設計。源流/サブ視覚化で「奥田民生→音や響きが大事」の向きに本人が違和感を持ったことが発端。原因は向きの誤りではなく、「影響した」一種類しかない関係タイプの混線だった。*

**源流の定義（明文化）**: A→B の糸は「**Bを『なんで?』と掘ったとき、Aが答えの一部として現れる**」ことを意味する。時間的な形成順でも影響力の大小でもない。これは客観的な歴史ではなく**今日の本人の語りの構造**であり、自己理解が変われば向きは編み直されてよい（向きやkindの変更履歴自体が、自己理解の変化ログになる）。

edgesに関係タイプ `kind` を追加する（既存DBへはALTER。supabase.sqlに追記すること）:

```sql
alter table edges add column kind text not null default 'influence'
  check (kind in ('influence','example','resonance'));
```

| kind | 向き | 意味 | UI表記（文で見せる） |
|---|---|---|---|
| `influence` | あり | sourceがtargetを**形づくった**。「なんで?」の答えが現れる方向 | 「AがBを形づくった」 |
| `example` | あり（抽象度の軸） | source=具体は target=抽象の**あらわれ・一例・象徴** | 「AはBのあらわれ」 |
| `resonance` | なし | 互いに強め合う。**向きを決めきれない関係の正式な受け皿** | 「AとBは響き合う」 |

原則:

- kindは**構造計算と描画の分岐にだけ**使う。ニュアンスは従来どおりdescriptionが担う。**3種で打ち止め**（タイプが増えるほどインタビュー中のAIと手入れ中の本人に分類コストがかかる）
- **源流/サブ判定（client/src/sourceScore.ts のネット次数=出−入）はinfluenceの糸だけで計算する。** example/resonanceは源流性に一切効かせない（奥田民生の糸をexampleに直せば輪が消えて実感と一致する、が検収基準）
- `example`の向きの規約は**source=具体（あらわれ）→ target=抽象（本体）**。既存の「具体→価値観」のinfluence糸は向きを変えずkindだけ変えれば直せる
- `resonance`は向きに意味がないが、行としてはsource/targetを持つ。unique制約 `(universe_id, source_key, target_key)` はA→BとB→Aを別物と見なすため、**挿入時にサーバで逆向きの既存行もチェック**して重複を防ぐ
- **既存エッジの一括移行はしない**（全部デフォルトのinfluenceのまま）。本人がStarList・詳細パネルで一本ずつ編み直すのが正——どの糸を「あらわれ」に変えたか自体が一級の自己理解ログ。AIによる一括再分類の提案は編集会議（§4）の仕事（「再編みは局所、再構成は編集会議」の原則どおり）

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
    description: "関係の糸を張る（§2.1）。kind=influence:「sourceがtargetを形づくった」（本人の語りが『〜のおかげで/〜から生まれた』）。kind=example:「sourceはtargetのあらわれ・一例・象徴」（source=具体、target=抽象。語りが『〜はその一例/象徴』）。kind=resonance:「互いに響き合う」（向きを決めきれないときは推測で片方に倒さずこれを使う）。本人が語った関係はinferred=false、こちらの構造的な読みはinferred=true（description末尾に「（推定）」）。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        source_key: { type: "string" },
        target_key: { type: "string" },
        kind:       { type: "string", enum: ["influence","example","resonance"], description: "関係タイプ。迷ったらinfluence。向きを決めきれないならresonance" },
        strength:   { type: "number", description: "0〜1" },
        description:{ type: "string" },
        inferred:   { type: "boolean" }
      },
      required: ["source_key","target_key","kind","strength","description","inferred"],
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
        status: { type: ["string","null"], description: "'confirmed' | 'inferred' | null（union型にenumを併記するとAPIが400を返すため、許容値はdescriptionで指示しサーバ側で検証する）" }
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
- **出典リンク（ユーザー要望 2026-07-10）**: `nodes` に `url text` カラムを追加し、情報の出所がある星（ブクログの本のページ等）は詳細パネルにリンクを表示する。将来のコネクタ由来ノード（§10）も同じカラムを使う

## 6. 移行（最初の実装タスクの一部）

1. `inner-cosmos/index.html`（ver.0.8）の `CLUSTERS` / `NODES` / `EDGES` をパースしてSupabaseにseed投入するスクリプト（`scripts/seed.ts`）を書く。source='seed'、既存の `inferred` フラグは status/inferred にマップ
2. `GROWING.md` のプロトコル＋メモリのインタビュー履歴（第1〜6回。要点はGROWING.md末尾）をシステムプロンプト素材として移植
3. 3D描画は `inner-cosmos/index.html` の実装（force layout・グロー・ラベル・選択ハイライト）をReactコンポーネントに移植。**見た目はすでに検証済みなので新規発明しない**
4. 移行完了後も `inner-cosmos/` は触らずアーカイブとして残す（アプリが安定するまでのバックアップ）

## 7. フェーズ計画

| フェーズ | 内容 | 完了条件 |
|---|---|---|
| **1 (MVP)** ✅実装済み | seed移行、3Dビューア、インタビューSSE＋星誕生アニメ、確定/削除UI、Render+Supabaseデプロイ | スマホのブラウザでインタビューに答えると星が生まれ、翌日も残っている（**ローカル動作確認済み。Renderへの実デプロイは未実施**） |
| **2a** ✅実装済み | **手入れモード（§13: 星の言葉の書き換え・糸の切り張り・星を植える・AIの局所再編み）＋レンズ（§13.4）＋2a追補（§2.1糸の意味論）** | 星の言葉を直し糸を切り張りすると宇宙が応答し、提案が点滅で届く |
| **2b** ✅実装済み | **探索モード（§12: 潜る・辿る・足あと・ふりかえりメモ・道のりを読み解く）** | ある星に潜り、糸を辿って源流まで歩き、メモが残せる |
| **2c** ✅実装済み | **質問の泉＋対話の航跡（§14: 質問キュー=§11の土台、transcript閲覧）** | 泉に溜まった質問から選んで答えられ、これまでの語りを読み返せる |
| **2.5a** | **ログイン化 第一段階（§15: Supabase Auth・所有権チェック・RLS有効化。開放はしない）** | 共有シークレットが撤去され、ログインした本人だけが自分の宇宙に触れる |
| **2d** | ブクログ取り込み（出典URL付き、§5）、編集会議（§4） | 本棚から星の候補が届き、月次の読み直しが読める |
| **2.5b** | **ログイン化 第二段階（開放: 招待制か一般公開かの判断・濫用対策・オンボーディング・複数宇宙）** | 新規ユーザーがサインアップし、ゼロから自分の宇宙を育て始められる |
| **3** | コネクタ基盤（§10）＋easy系情報源（Googleカレンダー→Spotify/YouTube）、闇の穴＋仮説ゴースト星（§12.4） | 設定画面でON/OFFでき、探索中に「求めているドット」の仮説に出会える |
| **4** | 好奇心エンジン本格稼働（§11）、Garmin・SNS等の難コネクタ、共有リンク | |

**フェーズ2.5について（2026-07-19決定、2026-07-20更新）**: 「開発者本人が唯一のユーザー」前提をやめる改修を、フェーズ4から前倒しして2c実装完了後に行う（急ぎではない）。2026-07-20の相談で開放方針は「**まだ本人のみ**」と決定し、2.5を二段階に分割: **2.5a**=認証基盤（§15。ログイン・所有権・RLS。サインアップは閉じたまま）／**2.5b**=開放（招待制か一般公開かの判断は**未決のまま持ち越し**。インタビューはオーナーのAnthropicキーで課金されるため回数制限などの濫用対策もここ。オンボーディングとUI再設計——2b実機確認時のユーザー所感「他ユーザーには相当難しい」が前提条件——もここ）。ゼロスタートの中核（空の宇宙でのインタビュー）は検証済み。

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

→ **フェーズ2cの実装仕様は§14（質問の泉と対話の航跡）**。この節の`questions`テーブル定義がそのまま正。

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

## 12. 探索モード — 一人称の洞窟探検（フェーズ2b）

現行の3Dは「自分の知性を外から眺める標本」（三人称・俯瞰）。ここに**一人称モード**を足す。ある星に潜り込み、因果の糸を洞窟の通路のように辿り、「この経験があったからこれが生まれていたのか」というメタ認知のふりかえりを、**歩く体験として**行う。

### 12.1 2つのモード

| | 俯瞰モード（既存） | 探索モード（新規） |
|---|---|---|
| 視点 | 宇宙の外から全体を見る | 星の内側に立ち、隣の星への通路だけが見える |
| 問い | 「私はどういう構造か」 | 「なぜ私はこれを大切に思うのか」 |
| カメラ | オービット＋自動漂流 | 星から星へ、糸に沿って移動 |

星の詳細パネルに **「⛏ この星に潜る」** ボタン → 探索モードへ。いつでも「宇宙に浮上」で俯瞰に戻れる。

### 12.2 潜る（チェンバー表現）

- カメラがその星の位置までズームイン。星は目の前の**発光する空間（チェンバー）**になる
- 表示するのは: この星の説明文＋**直接つながる星々だけ**。それぞれが「通路の先の光」として周囲に浮かぶ。他の全ノードはフォグの彼方に沈める（既存のFogExp2を強める＋非隣接ノードのopacityを落とすだけで実現可能）
- 各通路には**エッジのdescriptionを浮かべる**（「抑圧が剥がれた先に開けた宇宙の体感」等）。通路は**3群**に分ける（§2.1のkindに対応）:
  - **⬆ 源流へ**（incoming の influence: この星を形づくったもの）——「なんで?」を掘る方向。**この群に入るのはinfluenceの糸だけ**（例示の糸が混ざると、掘っても答えにならない道ができてしまう）
  - **⬇ 流れの先へ**（outgoing の influence: この星が生んだもの）
  - **✦ あらわれ・響き**（example / resonance）——掘る道ではなく**横に開く窓**。抽象の星から見れば「この価値観が息づいている場所たち」、具体の星から見れば「この星に宿っているもの」
- 「なんで私はこれを?」という問いには源流方向が答えになる、というガイドをUIに薄く出す

### 12.3 辿る（トラバース）

- 通路の先の光をタップ → カメラが**エッジの曲線に沿って移動**（既存の `QuadraticBezierCurve3.getPoint(t)` をカメラパスに流用。パルス演出と同じ数学）→ 次のチェンバーに到着
- **足あと**: 通ってきた経路は明るい糸として残り、画面下にパンくず（b4 ← e9 ← e2 …）。タップでその地点に戻れる
- チェンバーごとに **「✎ ここでのふりかえりメモ」**: 「なるほどそうかも」と思ったことをその場で書ける（音声入力前提の1行メモ）。メモは:
  - `inputs`（kind='reflection'）として保存 → 好奇心エンジンの素材になる
  - そのエッジ上での納得なら「この糸、確かにある」ワンタップで **strength を強化／inferredを確定**（探索そのものがマップを育てる）

### 12.4 闇の穴 — 求めているドットの仮説（フェーズ3〜）

チェンバーには通路のほかに、**まだ照らされていない穴**を表示する。ルールベースで検出できる構造的空白（LLM不要・クライアント計算）:

- 信念なのに源流エッジが少ない（形成史が空白。数えるのはincomingのinfluenceのみ——§2.1）
- サイズが大きいのに他クラスタとつながっていない
- 語彙上は近いのに糸が無い星のペア（編集会議が候補を事前計算）

穴をタップ → **「この闇に何がありそうか、一緒に考える」** → Sonnetに現在地・経路・周辺構造を渡し、仮説を生成:

> 「b6『音や響きが大事』の源流は幼少期とギターの2本だけです。あなたはここに、まだ語っていない“声”や“場の響き”の経験を求めていませんか？——例えばファシリテーター として12年間、部屋の空気の変化を聴き続けた経験は、ここにつながりませんか？」

- 仮説に手応えがあれば **`status='hypothetical'` のゴースト星**（輪郭だけの暗い星）としてその場に生成し、確かめるための質問を質問キューへ（§11）
- ゴースト星は後のインタビューで実体化（confirmed）するか、消える。nodes.statusのcheck制約に `'hypothetical'` を追加

### 12.5 同行者ナレーション（コスト設計）

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

### 12.6 フェーズ配置

- フェーズ2b: 潜る・辿る・足あと・ふりかえりメモ・「道のりを読み解く」（12.1〜12.3, 12.5）
- フェーズ3: 闇の穴の構造検出＋仮説ゴースト星（12.4）

## 13. 手入れモード — 宇宙に手を入れる（フェーズ2a）

*2026-07-10 ユーザー発案（星の言葉の書き換え／糸の切り張り・星の追加とAIの再編み／クラスタ別表示）をFable 5が統合設計。*

インタビュー（語る）に加えて、宇宙への**直接の手入れ**を可能にする。ただしこのアプリでは手入れはデータ編集（CRUD）ではなく**対話の一形態**である。「眺める宇宙」から「手を入れる庭」へ。すべての操作は既存のインタビューエンジンの川を流れ、宇宙（AI）が応答する。

### 13.1 三つの原則

1. **言葉の主権はユーザーにある**: ユーザーが書き換えた label/description は `user_edited=true` になり、以後AIは `update_node` で上書きできない（サーバ側で拒否し、is_errorのtool_resultで「変えたいなら本人に提案せよ」と伝える）。AIはチャットで提案はできるが、直すのは常に本人
2. **手入れも対話である**: 操作は即時にDBへ反映され画面に出る（待たせない）。その後、同じ操作が `<user_action>` としてインタビューエンジンに流れ、AIが**近傍構造（隣接±1ホップ）だけ**を読み直して応答する。**AIの応答提案（新しい糸・意味の変化の指摘）はすべて inferred（点滅）として届き、ユーザーが確定する** — ユーザーの手は主権的、宇宙の応答は提案。インタビューと完全に対称のhuman-in-the-loop
3. **再編みは局所、再構成は編集会議**: 操作のたびの応答は軽い1ターン（Sonnet、プロンプトキャッシュ有効）。宇宙全体の読み直し・クラスタ再編は月次の編集会議（Opus、§4）の仕事。**日々の手入れと季節の剪定を分ける**

### 13.2 できる操作

| 操作 | UI | 即時反映 | AIの応答（例） |
|---|---|---|---|
| 星の言葉を直す | 詳細パネルの ✎（**全ノード対象**に拡大） | `PATCH /api/nodes/:id`（label/description、user_edited=true） | 意味が変わったなら周辺の糸のdescription更新・強さの見立て直し・新しい糸の提案 |
| 糸を切る | 詳細パネルの「つながり」一覧の ✂ | `DELETE /api/edges/:id` | 切った理由を一言聞く。孤立した側への別の糸の候補を提案 |
| 糸を張る | 「＋この星から糸を張る」→ 相手の星をタップ → 一言 | `POST /api/edges`（説明はユーザーの一言） | descriptionの清書提案、strengthの見立て、「向きは逆では？」の指摘 |
| 星を植える | 「＋隣に星を植える」→ 名前と一言 | interview経由（クラスタ・サイズ・説明の肉付けはAIがadd_nodeで） | 実体化＋源流/流れの先の糸の提案 |

- confirmedの星の削除は今回スコープ外（推定の星の ✕ は既存のまま）。**「消す」より「暗くする」**（過去の自分の地層として残す考古学）をフェーズ3で検討する
- 「つながり」一覧UI（⬆源流 / ⬇流れの先 のグループ表示、各行にエッジのdescription）は、**探索モード（§12）のチェンバーDOMシートの原型**としてコンポーネント設計する

### 13.3 実装の要点

- 新ツール `remove_edge`（source_key, target_key, reason。strict、union型+enum併記禁止に注意）— AI自身も再編み時に糸を整理できる。SSE `{type:"edge_removed", edge_id}` を追加し、3D側は糸のフェードアウト演出
- `nodes` に `user_edited boolean not null default false` を追加（ALTER文をsupabase.sqlに追記し、READMEにも実行手順を記載）
- 再編みは `POST /api/universe/:id/interview` を流用: `{text}` の代わりに `{action: {kind: "edit_node"|"cut_edge"|"tie_edge"|"plant_node", ...}}` を受けたら `<user_action>` ブロック（何をどう変えたか、before/after）に整形して同じループへ。messagesにもそのまま残る（=**手入れの履歴そのものが自己理解の変化ログ**になり、編集会議・好奇心エンジンの一級の入力になる）
- systemプロンプトに手入れ応答の方針を追記: 近傍だけ読む／提案はinferred／応答は1〜3文で簡潔に／user_editedの言葉を尊重
- 同時実行は既存のinterviewロックで足りる。ユーザー操作の即時反映APIと再編みの間に他操作が入っても、AIは常に最新のグラフダイジェストを見るので破綻しない

### 13.4 レンズ（クラスタ別表示）

- HUDの凡例（5クラスタ）を**トグルボタン化**。タップでそのクラスタの星だけを浮かび上がらせ、他は選択フォーカスと同じ要領で沈める（opacity操作のみ）。複数選択可・再タップで解除
- 同じ仕組みで**「推定」レンズ**（status=inferredの星だけ）も追加 — 「確認待ちの提案がどこに溜まっているか」が一目で見える
- 完全クライアント内（APIコストゼロ）。**視点を変えることは問いを変えること** — レンズは俯瞰モードにおける問いの切り替えであり、将来「最近生まれた星」「本から来た星」「よく訪れる星」等に同じUIで拡張する

### 13.5 糸の意味論への対応（フェーズ2a追補、v1.4追加）

*フェーズ2a実装後・2b着手前に行う。前提は§2.1（源流の定義・kind 3種・原則）。§12.2の通路3群構成はこの追補が土台になる。*

**DB**: §2.1のALTER文を `supabase.sql` に追記し、READMEに実行手順を記載（`user_edited` 追加時と同じ手順）。

**サーバ**:

- `add_edge` ツールに `kind` を追加（§3.3更新済み。単純な `type:"string"` + `enum` なのでunion+enum併記の罠には**当たらない**）
- `POST /api/edges`（手入れの糸張り）のbodyに `kind` を追加。`kind='resonance'` のときは逆向き `(target,source)` の既存行をチェックして重複を拒否
- `PATCH /api/edges/:id` を新設: `kind` の変更と向きの反転（source/target入れ替え）。**LLMには流さない直接更新**（StarListの⇄と同じ「まとめてレビュー」用途。現行の⇄の即時反映と同じ扱い）
- systemPromptにkindの判定基準を追記: 語りが「〜のおかげで/〜から生まれた」→influence、「〜はその一例/象徴」→example、**向きを決めきれないときは推測で片方に倒さずresonance**。手入れ応答で既存の糸のkind変更を勧めたいときは、直接変えずチャットで提案する（言葉の主権と同じ扱い）
- グラフダイジェスト・`<user_action>` ブロックにkindを含める（AIが関係の種類を読めるように）

**クライアント**:

- `sourceScore.ts`: ネット次数（出−入）の計算対象を **kind='influence' のエッジのみ**に限定（§2.1）。example/resonanceは輪・色の濃さに影響しない
- `TiePicker`（糸を張る）: 関係を**文で**選ぶUIを追加——「AがBを形づくった / AはBのあらわれ / AとBは響き合う」（デフォルト=influence）
- `StarList` の⇄ボタンを「関係を編む」小UIに拡張: 向きの反転＋kindの変更（従来どおり即時反映のみ、AIには流さない）。詳細パネルの「つながり」一覧にも同じ操作を置く
- つながり一覧のグループを3群に: **⬆源流（influence in）/ ⬇流れの先（influence out）/ ✦あらわれ・響き（example/resonance）**——§12.2チェンバーDOMシートの原型として
- 3D描画: influence=現行どおり、example=細く・淡く、resonance=向きの表現なし。**控えめに**（3Dは光と雰囲気に徹する方針どおり。凝った矢印などは足さない）

**移行**: 既存エッジは全てデフォルトの `influence` のまま。一括再分類はしない（§2.1の原則）。

## 14. 質問の泉と対話の航跡 — 質問キューとtranscript閲覧（フェーズ2c）

*v1.5追加。§11.1（質問キュー）の先行導入と、messagesログの閲覧UI。好奇心エンジン（§11.2観測バッチ）はフェーズ4のままだが、質問が貯まり・選ばれ・答えられる「泉」の器をここで作る。*

インタビューの締めの質問はこれまで「1つだけ保存して次回に出す」使い捨てだった（`universes.pending_question`）。これを**泉**に変える: AIが聞きたいことは複数貯まり、ユーザーは提示された質問に答えてもいいし、泉から別の質問を選んで答えてもいい。**質問は宝物なので捨てずに貯める**（§11.1）。あわせて、これまでの語り全体を読み返せる**航跡**（transcript閲覧）を作る。

### 14.1 原則

1. **質問は宝物**: 削除しない。いらない質問は `dismissed`（暗くする）にするだけで、泉の底に残り復活できる。「消す」より「暗くする」（§13.2の考古学と同じ思想）
2. **提示は一つずつ、泉は複数**: システムプロンプト原則1（質問は必ず一つずつ）は変えない。変わるのは裏側だけ——締めに使わなかった「いつか聞きたいこと」も泉に貯められるようになる
3. **選ぶ主権はユーザー**: AIは次の質問を提示するが、どの質問に答えるかは本人が決める。泉から選ばれた質問には、AIはその文脈を汲んで応対する（言葉の主権・手の主権に続く、**問いを選ぶ主権**）
4. **航跡は読み物**: 生ログ（グラフダイジェスト・tool_useのJSON・tool_result）は見せない。本人の語り・AIの応答・宇宙に起きたこと（星の誕生・糸・手入れ）だけを蒸留して時系列で読ませる。3D演出は足さない

### 14.2 DBと移行

- §11.1の `create table questions` を **そのまま** `supabase.sql` に追記（変更しない。`evidence` には `{"node_keys": [...]}` を入れる）。READMEに実行手順を記載（`user_edited`・`kind` 追加時と同じ手順、実行はユーザーがSupabase SQL Editorで行う）
- **移行SQLを添える**: 既存の `universes.pending_question` が非NULLなら、その内容を `questions` に `status='asked'` で1行insertする（`insert ... select ... where pending_question is not null`）。以後 `pending_question` カラムは**読みも書きもしない**（カラム自体は残す。削除はフェーズ3のスキーマ整理で検討）

### 14.3 サーバ

**ツール置き換え**: `set_pending_question` を削除し、`queue_question` を追加:

```jsonc
{
  "name": "queue_question",
  "description": "聞きたい質問を泉（質問キュー）に登録する。present=trueは今回の応答の締めに提示する質問（応答本文の最後にも同じ質問を書くこと。1ターンに1つだけ）。present=falseは今は聞かないが将来聞きたい質問を貯める。",
  "input_schema": {
    "type": "object",
    "properties": {
      "question": { "type": "string" },
      "rationale": { "type": "string", "description": "なぜ聞きたいか。UIで「AIがこれを聞きたい理由」として本人に見える" },
      "related_keys": { "type": "array", "items": { "type": "string" }, "description": "根拠となる星のkey。無ければ空配列" },
      "present": { "type": "boolean" }
    },
    "required": ["question", "rationale", "related_keys", "present"],
    "additionalProperties": false
  }
}
```

（strict: true。単純型のみでunion+enum併記の罠には当たらない）

- **present=trueの実行**: 既存の `status='asked'` 行をすべて `'open'` に戻してから、新しい行を `'asked'` でinsertする。「提示は常に1つ」をサーバが保証し、答えられなかった質問は自動的に泉へ還る（後勝ち。1ターンに複数present=trueが来ても壊れない）
- **present=falseの実行**: `status='open'` でinsertするだけ
- **グラフダイジェスト**（`buildGraphDigest`）: `pending_question:` 行を置き換え、`asked: <提示中の質問>` と `--- 泉（open questions, 新しい順・最大10件） ---` の一覧を含める。AIはこれを見て**重複質問を登録しない**・泉の中の質問を会話の流れで自然に持ち出せる
- **インタビューターン拡張**: `POST /api/universe/:id/interview` のbodyに任意の `question_id` を追加。あればサーバはその質問を読み、`<answering_question>質問文</answering_question>` ブロックをturnBodyの前に付けてAIに文脈を渡し、**ターンが正常完了したら**その行を `status='answered'` に更新する（失敗時は据え置き）
- **REST**:
  - `GET /api/universe/:id/questions` → `status in ('open','asked')` を新しい順で返す。`?all=1` で answered/dismissed も返す（泉の底）
  - `PATCH /api/questions/:id` → `status` の変更のみ（`dismissed` にする / `open` に復活）。LLMには流さない直接更新（StarListの⇄と同じ扱い）
- **systemPrompt更新**: 原則7を書き換え——「応答の最後は必ず次の質問で締める。queue_question(present=true)で同じ質問を保存すること」。追記——「会話の中で『今は聞かないが、いつか聞きたい』が湧いたらpresent=falseで泉に貯めてよい（1ターン最大2つまで。乱発しない）。ダイジェストの泉一覧にある質問と重複するものは登録しない。`<answering_question>`ブロックが付いたターンは、本人が泉からその質問を選んで答えに来たということ。その質問の文脈（rationale相当の意図）を汲んで受け止めること」。手入れモード方針6の `set_pending_question` 言及も `queue_question(present=true)` に読み替えて更新（手入れ応答では無理に使わない、は従来どおり）
- **transcript API**: `GET /api/universe/:id/transcript?before=<created_at>&limit=100` → messagesを新しい順にページング返却。**蒸留はサーバでやる**（生contentをクライアントに送らない。表示ロジックの一元化と、フェーズ3マルチユーザー時の情報最小化のため）。各messageを表示アイテム配列に変換:
  - user・string content: `<graph_digest>...</graph_digest>` を除去。`<user_action>...</user_action>` → `{type:"action", summary}`（操作の種類と対象を1行に）。`<answering_question>...</answering_question>` → `{type:"picked_question", question}`。残りの本文 → `{type:"user_text", text}`
  - user・array content（tool_result）: **スキップ**（アイテムなし）
  - assistant: textブロック → `{type:"ai_text", text}`。tool_use → チップ: `add_node`→`{type:"star_born", label}`、`add_edge`→`{type:"thread_tied", source_key, target_key}`、`update_node`→`{type:"star_updated", key}`、`remove_edge`→`{type:"thread_cut"}`、`queue_question`→`{type:"question_queued", present}`
  - 各アイテムに `created_at` を付与（日付見出し用）。空になったmessage（tool_resultのみ等）は返さない

### 14.4 クライアント

- **SSEイベント変更**: `{type:"pending_question"}` → `{type:"question_queued", question, present}`。present=trueなら提示中質問（activeQuestion）を差し替え、present=falseなら泉バッジを+1して控えめに知らせる（「泉に問いがひとつ落ちた」程度の軽い表示。派手な演出は足さない）
- **`QuestionSpring.tsx`（泉シート）**: ヘッダーに「泉」ボタン＋open件数バッジ（StarList/ClusterManagerと同じ様式のDOMシート）。各行: 質問文／「AIがこれを聞きたい理由」（rationale、折りたたみ）／related_keysの星チップ。行の操作:
  - **「これに答えたい」** → シートを閉じ、InterviewPanelを開き、その質問をassistant行として表示。次の送信に `question_id` を添付
  - **「暗くする」**（dismissed）→ 一覧から消え、シート下部の「泉の底」（折りたたみ）へ。そこから「泉に戻す」で復活（PATCHのみ、AIには流れない）
- **InterviewPanel**: `pendingQuestion` プロップを `activeQuestion`（提示中 'asked' の質問、または泉から選んだ質問）に置き換え。空状態の文言はactiveQuestionがあればそれを出す（現行と同じ挙動の一般化）
- **`TranscriptView.tsx`（航跡）**: ヘッダーに「航跡」ボタン → 全画面シート。新しい順に表示し、上へスクロールで過去を追加読み込み（`before` パラメータ）。日付見出し、user/AIの吹き出し、チップ（⭐星が生まれた「label」／🧵糸／✂糸を切った／🛠手入れ／💧泉から選んだ問い）。検索・フィルタはフェーズ3送り（現状は唯一のユーザー＝開発者本人が読み返せれば十分）

### 14.5 検収基準（実API・使い捨てテスト宇宙で確認し、終わったら消す）

1. インタビュー1ターン完走 → 締めの質問が `questions` に `status='asked'` で入り、次ターンのダイジェストに `asked:` として載る。前の 'asked' は 'open' に還っている
2. AIが present=false で貯めた質問が泉シートに理由付きで表示され、バッジ件数が合う
3. 泉から質問を選んで答える → ターン完了後に `status='answered'` になり、AIの応答が `<answering_question>` の文脈を踏まえている
4. 移行SQLで既存 `universes.pending_question` が 'asked' 行として泉に入る
5. 航跡にグラフダイジェスト・tool_useの生JSONが**見えない**こと。星の誕生チップ・手入れチップが正しい位置に出ること。`before` ページングで過去に遡れること

## 15. ログイン化 第一段階 — 認証基盤（フェーズ2.5a）

*2026-07-20 Fable 5設計（v1.6）。開放方針の相談で「まだ本人のみ」と決定。本章は認証基盤（ログイン＋データ隔離）だけを扱い、他ユーザーへの開放は§7のフェーズ2.5bへ分離した。*

### 15.1 スコープ

**やること**: `APP_SHARED_SECRET`による共有シークレット認証を、Supabase Authによる本物のログインに置き換える。`universes.owner_id`（§2で最初から用意してある列）に基づく所有権チェックを全APIに入れ、全テーブルのRLSを有効化する。

**やらないこと（2.5bへ送る）**: サインアップの開放、招待制か一般公開かの判断（未決のまま）、回数制限などの濫用対策、オンボーディング・チュートリアル、複数宇宙、「新しい宇宙を作る」UI。宇宙を持たないユーザーがログインした場合は「宇宙がまだありません」と表示するだけでよい。

**触らないもの**: インタビューエンジン・ツール定義・システムプロンプトには一切手を入れない（2cで発覚した「schema too complex」の罠を踏むリスクをゼロにする）。3D描画・各パネルUIも変更しない。

### 15.2 認証方式 — メール＋パスワード、サインアップは閉じる

- **Supabase Authのメール＋パスワード方式**を使う。マジックリンク（passwordless）にしない理由: Supabase組み込みSMTPの送信制限（1時間あたり数通）が実運用に耐えず、カスタムSMTPを立てるのは2.5aのスコープに対して過剰。パスワード方式ならメール送信ゼロで完結する
- supabase-jsがセッションをlocalStorageに保持し自動リフレッシュするため、ログイン操作自体が発生するのは稀（スマホでも一度ログインすれば維持される）
- **オーナーアカウントはSupabaseダッシュボードから手動作成**し、Authentication設定の「Allow new users to sign up」を**オフ**にする。登録経路そのものが閉じるので、2.5aでは濫用対策が不要になる（これがスコープを小さく保てる理由）
- クライアントに`@supabase/supabase-js`を追加し、`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`（`sb_publishable_...`形式）を環境変数にする。**auth機能だけを使い、クライアントから直接DBを読み書きしない**（データアクセスは従来どおり全部Express経由）。ブラウザにはネイティブWebSocketがあるので、サーバ側で必要だった`ws`パッケージの回避策はクライアントには不要

### 15.3 RLS有効化は必須（セキュリティ上の要点）

クライアントにpublishable keyを置いた瞬間、**RLSが無効のままだとPostgREST経由で全テーブルが誰でも読み書きできてしまう**（現行の「RLS無効でよい」は、クライアントがSupabaseに直接触らない前提だったから成り立っていた）。よって2.5aで全テーブル（universes/clusters/nodes/edges/messages/reports/expeditions/questions）のRLSを有効化する。**ポリシーは1本も作らない**（=anon/authenticatedからのPostgRESTアクセスは全拒否）。サーバはservice key（`sb_secret_...`）なのでRLSを素通りし、既存のDBアクセスコードは一切変更不要。`supabase.sql`に`alter table ... enable row level security;`を追記する。

### 15.4 サーバ

- `auth.ts`の`requireAppSecret`を`requireUser`に置き換える: `Authorization: Bearer <access_token>`を`supabase.auth.getUser(token)`で検証し、`req`にuserIdを載せる。無効・欠落は401
- 毎リクエストのAuth API往復を避けるため、token→{userId, 有効期限}のインメモリキャッシュ（TTL60秒程度）を入れてよい（任意。まず素朴に実装し、体感が遅ければ足す）
- **所有権チェック**: `/api/default-universe`は`owner_id = userId`でフィルタする（ルート名は変えない。変更を最小に）。`/api/universe/:id/*`は対象universeの`owner_id`を確認。`/api/nodes/:id`・`/api/edges/:id`・`/api/questions/:id`のようにエンティティIDで直接触るルートは、対象行の`universe_id`を引いてからowner確認する共通ヘルパー（`assertUniverseOwner(userId, universeId)`）を通す。**例外なく全ルートに適用**（漏れが1本あれば隔離は破れる）
- 「`APP_SHARED_SECRET`未設定なら素通し」のローカル開発モードは**廃止**する。ローカルも本番と同じSupabaseプロジェクトを使う運用（既定路線）なので、ローカルでも同じアカウントでログインすればよい。認証を素通しする環境変数は作らない
- `APP_SHARED_SECRET`関連のコード・環境変数（`VITE_APP_SHARED_SECRET`含む）は完全に撤去する

### 15.5 クライアント

- `AuthGate`コンポーネントでアプリ全体を包む: セッションが無ければログイン画面（メール＋パスワード入力とエラー表示だけの最小構成。見た目は宇宙の雰囲気に合わせた暗色でよいが、凝らない）、あればこれまでどおりのApp
- `api.ts`の`headers()`を差し替える: `supabase.auth.getSession()`のaccess_tokenを`Authorization: Bearer`ヘッダに載せる（SSEもfetchベースなので同じヘルパーで済む）。APIが401を返したらセッション切れとしてログイン画面に戻す
- ログアウトボタンを目立たない場所（設定系ボタンの並び）に1つ
- オーナー以外のユーザー（宇宙を持たない）でログインした場合は「あなたの宇宙はまだありません」の表示だけ（ゼロスタートUIは2.5b）

### 15.6 移行手順（ユーザーがダッシュボード/SQL Editorで行う。READMEに書くこと）

1. Supabaseダッシュボード → Authentication → オーナーアカウントを作成（メール＋パスワード）
2. Authentication設定で「Allow new users to sign up」をオフ
3. SQL Editorで `update universes set owner_id = '<オーナーのauth uid>';`（唯一のuniverseに紐付け）
4. RLS有効化SQL（supabase.sqlに追記されたもの）を実行
5. Render環境変数: `APP_SHARED_SECRET`/`VITE_APP_SHARED_SECRET`を削除、`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`を追加（Viteの環境変数はビルド時埋め込みなので再ビルドが要る）。ローカルの`server/.env`・`client/.env.local`も同様に更新

### 15.7 検収基準（実Supabase Authで確認。テストユーザーは終わったら削除）

1. 未ログインで`/api/default-universe`等を叩くと401（`/api/health`は認証なしで200のまま）
2. オーナーでログイン → 自分の宇宙が表示され、インタビュー1ターンが実APIで完走する（認証差し替えでSSEが壊れていないことの確認）
3. 使い捨てテストユーザー（ダッシュボードで作成）でログイン → オーナーの宇宙が見えず、「宇宙がまだありません」表示になる。テストユーザーのtokenでオーナーのuniverse IDを直接指定してAPIを叩いても403/404
4. publishable keyでPostgRESTを直接叩いても（`curl`で`/rest/v1/nodes`等）RLSにより1行も読めない
5. リポジトリから`APP_SHARED_SECRET`への参照が消えている（grepで0件）

## 16. 実装セッションへの指示（このドキュメントの使い方）

新しいClaude Codeチャット（Sonnet 5）で:

> inner-universe/DESIGN.md を読んで、フェーズ1を実装して。プロジェクトは inner-universe/ 配下に作り直してよい（既存のindex.htmlは prototype-v0.html にリネームして残す）。Supabaseのテーブル作成SQLとRenderデプロイ手順もREADMEに書くこと。

フェーズ2a（手入れモード＋レンズ）の指示例:

> inner-universe/DESIGN.md の冒頭「実装状況」と §13（手入れモード）を読んで、フェーズ2aを実装して。DB変更は supabase.sql にALTER文を追記し、READMEに実行手順を書くこと。動作確認は実API（Anthropic/Supabase）で「星の言葉を直す→AIの応答がチャットに届く」「糸を切る→再編み提案が点滅で届く」まで通すこと（モック確認だけで完了としない。使い捨てのテスト宇宙を作って確認し、終わったら消す）。ツール定義でunion型にenumを併記しないこと（§3.3の注意書き参照）。

フェーズ2a追補（糸の意味論）の指示例:

> inner-universe/DESIGN.md の冒頭「実装状況」と §2.1（糸の意味論）・§13.5（フェーズ2a追補）を読んで、糸の関係タイプ kind（influence/example/resonance）を実装して。§3.3の add_edge ツール定義は更新済みなのでコードを同期すること。DB変更（edges.kind）は supabase.sql にALTER文を追記し、READMEに実行手順を書くこと（実行はユーザーがSupabase SQL Editorで行う）。動作確認は実API（Anthropic/Supabase）で、使い捨てのテスト宇宙を作って (1)TiePickerで「あらわれ」を選んで糸を張る→AIの応答がチャットに届く、(2)influenceの糸を1本exampleに変える→張り元の星の輪（源流表示）が消える、の両方を通すこと（終わったらテスト宇宙は消す）。既存エッジの一括再分類はしないこと（§2.1）。

フェーズ2c（質問の泉＋対話の航跡）の指示例:

> inner-universe/DESIGN.md の冒頭「実装状況」と §11.1（質問キュー）・§14（質問の泉と対話の航跡）を読んで、フェーズ2cを実装して。DB変更（questionsテーブル新設＋pending_question移行SQL）は supabase.sql に追記し、READMEに実行手順を書くこと（実行はユーザーがSupabase SQL Editorで行う）。set_pending_question ツールは削除し queue_question に置き換えること（§14.3の定義どおり。strict、union型にenumを併記しない）。transcriptの蒸留はサーバ側で行い、生content（グラフダイジェスト・tool_use JSON・tool_result）をクライアントに送らないこと。動作確認は実API（Anthropic/Supabase）で使い捨てのテスト宇宙を作り、§14.5の検収基準5点をすべて通すこと（終わったらテスト宇宙は消す）。このPCでのブラウザ確認は本番ビルド（npm run build && npm start）で行った方が安定する（Vite dev serverのHMR切断問題）。

フェーズ2.5a（ログイン化 第一段階）の指示例:

> inner-universe/DESIGN.md の冒頭「実装状況」と §15（ログイン化 第一段階）を読んで、フェーズ2.5aを実装して。インタビューエンジン・ツール定義には一切触れないこと（§15.1）。DB変更（RLS有効化）とowner_id設定SQLは supabase.sql に追記し、READMEに§15.6の移行手順を書くこと（ダッシュボード操作とSQL実行はユーザーが行う）。APP_SHARED_SECRET関連のコード・環境変数は完全に撤去すること。動作確認は実Supabase Authで§15.7の検収基準5点をすべて通すこと（使い捨てテストユーザーは終わったら削除。オーナーアカウントの作成とサインアップ無効化はユーザーに依頼する）。このPCでのブラウザ確認は本番ビルド（npm run build && npm start）で行った方が安定する（Vite dev serverのHMR切断問題）。

実装上の注意（Claude API周り、2026-07時点の正確な仕様）:
- モデルID: `claude-sonnet-5` / `claude-opus-4-8`（日付サフィックスを付けない）
- Sonnet 5に `temperature` / `top_p` / `top_k` / `budget_tokens` を送ると400。thinkingは未指定でadaptiveが走る
- ツールの `strict: true` はツール定義のトップレベル（`tool_choice`ではない）
- 並列tool_useの結果は**1つの**userメッセージにまとめて返す
- `cache_control: {type:"ephemeral"}` はブロック単位。最大4箇所。systemの最終ブロック＋messages末尾に置く
- SDKの型（`Anthropic.MessageParam` 等）を使い、独自interfaceを定義しない
