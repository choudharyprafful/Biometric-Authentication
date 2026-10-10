import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
  Platform,
} from "react-native";
import { login, verifyFace } from "../lib/api";
import {
  DEVICE_KEY_NAME,
  DEVICE_KEY_PHRASE,
  loginWithBiometricKey,
  linkDeviceWithCode,
} from "../lib/biometricKey";
import { useAuth } from "../context/AuthContext";
import {
  Card,
  Label,
  Input,
  Button,
  MethodOption,
  SectionNote,
  ShieldBadge,
} from "../components/ui";
import {
  FaceCapture,
  FACE_OPTION_NAME,
  FACE_OPTION_PHRASE,
} from "../components/FaceCapture";
import { colors, fonts } from "../theme";
import { PRIVACY_POLICY_URL } from "../config";
import { FaceCameraScreen } from "./FaceCameraScreen";

type LoginStep = "password" | "choose" | "link";

// What the account has for the second step, from POST /auth/login. "fingerprint" means some
// passkey or phone key exists: the server can't tell whether it is on this phone.
interface SecondSteps {
  fingerprint: boolean;
  face: boolean;
  tempToken: string | null;
}
const NO_SECOND_STEPS: SecondSteps = {
  fingerprint: false,
  face: false,
  tempToken: null,
};

export function LoginScreen({
  onSwitchToRegister,
}: {
  onSwitchToRegister: () => void;
}) {
  const { refetchUser } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // 'choose' is step 2 of ordinary login (password succeeded): the person picks fingerprint (the
  // device biometric key) or face (the website's face check, src/components/FaceCapture.tsx) —
  // mirrors the web app's two-step flow (Login.tsx): password alone never grants a full session.
  // 'link' is the separate cross-device bootstrap for an account that has no biometric key on THIS
  // device yet (e.g. enrolled via web) — see src/lib/biometricKey.ts's linkDeviceWithCode() for why
  // that path exists.
  const [view, setView] = useState<LoginStep>("password");
  const [steps, setSteps] = useState<SecondSteps>(NO_SECOND_STEPS);
  const [checking, setChecking] = useState<"fingerprint" | "face" | null>(null);
  const [faceOpen, setFaceOpen] = useState(false);

  const handlePasswordSubmit = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await login(email.trim().toLowerCase(), password);
      if (!result.requiresFaceVerification) {
        // No MFA enrolled yet (fresh account) — already fully authenticated.
        await refetchUser();
        return;
      }
      setSteps({
        fingerprint: result.passkeyAvailable,
        face: result.faceAvailable,
        tempToken: result.tempToken,
      });
      setView("choose");
    } catch (err: any) {
      setError(err?.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleFingerprint = async () => {
    setError("");
    setChecking("fingerprint");
    try {
      const result = await loginWithBiometricKey();

      if (!result.verified) {
        throw new Error("Biometric verification failed.");
      }

      await refetchUser();
    } catch (err: any) {
      setError(err?.message || `${DEVICE_KEY_NAME} check failed.`);
    } finally {
      setChecking(null);
    }
  };

  const handleFace = async (descriptor: number[]) => {
    setFaceOpen(false);
    setError("");
    if (!steps.tempToken) {
      setError("Sign-in has expired. Go back and enter your password again.");
      return;
    }
    setChecking("face");
    try {
      await verifyFace(descriptor, steps.tempToken);
      await refetchUser();
    } catch (err: any) {
      // The server's message says whether another scan is allowed or the password is needed again.
      setError(err?.message || "Face check failed.");
    } finally {
      setChecking(null);
    }
  };

  const backToPassword = () => {
    setError("");
    setSteps(NO_SECOND_STEPS);
    setView("password");
  };

  const handleLinkDevice = async () => {
    setError("");
    setBusy(true);
    try {
      await linkDeviceWithCode(linkCode.trim(), "Mobile device");
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || "Device linking failed.");
    } finally {
      setBusy(false);
    }
  };

  if (showCamera)
    return <FaceCameraScreen onBack={() => setShowCamera(false)} />;
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <ShieldBadge />
        <Text style={styles.title}>SecureAI</Text>
        <Text style={styles.subtitle}>Identity Verification</Text>
      </View>

      <Card accentCorners style={styles.card}>
        {view === "password" && (
          <>
            <View style={styles.field}>
              <Label>Operator ID (Email)</Label>
              <Input
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>
            <View style={styles.field}>
              <Label>Password</Label>
              <Input
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
            </View>

            <SectionNote>
              {Platform.OS === "ios"
                ? "Biometric MFA — after your password, finish signing in with Face ID or Touch ID, or a face scan."
                : "Biometric MFA — after your password, choose fingerprint or face to finish signing in."}
            </SectionNote>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              onPress={handlePasswordSubmit}
              isLoading={busy}
              style={styles.submitButton}
            >
              Authenticate
            </Button>

            <Pressable onPress={onSwitchToRegister}>
              <Text style={styles.link}>Need an account? Register</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setError("");
                setView("link");
              }}
            >
              <Text style={styles.link}>
                Link this device to an existing account
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void Linking.openURL(PRIVACY_POLICY_URL);
              }}
              accessibilityRole="link"
            >
              <Text style={styles.link}>Privacy Policy</Text>
            </Pressable>
          </>
        )}

        {view === "choose" && (
          <View style={styles.verifyStep}>
            <ShieldBadge size={48} />
            <Button onPress={() => setShowCamera(true)}>
              Open Front Camera
            </Button>
            <Text style={styles.verifyTitle}>Verify It's You</Text>
            <Text style={styles.verifySubtitle}>
              Password confirmed. Choose how to finish signing in.
            </Text>
            <View style={styles.methods}>
              <MethodOption
                title={DEVICE_KEY_NAME}
                recommended={steps.fingerprint}
                detail={
                  steps.fingerprint
                    ? "Unlocks a key kept on this phone, which signs a one-time challenge. Your biometric never leaves the phone."
                    : `Not set up for this account. Sign in with ${FACE_OPTION_PHRASE}, then set it up under Privacy & Your Data.`
                }
                onPress={handleFingerprint}
                disabled={!steps.fingerprint || checking !== null}
                isLoading={checking === "fingerprint"}
                testID="button-signin-fingerprint"
              />
              <MethodOption
                title={FACE_OPTION_NAME}
                detail={
                  steps.face
                    ? "Look at the front camera and blink: the same face check as the website."
                    : `Not set up for this account. Sign in with ${DEVICE_KEY_PHRASE}, then set it up under Privacy & Your Data.`
                }
                onPress={() => {
                  setError("");
                  setFaceOpen(true);
                }}
                disabled={!steps.face || checking !== null}
                isLoading={checking === "face"}
                testID="button-signin-face"
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              onPress={() => {
                setError("");
                setView("link");
              }}
            >
              <Text style={styles.link}>
                No key on this phone yet? Link this device
              </Text>
            </Pressable>
            <Pressable onPress={backToPassword}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
          </View>
        )}

        {view === "link" && (
          <View style={styles.verifyStep}>
            <ShieldBadge size={48} />
            <Button onPress={() => setShowCamera(true)}>
              Open Front Camera
            </Button>
            <Text style={styles.verifyTitle}>Link This Device</Text>
            <Text style={styles.verifySubtitle}>
              Enter the code shown on an already signed-in session (web →
              Security Settings → "Link Mobile Device"). Your biometric will
              unlock a new key for this device.
            </Text>
            <View style={[styles.field, styles.fullWidth]}>
              <Label>Link Code</Label>
              <Input
                autoCapitalize="characters"
                autoCorrect={false}
                value={linkCode}
                onChangeText={setLinkCode}
                placeholder="XXXXXXXXXX"
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              onPress={handleLinkDevice}
              isLoading={busy}
              disabled={!linkCode.trim()}
              style={styles.submitButton}
            >
              Link Device
            </Button>
            <Pressable
              onPress={() => {
                setError("");
                setLinkCode("");
                setView("password");
              }}
            >
              <Text style={styles.link}>Back</Text>
            </Pressable>
          </View>
        )}
      </Card>

      <FaceCapture
        visible={faceOpen}
        title="Sign in with your face"
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
  header: { alignItems: "center", marginBottom: 32 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 26,
    textTransform: "uppercase",
    letterSpacing: 4,
    marginTop: 16,
  },
  subtitle: {
    fontFamily: fonts.mono,
    color: `${colors.primary}B3`,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 3,
    marginTop: 6,
  },
  card: { gap: 0 },
  field: { marginBottom: 16 },
  fullWidth: { alignSelf: "stretch" },
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
  verifyStep: { alignItems: "center" },
  methods: { alignSelf: "stretch", gap: 12, marginBottom: 16 },
  verifyTitle: {
    fontFamily: fonts.mono,
    color: colors.primary,
    fontSize: 18,
    textTransform: "uppercase",
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 8,
  },
  verifySubtitle: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: "center",
    marginBottom: 20,
    lineHeight: 18,
  },
});
