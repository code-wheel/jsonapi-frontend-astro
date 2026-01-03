import { expect, test } from "@playwright/test"

test("renders a headless page via resolver", async ({ page }) => {
  await page.goto("/about-us")
  await expect(page.getByRole("heading", { name: "About Us" })).toBeVisible()
  await expect(page.getByText("Hello from Drupal JSON:API").first()).toBeVisible()

  if (process.env.EXPECT_LAYOUT === "1") {
    await expect(page.locator("[data-layout-id]")).toBeVisible()
  }
})

test("proxies non-headless routes in nextjs_first", async ({ page }) => {
  test.skip(process.env.E2E_DEPLOYMENT_MODE !== "nextjs_first", "Requires nextjs_first mode")
  await page.goto("/non-headless")
  await expect(page.getByText("Non-headless")).toBeVisible()
  await expect(page.getByText("This route is intentionally not headless.")).toBeVisible()
})

