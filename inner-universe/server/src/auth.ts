import type { NextFunction, Request, Response } from "express";
import { supabase } from "./db.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// token→{userId, 有効期限}の簡易キャッシュ（毎リクエストのAuth API往復を避ける。§15.4）
const CACHE_TTL_MS = 60_000;
const userCache = new Map<string, { userId: string; expires: number }>();

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.header("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const cached = userCache.get(token);
  if (cached && cached.expires > Date.now()) {
    req.userId = cached.userId;
    next();
    return;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  userCache.set(token, { userId: data.user.id, expires: Date.now() + CACHE_TTL_MS });
  req.userId = data.user.id;
  next();
}

export async function assertUniverseOwner(userId: string, universeId: string): Promise<boolean> {
  const { data } = await supabase
    .from("universes")
    .select("id")
    .eq("id", universeId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

// universeRouter用: パスの :id が universe そのもののidであるルート
export function requireUniverseOwner(req: Request, res: Response, next: NextFunction) {
  assertUniverseOwner(req.userId!, req.params.id)
    .then((ok) => {
      if (!ok) {
        res.status(404).json({ error: "not found" });
        return;
      }
      next();
    })
    .catch((err) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
}

// nodeRouter/edgeRouter/questionRouter用: パスの :id はエンティティのid。
// そのエンティティが属するuniverse_idを引いてから所有権を確認する（§15.4）
export function requireEntityUniverseOwner(table: "nodes" | "edges" | "questions") {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const { data, error } = await supabase.from(table).select("universe_id").eq("id", req.params.id).maybeSingle();
      if (error || !data) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const ok = await assertUniverseOwner(req.userId!, data.universe_id as string);
      if (!ok) {
        res.status(404).json({ error: "not found" });
        return;
      }
      next();
    })().catch((err: unknown) => {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
  };
}
