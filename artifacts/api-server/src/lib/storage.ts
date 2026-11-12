import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Private object storage for sensitive verification documents.
 *
 * Production uses any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2,
 * MinIO, ...) that is NOT publicly readable. Files are only ever opened through
 * short-lived signed URLs. A local-disk driver exists for development only and
 * refuses to run when NODE_ENV=production.
 *
 * Environment variables (see DEPLOYMENT.md):
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   (required for S3)
 *   S3_REGION (default "us-east-1"; use "auto" for Cloudflare R2)
 *   S3_ENDPOINT (optional, for R2/MinIO/B2), S3_FORCE_PATH_STYLE=true (optional)
 *   DOCUMENT_URL_TTL_SECONDS (default 60, max 300)
 *   STORAGE_DRIVER=local + LOCAL_STORAGE_DIR (development only)
 */
export interface PrivateStorage {
  readonly driver: "s3" | "local";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  signedGetUrl(input: {
    key: string;
    filename: string;
    contentType: string;
    baseUrl: string;
  }): Promise<string>;
}

export function documentUrlTtlSeconds() {
  const configured = Number(process.env.DOCUMENT_URL_TTL_SECONDS ?? 60);
  if (!Number.isFinite(configured)) return 60;
  return Math.min(300, Math.max(15, Math.floor(configured)));
}

function contentDisposition(filename: string) {
  const safe = filename.replace(/[^\w.\- ()]/g, "_").slice(0, 80) || "document";
  return `inline; filename="${safe}"`;
}

/** Object names are generated server-side; the user's filename is never used. */
export function newObjectKey(userId: string, extension: string) {
  return `verification/${userId}/${randomUUID()}.${extension}`;
}

function s3Storage(): PrivateStorage | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const client = new S3Client({
    region: process.env.S3_REGION?.trim() || "us-east-1",
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    driver: "s3",
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "private, no-store",
        }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async signedGetUrl({ key, filename, contentType }) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: contentType,
          ResponseContentDisposition: contentDisposition(filename),
          ResponseCacheControl: "private, no-store",
        }),
        { expiresIn: documentUrlTtlSeconds() },
      );
    },
  };
}

function localSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for local document links.");
  return createHmac("sha256", secret).update("local-document-links").digest();
}

type LocalClaims = { k: string; f: string; c: string; e: number };

function signLocal(claims: LocalClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", localSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyLocalToken(token: string): LocalClaims | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", localSecret()).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as LocalClaims;
    if (typeof claims.k !== "string" || claims.e < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

function localDir() {
  return path.resolve(process.env.LOCAL_STORAGE_DIR?.trim() || ".private-storage");
}

function localPath(key: string) {
  const resolved = path.resolve(localDir(), key);
  if (!resolved.startsWith(localDir() + path.sep)) throw new Error("Invalid object key.");
  return resolved;
}

export async function readLocalObject(key: string) {
  return readFile(localPath(key));
}

function localStorage(): PrivateStorage | null {
  if (process.env.STORAGE_DRIVER !== "local") return null;
  // Never allow files on the web server's disk to stand in for private storage in production.
  if (process.env.NODE_ENV === "production") return null;
  return {
    driver: "local",
    async put(key, body) {
      const target = localPath(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
    },
    async remove(key) {
      await rm(localPath(key), { force: true });
    },
    async signedGetUrl({ key, filename, contentType, baseUrl }) {
      const token = signLocal({ k: key, f: filename, c: contentType, e: Date.now() + documentUrlTtlSeconds() * 1000 });
      return `${baseUrl}/api/v1/documents/local/${token}`;
    },
  };
}

let cached: PrivateStorage | null | undefined;

export function getStorage(): PrivateStorage | null {
  if (cached === undefined) cached = s3Storage() ?? localStorage();
  return cached;
}

/** For tests that switch drivers between cases. */
export function resetStorageForTests() {
  cached = undefined;
}
