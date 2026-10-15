/**
 * What the phone app's start-up check found on the device (artifacts/mobile/src/lib/
 * deviceIntegrity.ts; MASVS-RESILIENCE, docs/06): "rooted" (a rooted Android phone or a jailbroken
 * iPhone) and/or "emulator", sent as the X-Device-Integrity header.
 *
 * The server can't verify this: an app changed by an attacker can simply stop sending it, and proving
 * the device is genuine would take Play Integrity or App Attest. So it is used only where an honest
 * phone's report helps: a flagged sign-in is recorded for security staff, and a new phone key isn't
 * registered from a device that says its key storage can't be trusted.
 */
import type { Request } from "express";
import { logEvent } from "./auditLog";
import { getClientIp } from "./clientIp";

const FINDINGS = ["rooted", "emulator"] as const;
export type DeviceFinding = (typeof FINDINGS)[number];

/** The findings this request reports; empty when it reports none (anything unrecognised is ignored). */
export function reportedDeviceFindings(req: Request): DeviceFinding[] {
  const raw = req.headers["x-device-integrity"];
  const reported = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((part) => part.trim().toLowerCase());
  return FINDINGS.filter((finding) => reported.includes(finding));
}

/** Records a flagged device against the account, naming what was being done. */
export async function recordDeviceFindings(
  req: Request,
  findings: readonly DeviceFinding[],
  user: { id: number; email?: string | null },
  action: string,
): Promise<void> {
  if (findings.length === 0) return;
  await logEvent({
    eventType: "DEVICE_INTEGRITY_FLAGGED",
    details: `${action} for user ${user.id} from a phone that reported: ${findings.join(", ")}`,
    userId: user.id,
    userEmail: user.email ?? null,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });
}
