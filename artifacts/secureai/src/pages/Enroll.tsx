import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useEnrollFace } from '@workspace/api-client-react';
import { Card, Button } from '../components/ui';
import { ScanFace, CheckCircle2, ChevronRight, KeyRound } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { PasskeyManager } from '../components/PasskeyManager';

type EnrollTab = 'face' | 'passkey';

export default function Enroll() {
  const { user, refetchUser } = useAuth();
  const [, setLocation] = useLocation();
  const enrollMutation = useEnrollFace();

  const [tab, setTab] = useState<EnrollTab>('passkey');
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

      {/* Tab selector */}
      <div className="flex border-b border-border mb-6">
        <button
          onClick={() => setTab('passkey')}
          className={`flex items-center gap-2 px-4 py-2 font-mono text-xs uppercase tracking-widest border-b-2 transition-colors ${
            tab === 'passkey'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          Passkey (Recommended)
        </button>
        <button
          onClick={() => setTab('face')}
          className={`flex items-center gap-2 px-4 py-2 font-mono text-xs uppercase tracking-widest border-b-2 transition-colors ${
            tab === 'face'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ScanFace className="w-4 h-4" />
          Face Scan (Demo)
        </button>
      </div>

      {/* ── PASSKEY TAB ── */}
      {tab === 'passkey' && (
        <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
          <PasskeyManager />
          <div className="mt-6 pt-4 border-t border-border flex justify-end">
            <Button variant="ghost" onClick={() => setLocation('/dashboard')}>
              Back to dashboard
            </Button>
          </div>
        </Card>
      )}

      {/* ── FACE SCAN TAB ── */}
      {tab === 'face' && (
        <>
          {/* Step progress */}
          <div className="flex items-center justify-between mb-8 px-8">
            {([1, 2, 3] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex flex-col items-center ${step >= s ? 'text-primary' : 'text-muted-foreground'}`}>
                  <div
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center font-mono font-bold text-sm mb-2 ${
                      step >= s ? 'border-primary bg-primary/20' : 'border-muted-foreground'
                    }`}
                  >
                    {s}
                  </div>
                  <span className="text-xs font-mono uppercase tracking-widest">
                    {['Protocol', 'Capture', 'Confirm'][i]}
                  </span>
                </div>
                {i < 2 && (
                  <div className={`flex-1 h-px mx-4 opacity-30 ${step > s ? 'bg-primary' : 'bg-muted-foreground'}`} />
                )}
              </React.Fragment>
            ))}
          </div>

          <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
            {step === 1 && (
              <div className="space-y-6 text-center py-8">
                <ScanFace className="w-16 h-16 text-primary mx-auto mb-4 opacity-80" />
                <h2 className="text-xl font-mono uppercase tracking-widest">Demo Face Scan</h2>

                {/* Honest limitation warning */}
                <div className="border border-yellow-500/40 bg-yellow-500/5 p-4 text-left mx-4">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-yellow-500 mb-1">
                    ⚠ Security limitation
                  </p>
                  <p className="font-mono text-xs text-muted-foreground leading-relaxed">
                    This face scan sends a 128-value descriptor over the network. A compromised client
                    can forge it — it is not cryptographically secure. Use the <strong className="text-foreground">Passkey</strong> tab
                    for production-grade biometric MFA.
                  </p>
                </div>

                <p className="text-muted-foreground font-mono max-w-lg mx-auto text-sm">
                  SecureAI will capture a mathematical map of your face. No visual image is stored.
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
                <FaceCamera onCapture={handleCapture} buttonLabel="Capture Biometric Map" />
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
        </>
      )}
    </div>
  );
}
