# Data Classification Scheme

Brief §6, "Data classification" row: Team 2 defines sensitive vs. non-sensitive classes and data
ownership; Team 1 applies protection appropriate to each class. Team 2's actual classification policy
doesn't exist yet in this joint project — this document states the scheme this implementation assumes,
so it's falsifiable/reviewable rather than silently baked into the code, matching the same pattern
`05_Consent_and_Deletion_Design.md` already uses for consent and retention.

This isn't a new decision retrofitted onto the code — every protection referenced below already exists
and was built before this document was. What's new here is naming the scheme explicitly, so the
protection choices read as *applications of a classification*, not an unrelated pile of individually
justified controls. The three open questions in §3 that are genuinely Team 2's call are also collected,
alongside every other open question across these docs, in `08_Requests_to_Team2.md`.

## 1. The scheme

Four tiers, ordered by consequence of unauthorized disclosure or loss of integrity — not by data volume
or how often it's accessed:

| Tier | Definition | Consequence of compromise |
|---|---|---|
| **Operational** | Data needed to run the app, low harm if disclosed in isolation | Minor — reveals usage patterns, not identity or secrets |
| **Account** | Identifies or authenticates a specific person | Account takeover, identity exposure |
| **Biometric** | Derived from a physical characteristic; cannot be reissued if compromised the way a password can | Permanent, irrevocable exposure — a leaked face descriptor can't be "reset" |
| **Financial** | Payment/subscription data | Fraud, financial harm, regulatory exposure (PCI-adjacent even where tokenised) |

A fifth axis cuts across all four and gets its own row below because it isn't about *confidentiality* at
all: **integrity-critical** data, where the harm model is tampering or repudiation, not disclosure. The
audit log is the one category in this app where that's the dominant concern — a leaked audit log is
embarrassing; a *silently edited* one defeats the entire point of having it. This is why `security_logs`
gets hash-chain tamper-evidence (`auditLog.ts`) as its primary control, not encryption-at-rest as its
primary control, even though both would generically appear on a "protect this" checklist.

## 2. Data category → tier → applied protection

| Data | Tier | Why | Applied protection | Reference |
|---|---|---|---|---|
| Email, name, password hash | Account | Directly identifies and authenticates the person | bcrypt (cost 12, never reversible); email uniqueness enforced; never returned in plaintext-adjacent form (hash only) | `lib/db/src/schema/users.ts:7-8` · `auth.ts:188` |
| Role (`user`/`admin`/`security_analyst`/`it_support`) | Operational | Reveals privilege level, not identity on its own | Server-side role check on every privileged route, not just hidden UI | `users.ts:36-38` · `security.ts:36-38` |
| Face descriptor | Biometric | The scheme's own reasoning, stated in `05_Consent_and_Deletion_Design.md`: "biometric data is treated as a distinct, higher-sensitivity category from general account data, requiring its own explicit opt-in" | AES-256-GCM at rest; separate `biometricConsentGiven` gate, cleared on withdrawal, not just the descriptor itself | `users.ts:15-24` · `fileEncryption.ts`. Sensitive information under the Privacy Act 1988, confirmed by Team 2 on 2026-09-26, so it is collected only with express, informed consent (docs/08 §5) |
| Uploaded files | Account (default) / Biometric (if the content itself is a face image) | Ownership is unambiguous but content-dependent sensitivity varies — this app doesn't currently distinguish an uploaded selfie from an uploaded PDF at the classification level | AES-256-GCM at rest; EXIF/GPS stripped (images); owner-only access (IDOR-checked) | `uploads.ts:133,177-187` · `imageSafety.ts` |
| Payment token, amount, subscription plan | Financial | Direct financial/regulatory exposure if disclosed | AES-256-GCM at rest; tokenised (no raw card data ever received — see `payments.ts`); HMAC-verified webhooks | `payments.ts:76-77,136-137` · `webhookSignature.ts` |
| Security/audit log entries | **Integrity-critical** (not primarily confidentiality-tiered) | The log's value is in being *trustworthy*, not secret — see §1 | SHA-256 hash chain, not encryption, as the primary control; access still restricted to `security_analyst` only | `auditLog.ts:63-173` · `security.ts:36` |
| Session tokens, CSRF tokens | Account (ephemeral) | Short-lived but equivalent to a live credential while valid | httpOnly+secure cookie; rolling 30-min idle + 12-hr absolute expiry; regenerated on privilege change | `app.ts:190-239` |

## 3. Assumptions this scheme makes (open to Team 2 override)

1. Uploaded file content isn't classified per-file: a user's uploaded tax document and uploaded meme
   currently get identical protection (encrypted, owner-only, EXIF-stripped-if-image). If Team 2's policy
   wants content-aware classification (e.g., detecting and specially handling uploaded government-ID
   images), that's a new control, not a reclassification of an existing one.
2. Biometric is one tier, not split by biometric type: the face descriptor (server-stored,
   AES-256-GCM) and the mobile Keystore-backed signing key (never leaves hardware, server never sees the
   key itself) are both called "Biometric" tier here despite materially different actual exposure — the
   Keystore key literally cannot be exfiltrated by a server compromise, while the descriptor can. Team 2
   may want these split into two tiers given that asymmetry.
3. Operational-tier data still isn't public: "low harm if disclosed in isolation" is not the same as
   "fine to disclose" — role, timestamps, and subscription plan are still access-controlled (own-data-only
   for regular users), just not additionally encrypted at rest the way Account/Biometric/Financial tiers
   are.
4. This scheme doesn't set retention limits: classification (this document) and retention
   (`05_Consent_and_Deletion_Design.md` §3) are deliberately kept separate — a data category's
   sensitivity tier and how long it should be kept are different questions, and conflating them was how
   the retention doc ended up correctly refusing to invent a purge window for audit logs/payments without
   a Team 2 policy. That reasoning still stands here: this document classifies, it doesn't schedule
   disposal.
