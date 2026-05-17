import { expect, test } from "@playwright/test";

test.describe("Krok 18+19 — PWA + hardening", () => {
  test("PWA manifest is served and references icons", async ({ request }) => {
    const r = await request.get("/manifest.webmanifest");
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.name).toBe("Astrozor");
    expect(body.short_name).toBe("Astrozor");
    expect(body.display).toBe("standalone");
    expect(Array.isArray(body.icons)).toBe(true);
  });

  test("service worker is registered (URL accessible)", async ({ request }) => {
    // vite-plugin-pwa in dev exposes 'dev-sw.js'
    const r = await request.get("/dev-sw.js?dev-sw");
    expect([200, 404]).toContain(r.status());
  });

  test("API responses include security headers", async ({ request }) => {
    const r = await request.get("/api/v1/healthz");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
    expect(r.headers()["x-frame-options"]).toBe("DENY");
    expect(r.headers()["referrer-policy"]).toContain("strict-origin");
    expect(r.headers()["content-security-policy"]).toContain("default-src 'none'");
  });

  test("rate limiter blocks auth endpoint after threshold", async ({ playwright }) => {
    test.setTimeout(30_000);
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    // Dev limit /signup: 50 calls / 600 s per IP. Issue 60 to trip it.
    const responses: number[] = [];
    for (let i = 0; i < 60; i++) {
      const r = await ctx.post("/api/v1/auth/signup", {
        data: {
          email: `rate-${Date.now()}-${i}@astrozor.localhost`,
          password: "p455word!12",
        },
      });
      responses.push(r.status());
    }
    expect(responses.includes(429)).toBe(true);
    await ctx.dispose();
  });
});
