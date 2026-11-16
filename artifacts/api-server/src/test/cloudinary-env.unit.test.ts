import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { cleanCloudinaryUrl } from "../lib/cloudinary-env";

const good = "cloudinary://123:abc@mycloud";

describe("CLOUDINARY_URL tolerance", () => {
  it("leaves a correct value alone", () => {
    assert.deepEqual(cleanCloudinaryUrl(good), { value: good, changed: false });
  });
  it("forgives quotes, spaces, newlines and a pasted variable name", () => {
    for (const messy of [`"${good}"`, `'${good}'`, ` ${good} `, `${good}\n`, `CLOUDINARY_URL=${good}`, `CLOUDINARY_URL = "${good}"`, `"CLOUDINARY_URL=${good}"`]) {
      assert.deepEqual(cleanCloudinaryUrl(messy), { value: good, changed: true }, messy);
    }
  });
  it("rejects values that cannot work instead of throwing", () => {
    for (const bad of ["not a url", "http://k:s@c", "cloudinary://onlycloud", "cloudinary://k@c", "cloudinary://:s@c"]) {
      assert.equal(cleanCloudinaryUrl(bad).value, null, bad);
    }
    assert.deepEqual(cleanCloudinaryUrl(undefined), { value: null, changed: false });
    assert.deepEqual(cleanCloudinaryUrl("  "), { value: null, changed: false });
  });

  // The real failure on the host: the whole process died while loading the library.
  const driverFor = (url: string) => {
    const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "const m = await import('./src/lib/storage.ts'); console.log('RESULT:' + JSON.stringify(m.getStorage()?.driver ?? null));"], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { ...process.env, CLOUDINARY_URL: url, STORAGE_DRIVER: "", SESSION_SECRET: "x".repeat(40) },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(/RESULT:(.*)/.exec(out)![1]);
  };
  it("starts normally with a messy but recoverable value", () => {
    assert.equal(driverFor(`CLOUDINARY_URL=${good}`), "cloudinary");
    assert.equal(driverFor(`"${good}"`), "cloudinary");
  });
  it("starts normally, with storage switched off, when the value is unusable", () => {
    assert.equal(driverFor("this is not a cloudinary url"), null);
    assert.equal(driverFor("cloudinary://<your_api_key>:<your_api_secret>@mycloud"), null);
  });
});
