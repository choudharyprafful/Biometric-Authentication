import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { register } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, Label, Input, Button, ShieldBadge } from '../components/ui';
import { colors, fonts } from '../theme';

export function RegisterScreen({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
  const { refetchUser } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleRegister = async () => {
    setError('');
    setBusy(true);
    try {
      await register(email.trim().toLowerCase(), name.trim(), password);
      await refetchUser();
    } catch (err: any) {
      setError(err?.message || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <ShieldBadge size={48} />
        <Text style={styles.title}>New Operator Onboarding</Text>
      </View>

      <Card topAccent>
        <View style={styles.field}>
          <Label>Full Designation (Name)</Label>
          <Input value={name} onChangeText={setName} />
        </View>
        <View style={styles.field}>
          <Label>Operator ID (Email)</Label>
          <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        </View>
        <View style={styles.field}>
          <Label>Password</Label>
          <Input secureTextEntry value={password} onChangeText={setPassword} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button onPress={handleRegister} isLoading={busy} style={styles.submitButton}>
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
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 32 },
  title: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 18,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginTop: 16,
    textAlign: 'center',
  },
  field: { marginBottom: 16 },
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
});
