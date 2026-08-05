/**
 * PasskeyManager
 *
 * Lets a logged-in operator register new passkeys and remove existing ones.
 * Each passkey is a cryptographic key pair; the private key never leaves the device.
 * The biometric (Face ID / Touch ID / Windows Hello) only unlocks the local private key.
 *
 * Drop this anywhere inside an authenticated layout.
 */
import React, { useState } from 'react';
import { KeyRound, Trash2, PlusCircle, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import {
  useListPasskeys,
  useWebauthnRegisterOptions,
  useWebauthnRegisterVerify,
  useDeletePasskey,
} from '@workspace/api-client-react';
import { Button, Input, Label } from './ui';

export function PasskeyManager() {
  const [label, setLabel] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: passkeys, refetch, isLoading } = useListPasskeys();
  const registerOptionsMutation = useWebauthnRegisterOptions();
  const registerVerifyMutation = useWebauthnRegisterVerify();
  const deletePasskeyMutation = useDeletePasskey();

  const handleRegister = async () => {
    setError('');
    setSuccess('');
    setRegistering(true);
    try {
      // Step 1 — get creation options (challenge, rp info, user info)
      const options = await registerOptionsMutation.mutateAsync();

      // Step 2 — browser shows native biometric registration dialog.
      // The device creates a key pair in the secure enclave; the private key
      // never leaves the device. Only the public key + signed challenge come back.
      let regResponse;
      try {
        regResponse = await startRegistration({ optionsJSON: options as any });
      } catch (browserErr: any) {
        if (browserErr?.name === 'NotAllowedError') {
          setError('Passkey prompt dismissed. Make sure you allow the browser to use biometrics.');
        } else if (browserErr?.name === 'SecurityError') {
          setError('Passkeys require a top-level browser tab — open the app outside of an embedded preview.');
        } else if (browserErr?.name === 'InvalidStateError') {
          setError('A passkey for this account already exists on this device.');
        } else {
          setError(browserErr?.message || 'Device rejected the passkey registration.');
        }
        return;
      }

      // Step 3 — server verifies the signed challenge and stores the public key
      await registerVerifyMutation.mutateAsync({
        data: {
          response: regResponse as any,
          label: label.trim() || 'Passkey',
        },
      });

      setLabel('');
      setSuccess('Passkey registered successfully. You can now sign in without a password.');
      await refetch();
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Registration failed.');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError('');
    try {
      await deletePasskeyMutation.mutateAsync({ id });
      await refetch();
    } catch {
      setError('Failed to remove passkey.');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <KeyRound className="w-5 h-5 text-primary" />
        <div>
          <h3 className="font-mono text-sm uppercase tracking-widest font-bold">Passkeys</h3>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            Device biometrics — private key never leaves your device
          </p>
        </div>
      </div>

      {/* Security explanation */}
      <div className="border border-primary/20 bg-primary/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
            Why passkeys are stronger than face scan
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground leading-relaxed">
          Face scan sends a mathematical descriptor over the network — a hacked client can fake it.
          A passkey stores a private key in the device's secure enclave. The biometric only unlocks
          that key locally; what reaches the server is a cryptographic signature, not biometric data.
          The server verifies the signature with your public key — no secret ever travels.
        </p>
      </div>

      {/* Existing passkeys */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground font-mono text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading passkeys…
        </div>
      ) : passkeys && passkeys.length > 0 ? (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Registered passkeys
          </p>
          {passkeys.map((pk) => (
            <div
              key={pk.id}
              className="flex items-center justify-between border border-border bg-secondary/30 px-3 py-2"
            >
              <div className="space-y-0.5">
                <p className="font-mono text-sm font-medium">{pk.label}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  Registered {formatDate(pk.createdAt)}
                  {pk.lastUsedAt && ` · Last used ${formatDate(pk.lastUsedAt)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDelete(pk.id)}
                disabled={deletePasskeyMutation.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-mono text-xs text-muted-foreground">
          No passkeys registered yet. Add one below.
        </p>
      )}

      {/* Register new passkey */}
      <div className="border-t border-border pt-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Register new passkey
        </p>
        <div className="space-y-2">
          <Label htmlFor="passkey-label">Passkey label (optional)</Label>
          <Input
            id="passkey-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="MacBook Touch ID"
            className="font-mono text-sm"
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            A name to help you recognise this device later.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p className="font-mono text-xs">{error}</p>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 text-green-400">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <p className="font-mono text-xs">{success}</p>
          </div>
        )}

        <Button
          onClick={handleRegister}
          disabled={registering}
          className="w-full font-mono text-xs tracking-wider"
        >
          {registering ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Waiting for device…
            </>
          ) : (
            <>
              <PlusCircle className="w-4 h-4 mr-2" />
              Register Passkey
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
