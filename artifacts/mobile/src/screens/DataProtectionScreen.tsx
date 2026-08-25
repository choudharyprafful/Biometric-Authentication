import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Card, Badge } from '../components/ui';
import { colors, fonts } from '../theme';

interface Row {
  data: string;
  storedIn: string;
  atRest: string;
  access: string;
}

// Ported directly from artifacts/secureai/src/pages/DataProtection.tsx's
// ROWS constant — this is static reference content, not API-backed, so it's
// kept as a literal here rather than fetched.
const ROWS: Row[] = [
  {
    data: 'Password',
    storedIn: 'users.password_hash',
    atRest: 'bcrypt hash (cost 12) — one-way, never decrypted',
    access: 'Never returned by any API response',
  },
  {
    data: 'Face biometric descriptor',
    storedIn: 'users.face_descriptor_ciphertext / _iv / _auth_tag',
    atRest: 'AES-256-GCM encrypted',
    access: 'Decrypted in memory only to compare a live scan; never sent to the client',
  },
  {
    data: 'Passkey public key',
    storedIn: 'passkeys.public_key',
    atRest: "Public key only — the private key never leaves the user's device",
    access: 'Used to verify signed challenges; not a secret if exposed',
  },
  {
    data: 'Device biometric key public key',
    storedIn: 'biometric_keys.public_key',
    atRest: 'Public key only — the private key never leaves Android Keystore',
    access: 'Used to verify signed challenges; not a secret if exposed',
  },
  {
    data: 'Uploaded files (text / image / video / audio)',
    storedIn: 'uploads.ciphertext / iv / auth_tag',
    atRest: 'AES-256-GCM encrypted',
    access: 'Strictly the uploader — no admin bypass',
  },
  {
    data: 'Payment provider token',
    storedIn: 'payments.provider_token_ciphertext / iv / auth_tag',
    atRest: 'AES-256-GCM encrypted',
    access: 'Owner or admin',
  },
  {
    data: 'Password-reset token',
    storedIn: 'password_reset_tokens.token_hash',
    atRest: 'SHA-256 hash, single-use, 30-minute expiry',
    access: 'Consumed server-side only; raw token only ever exists in the emailed link',
  },
  {
    data: 'Session identity',
    storedIn: 'connect.sid cookie + session table',
    atRest: 'httpOnly, Secure in production, SameSite=Lax',
    access: 'Server-validated only — not readable by page JavaScript',
  },
  {
    data: 'Audit / security logs',
    storedIn: 'security_logs',
    atRest: 'Hash-chained (SHA-256, links each row to the one before it) — tampering is detectable, not just logged',
    access: 'Security analyst only',
  },
];

export function DataProtectionScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.infoCard}>
        <Text style={styles.infoTitle}>Encryption at Rest</Text>
        <Text style={styles.infoText}>
          Face descriptors, uploaded files, and payment provider tokens are all AES-256-GCM encrypted before being
          written to Postgres — the raw database columns hold only ciphertext, never plaintext.
        </Text>
      </Card>
      <Card style={styles.infoCard}>
        <Text style={styles.infoTitle}>Encryption in Transit</Text>
        <Text style={styles.infoText}>
          In production, every request is forced onto HTTPS (plain HTTP redirects, 308) and browsers are told to
          remember that via HSTS. Session cookies carry the Secure flag in production.
        </Text>
      </Card>

      {ROWS.map((row) => (
        <Card key={row.data} style={styles.rowCard}>
          <Text style={styles.rowData}>{row.data}</Text>
          <View style={styles.storedInPill}>
            <Text style={styles.storedInText}>{row.storedIn}</Text>
          </View>
          <View style={styles.atRestRow}>
            <Badge tone="success">Encrypted</Badge>
          </View>
          <Text style={styles.atRestDetail}>{row.atRest}</Text>
          <Text style={styles.accessLabel}>Who can access it</Text>
          <Text style={styles.accessText}>{row.access}</Text>
        </Card>
      ))}

      <Text style={styles.disclaimer}>
        Known limitation: the hash-chain write queue and rate limiters are in-memory and single-process — correct
        for this demo's single server instance, but a real multi-instance deployment would need a shared store
        (e.g. Redis) instead.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  infoCard: { marginBottom: 12 },
  infoTitle: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  infoText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 11, lineHeight: 17 },
  rowCard: { marginBottom: 12 },
  rowData: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  storedInPill: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, padding: 6, marginBottom: 10, alignSelf: 'flex-start' },
  storedInText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 10 },
  atRestRow: { marginBottom: 6 },
  atRestDetail: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 10, lineHeight: 15, marginBottom: 10 },
  accessLabel: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  accessText: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 11 },
  disclaimer: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, lineHeight: 14, marginTop: 8 },
});
