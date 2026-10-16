import React, { useState } from "react";
import { Link, useSearch } from "wouter";
import { useVerifyEmail } from "@workspace/api-client-react";
import { Card, Button } from "../components/ui";
import { MailCheck, CheckCircle2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";

// An explicit click, like ParentConsent: a mail scanner or link preview that opens the page
// shouldn't confirm the address on the account holder's behalf.
export default function VerifyEmail() {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const { user, refetchUser } = useAuth();

  const verifyMutation = useVerifyEmail();
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  const handleConfirm = async () => {
    setError("");
    try {
      await verifyMutation.mutateAsync({ data: { token } });
      setVerified(true);
      refetchUser();
    } catch (err: any) {
      setError(
        err?.data?.error ||
          "This link has expired or was already used. Sign in and send a new one from your dashboard.",
      );
    }
  };

  return (
    <main className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4">
          <MailCheck className="w-12 h-12 text-primary" />
        </div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">
          SecureAI
        </h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">
          Confirm your email
        </p>
      </div>

      <Card className="w-full max-w-md">
        {!token ? (
          <p className="font-mono text-sm text-destructive text-center">
            This page needs the link from the confirmation email.
          </p>
        ) : verified ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto" />
            <p className="font-mono text-sm text-foreground">
              Email address confirmed. You can now upload files and make
              payments.
            </p>
            <Link href={user ? "/dashboard" : "/"}>
              <Button className="w-full">
                {user ? "Go to dashboard" : "Go to sign-in"}
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              Confirm that this email address belongs to you to finish setting
              up your SecureAI account.
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
              data-testid="button-confirm-email"
            >
              Confirm my email address
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
