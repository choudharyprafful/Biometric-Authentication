import React from "react";
import type {
  BystanderKind,
  UploadConsentRequest,
} from "@workspace/api-client-react";

// Team 2's Bystander Consent Policy (docs/08 section 5h): the uploader says who else a file shows or
// names. That declaration is the policy's detection method; nothing scans uploads for faces or voices.
// What each answer does is in the API's lib/dataProvenance.ts (assessPeopleRules). Someone with their
// own account is asked directly (lib/bystanderConsent.ts).

export const PEOPLE_OPTIONS: { value: BystanderKind; label: string }[] = [
  {
    value: "reachable",
    label: "Someone I've told about it, who doesn't object",
  },
  { value: "account", label: "Someone with a SecureAI account (ask them)" },
  { value: "unreachable", label: "Someone I can't contact" },
  { value: "minor", label: "Someone under 18" },
  { value: "deceased", label: "Someone who has died" },
];

const SHORT: Record<string, string> = {
  reachable: "someone you told",
  account: "someone with an account",
  unreachable: "someone you can't contact",
  minor: "someone under 18",
  deceased: "someone who has died",
};

/** Must match MAX_PEOPLE_ASKED in the API's lib/bystanderConsent.ts. */
const MAX_PEOPLE_ASKED = 5;

export interface PeopleAnswer {
  others: boolean | null;
  kinds: BystanderKind[];
  statement: string;
  /** Addresses of people with an account, as typed: commas or spaces between them. */
  emails: string;
}

export const NO_ANSWER: PeopleAnswer = {
  others: null,
  kinds: [],
  statement: "",
  emails: "",
};

export function answerFrom(
  bystanders: BystanderKind[] | null | undefined,
  statement: string | null | undefined,
  requests: UploadConsentRequest[] = [],
): PeopleAnswer {
  if (bystanders == null) return NO_ANSWER;
  return {
    others: bystanders.length > 0,
    kinds: bystanders,
    statement: statement ?? "",
    emails: requests.map((r) => r.email).join(", "),
  };
}

function emailList(typed: string): string[] {
  return typed
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** Null when the answer isn't complete; otherwise the request fields. */
export function toRequest(answer: PeopleAnswer): {
  bystanders: BystanderKind[];
  bystanderStatement: string | null;
  consentRequestEmails: string[];
} | null {
  if (answer.others === null) return null;
  if (!answer.others)
    return {
      bystanders: [],
      bystanderStatement: null,
      consentRequestEmails: [],
    };
  if (answer.kinds.length === 0) return null;
  const reachable = answer.kinds.includes("reachable");
  if (reachable && answer.statement.trim().length < 5) return null;
  const emails = answer.kinds.includes("account")
    ? emailList(answer.emails)
    : [];
  if (
    answer.kinds.includes("account") &&
    (emails.length === 0 || emails.length > MAX_PEOPLE_ASKED)
  )
    return null;
  return {
    bystanders: answer.kinds,
    bystanderStatement: reachable ? answer.statement.trim() : null,
    consentRequestEmails: emails,
  };
}

/** One line for a file in the list. */
export function peopleSummary(bystanders: BystanderKind[] | null | undefined) {
  if (bystanders == null) return "Who else it shows: not asked";
  if (bystanders.length === 0) return "Shows no one else";
  return `Also shows ${bystanders.map((k) => SHORT[k] ?? k).join(", ")}`;
}

/** Where one person with an account stands, for the uploader. */
export function requestStatus(r: UploadConsentRequest): string {
  if (r.answeredAt === null) return "waiting for their answer";
  if (r.personalisation && r.sharedTraining) return "agreed";
  if (r.personalisation) return "agreed to your topic profile only";
  if (r.sharedTraining) return "said no to your topic profile";
  return "said no";
}

export function PeopleQuestion({
  value,
  onChange,
  idPrefix,
}: {
  value: PeopleAnswer;
  onChange: (next: PeopleAnswer) => void;
  idPrefix: string;
}) {
  const toggle = (kind: BystanderKind) =>
    onChange({
      ...value,
      kinds: value.kinds.includes(kind)
        ? value.kinds.filter((k) => k !== kind)
        : [...value.kinds, kind],
    });
  return (
    <fieldset className="space-y-2" data-testid={`${idPrefix}-people`}>
      <legend className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Does it show or name anyone else?
      </legend>
      <div className="flex flex-wrap gap-4">
        {(
          [
            [false, "No, only me"],
            [true, "Yes"],
          ] as const
        ).map(([others, label]) => (
          <label
            key={label}
            className="flex items-center gap-2 text-xs text-foreground"
          >
            <input
              type="radio"
              name={`${idPrefix}-others`}
              checked={value.others === others}
              onChange={() => onChange({ ...value, others })}
              data-testid={`${idPrefix}-others-${others ? "yes" : "no"}`}
            />
            {label}
          </label>
        ))}
      </div>
      {value.others && (
        <div className="space-y-2 border border-border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">Tick all that apply.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PEOPLE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={value.kinds.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  data-testid={`${idPrefix}-kind-${opt.value}`}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {value.kinds.includes("reachable") && (
            <input
              type="text"
              aria-label="Whom you told, and that they don't object"
              placeholder="Whom you told, and that they don't object (for example: my sister Ana, she's fine with it)"
              value={value.statement}
              maxLength={500}
              onChange={(e) =>
                onChange({ ...value, statement: e.target.value })
              }
              className="w-full bg-card border border-border text-xs px-2 py-2 text-foreground"
              data-testid={`${idPrefix}-statement`}
            />
          )}
          {value.kinds.includes("account") && (
            <div className="space-y-1">
              <input
                type="text"
                aria-label="Their email addresses"
                placeholder="Their SecureAI email address (up to 5, separated by commas)"
                value={value.emails}
                maxLength={1300}
                onChange={(e) => onChange({ ...value, emails: e.target.value })}
                className="w-full bg-card border border-border text-xs px-2 py-2 text-foreground"
                data-testid={`${idPrefix}-emails`}
              />
              <p className="text-xs text-muted-foreground">
                We ask each of them in their own account. They see your name and
                email, and the file's name and type, never the file itself. No
                feature uses it until they agree.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A file showing other people is never used to train anything shared
            unless everyone in it has agreed from their own account. If anyone
            in it is under 18, no feature uses it at all.
          </p>
        </div>
      )}
    </fieldset>
  );
}
