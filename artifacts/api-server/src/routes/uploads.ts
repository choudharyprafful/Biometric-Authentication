import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, uploadsTable } from "@workspace/db";
import {
  CreateUploadBody,
  CreateUploadResponse,
  ListUploadsResponse,
  GetUploadParams,
  GetUploadResponse,
  DeleteUploadParams,
} from "@workspace/api-zod";
import { logEvent } from "../lib/auditLog";
import { encryptFile, decryptFile } from "../lib/fileEncryption";
import { requireMfaEnrolled } from "../middlewares/requireMfaEnrolled";
import { requireParentConsent } from "../middlewares/requireParentConsent";
import { requestRateLimit } from "../middlewares/requestRateLimit";
import { stripImageMetadata, detectImageFormat } from "../lib/imageSafety";
import { stripVideoMetadata } from "../lib/videoSafety";
import { scanBuffer } from "../lib/malwareScan";
import { scanWithClamdIfConfigured } from "../lib/clamdClient";
import { assessTrainingEligibility, isContentSource, type ContentSource } from "../lib/dataProvenance";

const router: IRouter = Router();
router.use(requireParentConsent, requireMfaEnrolled);

// Every upload costs real server work (malware scan + AES encryption) even
// when rejected — 20 per 5 minutes per account is generous for legitimate
// use but stops an authenticated user from turning this into a CPU-burn
// endpoint (OWASP API4:2023, Unrestricted Resource Consumption).
const uploadRateLimit = requestRateLimit("upload", 20, 5 * 60 * 1000);

// Decoded file size cap — the demo stores dummy files only. 15MB comfortably
// covers a typical phone camera JPEG (commonly 5-12MB) or a short clip;
// still a bounded, deliberate limit, not unlimited. Must stay comfortably
// under the /api/uploads JSON body limit in app.ts (base64 inflates size
// ~33%, so this needs real headroom under that limit, not just under it).
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Server derives the file category from the MIME type rather than trusting
// a client-supplied field — every input is hostile until validated.
function classifyMimeType(mimeType: string): "image" | "video" | "text" | "audio" | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/")) return "text";
  if (mimeType.startsWith("audio/")) return "audio";
  return null;
}

function getClientIp(req: import("express").Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

function mapUploadMeta(row: typeof uploadsTable.$inferSelect) {
  // Eligibility is recomputed from the stored source on every read rather
  // than persisted alongside it. The matrix is Team 2's document and can
  // change; a stored boolean would keep answering with the rules that applied
  // the day the file landed, which is exactly the staleness the consent
  // design elsewhere in this app is careful to avoid.
  const eligibility = assessTrainingEligibility(row.contentSource, row.fileType);
  return {
    id: row.id,
    userId: row.userId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileType: row.fileType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    contentSource: row.contentSource,
    trainingEligible: eligibility.eligible,
    ...(eligibility.eligible ? {} : { trainingExclusionReason: eligibility.reason }),
  };
}

// GET /uploads — metadata only, never ciphertext. Owner-only: this is not
// admin-visible like payments/users, since "authorized user" here means the
// uploader alone.
router.get("/uploads", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const uploads = await db.select().from(uploadsTable).where(eq(uploadsTable.userId, userId)).orderBy(desc(uploadsTable.createdAt));
  res.json(ListUploadsResponse.parse(uploads.map(mapUploadMeta)));
});

// POST /uploads
router.post("/uploads", uploadRateLimit, async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const parsed = CreateUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { fileName, mimeType, dataBase64 } = parsed.data;

  // An absent or unrecognised source is stored as "unspecified" rather than
  // rejected. Refusing the upload would punish the user for a governance
  // field, when the safe outcome is simply that the file stays out of every
  // training corpus — it remains fully usable by its owner either way.
  const declaredSource: ContentSource = isContentSource(parsed.data.contentSource)
    ? parsed.data.contentSource
    : "unspecified";

  const fileType = classifyMimeType(mimeType);
  if (!fileType) {
    res.status(400).json({ error: "Unsupported file type — only text, image, video, and audio are allowed" });
    return;
  }

  let plaintext: Buffer;
  try {
    plaintext = Buffer.from(dataBase64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid file data" });
    return;
  }
  if (plaintext.length === 0 || plaintext.length > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: `File must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB` });
    return;
  }

  // Signature-based scan (EICAR test file + masquerading-executable
  // detection) — applies to every type, not just images. See
  // lib/malwareScan.ts for exactly what this does and doesn't cover.
  const scan = scanBuffer(plaintext, mimeType);
  if (!scan.clean) {
    await logEvent({
      eventType: "UPLOAD_SCAN_REJECTED",
      details: `Upload rejected by scan: ${fileName} — ${scan.reason}`,
      userId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(400).json({ error: `File rejected: ${scan.reason}` });
    return;
  }

  // Second, optional layer — a real AV engine via clamd's wire protocol,
  // active only when CLAMD_HOST is configured. No-ops (available: false)
  // when it isn't, or if clamd is unreachable — an infrastructure outage
  // degrades to signature-only scanning rather than blocking every upload.
  // See lib/clamdClient.ts for why this couldn't be verified against a real
  // ClamAV instance in this environment.
  const clamdScan = await scanWithClamdIfConfigured(plaintext);
  if (clamdScan.available && !clamdScan.clean) {
    await logEvent({
      eventType: "UPLOAD_SCAN_REJECTED",
      details: `Upload rejected by clamd: ${fileName} — ${clamdScan.reason}`,
      userId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(400).json({ error: `File rejected: ${clamdScan.reason}` });
    return;
  }

  if (fileType === "image") {
    // Client-declared Content-Type is hostile input — a browser derives
    // file.type from the file EXTENSION for a locally-picked file, not the
    // content, so it can legitimately be wrong (e.g. a WebP saved with a
    // .png name). Detect the real format from the bytes and use that for
    // both validation and stripping, rather than checking against
    // whatever subtype the client happened to declare.
    const detectedFormat = detectImageFormat(plaintext);
    if (!detectedFormat) {
      res.status(400).json({ error: "File content does not look like a valid image (png, jpeg, gif, or webp)" });
      return;
    }
    // Strip EXIF/GPS location and text metadata before it's ever encrypted and stored (brief: "strip photo location data").
    plaintext = stripImageMetadata(plaintext, detectedFormat);
  } else if (fileType === "video") {
    // MP4/MOV GPS-atom stripping — see lib/videoSafety.ts for the full reasoning, including the box-order safety check that keeps this from being the "hand-rolled
    // atom walker risks silent corruption" case this was previously, correctly, deferred over. Never rejects the upload: fails open to the original bytes on
    // anything it isn't confident is safe (e.g. streaming-optimised layout, fragmented MP4, WebM), same as every image parser above.
    plaintext = stripVideoMetadata(plaintext);
  }

  const encrypted = encryptFile(plaintext);
  const [upload] = await db.insert(uploadsTable).values({
    userId,
    fileName,
    mimeType,
    fileType,
    sizeBytes: plaintext.length,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    contentSource: declaredSource,
  }).returning();

  if (!upload) {
    res.status(500).json({ error: "Failed to store file" });
    return;
  }

  const eligibility = assessTrainingEligibility(declaredSource, fileType);

  await logEvent({
    eventType: "UPLOAD_CREATED",
    details:
      `Encrypted ${fileType} file uploaded: ${fileName} (${plaintext.length} bytes), ` +
      `source=${declaredSource}, tier=${eligibility.tier}, copyright=${eligibility.copyrightRisk}`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  // A separate event from UPLOAD_CREATED, deliberately. The provenance
  // decision is a governance outcome rather than a storage one, and a
  // security_analyst reviewing what the models were allowed to learn from
  // should be able to read that as its own trail — including which axis of
  // the matrix refused, which is the part that says whether this is a
  // copyright question or a missing-consent-workflow one.
  if (!eligibility.eligible) {
    await logEvent({
      eventType: "TRAINING_SOURCE_REJECTED",
      details:
        `Upload ${upload.id} excluded from training corpora — blocked by ${eligibility.blockedBy}: ` +
        `${eligibility.reason} (matrix: ${eligibility.matrixRows.join(" | ")})`,
      userId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
  }

  res.status(201).json(CreateUploadResponse.parse(mapUploadMeta(upload)));
});

// GET /uploads/:id — decrypts and returns content. Strictly owner-only, no
// admin bypass: encrypted-at-rest content is only for the uploader.
router.get("/uploads/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = GetUploadParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, params.data.id));
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  if (upload.userId !== userId) {
    await logEvent({
      eventType: "UNAUTHORIZED_ACCESS",
      details: `User ${userId} attempted to access upload ${upload.id} owned by user ${upload.userId}`,
      userId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const plaintext = decryptFile(upload);

  await logEvent({
    eventType: "UPLOAD_DOWNLOADED",
    details: `Decrypted file accessed: ${upload.fileName}`,
    userId,
    ipAddress: getClientIp(req),
    userAgent: req.headers["user-agent"],
  });

  res.json(GetUploadResponse.parse({
    ...mapUploadMeta(upload),
    dataBase64: plaintext.toString("base64"),
  }));
});

// DELETE /uploads/:id — owner-only.
router.delete("/uploads/:id", async (req, res): Promise<void> => {
  const userId = req.session.userId as number;
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const params = DeleteUploadParams.safeParse({ id: Number(rawId) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [upload] = await db.select().from(uploadsTable).where(eq(uploadsTable.id, params.data.id));
  if (!upload) {
    res.status(404).json({ error: "Upload not found" });
    return;
  }
  if (upload.userId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await db.delete(uploadsTable).where(eq(uploadsTable.id, params.data.id));
  await logEvent({ eventType: "UPLOAD_DELETED", details: `Upload deleted: ${upload.fileName} (${upload.fileType}, ${upload.mimeType}, ${upload.sizeBytes} bytes)`, userId });
  res.sendStatus(204);
});

export default router;
