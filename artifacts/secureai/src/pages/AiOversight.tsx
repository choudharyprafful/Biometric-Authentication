import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiOversight,
  getGetAiOversightQueryKey,
  useListAiChallenges,
  getListAiChallengesQueryKey,
  getGetAiSystemsQueryKey,
  useSetAiSystemState,
  useResolveAiChallenge,
  type AiSystemStaffState,
  type AiChallenge,
  type AiOutcomeWindow,
} from '@workspace/api-client-react';
import { Card, Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import { Eye, Loader2, Power, Gauge, Inbox } from 'lucide-react';

// Human oversight for the AI register (Team 2: guardrail 5, monitoring, challenge and remediation):
// what the models are doing in practice, switches to stop them, and the review queue for challenges.

const pct = (part: number, whole: number) => (whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)}%`);

const METRICS: Array<{ label: string; value: (w: AiOutcomeWindow) => string; hint: string }> = [
  { label: 'Face scans', value: (w) => String(w.faceScans), hint: 'Sign-in face scans compared by the model' },
  { label: 'Face scans refused', value: (w) => `${w.faceScanFailures} (${pct(w.faceScanFailures, w.faceScans)})`, hint: 'A rising share can mean the model is failing some people: check challenges' },
  { label: 'Password sign-ins', value: (w) => String(w.passwordSignIns), hint: 'Each one is scored by the sign-in risk check' },
  { label: 'Sign-ins flagged', value: (w) => `${w.signInsFlagged} (${pct(w.signInsFlagged, w.passwordSignIns)})`, hint: 'Medium or high risk; high risk also warns the person' },
  { label: 'Suggestions requested', value: (w) => String(w.suggestionQueries), hint: 'Behaviour-model queries, each audited' },
  { label: 'Suggestions shown', value: (w) => `${w.suggestionsShown} (${pct(w.suggestionsShown, w.suggestionQueries)})`, hint: 'The rest cleared no 3-account threshold' },
  { label: 'Topic profiles built', value: (w) => String(w.profileQueries), hint: 'Personalisation requests' },
  { label: 'Security alerts sent', value: (w) => String(w.securityAlerts), hint: 'Anomaly alerts pushed to staff' },
  { label: 'Challenges filed', value: (w) => String(w.challengesFiled), hint: 'People disputing an AI decision' },
];

function SwitchRow({ system, canSwitch }: { system: AiSystemStaffState; canSwitch: boolean }) {
  const queryClient = useQueryClient();
  const setState = useSetAiSystemState();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const next = !system.enabled;

  const apply = async () => {
    setError('');
    try {
      await setState.mutateAsync({ id: system.id, data: { enabled: next, reason } });
      setOpen(false);
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAiOversightQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAiSystemsQueryKey() }),
      ]);
    } catch (err: any) {
      setError(err?.data?.error || 'Could not change the switch.');
    }
  };

  return (
    <div className="border border-border p-3 space-y-2 min-w-0 [overflow-wrap:anywhere]" data-testid={`switch-${system.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm uppercase tracking-wider text-foreground">{system.name}</p>
          {system.changedAt && (
            <p className="text-xs text-muted-foreground">
              {system.enabled ? 'Switched on' : 'Switched off'} {new Date(system.changedAt).toLocaleString()} by {system.changedBy}: "{system.reason}"
            </p>
          )}
        </div>
        <Badge variant={system.enabled ? 'success' : 'warning'} className="shrink-0">{system.enabled ? 'On' : 'Off'}</Badge>
      </div>
      {!system.switchable ? (
        <p className="text-xs text-muted-foreground">{system.switchNote}</p>
      ) : !canSwitch ? (
        <p className="text-xs text-muted-foreground">Administrators can switch this off. {system.switchNote}</p>
      ) : !open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={`button-toggle-${system.id}`}>
          <Power className="w-4 h-4 mr-2" /> {next ? 'Switch on' : 'Switch off'}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{next ? 'Switching on resumes the model.' : system.switchNote}</p>
          <Label htmlFor={`reason-${system.id}`}>Reason (recorded in the audit log)</Label>
          <Input id={`reason-${system.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="At least 10 characters" data-testid={`input-reason-${system.id}`} />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant={next ? 'default' : 'destructive'} onClick={apply} isLoading={setState.isPending} disabled={reason.trim().length < 10} data-testid={`button-confirm-${system.id}`}>
              {next ? 'Switch on' : 'Switch off'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setError(''); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChallengeItem({ challenge }: { challenge: AiChallenge }) {
  const queryClient = useQueryClient();
  const resolve = useResolveAiChallenge();
  const [outcome, setOutcome] = useState<'upheld' | 'not-upheld'>('upheld');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      await resolve.mutateAsync({ id: challenge.id, data: { outcome, note } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAiChallengesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAiOversightQueryKey() }),
      ]);
    } catch (err: any) {
      setError(err?.data?.error || 'Could not record the outcome.');
    }
  };

  return (
    <li className="border border-border p-3 space-y-2 min-w-0 [overflow-wrap:anywhere]" data-testid={`challenge-${challenge.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-wider text-foreground">{challenge.systemName}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            #{challenge.id} · {challenge.submittedBy} · {new Date(challenge.submittedAt).toLocaleString()}{challenge.reference ? ` · re: ${challenge.reference}` : ''}
          </p>
        </div>
        {challenge.status === 'open'
          ? <Badge variant="outline" className="shrink-0">Open</Badge>
          : <Badge variant={challenge.outcome === 'upheld' ? 'success' : 'secondary'} className="shrink-0">{challenge.outcome === 'upheld' ? 'Upheld' : 'Not upheld'}</Badge>}
      </div>
      <p className="text-sm text-foreground">{challenge.message}</p>
      {challenge.status === 'resolved' ? (
        <p className="text-sm text-muted-foreground border-l-2 border-primary/50 pl-2">
          {challenge.resolutionNote} <span className="font-mono text-[10px]">({challenge.resolvedBy}, {new Date(challenge.resolvedAt!).toLocaleString()})</span>
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {(['upheld', 'not-upheld'] as const).map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" name={`outcome-${challenge.id}`} checked={outcome === o} onChange={() => setOutcome(o)} />
                {o === 'upheld' ? 'Upheld (the AI got it wrong)' : 'Not upheld'}
              </label>
            ))}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="What you found and did; the person sees this" aria-label="Resolution note" data-testid={`input-resolution-${challenge.id}`} />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <Button size="sm" onClick={submit} isLoading={resolve.isPending} disabled={note.trim().length < 5} data-testid={`button-resolve-${challenge.id}`}>
            Record outcome
          </Button>
        </div>
      )}
    </li>
  );
}

export default function AiOversight() {
  const { user } = useAuth();
  const isStaff = user?.role === 'security_analyst' || user?.role === 'admin';
  const oversight = useGetAiOversight({ query: { queryKey: getGetAiOversightQueryKey(), enabled: isStaff } });
  const challenges = useListAiChallenges({ query: { queryKey: getListAiChallengesQueryKey(), enabled: isStaff } });

  if (!isStaff) {
    return <div className="p-6 border border-border font-mono text-sm text-muted-foreground">AI oversight is for security analysts and administrators.</div>;
  }
  if (oversight.isLoading || challenges.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (oversight.error || !oversight.data || !challenges.data) {
    return <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">Could not load AI oversight.</div>;
  }

  const { systems, outcomes, openChallenges } = oversight.data;
  const ordered = [...challenges.data].sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <Eye className="w-8 h-8 text-primary shrink-0" />
          AI Oversight
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          What the models are doing, switches to stop them, and the challenges people have raised
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2"><Gauge className="w-5 h-5 text-primary" /> Outcomes</h2>
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Measure</TableHead>
                {outcomes.map((w) => <TableHead key={w.days} className="text-right">Last {w.days} days</TableHead>)}
                <TableHead>What to watch for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICS.map((m) => (
                <TableRow key={m.label}>
                  <TableCell className="font-mono text-xs">{m.label}</TableCell>
                  {outcomes.map((w) => <TableCell key={w.days} className="font-mono text-xs text-right tabular-nums">{m.value(w)}</TableCell>)}
                  <TableCell className="text-xs text-muted-foreground">{m.hint}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2"><Power className="w-5 h-5 text-primary" /> Switches</h2>
        <div className="grid gap-3 md:grid-cols-2 items-start">
          {systems.map((s) => <SwitchRow key={s.id} system={s} canSwitch={user?.role === 'admin'} />)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary" /> Challenges <Badge variant={openChallenges > 0 ? 'warning' : 'outline'}>{openChallenges} open</Badge>
        </h2>
        {ordered.length === 0 ? (
          <Card><p className="text-sm text-muted-foreground">Nobody has challenged an AI decision yet.</p></Card>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2 items-start">
            {ordered.map((c) => <ChallengeItem key={c.id} challenge={c} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
