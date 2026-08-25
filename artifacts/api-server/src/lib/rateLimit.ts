/**
 * In-process sliding-window rate limiter for login attempts. Stops
 * credential stuffing and brute-force password guessing.
 *
 * checkAndRecordRequest does the check-and-increment as one synchronous
 * call. It used to be two separate calls with an await in between at the
 * login call site, which let concurrent requests race past the limit
 * (see docs/04_Threat_Model_Risk_Assessment.md, R-AUTH-2).
 */
interface Window {
  count: number;
  firstAttemptAt: number;
}

const attempts = new Map<string, Window>();

// Periodic sweep so the map doesn't grow unbounded over a long-running process.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.firstAttemptAt > 60 * 60 * 1000) attempts.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

// Rolls back a single reservation from checkAndRecordRequest (decrement,
// not a full clear, so other requests sharing the same key aren't wiped).
export function releaseAttempt(key: string): void {
  const entry = attempts.get(key);
  if (entry && entry.count > 0) entry.count -= 1;
}

// General per-key throttle. Login reserves before any async work and
// releases afterward if it doesn't count (see routes/auth.ts). Checks and
// increments atomically so concurrent requests can't both read the count
// before either one increments it.
export function checkAndRecordRequest(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAttemptAt > windowMs) {
    attempts.set(key, { count: 1, firstAttemptAt: now });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - entry.firstAttemptAt)) / 1000) };
  }

  entry.count += 1;
  return { allowed: true };
}
