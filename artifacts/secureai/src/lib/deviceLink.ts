const API = '/api/auth/biometric-key';

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

export interface LinkCode {
  code: string;
  expiresAt: number;
}

/** Mints a short-lived, single-use code a new device (e.g. the mobile app)
 *  can redeem to enroll its own biometric key and sign in — without that
 *  new device needing to satisfy MFA on its own first. Only callable from
 *  an already fully-authenticated session, which is the entire security
 *  basis for the redeem step being unauthenticated on the other end. */
export async function createDeviceLinkCode(): Promise<LinkCode> {
  const res = await fetch(`${API}/create-link-code`, {
    method: 'POST',
    credentials: 'include',
    headers: mutatingHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'Failed to generate a link code');
  }
  return res.json();
}
