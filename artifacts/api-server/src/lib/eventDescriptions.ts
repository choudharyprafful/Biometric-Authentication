import type { AuditEventType } from "./auditLog";

/**
 * Plain-language names for security events, for people who aren't technical: the readable data
 * export (privacy policy section 11) uses them in place of codes like LOGIN_FAILED. A Record, so
 * adding an event type without a description fails to compile.
 */
export const EVENT_DESCRIPTIONS: Record<AuditEventType, string> = {
  LOGIN_SUCCESS: "Signed in with your password",
  LOGIN_FAILED: "Sign-in attempt failed",
  LOGIN_FACE_SUCCESS: "Confirmed sign-in with your face",
  LOGIN_FACE_FAILED: "Face check at sign-in did not match",
  LOGIN_PASSKEY_SUCCESS: "Confirmed sign-in with a passkey or phone key",
  LOGIN_PASSKEY_FAILED: "Passkey check at sign-in failed",
  PASSKEY_ENROLLED: "Added a passkey",
  PASSKEY_REMOVED: "Removed a passkey",
  DEVICE_LINK_CODE_CREATED: "Created a code to link a phone",
  DEVICE_LINK_REDEEMED: "Linked a phone to your account",
  LOGOUT: "Signed out",
  LOGOUT_ALL: "Signed out on all devices",
  REGISTER: "Created your account",
  FACE_ENROLLED: "Set up face sign-in",
  FACE_REMOVED: "Removed face sign-in",
  PASSWORD_RESET_REQUESTED: "Asked to reset your password",
  PASSWORD_RESET_FACE_FAILED: "Face check during password reset did not match",
  PASSWORD_RESET_PASSKEY_FAILED: "Passkey check during password reset failed",
  PASSWORD_RESET_COMPLETED: "Reset your password",
  USER_DELETED: "Account deleted",
  USER_UPDATED: "Account details changed",
  ROLE_CHANGED: "Account type changed",
  ENCRYPTION_KEY_ROTATED: "Encryption key maintenance",
  MFA_RESET_BY_STAFF: "Staff reset your sign-in methods",
  PAYMENT_CREATED: "Made a payment",
  PAYMENT_FAILED: "A payment was declined",
  SUBSCRIPTION_CHANGED: "Subscription changed",
  PAYMENT_WEBHOOK_RECEIVED: "Payment update received from the payment provider",
  PAYMENT_WEBHOOK_REJECTED: "Payment update from the payment provider rejected",
  UPLOAD_CREATED: "Uploaded a file",
  UPLOAD_DOWNLOADED: "Downloaded a file",
  UPLOAD_DELETED: "Deleted a file",
  UPLOAD_SCAN_REJECTED: "An upload was refused by the virus scanner",
  UPLOAD_SCAN_UNAVAILABLE:
    "An upload was refused because the virus scanner was unavailable",
  UNAUTHORIZED_ACCESS: "Tried to open something your account can't access",
  RATE_LIMIT_HIT: "Too many attempts in a short time",
  AUDIT_LOG_CHAIN_REPAIRED: "Security record maintenance",
  AUDIT_LOG_CHAIN_RESTORED: "Security record maintenance",
  MINOR_REGISTRATION_PENDING_CONSENT:
    "Account waiting for a parent or guardian to agree",
  PARENT_CONSENT_GRANTED: "A parent or guardian agreed to your account",
  TRAINING_CONSENT_GIVEN: "Agreed to let your activity improve suggestions",
  TRAINING_CONSENT_WITHDRAWN:
    "Stopped letting your activity improve suggestions",
  BEHAVIOR_MODEL_QUERIED: "Suggestion shown on your dashboard",
  SECURITY_ALERT_NOTIFIED: "Security alert sent to staff",
  LOGIN_RISK_FLAGGED: "Unusual sign-in noticed",
  CONTENT_PERSONALIZATION_CONSENT_GIVEN:
    "Agreed to personalisation from your own text",
  CONTENT_PERSONALIZATION_CONSENT_WITHDRAWN:
    "Stopped personalisation from your own text",
  CONTENT_PROFILE_QUERIED: "Viewed your personalisation topics",
  PAYMENT_REFUNDED: "A payment was refunded",
  PAYMENT_IDEMPOTENT_REPLAY:
    "A repeated payment request was recognised and not charged twice",
  TRAINING_SOURCE_REJECTED:
    "An upload was kept out of AI learning because of where it came from",
  AI_SYSTEM_TOGGLED: "Staff switched an AI feature on or off",
  AI_DECISION_CHALLENGED: "Challenged an AI decision",
  AI_CHALLENGE_RESOLVED: "Your AI challenge was decided",
  AI_CHALLENGE_ACKNOWLEDGED: "Your AI challenge was acknowledged",
  PAYMENT_DISPUTED: "A payment was disputed",
  PAYMENT_DISPUTE_WON: "A payment dispute was resolved",
  PAYMENT_CHARGED_BACK: "A payment was charged back",
  PAYMENT_HOLD_PLACED: "Payments put on hold",
  PAYMENT_HOLD_CLEARED: "Payment hold removed",
  PAYMENT_WEBHOOK_IGNORED: "Payment update from the payment provider ignored",
  SESSION_LIMIT_ENFORCED:
    "Signed out on an older device (too many devices signed in)",
  PRIVACY_POLICY_ACKNOWLEDGED: "Confirmed you had read the privacy policy",
  DATA_EXPORTED: "Downloaded a copy of your data",
  DATA_BREACH_RECORDED: "Data breach recorded by staff",
  DATA_BREACH_ASSESSED: "Data breach assessed by staff",
  DATA_BREACH_USERS_NOTIFIED: "People affected by a data breach were told",
  DATA_BREACH_REGULATOR_NOTIFIED:
    "The privacy regulator was told about a data breach",
  DATA_BREACH_NOTICE_ACKNOWLEDGED:
    "Confirmed you had read a data breach notice",
  GOVERNMENT_DISCLOSURE_RECORDED:
    "Information disclosed to a government agency under the law",
  LEGAL_HOLD_PLACED: "Legal hold placed by staff",
  LEGAL_HOLD_RELEASED: "Legal hold released by staff",
};

export function describeEvent(eventType: string): string {
  return (
    EVENT_DESCRIPTIONS[eventType as AuditEventType] ??
    eventType
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}
