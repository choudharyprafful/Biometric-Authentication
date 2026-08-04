# SecureAI — Biometric Security Demo

A security proof-of-concept platform demonstrating biometric face MFA authentication, secure session management, access control, audit logging, and simulated payments. Built as a student project deliverable (Team 1 — Technical Security) per the brief.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/secureai run dev` — run the frontend (port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — rebuild lib declarations (run after changing lib/db or lib/api-spec)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — express-session secret

## Demo Credentials

All demo accounts use password: `Password123!`

- `admin@secureai.demo` — admin role (can see all users, logs, payments)
- `alice@secureai.demo` — regular user
- `bob@secureai.demo` — regular user

None start with face enrolled. Use the /enroll page after login to enroll your face with the webcam.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite 7, wouter routing, TanStack React Query, face-api.js
- API: Express 5, express-session (PostgreSQL-backed via connect-pg-simple)
- DB: PostgreSQL + Drizzle ORM
- Auth: bcryptjs password hashing + face biometric MFA
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec at lib/api-spec/openapi.yaml)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (users, securityLogs, threats, payments)
- `artifacts/api-server/src/routes/` — Express route handlers (auth, users, security, payments)
- `artifacts/api-server/src/lib/faceUtils.ts` — Euclidean distance face comparison (threshold 0.6)
- `artifacts/api-server/src/lib/auditLog.ts` — security event logging helper
- `artifacts/api-server/src/lib/seed.ts` — demo data seeder (runs on startup if DB is empty)
- `artifacts/secureai/src/` — React frontend (pages, components, auth context)

## Architecture decisions

- **Session cookies over JWTs**: express-session with PostgreSQL store (`user_sessions` table). Simpler, revocable, httpOnly cookies prevent XSS token theft.
- **Biometric MFA via face-api.js**: Face descriptor extraction runs in-browser (128-float vector). Server stores descriptor in JSONB column and compares with Euclidean distance < 0.6 threshold. The device does the biometric check; the server validates the result via signed descriptor comparison.
- **Two-step login**: Step 1 (password) creates a short-lived `pendingUserId + tempToken` in session. Step 2 (face) validates the tempToken and upgrades to a full session. This prevents a fake "biometric OK" message from bypassing auth.
- **Payment tokenisation**: Server generates a `tok_*` provider token; raw card numbers never touch the API. Simulates PCI-compliant Stripe-style tokenisation.
- **Audit logging**: Every security event (login success/fail, face enroll/remove, payment) is written to `security_logs` table with IP, user-agent, and details.

## Product

Authenticated users see:
- **Dashboard** — security telemetry cards, recent events feed, threat indicators
- **Face Enrollment** — webcam capture → 128-element descriptor stored server-side
- **Security Logs** — filterable audit trail of all security events
- **Threat Assessment** — board of detected threats with severity/status
- **Payments** — payment history + simulated checkout modal

Admin users additionally see:
- **User Management** — list all users, change roles, delete users

## User preferences

_Populate as you build_

## Gotchas

- Always run `pnpm run typecheck:libs` after changing `lib/db/src/schema/` before running the API server typecheck — stale composite declarations cause false "module has no exported member" errors.
- Orval 8.23.0 with Zod 3.25.76: do NOT use `type: integer` or `format: email` in the OpenAPI spec — these trigger Zod v4 methods (`zod.int()`, `zod.email()`) that don't exist on the v3 API surface. Use `type: number` and plain `type: string` instead.
- face-api.js models load from CDN (~12MB total) — first face capture has a 5-15s model download delay.
- The `token` field in AuthResponse is just the string "authenticated" — real auth is the session cookie. Don't use it as a bearer token.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
