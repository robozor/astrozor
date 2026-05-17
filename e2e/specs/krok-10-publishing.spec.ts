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

test.describe("Krok 10+11 — Publishing (Markdown) + DOI mock", () => {
  test("draft → publish → DOI minted; markdown is rendered + sanitized", async ({ playwright }) => {
    const author = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(author, "author");

    // Create draft with markdown including a script tag (must be stripped)
    const tag = `pub-${Date.now()}`;
    const md = `# Title ${tag}\n\nHello **world**.\n\n<script>alert('xss')</script>\n\n- item 1\n- item 2\n\n[link](https://example.com)\n`;
    const create = await author.post("/api/v1/articles", {
      data: {
        title: `My article ${tag}`,
        summary: "Test summary",
        content_md: md,
        language: "cs",
      },
    });
    expect(create.status()).toBe(201);
    const draft = await create.json();
    expect(draft.status).toBe("draft");
    expect(draft.doi).toBe("");
    expect(draft.content_html).toContain("<strong>world</strong>");
    expect(draft.content_html).not.toContain("<script>");
    expect(draft.content_html).toContain("<li>item 1</li>");

    // Draft is not in public list
    const publicList = await author.get("/api/v1/articles");
    const publicSlugs = (await publicList.json()).items.map((a: { slug: string }) => a.slug);
    expect(publicSlugs).not.toContain(draft.slug);

    // Author can fetch their own draft directly
    const ownDraft = await author.get(`/api/v1/articles/${draft.slug}`);
    expect(ownDraft.status()).toBe(200);

    // Publish
    const publish = await author.post(`/api/v1/articles/${draft.slug}/publish`);
    expect(publish.status()).toBe(200);
    const published = await publish.json();
    expect(published.status).toBe("published");
    expect(published.published_at).not.toBeNull();
    expect(published.doi).toMatch(/^10\.5281\/zenodo\.MOCK-/);

    // Now it appears in public list
    const publicList2 = await author.get("/api/v1/articles");
    const slugs2 = (await publicList2.json()).items.map((a: { slug: string }) => a.slug);
    expect(slugs2).toContain(draft.slug);

    await author.dispose();
  });

  test("only author can edit or delete; comments only for authed", async ({ playwright }) => {
    const author = await playwright.request.newContext({ baseURL: "http://proxy" });
    const other = await playwright.request.newContext({ baseURL: "http://proxy" });
    const anon = await playwright.request.newContext({ baseURL: "http://proxy" });

    await signup(author, "authA");
    await signup(other, "otherO");

    const create = await author.post("/api/v1/articles", {
      data: { title: `Owned ${Date.now()}`, content_md: "Hello" },
    });
    const slug = (await create.json()).slug;

    // Other cannot edit
    const otherEdit = await other.patch(`/api/v1/articles/${slug}`, {
      data: { title: "hijack" },
    });
    expect(otherEdit.status()).toBe(403);

    // Publish first
    await author.post(`/api/v1/articles/${slug}/publish`);

    // Anonymous cannot comment
    const anonComment = await anon.post(`/api/v1/articles/${slug}/comments`, {
      data: { text: "anon comment" },
    });
    expect(anonComment.status()).toBe(401);

    // Other (authed) can comment
    const c = await other.post(`/api/v1/articles/${slug}/comments`, {
      data: { text: "Great article!" },
    });
    expect(c.status()).toBe(201);

    // List shows comment
    const list = await anon.get(`/api/v1/articles/${slug}/comments`);
    const body = await list.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.items[0].text).toContain("Great article");

    await author.dispose();
    await other.dispose();
    await anon.dispose();
  });
});
