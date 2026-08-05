---
name: WebAuthn / Passkeys implementation
description: How WebAuthn is implemented in SecureAI — packages, RPID config, DB schema, API routes, frontend hooks.
---

# WebAuthn implementation in SecureAI

## Packages
- Server: `@simplewebauthn/server` + `@simplewebauthn/types` in `@workspace/api-server`
- Client: `@simplewebauthn/browser` in `@workspace/secureai`

## RPID / origin configuration
- `rpID = process.env.REPLIT_DEV_DOMAIN ?? 'localhost'` (in `artifacts/api-server/src/routes/webauthn.ts`)
- `allowedOrigins()` returns `['https://${rpID}', 'http://localhost:3000', 'http://localhost:5173']`
- WebAuthn does NOT work in an embedded iframe without `allow="publickey-credentials-*"` on the iframe — the app must be opened in a full browser tab.

## DB schema
- Table: `webauthn_credentials` (see `lib/db/src/schema/webauthnCredentials.ts`)
- Fields: `id`, `userId`, `credentialId` (unique, base64url), `publicKey` (base64url COSE), `counter` (bigint), `transports` (comma-separated), `label`, `createdAt`, `lastUsedAt`
- Public key stored as `Buffer.from(credential.publicKey).toString('base64url')` at registration; reconstructed via `Buffer.from(storedCred.publicKey, 'base64url')` at verification.

## Session fields added
In `artifacts/api-server/src/app.ts` SessionData: `webauthnChallenge?: string`, `webauthnUserId?: number`

## API routes (all in `artifacts/api-server/src/routes/webauthn.ts`)
- POST `/auth/webauthn/register-options` — requires session.userId
- POST `/auth/webauthn/register-verify` — body: `{ response: RegistrationResponseJSON, label?: string }`
- POST `/auth/webauthn/authenticate-options` — body: `{ email?: string }` (no auth required)
- POST `/auth/webauthn/authenticate-verify` — body: `{ response: AuthenticationResponseJSON }` → establishes session
- GET  `/auth/webauthn/credentials` — requires session.userId
- DELETE `/auth/webauthn/credentials/:id` — requires session.userId

## Audit event types added to AuditEventType
`PASSKEY_REGISTERED`, `PASSKEY_REMOVED`, `PASSKEY_AUTH_SUCCESS`, `PASSKEY_AUTH_FAILED`

## Frontend
- Login.tsx: "Sign in with Passkey" button → passkey view → `startAuthentication(options)` from `@simplewebauthn/browser`
- PasskeyManager.tsx: reusable component for registration + deletion of passkeys
- Enroll.tsx: tabbed interface — Passkey (recommended) tab shows PasskeyManager; Face scan tab is the legacy flow with an honest security limitation warning

**Why:** Face scan sends descriptor over network — forgeable. Passkey private key never leaves secure enclave; only signature travels.
