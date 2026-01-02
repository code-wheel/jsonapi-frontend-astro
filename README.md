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

## Minimal integration (without this starter)

If you prefer wiring this into an existing Astro project, the core loop is:

```ts
import { resolvePath, fetchJsonApi, fetchView } from "@codewheel/jsonapi-frontend-client"

const baseUrl = import.meta.env.DRUPAL_BASE_URL
const resolved = await resolvePath("/about-us", { baseUrl })

if (resolved.resolved && resolved.kind === "entity" && resolved.jsonapi_url) {
  const doc = await fetchJsonApi(resolved.jsonapi_url, { baseUrl })
}

if (resolved.resolved && resolved.kind === "view" && resolved.data_url) {
  const doc = await fetchView(resolved.data_url, { baseUrl })
}
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
  - Webform routes like `/form/*` and `/webform_rest/*` (for interactive forms + submissions)
  - any non-headless paths (based on `/jsonapi/resolve`)

```env
DEPLOYMENT_MODE=nextjs_first
DRUPAL_BASE_URL=https://cms.example.com
DRUPAL_ORIGIN_URL=https://cms.example.com
DRUPAL_PROXY_SECRET=your-secret-from-drupal-admin
```

In this mode, access Drupal admin directly on the origin domain (e.g. `https://cms.example.com/admin`).

## Webforms (optional)

Drupal Webform is usually best kept as a Drupal-rendered UI in hybrid headless setups:

- **Split routing:** route `/form/*` to Drupal.
- **Frontend-first:** this starter proxies `/form/*` and `/webform_rest/*` to Drupal (including POST submissions).

## Static builds (SSG) (optional)

This starter runs in SSR mode by default (so it can support `nextjs_first` proxying). If you want Astro’s default static output (SSG), you still use `/jsonapi/resolve` for correctness — the missing piece is a build-time list of paths.

- SSG works best with `split_routing` (static sites can’t proxy Drupal HTML).
- Generate a route list from either:
  - JSON:API collection endpoints (e.g. list `path.alias` from `/jsonapi/node/page?filter[status]=1&fields[node--page]=path`), or
  - the built-in routes feed (`/jsonapi/routes`) (recommended), or
  - a single Views “routes feed” exposed via `jsonapi_views`.

Built-in routes feed example:

```bash
curl -H "X-Routes-Secret: $ROUTES_FEED_SECRET" "https://cms.example.com/jsonapi/routes?_format=json&page[limit]=50"
```

Example `getStaticPaths()` (pre-render pages from `node--page`):

```astro
---
import { loadDrupalRoute } from "../lib/drupal"

export async function getStaticPaths() {
  const baseUrl = import.meta.env.DRUPAL_BASE_URL
  const url = new URL("/jsonapi/node/page", baseUrl)
  url.searchParams.set("filter[status]", "1")
  url.searchParams.set("fields[node--page]", "path")
  url.searchParams.set("page[limit]", "50")

  const doc = await fetch(url).then((r) => r.json())
  const paths = (doc.data ?? [])
    .map((node) => node?.attributes?.path?.alias)
    .filter((p) => typeof p === "string" && p.startsWith("/"))

  return paths.map((p) => ({
    params: { slug: p.split("/").filter(Boolean) },
    props: { path: p },
  }))
}

const { path } = Astro.props
const result = await loadDrupalRoute(path)
---
```

If you have a lot of content, paginate using JSON:API `links.next` (or `page[offset]`/`page[limit]`).

See the Migration Guide for details: https://www.drupal.org/docs/contributed-modules/jsonapi-frontend/migration-guide

## Credentials (optional)

If your Drupal JSON:API requires auth, set one of these in `.env` (server-side only):

- `DRUPAL_BASIC_USERNAME` + `DRUPAL_BASIC_PASSWORD`
- `DRUPAL_JWT_TOKEN`
