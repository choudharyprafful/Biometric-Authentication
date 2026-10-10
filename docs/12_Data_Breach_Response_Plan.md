# Data Breach Response Plan — SecureAI

What SecureAI does when personal information may have been breached, and what it does when a government
agency asks for someone's information. It follows Australia's Notifiable Data Breaches (NDB) scheme
(Privacy Act 1988, Part IIIC) and the OAIC's four steps: contain, assess, notify, review.

Written 4 October 2026 for Miifile Pty Ltd's requirements of 2 October 2026 (docs/08, section 5d), and
updated 7 October 2026 with the privacy policy's section 14 (version 2026-10-07, docs/08 section 5f),
which tells people what this plan does: change the two together. Section 3 was rewritten the same day,
with legal holds and rules for what can be given to an agency (policy section 9, version 2026-10-07.2,
docs/08 section 5g). The app side is the **Privacy
Compliance** page (security analysts and administrators), the breach notice people see in the web and
phone apps, and the records behind them. This is a student proof of concept: a real deployment needs a
named privacy officer and a legal review of this plan.

The plan covers information SecureAI's service providers hold for it (AWS and Google, privacy policy
section 9) as well as its own systems: a breach on their side is handled the same way.

## 1. Who does what

| Role             | In the app                                                                                                    | Responsible for                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Response lead    | —                                                                                                             | Running the response. For this proof of concept, the Team 1 lead; in production, Miifile's privacy officer |
| Security analyst | Records a suspected breach and its assessment                                                                 | Containing it and gathering the facts                                                                      |
| Administrator    | Also tells the people affected, records the OAIC notification, and records disclosures to government agencies | The decisions made for the company: notifying, and disclosing under the law                                |
| Person affected  | Sees the notice until they confirm reading it; finds it in their data download                                | —                                                                                                          |

The split is enforced by the API (`routes/dataBreaches.ts`): analysts get `403` on the notify, OAIC and
disclosure endpoints, and standard accounts get `403` on all of them. CI's adversarial probes check this on
every push.

## 2. The four steps

| Step       | Deadline                                                                                                           | What to do                                                                                                                                                                                                                                                                                                   | Recorded as                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contain | Straight away                                                                                                      | Stop the exposure (revoke the key, close the bucket, rotate the password). Record the breach on Privacy Compliance with when it was discovered, what happened, the information involved and what people should do                                                                                            | `data_breaches` row; `DATA_BREACH_RECORDED` audit event                                                                                                         |
| 2. Assess  | Within 30 days of discovering it (s 26WH)                                                                          | Decide whether serious harm is likely (s 26WG: the kind and sensitivity of the information, who has it, whether it is protected, what has been done since). If action taken in time means it no longer is, the breach is not eligible (s 26WF): say so. Write down the reasons. Record when it was contained | `assessment`, `assessment_note`, `assessed_at`; `DATA_BREACH_ASSESSED`                                                                                          |
| 3. Notify  | As soon as practicable once it is an eligible data breach, without waiting for the 30 days to end (s 26WK, s 26WL) | Submit the OAIC's Notifiable Data Breach form, then record the date and the OAIC's reference. Tell the people affected at the same time or straight after: listed accounts, or everyone, and by hand anyone who has deleted their account (below)                                                            | `regulator_notified_at`, `regulator_reference`, `users_notified_at`, `data_breach_notices` rows; `DATA_BREACH_REGULATOR_NOTIFIED`, `DATA_BREACH_USERS_NOTIFIED` |
| 4. Review  | After the response                                                                                                 | Fix the cause, update docs/04's risk register, and check this plan worked                                                                                                                                                                                                                                    | docs/04                                                                                                                                                         |

A breach judged not eligible stays in the register with its reasons. It can be reassessed if new facts
come to light; every assessment stays in the audit log. People can be told about a breach that isn't
eligible too, when there is something they can do to protect themselves: "Tell the people affected"
works at any stage.

### People who deleted their account

Their payment and security records are kept after deletion, with their email (privacy policy section
10), so a breach can involve them. The app can't show them a notice, and "Tell the people affected"
lists their addresses back as having no account. Email them the same statement by hand, from the
address the app's emails come from (the policy tells people breach emails come from it), and write in
the assessment note that they were told and when.

### EU and UK users

If people in the EU or UK are affected, the response lead also tells the relevant supervisory authority
within 72 hours of becoming aware of the breach, unless it is unlikely to result in a risk to their
rights and freedoms (GDPR art. 33), and tells those people without undue delay if the risk to them is
high (art. 34). The register's notification fields are for the OAIC: record the authority, the date and
its reference in the assessment note.

### Deadlines are watched

The security dashboard raises an alert for every breach still waiting on a step:

- **Medium** while an assessment is due, naming the date (30 days after discovery).
- **High** once the 30 days have passed without an assessment.
- **High** for an eligible breach until both the people affected and the OAIC have been told.

High alerts are also emailed to the addresses in `SECURITY_ALERT_EMAILS` and sent to the alert webhook
(`SECURITY_ALERT_WEBHOOK_URL`) where those are set, repeating every 30 minutes until the step
is done (`lib/dataBreaches.ts` `computeBreachAlerts`).

### What the people affected receive

The statement the NDB scheme asks for: who we are and how to reach us, what happened, the kinds of
information involved, and what they should do. Staff write the text when they record the breach, so it
is in plain words from the start.

- **Email**, sent when an administrator chooses "Tell the people affected" (`lib/dataBreaches.ts`
  `breachEmail`). It ends with how to complain to the OAIC. If email isn't set up, the result says how
  many could not be emailed. It never asks for a password or payment details, and its only SecureAI link
  is the home page. Policy section 14 tells people so, to make a fake easier to spot, so keep it that
  way.
- **A notice in the app**: at the top of every signed-in page on the website, and as a banner on the
  phone app that opens the full notice, until they choose "I've read this"
  (`DATA_BREACH_NOTICE_ACKNOWLEDGED`). The register shows how many were told and how many confirmed.
- **Their data download** lists every notice they were sent (privacy policy section 11).

Anyone already told about a breach is skipped, so it is safe to send again to a longer list. Addresses
with no account are reported back rather than ignored (see "People who deleted their account" above).

## 3. Requests from government agencies

Personal information is given to an Australian government or law-enforcement agency only when the law
requires or allows it, only what the request covers, and only about the person it names (privacy policy
section 9). When a request arrives:

1. **Place a legal hold first** (below), so nothing the request may cover is lost while it is dealt with.
2. **Check it is genuine** by contacting the agency through its published details, never through the
   contact details in the request. Fake urgent requests sent from compromised police email accounts are a
   known way to steal personal information.
3. **Decide what kind of request it is.** That decides what can be given:

| Kind (in the app)   | What it is                                                                              | Basis                                                                                      | What can be given                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required by law     | A warrant, subpoena, court order or statutory notice (for example from the ATO or ASIC) | APP 6.2(b): it must be complied with                                                       | What it covers, including face templates and uploaded files                                                                                      |
| Enforcement request | A written request from an Australian enforcement body, with no order                    | APP 6.2(e): it may be complied with, if staff reasonably believe it necessary for its work | Account details, security records, payment records, AI challenge records, passkeys and phone keys. Not face templates or files: ask for an order |
| Emergency           | A serious threat to someone's life, health or safety, or a missing person               | Privacy Act s 16A: it may be complied with                                                 | The minimum needed, from the same list. Not face templates or files                                                                              |

The API refuses to record a face template or uploaded files for anything but "Required by law"
(`lib/dataBreaches.ts`, `LEGAL_DEMAND_ONLY`), and the form won't let them be ticked, so the rule can't be
skipped by mistake.

4. **Never give credentials.** Password hashes, sign-in tokens and encryption keys aren't information about
   a person but the means into accounts, and the record has no category for them. A technical assistance
   request or notice under the Telecommunications Act 1997, Part 15, can't require a systemic weakness
   (s 317ZG) and comes with secrecy rules (s 317ZF): take legal advice.
5. **A foreign government or court** must go through Australia's mutual assistance process (Mutual
   Assistance in Criminal Matters Act 1987). Don't disclose to it directly.
6. **Give only what the request covers**, about the person it names, leaving other people's information
   out.
7. **Record it** on Privacy Compliance: the agency and its reference, the kind of request, the law or order,
   the kinds of information given, whose account, what was given and when, and whether the person has been
   told. This is the written note APP 6.5 requires.
8. **Tell the person** unless the law forbids it. If they can't be told, the reason is required.

Only administrators can record a disclosure. A disclosure the person has been told about appears in their
data download, with the kind of request and the kinds of information in plain words; one they haven't been
told about does not, so the download can't tip someone off when an order forbids it. The audit event
(`GOVERNMENT_DISCLOSURE_RECORDED`) names the agency, the kind and the categories but not the person, because
the audit log is read more widely than the disclosure record. Disclosures recorded before 7 October 2026
show the kind as not recorded.

### Legal holds

A hold (`lib/legalHolds.ts`; Privacy Compliance, administrators only) keeps what a request may need while
it is dealt with:

- **When it is placed**, the person's account (without the password hash), face template, files, passkeys,
  phone keys and payment records are copied. A hold can be placed on an email with no account; payment and
  security records are still held.
- **While it lasts**, anything of theirs about to be deleted or replaced is copied first. That covers
  deleting the account, a file or a passkey; removing or re-enrolling a face; a staff MFA reset; and the
  hourly retention purge of payment and security records, copied when due or within a day of it. The
  deletion still happens, so the person sees nothing different, which also avoids tipping them off. If the
  copy fails, the deletion doesn't happen (each pair is one transaction). If the purge's copy fails, nothing
  is purged that hour.
- **Copies are kept as stored**: files and face templates stay encrypted, and an unchanged record is kept
  once. No endpoint returns them, so no account, an administrator's included, can open another person's
  files or face template in the app. Producing them for an agency is an operator task, with database access
  and the encryption key, done under legal advice and recorded as a disclosure.
- **Release** the hold when the obligation ends, for example when the agency confirms or the matter
  closes. A reason is required, the copies are deleted, and the hold stays on record. A released hold
  can't be reopened: place a new one.
- **Who is under a hold is need-to-know**: only administrators can see holds, and the audit events
  (`LEGAL_HOLD_PLACED`, `LEGAL_HOLD_RELEASED`) name the agency but not the person.

## 4. How long these records are kept

The breach register and the disclosure record are not deleted by the retention purge (docs/05,
section 7): they are the evidence that the law was followed. A legal hold's copies are deleted when the hold
is released, never by the purge, whose deletions are what a hold exists to stop. The audit events about them follow the
security log's 12 months. Payment records are kept 7 years, security log entries 12 months, and records
of challenges to AI decisions 2 years.

## 5. Limits

- Whether serious harm is likely is a human judgement. The app records it and its reasons; it does not
  make it.
- The OAIC is notified on the OAIC's own website. The app records when, and the reference.
- Emails to "everyone" are sent while the request waits, five at a time. That suits this proof of
  concept's size; a large user base would need a background queue.
- The NDB scheme also allows publishing a statement on the website when telling each person isn't
  practicable. The app has no public statement page; the in-app notice to everyone is the nearest
  equivalent.
- The dashboard's alerts follow the NDB scheme's deadlines. The GDPR's 72 hours, for EU and UK users,
  is the response lead's to watch.
- People who deleted their account are emailed by hand (section 2). The app records only what staff
  write in the assessment note.
- Which kind a request is remains staff's judgement. The API enforces only that face templates and files
  need a legal demand.
- A hold copies; it doesn't freeze. The person can still change their profile or consents. The copy made
  when the hold was placed shows how things stood then, and a changed record is copied again when it is
  deleted.
- A hold placed after the account was deleted finds payment and security records by email only, so
  security records that carry only the old account id aren't matched.
- Copies can't be read through the app. Producing them needs an operator with database access and the
  encryption key.

## 6. How it was checked

On 7 October 2026, for section 3's rules and legal holds, against a throwaway local database:

- An API end-to-end run of 46 checks. It covered:
  - who can use holds;
  - the disclosure rules, including that the API refuses face templates and files on a police request or
    in an emergency;
  - copies when a hold is placed, and before every deletion path, with the deletion still happening;
  - the retention purge copying the held person's payment and security records first, and nobody
    else's;
  - release deleting the copies, and an intact audit chain.
- A browser run of 17 checks on Privacy Compliance. It covered the form's rules, placing and releasing a
  hold, no sideways scrolling at phone width, and that an analyst sees no holds and the page never asks
  for them.
- CI's adversarial probes, 44 of 44, now including the legal-hold endpoints.
- `scripts/ops/migrate-legal-holds.mjs`, rehearsed twice on a copy shaped like production. It is
  idempotent, and Drizzle then found nothing to change.

On 4 October 2026, against a throwaway local database:

- An API end-to-end run of 41 checks: who can do what, the 30-day deadline and its alerts, the email's
  content (through a fake mail server, so no real email was sent), notices and acknowledgement, the OAIC
  record that can't be changed afterwards, disclosures including one the person may not be told about,
  both downloads, and an intact audit chain.
- A browser run of 13 checks: the whole workflow on Privacy Compliance as an administrator, the notice and
  "I've read this" as the person affected, both downloads, and no sideways scrolling at phone width.
- CI's adversarial probes (40 of 40) now include the new endpoints' access control and the readable
  copy's escaping.
