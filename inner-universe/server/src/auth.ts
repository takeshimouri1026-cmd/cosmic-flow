import type { NextFunction, Request, Response } from "express";

export function requireAppSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.APP_SHARED_SECRET;
  if (!expected) {
    // 未設定ならローカル開発とみなし素通しする
    next();
    return;
  }
  const provided = req.header("x-app-secret");
  if (provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
