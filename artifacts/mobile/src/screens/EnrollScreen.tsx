import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import {
  DEVICE_KEY_NAME,
  enrollBiometricKey,
  isBiometricSupported,
} from "../lib/biometricKey";
import { enrollFace } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  Card,
  Button,
  CheckRow,
  MethodOption,
  SectionNote,
  ShieldBadge,
} from "../components/ui";
import {
  FaceCapture,
  FACE_CHECK_SUPPORTED,
  FACE_CONSENT_TEXT,
} from "../components/FaceCapture";
import { colors, fonts } from "../theme";

// The second sign-in step every account needs before anything else (requireMfaEnrolled on the
// server). The person chooses one; the other can be added later under Privacy & Your Data.
// - Fingerprint: a device biometric key, not a WebAuthn passkey — see src/lib/biometricKey.ts for
//   why. This is the brief's own design (decision #1): the biometric unlocks a key on the phone
//   that signs a server challenge, and never leaves the phone.
// - Face (Android): the website's face check, in a WebView (src/components/FaceCapture.tsx). It
//   stores a face template on the server, the documented departure from the brief that the website
//   already makes (docs/04_Threat_Model_Risk_Assessment.md, R-AUTH-1), so it needs its own express
//   consent. On an iPhone, Face ID unlocks the device key instead.
export function EnrollScreen() {
  const { user, refetchUser } = useAuth();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<"face" | null>(null);
  const [faceConsent, setFaceConsent] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [busy, setBusy] = useState<"fingerprint" | "face" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    isBiometricSupported()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);

  const handleFingerprint = async () => {
    setChosen(null);
    setError("");
    setBusy("fingerprint");
    try {
      await enrollBiometricKey("Mobile device");
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Fingerprint set-up failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleFace = async (descriptor: number[]) => {
    setFaceOpen(false);
    if (!user) return;
    setError("");
    setBusy("face");
    try {
      await enrollFace(user.id, descriptor, faceConsent);
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Face set-up failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <ShieldBadge size={48} />
        <Text style={styles.title}>Second Sign-in Step Required</Text>
        <Text style={styles.subtitle}>
          Second mandatory factor for operator {user?.name}
        </Text>
      </View>

      <Card topAccent>
        <SectionNote tone="destructive">
          {FACE_CHECK_SUPPORTED
            ? "Mandatory — a password alone isn't enough. Access is blocked until you set up fingerprint or face sign-in. You can add the other later under Privacy & Your Data."
            : "Mandatory — a password alone isn't enough. Access is blocked until this phone's biometric key is registered."}
        </SectionNote>

        <View style={styles.methods}>
          <MethodOption
            title={DEVICE_KEY_NAME}
            recommended={FACE_CHECK_SUPPORTED}
            detail={
              supported === false
                ? FACE_CHECK_SUPPORTED
                  ? "This phone has no fingerprint set up. Add one in the phone's settings, or choose face."
                  : "This device doesn't support biometric authentication."
                : "Unlocks a key stored securely on this phone. The key signs a challenge from the server: your biometric never leaves the phone, and the server never sees it."
            }
            onPress={handleFingerprint}
            disabled={supported !== true || busy !== null}
            isLoading={busy === "fingerprint"}
            testID="button-enroll-fingerprint"
          />
          {FACE_CHECK_SUPPORTED ? (
            <MethodOption
              title="Face"
              detail="Look at the front camera and blink: the same face check as the website. A template of your face is stored, encrypted, on SecureAI's servers."
              onPress={() => {
                setError("");
                setChosen("face");
              }}
              disabled={busy !== null}
              isLoading={busy === "face"}
              testID="button-enroll-face"
            />
          ) : null}
        </View>

        {chosen === "face" && (
          <View style={styles.consent}>
            <CheckRow
              checked={faceConsent}
              onChange={setFaceConsent}
              testID="checkbox-biometric-consent"
            >
              {FACE_CONSENT_TEXT}
            </CheckRow>
            <Button
              onPress={() => {
                setError("");
                setFaceOpen(true);
              }}
              disabled={!faceConsent || busy !== null}
              testID="button-face-continue"
            >
              Continue to the Camera
            </Button>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      <FaceCapture
        visible={faceOpen}
        title="Set up face sign-in"
        onCapture={handleFace}
        onCancel={() => setFaceOpen(false)}
      />
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
  header: { alignItems: "center", marginBottom: 24 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 18,
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 16,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 8,
    textAlign: "center",
  },
  methods: { gap: 12, marginTop: 16, marginBottom: 16 },
  consent: { gap: 14, marginBottom: 16 },
  error: {
    fontFamily: fonts.mono,
    color: colors.destructive,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: "center",
  },
});
