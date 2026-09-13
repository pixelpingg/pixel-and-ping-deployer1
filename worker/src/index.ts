import migration1 from "../migrations/0001_init.sql";
import migration2 from "../migrations/0002_profile.sql";
import migration3 from "../migrations/0003_front_ips.sql";

const CF_API = "https://api.cloudflare.com/client/v4";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";
const MIGRATIONS = [migration1, migration2, migration3] as const;

type Account = {
  id: string;
  name: string;
  type?: string;
};

type JobResult = {
  url: string;
  username: "admin";
  password: string;
};

type JobState = {
  status: "RUNNING" | "READY" | "FAILED";
  step: string;
  result?: JobResult;
  error?: string;
};

type Env = {
  JOBS: DurableObjectNamespace;
  ASSETS: Fetcher;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function cors(request: Request, response: Response) {
  const origin = request.headers.get("Origin");
  if (!origin) return response;

  const requestOrigin = new URL(request.url).origin;
  const allowed =
    origin === "https://pixelpingg.github.io" ||
    origin === requestOrigin ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  if (!allowed) return response;

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, x-requested-with",
  );
  headers.set("access-control-max-age", "600");
  headers.set("vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomPassword(length = 24) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let result = "";

  for (const byte of randomBytes(length)) {
    result += alphabet[byte % alphabet.length];
  }

  return result;
}

function randomSecret(bytes = 48) {
  return btoa(String.fromCharCode(...randomBytes(bytes)));
}

function scriptName(accountId: string) {
  return `pixelping-${accountId.slice(0, 6).toLowerCase()}-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 8)}`.slice(0, 63);
}

function isValidToken(token: string) {
  return token.length >= 20 && token.length <= 500;
}

function isValidAccountId(accountId: string) {
  return /^[a-f0-9]{32}$/i.test(accountId);
}

function isValidJobId(id: string) {
  return /^[0-9a-f-]{36}$/i.test(id);
}

async function panelSource(env: Env): Promise<string> {
  const response = await env.ASSETS.fetch(
    new Request("https://assets.local/panel-worker.bundle.txt"),
  );

  if (!response.ok) {
    throw new Error(
      `Panel Worker bundle asset could not be loaded. HTTP ${response.status}`,
    );
  }

  const source = await response.text();

  if (!source || source.length < 1000) {
    throw new Error("Panel Worker bundle asset is empty or incomplete.");
  }

  const beginning = source.slice(0, 200).toLowerCase();
  if (beginning.includes("<!doctype html") || beginning.includes("<html")) {
    throw new Error(
      "Panel Worker bundle asset returned frontend HTML instead of Worker code.",
    );
  }

  if (!source.includes("cloneEntry_default") && !source.includes("export")) {
    throw new Error("Panel Worker bundle does not look like a valid Worker.");
  }

  return source;
}

async function cf(
  token: string,
  path: string,
  init: RequestInit = {},
  attempt = 1,
): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${CF_API}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return cf(token, path, init, attempt + 1);
    }

    throw new Error(
      `Could not reach Cloudflare API: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const body = await response.json().catch(() => ({}));

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const delay =
      retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : 500 * attempt;

    await new Promise((resolve) => setTimeout(resolve, delay));
    return cf(token, path, init, attempt + 1);
  }

  if (!response.ok || body?.success === false) {
    const message =
      body?.errors?.[0]?.message ||
      `Cloudflare API error ${response.status}`;

    throw Object.assign(new Error(message), {
      status: response.status,
      cloudflareErrors: body?.errors,
    });
  }

  return body.result;
}

async function verifyToken(token: string) {
  const verification = await cf(token, "/user/tokens/verify");

  if (verification?.status !== "active") {
    throw new Error("Cloudflare says this API token is not active.");
  }

  const user = await cf(token, "/user");
  const accounts: Account[] = [];

  try {
    for (let page = 1; page <= 10; page++) {
      const rows = await cf(
        token,
        `/memberships?status=accepted&per_page=50&page=${page}`,
      );

      for (const membership of rows || []) {
        const account = membership?.account;
        if (account?.id && account?.name) {
          accounts.push(account);
        }
      }

      if (!Array.isArray(rows) || rows.length < 50) break;
    }
  } catch {
    for (let page = 1; page <= 10; page++) {
      const rows = await cf(
        token,
        `/accounts?per_page=50&page=${page}`,
      );

      for (const account of rows || []) {
        if (account?.id && account?.name) {
          accounts.push(account);
        }
      }

      if (!Array.isArray(rows) || rows.length < 50) break;
    }
  }

  const uniqueAccounts = [
    ...new Map(
      accounts.map((account) => [
        account.id,
        {
          id: account.id,
          name: account.name,
          type: account.type,
        },
      ]),
    ).values(),
  ].slice(0, 100);

  return {
    email: user?.email || null,
    accounts: uniqueAccounts,
    tokenUrl: TOKEN_URL,
  };
}

async function d1Query(
  token: string,
  accountId: string,
  dbId: string,
  sql: string,
  params: unknown[] = [],
) {
  return cf(
    token,
    `/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      body: JSON.stringify({ sql, params }),
    },
  );
}

function d1Rows(result: any): any[] {
  if (Array.isArray(result)) {
    return result.flatMap((item) =>
      Array.isArray(item?.results) ? item.results : [],
    );
  }

  if (Array.isArray(result?.results)) {
    return result.results;
  }

  return [];
}

async function createD1(
  token: string,
  accountId: string,
  name: string,
) {
  const result = await cf(
    token,
    `/accounts/${accountId}/d1/database`,
    {
      method: "POST",
      body: JSON.stringify({ name }),
    },
  );

  if (!result?.uuid) {
    throw new Error("Cloudflare did not return the D1 database ID.");
  }

  return result.uuid as string;
}

async function runMigrations(
  token: string,
  accountId: string,
  dbId: string,
) {
  for (const sql of MIGRATIONS) {
    if (!sql || typeof sql !== "string") {
      throw new Error("A D1 migration file was not loaded as text.");
    }

    await d1Query(token, accountId, dbId, sql);
  }

  const requiredTables = [
    "admins",
    "sessions",
    "vpn_users",
    "settings",
    "front_ips",
  ];

  const check = await d1Query(
    token,
    accountId,
    dbId,
    `SELECT name FROM sqlite_master
     WHERE type='table'
     AND name IN (${requiredTables.map(() => "?").join(",")})`,
    requiredTables,
  );

  const names = new Set(
    d1Rows(check).map((row) => String(row?.name || "")),
  );

  const missing = requiredTables.filter((name) => !names.has(name));

  if (missing.length) {
    throw new Error(
      `Panel database schema verification failed. Missing: ${missing.join(", ")}`,
    );
  }

  const adminColumns = await d1Query(
    token,
    accountId,
    dbId,
    "PRAGMA table_info(admins)",
  );

  const columns = new Set(
    d1Rows(adminColumns).map((row) => String(row?.name || "")),
  );

  for (const requiredColumn of [
    "id",
    "username",
    "password_hash",
    "is_active",
    "role",
  ]) {
    if (!columns.has(requiredColumn)) {
      throw new Error(
        `Panel database schema verification failed. admins.${requiredColumn} is missing.`,
      );
    }
  }
}

async function createKv(
  token: string,
  accountId: string,
  title: string,
) {
  const result = await cf(
    token,
    `/accounts/${accountId}/storage/kv/namespaces`,
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
  );

  if (!result?.id) {
    throw new Error("Cloudflare did not return the KV namespace ID.");
  }

  return result.id as string;
}

async function verifyKv(
  token: string,
  accountId: string,
  namespaceId: string,
) {
  const result = await cf(
    token,
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`,
  );

  if (!result?.id || result.id !== namespaceId) {
    throw new Error("Cloudflare KV namespace verification failed.");
  }
}

async function getOrCreateSubdomain(
  token: string,
  accountId: string,
) {
  try {
    const existing = await cf(
      token,
      `/accounts/${accountId}/workers/subdomain`,
    );

    if (existing?.subdomain) {
      return String(existing.subdomain);
    }
  } catch {
    // Creation attempt below.
  }

  const desired = `pixelping-${accountId.slice(0, 8).toLowerCase()}`;

  const created = await cf(
    token,
    `/accounts/${accountId}/workers/subdomain`,
    {
      method: "PUT",
      body: JSON.stringify({ subdomain: desired }),
    },
  );

  if (!created?.subdomain) {
    throw new Error("Cloudflare did not return a Workers.dev subdomain.");
  }

  return String(created.subdomain);
}

function panelUrlFor(name: string, subdomain: string) {
  return `https://${name}.${subdomain}.workers.dev`;
}

async function uploadWorker(
  token: string,
  accountId: string,
  name: string,
  d1Id: string,
  kvId: string,
  sourceUrl: string,
  password: string,
  subdomain: string,
  source: string,
) {
  const panelUrl = panelUrlFor(name, subdomain);

  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-08-31",
    bindings: [
      { type: "d1", name: "DB", database_id: d1Id },
      {
        type: "kv_namespace",
        name: "PIXELPING_KV",
        namespace_id: kvId,
      },
      {
        type: "plain_text",
        name: "FRONTEND_ORIGIN",
        text: panelUrl,
      },
      {
        type: "plain_text",
        name: "FRONTEND_SOURCE_URL",
        text: sourceUrl,
      },
      {
        type: "plain_text",
        name: "PRESENCE_TIMEOUT_SEC",
        text: "90",
      },
      {
        type: "plain_text",
        name: "VPN_PROVIDER",
        text: "worker-relay",
      },
      {
        type: "plain_text",
        name: "CF_ACCOUNT_ID",
        text: accountId,
      },
      {
        type: "plain_text",
        name: "CF_DAILY_REQUEST_LIMIT",
        text: "100000",
      },
      {
        type: "plain_text",
        name: "ADMIN_TELEGRAM_ID",
        text: "0",
      },
      {
        type: "plain_text",
        name: "PUBLIC_BASE_URL",
        text: panelUrl,
      },
      {
        type: "secret_text",
        name: "JWT_SECRET",
        text: randomSecret(48),
      },
      {
        type: "secret_text",
        name: "ENCRYPTION_KEY",
        text: randomSecret(32),
      },
      {
        type: "secret_text",
        name: "INITIAL_ADMIN_PASSWORD",
        text: password,
      },
    ],
    observability: { enabled: true },
  };

  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append(
    "worker.js",
    new Blob([source], {
      type: "application/javascript+module",
    }),
    "worker.js",
  );

  await cf(
    token,
    `/accounts/${accountId}/workers/scripts/${name}`,
    {
      method: "PUT",
      body: form,
    },
  );
}

async function verifyUploadedWorker(
  token: string,
  accountId: string,
  name: string,
) {
  await cf(
    token,
    `/accounts/${accountId}/workers/scripts/${name}`,
    {
      method: "GET",
    },
  );
}

async function enableSubdomain(
  token: string,
  accountId: string,
  name: string,
) {
  await cf(
    token,
    `/accounts/${accountId}/workers/scripts/${name}/subdomain`,
    {
      method: "POST",
      body: JSON.stringify({ enabled: true }),
    },
  );
}

async function healthCheck(url: string) {
  let last = "no response";

  for (let i = 0; i < 12; i++) {
    try {
      const response = await fetch(`${url}/api/health`, {
        headers: { accept: "application/json" },
      });

      const body = await response.json().catch(() => null);

      if (response.ok && body?.ok === true) {
        return;
      }

      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Panel health check failed: ${last}`);
}

/*
 * The panel creates the initial "admin" record lazily on the first
 * successful password login when the admins table is empty.
 *
 * This request is therefore intentionally part of deployment verification:
 * it proves that D1 + KV + INITIAL_ADMIN_PASSWORD + JWT_SECRET + bcrypt
 * + the real auth route are all working together.
 */
async function verifyInitialAdmin(
  url: string,
  password: string,
) {
  const response = await fetch(`${url}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error?.code ||
      `HTTP ${response.status}`;

    throw new Error(`Initial admin verification failed: ${message}`);
  }

  if (body?.requiresTwoFactor) {
    throw new Error(
      "Initial admin unexpectedly requires 2FA before bootstrap completed.",
    );
  }

  if (body?.admin?.username !== "admin") {
    throw new Error(
      "Initial admin verification failed: the panel did not create the admin user.",
    );
  }

  return true;
}

function safeError(error: unknown) {
  const status = Number((error as any)?.status || 0);

  if (status === 401 || status === 403) {
    return "Cloudflare rejected this token. Check Workers Scripts, KV, D1, Workers.dev, User Details and Membership permissions.";
  }

  if (status === 429) {
    return "Cloudflare rate limit reached. Please wait a little and try again.";
  }

  if (status >= 500) {
    return "Cloudflare API is temporarily unavailable. Please try again.";
  }

  return error instanceof Error ? error.message : "Deployment failed.";
}

export class DeployJob implements DurableObject {
  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const job = await this.state.storage.get<JobState>("job");

      return json(
        job || {
          status: "FAILED",
          step: "validate",
          error: "Deployment job not found.",
        },
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json().catch(() => null)) as {
      token?: string;
      accountId?: string;
      sourceUrl?: string;
    } | null;

    const token = String(payload?.token || "").trim();
    const accountId = String(payload?.accountId || "").trim();
    const sourceUrl = String(payload?.sourceUrl || "").trim();

    if (!isValidToken(token) || !isValidAccountId(accountId)) {
      return new Response("Invalid deployment payload", { status: 400 });
    }

    if (!/^https?:\/\/[^/]+$/i.test(sourceUrl)) {
      return new Response("Invalid source URL", { status: 400 });
    }

    const current = await this.state.storage.get<JobState>("job");

    if (current?.status === "RUNNING") {
      return new Response("already-running", { status: 409 });
    }

    await this.state.storage.put<JobState>("job", {
      status: "RUNNING",
      step: "validate",
    });

    this.state.waitUntil(
      this.run({
        token,
        accountId,
        sourceUrl,
      }),
    );

    return new Response("started", { status: 202 });
  }

  private async set(step: string) {
    const current = await this.state.storage.get<JobState>("job");

    await this.state.storage.put<JobState>("job", {
      ...(current || { status: "RUNNING" }),
      status: "RUNNING",
      step,
    });
  }

  private async run({
    token,
    accountId,
    sourceUrl,
  }: {
    token: string;
    accountId: string;
    sourceUrl: string;
  }) {
    let step = "validate";

    try {
      const verified = await verifyToken(token);

      if (!verified.accounts.some((account) => account.id === accountId)) {
        throw Object.assign(
          new Error(
            "This token cannot access the selected Cloudflare account.",
          ),
          { status: 403 },
        );
      }

      const name = scriptName(accountId);
      const password = randomPassword();

      step = "d1";
      await this.set(step);
      const d1Id = await createD1(
        token,
        accountId,
        `${name}-db`,
      );

      step = "migrations";
      await this.set(step);
      await runMigrations(token, accountId, d1Id);

      step = "kv";
      await this.set(step);
      const kvId = await createKv(
        token,
        accountId,
        `${name}-kv`,
      );

      step = "kv_verify";
      await this.set(step);
      await verifyKv(token, accountId, kvId);

      step = "subdomain_lookup";
      await this.set(step);
      const subdomain = await getOrCreateSubdomain(
        token,
        accountId,
      );

      const panelUrl = panelUrlFor(name, subdomain);

      step = "load_bundle";
      await this.set(step);
      const source = await panelSource(this.env);

      step = "script";
      await this.set(step);
      await uploadWorker(
        token,
        accountId,
        name,
        d1Id,
        kvId,
        sourceUrl,
        password,
        subdomain,
        source,
      );

      step = "script_verify";
      await this.set(step);
      await verifyUploadedWorker(
        token,
        accountId,
        name,
      );

      step = "enable_subdomain";
      await this.set(step);
      await enableSubdomain(
        token,
        accountId,
        name,
      );

      step = "health";
      await this.set(step);
      await healthCheck(panelUrl);

      step = "admin";
      await this.set(step);
      await verifyInitialAdmin(panelUrl, password);

      step = "final_health";
      await this.set(step);
      await healthCheck(panelUrl);

      const result: JobResult = {
        url: panelUrl,
        username: "admin",
        password,
      };

      /*
       * The Cloudflare API token is never written to Durable Object storage.
       * Only the deployment result is retained so the frontend can poll it.
       */
      await this.state.storage.put<JobState>("job", {
        status: "READY",
        step: "final_health",
        result,
      });
    } catch (error) {
      await this.state.storage.put<JobState>("job", {
        status: "FAILED",
        step,
        error: safeError(error),
      });
    }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(
        request,
        new Response(null, { status: 204 }),
      );
    }

    try {
      if (
        request.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        return cors(
          request,
          json({
            ok: true,
            service: "pixel-ping-deployer",
            runtime: "cloudflare-workers",
          }),
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/verify"
      ) {
        const body = (await request.json().catch(() => ({}))) as {
          token?: unknown;
        };

        const token = String(body.token || "").trim();

        if (!isValidToken(token)) {
          return cors(
            request,
            json(
              {
                error:
                  "Please paste a valid Cloudflare API token.",
              },
              400,
            ),
          );
        }

        return cors(
          request,
          json(await verifyToken(token)),
        );
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/deploy"
      ) {
        const body = (await request.json().catch(() => ({}))) as {
          token?: unknown;
          accountId?: unknown;
        };

        const token = String(body.token || "").trim();
        const accountId = String(body.accountId || "").trim();

        if (!isValidToken(token)) {
          return cors(
            request,
            json(
              { error: "Invalid Cloudflare API token." },
              400,
            ),
          );
        }

        if (!isValidAccountId(accountId)) {
          return cors(
            request,
            json(
              {
                error:
                  "Invalid Cloudflare account selection.",
              },
              400,
            ),
          );
        }

        const verified = await verifyToken(token);

        if (
          !verified.accounts.some(
            (account) => account.id === accountId,
          )
        ) {
          return cors(
            request,
            json(
              {
                error:
                  "This token cannot access the selected Cloudflare account.",
              },
              403,
            ),
          );
        }

        const id = crypto.randomUUID();
        const stub = env.JOBS.get(
          env.JOBS.idFromName(id),
        );

        const startResponse = await stub.fetch(
          "https://job/start",
          {
            method: "POST",
            body: JSON.stringify({
              token,
              accountId,
              sourceUrl: url.origin,
            }),
          },
        );

        if (!startResponse.ok) {
          const message = await startResponse.text();
          return cors(
            request,
            json(
              {
                error:
                  message ||
                  "Could not start deployment job.",
              },
              startResponse.status === 409
                ? 409
                : 500,
            ),
          );
        }

        return cors(
          request,
          json({ jobId: id }, 202),
        );
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/jobs/")
      ) {
        const id = url.pathname.slice(
          "/api/jobs/".length,
        );

        if (!isValidJobId(id)) {
          return cors(
            request,
            json(
              {
                error: "Deployment job not found.",
              },
              404,
            ),
          );
        }

        const stub = env.JOBS.get(
          env.JOBS.idFromName(id),
        );

        const response = await stub.fetch(
          "https://job/status",
        );

        return cors(
          request,
          new Response(response.body, {
            status: response.status,
            headers: response.headers,
          }),
        );
      }

      if (!url.pathname.startsWith("/api/")) {
        return env.ASSETS.fetch(request);
      }

      return cors(
        request,
        json({ error: "Not found" }, 404),
      );
    } catch (error) {
      return cors(
        request,
        json(
          { error: safeError(error) },
          500,
        ),
      );
    }
  },
};
