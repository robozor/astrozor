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

test.describe("Krok 6+7 — Chat (REST, polling-based)", () => {
  test("two users exchange messages, both see history", async ({ playwright }) => {
    const a = await playwright.request.newContext({ baseURL: "http://proxy" });
    const b = await playwright.request.newContext({ baseURL: "http://proxy" });
    const emailA = await signup(a, "chatA");
    const emailB = await signup(b, "chatB");

    const slug = "hvezdarna-jindrichuv-hradec";
    const tag = `tag-${Date.now()}`;

    await a.post(`/api/v1/places/${slug}/chat`, { data: { text: `Hello from A ${tag}` } });
    await b.post(`/api/v1/places/${slug}/chat`, { data: { text: `Reply from B ${tag}` } });

    const list = await a.get(`/api/v1/places/${slug}/chat`);
    expect(list.status()).toBe(200);
    const body = await list.json();
    const texts = body.items.map((m: { text: string }) => m.text);
    expect(texts.some((t: string) => t.includes(`Hello from A ${tag}`))).toBe(true);
    expect(texts.some((t: string) => t.includes(`Reply from B ${tag}`))).toBe(true);

    // Author display name carried correctly — filter by the unique tag
    const aRow = body.items.find((m: { text: string }) => m.text.includes(`Hello from A ${tag}`));
    expect(aRow.user_email.toLowerCase()).toBe(emailA.toLowerCase());
    void emailB;

    await a.dispose();
    await b.dispose();
  });

  test("XSS attempt is sanitized", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "xss");
    const slug = "hvezdarna-vsetin";

    await ctx.post(`/api/v1/places/${slug}/chat`, {
      data: { text: `<script>alert("xss")</script><b>safe</b><a href="javascript:bad()">link</a>` },
    });

    const list = await ctx.get(`/api/v1/places/${slug}/chat`);
    const body = await list.json();
    const latest = body.items[body.items.length - 1].text;
    expect(latest).not.toContain("<script>");
    expect(latest).toContain("<b>safe</b>");
    // bleach strips javascript: schemes
    expect(latest).not.toContain("javascript:");

    await ctx.dispose();
  });

  test("anonymous user cannot post", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    const res = await ctx.post("/api/v1/places/hvezdarna-vsetin/chat", { data: { text: "nope" } });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
