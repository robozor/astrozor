import { expect, test } from "@playwright/test";

/**
 * Krok 3 acceptance: Map + Places (read-only).
 * - API: GET /places returns the seeded places (15 CZ observatories/spots).
 * - Map renders (MapLibre canvas).
 * - At least one seeded place's marker is rendered on the authenticated map.
 * - Clicking a marker reveals the detail panel.
 */

const PASSWORD = "AstrozorTest!2026";

test.describe("Krok 3 — Map & places (read-only)", () => {
  test("API lists seeded places", async ({ request }) => {
    const res = await request.get("/api/v1/places");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(15);
    const slugs = body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain("hvezdarna-a-planetarium-brno");
    expect(slugs).toContain("astronomicky-ustav-av-cr-ondrejov");
  });

  test("bbox filter narrows results", async ({ request }) => {
    // Just Czech Republic bbox
    const res = await request.get(
      "/api/v1/places?bbox=12.0,48.5,19.0,51.1",
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThan(0);

    // Bbox completely outside CR — should yield zero
    const empty = await request.get(
      "/api/v1/places?bbox=-20.0,-20.0,-10.0,-10.0",
    );
    const emptyBody = await empty.json();
    expect(emptyBody.count).toBe(0);
  });

  test("authenticated map shows markers and detail panel on click", async ({ page }) => {
    const email = `astro-${Date.now()}-map@astrozor.localhost`;
    const ctxRequest = page.context().request;
    const signup = await ctxRequest.post("/api/v1/auth/signup", {
      data: { email, password: PASSWORD, display_name: "Map Tester" },
    });
    expect(signup.status()).toBe(201);

    await page.goto("/");

    // Map canvas exists (MapLibre creates a <canvas>)
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 10000 });

    // At least one known marker is rendered
    const ondrejov = page.getByTestId("marker-astronomicky-ustav-av-cr-ondrejov");
    await expect(ondrejov).toBeVisible();

    // Click → detail panel
    await ondrejov.click();
    const detail = page.getByTestId("place-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/ondřejov/i);

    // Close detail
    await detail.getByRole("button", { name: /close/i }).click();
    await expect(detail).toBeHidden();
  });
});
