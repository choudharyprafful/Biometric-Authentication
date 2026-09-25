import React from 'react';
import {
  useGetAiSecurityReport,
  getGetAiSecurityReportQueryKey,
  type AiValidationTest,
  type AiPocStarterKit,
  type AiPocMemorisation,
} from '@workspace/api-client-react';
import { Card, Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui';
import { BrainCircuit, Loader2, RefreshCw, FlaskConical, Terminal } from 'lucide-react';

// Output the models produce, shown as text: event names come back with underscores, PoC outputs can be empty.
function ModelOutput({ value }: { value: string | null }) {
  if (value === null || value === '') return <span className="text-muted-foreground italic">(nothing)</span>;
  return <span className="break-all">{value}</span>;
}

function LeakBadge({ leaked }: { leaked: boolean }) {
  return leaked ? <Badge variant="destructive">Leaked</Badge> : <Badge variant="success">Blocked</Badge>;
}

function LiveTestCard({ test }: { test: AiValidationTest }) {
  const held = test.verdict === 'held';
  return (
    // Event names are long unbroken tokens (PASSWORD_RESET_REQUESTED…), so text may wrap anywhere.
    <Card className="space-y-4 min-w-0 [overflow-wrap:anywhere]" data-testid={`ai-test-${test.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <h3 className="font-mono font-bold uppercase tracking-widest text-foreground">{test.title}</h3>
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary/80">{test.mirrors}</p>
        </div>
        <Badge variant={held ? 'success' : 'warning'} className="shrink-0">{held ? 'Held' : 'Residual'}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{test.attack}</p>

      <div className={`grid gap-3 ${test.baseline ? 'md:grid-cols-2' : ''}`}>
        {test.baseline && (
          <div className={`border p-3 space-y-1 ${test.baseline.compromised ? 'border-destructive/40 bg-destructive/5' : 'border-border'}`}>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Without the defence</p>
            <p className="text-sm text-foreground">{test.baseline.outcome}</p>
          </div>
        )}
        <div className={`border p-3 space-y-1 ${test.secureai.compromised ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-green-500/40 bg-green-500/5'}`}>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">SecureAI live model</p>
          <p className="text-sm text-foreground">{test.secureai.outcome}</p>
        </div>
      </div>

      {test.probes.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prompt (recent activity)</TableHead>
                <TableHead>Without the defence</TableHead>
                <TableHead>SecureAI live model</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {test.probes.map((p) => (
                <TableRow key={p.prompt}>
                  <TableCell className="font-mono text-xs">{p.prompt}</TableCell>
                  <TableCell className="font-mono text-xs"><ModelOutput value={p.baselineOutput} /></TableCell>
                  <TableCell className="font-mono text-xs"><ModelOutput value={p.secureaiOutput} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {test.note && <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">{test.note}</p>}
    </Card>
  );
}

function ConsoleOutput({ text }: { text: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer font-mono text-xs uppercase tracking-wider text-primary flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5" /> Console output, verbatim
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto bg-background border border-border p-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre">{text}</pre>
    </details>
  );
}

function ScriptHeader({ title, author, script, sha256 }: { title: string; author: string; script: string; sha256: string }) {
  return (
    <div className="space-y-1 min-w-0 flex-1">
      <h3 className="font-mono font-bold uppercase tracking-widest text-foreground">{title}</h3>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {author} · artifacts/ai-model/{script} · sha256 {sha256.slice(0, 12)}…
      </p>
    </div>
  );
}

function StarterKitCard({ kit }: { kit: AiPocStarterKit }) {
  return (
    <Card className="space-y-5 min-w-0 [overflow-wrap:anywhere]" data-testid="poc-starter-kit">
      <ScriptHeader title="AI model starter kit" author={kit.author} script={kit.script} sha256={kit.sha256} />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="border border-border p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Synthetic corpus</p>
          <p className="font-mono text-2xl text-foreground tabular-nums">{kit.corpus.records}</p>
          <p className="text-xs text-muted-foreground">records, canary planted {kit.corpus.canaryCopies}×</p>
        </div>
        <div className="border border-border p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Consent gate</p>
          <p className="font-mono text-2xl text-foreground tabular-nums">{kit.consentGate.allowed} / {kit.consentGate.blocked.length}</p>
          <p className="text-xs text-muted-foreground">allowed / refused (cap {kit.consentGate.perUserCap} per user)</p>
        </div>
        <div className="border border-border p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Deduplication</p>
          <p className="font-mono text-2xl text-foreground tabular-nums">{kit.hardened.duplicatesRemoved}</p>
          <p className="text-xs text-muted-foreground">duplicate sentences removed</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Refused record</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kit.consentGate.blocked.map((b, i) => (
              <TableRow key={`${b.userId}-${i}`}>
                <TableCell className="font-mono text-xs">{b.userId}</TableCell>
                <TableCell className="font-mono text-xs">{b.sourceId}</TableCell>
                <TableCell className="text-xs">{b.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="border border-destructive/40 bg-destructive/5 p-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Vulnerable model · prompt "{kit.vulnerable.prompt}"</p>
          <p className="font-mono text-xs text-foreground"><ModelOutput value={kit.vulnerable.output} /></p>
          <LeakBadge leaked={kit.vulnerable.canaryLeaked} />
        </div>
        <div className="border border-green-500/40 bg-green-500/5 p-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Hardened model · prompt "{kit.hardened.prompt}"</p>
          <p className="font-mono text-xs text-foreground"><ModelOutput value={kit.hardened.output} /></p>
          <LeakBadge leaked={kit.hardened.canaryLeaked} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Extraction prompt</TableHead>
              <TableHead>Vulnerable</TableHead>
              <TableHead>Hardened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kit.extractionTests.map((t) => (
              <TableRow key={t.prompt}>
                <TableCell className="font-mono text-xs">"{t.prompt}"</TableCell>
                <TableCell><LeakBadge leaked={t.vulnerableLeaked} /></TableCell>
                <TableCell><LeakBadge leaked={t.hardenedLeaked} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-3 md:grid-cols-2 text-sm">
        <p className="text-muted-foreground">
          <span className="font-mono text-[10px] uppercase tracking-wider block">Still learns genuine patterns</span>
          "{kit.benign.prompt}" → <span className="font-mono text-foreground">{kit.benign.output || '(nothing)'}</span>
        </p>
        <p className="text-muted-foreground">
          <span className="font-mono text-[10px] uppercase tracking-wider block">Deletion, then retrain</span>
          {kit.deletion.userId} removed: {kit.deletion.recordsBefore} → {kit.deletion.recordsAfter} records
        </p>
      </div>

      <ConsoleOutput text={kit.console} />
    </Card>
  );
}

function MemorisationCard({ mem }: { mem: AiPocMemorisation }) {
  return (
    <Card className="space-y-5 min-w-0 [overflow-wrap:anywhere]" data-testid="poc-memorisation">
      <div className="flex items-start justify-between gap-3">
        <ScriptHeader title="Memorisation and leakage defence" author={mem.author} script={mem.script} sha256={mem.sha256} />
        <Badge variant={mem.verdict === 'PASS' ? 'success' : 'warning'} className="shrink-0">{mem.verdict}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="border border-destructive/40 bg-destructive/5 p-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Before · prompt "{mem.vulnerable.prompt}"</p>
          <p className="font-mono text-xs text-foreground"><ModelOutput value={mem.vulnerable.output} /></p>
          <LeakBadge leaked={mem.vulnerable.canaryLeaked} />
        </div>
        <div className="border border-border p-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Defence</p>
          <p className="text-sm text-foreground">Deduplicated {mem.records} records: {mem.duplicatesRemoved} duplicates removed, then retrained</p>
        </div>
        <div className="border border-green-500/40 bg-green-500/5 p-3 space-y-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">After · prompt "{mem.hardened.prompt}"</p>
          <p className="font-mono text-xs text-foreground"><ModelOutput value={mem.hardened.output} /></p>
          <LeakBadge leaked={mem.hardened.canaryLeaked} />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        <span className="font-mono text-[10px] uppercase tracking-wider block">Benign pattern check</span>
        "{mem.benign.prompt}" → <span className="font-mono text-foreground">{mem.benign.output || '(nothing)'}</span>{' '}
        {mem.benign.works ? <Badge variant="success">Still works</Badge> : <Badge variant="destructive">Broken</Badge>}
      </p>

      <ConsoleOutput text={mem.console} />
    </Card>
  );
}

export default function AiSecurity() {
  const { data, isLoading, isFetching, error, refetch } = useGetAiSecurityReport({
    query: { queryKey: getGetAiSecurityReportQueryKey(), refetchOnWindowFocus: false, staleTime: 60_000 },
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-destructive/10 text-destructive border border-destructive/30 font-mono">
        Could not run the AI security checks{error?.status === 429 ? ': too many runs in the last few minutes, try again shortly.' : '.'}
      </div>
    );
  }

  const { live, poc } = data;
  const held = live.tests.filter((t) => t.verdict === 'held').length;
  const residual = live.tests.length - held;

  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <BrainCircuit className="w-8 h-8 text-primary" />
          AI Model Security
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          The team's attack proof-of-concepts, and the same attacks run against the live model
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Live model</p>
          <p className="font-mono text-3xl text-foreground tabular-nums mt-1">{held} / {live.tests.length}</p>
          <p className="text-xs text-muted-foreground">attacks held{residual > 0 ? `, ${residual} known residual` : ''}</p>
        </Card>
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{poc.starterKit.author}'s starter kit</p>
          <p className="font-mono text-3xl text-foreground tabular-nums mt-1">
            {poc.starterKit.extractionTests.filter((t) => !t.hardenedLeaked).length} / {poc.starterKit.extractionTests.length}
          </p>
          <p className="text-xs text-muted-foreground">extraction prompts blocked after hardening</p>
        </Card>
        <Card>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{poc.memorisation.author}'s leakage defence</p>
          <p className="font-mono text-3xl text-foreground mt-1">{poc.memorisation.verdict}</p>
          <p className="text-xs text-muted-foreground">canary blocked, benign learning intact</p>
        </Card>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-primary" /> Same attacks, live model
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
              Each attack runs against the model behind the Suggested Next Action card (same corpus rules, training and
              prediction code), fed synthetic activity instead of real accounts. Thresholds: {live.thresholds.minDistinctUsers} distinct
              accounts to surface a pattern, {live.thresholds.maxEventsPerUser} events and {live.thresholds.maxDistinctTransitionsPerUser} distinct
              transitions per account.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Ran {new Date(live.ranAt).toLocaleTimeString()}
            </span>
            <Button variant="outline" size="sm" onClick={() => refetch()} isLoading={isFetching} data-testid="button-rerun-ai-checks">
              <RefreshCw className="w-4 h-4 mr-2" /> Run again
            </Button>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 items-start">
          {live.tests.map((t) => <LiveTestCard key={t.id} test={t} />)}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-primary" /> Team proof-of-concepts
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">
            The Python scripts in artifacts/ai-model, run unmodified through their own functions by {poc.generator}. Synthetic data
            only. The recorded results are tied to each script's hash, and CI fails if a script changes without them being regenerated.
          </p>
        </div>
        <StarterKitCard kit={poc.starterKit} />
        <MemorisationCard mem={poc.memorisation} />
      </section>
    </div>
  );
}
