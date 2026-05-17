import { expect, test } from "@playwright/test";

/**
 * Krok 2 acceptance: i18n (cs / en).
 * - Switching language updates rendered strings.
 * - Selection persists across page reload (localStorage).
 * - Authenticated user's choice persists to profile.
 */

const PASSWORD = "AstrozorTest!2026";

test.describe("Krok 2 — Internationalization", () => {
  test("language switcher toggles cs ↔ en and persists across reload", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("lang-cs").click();
    await expect(page.getByTestId("tab-login")).toHaveText(/přihlášení/i);
    await expect(page.getByTestId("tab-signup")).toHaveText(/registrace/i);

    await page.getByTestId("lang-en").click();
    await expect(page.getByTestId("tab-login")).toHaveText(/^log in$/i);
    await expect(page.getByTestId("tab-signup")).toHaveText(/^sign up$/i);

    await page.reload();
    await expect(page.getByTestId("tab-signup")).toHaveText(/^sign up$/i);

    await page.getByTestId("lang-cs").click();
    await expect(page.getByTestId("tab-signup")).toHaveText(/registrace/i);
  });

  test("authenticated user — language change persists to profile", async ({ page }) => {
    const email = `astro-${Date.now()}-i18n@astrozor.localhost`;
    // Pre-create user via the page context's request (shares cookies)
    const ctxRequest = page.context().request;
    const signup = await ctxRequest.post("/api/v1/auth/signup", {
      data: { email, password: PASSWORD, display_name: "I18n Tester" },
    });
    expect(signup.status()).toBe(201);
    await ctxRequest.post("/api/v1/auth/logout");

    await page.goto("/");
    await page.getByTestId("lang-cs").click(); // start CS to make labels deterministic

    // Login (CS labels: E-mail, Heslo, Přihlásit se)
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: /přihlásit se/i }).click();

    await expect(page.getByText(/přihlášen\(a\) jako/i)).toBeVisible({ timeout: 10000 });

    // Now switch UI to EN — patches profile.language
    const patchPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/accounts/profile") &&
        resp.request().method() === "PATCH" &&
        resp.status() === 200,
    );
    await page.getByTestId("lang-en").click();
    await patchPromise;
    await expect(page.getByText(/logged in as/i)).toBeVisible();

    // Verify via API (use page request context so we share session)
    const me = await ctxRequest.get("/api/v1/auth/me");
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.profile.language).toBe("en");
  });
});
