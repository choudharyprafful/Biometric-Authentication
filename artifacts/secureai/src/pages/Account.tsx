import { Link } from 'wouter';
import { KeyRound, ScanFace, ShieldCheck, TriangleAlert, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card, Button } from '../components/ui';
import { PasskeyManager } from '../components/PasskeyManager';

export default function Account() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Operator profile</p>
        <h1 className="mt-2 flex items-center gap-3 font-mono text-3xl font-bold uppercase tracking-widest">
          <ShieldCheck className="w-8 h-8 text-primary" />
          Account Security
        </h1>
        <p className="mt-3 max-w-2xl font-mono text-sm text-muted-foreground">
          Manage the cryptographic credentials and demo biometric methods connected to your operator account.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border-t-4 border-t-primary">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <h2 className="font-mono text-sm font-bold uppercase tracking-widest">Passkeys</h2>
              </div>
              <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
                Recommended. Your device biometric unlocks a private key that signs a fresh server challenge.
              </p>
            </div>
            <span className="border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-primary">
              Strongest
            </span>
          </div>
        </Card>

        <Card className={user.faceEnrolled ? 'border-t-4 border-t-primary/60' : 'border-t-4 border-t-yellow-500/60'}>
          <div className="flex items-start gap-3">
            {user.faceEnrolled ? <ScanFace className="w-5 h-5 text-primary shrink-0" /> : <TriangleAlert className="w-5 h-5 text-yellow-500 shrink-0" />}
            <div>
              <h2 className="font-mono text-sm font-bold uppercase tracking-widest">Face Scan Demo</h2>
              <p className="mt-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {user.faceEnrolled
                  ? 'A face descriptor is enrolled for the legacy demo MFA flow.'
                  : 'No face descriptor is enrolled for the legacy demo MFA flow.'}
              </p>
              <Link href="/enroll">
                <Button variant="outline" size="sm" className="mt-4 font-mono text-xs">
                  {user.faceEnrolled ? 'Review or re-enroll' : 'Set up face scan'}
                  <ArrowRight className="ml-1" />
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <Card className="border-t-4 border-t-primary bg-card/50">
        <PasskeyManager />
      </Card>
    </div>
  );
}