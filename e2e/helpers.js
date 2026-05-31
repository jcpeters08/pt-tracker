import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// GitHub Contents-style listing built from the real data dir, so the app
// discovers the actual files (then fetches them same-origin from webServer).
function ghListing(dir) {
  const d = path.join(ROOT, "data", dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith(".json")).map(name => ({ name }));
}

// Mock the auth Worker + GitHub Contents API. Same-origin data/*.json are
// served real by the webServer, so the app loads genuine routines/logs.
export async function mockBackends(context) {
  await context.route(/pt-tracker-auth\.ositodelnorte\.workers\.dev/, route => {
    const url = route.request().url();
    if (url.includes("/auth/verify-code")) return route.fulfill({ json: { sid: "e2e-sid" } });
    if (url.includes("/auth/me")) return route.fulfill({ json: { email: "jcpeters08@gmail.com" } });
    if (url.endsWith("/pat")) return route.fulfill({ json: { pat: "github_pat_e2e" } });
    return route.fulfill({ json: { ok: true } });
  });
  await context.route(/api\.github\.com/, route => {
    const url = route.request().url();
    for (const dir of ["routines", "logs", "recovery_logs", "exercises"]) {
      if (url.includes(`/contents/data/${dir}`)) return route.fulfill({ json: ghListing(dir) });
    }
    if (url.includes("pending.json")) return route.fulfill({ json: { content: "e30=", sha: "deadbeef" } });
    return route.fulfill({ json: [] });
  });
}

// Drive the real sign-in UI through to the authenticated app view.
export async function signIn(page, context) {
  await mockBackends(context);
  await page.goto("/index.html");
  await expect(page.locator("#signin-panel")).toBeVisible();
  await page.fill("#email-input", "jcpeters08@gmail.com");
  await page.click("#email-send");
  await expect(page.locator("#code-row")).toBeVisible();
  await page.fill("#code-input", "123456");
  await page.click("#code-verify");
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
}
