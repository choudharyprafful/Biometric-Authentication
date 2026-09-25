import type { Request } from "express";

// req.ip honours app.ts's "trust proxy" hop count, so only the X-Forwarded-For
// entries added by our own proxies are believed — never the ones a client wrote.
export function getClientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}
