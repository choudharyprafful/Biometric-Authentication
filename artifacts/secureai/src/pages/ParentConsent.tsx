import React, { useState } from "react";
import { Link, useSearch, useLocation } from "wouter";
import { useVerifyParentConsent } from "@workspace/api-client-react";
import { Card, Button } from "../components/ui";
import { Users as UsersIcon, CheckCircle2 } from "lucide-react";

// Deliberately requires an explicit click rather than auto-confirming on
// page load — a parent/guardian opening the email shouldn't have their
// approval recorded just from the link being opened (a scanner/preview bot
// following the link, for instance, shouldn't count as consent).
export default function ParentConsent() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get("token") ?? "";

  const verifyMutation = useVerifyParentConsent();
  const [error, setError] = useState("");
  const [childEmail, setChildEmail] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError("");
    try {
      const res = await verifyMutation.mutateAsync({ data: { token } });
      setChildEmail(res.childEmail ?? null);
    } catch (err: any) {
      setError(err?.data?.error || "Invalid or expired consent link.");
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4">
          <UsersIcon className="w-12 h-12 text-primary" />
        </div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">
          SecureAI
        </h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">
          Parent / Guardian Consent
        </p>
      </div>

      <Card className="w-full max-w-md">
        {!token ? (
          <p className="font-mono text-sm text-destructive text-center">
            Missing consent token — use the link from the confirmation email.
          </p>
        ) : childEmail ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto" />
            <p className="font-mono text-sm text-foreground">
              Consent recorded — the account for{" "}
              <span className="text-primary">{childEmail}</span> is now active.
            </p>
            <Button className="w-full" onClick={() => setLocation("/")}>
              Go to Login
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              A minor in your care has registered a SecureAI account. Confirming
              below activates it and records your consent, timestamped, in the
              account's audit trail.
            </p>

            {error && (
              <p className="text-destructive font-mono text-xs uppercase tracking-wider text-center">
                {error}
              </p>
            )}

            <Button
              className="w-full"
              onClick={handleConfirm}
              isLoading={verifyMutation.isPending}
              data-testid="button-confirm-parent-consent"
            >
              I am the parent/guardian — confirm
            </Button>

            <div className="text-center pt-2">
              <Link href="/">
                <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                  Back to login
                </span>
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
