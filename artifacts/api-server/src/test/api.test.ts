import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import type { AuthenticatedPrincipal } from "../types/auth";
import type { Request, Response } from "express";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-only-session-secret-with-more-than-32-bytes";
delete process.env.NEON_DATABASE_URL;
delete process.env.DATABASE_URL;

const [{ requireRole }, { HttpError }, { default: app }] = await Promise.all([
  import("../lib/auth-middleware"),
  import("../lib/errors"),
  import("../app"),
]);
const server = app.listen(0);
let baseUrl = "";
let csrfCookie = "";
let csrfToken = "";

before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${baseUrl}/api/v1/auth/csrf`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  csrfCookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(csrfCookie.startsWith("sedibeng.csrf="));
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function apiRequest(
  path: string,
  options: RequestInit = {},
  includeCsrf = true,
) {
  const headers = new Headers(options.headers);
  headers.set("origin", "http://localhost:5173");
  if (includeCsrf) {
    headers.set("cookie", csrfCookie);
    headers.set("x-csrf-token", csrfToken);
  }
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

describe("API authentication boundaries", () => {
  it("returns an anonymous session without requiring a database", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { user: null });
  });

  it("keeps saved requests private to signed-in donors", async () => {
    const list = await fetch(`${baseUrl}/api/v1/saved`);
    assert.equal(list.status, 401);
    const save = await apiRequest("/api/v1/requests/00000000-0000-4000-8000-000000000000/save", { method: "PUT" });
    assert.equal(save.status, 401);
  });

  it("validates feed paging parameters before touching the database", async () => {
    const tooMany = await fetch(`${baseUrl}/api/v1/feed?limit=500`);
    assert.equal(tooMany.status, 400);
    const badCursor = await fetch(`${baseUrl}/api/v1/feed?cursor=not-a-real-cursor`);
    assert.equal(badCursor.status, 400);
  });

  it("rejects protected dashboard requests without a signed-in account", async () => {
    for (const role of ["donor", "teacher", "admin"]) {
      const response = await fetch(`${baseUrl}/api/v1/dashboard/${role}`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Sign in to continue." });
    }
  });

  it("rejects state-changing requests without a CSRF token", async () => {
    const response = await apiRequest(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "person@example.org", password: "not-a-valid-password" }),
      },
      false,
    );
    assert.equal(response.status, 403);
  });

  it("validates malformed login input before contacting the database", async () => {
    const response = await apiRequest("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "short" }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error?: unknown };
    assert.equal(typeof body.error, "string");
  });

  it("requires authentication before a teacher can create requests", async () => {
    const response = await apiRequest("/api/v1/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 401);
  });
});

describe("role authorization middleware", () => {
  it("denies a signed-in user whose role does not match", () => {
    const principal: AuthenticatedPrincipal = {
      id: "user-1",
      name: "Test Donor",
      email: "donor@example.org",
      role: "DONOR",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    };
    const request = { authUser: principal } as Request;
    let nextError: unknown;

    requireRole("ADMIN")(
      request,
      {} as Response,
      (error?: unknown) => {
        nextError = error;
      },
    );

    assert.ok(nextError instanceof HttpError);
    assert.equal((nextError as Error).message, "You do not have permission to perform this action.");
  });
});
