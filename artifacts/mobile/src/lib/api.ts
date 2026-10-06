import CookieManager from "@react-native-cookies/cookies";
import { API_BASE_URL, APP_ORIGIN } from "../config";

// React Native's fetch (backed by the native HTTP stack on both platforms)
// persists and replays cookies automatically, same as a browser — so the
// session cookie set by POST /auth/login is sent back on every later
// request without any extra work here. The one thing a browser's fetch
// does that this doesn't is read a non-httpOnly cookie's value into JS
// (there's no `document.cookie` in React Native) — CookieManager.get()
// below is the equivalent, used only to read the CSRF token back out.
async function csrfHeader(): Promise<Record<string, string>> {
  const cookies = await CookieManager.get(API_BASE_URL);
  const token = cookies["csrf_token"]?.value;
  return token ? { "X-CSRF-Token": token } : {};
}

async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    // "text" for a response that isn't JSON (the readable data export is a web page).
    responseType?: "json" | "text";
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const isMutating = method !== "GET" && method !== "HEAD";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: APP_ORIGIN,
    // Caller-supplied headers (e.g. Idempotency-Key) go BEFORE the CSRF
    // header, not after. Later spreads win, so putting them last would let
    // any caller overwrite the CSRF token — or Origin — with a value of its
    // own choosing. Ordering is the whole control here.
    ...(options.headers ?? {}),
    ...(isMutating ? await csrfHeader() : {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(
      (data as { error?: string }).error || `Request failed (${res.status})`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (
    options.responseType === "text" ? res.text() : res.json()
  ) as Promise<T>;
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
  parentConsentPending: boolean;
  trainingConsentGiven: boolean;
  contentPersonalizationConsentGiven: boolean;
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
  await request("/auth/me").catch(() => {});
}

// Every consent is whatever the person ticked on the sign-up screen; nothing is assumed on their
// behalf. dataConsent must be true for the server to create the account, and it is the person's
// own tick that makes it so.
export interface RegisterInput {
  email: string;
  name: string;
  password: string;
  dateOfBirth: string;
  parentGuardianEmail?: string;
  dataConsent: boolean;
  trainingConsent: boolean;
  privacyPolicyVersion: string;
}

export async function register(
  input: RegisterInput,
): Promise<{ user: AppUser; devParentConsentLink?: string | null }> {
  return request("/auth/register", { method: "POST", body: input });
}

// Privacy rights (policy sections 11 and 13), the same endpoints the web app uses.
export interface PrivacyPolicyStatus {
  currentVersion: string;
  acknowledgedVersion: string | null;
  acknowledgedAt: string | null;
}

export async function getPrivacyPolicyStatus(): Promise<PrivacyPolicyStatus> {
  return request("/users/me/privacy-policy");
}

export async function acknowledgePrivacyPolicy(
  version: string,
): Promise<PrivacyPolicyStatus> {
  return request("/users/me/privacy-policy/acknowledge", {
    method: "POST",
    body: { version },
  });
}

export async function setTrainingConsent(consent: boolean): Promise<AppUser> {
  return request("/users/me/training-consent", {
    method: "POST",
    body: { consent },
  });
}

export async function setContentPersonalizationConsent(
  consent: boolean,
): Promise<AppUser> {
  return request("/users/me/content-personalization-consent", {
    method: "POST",
    body: { consent },
  });
}

/** The whole export as text, so it can be written to a file and shared. */
export async function exportMyData(): Promise<string> {
  return JSON.stringify(await request<unknown>("/users/me/export"), null, 2);
}

/** The same data as one web page someone who isn't technical can read, print or save as a PDF. */
export async function exportMyDataReadable(): Promise<string> {
  return request<string>("/users/me/export/readable", { responseType: "text" });
}

export interface BreachNotice {
  id: number;
  title: string;
  description: string;
  dataInvolved: string;
  userGuidance: string;
  notifiedAt: string;
  acknowledgedAt: string | null;
}

export async function listMyBreachNotices(): Promise<BreachNotice[]> {
  return request("/users/me/breach-notices");
}

export async function acknowledgeBreachNotice(
  id: number,
): Promise<BreachNotice> {
  return request(`/users/me/breach-notices/${id}/acknowledge`, {
    method: "POST",
  });
}

export async function deleteMyAccount(
  userId: number,
  password: string,
): Promise<void> {
  await request(`/users/${userId}`, { method: "DELETE", body: { password } });
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  return request("/auth/login", { method: "POST", body: { email, password } });
}

export async function getMe(): Promise<AppUser | null> {
  try {
    return await request<AppUser>("/auth/me");
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" });
}

export async function logoutAll(): Promise<{ terminatedSessions: number }> {
  return request("/auth/logout-all", { method: "POST" });
}

export async function getDashboard(): Promise<SecurityDashboard> {
  return request("/security/dashboard");
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
  if (filters?.eventType) params.set("eventType", filters.eventType);
  if (filters?.userEmail) params.set("userEmail", filters.userEmail);
  if (filters?.ipAddress) params.set("ipAddress", filters.ipAddress);
  if (filters?.fromDate) params.set("fromDate", filters.fromDate);
  if (filters?.toDate) params.set("toDate", filters.toDate);
  const qs = params.toString();
  return request(`/security/logs${qs ? `?${qs}` : ""}`);
}

export async function verifyLogIntegrity(): Promise<LogChainVerification> {
  return request("/security/logs/verify");
}

export interface Threat {
  id: number;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  plainSummary: string | null;
  timestamp: string;
  status: "active" | "mitigated" | "resolved";
  affectedUsers: number | null;
}

export async function listThreats(): Promise<Threat[]> {
  return request("/security/threats");
}

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin" | "security_analyst" | "it_support";
  faceEnrolled: boolean;
  passkeyEnrolled: boolean;
  dataConsentGiven: boolean;
  biometricConsentGiven: boolean;
  subscriptionPlan: string;
  createdAt: string;
  updatedAt: string | null;
}

export async function listUsers(): Promise<StaffUser[]> {
  return request("/users");
}

export async function updateUserRole(
  id: number,
  role: StaffUser["role"],
): Promise<StaffUser> {
  return request(`/users/${id}`, { method: "PATCH", body: { role } });
}

export async function deleteUser(id: number, password?: string): Promise<void> {
  await request(`/users/${id}`, {
    method: "DELETE",
    body: password ? { password } : undefined,
  });
}

export async function resetUserMfa(id: number): Promise<StaffUser> {
  return request(`/users/${id}/reset-mfa`, { method: "POST" });
}

export async function staffResetPassword(
  id: number,
): Promise<{ message: string; devResetLink: string | null }> {
  return request(`/users/${id}/reset-password`, { method: "POST" });
}

export interface Payment {
  id: number;
  userId: number | null;
  userEmail: string | null;
  amount: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded";
  description: string;
  providerToken: string;
  createdAt: string;
}

export interface Plan {
  id: "plus" | "pro" | "team";
  name: string;
  amount: number;
  currency: string;
  interval: string;
  description: string;
  features: string[];
}

export async function listPayments(): Promise<Payment[]> {
  return request("/payments");
}

export async function listPlans(): Promise<Plan[]> {
  return request("/payments/plans");
}

/**
 * Idempotency key for a payment attempt.
 *
 * React Native's Hermes runtime provides neither crypto.randomUUID nor, on
 * every version, crypto.getRandomValues — so this uses the strongest source
 * actually present and falls back to time + counter + Math.random.
 *
 * What the fallback does and does not buy, stated plainly: it gives
 * UNIQUENESS, which is what idempotency needs — two attempts must not
 * collide, and a collision now returns a 409 rather than someone else's
 * payment (the server scopes its lookup to the calling user; see the
 * comments in routes/payments.ts). It does NOT give unpredictability. That
 * distinction only stopped mattering once the server was fixed to scope by
 * userId; before that, a guessable key read another account's record, which
 * is precisely the kind of server-side guarantee that should never have
 * depended on a client's choice of random source.
 */
let idempotencyCounter = 0;
export function newIdempotencyKey(): string {
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  if (typeof g.crypto?.getRandomValues === "function") {
    const bytes = g.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  idempotencyCounter += 1;
  const rand =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${idempotencyCounter.toString(36)}-${rand}`;
}

/**
 * cardLast4/cardBrand are the ONLY card-derived values sent. The full
 * number, expiry and CVV never leave the device — they exist in component
 * state just long enough to validate, exactly as on web. The server uses
 * last4 to drive its simulated decline logic (lib/paymentSimulation.ts)
 * against published test-card numbers; omitting it always simulates
 * success, which is what this client used to do unintentionally.
 *
 * idempotencyKey is passed as a header rather than a body field because
 * that is where the server reads it, and because it identifies the REQUEST
 * rather than the payment — a retry of the same intent carries the same
 * key, which is what makes a duplicate charge impossible.
 */
export async function createPayment(
  amount: number,
  currency: string,
  description: string,
  card?: { last4: string; brand: string },
  idempotencyKey?: string,
): Promise<Payment> {
  return request("/payments", {
    method: "POST",
    body: {
      amount,
      currency,
      description,
      cardLast4: card?.last4 ?? null,
      cardBrand: card?.brand ?? null,
    },
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export async function subscribe(
  planId: Plan["id"],
  card?: { last4: string; brand: string },
  idempotencyKey?: string,
): Promise<{ payment: Payment; subscriptionPlan: string }> {
  return request("/payments/subscribe", {
    method: "POST",
    body: {
      planId,
      cardLast4: card?.last4 ?? null,
      cardBrand: card?.brand ?? null,
    },
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
}

export { request };
