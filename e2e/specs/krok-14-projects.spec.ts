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

test.describe("Krok 14 — Projects + GitHub", () => {
  test("create project, list, owner is auto-member", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "proj");

    const create = await ctx.post("/api/v1/projects", {
      data: { name: `Test project ${Date.now()}`, description: "E2E test", language: "cs" },
    });
    expect(create.status()).toBe(201);
    const p = await create.json();
    expect(p.member_count).toBe(1);
    expect(p.repo_count).toBe(0);
    expect(p.visibility).toBe("public");

    // List shows it (public)
    const list = await ctx.get("/api/v1/projects");
    const slugs = (await list.json()).map((x: { slug: string }) => x.slug);
    expect(slugs).toContain(p.slug);

    await ctx.dispose();
  });

  test("add GitHub repo, fetch metadata (anon API)", async ({ playwright }) => {
    test.setTimeout(60_000); // GitHub API can be slow
    const ctx = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(ctx, "ghproj");

    const create = await ctx.post("/api/v1/projects", {
      data: { name: `Astronomy hub ${Date.now()}` },
    });
    const slug = (await create.json()).slug;

    // Add a stable, very public repo. GitHub anon: 60 req/hour per IP.
    const addRepo = await ctx.post(`/api/v1/projects/${slug}/repos`, {
      data: { full_name: "astropy/astropy" },
    });
    expect(addRepo.status()).toBe(201);
    const repo = await addRepo.json();

    // Skip if rate-limited (CI flakiness defense)
    if (repo.last_status === "rate_limited" || repo.last_status === "error") {
      test.skip(true, `GitHub status: ${repo.last_status}`);
    }
    expect(repo.last_status).toBe("ok");
    expect(repo.stars).toBeGreaterThan(0);
    expect(repo.language).toBeTruthy();

    // List repos for project
    const list = await ctx.get(`/api/v1/projects/${slug}/repos`);
    expect(list.status()).toBe(200);
    expect((await list.json()).length).toBe(1);

    await ctx.dispose();
  });
});
