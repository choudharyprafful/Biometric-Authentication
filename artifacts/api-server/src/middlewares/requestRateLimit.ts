import type { NextFunction, Request, Response } from "express";
import { checkAndRecordRequest } from "../lib/rateLimit";
import { logEvent } from "../lib/auditLog";

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

/**
 * General per-user request throttle for costly authenticated routes
 * (uploads, payments, passkey registration) — closes the gap where only
 * login had any rate limiting at all (OWASP API4:2023, Unrestricted
 * Resource Consumption). Keyed by session userId, not IP: every route this
 * is applied to already sits behind requireMfaEnrolled, so a userId is
 * always present, and per-account throttling is what actually matters once
 * a request is authenticated (shared IPs — offices, NAT, VPNs — would
 * otherwise throttle unrelated legitimate users together).
 */
export function requestRateLimit(label: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.session.userId;
    const key = `${label}:user:${userId ?? "anon"}`;
    const result = checkAndRecordRequest(key, maxRequests, windowMs);

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds ?? 60));
      void logEvent({
        eventType: "RATE_LIMIT_HIT",
        details: `Rate limit hit for ${label}`,
        userId: userId ?? null,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
      });
      res.status(429).json({ error: "Too many requests — please slow down and try again shortly." });
      return;
    }

    next();
  };
}
