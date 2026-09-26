import React, { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useRegisterUser } from '@workspace/api-client-react';
import { Card, Input, Label, Button } from '../components/ui';
import { Checkbox } from '../components/ui/checkbox';
import { Shield, Users as UsersIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { PRIVACY_POLICY } from '../lib/privacyPolicy';

// Self-reported, same as virtually every consumer app — real ID/document
// verification is out of scope for this PoC (see
// docs/05_Consent_and_Deletion_Design.md, "Minor / parental consent").
// Must match MINOR_CONSENT_AGE_THRESHOLD in api-server's auth.ts — this is
// purely a client-side UX hint (show/hide the parent-email field before
// submit); the server independently recomputes age from dateOfBirth and is
// the actual enforcement point.
const MINOR_CONSENT_AGE_THRESHOLD = 18;

function computeAge(dateOfBirthIso: string): number | null {
  if (!dateOfBirthIso) return null;
  const dob = new Date(dateOfBirthIso);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [parentGuardianEmail, setParentGuardianEmail] = useState('');
  const [dataConsent, setDataConsent] = useState(false);
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [error, setError] = useState('');
  const [devParentConsentLink, setDevParentConsentLink] = useState<string | null>(null);

  const [, setLocation] = useLocation();
  const registerMutation = useRegisterUser();
  const { refetchUser } = useAuth();

  const age = computeAge(dateOfBirth);
  const isMinor = age !== null && age < MINOR_CONSENT_AGE_THRESHOLD;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passkeys do not match.');
      return;
    }

    if (!dataConsent) {
      setError('You must consent to data processing to register.');
      return;
    }

    if (isMinor && !parentGuardianEmail.trim()) {
      setError(`A parent/guardian email is required to register under age ${MINOR_CONSENT_AGE_THRESHOLD}.`);
      return;
    }

    try {
      const res = await registerMutation.mutateAsync({
        data: { name, email, password, dataConsent, trainingConsent, dateOfBirth, parentGuardianEmail: isMinor ? parentGuardianEmail : undefined, privacyPolicyVersion: PRIVACY_POLICY.version },
      });
      if (res.devParentConsentLink) {
        // Account was created but is gated pending parent/guardian
        // confirmation — don't route to /enroll, the account can't use
        // protected features yet regardless.
        setDevParentConsentLink(res.devParentConsentLink);
        return;
      }
      await refetchUser();
      setLocation('/enroll');
    } catch (err: any) {
      setError(err?.data?.error || 'Registration sequence failed.');
    }
  };

  if (devParentConsentLink) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center">
        <div className="mb-8 flex flex-col items-center">
          <UsersIcon className="w-10 h-10 text-primary mb-4" />
          <h1 className="font-mono text-2xl tracking-widest uppercase text-foreground">Parental Consent Required</h1>
        </div>
        <Card className="w-full max-w-md relative overflow-hidden border-t-2 border-t-primary">
          <div className="space-y-4 text-center">
            <p className="font-mono text-sm text-foreground">
              Account created for {email}, but it can't be used yet. We've sent a confirmation link to{' '}
              <span className="text-primary">{parentGuardianEmail}</span> — the account activates once your
              parent or guardian confirms.
            </p>
            <div className="border border-primary/20 bg-primary/5 p-3 text-left">
              <p className="font-mono text-[10px] uppercase tracking-wider text-primary mb-1">Dev mode — no mail server configured</p>
              <Link href={devParentConsentLink}>
                <span className="text-xs font-mono text-primary underline break-all cursor-pointer" data-testid="link-dev-parent-consent">
                  {devParentConsentLink}
                </span>
              </Link>
            </div>
            <Link href="/">
              <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                Return to Authentication
              </span>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center">
      <div className="mb-8 flex flex-col items-center">
        <Shield className="w-10 h-10 text-primary mb-4" />
        <h1 className="font-mono text-2xl tracking-widest uppercase text-foreground">New Operator Onboarding</h1>
      </div>

      <Card className="w-full max-w-md relative overflow-hidden border-t-2 border-t-primary">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Designation (Name)</Label>
              <Input 
                id="name" 
                required 
                value={name}
                onChange={e => setName(e.target.value)}
                data-testid="input-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Operator ID (Email)</Label>
              <Input 
                id="email" 
                type="email" 
                required 
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Passkey</Label>
              <Input 
                id="password" 
                type="password" 
                required
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                data-testid="input-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Passkey</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                data-testid="input-confirm-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">Date of Birth</Label>
              <Input
                id="dateOfBirth"
                type="date"
                required
                max={new Date().toISOString().slice(0, 10)}
                value={dateOfBirth}
                onChange={e => setDateOfBirth(e.target.value)}
                data-testid="input-date-of-birth"
              />
            </div>
            {isMinor && (
              <div className="space-y-2 border border-primary/20 bg-primary/5 p-3">
                <Label htmlFor="parentGuardianEmail" className="text-primary">Parent / Guardian Email</Label>
                <p className="text-[11px] font-mono text-muted-foreground leading-snug">
                  Accounts under {MINOR_CONSENT_AGE_THRESHOLD} require a parent or guardian to confirm before the
                  account can be used.
                </p>
                <Input
                  id="parentGuardianEmail"
                  type="email"
                  required
                  value={parentGuardianEmail}
                  onChange={e => setParentGuardianEmail(e.target.value)}
                  data-testid="input-parent-guardian-email"
                />
              </div>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="dataConsent"
              checked={dataConsent}
              onCheckedChange={(checked) => setDataConsent(checked === true)}
              data-testid="checkbox-data-consent"
            />
            <Label htmlFor="dataConsent" className="text-xs font-normal leading-snug text-muted-foreground">
              I consent to my account and profile data being processed and stored for the purposes of this
              application. I understand I can request deletion of my account at any time.
            </Label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="trainingConsent"
              checked={trainingConsent}
              onCheckedChange={(checked) => setTrainingConsent(checked === true)}
              data-testid="checkbox-training-consent"
            />
            <Label htmlFor="trainingConsent" className="text-xs font-normal leading-snug text-muted-foreground">
              Optional — allow my activity (which actions I take, never what I upload) to contribute to the
              app's behavior-suggestion model. Unrelated to the consent above; leaving this unchecked doesn't
              affect anything else. Changeable any time in Settings.
            </Label>
          </div>

          <p className="text-xs text-muted-foreground leading-snug" data-testid="register-privacy-notice">
            Before you create an account, read our{' '}
            <Link href="/privacy"><span className="text-primary underline underline-offset-2 cursor-pointer">Privacy Policy</span></Link>:
            what we collect, where it is stored (in the United States), and how to download or delete it. This is a student
            proof of concept, so please use test details rather than your real information.
          </p>

          {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

          <Button
            type="submit"
            className="w-full"
            isLoading={registerMutation.isPending}
            disabled={!dataConsent}
            data-testid="button-register"
          >
            Issue Clearance
          </Button>
          
          <div className="text-center pt-4 border-t border-border">
            <Link href="/">
              <span className="text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer uppercase tracking-wider">
                Return to Authentication
              </span>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
