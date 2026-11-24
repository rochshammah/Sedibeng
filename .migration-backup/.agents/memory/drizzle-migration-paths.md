---
name: Drizzle migration paths
description: Drizzle Kit path resolution for migration metadata in this workspace.
---

Keep Drizzle schema and output paths relative to the `lib/db` package working directory. Absolute output paths produced a malformed snapshot lookup path during migration generation.

**Why:** Drizzle Kit attempted to open a path containing `.//home/.../migrations/meta/...` when the configured output directory was absolute.

**How to apply:** Keep both generation and migration configs package-relative, and run their scripts through the `@workspace/db` package scripts.
