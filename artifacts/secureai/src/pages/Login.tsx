import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import {
  useLoginUser,
  useFaceVerify,
  useWebauthnAuthenticateOptions,
  useWebauthnAuthenticateVerify,
} from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { Shield, Fingerprint, KeyRound, Loader2 } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { startAuthentication } from '@simplewebauthn/browser';

type LoginView = 'password' | 'face-mfa' | 'passkey';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkeyEmail, setPasskeyEmail] = useState('');
  const [error, setError] = useState('');
  const [scanAttempt, setScanAttempt] = useState(0);
  const [view, setView] = useState<LoginView>('password');
  const [passkeyPending, setPasskeyPending] = useState(false);

  const { requiresFaceVerification, tempToken, setTempToken, setRequiresFaceVerification, refetchUser } = useAuth();
  const [, setLocation] = useLocation();

  const loginMutation = useLoginUser();
  const faceVerifyMutation = useFaceVerify();
  const authOptionsMutation = useWebauthnAuthenticateOptions();
  const authVerifyMutation = useWebauthnAuthenticateVerify();

  // ----- Password login -----
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await loginMutation.mutateAsync({ data: { email, password } });
      if (res.requiresFaceVerification && res.tempToken) {
        setTempToken(res.tempToken);
        setRequiresFaceVerification(true);
        setScanAttempt(0);
        setView('face-mfa');
      } else {
        await refetchUser();
        setLocation('/dashboard');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Authentication failed. Unauthorized access attempt logged.');
    }
  };

  // ----- Face MFA -----
  const handleFaceScan = async (descriptor: number[]) => {
    if (!tempToken) return;
    setError('');
    try {
      await faceVerifyMutation.mutateAsync({ data: { descriptor, tempToken } });
      setTempToken(null);
      setRequiresFaceVerification(false);
      await refetchUser();
      setLocation('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Biometric verification failed.');
      setScanAttempt((a) => a + 1);
    }
  };

  // ----- Passkey (WebAuthn) login -----
  const handlePasskeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPasskeyPending(true);
    try {
      // Step 1 — get challenge from server
      const options = await authOptionsMutation.mutateAsync({
        data: { email: passkeyEmail || undefined },
      });

      // Step 2 — browser shows native biometric prompt; private key signs the challenge
      // No biometric data leaves the device — only the signed challenge is sent back.
      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: options as any });
      } catch (browserErr: any) {
        if (browserErr?.name === 'NotAllowedError') {
          setError('Passkey prompt was dismissed or timed out. Try again.');
        } else if (browserErr?.name === 'SecurityError') {
          setError('Passkeys require a top-level window — open the app in a full browser tab, not an embedded preview.');
        } else {
          setError(browserErr?.message || 'Device rejected the passkey request.');
        }
        return;
      }

      // Step 3 — server verifies the signature against the stored public key
      const result = await authVerifyMutation.mutateAsync({ data: { response: assertion as any } });
      await refetchUser();
      setLocation('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Passkey authentication failed.');
    } finally {
      setPasskeyPending(false);
    }
  };

  const activeView = view === 'face-mfa' && requiresFaceVerification ? 'face-mfa' : view;

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4 animate-pulse">
          <Shield className="w-12 h-12 text-primary" />
        </div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">SecureAI</h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">Identity Verification</p>
      </div>

      <Card className="w-full max-w-md relative overflow-hidden">
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-primary/50" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-primary/50" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-primary/50" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-primary/50" />

        {/* ── Password form ── */}
        {activeView === 'password' && (
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Operator ID (Email)</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@secureai.demo"
                  data-testid="input-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passkey</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  data-testid="input-password"
                />
              </div>
            </div>

            <div className="border border-primary/20 bg-primary/5 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary">Biometric MFA</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Enrolled operators continue to a live face scan after password verification.
              </p>
            </div>

            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

            <Button type="submit" className="w-full" isLoading={loginMutation.isPending} data-testid="button-login">
              Authenticate
            </Button>

            {/* Passkey alternative */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  or
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full font-mono text-xs tracking-wider"
              onClick={() => { setError(''); setView('passkey'); }}
            >
              <KeyRound className="w-4 h-4 mr-2 text-primary" />
              Sign in with Passkey
            </Button>

            <div className="pt-4 text-center border-t border-border">
              <p className="text-xs font-mono text-muted-foreground">
                Demo:{' '}
                <span
                  className="text-primary cursor-pointer"
                  onClick={() => { setEmail('admin@secureai.demo'); setPassword('Password123!'); }}
                >
                  admin@secureai.demo
                </span>{' '}
                / Password123!
              </p>
            </div>

            <div className="text-center pt-2">
              <Link href="/register">
                <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                  Request New Clearance (Register)
                </span>
              </Link>
            </div>
          </form>
        )}

        {/* ── Face MFA ── */}
        {activeView === 'face-mfa' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-2">
              <Fingerprint className="w-8 h-8 text-primary mx-auto mb-2 animate-pulse" />
              <h2 className="font-mono text-lg uppercase tracking-widest text-primary">Biometric Step Required</h2>
              <p className="text-xs font-mono text-muted-foreground">Position face clearly in the reticle.</p>
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                Camera permission is required. The scan starts automatically once your face is detected.
              </p>
            </div>

            <FaceCamera key={scanAttempt} onCapture={handleFaceScan} autoCapture isVerifying />

            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider text-center">{error}</p>}
            {faceVerifyMutation.isPending && (
              <p className="text-primary font-mono text-xs uppercase tracking-wider text-center animate-pulse">
                Verifying biometric signature...
              </p>
            )}
            {error && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setError(''); setScanAttempt((a) => a + 1); }}
                disabled={faceVerifyMutation.isPending}
              >
                Try face scan again
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => { setRequiresFaceVerification(false); setTempToken(null); setView('password'); }}
            >
              Abort sequence
            </Button>
          </div>
        )}

        {/* ── Passkey login ── */}
        {activeView === 'passkey' && (
          <form onSubmit={handlePasskeyLogin} className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-3">
              <div className="bg-primary/10 border border-primary/30 p-4 inline-block mx-auto">
                <KeyRound className="w-10 h-10 text-primary" />
              </div>
              <h2 className="font-mono text-lg uppercase tracking-widest text-primary">Passkey Login</h2>
              <p className="text-xs font-mono text-muted-foreground max-w-xs mx-auto">
                Your device biometric (Face ID / Touch ID / Windows Hello) unlocks a private key stored in
                the secure enclave. It signs a server challenge — no biometric data ever leaves your device.
              </p>
            </div>

            {/* How it works panel */}
            <div className="border border-primary/20 bg-primary/5 p-3 space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary">How passkeys work</p>
              <ol className="font-mono text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Server issues a one-time challenge</li>
                <li>Device biometric unlocks your private key</li>
                <li>Private key signs the challenge (stays on device)</li>
                <li>Server verifies signature with stored public key</li>
              </ol>
            </div>

            <div className="space-y-2">
              <Label htmlFor="passkey-email">Operator ID (Email) — optional</Label>
              <Input
                id="passkey-email"
                type="email"
                value={passkeyEmail}
                onChange={(e) => setPasskeyEmail(e.target.value)}
                placeholder="admin@secureai.demo"
              />
              <p className="text-[10px] font-mono text-muted-foreground">
                Leave blank to let your device choose from all registered passkeys.
              </p>
            </div>

            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

            <Button type="submit" className="w-full" disabled={passkeyPending}>
              {passkeyPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Waiting for device…
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Authenticate with Passkey
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full font-mono text-xs tracking-wider"
              onClick={() => { setError(''); setView('password'); }}
            >
              ← Back to password login
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
