/**
 * WebAuthn / Passkeys routes
 *
 * Core idea: the device biometric (face/fingerprint) unlocks a private key
 * stored in the secure enclave. That private key signs a server-issued
 * challenge. The server verifies the signature against the stored public key.
 * No biometric data ever leaves the device.
 *
 * Flows:
 *  1. Registration (logged-in user):
 *     POST /auth/webauthn/register-options  → PublicKeyCredentialCreationOptionsJSON
 *     POST /auth/webauthn/register-verify   → { verified, credential }
 *
 *  2. Passwordless authentication:
 *     POST /auth/webauthn/authenticate-options → PublicKeyCredentialRequestOptionsJSON
 *     POST /auth/webauthn/authenticate-verify  → user object + session
 *
 *  3. Credential management (logged-in user):
 *     GET    /auth/webauthn/credentials     → list
 *     DELETE /auth/webauthn/credentials/:id → 204
 */
import { Router, type IRouter, type Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/types";
import { eq, and } from "drizzle-orm";
import { db, usersTable, webauthnCredentialsTable } from "@workspace/db";
import { logEvent } from "../lib/auditLog";

const router: IRouter = Router();

// Relying-Party configuration
// rpID must equal the effective domain of the browser origin.
const rpID = process.env["REPLIT_DEV_DOMAIN"] ?? "localhost";
const rpName = "SecureAI";
// Accept both the Replit dev-domain origin and localhost (for local dev)
function allowedOrigins(): string[] {
  const origins = [`https://${rpID}`];
  if (rpID !== "localhost") origins.push("http://localhost:3000", "http://localhost:5173");
  return origins;
}

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );
}

// ---------------------------------------------------------------------------
// Registration — Step 1: generate options
// POST /auth/webauthn/register-options
// ---------------------------------------------------------------------------
router.post("/auth/webauthn/register-options", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Collect credential IDs already registered so the authenticator won't create duplicates
  const existing = await db
    .select({ credentialId: webauthnCredentialsTable.credentialId })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, user.id));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
    })),
    authenticatorSelection: {
      // "platform" prefers built-in (Face ID / Touch ID / Windows Hello)
      // "cross-platform" also allows hardware keys — we allow both
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  // Persist challenge for verification
  req.session.webauthnChallenge = options.challenge;
  await saveSession(req);

  res.json(options);
});

// ---------------------------------------------------------------------------
// Registration — Step 2: verify and save credential
// POST /auth/webauthn/register-verify
// ---------------------------------------------------------------------------
router.post("/auth/webauthn/register-verify", async (req, res): Promise<void> => {
  if (!req.session.userId || !req.session.webauthnChallenge) {
    res.status(401).json({ error: "No pending registration challenge" });
    return;
  }

  const { response, label } = req.body as {
    response: RegistrationResponseJSON;
    label?: string;
  };

  const expectedChallenge = req.session.webauthnChallenge;
  const userId = req.session.userId;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Verification failed";
    res.status(400).json({ error: `Passkey verification failed: ${message}` });
    return;
  }

  if (!verification.verified || !verification.registrationInfo) {
    res.status(400).json({ error: "Passkey registration could not be verified" });
    return;
  }

  const { credential } = verification.registrationInfo;

  // Store public key as base64url string
  const publicKeyB64 = Buffer.from(credential.publicKey).toString("base64url");

  await db.insert(webauthnCredentialsTable).values({
    userId,
    credentialId: credential.id,
    publicKey: publicKeyB64,
    counter: credential.counter,
    transports: response.response.transports?.join(",") ?? null,
    label: label ?? "Passkey",
  });

  // Clean up challenge
  delete req.session.webauthnChallenge;
  await saveSession(req);

  await logEvent({
    eventType: "PASSKEY_REGISTERED",
    details: `Passkey registered for user ${userId} (label: ${label ?? "Passkey"})`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.json({ verified: true, credentialId: credential.id });
});

// ---------------------------------------------------------------------------
// Authentication — Step 1: generate options
// POST /auth/webauthn/authenticate-options
// Body: { email?: string }  — omit for discoverable-credential (passkey) flow
// ---------------------------------------------------------------------------
router.post("/auth/webauthn/authenticate-options", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };

  let allowCredentials: { id: string }[] | undefined;
  let pendingUserId: number | undefined;

  if (email) {
    // Look up the user and their registered credentials so the browser can
    // offer the right passkey without scanning all stored credentials.
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()));

    if (user) {
      const creds = await db
        .select({ credentialId: webauthnCredentialsTable.credentialId })
        .from(webauthnCredentialsTable)
        .where(eq(webauthnCredentialsTable.userId, user.id));

      allowCredentials = creds.map((c) => ({ id: c.credentialId }));
      pendingUserId = user.id;
    }
    // If user not found, still generate a challenge — avoids user-enumeration
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials,
  });

  req.session.webauthnChallenge = options.challenge;
  if (pendingUserId !== undefined) req.session.webauthnUserId = pendingUserId;
  await saveSession(req);

  res.json(options);
});

// ---------------------------------------------------------------------------
// Authentication — Step 2: verify assertion and log in
// POST /auth/webauthn/authenticate-verify
// Body: { response: AuthenticationResponseJSON }
// ---------------------------------------------------------------------------
router.post("/auth/webauthn/authenticate-verify", async (req, res): Promise<void> => {
  if (!req.session.webauthnChallenge) {
    res.status(401).json({ error: "No pending authentication challenge" });
    return;
  }

  const { response } = req.body as { response: AuthenticationResponseJSON };
  const expectedChallenge = req.session.webauthnChallenge;
  const ip = getClientIp(req);

  // Find the matching stored credential by ID
  const [storedCred] = await db
    .select()
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.credentialId, response.id));

  if (!storedCred) {
    await logEvent({
      eventType: "PASSKEY_AUTH_FAILED",
      details: `No credential found for id ${response.id}`,
      ipAddress: ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(401).json({ error: "Passkey not recognised" });
    return;
  }

  // Reconstruct the public key Uint8Array from stored base64url
  const publicKeyBytes = Buffer.from(storedCred.publicKey, "base64url");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: storedCred.credentialId,
        publicKey: publicKeyBytes,
        counter: storedCred.counter,
        transports: storedCred.transports
          ? (storedCred.transports.split(",") as any)
          : undefined,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Verification failed";
    await logEvent({
      eventType: "PASSKEY_AUTH_FAILED",
      details: `Passkey assertion error: ${message}`,
      userId: storedCred.userId,
      ipAddress: ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(401).json({ error: `Passkey verification failed: ${message}` });
    return;
  }

  if (!verification.verified) {
    await logEvent({
      eventType: "PASSKEY_AUTH_FAILED",
      details: "Passkey assertion unverified",
      userId: storedCred.userId,
      ipAddress: ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(401).json({ error: "Passkey authentication failed" });
    return;
  }

  // Update the counter to detect cloned authenticators
  await db
    .update(webauthnCredentialsTable)
    .set({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    })
    .where(eq(webauthnCredentialsTable.id, storedCred.id));

  // Fetch user and establish session
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, storedCred.userId));
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  req.session.userId = user.id;
  delete req.session.webauthnChallenge;
  delete req.session.webauthnUserId;
  delete req.session.pendingUserId;
  delete req.session.tempToken;
  await saveSession(req);

  await logEvent({
    eventType: "PASSKEY_AUTH_SUCCESS",
    details: `Passkey authentication successful for ${user.email}`,
    userId: user.id,
    userEmail: user.email,
    ipAddress: ip,
    userAgent: req.headers["user-agent"],
  });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      faceEnrolled: user.faceEnrolled,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt?.toISOString() ?? null,
    },
    token: "authenticated",
  });
});

// ---------------------------------------------------------------------------
// Credential management
// ---------------------------------------------------------------------------

// GET /auth/webauthn/credentials
router.get("/auth/webauthn/credentials", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const creds = await db
    .select({
      id: webauthnCredentialsTable.id,
      label: webauthnCredentialsTable.label,
      credentialId: webauthnCredentialsTable.credentialId,
      createdAt: webauthnCredentialsTable.createdAt,
      lastUsedAt: webauthnCredentialsTable.lastUsedAt,
    })
    .from(webauthnCredentialsTable)
    .where(eq(webauthnCredentialsTable.userId, req.session.userId));

  res.json(
    creds.map((c) => ({
      id: c.id,
      label: c.label,
      credentialId: c.credentialId,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
    }))
  );
});

// DELETE /auth/webauthn/credentials/:id
router.delete("/auth/webauthn/credentials/:id", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const credId = parseInt(req.params["id"] ?? "", 10);
  if (isNaN(credId)) {
    res.status(400).json({ error: "Invalid credential id" });
    return;
  }

  const [deleted] = await db
    .delete(webauthnCredentialsTable)
    .where(
      and(
        eq(webauthnCredentialsTable.id, credId),
        eq(webauthnCredentialsTable.userId, req.session.userId)
      )
    )
    .returning({ id: webauthnCredentialsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Credential not found" });
    return;
  }

  await logEvent({
    eventType: "PASSKEY_REMOVED",
    details: `Passkey credential ${credId} removed`,
    userId: req.session.userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.sendStatus(204);
});

export default router;
