# PIXEL & PING deployment audit

## Included behavior
- Single landing page only.
- No registration/login flow.
- Four languages: English, Persian, Russian, Chinese.
- Cloudflare dashboard and preconfigured API-token links.
- Token validation before provisioning.
- Account discovery through Memberships:Read, with /accounts fallback.
- Automatic D1 + core migrations + KV + Worker + workers.dev + admin + health check.
- Runtime secrets are generated server-side and uploaded as Cloudflare secret bindings.
- User API token is not persisted to disk/database and is cleared from the in-memory job after completion/failure.
- Per-IP in-memory rate limits for token verification and deployment starts.
- Real panel URL is only returned after the panel's /api/health endpoint succeeds.

## Verification performed in the build workspace
- `node --check server.mjs` — PASS.
- Frontend TypeScript source was parsed by `tsc`; dependency resolution was unavailable in the isolated build environment because npm packages were not installed there. The user-facing build command remains `npm run build`.

No claim of a real Cloudflare deployment is made from this offline workspace. The first real deployment must be tested with a real Cloudflare token in the target hosting environment.
