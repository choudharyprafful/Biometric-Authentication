import React from "react";
import type { BystanderKind } from "@workspace/api-client-react";

// Team 2's Bystander Consent Policy (docs/08 section 5h): the uploader says who else a file shows or
// names. That declaration is the policy's detection method; nothing scans uploads for faces or voices.
// What each answer does is in the API's lib/dataProvenance.ts (assessPeopleRules).

export const PEOPLE_OPTIONS: { value: BystanderKind; label: string }[] = [
  {
    value: "reachable",
    label: "Someone I've told about it, who doesn't object",
  },
  { value: "unreachable", label: "Someone I can't contact" },
  { value: "minor", label: "Someone under 18" },
  { value: "deceased", label: "Someone who has died" },
];

const SHORT: Record<string, string> = {
  reachable: "someone you told",
  unreachable: "someone you can't contact",
  minor: "someone under 18",
  deceased: "someone who has died",
};

export interface PeopleAnswer {
  others: boolean | null;
  kinds: BystanderKind[];
  statement: string;
}

export const NO_ANSWER: PeopleAnswer = {
  others: null,
  kinds: [],
  statement: "",
};

export function answerFrom(
  bystanders: BystanderKind[] | null | undefined,
  statement: string | null | undefined,
): PeopleAnswer {
  if (bystanders == null) return NO_ANSWER;
  return {
    others: bystanders.length > 0,
    kinds: bystanders,
    statement: statement ?? "",
  };
}

/** Null when the answer isn't complete; otherwise the request fields. */
export function toRequest(answer: PeopleAnswer): {
  bystanders: BystanderKind[];
  bystanderStatement: string | null;
} | null {
  if (answer.others === null) return null;
  if (!answer.others) return { bystanders: [], bystanderStatement: null };
  if (answer.kinds.length === 0) return null;
  const reachable = answer.kinds.includes("reachable");
  if (reachable && answer.statement.trim().length < 5) return null;
  return {
    bystanders: answer.kinds,
    bystanderStatement: reachable ? answer.statement.trim() : null,
  };
}

/** One line for a file in the list. */
export function peopleSummary(bystanders: BystanderKind[] | null | undefined) {
  if (bystanders == null) return "Who else it shows: not asked";
  if (bystanders.length === 0) return "Shows no one else";
  return `Also shows ${bystanders.map((k) => SHORT[k] ?? k).join(", ")}`;
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
          <p className="text-xs text-muted-foreground">
            A file showing other people is never used to train anything shared.
            If anyone in it is under 18, no feature uses it at all.
          </p>
        </div>
      )}
    </fieldset>
  );
}
