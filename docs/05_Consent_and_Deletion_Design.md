 1# Consent, Deletion & Retention — Design Note

Brief §8 deliverable; brief §6 overlap points with Team 2 ("Consent — Team 2 decides how consent &
withdrawal work; Team 1 enforces it, blocks non-consented data from training" / "Deletion — Team 2
decides what 'delete my profile' means; Team 1 builds the deletion mechanism + its limits" / "Retention
— Team 2 sets retention/disposal policy; Team 1 implements retention limits and secure disposal").

Team 2's actual policy documents don't exist yet in this joint project. The design below states the
assumptions this implementation makes about that policy, so they're falsifiable/reviewable rather than
silently baked in. Every open question below (and elsewhere in these docs) that's actually Team 2's call
to make is collected in one place, organized against Team 2's own deliverables, in
`08_Requests_to_Team2.md`.

## 1. Consent model

Two separate, independently-tracked consent flags on `users`, not one blanket flag:

| Flag | Set when | Cleared when | Required before |
|---|---|---|---|
| `dataConsentGiven` / `dataConsentAt` | `POST /auth/register` with `dataConsent: true` | Never (only account deletion removes it, by removing the row) | Registration succeeds at all |
| `biometricConsentGiven` / `biometricConsentAt` | `POST /users/:id/enroll-face` with `consent: true` | `DELETE /users/:id/face` (withdrawal) | A face descriptor is stored |
| `trainingConsentGiven` / `trainingConsentAt` | `POST /auth/register` with `trainingConsent: true` (optional, defaults to false), or `POST /users/me/training-consent` with `consent: true` afterward | `POST /users/me/training-consent` with `consent: false` — freely toggleable either direction, any time, regardless of what was chosen at registration. **Defect found and fixed 2026-09-25 (docs/04 R-CONSENT-2):** for an account that had not enrolled MFA yet, or was awaiting parental consent, this endpoint (and `POST /users/me/content-personalization-consent`) returned `403` because an MFA gate from another router leaked onto it. The gates are now scoped to their own paths, and both withdrawals return `200` for those accounts (verified locally and on the live site) | Nothing — gates whether activity contributes to the behavior model (§5b), not any core feature |

Design assumption: biometric data is treated as a distinct, higher-sensitivity category from general
account data, requiring its own explicit opt-in rather than being covered by general registration
consent. If Team 2's data-classification policy treats other categories (uploaded files, payment data)
as equally sensitive, this same per-category consent pattern can be extended to them.

Update 2026-09-09 — confirmed, not just anticipated: Team 2's received Acceptability Matrix
(`09_Team2_Data_Source_Acceptability_Matrix.md` §1, §3) independently tiers biometric data as T3 —
"Highest: separate explicit consent... never shared or sold" — matching this section's design exactly.
It also confirms payment data (T2, "Not used for training") sits in its own, less-sensitive-than-biometric
tier, consistent with `dataConsentGiven` covering it rather than a dedicated flag. No design change
needed here; recorded so the assumption above reads as verified, not merely hoped-for.

Enforcement point: consent is enforced at the point of storage, not just displayed as a notice.
`POST /users/:id/enroll-face` returns `400` and stores nothing if `consent` isn't `true` in the request
body — no code path persists a face descriptor without it. Verified live: an enroll-face call without
consent is rejected before any encryption or database write happens.

Withdrawal is deletion, not a separate state: there is no "consent withdrawn, data retained" state —
`DELETE /users/:id/face` clears the ciphertext, IV, auth tag, `faceEnrolled`, AND
`biometricConsentGiven`/`biometricConsentAt` in the same database update.

## 1b. Minor / parental consent

Design decision, 2026-08-28 — self-reported date of birth, not ID/document verification: real age
verification (driver's licence, passport, etc.) needs a KYC vendor or OCR pipeline, is disproportionate
engineering effort for a PoC on synthetic data, and isn't something either brief asks for. Self-reported
DOB is what virtually every consumer app actually does (Instagram, Facebook, etc. don't verify IDs
either) — the age threshold is `MINOR_CONSENT_AGE_THRESHOLD = 18` (`auth.ts`), a Team 1 default, genuinely
open to Team 2 override (tracked in `08_Requests_to_Team2.md`).

This is a different problem from third-party consent: minor consent (this section) is about whether
the *account holder themselves* is old enough to consent for themselves. Third-party consent — someone
else appearing in a photo the account holder uploads — is a separate, still-entirely-unbuilt problem; see
`08_Requests_to_Team2.md` §1 for that one. Solving this one doesn't touch that one.

Mechanism:
1. `POST /auth/register` requires `dateOfBirth`; age is computed server-side (`computeAge`), never trusted
   from a client-reported boolean — the same principle applied to biometric MFA elsewhere in this app.
2. If under threshold, `parentGuardianEmail` becomes required too. The account is created (so a real row,
   real audit trail entry, exists — not a separate "pending signup" limbo state) with `parentConsentGiven:
   false`, and a single-use, 7-day token is minted (`parentConsentTokensTable`, same shape as
   `passwordResetTokensTable`) — 7 days because a parent confirming isn't a time-pressured security action
   the way a password reset is.
3. **`requireParentConsent` middleware blocks every route that does something new or sensitive** —
   uploads, payments, the security dashboard, user management, and critically, *enrollment itself*
   (`enroll-face`, passkey/biometric-key registration, device-link-code creation) — until consent clears.
   Registration and login are deliberately NOT blocked (a gated account still gets a session, same
   philosophy as MFA enrollment not blocking registration either) — only what it can *do* with that
   session is restricted. Verified live: a registered-minor session gets `403
   PARENT_CONSENT_REQUIRED` on both a protected route and a face-enrollment attempt; after
   `/auth/parent-consent/verify` succeeds, the same session correctly falls through to the next gate
   (`403 MFA_ENROLLMENT_REQUIRED`) rather than silently granting full access.
4. Delivered by real email when an SMTP provider is configured (`lib/mailer.ts`, added 2026-09-13, same
   mechanism as password reset); `devParentConsentLink` is separately returned directly in the register
   response too, gated by the `devAuthLinksEnabled()` allow-list regardless of whether email is also sent.

Not built: re-verification if the account's *reported* age later needs re-checking, a "resend the
consent email" flow (matching password reset's own lack of one), and — deliberately — any mechanism for
the parent/guardian to later *revoke* consent once granted (mirrors this app's broader pattern of no
backup/long-tail account-recovery flows being in scope, see honest-limits §6 below).

## 2. Deletion mechanism

Two independent deletion paths, matching two different real-world "delete" requests:

### a) Delete just the biometric data (`DELETE /users/:id/face`)
Used when a user wants to stop using face-scan MFA without deleting their whole account (e.g., after
switching primary MFA to passkey-only, or explicitly withdrawing biometric consent per above).

### b) Delete the whole account (`DELETE /users/:id`)
Self-service ("delete my profile") or admin-driven. Self-service deletion is always reachable, like
consent withdrawal: it is not behind the MFA-enrollment or parental-consent gates, so an account that is
still mid-setup, or a minor awaiting a parent, can still erase itself. It does require re-entering the
current password (docs/04 R-AC-3). Deleting someone else's account is admin-only and keeps both gates.
(Until 2026-09-25 the gates applied to self-deletion too; see R-AC-3.)

Foreign-key behaviour is deliberately asymmetric, by data category:

| Related table | On user deletion | Why |
|---|---|---|
| `uploads` | `CASCADE` (deleted) | No reason to retain another user's files after they've left — nothing else references them |
| `passkeys`, `biometric_keys` | `CASCADE` (deleted) | Device credentials are meaningless without the account they authenticate. **Corrected 2026-09-26:** this row said `passkeys` cascaded, but neither key table had a foreign key at all, so every deleted account left its passkeys and phone keys behind (11 and 17 orphaned rows in the dev database). Both now have `ON DELETE CASCADE` foreign keys (`scripts/ops/migrate-account-deletion.mjs` removes existing orphans and adds them), and `DELETE /users/:id` also deletes them explicitly in the same transaction (docs/04 R-CONSENT-3) |
| `session` (signed-in sessions) | Deleted in the same transaction | A deleted account's other devices are signed out at once rather than when their sessions expire (up to 12 hours). Added 2026-09-26 |
| `payments` | `userId` → `SET NULL` (row kept, `userEmail` text column retained for attribution) | Financial records need to outlive the account for accounting/dispute purposes |
| `security_logs` | `userId` → left exactly as originally written, no foreign key at all (row kept, `userEmail` text column retained) | Audit trail integrity matters after an account is gone — an incident investigation into a now-deleted account still needs its history. This table previously used `SET NULL` like `payments`, but `SET NULL` mutates the row's stored `userId` after its tamper-evident hash was already computed, silently breaking `/security/logs/verify` on every account deletion. A hash-chained row must never change post-write, so this column deliberately isn't a live foreign key — see `04_Threat_Model_Risk_Assessment.md`, R-LOG-3 |

This is the concrete answer to brief §6's "What 'delete my profile' means" — the limit being stated
explicitly here: deleting a profile does not delete financial or audit history. If Team 2's policy
defines "delete my profile" as requiring full erasure with no exceptions, that's a conflict with standard
financial/audit retention practice worth raising with them directly.

## 3. Retention

Brief §6's retention row: Team 2 sets the retention/disposal policy per data category, Team 1 implements
the actual limits and secure disposal. Each category gets the retention behaviour that's correct for it
rather than one blanket rule — most of this app's data has a real reason to persist indefinitely:

| Data | Retention | Disposal mechanism |
|---|---|---|
| Password reset tokens | Deleted once used, or once past `expiresAt` | Implemented, running: `lib/retention.ts` purges used/expired rows on server startup and hourly thereafter. This is the one category with an unambiguous "no further purpose" point — the audit trail already records `PASSWORD_RESET_REQUESTED`/`PASSWORD_RESET_COMPLETED` separately, so the token row itself isn't forensic evidence |
| Parent/guardian consent tokens | Deleted once used, or once past `expiresAt` | Implemented, running — same job, same reasoning as password reset tokens above. Added 2026-08-28; previously the only token category the job didn't cover |
| Security/audit logs | Indefinite by default; a hard ceiling is a Team 2 policy call | Mechanism now exists and is real (`purgeAgedSecurityLogs(maxAgeDays)`), but stays inert until `SECURITY_LOGS_RETENTION_DAYS` is set — unset (today's state) means no ceiling, unchanged from before. Deletions this job performs still go through the existing deletion-audit trigger (`security_log_deletions`) like any other deletion — a policy-driven purge is tracked, not a bypass. `07_Data_Classification.md` §1 explains why this category is classified by *integrity* need, not confidentiality, which is exactly why Team 1 isn't the one who should pick the number |
| Payments | Indefinite by default; a hard ceiling is a Team 2 policy call | Same shape as security logs — `purgeAgedPayments(maxAgeDays)` exists and is real, gated behind `PAYMENTS_RETENTION_DAYS`, unset by default. Financial records typically have a regulatory retention *floor*, not a ceiling Team 1 should guess at, which is why the default stays "don't purge" until told otherwise |
| Uploads, face descriptors, passkeys | Until the user deletes them or their account | User-driven disposal, already covered above. Deliberately NOT given a Team-2-configurable ceiling like security logs/payments — an automatic ceiling here would mean silently deleting a user's own kept files without their action, a materially different (and more consequential) kind of change than trimming records with no user-facing purpose |
| Sessions | `express-session` store TTL (`app.ts`) | Already time-bounded; connect-pg-simple's own default pruning (`pruneSessionInterval`, on unless explicitly disabled — confirmed not disabled here) removes expired rows from the `session` table on its own schedule |

What's real vs. what's still a policy gap, stated precisely: every category above now has a working
disposal mechanism — the only thing genuinely still missing is the two *numbers* (security-log and
payment retention ceilings) that only Team 2's policy can supply. That's a narrower, more honest gap than
"no job exists," which was true before 2026-08-28. Verified live: seeded an aged (91-day-old) and a fresh
security-log row and payment row each; a 90-day purge removed only the aged rows, leaving the fresh ones
untouched, for both categories.

## 5. AI/ML training-data consent & deletion

The three sections above cover the live application's own account/biometric/upload data. Brief §8
separately asks for the *training-pipeline* case — consent checked at ingestion, and a deletion mechanism
that addresses (without claiming to solve) a model that's already learned from the data. That's
demonstrated two ways: a standalone PoC (`artifacts/ai-model/model_starter.py`, §5a below) on synthetic
data, and — since 2026-08-28 — a real, live-wired pipeline inside the app itself (§5b below) that trains
on genuine account activity, not synthetic data.

### 5a. Standalone PoC

Record shape: every training record carries `user_id`, `consent_id`, and `source_id` from the moment
it's created (the script's own header calls these "the three fields that cannot be retrofitted" — added
as an afterthought, they can't reconstruct which past training runs used non-consented data). A record
with no `consent_id` represents a user who never consented.

Consent enforcement point: `consent_gate()` runs before training ever sees the data — a record
without a `consent_id` is rejected there, with a reason, not silently dropped or (worse) filtered after
the fact by a step someone could forget to call. Verified live: a planted non-consented record (`user-99`)
is correctly blocked, with 10 of 11 synthetic records allowed through.

Update 2026-09-09 — `source_id` now has a real list to check against: every record has always carried
a `source_id`, but until Team 2's Acceptability Matrix arrived there was no allowed-sources list for it to
be checked against — `consent_gate()` verified *that* consent existed, not *what kind* of source was
consenting. `09_Team2_Data_Source_Acceptability_Matrix.md` §3 is that list now: each `source_id` category
this PoC's synthetic data represents maps to a matrix row with its own tier, training-consent rule, and
third-party flag. Extending `consent_gate()` to check `source_id` against the matrix (not just
presence/absence of `consent_id`) is real follow-up work this document is flagging, not yet built.

Deletion mechanism: `delete_user(records, user_id)` removes every record belonging to that user from
the corpus; the model is then retrained from the reduced corpus (10 → 8 records after deleting one user
in the demo run, retraining in well under a second). This is the correct mechanism for the part of the
brief's ask that's actually solvable: the user's data no longer influences any *future* training run or
any model retrained after the request.

The genuinely hard part, stated honestly rather than solved: what a model already deployed and served
from has learned from that user's data cannot be surgically removed without a full retrain — the brief
itself scopes this as "design an approach and state its limitations," not "solve machine unlearning," and
this PoC does exactly that rather than overclaiming. The mitigating factor specific to this PoC: it's
designed to retrain in under a minute (the brief's "one hard rule"), so "retrain from scratch on deletion"
is actually a viable operational answer here in a way it wouldn't be for a model that takes days to train
— worth stating as a real, PoC-specific mitigation rather than a universal answer to the deletion problem.

Anti-poisoning as a consent-adjacent control: `MAX_DOCS_PER_USER` caps how many records any single
consented user can contribute, so even a fully-consented account can't dominate the training corpus.
Implemented and exercised by the consent gate's code path, but not actually triggered by the demo's own
synthetic corpus (no user contributes more than 2 records against a cap of 3) — noted here rather than
left for a reader to discover, per this document's own standard of stating what's proven vs. merely built.

### 5b. Live app — the behavior-transition model

`artifacts/api-server/src/lib/behaviorModel.ts`, wired into `POST /users/me/training-consent` and `GET
/behavior/suggested-action`. Trains on the *sequence of audit-log event types* an account's activity
produces (login, upload, enroll, etc.) — never on the content of anything a user uploads, which stays
AES-256-GCM encrypted and unread by this or any model, matching this app's existing "don't decrypt data
unnecessarily" posture (see `03_Data_Flow.md`). What it predicts is deliberately modest: given an
account's most recent action (or two, see below), the most common next action across everyone who opted
in — a "suggested next action" hint, not personalisation over uploaded content.

Upgraded 2026-09-12 — 1st-order → 2nd-order Markov chain, with graceful fallback: originally predicted
from the single last event only, so two accounts sharing the same last action but arriving there via a
genuinely different history always got the same suggestion. Now tries a table keyed on the last TWO
events first (more specific evidence), falling back to the original single-event table when there's no
matching two-event context or it doesn't independently clear `MIN_DISTINCT_USERS` on its own — never a
hard failure, always a step down to the next-best evidence. The response reports which table actually
answered (`contextDepth: 1` or `2`), so a caller can see honestly which one fired rather than the upgrade
being invisible. The SAME `MIN_DISTINCT_USERS = 3` memorisation bar applies to both tables — a two-event
context is a *narrower* signal than a single event, so if anything it deserves an equal or stricter bar,
not a relaxed one. Verified live with a deliberately constructed disagreement: two groups of consented
test accounts (3 vs. 5) shared the same last event but arrived via a different one and diverged on what
came next. An account whose own last two events matched the smaller group's context exactly correctly
received that group's answer instead of the naive single-event global majority; a second account with no
matching two-event context correctly fell back to that same global majority.

Open question against the received matrix, not yet resolved:
`09_Team2_Data_Source_Acceptability_Matrix.md` §3 lists *Account and login data (name, email)*, T1, as
"Not usable for personalisation or training under any circumstance." This model trains on login/logout
*event types*, never the PII fields themselves, and only for accounts with `trainingConsentGiven`. Whether
that rule is meant to reach event-type metadata like this, or only the PII fields it names, is a genuine
ambiguity Team 1 can't resolve unilaterally — sent back to Team 2 as a direct question in
`08_Requests_to_Team2.md` §3 rather than assumed either way. If Team 2 confirms the broader reading, this
model's whole approach (training on activity patterns rather than content) would need to stop treating
login/logout as trainable signal — a materially narrower model than what's built and live today.

A dedicated consent flag, separate from `dataConsentGiven` and `biometricConsentGiven`:
`trainingConsentGiven`/`trainingConsentAt` on `users` (added to the table in §1) gates only this: whether
an account's activity may contribute to the training corpus. Using the app at all (`dataConsentGiven`) is
not the same as consenting to have your behavior fed into a model — this flag is the difference. Unlike
the other two flags, it's freely toggleable in either direction any time via `POST
/users/me/training-consent`, not a one-time or withdrawal-only choice, and toggling it logs an audit
event (`TRAINING_CONSENT_GIVEN` / `TRAINING_CONSENT_WITHDRAWN`).

Asked at registration, not just discoverable later in Settings: `POST /auth/register` accepts an
optional `trainingConsent` boolean (default `false` when omitted) alongside the existing, mandatory
`dataConsent`. Register.tsx presents it as its own, clearly-separate, unchecked-by-default checkbox —
deliberately not bundled into the single mandatory data-consent checkbox above it, and not required to
complete registration, since forcing a choice at account-creation time (or defaulting it to checked) would
undermine the "genuinely optional, no consequence either way" framing the Settings toggle already
establishes. Choosing yes at registration logs the same `TRAINING_CONSENT_GIVEN` audit event the Settings
toggle does — a grant is a grant regardless of which screen it happened on. Verified live: registering
with `trainingConsent: true` sets the flag and returns it correctly in the response; registering with
`false` (or omitting it) leaves it unset; both persist to the database exactly as requested.

Consent enforcement point — re-checked at every inference, not just at ingestion: `buildTrainingCorpus()`
selects only users with `trainingConsentGiven = true`, freshly, on every call — there is no cached
membership list and no separately-scheduled "training job" whose staleness could matter. Verified live: a
seeded test account with `trainingConsentGiven = false`, producing the exact same activity pattern as a
consented majority of 4 other test accounts, was confirmed absent from the built corpus.

Deletion mechanism — stronger than "retrain on request" as a structural byproduct, not a designed
feature: nothing is ever persisted between requests: `buildTrainingCorpus()` and `train()` both re-run
from the current `security_logs` table on every single `GET /behavior/suggested-action` call. Withdrawing
consent (or deleting the account entirely, which cannot set `trainingConsentGiven=true` on a row that no
longer exists) is complete and immediate on the very next call — there's no stale trained artifact
anywhere to separately retract, and no retraining step to remember to run.

The genuinely hard part is still genuinely hard — this doesn't change that: this compute-on-read
property is real, but it's an artifact of the model being cheap enough to rebuild from scratch on every
request, not a general solution to "unlearning." A model expensive enough to require persistent,
long-lived training (which this deliberately small, honestly-scoped model is not) would still face the
same unsolved problem the brief flags. Stated here for the same reason the PoC states its own limit in
§5a: per this document's standard of saying what's proven vs. merely built, this is a real property of
*this* model's shape, not a claim about model deletion in general.

Anti-poisoning — proven, not just implemented: `MAX_TRANSITIONS_PER_USER = 50` caps how many of one
consented user's own event transitions can enter a single corpus build — the direct live-data analog of
the PoC's `MAX_DOCS_PER_USER` (whose own cap stays unproven — its synthetic data never exceeds 2
records/user). The live app's version was pushed past its limit for real: a seeded test account with 60
raw audit-log events was confirmed to enter `buildTrainingCorpus()`'s output truncated at exactly 50, not
60 — verified against a real Postgres-backed run, not just read from the code.

Memorisation/leakage — verified live, not just implemented — `MIN_DISTINCT_USERS = 3`: a transition is
only ever surfaced as a prediction if independently observed from 3 or more distinct consented accounts.
Verified against the running server: a canary transition (`LOGIN_FACE_SUCCESS → USER_DELETED`) seeded
from exactly 1 test account was correctly refused by `GET /behavior/suggested-action` (`predictNext`
returned `null`), while a transition (`LOGIN_SUCCESS → UPLOAD_CREATED`) shared by 4 consented test
accounts was correctly surfaced — the live-data equivalent of the PoC's own canary-extraction test in
§5a.

Differential privacy — built, measured, and honestly reported as unusable at this corpus size (added
2026-09-18): `artifacts/api-server/src/lib/behaviorModelPrivacy.ts` adds a Laplace mechanism over the
transition counts, because `MIN_DISTINCT_USERS` alone is a *deterministic* bar — it withholds a count-1
cell, but an attacker who can watch cells appear and disappear as the corpus changes still learns
something from exactly where the boundary sits. DP closes that gap by making the release itself
randomised. The full sensitivity derivation, the stability-based threshold, and the ε/corpus-size
frontier are in `04_Threat_Model_Risk_Assessment.md` §2.2; what matters for *this* document is the
consent and deletion consequence:

- `train()` now enforces `MAX_CONTRIBUTED_TRANSITIONS_PER_USER = 12` distinct transitions per account,
  which is the clipping step that makes the L1 sensitivity a provable bound rather than an assumption.
  This ships **enabled**, independent of whether DP itself is switched on, and tightens the existing
  anti-poisoning story above: one account's influence on any single cell is now bounded by construction.
- The noise layer itself ships **disabled by default** (`BEHAVIOR_MODEL_DP_EPSILON` unset). This is a
  deliberate, measured choice, not an unfinished feature. At ε=1 the release threshold requires ~153
  distinct consented accounts before *any* transition is publishable; this app's consented corpus is far
  smaller, so enabling it would return `null` for every query. Turning it on would make the model look
  private while actually making it useless, which is the failure mode §6 of this document exists to
  refuse.
- `privacyReport()` states this in plain words rather than leaving an operator to work it out: given the
  current corpus and a candidate ε, it returns an `assessment` that says outright whether that
  combination is usable. A "NOT usable" verdict is a reportable result, not a bug to be hidden.

Measured, not asserted: `pnpm --filter @workspace/api-server run verify:dp` runs
`behaviorModelPrivacy.verify.ts`, which plants a single-user canary transition in a 21-account corpus and
performs 20,000 randomised releases. Across repeated runs the canary escaped in 9–23 of 20,000
(0.045–0.115%) against a 0.1% design budget — a range that brackets the 20 escapes the budget predicts,
with the spread being ordinary sampling noise (σ≈4.5 at n=20,000), not drift. The sampler's measured
variance was 31.7–31.8 against the 32 that Laplace(0, b=4) requires. The check asserts against 3× the
budget rather than the budget itself precisely so that this variance doesn't produce a failure that means
nothing. That check is permanent rather than throwaway for a specific reason: a DP guarantee is voided invisibly —
by a refactor that swaps the CSPRNG sampler for `Math.random`, or an unrelated change to `train()` that
stops enforcing the cap — and neither failure is visible to code review or to a typecheck.

Model-serving endpoint protection — two independent controls, per the brief's own wording: unlike the
PoC (a local script with no endpoint to protect), `GET /behavior/suggested-action` is a real, queryable
inference endpoint — so it's the one place in this project where "model theft/extraction via repeated
queries" is actually applicable. The brief lists "rate limiting" and "query monitoring" as two separate
things, not one, so both exist:

- **Rate limiting** — `requestRateLimit("behavior-suggested-action", 30, 5 * 60 * 1000)`, on top of
  `requireParentConsent` and `requireMfaEnrolled`. Verified live: the 31st request from one session
  inside the 5-minute window received `429`.
- **Query monitoring** — every successful call (not only ones that exceed the rate limit) writes its own
  `BEHAVIOR_MODEL_QUERIED` audit event, giving a security analyst visibility into a slow,
  under-the-limit extraction pattern that rate limiting alone wouldn't surface. Deliberately excluded
  from the training corpus and from `getLastEventType()` (`behaviorModel.ts`'s `META_EVENT_TYPES`) —
  otherwise querying the model would itself become a learned "next action," and would permanently
  blank a user's own suggestion by becoming their own most recent event on every subsequent call.
  Verified live: a real HTTP call to the endpoint was confirmed to add exactly one such row for that
  account, and a second call was confirmed to still return a real suggestion rather than nothing.

### 5c. Live app — content-based personalization (added 2026-09-11)

A third, distinct AI/ML feature from §5a/§5b above, deliberately different in shape rather than a variant
of the behavior model: `artifacts/api-server/src/lib/contentPersonalizationModel.ts`, wired into `POST
/users/me/content-personalization-consent` and `GET /users/me/content-profile`. Where §5b trains on
event-type *metadata* and pools consented users into a shared corpus, this reads upload *content* —
and deliberately never pools anything across accounts. The two differences are linked: content is more
sensitive than metadata, so the model that reads it is scoped to be strictly less shared, not more.

A third, wholly separate consent flag: `contentPersonalizationConsentGiven`/`At` on `users` — distinct
from both `dataConsentGiven` (using the app at all) and `trainingConsentGiven` (contributing event-type
metadata to the shared behavior model). Granting one says nothing about the others. Matches Team 2's
Acceptability Matrix (`09_Team2_Data_Source_Acceptability_Matrix.md` §3) principle that uploaded text needs
"explicit, per-purpose consent naming the specific use," with training consent for it as "a separate
explicit opt-in" — this flag names its specific use directly (personalization from the account's own
uploaded text), not a generic "AI features" toggle.

Scope, stated as a deliberate line, not an oversight — text uploads only: the matrix requires photos
and video to go through a distinct bystander-consent workflow ("Yes — bystanders, possibly minors... People
never agreed to this") this app has no mechanism for, and audio needs its own voice-cloning-specific
consent, "not folded into a general 'audio' consent." Text carries neither complication — no third party
is depicted the way a photo/video/audio recording of someone can be. `buildContentProfile()` filters at
the database query itself, not as a downstream check.

Extended 2026-09-18 — the scope above was only half the matrix, and the missing half was the one that
mattered. The file-type line described here was correct, but it was the *only* axis being enforced, and
the matrix is a two-dimensional table. Nothing recorded where an upload's content came from, so a
`fileType === "text"` filter admitted the uploader's own diary and an uploaded copy of a published book
on exactly equal terms — the matrix's `published_work`, `third_party_individual` and `social_media` rows
were unenforceable because the app never asked the question. `uploads.content_source` now records a
declared origin, and `lib/dataProvenance.ts` evaluates both axes together (see
`03_Data_Flow.md` §2b for the full design and `04_Threat_Model_Risk_Assessment.md` R-ML-9 for the risk
framing). The consent consequence for this section specifically: an account's explicit
`contentPersonalizationConsentGiven` is necessary but **no longer sufficient** — consent from the
uploader cannot authorise training on content whose rights belong to someone else, which is Team 2's own
note on the incidental-IP row ("copyright risk here is independent of anyone's consent status") applied
as a rule rather than quoted. Undeclared uploads default to `unspecified` and are excluded from training
until a source is declared, which keeps the existing corpus out rather than grandfathering it in on an
assumption. This reading is sent back to
Team 2 for confirmation in `08_Requests_to_Team2.md`, the same pattern used for every other Team-1-assumed
scope line in this project.

Consent enforcement point: `buildContentProfile()` checks `contentPersonalizationConsentGiven` fresh
from the database as the very first step, before any upload is even queried — a non-consented account gets
an empty profile (`keywords: [], documentsConsidered: 0`), not an error, matching this app's established
"refuse gracefully" pattern (`predictNext()` returning `null` in §5b).

Deletion mechanism — the same structural property as §5b, now for content instead of metadata: nothing
is persisted beyond the encrypted uploads that already exist: every call decrypts the account's own text
uploads in memory, computes keyword frequencies, and discards the plaintext — there is no stored "AI
profile" row anywhere to separately delete. Withdrawing consent, or deleting the uploads themselves via the
existing `DELETE /uploads/:id`, is complete and immediate on the very next `GET
/users/me/content-profile` call. Verified live: a profile built from 2 seeded text uploads correctly
surfaced their real keywords (`"photography"` and `"hiking"` ranked highest, matching the seeded content's
actual word frequencies); withdrawing consent returned the profile to `{keywords: [], documentsConsidered:
0}` on the very next call, with no stale or cached result.

Anti-poisoning is not the relevant frame here, stated explicitly rather than silently applying it
anyway: `MAX_DOCUMENTS`/`MAX_CHARS_PER_DOCUMENT` bound how much work one profile build does, but this is
a cost bound, not a fairness/poisoning defense — there is no shared corpus for one account's data volume to
dominate or poison against another account's. Naming this distinction explicitly rather than reusing §5b's
poisoning language for a case it doesn't actually apply to.

Model-serving endpoint protection — same two controls as §5b, applied here too: `GET
/users/me/content-profile` is gated by `requireParentConsent`, `requireMfaEnrolled`, and
`requestRateLimit("content-profile", 30, 5 * 60 * 1000)`. Every successful call also writes a
`CONTENT_PROFILE_QUERIED` audit event, verified live to record an accurate keyword/document count on every
call — arguably more warranted here than in §5b, since this is the one endpoint in the app whose queries
correspond to decrypting real content server-side.

The genuinely hard part is smaller here than in §5b, for a structural reason worth stating plainly:
because this model is never pooled or shared, there is no cross-account "what has the shared model already
learned from this person" question at all — withdrawing consent doesn't need to reason about anyone else's
exposure, only this one account's own data, which the compute-on-read design already handles completely.
This is a genuine, structural simplification, not an oversight in scope — the tradeoff for it is that this
model can never benefit from other users' patterns the way §5b's shared corpus can.

Scoring upgraded 2026-09-11 — TF-IDF over unigrams and bigrams, not plain term-frequency: the original
version ranked purely by raw word count, which meant a word an account used constantly across every single
document (high frequency, but not actually distinctive to anything) could outrank a word concentrated in
one specific document about one specific thing. TF-IDF corrects this: a term's weight is its frequency
multiplied by an inverse-document-frequency factor that discounts terms appearing in most/all of the
account's own documents. Bigrams (adjacent word pairs, e.g. "landscape photography") are extracted from
genuinely adjacent tokens in the source text — not reconstructed after stopword removal, which would risk
joining words that were never actually next to each other. Verified live: given two terms with identical
raw occurrence counts across a 3-document corpus, the term confined to a single document scored
meaningfully higher than the term spread across all three, isolating and confirming the IDF effect itself,
not just that the feature still produces output. Consent model, scope (text-only), and deletion behaviour
are all unchanged by this — only the ranking mathematics improved.

## 6. Honest limits (per the brief's "design an approach and be honest about its limits" instruction)

1. No model to un-learn from — in the live app: the web/API application itself still doesn't train a
   model (face-api.js is pretrained and client-side only), so this specific problem doesn't apply to it.
   A separate, standalone PoC now exists for the training-pipeline case specifically — see Section 5
   below — and it does **not** claim to solve machine unlearning either; it demonstrates the mechanism
   the brief actually asks for (remove + retrain) and states the same limitation the brief names
   explicitly, honestly, rather than avoiding the question by not building anything.
2. Withdrawing biometric consent doesn't preserve access unless a passkey is also enrolled:
   `requireMfaEnrolled` accepts either face or passkey (see `04_Threat_Model_Risk_Assessment.md`), so
   withdrawing the face descriptor only blocks access again if it was the account's only enrolled
   factor. An account with both loses face and keeps working on the passkey alone; an account with only
   face is routed back to `/enroll` until it enrolls something.
3. Backups are out of scope: this PoC has no backup/restore mechanism, so "does deletion also purge
   backups" isn't an answerable question here — a real deployment with backups would need an explicit
   retention/purge policy for them too.
4. Consent timestamps are evidence of consent, not a legal consent-management system:
   `dataConsentAt`/`biometricConsentAt` support answering "did this user consent, and when" for an audit,
   but this PoC has no versioned consent-text/policy tracking (e.g., which version of the privacy policy
   they consented to) — a real system handling actual personal data would need that, and it's Team 2's
   policy question to answer before Team 1 could build it.

## 7. Privacy policy, acknowledgement and data export (added 2026-09-26)

The privacy policy is served at `/privacy`, readable without an account and linked from the login and
registration pages (web) and the mobile login screen. Its text is Team 2's draft of 23 September 2026,
corrected by Team 1 so every statement matches the app; the corrections are listed in
`08_Requests_to_Team2.md` §5c for Team 2 to accept or revise. Text: `artifacts/secureai/src/lib/privacyPolicy.ts`.

- **Who was shown which version.** Registration sends the version the form showed; the API records it as a
  `PRIVACY_POLICY_ACKNOWLEDGED` audit event (`version=…; via=registration`). Anyone signed in whose last
  acknowledged version is not the current one sees a notice on every page until they acknowledge it
  (`via=notice`). Keeping this in the hash-chained audit log makes the record tamper-evident and needs no
  schema change per version. The web text and the API's `PRIVACY_POLICY_VERSION` must match, and
  `scripts/check-privacy-policy-version.mjs` fails CI if they don't, so nobody is recorded as having seen
  text they weren't shown. An acknowledgement is notice, not consent: consent stays the separate,
  purpose-specific choices in §1.
- **Data export (policy §11; APP 12, GDPR arts. 15 and 20).** `GET /users/me/export` returns one JSON file:
  account, consents, sign-in methods, uploads (content included up to 25 MB in total), payments, the
  account's own security events (most recent 5,000, with IP address and browser) and policy status. The
  face template is described but deliberately not included, since a copy in a file is only another place
  it could leak; the password hash is not included. 5 exports per hour; each is audit-logged as `DATA_EXPORTED`.
  Available from Security Settings and the policy page.
- **Open to every signed-in account**, like consent withdrawal (R-CONSENT-2): an account still setting up
  sign-in or awaiting a parent can read, acknowledge and export.
