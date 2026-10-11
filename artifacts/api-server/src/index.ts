import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { startRetentionJob } from "./lib/retention";
import { startKeyRotationJob } from "./lib/keyRotation";
import { startSecurityAlertingJob } from "./lib/securityAlerting";
import {
  ensureDeletionAuditTrigger,
  ensureRetentionPurge,
} from "./lib/dbBootstrap";
import { logClamdStatusAtStartup } from "./lib/clamdClient";
import { logBehaviorModelPrivacyAtStartup } from "./lib/behaviorModel";
import { isEmailConfigured } from "./lib/mailer";
import { devAuthLinksEnabled } from "./lib/devLinks";
import { breachLookupEnabled } from "./lib/breachedPasswords";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  await ensureDeletionAuditTrigger();
  await ensureRetentionPurge();

  // Seed demo data if DB is empty
  try {
    await seedIfEmpty();
  } catch (e) {
    logger.warn({ err: e }, "Seed failed — continuing without demo data");
  }

  startRetentionJob();
  startKeyRotationJob();
  startSecurityAlertingJob();
  void logClamdStatusAtStartup(logger);
  void logBehaviorModelPrivacyAtStartup(logger);

  // New accounts can only open uploads and payments by confirming their email (R-PAY-5), so a
  // missing mail account is worth saying out loud rather than finding out from support requests.
  if (isEmailConfigured())
    logger.info("Email verification: confirmation links are emailed");
  else if (devAuthLinksEnabled())
    logger.info(
      "Email verification: no email account, so the link is returned to the client (local development only)",
    );
  else
    logger.warn(
      "Email verification: no email account (SMTP_HOST, SMTP_USER, SMTP_PASS), so new accounts cannot confirm their address and stay unable to upload or pay",
    );
  logger.info(
    `Breached-password check: ${breachLookupEnabled() ? "bundled list and Have I Been Pwned" : "bundled list only (BREACHED_PASSWORD_API=off)"}`,
  );
});
