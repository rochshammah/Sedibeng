import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cloudinaryCredentialsFromEnv } from "../lib/storage";

describe("Cloudinary configuration", () => {
  it("reads the combined CLOUDINARY_URL", () => {
    assert.deepEqual(
      cloudinaryCredentialsFromEnv({ CLOUDINARY_URL: "cloudinary://12345:s3cr%40t@mycloud" } as NodeJS.ProcessEnv),
      { cloudName: "mycloud", apiKey: "12345", apiSecret: "s3cr@t" },
    );
  });
  it("reads the three separate variables, which win over the combined one", () => {
    const found = cloudinaryCredentialsFromEnv({
      CLOUDINARY_CLOUD_NAME: "a", CLOUDINARY_API_KEY: "b", CLOUDINARY_API_SECRET: "c", CLOUDINARY_URL: "cloudinary://x:y@z",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(found, { cloudName: "a", apiKey: "b", apiSecret: "c" });
  });
  it("treats missing, malformed and placeholder values as not configured", () => {
    assert.equal(cloudinaryCredentialsFromEnv({} as NodeJS.ProcessEnv), null);
    assert.equal(cloudinaryCredentialsFromEnv({ CLOUDINARY_URL: "not a url" } as NodeJS.ProcessEnv), null);
    assert.equal(cloudinaryCredentialsFromEnv({ CLOUDINARY_URL: "http://k:s@c" } as NodeJS.ProcessEnv), null);
    assert.equal(cloudinaryCredentialsFromEnv({ CLOUDINARY_URL: "cloudinary://<your_api_key>:<your_api_secret>@mycloud" } as NodeJS.ProcessEnv), null);
  });
});
