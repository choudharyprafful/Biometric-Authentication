# SecureAI — Biometric Security Demo

A security proof-of-concept demonstrating biometric multi-factor authentication (face and/or WebAuthn passkey on web, passkey on mobile), secure session management, role-based access control, encryption at rest, hardened transit/API security, audit logging, and simulated subscription payments — plus a standalone AI/ML training-pipeline security PoC.

Built as a student deliverable for **Team 1 (Technical Security)**, per the course brief. A parallel **Team 2 (Ethics & Governance)** brief covers the policy/consent side of the same system.

## Where things live

| Path | What it is |
|---|---|
| [`artifacts/api-server`](artifacts/api-server) | Express API — auth, sessions, MFA, users, payments, uploads, security logs |
| [`artifacts/secureai`](artifacts/secureai) | React web frontend |
| [`artifacts/mobile`](artifacts/mobile) | Expo/React Native mobile app (passkey + biometric MFA) — see its own [README](artifacts/mobile/README.md) |
| [`artifacts/ai-model`](artifacts/ai-model) | Standalone AI/ML training-pipeline security PoC (consent, poisoning, deletion, memorisation) |
| [`lib/db`](lib/db) | Drizzle ORM schema — the single source of truth for the data model |
| [`lib/api-spec`](lib/api-spec) | OpenAPI spec — the single source of truth for the HTTP API |
| [`lib/api-zod`](lib/api-zod), [`lib/api-client-react`](lib/api-client-react) | Generated from the OpenAPI spec — Zod validation + typed React Query hooks |
| [`docs/`](docs) | Security architecture, auth/data-flow diagrams, threat model, consent & deletion design |
| [`scripts/`](scripts) | Security testing — adversarial-probe suite, load test |

## Documentation

| Doc | Covers |
|---|---|
| [01 — Security Architecture](docs/01_Security_Architecture.md) | System components, trust boundaries |
| [02 — Authentication Flow](docs/02_Authentication_Flow.md) | Login, MFA, session lifecycle |
| [04 — Threat Model & Risk Assessment](docs/04_Threat_Model_Risk_Assessment.md) | STRIDE analysis, risk register, OWASP mapping |

Two further docs (data flow including the AI/ML pipeline, and consent/deletion design) are in progress and will be added alongside their corresponding work.

## Quick start

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL and SESSION_SECRET

pnpm --filter @workspace/api-server run dev   # API on :8080
pnpm --filter @workspace/secureai run dev     # web app
```

**Environment variables** (see [`.env.example`](.env.example)):

| Variable | Required? | What it's for |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes | express-session secret |
| `FILE_ENCRYPTION_KEY` | No | AES-256 key (64-char hex) for encrypting uploads/face descriptors/payment tokens at rest; falls back to a key derived from `SESSION_SECRET` for local dev |
| `WEBHOOK_SECRET` | No | HMAC secret for payment webhook signature verification; falls back to a dev default |

**Demo accounts** (all use password `Password123!`):

| Email | Role |
|---|---|
| `admin_user@prafful.com` | admin |
| `security_monitoring@prafful.com` | security_analyst |
| `it_support@prafful.com` | it_support |
| `admin@prafful.com`, `bob@prafful.com` | user |

None start MFA-enrolled — visit `/enroll` after logging in to set up face and/or passkey.

For the mobile app, see [`artifacts/mobile/README.md`](artifacts/mobile/README.md). For the AI/ML PoC: `python3 artifacts/ai-model/model_starter.py` (pure Python, no install step).

## Progress tracking

Work is tracked week-by-week against the brief as [GitHub Issues](../../issues), each with a checklist mapping brief requirements to the actual files that satisfy them.
