/**
 * The sign-in, sign-up and reset-request rate limits (routes/auth.ts). Kept here so the Security
 * Center (lib/securityControls.ts) reports the numbers the routes actually use.
 */

// Per-account cap stops targeted brute force; the looser per-IP cap stops a single source rotating through many stolen email:password pairs.
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 5;
export const LOGIN_MAX_ATTEMPTS_PER_IP = 20;

// Registration is anonymous (no account to key by yet), so it's keyed by IP like the login IP cap, but looser since a shared IP (office, campus, NAT) can mean many legitimate one-time signups.
export const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;
export const REGISTER_MAX_ATTEMPTS_PER_IP = 10;

// Closes the residual gap R-AUTH-6 stated openly: the reset TTL and attempt cap bounded how guessable an issued token was, but nothing bounded how MANY could be issued. Each request does real work (token generation, a DB insert, an audit write, and now an SMTP send), and an unbounded flood also means an unbounded volume of reset mail to a victim's inbox. Per-account is the tighter cap since that's the thing being targeted; per-IP is looser for the same shared-NAT reason registration is.
export const RESET_REQUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
export const RESET_REQUEST_MAX_PER_ACCOUNT = 5;
export const RESET_REQUEST_MAX_PER_IP = 20;
