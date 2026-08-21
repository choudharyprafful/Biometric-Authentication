# Security Architecture — SecureAI

Team 1: Technical Security. This diagram covers the CORE + IMPORTANT controls actually built in this
proof-of-concept (see `replit.md` for the full narrative of each decision).

## Component diagram

```mermaid
flowchart TB
    subgraph Client["Browser (Web Client)"]
        UI["React 19 SPA<br/>(Vite, wouter routing)"]
        FaceLib["face-api.js<br/>TinyFaceDetector<br/>(client-side descriptor capture)"]
        WebAuthnClient["@simplewebauthn/browser<br/>(platform authenticator)"]
        UI --- FaceLib
        UI --- WebAuthnClient
    end

    subgraph Edge["Transit hardening"]
        HTTPS["HTTPS redirect (prod) + HSTS"]
        Headers["CSP / X-Frame-Options /<br/>X-Content-Type-Options / Referrer-Policy"]
        CORS["CORS allowlist<br/>(lib/allowedOrigins.ts)"]
        CSRF["Double-submit-cookie CSRF<br/>(csrf_token cookie + X-CSRF-Token header)"]
    end

    subgraph API["Express 5 API server"]
        MW["requireMfaEnrolled middleware<br/>(server-side gate, not just UI redirect)"]
        RateLimit["In-memory sliding-window<br/>rate limiter (login)"]
        Routes["Route handlers<br/>auth / users / passkeys / uploads /<br/>payments / security"]
        AuditLib["auditLog.ts<br/>hash-chained, serialized write queue"]
        Encrypt["fileEncryption.ts<br/>AES-256-GCM"]
        Scan["malwareScan.ts<br/>signature-based (EICAR, exe magic bytes, SVG script)"]
        ImgSafety["imageSafety.ts<br/>EXIF/GPS strip + magic-byte MIME check"]
        WebhookSig["webhookSignature.ts<br/>HMAC-SHA256 + anti-replay"]
    end

    subgraph DB["PostgreSQL (Drizzle ORM)"]
        Users[("users<br/>(passwordHash, encrypted face descriptor,<br/>consent flags)")]
        Passkeys[("passkeys<br/>(WebAuthn public keys)")]
        Uploads[("uploads<br/>(encrypted file blobs)")]
        Payments[("payments<br/>(encrypted provider tokens)")]
        Logs[("security_logs<br/>(hash-chained)")]
        Sessions[("user_sessions<br/>(connect-pg-simple)")]
    end

    subgraph ExternalSim["Simulated external (not real in this PoC)"]
        Provider["Payment provider<br/>(Stripe-style, tokenised, simulated)"]
    end

    UI -->|fetch, credentials:'include'| HTTPS --> Headers --> CORS --> CSRF --> MW
    MW --> RateLimit --> Routes
    Routes --> AuditLib --> Logs
    Routes --> Encrypt --> Users
    Routes --> Encrypt --> Payments
    Routes --> Scan --> ImgSafety --> Encrypt --> Uploads
    Routes --> Passkeys
    Routes --> Sessions
    Routes -->|HMAC-verified webhook| WebhookSig
    Provider -. s30 .-> WebhookSig
```

## Why these boundaries

- **Every protected route sits behind `requireMfaEnrolled`, not just the frontend router.** The React route
  guard is UX only — a direct API call with a valid session cookie but incomplete MFA is still rejected
  server-side. This is the single most important boundary in the diagram: it's what makes "mandatory MFA"
  actually mandatory rather than a suggestion the client could skip.
- **CSRF sits in front of the MFA gate, not behind it.** A forged cross-site request can't even reach a
  route handler without a matching `X-CSRF-Token`, regardless of MFA state.
- **Encryption and audit logging are library calls used *by* route handlers, not a separate service.**
  There's no key-management service or external HSM in this PoC — `FILE_ENCRYPTION_KEY` is a single
  symmetric key from environment config. That's an accepted limitation of a demo, documented as such
  (see `04_Threat_Model_Risk_Assessment.md`, R-DP-3).
- **The payment provider is simulated.** No real Stripe (or equivalent) integration exists; the webhook
  signature verification path is real and independently testable (`lib/webhookSignature.ts`), but nothing
  in this PoC actually calls out to a payment network.

## Mapping to the brief's CORE areas

| Brief CORE area | Where it lives in this diagram |
 ---|---|
| Authentication + MFA | `requireMfaEnrolled`, `auth`/`passkeys` routes, `users` table consent+descriptor columns |
| Data protection | `fileEncryption.ts`, `imageSafety.ts`, `malwareScan.ts` |
| Access control | Route-level ownership checks inside each handler (not shown as a separate box — enforced per-route) |
| Secure communication | Edge subgraph (HTTPS/HSTS, headers, CORS, CSRF) |
| Logging | `auditLog.ts` → `security_logs` |
| Risk assessment | See `04_Threat_Model_Risk_Assessment.md` |
