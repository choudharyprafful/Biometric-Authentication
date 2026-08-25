import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { listPayments, listPlans, createPayment, subscribe, type Payment, type Plan } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Badge, Input, Label, Centered } from '../components/ui';
import { colors, fonts } from '../theme';

const CURRENCIES = ['USD', 'EUR', 'GBP'];

const STATUS_TONE: Record<Payment['status'], 'success' | 'destructive' | 'warning' | 'outline'> = {
  completed: 'success',
  failed: 'destructive',
  pending: 'warning',
  refunded: 'outline',
};

export function PaymentsScreen() {
  const { user, refetchUser } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subscribingId, setSubscribingId] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([listPayments(), listPlans()])
      .then(([p, pl]) => { setPayments(p); setPlans(pl); })
      .catch((err) => setError(err?.message || 'Failed to load payments.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubscribe = async (plan: Plan) => {
    setSubscribingId(plan.id);
    try {
      await subscribe(plan.id);
      await refetchUser();
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Subscription failed.');
    } finally {
      setSubscribingId(null);
    }
  };

  const handleCreatePayment = async () => {
    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0 || !description.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await createPayment(numericAmount, currency, description.trim());
      setAmount('');
      setDescription('');
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Transaction failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>Subscription Plans</Text>
      {plans.map((plan) => {
        const isCurrent = user?.subscriptionPlan === plan.id;
        return (
          <Card key={plan.id} style={styles.planCard} topAccent>
            <View style={styles.planHeader}>
              <Text style={styles.planName}>{plan.name}</Text>
              <Text style={styles.planPrice}>${plan.amount}/{plan.interval}</Text>
            </View>
            {plan.features.map((f) => (
              <Text key={f} style={styles.feature}>• {f}</Text>
            ))}
            <Button
              size="sm"
              variant={isCurrent ? 'ghost' : 'default'}
              disabled={isCurrent}
              isLoading={subscribingId === plan.id}
              onPress={() => handleSubscribe(plan)}
              style={{ marginTop: 10 }}
            >
              {isCurrent ? 'Current Plan' : 'Subscribe'}
            </Button>
          </Card>
        );
      })}

      <Text style={styles.sectionTitle}>Simulate Transaction</Text>
      <Card style={styles.formCard}>
        <Label>Amount</Label>
        <Input value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
        <Label style={{ marginTop: 12 }}>Currency</Label>
        <View style={styles.currencyRow}>
          {CURRENCIES.map((c) => (
            <Button key={c} size="sm" variant={currency === c ? 'default' : 'outline'} onPress={() => setCurrency(c)} style={{ flexGrow: 1 }}>
              {c}
            </Button>
          ))}
        </View>
        <Label style={{ marginTop: 12 }}>Description</Label>
        <Input value={description} onChangeText={setDescription} placeholder="e.g. API credits" />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Button onPress={handleCreatePayment} isLoading={submitting} style={{ marginTop: 14 }}>
          Execute
        </Button>
      </Card>

      <Text style={styles.sectionTitle}>Ledger</Text>
      {payments.length === 0 ? (
        <Text style={styles.emptyText}>No transactions yet.</Text>
      ) : (
        payments.map((p) => (
          <Card key={p.id} style={styles.paymentCard}>
            <View style={styles.paymentTop}>
              <Text style={styles.paymentDesc}>{p.description}</Text>
              <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
            </View>
            <View style={styles.paymentBottom}>
              <Text style={styles.paymentMeta}>{p.userEmail ?? 'deleted account'} · {new Date(p.createdAt).toLocaleDateString()}</Text>
              <Text style={styles.paymentAmount}>{p.currency} {p.amount.toFixed(2)}</Text>
            </View>
            <Text style={styles.token}>{p.providerToken}</Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  errorText: { fontFamily: fonts.mono, color: colors.destructive, fontSize: 11, marginTop: 10 },
  emptyText: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 8 },
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
  planCard: { marginBottom: 14 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  planName: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 15, fontWeight: '700', textTransform: 'uppercase' },
  planPrice: { fontFamily: fonts.mono, color: colors.primary, fontSize: 15, fontWeight: '700' },
  feature: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 11, marginBottom: 3 },
  formCard: { marginBottom: 20 },
  currencyRow: { flexDirection: 'row', gap: 6 },
  paymentCard: { marginBottom: 10 },
  paymentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  paymentDesc: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 },
  paymentBottom: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  paymentMeta: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 10 },
  paymentAmount: { fontFamily: fonts.mono, color: colors.foreground, fontSize: 12, fontWeight: '700' },
  token: { fontFamily: fonts.mono, color: colors.mutedForeground, fontSize: 9, backgroundColor: colors.background, padding: 6 },
});
