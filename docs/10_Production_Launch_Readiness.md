# Production Launch Readiness — Australian Public Launch

Not a brief deliverable. Every other doc in this folder (`01`–`09`) was built to satisfy the Team 1
student-project brief: synthetic data only, PoC scope, "design an approach and state its limitations."
This one exists because the project's own goal has since expanded beyond that — a genuine, full public
launch in the Australian market, with real users, real payments, and real regulatory exposure. That's a
materially different bar, and pretending the two are the same thing would be dishonest. This doc states
the gap plainly and tracks closing it.

**Not legal advice**, same standing caveat every other doc in this project carries, stated here with more
weight than usual: real launch decisions below need real legal, tax, and insurance advice before they're
acted on, not just Team 1's technical read of them.

## 0. One fact that changes the whole calculus

The Privacy Act 1988's small-business exemption (turnover under $3M) does NOT apply once an
organisation collects or holds "sensitive information": biometric templates collected for the purpose
of automated identification or verification are expressly listed as sensitive information under the Act
(alongside health, genetic, and similar categories) — see Privacy Act 1988 s6D(4)(b) and the OAIC's own
guidance. This app collects exactly that (the face descriptor, `users.faceDescriptorCiphertext`). In
practice, "we're a small startup" is not an exemption here, regardless of revenue: the 13 Australian
Privacy Principles (APPs) apply in full from day one of real users, not once the business reaches some
size. Confirm this reading with a real privacy lawyer before launch — it is the single fact most likely to
change the sequencing below if it turns out to be wrong.

## 1. Blocking — not something Team 1 (or this session) can do for you

Everything in this section needs a human with the right qualification or authority, not more code.

| Item | Why it blocks | Status |
|---|---|---|
| Business registration (ABN, and a company structure if not sole-trading) | Needed to hold a real payment-processor account, sign a real ToS as an entity, and for tax/liability separation | Not started, as far as this session knows |
| Privacy Policy + Terms of Service, drafted and reviewed by an Australian lawyer | APP 1 requires a clearly-expressed, up-to-date privacy policy; a ToS needs Australian Consumer Law review (unfair contract terms apply to standard-form consumer contracts) | Not started. Team 1 can draft a technically-accurate starting point (what's actually collected, retained, and why, straight from this codebase) but it needs real legal sign-off before a real user relies on it |
| Team 2's finished compliance deliverables: Privacy Impact Assessment, Regulatory Compliance Assessment, completed Responsible AI Framework, IP & Copyright Assessment | These are the actual APPs/GDPR-mapping documents a regulator or a user's lawyer would expect to exist; `08_Requests_to_Team2.md` shows most are still open questions, not finished outputs. Only the Data Source Acceptability Matrix has arrived so far (`09_Team2_Data_Source_Acceptability_Matrix.md`) | In progress on Team 2's side, not Team 1's to accelerate |
| Cyber-liability / professional-indemnity insurance | Standard for any business holding biometric + payment data; a real accountant/broker conversation, not a technical one | Not started |
| A real security review beyond this project's own self-testing | `04_Threat_Model_Risk_Assessment.md` §3 and the Requirements Audit artifact both already say this in their own words: an independent third-party penetration test is the recommended next step before a production launch, beyond the internal pentest already run | Recommended, not booked |

## 2. Needs your decisions/credentials — Team 1 can build the integration once you have them

| Item | What's needed from you | What Team 1 builds once you have it |
|---|---|---|
| Real payment processor | A Stripe (or equivalent) account, tied to the registered business above. Stripe is the standard AU-market choice — AU-based settlement, PCI-DSS SAQ-A scope achievable via Stripe Elements/Checkout (card data never touches this app's own servers, matching the tokenisation architecture already built) | Replace the fully-simulated `payments.ts` flow with real Stripe API calls; webhook signature verification is already real (`lib/webhookSignature.ts`) and just needs pointing at Stripe's actual signing scheme instead of the custom HMAC used for the simulated flow |
| Real transactional email (SMS still not wired, if wanted for the parent-consent flow) | SMTP credentials from a provider — Gmail (with an App Password) works for testing, AWS SES/SendGrid/Postmark for real volume | **Done 2026-09-13** — `lib/mailer.ts` sends via plain SMTP (nodemailer) for password-reset and parent-consent links, alongside (not replacing) the `devAuthLinksEnabled()` dev-only fallback (`lib/devLinks.ts`, hardened 2026-09-11 — see §4 below). Delivery is best-effort and never blocks the request it's attached to. Set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`EMAIL_FROM`/`APP_BASE_URL` in `.env` to activate; leave `SMTP_HOST` unset to keep the dev-only path as the sole delivery mechanism |
| A registered domain + DNS under the real business's control | Domain purchase/registration is a business decision, not a technical one | Point production DNS/TLS at it; update CORS allowlist (`lib/allowedOrigins.ts`) and CSP accordingly |
| A dedicated production AWS account (separate from this session's dev/demo account) | An account boundary decision — keeps a compromised dev credential from having any path to production data | Rebuild the IAM structure from scratch with least-privilege roles per service, informed by this session's own experience (a supposedly-scoped IAM user was found to still have `s3:ListBuckets`/`rds:DescribeDBInstances` — see prior session history); rotate/retire whatever credentials exist in the current demo account |

## 3. Team 1 can start now — no external blockers, purely technical

Ordered roughly by how much it matters once real users are involved.

| Item | Why it matters for a real launch specifically | Status |
|---|---|---|
| Kill the dev-only auth-link leak, defense-in-depth | Previously gated on `NODE_ENV !== "production"` — a block-list with a single point of failure: any misconfigured/unset/mistyped environment would leak a password-reset or parent-consent link to any API caller, not just the intended recipient. Now an allow-list (`lib/devLinks.ts`: `NODE_ENV === "development"`, exactly) | **Done, verified live 2026-09-11** — confirmed the link is still returned in real local dev, and confirmed (via a throwaway instance with `NODE_ENV` deliberately unset) that it's correctly suppressed where the old check would have leaked it |
| Remove stray deploy artifacts from the repo | `amplify-deploy2.zip` (a one-off manual-deploy zip, ~4.9MB) was sitting untracked in the repo root — never committed, but exactly the kind of debris that shouldn't accumulate once this is a real product's repo, not a demo scratch space | **Done 2026-09-11** — removed, and `*.zip` added to `.gitignore` to stop it recurring |
| Move production hosting to an AU AWS region | Not legally mandated, but standard practice and directly relevant to APP 8 (cross-border disclosure of personal information) — keeping data resident in Australia (`ap-southeast-2`, Sydney) is the simplest way to avoid a cross-border-disclosure question entirely, rather than having to answer it | Not started — current dev/demo deployment's region hasn't been confirmed as Sydney |
| Replace in-memory rate-limiting / session state with a shared store | `04_Threat_Model_Risk_Assessment.md` R-LOG-1 already states this plainly: the in-memory rate limiter, audit-log write queue, and alert-notification cooldown all silently stop working correctly the moment there's more than one server instance. A real public launch needs horizontal scaling (or at least the option of it) from day one, which this currently blocks | Not started — needs a Redis instance (e.g. ElastiCache) and swapping `lib/rateLimit.ts`'s in-memory Map for a Redis-backed equivalent |
| Set real retention ceilings | Security-log and payment retention (`SECURITY_LOGS_RETENTION_DAYS`, `PAYMENTS_RETENTION_DAYS`) are deliberately unset today, pending Team 2 policy. "No ceiling, forever" is a defensible PoC default; it is not a defensible real-production default once real users' data is accumulating indefinitely | Mechanism already built (`lib/retention.ts`), just needs real numbers — see the open item in `05_Consent_and_Deletion_Design.md` §3 |
| Decide, consciously, on age-verification rigor | Self-reported date of birth (`05_Consent_and_Deletion_Design.md` §1b) is an honest, common PoC/demo choice. For a real public launch handling real minors' data, this is worth a deliberate go/no-go decision (not a silent carry-over) — many consumer apps do ship with self-reported DOB, but it should be a decision made with real risk tolerance in mind, not inherited by default | Flagged, no change made — this is a business risk decision, not purely technical |
| Get CI actually running against a real runner | `04_Threat_Model_Risk_Assessment.md` §3 already notes the CI workflow has never executed on an actual CI runner. Before real code ships to real users, the typecheck/dependency-audit/SAST/adversarial-probe pipeline that exists on paper needs to actually run on every change | Not started — the one item previously deferred pending your go-ahead to touch the remote repo, still true here |
| Extend `scripts/src/security/adversarial-probes.ts` with regression coverage for the three anomaly-detection features added 2026-09-11 | Login-risk scoring, face-verification anomaly detection, and upload-anomaly detection were all verified live by hand this session; folding that into the automated suite means future changes can't silently regress them the way the DOB-field regression silently broke the suite once before | Not started — noted as a next step when this work was reported |

## 4. What's already in reasonably good shape and does NOT need rebuilding

Worth stating explicitly so this doc doesn't read as "nothing here is production-ready." A meaningful amount
of the existing work carries over directly:

- Encryption at rest (AES-256-GCM for biometric descriptors, uploads, payment tokens), password hashing
  (bcrypt cost 12), TLS/HSTS in production, CSRF/CORS, the audit-log hash chain, and the role-based access
  model are all real, tested controls — see `04_Threat_Model_Risk_Assessment.md` for the full register.
- The payment architecture never stores raw card data anywhere, which keeps the app out of the harder
  tiers of PCI-DSS scope even once a real processor is wired in (bucket 2's Stripe work is a swap, not a
  redesign).
- The consent model (separate flags for data/biometric/training consent, enforced at the point of storage,
  not just displayed) is a real design a real privacy lawyer can review rather than something built from
  scratch for compliance theatre.
- The suspicious-activity alerting pipeline (rate-limit spikes, login-failure spikes, the three
  anomaly-detection features added 2026-09-11, webhook push) is genuinely operational today, not aspirational.

## 5. Suggested order

1. Bucket 1's business/legal items (ABN, lawyer engagement, Team 2's finished compliance docs) — these
   gate everything else and have the longest lead time, so start them first even though they're not
   Team 1's to execute.
2. In parallel, Team 1 continues bucket 3 (no blockers) — AU region migration, Redis-backed rate limiting,
   real retention numbers, CI, probe-suite coverage.
3. Once the business entity exists: bucket 2 (Stripe, real email, production AWS account, domain) — these
   need bucket 1's outputs as inputs, so they can't move first.
4. Independent third-party penetration test, after bucket 2 is wired in (testing the real integrations,
   not just the simulated ones).
5. Launch.

Nothing in this document was deployed or pushed anywhere — it's a plan and a small set of local code
changes (§3's first two rows), reviewed the same way every other change in this project is, before
anything touches the live site.
