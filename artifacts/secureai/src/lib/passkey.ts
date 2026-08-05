import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

const API = '/api/auth/passkey';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export interface PasskeyInfo {
  id: number;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const res = await fetch(`${API}/list`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to load passkeys');
  return res.json();
}

export async function deletePasskey(id: number): Promise<void> {
  const res = await fetch(`${API}/${id}`, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error('Failed to remove passkey');
}

/** Enroll a new passkey — the browser/OS biometric unlocks a device-held key. */
export async function enrollPasskey(deviceName?: string): Promise<void> {
  const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/register-options');
  const attestation = await startRegistration({ optionsJSON: options });
  await post('/register-verify', { response: attestation, deviceName });
}

/** Complete login MFA by signing the server's challenge with the device key. */
export async function loginWithPasskey(): Promise<{ verified: boolean }> {
  const options = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/login-options');
  const assertion = await startAuthentication({ optionsJSON: options });
  return post('/login-verify', { response: assertion });
}

/** True if the pending-login user has passkeys available (404 = none). */
export async function passkeyLoginAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/login-options`, {
      method: 'POST',
      credentials: 'include',
    });
    // We only probe availability; a 200 also stores a challenge which is fine —
    // loginWithPasskey requests fresh options anyway.
    return res.ok;
  } catch {
    return false;
  }
}
