import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { logout, logoutAll, getDashboard, type SecurityDashboard } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, StatCard, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

export function DashboardScreen() {
  const { user, refetchUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [dashboard, setDashboard] = useState<SecurityDashboard | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  useEffect(() => {
    getDashboard()
      .then(setDashboard)
      .catch(() => setDashboard(null))
      .finally(() => setLoadingDashboard(false));
  }, []);

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      await refetchUser();
      setBusy(false);
    }
  };

  const handleLogoutAll = async () => {
    setBusy(true);
    try {
      const result = await logoutAll();
      Alert.alert('Signed out everywhere', `${result.terminatedSessions} session(s) terminated.`);
    } finally {
      await refetchUser();
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.statusRow}>
        <Text style={styles.subtitle}>Welcome, {user.name}</Text>
        <View style={styles.statusRight}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Nominal</Text>
        </View>
      </View>

      {loadingDashboard ? (
        <Centered>
          <ActivityIndicator color={colors.primary} />
        </Centered>
      ) : dashboard ? (
        <>
          <View style={styles.statGrid}>
            <StatCard label="Active Operators" value={dashboard.totalUsers} tone="info" />
            <StatCard label="Biometric Enrolled" value={dashboard.faceEnrolledUsers} tone="primary" />
            <StatCard
              label="Failed Access (24h)"
              value={dashboard.failedLogins24h}
              tone={dashboard.failedLogins24h > 10 ? 'destructive' : 'warning'}
            />
            <StatCard
              label="Active Threats"
              value={dashboard.threatsDetected}
              tone={dashboard.threatsDetected > 0 ? 'destructive' : 'success'}
            />
          </View>

          {dashboard.recentLogs.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Recent Audit Trail</Text>
              <Card style={styles.logsCard}>
                {dashboard.recentLogs.map((log, i) => (
                  <View key={log.id} style={[styles.logRow, i === dashboard.recentLogs.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={styles.logRowTop}>
                      <Badge tone={log.eventType.includes('FAILED') || log.eventType === 'UNAUTHORIZED_ACCESS' ? 'destructive' : 'outline'}>
                        {log.eventType}
                      </Badge>
                      <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleString()}</Text>
                    </View>
                    <Text style={styles.logDetails} numberOfLines={2}>{log.details}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Account</Text>
      <Card topAccent style={styles.card}>
        <Row label="Email" value={user.email} />
        <Row label="Role" value={user.role} />
        <Row label="Device biometric enrolled" value={user.passkeyEnrolled ? 'Yes' : 'No'} />
        <Row label="Face enrolled" value={user.faceEnrolled ? 'Yes (web)' : 'No'} />
        <Row label="Plan" value={user.subscriptionPlan} last />
      </Card>

      <Button onPress={handleLogout} disabled={busy} style={styles.button}>
        Log Out
      </Button>
      <Button onPress={handleLogoutAll} disabled={busy} variant="destructive" style={styles.button}>
        Sign Out of All Devices
      </Button>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, padding: 20, paddingBottom: 40 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  subtitle: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  statusText: {
    fontFamily: fonts.mono,
    color: colors.success,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  sectionTitle: {
    fontFamily: fonts.mono,
    color: colors.foreground,
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 8,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 8,
  },
  logsCard: { padding: 0, marginBottom: 24 },
  logRow: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  logRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logTime: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9 },
  logDetails: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 11, lineHeight: 16 },
  card: { marginBottom: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowValue: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 13, fontWeight: '600' },
  button: { marginBottom: 12 },
});
