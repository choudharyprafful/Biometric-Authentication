import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { listThreats, type Threat } from '../lib/api';
import { Card, Badge, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

const SEVERITY_TONE: Record<Threat['severity'], 'destructive' | 'warning' | 'info' | 'outline'> = {
  critical: 'destructive',
  high: 'destructive',
  medium: 'warning',
  low: 'info',
};

const STATUS_TONE: Record<Threat['status'], 'destructive' | 'warning' | 'success'> = {
  active: 'destructive',
  mitigated: 'warning',
  resolved: 'success',
};

export function ThreatsScreen() {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listThreats()
      .then(setThreats)
      .catch((err) => setError(err?.message || 'Failed to load threat intelligence.'))
      .finally(() => setLoading(false));
  }, []);

  const activeCount = threats.filter((threat) => threat.status === 'active').length;

  if (loading) {
    return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  }
  if (error) {
    return <Centered><Text style={styles.errorText}>{error}</Text></Centered>;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.summary}>{activeCount} threat{activeCount === 1 ? '' : 's'} happening right now</Text>

      {threats.length === 0 ? (
        <Text style={styles.emptyText}>No threats detected.</Text>
      ) : (
        threats.map((threat) => (
          <Card
            key={threat.id}
            style={[styles.card, threat.status === 'active' && threat.severity === 'critical' && styles.criticalCard]}
          >
            <View style={styles.topRow}>
              <Text style={styles.type}>{threat.type.replace(/_/g, ' ')}</Text>
              <View style={styles.badges}>
                <Badge tone={SEVERITY_TONE[threat.severity]}>{threat.severity}</Badge>
                <Badge tone={STATUS_TONE[threat.status]}>{threat.status}</Badge>
              </View>
            </View>
            <Text style={styles.summaryText}>{threat.plainSummary ?? threat.description}</Text>
            {threat.plainSummary && <Text style={styles.techDetail}>{threat.description}</Text>}
            <View style={styles.footerRow}>
              <Text style={styles.timestamp}>{new Date(threat.timestamp).toLocaleString()}</Text>
              {threat.affectedUsers != null && <Text style={styles.affected}>{threat.affectedUsers} affected</Text>}
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  errorText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 12 },
  emptyText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 20 },
  summary: {
    fontFamily: fonts.mono,
    color: colors.mutedForeground,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  card: { marginBottom: 14 },
  criticalCard: { borderColor: colors.destructive },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  type: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 13, fontWeight: '700', textTransform: 'capitalize', flex: 1, marginRight: 8 },
  badges: { flexDirection: 'row', gap: 6 },
  summaryText: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  techDetail: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 10, lineHeight: 15, marginBottom: 8 },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  timestamp: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9 },
  affected: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9 },
});
