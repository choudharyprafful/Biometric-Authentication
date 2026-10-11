import React, { useState } from "react";
import { Link } from "wouter";
import { useResendEmailVerification } from "@workspace/api-client-react";
import { Button } from "./ui";
import { useAuth } from "../contexts/AuthContext";

// R-PAY-5: until the address is confirmed the API refuses uploads and payments
// (EMAIL_VERIFICATION_REQUIRED), so the reason and the way out sit on every signed-in page.
export function EmailVerificationNotice() {
  const { user } = useAuth();
  const resend = useResendEmailVerification();
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState<string | null>(null);
  if (!user || user.emailVerified) return null;

  const handleResend = async () => {
    setMessage("");
    try {
      const res = await resend.mutateAsync();
      setDevLink(res.devEmailVerificationLink ?? null);
      setMessage(
        res.alreadyVerified
          ? "Your address is already confirmed. Refresh the page."
          : `We've sent a new link to ${user.email}. Earlier links no longer work.`,
      );
    } catch (err: any) {
      setMessage(err?.data?.error || "Could not send a new link. Try again.");
    }
  };

  return (
    <div
      className="mb-6 border border-primary/40 bg-primary/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      data-testid="email-verification-notice"
    >
      <div className="flex-1 space-y-1">
        <p className="text-sm text-foreground">
          Confirm your email address to upload files and make payments. We sent
          a link to {user.email} when you signed up; it works for 24 hours.
        </p>
        {message && (
          <p className="font-mono text-xs text-muted-foreground">{message}</p>
        )}
        {devLink && (
          <p className="font-mono text-xs text-primary">
            Local development:{" "}
            <Link href={devLink}>
              <span className="underline cursor-pointer">open the link</span>
            </Link>
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleResend}
        isLoading={resend.isPending}
        data-testid="email-verification-resend"
      >
        Send a new link
      </Button>
    </div>
  );
}
