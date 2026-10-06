import type { RequestHandler } from "express";

// PostgreSQL text cannot hold U+0000, so a NUL anywhere in a request reached the database as a
// failed query and came back as a 500. The ZAP scan of 2026-09-27 found it on PATCH /users/:id
// and the audit-log search filters; it applied to every route that stores or filters on text.
// Refused up front instead, for the body, the query string and the path alike.

const MAX_DEPTH = 32;

export function containsNul(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH)
    return false;
  if (Array.isArray(value)) return value.some((v) => containsNul(v, depth + 1));
  return Object.entries(value).some(
    ([k, v]) => k.includes("\u0000") || containsNul(v, depth + 1),
  );
}

function pathContainsNul(path: string): boolean {
  if (!path.includes("%")) return path.includes("\u0000");
  try {
    return decodeURIComponent(path).includes("\u0000");
  } catch {
    // Malformed percent-encoding is left to the router, which already answers it with a 400.
    return false;
  }
}

export const rejectNulCharacters: RequestHandler = (req, res, next) => {
  if (
    pathContainsNul(req.path) ||
    containsNul(req.query) ||
    containsNul(req.body)
  ) {
    res.status(400).json({ error: "Request contains a NUL character" });
    return;
  }
  next();
};
