import bcrypt from "bcryptjs";
import { db, usersTable, securityLogsTable, threatsTable, paymentsTable } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { logger } from "./logger";

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
    role: "admin",
    faceEnrolled: false,
  }).returning();

  const [bob] = await db.insert(usersTable).values({
    email: "bob@prafful.com",
    name: "Bob Martinez",
    passwordHash,
    role: "user",
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
      status: "active",
      affectedUsers: 2,
    },
    {
      type: "Brute Force",
      severity: "medium",
      description: "Repeated password attempts on admin@prafful.com account from a single IP address.",
      status: "mitigated",
      affectedUsers: 1,
    },
    {
      type: "Unauthenticated Probe",
      severity: "low",
      description: "Automated scanner attempted to access authenticated API endpoints without credentials.",
      status: "resolved",
      affectedUsers: null,
    },
    {
      type: "Data Poisoning Risk",
      severity: "medium",
      description: "Unvalidated file upload detected in model training pipeline. Input validation controls applied.",
      status: "mitigated",
      affectedUsers: null,
    },
    {
      type: "Model API Abuse",
      severity: "high",
      description: "High-frequency requests to AI inference endpoint suggesting model extraction attempt. Rate limiting engaged.",
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
        providerToken: `tok_demo_alice_sub_001`,
        status: "completed",
      },
      {
        userId: bob.id,
        userEmail: bob.email,
        amount: 99.00,
        currency: "USD",
        description: "Enterprise plan — annual",
        providerToken: `tok_demo_bob_enterprise_001`,
        status: "completed",
      },
      {
        userId: alice.id,
        userEmail: alice.email,
        amount: 9.99,
        currency: "USD",
        description: "Add-on: Advanced threat monitoring",
        providerToken: `tok_demo_alice_addon_001`,
        status: "completed",
      },
    ]);
  }

  logger.info("Demo seed complete. Login: admin_user@prafful.com / admin@prafful.com / bob@prafful.com — all with password: Password123!");
}
