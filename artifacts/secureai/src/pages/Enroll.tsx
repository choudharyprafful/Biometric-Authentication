import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useEnrollFace } from '@workspace/api-client-react';
import { Card, Button } from '../components/ui';
import { ScanFace, CheckCircle2, ChevronRight, KeyRound, Trash2 } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { enrollPasskey, listPasskeys, deletePasskey, type PasskeyInfo } from '../lib/passkey';

function PasskeySection() {
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    listPasskeys().then(setPasskeys).catch(() => setPasskeys([]));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const inIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  const handleAdd = async () => {
    setError('');
    setBusy(true);
    try {
      await enrollPasskey();
      refresh();
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
        setError(
          inIframe
            ? 'The browser blocked passkey creation inside the embedded preview. Open the app in its own tab and try again.'
            : 'Passkey prompt was cancelled or timed out. Please try again.',
        );
      } else {
        setError(err?.message || 'Passkey enrollment failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePasskey(id);
      refresh();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove passkey.');
    }
  };

  return (
    <Card className="mt-8 border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
      <div className="space-y-4">
        <h2 className="text-lg font-mono uppercase tracking-widest flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-primary" />
          Device Passkeys (WebAuthn)
        </h2>
        <p className="text-sm font-mono text-muted-foreground">
          Gold-standard MFA: your device biometric (Face ID / fingerprint / PIN) unlocks a
          secret key that never leaves the device. The key signs a one-time challenge from
          the server — the signature is the second factor, so a hacked client cannot fake it.
        </p>

        {passkeys.length > 0 && (
          <ul className="space-y-2">
            {passkeys.map((pk) => (
              <li key={pk.id} className="flex items-center justify-between border border-primary/20 bg-primary/5 px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {pk.deviceName || 'Passkey'} · added {new Date(pk.createdAt).toLocaleDateString()}
                  {pk.lastUsedAt ? ` · last used ${new Date(pk.lastUsedAt).toLocaleDateString()}` : ''}
                </span>
                <button
                  className="text-destructive/70 hover:text-destructive"
                  onClick={() => handleDelete(pk.id)}
                  title="Remove passkey"
                  data-testid={`button-delete-passkey-${pk.id}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {inIframe && (
          <div className="border border-yellow-500/30 bg-yellow-500/5 p-3">
            <p className="font-mono text-xs text-yellow-500/90">
              You appear to be in the embedded preview. Browsers block passkey creation inside
              embedded frames —{' '}
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-yellow-400"
              >
                open the app in a new tab
              </a>{' '}
              to register this device.
            </p>
          </div>
        )}

        {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

        <Button onClick={handleAdd} isLoading={busy} variant="outline" data-testid="button-add-passkey">
          <KeyRound className="w-4 h-4 mr-2" />
          {passkeys.length > 0 ? 'Add another passkey' : 'Register this device'}
        </Button>
      </div>
    </Card>
  );
}

export default function Enroll() {
  const { user, refetchUser } = useAuth();
  const [, setLocation] = useLocation();
  const enrollMutation = useEnrollFace();
  
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [descriptor, setDescriptor] = useState<number[] | null>(null);
  const [error, setError] = useState('');

  if (!user) return null;

  const handleCapture = (capturedDescriptor: number[]) => {
    setDescriptor(capturedDescriptor);
    setStep(3);
  };

  const handleConfirm = async () => {
    if (!descriptor) return;
    setError('');
    
    try {
      await enrollMutation.mutateAsync({ id: user.id, data: { descriptor } });
      await refetchUser();
      setLocation('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to save biometric profile.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-12">
      <div className="mb-8">
        <h1 className="font-mono text-3xl font-bold uppercase tracking-widest text-foreground flex items-center gap-4">
          <ScanFace className="w-8 h-8 text-primary" />
          Biometric Enrollment
        </h1>
        <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-wider">
          Multi-factor security protocol setup for operator {user.name}
        </p>
      </div>

      <div className="flex items-center justify-between mb-8 px-8">
        <div className={`flex flex-col items-center ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm mb-2 ${step >= 1 ? 'border-primary bg-primary/20' : 'border-muted-foreground'}`}>1</div>
          <span className="text-xs font-mono uppercase tracking-widest">Protocol</span>
        </div>
        <div className={`flex-1 h-px ${step >= 2 ? 'bg-primary' : 'bg-muted-foreground'} mx-4 opacity-30`} />
        <div className={`flex flex-col items-center ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm mb-2 ${step >= 2 ? 'border-primary bg-primary/20' : 'border-muted-foreground'}`}>2</div>
          <span className="text-xs font-mono uppercase tracking-widest">Capture</span>
        </div>
        <div className={`flex-1 h-px ${step >= 3 ? 'bg-primary' : 'bg-muted-foreground'} mx-4 opacity-30`} />
        <div className={`flex flex-col items-center ${step >= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm mb-2 ${step >= 3 ? 'border-primary bg-primary/20' : 'border-muted-foreground'}`}>3</div>
          <span className="text-xs font-mono uppercase tracking-widest">Confirm</span>
        </div>
      </div>

      <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
        {step === 1 && (
          <div className="space-y-6 text-center py-8">
            <ScanFace className="w-16 h-16 text-primary mx-auto mb-4 opacity-80" />
            <h2 className="text-xl font-mono uppercase tracking-widest">Enhanced Security Required</h2>
            <p className="text-muted-foreground font-mono max-w-lg mx-auto">
              SecureAI requires facial biometrics for multi-factor authentication. 
              The system will capture a mathematical map of your face.
              No visual image is stored.
            </p>
            
            <div className="bg-primary/5 border border-primary/20 p-4 inline-block text-left mt-4">
              <ul className="text-sm font-mono text-muted-foreground space-y-2 list-disc pl-4">
                <li>Ensure good lighting</li>
                <li>Face the camera directly</li>
                <li>Remove sunglasses or masks</li>
              </ul>
            </div>

            <div className="flex justify-center gap-4 mt-8">
              <Button variant="ghost" onClick={() => setLocation('/dashboard')}>
                Skip Protocol
              </Button>
              <Button onClick={() => setStep(2)}>
                Initialize Camera <ChevronRight className="ml-2 w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 py-4">
            <FaceCamera 
              onCapture={handleCapture}
              buttonLabel="Capture Biometric Map"
            />
            <div className="flex justify-center mt-4">
               <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Abort</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 text-center py-8">
            <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-mono uppercase tracking-widest text-green-400">Signature Acquired</h2>
            <p className="text-muted-foreground font-mono max-w-lg mx-auto">
              Facial map generated successfully. Proceed to bind this signature to your operator profile.
            </p>
            
            {error && <p className="text-destructive font-mono text-sm">{error}</p>}

            <div className="flex justify-center gap-4 mt-8">
              <Button variant="outline" onClick={() => setStep(2)} disabled={enrollMutation.isPending}>
                Recapture
              </Button>
              <Button onClick={handleConfirm} isLoading={enrollMutation.isPending}>
                Commit Signature
              </Button>
            </div>
          </div>
        )}
      </Card>

      <PasskeySection />
    </div>
  );
}
