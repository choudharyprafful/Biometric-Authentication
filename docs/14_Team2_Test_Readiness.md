# 14. Team 2 Test Readiness

Team 1's answer to Team 2's three test documents: the **Compliance Test Plan**, the **"Alex Rivera" scenario
test script**, and the **User Data Case Studies**. For each test it says what SecureAI does, how to show it
in the app, and the result Team 1 expects, so any difference from Team 2's expected behaviour is known
before the session rather than found during it. The Result column in Team 2's documents is still theirs to
fill in from what the build actually does.

Written 2026-10-15. Synthetic data only, as Team 2's documents require.

## How to run the tests

- **Where.** The changes made for these tests (section 5) are on the branch `yaseen/ethics-test-readiness`
  until it is merged and deployed. Run the session on a local build of that branch (README "Quick start")
  or on the live site once it is deployed. Production needs two database migrations first: the bystander
  migration, then `scripts/ops/migrate-bystander-consent-requests.mjs`.
- **Accounts.** Two synthetic accounts: "Alex Rivera" and "Sam". Sam is used where Team 2's scenarios have a
  second person who also has an account (scenario step 2, case study item 2).
- **Pages.** Data Vault (`/uploads`), Security Settings (`/enroll`), How SecureAI uses AI (`/ai`), AI
  Security (`/ai-security`), Report content (`/report-content`), Privacy Policy (`/privacy`).
- **Records.** Each account's own data download (Security Settings: the readable copy or the JSON file)
  shows the stored status fields Team 2 asks to inspect: who else a file shows, the statement and date, the
  people asked and their answers, and the security events.

The expected results use Team 2's terms: **Pass**, **Limited** (only documentation or a demonstration can
confirm it), **Monitor only**, and, from the scenario script, **Diverges**. **Not applicable** marks a test
of a feature SecureAI does not have.

## 1. Compliance Test Plan

| Risk                                 | What SecureAI does                                                                                                                                                                                                                                              | How to show it                                                                                                                                                                                                                                     | Expected                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R01 (adult in a photo)               | The upload form asks whether the file shows or names anyone else. "Someone I've told about it, who doesn't object" needs a statement, kept with its date. Such a file is never used by anything shared across accounts. Photos are used by no AI feature at all | Upload a synthetic photo, answer "Yes", tick that answer and write the statement. The file's row says "Also shows someone you told"; the data download shows `otherPeople`, the statement and the date; the security log has `BYSTANDERS_DECLARED` | Pass                                                                                       |
| R02 (minor)                          | "Someone under 18" overrides every other answer: no feature uses the file, whatever an adult says                                                                                                                                                               | Upload with "Someone I've told" and "Someone under 18" ticked together. The file is stored, and its row and any profile show it unused, with the reason "It shows or names someone under 18"                                                       | Pass                                                                                       |
| R05 (likeness output)                | SecureAI generates no text, images or voice. The six AI systems are listed on `/ai`; none generates content                                                                                                                                                     | Show `/ai` and privacy policy section 8                                                                                                                                                                                                            | Not applicable                                                                             |
| R06 (unlicensed book)                | Declaring a file as "Published book / article / news" keeps it out of every AI use and logs `TRAINING_SOURCE_REJECTED`. A file with no declared source is treated the same way                                                                                  | Upload a synthetic excerpt with that source. Its row shows it unused, with the matrix's reason                                                                                                                                                     | Pass. Nothing detects a book automatically; it relies on the declaration                   |
| R09 (withdrawal)                     | Unticking "Content Personalization" stops the topic profile at once. The app then offers to delete the text files the profile read                                                                                                                              | Show the topic list, untick, read the on-screen message, choose "Delete" and see the files gone from the Data Vault                                                                                                                                | Pass. The wording differs from Team 2's expectation: see section 4                         |
| R20 (harmful output)                 | No generative output and no prompts to attack. A visible report path exists (`/report-content`, and "Challenge a decision" on `/ai`)                                                                                                                            | Show the report page and the challenge form                                                                                                                                                                                                        | Not applicable (no generative feature); reporting path: Pass                               |
| R10 (decline training consent)       | Account-data consent is the only one needed to use the app. Training and topic-profile consents are separate, unticked by default, and changeable later                                                                                                         | Register without ticking training consent, then use the vault and payments                                                                                                                                                                         | Pass                                                                                       |
| R03 (deceased)                       | A file marked "Someone else's work" is used by no AI feature. A file that shows or names someone who has died is kept out of anything shared                                                                                                                    | Upload a synthetic voicemail with each answer and compare the rows                                                                                                                                                                                 | Pass                                                                                       |
| R04 (biometric not in training data) | No model reads biometric data: the suggestion model learns action types, the topic profile reads text files. The data download describes the face template but never includes it                                                                                | Download the data and search it; show `/ai` for what each model reads                                                                                                                                                                              | Pass (Limited: "no model reads it" rests on the code and its documentation)                |
| R07 (YouTube link)                   | There is no way to add a link or import from a URL. A downloaded video declared "From social media" is used by nothing, and no video is used by any AI feature                                                                                                  | Show that the upload form takes only files; upload a video with that source                                                                                                                                                                        | Pass. The literal step can't be performed                                                  |
| R11 (where data is)                  | AWS `us-east-1` (Northern Virginia), named in the privacy policy. A move to Sydney is not started (docs/10)                                                                                                                                                     | Privacy policy section 9 and docs/10                                                                                                                                                                                                               | Limited. The answer is fixed and documented; the APP 8 safeguards are still open           |
| R13 (bias)                           | The AI Security page runs a fairness spot-check on every load: eight synthetic writers in five scripts write the same diary through the real topic-profile code                                                                                                 | Open `/ai-security`, section "Fairness spot-check"                                                                                                                                                                                                 | Pass (Limited, as the plan says). It found and fixed a real fault (section 5)              |
| R14 (AI limits)                      | Every AI output is labelled "AI" and links to `/ai`, which lists each system's known limits and how to challenge it                                                                                                                                             | Dashboard and Security Settings labels, then `/ai`                                                                                                                                                                                                 | Pass                                                                                       |
| R15 (untrusted source)               | Five source choices; anything not the uploader's own work is used by no AI feature, and an undeclared source fails closed. The stored record has the source, privacy tier and copyright risk; there is no field called "trust tier"                             | Upload with each source and compare the rows                                                                                                                                                                                                       | Pass                                                                                       |
| R16 (non-admin access)               | Another account's file returns 403 and is logged as `UNAUTHORIZED_ACCESS`. No endpoint returns a face template. Staff pages refuse ordinary accounts                                                                                                            | As a second test account, request the first account's file                                                                                                                                                                                         | Pass. An administrator has every role's rights, a decision recorded in docs/04 (R-AC-4)    |
| R17 (encryption at rest)             | Files and face templates are encrypted by the app (AES-256-GCM) before they reach the database. **The production database's disk is not encrypted** (docs/04 R-DP-5, accepted by the project owner for the proof of concept)                                    | Show the encrypted columns and docs/04 R-DP-5                                                                                                                                                                                                      | Limited, and partial: the app-level encryption is real; the database disk is not encrypted |
| R18 (copyright law)                  | A legal-landscape risk                                                                                                                                                                                                                                          |                                                                                                                                                                                                                                                    | Monitor only                                                                               |

## 2. The "Alex Rivera" scenario

Run in order, as the script says.

1. **Sign-up and biometric enrolment.**
   - Register with account-data consent only.
   - Face sign-in: the template is computed on the device, then sent to the server and stored encrypted.
     Team 2 agreed to this in writing on 2026-09-26 (docs/08 §5), and the consent text says so.
   - A passkey, or the phone app's fingerprint, Face ID or Touch ID, keeps the biometric on the device.
   - **Expected:** Diverges for face sign-in, as agreed; Pass with a passkey. The data download never
     contains the template. Suggested: run the step with a passkey and note the face path.
2. **Diary entry naming Sam.**
   - Upload as "My own work" and answer "Yes". Then either:
     - tick "Someone I've told about it, who doesn't object" and write that Sam knows and doesn't object; or
     - if Sam has an account, tick "Someone with a SecureAI account" and give Sam's address. Sam answers in
       their own Data Vault.
   - **Expected:** Pass. Used at most by Alex's own topic profile, never by anything shared. With Sam asked,
     nothing uses it until Sam answers, and Sam's "no" keeps it out.
3. **Family photo: sister and two children.**
   - Tick "Someone I've told" (the sister) and "Someone under 18" (the children) on the one upload.
   - The file is stored and used by nothing, with the reason "It shows or names someone under 18". There is
     no error and no workaround: the safe outcome Team 2's note describes.
   - **Expected:** Pass, with one difference to know beforehand. SecureAI decides per file, not per person,
     so the sister's part is not usable separately: with a child in the photo, nothing uses any of it.
4. **Linking a YouTube video.** As R07: there is nothing to paste a link into. A downloaded copy declared
   "From social media" is used by nothing. **Expected:** Pass (by absence).
5. **Voice memo.**
   - Choosing an audio file shows a notice before upload. It says the recording is stored encrypted, that
     no feature uses voice recordings, and that SecureAI never copies (clones) a voice; a separate consent
     naming voice cloning would come first if that ever changed.
   - **Expected:** Pass for naming voice cloning. One difference: there is no personalisation opt-in for
     audio, because no feature uses it at all, which is stricter than the script expects.
6. **AI-generated output and an adversarial prompt.** SecureAI generates nothing and takes no prompts. The
   AI it does use is labelled where it appears. **Expected:** Not applicable.
7. **Consent withdrawal.**
   - As R09. Untick personalisation; the profile is empty at once.
   - Choose "Delete 2 files" in the offer that follows, and the diary entries are deleted.
   - The literal on-screen message: "Personalisation is off from now on. The topic list was never saved, so
     nothing it picked up from your writing remains."
   - **Expected:** Pass, with the wording difference in section 4.
8. **Infrastructure.** As R11: `us-east-1`. **Expected:** Limited.

## 3. User Data Case Studies

| Item                                      | What SecureAI does                                                                                                                                                                                                                                                                                                  | Matches?                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1. Selfie                                 | "Where is this from?" covers who took it, and "Does it show or name anyone else?" the people in it. Consent to store uploads is asked once at sign-up, not the first time each kind of file is uploaded, and personalisation and training consents are per account, not per photo. Photos are used by no AI feature | Partly: the storage and AI-use consents are per account, not per media type or per item |
| 2. Video with a friend who has an account | "Someone with a SecureAI account" sends the friend a request in their own account. They answer the topic profile and shared training separately; a use they refuse is not available for that file, and the uploader sees each answer                                                                                | Yes (added 2026-10-15). The first-upload storage consent is as in item 1                |
| 3. Theme park group photo                 | Answering adults who agree, minors, and strangers: the minor rule overrides, the file is used by nothing, and the uploader sees why                                                                                                                                                                                 | Yes                                                                                     |
| 4. Deceased relative's diary              | "Someone else's work" keeps it out of every AI use, with the reason shown                                                                                                                                                                                                                                           | Yes                                                                                     |

## 4. Differences to know before the session

- **Face template on the server** (scenario step 1). Agreed with Team 2 on 2026-09-26 and stated in the
  consent text and the privacy policy. A passkey is always available instead.
- **Withdrawal wording** (R09, step 7). Team 2 expects a caution that some learned patterns may persist
  until retraining. SecureAI stores no trained model: the topic profile is rebuilt from current files on
  every view, and the suggestion model on every prediction. So "nothing it picked up from your writing
  remains" is accurate here, and the caution would be untrue. If a stored model is ever added, the wording
  has to change with it.
- **Per file, not per person** (scenario step 3). The strictest answer on a file decides what uses it.
- **No generative output, no link import** (R05, R07, R20, steps 4 and 6). These tests have nothing to act
  on.
- **Consents per account** (case study item 1). Storage consent is asked once at sign-up.
- **Database disk not encrypted** (R17). Files and face templates are encrypted by the app; the production
  database disk is not (R-DP-5).
- **Hosting in the United States** (R11, step 8). Documented; the APP 8 safeguards are open.

## 5. What changed for these tests (2026-10-15)

| Change                                                                                                     | Why                                                                                                      | Record                         |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------ |
| After withdrawing personalisation, an offer to delete the files it read (web and phone)                    | Weeks 3-4 section 7; scenario step 7                                                                     | docs/04 R-PRIV-11              |
| A notice before uploading a voice recording or video, naming voice cloning                                 | Weeks 3-4 consent matrix; scenario step 5                                                                | This document, section 2       |
| The phone app asks who else a file shows, and lets the answer change later                                 | Bystander Consent Policy section 3: the web app already asked                                            | docs/08 §5h                    |
| People in a file who have an account are asked directly                                                    | Bystander Consent Policy section 4, first row; case study item 2                                         | docs/04 R-PRIV-10, docs/08 §5h |
| The topic profile reads writing in every language; a fairness spot-check on the AI Security page and in CI | R13. The check found that Hindi, Chinese and Arabic writers got no topics, and that accented words broke | docs/04 R-ML-12, docs/11 §5a   |
| Privacy policy version 2026-10-15                                                                          | Sections 2, 5, 6 and 11 describe the above                                                               | docs/08 §5h                    |
