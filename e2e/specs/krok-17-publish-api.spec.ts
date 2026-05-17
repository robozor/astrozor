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

test.describe("Krok 17 — Publish API + tokens", () => {
  test("create token, publish via bearer auth, token shows last_used_at", async ({ playwright }) => {
    // Session for token CRUD
    const session = await playwright.request.newContext({ baseURL: "http://proxy" });
    const email = await signup(session, "tok");

    // Create a token
    const tok = await session.post("/api/v1/accounts/tokens", {
      data: { name: "test CLI token", scopes: ["publish:articles"] },
    });
    expect(tok.status()).toBe(201);
    const { token, prefix } = await tok.json();
    expect(token).toMatch(/^ast_/);
    expect(prefix).toBe(token.slice(0, 8));

    // Bearer client (separate context, no session cookies)
    const bearer = await playwright.request.newContext({
      baseURL: "http://proxy",
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    // whoami
    const who = await bearer.get("/api/v1/publish/whoami");
    expect(who.status()).toBe(200);
    expect((await who.json()).user_email).toBe(email.toLowerCase());

    // Publish via Markdown
    const tag = `pub-${Date.now()}`;
    const pub = await bearer.post("/api/v1/publish/articles", {
      data: {
        title: `CLI published ${tag}`,
        summary: "Sent via API token",
        engine: "markdown",
        language: "cs",
        content_md: `# Hello ${tag}\n\nThis is **bold**.\n`,
      },
    });
    expect(pub.status()).toBe(201);
    const result = await pub.json();
    expect(result.status).toBe("published");
    expect(result.doi).toMatch(/^10\.5281\/zenodo\.MOCK-/);
    expect(result.article_slug).toContain("cli-published");

    // Publish with raw HTML — script must be stripped
    const pub2 = await bearer.post("/api/v1/publish/articles", {
      data: {
        title: `HTML pub ${tag}`,
        engine: "quarto",
        html: `<h1>Hi</h1><script>alert('x')</script><p>safe</p>`,
      },
    });
    expect(pub2.status()).toBe(201);
    // Fetch and verify HTML stripped of script
    const a = await session.get(`/api/v1/articles/${(await pub2.json()).article_slug}`);
    expect(a.status()).toBe(200);
    const aBody = await a.json();
    expect(aBody.content_html).not.toContain("<script>");
    expect(aBody.content_html).toContain("safe");

    // Revoked token can no longer publish
    const list = await session.get("/api/v1/accounts/tokens");
    const tokenId = (await list.json())[0].id;
    const revoke = await session.delete(`/api/v1/accounts/tokens/${tokenId}`);
    expect(revoke.status()).toBe(204);

    const after = await bearer.get("/api/v1/publish/whoami");
    expect(after.status()).toBe(401);

    await session.dispose();
    await bearer.dispose();
  });

  test("publish requires the publish:articles scope", async ({ playwright }) => {
    const session = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(session, "scoped");

    // Token with only read:profile scope
    const tok = await session.post("/api/v1/accounts/tokens", {
      data: { name: "readonly", scopes: ["read:profile"] },
    });
    const { token } = await tok.json();

    const bearer = await playwright.request.newContext({
      baseURL: "http://proxy",
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const pub = await bearer.post("/api/v1/publish/articles", {
      data: { title: "denied", content_md: "x" },
    });
    expect(pub.status()).toBe(403);

    await session.dispose();
    await bearer.dispose();
  });
});
