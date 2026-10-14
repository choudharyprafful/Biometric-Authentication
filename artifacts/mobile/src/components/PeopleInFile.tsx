import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { CheckRow, Input } from "./ui";
import { colors, fonts } from "../theme";
import type { BystanderKind, PeopleRequest } from "../lib/uploads";

// Team 2's Bystander Consent Policy on the phone, the same question as the web app's
// components/PeopleInFile.tsx: the uploader says who else a file shows or names. That declaration is
// the policy's detection method; nothing scans uploads for faces or voices. What each answer does is
// in the API's lib/dataProvenance.ts (assessPeopleRules).

export const PEOPLE_OPTIONS: { value: BystanderKind; label: string }[] = [
  {
    value: "reachable",
    label: "Someone I've told about it, who doesn't object",
  },
  { value: "unreachable", label: "Someone I can't contact" },
  { value: "minor", label: "Someone under 18" },
  { value: "deceased", label: "Someone who has died" },
];

const SHORT: Record<BystanderKind, string> = {
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
export function toRequest(answer: PeopleAnswer): PeopleRequest | null {
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
  if (bystanders === undefined) return null;
  if (bystanders === null) return "Who else it shows: not asked";
  if (bystanders.length === 0) return "Shows no one else";
  return `Also shows ${bystanders.map((k) => SHORT[k] ?? k).join(", ")}`;
}

export function PeopleQuestion({
  value,
  onChange,
  testIdPrefix,
}: Readonly<{
  value: PeopleAnswer;
  onChange: (next: PeopleAnswer) => void;
  testIdPrefix: string;
}>) {
  const toggle = (kind: BystanderKind) =>
    onChange({
      ...value,
      kinds: value.kinds.includes(kind)
        ? value.kinds.filter((k) => k !== kind)
        : [...value.kinds, kind],
    });
  return (
    <View style={styles.wrap} testID={`${testIdPrefix}-people`}>
      <Text style={styles.label}>Does it show or name anyone else?</Text>
      <View style={styles.choiceRow}>
        {(
          [
            [false, "No, only me"],
            [true, "Yes"],
          ] as const
        ).map(([others, label]) => {
          const selected = value.others === others;
          return (
            <Pressable
              key={label}
              onPress={() => onChange({ ...value, others })}
              style={[styles.chip, selected && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`${testIdPrefix}-others-${others ? "yes" : "no"}`}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value.others ? (
        <View style={styles.details}>
          <Text style={styles.note}>Tick all that apply.</Text>
          {PEOPLE_OPTIONS.map((opt) => (
            <CheckRow
              key={opt.value}
              checked={value.kinds.includes(opt.value)}
              onChange={() => toggle(opt.value)}
              testID={`${testIdPrefix}-kind-${opt.value}`}
            >
              {opt.label}
            </CheckRow>
          ))}
          {value.kinds.includes("reachable") ? (
            <Input
              accessibilityLabel="Whom you told, and that they don't object"
              placeholder="Whom you told, and that they don't object (for example: my sister Ana, she's fine with it)"
              value={value.statement}
              maxLength={500}
              onChangeText={(statement) => onChange({ ...value, statement })}
              testID={`${testIdPrefix}-statement`}
            />
          ) : null}
          <Text style={styles.note}>
            A file showing other people is never used to train anything shared.
            If anyone in it is under 18, no feature uses it at all.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 14 },
  label: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  choiceRow: { flexDirection: "row", gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.card },
  chipText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  chipTextOn: { color: colors.primary },
  details: {
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  note: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 10,
    lineHeight: 15,
  },
});
