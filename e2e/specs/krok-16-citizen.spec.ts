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

test.describe("Krok 16 — Citizen science", () => {
  test("create campaign, submit contribution, coordinator reviews", async ({ playwright }) => {
    const coordinator = await playwright.request.newContext({ baseURL: "http://proxy" });
    const contributor = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(coordinator, "coord");
    await signup(contributor, "contrib");

    // Coordinator needs a project to host campaigns
    const projRes = await coordinator.post("/api/v1/projects", {
      data: { name: `Variable star watch ${Date.now()}` },
    });
    const projectSlug = (await projRes.json()).slug;

    // Create campaign
    const c = await coordinator.post("/api/v1/campaigns", {
      data: {
        project_slug: projectSlug,
        title: `AR Cas photometry ${Date.now()}`,
        description: "Weekly photometry runs",
        methodology: "V-filter, 60s exposures, 5 stars per night",
        kind: "photometry",
        contribution_schema: {
          jd: "number",
          mag: "number",
          filter: "string",
        },
      },
    });
    expect(c.status()).toBe(201);
    const campaign = await c.json();
    expect(campaign.status).toBe("open");
    expect(campaign.contribution_count).toBe(0);

    // Contributor submits data
    const contrib = await contributor.post(`/api/v1/campaigns/${campaign.slug}/contributions`, {
      data: {
        title: "Night of 2026-05-17",
        data: { jd: 2460812.5, mag: 9.84, filter: "V" },
        comment: "Clear sky, seeing 3/5",
      },
    });
    expect(contrib.status()).toBe(201);
    const submission = await contrib.json();
    expect(submission.status).toBe("submitted");

    // Coordinator reviews & accepts
    const review = await coordinator.post(
      `/api/v1/contributions/${submission.id}/review`,
      { data: { status: "accepted", review_comment: "Clean photometry" } },
    );
    expect(review.status()).toBe(200);
    const reviewed = await review.json();
    expect(reviewed.status).toBe("accepted");
    expect(reviewed.reviewed_by_email).toBeTruthy();

    // Contributor cannot review (only coordinator)
    const tryReview = await contributor.post(
      `/api/v1/contributions/${submission.id}/review`,
      { data: { status: "rejected" } },
    );
    expect(tryReview.status()).toBe(403);

    // Campaign now shows accepted_count
    const updated = await contributor.get(`/api/v1/campaigns/${campaign.slug}`);
    const updBody = await updated.json();
    expect(updBody.accepted_count).toBe(1);
    expect(updBody.contribution_count).toBe(1);

    await coordinator.dispose();
    await contributor.dispose();
  });
});
