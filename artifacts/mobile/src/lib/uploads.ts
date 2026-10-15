import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { request } from "./api";

// Mirrors the server enum in api-server/src/lib/dataProvenance.ts, which is
// Team 2's acceptability matrix turned into rules. Labels are written from
// the uploader's point of view, not in the matrix's own vocabulary — the
// person picking one hasn't read that document.
export type ContentSource =
  | "own_work"
  | "third_party_individual"
  | "published_work"
  | "social_media"
  | "incidental_third_party_ip";

export const CONTENT_SOURCE_OPTIONS: Array<{
  value: ContentSource;
  label: string;
}> = [
  { value: "own_work", label: "My own work" },
  { value: "third_party_individual", label: "Someone else's work" },
  { value: "published_work", label: "Published book / article / news" },
  { value: "social_media", label: "From social media" },
  {
    value: "incidental_third_party_ip",
    label: "Mine, but contains someone else's IP",
  },
];

// Team 2's Bystander Consent Policy: who else a file shows or names, as the uploader says. Mirrors
// BystanderKind in the API (lib/dataProvenance.ts) and the web app's components/PeopleInFile.tsx.
export type BystanderKind =
  "reachable" | "account" | "unreachable" | "minor" | "deceased";

export interface PeopleRequest {
  bystanders: BystanderKind[];
  bystanderStatement: string | null;
  // Addresses of people in it with a SecureAI account, who are asked directly.
  consentRequestEmails: string[];
}

/** One person with an account the uploader asked, and their answers so far (null until answered). */
export interface UploadConsentRequest {
  email: string;
  personalisation: boolean | null;
  sharedTraining: boolean | null;
  answeredAt: string | null;
}

/** A request to this account about someone else's file that shows it. */
export interface IncomingConsentRequest {
  id: number;
  fromName: string;
  fromEmail: string;
  fileName: string;
  fileType: "image" | "video" | "text" | "audio";
  uploadedAt: string;
  requestedAt: string;
  personalisation: boolean | null;
  sharedTraining: boolean | null;
  answeredAt: string | null;
}

export interface UploadMeta {
  id: number;
  userId: number;
  fileName: string;
  mimeType: string;
  fileType: "image" | "video" | "text" | "audio";
  sizeBytes: number;
  createdAt: string;
  contentSource: ContentSource | "unspecified";
  trainingEligible: boolean;
  trainingExclusionReason?: string;
  // Absent from API versions before the bystander policy; null when never asked.
  bystanders?: BystanderKind[] | null;
  bystanderStatement?: string | null;
  pausedForReviewAt?: string | null;
  consentRequests?: UploadConsentRequest[];
}

// Shown before a voice recording or video is uploaded (Team 2's consent matrix, section 9; the
// scenario script's step 5). Same words as the web app (secureai src/pages/Uploads.tsx): no
// feature reads these files, so this says what happens rather than asking for a consent.
export const MEDIA_NOTICE: Record<
  "audio" | "video",
  { title: string; text: string }
> = {
  audio: {
    title: "Voice recording",
    text: "It's stored encrypted, for you to play back and download. No feature uses voice recordings: nothing is trained on them, nothing is personalised from them, and SecureAI never copies (clones) a voice. If that ever changes, you'll be asked first, in a separate consent that names voice cloning.",
  },
  video: {
    title: "Video",
    text: "It's stored encrypted, for you to watch and download. No feature uses videos: nothing is trained on them, nothing is personalised from them, and SecureAI never copies a face or a voice from them. If that ever changes, you'll be asked first, in a separate consent that names it.",
  },
};

export function mediaKind(mimeType: string): "audio" | "video" | null {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

export interface PickedFile {
  name: string;
  mimeType: string;
  uri: string;
}

export interface UploadContent extends UploadMeta {
  dataBase64: string;
}

// 15MB mirrors the server's MAX_UPLOAD_BYTES (routes/uploads.ts) — checked
// here too so a too-large file fails fast instead of wasting a full upload
// round-trip before the server rejects it.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// RN/Hermes has no guaranteed global atob/Buffer — this is a self-contained
// base64 -> UTF-8 decoder so text-file preview doesn't need a new dependency.
const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function base64ToUtf8(base64: string): string {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = BASE64_CHARS.indexOf(clean[i]);
    const e2 = BASE64_CHARS.indexOf(clean[i + 1]);
    const e3 = clean[i + 2] ? BASE64_CHARS.indexOf(clean[i + 2]) : -1;
    const e4 = clean[i + 3] ? BASE64_CHARS.indexOf(clean[i + 3]) : -1;
    bytes.push((e1 << 2) | (e2 >> 4));
    if (e3 >= 0) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 >= 0) bytes.push(((e3 & 3) << 6) | e4);
  }
  // Decode UTF-8 byte sequence to a JS string.
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i += 1;
    } else if (b0 >= 0xc0 && b0 < 0xe0 && i + 1 < bytes.length) {
      result += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 >= 0xe0 && i + 2 < bytes.length) {
      result += String.fromCharCode(
        ((b0 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      result += String.fromCharCode(b0);
      i += 1;
    }
  }
  return result;
}

export async function listUploads(): Promise<UploadMeta[]> {
  return request("/uploads");
}

export async function getUpload(id: number): Promise<UploadContent> {
  return request(`/uploads/${id}`);
}

export async function deleteUpload(id: number): Promise<void> {
  await request(`/uploads/${id}`, { method: "DELETE" });
}

// Opens the OS document picker. Returns null if the user cancelled. Picking and uploading are
// separate steps so a voice recording or video can show its notice in between.
export async function pickFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["image/*", "video/*", "audio/*", "text/plain"],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }
  return {
    name: asset.name,
    mimeType: asset.mimeType ?? "application/octet-stream",
    uri: asset.uri,
  };
}

// Reads the picked file as base64 (RN has no FileReader/Blob the way a browser does —
// expo-file-system is the equivalent primitive) and uploads it with the uploader's answers.
export async function uploadPickedFile(
  file: PickedFile,
  contentSource: ContentSource,
  people: PeopleRequest,
): Promise<UploadMeta> {
  const dataBase64 = await FileSystem.readAsStringAsync(file.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return request("/uploads", {
    method: "POST",
    body: {
      fileName: file.name,
      mimeType: file.mimeType,
      dataBase64,
      contentSource,
      ...people,
    },
  });
}

// Policy section 3: the uploader can say who else a file shows at any time, not only at upload.
export async function declareUploadPeople(
  id: number,
  people: PeopleRequest,
): Promise<UploadMeta> {
  return request(`/uploads/${id}/people`, { method: "POST", body: people });
}

// Team 2's Bystander Consent Policy, section 4, first row: requests to this account, answered per use.
export async function listIncomingConsentRequests(): Promise<
  IncomingConsentRequest[]
> {
  return request("/bystander-consent-requests");
}

export async function answerConsentRequest(
  id: number,
  answer: { personalisation: boolean; sharedTraining: boolean },
): Promise<IncomingConsentRequest> {
  return request(`/bystander-consent-requests/${id}/answer`, {
    method: "POST",
    body: answer,
  });
}

// There's no browser "Downloads folder" on mobile — write the decrypted
// bytes to a temp file and hand off to the OS share sheet, which lets the
// user save it wherever they want (Files app, another app, etc.). This is
// the standard RN equivalent of a browser's <a download> trick.
export async function downloadAndShare(upload: UploadContent): Promise<void> {
  const dest = `${FileSystem.cacheDirectory}${upload.fileName}`;
  await FileSystem.writeAsStringAsync(dest, upload.dataBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(dest, { mimeType: upload.mimeType });
    }
  } finally {
    // The file is stored encrypted on the server; once the share sheet has closed, don't leave
    // a decrypted copy in the app's cache (MASVS-STORAGE-1).
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
  }
}
