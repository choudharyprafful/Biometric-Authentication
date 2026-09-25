/**
 * Verifies lib/clamdClient.ts against a fake clamd that speaks the same wire
 * protocol: INSTREAM framing (including a file at the 15 MB upload cap), the
 * OK / FOUND / error replies, PING and VERSION, and every way clamd can be
 * missing. The real engine is checked separately, on the server, by the
 * deploy hook's EICAR self-test.
 *
 * The failure modes that matter are silent ones: a framing bug that clamd
 * would reject, or an unreachable or confused scanner being read as "clean".
 * The upload route refuses files whenever this client reports available:false,
 * so section [4] is what keeps a scanner outage from storing files unscanned.
 *
 * Run: pnpm --filter @workspace/api-server run verify:clamd
 * Needs no server, database or ClamAV install.
 */
import net from "node:net";

const { scanWithClamd, clamdCommand, clamdTarget } = await import("./clamdClient");

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

const MARKER = "SECUREAI-FAKE-MALWARE-SAMPLE";

type Mode = "normal" | "error" | "silent";

/** A fake clamd. Records each INSTREAM payload it reassembles from the frames. */
function startFakeClamd(mode: Mode): Promise<{ port: number; received: Buffer[]; close: () => void }> {
  const received: Buffer[] = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const chunks: Buffer[] = [];
    socket.on("data", (data) => {
      buf = Buffer.concat([buf, data]);
      if (command === null) {
        const nul = buf.indexOf(0);
        if (nul === -1) return;
        command = buf.subarray(0, nul).toString("utf8");
        buf = buf.subarray(nul + 1);
        if (command === "zPING") return void socket.end("PONG\0");
        if (command === "zVERSION") return void socket.end("ClamAV 1.4.6/27777/Fri Sep 25 08:00:00 2026\0");
        if (command !== "zINSTREAM") return void socket.end("UNKNOWN COMMAND\0");
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const payload = Buffer.concat(chunks);
          received.push(payload);
          if (mode === "silent") return; // accept everything, never answer
          if (mode === "error") return void socket.end("INSTREAM size limit exceeded. ERROR\0");
          const reply = payload.includes(MARKER) ? "stream: Fake.Test.Sample-1 FOUND\0" : "stream: OK\0";
          return void socket.end(reply);
        }
        if (buf.length < 4 + len) return;
        chunks.push(Buffer.from(buf.subarray(4, 4 + len)));
        buf = buf.subarray(4 + len);
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, received, close: () => server.close() });
    });
  });
}

/** A port that nothing listens on: bind one, note it, release it. */
async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// ---------------------------------------------------------------------------
console.log("\n[1] Clean and infected files");
{
  const fake = await startFakeClamd("normal");
  const clean = await scanWithClamd(Buffer.from("an ordinary diary entry"), "127.0.0.1", fake.port);
  check("clean file is reported clean", clean.available && clean.clean && clean.reason === null, JSON.stringify(clean));
  const bad = await scanWithClamd(Buffer.from(`prefix ${MARKER} suffix`), "127.0.0.1", fake.port);
  check(
    "a detection is reported with clamd's signature name",
    bad.available && !bad.clean && bad.reason === "clamd detected: Fake.Test.Sample-1",
    JSON.stringify(bad),
  );
  fake.close();
}

// ---------------------------------------------------------------------------
console.log("\n[2] INSTREAM framing");
{
  const fake = await startFakeClamd("normal");
  const multi = Buffer.alloc(20 * 1024 + 123);
  for (let i = 0; i < multi.length; i++) multi[i] = (i * 31) % 251;
  await scanWithClamd(multi, "127.0.0.1", fake.port);
  check("a 20 KB file split across chunks arrives byte-identical", fake.received[0]?.equals(multi) ?? false, `${fake.received[0]?.length} of ${multi.length} bytes`);

  const max = Buffer.alloc(15 * 1024 * 1024, 0x41);
  const started = Date.now();
  const result = await scanWithClamd(max, "127.0.0.1", fake.port);
  check(
    "a file at the 15 MB upload cap is streamed whole and scanned",
    result.available && result.clean && (fake.received[1]?.equals(max) ?? false),
    `${fake.received[1]?.length} bytes in ${Date.now() - started} ms`,
  );

  const one = Buffer.from([0x42]);
  await scanWithClamd(one, "127.0.0.1", fake.port);
  check("a 1-byte file is framed correctly", fake.received[2]?.equals(one) ?? false, `${fake.received[2]?.length} byte(s)`);
  fake.close();
}

// ---------------------------------------------------------------------------
console.log("\n[3] PING and VERSION");
{
  const fake = await startFakeClamd("normal");
  const pong = await clamdCommand("PING", "127.0.0.1", fake.port);
  check("PING answers PONG", pong === "PONG", String(pong));
  const version = await clamdCommand("VERSION", "127.0.0.1", fake.port);
  check("VERSION returns the engine and signature version", version?.startsWith("ClamAV 1.4.6/") ?? false, String(version));
  const down = await clamdCommand("PING", "127.0.0.1", await closedPort());
  check("PING to a stopped clamd returns null", down === null, String(down));
  fake.close();
}

// ---------------------------------------------------------------------------
console.log("\n[4] A missing or confused scanner is never read as clean");
{
  const notConfigured = await scanWithClamd(Buffer.from("x"), undefined, 3310);
  check("no host: available false", !notConfigured.available, JSON.stringify(notConfigured));

  const unreachable = await scanWithClamd(Buffer.from("x"), "127.0.0.1", await closedPort());
  check("nothing listening: available false", !unreachable.available, JSON.stringify(unreachable));

  const errFake = await startFakeClamd("error");
  const err = await scanWithClamd(Buffer.from("x"), "127.0.0.1", errFake.port);
  check("an ERROR reply: available false", !err.available, JSON.stringify(err));
  errFake.close();

  const silentFake = await startFakeClamd("silent");
  const started = Date.now();
  const silent = await scanWithClamd(Buffer.from("x"), "127.0.0.1", silentFake.port);
  check("a clamd that never answers times out: available false", !silent.available, `${JSON.stringify(silent)} after ${Date.now() - started} ms`);
  silentFake.close();
}

// ---------------------------------------------------------------------------
console.log("\n[5] Configuration");
{
  const saved = { host: process.env["CLAMD_HOST"], port: process.env["CLAMD_PORT"] };
  delete process.env["CLAMD_HOST"];
  delete process.env["CLAMD_PORT"];
  check("CLAMD_HOST unset: scanning not configured", clamdTarget() === null, JSON.stringify(clamdTarget()));
  process.env["CLAMD_HOST"] = "127.0.0.1";
  const target = clamdTarget();
  check("CLAMD_HOST set, CLAMD_PORT unset: port 3310", target?.host === "127.0.0.1" && target.port === 3310, JSON.stringify(target));
  if (saved.host === undefined) delete process.env["CLAMD_HOST"];
  else process.env["CLAMD_HOST"] = saved.host;
  if (saved.port !== undefined) process.env["CLAMD_PORT"] = saved.port;
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
