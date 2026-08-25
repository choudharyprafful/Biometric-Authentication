import React, { useEffect, useState } from 'react';
import { Link, useSearch, useLocation } from 'wouter';
import { useVerifyResetToken, useResetPasswordWithFace } from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { KeyRound, CheckCircle2, Fingerprint } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { resetPasswordWithPasskey } from '../lib/passkey';

export default function ResetPassword() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(search).get('token') ?? '';

  const verifyMutation = useVerifyResetToken();
  const resetFaceMutation = useResetPasswordWithFace();

  const [tokenError, setTokenError] = useState('');
  const [faceAvailable, setFaceAvailable] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [scanAttempt, setScanAttempt] = useState(0);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Passkey is the signed-challenge factor and is preferred; face scan is
  // only shown up front when no passkey is registered, or on request.
  const [useFaceInstead, setUseFaceInstead] = useState(false);

  useEffect(() => {
    if (!token) return;
    verifyMutation.mutateAsync({ data: { token } }).then((res) => {
      setFaceAvailable(res.faceAvailable);
      setPasskeyAvailable(res.passkeyAvailable);
    }).catch((err: any) => {
      setTokenError(err?.data?.error || 'Invalid or expired reset link.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const passwordsValid = newPassword.length >= 8 && newPassword === confirmPassword;

  const handleFaceScan = async (descriptor: number[]) => {
    if (!passwordsValid) return;
    setError('');
    try {
      await resetFaceMutation.mutateAsync({ data: { token, descriptor, newPassword } });
      setDone(true);
    } catch (err: any) {
      setError(err?.data?.error || 'Face verification failed.');
      setScanAttempt((attempt) => attempt + 1);
    }
  };

  const handlePasskeyReset = async () => {
    if (!passwordsValid) return;
    setError('');
    setPasskeyBusy(true);
    try {
      await resetPasswordWithPasskey(token, newPassword);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Passkey verification failed.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4">
          <KeyRound className="w-12 h-12 text-primary" />
        </div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">SecureAI</h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">Reset Password</p>
      </div>

      <Card className="w-full max-w-md">
        {!token ? (
          <p className="font-mono text-sm text-destructive text-center">Missing reset token — use the link from your reset email.</p>
        ) : tokenError ? (
          <p className="font-mono text-sm text-destructive text-center">{tokenError}</p>
        ) : done ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-green-400 mx-auto" />
            <p className="font-mono text-sm text-foreground">Password updated. You can now log in.</p>
            <Button className="w-full" onClick={() => setLocation('/')}>
              Go to Login
            </Button>
          </div>
        ) : verifyMutation.isPending ? (
          <p className="font-mono text-sm text-muted-foreground text-center uppercase tracking-wider">Checking reset link...</p>
        ) : !faceAvailable && !passkeyAvailable ? (
          <p className="font-mono text-sm text-destructive text-center">
            No biometric or passkey is enrolled on this account, so it can't be verified for a self-service reset. Contact an administrator.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="border border-primary/20 bg-primary/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary flex items-center gap-2">
                <Fingerprint className="w-3 h-3" /> Identity verification required
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                A reset link alone isn't enough — {passkeyAvailable ? 'your device passkey' : 'a live face scan'} must also confirm it's you before the password changes.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
            {newPassword && confirmPassword && !passwordsValid && (
              <p className="text-destructive font-mono text-xs uppercase tracking-wider">
                {newPassword.length < 8 ? 'Password must be at least 8 characters.' : 'Passwords do not match.'}
              </p>
            )}

            {(() => {
              const showFaceCamera = passwordsValid && faceAvailable && (useFaceInstead || !passkeyAvailable);
              const showPasskeyButton = passwordsValid && passkeyAvailable && !showFaceCamera;
              return (
                <>
                  {showFaceCamera && (
                    <FaceCamera key={scanAttempt} onCapture={handleFaceScan} autoCapture isVerifying />
                  )}

                  {showPasskeyButton && (
                    <Button
                      className="w-full"
                      onClick={handlePasskeyReset}
                      isLoading={passkeyBusy}
                      data-testid="button-passkey-reset"
                    >
                      <KeyRound className="w-4 h-4 mr-2" />
                      Verify with device passkey
                    </Button>
                  )}

                  {passwordsValid && passkeyAvailable && faceAvailable && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => { setError(''); setUseFaceInstead((v) => !v); }}
                    >
                      {showFaceCamera ? 'Use device passkey instead' : 'Use face scan instead'}
                    </Button>
                  )}
                </>
              );
            })()}

            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider text-center">{error}</p>}

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
