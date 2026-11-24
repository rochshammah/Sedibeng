// A small local stand-in for the parts of Cloudinary's API that Sedibeng uses
// (raw upload, destroy, signed private download). It enforces the same request
// signing rules so tests prove the driver signs requests correctly, and records
// everything it receives so tests can prove what was (and was not) sent.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:https";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { v2 as cloudinary } from "cloudinary";

export type FakeAsset = { bytes: Buffer; resourceType: string; type: string };

export async function startFakeCloudinary(options: { cloudName: string; apiKey: string; apiSecret: string }) {
  const assets = new Map<string, FakeAsset>();
  const receivedFields: Record<string, string>[] = [];
  const failures: string[] = [];

  async function body(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  function parseMultipart(buffer: Buffer, contentType: string) {
    const boundary = contentType.split("boundary=")[1]?.replace(/^"|"$/g, "");
    const fields: Record<string, string> = {};
    let file: Buffer | null = null;
    if (!boundary) return { fields, file };
    for (const part of buffer.toString("latin1").split(`--${boundary}`)) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd < 0) continue;
      const header = part.slice(0, headerEnd);
      const name = /name="([^"]+)"/.exec(header)?.[1];
      let value = part.slice(headerEnd + 4);
      if (value.endsWith("\r\n")) value = value.slice(0, -2);
      if (!name) continue;
      if (/filename=/.test(header) || name === "file") file = Buffer.from(value, "latin1");
      else fields[name] = Buffer.from(value, "latin1").toString("utf8");
    }
    return { fields, file };
  }

  const validSignature = (params: Record<string, string>, signature: string | undefined) => {
    const { api_key: _key, cloud_name: _cloud, resource_type: _type, file: _file, signature: _sig, ...signed } = params;
    void _key; void _cloud; void _type; void _file; void _sig;
    return signature === cloudinary.utils.api_sign_request(signed, options.apiSecret);
  };

  // The Cloudinary SDK only talks HTTPS, so the stand-in uses a throwaway self-signed certificate.
  const dir = mkdtempSync(path.join(os.tmpdir(), "fake-cld-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // test process only
  const server: Server = createServer({ key: readFileSync(path.join(dir, "k.pem")), cert: readFileSync(path.join(dir, "c.pem")) }, async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake");
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };
    const match = /^\/v1_1\/([^/]+)\/(raw|image)\/(upload|destroy|download)$/.exec(url.pathname);
    if (!match || match[1] !== options.cloudName) return json(404, { error: { message: "Unknown cloud or path" } });
    const [, , resourceType, action] = match;
    const raw = request.method === "POST" ? await body(request) : Buffer.alloc(0);
    const contentType = request.headers["content-type"] ?? "";
    let params: Record<string, string> = {};
    let file: Buffer | null = null;
    if (request.method === "GET") params = Object.fromEntries(url.searchParams);
    else if (contentType.startsWith("multipart/")) ({ fields: params, file } = parseMultipart(raw, contentType));
    else params = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
    receivedFields.push({ action, resource_type: resourceType, ...params });

    if (params.api_key !== options.apiKey) { failures.push("bad api key"); return json(401, { error: { message: "Invalid api_key" } }); }
    if (!validSignature(params, params.signature)) { failures.push(`bad signature on ${action}`); return json(401, { error: { message: "Invalid Signature" } }); }

    if (action === "upload" && request.method === "POST") {
      if (!file || !params.public_id) return json(400, { error: { message: "Missing file or public_id" } });
      if (params.type !== "authenticated") { failures.push("upload was not private"); return json(400, { error: { message: "Upload must be authenticated" } }); }
      if (assets.has(params.public_id) && (params.overwrite === "false" || params.overwrite === "0")) return json(200, { public_id: params.public_id, existing: true });
      assets.set(params.public_id, { bytes: file, resourceType, type: params.type });
      return json(200, { public_id: params.public_id, resource_type: resourceType, type: params.type, bytes: file.length, version: 1 });
    }
    if (action === "destroy" && request.method === "POST") {
      const existed = assets.delete(params.public_id);
      return json(200, { result: existed ? "ok" : "not found" });
    }
    if (action === "download" && request.method === "GET") {
      if (params.expires_at && Number(params.expires_at) < Date.now() / 1000) return json(401, { error: { message: "Request expired" } });
      const asset = assets.get(params.public_id);
      if (!asset) return json(404, { error: { message: "Resource not found" } });
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      return response.end(asset.bytes);
    }
    return json(405, { error: { message: "Unsupported" } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `https://127.0.0.1:${port}`,
    assets, receivedFields, failures,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
