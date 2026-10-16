import { Platform } from "react-native";
import * as Device from "expo-device";

// MASVS-RESILIENCE-1 (docs/06): does this phone still keep its security promises? The phone key
// (src/lib/biometricKey.ts) rests on the operating system keeping the key in protected storage and
// asking for a real fingerprint or face before using it. A rooted Android phone or a jailbroken
// iPhone can break both, and an emulator never had them.
//
// expo-device does the checking: on Android an "su" binary or test-keys, on iOS the usual jailbreak
// signs, and whether this is a real device at all. These checks raise the cost of an attack; they
// don't stop someone determined to hide the root, and the server can't verify what the phone says
// (that would take Play Integrity or App Attest). So a finding warns the person, turns off setting up
// a new phone key on this device, and is sent with each request so the server records it
// (X-Device-Integrity; the API's lib/deviceIntegrity.ts).

export type IntegrityFinding = "rooted" | "emulator";

let findings: IntegrityFinding[] = [];

/** What the last check found; empty until it has run, and when nothing was found. */
export function integrityFindings(): IntegrityFinding[] {
  return findings;
}

/** Runs once at start-up (App.tsx). A check that fails to run is not counted as a finding. */
export async function checkDeviceIntegrity(): Promise<IntegrityFinding[]> {
  const found: IntegrityFinding[] = [];
  try {
    if (await Device.isRootedExperimentalAsync()) found.push("rooted");
  } catch {
    // Nothing to report: an unknown result is not evidence of a rooted phone.
  }
  // Development builds run in emulators and simulators as a matter of course.
  if (!Device.isDevice && !__DEV__) found.push("emulator");
  findings = found;
  return found;
}

const ROOTED = Platform.OS === "ios" ? "jailbroken" : "rooted";

/** Why a new phone key can't be set up on this device, or null when it can. */
export function deviceKeyBlockedReason(): string | null {
  if (findings.includes("rooted"))
    return `This phone appears to be ${ROOTED}, so its secure key storage can't be trusted to protect a sign-in key. Choose face instead, or sign in on the website.`;
  if (findings.includes("emulator"))
    return "This looks like an emulator, which has no secure key storage. Choose face instead, or use a real phone.";
  return null;
}

/** One sentence per finding, for the start-up warning. */
export function describeFindings(found: IntegrityFinding[]): string[] {
  return found.map((f) =>
    f === "rooted"
      ? `This phone appears to be ${ROOTED}. Apps on it can read or change what other apps store, including sign-in keys.`
      : "SecureAI is running in an emulator, not on a real phone. An emulator has no secure key storage.",
  );
}
