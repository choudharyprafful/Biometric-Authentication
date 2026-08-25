import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type { User } from '@workspace/api-client-react';

const API = '/api/auth/passkey';

/** Double-submit CSRF: echo the cookie value back as a header so the API
 *  knows this call came from same-origin JS, not a forged cross-site request. */
function readCsrfCookie(): string | null {
  const match = /(?:^|;\s*)csrf_token=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function mutatingHeaders(): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const csrfToken = readCsrfCookie();
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

async function postTo<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: mutatingHeaders(),
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

function post<T>(path: string, body?: unknown): Promise<T> {
  return postTo<T>(`${API}${path}`, body);
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
  const res = await fetch(`${API}/${id}`, { method: 'DELETE', credentials: 'include', headers: mutatingHeaders() });
  if (!res.ok) throw new Error('Failed to remove passkey');
}

/** Enroll a new passkey — the browser/OS biometric unlocks a device-held key. */
export async function enrollPasskey(deviceName?: string): Promise<void> {
  const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/register-options');
  const attestation = await startRegistration({ optionsJSON: options });
  await post('/register-verify', { response: attestation, deviceName });
}

/** Complete login MFA by signing the server's challenge with the device key. */
export async function loginWithPasskey(): Promise<{ verified: boolean; user: User }> {
  const options = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/login-options');
  const assertion = await startAuthentication({ optionsJSON: options });
  return post('/login-verify', { response: assertion });
}

/** Complete a password reset by signing the server's challenge with the
 *  account's device-held passkey — same crypto proof as login MFA, gated
 *  on a valid reset token rather than an authenticated session. */
export async function resetPasswordWithPasskey(token: string, newPassword: string): Promise<{ success: boolean }> {
  const options = await postTo<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
    '/api/auth/reset-password/passkey-options',
    { token },
  );
  const assertion = await startAuthentication({ optionsJSON: options });
  return postTo('/api/auth/reset-password/passkey-verify', { response: assertion, newPassword });
}

/** True if the pending-login user has passkeys available (404 = none). */
export async function passkeyLoginAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/login-options`, {
      method: 'POST',
      credentials: 'include',
      headers: mutatingHeaders(),
    });
    // We only probe availability; a 200 also stores a challenge which is fine —
    // loginWithPasskey requests fresh options anyway.
    return res.ok;
  } catch {
    return false;
  }
}
