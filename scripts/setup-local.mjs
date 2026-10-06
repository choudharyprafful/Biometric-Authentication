// Local development setup, README "Quick start" step 2:
//
//   pnpm run setup:local postgresql://postgres:postgres@localhost:5432/secureai
//
// 1. Creates the database named in the address, if it doesn't exist yet.
// 2. Writes .env from .env.example with that DATABASE_URL and a random SESSION_SECRET. An existing
//    .env is kept; only the placeholder address copied from .env.example is replaced.
// 3. Creates the tables (pnpm --filter @workspace/db run push).
//
// Safe to run again. Local development only: a deployment sets its own environment.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const example = fs.readFileSync(path.join(root, ".env.example"), "utf8");
const EXAMPLE_ADDRESS =
  "postgresql://postgres:postgres@localhost:5432/secureai";

function stop(message) {
  console.error(`\nSetup stopped: ${message}`);
  process.exit(1);
}

function valueIn(text, key) {
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1].trim();
}

function setValue(text, key, value) {
  return text.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`);
}

const placeholderAddress = valueIn(example, "DATABASE_URL");
const envText = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf8")
  : null;
const envAddress =
  envText === null ? undefined : valueIn(envText, "DATABASE_URL");
const address =
  process.argv[2] ??
  (envAddress && envAddress !== placeholderAddress ? envAddress : undefined);

if (!address)
  stop(
    `give the database address, for example:\n  pnpm run setup:local ${EXAMPLE_ADDRESS}`,
  );

let url;
try {
  url = new URL(address);
} catch {
  stop(
    `"${address}" is not a database address. It looks like ${EXAMPLE_ADDRESS}`,
  );
}
if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
  stop(`"${address}" should start with postgresql://`);
const database = decodeURIComponent(url.pathname.slice(1));
const user = decodeURIComponent(url.username) || "(your computer user name)";
if (!/^[A-Za-z0-9_]+$/.test(database))
  stop(
    `the database name at the end of the address should be letters, digits or _ (got "${database}")`,
  );
if (envAddress && envAddress !== placeholderAddress && envAddress !== address)
  stop(
    `.env already uses a different database:\n  ${envAddress}\nEdit DATABASE_URL in .env, or delete .env and run this again.`,
  );

function explain(error) {
  const where = `${url.hostname}:${url.port || 5432}`;
  switch (error.code) {
    case "ECONNREFUSED":
      return `nothing is answering at ${where}. Is PostgreSQL installed and running? See README "Quick start", step 1, and "If something goes wrong".`;
    case "ENOTFOUND":
      return `cannot find the computer "${url.hostname}" in the address.`;
    case "28P01":
      return `PostgreSQL refused the password for user "${user}". Put the password you chose when installing PostgreSQL in the address: postgresql://${user}:YOUR_PASSWORD@${where}/${database}`;
    case "28000":
      return `PostgreSQL does not let user "${user}" sign in: ${error.message}`;
    case "42501":
      return `user "${user}" is not allowed to create databases. Create "${database}" yourself, or use the postgres user.`;
    default:
      return error.message;
  }
}

// 1. The database, created from the server's built-in "postgres" database.
const server = new URL(url);
server.pathname = "/postgres";
const client = new pg.Client({ connectionString: server.toString() });
try {
  await client.connect();
  const found = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [database],
  );
  if (found.rowCount === 0) {
    await client.query(`CREATE DATABASE "${database}"`);
    console.log(`Created the database "${database}".`);
  } else {
    console.log(`The database "${database}" already exists.`);
  }
} catch (error) {
  stop(explain(error));
} finally {
  await client.end().catch(() => {});
}

// 2. .env
if (envText === null) {
  let text = setValue(example, "DATABASE_URL", address);
  text = setValue(
    text,
    "SESSION_SECRET",
    crypto.randomBytes(32).toString("hex"),
  );
  fs.writeFileSync(envPath, text);
  console.log(
    "Created .env: your database address, a random SESSION_SECRET, everything else from .env.example.",
  );
} else if (envAddress !== address) {
  let text = setValue(envText, "DATABASE_URL", address);
  if (valueIn(text, "SESSION_SECRET") === valueIn(example, "SESSION_SECRET"))
    text = setValue(
      text,
      "SESSION_SECRET",
      crypto.randomBytes(32).toString("hex"),
    );
  fs.writeFileSync(envPath, text);
  console.log("Updated .env with your database address.");
} else {
  console.log("Keeping the existing .env.");
}

// 3. The tables.
console.log("Creating the tables...");
const push = spawnSync("pnpm --filter @workspace/db run push", {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DATABASE_URL: address },
});
if (push.status !== 0) stop("creating the tables failed (see above).");

console.log(`
Setup complete. Start the API and the web app, each in its own terminal window:

  pnpm run dev:api
  pnpm run dev:web

Then open http://localhost:5173 and sign in as admin_user@prafful.com with password Password123!`);
