# Data Source Acceptability Matrix (received from Team 2)

Received from Team 2 on 2026-09-09 — this is their actual Week 5-6 Acceptability Matrix deliverable,
not a placeholder. It's the direct input `docs/08_Requests_to_Team2.md` §3 named as "the one item that
genuinely blocks further build work": Team 1's `consent_gate()` (both the standalone PoC and the live
`behaviorModel.ts`) tags every record with a source/consent identifier but had no allowed-sources list to
check it against. This doc is that list. Transcribed here verbatim (tables reformatted for markdown; no
content added, removed, or reworded) so it lives in-repo as the authoritative reference, not only in a
PDF handoff. See `08_Requests_to_Team2.md` §3 for what changes in Team 1's own docs/code as a result,
and the one clarifying question sent back.

## 1. Privacy tiers

| Tier | Definition | Examples | Protection (Team 1) |
|---|---|---|---|
| T0 — Non-personal | Aggregated or anonymised; doesn't identify a person | Anonymised usage metrics, logs without PII | Standard security |
| T1 — Basic personal | Identifies a person but isn't sensitive | Name, email, account ID | Access control, encryption, minimisation |
| T2 — Sensitive personal | Intimate or financial; higher harm if exposed | Diaries, personal documents, payment data | Strict access, explicit consent, purpose limitation |
| T3 — Special-category / biometric | Uniquely identifies someone or reveals a protected trait; often can't be reissued if compromised | Voice, face or video, health- or belief-revealing content, device biometric templates | Highest: separate explicit consent, encryption plus isolation, strict retention, never shared or sold |

## 2. Copyright IP risk levels

| Level | Definition | Notes |
|---|---|---|
| Low | User clearly owns the rights, or the content is free to use | e.g. the user's own photos, their own writing |
| Medium | Ownership is likely but not confirmed, or a license is probably obtainable | e.g. traditional commercial photography, commissioned work from before 1998 in Australia |
| High | Third-party copyright is confirmed and a license is required, or the platform's terms explicitly rule out this use | e.g. published books, YouTube/TikTok/Meta content — scraping is banned outright in their terms of service |

## 3. Data type × consent × copyright matrix

| Data type | Privacy tier | Consent approach | Service-Use Consent | Training Consent | Copyright risk | Third parties? | Key concern |
|---|---|---|---|---|---|---|---|
| Account and login data (name, email) | T1 | Standard service consent, bundled with account creation is acceptable here since it's operationally necessary | Required (contractual) | Not used for training | Low | No | Basic PII, so minimise what's collected and keep it secure. Not usable for personalisation or training under any circumstance |
| Subscription / payment data | T2 | Standard service consent, bundled with account creation is acceptable here since it's operationally necessary | Required (contractual) | Not used for training | Low | No | Financial data — shouldn't be reused for personalisation. Likely sits under a separate PCI-DSS regime anyway |
| Device-native biometric (2FA) | T3 | Explicit, authentication-only consent, separate consent | Explicit opt-in | Not used for training | N/A | No (self) | The template stays on the device and is excluded from training or personalisation entirely, by design |
| Uploaded text (diaries, documents) | T2 (T3 if it touches a special category) | Explicit, per-purpose consent naming the specific use (e.g. "personalise your AI's writing style") | Explicit, per upload type | Separate explicit opt-in | Low | Sometimes — names other people | Intimate content that can incidentally expose people who never agreed to any of this |
| Uploaded photos — family/group | T3 | Explicit consent from the uploader, plus a distinct bystander-consent workflow | Explicit, per upload type | Separate explicit opt-in | Low | Yes — bystanders, possibly minors | Faces are close to biometric data. People never agreed to this, and minors need a stricter path than adult bystanders do |
| Uploaded photos with incidental third-party IP (e.g. a branded character in frame) | T2 | *(not specified in source)* | Explicit, per upload type | Separate explicit opt-in | Medium–High | Possible | Copyright risk here is independent of anyone's consent status |
| Uploaded video | T3 | Same as photos, plus a specific mention that voice and likeness may be used for personalisation | Explicit, per upload type | Separate explicit opt-in | Low | Yes | Face and voice together raise the deepfake risk above what a still photo carries |
| Uploaded audio / voice | T3 | Explicit consent, specifically naming voice cloning/personalisation as the use, not folded into a general "audio" consent | Explicit, per upload type | Separate explicit opt-in | Low–High | Sometimes — other voices | Voice cloning and vishing risk. For music covers specifically, the composer still holds rights even though the user recorded it |
| Third-party content uploaded by a user (a friend's photo, a grandparent's diary, a deceased person's voicemail) | T3 | Not obtainable from the individual | Governed by Acceptability matrix | Governed by Acceptability matrix | High | Yes — the uploader has no rights to it | The deceased-person case is different from the others: consent isn't pending, it's permanently out of reach |
| Public / third-party content — published books, news, blogs | T0–T1 | Not obtainable from the individual | Governed by Acceptability matrix | Governed by Acceptability matrix | High | Yes — author or publisher | The author agreed to publication, not to AI training. A license is still needed |
| Public / third-party content — social media | T2–T3 | The app cannot obtain consent from the original creator — default position is exclusion from training pending the Week 5-6 Acceptability Matrix (i.e. this document) | Not obtainable from the individual | Governed by Acceptability matrix | High | Yes — the platform and individuals | Being public doesn't mean it's fair game. Meta, YouTube and TikTok all ban scraping in their terms |
| Derived "AI profile" (model weights, embeddings) | Inherits up to T3 | Covered by the upstream consents that fed it, not a separate consent event | Implied by upstream consent | Implied by upstream consent | Inherits | Inherits from whatever it was trained on | This is an opaque profile built from sensitive inputs. Users need to be able to see it and delete it, and withdrawal creates a dependency back to the source records |
| AI-generated outputs | Varies | Covered by the upstream consents that fed it, not a separate consent event | Implied by upstream consent | Implied by upstream consent | — | Can depict real people | Impersonation risk. Needs to be labelled as AI-generated |

## 4. Copyright reference (supporting the risk column above)

General notes (Team 2's own):
- Copyright duration varies by territory. Many territories: life of the creator (or last surviving
  creator) + 70 years; some differ (e.g. China: 50 years from the death of the author).
- After the creator's death, copyright may pass to their estate or to a company (media or private equity).
- If the author is unknown, copyright lasts longer in the U.S.
- Likeness rights last the person's lifetime.
- Copyright rules generally follow where a work was first created/published; if produced somewhere with
  a shorter term, the longer term of a region where it's also protected can still apply there.

Length — Australia / UK / EU:

| Media type | Australia | UK | EU |
|---|---|---|---|
| Standard works* | Life of author + 70 years | Life of author + 70 years | Life of author + 70 years |
| Sound recordings | 70 years from first published/made public | 70 years from first published, or 50 years if not published | 70 years from first published/made public |
| Films | 70 years from first published/made public | 70 years after death of the last key creator** | 70 years after death of the last key creator** |
| Government | 50 years from creation or first publication | No standardised length across region | — |
| Broadcasts | 50 years after broadcast | 50 years after broadcast | 50 years after broadcast |
| Published editions | 25 years from first publication | 25 years from first publication | No standardised length across region |

*Standard works: literary, dramatic, musical, artistic. **Key creators: principal director, screenplay
author, dialogue writer, composer of the music. Table not exhaustive; exceptions may apply.

Length — United States:

| Type of work | Duration |
|---|---|
| Works created after 1 Jan 1978 | Life of author + 70 years |
| Anonymous / pseudonymous / works for hire | 95 years from first publication, or 120 years from creation, whichever is shorter |
| Works created before 1 Jan 1978 | Varies by statutory dates and publication status; max 95 years from publication for older works still in copyright |

Outliers: in a translation, the original author retains rights to the original work; the translator
has rights to their translation, but permission from the original copyright holder is required unless the
original is in the public domain.

Ownership defaults (Team 2's own):
- User-produced content: the user typically holds copyright, unless produced as part of their job (then
  the employer holds it).
- Third-party traditional media: copyright held by the creator/media company; a licensing agreement is
  required to use it.
- Third-party social media: copyright held by the creator; the user grants the *platform* a license under
  its own ToS — that license doesn't extend to a third party like this app. A separate licence to use the
  content may be obtainable from some platforms.
