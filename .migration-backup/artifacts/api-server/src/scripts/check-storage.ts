// Checks that private document storage works with the credentials in your environment.
// It uploads a tiny test file, reads it back, confirms it is NOT publicly reachable,
// then deletes it. It never prints secrets.
//   Cloudinary:  CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud> pnpm --filter @workspace/api-server run storage:check
import { randomUUID } from "node:crypto";
import { cloudinaryCredentialsFromEnv, getStorage } from "../lib/storage";

const storage = getStorage();
if (!storage) {
  console.error("✗ No document storage is configured. Set CLOUDINARY_URL (or the S3 variables) first.");
  process.exit(1);
}

let failed = false;
const pass = (message: string) => console.log(`✓ ${message}`);
const fail = (message: string) => { failed = true; console.error(`✗ ${message}`); };

const key = `verification/storage-check/${randomUUID()}.pdf`;
const bytes = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(`sedibeng storage check ${new Date().toISOString()}`)]);
console.log(`Driver: ${storage.driver}`);

try {
  await storage.put(key, bytes, "application/pdf");
  pass("Uploaded a test file");
} catch (error) {
  fail(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

try {
  let readBack: Buffer;
  if (storage.proxied && storage.read) {
    readBack = await storage.read(key);
  } else {
    const url = await storage.signedGetUrl({ key, filename: "check.pdf", contentType: "application/pdf", baseUrl: "http://localhost" });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readBack = Buffer.from(await response.arrayBuffer());
  }
  readBack.equals(bytes) ? pass("Read the file back through the private route") : fail("The file read back does not match what was uploaded");
} catch (error) {
  fail(`Could not read the file back: ${error instanceof Error ? error.message : String(error)}`);
}

if (storage.driver === "cloudinary") {
  // The same file must NOT be fetchable by anyone without a signature.
  const credentials = cloudinaryCredentialsFromEnv()!;
  const folder = (process.env.CLOUDINARY_FOLDER?.trim() || "sedibeng").replace(/^\/+|\/+$/g, "");
  const base = process.env.CLOUDINARY_DELIVERY_BASE_URL?.trim() || "https://res.cloudinary.com";
  for (const kind of ["upload", "authenticated"]) {
    const publicUrl = `${base}/${credentials.cloudName}/raw/${kind}/${folder}/${key}`;
    try {
      const response = await fetch(publicUrl, { redirect: "manual" });
      response.status === 200 ? fail(`The file is PUBLICLY readable at /raw/${kind}/ (HTTP 200). Do not use this account setup for ID documents.`) : pass(`Not publicly readable at /raw/${kind}/ (HTTP ${response.status})`);
    } catch {
      console.log(`– Could not reach the public delivery address for /raw/${kind}/ (skipped)`);
    }
  }
}

try {
  await storage.remove(key);
  pass("Deleted the test file");
  if (storage.proxied && storage.read) {
    await storage.read(key).then(() => fail("The file is still readable after deleting it"), () => pass("Confirmed it is gone"));
  }
} catch (error) {
  fail(`Could not delete the test file: ${error instanceof Error ? error.message : String(error)}`);
}

console.log(failed ? "\nStorage check FAILED." : "\nStorage check passed. Document uploads are ready.");
process.exit(failed ? 1 : 0);
