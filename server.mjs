import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.join(ROOT, "frontend", "dist");
const BUNDLE_PATH = path.join(ROOT, "worker", "src", "assets", "panel-worker.bundle.js");
const MIGRATION_DIR = path.join(ROOT, "worker", "migrations");
const CF_API = "https://api.cloudflare.com/client/v4";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_SITE_ORIGIN = process.env.PUBLIC_SITE_ORIGIN || "";
const jobs = new Map();
const rateBuckets = new Map();

const tokenUrl = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22user_details%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22memberships%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=PIXEL%20%26%20PING";

const migrationFiles = fs.readdirSync(MIGRATION_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const migrations = migrationFiles.map((f) => fs.readFileSync(path.join(MIGRATION_DIR, f), "utf8"));
const panelWorkerCode = fs.readFileSync(BUNDLE_PATH, "utf8");

function json(res, status, body, origin) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (origin && (origin === PUBLIC_SITE_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-credentials"] = "false";
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function requestOrigin(req) { return req.headers.origin || ""; }
function clientIp(req) { return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim(); }

function allowedRate(key, max, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= max) { rateBuckets.set(key, fresh); return false; }
  fresh.push(now); rateBuckets.set(key, fresh); return true;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

async function cf(token, apiPath, init = {}, attempt = 1) {
  const response = await fetch(`${CF_API}${apiPath}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    await new Promise((r) => setTimeout(r, retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 350 * attempt));
    return cf(token, apiPath, init, attempt + 1);
  }
  if (!response.ok || body?.success === false) {
    const message = body?.errors?.[0]?.message || `Cloudflare API error ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body.result;
}

async function verifyToken(token) {
  const verification = await cf(token, "/user/tokens/verify");
  if (verification?.status !== "active") throw new Error("Cloudflare says this API token is not active.");
  const user = await cf(token, "/user");
  const accounts = [];
  // The token created by the PIXEL & PING link explicitly includes Memberships:Read.
  // Prefer memberships for account discovery, then fall back to /accounts for tokens
  // created with the broader account-read permission set.
  try {
    for (let page = 1; page <= 10; page++) {
      const rows = await cf(token, `/memberships?status=accepted&per_page=50&page=${page}`);
      for (const membership of rows || []) if (membership?.account?.id && membership?.account?.name) accounts.push(membership.account);
      if (!rows || rows.length < 50) break;
    }
  } catch {
    for (let page = 1; page <= 10; page++) {
      const rows = await cf(token, `/accounts?per_page=50&page=${page}`);
      accounts.push(...(rows || []));
      if (!rows || rows.length < 50) break;
    }
  }
  const unique = [...new Map(accounts.filter((a) => a?.id && a?.name).map((a) => [a.id, { id: a.id, name: a.name, type: a.type }])).values()];
  return { email: user?.email || null, accounts: unique.slice(0, 100) };
}

function randomPassword(length = 20) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
function randomSecret(bytes = 32) { return crypto.randomBytes(bytes).toString("base64"); }
function scriptName(accountId) { return `pixelping-${accountId.slice(0, 6).toLowerCase()}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 63); }

async function d1Query(token, accountId, dbId, sql, params = []) {
  return cf(token, `/accounts/${accountId}/d1/database/${dbId}/query`, { method: "POST", body: JSON.stringify({ sql, params }) });
}

async function createD1(token, accountId, name) {
  const result = await cf(token, `/accounts/${accountId}/d1/database`, { method: "POST", body: JSON.stringify({ name }) });
  return result.uuid;
}

async function runMigrations(token, accountId, dbId) {
  for (const sql of migrations) await d1Query(token, accountId, dbId, sql);
  const check = await d1Query(token, accountId, dbId, "SELECT name FROM sqlite_master WHERE type='table' AND name='admins'");
  const row = check?.[0]?.results?.[0] || check?.results?.[0] || check?.[0];
  if (!row?.name) throw new Error("Panel database schema verification failed: admins table is missing.");
}

async function createKv(token, accountId, title) {
  const result = await cf(token, `/accounts/${accountId}/storage/kv/namespaces`, { method: "POST", body: JSON.stringify({ title }) });
  return result.id;
}

async function getOrCreateSubdomain(token, accountId) {
  try {
    const existing = await cf(token, `/accounts/${accountId}/workers/subdomain`);
    if (existing?.subdomain) return existing.subdomain;
  } catch (err) {
    const desired = `pixelping-${accountId.slice(0, 8).toLowerCase()}`;
    try {
      const created = await cf(token, `/accounts/${accountId}/workers/subdomain`, { method: "PUT", body: JSON.stringify({ subdomain: desired }) });
      if (created?.subdomain) return created.subdomain;
    } catch (createErr) {
      throw new Error(`Workers.dev subdomain is unavailable: ${createErr instanceof Error ? createErr.message : String(createErr)}`);
    }
  }
  throw new Error("Cloudflare did not return a Workers.dev subdomain.");
}

async function uploadWorker(token, accountId, name, d1Id, kvId, sourceUrl, password) {
  const jwtSecret = randomSecret(48);
  const encryptionKey = randomSecret(32);
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-08-31",
    bindings: [
      { type: "d1", name: "DB", database_id: d1Id },
      { type: "kv_namespace", name: "PIXELPING_KV", namespace_id: kvId },
      { type: "plain_text", name: "FRONTEND_ORIGIN", text: `https://${name}.${await getOrCreateSubdomain(token, accountId)}.workers.dev` },
      { type: "plain_text", name: "FRONTEND_SOURCE_URL", text: sourceUrl },
      { type: "plain_text", name: "PRESENCE_TIMEOUT_SEC", text: "90" },
      { type: "plain_text", name: "VPN_PROVIDER", text: "worker-relay" },
      { type: "plain_text", name: "CF_ACCOUNT_ID", text: accountId },
      { type: "plain_text", name: "CF_DAILY_REQUEST_LIMIT", text: "100000" },
      { type: "plain_text", name: "ADMIN_TELEGRAM_ID", text: "0" },
      { type: "plain_text", name: "PUBLIC_BASE_URL", text: `https://${name}.${await getOrCreateSubdomain(token, accountId)}.workers.dev` },
      { type: "secret_text", name: "JWT_SECRET", text: jwtSecret },
      { type: "secret_text", name: "ENCRYPTION_KEY", text: encryptionKey },
      { type: "secret_text", name: "INITIAL_ADMIN_PASSWORD", text: password },
    ],
    observability: { enabled: true },
  };
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("worker.js", new Blob([panelWorkerCode], { type: "application/javascript+module" }), "worker.js");
  await cf(token, `/accounts/${accountId}/workers/scripts/${name}`, { method: "PUT", body: form });
  return { jwtSecret, encryptionKey };
}

async function enableSubdomain(token, accountId, name) {
  await cf(token, `/accounts/${accountId}/workers/scripts/${name}/subdomain`, { method: "POST", body: JSON.stringify({ enabled: true }) });
}

async function seedAdmin(token, accountId, dbId, password) {
  const check = await d1Query(token, accountId, dbId, "SELECT COUNT(*) AS c FROM admins");
  const row = check?.[0]?.results?.[0] || check?.results?.[0] || check?.[0];
  if (Number(row?.c || 0) > 0) return;
  const hash = await bcrypt.hash(password, 12);
  const now = Date.now();
  await d1Query(token, accountId, dbId, "INSERT INTO admins (id,email,username,password_hash,role,two_factor_enabled,is_active,created_at,updated_at) VALUES (?,?,?,?,?,0,1,?,?)", [crypto.randomUUID(), "admin@pixelping.local", "admin", hash, "SUPER_ADMIN", now, now]);
}

async function healthCheck(url) {
  const deadline = Date.now() + 35_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { headers: { accept: "application/json" } });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        if (body?.ok === true) return;
        last = `health endpoint returned HTTP ${response.status}`;
      } else last = `health endpoint returned HTTP ${response.status}`;
    } catch (err) { last = err instanceof Error ? err.message : String(err); }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`Panel health check timed out: ${last || "no response"}`);
}

async function deploy(job) {
  const { token, accountId, sourceUrl } = job;
  const name = scriptName(accountId);
  const password = randomPassword();
  job.step = "d1";
  const d1Id = await createD1(token, accountId, `${name}-db`);
  job.step = "migrations";
  await runMigrations(token, accountId, d1Id);
  job.step = "kv";
  const kvId = await createKv(token, accountId, `${name}-kv`);
  job.step = "subdomain_lookup";
  const subdomain = await getOrCreateSubdomain(token, accountId);
  const url = `https://${name}.${subdomain}.workers.dev`;
  job.step = "script";
  await uploadWorker(token, accountId, name, d1Id, kvId, sourceUrl, password);
  job.step = "enable_subdomain";
  await enableSubdomain(token, accountId, name);
  job.step = "admin";
  await seedAdmin(token, accountId, d1Id, password);
  await healthCheck(url);
  return { url, username: "admin", password };
}

function sanitizeError(err) {
  const status = Number(err?.status || 0);
  if (status === 401 || status === 403) return "Cloudflare rejected this token. Check that it is active and has the required Workers, KV, D1, Workers.dev, User Details and Membership permissions.";
  if (status === 429) return "Cloudflare rate limit reached. Please wait a little and try again.";
  return err instanceof Error ? err.message : "Deployment failed.";
}

function sourceUrl(req) {
  if (PUBLIC_SITE_ORIGIN) return PUBLIC_SITE_ORIGIN.replace(/\/$/, "");
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
  if (pathname.startsWith("/api/")) return false;
  if (!fs.existsSync(FRONTEND_DIST)) { json(res, 503, { error: "Frontend build not found. Run npm run build first." }, requestOrigin(req)); return true; }
  let file = path.join(FRONTEND_DIST, pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(FRONTEND_DIST)) { json(res, 400, { error: "Invalid path" }, requestOrigin(req)); return true; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(FRONTEND_DIST, "index.html");
  const ext = path.extname(file);
  const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".svg":"image/svg+xml", ".ico":"image/x-icon", ".woff2":"font/woff2" };
  res.writeHead(200, { "content-type": types[ext] || "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable" });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const origin = requestOrigin(req);
  if (req.method === "OPTIONS") {
    const headers = { "access-control-allow-methods":"GET,POST,OPTIONS", "access-control-allow-headers":"content-type", "access-control-max-age":"600" };
    if (origin && (origin === PUBLIC_SITE_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) headers["access-control-allow-origin"] = origin;
    res.writeHead(204, headers); res.end(); return;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, {ok:true,service:"pixel-ping-deployer"}, origin);
    if (req.method === "POST" && url.pathname === "/api/verify") {
      if (!allowedRate(`verify:${clientIp(req)}`, 6, 60_000)) return json(res, 429, {error:"Too many token checks. Please wait a minute."}, origin);
      const body = await readBody(req); const token = String(body.token || "").trim();
      if (token.length < 20 || token.length > 500) return json(res, 400, {error:"Please paste a valid Cloudflare API token."}, origin);
      const verified = await verifyToken(token);
      return json(res, 200, {email:verified.email,accounts:verified.accounts,tokenUrl}, origin);
    }
    if (req.method === "POST" && url.pathname === "/api/deploy") {
      if (!allowedRate(`deploy:${clientIp(req)}`, 2, 10*60_000)) return json(res, 429, {error:"Too many deployments from this connection. Please wait before trying again."}, origin);
      const body = await readBody(req); const token = String(body.token || "").trim(); const accountId = String(body.accountId || "").trim();
      if (token.length < 20 || token.length > 500) return json(res, 400, {error:"Invalid Cloudflare API token."}, origin);
      if (!/^[a-f0-9]{32}$/i.test(accountId)) return json(res, 400, {error:"Invalid Cloudflare account selection."}, origin);
      const verified = await verifyToken(token);
      if (!verified.accounts.some((a) => a.id === accountId)) return json(res, 403, {error:"This token cannot access the selected Cloudflare account."}, origin);
      const id = crypto.randomUUID();
      const job = { id, token, accountId, sourceUrl:sourceUrl(req), status:"RUNNING", step:"validate", result:null, error:null, createdAt:Date.now() };
      jobs.set(id, job);
      deploy(job).then((result)=>{ job.status="READY"; job.result=result; job.token=""; }).catch((err)=>{ job.status="FAILED"; job.error=sanitizeError(err); job.token=""; });
      return json(res, 202, {jobId:id}, origin);
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const id = url.pathname.slice("/api/jobs/".length); const job = jobs.get(id);
      if (!job) return json(res, 404, {error:"Deployment job not found or expired."}, origin);
      if (Date.now() - job.createdAt > 30*60_000) { jobs.delete(id); return json(res, 404, {error:"Deployment job expired."}, origin); }
      return json(res, 200, {status:job.status,step:job.step,result:job.status === "READY" ? job.result : null,error:job.status === "FAILED" ? job.error : null}, origin);
    }
    if (serveStatic(req,res)) return;
    json(res,404,{error:"Not found"},origin);
  } catch (err) {
    console.error("request_error", err instanceof Error ? err.message : String(err));
    json(res, 500, {error:sanitizeError(err)}, origin);
  }
});

setInterval(() => {
  const cutoff = Date.now() - 30*60_000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) jobs.delete(id);
  const rateCutoff = Date.now() - 10*60_000;
  for (const [key, values] of rateBuckets) { const fresh = values.filter((t)=>t>rateCutoff); if (fresh.length) rateBuckets.set(key,fresh); else rateBuckets.delete(key); }
}, 60_000).unref();

server.listen(PORT, "0.0.0.0", () => console.log(`PIXEL & PING deployer listening on ${PORT}`));
