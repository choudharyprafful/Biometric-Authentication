/**
 * Verifies lib/alertEmail.ts against a fake SMTP server: an alert reaches every address in
 * SECURITY_ALERT_EMAILS and no one else, nothing is attempted without recipients or an email
 * account, text inside an alert can't add a mail header, and a mail server that is down fails
 * quietly instead of stopping the alert job.
 *
 * Run: pnpm --filter @workspace/api-server run verify:alert-email
 * Needs no server, database or real email account.
 */
import net from "node:net";

let failures = 0;
function check(label: string, pass: boolean, detail: string): void {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}\n        ${detail}`);
  if (!pass) failures += 1;
}

interface Received {
  rcpt: string[];
  headers: string;
  body: string;
}

/** Accepts any login and records each message's recipients, header block and body. */
function startFakeSmtp(): Promise<{
  port: number;
  mail: Received[];
  close: () => Promise<void>;
}> {
  const mail: Received[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    let inData = false;
    let current: Received = { rcpt: [], headers: "", body: "" };
    let lines: string[] = [];
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let i: number;
      while ((i = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === ".") {
            const blank = lines.indexOf("");
            // Unfold: a long header continues on lines that start with whitespace (RFC 5322).
            current.headers = lines
              .slice(0, blank)
              .join("\n")
              .replace(/\n[ \t]+/g, " ");
            current.body = lines.slice(blank + 1).join("\n");
            mail.push(current);
            current = { rcpt: [], headers: "", body: "" };
            lines = [];
            inData = false;
            socket.write("250 queued\r\n");
          } else lines.push(line.startsWith("..") ? line.slice(1) : line);
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO"))
          socket.write("250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
        else if (upper.startsWith("HELO")) socket.write("250 fake\r\n");
        else if (upper.startsWith("AUTH PLAIN")) socket.write("235 ok\r\n");
        else if (upper.startsWith("AUTH LOGIN"))
          socket.write("334 VXNlcm5hbWU6\r\n");
        else if (upper.startsWith("MAIL")) socket.write("250 ok\r\n");
        else if (upper.startsWith("RCPT")) {
          current.rcpt.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, "$1"));
          socket.write("250 ok\r\n");
        } else if (upper.startsWith("DATA")) {
          inData = true;
          socket.write("354 go\r\n");
        } else if (upper.startsWith("QUIT")) {
          socket.write("221 bye\r\n");
          socket.end();
        } else socket.write("235 ok\r\n"); // the AUTH LOGIN username and password lines
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        mail,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      }),
    ),
  );
}

const smtp = await startFakeSmtp();
process.env["SMTP_HOST"] = "127.0.0.1";
process.env["SMTP_PORT"] = String(smtp.port);
process.env["SMTP_USER"] = "fake";
process.env["SMTP_PASS"] = "fake";
process.env["EMAIL_FROM"] = "secureai-alerts@example.com";
delete process.env["SECURITY_ALERT_EMAILS"];

const { deliverAlertEmail, alertRecipients } = await import("./alertEmail");
const alert = (message: string) => ({
  id: "login-failure-spike:203.0.113.9",
  severity: "high" as const,
  message,
  count: 12,
  windowMinutes: 15,
});

console.log("\n[1] Nobody to tell");
const none = await deliverAlertEmail(
  alert("12 failed logins from 203.0.113.9"),
);
check(
  "no recipients set: nothing attempted",
  !none.attempted && smtp.mail.length === 0,
  JSON.stringify(none),
);

console.log("\n[2] Every listed address, and no one else");
process.env["SECURITY_ALERT_EMAILS"] = " ops@example.com, ,lead@example.com ";
check(
  "the list is trimmed and blanks dropped",
  alertRecipients().join(",") === "ops@example.com,lead@example.com",
  alertRecipients().join(","),
);
const sent = await deliverAlertEmail(
  alert("12 failed logins from 203.0.113.9 in the last 15 minutes"),
);
const rcpts = smtp.mail.flatMap((m) => m.rcpt).sort();
check(
  "sent to both, one message each",
  sent.attempted &&
    sent.recipients === 2 &&
    sent.delivered === 2 &&
    rcpts.join(",") === "lead@example.com,ops@example.com",
  `${JSON.stringify(sent)}; server got ${rcpts.join(", ")}`,
);
const first = smtp.mail[0];
check(
  "subject names the severity and the alert",
  /^Subject: \[SecureAI\] HIGH security alert: 12 failed logins from 203\.0\.113\.9/m.test(
    first?.headers ?? "",
  ),
  (first?.headers.match(/^Subject:.*$/m) ?? ["(none)"])[0],
);
check(
  "body says what happened and links the dashboard",
  /12 failed logins from 203\.0\.113\.9/.test(first?.body ?? "") &&
    /\/dashboard/.test(first?.body ?? ""),
  `${first?.body.length ?? 0} characters`,
);

console.log("\n[3] Text inside an alert can't add a mail header");
smtp.mail.length = 0;
await deliverAlertEmail(
  alert('Data breach "Backup"\r\nBcc: attacker@example.com\r\nX-Injected: yes'),
);
const injected = smtp.mail[0];
check(
  "no Bcc or extra header, and no extra recipient",
  !!injected &&
    !/^(Bcc|X-Injected):/im.test(injected.headers) &&
    smtp.mail
      .flatMap((m) => m.rcpt)
      .every((r) => r.endsWith("@example.com") && r !== "attacker@example.com"),
  injected
    ? (injected.headers.match(/^Subject:.*$/m) ?? ["(no subject)"])[0]
    : "no message",
);
smtp.mail.length = 0;
await deliverAlertEmail(alert("x".repeat(400)));
const longSubject =
  (smtp.mail[0]?.headers.match(/^Subject: (.*)$/m) ?? [, ""])[1] ?? "";
check(
  "a long alert is shortened in the subject",
  longSubject.length < 180 && longSubject.endsWith("..."),
  `${longSubject.length} characters`,
);

console.log("\n[4] Email not set up, or the mail server down");
delete process.env["SMTP_HOST"];
const noSmtp = await deliverAlertEmail(alert("12 failed logins"));
check(
  "no email account: nothing attempted",
  !noSmtp.attempted,
  JSON.stringify(noSmtp),
);
process.env["SMTP_HOST"] = "127.0.0.1";
await smtp.close();
const down = await deliverAlertEmail(alert("12 failed logins"));
check(
  "mail server down: reported as not delivered, nothing thrown",
  down.attempted && down.delivered === 0 && down.recipients === 2,
  JSON.stringify(down),
);

console.log(
  `\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
