import { expect, test } from "@playwright/test";

/**
 * Krok 4 acceptance: Places CRUD.
 * - Authed user can create a temporary place.
 * - Owner can update/delete; non-owner cannot.
 * - Permanent kinds require staff; non-staff get 403.
 * - Expired temp place no longer listed.
 */

const PASSWORD = "AstrozorTest!2026";

async function signup(request: import("@playwright/test").APIRequestContext, suffix: string) {
  const email = `astro-${Date.now()}-${suffix}@astrozor.localhost`;
  const r = await request.post("/api/v1/auth/signup", {
    data: { email, password: PASSWORD, display_name: suffix },
  });
  expect(r.status()).toBe(201);
  return email;
}

test.describe("Krok 4 — Places CRUD", () => {
  test("create temporary place, update, delete", async ({ playwright }) => {
    // Each test gets its own request context (own cookies)
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "crud");

    // Create temporary place
    const create = await ctx.post("/api/v1/places", {
      data: {
        name: `Test spot ${Date.now()}`,
        kind: "spot_temporary",
        description: "E2E test",
        lat: 50.1,
        lon: 14.4,
      },
    });
    expect(create.status()).toBe(201);
    const place = await create.json();
    expect(place.kind).toBe("spot_temporary");
    expect(place.valid_to).not.toBeNull();
    const slug = place.slug as string;

    // Update
    const patch = await ctx.patch(`/api/v1/places/${slug}`, {
      data: { description: "Updated desc" },
    });
    expect(patch.status()).toBe(200);
    expect((await patch.json()).description).toBe("Updated desc");

    // Delete
    const del = await ctx.delete(`/api/v1/places/${slug}`);
    expect(del.status()).toBe(204);

    // 404 after delete
    const get = await ctx.get(`/api/v1/places/${slug}`);
    expect(get.status()).toBe(404);

    await ctx.dispose();
  });

  test("non-owner cannot modify", async ({ playwright }) => {
    const owner = await playwright.request.newContext({ baseURL: "http://proxy" });
    const intruder = await playwright.request.newContext({ baseURL: "http://proxy" });

    await signup(owner, "owner");
    await signup(intruder, "intruder");

    const create = await owner.post("/api/v1/places", {
      data: { name: `Owned spot ${Date.now()}`, kind: "spot_temporary", lat: 50.1, lon: 14.4 },
    });
    const { slug } = await create.json();

    const patch = await intruder.patch(`/api/v1/places/${slug}`, {
      data: { description: "hijack" },
    });
    expect(patch.status()).toBe(403);

    const del = await intruder.delete(`/api/v1/places/${slug}`);
    expect(del.status()).toBe(403);

    await owner.dispose();
    await intruder.dispose();
  });

  test("non-staff cannot create permanent place", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "perm");

    const create = await ctx.post("/api/v1/places", {
      data: {
        name: "Forbidden observatory",
        kind: "observatory_public",
        lat: 50.1,
        lon: 14.4,
      },
    });
    expect(create.status()).toBe(403);

    await ctx.dispose();
  });

  test("expired temp place vanishes from list", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "expire");

    // Create temp place with valid_to in the past (1 hour ago)
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    const create = await ctx.post("/api/v1/places", {
      data: {
        name: `Already-expired ${Date.now()}`,
        kind: "spot_temporary",
        lat: 50.1,
        lon: 14.4,
        valid_to: past,
      },
    });
    expect(create.status()).toBe(201);
    const { slug } = await create.json();

    // Should not appear in the default list (API filters expired temp)
    const list = await ctx.get("/api/v1/places");
    const body = await list.json();
    const slugs = body.items.map((p: { slug: string }) => p.slug);
    expect(slugs).not.toContain(slug);

    await ctx.dispose();
  });
});
