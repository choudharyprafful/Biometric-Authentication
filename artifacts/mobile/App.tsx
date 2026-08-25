import React, { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { RegisterScreen } from './src/screens/RegisterScreen';
import { EnrollScreen } from './src/screens/EnrollScreen';
import { AppShell } from './src/navigation/AppShell';
import { colors } from './src/theme';

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
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
});
