# 11. Responsible AI Governance

Team 1's response to Team 2's Weeks 7-8 milestone, *Responsible AI and Governance, and Accountability*,
and its companion list of 20 common elements drawn from the DTA policy, Australia's AI Ethics
Principles, the Voluntary AI Safety Standard (10 guardrails), the National AI Centre's adoption
guidance, ASD's *Engaging with AI* and the OAIC's two AI privacy guides. Like Team 2's own document,
this is not legal advice.

What is built lives in the app, not only here:

| Where | What |
|---|---|
| `/ai` — *How SecureAI uses AI* (public) | The AI system register, and the form to challenge a decision |
| `/ai-oversight` (security analysts, administrators) | Outcome monitoring, model switches, the challenge queue |
| `/ai-security` (signed-in users) | The team's AI attack proof-of-concepts and the same attacks run against the live model |
| `artifacts/api-server/src/lib/aiSystems.ts` | The register itself: one source for the page, the API and this document |
| `artifacts/api-server/src/lib/aiGovernance.ts` | Switches, challenges and monitoring, stored in the hash-chained audit log |

## 1. The AI systems

SecureAI uses AI in six places. None of them deletes, locks or charges anything on its own. The one
that can refuse something, face matching, always has an alternative: a passkey, and a person who can
reset a second factor.

| System | What it decides | Data | Human control | Switchable |
|---|---|---|---|---|
| Face matching (face-api.js) | Whether a face scan matches the enrolled face (distance < 0.6); a miss refuses that attempt only | Camera image in the browser only; encrypted 128-number template, with biometric consent | Face is optional (passkey instead); staff MFA reset; failure and threshold-probing alerts | No — per person instead (see §2) |
| Blink check (landmark model + rule) | Whether a face scan may go ahead | Camera frames in the browser only | Passkey alternative; nothing recorded against the person | No — part of the face scan |
| Sign-in risk check | Whether to warn the person and flag the sign-in; never blocks | The account's own sign-in history | Warnings advisory; flags reviewed by analysts | Yes |
| Suggested next action (Markov model) | Nothing — a hint on the dashboard | Activity types from accounts that opted in; 3-account minimum | Every query audited; consent withdrawable | Yes |
| Personal topic profile (TF-IDF) | Topic words in the person's own profile | Their own text uploads marked as own work, with separate consent | Only they see it; consent withdrawable | Yes |
| Security anomaly alerts | Nothing about any account — alerts staff | Audit-log events | Every alert goes to a person | No — it is itself an oversight channel |

The full entry for each system (purpose, why AI is the right tool, where it runs, known limits, risk
register references) is on `/ai` and in `lib/aiSystems.ts`.

## 2. Accountability and human oversight

**Accountable owner for all six systems: Prafful Choudhary, Team 1 lead** — the person answerable for
their outcomes, with authority to intervene (guardrails 1.1 and 5.1). It is one constant,
`ACCOUNTABLE_OWNER` in `lib/aiSystems.ts`; changing the lead is a one-line edit that updates the
public page too.

**Oversight roles.** Security analysts review sign-in flags, anomaly alerts and challenges.
Administrators can also switch models off. IT support can reset a person's second factors after
checking who they are.

**Switches.** An administrator can switch off the sign-in risk check, suggestions and personalisation
from `/ai-oversight`, with a reason of at least 10 characters. The switch takes effect within five
seconds:

| Switched off | Effect |
|---|---|
| Sign-in risk check | Sign-ins are not scored, no warnings shown, nothing flagged |
| Suggested next action | The model is not trained or queried; the dashboard says suggestions are off |
| Personal topic profile | No uploads are decrypted or read; the profile says personalisation is off |

Each change is an `AI_SYSTEM_TOGGLED` event in the hash-chained audit log, recording who, when and why,
so the record is tamper-evident without a separate table. The public page shows that a system is off
and since when, but not who switched it or why; the staff view shows both.

Face matching and the blink check are deliberately **not** switchable globally: switching them off
would stop every face-only sign-in at once. Oversight there is per person — the passkey alternative,
and a staff MFA reset. The anomaly alerts are not switchable because they are themselves the channel
that puts a person in the loop.

## 3. Challenge and remediation

Anyone signed in — including an account that has not finished MFA setup, or a minor awaiting a parent,
since a person the face model fails is exactly who needs this — can challenge an AI decision from `/ai`.
Every AI label in the app links there, and the sign-in warning links straight to a pre-filled
challenge.

1. The person picks the system, says what happened, and can add when (letters, numbers and basic
   punctuation only, so nothing in it can be mistaken for part of the record's structure).
   Five challenges per account per hour.
2. It lands in the queue on `/ai-oversight` as `AI_DECISION_CHALLENGED`.
3. **Acknowledgement, within Team 2's response target.** Team 2 set the target on 2026-09-26 (Gillian
   Habgood): acknowledge a challenge within 1–2 business days and tell the person how it will be
   investigated; how long the investigation takes depends on the challenge, so it has no fixed target.
   SecureAI uses **2 business days** (`CHALLENGE_ACKNOWLEDGE_BUSINESS_DAYS`), counted Monday to Friday on
   the Melbourne calendar; public holidays are not excluded. Each challenge carries its acknowledge-by
   date, shown to the person and to staff. A security analyst or administrator acknowledges it with a
   note on how it will be investigated (`AI_CHALLENGE_ACKNOWLEDGED`), which the person sees. A challenge
   still waiting after its date is marked **Overdue** in the queue and raises a security-dashboard alert.
4. A security analyst or administrator records **upheld** (the AI got it wrong) or **not upheld**,
   with a note the person sees (`AI_CHALLENGE_RESOLVED`). A challenge can be resolved once; resolving
   it also answers it, so a challenge resolved before being acknowledged is not overdue.
5. The person sees each step under *Your challenges*: received (with the acknowledge-by date), under
   investigation (with the acknowledgement note), then the outcome and note.

Remedies available to the reviewer today: an MFA reset (face or passkey), explaining the
passkey alternative, re-enrolling the face, switching a model off, and recording the case for the
monitoring below. **Response target: to be set by Team 2** — the queue shows each challenge's age so a
target can be measured once agreed.

## 4. Monitoring

`/ai-oversight` shows, for the last 7 and 30 days:

| Measure | What to watch for |
|---|---|
| Face scans, and the share refused | A rising refusal rate can mean the model is failing some people — read the face challenges |
| Password sign-ins, and the share flagged | A jump in flags usually means a network change (VPN, carrier), not an attack wave |
| Suggestions requested, and the share shown | Few shown means little opted-in data; a sudden change deserves a look for coordinated accounts (R-ML-3) |
| Topic profiles built | Use of the one feature that reads upload content |
| Security alerts sent | Anomaly alerts pushed to staff |
| Challenges filed | People disputing AI decisions |

The attack-resistance checks on `/ai-security` re-run against the live model on every visit.

## 5. Face matching: accuracy, fairness and supplier record

**What is known.** face-api.js 0.22.2 (MIT licence, author *justadudewhohacks*). Its README states the
recognition network is a ResNet-34-like model equivalent to dlib's, with weights trained by dlib's
author, and reports 99.38% accuracy on the LFW benchmark; the tiny face detector was trained on about
14,000 images and the 68-point landmark model on about 35,000. The library has had no release since
2020.

**What is not known.** Accuracy and fairness on SecureAI's own users have **not** been measured.
Doing so needs a demographically labelled set of consented face images; the project's ground rule is
synthetic data only, and the app deliberately collects no demographic data. LFW itself is widely
documented as demographically unbalanced, so the 99.38% says little about any particular group. The
0.6 match threshold is the library's default, not calibrated here. This is recorded as R-ML-10 rather
than papered over.

**What limits the harm.** The review found the web app made face enrolment effectively mandatory: a
new account had to enrol a face before a passkey was even offered, although the server has always
accepted either factor. Anyone the model could not enrol, without a camera, or unwilling to give
biometric consent was locked out of setup. Fixed 2026-09-25: the face step offers *"Can't use a face
scan? Set up a passkey instead"*, passkey-only accounts go straight to the dashboard, and face can be
added or removed later in settings. Together with the staff MFA reset, no one depends on the face model
to use SecureAI.

**Supplier integrity.** The seven model files are vendored in `artifacts/secureai/public/models/` from
a pinned commit (not fetched from a CDN at runtime), and their SHA-256 hashes are recorded in
`artifacts/secureai/face-model-weights.sha256`. CI runs `sha256sum -c` on every push, so a silently
swapped weight file fails the build. Regenerate the hash file only when deliberately re-pinning.

**What a real evaluation would need.** A consented, demographically labelled face set (or a licensed
synthetic one), false-accept and false-reject rates per group across a range of thresholds, and a
decision on the threshold from those numbers. Until then, the monitoring above (refusal rate plus
face challenges) is the operational signal.

## 6. Transparency and explanations in the app

| Where | What the person sees |
|---|---|
| Sign-in face step | "AI face matching" label; "if it doesn't recognise you, use your passkey instead" |
| Face mismatch | That the face-matching model did not recognise the scan, and to try in even light or use the passkey. The match distance is never shown, since it would help someone probing the threshold |
| After a flagged sign-in | A dashboard warning labelled "Automated check", naming what it saw (a new network, a new device, a network change shortly after another sign-in, an unusual time) with a link to challenge it. Until now the API produced this warning but no screen showed it |
| Dashboard suggestion | "AI suggestion" label; says so when an administrator has switched it off |
| Settings: face, training, personalisation | AI labels linking to each system's entry |
| Uploads | "Automated monitoring" label: bursts alert staff; it never reads, blocks or deletes files |
| Sign-in page | Link to *How SecureAI uses AI* |

## 7. Operator guide (AI literacy)

For administrators and security analysts:

- **Face refusals and challenges.** Check the person's identity through the usual support channel,
  then offer a passkey or an MFA reset. Treat several face challenges from different people as a
  signal that the model is failing a group, not as isolated cases.
- **Sign-in flags.** A flag is a prompt to look, not proof of compromise. VPNs and mobile networks
  cause most of them. Use the audit log to compare with the account's history.
- **Suggestions.** They carry no authority and cannot act. If they start steering people somewhere
  odd, suspect coordinated accounts (R-ML-3): switch suggestions off with a reason, then investigate.
- **Switching a model off.** Write the reason for the next person reading the audit log, not for
  yourself. Switch it back on the same way.
- **Resolving a challenge.** Upheld means the AI got it wrong. The note is shown to the person: say
  what you found and what you did, in plain words.
- **What the models cannot do.** None of them can see file contents except the personal topic
  profile (own text, own consent); none of them makes a decision a person cannot review.

## 8. Team 2's 20 elements

| # | Element | SecureAI | Evidence |
|---|---|---|---|
| 1 | Risk management | AI risks rated in the register, including harms to people, not only attacks | docs/04 R-ML-1…11, R-BIO-1, R-ADV-1 |
| 2 | Accountability | Named accountable owner for every system, with authority to intervene | §2, `/ai` |
| 3 | Human oversight | Switches, staff MFA reset, analyst review of flags, alerts and challenges | §2, `/ai-oversight` |
| 4 | Privacy protection | Per-purpose consent, encryption, 3-account threshold, optional differential privacy, immediate withdrawal. Team 2 confirmed (2026-09-26) that stored face templates are sensitive information under the Privacy Act even when encrypted; the face-consent wording and the privacy policy now say so, with the purpose, the US storage and the passkey alternative | docs/05, docs/07, docs/08 §5, R-CONSENT-1, R-ML-5…7 |
| 5 | Cybersecurity | Attack tests re-run live; rate-limited, audited model endpoint; supply-chain checks | `/ai-security`, docs/04 |
| 6 | Transparency | Public register; AI labels wherever AI output appears | §6, `/ai` |
| 7 | Explainability | Sign-in warnings name their reasons; face failures explain themselves; suggestions show their basis | §6 |
| 8 | Fairness | Face optional with a passkey alternative; limits stated; unmeasured accuracy recorded honestly | §5, R-ML-10 |
| 9 | Safety and reliability | Models decline to answer on thin evidence; nothing irreversible is automated | §1 |
| 10 | Testing and assurance | Attack suites, PoC results checked in CI, API and browser suites | `/ai-security`, CI |
| 11 | Accuracy of outputs | Face accuracy not measurable under project rules; monitored operationally | §4, §5 |
| 12 | Data quality and governance | Content-source declaration, consent gating, per-account caps | docs/09, R-ML-9 |
| 13 | Legal compliance | Partly: a draft privacy policy is published at `/privacy` (2026-09-26; Team 2's text corrected to match the app, with version acknowledgement and data export). Legal review not started | docs/10, docs/08 §5c |
| 14 | Purpose and appropriate use | Purpose and "why AI" stated per system | `/ai`, `lib/aiSystems.ts` |
| 15 | Supplier due diligence | face-api.js record; model weights hash-checked in CI | §5 |
| 16 | Ongoing monitoring | 7- and 30-day outcome measures for every model | §4 |
| 17 | AI literacy | Operator guide | §7 |
| 18 | Documentation and records | Register, this document, tamper-evident audit records of switches and challenges | §2, §3 |
| 19 | Challenge and remediation | Challenge form, review queue, visible outcomes; Team 2's response target (acknowledge within 2 business days, saying how it will be investigated) with overdue flags and alerts | §3 |
| 20 | Responsible innovation | Privacy-first model design: rebuilt per request, consent-gated, threshold-bound | docs/05 §5 |

## 9. Open items

- **Legal review of the privacy policy** (element 13; docs/10) — the draft is published; review by a lawyer is organisational, not code.
- **Server-stored face templates as "sensitive information"** — answered by Team 2 on 2026-09-26: yes,
  even encrypted (see docs/08 §5). Implemented as express, informed consent wording (R-CONSENT-1).
- **A response target for challenges** — set by Team 2 on 2026-09-26 and implemented (§3).
- **Face accuracy and fairness measurement** — needs data the project rules exclude (§5).
- **Generative AI.** Team 2's accountability framework assumes image, video, audio or text generation
  and voice-phishing impersonation. SecureAI generates no content, so that part does not apply today;
  the labelling rule for AI-generated output in Team 2's data-source matrix (docs/09) would apply if it
  were added.
- **Future standards.** The Office of AI's Australian Standards for AI, expected to be legislated in
  early 2027, will need a review against this register when published.
