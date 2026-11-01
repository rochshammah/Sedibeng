import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-only-session-secret-with-more-than-32-bytes";

const security = await import("../lib/security");

test("password hashes verify without storing the original password", async () => {
  const password = "CorrectHorseBatteryStaple!42";
  const encoded = await security.hashPassword(password);

  assert.notEqual(encoded, password);
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await security.verifyPassword(password, encoded), true);
  assert.equal(await security.verifyPassword("wrong-password", encoded), false);
  assert.equal(await security.verifyPassword(password, "invalid"), false);
});

test("one-time tokens are random and stored as one-way digests", () => {
  const first = security.createOneTimeToken();
  const second = security.createOneTimeToken();

  assert.notEqual(first, second);
  assert.notEqual(security.digestOneTimeToken(first), first);
  assert.equal(security.digestOneTimeToken(first).length, 64);
});

test("CSRF tokens reject tampering and unsafe methods are identified", () => {
  const token = security.createCsrfToken();
  assert.equal(security.verifyCsrfToken(token), true);
  assert.equal(security.verifyCsrfToken(`${token}x`), false);
  assert.equal(security.isSafeMethod("GET"), true);
  assert.equal(security.isSafeMethod("POST"), false);
});
