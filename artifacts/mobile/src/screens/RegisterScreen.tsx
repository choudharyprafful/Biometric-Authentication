import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
} from "react-native";
import { register } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  Card,
  Label,
  Input,
  Button,
  ShieldBadge,
  CheckRow,
  SectionNote,
} from "../components/ui";
import { colors, fonts } from "../theme";
import {
  MINOR_CONSENT_AGE_THRESHOLD,
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_VERSION,
} from "../config";

// Same fields, wording and rules as the web sign-up (artifacts/secureai/src/pages/Register.tsx).
// Until 2026-09-27 this screen sent dataConsent: true without asking and no date of birth, so
// the app claimed a consent nobody gave, and the API rejected every mobile sign-up anyway.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function computeAge(dateOfBirth: string): number | null {
  if (!DATE_PATTERN.test(dateOfBirth)) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() &&
      now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function RegisterScreen({
  onSwitchToLogin,
}: Readonly<{
  onSwitchToLogin: () => void;
}>) {
  const { refetchUser } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [parentGuardianEmail, setParentGuardianEmail] = useState("");
  const [dataConsent, setDataConsent] = useState(false);
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingGuardian, setAwaitingGuardian] = useState(false);

  const age = computeAge(dateOfBirth.trim());
  const isMinor = age !== null && age < MINOR_CONSENT_AGE_THRESHOLD;

  const handleRegister = async () => {
    setError("");
    if (password !== confirmPassword) {
      setError("The passwords don't match.");
      return;
    }
    if (age === null || age < 0) {
      setError("Enter your date of birth as YYYY-MM-DD.");
      return;
    }
    if (!dataConsent) {
      setError("You must consent to data processing to register.");
      return;
    }
    if (isMinor && !parentGuardianEmail.trim()) {
      setError(
        `A parent or guardian email is required to register under ${MINOR_CONSENT_AGE_THRESHOLD}.`,
      );
      return;
    }
    setBusy(true);
    try {
      const res = await register({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        password,
        dateOfBirth: dateOfBirth.trim(),
        parentGuardianEmail: isMinor ? parentGuardianEmail.trim() : undefined,
        dataConsent,
        trainingConsent,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      });
      if (res.user.parentConsentPending) {
        setAwaitingGuardian(true);
        return;
      }
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  };

  if (awaitingGuardian) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <ShieldBadge size={48} />
          <Text style={styles.title}>Parental Consent Required</Text>
        </View>
        <Card topAccent>
          <Text style={styles.body} testID="register-awaiting-guardian">
            Account created for {email.trim().toLowerCase()}, but it can't be
            used yet. We've sent a confirmation link to{" "}
            <Text style={styles.accent}>{parentGuardianEmail.trim()}</Text>. The
            account activates once your parent or guardian confirms.
          </Text>
          <Pressable onPress={onSwitchToLogin}>
            <Text style={styles.link}>Return to Authentication</Text>
          </Pressable>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <ShieldBadge size={48} />
        <Text style={styles.title}>New Operator Onboarding</Text>
      </View>

      <Card topAccent>
        <View style={styles.field}>
          <Label>Full Designation (Name)</Label>
          <Input value={name} onChangeText={setName} testID="input-name" />
        </View>
        <View style={styles.field}>
          <Label>Operator ID (Email)</Label>
          <Input
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            testID="input-email"
          />
        </View>
        <View style={styles.field}>
          <Label>Password</Label>
          <Input
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            testID="input-password"
          />
        </View>
        <View style={styles.field}>
          <Label>Confirm Password</Label>
          <Input
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            testID="input-confirm-password"
          />
        </View>
        <View style={styles.field}>
          <Label>Date of Birth</Label>
          <Input
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            value={dateOfBirth}
            onChangeText={setDateOfBirth}
            testID="input-date-of-birth"
          />
        </View>
        {isMinor ? (
          <View style={styles.field}>
            <SectionNote>
              Accounts under {MINOR_CONSENT_AGE_THRESHOLD} need a parent or
              guardian to confirm before the account can be used.
            </SectionNote>
            <Label>Parent / Guardian Email</Label>
            <Input
              autoCapitalize="none"
              keyboardType="email-address"
              value={parentGuardianEmail}
              onChangeText={setParentGuardianEmail}
              testID="input-parent-guardian-email"
            />
          </View>
        ) : null}

        <View style={styles.consents}>
          <CheckRow
            checked={dataConsent}
            onChange={setDataConsent}
            testID="checkbox-data-consent"
          >
            I consent to my account and profile data being processed and stored
            for the purposes of this application. I understand I can request
            deletion of my account at any time.
          </CheckRow>
          <CheckRow
            checked={trainingConsent}
            onChange={setTrainingConsent}
            testID="checkbox-training-consent"
          >
            Optional: allow my activity (which actions I take, never what I
            upload) to contribute to the app's behaviour-suggestion model.
            Leaving this unticked doesn't affect anything else. You can change
            it any time under Privacy &amp; Your Data.
          </CheckRow>
        </View>

        <Text style={styles.notice} testID="register-privacy-notice">
          Before you create an account, read our{" "}
          <Text
            style={styles.inlineLink}
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          >
            Privacy Policy
          </Text>
          : what we collect, where it is stored (in the United States), and how
          to download or delete it. This is a student proof of concept, so
          please use test details rather than your real information.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          onPress={handleRegister}
          isLoading={busy}
          disabled={!dataConsent}
          style={styles.submitButton}
          testID="button-register"
        >
          Issue Clearance
        </Button>
        <Pressable onPress={onSwitchToLogin}>
          <Text style={styles.link}>Return to Authentication</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: "center",
  },
  header: { alignItems: "center", marginBottom: 32 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 18,
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 16,
    textAlign: "center",
  },
  field: { marginBottom: 16 },
  consents: { gap: 14, marginBottom: 16 },
  notice: {
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  inlineLink: { color: colors.primary, textDecorationLine: "underline" },
  body: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 16,
  },
  accent: { color: colors.primary },
  submitButton: { marginTop: 8, marginBottom: 16 },
  error: {
    fontFamily: fonts.mono,
    color: colors.destructive,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: "center",
  },
  link: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 8,
  },
});
