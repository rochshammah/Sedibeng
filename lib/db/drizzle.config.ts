import { defineConfig } from "drizzle-kit";

const isReplitRuntime = Boolean(
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN,
);
const connectionString =
  process.env.NEON_DATABASE_URL ??
  (isReplitRuntime ? undefined : process.env.DATABASE_URL);

if (!connectionString) {
  throw new Error(
    "Set NEON_DATABASE_URL before running migrations in Replit, or DATABASE_URL on the deployment host.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
