import "dotenv/config";

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

import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { requireAppSecret } from "./auth.js";
import { supabase } from "./db.js";
import { edgeRouter, nodeRouter, universeRouter } from "./routes/universe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// フェーズ1はシングルユーザー前提。最初に作られた universe を「自分の宇宙」として返す
app.get("/api/default-universe", requireAppSecret, async (_req, res) => {
  const { data, error } = await supabase
    .from("universes")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "universe がまだありません。scripts/seed.ts を実行してください" });
    return;
  }
  res.json({ universe: data });
});

app.use("/api/universe", requireAppSecret, universeRouter);
app.use("/api/nodes", requireAppSecret, nodeRouter);
app.use("/api/edges", requireAppSecret, edgeRouter);

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`inner-universe server listening on :${port}`);
});
