import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { login } from '../lib/api';
import { loginWithBiometricKey, linkDeviceWithCode } from '../lib/biometricKey';
import { useAuth } from '../context/AuthContext';
import { Card, Label, Input, Button, SectionNote, ShieldBadge } from '../components/ui';
import { colors, fonts } from '../theme';

type View = 'password' | 'biometric' | 'link';

export function LoginScreen({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
  const { refetchUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 'biometric' is step 2 of ordinary login (password succeeded, a device
  // biometric-key ceremony is needed) — mirrors the web app's two-step flow
  // (Login.tsx): password alone never grants a full session. 'link' is the
  // separate cross-device bootstrap for an account that has no biometric key
  // on THIS device yet (e.g. enrolled via web) — see src/lib/biometricKey.ts's
  // linkDeviceWithCode() for why that path exists.
  const [view, setView] = useState<View>('password');

  const handlePasswordSubmit = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await login(email.trim().toLowerCase(), password);
      if (!result.requiresFaceVerification) {
        // No MFA enrolled yet (fresh account) — already fully authenticated.
        await refetchUser();
        return;
      }
      if (!result.passkeyAvailable) {
        setError('This account has no device biometric key enrolled on this device. Use "Link this device" below with a code from an already signed-in session.');
        return;
      }
      setView('biometric');
    } catch (err: any) {
      setError(err?.message || 'Login failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleBiometricStep = async () => {
    setError('');
    setBusy(true);
    try {
      await loginWithBiometricKey();
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || 'Biometric verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleLinkDevice = async () => {
    setError('');
    setBusy(true);
    try {
      await linkDeviceWithCode(linkCode.trim(), 'Mobile device');
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || 'Device linking failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <ShieldBadge />
        <Text style={styles.title}>SecureAI</Text>
        <Text style={styles.subtitle}>Identity Verification</Text>
      </View>

      <Card accentCorners style={styles.card}>
        {view === 'password' && (
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
              <Input secureTextEntry value={password} onChangeText={setPassword} />
            </View>

            <SectionNote>
              Biometric MFA — enrolled operators continue to a device biometric check after password verification.
            </SectionNote>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button onPress={handlePasswordSubmit} isLoading={busy} style={styles.submitButton}>
              Authenticate
            </Button>

            <Pressable onPress={onSwitchToRegister}>
              <Text style={styles.link}>Need an account? Register</Text>
            </Pressable>
            <Pressable onPress={() => { setError(''); setView('link'); }}>
              <Text style={styles.link}>Link this device to an existing account</Text>
            </Pressable>
          </>
        )}

        {view === 'biometric' && (
          <View style={styles.verifyStep}>
            <ShieldBadge size={48} />
            <Text style={styles.verifyTitle}>Verify It's You</Text>
            <Text style={styles.verifySubtitle}>
              Password confirmed. Complete sign-in with your device biometric.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button onPress={handleBiometricStep} isLoading={busy} style={styles.submitButton}>
              Use Device Biometric
            </Button>
            <Pressable onPress={() => { setError(''); setView('password'); }}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
          </View>
        )}

        {view === 'link' && (
          <View style={styles.verifyStep}>
            <ShieldBadge size={48} />
            <Text style={styles.verifyTitle}>Link This Device</Text>
            <Text style={styles.verifySubtitle}>
              Enter the code shown on an already signed-in session (web → Security Settings → "Link
              Mobile Device"). Your biometric will unlock a new key for this device.
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
            <Button onPress={handleLinkDevice} isLoading={busy} disabled={!linkCode.trim()} style={styles.submitButton}>
              Link Device
            </Button>
            <Pressable onPress={() => { setError(''); setLinkCode(''); setView('password'); }}>
              <Text style={styles.link}>Back</Text>
            </Pressable>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 32 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 26,
    textTransform: 'uppercase',
    letterSpacing: 4,
    marginTop: 16,
  },
  subtitle: {
    fontFamily: fonts.mono,
    color: `${colors.primary}B3`,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginTop: 6,
  },
  card: { gap: 0 },
  field: { marginBottom: 16 },
  fullWidth: { alignSelf: 'stretch' },
  submitButton: { marginTop: 8, marginBottom: 16 },
  error: {
    fontFamily: fonts.mono,
    color: colors.destructive,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: 'center',
  },
  link: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 8,
  },
  verifyStep: { alignItems: 'center' },
  verifyTitle: {
    fontFamily: fonts.mono,
    color: colors.primary,
    fontSize: 18,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 8,
  },
  verifySubtitle: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
});
