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

test.describe("Krok 8+9 — Subscriptions and notifications", () => {
  test("subscribe to place, peer posts message → notification arrives", async ({ playwright }) => {
    const subscriber = await playwright.request.newContext({ baseURL: "http://proxy" });
    const author = await playwright.request.newContext({ baseURL: "http://proxy" });

    await signup(subscriber, "subscriber");
    await signup(author, "author");

    const slug = "hvezdarna-karlovy-vary";

    // Subscriber subscribes to place
    const sub = await subscriber.post("/api/v1/subscriptions", {
      data: { kind: "place", target_id: slug },
    });
    expect([200, 201]).toContain(sub.status());

    // Author posts a chat message
    const tag = `notif-${Date.now()}`;
    await author.post(`/api/v1/places/${slug}/chat`, { data: { text: `Ping ${tag}` } });

    // Subscriber checks notifications
    const list = await subscriber.get("/api/v1/notifications");
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.unread_count).toBeGreaterThanOrEqual(1);
    const match = body.items.find((n: { body: string }) => n.body.includes(tag));
    expect(match).toBeTruthy();
    expect(match.kind).toBe("chat.message");
    expect(match.source_kind).toBe("place");
    expect(match.source_id).toBe(slug);

    // Mark as read
    const markRead = await subscriber.post(`/api/v1/notifications/${match.id}/read`);
    expect(markRead.status()).toBe(200);
    expect((await markRead.json()).read_at).not.toBeNull();

    await subscriber.dispose();
    await author.dispose();
  });

  test("author does NOT get notification about own message", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "selfauth");

    const slug = "stanoviste-rip";
    await ctx.post("/api/v1/subscriptions", { data: { kind: "place", target_id: slug } });

    const tag = `selftag-${Date.now()}`;
    await ctx.post(`/api/v1/places/${slug}/chat`, { data: { text: `From self ${tag}` } });

    const list = await ctx.get("/api/v1/notifications");
    const body = await list.json();
    const own = body.items.find((n: { body: string }) => n.body.includes(tag));
    expect(own).toBeUndefined();

    await ctx.dispose();
  });

  test("check-in triggers notification for subscribers", async ({ playwright }) => {
    const subscriber = await playwright.request.newContext({ baseURL: "http://proxy" });
    const visitor = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(subscriber, "subCheck");
    await signup(visitor, "visitor");

    const slug = "stanoviste-pasecka-skala";
    await subscriber.post("/api/v1/subscriptions", { data: { kind: "place", target_id: slug } });

    await visitor.post(`/api/v1/places/${slug}/checkin`, { data: { comment: "On the spot" } });

    const list = await subscriber.get("/api/v1/notifications");
    const body = await list.json();
    const found = body.items.find(
      (n: { kind: string; source_id: string }) =>
        n.kind === "presence.checkin" && n.source_id === slug,
    );
    expect(found).toBeTruthy();

    await subscriber.dispose();
    await visitor.dispose();
  });
});
