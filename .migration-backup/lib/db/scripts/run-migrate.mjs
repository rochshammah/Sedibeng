import { spawnSync } from "node:child_process";

const isReplitRuntime = Boolean(
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN,
);
const hasDatabaseUrl = Boolean(
  process.env.NEON_DATABASE_URL ||
    (!isReplitRuntime && process.env.DATABASE_URL),
);

if (!hasDatabaseUrl) {
  console.error(
    "Set NEON_DATABASE_URL in Replit Secrets before running database migrations.",
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error("Could not start Drizzle migrations.");
  process.exit(1);
}

process.exit(result.status ?? 1);
