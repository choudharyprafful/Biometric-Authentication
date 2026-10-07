/**
 * Video (MP4/MOV) location-metadata stripping — the video counterpart of
 * imageSafety.ts, which explicitly deferred this as "needs a real MP4
 * parsing library, not a demo-scope hand-rolled one." Revisited: MP4/MOV
 * (ISO/IEC 14496-12, "ISO base media file format") is a length-prefixed,
 * strictly-typed box/atom tree — structurally the same shape as the PNG
 * chunk format imageSafety.ts already parses safely — which does make a
 * real, safe fix possible, provided one specific danger is handled
 * correctly (see below). The actual video/audio sample bytes live in a
 * separate top-level 'mdat' box that this code never walks into or
 * modifies; the only box ever rewritten is 'moov > udta', a small
 * (typically low-KB) metadata container.
 *
 * The one real danger: chunk-offset tables inside 'moov' ('stco'/'co64')
 * store ABSOLUTE byte offsets into 'mdat'. If 'moov' sits BEFORE 'mdat' in
 * the file (common for "fast-start"/streaming-optimised exports) and we
 * shrink 'moov', every byte after it — including all of 'mdat' — shifts
 * left, silently invalidating those offset tables without touching a
 * single sample byte. That is exactly the "subtle corruption a naive fix
 * risks" scenario the original decision was right to avoid. This
 * implementation checks box order first and only strips when 'mdat' comes
 * entirely before 'moov' (shrinking 'moov' then can't move anything the
 * offset tables reference) — the common case for camera-original,
 * non-streaming-optimised MOV/MP4 files. Any other layout (streaming-
 * optimised exports, fragmented MP4 with 'moof', anything that doesn't
 * parse exactly as expected) fails open to the original, untouched buffer
 * — identical philosophy to every parser in imageSafety.ts.
 *
 * Scope, stated honestly: strips the QuickTime-style GPS coordinate atom
 * ('©xyz' — the literal "location data" the brief asks about, and the
 * direct video equivalent of a JPEG's GPS EXIF tag). Does not attempt the
 * ISO 'meta'/'keys'/'ilst' positional key-value metadata scheme some files
 * also carry (safely rewriting it means re-deriving index references
 * throughout — meaningfully higher risk for what this file is). Only
 * recognises the MP4/MOV container; WebM (Matroska-based, a structurally
 * different format) is not covered — same "detected format, not declared
 * type" honesty imageSafety.ts already applies to images.
 */

interface Box {
  type: string;
  headerSize: number; // bytes before the payload (8, or 16 for a 64-bit size)
  start: number; // absolute offset of the box, including its header
  contentStart: number; // absolute offset where the payload begins
  end: number; // absolute offset just past the box (exclusive)
}

/** Reads one box starting at `offset`, bounded by `limit`. Returns null on
 *  anything that doesn't parse as a well-formed box within those bounds. */
function readBox(buffer: Buffer, offset: number, limit: number): Box | null {
  if (offset + 8 > limit) return null;
  const size32 = buffer.readUInt32BE(offset);
  const type = buffer.toString("latin1", offset + 4, offset + 8); // latin1, not ascii — box types can use high-bit bytes (e.g. '\xa9xyz'), which "ascii" would silently mangle

  let headerSize = 8;
  let size: number;
  if (size32 === 1) {
    if (offset + 16 > limit) return null;
    const big = buffer.readBigUInt64BE(offset + 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(big);
    headerSize = 16;
  } else if (size32 === 0) {
    size = limit - offset; // box extends to the end of its parent
  } else {
    size = size32;
  }

  if (size < headerSize || offset + size > limit) return null;
  return {
    type,
    headerSize,
    start: offset,
    contentStart: offset + headerSize,
    end: offset + size,
  };
}

/** Walks every sibling box in [offset, limit). Returns null if any box in
 *  the sequence fails to parse cleanly. */
function readBoxes(
  buffer: Buffer,
  offset: number,
  limit: number,
): Box[] | null {
  const boxes: Box[] = [];
  let pos = offset;
  while (pos < limit) {
    const box = readBox(buffer, pos, limit);
    if (!box) return null;
    boxes.push(box);
    pos = box.end;
  }
  return boxes;
}

function rebuildBox(type: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + content.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, content]);
}

const GPS_ATOM_TYPE = "©xyz"; // QuickTime GPS coordinate atom, e.g. "+37.3346-122.0090/"

/** Strips the GPS atom from 'moov > udta' when it's safe to do so. Returns
 *  the original buffer, byte-for-byte, whenever it isn't confident that's
 *  safe — including simply "there was nothing to strip." */
export function stripVideoMetadata(buffer: Buffer): Buffer {
  try {
    const topLevel = readBoxes(buffer, 0, buffer.length);
    if (!topLevel) return buffer;

    // Fragmented MP4 ('moof') has different, non-absolute offset semantics
    // this code doesn't reason about — out of scope, fail open.
    if (topLevel.some((b) => b.type === "moof")) return buffer;

    const moov = topLevel.find((b) => b.type === "moov");
    const mdat = topLevel.find((b) => b.type === "mdat");
    if (!moov || !mdat) return buffer;

    // The one safety-critical check — see module comment. If 'moov' isn't
    // entirely after 'mdat', shrinking it could move 'mdat' and silently
    // invalidate the sample offset tables ('stco'/'co64') moov itself
    // contains. Only proceed in the provably-safe layout.
    if (moov.start < mdat.end) return buffer;

    const moovChildren = readBoxes(buffer, moov.contentStart, moov.end);
    if (!moovChildren) return buffer;

    const udta = moovChildren.find((b) => b.type === "udta");
    if (!udta) return buffer;

    const udtaChildren = readBoxes(buffer, udta.contentStart, udta.end);
    if (!udtaChildren) return buffer;

    if (!udtaChildren.some((b) => b.type === GPS_ATOM_TYPE)) return buffer; // nothing to strip

    const keptUdtaChildren = udtaChildren.filter(
      (b) => b.type !== GPS_ATOM_TYPE,
    );
    const newUdtaContent = Buffer.concat(
      keptUdtaChildren.map((b) => buffer.subarray(b.start, b.end)),
    );
    const newUdta = rebuildBox("udta", newUdtaContent);

    const newMoovContent = Buffer.concat(
      moovChildren.map((b) =>
        b.type === "udta" ? newUdta : buffer.subarray(b.start, b.end),
      ),
    );
    const newMoov = rebuildBox("moov", newMoovContent);

    return Buffer.concat(
      topLevel.map((b) =>
        b.type === "moov" ? newMoov : buffer.subarray(b.start, b.end),
      ),
    );
  } catch {
    return buffer; // stripping must never be the reason an upload fails
  }
}
