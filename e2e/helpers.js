import { expect } from "@playwright/test";

// Keep date-sensitive routine-mode tests independent from the real calendar.
// Call before signIn() so the app boots with the intended routine as "today".
export async function freezeAppTime(page, timestamp) {
  await page.clock.setFixedTime(timestamp);
}

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

// iOS keeps the layout viewport full-height while the software keyboard is up
// and only shrinks window.visualViewport. Chromium can't open a keyboard, so
// keyboard-aware specs install a controllable visualViewport stand-in before
// the app boots and drive it the way iOS does. Call before signIn().
export async function installFakeVisualViewport(page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    const fake = {
      offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      get width() { return this._width ?? window.innerWidth; },
      set width(v) { this._width = v; },
      get height() { return this._height ?? window.innerHeight; },
      set height(v) { this._height = v; },
      addEventListener: (...args) => target.addEventListener(...args),
      removeEventListener: (...args) => target.removeEventListener(...args),
      dispatchEvent: (event) => target.dispatchEvent(event),
    };
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    window.__fakeVisualViewport = fake;
  });
}

export async function setVisualViewport(page, { height, offsetTop = 0, scale = 1 }, eventName = "resize") {
  await page.evaluate(([h, top, sc, name]) => {
    const vv = window.__fakeVisualViewport;
    vv.height = h; vv.offsetTop = top; vv.scale = sc;
    vv.dispatchEvent(new Event(name));
  }, [height, offsetTop, scale, eventName]);
  await page.waitForTimeout(100); // rAF-coalesced update
}
