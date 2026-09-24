# Requests to Team 2 (Ethics & Governance)

Every Team 1 doc in this folder that says "Team 2's policy doesn't exist yet, so we assumed X" is
collected here as one list, organized against Team 2's own brief so each item maps to whichever of
*their* deliverables should answer it. Nothing here is new work — it's the accumulated open questions
from `02`–`07`, made concrete enough to actually send.

For each item: **the current default** (what Team 1 built/assumed in the policy's absence) and **the
ask** (what would change if Team 2 decides differently). Where Team 2's own brief already gives a partial
answer (their worked example, their illustrative matrix), that's noted — but their brief explicitly calls
those illustrative, not final, so they're listed as open regardless.

## 0. Coordination interface — confirmed aligned

An earlier version of this document flagged a possible mismatch (Team 1's brief lists Retention as its
own §6 row; a shorter version of Team 2's brief didn't). Resolved against Team 2's full elaborated brief
(§10): both teams' coordination tables now match exactly, seven-for-seven — Data classification, Consent,
Deletion/erasure, Access control, Audit logging, Data provenance, Retention, each with the same
policy/enforcement split on both sides. Nothing to resolve here; noted only so it doesn't get re-raised.

## 1. For the Privacy & Consent Framework

The gap that matters most: third-party consent has no technical mechanism at all yet, not even a
placeholder. This is explicitly in scope for Team 2 twice over — both as one of the three things that
make the app *ethically tricky* ("a user can only consent to their own data... your consent and
acceptability frameworks must confront this directly") and as a literal Requirements §2 bullet ("Handle
consent per data category... and address third-party consent where a user's upload contains other
people"). The current consent model (`05_Consent_and_Deletion_Design.md` §1) only ever captures the
*uploading* user's own consent (`dataConsentGiven`, `biometricConsentGiven`). There is currently no
concept of "this photo contains a bystander who hasn't agreed to anything" anywhere in the schema, the
upload flow, or the biometric-enrollment flow. This isn't a partial implementation to harden — it's a
genuinely open question with zero technical scaffolding, and it's squarely Team 2's brief to answer
first: **what should the app even ask, or refuse, when a user uploads a photo/video containing other
identifiable people?** Options range from "out of scope for this PoC, state the limitation" to "a
consent-gate question at upload time" to "face-detection-based redaction before storage" — each has a
very different build cost, so the policy call needs to come before Team 1 picks one.

Consent granularity: current default is two independent flags, general account data and biometric data
(`05` §1's table). If Team 2's Privacy & Consent Framework wants finer-grained categories (separate
consent for uploads vs. account data vs. payment data, matching Team 2's own §3 "separate consent per
data type" instruction), that's a schema change worth doing once, not per-category as each gets asked
for — better to get Team 2's full category list up front.

Versioned consent: current default is a single boolean + timestamp per category, no record of *which
version* of a privacy notice/policy text the user was shown when they consented. If the Privacy &
Consent Framework produces actual policy text, `05` §6.4 already flags this as needed and unbuilt.

Training-specific consent, separate from storage consent, is now built and live, not just PoC'd: Team
2's brief explicitly asks for consent "separately for training" (§3), and this now exists for real:
`trainingConsentGiven` on `users`, a flag entirely separate from `dataConsentGiven`. Askable at two points:
optionally at registration (`POST /auth/register`'s `trainingConsent` field, unchecked by default, not
required to complete registration), and freely toggleable in either direction afterward any time via
`POST /users/me/training-consent`. Gates the live behavior-transition model described in `05` §5b and
`03_Data_Flow.md`. The standalone PoC (`artifacts/ai-model/model_starter.py`) still separately proves
the same consent-gate pattern (`consent_id`, `05` §5a) on synthetic data. One scope note for Team 2: the
live version deliberately trains on *behavioral metadata* (the sequence of audit-log event types an
account produces — login, upload, enroll, etc.), not on the *content* of uploaded files, which stay
AES-256-GCM encrypted and unread by any model. If Team 2's framework anticipates training on upload
*content* specifically (the brief's literal "user uploads" framing), that remains the unbuilt,
assumed-only pipeline in `03_Data_Flow.md`'s "Assumed" subgraph — a materially bigger scope than what's
live today, since it would require this app to decrypt and process file content it currently never
touches server-side.

Minor/parental consent — now built, age threshold is the open part: neither brief names this
explicitly, but it's adjacent to Team 2's consent and third-party-consent scope, so flagging it here
rather than assuming it's out of scope entirely. `05_Consent_and_Deletion_Design.md` §1b: self-reported
date of birth at registration; under a threshold, a parent/guardian email must confirm via a link before
the account can do anything (uploads, payments, even enrolling a biometric factor — not just a soft
block). The threshold itself (`MINOR_CONSENT_AGE_THRESHOLD = 18` in `auth.ts`) is a Team 1 default, not a
researched policy position — if the Privacy & Consent Framework lands on a different number (or a
two-tier scheme, e.g. under-13 blocked outright vs. 13–17 parent-gated), that's a one-line change.

## 2. For the Data Governance Policy

Retention windows: current default, per `05_Consent_and_Deletion_Design.md` §3, is that password-reset
tokens auto-purge (the one category with an unambiguous "no further purpose" point); security logs and
payments are kept indefinitely, deliberately, because Team 1 didn't think it was Team 1's place to invent
a number. If the Data Governance Policy sets actual retention ceilings for any category, `retention.ts`
is a five-minute change to extend — the reasoning for *why* nothing's there yet is already written down,
Team 1 is just waiting on the number.

**"Delete my profile" — does it really mean full erasure, no exceptions?** Current default (`05` §2):
deleting an account keeps payment records (`userId` → `SET NULL`, `userEmail` retained for accounting)
and audit-log entries (same pattern, plus a hash-chain integrity reason those specifically can't use
`SET NULL` — see `05`'s table). This is standard financial/audit-retention practice, but if the Data
Governance Policy defines "delete my profile" as truly total erasure, that's a direct conflict worth
resolving explicitly rather than Team 1 assuming the standard-practice reading is what was meant.

**Refund-eligibility threshold** (Governance § "admin/developer duties" adjacent). `04_Threat_Model...md`
(the refund-fraud analysis) flags that a real refund control needs a policy threshold — e.g., no
auto-refund once premium features were already consumed that billing period — and explicitly calls this
"a policy decision Team 2 would own." No refund flow exists yet at all, so this only matters once one's
being built, but worth having the number ready rather than inventing one under deadline pressure.

## 3. For the Data Source Acceptability Matrix / Data Provenance & Source Governance Framework

Received 2026-09-09: Team 2's actual Week 5-6 Acceptability Matrix (Privacy tiers, copyright risk
levels, and the full data-type table) has arrived and is transcribed in full in
`09_Team2_Data_Source_Acceptability_Matrix.md`. This closes the specific gap this section flagged — no
allowed-sources list existed for `consent_gate()` to check against; now one does. (§6 below names the
one item that was ever formally called a hard blocker on further build work, and this wasn't it — that
was always §1's third-party-consent question. This section was still a real, useful gap to close, just
not the blocking one.)

Enforced in code from 2026-09-18. Receiving the list and acting on it are two different things, and for
nine days this section recorded only the first. Team 1's half of brief §6's provenance row ("records
origin; validates inputs") now exists: `uploads.content_source` records a declared origin per file and
`artifacts/api-server/src/lib/dataProvenance.ts` turns the matrix into rules the content-personalization
pipeline evaluates, each rule citing the matrix row it was read from. Worth stating plainly because it
is the kind of gap that hides well: the matrix had been transcribed into the repo, referenced from three
other documents, and cited in the risk register — none of which is the same as a line of code checking
it. See `03_Data_Flow.md` §2b and `04_Threat_Model_Risk_Assessment.md` R-ML-9.

What it confirms Team 1 already got right, independently:
- Device-native biometric (T3): "excluded from training or personalisation entirely, by design" —
  matches the live app exactly; the face descriptor never enters `behaviorModel.ts` or any training path.
- Subscription/payment data (T2): "Not used for training" — already true; `paymentsTable` data is never
  read by any model.
- The deceased-person case (third-party content uploaded by a user) is named as categorically different
  from ordinary third-party consent ("consent isn't pending, it's permanently out of reach") — this
  confirms Team 2 treats it as a governed, high-risk data-provenance case, not an overlooked gap.
  Separately, the matrix's "AI-generated outputs" row states an actual policy position on impersonation
  risk generically ("Needs to be labelled as AI-generated") — this is the stated position §5 below asked
  whether Team 2 wanted to provide, and it answers that ask: label AI-generated content, with no separate
  carve-out needed for deceased or public figures specifically. See §5 below for the update.

One genuine clarifying question this raises against the live AI/ML feature, sent back to Team 2 rather
than assumed either way: the matrix lists *Account and login data (name, email)*, T1, as "Not usable
for personalisation or training under any circumstance." The live behavior-transition model
(`behaviorModel.ts`) trains on the *sequence of audit-log event types* an account produces (e.g.
`LOGIN_SUCCESS → UPLOAD_CREATED`) — never the name, email, or any other PII field itself, and gated
behind its own separate `trainingConsentGiven` opt-in (`05` §5b). Does "account and login data" mean the
PII fields specifically (which the live model already avoids entirely), or does it extend to *any*
login-derived signal, including behavioral/event-type metadata with no PII in it? If the latter, the
live behavior model's whole approach — training on activity patterns rather than content — would need to
stop treating login/logout events as trainable signal, which is a materially different, narrower model
than what's built and live today. Team 1's own reading, stated for Team 2 to correct rather than left
implicit: the rule is about the PII fields (name/email), not about excluding login as a *behavioral
event type* from an already-opt-in, already-anonymised-of-content signal — but this is Team 2's call to
confirm, not Team 1's to assume.

A second, closely related but distinct design assumption, added 2026-09-11 with the new login-risk
model (`lib/loginRiskModel.ts`, see `04_Threat_Model_Risk_Assessment.md` R-AUTH-7): this model scores
each login attempt (new IP, new device, rapid IP change) against that SAME account's own login history —
never pooled across accounts, never shown to or trained into anything any other user sees. It is
deliberately NOT gated behind `trainingConsentGiven`, on the reading that this is fraud/account-security
scoring — the same category as password hashing or rate limiting, which also don't ask for a separate
opt-in — not the personalisation the matrix's "Training Consent" column is about. Team 1's reasoning
mirrors how GDPR Recital 47 treats fraud prevention as a distinct legitimate interest from consent-gated
processing, but that's a legal analogy Team 1 is applying, not a confirmed policy position. Does the
matrix's "Account and login data... not usable for personalisation or training under any circumstance"
rule intend to also cover this kind of per-account, non-pooled security scoring, or is that understood to
be a different category entirely (the way device-native biometric MFA is already carved out as
"authentication-only consent... not used for training")? If the matrix intends the broader reading, this
feature would need to become opt-out-only-with-a-policy-exception, or be redesigned around explicit
consent — a real, buildable change, just not one Team 1 should guess at silently.

Also worth flagging: the delivered matrix doesn't carry the `Train?` / `Personalise only?` two-column
split this document previously anticipated from Team 2's elaborated brief: the received matrix has a
single "Training Consent" column per row, not separate train-vs-personalise-only settings. Team 1 reads
this as the distinction not being part of the final matrix (rather than an oversight), and has built
accordingly — there's still exactly one training mode (contribute to the shared model, gated by consent),
no "personalise-only, never leaves this session" mode. Flagged here so it's an explicit, confirmable
reading rather than a silent assumption, in case a "personalise only" mode is still coming separately.

Update 2026-09-11 — a real "personalise only, never leaves this session" mode now exists, for one data
type: `lib/contentPersonalizationModel.ts` reads a consented account's own uploaded TEXT content
(diaries/documents) to build a private keyword-frequency profile, gated by its own dedicated consent flag
(`contentPersonalizationConsentGiven`), never pooled or shown to any other account — exactly the shape the
matrix's anticipated-but-not-delivered "Personalise only?" column would have described, built for text
specifically because it needed it least controversially: no third party is depicted the way a photo, video,
or audio recording of someone can be, so it sidesteps the bystander-consent and voice-cloning-consent
questions those categories carry in the matrix (§3, "Uploaded photos" / "Uploaded video" / "Uploaded audio
/ voice" rows). Photos, video, and audio are deliberately NOT read into this model — building that would
mean building past the bystander/voice-consent workflows the matrix requires but this app doesn't have.
Two things worth Team 2 confirming rather than assuming: (1) is text-only the right place to start, or
should the personalise-only mode also cover other types once their consent workflows exist; (2) does a
single account-level `contentPersonalizationConsentGiven` flag satisfy "explicit, per-purpose consent
naming the specific use," or does the matrix intend consent scoped per upload (e.g. per-document opt-in)
rather than per-account.

## 4. For the Data Classification scheme

`07_Data_Classification.md` is Team 1's own stated assumption (per that doc's own framing, written
*because* Team 2's scheme doesn't exist yet), not a request to build something new — but three specific
questions in it are genuinely Team 2's call, not Team 1's, and are called out explicitly in that doc's
§3:

1. Should uploaded file *content* be classified per-file (e.g. a photo containing a government ID vs. a
   meme), or is uniform treatment by file type acceptable?
2. Should the two very different "biometric" mechanisms (server-stored face descriptor vs. device-only
   Keystore key, which materially differ in actual exposure — see `07` §3.2) be split into separate
   tiers?
3. Is "Operational" tier data (role, timestamps, subscription plan) correctly scoped as "access-controlled
   but not additionally encrypted," or does the classification policy want it treated more strictly?

## 5. For the Ethics & Governance Framework / Responsible AI Framework

The face-verify MFA departure has a privacy dimension, not just a security one: `04_Threat_Model...md`
§0 documents that this app deliberately keeps server-side biometric storage (an encrypted face
descriptor) even though the current brief's device-native-only decision says biometric data shouldn't be
held server-side at all. Team 1's reasoning there is entirely security/UX-focused (device coverage,
demonstrating the harder threat model). What it doesn't address, because it isn't Team 1's call: does
storing biometric data server-side — even encrypted, even consented — trigger a different tier of
obligation under the Australian Privacy Principles' "sensitive information" category, or under GDPR's
special-category-data rules, than the device-native design assumes? Team 2's own elaborated brief (§9)
already flags that the APPs "note biometric and other data treated as sensitive information," so this
question is already squarely inside their Regulatory Compliance Assessment's scope, not a stretch — and
the answer might independently push back on the security team's own "keep it" decision from a completely
different direction than the security tradeoffs that motivated it.

Impersonation, including deceased or public figures: Team 2's elaborated brief (§6) explicitly widens
this beyond living non-consenting third parties to "deceased or public figures the user might feed in" —
a real, distinct sub-case Team 1's docs hadn't separately named. This app doesn't train a generative model
in its live form (face-api.js is a fixed, pretrained comparison model, not a generator), so there's no
voice/face-cloning capability to govern *today* — but if the Responsible AI Framework wants a stated
position anyway (e.g., "if a generative capability were added, here's the principle, including for
deceased/public figures specifically"), that's worth a line in `03_Data_Flow.md`'s existing "documented as
an assumption, not implemented" pattern for exactly this kind of conditional risk.

Update 2026-09-09 — the received Acceptability Matrix (`09_...md` §3) answers this: its
"AI-generated outputs" row states the policy directly: such outputs carry an "impersonation risk" and
"need to be labelled as AI-generated" — a general rule that covers deceased/public figures without
requiring a separate carve-out for them. Separately, its "third-party content uploaded by a user" row
confirms deceased-person source material itself is governed as a high-risk, third-party-implicated data
category ("consent isn't pending, it's permanently out of reach"), distinct from ordinary pending
consent. Read together: no separate deceased/public-figure policy is needed — the general
AI-generated-content labelling rule and the general third-party data-governance rule already cover this
case. There is still nothing to *build* today (no generative capability exists in the live app), but the
open question above is now answered rather than pending; the `03_Data_Flow.md` "documented as an
assumption, not implemented" line is still worth adding so the labelling rule is captured for whenever a
generative capability is added.

Admin/developer governance duties: Team 2's brief (§5) asks them to "define governance responsibilities
for administrators and developers." Team 1 has four roles (`user`/`admin`/`security_analyst`/
`it_support`) — `admin` is currently a full superset of every other role's rights, including audit-log
visibility (changed 2026-08-28 from an earlier, stricter design that kept admin and security_analyst
disjoint as a separation-of-duties control — see `04_Threat_Model...md` R-AC-4 for the reasoning both ways
and how to revert it). That's Team 1's own security-driven design choice either way, not derived from a
Team 2 governance policy. Worth confirming whether Team 2's intended role scope/duties for admins expects
that kind of separation or not, since it directly affects whether R-AC-4 should stay accepted or get
re-closed.

## 6. What Team 1 is *not* asking for

Not every "Team 2 decides" line in either brief needs a response before Team 1 can keep working — most of
what's above already has a working, documented default in place. The one item that genuinely blocks
further build work is §1's third-party-consent question: everything else here can proceed on the stated
assumption and just get updated if Team 2's actual policy differs.
