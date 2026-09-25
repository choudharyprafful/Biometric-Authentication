import { Link } from 'wouter';
import { Bot } from 'lucide-react';

// Marks output produced or shaped by an AI system and links to its entry on /ai (Team 2: transparency —
// people should be able to tell when AI is involved and find out how it works).
export function AiLabel({ system, text = 'AI' }: { system: string; text?: string }) {
  return (
    <Link href={`/ai#${system}`}>
      <span
        className="inline-flex items-center gap-1 border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary cursor-pointer hover:bg-primary/20 shrink-0"
        title="How SecureAI uses AI"
        data-testid={`ai-label-${system}`}
      >
        <Bot className="w-3 h-3" aria-hidden="true" /> {text}
      </span>
    </Link>
  );
}
