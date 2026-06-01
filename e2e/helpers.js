import { expect } from "@playwright/test";
// Mock the auth Worker. Same-origin data/*.json are served by the webServer,
// discovered through data/manifest.json. opts.onPendingAppend(entry) receives
// the pending entry the app posts to the Worker append endpoint.
export async function mockBackends(context, opts = {}) {
  await context.route(/pt-tracker-auth\.ositodelnorte\.workers\.dev/, route => {
    const url = route.request().url();
    if (url.includes("/auth/verify-code")) return route.fulfill({ json: { sid: "e2e-sid" } });
    if (url.includes("/auth/me")) return route.fulfill({ json: { email: "jcpeters08@gmail.com" } });
    if (url.endsWith("/pat")) return route.fulfill({ json: { has_pat: true } });
    if (url.includes("/pending/append")) {
      if (opts.onPendingAppend) {
        try { opts.onPendingAppend(route.request().postDataJSON().entry); } catch {}
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await context.route(/api\.github\.com/, route => {
    return route.fulfill({ status: 500, json: { error: "unexpected GitHub Contents API call in e2e" } });
  });
}

// Drive the real sign-in UI through to the authenticated app view.
export async function signIn(page, context, opts = {}) {
  await mockBackends(context, opts);
  await page.goto("/index.html");
  await expect(page.locator("#signin-panel")).toBeVisible();
  await page.fill("#email-input", "jcpeters08@gmail.com");
  await page.click("#email-send");
  await expect(page.locator("#code-row")).toBeVisible();
  await page.fill("#code-input", "123456");
  await page.click("#code-verify");
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
}
