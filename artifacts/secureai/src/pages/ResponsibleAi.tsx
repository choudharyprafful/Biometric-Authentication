import React, { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiSystems,
  getGetAiSystemsQueryKey,
  useListMyAiChallenges,
  getListMyAiChallengesQueryKey,
  useSubmitAiChallenge,
  type AiSystemEntry,
  type AiSystemId,
  type AiChallenge,
} from '@workspace/api-client-react';
import { Card, Badge, Button, Input, Label } from '../components/ui';
import { Textarea } from '../components/ui/textarea';
import { useAuth } from '../contexts/AuthContext';
import { Bot, Loader2, MessageSquareWarning, UserCheck } from 'lucide-react';

// Team 2's Responsible AI framework (Weeks 7-8): transparency, explainability, accountability, and a way to
// challenge AI-assisted outcomes. Everything shown comes from the register in lib/aiSystems.ts.

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-4 py-2 border-t border-border first:border-t-0">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground pt-0.5">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

function SystemCard({ system }: { system: AiSystemEntry }) {
  return (
    <Card id={system.id} className="space-y-3 scroll-mt-24 min-w-0 [overflow-wrap:anywhere]" data-testid={`ai-system-${system.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-mono font-bold uppercase tracking-widest text-foreground">{system.name}</h3>
          <p className="text-xs text-muted-foreground">{system.kind}</p>
        </div>
        {system.enabled ? (
          <Badge variant="success" className="shrink-0">On</Badge>
        ) : (
          <Badge variant="warning" className="shrink-0" title={system.stateChangedAt ? `Since ${new Date(system.stateChangedAt).toLocaleString()}` : undefined}>
            Switched off
          </Badge>
        )}
      </div>
      <dl>
        <Row label="What it's for">{system.purpose}</Row>
        <Row label="What it decides">{system.decides}</Row>
        <Row label="Why AI">{system.whyAi}</Row>
        <Row label="Data it uses">{system.dataUsed}</Row>
        <Row label="Where it runs">{system.runsWhere}</Row>
        <Row label="Human oversight">{system.humanOversight}</Row>
        <Row label="Known limits">
          <ul className="list-disc pl-4 space-y-1">
            {system.knownLimits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Row>
        <Row label="If it gets it wrong">
          {system.howToChallenge}{' '}
          <a href={`/ai?challenge=${system.id}#challenge`} className="text-primary underline underline-offset-2">Challenge a {system.name.toLowerCase()} decision</a>
        </Row>
        <Row label="Accountable">{system.accountableOwner}. {system.oversightRole}.</Row>
        {!system.switchable && <Row label="Can it be switched off?">{system.switchNote}</Row>}
      </dl>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Risk register: {system.riskRefs.join(' · ')}</p>
    </Card>
  );
}

function outcomeBadge(c: AiChallenge) {
  if (c.status === 'open') return <Badge variant="outline">Under review</Badge>;
  return c.outcome === 'upheld' ? <Badge variant="success">Upheld</Badge> : <Badge variant="secondary">Not upheld</Badge>;
}

function ChallengeSection({ systems }: { systems: AiSystemEntry[] }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const initial = new URLSearchParams(window.location.search).get('challenge');
  const [systemId, setSystemId] = useState<AiSystemId>(
    systems.some((s) => s.id === initial) ? (initial as AiSystemId) : systems[0]!.id,
  );
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submit = useSubmitAiChallenge();
  const mine = useListMyAiChallenges({ query: { queryKey: getListMyAiChallengesQueryKey(), enabled: !!user } });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSent(false);
    try {
      await submit.mutateAsync({ data: { systemId, message, ...(reference.trim() ? { reference: reference.trim() } : {}) } });
      setMessage('');
      setReference('');
      setSent(true);
      await queryClient.invalidateQueries({ queryKey: getListMyAiChallengesQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error || 'Could not send your challenge. Try again in a moment.');
    }
  };

  return (
    <section id="challenge" className="space-y-4 scroll-mt-24">
      <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
        <MessageSquareWarning className="w-5 h-5 text-primary" /> Challenge a decision
      </h2>
      {!user ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Sign in to challenge a decision, so we can link it to your account and show you the outcome.{' '}
            <Link href="/"><span className="text-primary underline underline-offset-2 cursor-pointer">Sign in</span></Link>
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <Card>
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tell us which AI decision you think was wrong. A security analyst reviews every challenge and records the outcome, which you will see here.
              </p>
              <div className="space-y-2">
                <Label htmlFor="challenge-system">Which AI system</Label>
                <select
                  id="challenge-system"
                  value={systemId}
                  onChange={(e) => setSystemId(e.target.value as AiSystemId)}
                  className="flex h-10 w-full border border-border bg-input px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  data-testid="select-challenge-system"
                >
                  {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="challenge-reference">When it happened (optional)</Label>
                <Input id="challenge-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} placeholder="e.g. 25 Sep, 3:40 pm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="challenge-message">What happened, and why you think it was wrong</Label>
                <Textarea
                  id="challenge-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  minLength={10}
                  maxLength={1000}
                  rows={5}
                  required
                  data-testid="input-challenge-message"
                />
                <p className="font-mono text-[10px] text-muted-foreground text-right tabular-nums">{message.length} / 1000</p>
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              {sent && <p className="text-green-400 text-sm">Sent. A security analyst will review it; the outcome appears under Your challenges.</p>}
              <Button type="submit" isLoading={submit.isPending} disabled={message.trim().length < 10} data-testid="button-submit-challenge">
                Send challenge
              </Button>
            </form>
          </Card>
          <Card className="space-y-3 min-w-0 [overflow-wrap:anywhere]">
            <h3 className="font-mono font-bold uppercase tracking-widest text-foreground">Your challenges</h3>
            {mine.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !mine.data?.length ? (
              <p className="text-sm text-muted-foreground">You haven't challenged any decisions.</p>
            ) : (
              <ul className="space-y-3" data-testid="list-my-challenges">
                {mine.data.map((c) => (
                  <li key={c.id} className="border border-border p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-xs uppercase tracking-wider text-foreground">{c.systemName}</p>
                      <span className="shrink-0">{outcomeBadge(c)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.message}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/70">Sent {new Date(c.submittedAt).toLocaleString()}</p>
                    {c.resolutionNote && (
                      <p className="text-sm text-foreground border-l-2 border-primary/50 pl-2">
                        Reviewer: {c.resolutionNote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}

export default function ResponsibleAi() {
  const { data, isLoading, error } = useGetAiSystems({ query: { queryKey: getGetAiSystemsQueryKey(), staleTime: 60_000 } });

  // The AI labels elsewhere in the app link to /ai#<system>; scroll there once the cards exist.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (data && target) document.getElementById(target)?.scrollIntoView();
  }, [data]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">Could not load how SecureAI uses AI.</div>;
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary shrink-0" />
          How SecureAI uses AI
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          Every place an AI model makes or shapes a decision about you, and what you can do about it
        </p>
      </div>

      <Card className="space-y-3">
        <p className="text-sm text-foreground">
          SecureAI uses AI in {data.systems.length} places. None of them deletes, locks or charges anything on its own. Where one can refuse
          something (a face scan), there is always another way in: a passkey, and a person who can help.
        </p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>AI output is labelled where it appears in the app, and each label links here.</li>
          <li>You can challenge any AI decision below; a security analyst reviews it and you see the outcome.</li>
          <li>Administrators can switch the models that aren't needed for security off, and every switch is recorded with a reason.</li>
        </ul>
        <p className="text-sm text-foreground flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-primary shrink-0" /> Accountable for all of them: {data.accountableOwner}.
        </p>
        <p className="text-xs text-muted-foreground">
          How the models hold up against attacks: <Link href="/ai-security"><span className="text-primary underline underline-offset-2 cursor-pointer">AI Security</span></Link> (signed-in users).
        </p>
      </Card>

      <section className="space-y-4">
        <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">The AI systems</h2>
        <div className="grid gap-4">
          {data.systems.map((s) => <SystemCard key={s.id} system={s} />)}
        </div>
      </section>

      <ChallengeSection systems={data.systems} />
    </div>
  );
}
