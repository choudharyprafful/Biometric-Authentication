import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useLoginUser, useFaceVerify } from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { Shield, Fingerprint } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { KeyRound } from 'lucide-react';
import { loginWithPasskey } from '../lib/passkey';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [scanAttempt, setScanAttempt] = useState(0);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [faceAvailable, setFaceAvailable] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  
  const { requiresFaceVerification, tempToken, setTempToken, setRequiresFaceVerification, refetchUser } = useAuth();
  const [, setLocation] = useLocation();
  
  const loginMutation = useLoginUser();
  const faceVerifyMutation = useFaceVerify();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    try {
      const res = await loginMutation.mutateAsync({ data: { email, password } });
      
      if (res.requiresFaceVerification && res.tempToken) {
        setTempToken(res.tempToken);
        setFaceAvailable(res.faceAvailable);
        setPasskeyAvailable(res.passkeyAvailable);
        setRequiresFaceVerification(true);
        setScanAttempt(0);
      } else {
        await refetchUser();
        setLocation('/dashboard');
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Authentication failed. Unauthorized access attempt logged.');
    }
  };

  useEffect(() => {
    if (!requiresFaceVerification) {
      setPasskeyAvailable(false);
      setFaceAvailable(false);
    }
  }, [requiresFaceVerification]);

  const handlePasskeyLogin = async () => {
    setError('');
    setPasskeyBusy(true);
    try {
      await loginWithPasskey();
      setTempToken(null);
      setRequiresFaceVerification(false);
      await refetchUser();
      setLocation('/dashboard');
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
        let inIframe = true;
        try { inIframe = window.self !== window.top; } catch { /* cross-origin parent */ }
        setError(
          inIframe
            ? 'The browser blocked the passkey prompt inside the embedded preview. Open the app in its own tab and try again.'
            : 'Passkey prompt was cancelled or timed out. Please try again.',
        );
      } else {
        setError(err?.message || 'Passkey verification failed.');
      }
    } finally {
      setPasskeyBusy(false);
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
      // Mount a fresh scanner after a failed comparison so the operator can
      // deliberately position their face and try again.
      setScanAttempt((attempt) => attempt + 1);
    }
  };

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
        {/* Decorative corner accents */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-primary/50"></div>
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-primary/50"></div>
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-primary/50"></div>
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-primary/50"></div>

        {!requiresFaceVerification ? (
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Operator ID (Email)</Label>
                <Input 
                  id="email" 
                  type="email" 
                  required 
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin_user@prafful.com"
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
                  onChange={e => setPassword(e.target.value)}
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
            
            <Button 
              type="submit" 
              className="w-full" 
              isLoading={loginMutation.isPending}
              data-testid="button-login"
            >
              Authenticate
            </Button>
            
            <div className="pt-4 text-center border-t border-border">
              <p className="text-xs font-mono text-muted-foreground">
                Demo access: <span className="text-primary cursor-pointer" onClick={() => { setEmail('admin_user@prafful.com'); setPassword('Password123!'); }}>admin_user@prafful.com</span> / Password123!
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
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center space-y-2">
              <Fingerprint className="w-8 h-8 text-primary mx-auto mb-2 animate-pulse" />
              <h2 className="font-mono text-lg uppercase tracking-widest text-primary">
                {faceAvailable ? 'Biometric Step Required' : 'Passkey Step Required'}
              </h2>
              {faceAvailable ? (
                <>
                  <p className="text-xs font-mono text-muted-foreground">Position face clearly in the reticle.</p>
                  <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    Camera permission is required. The scan starts automatically once your face is detected.
                  </p>
                </>
              ) : (
                <p className="text-xs font-mono text-muted-foreground">
                  Confirm your identity with your device passkey to continue.
                </p>
              )}
            </div>
            
            {faceAvailable && (
              <FaceCamera 
                key={scanAttempt}
                onCapture={handleFaceScan} 
                autoCapture={true} 
                isVerifying={true}
              />
            )}
            
            {passkeyAvailable && (
              <Button
                variant="outline"
                className="w-full"
                onClick={handlePasskeyLogin}
                isLoading={passkeyBusy}
                data-testid="button-passkey-login"
              >
                <KeyRound className="w-4 h-4 mr-2" />
                {faceAvailable ? 'Use device passkey instead' : 'Verify with device passkey'}
              </Button>
            )}

            {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider text-center">{error}</p>}
            {faceVerifyMutation.isPending && <p className="text-primary font-mono text-xs uppercase tracking-wider text-center animate-pulse">Verifying biometric signature...</p>}

            {error && faceAvailable && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setError('');
                  setScanAttempt((attempt) => attempt + 1);
                }}
                disabled={faceVerifyMutation.isPending}
              >
                Try face scan again
              </Button>
            )}
            
            <Button 
              variant="ghost" 
              className="w-full" 
              onClick={() => { setRequiresFaceVerification(false); setTempToken(null); }}
            >
              Abort sequence
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
