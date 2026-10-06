import { describeEvent } from "./eventDescriptions";

/**
 * The readable copy of "Download my data" (privacy policy section 11; Australian Privacy Principle 12):
 * one self-contained web page, written for someone who isn't technical, that opens in any browser
 * and can be printed or saved as a PDF. Requested by the client on 2026-10-02. The JSON download
 * stays for moving data to another service.
 *
 * Every value is escaped: names, file names and browser details come from users, and this file is
 * opened outside the app. The page has no scripts.
 */

export interface ReadableExportInput {
  exportedAt: Date;
  privacyPolicyUrl: string;
  account: {
    name: string;
    email: string;
    role: string;
    dateOfBirth: string | null;
    parentGuardianEmail: string | null;
    parentConsentGiven: boolean | null;
    subscriptionPlan: string;
    createdAt: string | null;
    updatedAt: string | null;
  };
  consents: { label: string; given: boolean; at: string | null }[];
  faceTemplateStored: boolean;
  passkeys: {
    deviceName: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
  }[];
  phoneKeys: {
    deviceName: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
  }[];
  uploads: {
    fileName: string;
    fileType: string;
    sizeBytes: number;
    declaredSource: string;
    uploadedAt: string | null;
  }[];
  payments: {
    amount: number;
    currency: string;
    status: string;
    description: string;
    createdAt: string | null;
    refundedAt: string | null;
  }[];
  events: {
    timestamp: string | null;
    eventType: string;
    details: string;
    ipAddress: string | null;
    userAgent: string | null;
  }[];
  eventLimit: number;
  policy: {
    currentVersion: string;
    acknowledgedVersion: string | null;
    acknowledgedAt: string | null;
  };
  breachNotices: {
    title: string;
    description: string;
    dataInvolved: string;
    userGuidance: string;
    notifiedAt: string;
    acknowledgedAt: string | null;
  }[];
  disclosures: {
    agency: string;
    legalBasis: string;
    informationDisclosed: string;
    disclosedAt: string;
    personToldAt: string | null;
  }[];
  retention: {
    paymentRecordsYears: number;
    securityLogMonths: number;
    aiChallengeRecordYears: number;
  };
}

const esc = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const dateTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dateOnly = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "long",
  year: "numeric",
});

function when(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Not recorded" : dateTime.format(d);
}

function day(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return "Not given";
  const d = new Date(
    isoOrDate.length === 10 ? `${isoOrDate}T12:00:00Z` : isoOrDate,
  );
  return Number.isNaN(d.getTime()) ? "Not given" : dateOnly.format(d);
}

const ROLES: Record<string, string> = {
  user: "Standard account",
  admin: "Administrator",
  security_analyst: "Security analyst",
  it_support: "IT support",
};
const PLANS: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  team: "Team",
};
const FILE_TYPES: Record<string, string> = {
  image: "Photo or image",
  video: "Video",
  text: "Text document",
  audio: "Audio",
};
const SOURCES: Record<string, string> = {
  own_work: "Your own work",
  third_party_individual: "Another person's content",
  published_work: "Published work (for example a book or article)",
  social_media: "From social media",
  incidental_third_party_ip: "Your own, but includes someone else's material",
  unspecified: "Not stated",
};
const PAYMENT_STATUS: Record<string, string> = {
  pending: "Pending",
  completed: "Paid",
  failed: "Declined",
  refunded: "Refunded",
  disputed: "Disputed",
  charged_back: "Charged back",
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** "Chrome on Windows" rather than the raw browser string. */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Not recorded";
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? "Safari"
            : /okhttp|CFNetwork|Expo/i.test(ua)
              ? "SecureAI mobile app"
              : /curl|python|node|axios/i.test(ua)
                ? "A program (not a web browser)"
                : "A web browser";
  const system = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad|iOS|CFNetwork/.test(ua)
      ? "iPhone or iPad"
      : /Android|okhttp/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

function table(head: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="empty">${esc(empty)}</p>`;
  return (
    `<table class="data"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    // data-label repeats the column heading on each value, for the stacked layout on a phone.
    rows
      .map(
        (r) =>
          `<tr>${r.map((c, i) => `<td data-label="${esc(head[i])}">${c}</td>`).join("")}</tr>`,
      )
      .join("") +
    "</tbody></table>"
  );
}

function facts(rows: [string, string][]): string {
  return `<table class="facts"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join("")}</tbody></table>`;
}

const STYLE = `
body{margin:0;background:#f4f6f8;color:#1f2933;font:16px/1.55 "Segoe UI",Arial,Helvetica,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 20px 48px;background:#fff}
h1{font-size:28px;margin:0 0 8px}h2{font-size:21px;margin:36px 0 10px;padding-bottom:6px;border-bottom:2px solid #0e8080;color:#0b5f5f}
p{margin:0 0 12px}.lead{font-size:17px}.muted,.empty{color:#52606d}.note{background:#eef6f6;border-left:4px solid #0e8080;padding:10px 14px}
.alert{background:#fdecea;border-left:4px solid #b42318;padding:10px 14px}
nav ul{columns:2;margin:0;padding-left:20px}
table{border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:15px}
th,td{border:1px solid #cbd2d9;padding:7px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
thead th{background:#e4ecef}table.facts th{width:34%;background:#f5f7fa;font-weight:600}
.small{font-size:13px;color:#52606d}
@media (max-width:640px){main{padding:20px 14px 36px}nav ul{columns:1}
table.data thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
table.data,table.data tbody,table.data tr,table.data td{display:block}
table.data tr{border:1px solid #cbd2d9;margin-bottom:10px}table.data td{border:0;border-top:1px solid #e4e7eb}table.data td:first-child{border-top:0}
table.data td::before{content:attr(data-label);display:block;font-size:13px;font-weight:600;color:#52606d}}
@media print{body{background:#fff}main{padding:0}h2{break-after:avoid}tr{break-inside:avoid}nav{display:none}}
`;

export function renderReadableExport(input: ReadableExportInput): string {
  const a = input.account;
  const guardian = a.parentGuardianEmail
    ? `${esc(a.parentGuardianEmail)} (${a.parentConsentGiven ? "has agreed to your account" : "has not agreed yet"})`
    : "Not needed (you were 18 or over when you signed up)";
  const policyLine = input.policy.acknowledgedVersion
    ? `You last confirmed you had read version ${esc(input.policy.acknowledgedVersion)} on ${esc(when(input.policy.acknowledgedAt))}. The current version is ${esc(input.policy.currentVersion)}.`
    : `You haven't yet confirmed you've read the privacy policy. The current version is ${esc(input.policy.currentVersion)}.`;
  const keyRows = (keys: ReadableExportInput["passkeys"], kind: string) =>
    keys.map((k) => [
      esc(k.deviceName || kind),
      esc(when(k.createdAt)),
      esc(k.lastUsedAt ? when(k.lastUsedAt) : "Not used yet"),
    ]);
  const r = input.retention;

  const sections: string[] = [
    `<section id="about"><h2>About you</h2>${facts([
      ["Name", esc(a.name)],
      ["Email address", esc(a.email)],
      ["Date of birth", esc(day(a.dateOfBirth))],
      ["Account type", esc(ROLES[a.role] ?? a.role)],
      ["Parent or guardian", guardian],
      [
        "Subscription plan",
        esc(PLANS[a.subscriptionPlan] ?? a.subscriptionPlan),
      ],
      ["Account created", esc(when(a.createdAt))],
      ["Details last changed", esc(when(a.updatedAt))],
    ])}</section>`,
    `<section id="choices"><h2>Your choices</h2><p>What you have agreed to. You can change the optional ones at any time in Security Settings.</p>${table(
      ["What you were asked", "Your answer", "When"],
      input.consents.map((c) => [
        esc(c.label),
        c.given ? "<strong>Yes</strong>" : "No",
        esc(c.at ? when(c.at) : "Not given"),
      ]),
      "No choices recorded.",
    )}</section>`,
    `<section id="sign-in"><h2>How you sign in</h2>${facts([
      [
        "Password",
        "Kept only in a scrambled form that can't be turned back into your password, so it isn't in this copy.",
      ],
      [
        "Face sign-in",
        input.faceTemplateStored
          ? "Set up. We store a set of 128 numbers describing your face, encrypted. It isn't included here, so no extra copy of it exists; you can delete it in Security Settings."
          : "Not set up.",
      ],
    ])}<p><strong>Passkeys</strong> (your device's fingerprint, face or PIN unlocks them; nothing about your fingerprint or face reaches us)</p>${table(
      ["Device", "Added", "Last used"],
      keyRows(input.passkeys, "Passkey"),
      "No passkeys.",
    )}<p><strong>Phone keys</strong> (from the SecureAI mobile app)</p>${table(
      ["Device", "Added", "Last used"],
      keyRows(input.phoneKeys, "Phone"),
      "No phone keys.",
    )}</section>`,
    `<section id="files"><h2>Your files</h2><p>Files you uploaded to your Data Vault. The files themselves are in the Data Vault; the download for other services (JSON) includes their contents.</p>${table(
      [
        "File",
        "Type",
        "Size",
        "Uploaded",
        "Where it came from (as you told us)",
      ],
      input.uploads.map((u) => [
        esc(u.fileName),
        esc(FILE_TYPES[u.fileType] ?? u.fileType),
        esc(size(u.sizeBytes)),
        esc(when(u.uploadedAt)),
        esc(SOURCES[u.declaredSource] ?? u.declaredSource),
      ]),
      "You haven't uploaded any files.",
    )}</section>`,
    `<section id="payments"><h2>Your payments</h2><p>Payments in this proof of concept are simulated: no real card was charged.</p>${table(
      ["Date", "What for", "Amount", "Result", "Refunded"],
      input.payments.map((p) => [
        esc(when(p.createdAt)),
        esc(p.description),
        esc(money(p.amount, p.currency)),
        esc(PAYMENT_STATUS[p.status] ?? p.status),
        esc(p.refundedAt ? when(p.refundedAt) : "No"),
      ]),
      "You haven't made any payments.",
    )}</section>`,
    `<section id="activity"><h2>Security activity on your account</h2><p>We record these to keep your account safe: your ${input.events.length === input.eventLimit ? `most recent ${input.eventLimit.toLocaleString("en-AU")}` : input.events.length.toLocaleString("en-AU")} event${input.events.length === 1 ? "" : "s"}, newest first. "Internet address" is the IP address the request came from.</p>${table(
      ["When", "What happened", "Device", "Internet address", "Details"],
      input.events.map((e) => [
        esc(when(e.timestamp)),
        esc(describeEvent(e.eventType)),
        esc(describeDevice(e.userAgent)),
        esc(e.ipAddress ?? "Not recorded"),
        `<span class="small">${esc(e.details)}</span>`,
      ]),
      "No security activity recorded.",
    )}</section>`,
    `<section id="breaches"><h2>Data breach notices</h2>${
      input.breachNotices.length === 0
        ? '<p class="empty">We haven\'t had to tell you about any data breach.</p>'
        : input.breachNotices
            .map(
              (n) =>
                `<div class="alert"><p><strong>${esc(n.title)}</strong> (told to you on ${esc(when(n.notifiedAt))}${n.acknowledgedAt ? `; you confirmed you'd read it on ${esc(when(n.acknowledgedAt))}` : ""})</p><p>${esc(n.description)}</p><p><strong>Information involved:</strong> ${esc(n.dataInvolved)}</p><p><strong>What you can do:</strong> ${esc(n.userGuidance)}</p></div>`,
            )
            .join("")
    }</section>`,
    `<section id="disclosures"><h2>Information given to government agencies</h2><p>We only give your information to a government or law-enforcement agency when the law requires or allows it, for example under a warrant or court order, and we keep a written record each time. These are the times we have told you about.</p>${table(
      ["When", "Agency", "Why (the law or order)", "What was given"],
      input.disclosures.map((d) => [
        esc(when(d.disclosedAt)),
        esc(d.agency),
        esc(d.legalBasis),
        esc(d.informationDisclosed),
      ]),
      "None.",
    )}</section>`,
    `<section id="policy"><h2>Privacy policy</h2><p>${policyLine}</p></section>`,
    `<section id="keeping"><h2>How long we keep your information</h2><p>If you delete your account, we delete your profile, face template, passkeys and phone keys, files and sign-in sessions straight away.</p><p>Some records are kept for a set time whether or not you delete your account, and are then deleted automatically: payment records for ${r.paymentRecordsYears} years after the payment, security records for ${r.securityLogMonths} months, and records of challenges to AI decisions for ${r.aiChallengeRecordYears} years.</p></section>`,
  ];

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your SecureAI data, ${esc(dateOnly.format(input.exportedAt))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Your SecureAI data</h1>
<p class="lead">This is a copy of the personal information SecureAI holds about you, made on ${esc(dateTime.format(input.exportedAt))} (Sydney time).</p>
<p class="note">To keep a copy, save this page, or use your browser's Print option and choose "Save as PDF". If anything here looks wrong, you can change your name in Security Settings, or contact us about anything else.</p>
<nav aria-label="Contents"><ul>
<li><a href="#about">About you</a></li><li><a href="#choices">Your choices</a></li><li><a href="#sign-in">How you sign in</a></li>
<li><a href="#files">Your files</a></li><li><a href="#payments">Your payments</a></li><li><a href="#activity">Security activity</a></li>
<li><a href="#breaches">Data breach notices</a></li><li><a href="#disclosures">Government agencies</a></li><li><a href="#policy">Privacy policy</a></li><li><a href="#keeping">How long we keep it</a></li>
</ul></nav>
${sections.join("\n")}
<p class="muted">Our privacy policy explains your rights and how to contact us: ${esc(input.privacyPolicyUrl)}</p>
</main>
</body>
</html>
`;
}
