import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import net from "node:net"
import { setTimeout as delay } from "node:timers/promises"
import { startMockDrupal } from "./mock-drupal.mjs"

function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

async function run(cmd, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...options })
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))
    })
  })
}

async function waitForHttpOk(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(url, { redirect: "manual" })
      if (res.ok || (res.status >= 300 && res.status < 500)) {
        return
      }
    } catch {
      // ignore
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${url}`)
    }
    await delay(250)
  }
}

async function startAstroServer(port, env) {
  const child = spawn(process.execPath, ["dist/server/entry.mjs"], {
    stdio: "inherit",
    // Astro standalone server binds to HOST (defaults to "localhost", which can be IPv6-only in CI).
    // Force IPv4 so our smoke requests to 127.0.0.1 always work.
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), ...env },
  })
  await waitForHttpOk(`http://127.0.0.1:${port}/`)
  return child
}

async function stop(child) {
  if (!child || child.killed) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise((resolve) => child.on("exit", resolve)),
    delay(5000),
  ])
  if (!child.killed) {
    child.kill("SIGKILL")
  }
}

async function fetchText(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  return { res, text }
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
  })
}

async function scenarioSplitRouting(baseUrl) {
  console.log("\n[smoke] Astro split_routing")
  const env = {
    DEPLOYMENT_MODE: "split_routing",
    DRUPAL_BASE_URL: baseUrl,
  }

  await run(npmCmd(), ["run", "build"], { env: { ...process.env, ...env } })

  const port = await getFreePort()
  const server = await startAstroServer(port, env)
  try {
    {
      const { res, text } = await fetchText(`http://127.0.0.1:${port}/about-us`)
      assert.equal(res.status, 200)
      assert.match(text, /About Us/)
      assert.match(text, /Hello from Drupal JSON:API/)
    }

    {
      const { res } = await fetchText(`http://127.0.0.1:${port}/non-headless`, {
        redirect: "manual",
      })
      assert.equal(res.status, 302)
      assert.equal(res.headers.get("location"), `${baseUrl}/non-headless`)
    }
  } finally {
    await stop(server)
  }
}

async function scenarioFrontendFirst(baseUrl, proxySecret) {
  console.log("\n[smoke] Astro nextjs_first")
  const env = {
    DEPLOYMENT_MODE: "nextjs_first",
    DRUPAL_BASE_URL: baseUrl,
    DRUPAL_ORIGIN_URL: baseUrl,
    DRUPAL_PROXY_SECRET: proxySecret,
  }

  await run(npmCmd(), ["run", "build"], { env: { ...process.env, ...env } })

  const port = await getFreePort()
  const server = await startAstroServer(port, env)
  try {
    {
      const { res, text } = await fetchText(`http://127.0.0.1:${port}/non-headless`)
      assert.equal(res.status, 200)
      assert.match(text, /Drupal HTML \(non-headless\)/)
    }

    {
      const { res, text } = await fetchText(`http://127.0.0.1:${port}/sites/default/files/test.txt`)
      assert.equal(res.status, 200)
      assert.equal(text, "TEST FILE")
    }
  } finally {
    await stop(server)
  }
}

const mock = await startMockDrupal()
try {
  await scenarioSplitRouting(mock.baseUrl)
  await scenarioFrontendFirst(mock.baseUrl, mock.proxySecret)
  console.log("\n[smoke] OK")
} finally {
  await mock.close()
}
