import ReactNativeBiometrics from 'react-native-biometrics';
import { request, type AppUser } from './api';

// Device-native biometric second factor, using Android Keystore + BiometricPrompt
// directly instead of WebAuthn/passkeys. Chosen specifically because native passkey
// ceremonies require Digital Asset Links domain verification against a real, owned
// domain — something no local dev tunnel can ever satisfy (see README.md, "Why a
// full passkey ceremony can't be completed against a tunnel domain"). Keystore key
// generation + BiometricPrompt-gated signing has no such requirement, but still
// satisfies the brief's actual security property: "the biometric unlocks a secret
// key on the device that signs a challenge from the server; the biometric never
// leaves the device." allowDeviceCredentials is left false — only a real biometric
// (fingerprint/face) unlocks the key, not a PIN/pattern fallback, matching the
// same "gate a crypto operation with a real biometric" intent as the passkey path
// it replaces.
const biometrics = new ReactNativeBiometrics({ allowDeviceCredentials: false });

export async function isBiometricSupported(): Promise<boolean> {
  const { available } = await biometrics.isSensorAvailable();
  return available;
}

export async function enrollBiometricKey(deviceName?: string): Promise<void> {
  const { challenge } = await request<{ challenge: string }>('/auth/biometric-key/register-challenge', { method: 'POST' });

  // A fresh key pair every enrollment — deleteKeys() first in case a stale
  // key from an earlier attempt is still in the Keystore, which would make
  // createKeys() return that old (already-registered-or-abandoned) key
  // instead of generating a new one.
  await biometrics.deleteKeys().catch(() => {});
  const { publicKey } = await biometrics.createKeys();

  const { success, signature } = await biometrics.createSignature({
    promptMessage: 'Confirm your biometric to enroll',
    payload: challenge,
  });
  if (!success || !signature) throw new Error('Biometric enrollment was cancelled or failed');

  await request('/auth/biometric-key/register', { method: 'POST', body: { publicKey, signature, deviceName } });
}

export async function loginWithBiometricKey(): Promise<{ verified: boolean }> {
  const { challenge } = await request<{ challenge: string }>('/auth/biometric-key/login-options', { method: 'POST' });

  const { success, signature } = await biometrics.createSignature({
    promptMessage: 'Confirm your biometric to sign in',
    payload: challenge,
  });
  if (!success || !signature) throw new Error('Biometric verification was cancelled or failed');

  return request('/auth/biometric-key/login-verify', { method: 'POST', body: { signature } });
}

// Bootstraps this device onto an account that was enrolled elsewhere (e.g.
// web, with face or a passkey) and has no biometric key on THIS device yet —
// normal login can't get past MFA in that case, since mobile has no way to
// satisfy a factor it doesn't hold. `code` comes from that other, already-
// authenticated session (Security Settings → "Link Mobile Device" on web).
// The code itself is the signed payload: it's random, single-use, and the
// server already treats it as consumed the moment it's looked up, so there's
// no separate challenge round-trip needed the way enroll/login have.
export async function linkDeviceWithCode(code: string, deviceName?: string): Promise<{ verified: boolean; user: AppUser }> {
  await biometrics.deleteKeys().catch(() => {});
  const { publicKey } = await biometrics.createKeys();

  const { success, signature } = await biometrics.createSignature({
    promptMessage: 'Confirm your biometric to link this device',
    payload: code,
  });
  if (!success || !signature) throw new Error('Device linking was cancelled or failed');

  return request('/auth/biometric-key/redeem-link-code', {
    method: 'POST',
    body: { code, publicKey, signature, deviceName },
  });
}
