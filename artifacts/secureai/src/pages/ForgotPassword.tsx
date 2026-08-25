import React, { useState } from 'react';
import { Link } from 'wouter';
import { useForgotPassword } from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { Shield, KeyRound } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
  const forgotPasswordMutation = useForgotPassword();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await forgotPasswordMutation.mutateAsync({ data: { email } });
    setMessage(res.message);
    setDevResetLink(res.devResetLink ?? null);
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4">
          <KeyRound className="w-12 h-12 text-primary" />
        </div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">SecureAI</h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">Password Recovery</p>
      </div>

      <Card className="w-full max-w-md">
        {message ? (
          <div className="space-y-4 text-center">
            <Shield className="w-8 h-8 text-primary mx-auto" />
            <p className="font-mono text-sm text-foreground">{message}</p>
            {devResetLink && (
              <div className="border border-primary/20 bg-primary/5 p-3 text-left">
                <p className="font-mono text-[10px] uppercase tracking-wider text-primary mb-1">Dev mode — no mail server configured</p>
                <Link href={devResetLink}>
                  <span className="text-xs font-mono text-primary underline break-all cursor-pointer" data-testid="link-dev-reset">
                    {devResetLink}
                  </span>
                </Link>
              </div>
            )}
            <Link href="/">
              <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                Back to login
              </span>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              Enter your operator ID and we'll issue a reset link if the account exists.
            </p>
            <div className="space-y-2">
              <Label htmlFor="email">Operator ID (Email)</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-forgot-email"
              />
            </div>
            <Button type="submit" className="w-full" isLoading={forgotPasswordMutation.isPending} data-testid="button-forgot-submit">
              Send Reset Link
            </Button>
            <div className="text-center pt-2">
              <Link href="/">
                <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                  Back to login
                </span>
              </Link>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
