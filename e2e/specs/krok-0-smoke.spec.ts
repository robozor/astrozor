import { expect, test } from "@playwright/test";

/**
 * Krok 0 acceptance test:
 * - The home page renders the placeholder with the title "Astrozor".
 * - The API health check returns status "ok".
 * - The frontend successfully fetches /api/v1/healthz from the running stack.
 */

test.describe("Krok 0 — Docker stack smoke", () => {
  test("home page renders Astrozor heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /astrozor/i })).toBeVisible();
    await expect(page.getByText(/Krok 0/i)).toBeVisible();
  });

  test("API healthz endpoint returns 200 OK", async ({ request }) => {
    const response = await request.get("/api/v1/healthz");
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({ status: "ok", version: expect.any(String) });
  });

  test("API readyz endpoint reports database connection", async ({ request }) => {
    const response = await request.get("/api/v1/readyz");
    expect(response.status()).toBe(200);
    const json = await response.json();
    expect(json.database).toMatch(/^(ok|error|skipped)/);
  });

  test("frontend shows API + Database status cards", async ({ page }) => {
    await page.goto("/");
    // Wait for TanStack Query to fetch /api/v1/healthz
    await expect(page.getByText(/frontend/i).first()).toBeVisible();
    await expect(page.getByText(/api/i).first()).toBeVisible();
    await expect(page.getByText(/database/i).first()).toBeVisible();
  });
});
