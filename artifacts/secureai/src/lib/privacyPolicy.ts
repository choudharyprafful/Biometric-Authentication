// SecureAI's privacy policy. Written by Team 2 (Ethics & Governance), draft of 23 September 2026;
// updated by Team 1 on 26 September 2026 so every statement matches what the app does (the changes
// are listed in docs/08, section 5c). The version must match PRIVACY_POLICY_VERSION in
// artifacts/api-server/src/lib/privacyPolicy.ts; scripts/check-privacy-policy-version.mjs checks it
// in CI. Change the version whenever the text changes, and signed-in users are asked to review it.
//
// Inline links use [text](/path).

export type PolicyBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface PolicySection {
  id: string;
  title: string;
  blocks: PolicyBlock[];
}

export const PRIVACY_POLICY = {
  version: '2026-09-26.2',
  effectiveDate: '26 September 2026',
  status:
    'Draft. Written by Team 2 (Ethics & Governance) on 23 September 2026 and updated by Team 1 on 26 September 2026 to match how the app works today and to add Team 2\'s answers on biometric information and challenge response times. Pending review by Team 2 and a legal adviser; not legal advice.',
  demoNotice:
    'SecureAI is a student proof of concept. Please use test details rather than your real personal information, and never enter a real card number. If you would rather not give a face scan, set up a passkey instead.',
  contact: 'privacy@secureai.example',
  contactNote: 'placeholder address, not yet monitored: until it is, use the challenge form on [How SecureAI uses AI](/ai#challenge)',
  sections: [
    {
      id: 'who-we-are',
      title: '1. Who we are, and what this policy covers',
      blocks: [
        { kind: 'p', text: 'SecureAI ("we", "us") is a web and mobile application with user accounts, subscriptions and payments, and a second sign-in step on every account. It uses AI in six places, each listed with its purpose and limits on [How SecureAI uses AI](/ai). Two of them learn from your data, and only if you separately opt in: the suggestion model learns from the types of actions you take, and your topic profile reads your own text uploads. Photos, video and audio you upload are stored encrypted but are not used by any AI feature, and we do not use public or third-party content.' },
        { kind: 'p', text: 'This policy explains what we collect, why, how you control it, and what rights you have, including the right to withdraw consent for AI use separately from simply using the app. It applies to all users of SecureAI on web and mobile.' },
        { kind: 'p', text: 'We are guided by the Australian Privacy Principles (Privacy Act 1988), Australia\'s AI Ethics Principles, and, for users in the EU/UK, the GDPR/UK GDPR and EU AI Act. Where AI-specific Australian regulation is still being finalised, we say so rather than claim certainty.' },
      ],
    },
    {
      id: 'what-we-collect',
      title: '2. What we collect',
      blocks: [
        { kind: 'p', text: 'Every data type we collect is tied to a named feature and classified by sensitivity. We don\'t collect on an open-ended "to improve our services" basis.' },
        {
          kind: 'table',
          head: ['Category', 'What it is', 'Sensitivity', 'Used for'],
          rows: [
            ['Account', 'Name, email, date of birth, password (stored only as a one-way hash), subscription plan; a parent or guardian\'s email for under-18s', 'Low–medium', 'Running your account and checking age at sign-up'],
            ['Payments', 'Amount, currency, plan, status, and the card brand and last 4 digits if you give them. Payments in this proof of concept are simulated: no full card number is ever sent to us', 'Medium', 'Your payment history and refunds. Never used by any AI feature, except that "made a payment" can be one of the action types the suggestion model learns from if you opt in (section 4)'],
            ['Face template (only if you choose face sign-in)', '128 numbers computed in your browser from the camera. The camera image never leaves your device; the template is sent to us and stored encrypted', 'Very high: biometric information is sensitive information under the Privacy Act 1988, even when encrypted', 'Confirming it\'s you at sign-in and password reset, and nothing else. Collected only with your express consent, and you can use a passkey instead. Delete it any time in Security Settings'],
            ['Passkey or phone key', 'A public key. Your fingerprint or face unlocks the key on your own device and never leaves it', 'Low', 'Sign-in and password reset'],
            ['Security records', 'Your email, IP address, browser and device, and the time of each security event (sign-ins, payments, uploads, setting changes)', 'Medium', 'Protecting your account: the automated sign-in risk check compares a new sign-in with your own history, abuse and fraud detection (including account sharing), and staff investigation'],
            ['Your uploads', 'Text, photos, video and audio, each with the source you declare. Location data is removed from photos, and from videos where that can be done safely', 'Very high', 'Storing them for you. Only your own text uploads can build your private topic profile, and only if you opt in'],
            ['Your activity', 'Which types of actions you take in the app (for example "uploaded a file"), never their content', 'Low', 'The suggestion model, only if you opt in (section 4)'],
            ['Challenges', 'What you write when you challenge an AI decision', 'Varies', 'Reviewing your challenge and telling you the outcome'],
          ],
        },
        { kind: 'p', text: 'We use two cookies, both needed for the app to work: a session cookie that keeps you signed in (it ends after 30 minutes without activity, or 12 hours at most) and a security cookie that stops other websites acting in your name. We use no advertising or analytics cookies or trackers.' },
        { kind: 'p', text: 'We apply data minimisation throughout, and we don\'t ask for a government ID.' },
      ],
    },
    {
      id: 'consent',
      title: '3. How consent works',
      blocks: [
        { kind: 'p', text: 'Every consent request in SecureAI is designed to meet five tests before we treat it as valid:' },
        {
          kind: 'list',
          items: [
            'Voluntary: no pre-ticked boxes, and declining never degrades an unrelated feature.',
            'Informed: plain language that says what happens if you say no.',
            'Current: an old consent doesn\'t silently cover a new use we add later.',
            'Specific: we name the actual data and use, never a generic "personalise your experience".',
            'Given with capacity: we check age at sign-up (see section 6 on minors).',
          ],
        },
        { kind: 'p', text: 'Using SecureAI is not the same as consenting to AI use. We ask separately, with unticked choices, for: (1) processing your account data, which is needed to run your account; (2) your face template, only if you choose face sign-in, because biometric information is sensitive information under the Privacy Act and needs your express consent; (3) letting the suggestion model learn from the types of actions you take; and (4) letting your topic profile read your own text uploads. Declining (2), (3) or (4) doesn\'t affect anything else. You can withdraw each one at any time in [Security Settings](/enroll), including before you finish setting up sign-in, and the change applies to the very next request.' },
      ],
    },
    {
      id: 'how-we-use',
      title: '4. How we use your data',
      blocks: [
        { kind: 'p', text: 'We distinguish two uses, and treat them as separate consent decisions, not one bundled toggle:' },
        {
          kind: 'list',
          items: [
            'Personalisation: your topic profile, built from your own text uploads and shown only to you. It is never pooled with other accounts.',
            'Shared learning: the suggestion model, which learns from the types of actions taken by everyone who has opted in. It never sees what you upload, and it only uses a pattern once at least three different accounts show it, so it can\'t repeat something only you do.',
          ],
        },
        { kind: 'p', text: 'Content is eligible for either use only where our Data Source Acceptability Matrix (section 7) and your own consent settings both allow it. Eligibility is checked every time: both models are rebuilt from current data on each request, so withdrawing consent takes effect on the very next request rather than waiting for a retraining cycle.' },
        { kind: 'p', text: 'Automated checks also help protect your account: the sign-in risk check, face matching and liveness check at sign-in, and alerts about unusual activity shown to our security staff. Each is described, with its limits and how to challenge it, on [How SecureAI uses AI](/ai).' },
      ],
    },
    {
      id: 'other-people',
      title: '5. Other people in your content',
      blocks: [
        { kind: 'p', text: 'You can only consent on your own behalf, but a family photo, a video or a diary entry often includes other people who never agreed to anything. When you upload a file you tell us where it came from; anything you mark as another person\'s content, published work or social media is never used by any AI feature. It is stored only for you.' },
        { kind: 'p', text: 'Photos, video and audio are not used by any AI feature at all, whoever appears in them. We don\'t automatically scan text for other people\'s names, so a diary entry you mark as your own work can be read by your private topic profile if you opt in; it is never shared with other accounts.' },
      ],
    },
    {
      id: 'children',
      title: '6. Children and minors',
      blocks: [
        { kind: 'p', text: 'You give your date of birth when you sign up. If you are under 18, a parent or guardian\'s email is required, and your account can\'t use its protected features until they confirm through the link we email them. We rely on the date of birth you give; we don\'t verify it further.' },
        { kind: 'p', text: 'Content that shows a minor is never used for training or shared personalisation, because photos and video are not used by any AI feature at all. We\'re tracking Australia\'s draft Children\'s Online Privacy Code (proposing protections up to age 15) and will update this section as it develops.' },
      ],
    },
    {
      id: 'external-sources',
      title: '7. External and public sources',
      blocks: [
        { kind: 'p', text: '"Public" does not mean "usable": data being online doesn\'t waive copyright, platform terms, or the rights of the people in it. SecureAI currently uses no external or public data. Our Data Source Acceptability Matrix sets the rules for what could be used:' },
        {
          kind: 'table',
          head: ['Source', 'Our default', 'Why'],
          rows: [
            ['Your own text', 'Your private topic profile, with consent', 'Yours to consent to, subject to section 5'],
            ['Your own photos, voice and video', 'Stored for you only; not used by any AI feature', 'We have no consent path for the other people who may appear in them'],
            ['Linked YouTube/social video', 'Excluded from training and personalisation', 'Platform terms generally prohibit scraping'],
            ['Public social media posts', 'Excluded', '"Public" ≠ rights-cleared; individual and platform rights still apply'],
            ['News articles, blogs, published books', 'Excluded pending licence', 'No settled exception for AI training under current Australian law'],
            ['A friend\'s or relative\'s content you didn\'t upload yourself', 'Excluded', 'You can\'t consent on someone else\'s behalf'],
          ],
        },
        { kind: 'p', text: 'Whether training on copyrighted material is lawful is actively contested and differs by country. We treat this as a live risk to manage, not a settled question, and we default to exclusion where the law is unclear.' },
      ],
    },
    {
      id: 'ai-content',
      title: '8. AI output and its limits',
      blocks: [
        { kind: 'p', text: 'SecureAI does not generate text, images or voice. Wherever an AI system influences what you see (a suggestion, a topic profile, a sign-in warning), it is labelled "AI" and links to an explanation of what it decided and why.' },
        { kind: 'p', text: 'If we ever add generated content, it will be labelled as AI-generated wherever it is shown or shared, we won\'t claim you exclusively own raw AI output, and we won\'t let the app reproduce a real person\'s voice or likeness without a clear label or a block.' },
      ],
    },
    {
      id: 'sharing',
      title: '9. Sharing and cross-border transfers',
      blocks: [
        { kind: 'p', text: 'We don\'t sell personal data. We use these service providers:' },
        {
          kind: 'list',
          items: [
            'Amazon Web Services: hosting, database and content delivery. Your data is stored in the United States (US East, Northern Virginia), and the website is delivered through Amazon\'s global network.',
            'Google (Gmail): sends account emails, such as password-reset and parental-consent links, so your email address and the link pass through Google.',
            'No payment processor yet: payments in this proof of concept are simulated. A real processor would receive card details directly, and they would never reach us or our AI features.',
          ],
        },
        { kind: 'p', text: 'Storing data in the United States is a disclosure outside Australia under Australian Privacy Principle 8, and a transfer outside the EU/UK for GDPR purposes. The safeguards for these transfers are being reviewed as part of this draft.' },
      ],
    },
    {
      id: 'retention',
      title: '10. How long we keep data',
      blocks: [
        { kind: 'p', text: 'When you delete your account, we delete your profile, face template, passkeys and phone keys, uploads and sessions straight away. Payment records and security records are kept after deletion, with your email, for accountability and fraud prevention.' },
        { kind: 'p', text: 'Expired password-reset and parental-consent links are deleted automatically. Security records and payment records are kept for a defined period rather than indefinitely once that period is set; at the time of writing it has not been set, so they are currently kept without a limit. We will publish a specific number of days for each before this policy is treated as final.' },
      ],
    },
    {
      id: 'your-rights',
      title: '11. Your rights',
      blocks: [
        {
          kind: 'list',
          items: [
            'Access and export: download a copy of your data at any time from [Security Settings](/enroll) (a JSON file). Your face template is described but not included, to avoid creating another copy of it.',
            'Correction: contact us to correct any of your details.',
            'Deletion: delete your whole account in Security Settings, or individual files in the Data Vault, and remove your face template at any time.',
            'Withdrawing consent: switch off each AI use separately in Security Settings. It applies to the very next request, because both models are rebuilt from current data each time.',
          ],
        },
        { kind: 'p', text: 'Deleting your data means we stop using it and delete the source content from our stores. Because our models are rebuilt from current data on every request, there is no already-trained model left holding it. If that ever changes, we will tell you plainly when removal takes effect.' },
      ],
    },
    {
      id: 'complaints',
      title: '12. Complaints and challenging an AI decision',
      blocks: [
        { kind: 'p', text: 'If you think an AI-influenced outcome has treated you unfairly, use the challenge form on [How SecureAI uses AI](/ai#challenge): a security analyst reviews it and you see the outcome and a note. For anything else about your data, contact us. A security analyst will acknowledge your challenge within 2 business days and tell you how it will be investigated; how long the investigation takes depends on what happened, and you will see the outcome. This is consistent with the contestability principle in Australia\'s AI Ethics Principles.' },
        { kind: 'p', text: 'If you\'re not satisfied with our response, Australian users can escalate to the Office of the Australian Information Commissioner (OAIC); EU/UK users have the equivalent right to lodge a complaint with their local data protection authority.' },
      ],
    },
    {
      id: 'changes',
      title: '13. Changes to this policy, and contact',
      blocks: [
        { kind: 'p', text: 'When this policy changes, you\'ll see a notice in the app the next time you sign in, and we record which version you were shown. We won\'t apply an expanded use of your existing data without asking again, consistent with the "current" consent test in section 3.' },
      ],
    },
  ] as PolicySection[],
} as const;
