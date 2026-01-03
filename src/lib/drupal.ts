import {
  fetchJsonApi,
  fetchView,
  resolvePath,
  type JsonApiDocument,
  type ResolveResponse,
} from "@codewheel/jsonapi-frontend-client"
import type { LayoutResolveResponse, LayoutTree } from "./layout"

type DeploymentMode = "split_routing" | "nextjs_first"

type LoadedRoute =
  | {
      kind: "not_found"
      resolved: ResolveResponse
      doc: null
      title: null
    }
  | {
      kind: "redirect"
      resolved: ResolveResponse
      doc: null
      title: null
    }
  | {
      kind: "entity"
      resolved: ResolveResponse
      doc: JsonApiDocument
      title: string | null
      layout: LayoutTree | null
    }
  | {
      kind: "view"
      resolved: ResolveResponse
      doc: JsonApiDocument
      title: string | null
      layout: null
    }

export function getDeploymentMode(): DeploymentMode {
  const raw = import.meta.env.DEPLOYMENT_MODE
  return raw === "nextjs_first" ? "nextjs_first" : "split_routing"
}

export function getDrupalBaseUrl(): string {
  const raw = import.meta.env.DRUPAL_BASE_URL
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    throw new Error("Missing DRUPAL_BASE_URL (set it in .env)")
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`Invalid DRUPAL_BASE_URL "${raw}" (expected http(s) URL)`)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid DRUPAL_BASE_URL protocol "${parsed.protocol}" (expected http/https)`)
  }

  return parsed.toString().replace(/\/$/, "")
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

function getDrupalProxyHeaders(): HeadersInit | undefined {
  const proxySecret = import.meta.env.DRUPAL_PROXY_SECRET
  if (proxySecret && typeof proxySecret === "string" && proxySecret.trim() !== "") {
    return { "X-Proxy-Secret": proxySecret.trim() }
  }

  return undefined
}

function guessTitle(doc: JsonApiDocument | null): string | null {
  if (!doc) return null

  const data = (doc as unknown as { data?: unknown }).data
  if (!data || Array.isArray(data)) return null

  const attrs = (data as { attributes?: Record<string, unknown> }).attributes
  if (!attrs) return null

  const title = attrs.title
  if (typeof title === "string" && title.trim() !== "") return title

  const name = attrs.name
  if (typeof name === "string" && name.trim() !== "") return name

  return null
}

async function resolvePathWithLayout(
  path: string,
  options: { baseUrl: string; headers?: HeadersInit }
): Promise<LayoutResolveResponse> {
  const url = new URL("/jsonapi/layout/resolve", options.baseUrl)
  url.searchParams.set("path", path)
  url.searchParams.set("_format", "json")

  const headers: HeadersInit = {
    Accept: "application/vnd.api+json",
    ...(options.headers ?? {}),
  }

  const res = await fetch(url.toString(), { headers })

  if (res.status === 404) {
    return await resolvePath(path, options)
  }

  if (!res.ok) {
    throw new Error(`Layout resolver failed: ${res.status} ${res.statusText}`)
  }

  return (await res.json()) as LayoutResolveResponse
}

export async function loadDrupalRoute(path: string): Promise<LoadedRoute> {
  const baseUrl = getDrupalBaseUrl()
  const authHeaders = getDrupalAuthHeaders()
  const proxyHeaders = getDrupalProxyHeaders()
  const headers =
    authHeaders || proxyHeaders ? { ...(authHeaders ?? {}), ...(proxyHeaders ?? {}) } : undefined

  const resolved = await resolvePathWithLayout(path, { baseUrl, headers })

  if (!resolved.resolved) {
    return { kind: "not_found", resolved, doc: null, title: null }
  }

  if (resolved.redirect) {
    return { kind: "redirect", resolved, doc: null, title: null }
  }

  if (resolved.kind === "entity" && resolved.jsonapi_url) {
    const doc = await fetchJsonApi(resolved.jsonapi_url, { baseUrl, headers })
    const layout = resolved.kind === "entity" && "layout" in resolved ? (resolved.layout ?? null) : null
    return { kind: "entity", resolved, doc, title: guessTitle(doc), layout }
  }

  if (resolved.kind === "view" && resolved.data_url) {
    const doc = await fetchView(resolved.data_url, { baseUrl, headers })
    return { kind: "view", resolved, doc, title: guessTitle(doc), layout: null }
  }

  return { kind: "not_found", resolved, doc: null, title: null }
}
