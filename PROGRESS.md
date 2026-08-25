# Progress Tracker

Mirrors the current state of [GitHub Issues](../../issues) as of this file's last update — a local,
in-repo view of the same week-by-week tracking, so status is visible without leaving the repo. The
GitHub issues remain the source of truth; if this file and GitHub ever disagree, GitHub is newer.

## Summary

| Weeks | Issue | Track | Status |
|---|---|---|---|
| 1-2 | [#1](https://github.com/choudharyprafful/Biometric-Authentication/issues/1) | Discovery & Threat Modelling | ✅ Closed — 3/3 |
| 3-4 | [#2](https://github.com/choudharyprafful/Biometric-Authentication/issues/2) | Core Authentication & Access Control | ✅ Closed — 12/12 |
| 3-4 | [#4](https://github.com/choudharyprafful/Biometric-Authentication/issues/4) | AI/ML Data Foundation & Consent (Yaseen) | 🟡 Open — 0/2 checked¹ |
| 5-6 | [#3](https://github.com/choudharyprafful/Biometric-Authentication/issues/3) | Data Protection & Secure Communication | 🟢 Open, all done — 10/10 |
| 5-6 | [#8](https://github.com/choudharyprafful/Biometric-Authentication/issues/8) | AI/ML Deletion & Memorisation Defense (Yaseen + Sadakshi) | 🟡 Open — 2/4 |
| 7-8 | [#5](https://github.com/choudharyprafful/Biometric-Authentication/issues/5) | Payments & Subscription Abuse | 🟢 Open, all done — 9/9 |
| 7-8 | [#9](https://github.com/choudharyprafful/Biometric-Authentication/issues/9) | AI/ML Extraction Protection & Docs Sync (Sadakshi) | 🟡 Open — 0/3 |
| 9 | [#6](https://github.com/choudharyprafful/Biometric-Authentication/issues/6) | Logging, Monitoring & PoC Build-out | 🟢 Open, all done — 11/11 |
| 10 | [#7](https://github.com/choudharyprafful/Biometric-Authentication/issues/7) | Finalise, Consolidate & Present | ⚪ Blocked — 0/6, waits on AI/ML |

**Non-AI/ML (Team 1's own scope): 45/45 done.** Everything outstanding is AI/ML (owned by Yaseen +
Sadakshi) or Week 10 finalisation (blocked on AI/ML landing first).

¹ Issue #4's 2 items are actually done and verified (record consent-tagging, consent gate — confirmed by
running `artifacts/ai-model/model_starter.py`), but show unchecked on GitHub — someone unchecked them
there after they were originally marked done. Flagged here rather than silently mirrored, since this file
is meant to be trustworthy, not just a literal copy.

---

## Weeks 1-2 — Discovery & Threat Modelling ([#1](https://github.com/choudharyprafful/Biometric-Authentication/issues/1), closed)

- [x] `docs/01_Security_Architecture.md` — system architecture sketch
- [x] `docs/04_Threat_Model_Risk_Assessment.md` — STRIDE pass per component, asset inventory, trust boundaries, prioritised risk register, standards mapping
- [x] Coordination interface with Team 2 stated

## Weeks 3-4 — Core Authentication & Access Control ([#2](https://github.com/choudharyprafful/Biometric-Authentication/issues/2), closed)

- [x] Password auth (bcrypt, cost 12) + timing-safe login
- [x] Device-native biometric MFA — web (WebAuthn/passkeys) and mobile (Android Keystore + BiometricPrompt)
- [x] Two-step login (password → MFA upgrade)
- [x] Session management: idle timeout (30 min) + absolute cap (12h), logout-all, session regenerate on privilege change
- [x] Password reset requiring live MFA proof, not just link possession
- [x] Device enrolment/re-enrolment, including cross-device linking
- [x] Credential stuffing / rate limiting / lockout
- [x] IDOR / broken object-level authorisation checks
- [x] Least-privilege DB role
- [x] Device-passcode MFA fallback — documented as a deliberate departure (`docs/02_Authentication_Flow.md`)
- [x] SIM-swap-style recovery-abuse threat modelling — written up (`docs/04`, R-AUTH-6)
- [x] Passkey-as-single-gesture-MFA trade-off — written up (`docs/02_Authentication_Flow.md`)

## Weeks 3-4 (AI/ML) — Data Foundation & Consent ([#4](https://github.com/choudharyprafful/Biometric-Authentication/issues/4), open — Yaseen)

- [ ] Every training record carries `user_id`, `consent_id`, `source_id` from creation¹
- [ ] Consent gate — rejects any record with no `consent_id` before training ever sees it¹

## Weeks 5-6 — Data Protection & Secure Communication ([#3](https://github.com/choudharyprafful/Biometric-Authentication/issues/3), open, all done)

- [x] AES-256-GCM at rest for uploads, face descriptors, payment provider tokens
- [x] TLS forced + HSTS in production
- [x] Upload validation: magic-byte detection, malware scan, EXIF/GPS/text metadata stripping
- [x] CSRF — double-submit cookie, timing-safe comparison
- [x] CORS allowlist, not `origin: true`
- [x] Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [x] Per-account rate limiting on uploads/payments/passkey-registration
- [x] Mobile: session cookie via native HTTP stack, CSRF token read via `@react-native-cookies/cookies`
- [x] Mobile certificate pinning — Android release builds, pin values are placeholders pending a real production domain
- [x] Formal OWASP MASVS checklist walkthrough — `docs/06_Mobile_Security_MASVS_Checklist.md`

## Weeks 5-6 (AI/ML) — Deletion & Memorisation Defense ([#8](https://github.com/choudharyprafful/Biometric-Authentication/issues/8), open — Yaseen + Sadakshi)

- [x] Deletion mechanism — `delete_user()` + retrain, live-verified
- [x] Memorisation/leakage defense — sentence-level deduplication, canary-tested
- [ ] Per-user contribution cap (anti-poisoning) — implemented, not yet exercised by the demo corpus
- [ ] A real data-poisoning demo beyond the cap

## Weeks 7-8 — Payments & Subscription Abuse ([#5](https://github.com/choudharyprafful/Biometric-Authentication/issues/5), open, all done)

- [x] Tokenisation — server-generated `tok_*` tokens, raw card numbers never touch the API
- [x] Card-entry UI client-side-only realism (Luhn check, expiry/CVV format)
- [x] Server-canonical pricing
- [x] Duplicate-subscription guard
- [x] Signed, replay-resistant webhooks
- [x] Refund-fraud analysis (`docs/04`, R-PAY-3)
- [x] Shared-account abuse analysis (R-PAY-4)
- [x] Free-tier abuse analysis — analysed **and fixed** (R-PAY-5): per-IP registration rate limit added
- [x] Chargeback handling analysis (R-PAY-6)

## Weeks 7-8 (AI/ML) — Extraction Protection & Docs Sync ([#9](https://github.com/choudharyprafful/Biometric-Authentication/issues/9), open — Sadakshi)

- [ ] Model theft/extraction protection writeup
- [ ] A second extraction-attempt style beyond the single canary-prompt test
- [ ] `docs/03_Data_Flow.md` sync

## Week 9 — Logging, Monitoring & PoC Build-out ([#6](https://github.com/choudharyprafful/Biometric-Authentication/issues/6), open, all done)

- [x] Hash-chained tamper-evident audit log
- [x] `GET /security/logs/verify` chain verification
- [x] No secrets/tokens/card data/full biometric values in any log line
- [x] Rate-limit trips are themselves audit-logged and queryable
- [x] Dependency scanning (`pnpm audit`), wired into CI
- [x] Adversarial-probe suite (SQLi, CSRF, auth-bypass, IDOR, stored XSS)
- [x] Concurrency load test for the login rate limiter
- [x] Full mobile app PoC, tested live on a real Android device
- [x] AI/ML PoC — see the AI/ML issues
- [x] Active alerting/dashboard-highlighting for suspicious activity
- [x] Real SAST tooling — Semgrep, real CI gate

## Week 10 — Finalise, Consolidate & Present ([#7](https://github.com/choudharyprafful/Biometric-Authentication/issues/7), blocked)

- [ ] Close out remaining items from Weeks 3-4/5-6/7-8/9 issues (AI/ML only, at this point)
- [ ] Consistency pass across all docs
- [ ] Final read-through of `docs/04`'s risk register
- [ ] Confirm all 7 required deliverables present and accurate
- [ ] Final sync with Team 2
- [ ] Presentation prep
