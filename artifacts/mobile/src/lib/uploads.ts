import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { request } from './api';

export interface UploadMeta {
  id: number;
  userId: number;
  fileName: string;
  mimeType: string;
  fileType: 'image' | 'video' | 'text' | 'audio';
  sizeBytes: number;
  createdAt: string;
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
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64ToUtf8(base64: string): string {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
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
  let result = '';
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
      result += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else {
      result += String.fromCharCode(b0);
      i += 1;
    }
  }
  return result;
}

export async function listUploads(): Promise<UploadMeta[]> {
  return request('/uploads');
}

export async function getUpload(id: number): Promise<UploadContent> {
  return request(`/uploads/${id}`);
}

export async function deleteUpload(id: number): Promise<void> {
  await request(`/uploads/${id}`, { method: 'DELETE' });
}

// Opens the OS document picker, reads the picked file as base64 (RN has no
// FileReader/Blob the way a browser does — expo-file-system is the
// equivalent primitive), and uploads it. Returns null if the user cancelled.
export async function pickAndUploadFile(): Promise<UploadMeta | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'video/*', 'audio/*', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File must be under ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`);
  }

  const dataBase64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
  return request('/uploads', {
    method: 'POST',
    body: { fileName: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream', dataBase64 },
  });
}

// There's no browser "Downloads folder" on mobile — write the decrypted
// bytes to a temp file and hand off to the OS share sheet, which lets the
// user save it wherever they want (Files app, another app, etc.). This is
// the standard RN equivalent of a browser's <a download> trick.
export async function downloadAndShare(upload: UploadContent): Promise<void> {
  const dest = `${FileSystem.cacheDirectory}${upload.fileName}`;
  await FileSystem.writeAsStringAsync(dest, upload.dataBase64, { encoding: FileSystem.EncodingType.Base64 });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(dest, { mimeType: upload.mimeType });
  }
}
