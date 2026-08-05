---
name: PostgreSQL sessions
description: Session-store schema constraint for SecureAI's Express authentication.
---

Use an explicitly managed `session` table for the PostgreSQL-backed `express-session` store.

**Why:** The bundled `connect-pg-simple` auto-create SQL includes a legacy PostgreSQL table option that is rejected by the current database, so login responses can be successful while their session cannot be saved.

**How to apply:** Keep the default `session` table represented in the Drizzle schema and push it with the project database schema before relying on cookie-based authentication.