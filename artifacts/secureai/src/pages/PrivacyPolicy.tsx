import React, { useEffect } from 'react';
import { Link } from 'wouter';
import { FileText } from 'lucide-react';
import { Card } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { PRIVACY_POLICY, type PolicyBlock } from '../lib/privacyPolicy';
import { PrivacyPolicyAcknowledge } from '../components/PrivacyPolicyNotice';
import { DownloadMyData } from '../components/DownloadMyData';

// The policy text lives in lib/privacyPolicy.ts. Public: readable before signing in, like /ai.

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Renders "[text](/path)" as in-app links; everything else as plain text. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} href={m[2]}>
        <span className="text-primary underline underline-offset-2 cursor-pointer">{m[1]}</span>
      </Link>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Block({ block }: { block: PolicyBlock }) {
  if (block.kind === 'p') return <p className="text-sm text-foreground leading-relaxed"><Inline text={block.text} /></p>;
  if (block.kind === 'list') {
    return (
      <ul className="text-sm text-foreground list-disc pl-5 space-y-1.5 leading-relaxed">
        {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full text-sm border-collapse min-w-[40rem]">
        <thead>
          <tr className="bg-muted/30">
            {block.head.map((h) => (
              <th key={h} className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2 border-b border-border align-bottom">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row[0]} className="border-b border-border last:border-b-0 align-top">
              {row.map((cell, i) => (
                <td key={i} className={`px-3 py-2 ${i === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}><Inline text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPolicy() {
  const { user } = useAuth();

  // Links elsewhere point at /privacy#<section>; scroll there after the page renders.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView();
  }, []);

  return (
    <div className="space-y-8 max-w-4xl" data-testid="privacy-policy">
      <div className="border-b border-border pb-6">
        <h1 className="text-3xl font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary shrink-0" />
          Privacy Policy
        </h1>
        <p className="text-sm font-mono text-muted-foreground uppercase tracking-wider mt-2">
          Version {PRIVACY_POLICY.version} · effective {PRIVACY_POLICY.effectiveDate}
        </p>
      </div>

      <div className="border border-primary/40 bg-primary/10 p-4 text-sm text-foreground" data-testid="privacy-demo-notice">
        {PRIVACY_POLICY.demoNotice}
      </div>
      <p className="text-xs text-muted-foreground">{PRIVACY_POLICY.status}</p>

      <Card className="space-y-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Contents</h2>
        <ol className="text-sm grid sm:grid-cols-2 gap-x-6 gap-y-1">
          {PRIVACY_POLICY.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-primary hover:underline underline-offset-2">{s.title}</a>
            </li>
          ))}
        </ol>
      </Card>

      {PRIVACY_POLICY.sections.map((section) => (
        <section key={section.id} id={section.id} className="space-y-3 scroll-mt-24">
          <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">{section.title}</h2>
          {section.blocks.map((block, i) => <Block key={i} block={block} />)}
          {section.id === 'your-rights' && user && <DownloadMyData />}
          {section.id === 'changes' && (
            <p className="text-sm text-foreground">
              Contact: <span className="font-mono">{PRIVACY_POLICY.contact}</span> ({<Inline text={PRIVACY_POLICY.contactNote} />}).
            </p>
          )}
        </section>
      ))}

      {user && <PrivacyPolicyAcknowledge />}
    </div>
  );
}
