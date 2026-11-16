// Integration tests for Phase 4: donor goods, locations and service areas, item photos,
// location-based discovery and the offer/quantity workflow. Needs a migrated PostgreSQL
// database; skipped unless INTEGRATION_DATABASE_URL is set. TEST_STORAGE=cloudinary runs
// the photo tests against the local Cloudinary stand-in.
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
const useFakeCloudinary = process.env.TEST_STORAGE === "cloudinary";

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "integration-test-session-secret-with-more-than-32-bytes";
process.env.STORAGE_DRIVER = useFakeCloudinary ? "cloudinary" : "local";
process.env.LOCAL_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), "sedibeng-p4-"));
delete process.env.NEON_DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
delete process.env.ALLOW_UNVERIFIED_EMAIL_SIGNUP;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
else delete process.env.DATABASE_URL;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = Record<string, any>;
type Api = (method: string, url: string, options?: { json?: unknown; body?: Buffer; contentType?: string }) => Promise<{ status: number; json: any; text: string; bytes: Buffer; headers: Headers }>;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(200)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), randomBytes(64)]);

suite("Phase 4: goods, locations and discovery", () => {
  let baseUrl = "";
  let server: import("node:http").Server;
  let db: any, tables: any, security: any, orm: any;
  let fake: Awaited<ReturnType<typeof startFakeCloudinary>> | undefined;
  const ids: Record<string, string> = {};
  const loc: Record<string, string> = {};
  const area: Record<string, string> = {};
  const school: Record<string, string> = {};
  const as: Record<string, Api> = {};
  let anon: Api;

  async function makeClient(userId?: string): Promise<Api> {
    const csrf = await fetch(`${baseUrl}/api/v1/auth/csrf`);
    const token = ((await csrf.json()) as { csrfToken: string }).csrfToken;
    const cookies = [csrf.headers.get("set-cookie")!.split(";")[0]];
    if (userId) {
      const raw = randomBytes(32).toString("base64url");
      await db.insert(tables.userSessionsTable).values({ sessionHash: security.sessionTokenHash(raw), userId, expiresAt: new Date(Date.now() + 3_600_000), lastSeenAt: new Date() });
      cookies.push(`${security.sessionCookieName()}=${raw}`);
    }
    return async (method, url, options = {}) => {
      const headers: Record<string, string> = { cookie: cookies.join("; "), origin: baseUrl, "x-csrf-token": token };
      let body: Uint8Array | string | undefined;
      if (options.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(options.json); }
      if (options.body) { headers["content-type"] = options.contentType ?? "image/jpeg"; body = new Uint8Array(options.body); }
      const res = await fetch(`${baseUrl}/api/v1${url}`, { method, headers, body });
      const bytes = Buffer.from(await res.arrayBuffer());
      const text = bytes.toString("utf8");
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* binary or empty */ }
      return { status: res.status, json, text, bytes, headers: res.headers };
    };
  }

  async function makeUser(key: string, role: "ADMIN" | "DONOR" | "TEACHER", options: { schoolKey?: string; verified?: boolean } = {}) {
    const [user] = await db.insert(tables.usersTable).values({ name: `Test ${key}`, email: `${key}.${randomBytes(3).toString("hex")}@phase4.test`, passwordHash: "not-a-real-hash", role, status: "ACTIVE", emailVerifiedAt: new Date() }).returning();
    ids[key] = user.id;
    if (role === "TEACHER") {
      await db.insert(tables.teacherProfilesTable).values({ userId: user.id, schoolId: school[options.schoolKey!] });
      if (options.verified !== false) {
        await db.insert(tables.verificationRecordsTable).values([
          { userId: user.id, type: "TEACHER", stage: "IDENTITY", status: "VERIFIED" },
          { userId: user.id, type: "TEACHER", stage: "PROFESSIONAL", status: "VERIFIED", schoolId: school[options.schoolKey!] },
        ]);
      }
    }
    if (role === "DONOR" && options.verified !== false) await db.insert(tables.verificationRecordsTable).values({ userId: user.id, type: "DONOR", status: "VERIFIED" });
    as[key] = await makeClient(user.id);
  }

  const goods = (locationId: string, extra: Json = {}) => ({ title: "School shoes", category: "School shoes", description: "Black leather shoes, sizes 3 to 5.", quantityAvailable: 10, unit: "pairs", condition: "GOOD", locationId, ...extra });
  const requestBody = (teacher: string, extra: Json = {}) => ({ schoolId: school[teacher], title: "Shoes for Grade 4", category: "School shoes", item: "black school shoes", description: "Several learners need sturdy shoes.", quantity: 10, unit: "pairs", priority: "STANDARD", schoolContext: "Test school", ...extra });

  async function publishRequest(teacher: string, schoolKey: string, extra: Json = {}) {
    const created = await as[teacher]("POST", "/requests", { json: requestBody(schoolKey, extra) });
    assert.equal(created.status, 201, created.text);
    const approved = await as.admin("PATCH", `/admin/requests/${created.json.id}/moderation`, { json: { decision: "APPROVE" } });
    assert.equal(approved.status, 200, approved.text);
    return approved.json;
  }

  before(async () => {
   try {
    if (useFakeCloudinary) {
      fake = await startFakeCloudinary({ cloudName: "testcloud", apiKey: "test-key-123", apiSecret: "test-secret-xyz" });
      Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: "testcloud", CLOUDINARY_API_KEY: "test-key-123", CLOUDINARY_API_SECRET: "test-secret-xyz", CLOUDINARY_FOLDER: "sedibeng", CLOUDINARY_UPLOAD_PREFIX: fake.url });
    }
    const [{ default: app }, dbModule, securityModule, orm0] = await Promise.all([import("../app"), import("@workspace/db"), import("../lib/security"), import("drizzle-orm")]);
    db = dbModule.requireDb(); tables = dbModule; security = securityModule; orm = orm0;
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    anon = await makeClient();

    for (const row of await db.select().from(tables.locationsTable)) loc[row.name] = row.id;
    for (const row of await db.select().from(tables.serviceAreasTable)) area[row.name] = row.id;
    const suffix = randomBytes(3).toString("hex");
    for (const [key, name, locationName] of [["G", "Gaborone School", "Gaborone"], ["T", "Tlokweng School", "Tlokweng"], ["K", "Kasane School", "Kasane"], ["N", "No Location School", null]] as const) {
      const [row] = await db.insert(tables.schoolsTable).values({ name: `${name} ${suffix}`, district: "Test", area: key, status: "ACTIVE", locationId: locationName ? loc[locationName] : null }).returning();
      school[key] = row.id;
    }
    await makeUser("admin", "ADMIN");
    await makeUser("donor1", "DONOR"); await makeUser("donor2", "DONOR"); await makeUser("donor3", "DONOR"); await makeUser("donorNew", "DONOR", { verified: false });
    await makeUser("tG", "TEACHER", { schoolKey: "G" }); await makeUser("tT", "TEACHER", { schoolKey: "T" });
    await makeUser("tK", "TEACHER", { schoolKey: "K" }); await makeUser("tN", "TEACHER", { schoolKey: "N" });
   } catch (error) { console.error("SETUP FAILED:", error); throw error; }
  });

  after(async () => { await new Promise((resolve) => server?.close(resolve)); await fake?.close(); process.exit(0); });

  describe("locations and service areas", () => {
    it("Greater Gaborone groups its six locations; other towns have their own areas", async () => {
      const tree = (await anon("GET", "/locations")).json as Json[];
      const gaborone = tree.find((a) => a.name === "Greater Gaborone")!;
      assert.deepEqual(gaborone.locations.map((l: Json) => l.name).sort(), ["Gabane", "Gaborone", "Metsimotlhabe", "Mmopane", "Mogoditshane", "Tlokweng"]);
      for (const town of ["Francistown", "Maun", "Palapye", "Kasane"]) {
        const own = tree.find((a) => a.name === town)!;
        assert.deepEqual(own.locations.map((l: Json) => l.name), [town], `${town} is its own area`);
      }
      assert.ok(!tree.some((a) => a.id === gaborone.id && a.locations.some((l: Json) => l.name === "Kasane")));
    });

    it("administrators can add, move and switch off locations; nobody else can", async () => {
      const created = await as.admin("POST", "/admin/locations/create", { json: { name: `Test Village ${randomBytes(2).toString("hex")}`, serviceAreaId: area["Greater Gaborone"], isActive: true } });
      assert.equal(created.status, 201, created.text);
      assert.equal((await as.admin("POST", "/admin/locations/create", { json: { name: created.json.name.toUpperCase(), serviceAreaId: area["Maun"], isActive: true } })).status, 409, "duplicate names refused");
      const moved = await as.admin("PATCH", `/admin/locations/${created.json.id}`, { json: { name: created.json.name, serviceAreaId: area["Maun"], isActive: false } });
      assert.equal(moved.status, 200);
      const publicTree = (await anon("GET", "/locations")).json as Json[];
      assert.ok(!publicTree.some((a) => a.locations.some((l: Json) => l.id === created.json.id)), "inactive locations are not selectable");
      const adminTree = (await as.admin("GET", "/admin/locations")).json as Json[];
      assert.ok(adminTree.find((a) => a.name === "Maun")!.locations.some((l: Json) => l.id === created.json.id && l.isActive === false));
      const newArea = await as.admin("POST", "/admin/service-areas", { json: { name: `Test Area ${randomBytes(2).toString("hex")}`, isActive: true } });
      assert.equal(newArea.status, 201);
      for (const [method, url, json] of [["GET", "/admin/locations", undefined], ["POST", "/admin/service-areas", { name: "Nope", isActive: true }], ["POST", "/admin/locations/create", { name: "Nope", serviceAreaId: area["Maun"], isActive: true }], ["PATCH", `/admin/locations/${created.json.id}`, { name: "x", serviceAreaId: area["Maun"], isActive: true }]] as const) {
        assert.equal((await as.donor1(method, url, json ? { json } : {})).status, 403, `donor ${method} ${url}`);
        assert.equal((await as.tG(method, url, json ? { json } : {})).status, 403, `teacher ${method} ${url}`);
      }
    });

    it("a person's default area is only a preference, and cannot change their role", async () => {
      assert.equal((await as.tG("GET", "/me/service-area")).json.serviceAreaName, "Greater Gaborone", "teacher default comes from the school");
      assert.equal((await as.tG("GET", "/me/service-area")).json.source, "SCHOOL");
      const set = await as.donor1("PUT", "/me/service-area", { json: { serviceAreaId: area["Kasane"], role: "ADMIN", status: "ACTIVE" } });
      assert.equal(set.status, 200);
      assert.equal(set.json.serviceAreaName, "Kasane");
      const [user] = await db.select().from(tables.usersTable).where(orm.eq(tables.usersTable.id, ids.donor1));
      assert.equal(user.role, "DONOR", "role unchanged");
      assert.equal((await as.donor1("PUT", "/me/service-area", { json: { serviceAreaId: "00000000-0000-4000-8000-000000000000" } })).status, 400);
      await as.donor1("PUT", "/me/service-area", { json: { serviceAreaId: null } });
      assert.equal((await as.donor1("GET", "/me/service-area")).json.source, "NONE");
    });
  });

  describe("donor goods", () => {
    it("adds one item and several items; location, quantity and condition are validated on the server", async () => {
      const one = await as.donor1("POST", "/inventory", { json: goods(loc["Mogoditshane"]) });
      assert.equal(one.status, 201, one.text);
      assert.equal(one.json.status, "AVAILABLE");
      assert.equal(one.json.locationName, "Mogoditshane");
      assert.equal(one.json.serviceAreaName, "Greater Gaborone");
      assert.equal(one.json.categoryGroup, "SHOES");
      ids.shoesMogo = one.json.id;
      const bulk = await as.donor1("POST", "/inventory/bulk", { json: { items: [goods(loc["Gaborone"], { title: "Uniforms", category: "School uniforms", quantityAvailable: 5 }), goods(loc["Gaborone"], { title: "Exercise books", category: "Books and stationery", unit: "books", quantityAvailable: 40, condition: "NEW" })] } });
      assert.equal(bulk.status, 201, bulk.text);
      assert.equal(bulk.json.length, 2);
      assert.deepEqual(bulk.json.map((i: Json) => i.categoryGroup).sort(), ["BOOKS_STATIONERY", "UNIFORMS"]);
      for (const bad of [
        goods(loc["Gaborone"], { locationId: undefined }), goods("not-a-uuid"), goods("00000000-0000-4000-8000-000000000000"),
        goods(loc["Gaborone"], { quantityAvailable: 0 }), goods(loc["Gaborone"], { quantityAvailable: -3 }), goods(loc["Gaborone"], { condition: "BROKEN" }), goods(loc["Gaborone"], { title: " " }),
      ]) assert.equal((await as.donor1("POST", "/inventory", { json: bad })).status, 400, JSON.stringify(bad).slice(0, 80));
      const inactive = await db.insert(tables.locationsTable).values({ name: `Switched Off ${randomBytes(2).toString("hex")}`, serviceAreaId: area["Maun"], isActive: false }).returning();
      assert.equal((await as.donor1("POST", "/inventory", { json: goods(inactive[0].id) })).status, 400, "inactive location refused");
      assert.equal((await as.donor1("POST", "/inventory/bulk", { json: { items: [] } })).status, 400);
    });

    it("an unverified donor's goods wait as drafts; teachers and anonymous users cannot list goods", async () => {
      const draft = await as.donorNew("POST", "/inventory", { json: goods(loc["Gaborone"]) });
      assert.equal(draft.status, 201);
      assert.equal(draft.json.status, "DRAFT");
      assert.equal((await as.tG("POST", "/inventory", { json: goods(loc["Gaborone"]) })).status, 403);
      assert.equal((await anon("POST", "/inventory", { json: goods(loc["Gaborone"]) })).status, 401);
      assert.ok(!((await as.tG("GET", "/goods")).json as Json[]).some((g) => g.id === draft.json.id), "drafts are never shown to teachers");
    });

    it("donors can edit and withdraw only their own listings (no access through manipulated ids)", async () => {
      const edited = await as.donor1("PATCH", `/inventory/${ids.shoesMogo}`, { json: goods(loc["Mogoditshane"], { quantityAvailable: 12, description: "Black shoes, sizes 3-6." }) });
      assert.equal(edited.status, 200, edited.text);
      assert.equal(edited.json.quantityAvailable, 12);
      assert.equal((await as.donor2("PATCH", `/inventory/${ids.shoesMogo}`, { json: goods(loc["Gaborone"]) })).status, 404, "another donor cannot edit it");
      assert.equal((await as.donor2("DELETE", `/inventory/${ids.shoesMogo}`)).status, 404, "another donor cannot withdraw it");
      assert.equal((await as.donor2("POST", `/inventory/${ids.shoesMogo}/photo`, { body: JPEG, contentType: "image/jpeg" })).status, 404, "another donor cannot add a photo");
      assert.ok(!((await as.donor2("GET", "/inventory")).json as Json[]).some((i) => i.id === ids.shoesMogo), "not in another donor's list");
      const temp = await as.donor1("POST", "/inventory", { json: goods(loc["Gaborone"], { title: "To withdraw" }) });
      assert.equal((await as.donor1("DELETE", `/inventory/${temp.json.id}`)).status, 204);
      const list = (await as.donor1("GET", "/inventory")).json as Json[];
      assert.equal(list.find((i) => i.id === temp.json.id)!.status, "WITHDRAWN");
      assert.ok(!((await as.tG("GET", "/goods")).json as Json[]).some((g) => g.id === temp.json.id), "withdrawn goods vanish from discovery");
    });
  });

  describe("item photos", () => {
    it("rejects non-photos, disguised files and oversize uploads", async () => {
      const url = `/inventory/${ids.shoesMogo}/photo`;
      assert.equal((await as.donor1("POST", url, { body: PDF, contentType: "application/pdf" })).status, 415, "pdf is not a photo");
      assert.equal((await as.donor1("POST", url, { body: Buffer.from("<html><script>alert(1)</script></html>"), contentType: "image/jpeg" })).status, 415, "html disguised as jpeg");
      assert.equal((await as.donor1("POST", url, { body: PNG, contentType: "image/jpeg" })).status, 415, "png declared as jpeg");
      assert.equal((await as.donor1("POST", url, { body: Buffer.from("<svg onload=alert(1)/>"), contentType: "image/svg+xml" })).status, 415);
      assert.equal((await as.donor1("POST", url, { body: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]), contentType: "image/jpeg" })).status, 413);
      assert.equal((await as.donor1("POST", url, { body: JPEG, contentType: "image/jpeg" }).then((r) => r.status)), 200);
    });

    it("stores photos in the item-photos folder, separate from verification documents", async () => {
      const [row] = await db.select().from(tables.donorInventoryTable).where(orm.eq(tables.donorInventoryTable.id, ids.shoesMogo));
      assert.match(row.photoObjectKey, /^item-photos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
      assert.ok(!row.photoObjectKey.startsWith("verification/"));
      assert.equal(row.photoStatus, "PENDING");
      if (fake) {
        const publicId = `sedibeng/${row.photoObjectKey}`;
        assert.ok(fake.assets.has(publicId), "uploaded to the sedibeng/item-photos folder");
        assert.equal(fake.assets.get(publicId)!.type, "authenticated", "private, not public delivery");
        assert.ok([...fake.assets.keys()].filter((k) => k.startsWith("sedibeng/item-photos/")).every((k) => !k.includes("/verification/")));
        assert.deepEqual(fake.failures, []);
      }
    });

    it("a photo is shown to teachers only after an administrator approves it", async () => {
      const photoUrl = `/inventory/${ids.shoesMogo}/photo`;
      assert.equal((await as.donor1("GET", photoUrl)).status, 200, "the owner sees their own photo");
      assert.ok((await as.donor1("GET", photoUrl)).bytes.equals(JPEG));
      assert.equal((await as.tG("GET", photoUrl)).status, 404, "a teacher cannot see it while pending");
      assert.equal((await as.donor2("GET", photoUrl)).status, 404, "another donor cannot see it");
      assert.equal((await anon("GET", photoUrl)).status, 401, "signed-out users cannot see it");
      assert.equal((await as.admin("GET", photoUrl)).status, 200, "administrators can review it");
      const goodsBefore = ((await as.tG("GET", "/goods")).json as Json[]).find((g) => g.id === ids.shoesMogo)!;
      assert.equal(goodsBefore.photoVersion, null, "no photo reference is exposed before approval");

      const pending = (await as.admin("GET", "/admin/goods-photos")).json as Json[];
      assert.ok(pending.some((p) => p.id === ids.shoesMogo));
      assert.equal((await as.donor1("GET", "/admin/goods-photos")).status, 403);
      assert.equal((await as.tG("POST", `/admin/goods-photos/${ids.shoesMogo}/decision`, { json: { decision: "APPROVE" } })).status, 403);
      assert.equal((await as.admin("POST", `/admin/goods-photos/${ids.shoesMogo}/decision`, { json: { decision: "APPROVE" } })).status, 200);

      const shown = await as.tG("GET", photoUrl);
      assert.equal(shown.status, 200);
      assert.ok(shown.bytes.equals(JPEG));
      assert.equal(shown.headers.get("x-content-type-options"), "nosniff");
      assert.ok(((await as.tG("GET", "/goods")).json as Json[]).find((g) => g.id === ids.shoesMogo)!.photoVersion);
    });

    it("replacing a photo needs approval again, rejecting removes it, and withdrawing hides it", async () => {
      const url = `/inventory/${ids.shoesMogo}/photo`;
      const [before] = await db.select().from(tables.donorInventoryTable).where(orm.eq(tables.donorInventoryTable.id, ids.shoesMogo));
      assert.equal((await as.donor1("POST", url, { body: PNG, contentType: "image/png" })).status, 200);
      assert.equal((await as.tG("GET", url)).status, 404, "pending again after a replacement");
      if (fake) assert.ok(!fake.assets.has(`sedibeng/${before.photoObjectKey}`), "the old photo was deleted from Cloudinary");
      assert.equal((await as.admin("POST", `/admin/goods-photos/${ids.shoesMogo}/decision`, { json: { decision: "REJECT" } })).status, 200);
      assert.equal((await as.tG("GET", url)).status, 404);
      const [rejected] = await db.select().from(tables.donorInventoryTable).where(orm.eq(tables.donorInventoryTable.id, ids.shoesMogo));
      assert.equal(rejected.photoStatus, "REJECTED");
      assert.equal(rejected.photoObjectKey, null, "a rejected photo is not kept");
      const item = (await as.donor1("POST", "/inventory", { json: goods(loc["Gaborone"], { title: "Photo then withdraw" }) })).json;
      await as.donor1("POST", `/inventory/${item.id}/photo`, { body: JPEG, contentType: "image/jpeg" });
      await as.admin("POST", `/admin/goods-photos/${item.id}/decision`, { json: { decision: "APPROVE" } });
      assert.equal((await as.tG("GET", `/inventory/${item.id}/photo`)).status, 200);
      await as.donor1("DELETE", `/inventory/${item.id}`);
      assert.equal((await as.tG("GET", `/inventory/${item.id}/photo`)).status, 404, "a withdrawn item's photo is gone");
    });

    it("verification documents stay private and cannot be read through the photo route", async () => {
      const [doc] = await db.insert(tables.verificationDocumentsTable).values({ userId: ids.tG, stage: "IDENTITY", documentType: "NATIONAL_ID", originalFilename: "id.pdf", contentType: "application/pdf", sizeBytes: 10, sha256: "x", objectKey: `verification/${ids.tG}/${randomBytes(8).toString("hex")}.pdf` }).returning();
      const [item] = await db.insert(tables.donorInventoryTable).values({ donorUserId: ids.donor2, title: "Trap", category: "Bags", categoryGroup: "BAGS", item: "Trap", description: "Trap listing", quantityAvailable: 1, unit: "bags", district: "Gaborone", locationId: loc["Gaborone"], status: "AVAILABLE", photoStatus: "APPROVED", photoObjectKey: doc.objectKey, photoContentType: "application/pdf" }).returning();
      assert.equal((await as.tG("GET", `/inventory/${item.id}/photo`)).status, 404, "a verification key can never be served as a photo");
      assert.equal((await as.admin("GET", `/inventory/${item.id}/photo`)).status, 404);
      assert.equal((await as.tK("POST", `/verification/documents/${doc.id}/access`)).status, 404, "another teacher still cannot open the document");
      assert.equal((await as.admin("POST", `/verification/documents/${doc.id}/access`)).status, 200, "administrators can still open verification documents");
      await db.delete(tables.donorInventoryTable).where(orm.eq(tables.donorInventoryTable.id, item.id));
    });
  });

  describe("location-based discovery", () => {
    let reqGaboroneShoes: Json, reqTlokwengShoes: Json, reqKasaneShoes: Json, reqTlokwengUniforms: Json;
    let kasaneGoods: Json;

    it("teachers choose or inherit a location; drafts may wait, sending needs one", async () => {
      reqGaboroneShoes = await publishRequest("tG", "G");
      assert.equal(reqGaboroneShoes.locationName, "Gaborone", "the school's location is used by default");
      assert.equal(reqGaboroneShoes.serviceAreaName, "Greater Gaborone");
      assert.equal(reqGaboroneShoes.categoryGroup, "SHOES");
      reqTlokwengShoes = await publishRequest("tT", "T");
      assert.equal(reqTlokwengShoes.locationName, "Tlokweng");
      reqKasaneShoes = await publishRequest("tK", "K");
      assert.equal(reqKasaneShoes.serviceAreaName, "Kasane");
      reqTlokwengUniforms = await publishRequest("tT", "T", { title: "Uniforms for Grade 1", category: "School uniforms", item: "uniforms" });

      assert.equal((await as.tN("POST", "/requests", { json: requestBody("N") })).status, 400, "a school with no location needs one chosen");
      const draft = await as.tN("POST", "/requests", { json: requestBody("N", { submit: false }) });
      assert.equal(draft.status, 201, "drafts can be saved without a location");
      const chosen = await as.tN("POST", "/requests", { json: requestBody("N", { locationId: loc["Mogoditshane"] }) });
      assert.equal(chosen.status, 201, chosen.text);
      assert.equal(chosen.json.locationName, "Mogoditshane");
      assert.equal((await as.tN("POST", "/requests", { json: requestBody("N", { locationId: "00000000-0000-4000-8000-000000000000" }) })).status, 400, "unknown location refused");
      const override = await as.tG("POST", "/requests", { json: requestBody("G", { locationId: loc["Tlokweng"] }) });
      assert.equal(override.json.locationName, "Tlokweng", "a teacher can pick another approved location");
    });

    it("the actual location is shown on every post", async () => {
      const feed = (await anon("GET", "/feed?limit=20")).json.items as Json[];
      const post = feed.find((p) => p.id === reqTlokwengShoes.id)!;
      assert.equal(post.locationName, "Tlokweng");
      assert.equal(post.location, "Tlokweng");
      assert.equal(post.serviceAreaName, "Greater Gaborone");
      assert.equal(feed.find((p) => p.id === reqKasaneShoes.id)!.locationName, "Kasane");
    });

    it("the same service area and a relevant category are suggested to each other", async () => {
      // donor1 lists shoes in Mogoditshane (Greater Gaborone); teachers in Gaborone and Tlokweng ask for shoes
      const asGaborone = ((await as.tG("GET", `/goods?serviceAreaId=${area["Greater Gaborone"]}`)).json as Json[]).find((g) => g.id === ids.shoesMogo)!;
      assert.ok(asGaborone, "the Mogoditshane shoes are listed for a Gaborone teacher");
      assert.equal(asGaborone.locationName, "Mogoditshane", "the donor's actual location is shown");
      assert.equal(asGaborone.inMyServiceArea, true);
      assert.equal(asGaborone.localMatch, true, "Gaborone teacher has a live shoes request in the same service area");
      assert.equal(((await as.tT("GET", `/goods?serviceAreaId=${area["Greater Gaborone"]}`)).json as Json[]).find((g) => g.id === ids.shoesMogo)!.localMatch, true, "and so does the Tlokweng teacher");
      // a donor whose only goods are shoes in Mogoditshane (Greater Gaborone)
      assert.equal((await as.donor3("POST", "/inventory", { json: goods(loc["Mogoditshane"], { title: "Donor 3 shoes" }) })).status, 201);
      const feed = (await as.donor3("GET", "/feed?limit=20")).json.items as Json[];
      assert.equal(feed.find((p) => p.id === reqGaboroneShoes.id)!.localMatch, true, "Gaborone shoes request is local to Mogoditshane shoes");
      assert.equal(feed.find((p) => p.id === reqTlokwengShoes.id)!.localMatch, true);
      assert.equal(feed.find((p) => p.id === reqKasaneShoes.id)!.localMatch, false, "Kasane is a different service area");
      assert.equal(feed.find((p) => p.id === reqTlokwengUniforms.id)!.localMatch, false, "a uniforms request is not relevant to shoes");
      // donor1 also listed uniforms in Gaborone earlier, so the uniforms request is local to them
      const feed1 = (await as.donor1("GET", "/feed?limit=20")).json.items as Json[];
      assert.equal(feed1.find((p) => p.id === reqTlokwengUniforms.id)!.localMatch, true, "donor1 listed uniforms in the same service area");
      assert.equal(feed1.find((p) => p.id === reqKasaneShoes.id)!.localMatch, false);
      // a donor with no goods gets no local-match labels at all
      const nothing = (await as.donorNew("GET", "/feed?limit=20")).json.items as Json[];
      assert.ok(nothing.every((p) => p.localMatch === false));
      // matching never looks at sizes: the description mentions sizes 3-5 but is not compared with the request
      assert.ok(!JSON.stringify(feed).includes("sizes 3"), "item descriptions are not part of feed posts");
    });

    it("goods in a different service area are not suggested, but can be explored", async () => {
      kasaneGoods = (await as.donor2("POST", "/inventory", { json: goods(loc["Kasane"], { title: "Kasane shoes" }) })).json;
      // default view for the Gaborone teacher: their own service area only
      const local = (await as.tG("GET", `/goods?serviceAreaId=${area["Greater Gaborone"]}`)).json as Json[];
      assert.ok(!local.some((g) => g.id === kasaneGoods.id), "not shown in the Gaborone service area");
      const all = (await as.tG("GET", "/goods")).json as Json[];
      const seen = all.find((g) => g.id === kasaneGoods.id)!;
      assert.ok(seen, "visible when exploring all areas");
      assert.equal(seen.inMyServiceArea, false);
      assert.equal(seen.localMatch, false, "never suggested as a local match");
      assert.equal(seen.serviceAreaName, "Kasane");
      const onlyKasane = (await as.tG("GET", `/goods?serviceAreaId=${area["Kasane"]}`)).json as Json[];
      assert.ok(onlyKasane.every((g) => g.serviceAreaName === "Kasane") && onlyKasane.some((g) => g.id === kasaneGoods.id));
      const kasaneTeacher = ((await as.tK("GET", "/goods")).json as Json[]).find((g) => g.id === kasaneGoods.id)!;
      assert.equal(kasaneTeacher.localMatch, true, "but it IS local to the Kasane teacher who asked for shoes");
      assert.equal(((await as.tG("GET", `/goods?categoryGroup=UNIFORMS`)).json as Json[]).every((g) => g.categoryGroup === "UNIFORMS"), true);
      assert.equal(((await as.tG("GET", `/goods?locationId=${loc["Mogoditshane"]}`)).json as Json[]).every((g) => g.locationName === "Mogoditshane"), true);
      assert.equal((await as.donor1("GET", "/goods")).status, 403, "donors do not browse other donors' goods");
      assert.equal((await anon("GET", "/goods")).status, 401);
      const tree = JSON.stringify((await as.tG("GET", "/goods")).json);
      for (const secret of ["donorUserId", "donor1", "@phase4.test", "photoObjectKey", "item-photos/"]) assert.ok(!tree.includes(secret), `goods listing leaked ${secret}`);
    });

    it("the donor feed filters by service area and category without duplicates or gaps, newest first", async () => {
      const same = new Date("2026-05-01T10:00:00.000Z");
      await db.insert(tables.assistanceRequestsTable).values(Array.from({ length: 24 }, (_, i) => ({
        teacherUserId: ids.tG, schoolId: school.G, title: `Area paging ${i}`, category: "School bags", categoryGroup: "BAGS", item: "bags", description: "Paging test.", quantity: 3, unit: "bags",
        district: "Test", area: "G", schoolContext: "x", priority: "STANDARD", status: "OPEN", locationId: i % 2 === 0 ? loc["Gaborone"] : loc["Kasane"],
        publishedAt: i < 12 ? same : new Date(same.getTime() + i * 1000), createdAt: same,
      })));
      const collect = async (query: string) => {
        const seen: Json[] = []; let cursor: string | null = null; let pages = 0;
        do {
          const res: { status: number; json: any } = await as.donor1("GET", `/feed?limit=7${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
          assert.equal(res.status, 200); seen.push(...res.json.items); cursor = res.json.nextCursor; pages += 1;
        } while (cursor);
        return { seen, pages };
      };
      const area1 = await collect(`&serviceAreaId=${area["Greater Gaborone"]}`);
      assert.ok(area1.seen.every((p) => p.serviceAreaName === "Greater Gaborone"));
      assert.equal(new Set(area1.seen.map((p) => p.id)).size, area1.seen.length, "no duplicates");
      const [{ value }] = await db.select({ value: orm.count() }).from(tables.assistanceRequestsTable).innerJoin(tables.locationsTable, orm.eq(tables.assistanceRequestsTable.locationId, tables.locationsTable.id))
        .where(orm.and(orm.eq(tables.locationsTable.serviceAreaId, area["Greater Gaborone"]), orm.inArray(tables.assistanceRequestsTable.status, ["OPEN", "PARTIALLY_MATCHED", "MATCHED", "FULFILLED"])));
      assert.equal(area1.seen.length, Number(value), "no gaps");
      assert.ok(area1.pages >= 2);
      const times = area1.seen.map((p) => p.postedAt);
      assert.ok(times.every((t, i) => i === 0 || t <= times[i - 1]), "newest first");
      const everything = await collect("");
      assert.ok(everything.seen.length > area1.seen.length, "all areas shows more");
      const bags = await collect("&categoryGroup=BAGS");
      assert.ok(bags.seen.every((p) => p.categoryGroup === "BAGS") && bags.seen.length >= 24);
      const urgent = ((await as.donor1("GET", "/feed?priority=Essential&limit=20")).json.items as Json[]);
      assert.ok(urgent.every((p) => p.priority === "Essential"), "Urgent is still a filter, not a ranking boost");
    });
  });

  describe("offers and quantities", () => {
    let request: Json;
    before(async () => { request = await publishRequest("tG", "G", { title: "Shoes for offers", quantity: 50 }); });

    it("requires a listing, and the goods must suit the request", async () => {
      assert.equal((await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, quantity: 2 } })).status, 400, "an offer must name one of the donor's goods");
      const uniforms = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.title === "Uniforms");
      const wrong = await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: uniforms.id, quantity: 1 } });
      assert.equal(wrong.status, 400);
      assert.match(wrong.json.error, /kind of item/i);
      const others = await as.donor2("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: ids.shoesMogo, quantity: 1 } });
      assert.equal(others.status, 400, "another donor's goods cannot be offered");
      const unverified = await as.donorNew("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: ids.shoesMogo, quantity: 1 } });
      assert.equal(unverified.status, 403, "an unverified donor cannot offer");
    });

    it("never lets offers exceed the quantity available, and offering everything works", async () => {
      const item = (await as.donor1("POST", "/inventory", { json: goods(loc["Gaborone"], { title: "Limited shoes", quantityAvailable: 6 }) })).json;
      const tooMany = await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 7 } });
      assert.equal(tooMany.status, 400);
      assert.match(tooMany.json.error, /only have 6/);
      assert.equal((await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 0 } })).status, 400);
      assert.equal((await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: -2 } })).status, 400);
      const all = await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 6 } });
      assert.equal(all.status, 201, all.text); // used to fail with a database error
      assert.equal(all.json.inventoryTitle, "Limited shoes");
      const after = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.id === item.id);
      assert.equal(after.quantityAvailable, 0);
      assert.equal(after.status, "RESERVED");
      assert.equal(after.offerCount, 1);
      assert.equal(after.pendingOfferCount, 1);
      assert.equal((await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 1 } })).status, 400, "nothing left to offer");
      ids.reservedItem = item.id; ids.reservedOffer = all.json.id;
    });

    it("declining gives goods back; accepting keeps them reserved; delivery is a separate step", async () => {
      const declined = await as.tG("POST", `/sponsorships/${ids.reservedOffer}/decision`, { json: { decision: "REJECT" } });
      assert.equal(declined.status, 200, declined.text);
      let item = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.id === ids.reservedItem);
      assert.equal(item.quantityAvailable, 6, "quantity restored");
      assert.equal(item.status, "AVAILABLE");
      const offer = await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: ids.reservedItem, quantity: 4, donorMessage: "Collect any weekday" } });
      assert.equal(offer.status, 201);
      assert.equal((await as.tK("POST", `/sponsorships/${offer.json.id}/decision`, { json: { decision: "APPROVE" } })).status, 404, "another teacher cannot decide it");
      const accepted = await as.tG("POST", `/sponsorships/${offer.json.id}/decision`, { json: { decision: "APPROVE" } });
      assert.equal(accepted.status, 200);
      item = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.id === ids.reservedItem);
      assert.equal(item.quantityAvailable, 2, "accepted goods stay set aside");
      const order = ((await as.donor1("GET", "/orders")).json as Json[]).find((o) => o.requestTitle === "Shoes for offers" && o.quantity === 4)!;
      assert.equal(order.status, "PREPARING", "accepting an offer does not mark goods delivered");
      assert.equal((await as.donor1("PATCH", `/orders/${order.id}/status`, { json: { status: "CANCELLED" } })).status, 200);
      item = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.id === ids.reservedItem);
      assert.equal(item.quantityAvailable, 6, "a cancelled handoff gives the goods back");
    });

    it("giving goods back never revives a listing the donor withdrew", async () => {
      const item = (await as.donor1("POST", "/inventory", { json: goods(loc["Gaborone"], { title: "Withdrawn later", quantityAvailable: 5 }) })).json;
      const offer = await as.donor1("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 5 } });
      assert.equal(offer.status, 201);
      assert.equal((await as.donor1("DELETE", `/inventory/${item.id}`)).status, 204);
      assert.equal((await as.tG("POST", `/sponsorships/${offer.json.id}/decision`, { json: { decision: "REJECT" } })).status, 200);
      const after = (await as.donor1("GET", "/inventory")).json.find((i: Json) => i.id === item.id);
      assert.equal(after.status, "WITHDRAWN", "still withdrawn");
      assert.ok(!((await as.tG("GET", "/goods")).json as Json[]).some((g) => g.id === item.id));
    });

    it("simultaneous offers can never overdraw the stock", async () => {
      const item = (await as.donor2("POST", "/inventory", { json: goods(loc["Gaborone"], { title: "Race shoes", quantityAvailable: 10 }) })).json;
      const results = await Promise.all([1, 2, 3, 4].map(() => as.donor2("POST", "/sponsorships", { json: { requestId: request.id, inventoryId: item.id, quantity: 4 } })));
      const ok = results.filter((r) => r.status === 201).length;
      assert.equal(ok, 2, "exactly two offers of 4 fit into 10");
      const [row] = await db.select().from(tables.donorInventoryTable).where(orm.eq(tables.donorInventoryTable.id, item.id));
      assert.equal(row.quantityAvailable, 2);
      assert.ok(row.quantityAvailable >= 0);
      const [sum] = await db.select({ total: orm.sql<number>`coalesce(sum(quantity),0)::int` }).from(tables.sponsorshipsTable).where(orm.eq(tables.sponsorshipsTable.inventoryId, item.id));
      assert.equal(sum.total + row.quantityAvailable, 10, "reserved plus remaining always equals what was listed");
    });
  });

  describe("sign-up without email delivery (testing only)", () => {
    const body = (n: string) => ({ name: "Bypass Tester", email: `${n}.${randomBytes(3).toString("hex")}@phase4.test`, password: "Sedibeng#Test2026" });
    it("is refused by default while email is not configured", async () => {
      const res = await anon("POST", "/auth/register/donor", { json: body("default") });
      assert.equal(res.status, 503);
      assert.match(res.json.error, /Email delivery is not configured/);
    });
    it("creates a ready-to-use account only when explicitly switched on", async () => {
      process.env.ALLOW_UNVERIFIED_EMAIL_SIGNUP = "true";
      try {
        const payload = body("bypass");
        const created = await anon("POST", "/auth/register/donor", { json: payload });
        assert.equal(created.status, 201, created.text);
        assert.match(created.json.message, /sign in now/i);
        const [user] = await db.select().from(tables.usersTable).where(orm.eq(tables.usersTable.email, payload.email.toLowerCase()));
        assert.equal(user.status, "ACTIVE");
        assert.ok(user.emailVerifiedAt);
        const login = await anon("POST", "/auth/login", { json: { email: payload.email, password: payload.password } });
        assert.equal(login.status, 200, login.text);
      } finally { delete process.env.ALLOW_UNVERIFIED_EMAIL_SIGNUP; }
    });
    it("switches itself off as soon as email is configured", async () => {
      const { unverifiedSignupAllowed } = await import("../lib/email");
      process.env.ALLOW_UNVERIFIED_EMAIL_SIGNUP = "true";
      assert.equal(unverifiedSignupAllowed(), true);
      process.env.RESEND_API_KEY = "re_test"; process.env.EMAIL_FROM = "Sedibeng <hello@example.com>";
      try { assert.equal(unverifiedSignupAllowed(), false, "with email configured the normal verification flow applies"); }
      finally { delete process.env.RESEND_API_KEY; delete process.env.EMAIL_FROM; delete process.env.ALLOW_UNVERIFIED_EMAIL_SIGNUP; }
    });
  });
});
