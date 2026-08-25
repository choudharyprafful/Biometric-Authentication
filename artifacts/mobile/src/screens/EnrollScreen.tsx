import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { enrollBiometricKey, isBiometricSupported } from '../lib/biometricKey';
import { useAuth } from '../context/AuthContext';
import { Card, Button, SectionNote, ShieldBadge } from '../components/ui';
import { colors, fonts } from '../theme';

// Mobile enrollment is a device biometric key, not a WebAuthn passkey — see
// src/lib/biometricKey.ts for why. It's still device-native and still
// app-captured-face-free, matching the brief's actual design (decision #1),
// unlike the web app which keeps an additional app-captured face factor as
// a deliberate, documented departure (see docs/04_Threat_Model_Risk_Assessment.md).
export function EnrollScreen() {
  const { user, refetchUser } = useAuth();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isBiometricSupported().then(setSupported);
  }, []);

  const handleEnroll = async () => {
    setError('');
    setBusy(true);
    try {
      await enrollBiometricKey('Mobile device');
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || 'Biometric enrollment failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <ShieldBadge size={48} />
        <Text style={styles.title}>Device Biometric Required</Text>
        <Text style={styles.subtitle}>Second mandatory factor for operator {user?.name}</Text>
      </View>

      <Card topAccent>
        <SectionNote tone="destructive">
          Mandatory — a password alone doesn't sign a server challenge. Access is blocked until a device biometric
          key is registered.
        </SectionNote>

        <Text style={styles.body}>
          Your device biometric (fingerprint / face unlock) will unlock a key stored securely on this device. That
          key signs a challenge from the server — the biometric never leaves your device, and the server never
          sees it.
        </Text>

        {supported === false ? (
          <Text style={styles.error}>This device doesn't support biometric authentication.</Text>
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button onPress={handleEnroll} isLoading={busy} disabled={supported === null} style={styles.button}>
              Register This Device
            </Button>
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 24 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 18,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 16,
    marginBottom: 20,
  },
  button: { marginTop: 4 },
  error: {
    fontFamily: fonts.mono,
    color: colors.destructive,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
});
