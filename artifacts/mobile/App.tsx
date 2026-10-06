import React, { useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
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

  // Either factor satisfies MFA (see requireMfaEnrolled.ts) — a mobile
  // account only ever has passkeyEnrolled, never faceEnrolled. That field
  // name is reused from the WebAuthn-passkey era but now also covers device
  // biometric keys (Keystore + BiometricPrompt) — see routes/auth.ts mapUser
  // and src/lib/biometricKey.ts for why mobile no longer uses real passkeys.
  const mfaComplete = user.faceEnrolled || user.passkeyEnrolled;
  return mfaComplete ? <AppShell /> : <EnrollScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.flex}>
        <AuthProvider>
          <RootView />
        </AuthProvider>
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
