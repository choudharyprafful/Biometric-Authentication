/**
 * Verifies lib/breachedPasswords.ts (R-AUTH-10) against a fake Have I Been Pwned: common and
 * account-specific passwords are refused, a breached one is refused, only 5 hash characters are
 * sent, padding never counts as a match, and an API that is down, slow or switched off leaves the
 * bundled list as the check instead of blocking sign-up.
 *
 * Run: pnpm --filter @workspace/api-server run verify:breached-passwords
 * Needs no server, database or network. Add --live to also ask the real API about one password.
 */
import crypto from "node:crypto";
import commonPasswordList from "./commonPasswords.json";
import {
  breachCount,
  checkNewPassword,
  rangeHash as sha1,
} from "./breachedPasswords";

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

/** A fake range API that knows the given passwords, with padding lines like the real one. */
function fakeApi(breached: Record<string, number>) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const prefix = url.slice(-5);
    const lines = Object.entries(breached)
      .map(([p, n]) => [sha1(p), n] as const)
      .filter(([h]) => h.startsWith(prefix))
      .map(([h, n]) => `${h.slice(5)}:${n}`);
    // Padding: random suffixes with a count of 0.
    for (let i = 0; i < 3; i++)
      lines.push(
        `${crypto.randomBytes(18).toString("hex").slice(0, 35).toUpperCase()}:0`,
      );
    return new Response(lines.join("\r\n"), { status: 200 });
  }) as typeof fetch;
  return { impl, requests };
}

const unused = (async () => {
  throw new Error("the API should not be called");
}) as typeof fetch;

async function main(): Promise<void> {
  console.log("Bundled list");
  const list = commonPasswordList.passwords;
  check(
    "2,087 entries, all at least 8 characters",
    list.length === 2087 && list.every((p) => p.length >= 8),
    `${list.length} entries, shortest ${Math.min(...list.map((p) => p.length))}`,
  );

  console.log("\nRefused without asking the API");
  for (const [password, email, reason] of [
    ["sunshine", "a@example.com", "common"],
    ["IloveYou", "a@example.com", "common"], // matched ignoring case
    ["jordan.lee-2026", "jordan.lee@example.com", "context"],
    ["MySecureAIpass9", "a@example.com", "context"],
  ] as const) {
    const result = await checkNewPassword(password, { email }, unused);
    check(
      `"${password}" refused as ${reason}`,
      !result.ok && result.reason === reason,
      JSON.stringify(result),
    );
  }

  console.log("\nAsked the API");
  const breached = "Tr0ub4dor&3-horse";
  const api = fakeApi({ [breached]: 4182 });
  const refused = await checkNewPassword(
    breached,
    { email: "a@example.com" },
    api.impl,
  );
  check(
    "a breached password is refused",
    !refused.ok && refused.reason === "breached",
    JSON.stringify(refused),
  );
  const sent = api.requests[0];
  check(
    "only the first 5 characters of the SHA-1 hash are sent, with padding asked for",
    sent?.url ===
      `https://api.pwnedpasswords.com/range/${sha1(breached).slice(0, 5)}` &&
      sent.headers["Add-Padding"] === "true" &&
      !sent.url.includes(sha1(breached).slice(5)),
    sent?.url ?? "no request",
  );
  const fresh = "violet-harbour-ledger-73";
  const allowed = await checkNewPassword(
    fresh,
    { email: "bo@example.com" },
    api.impl,
  );
  check(
    "a password the API doesn't know is allowed (padding lines never match)",
    allowed.ok && allowed.breachLookup === "no-match",
    JSON.stringify(allowed),
  );
  check(
    'a short email name ("bo") isn\'t treated as a context word',
    (
      await checkNewPassword(
        "bobcat-river-91",
        { email: "bo@example.com" },
        api.impl,
      )
    ).ok,
    "bobcat-river-91 with bo@example.com",
  );

  console.log("\nWhen the API can't answer");
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  const r1 = await checkNewPassword(fresh, {}, down);
  check(
    "API unreachable: allowed on the bundled list",
    r1.ok && r1.breachLookup === "unavailable",
    JSON.stringify(r1),
  );
  const r2 = await checkNewPassword(
    fresh,
    {},
    (async () => new Response("busy", { status: 503 })) as typeof fetch,
  );
  check(
    "API error status: allowed on the bundled list",
    r2.ok && r2.breachLookup === "unavailable",
    JSON.stringify(r2),
  );
  const hanging = ((_: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, rejectFn) =>
      init?.signal?.addEventListener("abort", () =>
        rejectFn(new Error("aborted")),
      ),
    )) as typeof fetch;
  // AbortSignal.timeout's timer doesn't keep Node running (the server always has other work).
  const keepAlive = setInterval(() => {}, 1000);
  const started = Date.now();
  const r3 = await checkNewPassword(fresh, {}, hanging);
  const waited = Date.now() - started;
  clearInterval(keepAlive);
  check(
    "API hanging: gives up after the timeout",
    r3.ok && r3.breachLookup === "unavailable" && waited < 4000,
    `${JSON.stringify(r3)} after ${waited} ms`,
  );
  check(
    "a common password is still refused while the API is down",
    !(await checkNewPassword("football", {}, down)).ok,
    "football",
  );
  process.env["BREACHED_PASSWORD_API"] = "off";
  const r4 = await checkNewPassword(fresh, {}, unused);
  check(
    "BREACHED_PASSWORD_API=off: no request, bundled list only",
    r4.ok && r4.breachLookup === "off",
    JSON.stringify(r4),
  );
  delete process.env["BREACHED_PASSWORD_API"];

  if (process.argv.includes("--live")) {
    console.log("\nThe real API");
    const count = await breachCount("Password123!");
    check(
      '"Password123!" is in Have I Been Pwned',
      count !== null && count > 0,
      `count ${count}`,
    );
  }

  console.log(
    failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
