import http from "node:http"
import { once } from "node:events"

const DEFAULT_UUID = "11111111-1111-1111-1111-111111111111"

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/vnd.api+json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  })
  res.end(body)
}

export async function startMockDrupal(options = {}) {
  const uuid = options.uuid ?? DEFAULT_UUID
  const proxySecret = options.proxySecret ?? "test-secret"
  const requests = []

  const server = http.createServer((req, res) => {
    const host = req.headers.host || "127.0.0.1"
    const origin = `http://${host}`
    const url = new URL(req.url || "/", origin)
    const pathname = url.pathname

    requests.push({
      method: req.method || "GET",
      pathname,
      search: url.search,
      proxySecretOk: req.headers["x-proxy-secret"] === proxySecret,
      resolvePath: pathname === "/jsonapi/resolve" ? url.searchParams.get("path") : null,
    })

    // Simulate Drupal origin protection: everything except /jsonapi/* requires X-Proxy-Secret.
    if (!pathname.startsWith("/jsonapi")) {
      const provided = req.headers["x-proxy-secret"]
      if (provided !== proxySecret) {
        return sendJson(res, 403, {
          errors: [
            {
              status: "403",
              title: "Forbidden",
              detail: "Missing or invalid X-Proxy-Secret",
            },
          ],
        })
      }
    }

    if (pathname === "/jsonapi/resolve") {
      const path = url.searchParams.get("path") || ""

      if (path === "/about-us") {
        return sendJson(res, 200, {
          resolved: true,
          kind: "entity",
          canonical: "/about-us",
          entity: { type: "node--page", id: uuid, langcode: "en" },
          redirect: null,
          jsonapi_url: `/jsonapi/node/page/${uuid}`,
          data_url: null,
          headless: true,
          drupal_url: null,
        })
      }

      if (path === "/blog") {
        return sendJson(res, 200, {
          resolved: true,
          kind: "view",
          canonical: "/blog",
          entity: null,
          redirect: null,
          jsonapi_url: null,
          data_url: "/jsonapi/views/articles/page_1",
          headless: true,
          drupal_url: null,
        })
      }

      if (path === "/non-headless") {
        return sendJson(res, 200, {
          resolved: true,
          kind: "entity",
          canonical: "/non-headless",
          entity: { type: "node--page", id: uuid, langcode: "en" },
          redirect: null,
          jsonapi_url: `/jsonapi/node/page/${uuid}`,
          data_url: null,
          headless: false,
          drupal_url: `${origin}/non-headless`,
        })
      }

      return sendJson(res, 200, {
        resolved: false,
        kind: null,
        canonical: null,
        entity: null,
        redirect: null,
        jsonapi_url: null,
        data_url: null,
        headless: false,
        drupal_url: null,
      })
    }

    if (pathname === `/jsonapi/node/page/${uuid}`) {
      return sendJson(res, 200, {
        jsonapi: { version: "1.0" },
        data: {
          type: "node--page",
          id: uuid,
          attributes: {
            title: "About Us",
            body: {
              processed: "<p>Hello from Drupal JSON:API</p>",
              summary: "Hello from Drupal JSON:API",
            },
          },
        },
      })
    }

    if (pathname === "/jsonapi/views/articles/page_1") {
      return sendJson(res, 200, {
        jsonapi: { version: "1.0" },
        data: [
          { type: "node--article", id: "a1", attributes: { title: "Article One" } },
          { type: "node--article", id: "a2", attributes: { title: "Article Two" } },
        ],
      })
    }

    if (pathname === "/non-headless") {
      return sendText(
        res,
        200,
        `<!doctype html><html><head><title>Drupal</title><link rel="stylesheet" href="/sites/default/files/test.css"></head><body><h1>Drupal HTML (non-headless)</h1></body></html>`,
        "text/html; charset=utf-8"
      )
    }

    if (pathname === "/sites/default/files/test.txt") {
      return sendText(res, 200, "TEST FILE", "text/plain; charset=utf-8")
    }

    if (pathname === "/sites/default/files/test.css") {
      return sendText(res, 200, "body{background:#fff}", "text/css; charset=utf-8")
    }

    return sendText(res, 404, "Not Found", "text/plain; charset=utf-8")
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  const addr = server.address()
  const port = typeof addr === "object" && addr ? addr.port : 0

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    proxySecret,
    uuid,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
