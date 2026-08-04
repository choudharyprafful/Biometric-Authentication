import React, { useState } from 'react';
import { useListPayments, useCreatePayment, getListPaymentsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Badge, Button, Card, Input, Label } from '../components/ui';
import { Loader2, DollarSign, Plus } from 'lucide-react';
import { format } from 'date-fns';

export default function Payments() {
  const queryClient = useQueryClient();
  const { data: payments, isLoading } = useListPayments();
  const createMutation = useCreatePayment();
  
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState('100.00');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('Security Audit Service');
  const [error, setError] = useState('');

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      await createMutation.mutateAsync({ 
        data: { 
          amount: parseFloat(amount), 
          currency, 
          description 
        } 
      });
      setShowModal(false);
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Payment simulation failed.');
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
          <Card className="w-full max-w-md border-primary shadow-[0_0_30px_rgba(0,220,255,0.1)] relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-primary animate-pulse" />
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

              {error && <p className="text-destructive font-mono text-xs uppercase">{error}</p>}

              <div className="flex justify-end gap-3 mt-8">
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={createMutation.isPending}>
                  Execute
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
