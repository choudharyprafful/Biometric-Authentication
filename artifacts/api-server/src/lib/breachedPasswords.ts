/**
 * Checks a new password (sign-up, and both reset paths) against the NIST SP 800-63B §5.1.1.2 list
 * (R-AUTH-10): commonly used passwords, passwords from known breaches, and words specific to this
 * service or account. Login never runs it: an existing password is only checked when it is set.
 *
 * Two sources, so the check still works when one is unavailable:
 * - commonPasswords.json, bundled: the 2,087 entries of 8+ characters from SecLists' 10,000 most
 *   common passwords, matched ignoring case.
 * - Have I Been Pwned's range API (k-anonymity): only the first 5 characters of the password's
 *   SHA-1 hash leave the server, with padding so the response size doesn't reveal the match.
 *   BREACHED_PASSWORD_API=off turns the lookup off. If the API is slow or down, the password is
 *   allowed on the bundled list alone, so sign-up and reset never depend on a third party.
 */
import crypto from "node:crypto";
import commonPasswordList from "./commonPasswords.json";

const COMMON_PASSWORDS = new Set(
  commonPasswordList.passwords.map((p) => p.toLowerCase()),
);

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const LOOKUP_TIMEOUT_MS = 2500;

export type PasswordRejection = "common" | "breached" | "context";

export type PasswordCheck =
  | { ok: true; breachLookup: "no-match" | "unavailable" | "off" }
  | { ok: false; reason: PasswordRejection; message: string };

const MESSAGES: Record<PasswordRejection, string> = {
  common:
    "This is one of the most commonly used passwords, so it is among the first an attacker tries. Choose a different one.",
  breached:
    "This password has appeared in a known data breach, so attackers may already have it. Choose a different one.",
  context:
    "Don't use your email address or the name SecureAI in your password. Choose a different one.",
};

function reject(reason: PasswordRejection): PasswordCheck {
  return { ok: false, reason, message: MESSAGES[reason] };
}

export function breachLookupEnabled(): boolean {
  return process.env["BREACHED_PASSWORD_API"] !== "off";
}

/** The hash the range API is keyed on: it names the password there, it doesn't protect it. */
export function rangeHash(password: string): string {
  // nosemgrep
  const sha1 = crypto.createHash("sha1");
  return sha1.update(password, "utf8").digest("hex").toUpperCase();
}

/** How many times the password appears in Have I Been Pwned, or null when the lookup failed. */
export async function breachCount(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const hash = rangeHash(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(`${RANGE_API}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "SecureAI" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split("\n")) {
      const [candidate, count] = line.trim().split(":");
      // Padding entries carry a count of 0 and never match a real hash.
      if (candidate === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

export async function checkNewPassword(
  password: string,
  account: { email?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordCheck> {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return reject("common");

  // The part of the email before the @, when it is long enough to be specific to this person.
  const localPart = (account.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (
    lower.includes("secureai") ||
    (localPart.length >= 4 && lower.includes(localPart))
  )
    return reject("context");

  if (!breachLookupEnabled()) return { ok: true, breachLookup: "off" };
  const count = await breachCount(password, fetchImpl);
  if (count === null) {
    console.warn(
      "Breached-password lookup unavailable; checked against the bundled list only",
    );
    return { ok: true, breachLookup: "unavailable" };
  }
  return count > 0
    ? reject("breached")
    : { ok: true, breachLookup: "no-match" };
}
