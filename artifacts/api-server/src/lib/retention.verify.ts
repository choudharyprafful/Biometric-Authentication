/**
 * Verifies the retention policy (privacy policy section 10; docs/04 R-LOG-5) against a real
 * database: payment records go after 7 years, security log entries after 12 months and AI
 * challenge records after 2 years; the hash chain still verifies afterwards; nothing removed under
 * retention is kept as a full copy; and a deletion that isn't retention is still caught.
 *
 * The failures that matter: removing a record early (above all an AI challenge record at 12
 * months), keeping a "deleted" record somewhere else, the tamper check raising a false alarm
 * after a legitimate purge, or retention being usable to hide a real deletion.
 *
 * Run: RETENTION_VERIFY_DISPOSABLE_DB=yes pnpm --filter @workspace/api-server run verify:retention
 * Needs DATABASE_URL pointing at a fresh, disposable database (tables created, no log entries or
 * payments yet) and a login that owns it. It writes test rows and removes them.
 */
import { sql } from "drizzle-orm";
import {
  db,
  pool,
  securityLogsTable,
  securityLogRetentionTable,
  paymentsTable,
} from "@workspace/db";
import {
  computeLogHash,
  GENESIS_HASH,
  verifyLogChain,
  type LogContent,
} from "./auditLog";
import {
  ensureDeletionAuditTrigger,
  ensureRetentionPurge,
} from "./dbBootstrap";
import { purgeAgedPayments, purgeAgedSecurityLogs } from "./retention";
import { retentionGrantsFor } from "./retentionSql.mjs";

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

if (process.env["RETENTION_VERIFY_DISPOSABLE_DB"] !== "yes") {
  console.error(
    "Refusing to run: this writes and deletes rows. Point DATABASE_URL at a disposable database and set RETENTION_VERIFY_DISPOSABLE_DB=yes.",
  );
  process.exit(2);
}

await ensureDeletionAuditTrigger();
await ensureRetentionPurge();

const counts = await db.execute<{ logs: number; payments: number }>(sql`
  SELECT (SELECT count(*) FROM security_logs)::int AS logs,
         (SELECT count(*) FROM payments)::int AS payments
`);
if (counts.rows[0]!.logs > 0 || counts.rows[0]!.payments > 0) {
  console.error(
    "Refusing to run: this database already has security log entries or payments. Use a fresh one.",
  );
  process.exit(2);
}

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

// A chain of entries of known ages, built the way logEvent builds it.
const plan: {
  label: string;
  eventType: string;
  days: number;
  keep: boolean;
}[] = [
  {
    label: "sign-in 3 years ago",
    eventType: "LOGIN_SUCCESS",
    days: 1095,
    keep: false,
  },
  {
    label: "AI challenge 3 years ago",
    eventType: "AI_DECISION_CHALLENGED",
    days: 1095,
    keep: false,
  },
  {
    label: "AI challenge acknowledged 18 months ago",
    eventType: "AI_CHALLENGE_ACKNOWLEDGED",
    days: 548,
    keep: true,
  },
  {
    label: "failed sign-in 18 months ago",
    eventType: "LOGIN_FAILED",
    days: 548,
    keep: false,
  },
  {
    label: "payment event 13 months ago",
    eventType: "PAYMENT_CREATED",
    days: 396,
    keep: false,
  },
  {
    label: "AI challenge resolved 13 months ago",
    eventType: "AI_CHALLENGE_RESOLVED",
    days: 396,
    keep: true,
  },
  {
    label: "sign-in 11 months ago",
    eventType: "LOGIN_SUCCESS",
    days: 335,
    keep: true,
  },
  { label: "registration today", eventType: "REGISTER", days: 0, keep: true },
];
let prevHash = GENESIS_HASH;
const ids: number[] = [];
for (const entry of plan) {
  const content: LogContent = {
    eventType: entry.eventType,
    details: `retention test: ${entry.label}`,
    userId: null,
    userEmail: "retention-test@example.com",
    ipAddress: "192.0.2.1",
    userAgent: "retention.verify",
    timestamp: ago(entry.days).toISOString(),
  };
  const hash = computeLogHash(prevHash, content);
  const [row] = await db
    .insert(securityLogsTable)
    .values({
      ...content,
      timestamp: new Date(content.timestamp),
      prevHash,
      hash,
    })
    .returning({ id: securityLogsTable.id });
  ids.push(row!.id);
  prevHash = hash;
}

const before = await verifyLogChain();
check(
  "the test chain verifies before the purge",
  before.valid && before.rowsChecked === plan.length,
  JSON.stringify(before),
);

// A full copy of an earlier deletion, 13 months old, and one from yesterday.
await db.execute(sql`
  INSERT INTO security_log_deletions (deleted_log_id, row_snapshot, deleted_by_db_role, deleted_at)
  VALUES (999001, '{"test":"old copy"}', 'retention-test', now() - interval '13 months'),
         (999002, '{"test":"recent copy"}', 'retention-test', now() - interval '1 day')
`);

const purged = await purgeAgedSecurityLogs();
const expectedGone = plan.filter((p) => !p.keep).length;
check(
  `the purge removes exactly the ${expectedGone} entries past their period`,
  purged.entries === expectedGone,
  `removed ${purged.entries}`,
);

const remaining = await db
  .select({ id: securityLogsTable.id, details: securityLogsTable.details })
  .from(securityLogsTable);
const remainingIds = new Set(remaining.map((r) => r.id));
for (const [i, entry] of plan.entries()) {
  check(
    `${entry.keep ? "kept" : "removed"}: ${entry.label}`,
    remainingIds.has(ids[i]!) === entry.keep,
    remainingIds.has(ids[i]!) ? "still in security_logs" : "gone",
  );
}

const after = await verifyLogChain();
check(
  "the chain still verifies after the purge, counting the removed entries",
  after.valid &&
    after.rowsChecked === plan.length - expectedGone &&
    after.purgedByRetention === expectedGone,
  JSON.stringify(after),
);

const stubs = await db.select().from(securityLogRetentionTable);
check(
  "each removed entry left a stub with hashes only, no content",
  stubs.length === expectedGone &&
    stubs.every(
      (s) =>
        s.hash !== null &&
        s.prevHash !== null &&
        !("details" in s) &&
        !("userEmail" in s),
    ),
  `${stubs.length} stub(s); columns: ${Object.keys(stubs[0] ?? {}).join(", ")}`,
);
check(
  "challenge records are classed separately from other entries",
  stubs.filter((s) => s.retentionClass === "ai-challenge").length === 1 &&
    stubs.filter((s) => s.retentionClass === "standard").length ===
      expectedGone - 1,
  stubs.map((s) => s.retentionClass).join(", "),
);

const copies = await db.execute<{ deleted_log_id: number }>(sql`
  SELECT deleted_log_id FROM security_log_deletions
`);
const copyIds = copies.rows.map((r) => Number(r.deleted_log_id));
check(
  "no full copy of a removed entry is kept",
  !ids.some((id, i) => !plan[i]!.keep && copyIds.includes(id)),
  `copies held for log ids: ${copyIds.join(", ") || "none"}`,
);
check(
  "full copies of earlier deletions go after 12 months, recent ones stay",
  purged.deletionCopies === 1 &&
    copyIds.includes(999002) &&
    !copyIds.includes(999001),
  `removed ${purged.deletionCopies}; remaining ${copyIds.join(", ")}`,
);

const again = await purgeAgedSecurityLogs();
const afterAgain = await verifyLogChain();
check(
  "running the purge again removes nothing and the chain still verifies",
  again.entries === 0 && afterAgain.valid,
  `${JSON.stringify(again)} ${JSON.stringify(afterAgain)}`,
);

// Payments: 8 years old goes, 6 years old stays.
const payment = (years: number) => ({
  amount: 9.99,
  description: `retention test: payment ${years} years ago`,
  status: "completed" as const,
  providerTokenCiphertext: "x",
  providerTokenIv: "x",
  providerTokenAuthTag: "x",
  createdAt: ago(years * 365 + 2),
});
await db.insert(paymentsTable).values([payment(8), payment(6)]);
const paymentsGone = await purgeAgedPayments();
const paymentsLeft = await db
  .select({ description: paymentsTable.description })
  .from(paymentsTable);
check(
  "payment records go after 7 years and not before",
  paymentsGone === 1 &&
    paymentsLeft.length === 1 &&
    paymentsLeft[0]!.description.includes("6 years"),
  `removed ${paymentsGone}; left: ${paymentsLeft.map((p) => p.description).join(", ")}`,
);

// A deletion that isn't retention: the 18-month-old acknowledgement, removed directly.
const target =
  ids[plan.findIndex((p) => p.eventType === "AI_CHALLENGE_ACKNOWLEDGED")]!;
await db.execute(sql`DELETE FROM security_logs WHERE id = ${target}`);
const tampered = await verifyLogChain();
check(
  "a deletion that isn't retention is still caught",
  !tampered.valid,
  JSON.stringify(tampered),
);
const kept = await db.execute(sql`
  SELECT 1 FROM security_log_deletions WHERE deleted_log_id = ${target}
`);
check(
  "and a full copy of it is kept for investigation",
  kept.rows.length === 1,
  `${kept.rows.length} copy found`,
);

// The app's own login, where the server has one. Logins belong to the whole server, so a fresh
// database can have the login without its grants: apply the grants the migration applies
// (scripts/ops/migrate-retention-and-breaches.mjs), so what is checked is exactly what production gets.
const appRole = await db.execute(
  sql`SELECT 1 FROM pg_roles WHERE rolname = 'secureai_app'`,
);
if (appRole.rows.length > 0) {
  for (const statement of retentionGrantsFor("secureai_app"))
    await db.execute(sql.raw(statement));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE secureai_app");
    let stubWriteError = "";
    try {
      await client.query(
        "INSERT INTO security_log_retention (log_id, prev_hash, hash, logged_at, retention_class) VALUES (999999, 'x', 'x', now(), 'standard')",
      );
    } catch (err) {
      stubWriteError = (err as Error).message;
    }
    check(
      "the app's login cannot write a retention stub",
      /permission denied/.test(stubWriteError),
      stubWriteError || "insert succeeded",
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
  const client2 = await pool.connect();
  try {
    await client2.query("BEGIN");
    await client2.query("SET LOCAL ROLE secureai_app");
    const r = await client2.query("SELECT * FROM purge_aged_security_logs()");
    check(
      "the app's login can run the purge",
      r.rows.length === 1,
      JSON.stringify(r.rows[0]),
    );
  } catch (err) {
    check("the app's login can run the purge", false, (err as Error).message);
  } finally {
    await client2.query("ROLLBACK");
    client2.release();
  }
} else {
  console.log(
    "  (no secureai_app login in this database: its permission checks are covered by scripts/ops/migrate-retention-and-breaches.mjs)",
  );
}

// Leave the database as it was found.
await db.execute(sql`DELETE FROM payments`);
await db.execute(sql`TRUNCATE security_log_retention`);
await db.execute(sql`DELETE FROM security_logs`);
await db.execute(sql`DELETE FROM security_log_deletions`);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
