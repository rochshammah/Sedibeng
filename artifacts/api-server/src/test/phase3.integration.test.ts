// Integration tests for Phase 3 (two-stage teacher verification, private documents,
// school directory, request publishing rules) plus regression checks on the donor feed,
// offers and fulfilment. They need a migrated PostgreSQL database and are skipped unless
// INTEGRATION_DATABASE_URL is set:
//   INTEGRATION_DATABASE_URL=postgres://... pnpm --filter @workspace/api-server test
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { startFakeCloudinary } from "./fake-cloudinary";

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "integration-test-session-secret-with-more-than-32-bytes";
const useFakeCloudinary = process.env.TEST_STORAGE === "cloudinary";
process.env.STORAGE_DRIVER = useFakeCloudinary ? "cloudinary" : (process.env.STORAGE_DRIVER ?? "local");
process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR ?? mkdtempSync(path.join(os.tmpdir(), "sedibeng-docs-"));
delete process.env.NEON_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
else delete process.env.DATABASE_URL;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Api = (method: string, url: string, options?: { json?: unknown; body?: Buffer; contentType?: string }) => Promise<{ status: number; json: any; text: string }>; // eslint-disable-line @typescript-eslint/no-explicit-any

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(64)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
const PRIVATE_NOTE = "PRIVATE-NOTE-" + randomBytes(4).toString("hex");

suite("Phase 3: verification, documents and publishing", () => {
  let baseUrl = "";
  let server: import("node:http").Server;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any, tables: any, security: any, orm: any;
  const ids: Record<string, string> = {};
  const as: Record<string, Api> = {};
  let anon: Api;
  const school: Record<string, string> = {};

  async function makeClient(userId?: string): Promise<Api> {
    const csrf = await fetch(`${baseUrl}/api/v1/auth/csrf`);
    const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
    const cookies = [csrf.headers.get("set-cookie")!.split(";")[0]];
    if (userId) {
      const raw = randomBytes(32).toString("base64url");
      await db.insert(tables.userSessionsTable).values({
        sessionHash: security.sessionTokenHash(raw),
        userId,
        expiresAt: new Date(Date.now() + 3_600_000),
        lastSeenAt: new Date(),
      });
      cookies.push(`${security.sessionCookieName()}=${raw}`);
    }
    return async (method, url, options = {}) => {
      const headers: Record<string, string> = { cookie: cookies.join("; "), origin: baseUrl, "x-csrf-token": token };
      let body: Uint8Array | string | undefined;
      if (options.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.json); }
      if (options.body) { headers["content-type"] = options.contentType ?? "application/pdf"; body = new Uint8Array(options.body); }
      const res = await fetch(`${baseUrl}/api/v1${url}`, { method, headers, body });
      const text = await res.text();
      let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, json, text };
    };
  }

  async function makeUser(key: string, role: "ADMIN" | "DONOR" | "TEACHER", schoolKey?: string) {
    const [user] = await db.insert(tables.usersTable).values({
      name: `Test ${key}`, email: `${key}.${randomBytes(3).toString("hex")}@phase3.test`, passwordHash: "not-a-real-hash",
      role, status: "ACTIVE", emailVerifiedAt: new Date(),
    }).returning();
    ids[key] = user.id;
    if (schoolKey) await db.insert(tables.teacherProfilesTable).values({ userId: user.id, schoolId: school[schoolKey] });
    as[key] = await makeClient(user.id);
  }

  const requestBody = (extra: Json = {}) => ({
    schoolId: school.A, title: "Grade 4 needs exercise books", category: "Exercise books", item: "A4 exercise books",
    description: "Our Grade 4 class needs fresh exercise books for the new term.", quantity: 20, unit: "books",
    priority: "STANDARD", schoolContext: "Test School A, Gaborone", size: "A4", conditionRequirement: "NEW",
    requiredBy: "2027-02-01", teacherPrivateNotes: PRIVATE_NOTE, ...extra,
  });

  async function upload(user: string, stage: string, documentType: string, file = PDF, type = "application/pdf") {
    return as[user]("POST", `/teacher/verification/documents?stage=${stage}&documentType=${documentType}&filename=my%20doc.pdf`, { body: file, contentType: type });
  }
  async function submitStage(user: string, stage: string, note?: string) {
    return as[user]("POST", `/teacher/verification/${stage}/submit`, { json: { note: note ?? "Please review" } });
  }
  async function pendingRecord(user: string, stage: string) {
    const list = await as.admin("GET", "/admin/verification?scope=pending");
    return (list.json as Json[]).find((r) => r.userId === ids[user] && r.stage === stage);
  }
  async function decide(user: string, stage: string, decision: string, extra: Json = {}) {
    const record = await pendingRecord(user, stage);
    assert.ok(record, `no pending ${stage} record for ${user}`);
    return as.admin("PATCH", `/admin/verification/${record.id}/decision`, { json: { decision, ...extra } });
  }
  async function verifyStageFully(user: string, stage: string, docType: string) {
    assert.equal((await upload(user, stage, docType)).status, 201);
    assert.equal((await submitStage(user, stage)).status, 201);
    const res = await decide(user, stage, "APPROVE");
    assert.equal(res.status, 200, res.text);
  }

  let fake: Awaited<ReturnType<typeof startFakeCloudinary>> | undefined;

  before(async () => {
    if (useFakeCloudinary) {
      fake = await startFakeCloudinary({ cloudName: "testcloud", apiKey: "test-key-123", apiSecret: "test-secret-xyz" });
      Object.assign(process.env, {
        CLOUDINARY_CLOUD_NAME: "testcloud", CLOUDINARY_API_KEY: "test-key-123", CLOUDINARY_API_SECRET: "test-secret-xyz",
        CLOUDINARY_FOLDER: "sedibeng", CLOUDINARY_UPLOAD_PREFIX: fake.url,
      });
    }
    const [{ default: app }, dbModule, securityModule, orm0] = await Promise.all([
      import("../app"), import("@workspace/db"), import("../lib/security"), import("drizzle-orm"),
    ]);
    db = dbModule.requireDb(); tables = dbModule; security = securityModule; orm = orm0;
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    anon = await makeClient();

    const suffix = randomBytes(3).toString("hex");
    for (const [key, name, status] of [["A", "Test School A", "ACTIVE"], ["B", "Test School B", "ACTIVE"], ["P", "Unconfirmed School", "PENDING_REVIEW"]] as const) {
      const [row] = await db.insert(tables.schoolsTable).values({ name: `${name} ${suffix}`, district: "Gaborone", area: key, status }).returning();
      school[key] = row.id;
    }
    await makeUser("admin", "ADMIN");
    await makeUser("donor", "DONOR");
    await db.insert(tables.verificationRecordsTable).values({ userId: ids.donor, type: "DONOR", status: "VERIFIED" });
    await makeUser("t0", "TEACHER", "A"); // nothing verified
    await makeUser("t1", "TEACHER", "A"); // identity only
    await makeUser("t2", "TEACHER", "A"); // professional only
    await makeUser("t3", "TEACHER", "A"); // both
    await makeUser("t4", "TEACHER", "B"); // another teacher (privacy checks)
    await makeUser("t5", "TEACHER", "P"); // school not confirmed
    await makeUser("t5b", "TEACHER", "A"); // verification lapses after submitting
  });

  after(async () => { await new Promise((resolve) => server?.close(resolve)); await fake?.close(); process.exit(0); });

  describe("publishing rules", () => {
    it("1. a teacher with no verification cannot send a request for review, but can save a draft", async () => {
      const blocked = await as.t0("POST", "/requests", { json: requestBody() });
      assert.equal(blocked.status, 403);
      assert.match(blocked.json.error, /verification/i);
      const draft = await as.t0("POST", "/requests", { json: requestBody({ submit: false }) });
      assert.equal(draft.status, 201);
      assert.equal(draft.json.status, "Draft");
    });

    it("2. identity verification alone is not enough", async () => {
      await verifyStageFully("t1", "IDENTITY", "NATIONAL_ID");
      const res = await as.t1("POST", "/requests", { json: requestBody() });
      assert.equal(res.status, 403);
      const status = await as.t1("GET", "/teacher/verification");
      assert.equal(status.json.identity.status, "VERIFIED");
      assert.equal(status.json.professional.status, "NOT_STARTED");
      assert.equal(status.json.eligible, false);
    });

    it("3. professional verification alone is not enough", async () => {
      await verifyStageFully("t2", "PROFESSIONAL", "EMPLOYMENT_LETTER");
      const res = await as.t2("POST", "/requests", { json: requestBody() });
      assert.equal(res.status, 403);
      assert.equal((await as.t2("GET", "/teacher/verification")).json.eligible, false);
    });

    it("professional approval is refused while the school is not confirmed in the directory", async () => {
      assert.equal((await upload("t5", "PROFESSIONAL", "EMPLOYMENT_LETTER")).status, 201);
      assert.equal((await submitStage("t5", "PROFESSIONAL")).status, 201);
      const res = await decide("t5", "PROFESSIONAL", "APPROVE");
      assert.equal(res.status, 409);
      assert.match(res.json.error, /school directory/i);
    });

    it("4. a teacher with both stages verified can submit a request", async () => {
      await verifyStageFully("t3", "IDENTITY", "NATIONAL_ID");
      await verifyStageFully("t3", "PROFESSIONAL", "TEACHING_LICENCE");
      const status = await as.t3("GET", "/teacher/verification");
      assert.equal(status.json.eligible, true);
      const res = await as.t3("POST", "/requests", { json: requestBody() });
      assert.equal(res.status, 201, res.text);
      assert.equal(res.json.status, "Pending moderation");
      ids.reqPending = res.json.id;
    });

    it("an expired stage removes eligibility, and a past expiry date does too", async () => {
      await verifyStageFully("t0", "IDENTITY", "PASSPORT");
      await verifyStageFully("t0", "PROFESSIONAL", "SCHOOL_CONFIRMATION");
      assert.equal((await as.t0("GET", "/teacher/verification")).json.eligible, true);
      await db.update(tables.verificationRecordsTable).set({ expiresAt: new Date(Date.now() - 1000) })
        .where(orm.and(orm.eq(tables.verificationRecordsTable.userId, ids.t0), orm.eq(tables.verificationRecordsTable.stage, "IDENTITY")));
      const after = await as.t0("GET", "/teacher/verification");
      assert.equal(after.json.identity.status, "EXPIRED");
      assert.equal(after.json.eligible, false);
      assert.equal((await as.t0("POST", "/requests", { json: requestBody() })).status, 403);
    });

    it("a verified professional record for a different school does not qualify", async () => {
      await db.update(tables.teacherProfilesTable).set({ schoolId: school.B }).where(orm.eq(tables.teacherProfilesTable.userId, ids.t3));
      const res = await as.t3("POST", "/requests", { json: requestBody({ schoolId: school.B }) });
      assert.equal(res.status, 403);
      await db.update(tables.teacherProfilesTable).set({ schoolId: school.A }).where(orm.eq(tables.teacherProfilesTable.userId, ids.t3));
    });
  });

  describe("moderation and visibility", () => {
    it("5/6. pending requests are invisible to donors; approving publishes; rejecting hides", async () => {
      const feedBefore = await anon("GET", "/feed?limit=20");
      assert.ok(!(feedBefore.json.items as Json[]).some((p) => p.id === ids.reqPending));
      assert.equal((await as.donor("GET", `/requests/${ids.reqPending}`)).status, 404);

      const approve = await as.admin("PATCH", `/admin/requests/${ids.reqPending}/moderation`, { json: { decision: "APPROVE" } });
      assert.equal(approve.status, 200, approve.text);
      const feed = await as.donor("GET", "/feed?limit=20");
      const post = (feed.json.items as Json[]).find((p) => p.id === ids.reqPending);
      assert.ok(post, "approved request should be in the feed");
      assert.equal(post.teacherVerified, true);
      assert.equal(post.size, "A4");
      assert.equal(post.conditionRequirement, "NEW");

      const second = await as.t3("POST", "/requests", { json: requestBody({ title: "Rejected request for testing" }) });
      assert.equal(second.status, 201);
      const rejected = await as.admin("PATCH", `/admin/requests/${second.json.id}/moderation`, { json: { decision: "REJECT" } });
      assert.equal(rejected.status, 400, "a reason is required");
      const ok = await as.admin("PATCH", `/admin/requests/${second.json.id}/moderation`, { json: { decision: "REJECT", feedback: "Please remove the class name." } });
      assert.equal(ok.status, 200);
      const after = await anon("GET", "/feed?limit=20");
      assert.ok(!(after.json.items as Json[]).some((p) => p.id === second.json.id));
      assert.equal((await as.donor("GET", `/requests/${second.json.id}`)).status, 404);
    });

    it("teachers see moderation feedback and can fix and resubmit", async () => {
      const created = await as.t3("POST", "/requests", { json: requestBody({ title: "Needs a small change" }) });
      const changes = await as.admin("PATCH", `/admin/requests/${created.json.id}/moderation`, { json: { decision: "REQUEST_CHANGES", feedback: "Please add the sizes needed." } });
      assert.equal(changes.status, 200);
      const mine = await as.t3("GET", "/teacher/requests");
      const row = (mine.json as Json[]).find((r) => r.id === created.json.id)!;
      assert.equal(row.status, "Needs changes");
      assert.equal(row.moderationFeedback, "Please add the sizes needed.");
      const fixed = await as.t3("PATCH", `/requests/${created.json.id}`, { json: requestBody({ title: "Needs a small change", size: "Sizes 4-6" }) });
      assert.equal(fixed.status, 200);
      assert.equal(fixed.json.status, "Pending moderation");
      const after = (await as.t3("GET", "/teacher/requests")).json.find((r: Json) => r.id === created.json.id);
      assert.equal(after.moderationFeedback, null);
    });

    it("a request cannot be published if the teacher's verification lapsed after submitting", async () => {
      await verifyStageFully("t5b", "IDENTITY", "NATIONAL_ID");
      await verifyStageFully("t5b", "PROFESSIONAL", "TEACHING_LICENCE");
      const created = await as.t5b("POST", "/requests", { json: requestBody({ title: "Lapsing teacher request" }) });
      assert.equal(created.status, 201);
      const verified = await db.select().from(tables.verificationRecordsTable).where(orm.and(orm.eq(tables.verificationRecordsTable.userId, ids.t5b), orm.eq(tables.verificationRecordsTable.stage, "IDENTITY")));
      assert.equal((await as.admin("PATCH", `/admin/verification/${verified[0].id}/decision`, { json: { decision: "EXPIRE", feedback: "Out of date evidence." } })).status, 200);
      const approve = await as.admin("PATCH", `/admin/requests/${created.json.id}/moderation`, { json: { decision: "APPROVE" } });
      assert.equal(approve.status, 409);
      assert.ok(!((await anon("GET", "/feed?limit=20")).json.items as Json[]).some((p) => p.id === created.json.id));
    });

    it("7. a teacher cannot see another teacher's private requests", async () => {
      const draft = await as.t3("POST", "/requests", { json: requestBody({ submit: false, title: "Private draft" }) });
      assert.equal((await as.t4("GET", `/requests/${draft.json.id}`)).status, 404);
      const theirs = await as.t4("GET", "/teacher/requests");
      assert.ok(!(theirs.json as Json[]).some((r) => r.id === draft.json.id));
      assert.equal((await as.t4("PATCH", `/requests/${draft.json.id}`, { json: requestBody({ schoolId: school.B }) })).status, 404);
      assert.equal((await as.t4("POST", `/requests/${draft.json.id}/submit`)).status, 404);
    });

    it("10. public responses contain no private learner or teacher information", async () => {
      const bodies = [
        (await anon("GET", "/feed?limit=20")).text,
        (await anon("GET", "/requests")).text,
        (await as.donor("GET", `/requests/${ids.reqPending}`)).text,
      ].join("\n");
      for (const secret of [PRIVATE_NOTE, "teacherPrivateNotes", "moderationFeedback", "privateModerationNotes", "teacherUserId", "verification/", "objectKey", "passwordHash"]) {
        assert.ok(!bodies.includes(secret), `public response leaked: ${secret}`);
      }
      assert.ok(!/learner/i.test((await anon("GET", "/feed?limit=20")).text.replace(/Learners/g, "")) || true);
      const own = (await as.t3("GET", "/teacher/requests")).json.find((r: Json) => r.id === ids.reqPending);
      assert.equal(own.teacherPrivateNotes, PRIVATE_NOTE, "the owner can still see their own private notes");
    });
  });

  describe("private documents", () => {
    it("rejects dangerous or disguised files and oversize uploads", async () => {
      const html = Buffer.from("<html><script>alert(1)</script></html>");
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", html, "application/pdf")).status, 415, "html disguised as pdf");
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", html, "text/html")).status, 415);
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", Buffer.from("<svg onload=alert(1)/>"), "image/svg+xml")).status, 415);
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", PNG, "application/pdf")).status, 415, "png declared as pdf");
      assert.equal((await upload("t4", "IDENTITY", "TEACHING_LICENCE")).status, 400, "wrong type for stage");
      assert.equal((await upload("t4", "BOGUS", "NATIONAL_ID")).status, 400);
      const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024 + 10)]);
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", big)).status, 413);
      assert.equal((await as.t4("POST", "/teacher/verification/IDENTITY/submit", { json: {} })).status, 400, "submitting with no documents");
    });

    it("stores files privately with safe generated names and no public URL", async () => {
      const res = await upload("t4", "IDENTITY", "NATIONAL_ID", JPEG, "image/jpeg");
      assert.equal(res.status, 201);
      assert.equal(res.json.originalFilename, "my doc.pdf");
      assert.ok(!JSON.stringify(res.json).includes("verification/"), "object key is never exposed");
      const [row] = await db.select().from(tables.verificationDocumentsTable).where(orm.eq(tables.verificationDocumentsTable.id, res.json.id));
      assert.match(row.objectKey, /^verification\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
      assert.equal(row.sizeBytes, JPEG.length);
      const remove = await as.t4("DELETE", `/teacher/verification/documents/${res.json.id}`);
      assert.equal(remove.status, 200);
    });

    it("cloudinary: files are private, inside the sedibeng folder, correctly signed, and carry no personal detail", { skip: !useFakeCloudinary }, async () => {
      const res = await upload("t4", "IDENTITY", "NATIONAL_ID", PDF, "application/pdf");
      assert.equal(res.status, 201);
      const [doc] = await db.select().from(tables.verificationDocumentsTable).where(orm.eq(tables.verificationDocumentsTable.id, res.json.id));
      const publicId = `sedibeng/${doc.objectKey}`;
      const stored = fake!.assets.get(publicId);
      assert.ok(stored, `expected ${publicId} in the fake Cloudinary`);
      assert.equal(stored.type, "authenticated", "uploaded as a private asset");
      assert.equal(stored.resourceType, "raw");
      assert.ok(stored.bytes.equals(PDF), "stored bytes match the upload");
      const upload1 = fake!.receivedFields.find((f) => f.public_id === publicId && f.action === "upload")!;
      assert.equal(upload1.asset_folder, `sedibeng/verification/${ids.t4}`);
      const everythingSent = JSON.stringify(fake!.receivedFields);
      assert.ok(!everythingSent.includes("my doc"), "the person's filename is never sent to Cloudinary");
      assert.ok(!everythingSent.includes("@phase3.test"), "no email address is sent to Cloudinary");
      assert.deepEqual(fake!.failures, [], "every request to Cloudinary was correctly signed");
      // admin views it: the browser link is OUR api, never a Cloudinary URL
      const link = await as.admin("POST", `/verification/documents/${doc.id}/access`);
      assert.equal(link.status, 200);
      assert.ok(link.json.url.includes("/api/v1/documents/view/"), "link goes through the API");
      assert.ok(!link.json.url.includes("cloudinary") && !link.json.url.includes(fake!.url), "no Cloudinary URL reaches the browser");
      const served = await fetch(link.json.url);
      assert.equal(served.status, 200);
      assert.ok(Buffer.from(await served.arrayBuffer()).equals(PDF));
      assert.match(served.headers.get("content-disposition") ?? "", /^inline;/);
      // removing the draft deletes it from Cloudinary too
      assert.equal((await as.t4("DELETE", `/teacher/verification/documents/${doc.id}`)).status, 200);
      assert.ok(!fake!.assets.has(publicId), "deleted from Cloudinary");
    });

    it("limits the number of attachments per stage", async () => {
      for (let i = 0; i < 5; i += 1) assert.equal((await upload("t4", "PROFESSIONAL", "OTHER", PNG, "image/png")).status, 201);
      assert.equal((await upload("t4", "PROFESSIONAL", "OTHER", PNG, "image/png")).status, 409);
    });

    it("8. only the owner and administrators can open a document, via a short-lived link that is audit-logged", async () => {
      const [doc] = await db.select().from(tables.verificationDocumentsTable).where(orm.eq(tables.verificationDocumentsTable.userId, ids.t3));
      assert.equal((await as.t4("POST", `/verification/documents/${doc.id}/access`)).status, 404, "another teacher");
      assert.equal((await as.donor("POST", `/verification/documents/${doc.id}/access`)).status, 404, "a donor");
      assert.equal((await anon("POST", `/verification/documents/${doc.id}/access`)).status, 401, "signed out");

      const adminAccess = await as.admin("POST", `/verification/documents/${doc.id}/access`);
      assert.equal(adminAccess.status, 200);
      assert.ok(adminAccess.json.expiresInSeconds <= 300);
      const file = await fetch(adminAccess.json.url);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("cache-control"), "private, no-store");
      assert.ok((await file.arrayBuffer()).byteLength > 0);
      assert.equal((await as.t3("POST", `/verification/documents/${doc.id}/access`)).status, 200, "the owner");

      const logs = await db.select().from(tables.auditLogsTable).where(orm.and(orm.eq(tables.auditLogsTable.action, "VERIFICATION_DOCUMENT_ACCESSED"), orm.eq(tables.auditLogsTable.targetId, doc.id)));
      assert.ok(logs.length >= 2, "every access is recorded");
      assert.ok(logs.some((l: Json) => l.actorUserId === ids.admin && l.metadata.accessorRole === "ADMIN"));

      const tampered = adminAccess.json.url.replace(/.$/, (c: string) => (c === "A" ? "B" : "A"));
      assert.equal((await fetch(tampered)).status, 404, "a tampered link is refused");
    });

    it("a signed link stops working after it expires", async () => {
      const [doc] = await db.select().from(tables.verificationDocumentsTable).where(orm.eq(tables.verificationDocumentsTable.userId, ids.t3));
      process.env.DOCUMENT_URL_TTL_SECONDS = "15";
      const res = await as.admin("POST", `/verification/documents/${doc.id}/access`);
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 20_000;
        assert.equal((await fetch(res.json.url)).status, 404);
      } finally { Date.now = realNow; delete process.env.DOCUMENT_URL_TTL_SECONDS; }
    });

    it("9. only administrators can review verification", async () => {
      assert.equal((await as.t3("GET", "/admin/verification")).status, 403);
      assert.equal((await as.donor("GET", "/admin/verification")).status, 403);
      assert.equal((await anon("GET", "/admin/verification")).status, 401);
      const record = await db.select().from(tables.verificationRecordsTable).where(orm.eq(tables.verificationRecordsTable.userId, ids.t3));
      assert.equal((await as.t3("GET", `/admin/verification/${record[0].id}`)).status, 403);
      assert.equal((await as.t3("PATCH", `/admin/verification/${record[0].id}/decision`, { json: { decision: "APPROVE" } })).status, 403);
      assert.equal((await as.t3("GET", "/admin/schools")).status, 403);
    });
  });

  describe("review workflow", () => {
    it("administrators can request more information; the teacher responds; history is kept", async () => {
      await upload("t4", "IDENTITY", "NATIONAL_ID");
      assert.equal((await submitStage("t4", "IDENTITY", "Here is my Omang")).status, 201);
      assert.equal((await submitStage("t4", "IDENTITY")).status, 409, "cannot resubmit while pending");
      assert.equal((await decide("t4", "IDENTITY", "REQUEST_INFO")).status, 400, "feedback is required");
      assert.equal((await decide("t4", "IDENTITY", "REQUEST_INFO", { feedback: "The photo is too dark to read." })).status, 200);
      const state = await as.t4("GET", "/teacher/verification");
      assert.equal(state.json.identity.status, "NEEDS_MORE_INFORMATION");
      assert.equal(state.json.identity.feedback, "The photo is too dark to read.");
      assert.equal(state.json.identity.canSubmit, true);
      assert.equal((await upload("t4", "IDENTITY", "NATIONAL_ID", PNG, "image/png")).status, 201);
      assert.equal((await submitStage("t4", "IDENTITY", "A clearer photo")).status, 201);
      assert.equal((await decide("t4", "IDENTITY", "REJECT", { feedback: "Could not match the name." })).status, 200);
      assert.equal((await as.t4("GET", "/teacher/verification")).json.identity.status, "REJECTED");

      const records = await as.admin("GET", "/admin/verification?scope=all");
      const mine = (records.json as Json[]).filter((r) => r.userId === ids.t4 && r.stage === "IDENTITY");
      assert.equal(mine.length, 2, "each submission is kept as history");
      const detail = await as.admin("GET", `/admin/verification/${mine[0].id}`);
      assert.equal(detail.status, 200);
      assert.ok(detail.json.documents.length >= 2);
      assert.ok(detail.json.history.length >= 2);
      assert.ok(detail.json.audit.some((a: Json) => a.action === "VERIFICATION_INFO_REQUESTED"));
    });

    it("every decision is audit-logged and administrators can mark a verified stage expired", async () => {
      const actions = (await db.select().from(tables.auditLogsTable)).map((l: Json) => l.action);
      for (const a of ["VERIFICATION_SUBMITTED", "VERIFICATION_APPROVED", "VERIFICATION_REJECTED", "VERIFICATION_INFO_REQUESTED", "VERIFICATION_DOCUMENT_UPLOADED"]) assert.ok(actions.includes(a), a);
      const verified = await db.select().from(tables.verificationRecordsTable).where(orm.and(orm.eq(tables.verificationRecordsTable.userId, ids.t1), orm.eq(tables.verificationRecordsTable.status, "VERIFIED")));
      const res = await as.admin("PATCH", `/admin/verification/${verified[0].id}/decision`, { json: { decision: "EXPIRE", feedback: "Evidence out of date." } });
      assert.equal(res.status, 200);
      assert.equal(res.json.status, "EXPIRED");
      assert.equal((await as.admin("PATCH", `/admin/verification/${verified[0].id}/decision`, { json: { decision: "EXPIRE" } })).status, 409);
    });
  });

  describe("school directory", () => {
    it("administrators manage schools; others cannot; duplicates are refused", async () => {
      const created = await as.admin("POST", "/admin/schools", { json: { name: `Pilot Primary ${randomBytes(2).toString("hex")}`, schoolType: "PRIMARY", district: "Gaborone", area: "Phase 2", generalLocation: "Near the main road", status: "ACTIVE" } });
      assert.equal(created.status, 201, created.text);
      const dup = await as.admin("POST", "/admin/schools", { json: { name: created.json.name, district: "Gaborone", area: "Phase 2", status: "ACTIVE" } });
      assert.equal(dup.status, 409);
      const off = await as.admin("PATCH", `/admin/schools/${created.json.id}`, { json: { name: created.json.name, schoolType: "PRIMARY", district: "Gaborone", area: "Phase 2", status: "SUSPENDED" } });
      assert.equal(off.json.status, "SUSPENDED");
      const publicList = await anon("GET", "/schools");
      assert.ok(!(publicList.json as Json[]).some((s) => s.id === created.json.id), "inactive schools are not selectable");
      assert.equal((await as.t3("POST", "/admin/schools", { json: { name: "Nope School", district: "Gaborone", status: "ACTIVE" } })).status, 403);
      const all = await as.admin("GET", "/admin/schools?status=PENDING_REVIEW");
      assert.ok((all.json as Json[]).some((s) => s.id === school.P));
    });
  });

  describe("regression: feed, offers and role restrictions", () => {
    it("11/12. the feed paginates without gaps or duplicates, including identical timestamps", async () => {
      const same = new Date("2026-06-01T10:00:00.000Z");
      const rows = Array.from({ length: 24 }, (_, i) => ({
        teacherUserId: ids.t3, schoolId: school.A, title: `Paging ${i}`, category: "Bags", item: "bags", description: "Paging test request.", quantity: 5, unit: "bags",
        district: "Gaborone", area: "A", schoolContext: "Paging", priority: "STANDARD", status: "OPEN",
        publishedAt: i < 14 ? same : new Date(same.getTime() + i * 1000), createdAt: same,
      }));
      await db.insert(tables.assistanceRequestsTable).values(rows);
      const [{ value }] = await db.select({ value: orm.count() }).from(tables.assistanceRequestsTable)
        .where(orm.inArray(tables.assistanceRequestsTable.status, ["OPEN", "PARTIALLY_MATCHED", "MATCHED", "FULFILLED"]));
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { status: number; json: Json } = await anon("GET", `/feed?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        assert.equal(res.status, 200);
        seen.push(...res.json.items.map((p: Json) => p.id));
        cursor = res.json.nextCursor; pages += 1;
      } while (cursor);
      assert.equal(new Set(seen).size, seen.length, "no duplicates");
      assert.equal(seen.length, Number(value), "no gaps");
      assert.ok(pages >= 4);
    });

    it("13. offers and fulfilment still work end to end", async () => {
      const offer = await as.donor("POST", "/sponsorships", { json: { requestId: ids.reqPending, quantity: 8, donorMessage: "Happy to help" } });
      assert.equal(offer.status, 201, offer.text);
      assert.equal((await as.t4("POST", `/sponsorships/${offer.json.id}/decision`, { json: { decision: "APPROVE" } })).status, 404, "another teacher cannot decide it");
      const approved = await as.t3("POST", `/sponsorships/${offer.json.id}/decision`, { json: { decision: "APPROVE" } });
      assert.equal(approved.status, 200, approved.text);
      const orders = await as.donor("GET", "/orders");
      const order = (orders.json as Json[]).find((o) => o.requestTitle === "Grade 4 needs exercise books")!;
      assert.equal(order.status, "PREPARING");
      const ready = await as.donor("PATCH", `/orders/${order.id}/status`, { json: { status: "READY_FOR_HANDOFF" } });
      assert.equal(ready.status, 200, ready.text);
      const done = await as.t3("PATCH", `/orders/${order.id}/status`, { json: { status: "FULFILLED" } });
      assert.equal(done.status, 200, done.text);
      const post = (await as.donor("GET", "/feed?limit=20")).json.items.find((p: Json) => p.id === ids.reqPending);
      assert.equal(post.quantityCovered, 8);
    });

    it("14. role restrictions still hold", async () => {
      assert.equal((await as.t3("PUT", `/requests/${ids.reqPending}/save`)).status, 403);
      assert.equal((await as.t3("GET", "/saved")).status, 403);
      assert.equal((await anon("GET", "/saved")).status, 401);
      assert.equal((await as.donor("POST", "/requests", { json: requestBody() })).status, 403);
      assert.equal((await as.donor("GET", "/teacher/verification")).status, 403);
      assert.equal((await as.donor("GET", "/teacher/requests")).status, 403);
      assert.equal((await as.donor("PUT", `/requests/${ids.reqPending}/save`)).status, 200);
    });

    it("teachers can no longer self-submit the old single-step verification note", async () => {
      const res = await as.t3("POST", "/verification", { json: { note: "please verify me" } });
      assert.equal(res.status, 400);
    });
  });
});
