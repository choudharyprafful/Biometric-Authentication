/**
 * Uploads are treated as hostile input (brief ground rule): before an image
 * is encrypted and stored, strip embedded metadata (EXIF/GPS location, PNG
 * text chunks) and identify what format the bytes actually are, rather
 * than trusting the client's declared Content-Type at all. That distinction
 * matters: a browser's `file.type` for a locally-picked file is commonly
 * derived from the file extension, not the content, so a real (and
 * initially confusing) bug report — a legitimate WebP image saved from a
 * website with a `.png` extension being rejected as "doesn't match the
 * declared type" — showed that verifying against the *declared* subtype
 * was the wrong check. Detecting the real format and using that for both
 * validation and stripping is the fix (`detectImageFormat`). No external
 * dependency — all four formats below are simple enough to parse at the
 * segment/chunk level without a full image decode.
 *
 * Video is explicitly NOT covered here, even though MP4/MOV containers can
 * carry GPS metadata (in their own moov/udta atom structure). That's a
 * different, harder container format — a hand-rolled atom walker risks
 * silently corrupting video files in a way a malformed JPEG/PNG/GIF/WebP
 * segment walker doesn't (this code fails open to the original bytes on
 * anything unexpected, which is a much safer failure mode for a still image
 * than for video, where subtle corruption may not be immediately visible).
 * Doing this properly needs a real MP4 parsing library, not a demo-scope
 * hand-rolled one — tracked as an accepted, documented limitation rather
 * than a silent gap.
 */

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;

/** Strips APPn (EXIF/XMP, markers 0xE0-0xEF) and COM (0xFE) segments from a
 *  JPEG. Leaves compressed scan data (after SOS) untouched. Fails open —
 *  returns the original buffer unchanged if the structure looks malformed,
 *  rather than risk corrupting the image. */
function stripJpegMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== JPEG_SOI) return buffer;

  const segments: Buffer[] = [Buffer.from([0xff, JPEG_SOI])];
  let offset = 2;

  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) return buffer; // not a marker where we expected one — bail out safely

    const marker = buffer[offset + 1];
    if (marker === JPEG_SOI || marker === JPEG_EOI) {
      offset += 2;
      continue;
    }
    if (marker === JPEG_SOS) {
      segments.push(buffer.subarray(offset)); // rest of file is scan data — copy as-is
      return Buffer.concat(segments);
    }

    if (offset + 4 > buffer.length) return buffer;
    const length = buffer.readUInt16BE(offset + 2);
    const segmentEnd = offset + 2 + length;
    if (length < 2 || segmentEnd > buffer.length) return buffer;

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) {
      segments.push(buffer.subarray(offset, segmentEnd));
    }
    offset = segmentEnd;
  }

  return buffer; // never hit SOS/EOF cleanly — bail out to the original rather than truncate it
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** Strips text/EXIF/timestamp ancillary chunks from a PNG, leaving
 *  everything that affects rendering untouched. Fails open on anything
 *  that doesn't parse as expected. */
function stripPngMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return buffer;

  const chunks: Buffer[] = [PNG_SIGNATURE];
  let offset = 8;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunkEnd = offset + 12 + length; // length(4) + type(4) + data + crc(4)
    if (length < 0 || chunkEnd > buffer.length) return buffer;

    if (!PNG_METADATA_CHUNKS.has(type)) {
      chunks.push(buffer.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
    if (type === "IEND") break;
  }

  return Buffer.concat(chunks);
}

/** Reads a GIF/WebP-style "read until you hit something you don't
 *  recognise" sub-block sequence: a size byte followed by that many data
 *  bytes, repeated until a zero-size block terminates it. Used for both
 *  GIF extension data and GIF image data, which share this encoding.
 *  Returns the offset just past the terminator, or past the end of the
 *  buffer if the sequence never terminates (caller treats that as
 *  malformed and bails out). */
function readGifSubBlocks(buffer: Buffer, start: number): number {
  let pos = start;
  while (pos < buffer.length) {
    const size = buffer[pos] as number;
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return pos;
}

/** Parses one GIF Extension block (introducer 0x21) starting at `offset`.
 *  Returns null if the buffer is too short/malformed to trust. `keep` is
 *  false only for a Comment Extension (label 0xFE) — every other
 *  extension type (Graphic Control, Plain Text, Application) is rendering-
 *  or behavior-relevant and must be preserved as-is. */
function parseGifExtensionBlock(buffer: Buffer, offset: number): { end: number; keep: boolean } | null {
  if (offset + 2 > buffer.length) return null;
  const label = buffer[offset + 1];
  const end = readGifSubBlocks(buffer, offset + 2);
  if (end > buffer.length) return null;
  return { end, keep: label !== 0xfe };
}

/** Parses one GIF Image Descriptor block (introducer 0x2C) starting at
 *  `offset`, walking past its optional local color table and LZW-encoded
 *  image data. Returns the end offset, or null if malformed. This block is
 *  always kept in full — it's pixel data, never metadata. */
function parseGifImageBlock(buffer: Buffer, offset: number): number | null {
  if (offset + 10 > buffer.length) return null;
  const imagePacked = buffer[offset + 9] as number;
  let dataStart = offset + 10;
  if (imagePacked & 0x80) {
    dataStart += 3 * 2 ** ((imagePacked & 0x07) + 1); // local color table
  }
  if (dataStart + 1 > buffer.length) return null;
  const end = readGifSubBlocks(buffer, dataStart + 1); // +1 skips LZW min code size byte
  return end > buffer.length ? null : end;
}

/** Offset just past the GIF header (signature + Logical Screen Descriptor
 *  + optional Global Color Table), or null if the buffer doesn't look like
 *  a valid GIF at all. */
function gifHeaderEnd(buffer: Buffer): number | null {
  if (buffer.length < 13) return null;
  const signature = buffer.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  const screenPacked = buffer[10] as number;
  let offset = 13;
  if (screenPacked & 0x80) {
    offset += 3 * 2 ** ((screenPacked & 0x07) + 1); // global color table
  }
  return offset > buffer.length ? null : offset;
}

/** One step of the GIF body walk: what to keep (if anything) and where the
 *  next block starts. `null` means malformed/unrecognised — caller bails
 *  out to the original buffer. `done` means the trailer was reached. */
function gifBodyStep(buffer: Buffer, offset: number): { end: number; output: Buffer | null; done: boolean } | null {
  const marker = buffer[offset];

  if (marker === 0x3b) return { end: offset + 1, output: buffer.subarray(offset, offset + 1), done: true };

  if (marker === 0x21) {
    const block = parseGifExtensionBlock(buffer, offset);
    if (!block) return null;
    return { end: block.end, output: block.keep ? buffer.subarray(offset, block.end) : null, done: false };
  }

  if (marker === 0x2c) {
    const end = parseGifImageBlock(buffer, offset);
    return end === null ? null : { end, output: buffer.subarray(offset, end), done: false };
  }

  return null; // unrecognised block type
}

/** Strips Comment Extension blocks from a GIF — the closest GIF equivalent
 *  of a JPEG COM segment or PNG tEXt chunk. GIF has no standardised
 *  EXIF/GPS mechanism, so this is the only metadata a GIF can meaningfully
 *  carry. Fails open on anything malformed. */
function stripGifMetadata(buffer: Buffer): Buffer {
  let offset = gifHeaderEnd(buffer);
  if (offset === null) return buffer;

  const out: Buffer[] = [buffer.subarray(0, offset)];

  while (offset < buffer.length) {
    const step = gifBodyStep(buffer, offset);
    if (!step) return buffer; // malformed or unrecognised — bail out to the original
    if (step.output) out.push(step.output);
    offset = step.end;
    if (step.done) break;
  }

  return Buffer.concat(out);
}

const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP "]); // "XMP " has a trailing space per the RIFF FourCC spec

/** Strips EXIF/XMP RIFF chunks from a WebP file — these are the two
 *  metadata chunk types the WebP spec defines as separate from the
 *  chunks needed to decode the image (VP8/VP8L/VP8X/ALPH/ANIM/ANMF/ICCP),
 *  so removing them never affects rendering. Recomputes the RIFF
 *  container's size field afterward. Fails open on anything malformed. */
function stripWebpMetadata(buffer: Buffer): Buffer {
  if (buffer.length < 12) return buffer;
  if (buffer.subarray(0, 4).toString("ascii") !== "RIFF") return buffer;
  if (buffer.subarray(8, 12).toString("ascii") !== "WEBP") return buffer;

  const body: Buffer[] = [buffer.subarray(8, 12)]; // "WEBP" — RIFF size field is recomputed below
  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const fourCC = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const paddedSize = size + (size % 2); // RIFF chunks are padded to an even length
    const chunkEnd = offset + 8 + paddedSize;
    if (chunkEnd > buffer.length) return buffer;

    if (!WEBP_METADATA_CHUNKS.has(fourCC)) {
      body.push(buffer.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  // Trailing bytes that don't form a complete chunk header mean the file is
  // malformed, not that we're done — fail open rather than silently drop
  // them (dropping would return something shorter than the original,
  // subtly different from "unchanged", for a file we don't understand).
  if (offset !== buffer.length) return buffer;

  const content = Buffer.concat(body);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(content.length, 4); // RIFF size excludes "RIFF" itself and this size field
  return Buffer.concat([header, content]);
}

export type DetectedImageFormat = "png" | "jpeg" | "gif" | "webp";

/**
 * Identifies the file's real format from its actual bytes, independent of
 * whatever MIME type the client declared. This matters because a browser's
 * `file.type` for a locally-picked file is commonly derived from the file
 * *extension*, not the content — so a WebP image saved from a website with
 * a `.png` filename (very common; browsers often keep whatever extension
 * was in the source URL) reports as `image/png` while the bytes are really
 * WebP. Rejecting that would be a false positive against a completely
 * legitimate file, found via a real report of exactly this happening.
 */
export function detectImageFormat(buffer: Buffer): DetectedImageFormat | null {
  if (buffer.length < 4) return null;
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") return "gif";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** Best-effort metadata stripping for the formats we can safely parse
 *  (JPEG, PNG, GIF, WebP), dispatched on the format actually detected in
 *  the bytes — never on a client-declared MIME type, which may be wrong
 *  (see `detectImageFormat`). Video passes through unchanged — see the
 *  module comment above for why that's a documented limitation, not an
 *  oversight. */
export function stripImageMetadata(buffer: Buffer, format: DetectedImageFormat): Buffer {
  try {
    if (format === "jpeg") return stripJpegMetadata(buffer);
    if (format === "png") return stripPngMetadata(buffer);
    if (format === "gif") return stripGifMetadata(buffer);
    if (format === "webp") return stripWebpMetadata(buffer);
    return buffer;
  } catch {
    return buffer; // stripping must never be the reason an upload fails
  }
}
