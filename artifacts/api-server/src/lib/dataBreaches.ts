/**
 * The data breach register and the record of disclosures to government agencies
 * (docs/12_Data_Breach_Response_Plan.md; privacy policy sections 9 and 14).
 *
 * Under Australia's Notifiable Data Breaches scheme (Privacy Act 1988, Part IIIC) a suspected breach
 * must be assessed within 30 days. One likely to cause serious harm is an eligible data breach, and
 * the people affected and the OAIC must then be told as soon as practicable. The register keeps the
 * date of each step so the deadlines can be shown and alerted on; each step is also written to the
 * hash-chained audit log, so who did what and when can't be quietly changed afterwards.
 */
import { count, desc, eq, and, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  usersTable,
  dataBreachesTable,
  dataBreachNoticesTable,
  governmentDisclosuresTable,
  type DataBreach,
  type GovernmentDisclosure,
} from "@workspace/db";
import { recordEvent } from "./auditLog";
import { appUrl, sendMail } from "./mailer";
import type { Actor } from "./aiGovernance";
import type { SecurityAlert } from "./securityAlerting";

export const ASSESSMENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// A staff computer's clock running a few minutes fast shouldn't turn "now" into a future date.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const NOTICE_INSERT_CHUNK = 1000;
const EMAILS_AT_ONCE = 5;

export type BreachNextStep =
  | "assess"
  | "notify-people-and-regulator"
  | "notify-people"
  | "notify-regulator"
  | "done";

export interface BreachView extends DataBreach {
  assessBy: Date;
  assessmentOverdue: boolean;
  nextStep: BreachNextStep;
  noticesSent: number;
  noticesAcknowledged: number;
}

export class BreachNotFoundError extends Error {}
export class NoticeNotFoundError extends Error {}
export class AlreadyRecordedError extends Error {}
/** Input that can't be right, such as a date in the future. The message is shown to staff. */
export class RegisterInputError extends Error {}

function actorFields(actor: Actor) {
  return {
    userId: actor.userId,
    userEmail: actor.email,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
  };
}

function notFuture(date: Date, what: string): void {
  if (date.getTime() > Date.now() + CLOCK_SKEW_MS)
    throw new RegisterInputError(`${what} can't be in the future`);
}

function nextStepFor(b: DataBreach): BreachNextStep {
  if (!b.assessment) return "assess";
  if (b.assessment !== "eligible") return "done";
  if (!b.usersNotifiedAt && !b.regulatorNotifiedAt)
    return "notify-people-and-regulator";
  if (!b.usersNotifiedAt) return "notify-people";
  if (!b.regulatorNotifiedAt) return "notify-regulator";
  return "done";
}

function toView(
  b: DataBreach,
  notices: { sent: number; acknowledged: number } = {
    sent: 0,
    acknowledged: 0,
  },
): BreachView {
  const assessBy = new Date(
    b.discoveredAt.getTime() + ASSESSMENT_DAYS * DAY_MS,
  );
  return {
    ...b,
    assessBy,
    assessmentOverdue: !b.assessment && Date.now() > assessBy.getTime(),
    nextStep: nextStepFor(b),
    noticesSent: notices.sent,
    noticesAcknowledged: notices.acknowledged,
  };
}

async function noticeCounts(breachIds?: number[]) {
  const rows = await db
    .select({
      breachId: dataBreachNoticesTable.breachId,
      sent: count(),
      acknowledged: count(dataBreachNoticesTable.acknowledgedAt),
    })
    .from(dataBreachNoticesTable)
    .where(
      breachIds
        ? inArray(dataBreachNoticesTable.breachId, breachIds)
        : undefined,
    )
    .groupBy(dataBreachNoticesTable.breachId);
  return new Map(rows.map((r) => [r.breachId, r]));
}

export async function listBreaches(): Promise<BreachView[]> {
  const breaches = await db
    .select()
    .from(dataBreachesTable)
    .orderBy(desc(dataBreachesTable.discoveredAt), desc(dataBreachesTable.id));
  if (breaches.length === 0) return [];
  const counts = await noticeCounts();
  return breaches.map((b) => toView(b, counts.get(b.id)));
}

async function getBreach(id: number): Promise<DataBreach> {
  const [b] = await db
    .select()
    .from(dataBreachesTable)
    .where(eq(dataBreachesTable.id, id));
  if (!b) throw new BreachNotFoundError();
  return b;
}

async function viewOf(id: number): Promise<BreachView> {
  const b = await getBreach(id);
  return toView(b, (await noticeCounts([id])).get(id));
}

export interface RecordBreachInput {
  title: string;
  description: string;
  dataInvolved: string;
  userGuidance: string;
  discoveredAt: Date;
}

export async function recordBreach(
  input: RecordBreachInput,
  actor: Actor,
): Promise<BreachView> {
  notFuture(input.discoveredAt, "The date it was discovered");
  const [row] = await db
    .insert(dataBreachesTable)
    .values({
      title: input.title.trim(),
      description: input.description.trim(),
      dataInvolved: input.dataInvolved.trim(),
      userGuidance: input.userGuidance.trim(),
      discoveredAt: input.discoveredAt,
      recordedByEmail: actor.email,
    })
    .returning();
  await recordEvent({
    eventType: "DATA_BREACH_RECORDED",
    details: `breach=${row!.id}; discovered=${row!.discoveredAt.toISOString()}; title=${row!.title}`,
    ...actorFields(actor),
  });
  return toView(row!);
}

/**
 * Records whether the breach is likely to cause serious harm. Can be repeated when new facts come to
 * light (a breach first judged not eligible can turn out to be eligible); every assessment stays in
 * the audit log.
 */
export async function assessBreach(
  id: number,
  input: { eligible: boolean; note: string; containedAt?: Date | null },
  actor: Actor,
): Promise<BreachView> {
  const breach = await getBreach(id);
  if (input.containedAt)
    notFuture(input.containedAt, "The date it was contained");
  const overdue = toView(breach).assessmentOverdue;
  const assessment = input.eligible ? "eligible" : "not-eligible";
  await db
    .update(dataBreachesTable)
    .set({
      assessment,
      assessmentNote: input.note.trim(),
      assessedAt: new Date(),
      containedAt: input.containedAt ?? breach.containedAt,
    })
    .where(eq(dataBreachesTable.id, id));
  await recordEvent({
    eventType: "DATA_BREACH_ASSESSED",
    details: `breach=${id}; assessment=${assessment}; afterDeadline=${overdue}; note=${input.note.trim()}`,
    ...actorFields(actor),
  });
  return viewOf(id);
}

function fmt(date: Date): string {
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Australia/Sydney",
  });
}

/**
 * The notification statement the Notifiable Data Breaches scheme asks for: who we are and how to
 * contact us, what happened, the kinds of information involved, and what the person should do.
 * Privacy policy section 14 tells people that this email never asks for a password or payment
 * details and that its only SecureAI link is the home page, so a fake is easier to spot. Keep both
 * true.
 */
function breachEmail(b: DataBreach): { subject: string; text: string } {
  return {
    subject: "Important: a data breach involving your SecureAI account",
    text: [
      "We are writing to tell you about a data breach that involves your personal information.",
      "",
      "WHAT HAPPENED",
      b.description,
      `We found out about it on ${fmt(b.discoveredAt)}.`,
      "",
      "THE INFORMATION INVOLVED",
      b.dataInvolved,
      "",
      "WHAT YOU SHOULD DO",
      b.userGuidance,
      "",
      `You will also see this notice when you next sign in: ${appUrl("/")}`,
      "",
      "If you have questions, reply to this email. If you aren't satisfied with our response, you can complain to the Office of the Australian Information Commissioner (OAIC): www.oaic.gov.au, 1300 363 992.",
      "",
      "SecureAI (Miifile Pty Ltd)",
    ].join("\n"),
  };
}

export interface NotifyResult {
  notified: number;
  alreadyNotified: number;
  emailed: number;
  unknownEmails: string[];
  breach: BreachView;
}

/**
 * Tells the people affected: a notice in the app, shown until they confirm reading it, and an email.
 * Anyone already told about this breach is skipped, so it is safe to run again for a longer list.
 */
export async function notifyBreachUsers(
  id: number,
  audience: "all" | "listed",
  emails: string[],
  actor: Actor,
): Promise<NotifyResult> {
  const breach = await getBreach(id);

  let targets: { id: number; email: string }[];
  let unknownEmails: string[] = [];
  if (audience === "all") {
    targets = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable);
  } else {
    const wanted = [
      ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ];
    if (wanted.length === 0)
      throw new RegisterInputError("List at least one email address");
    targets = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.email, wanted));
    const found = new Set(targets.map((t) => t.email));
    unknownEmails = wanted.filter((e) => !found.has(e));
  }

  const created: { id: number; userId: number }[] = [];
  for (let i = 0; i < targets.length; i += NOTICE_INSERT_CHUNK) {
    const chunk = targets.slice(i, i + NOTICE_INSERT_CHUNK);
    created.push(
      ...(await db
        .insert(dataBreachNoticesTable)
        .values(chunk.map((t) => ({ breachId: id, userId: t.id })))
        .onConflictDoNothing()
        .returning({
          id: dataBreachNoticesTable.id,
          userId: dataBreachNoticesTable.userId,
        })),
    );
  }

  const emailOf = new Map(targets.map((t) => [t.id, t.email]));
  const { subject, text } = breachEmail(breach);
  const emailedNotices: number[] = [];
  for (let i = 0; i < created.length; i += EMAILS_AT_ONCE) {
    const batch = created.slice(i, i + EMAILS_AT_ONCE);
    const sent = await Promise.all(
      batch.map((n) => sendMail(emailOf.get(n.userId)!, subject, text)),
    );
    batch.forEach((n, j) => sent[j] && emailedNotices.push(n.id));
  }
  if (emailedNotices.length)
    await db
      .update(dataBreachNoticesTable)
      .set({ emailSent: true })
      .where(inArray(dataBreachNoticesTable.id, emailedNotices));

  if (created.length && !breach.usersNotifiedAt)
    await db
      .update(dataBreachesTable)
      .set({ usersNotifiedAt: new Date() })
      .where(eq(dataBreachesTable.id, id));

  await recordEvent({
    eventType: "DATA_BREACH_USERS_NOTIFIED",
    details: `breach=${id}; audience=${audience}; notified=${created.length}; emailed=${emailedNotices.length}; alreadyNotified=${targets.length - created.length}; unknownEmails=${unknownEmails.length}`,
    ...actorFields(actor),
  });
  return {
    notified: created.length,
    alreadyNotified: targets.length - created.length,
    emailed: emailedNotices.length,
    unknownEmails,
    breach: await viewOf(id),
  };
}

export async function recordRegulatorNotification(
  id: number,
  notifiedAt: Date,
  reference: string,
  actor: Actor,
): Promise<BreachView> {
  const breach = await getBreach(id);
  if (breach.regulatorNotifiedAt) throw new AlreadyRecordedError();
  notFuture(notifiedAt, "The date the OAIC was told");
  if (notifiedAt.getTime() < breach.discoveredAt.getTime())
    throw new RegisterInputError(
      "The OAIC can't have been told before the breach was discovered",
    );
  await db
    .update(dataBreachesTable)
    .set({
      regulatorNotifiedAt: notifiedAt,
      regulatorReference: reference.trim(),
    })
    .where(eq(dataBreachesTable.id, id));
  await recordEvent({
    eventType: "DATA_BREACH_REGULATOR_NOTIFIED",
    details: `breach=${id}; notifiedAt=${notifiedAt.toISOString()}; reference=${reference.trim()}`,
    ...actorFields(actor),
  });
  return viewOf(id);
}

// ── What the person affected sees ────────────────────────────────────────────────────────────────

export interface BreachNoticeView {
  id: number;
  title: string;
  description: string;
  dataInvolved: string;
  userGuidance: string;
  notifiedAt: Date;
  acknowledgedAt: Date | null;
}

export async function noticesFor(
  userId: number,
  noticeId?: number,
): Promise<BreachNoticeView[]> {
  return db
    .select({
      id: dataBreachNoticesTable.id,
      title: dataBreachesTable.title,
      description: dataBreachesTable.description,
      dataInvolved: dataBreachesTable.dataInvolved,
      userGuidance: dataBreachesTable.userGuidance,
      notifiedAt: dataBreachNoticesTable.notifiedAt,
      acknowledgedAt: dataBreachNoticesTable.acknowledgedAt,
    })
    .from(dataBreachNoticesTable)
    .innerJoin(
      dataBreachesTable,
      eq(dataBreachesTable.id, dataBreachNoticesTable.breachId),
    )
    .where(
      and(
        eq(dataBreachNoticesTable.userId, userId),
        noticeId === undefined
          ? undefined
          : eq(dataBreachNoticesTable.id, noticeId),
      ),
    )
    .orderBy(
      desc(dataBreachNoticesTable.notifiedAt),
      desc(dataBreachNoticesTable.id),
    );
}

/** Records that the person has read the notice. Only their own; acknowledging twice changes nothing. */
export async function acknowledgeNotice(
  noticeId: number,
  actor: Actor,
): Promise<BreachNoticeView> {
  const [notice] = await noticesFor(actor.userId, noticeId);
  if (!notice) throw new NoticeNotFoundError();
  if (notice.acknowledgedAt) return notice;
  const [updated] = await db
    .update(dataBreachNoticesTable)
    .set({ acknowledgedAt: new Date() })
    .where(eq(dataBreachNoticesTable.id, noticeId))
    .returning({
      breachId: dataBreachNoticesTable.breachId,
      acknowledgedAt: dataBreachNoticesTable.acknowledgedAt,
    });
  await recordEvent({
    eventType: "DATA_BREACH_NOTICE_ACKNOWLEDGED",
    details: `notice=${noticeId}; breach=${updated!.breachId}`,
    ...actorFields(actor),
  });
  return { ...notice, acknowledgedAt: updated!.acknowledgedAt };
}

// ── Disclosures to government agencies ───────────────────────────────────────────────────────────

/**
 * Why information can be given (privacy policy section 9): legal-demand, required by Australian law
 * or a court or tribunal order (APP 6.2(b)); enforcement-request, a written request from an Australian
 * enforcement body that we judge reasonably necessary for its work (APP 6.2(e)); emergency, a serious
 * threat to someone's life, health or safety, or a missing person (Privacy Act s 16A). A foreign
 * government or court has to go through Australia's mutual assistance process, so it isn't a type.
 */
export const DISCLOSURE_REQUEST_TYPES = [
  "legal-demand",
  "enforcement-request",
  "emergency",
] as const;
export type DisclosureRequestType = (typeof DISCLOSURE_REQUEST_TYPES)[number];

/**
 * The kinds of information that can be given. Passwords (only a hash is held), sign-in tokens and
 * encryption keys are deliberately not a kind: they let someone into accounts rather than show what
 * happened, so they are never given.
 */
export const DISCLOSURE_CATEGORIES = [
  "account",
  "security-records",
  "payments",
  "uploads",
  "face-template",
  "ai-challenges",
  "sign-in-keys",
] as const;
export type DisclosureCategory = (typeof DISCLOSURE_CATEGORIES)[number];

/** Given only when the law requires it, never on a voluntary request or in an emergency. */
export const LEGAL_DEMAND_ONLY: readonly DisclosureCategory[] = [
  "face-template",
  "uploads",
];

export interface RecordDisclosureInput {
  agency: string;
  legalBasis: string;
  requestType: DisclosureRequestType;
  categories: DisclosureCategory[];
  reference?: string | null;
  subjectEmail?: string | null;
  informationDisclosed: string;
  disclosedAt: Date;
  personToldAt?: Date | null;
  notTellingReason?: string | null;
}

export async function listDisclosures(): Promise<GovernmentDisclosure[]> {
  return db
    .select()
    .from(governmentDisclosuresTable)
    .orderBy(
      desc(governmentDisclosuresTable.disclosedAt),
      desc(governmentDisclosuresTable.id),
    );
}

/**
 * The written note Australian Privacy Principle 6.5 requires when personal information is disclosed
 * for an enforcement-related activity. Either the person was told, or the reason they weren't is
 * written down: an order can forbid telling them.
 */
export async function recordDisclosure(
  input: RecordDisclosureInput,
  actor: Actor,
): Promise<GovernmentDisclosure> {
  notFuture(input.disclosedAt, "The date it was disclosed");
  if (input.personToldAt)
    notFuture(input.personToldAt, "The date the person was told");
  // In the order of DISCLOSURE_CATEGORIES, each once.
  const categories = DISCLOSURE_CATEGORIES.filter((c) =>
    input.categories.includes(c),
  );
  if (categories.length === 0)
    throw new RegisterInputError("Choose what kinds of information were given");
  if (
    input.requestType !== "legal-demand" &&
    categories.some((c) => LEGAL_DEMAND_ONLY.includes(c))
  )
    throw new RegisterInputError(
      "Face templates and uploaded files are given only when the law requires it (a warrant, subpoena, court order or statutory notice), never on a voluntary request or in an emergency (privacy policy section 9)",
    );
  const notTellingReason = input.notTellingReason?.trim() || null;
  if (!input.personToldAt && (!notTellingReason || notTellingReason.length < 5))
    throw new RegisterInputError(
      "Say when the person was told, or why they haven't been (for example, the order forbids it)",
    );
  const [row] = await db
    .insert(governmentDisclosuresTable)
    .values({
      agency: input.agency.trim(),
      legalBasis: input.legalBasis.trim(),
      requestType: input.requestType,
      categories,
      reference: input.reference?.trim() || null,
      subjectEmail: input.subjectEmail?.trim().toLowerCase() || null,
      informationDisclosed: input.informationDisclosed.trim(),
      disclosedAt: input.disclosedAt,
      personToldAt: input.personToldAt ?? null,
      notTellingReason: input.personToldAt ? null : notTellingReason,
      recordedByEmail: actor.email,
    })
    .returning();
  // The audit entry names the agency but not the person: the security log is read more widely than
  // this record, and an order can forbid revealing who was the subject.
  await recordEvent({
    eventType: "GOVERNMENT_DISCLOSURE_RECORDED",
    details: `disclosure=${row!.id}; agency=${row!.agency}; type=${input.requestType}; categories=${categories.join(",")}; personTold=${row!.personToldAt ? "yes" : "no"}`,
    ...actorFields(actor),
  });
  return row!;
}

/**
 * Disclosures about this person that they have been told about, for their own data export. One they
 * haven't been told about stays out: showing it could tip them off when the law forbids that.
 */
export async function disclosuresToldTo(
  email: string,
): Promise<GovernmentDisclosure[]> {
  return db
    .select()
    .from(governmentDisclosuresTable)
    .where(
      and(
        eq(governmentDisclosuresTable.subjectEmail, email.toLowerCase()),
        isNotNull(governmentDisclosuresTable.personToldAt),
      ),
    )
    .orderBy(desc(governmentDisclosuresTable.disclosedAt));
}

// ── Alerts ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Breaches waiting on a step the law sets a deadline for. Shown on the security dashboard; the high
 * ones are also sent to the alert webhook until the step is done.
 */
export async function computeBreachAlerts(): Promise<SecurityAlert[]> {
  let breaches: BreachView[];
  try {
    breaches = await listBreaches();
  } catch {
    return []; // the register's tables don't exist yet (before the migration)
  }
  const alerts: SecurityAlert[] = [];
  for (const b of breaches) {
    if (b.nextStep === "assess") {
      alerts.push({
        id: `data-breach-assessment:${b.id}`,
        severity: b.assessmentOverdue ? "high" : "medium",
        message: b.assessmentOverdue
          ? `Data breach "${b.title}" was not assessed within ${ASSESSMENT_DAYS} days (due ${fmt(b.assessBy)})`
          : `Data breach "${b.title}" must be assessed by ${fmt(b.assessBy)}`,
        count: 1,
        windowMinutes: 0,
      });
    } else if (b.nextStep !== "done") {
      const who =
        b.nextStep === "notify-people-and-regulator"
          ? "the people affected and the OAIC have"
          : b.nextStep === "notify-people"
            ? "the people affected have"
            : "the OAIC has";
      alerts.push({
        id: `data-breach-notification:${b.id}`,
        severity: "high",
        message: `Eligible data breach "${b.title}": ${who} not been told yet`,
        count: 1,
        windowMinutes: 0,
      });
    }
  }
  return alerts;
}
