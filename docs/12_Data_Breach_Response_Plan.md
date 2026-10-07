# Data Breach Response Plan — SecureAI

What SecureAI does when personal information may have been breached, and what it does when a government
agency asks for someone's information. It follows Australia's Notifiable Data Breaches (NDB) scheme
(Privacy Act 1988, Part IIIC) and the OAIC's four steps: contain, assess, notify, review.

Written 4 October 2026 for Miifile Pty Ltd's requirements of 2 October 2026 (docs/08, section 5d), and
updated 7 October 2026 with the privacy policy's section 14 (version 2026-10-07, docs/08 section 5f),
which tells people what this plan does: change the two together. The app side is the **Privacy
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

Personal information is given to a government or law-enforcement agency only when the law requires or
allows it (Australian Privacy Principle 6.2(b) and (e)). Before disclosing:

1. Check the request is genuine, by contacting the agency through its published details.
2. Identify the law or order relied on (warrant, subpoena, court order, notice under a statute).
3. Give only what it covers.
4. Record it on Privacy Compliance: the agency and its reference, the law or order, whose account,
   what was given and when, and whether the person has been told. This is the written note APP 6.5
   requires.
5. Tell the person unless the law forbids it. If they can't be told, the reason is required.

Only administrators can record a disclosure. A disclosure the person has been told about appears in
their data download; one they haven't been told about does not, so the download can't tip someone off
when an order forbids it. The audit event (`GOVERNMENT_DISCLOSURE_RECORDED`) names the agency but not the
person, because the audit log is read more widely than the disclosure record.

## 4. How long these records are kept

The breach register and the disclosure record are not deleted by the retention purge (docs/05,
section 7): they are the evidence that the law was followed. The audit events about them follow the
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

## 6. How it was checked

On 4 October 2026, against a throwaway local database:

- An API end-to-end run of 41 checks: who can do what, the 30-day deadline and its alerts, the email's
  content (through a fake mail server, so no real email was sent), notices and acknowledgement, the OAIC
  record that can't be changed afterwards, disclosures including one the person may not be told about,
  both downloads, and an intact audit chain.
- A browser run of 13 checks: the whole workflow on Privacy Compliance as an administrator, the notice and
  "I've read this" as the person affected, both downloads, and no sideways scrolling at phone width.
- CI's adversarial probes (40 of 40) now include the new endpoints' access control and the readable
  copy's escaping.
