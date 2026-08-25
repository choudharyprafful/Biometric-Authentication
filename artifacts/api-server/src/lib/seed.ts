import bcrypt from "bcryptjs";
import { db, usersTable, securityLogsTable, threatsTable, paymentsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { logger } from "./logger";
import { encryptFile } from "./fileEncryption";

function encryptToken(token: string) {
  const encrypted = encryptFile(Buffer.from(token, "utf8"));
  return {
    providerTokenCiphertext: encrypted.ciphertext,
    providerTokenIv: encrypted.iv,
    providerTokenAuthTag: encrypted.authTag,
  };
}

export async function seedIfEmpty(): Promise<void> {
  const [result] = await db.select({ count: count() }).from(usersTable);
  if (Number(result?.count ?? 0) > 0) return;

  logger.info("Seeding demo data...");

  const passwordHash = await bcrypt.hash("Password123!", 12);

  const [admin] = await db.insert(usersTable).values({
    email: "admin_user@prafful.com",
    name: "Admin User",
    passwordHash,
    role: "admin",
    faceEnrolled: false,
  }).returning();

  const [alice] = await db.insert(usersTable).values({
    email: "admin@prafful.com",
    name: "Alice Chen",
    passwordHash,
    role: "user",
    faceEnrolled: false,
  }).returning();

  const [bob] = await db.insert(usersTable).values({
    email: "bob@prafful.com",
    name: "Bob Martinez",
    passwordHash,
    role: "user",
    faceEnrolled: false,
  }).returning();

  const [secAnalyst] = await db.insert(usersTable).values({
    email: "security_monitoring@prafful.com",
    name: "Security Monitoring",
    passwordHash,
    role: "security_analyst",
    faceEnrolled: false,
  }).returning();

  const [itSupport] = await db.insert(usersTable).values({
    email: "it_support@prafful.com",
    name: "IT Support",
    passwordHash,
    role: "it_support",
    faceEnrolled: false,
  }).returning();

  // Seed security logs
  const now = new Date();
  const events = [
    { eventType: "REGISTER", details: "New user registered: admin_user@prafful.com", userId: admin?.id, userEmail: admin?.email, ipAddress: "192.168.1.1" },
    { eventType: "REGISTER", details: "New user registered: admin@prafful.com", userId: alice?.id, userEmail: alice?.email, ipAddress: "10.0.0.42" },
    { eventType: "LOGIN_SUCCESS", details: "Login successful for admin@prafful.com", userId: alice?.id, userEmail: alice?.email, ipAddress: "10.0.0.42" },
    { eventType: "LOGIN_FAILED", details: "Failed login attempt for unknown@example.com — user not found", ipAddress: "185.220.101.47" },
    { eventType: "REGISTER", details: "New user registered: bob@prafful.com", userId: bob?.id, userEmail: bob?.email, ipAddress: "172.16.0.10" },
    { eventType: "LOGIN_SUCCESS", details: "Login successful for bob@prafful.com", userId: bob?.id, userEmail: bob?.email, ipAddress: "172.16.0.10" },
    { eventType: "LOGIN_FAILED", details: "Failed login for admin@prafful.com — wrong password", userId: alice?.id, userEmail: alice?.email, ipAddress: "45.33.32.156" },
    { eventType: "LOGIN_FAILED", details: "Failed login for admin@prafful.com — wrong password", userId: alice?.id, userEmail: alice?.email, ipAddress: "45.33.32.156" },
    { eventType: "UNAUTHORIZED_ACCESS", details: "Unauthenticated request to /api/users", ipAddress: "104.16.0.0" },
    { eventType: "LOGIN_SUCCESS", details: "Login successful for admin_user@prafful.com", userId: admin?.id, userEmail: admin?.email, ipAddress: "192.168.1.1" },
    { eventType: "REGISTER", details: "New user registered: security_monitoring@prafful.com", userId: secAnalyst?.id, userEmail: secAnalyst?.email, ipAddress: "192.168.1.50" },
    { eventType: "REGISTER", details: "New user registered: it_support@prafful.com", userId: itSupport?.id, userEmail: itSupport?.email, ipAddress: "192.168.1.60" },
  ];

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const ts = new Date(now.getTime() - (events.length - i) * 3600000);
    await db.insert(securityLogsTable).values({
      ...event,
      userId: event.userId ?? null,
      userEmail: event.userEmail ?? null,
      ipAddress: event.ipAddress ?? null,
      timestamp: ts,
    });
  }

  // Seed threats
  await db.insert(threatsTable).values([
    {
      type: "Credential Stuffing",
      severity: "high",
      description: "Multiple failed login attempts from IP 45.33.32.156 using leaked credential lists. 3 attempts in 10 minutes.",
      plainSummary: "Someone tried to log in using a list of passwords stolen from other websites, hoping one would also work here. Our system noticed the repeated failed attempts and blocked them.",
      status: "active",
      affectedUsers: 2,
    },
    {
      type: "Brute Force",
      severity: "medium",
      description: "Repeated password attempts on a privileged account from a single IP address.",
      plainSummary: "Someone repeatedly guessed passwords for one of our administrator accounts. This has already been stopped and the account is safe.",
      status: "mitigated",
      affectedUsers: 1,
    },
    {
      type: "Unauthenticated Probe",
      severity: "low",
      description: "Automated scanner attempted to access authenticated API endpoints without credentials.",
      plainSummary: "An automated tool scanned our system looking for an unlocked door. It didn't find one, and nothing needed to be done.",
      status: "resolved",
      affectedUsers: null,
    },
    {
      type: "Data Poisoning Risk",
      severity: "medium",
      description: "Unvalidated file upload detected in model training pipeline. Input validation controls applied.",
      plainSummary: "Someone tried to sneak a harmful file into an upload area. Our checks caught it and the issue has been fixed.",
      status: "mitigated",
      affectedUsers: null,
    },
    {
      type: "Model API Abuse",
      severity: "high",
      description: "High-frequency requests to AI inference endpoint suggesting model extraction attempt. Rate limiting engaged.",
      plainSummary: "Someone sent an unusually large, fast burst of requests — a common sign of trying to copy or abuse the AI system. We automatically slowed them down.",
      status: "active",
      affectedUsers: null,
    },
  ]);

  // Seed payments
  if (alice && bob) {
    await db.insert(paymentsTable).values([
      {
        userId: alice.id,
        userEmail: alice.email,
        amount: 29.99,
        currency: "USD",
        description: "Pro subscription — monthly",
        ...encryptToken("tok_demo_alice_sub_001"),
        status: "completed",
      },
      {
        userId: bob.id,
        userEmail: bob.email,
        amount: 99.00,
        currency: "USD",
        description: "Enterprise plan — annual",
        ...encryptToken("tok_demo_bob_enterprise_001"),
        status: "completed",
      },
      {
        userId: alice.id,
        userEmail: alice.email,
        amount: 9.99,
        currency: "USD",
        description: "Add-on: Advanced threat monitoring",
        ...encryptToken("tok_demo_alice_addon_001"),
        status: "completed",
      },
    ]);
  }

  logger.info("Demo seed complete. Login: admin_user@prafful.com / admin@prafful.com / bob@prafful.com / security_monitoring@prafful.com / it_support@prafful.com — all with password: Password123!");
}
