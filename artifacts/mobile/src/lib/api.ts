import CookieManager from '@react-native-cookies/cookies';
import { API_BASE_URL, APP_ORIGIN } from '../config';

// React Native's fetch (backed by the native HTTP stack on both platforms)
// persists and replays cookies automatically, same as a browser — so the
// session cookie set by POST /auth/login is sent back on every later
// request without any extra work here. The one thing a browser's fetch
// does that this doesn't is read a non-httpOnly cookie's value into JS
// (there's no `document.cookie` in React Native) — CookieManager.get()
// below is the equivalent, used only to read the CSRF token back out.
async function csrfHeader(): Promise<Record<string, string>> {
  const cookies = await CookieManager.get(API_BASE_URL);
  const token = cookies['csrf_token']?.value;
  return token ? { 'X-CSRF-Token': token } : {};
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const isMutating = method !== 'GET' && method !== 'HEAD';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: APP_ORIGIN,
    ...(isMutating ? await csrfHeader() : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface AppUser {
  id: number;
  email: string;
  name: string;
  role: string;
  faceEnrolled: boolean;
  passkeyEnrolled: boolean;
  dataConsentGiven: boolean;
  biometricConsentGiven: boolean;
  subscriptionPlan: string;
}

export interface LoginResult {
  requiresFaceVerification: boolean;
  faceAvailable: boolean;
  passkeyAvailable: boolean;
  tempToken: string | null;
  user: AppUser;
}

// GET /auth/me first, before login/register, to make sure the CSRF cookie
// exists — the mutating request right after it would otherwise have
// nothing to echo back.
export async function primeCsrfCookie(): Promise<void> {
  await request('/auth/me').catch(() => {});
}

export async function register(email: string, name: string, password: string): Promise<{ user: AppUser }> {
  return request('/auth/register', { method: 'POST', body: { email, name, password, dataConsent: true } });
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return request('/auth/login', { method: 'POST', body: { email, password } });
}

export async function getMe(): Promise<AppUser | null> {
  try {
    return await request<AppUser>('/auth/me');
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
}

export async function logoutAll(): Promise<{ terminatedSessions: number }> {
  return request('/auth/logout-all', { method: 'POST' });
}

export async function getDashboard(): Promise<SecurityDashboard> {
  return request('/security/dashboard');
}

export interface SecurityDashboard {
  totalUsers: number;
  faceEnrolledUsers: number;
  activeSessionsCount: number;
  loginAttempts24h: number;
  failedLogins24h: number;
  threatsDetected: number;
  recentLogs: SecurityLog[];
}

export interface SecurityLog {
  id: number;
  userId: number | null;
  userEmail: string | null;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  details: string;
  timestamp: string;
}

export interface LogChainVerification {
  intact: boolean;
  rowsChecked: number;
  brokenAtId: number | null;
  reason: string | null;
}

export async function listSecurityLogs(filters?: {
  eventType?: string;
  userEmail?: string;
  ipAddress?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<SecurityLog[]> {
  const params = new URLSearchParams();
  if (filters?.eventType) params.set('eventType', filters.eventType);
  if (filters?.userEmail) params.set('userEmail', filters.userEmail);
  if (filters?.ipAddress) params.set('ipAddress', filters.ipAddress);
  if (filters?.fromDate) params.set('fromDate', filters.fromDate);
  if (filters?.toDate) params.set('toDate', filters.toDate);
  const qs = params.toString();
  return request(`/security/logs${qs ? `?${qs}` : ''}`);
}

export async function verifyLogIntegrity(): Promise<LogChainVerification> {
  return request('/security/logs/verify');
}

export interface Threat {
  id: number;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  plainSummary: string | null;
  timestamp: string;
  status: 'active' | 'mitigated' | 'resolved';
  affectedUsers: number | null;
}

export async function listThreats(): Promise<Threat[]> {
  return request('/security/threats');
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin' | 'security_analyst' | 'it_support';
  faceEnrolled: boolean;
  passkeyEnrolled: boolean;
  dataConsentGiven: boolean;
  biometricConsentGiven: boolean;
  subscriptionPlan: string;
  createdAt: string;
  updatedAt: string | null;
}

export async function listUsers(): Promise<StaffUser[]> {
  return request('/users');
}

export async function updateUserRole(id: number, role: StaffUser['role']): Promise<StaffUser> {
  return request(`/users/${id}`, { method: 'PATCH', body: { role } });
}

export async function deleteUser(id: number, password?: string): Promise<void> {
  await request(`/users/${id}`, { method: 'DELETE', body: password ? { password } : undefined });
}

export async function resetUserMfa(id: number): Promise<StaffUser> {
  return request(`/users/${id}/reset-mfa`, { method: 'POST' });
}

export async function staffResetPassword(id: number): Promise<{ message: string; devResetLink: string | null }> {
  return request(`/users/${id}/reset-password`, { method: 'POST' });
}

export interface Payment {
  id: number;
  userId: number | null;
  userEmail: string | null;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  description: string;
  providerToken: string;
  createdAt: string;
}

export interface Plan {
  id: 'plus' | 'pro' | 'team';
  name: string;
  amount: number;
  currency: string;
  interval: string;
  description: string;
  features: string[];
}

export async function listPayments(): Promise<Payment[]> {
  return request('/payments');
}

export async function listPlans(): Promise<Plan[]> {
  return request('/payments/plans');
}

export async function createPayment(amount: number, currency: string, description: string): Promise<Payment> {
  return request('/payments', { method: 'POST', body: { amount, currency, description } });
}

export async function subscribe(planId: Plan['id']): Promise<{ payment: Payment; subscriptionPlan: string }> {
  return request('/payments/subscribe', { method: 'POST', body: { planId } });
}

export { request };
