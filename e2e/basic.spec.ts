import { expect, test } from "@playwright/test"

function getDrupalBaseUrl(): string {
  return process.env.DRUPAL_BASE_URL || "http://127.0.0.1:8080"
}

type MenuItem = {
  title: string
  url: string
  active: boolean
  in_active_trail: boolean
  resolve: { resolved: boolean; kind: string | null } | null
  children: MenuItem[]
}

function findMenuItem(items: MenuItem[], title: string): MenuItem | null {
  for (const item of items) {
    if (item.title === title) return item
    const child = findMenuItem(item.children ?? [], title)
    if (child) return child
  }
  return null
}

test("renders a headless page via resolver", async ({ page }) => {
  await page.goto("/about-us")
  await expect(page.getByRole("heading", { name: "About Us" })).toBeVisible()
  await expect(page.getByText("Hello from Drupal JSON:API").first()).toBeVisible()

  if (process.env.EXPECT_LAYOUT === "1") {
    await expect(page.locator("[data-layout-id]")).toBeVisible()
  }
})

test("menu endpoint returns active trail + resolve hints", async ({ request }) => {
  const baseUrl = getDrupalBaseUrl()
  const url = new URL("/jsonapi/menu/main", baseUrl)
  url.searchParams.set("_format", "json")
  url.searchParams.set("path", "/about-us")

  const res = await request.get(url.toString(), {
    headers: { Accept: "application/vnd.api+json" },
  })
  expect(res.ok()).toBeTruthy()

  const payload = (await res.json()) as { data: MenuItem[]; meta?: { active_trail?: string[] } }
  expect(Array.isArray(payload.data)).toBeTruthy()
  expect(payload.meta?.active_trail?.length).toBeTruthy()

  const about = findMenuItem(payload.data, "About Us")
  expect(about).not.toBeNull()
  expect(about?.active).toBeTruthy()
  expect(about?.in_active_trail).toBeTruthy()
  expect(about?.resolve?.resolved).toBeTruthy()
  expect(about?.resolve?.kind).toBe("entity")
})

test("webform routes resolve as non-headless (route kind)", async ({ request }) => {
  const baseUrl = getDrupalBaseUrl()
  const url = new URL("/jsonapi/resolve", baseUrl)
  url.searchParams.set("_format", "json")
  url.searchParams.set("path", "/form/contact")

  const res = await request.get(url.toString(), {
    headers: { Accept: "application/vnd.api+json" },
  })
  expect(res.ok()).toBeTruthy()

  const payload = (await res.json()) as {
    resolved: boolean
    kind: string | null
    headless: boolean
    drupal_url: string | null
  }
  expect(payload.resolved).toBeTruthy()
  expect(payload.kind).toBe("route")
  expect(payload.headless).toBeFalsy()
  expect(payload.drupal_url).toBeTruthy()
})

test("proxies non-headless routes in nextjs_first", async ({ page }) => {
  test.skip(process.env.E2E_DEPLOYMENT_MODE !== "nextjs_first", "Requires nextjs_first mode")
  await page.goto("/non-headless")
  await expect(page.getByText("Non-headless")).toBeVisible()
  await expect(page.getByText("This route is intentionally not headless.")).toBeVisible()
})

test("redirects non-headless routes in split_routing", async ({ page }) => {
  test.skip(process.env.E2E_DEPLOYMENT_MODE === "nextjs_first", "Only for split_routing")

  await page.goto("/non-headless")
  const baseUrl = getDrupalBaseUrl()
  await expect(page).toHaveURL(new RegExp(`^${escapeRegExp(new URL(baseUrl).origin)}`))
  await expect(page.getByText("Non-headless")).toBeVisible()
  await expect(page.getByText("This route is intentionally not headless.")).toBeVisible()
})

test("webforms remain Drupal-rendered (proxy/redirect)", async ({ page }) => {
  await page.goto("/form/contact")
  await expect(page.getByText("Contact").first()).toBeVisible()
  await expect(page.locator("form")).toBeVisible()
})

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
