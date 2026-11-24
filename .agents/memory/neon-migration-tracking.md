---
name: Neon migration tracking
description: Reconcile live Neon schema and Drizzle migration history before preparing manual SQL.
---

Before preparing a manual Neon migration, compare the live schema with the Drizzle migration journal. Sedibeng's Neon database had the schema through migrations 0002–0004 even though its journal only recorded 0000–0001; recording the already-present migrations alongside the new SQL prevented future migrations from replaying old DDL. The user confirmed the resulting SQL script worked.

**Why:** The database schema and Drizzle's migration ledger can drift independently, so schema-only inspection can leave a future migration run trying to recreate existing tables.

**How to apply:** Verify both the schema and journal before generating SQL. Only reconcile entries when the live schema matches the corresponding migration snapshot, and commit new PostgreSQL enum values before any statement uses them.
