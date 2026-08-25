import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Double-submit-cookie CSRF protection. A cross-site page can trigger a
 * request that automatically carries the session cookie, but it cannot
 * read this cookie's value (browsers enforce same-origin on cookie
 * access) to also set it as a request header — so requiring both to match
 * proves the request originated from same-origin JavaScript, not a forged
 * cross-site form/fetch. Stateless — no server-side token storage needed.
 */
const CSRF_COOKIE = "csrf_token";
const CSRF_HEADER = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Issues a csrf_token cookie for any client that doesn't already have one.
 *  Readable by JS (not httpOnly) — the frontend must read it and echo it
 *  back as a header on state-changing requests. */
export function issueCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString("base64url");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days — independent of session lifetime
    });
  }
  next();
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Rejects state-changing requests whose X-CSRF-Token header doesn't match
 *  the csrf_token cookie. */
export function requireCsrfMatch(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !timingSafeEqualStr(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: "Invalid or missing CSRF token" });
    return;
  }

  next();
}
