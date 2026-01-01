import { defineMiddleware } from "astro:middleware"
import { resolvePath } from "@codewheel/jsonapi-frontend-client"

const FRONTEND_ONLY_PREFIXES = ["/_astro"]

const FRONTEND_ONLY_PATHS = ["/favicon.svg", "/favicon.ico", "/robots.txt", "/sitemap.xml"]

// Drupal assets that should always be fetched from the Drupal origin in `nextjs_first`.
const DRUPAL_ASSET_PREFIXES = ["/jsonapi", "/core", "/modules", "/themes", "/sites", "/libraries"]

function getDeploymentMode(): "split_routing" | "nextjs_first" {
  return import.meta.env.DEPLOYMENT_MODE === "nextjs_first" ? "nextjs_first" : "split_routing"
}

function getDrupalBaseUrl(): string {
  const raw = import.meta.env.DRUPAL_BASE_URL
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    throw new Error("Missing DRUPAL_BASE_URL (set it in .env)")
  }
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid DRUPAL_BASE_URL protocol "${url.protocol}" (expected http/https)`)
  }
  return url.toString().replace(/\/$/, "")
}

function getDrupalOriginUrl(): string {
  const raw = import.meta.env.DRUPAL_ORIGIN_URL || import.meta.env.DRUPAL_BASE_URL
  const url = new URL(raw)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid DRUPAL_ORIGIN_URL protocol "${url.protocol}" (expected http/https)`)
  }
  return url.toString().replace(/\/$/, "")
}

function getDrupalAuthHeaders(): HeadersInit | undefined {
  const jwt = import.meta.env.DRUPAL_JWT_TOKEN
  if (jwt && typeof jwt === "string" && jwt.trim() !== "") {
    return { Authorization: `Bearer ${jwt}` }
  }

  const username = import.meta.env.DRUPAL_BASIC_USERNAME
  const password = import.meta.env.DRUPAL_BASIC_PASSWORD
  if (username && password && typeof username === "string" && typeof password === "string") {
    const token = Buffer.from(`${username}:${password}`).toString("base64")
    return { Authorization: `Basic ${token}` }
  }

  return undefined
}

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "cache-control",
] as const

const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "etag",
  "last-modified",
  "set-cookie",
  "location",
  "vary",
  "x-drupal-cache",
  "x-drupal-dynamic-cache",
] as const

function rewriteLocationHeader(location: string, drupalOrigin: string, frontendOrigin: string): string {
  try {
    const url = new URL(location)
    const drupalUrl = new URL(drupalOrigin)
    if (url.host === drupalUrl.host) {
      const frontend = new URL(frontendOrigin)
      url.protocol = frontend.protocol
      url.host = frontend.host
    }
    return url.toString()
  } catch {
    return location
  }
}

function buildSafeDrupalTargetUrl(requestUrl: URL, drupalOriginUrl: URL): URL {
  const path = requestUrl.pathname
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("\0")) {
    throw new Error("Invalid request path")
  }

  const targetUrl = new URL(drupalOriginUrl.origin)
  targetUrl.pathname = path
  targetUrl.search = requestUrl.search

  if (targetUrl.origin !== drupalOriginUrl.origin) {
    throw new Error("Refusing to proxy to unexpected origin")
  }

  return targetUrl
}

async function proxyToDrupal(context: { request: Request; url: URL }): Promise<Response> {
  const drupalOrigin = getDrupalOriginUrl()
  const drupalOriginUrl = new URL(drupalOrigin)

  const targetUrl = buildSafeDrupalTargetUrl(context.url, drupalOriginUrl)

  const headers = new Headers()
  for (const headerName of FORWARD_REQUEST_HEADERS) {
    const value = context.request.headers.get(headerName)
    if (value) headers.set(headerName, value)
  }

  // Identify the proxy and forward common context.
  headers.set("X-Forwarded-Proto", context.url.protocol.replace(":", ""))
  headers.set("X-Forwarded-Host", context.url.host)
  const forwardedFor =
    context.request.headers.get("x-forwarded-for") ||
    context.request.headers.get("x-real-ip") ||
    context.request.headers.get("cf-connecting-ip")
  if (forwardedFor) {
    headers.set("X-Forwarded-For", forwardedFor)
  }

  // Add proxy secret for origin protection if configured.
  const proxySecret = import.meta.env.DRUPAL_PROXY_SECRET
  if (proxySecret && typeof proxySecret === "string" && proxySecret.trim() !== "") {
    headers.set("X-Proxy-Secret", proxySecret)
  }

  // Forward server-side auth headers to Drupal if configured.
  const authHeaders = getDrupalAuthHeaders()
  if (authHeaders) {
    new Headers(authHeaders).forEach((value, key) => headers.set(key, value))
  }

  const upstream = await fetch(targetUrl, {
    method: context.request.method,
    headers,
    body: context.request.method !== "GET" && context.request.method !== "HEAD" ? context.request.body : undefined,
    // @ts-expect-error - needed for streaming request bodies in Node
    duplex: "half",
    redirect: "manual",
  })

  const responseHeaders = new Headers()
  for (const headerName of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(headerName)
    if (value) {
      if (headerName === "set-cookie") {
        upstream.headers.forEach((v, k) => {
          if (k.toLowerCase() === "set-cookie") responseHeaders.append("set-cookie", v)
        })
      } else if (headerName === "location") {
        responseHeaders.set("location", rewriteLocationHeader(value, drupalOrigin, context.url.origin))
      } else {
        responseHeaders.set(headerName, value)
      }
    }
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (getDeploymentMode() !== "nextjs_first") {
    return next()
  }

  const path = context.url.pathname

  // Skip Astro internal/static paths.
  if (FRONTEND_ONLY_PATHS.includes(path) || FRONTEND_ONLY_PREFIXES.some((p) => path.startsWith(p))) {
    return next()
  }

  // Proxy assets without hitting the resolver.
  if (DRUPAL_ASSET_PREFIXES.some((p) => path.startsWith(p))) {
    return proxyToDrupal(context)
  }

  // Keep the proxy simple: only proxy idempotent reads by default.
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return next()
  }

  try {
    const baseUrl = getDrupalBaseUrl()
    const headers = getDrupalAuthHeaders()
    const resolved = await resolvePath(path, { baseUrl, headers })

    // Non-headless content: proxy to Drupal origin.
    if (resolved.resolved && !resolved.headless) {
      return proxyToDrupal(context)
    }
  } catch (error) {
    // SECURITY: don't log full URLs; just a safe message.
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[jsonapi_frontend] Middleware resolver error:", message)
  }

  return next()
})
