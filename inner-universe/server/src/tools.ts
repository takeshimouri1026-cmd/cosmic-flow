import type Anthropic from "@anthropic-ai/sdk";

export const INTERVIEW_TOOLS: Anthropic.Tool[] = [
  {
    name: "add_node",
    description:
      "ユーザーの回答から新しい星（信念・経験・知識）をマップに追加する。本人が明言した事実は status=confirmed、こちらの解釈・仮説は status=inferred。「人生で一番」「絶大」等の熱量は size に反映（最大10）。",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "一意な短いID。belief=b*, experience=e*, knowledge=k* の連番",
        },
        label: { type: "string" },
        type: { type: "string", enum: ["belief", "experience", "knowledge", "meta"] },
        cluster: { type: "string", enum: ["cosmos", "modern", "earth", "relation", "meta"] },
        size: { type: "integer", description: "1〜10。影響力・熱量" },
        description: { type: "string", description: "タップ時に表示される説明。本人の言葉を活かす" },
        status: { type: "string", enum: ["confirmed", "inferred"] },
      },
      required: ["key", "label", "type", "cluster", "size", "description", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "add_edge",
    description:
      "影響関係の糸を張る。source→target=「sourceがtargetに影響した」。本人が語った関係はinferred=false、こちらの構造的な読みはinferred=true（description末尾に「（推定）」）。",
    input_schema: {
      type: "object",
      properties: {
        source_key: { type: "string" },
        target_key: { type: "string" },
        strength: { type: "number", description: "0〜1" },
        description: { type: "string" },
        inferred: { type: "boolean" },
      },
      required: ["source_key", "target_key", "strength", "description", "inferred"],
      additionalProperties: false,
    },
  },
  {
    name: "update_node",
    description:
      "既存ノードの修正・昇格。推定が本人の回答で裏付けられたら status を confirmed にし description を確定情報に書き換える。誤りが判明したら内容を訂正する。",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        label: { type: ["string", "null"] },
        size: { type: ["integer", "null"] },
        cluster: { type: ["string", "null"] },
        description: { type: ["string", "null"] },
        // 注意: type が union（["string","null"]）のとき enum を併記するとAPIが
        // Invalid schema で400を返す。許容値はdescriptionで指示しサーバ側で検証する
        status: {
          type: ["string", "null"],
          description: "変更する場合は 'confirmed' か 'inferred'。変更しないなら null",
        },
      },
      required: ["key", "label", "size", "cluster", "description", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "set_pending_question",
    description: "次のインタビュー質問を1つだけ保存する（質問は必ず一つずつ）。応答本文の最後にも同じ質問を書くこと。",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
  },
];

// strict: true をトップレベルに付与（型定義に含まれないため as で拡張）
for (const tool of INTERVIEW_TOOLS) {
  (tool as unknown as { strict: boolean }).strict = true;
}
