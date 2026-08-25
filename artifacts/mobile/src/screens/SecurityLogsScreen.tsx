import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { listSecurityLogs, verifyLogIntegrity, type SecurityLog, type LogChainVerification } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, Input, Label, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

// No datetime picker here — adding one means a new native dependency and
// another Gradle rebuild for a feature this project's time budget didn't
// justify. Simple client-computed presets (24h/7d/all) cover the common
// case; text filters (event type, email, IP) still hit the same server-side
// filtering web uses.
const RANGE_PRESETS = [
  { label: '24H', hours: 24 },
  { label: '7D', hours: 24 * 7 },
  { label: 'All', hours: null as number | null },
];

export function SecurityLogsScreen() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [eventType, setEventType] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [rangeHours, setRangeHours] = useState<number | null>(null);
  const [verification, setVerification] = useState<LogChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const canSeeLogs = user?.role === 'security_analyst';

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    const fromDate = rangeHours ? new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString() : undefined;
    listSecurityLogs({
      eventType: eventType.trim() || undefined,
      userEmail: userEmail.trim() || undefined,
      ipAddress: ipAddress.trim() || undefined,
      fromDate,
    })
      .then(setLogs)
      .catch((err) => setError(err?.message || 'Failed to load audit trail.'))
      .finally(() => setLoading(false));
  }, [eventType, userEmail, ipAddress, rangeHours]);

  useEffect(() => { if (canSeeLogs) refresh(); }, [canSeeLogs, refresh]);

  if (!canSeeLogs) {
    return (
      <Centered>
        <Text style={styles.deniedText}>Security analyst access required.</Text>
      </Centered>
    );
  }

  const handleVerify = async () => {
    setVerifying(true);
    try {
      setVerification(await verifyLogIntegrity());
    } catch (err: any) {
      setVerification({ intact: false, rowsChecked: 0, brokenAtId: null, reason: err?.message || 'Verification failed' });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Card style={styles.filterCard}>
        <Label>Event Type</Label>
        <Input value={eventType} onChangeText={setEventType} autoCapitalize="characters" placeholder="e.g. LOGIN_FAILED" />
        <Label style={{ marginTop: 12 }}>User Email Contains</Label>
        <Input value={userEmail} onChangeText={setUserEmail} autoCapitalize="none" />
        <Label style={{ marginTop: 12 }}>IP Contains</Label>
        <Input value={ipAddress} onChangeText={setIpAddress} autoCapitalize="none" />
        <View style={styles.presetRow}>
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant={rangeHours === preset.hours ? 'default' : 'outline'}
              onPress={() => setRangeHours(preset.hours)}
              style={{ flexGrow: 1 }}
            >
              {preset.label}
            </Button>
          ))}
        </View>
        <Button size="sm" onPress={refresh} style={{ marginTop: 12 }}>Apply Filters</Button>
      </Card>

      <Card style={styles.verifyCard}>
        <Text style={styles.verifyTitle}>Chain Integrity</Text>
        {verification ? (
          <Text style={[styles.verifyResult, { color: verification.intact ? colors.success : colors.destructive }]}>
            {verification.intact
              ? `Intact — ${verification.rowsChecked} rows checked`
              : `Broken at row ${verification.brokenAtId ?? '?'} — ${verification.reason ?? 'unknown reason'}`}
          </Text>
        ) : (
          <Text style={styles.verifyResult}>Not yet checked.</Text>
        )}
        <Button size="sm" variant="outline" onPress={handleVerify} isLoading={verifying} style={{ marginTop: 10 }}>
          Verify Now
        </Button>
      </Card>

      {loading ? (
        <Centered><ActivityIndicator color={colors.primary} /></Centered>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : logs.length === 0 ? (
        <Text style={styles.emptyText}>No matching log entries.</Text>
      ) : (
        logs.map((log) => {
          const isFailure = log.eventType.includes('FAILED') || log.eventType === 'UNAUTHORIZED_ACCESS';
          const expanded = expandedId === log.id;
          return (
            <Pressable key={log.id} onPress={() => setExpandedId(expanded ? null : log.id)}>
              <Card style={styles.logCard}>
                <View style={styles.logTop}>
                  <Badge tone={isFailure ? 'destructive' : 'outline'}>{log.eventType}</Badge>
                  <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleString()}</Text>
                </View>
                <Text style={styles.logMeta}>{log.userEmail ?? 'SYSTEM'} · {log.ipAddress ?? 'unknown IP'}</Text>
                <Text style={styles.logDetails} numberOfLines={expanded ? undefined : 2}>{log.details}</Text>
              </Card>
            </Pressable>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  deniedText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  errorText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 12 },
  emptyText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 20 },
  filterCard: { marginBottom: 16 },
  presetRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  verifyCard: { marginBottom: 16 },
  verifyTitle: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  verifyResult: { fontFamily: fonts.mono, fontSize: 11, color: colors.mutedForeground },
  logCard: { marginBottom: 10, padding: 14 },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logTime: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9 },
  logMeta: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 10, marginBottom: 4 },
  logDetails: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 11, lineHeight: 16 },
});
