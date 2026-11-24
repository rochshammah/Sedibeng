import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const isReplitRuntime = Boolean(
  process.env.REPL_ID || process.env.REPLIT_DEV_DOMAIN,
);
const connectionString =
  process.env.NEON_DATABASE_URL ??
  (isReplitRuntime ? undefined : process.env.DATABASE_URL);

export const isDatabaseConfigured = Boolean(connectionString);
export const pool = connectionString
  ? new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;
export const db = pool ? drizzle(pool, { schema }) : null;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("The database is not configured.");
    this.name = "DatabaseUnavailableError";
  }
}

export function requireDb() {
  if (!db) throw new DatabaseUnavailableError();
  return db;
}

export async function closeDatabase() {
  await pool?.end();
}

export * from "./schema";
