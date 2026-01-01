# jsonapi-frontend-astro

Astro starter template for Drupal JSON:API with [`jsonapi_frontend`](https://www.drupal.org/project/jsonapi_frontend).

## Quick start

1) Install dependencies

```bash
npm install
```

2) Configure Drupal URL

```bash
cp .env.example .env
```

Edit `.env`:

```env
DRUPAL_BASE_URL=https://your-drupal-origin.com
```

3) Start developing

```bash
npm run dev
```

Open `http://localhost:4321` and navigate to any path that exists in Drupal.

## Requirements

- Node.js 20+
- A Drupal 10+ site with:
  - `drupal/jsonapi_frontend` enabled
  - Core `jsonapi` enabled
  - `jsonapi_views` (optional, for Views support)

## How it works

```
Request: /about-us
  ↓
Resolver: GET {DRUPAL_BASE_URL}/jsonapi/resolve?path=/about-us&_format=json
  ↓
Response: { kind: "entity", jsonapi_url: "/jsonapi/node/page/...", headless: true }
  ↓
Fetch: GET {DRUPAL_BASE_URL}/jsonapi/node/page/... (server-side)
  ↓
Render (Astro SSR): /src/pages/[...slug].astro
```

## Deployment modes

### Split routing (default)

- Drupal stays on your main domain.
- Your router/CDN sends selected paths to Astro.

```env
DEPLOYMENT_MODE=split_routing
DRUPAL_BASE_URL=https://www.example.com
```

### Frontend-first (`nextjs_first`)

- Astro handles all traffic on the main domain.
- Drupal runs on an origin/subdomain (e.g. `https://cms.example.com`).
- `src/middleware.ts` proxies:
  - Drupal assets (`/sites`, `/core`, etc.)
  - `/jsonapi/*` (so the API can live behind the same public domain)
  - any non-headless paths (based on `/jsonapi/resolve`)

```env
DEPLOYMENT_MODE=nextjs_first
DRUPAL_BASE_URL=https://cms.example.com
DRUPAL_ORIGIN_URL=https://cms.example.com
DRUPAL_PROXY_SECRET=your-secret-from-drupal-admin
```

In this mode, access Drupal admin directly on the origin domain (e.g. `https://cms.example.com/admin`).

## Credentials (optional)

If your Drupal JSON:API requires auth, set one of these in `.env` (server-side only):

- `DRUPAL_BASIC_USERNAME` + `DRUPAL_BASIC_PASSWORD`
- `DRUPAL_JWT_TOKEN`

