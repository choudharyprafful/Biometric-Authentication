// Idle timeout (cookie maxAge + rolling:true in app.ts) resets on activity.
// Absolute cap forces re-auth regardless of activity, so a stolen session
// cookie can't just be kept "warm" forever by the attacker's own traffic.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
export const ABSOLUTE_SESSION_MAX_MS = 12 * 60 * 60 * 1000; // 12 hr
