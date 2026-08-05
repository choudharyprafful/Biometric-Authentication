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
import { Shield, Fingerprint, KeyRound, Loader2, LockKeyhole } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { startAuthentication } from '@simplewebauthn/browser';
import { OpenInBrowserTab } from '../components/OpenInBrowserTab';

type LoginView = 'passkey' | 'password' | 'face-mfa';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkeyEmail, setPasskeyEmail] = useState('');
  const [error, setError] = useState('');
  const [scanAttempt, setScanAttempt] = useState(0);
  const [view, setView] = useState<LoginView>('passkey');
  const [passkeyPending, setPasskeyPending] = useState(false);
  const [needsTopLevelTab, setNeedsTopLevelTab] = useState(false);
  const { requiresFaceVerification, tempToken, setTempToken, setRequiresFaceVerification, refetchUser } = useAuth();
  const [, setLocation] = useLocation();
  const loginMutation = useLoginUser();
  const faceVerifyMutation = useFaceVerify();
  const authOptionsMutation = useWebauthnAuthenticateOptions();
  const authVerifyMutation = useWebauthnAuthenticateVerify();

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

  const handlePasskeyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsTopLevelTab(false);
    setPasskeyPending(true);
    try {
      const options = await authOptionsMutation.mutateAsync({ data: { email: passkeyEmail || undefined } });
      let assertion;
      try {
        assertion = await startAuthentication({ optionsJSON: options as any });
      } catch (browserErr: any) {
        if (browserErr?.name === 'NotAllowedError') setError('Passkey prompt was dismissed or timed out. Try again.');
        else if (browserErr?.name === 'SecurityError') {
          setError('This embedded preview cannot access device passkeys. Open SecureAI in a full browser tab to continue.');
          setNeedsTopLevelTab(true);
        } else setError(browserErr?.message || 'Device rejected the passkey request.');
        return;
      }
      await authVerifyMutation.mutateAsync({ data: { response: assertion as any } });
      await refetchUser();
      setLocation('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Passkey authentication failed.');
    } finally {
      setPasskeyPending(false);
    }
  };

  const activeView = view === 'face-mfa' && requiresFaceVerification ? 'face-mfa' : view;
  const switchView = (next: LoginView) => { setError(''); setNeedsTopLevelTab(false); setView(next); };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-4 border border-primary/30 mb-4 animate-pulse"><Shield className="w-12 h-12 text-primary" /></div>
        <h1 className="font-mono text-3xl tracking-widest uppercase">SecureAI</h1>
        <p className="font-mono text-sm text-primary/70 tracking-widest uppercase mt-2">Identity Verification</p>
      </div>
      <Card className="w-full max-w-md relative overflow-hidden">
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-primary/50" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-primary/50" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-primary/50" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-primary/50" />

        {activeView === 'passkey' && (
          <form onSubmit={handlePasskeyLogin} className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-3">
              <div className="bg-primary/10 border border-primary/30 p-4 inline-block"><KeyRound className="w-10 h-10 text-primary" /></div>
              <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Recommended sign-in</p><h2 className="mt-1 font-mono text-lg uppercase tracking-widest">Use your passkey</h2></div>
              <p className="text-xs font-mono text-muted-foreground max-w-xs mx-auto">Your device checks your face or fingerprint locally, then uses its protected private key to sign SecureAI’s one-time challenge.</p>
            </div>
            <div className="border border-primary/20 bg-primary/5 p-3 font-mono text-xs text-muted-foreground">No biometric data reaches SecureAI. The server verifies only the cryptographic signature.</div>
            <div className="space-y-2">
              <Label htmlFor="passkey-email">Operator ID (Email) — optional</Label>
              <Input id="passkey-email" type="email" autoComplete="username webauthn" value={passkeyEmail} onChange={(e) => setPasskeyEmail(e.target.value)} placeholder="admin@secureai.demo" />
              <p className="text-[10px] font-mono text-muted-foreground">Leave blank to choose from a passkey saved on this device.</p>
            </div>
            {error && <div className="space-y-2"><p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>{needsTopLevelTab && <OpenInBrowserTab />}</div>}
            <Button type="submit" className="w-full" disabled={passkeyPending}>
              {passkeyPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Waiting for device…</> : <><KeyRound className="w-4 h-4 mr-2" /> Continue with Passkey</>}
            </Button>
            <Button type="button" variant="ghost" className="w-full font-mono text-xs tracking-wider" onClick={() => switchView('password')}><LockKeyhole className="w-4 h-4 mr-2" /> Use password instead</Button>
            <div className="text-center pt-2 border-t border-border"><Link href="/register"><span className="text-xs font-mono text-muted-foreground hover:text-primary cursor-pointer uppercase tracking-wider">Request New Clearance (Register)</span></Link></div>
          </form>
        )}

        {activeView === 'password' && (
          <form onSubmit={handleLoginSubmit} className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-2"><LockKeyhole className="w-8 h-8 text-primary mx-auto" /><h2 className="font-mono text-lg uppercase tracking-widest">Password sign-in</h2><p className="font-mono text-xs text-muted-foreground">Legacy access path with face-scan MFA when enrolled.</p></div>
            <div className="space-y-4">
              <div className="space-y-2"><Label htmlFor="email">Operator ID (Email)</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@secureai.demo" data-testid="input-email" /></div>
              <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" data-testid="input-password" /></div>
            </div>
            <div className="border border-primary/20 bg-primary/5 p-3"><p className="font-mono text-[10px] uppercase tracking-wider text-primary">Demo MFA notice</p><p className="mt-1 font-mono text-xs text-muted-foreground">This path uses a networked face descriptor. Prefer passkeys for cryptographic device biometrics.</p></div>
            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}
            <Button type="submit" className="w-full" isLoading={loginMutation.isPending} data-testid="button-login">Authenticate</Button>
            <p className="text-center text-xs font-mono text-muted-foreground">Demo: <button type="button" className="text-primary" onClick={() => { setEmail('admin@secureai.demo'); setPassword('Password123!'); }}>admin@secureai.demo</button> / Password123!</p>
            <Button type="button" variant="ghost" className="w-full font-mono text-xs tracking-wider" onClick={() => switchView('passkey')}><KeyRound className="w-4 h-4 mr-2" /> Back to passkey sign-in</Button>
          </form>
        )}

        {activeView === 'face-mfa' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-2"><Fingerprint className="w-8 h-8 text-primary mx-auto mb-2 animate-pulse" /><h2 className="font-mono text-lg uppercase tracking-widest text-primary">Biometric Step Required</h2><p className="text-xs font-mono text-muted-foreground">Position face clearly in the reticle.</p></div>
            <FaceCamera key={scanAttempt} onCapture={handleFaceScan} autoCapture isVerifying />
            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider text-center">{error}</p>}
            {faceVerifyMutation.isPending && <p className="text-primary font-mono text-xs uppercase tracking-wider text-center animate-pulse">Verifying biometric signature...</p>}
            {error && <Button variant="outline" className="w-full" onClick={() => { setError(''); setScanAttempt((a) => a + 1); }} disabled={faceVerifyMutation.isPending}>Try face scan again</Button>}
            <Button variant="ghost" className="w-full" onClick={() => { setRequiresFaceVerification(false); setTempToken(null); switchView('password'); }}>Abort sequence</Button>
          </div>
        )}
      </Card>
    </div>
  );
}