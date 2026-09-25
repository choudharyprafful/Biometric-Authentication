/**
 * Real AV-engine integration: a from-scratch client for clamd's documented
 * wire protocol (INSTREAM, PING, VERSION — see clamd(8)), speakable to any
 * clamd reachable over TCP once CLAMD_HOST is set.
 *
 * In production clamd runs on the API's own instance, bound to 127.0.0.1
 * and installed by the deploy hook in .platform/hooks/prebuild/10_clamav.sh
 * (Amazon Linux 2023's ClamAV 1.4 LTS packages, signatures kept current by
 * freshclam). Local development has no clamd, leaves CLAMD_HOST unset, and
 * gets the signature-only checks in malwareScan.ts.
 *
 * A cloud-API alternative (VirusTotal etc.) was deliberately NOT used:
 * sending a user's uploaded file to a third party before it's ever
 * encrypted would be a privacy regression against this app's "never
 * process plaintext unnecessarily" posture.
 *
 * lib/clamdClient.verify.ts checks the framing and response parsing against
 * a fake clamd; the deploy hook checks the real engine by streaming the
 * EICAR test file through it before the API starts.
 */

import net from "node:net";

export interface ClamdResult {
  available: boolean; // false = clamd wasn't configured or wasn't reachable — caller should fall back, not treat this as "clean"
  clean: boolean;
  reason: string | null;
}

const NOT_CONFIGURED: ClamdResult = { available: false, clean: true, reason: null };

// clamd's own documented default chunk-size ceiling is much larger, but a
// conservative fixed size keeps this simple and keeps any one chunk well
// under typical socket buffer sizes.
const CHUNK_SIZE = 8192;
const CONNECT_TIMEOUT_MS = 5000;
const RESPONSE_TIMEOUT_MS = 10000;

/**
 * Speaks clamd's INSTREAM protocol over a plain TCP socket:
 * 1. Send the command "zINSTREAM\0".
 * 2. Send the file as a sequence of (4-byte big-endian length + chunk)
 *    frames, terminated by a zero-length frame.
 * 3. Read one response line: "stream: OK" (clean) or
 *    "stream: <signature name> FOUND" (infected) — anything else, or any
 *    connection/timeout failure, is treated as "not available" so a clamd
 *    outage degrades to signature-only scanning rather than blocking every
 *    upload or (worse) silently treating an unreachable scanner as "clean".
 */
export function scanWithClamd(buffer: Buffer, host: string | undefined, port: number): Promise<ClamdResult> {
  if (!host) return Promise.resolve(NOT_CONFIGURED);

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let responseBuffer = Buffer.alloc(0);

    const finish = (result: ClamdResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("timeout", () => finish({ available: false, clean: true, reason: "clamd connection timed out" }));
    socket.once("error", () => finish({ available: false, clean: true, reason: "clamd unreachable" }));

    socket.once("connect", () => {
      socket.setTimeout(RESPONSE_TIMEOUT_MS);
      socket.write("zINSTREAM\0");

      let offset = 0;
      while (offset < buffer.length) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
        const lengthPrefix = Buffer.alloc(4);
        lengthPrefix.writeUInt32BE(chunk.length, 0);
        socket.write(lengthPrefix);
        socket.write(chunk);
        offset += CHUNK_SIZE;
      }
      // Zero-length chunk signals end-of-stream to clamd.
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32BE(0, 0);
      socket.write(terminator);
    });

    socket.on("data", (data: Buffer | string) => {
      responseBuffer = Buffer.concat([responseBuffer, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
      // clamd terminates its INSTREAM reply with a NUL byte.
      if (responseBuffer.includes(0)) {
        const line = responseBuffer.toString("utf8").replace(/\0/g, "").trim();
        if (line.endsWith("OK")) {
          finish({ available: true, clean: true, reason: null });
        } else if (line.includes("FOUND")) {
          const match = /stream:\s*(.+?)\s+FOUND/.exec(line);
          finish({ available: true, clean: false, reason: `clamd detected: ${match?.[1] ?? "unknown signature"}` });
        } else {
          finish({ available: false, clean: true, reason: `unrecognised clamd response: ${line}` });
        }
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Sends one short clamd command ("PING", "VERSION") and returns its reply
 * line, or null if clamd is unreachable or silent.
 */
export function clamdCommand(command: string, host: string, port: number, timeoutMs = CONNECT_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finish(null));
    socket.once("error", () => finish(null));
    socket.once("connect", () => socket.write(`z${command}\0`));
    socket.on("data", (data: Buffer | string) => {
      reply = Buffer.concat([reply, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
      if (reply.includes(0)) finish(reply.toString("utf8").replace(/\0/g, "").trim());
    });
    socket.once("end", () => finish(reply.length ? reply.toString("utf8").replace(/\0/g, "").trim() : null));
    socket.connect(port, host);
  });
}

/** CLAMD_HOST/CLAMD_PORT, read on each call so tests can flip them without a
 *  restart. Port defaults to clamd's standard 3310. Null when unset. */
export function clamdTarget(): { host: string; port: number } | null {
  const host = process.env["CLAMD_HOST"];
  if (!host) return null;
  return { host, port: Number(process.env["CLAMD_PORT"] ?? 3310) };
}

export function scanWithClamdIfConfigured(buffer: Buffer): Promise<ClamdResult> {
  const target = clamdTarget();
  return scanWithClamd(buffer, target?.host, target?.port ?? 3310);
}

/**
 * Logs whether the configured clamd answers, and which engine and signature
 * version it runs. Retries for a while because clamd can still be loading
 * its signatures when the API starts. Informational only: uploads decide
 * per request.
 */
export async function logClamdStatusAtStartup(log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): Promise<void> {
  const target = clamdTarget();
  if (!target) {
    log.info({}, "Upload scanning: signature checks only (CLAMD_HOST not set)");
    return;
  }
  for (let attempt = 1; attempt <= 12; attempt++) {
    const version = await clamdCommand("VERSION", target.host, target.port);
    if (version) {
      log.info({ clamd: version }, "Upload scanning: ClamAV reachable");
      return;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  log.warn(target, "Upload scanning: ClamAV not reachable; uploads are refused until it answers");
}
