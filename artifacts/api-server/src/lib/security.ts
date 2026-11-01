import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { eq } from "drizzle-orm";
import {
  isDatabaseConfigured,
  requireDb,
  userSessionsTable,
} from "@workspace/db";
import type { AuthenticatedPrincipal, PublicUser } from "../types/auth";
import { HttpError } from "./errors";

const SESSION_LIFETIME_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_COOKIE_DEV = "sedibeng.sid";
const SESSION_COOKIE_PROD = "__Host-sedibeng.sid";
const CSRF_COOKIE = "sedibeng.csrf";
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

type SameSiteMode = "strict" | "lax" | "none";

function sameSiteMode(): SameSiteMode {
  const configured = process.env.COOKIE_SAME_SITE?.toLowerCase();
  if (configured === "strict" || configured === "lax" || configured === "none") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "none" : "lax";
}

function secureCookies() {
  return process.env.NODE_ENV === "production" || sameSiteMode() === "none";
}

export function sessionCookieName() {
  return process.env.NODE_ENV === "production"
    ? SESSION_COOKIE_PROD
    : SESSION_COOKIE_DEV;
}

function cookieOptions(httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    secure: secureCookies(),
    sameSite: sameSiteMode(),
    path: "/",
    maxAge: SESSION_LIFETIME_MS,
  };
}

function requireSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new HttpError(
      503,
      "Session security is not configured on this server.",
    );
  }
  return secret;
}

function hashSessionId(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function hashOneTimeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function derivePasswordHash(
  password: string,
  salt: Buffer,
  options: { N: number; r: number; p: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      { ...options, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key as Buffer);
      },
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derivePasswordHash(password, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [algorithm, rawN, rawR, rawP, rawSalt, rawHash, ...extra] =
    encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    rawN !== String(SCRYPT_N) ||
    rawR !== String(SCRYPT_R) ||
    rawP !== String(SCRYPT_P) ||
    !rawSalt ||
    !rawHash ||
    extra.length > 0
  ) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(rawSalt, "base64url");
    expected = Buffer.from(rawHash, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;

  const actual = await derivePasswordHash(password, salt, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return timingSafeEqual(actual, expected);
}

export function createOneTimeToken() {
  return randomBytes(32).toString("base64url");
}

export function digestOneTimeToken(token: string) {
  return hashOneTimeToken(token);
}

export function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function publicUser(user: AuthenticatedPrincipal): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
  };
}

export async function createSession(
  user: AuthenticatedPrincipal,
  response: Response,
) {
  const rawSessionId = randomBytes(32).toString("base64url");
  const now = new Date();
  await requireDb().insert(userSessionsTable).values({
    sessionHash: hashSessionId(rawSessionId),
    userId: user.id,
    expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    lastSeenAt: now,
  });

  response.cookie(sessionCookieName(), rawSessionId, cookieOptions(true));
}

export async function revokeCurrentSession(
  request: Request,
  response: Response,
) {
  const rawSessionId = request.cookies?.[sessionCookieName()];
  if (
    isDatabaseConfigured &&
    typeof rawSessionId === "string" &&
    rawSessionId.length <= 128
  ) {
    await requireDb()
      .delete(userSessionsTable)
      .where(eq(userSessionsTable.sessionHash, hashSessionId(rawSessionId)));
  }
  clearSessionCookie(response);
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(sessionCookieName(), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: sameSiteMode(),
    path: "/",
  });
}

export async function revokeAllSessionsForUser(userId: string) {
  await requireDb()
    .delete(userSessionsTable)
    .where(eq(userSessionsTable.userId, userId));
}

export function createCsrfToken() {
  const nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", requireSessionSecret())
    .update(nonce)
    .digest("base64url");
  return `${nonce}.${signature}`;
}

export function issueCsrfToken(response: Response) {
  const token = createCsrfToken();
  response.cookie(CSRF_COOKIE, token, {
    ...cookieOptions(false),
    httpOnly: false,
    maxAge: 1000 * 60 * 60 * 12,
  });
  return token;
}

export function verifyCsrfToken(token: string) {
  const [nonce, signature, ...extra] = token.split(".");
  if (!nonce || !signature || extra.length > 0) return false;
  const expected = createHmac("sha256", requireSessionSecret())
    .update(nonce)
    .digest("base64url");
  return safeEqual(signature, expected);
}

export function verifyCsrfRequest(request: Request) {
  const cookieToken = request.cookies?.[CSRF_COOKIE];
  const headerToken = request.get("x-csrf-token");
  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !safeEqual(cookieToken, headerToken)
  ) {
    return false;
  }
  return verifyCsrfToken(headerToken);
}

export function sessionTokenHash(rawSessionId: string) {
  return hashSessionId(rawSessionId);
}

export function isSafeMethod(method: string) {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

export function isBootstrapRequest(request: Request) {
  return request.originalUrl.split("?")[0]?.endsWith("/v1/admin/bootstrap") ?? false;
}

export function isOriginAllowed(request: Request, origin: string) {
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    return false;
  }

  const requestOrigin = `${request.protocol}://${request.get("host")}`;
  if (normalized === requestOrigin) return true;

  const configured = [
    process.env.FRONTEND_ORIGIN,
    ...(process.env.CORS_ORIGINS ?? "").split(","),
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => {
      try {
        return new URL(value.trim()).origin;
      } catch {
        return "";
      }
    });

  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:5173", "http://127.0.0.1:5173");
  }
  return configured.includes(normalized);
}

export function csrfError() {
  return new HttpError(403, "The request could not be verified. Refresh and try again.");
}
