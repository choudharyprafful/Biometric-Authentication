import { ExternalLink } from 'lucide-react';

type OpenInBrowserTabProps = {
  className?: string;
};

/**
 * WebAuthn needs a top-level browsing context. Replit previews are embedded
 * iframes, so browsers correctly refuse biometric credential ceremonies there.
 */
export function OpenInBrowserTab({ className = '' }: OpenInBrowserTabProps) {
  return (
    <a
      href={window.location.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 font-mono text-xs text-primary underline underline-offset-4 hover:text-primary/80 ${className}`}
    >
      Open SecureAI in a browser tab
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}