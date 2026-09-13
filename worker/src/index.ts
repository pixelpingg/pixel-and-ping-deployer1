import migration1 from "../migrations/0001_init.sql";
import migration2 from "../migrations/0002_profile.sql";
import migration3 from "../migrations/0003_front_ips.sql";

const CF_API = "https://api.cloudflare.com/client/v4";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

const MIGRATIONS = [migration1, migration2, migration3];

type Account = {
  id: string;
  name: string;
  type?: string;
};

type JobState = {
  status: "RUNNING" | "READY" | "FAILED";
  step: string;
  result?: unknown;
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

  const allowed =
    origin === "https://pixelpingg.github.io" ||
    origin === new URL(request.url).origin ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  if (!allowed) return response;

  const headers = new Headers(response.headers);

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  headers.set("access-control-allow-headers", "content-type");
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

function randomPassword(length = 20) {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";

  return Array.from(
    randomBytes(length),
    (byte) => alphabet[byte % alphabet.length],
  ).join("");
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

  const beginning = source.slice(0, 100).toLowerCase();

  if (
    beginning.includes("<!doctype html") ||
    beginning.includes("<html")
  ) {
    throw new Error(
      "Panel Worker bundle asset returned the frontend HTML instead of the Worker bundle.",
    );
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

  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    headers,
  });

  const body = await response.json().catch(() => ({}));

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retry = Number(response.headers.get("retry-after") || 0);

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        retry ? Math.min(retry * 1000, 5000) : 500 * attempt,
      ),
    );

    return cf(token, path, init, attempt + 1);
  }

  if (!response.ok || body?.success === false) {
    const error = Object.assign(
      new Error(
        body?.errors?.[0]?.message ||
          `Cloudflare API error ${response.status}`,
      ),
      { status: response.status },
    );

    throw error;
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
        if (membership?.account?.id && membership?.account?.name) {
          accounts.push(membership.account);
        }
      }

      if (!rows || rows.length < 50) break;
    }
  } catch {
    for (let page = 1; page <= 10; page++) {
      const rows = await cf(
        token,
        `/accounts?per_page=50&page=${page}`,
      );

      accounts.push(...(rows || []));

      if (!rows || rows.length < 50) break;
    }
  }

  return {
    email: user?.email || null,
    accounts: [
      ...new Map(
        accounts
          .filter((account) => account?.id && account?.name)
          .map((account) => [
            account.id,
            {
              id: account.id,
              name: account.name,
              type: account.type,
            },
          ]),
      ).values(),
    ].slice(0, 100),
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

  const check = await d1Query(
    token,
    accountId,
    dbId,
    "SELECT name FROM sqlite_master WHERE type='table' AND name='admins'",
  );

  const results = check?.[0]?.results || check?.results || [];
  const row = Array.isArray(results) ? results[0] : undefined;

  if (!row?.name) {
    throw new Error(
      "Panel database schema verification failed: admins table is missing.",
    );
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
      return existing.subdomain as string;
    }
  } catch {
    // Try to create it below.
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

  return created.subdomain as string;
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
  const panelUrl = `https://${name}.${subdomain}.workers.dev`;

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
      { type: "plain_text", name: "FRONTEND_ORIGIN", text: panelUrl },
      { type: "plain_text", name: "FRONTEND_SOURCE_URL", text: sourceUrl },
      { type: "plain_text", name: "PRESENCE_TIMEOUT_SEC", text: "90" },
      { type: "plain_text", name: "VPN_PROVIDER", text: "worker-relay" },
      { type: "plain_text", name: "CF_ACCOUNT_ID", text: accountId },
      { type: "plain_text", name: "CF_DAILY_REQUEST_LIMIT", text: "100000" },
      { type: "plain_text", name: "ADMIN_TELEGRAM_ID", text: "0" },
      { type: "plain_text", name: "PUBLIC_BASE_URL", text: panelUrl },
      { type: "secret_text", name: "JWT_SECRET", text: randomSecret(48) },
      { type: "secret_text", name: "ENCRYPTION_KEY", text: randomSecret(32) },
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

  for (let i = 0; i < 10; i++) {
    try {
      const response = await fetch(`${url}/api/health`, {
        headers: { accept: "application/json" },
      });

      const body = await response.json().catch(() => null);

      if (response.ok && body?.ok === true) return;

      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Panel health check failed: ${last}`);
}

function safeError(error: unknown) {
  const status = Number((error as any)?.status || 0);

  if (status === 401 || status === 403) {
    return "Cloudflare rejected this token. Check Workers Scripts, KV, D1, Workers.dev, User Details and Membership permissions.";
  }

  if (status === 429) {
    return "Cloudflare rate limit reached. Please wait a little and try again.";
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

      return new Response(
        JSON.stringify(
          job || {
            status: "FAILED",
            step: "validate",
            error: "Deployment job not found.",
          },
        ),
        {
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const payload = (await request.json()) as {
      token: string;
      accountId: string;
      sourceUrl: string;
    };

    const current = await this.state.storage.get<JobState>("job");

    if (current?.status === "RUNNING") {
      return new Response("already-running", { status: 409 });
    }

    await this.state.storage.put<JobState>("job", {
      status: "RUNNING",
      step: "validate",
    });

    this.state.waitUntil(this.run(payload));

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

      const d1Id = await createD1(token, accountId, `${name}-db`);

      step = "migrations";
      await this.set(step);

      await runMigrations(token, accountId, d1Id);

      step = "kv";
      await this.set(step);

      const kvId = await createKv(token, accountId, `${name}-kv`);

      step = "subdomain_lookup";
      await this.set(step);

      const subdomain = await getOrCreateSubdomain(token, accountId);
      const panelUrl = `https://${name}.${subdomain}.workers.dev`;

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

      step = "enable_subdomain";
      await this.set(step);

      await enableSubdomain(token, accountId, name);

      step = "health";
      await this.set(step);

      await healthCheck(panelUrl);

      await this.state.storage.put<JobState>("job", {
        status: "READY",
        step: "health",
        result: {
          url: panelUrl,
          username: "admin",
          password,
        },
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
      return cors(request, new Response(null, { status: 204 }));
    }

    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return cors(
          request,
          json({
            ok: true,
            service: "pixel-ping-deployer",
            runtime: "cloudflare-workers",
          }),
        );
      }

      if (request.method === "POST" && url.pathname === "/api/verify") {
        const body = (await request.json().catch(() => ({}))) as any;
        const token = String(body.token || "").trim();

        if (token.length < 20 || token.length > 500) {
          return cors(
            request,
            json(
              { error: "Please paste a valid Cloudflare API token." },
              400,
            ),
          );
        }

        return cors(request, json(await verifyToken(token)));
      }

      if (request.method === "POST" && url.pathname === "/api/deploy") {
        const body = (await request.json().catch(() => ({}))) as any;
        const token = String(body.token || "").trim();
        const accountId = String(body.accountId || "").trim();

        if (token.length < 20 || token.length > 500) {
          return cors(
            request,
            json({ error: "Invalid Cloudflare API token." }, 400),
          );
        }

        if (!/^[a-f0-9]{32}$/i.test(accountId)) {
          return cors(
            request,
            json(
              { error: "Invalid Cloudflare account selection." },
              400,
            ),
          );
        }

        const verified = await verifyToken(token);

        if (!verified.accounts.some((account) => account.id === accountId)) {
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
        const stub = env.JOBS.get(env.JOBS.idFromName(id));

        await stub.fetch("https://job/start", {
          method: "POST",
          body: JSON.stringify({
            token,
            accountId,
            sourceUrl: url.origin,
          }),
        });

        return cors(request, json({ jobId: id }, 202));
      }

      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/jobs/")
      ) {
        const id = url.pathname.slice("/api/jobs/".length);

        if (!/^[0-9a-f-]{36}$/i.test(id)) {
          return cors(
            request,
            json({ error: "Deployment job not found." }, 404),
          );
        }

        const stub = env.JOBS.get(env.JOBS.idFromName(id));
        const response = await stub.fetch("https://job/status");

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

      return cors(request, json({ error: "Not found" }, 404));
    } catch (error) {
      return cors(request, json({ error: safeError(error) }, 500));
    }
  },
};
