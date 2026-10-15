import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { EnrollScreen } from "./src/screens/EnrollScreen";
import { AppShell } from "./src/navigation/AppShell";
import { colors, fonts } from "./src/theme";
import { Button, Card } from "./src/components/ui";
import { logout } from "./src/lib/api";
import {
  checkDeviceIntegrity,
  describeFindings,
  type IntegrityFinding,
} from "./src/lib/deviceIntegrity";
import { WEB_BASE_URL } from "./src/config";

// Shown once per launch when the device check finds something (src/lib/deviceIntegrity.ts). The
// person can carry on: setting up a new phone key stays off on this device, and the server records
// the finding. The website is offered because a browser on a trusted computer doesn't share this
// risk.
function DeviceWarningView({
  findings,
  onContinue,
}: Readonly<{ findings: IntegrityFinding[]; onContinue: () => void }>) {
  return (
    <View style={styles.loading} testID="device-warning">
      <Card topAccent style={styles.card}>
        <Text style={styles.title}>This device may not be safe</Text>
        {describeFindings(findings).map((line) => (
          <Text key={line} style={styles.body}>
            {line}
          </Text>
        ))}
        <Text style={styles.body}>
          You can carry on, but setting up a new fingerprint or Face ID key is
          turned off here, and we record that this device was flagged. A browser
          on a trusted computer is safer.
        </Text>
        <Button onPress={() => void Linking.openURL(WEB_BASE_URL)}>
          Use the website instead
        </Button>
        <Button
          variant="outline"
          onPress={onContinue}
          testID="device-warning-continue"
        >
          Continue on this device
        </Button>
      </Card>
    </View>
  );
}

function AwaitingGuardianView() {
  const { user, refetchUser } = useAuth();
  const signOut = async () => {
    await logout().catch(() => {});
    await refetchUser();
  };
  return (
    <View style={styles.loading}>
      <Card topAccent style={styles.card}>
        <Text style={styles.title}>Parental Consent Required</Text>
        <Text style={styles.body} testID="awaiting-guardian">
          {user?.email} can't be used until your parent or guardian confirms
          using the link we emailed them.
        </Text>
        <Button variant="outline" onPress={signOut}>
          Sign out
        </Button>
      </Card>
    </View>
  );
}

function RootView() {
  const { user, isLoading } = useAuth();
  const [showRegister, setShowRegister] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!user) {
    return showRegister ? (
      <RegisterScreen onSwitchToLogin={() => setShowRegister(false)} />
    ) : (
      <LoginScreen onSwitchToRegister={() => setShowRegister(true)} />
    );
  }

  // A minor's account can't do anything until a parent or guardian confirms (requireParentConsent
  // on the server); say so rather than sending them into enrolment, which would be refused.
  if (user.parentConsentPending) return <AwaitingGuardianView />;

  // Either factor satisfies MFA (see requireMfaEnrolled.ts): face (the
  // website's face check, which the app also offers — src/components/
  // FaceCapture.tsx) or passkeyEnrolled. That field name is reused from the
  // WebAuthn-passkey era but now also covers device biometric keys (Keystore +
  // BiometricPrompt) — see routes/auth.ts mapUser and src/lib/biometricKey.ts
  // for why mobile no longer uses real passkeys.
  const mfaComplete = user.faceEnrolled || user.passkeyEnrolled;
  return mfaComplete ? <AppShell /> : <EnrollScreen />;
}

export default function App() {
  // null while the device check runs: it decides whether requests carry the device warning.
  const [findings, setFindings] = useState<IntegrityFinding[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    void checkDeviceIntegrity().then(setFindings);
  }, []);

  let content: React.ReactNode;
  if (findings === null) {
    content = (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  } else {
    // The warning sits inside AuthProvider, so the check of who is signed in starts behind it
    // (with the finding on that first request) and is ready when the person carries on. Nothing
    // else is shown until they do.
    content = (
      <AuthProvider>
        {findings.length > 0 && !acknowledged ? (
          <DeviceWarningView
            findings={findings}
            onContinue={() => setAcknowledged(true)}
          />
        ) : (
          <RootView />
        )}
      </AuthProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.flex}>
        {content}
        <StatusBar style="light" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: { gap: 16, alignSelf: "stretch" },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 16,
    textTransform: "uppercase",
    letterSpacing: 2,
  },
  body: { color: colors.mutedForeground, fontSize: 13, lineHeight: 19 },
});
