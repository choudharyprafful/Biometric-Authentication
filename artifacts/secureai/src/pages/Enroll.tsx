import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '../contexts/AuthContext';
import { useEnrollFace, useRemoveFace, useLogoutAllDevices, useDeleteUser, getGetCurrentUserQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, Button, Label, Input } from '../components/ui';
import { Checkbox } from '../components/ui/checkbox';
import { ScanFace, CheckCircle2, ChevronRight, KeyRound, Trash2, ShieldCheck, RefreshCw, Settings, LogOut, AlertTriangle, Smartphone } from 'lucide-react';
import { FaceCamera } from '../components/FaceCamera';
import { enrollPasskey, listPasskeys, deletePasskey, type PasskeyInfo } from '../lib/passkey';
import { createDeviceLinkCode } from '../lib/deviceLink';

function PasskeySection({ onEnrolled }: { onEnrolled?: () => void }) {
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
      onEnrolled?.();
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
    <div className="space-y-4">
      <p className="text-sm font-mono text-muted-foreground">
        Your device biometric (Face ID / fingerprint / PIN) unlocks a secret key that never
        leaves the device. The key signs a one-time challenge from the server — that
        signature is the real second factor, so a hacked client can't fake it.
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

      <Button onClick={handleAdd} isLoading={busy} data-testid="button-add-passkey">
        <KeyRound className="w-4 h-4 mr-2" />
        {passkeys.length > 0 ? 'Add another passkey' : 'Register this device'}
      </Button>
    </div>
  );
}

function LinkDeviceSection() {
  const [linkCode, setLinkCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!linkCode) return;
    const tick = () => setRemainingSeconds(Math.max(0, Math.round((linkCode.expiresAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [linkCode]);

  const handleGenerate = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await createDeviceLinkCode();
      setLinkCode(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate a link code.');
    } finally {
      setBusy(false);
    }
  };

  const expired = linkCode !== null && remainingSeconds <= 0;

  return (
    <div className="space-y-4">
      <p className="text-sm font-mono text-muted-foreground">
        Generate a short-lived code here, then enter it in the SecureAI mobile app (Login → "Link this
        device") to enroll that device's biometric key on this account — without the mobile app needing
        to pass face verification, which it has no way to do.
      </p>

      {linkCode && !expired && (
        <div className="border border-primary/40 bg-primary/5 p-4 text-center space-y-1">
          <p className="font-mono text-3xl tracking-[0.3em] text-primary">{linkCode.code}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Expires in {remainingSeconds}s — single use
          </p>
        </div>
      )}
      {expired && (
        <p className="font-mono text-xs uppercase tracking-wider text-destructive">
          Code expired — generate a new one.
        </p>
      )}

      {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}

      <Button onClick={handleGenerate} isLoading={busy} data-testid="button-generate-link-code">
        <Smartphone className="w-4 h-4 mr-2" />
        {linkCode ? 'Generate New Code' : 'Generate Link Code'}
      </Button>
    </div>
  );
}

type Mode = 'face' | 'passkey' | 'settings';

export default function Enroll() {
  const { user, refetchUser } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const enrollMutation = useEnrollFace();
  const removeFaceMutation = useRemoveFace();
  const logoutAllMutation = useLogoutAllDevices();
  const deleteAccountMutation = useDeleteUser();
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 'face' then 'passkey' for a not-yet-fully-enrolled account; 'settings'
  // once both are done and the page is visited to manage/re-enroll.
  const [mode, setMode] = useState<Mode>(() => {
    if (!user?.faceEnrolled) return 'face';
    if (!user?.passkeyEnrolled) return 'passkey';
    return 'settings';
  });
  const [reEnrollingFace, setReEnrollingFace] = useState(false);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [descriptor, setDescriptor] = useState<number[] | null>(null);
  const [error, setError] = useState('');
  const [biometricConsent, setBiometricConsent] = useState(false);

  if (!user) return null;

  const handleCapture = (capturedDescriptor: number[]) => {
    setDescriptor(capturedDescriptor);
    setStep(3);
  };

  const handleConfirm = async () => {
    if (!descriptor) return;
    setError('');

    try {
      // Re-enrolling just overwrites the stored descriptor via the same call.
      await enrollMutation.mutateAsync({ id: user.id, data: { descriptor, consent: biometricConsent } });
      await refetchUser();
      if (reEnrollingFace) {
        setReEnrollingFace(false);
        setStep(1);
        setDescriptor(null);
      } else if (user.passkeyEnrolled) {
        setMode('settings');
      } else {
        // Face alone already satisfies MFA (face OR passkey) — passkey is
        // offered next as an optional stronger factor, not forced.
        setLocation('/dashboard');
      }
    } catch (err: any) {
      setError(err?.data?.error || 'Failed to save biometric profile.');
    }
  };

  const handlePasskeyEnrolled = async () => {
    await refetchUser();
    if (mode === 'passkey') {
      setLocation('/dashboard');
    }
  };

  // Withdrawing consent deletes the descriptor server-side (DELETE
  // /users/:id/face) and blocks access again until re-enrolled.
  const handleWithdrawConsent = async () => {
    setError('');
    try {
      await removeFaceMutation.mutateAsync({ id: user.id });
      await refetchUser();
      setBiometricConsent(false);
      setDescriptor(null);
      setStep(1);
      setReEnrollingFace(false);
      setMode('face');
    } catch (err: any) {
      setError(err?.data?.error || 'Failed to withdraw consent / delete biometric data.');
    }
  };

  const handleLogoutAll = async () => {
    if (!confirm('Sign out of every device, including this one? Anyone currently using a session on another device will be logged out too.')) return;
    setError('');
    try {
      await logoutAllMutation.mutateAsync();
    } catch (err: any) {
      setError(err?.data?.error || 'Failed to sign out of all devices.');
      return;
    }
    queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
    queryClient.removeQueries({ queryKey: getGetCurrentUserQueryKey() });
    setLocation('/');
  };

  // Server re-verifies the password before deleting (routes/users.ts).
  const handleDeleteAccount = async () => {
    setDeleteError('');
    try {
      await deleteAccountMutation.mutateAsync({ id: user.id, data: { password: deletePassword } });
    } catch (err: any) {
      setDeleteError(err?.data?.error || 'Incorrect password.');
      return;
    }
    queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
    queryClient.removeQueries({ queryKey: getGetCurrentUserQueryKey() });
    setLocation('/');
  };

  // ---- Settings mode: both factors already enrolled, visited voluntarily ----
  if (mode === 'settings' && !reEnrollingFace) {
    return (
      <div className="max-w-3xl mx-auto py-12 space-y-6">
        <div>
          <h1 className="font-mono text-3xl font-bold uppercase tracking-widest text-foreground flex items-center gap-4">
            <Settings className="w-8 h-8 text-primary" />
            Security Settings
          </h1>
          <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-wider">
            Manage biometric factors for operator {user.name}
          </p>
        </div>

        <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <ScanFace className="w-5 h-5 text-primary" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Face Biometric</h2>
          </div>
          <p className="text-sm font-mono text-green-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Enrolled
          </p>
          <p className="text-sm font-mono text-muted-foreground">
            Re-enrolling replaces your stored facial signature — useful if lighting, a new
            camera, or a hairstyle/glasses change is causing verification mismatches.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => { setReEnrollingFace(true); setStep(1); setDescriptor(null); setError(''); }}
              data-testid="button-reenroll-face"
            >
              <RefreshCw className="w-4 h-4 mr-2" /> Re-enroll Face
            </Button>
            <Button
              variant="destructive"
              onClick={handleWithdrawConsent}
              isLoading={removeFaceMutation.isPending}
              data-testid="button-withdraw-biometric-consent"
            >
              <Trash2 className="w-4 h-4 mr-2" /> Withdraw Consent &amp; Delete Face Data
            </Button>
          </div>
          <p className="text-xs font-mono text-muted-foreground/80">
            Withdrawing permanently deletes your stored facial template and blocks access to the
            app again until you consent and re-enroll — mandatory MFA can't be bypassed by
            withdrawing one factor.
          </p>
          {error && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{error}</p>}
        </Card>

        <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <KeyRound className="w-5 h-5 text-primary" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Device Passkeys</h2>
          </div>
          <PasskeySection />
        </Card>

        <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-4">
            <Smartphone className="w-5 h-5 text-primary" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Link Mobile Device</h2>
          </div>
          <LinkDeviceSection />
        </Card>

        <Card className="border-t-4 border-t-destructive bg-card/50 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <LogOut className="w-5 h-5 text-destructive" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Active Sessions</h2>
          </div>
          <p className="text-sm font-mono text-muted-foreground">
            If you lose a device while still logged in, this is how you cut it off — it terminates
            every session for this account across every device, not just the one you're on.
          </p>
          <Button
            variant="destructive"
            onClick={handleLogoutAll}
            isLoading={logoutAllMutation.isPending}
            data-testid="button-logout-all"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign Out of All Devices
          </Button>
        </Card>

        <Card className="border-t-4 border-t-destructive bg-card/50 backdrop-blur-sm space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            <h2 className="font-mono font-bold uppercase tracking-widest text-foreground">Danger Zone</h2>
          </div>
          <p className="text-sm font-mono text-muted-foreground">
            Permanently deletes your account, face enrollment, and passkeys. Your payment and audit
            history is retained (not tied back to you by name) rather than erased — this is standard
            financial/audit-retention practice, not a bug.
          </p>

          {!confirmingDelete ? (
            <Button
              variant="destructive"
              onClick={() => { setConfirmingDelete(true); setDeleteError(''); }}
              data-testid="button-open-delete-account"
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete My Account
            </Button>
          ) : (
            <div className="space-y-3 max-w-sm">
              <Label htmlFor="deleteConfirmPassword" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Re-enter your password to confirm — this can't be undone
              </Label>
              <Input
                id="deleteConfirmPassword"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                data-testid="input-delete-confirm-password"
                autoFocus
              />
              {deleteError && <p className="text-destructive font-mono text-xs uppercase tracking-wider">{deleteError}</p>}
              <div className="flex gap-3">
                <Button
                  variant="ghost"
                  onClick={() => { setConfirmingDelete(false); setDeletePassword(''); setDeleteError(''); }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  isLoading={deleteAccountMutation.isPending}
                  disabled={!deletePassword}
                  data-testid="button-confirm-delete-account"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Permanently Delete
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div className="flex justify-center">
          <Button variant="ghost" onClick={() => setLocation('/dashboard')}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  if (mode === 'passkey' && !reEnrollingFace) {
    return (
      <div className="max-w-3xl mx-auto py-12">
        <div className="mb-8">
          <h1 className="font-mono text-3xl font-bold uppercase tracking-widest text-foreground flex items-center gap-4">
            <KeyRound className="w-8 h-8 text-primary" />
            Device Passkey Required
          </h1>
          <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-wider">
            Second mandatory factor for operator {user.name}
          </p>
        </div>

        <Card className="border-t-4 border-t-primary bg-card/50 backdrop-blur-sm space-y-6">
          <div className="border border-destructive/40 bg-destructive/5 p-3 inline-block text-left">
            <p className="font-mono text-xs text-destructive uppercase tracking-wider">
              Mandatory — a face scan alone doesn't sign a server challenge. Access is blocked until a passkey is registered too.
            </p>
          </div>
          <PasskeySection onEnrolled={handlePasskeyEnrolled} />
        </Card>
      </div>
    );
  }

  // ---- Face capture wizard: used for first-time mandatory enrollment AND
  // voluntary re-enrollment from settings mode. ----
  return (
    <div className="max-w-3xl mx-auto py-12">
      <div className="mb-8">
        <h1 className="font-mono text-3xl font-bold uppercase tracking-widest text-foreground flex items-center gap-4">
          <ScanFace className="w-8 h-8 text-primary" />
          {reEnrollingFace ? 'Re-enroll Face' : 'Biometric Enrollment'}
        </h1>
        <p className="font-mono text-sm text-muted-foreground mt-2 uppercase tracking-wider">
          {reEnrollingFace ? `Replacing stored facial signature for ${user.name}` : `Multi-factor security protocol setup for operator ${user.name}`}
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
            <h2 className="text-xl font-mono uppercase tracking-widest">
              {reEnrollingFace ? 'Recapture Facial Signature' : 'Biometric Enrollment Required'}
            </h2>
            <p className="text-muted-foreground font-mono max-w-lg mx-auto">
              SecureAI requires facial biometrics for multi-factor authentication.
              The system will capture a mathematical map of your face.
              No visual image is stored.
            </p>

            {!reEnrollingFace && (
              <div className="border border-destructive/40 bg-destructive/5 p-3 inline-block text-left mt-2">
                <p className="font-mono text-xs text-destructive uppercase tracking-wider">
                  Mandatory — access is blocked until enrollment is complete. A device passkey is required next.
                </p>
              </div>
            )}

            <div className="bg-primary/5 border border-primary/20 p-4 inline-block text-left mt-4">
              <ul className="text-sm font-mono text-muted-foreground space-y-2 list-disc pl-4">
                <li>Ensure good lighting</li>
                <li>Face the camera directly</li>
                <li>Remove sunglasses or masks</li>
              </ul>
            </div>

            <div className="flex items-start gap-2 max-w-lg mx-auto text-left border border-primary/20 bg-primary/5 p-4 mt-4">
              <Checkbox
                id="biometricConsent"
                checked={biometricConsent}
                onCheckedChange={(checked) => setBiometricConsent(checked === true)}
                data-testid="checkbox-biometric-consent"
              />
              <Label htmlFor="biometricConsent" className="text-xs font-mono font-normal leading-snug text-muted-foreground">
                I consent to my face being captured and stored as an encrypted biometric template
                for authentication purposes, separately from my general account data. I understand
                I can withdraw this consent at any time, which permanently deletes the stored
                template (Security Settings → Re-enroll Face flow).
              </Label>
            </div>

            <div className="flex justify-center gap-4 mt-8">
              {reEnrollingFace && (
                <Button variant="ghost" onClick={() => { setReEnrollingFace(false); setError(''); }}>
                  Cancel
                </Button>
              )}
              <Button onClick={() => setStep(2)} disabled={!biometricConsent}>
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
              {reEnrollingFace
                ? 'New facial map generated successfully. Commit to replace your stored signature.'
                : 'Facial map generated successfully. Commit this signature, then register a device passkey to finish.'}
            </p>

            {error && <p className="text-destructive font-mono text-sm">{error}</p>}

            <div className="flex justify-center gap-4 mt-8">
              <Button variant="outline" onClick={() => setStep(2)} disabled={enrollMutation.isPending}>
                Recapture
              </Button>
              <Button onClick={handleConfirm} isLoading={enrollMutation.isPending}>
                <ShieldCheck className="w-4 h-4 mr-2" /> Commit &amp; {reEnrollingFace ? 'Save' : 'Continue'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
