/**
 * The AI system register: every place SecureAI uses AI to make or shape a decision about a person,
 * with its purpose, data, oversight, owner and known limits. It answers Team 2's Responsible AI and
 * Accountability frameworks (Weeks 7-8): accountability, purpose, transparency, human oversight,
 * documentation. Served publicly by GET /ai/systems for the "How SecureAI uses AI" page, and
 * mirrored in docs/11_Responsible_AI_Governance.md.
 */

// Accountability (Voluntary AI Safety Standard guardrails 1.1 and 5.1): a named person answerable for
// each system, with authority to intervene. One constant so a change of lead is a one-line edit.
export const ACCOUNTABLE_OWNER = "Prafful Choudhary, Team 1 lead";
const OVERSIGHT_ROLE = "Security analysts review every flag, alert and challenge; administrators can switch models off";

export type AiSystemId = "face-recognition" | "liveness" | "login-risk" | "behaviour-suggestions" | "content-personalisation" | "anomaly-alerts";

export interface AiSystem {
  id: AiSystemId;
  name: string;
  kind: string;
  purpose: string;
  whyAi: string;
  decides: string;
  dataUsed: string;
  runsWhere: string;
  humanOversight: string;
  howToChallenge: string;
  knownLimits: string[];
  riskRefs: string[];
  accountableOwner: string;
  oversightRole: string;
  /** Whether an administrator can switch it off, and what switching it off does. */
  switchable: boolean;
  switchNote: string;
}

const CHALLENGE = "Use \"Challenge a decision\" on the How SecureAI uses AI page. A security analyst reviews it and you see the outcome there.";

export const AI_SYSTEMS: readonly AiSystem[] = [
  {
    id: "face-recognition",
    name: "Face matching",
    kind: "Pretrained neural network: face-api.js 0.22.2 (a ResNet-34-style face recognition network; weights trained by the dlib author)",
    purpose: "Confirms it is the account owner when signing in or resetting a password, as one of the second factors.",
    whyAi: "Recognising a face in a camera image cannot be written as fixed rules; a trained model turns the image into 128 numbers that can be compared. A passkey is always offered as well, so nobody has to rely on the model.",
    decides: "Whether a face scan is close enough to the enrolled face (distance below 0.6). A miss refuses that attempt; after repeated misses the sign-in has to be restarted. It never locks or deletes an account.",
    dataUsed: "A live camera image, processed only in your browser; the image is never uploaded. The 128-number face template is stored encrypted (AES-256-GCM) and only with your biometric consent.",
    runsWhere: "Face detection and template extraction in your browser; the comparison on the server.",
    humanOversight: "Face is optional: you can set up and sign in with a passkey instead, and add or remove your face at any time. IT support or an administrator can reset your second factors after checking it is you. Repeated failures, and scans clustered just above the match threshold, alert security analysts.",
    howToChallenge: CHALLENGE,
    knownLimits: [
      "Its accuracy has not been measured on SecureAI's own users: that needs a demographically labelled set of consented face images, which this project's synthetic-data rule rules out. The library reports 99.38% on the LFW benchmark, a dataset widely documented as demographically unbalanced.",
      "Face recognition systems in general work less well for some groups of people; this one may too. That is why a passkey is always available instead.",
      "The 0.6 match threshold is the library's default, not calibrated on this app's users.",
      "The library has had no release since 2020.",
    ],
    riskRefs: ["R-ML-10", "R-BIO-1", "R-ADV-1"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: false,
    switchNote: "Not switched off globally, because that would stop every face-only sign-in at once. Oversight is per person instead: a staff MFA reset, or the passkey alternative.",
  },
  {
    id: "liveness",
    name: "Blink check",
    kind: "Rule-based check on a pretrained 68-point face landmark model (face-api.js)",
    purpose: "Stops a printed photo or a still image being used in place of a live face during a face scan.",
    whyAi: "Finding the eyes in a camera frame needs the landmark model; the blink test on top of it is a fixed rule.",
    decides: "Whether a face scan may go ahead. It does not decide anything on its own beyond that.",
    dataUsed: "The same live camera frames, only in your browser. Nothing is stored or sent.",
    runsWhere: "Your browser.",
    humanOversight: "If it cannot see you blink, use your passkey instead; nothing is recorded against you.",
    howToChallenge: CHALLENGE,
    knownLimits: [
      "May not work for people who cannot blink normally, or with some eye conditions, glasses glare or poor light.",
      "A replayed video or a realistic mask can defeat it (R-BIO-1).",
    ],
    riskRefs: ["R-BIO-1", "R-ML-10"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: false,
    switchNote: "Not switched off globally: it is part of the face scan, and the passkey alternative already bypasses it for anyone it fails.",
  },
  {
    id: "login-risk",
    name: "Sign-in risk check",
    kind: "Statistical scoring of each sign-in against that account's own history",
    purpose: "Warns you, and flags to security analysts, when a sign-in looks unlike your usual ones, so a stolen password is noticed.",
    whyAi: "What is unusual differs per person, so it learns each account's own pattern (networks, browsers, time of day) instead of using one rule for everyone.",
    decides: "Whether to show you a warning and record a flag. It never blocks or slows a sign-in.",
    dataUsed: "Your own past sign-ins in the audit log: network address, browser, time. Never pooled with other accounts.",
    runsWhere: "Server, at each password sign-in.",
    humanOversight: "Warnings are advisory; flags are reviewed by security analysts. An administrator can switch the check off.",
    howToChallenge: CHALLENGE,
    knownLimits: [
      "VPNs and mobile networks change addresses often, which can cause false warnings.",
      "No location data is used, so it cannot tell a nearby network from one abroad.",
      "New accounts have little history, so their first sign-ins look new by definition.",
    ],
    riskRefs: ["R-AUTH-7", "R-ML-11"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: true,
    switchNote: "Switched off: sign-ins are not scored, no warnings are shown and nothing is flagged.",
  },
  {
    id: "behaviour-suggestions",
    name: "Suggested next action",
    kind: "Second-order Markov model over activity types, rebuilt on every request",
    purpose: "Shows a hint on the dashboard about what people with similar activity usually do next.",
    whyAi: "The suggestion comes from patterns across many accounts, which a fixed menu cannot capture.",
    decides: "Nothing: it only shows a suggestion. It cannot perform any action.",
    dataUsed: "Activity types (for example \"signed in\", \"uploaded a file\") from accounts that opted in to training. Never file contents. A pattern is only used once 3 or more separate accounts show it.",
    runsWhere: "Server.",
    humanOversight: "Every query is recorded in the audit log. An administrator can switch it off. You can withdraw training consent at any time, with effect on the next suggestion.",
    howToChallenge: CHALLENGE,
    knownLimits: [
      "Several coordinated accounts that outnumber the genuine users showing a pattern can change a suggestion (R-ML-3).",
      "Suggestions can simply be unhelpful; they carry no authority.",
    ],
    riskRefs: ["R-ML-1", "R-ML-3", "R-ML-5", "R-ML-6"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: true,
    switchNote: "Switched off: the dashboard shows no suggestion and the model is not trained.",
  },
  {
    id: "content-personalisation",
    name: "Personal topic profile",
    kind: "TF-IDF keyword statistics over your own text uploads",
    purpose: "Shows you the topics your own writing is about.",
    whyAi: "Word statistics find the distinctive topics in a set of documents without anyone reading them.",
    decides: "Which topic words appear in your own profile. Nothing else, and nobody else sees it.",
    dataUsed: "Text files you uploaded and marked as your own work, decrypted in memory only while building the profile, and only with your separate personalisation consent.",
    runsWhere: "Server; the profile is recomputed on each request and never stored.",
    humanOversight: "Only you see it; you can withdraw consent at any time. An administrator can switch it off.",
    howToChallenge: CHALLENGE,
    knownLimits: ["Text only; statistics over word frequency, so topics can be surprising or miss meaning."],
    riskRefs: ["R-ML-7", "R-ML-9"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: true,
    switchNote: "Switched off: no profile is built and your files are not read.",
  },
  {
    id: "anomaly-alerts",
    name: "Security anomaly alerts",
    kind: "Statistical detectors over the audit log (face-scan failure spikes and threshold probing, upload-rate spikes, sign-in failure spikes)",
    purpose: "Alerts security staff to patterns that suggest an attack.",
    whyAi: "Attacks show up as statistical patterns across many events rather than in any single one.",
    decides: "Nothing about any account by itself: it alerts people, and people decide what to do.",
    dataUsed: "Audit-log events and, for face scans, the match distance recorded on failed attempts.",
    runsWhere: "Server.",
    humanOversight: "Every alert goes to a person; no automatic action is taken against an account.",
    howToChallenge: CHALLENGE,
    knownLimits: ["Fixed thresholds can miss slow attacks, or alert on a legitimate burst of activity."],
    riskRefs: ["R-AUTH-2", "R-UP-1", "R-ADV-1"],
    accountableOwner: ACCOUNTABLE_OWNER,
    oversightRole: OVERSIGHT_ROLE,
    switchable: false,
    switchNote: "Not switched off: it is itself a human-oversight channel, and it takes no action on its own.",
  },
];

export const AI_SYSTEM_IDS = AI_SYSTEMS.map((s) => s.id) as AiSystemId[];
export const isAiSystemId = (value: string): value is AiSystemId => (AI_SYSTEM_IDS as string[]).includes(value);
