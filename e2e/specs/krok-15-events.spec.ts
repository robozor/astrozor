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

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

test.describe("Krok 15 — Events + state machine + iCal", () => {
  test("create event, transitions draft→announced→regOpen, register, then close", async ({
    playwright,
  }) => {
    const organizer = await playwright.request.newContext({ baseURL: "http://proxy" });
    const attendee = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(organizer, "org");
    await signup(attendee, "att");

    const create = await organizer.post("/api/v1/events", {
      data: {
        title: `Star party ${Date.now()}`,
        description: "Perseids observation",
        kind: "star_party",
        place_slug: "hvezdarna-vsetin",
        starts_at: future,
        capacity: 30,
      },
    });
    expect(create.status()).toBe(201);
    const ev = await create.json();
    expect(ev.status).toBe("draft");

    // Registration not open
    const earlyReg = await attendee.post(`/api/v1/events/${ev.slug}/register`);
    expect(earlyReg.status()).toBe(400);

    // Transition draft → announced
    const t1 = await organizer.post(`/api/v1/events/${ev.slug}/transition`, {
      data: { status: "announced" },
    });
    expect(t1.status()).toBe(200);

    // Invalid transition announced → finished (skipping stages)
    const tInv = await organizer.post(`/api/v1/events/${ev.slug}/transition`, {
      data: { status: "finished" },
    });
    expect(tInv.status()).toBe(400);

    // announced → registration_open
    const t2 = await organizer.post(`/api/v1/events/${ev.slug}/transition`, {
      data: { status: "registration_open" },
    });
    expect(t2.status()).toBe(200);

    // Now attendee can register
    const reg = await attendee.post(`/api/v1/events/${ev.slug}/register`);
    expect([200, 201]).toContain(reg.status());

    // Detail shows registration_count
    const detail = await organizer.get(`/api/v1/events/${ev.slug}`);
    expect((await detail.json()).registration_count).toBe(1);

    // iCal export
    const ical = await attendee.get(`/api/v1/events/${ev.slug}/ical`);
    expect(ical.status()).toBe(200);
    const body = await ical.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Star party");

    await organizer.dispose();
    await attendee.dispose();
  });

  test("non-organizer cannot transition", async ({ playwright }) => {
    const org = await playwright.request.newContext({ baseURL: "http://proxy" });
    const other = await playwright.request.newContext({ baseURL: "http://proxy" });
    await signup(org, "orgT");
    await signup(other, "otherT");

    const create = await org.post("/api/v1/events", {
      data: { title: `Event ${Date.now()}`, starts_at: future },
    });
    const slug = (await create.json()).slug;

    const tryT = await other.post(`/api/v1/events/${slug}/transition`, {
      data: { status: "announced" },
    });
    expect(tryT.status()).toBe(403);

    await org.dispose();
    await other.dispose();
  });
});
