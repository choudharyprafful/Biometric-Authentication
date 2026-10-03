import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"],
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env["SMTP_PORT"] ?? "587");
    transporter = nodemailer.createTransport({
      host: process.env["SMTP_HOST"],
      port,
      secure: process.env["SMTP_SECURE"] === "true" || port === 465,
      auth: {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASS"],
      },
    });
  }
  return transporter;
}

export function appUrl(path: string): string {
  const base =
    process.env["APP_BASE_URL"] ??
    `http://localhost:${process.env["FRONTEND_PORT"] ?? "5173"}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

// A delivery failure must never block the auth flow that triggered it (registration, password reset) — logged, not thrown.
// Resolves to whether the email was handed to the mail server (the breach register records it).
export async function sendMail(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  try {
    await getTransporter().sendMail({
      from: process.env["EMAIL_FROM"] ?? process.env["SMTP_USER"],
      to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error("Failed to send email:", err);
    return false;
  }
}
