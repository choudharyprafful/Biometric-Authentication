import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Local development keeps DATABASE_URL in the repository's .env (README "Quick start"). A value
// already in the environment wins, and deployments have no .env file.
const envFile = path.resolve(process.cwd(), "../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
