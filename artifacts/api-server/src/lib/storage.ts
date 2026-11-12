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
import { v2 as cloudinary } from "cloudinary";

/**
 * Private object storage for sensitive verification documents.
 *
 * Production uses Cloudinary (private "authenticated" assets) or any S3-compatible
 * bucket that is NOT publicly readable. Files are only ever opened through
 * short-lived signed links. A local-disk driver exists for development only and
 * refuses to run when NODE_ENV=production.
 *
 * Choose a driver with STORAGE_DRIVER=cloudinary|s3|local. If it is not set, Cloudinary
 * is used when its variables are present, otherwise S3.
 *
 * Cloudinary: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
 *   CLOUDINARY_FOLDER (default "sedibeng")
 *
 * S3 (see DEPLOYMENT.md):
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   (required for S3)
 *   S3_REGION (default "us-east-1"; use "auto" for Cloudflare R2)
 *   S3_ENDPOINT (optional, for R2/MinIO/B2), S3_FORCE_PATH_STYLE=true (optional)
 *   DOCUMENT_URL_TTL_SECONDS (default 60, max 300)
 *   STORAGE_DRIVER=local + LOCAL_STORAGE_DIR (development only)
 */
export interface PrivateStorage {
  readonly driver: "s3" | "local" | "cloudinary";
  /**
   * True when files are served through our own API (a signed, expiring link on this
   * server) instead of a link straight to the storage provider. The provider's URL is
   * then never shown to a browser.
   */
  readonly proxied: boolean;
  /** Reads a stored file. Only drivers that serve through our API implement it. */
  read?(key: string): Promise<Buffer>;
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
    proxied: false,
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
  return createHmac("sha256", secret).update("document-view-links").digest();
}

type LocalClaims = { k: string; f: string; c: string; e: number };

function signViewToken(claims: LocalClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", localSecret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifyViewToken(token: string): LocalClaims | null {
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
  // Never allow files on the web server's disk to stand in for private storage in production.
  if (process.env.NODE_ENV === "production") return null;
  return {
    driver: "local",
    proxied: true,
    read: (key) => readLocalObject(key),
    async put(key, body) {
      const target = localPath(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
    },
    async remove(key) {
      await rm(localPath(key), { force: true });
    },
    async signedGetUrl({ key, filename, contentType, baseUrl }) {
      const token = signViewToken({ k: key, f: filename, c: contentType, e: Date.now() + documentUrlTtlSeconds() * 1000 });
      return `${baseUrl}/api/v1/documents/view/${token}`;
    },
  };
}

/**
 * Cloudinary driver. Files are uploaded as private "authenticated" raw assets inside
 * the configured folder (default "sedibeng"), named only by random ids. Cloudinary
 * therefore never receives a person's filename or any personal detail. The browser
 * never sees a Cloudinary URL: our API reads the file server-side and serves it
 * through its own signed, expiring link.
 */
/** Accepts CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud name>, or the three separate variables. */
export function cloudinaryCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env) {
  let cloudName = env.CLOUDINARY_CLOUD_NAME?.trim();
  let apiKey = env.CLOUDINARY_API_KEY?.trim();
  let apiSecret = env.CLOUDINARY_API_SECRET?.trim();
  const combined = env.CLOUDINARY_URL?.trim();
  if (combined && (!cloudName || !apiKey || !apiSecret)) {
    try {
      const parsed = new URL(combined);
      if (parsed.protocol === "cloudinary:") {
        cloudName ||= parsed.hostname;
        apiKey ||= decodeURIComponent(parsed.username);
        apiSecret ||= decodeURIComponent(parsed.password);
      }
    } catch {
      // Not a valid URL: treated as "not configured" below.
    }
  }
  // A leftover "<your_api_key>" placeholder is not a real credential.
  if (!cloudName || !apiKey || !apiSecret || /[<>]/.test(`${apiKey}${apiSecret}${cloudName}`)) return null;
  return { cloudName, apiKey, apiSecret };
}

function cloudinaryStorage(): PrivateStorage | null {
  const found = cloudinaryCredentialsFromEnv();
  if (!found) return null;
  const { cloudName, apiKey, apiSecret } = found;
  const folder = (process.env.CLOUDINARY_FOLDER?.trim() || "sedibeng").replace(/^\/+|\/+$/g, "");
  const credentials = {
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
    // Only for tests against a local stand-in for Cloudinary.
    ...(process.env.CLOUDINARY_UPLOAD_PREFIX ? { upload_prefix: process.env.CLOUDINARY_UPLOAD_PREFIX } : {}),
  };
  const publicId = (key: string) => `${folder}/${key}`;
  const privateOptions = { resource_type: "raw", type: "authenticated" } as const;

  return {
    driver: "cloudinary",
    proxied: true,
    async put(key, body) {
      const id = publicId(key);
      await new Promise<void>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            ...credentials,
            ...privateOptions,
            public_id: id,
            asset_folder: id.slice(0, id.lastIndexOf("/")),
            overwrite: false,
            unique_filename: false,
            use_filename: false,
          },
          (error, result) => {
            if (error || !result) reject(new Error(`Cloudinary upload failed: ${error?.message ?? "no result"}`));
            else resolve();
          },
        );
        stream.end(body);
      });
    },
    async remove(key) {
      const result = await cloudinary.uploader.destroy(publicId(key), { ...credentials, ...privateOptions, invalidate: true });
      if (result?.result !== "ok" && result?.result !== "not found") {
        throw new Error(`Cloudinary could not delete the file (${String(result?.result)}).`);
      }
    },
    async read(key) {
      // A signed, expiring server-side request; the URL is never handed to a browser.
      const url = cloudinary.utils.private_download_url(publicId(key), "", {
        ...credentials,
        ...privateOptions,
        expires_at: Math.floor(Date.now() / 1000) + 60,
      });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Cloudinary download failed (HTTP ${response.status}).`);
      return Buffer.from(await response.arrayBuffer());
    },
    async signedGetUrl({ key, filename, contentType, baseUrl }) {
      const token = signViewToken({ k: key, f: filename, c: contentType, e: Date.now() + documentUrlTtlSeconds() * 1000 });
      return `${baseUrl}/api/v1/documents/view/${token}`;
    },
  };
}

function chooseStorage(): PrivateStorage | null {
  switch (process.env.STORAGE_DRIVER?.trim().toLowerCase()) {
    case "cloudinary": return cloudinaryStorage();
    case "s3": return s3Storage();
    case "local": return localStorage();
    default: return cloudinaryStorage() ?? s3Storage();
  }
}

let cached: PrivateStorage | null | undefined;

export function getStorage(): PrivateStorage | null {
  if (cached === undefined) cached = chooseStorage();
  return cached;
}

/** For tests that switch drivers between cases. */
export function resetStorageForTests() {
  cached = undefined;
}
