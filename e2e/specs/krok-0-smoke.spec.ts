import { expect, test } from "@playwright/test";

/**
 * Krok 0 regression smoke:
 * - The home page renders SOMETHING (Astrozor heading).
 * - The API health check returns status "ok".
 * - The API readyz endpoint reports a working database connection.
 *
 * These tests stay valid across all Kroks — they verify the foundation
 * (Docker stack, Caddy proxy, Django + Ninja API) is alive.
 */

test.describe("Krok 0 — Foundation smoke", () => {
  test("home page renders Astrozor heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /astrozor/i })).toBeVisible();
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
    expect(json.database).toBe("ok");
  });
});
