// The sign-in risk check's warning arrives with the password step, but the person only reaches the
// dashboard after MFA, so it is carried across in sessionStorage (this tab only) and shown once there.
// Storage can be unavailable (private windows, blocked site data); the warning is advisory, so that is
// silently tolerated rather than breaking sign-in.
const KEY = 'secureai.securityNotice';

export function rememberSecurityNotice(notice: string | null | undefined): void {
  try {
    if (notice) sessionStorage.setItem(KEY, notice);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable
  }
}

export function readSecurityNotice(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearSecurityNotice(): void {
  rememberSecurityNotice(null);
}
