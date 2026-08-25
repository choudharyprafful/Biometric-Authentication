import React, { useState } from 'react';
import { useListPayments, useCreatePayment, useListPlans, useSubscribe, getListPaymentsQueryKey, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button, Card, Input, Label } from '../components/ui';
import { Loader2, DollarSign, Plus, Check, Sparkles, Crown, Users, CreditCard, Lock, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { type CardDetails, EMPTY_CARD, formatCardNumber, formatExpiry, luhnCheck, isExpiryValid, isCardFormValid, getCardBrand, getLast4 } from '../lib/cardValidation';

interface ChargeReceipt {
  amount: number;
  currency: string;
  brand: string;
  last4: string;
}

/** Post-payment confirmation — this is what "deduct from card" means in a
 *  demo with no real processor: a clear receipt naming the specific card
 *  (brand + last 4, the one part of a card number that's routinely shown
 *  on real receipts precisely because it isn't sensitive by itself), not
 *  an actual balance being debited anywhere. There is still no server-side
 *  concept of "this card's balance" — the backend never received the card
 *  in the first place, so it has nothing to deduct from; this is a purely
 *  client-side confirmation built from the same card state that was about
 *  to be discarded anyway. */
function ChargeConfirmation({ receipt, onDone }: { receipt: ChargeReceipt; onDone: () => void }) {
  return (
    <div className="text-center py-6 space-y-4">
      <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
      <div>
        <p className="font-mono text-lg text-foreground">
          {receipt.currency} {receipt.amount.toFixed(2)} deducted
        </p>
        <p className="font-mono text-sm text-muted-foreground mt-1">
          from {receipt.brand} card ending in {receipt.last4}
        </p>
      </div>
      <Button onClick={onDone} data-testid="button-receipt-done">Done</Button>
    </div>
  );
}

const PLAN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  plus: Sparkles,
  pro: Crown,
  team: Users,
};

// ---------------------------------------------------------------------------
// Card entry — UI-only, PCI-scope-reducing by design (brief: "don't store
// card numbers... route through a provider so raw card data never touches
// your servers"). These values live in React state for exactly as long as
// this form is open, are validated client-side for realism (lib/cardValidation.ts),
// and are NEVER included in any request body below (see handleSimulate / the
// subscribe confirm handler) — the actual API calls only ever send amount/
// currency/description or planId, identical to before this form existed.
// In a real integration this is where Stripe Elements/Checkout would sit:
// the card form talks directly to the payment provider's own client SDK,
// and only the provider-issued token reaches your backend. There's no real
// provider here, so the equivalent honesty is that these fields are
// validated then discarded, not silently sent anywhere.
// ---------------------------------------------------------------------------

function CardEntryFields({ card, onChange }: { card: CardDetails; onChange: (card: CardDetails) => void }) {
  const numberValid = card.number.length === 0 || luhnCheck(card.number);
  const expiryValid = card.expiry.length === 0 || card.expiry.length < 5 || isExpiryValid(card.expiry);

  return (
    <div className="space-y-3 border border-border bg-input/30 p-4">
      <div className="flex items-center gap-2 text-primary">
        <CreditCard className="w-4 h-4" />
        <span className="font-mono text-xs uppercase tracking-widest">Card Details</span>
      </div>

      <div className="space-y-2">
        <Label>Card Number</Label>
        <Input
          inputMode="numeric"
          placeholder="4242 4242 4242 4242"
          value={card.number}
          onChange={(e) => onChange({ ...card, number: formatCardNumber(e.target.value) })}
          data-testid="input-card-number"
          required
        />
        {!numberValid && <p className="text-destructive font-mono text-[10px] uppercase">Invalid card number</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Expiry (MM/YY)</Label>
          <Input
            inputMode="numeric"
            placeholder="12/28"
            value={card.expiry}
            onChange={(e) => onChange({ ...card, expiry: formatExpiry(e.target.value) })}
            data-testid="input-card-expiry"
            required
          />
          {!expiryValid && <p className="text-destructive font-mono text-[10px] uppercase">Invalid or expired</p>}
        </div>
        <div className="space-y-2">
          <Label>CVV</Label>
          <Input
            inputMode="numeric"
            placeholder="123"
            value={card.cvv}
            onChange={(e) => onChange({ ...card, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            data-testid="input-card-cvv"
            required
          />
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-muted-foreground font-mono text-[10px] leading-relaxed">
        <Lock className="w-3 h-3 shrink-0 mt-0.5" />
        Stays in your browser only — never sent to our servers. A real integration would tokenize
        this directly with the payment provider; our API only ever receives the resulting reference token.
      </p>
    </div>
  );
}

function SubscriptionPlans() {
  const queryClient = useQueryClient();
  const { user, refetchUser } = useAuth();
  const { data: plans, isLoading } = useListPlans();
  const subscribeMutation = useSubscribe();
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ChargeReceipt | null>(null);

  const pendingPlan = plans?.find((p) => p.id === pendingPlanId) ?? null;

  const handleConfirmSubscribe = async () => {
    if (!pendingPlanId || !pendingPlan || !isCardFormValid(card)) return;
    setError('');
    try {
      // Only planId is ever sent — the card fields above never leave this
      // component's state, exactly as documented at the top of this file.
      await subscribeMutation.mutateAsync({ data: { planId: pendingPlanId } });
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      await refetchUser();
      setReceipt({ amount: pendingPlan.amount, currency: pendingPlan.currency, brand: getCardBrand(card.number), last4: getLast4(card.number) });
    } catch (err: any) {
      setError(err?.data?.error || 'Subscription failed.');
    }
  };

  const closeSubscribeFlow = () => {
    setPendingPlanId(null);
    setCard(EMPTY_CARD);
    setReceipt(null);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mb-8">
      <div>
        <h2 className="text-xl font-mono font-bold uppercase tracking-widest text-foreground">Subscription Tier</h2>
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mt-1">
          Fixed, server-priced plans — the client never sends an amount
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans?.map((plan) => {
          const Icon = PLAN_ICONS[plan.id] ?? Sparkles;
          const isCurrent = user?.subscriptionPlan === plan.id;
          return (
            <Card key={plan.id} className={isCurrent ? 'border-t-4 border-t-primary' : ''}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-5 h-5 text-primary" />
                <h3 className="font-mono font-bold uppercase tracking-widest text-foreground">{plan.name}</h3>
              </div>
              <p className="font-mono text-2xl text-foreground mb-4">
                ${plan.amount}
                <span className="text-xs text-muted-foreground">/{plan.interval}</span>
              </p>
              <ul className="space-y-2 mb-6">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-xs font-mono text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                variant={isCurrent ? 'secondary' : 'default'}
                disabled={isCurrent}
                onClick={() => { setPendingPlanId(plan.id); setCard(EMPTY_CARD); setError(''); }}
                data-testid={`button-subscribe-${plan.id}`}
              >
                {isCurrent ? 'Current Plan' : `Subscribe`}
              </Button>
            </Card>
          );
        })}
      </div>

      {pendingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md border-primary shadow-[0_0_30px_rgba(0,220,255,0.1)] relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-pulse" />

            {receipt ? (
              <ChargeConfirmation receipt={receipt} onDone={closeSubscribeFlow} />
            ) : (
              <>
                <h2 className="text-xl font-mono uppercase tracking-widest text-foreground mb-1">Confirm Subscription</h2>
                <p className="font-mono text-sm text-muted-foreground mb-6">
                  {pendingPlan.name} — ${pendingPlan.amount}/{pendingPlan.interval}
                </p>

                <div className="space-y-4">
                  <CardEntryFields card={card} onChange={setCard} />

                  {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="ghost" onClick={() => setPendingPlanId(null)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleConfirmSubscribe}
                      disabled={!isCardFormValid(card)}
                      isLoading={subscribeMutation.isPending}
                      data-testid="button-confirm-subscribe"
                    >
                      Confirm &amp; Subscribe
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default function Payments() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useListPayments();
  const createMutation = useCreatePayment();

  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState('100.00');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('Security Audit Service');
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ChargeReceipt | null>(null);

  const closeSimulateFlow = () => {
    setShowModal(false);
    setCard(EMPTY_CARD);
    setReceipt(null);
  };

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCardFormValid(card)) return;
    setError('');

    try {
      // Card fields above are validated for realism only -- amount/currency/
      // description is the entire request body, exactly as before this
      // form existed. See the CardEntryFields module comment.
      await createMutation.mutateAsync({
        data: {
          amount: parseFloat(amount),
          currency,
          description
        }
      });
      setReceipt({ amount: parseFloat(amount), currency, brand: getCardBrand(card.number), last4: getLast4(card.number) });
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error || 'Payment simulation failed.');
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'completed': return 'success';
      case 'failed': return 'destructive';
      case 'pending': return 'warning';
      default: return 'outline';
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col relative">
      <div className="flex items-end justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-primary" />
            Financial Ledger
          </h1>
          <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">Transaction history and audit records</p>
        </div>

        <Button onClick={() => setShowModal(true)}>
          <Plus className="w-4 h-4 mr-2" /> Simulate Transaction
        </Button>
      </div>

      <SubscriptionPlans />

      <div className="flex-1 overflow-hidden flex flex-col border border-border bg-card">
        {isLoading ? (
          <div className="flex-1 flex justify-center items-center">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm border-b border-border">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Provider Token</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments?.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(payment.createdAt), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-foreground">
                      {payment.description}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {payment.userEmail}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground whitespace-nowrap">
                      {payment.currency} {payment.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusColor(payment.status) as any}>
                        {payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <span className="font-mono px-2 py-1 bg-input border border-border rounded-sm">
                        {payment.providerToken}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {(!payments || payments.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center font-mono text-muted-foreground uppercase tracking-widest">
                      Ledger is empty.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md border-primary shadow-[0_0_30px_rgba(0,220,255,0.1)] relative max-h-[90vh] overflow-y-auto">
            <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-pulse" />

            {receipt ? (
              <ChargeConfirmation receipt={receipt} onDone={closeSimulateFlow} />
            ) : (
              <>
                <h2 className="text-xl font-mono uppercase tracking-widest text-foreground mb-6">Simulate Transaction</h2>

                <form onSubmit={handleSimulate} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Currency</Label>
                      <select
                        value={currency}
                        onChange={e => setCurrency(e.target.value)}
                        className="flex h-10 w-full border border-border bg-input px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary font-mono uppercase"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Input
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      required
                    />
                  </div>

                  <CardEntryFields card={card} onChange={setCard} />

                  {error && <p className="text-destructive font-mono text-xs uppercase">{error}</p>}

                  <div className="flex justify-end gap-3 mt-8">
                    <Button type="button" variant="ghost" onClick={closeSimulateFlow}>
                      Cancel
                    </Button>
                    <Button type="submit" isLoading={createMutation.isPending} disabled={!isCardFormValid(card)}>
                      Execute
                    </Button>
                  </div>
                </form>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
