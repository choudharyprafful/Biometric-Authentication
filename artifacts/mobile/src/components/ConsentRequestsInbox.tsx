import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Button, Card } from "./ui";
import { colors, fonts } from "../theme";
import {
  answerConsentRequest,
  listIncomingConsentRequests,
  type IncomingConsentRequest,
} from "../lib/uploads";

// Requests to this account from people who uploaded a file that shows it, the same as the web app's
// components/ConsentRequestsInbox.tsx: Team 2's Bystander Consent Policy, section 4, first row. Each
// use is answered on its own, and an answer can be changed at any time. The file is never shown.

const USES = [
  { key: "personalisation", question: "Their topic profile may use it" },
  {
    key: "sharedTraining",
    question: "Anything shared across accounts may use it",
  },
] as const;

type Answer = {
  personalisation: boolean | null;
  sharedTraining: boolean | null;
};

function RequestCard({
  request,
  onSaved,
}: Readonly<{ request: IncomingConsentRequest; onSaved: () => void }>) {
  const answered = request.answeredAt !== null;
  const [editing, setEditing] = useState(!answered);
  const [answer, setAnswer] = useState<Answer>({
    personalisation: request.personalisation,
    sharedTraining: request.sharedTraining,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const complete =
    answer.personalisation !== null && answer.sharedTraining !== null;

  const save = async () => {
    if (!complete) return;
    setBusy(true);
    setError("");
    try {
      await answerConsentRequest(request.id, {
        personalisation: answer.personalisation === true,
        sharedTraining: answer.sharedTraining === true,
      });
      setEditing(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || "Could not save your answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card} testID={`consent-request-${request.id}`}>
      <Text style={styles.text}>
        <Text style={styles.strong}>{request.fromName}</Text> (
        {request.fromEmail}) says their {request.fileType} file "
        {request.fileName}" shows or names you, and asked whether it can be
        used.
      </Text>
      {editing ? (
        <>
          {USES.map((use) => (
            <View key={use.key} style={styles.use}>
              <Text style={styles.question}>{use.question}?</Text>
              <View style={styles.row}>
                {(
                  [
                    [true, "Yes"],
                    [false, "No"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = answer[use.key] === value;
                  return (
                    <Pressable
                      key={label}
                      onPress={() =>
                        setAnswer((a) => ({ ...a, [use.key]: value }))
                      }
                      style={[styles.chip, selected && styles.chipOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      testID={`consent-${request.id}-${use.key}-${value ? "yes" : "no"}`}
                    >
                      <Text
                        style={[styles.chipText, selected && styles.chipTextOn]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <Button
            size="sm"
            onPress={save}
            disabled={!complete}
            isLoading={busy}
            testID={`consent-${request.id}-save`}
          >
            Save my answer
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.muted}>
            You said: topic profile {request.personalisation ? "yes" : "no"},
            shared {request.sharedTraining ? "yes" : "no"}.
          </Text>
          <Button size="sm" variant="outline" onPress={() => setEditing(true)}>
            Change my answer
          </Button>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

export function ConsentRequestsInbox() {
  const [requests, setRequests] = useState<IncomingConsentRequest[]>([]);
  const refresh = useCallback(() => {
    listIncomingConsentRequests()
      .then(setRequests)
      // An older server without this endpoint, or no connection: show nothing rather than an error.
      .catch(() => setRequests([]));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (requests.length === 0) return null;
  const waiting = requests.filter((r) => r.answeredAt === null).length;
  return (
    <View style={styles.wrap} testID="consent-requests">
      <Text style={styles.label}>
        Files other people say show you
        {waiting > 0 ? ` (${waiting} to answer)` : ""}
      </Text>
      <Text style={styles.muted}>
        Until you answer, no feature uses the file. You can change an answer at
        any time.
      </Text>
      {requests.map((r) => (
        <RequestCard key={r.id} request={r} onSaved={refresh} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 20 },
  label: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  card: { gap: 10 },
  text: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
  strong: { fontWeight: "700" },
  muted: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  use: { gap: 6 },
  question: { color: colors.foreground, fontSize: 12 },
  row: { flexDirection: "row", gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.card },
  chipText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedForeground,
  },
  chipTextOn: { color: colors.primary },
  error: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 11 },
});
