import { expect, test } from "@playwright/test";

const PASSWORD = "AstrozorTest!2026";

async function signup(request: import("@playwright/test").APIRequestContext, suffix: string) {
  const email = `astro-${Date.now()}-${suffix}@astrozor.localhost`;
  const r = await request.post("/api/v1/auth/signup", {
    data: { email, password: PASSWORD, display_name: suffix },
  });
  expect(r.status()).toBe(201);
  return email;
}

test.describe("Krok 12 — RSS / Atom aggregator", () => {
  test("add feed source pointing at local fixture, fetch, list items", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "feeds");

    // The Django test fixture serves a local Atom feed (DEBUG only)
    const fixtureUrl = "http://api:8000/api/v1/feeds/_test/fixture.xml";
    const slug = "stanoviste-rip";

    const create = await ctx.post("/api/v1/feeds/sources", {
      data: { url: fixtureUrl, name: "Local fixture", target_kind: "place", target_id: slug },
    });
    expect([200, 201]).toContain(create.status());
    const source = await create.json();

    // Manual fetch
    const fetch = await ctx.post(`/api/v1/feeds/sources/${source.id}/fetch`);
    expect(fetch.status()).toBe(200);
    const result = await fetch.json();
    expect(result.status).toBe("ok");
    expect(result.created + result.updated).toBeGreaterThanOrEqual(2);

    // List items for that target
    const list = await ctx.get(`/api/v1/feeds/items?target_kind=place&target_id=${slug}`);
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.count).toBeGreaterThanOrEqual(2);
    const titles = body.items.map((i: { title: string }) => i.title);
    expect(titles).toContain("Test entry 1");
    expect(titles).toContain("Test entry 2");

    // Idempotent fetch — no duplicates
    await ctx.post(`/api/v1/feeds/sources/${source.id}/fetch`);
    const list2 = await ctx.get(`/api/v1/feeds/items?target_kind=place&target_id=${slug}`);
    const body2 = await list2.json();
    expect(body2.count).toBe(body.count);

    await ctx.dispose();
  });

  test("rejects nonexistent target slug", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "badtarget");
    const res = await ctx.post("/api/v1/feeds/sources", {
      data: {
        url: "http://api:8000/api/v1/feeds/_test/fixture.xml",
        target_kind: "place",
        target_id: "ghost-place-does-not-exist",
      },
    });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });
});
