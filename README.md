# PIXEL & PING — One-Click Cloudflare Panel Deployer

A single professional landing page inspired by the supplied Orbit reference, rebuilt for PIXEL & PING. It has no pricing page, no Flux, no Telegram dependency, and no registration.

## Flow

**Cloudflare token → Deploy → real D1/KV/Worker provisioning → workers.dev → admin bootstrap → health check → panel URL + password.**

The hero uses the supplied PIXEL & PING dashboard screenshot as the interactive product mockup. Move the mouse over it to get the parallax effect.

## Languages

- English
- فارسی (RTL)
- Русский
- 中文

## Replit / GitHub

The public website can be hosted as a single Replit web service. Replit's public URL becomes the website URL. The same Node service serves the built React frontend and the secure deployment API.

### Run locally

```text
npm install
npm --prefix frontend install
npm run build
npm start
```

The server listens on `0.0.0.0:3000` (or Replit's `PORT`).

### GitHub

Push the whole repository to GitHub. Do not commit any `.env` file or Cloudflare API token.

### Cloudflare token

The page's token link is preconfigured for the permissions required by the deployment flow, including Workers Scripts, Workers KV Storage, D1, Workers.dev/subdomain, Account Analytics, User Details and Memberships.

### Security

Visitor tokens are accepted only over HTTPS in production hosting, held in memory while a deployment is running, never written to GitHub/D1/files, and removed from the in-memory job after success or failure. The server never logs request bodies.
