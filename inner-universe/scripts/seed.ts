// inner-cosmos/index.html の埋め込みデータ（CLUSTERS/NODES/EDGES）を
// Supabase の universes/clusters/nodes/edges に投入する。既存の universe があれば再利用する。
//
// 実行: cd server && npm run seed
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// このPCはNortonがTLSを独自証明書で中間検査するため、
// Windows証明書ストアのルートCAをNodeのTLS全体に注入する（Linuxでは何もしない）
if (process.platform === "win32") {
  try {
    const { default: winCa } = await import("win-ca");
    winCa.inject("+");
  } catch (err) {
    console.warn("win-ca の読み込みに失敗（続行します）:", err instanceof Error ? err.message : err);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY が設定されていません（server/.env を確認）");
}
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket as never },
});

interface SeedNode {
  id: string;
  label: string;
  type: string;
  cluster: string;
  size: number;
  description: string;
}
interface SeedEdge {
  source: string;
  target: string;
  strength: number;
  description: string;
  inferred?: boolean;
}
interface SeedCluster {
  label: string;
  css: string;
}

function loadInnerCosmosData(): {
  clusters: Record<string, SeedCluster>;
  nodes: SeedNode[];
  edges: SeedEdge[];
} {
  const filePath = path.resolve(__dirname, "../../inner-cosmos/index.html");
  const html = fs.readFileSync(filePath, "utf-8");

  const extractLiteral = (varDecl: string, openChar: string, closeChar: string): string => {
    const start = html.indexOf(varDecl);
    if (start === -1) throw new Error(`${varDecl} が見つかりません`);
    const braceStart = html.indexOf(openChar, start);
    let depth = 0;
    for (let i = braceStart; i < html.length; i++) {
      if (html[i] === openChar) depth++;
      else if (html[i] === closeChar) {
        depth--;
        if (depth === 0) return html.slice(braceStart, i + 1);
      }
    }
    throw new Error(`${varDecl} の閉じ括弧が見つかりません`);
  };

  const clustersSrc = extractLiteral("const CLUSTERS = ", "{", "}");
  const nodesSrc = extractLiteral("const NODES = ", "[", "]");
  const edgesSrc = extractLiteral("const EDGES = ", "[", "]");

  // 埋め込みJSライクなオブジェクト/配列リテラルを評価する（信頼済みローカルファイルのみを対象とする一回限りの移行スクリプト）
  const clusters = new Function(`return ${clustersSrc};`)();
  const nodes = new Function(`return ${nodesSrc};`)();
  const edges = new Function(`return ${edgesSrc};`)();

  return { clusters, nodes, edges };
}

async function main() {
  const { clusters, nodes, edges } = loadInnerCosmosData();
  console.log(
    `読み込み: clusters=${Object.keys(clusters).length} nodes=${nodes.length} edges=${edges.length}`
  );

  let { data: universe } = await supabase
    .from("universes")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!universe) {
    const { data, error } = await supabase
      .from("universes")
      .insert({ title: "内的宇宙", version: "1.0.0" })
      .select()
      .single();
    if (error) throw error;
    universe = data;
    console.log(`universe を新規作成: ${universe!.id}`);
  } else {
    console.log(`既存の universe を再利用: ${universe.id}`);
  }
  const universeId = universe!.id as string;

  for (const [key, c] of Object.entries(clusters) as [string, SeedCluster][]) {
    const { error } = await supabase
      .from("clusters")
      .upsert(
        { universe_id: universeId, key, label: c.label, color: c.css },
        { onConflict: "universe_id,key" }
      );
    if (error) throw error;
  }

  for (const n of nodes) {
    const { error } = await supabase
      .from("nodes")
      .upsert(
        {
          universe_id: universeId,
          key: n.id,
          label: n.label,
          type: n.type,
          cluster: n.cluster,
          size: n.size,
          description: n.description,
          status: "confirmed",
          source: "seed",
        },
        { onConflict: "universe_id,key" }
      );
    if (error) throw error;
  }

  for (const e of edges) {
    const { error } = await supabase
      .from("edges")
      .upsert(
        {
          universe_id: universeId,
          source_key: e.source,
          target_key: e.target,
          strength: e.strength,
          description: e.description,
          inferred: e.inferred ?? false,
          source: "seed",
        },
        { onConflict: "universe_id,source_key,target_key" }
      );
    if (error) throw error;
  }

  console.log(`完了。universe_id = ${universeId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
