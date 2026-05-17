import { expect, test } from "@playwright/test";

/**
 * Krok 1 acceptance:
 * - User can sign up with email + password.
 * - After signup, the authenticated view is visible.
 * - Verification e-mail was delivered to MailHog.
 * - Login with correct password works.
 * - Logout returns to unauthenticated state.
 */

function unique(suffix = "test"): string {
  const ts = Date.now();
  return `astro-${ts}-${suffix}@astrozor.localhost`;
}

const PASSWORD = "AstrozorTest!2026";

test.describe("Krok 1 — Authentication", () => {
  test("signup → authenticated → logout", async ({ page, request }) => {
    const email = unique("signup");

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /astrozor/i })).toBeVisible();

    // Switch to signup tab
    await page.getByRole("button", { name: /registrace/i }).click();

    await page.getByLabel(/přezdívka/i).fill("Test User");
    await page.getByLabel(/e-?mail/i).first().fill(email);
    await page.getByLabel(/heslo/i).fill(PASSWORD);

    await page.getByRole("button", { name: /vytvořit účet/i }).click();

    // Authenticated view — logout button + Mapa nav are reliable markers
    await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("nav-settings")).toBeVisible();

    // Verify e-mail was captured in MailHog
    const mh = await request.get("http://mailhog:8025/api/v2/search?kind=to&query=" + encodeURIComponent(email));
    expect(mh.status()).toBe(200);
    const body = await mh.json();
    expect(body.count).toBeGreaterThanOrEqual(1);

    // Logout
    await page.getByTestId("logout-button").click();
    await expect(page.getByRole("button", { name: /registrace/i })).toBeVisible();
  });

  test("login with existing user", async ({ page, request }) => {
    const email = unique("login");
    // Create user via API
    const signup = await request.post("/api/v1/auth/signup", {
      data: { email, password: PASSWORD, display_name: "Login Tester" },
    });
    expect(signup.status()).toBe(201);
    // Drop session cookie set by signup
    await request.post("/api/v1/auth/logout");

    await page.goto("/");
    await page.getByLabel(/e-?mail/i).first().fill(email);
    await page.getByLabel(/heslo/i).fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: /přihlásit se/i }).click();

    await expect(page.getByTestId("logout-button")).toBeVisible({ timeout: 10000 });
  });

  test("magic link request returns generic ok", async ({ request }) => {
    const email = unique("magic");
    const res = await request.post("/api/v1/auth/magic-link", {
      data: { email: `nonexistent-${email}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Same response regardless of registration — don't leak email existence
    expect(body.status).toBe("ok");
  });
});
