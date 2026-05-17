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

test.describe("Krok 5 — Presence (check-ins)", () => {
  test("two users check in at a place, presence count grows; explicit end clears", async ({
    playwright,
  }) => {
    const a = await playwright.request.newContext({ baseURL: "http://proxy" });
    const b = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(a, "presA");
    await signup(b, "presB");

    const slug = "hvezdarna-a-planetarium-brno";

    const ca = await a.post(`/api/v1/places/${slug}/checkin`, {
      data: { comment: "M51 observation", anonymous: false },
    });
    expect(ca.status()).toBe(201);

    const cb = await b.post(`/api/v1/places/${slug}/checkin`, {
      data: { anonymous: true },
    });
    expect(cb.status()).toBe(201);
    const { id: bCheckinId } = await cb.json();

    const presence = await a.get(`/api/v1/places/${slug}/presence`);
    expect(presence.status()).toBe(200);
    const body = await presence.json();
    expect(body.count).toBeGreaterThanOrEqual(2);
    const anonRow = body.checkins.find((c: { anonymous: boolean }) => c.anonymous);
    expect(anonRow.display_name).toBe("someone");
    expect(anonRow.user_email).toBeNull();

    // End B's checkin
    const end = await b.delete(`/api/v1/checkins/${bCheckinId}`);
    expect(end.status()).toBe(204);

    const after = await a.get(`/api/v1/places/${slug}/presence`);
    const afterBody = await after.json();
    expect(afterBody.count).toBe(body.count - 1);

    await a.dispose();
    await b.dispose();
  });

  test("non-owner cannot end another's checkin", async ({ playwright }) => {
    const a = await playwright.request.newContext({ baseURL: "http://proxy" });
    const b = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(a, "ownA");
    await signup(b, "intruderB");

    const create = await a.post("/api/v1/places/hvezdarna-vsetin/checkin", { data: {} });
    const { id } = await create.json();

    const tryEnd = await b.delete(`/api/v1/checkins/${id}`);
    expect(tryEnd.status()).toBe(403);

    await a.dispose();
    await b.dispose();
  });
});
