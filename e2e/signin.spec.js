import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

test("sign-in reaches the authenticated app and renders without fatal errors", async ({ page, context }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await signIn(page, context);

  await expect(page.locator("#signin-panel")).toBeHidden();
  await expect(page.locator("#signout-btn")).toBeVisible();
  // App shell has real content (routine loaded from the served data files).
  expect((await page.locator("#app").innerText()).trim().length).toBeGreaterThan(0);

  // No module/reference regressions (the kind a bad module extraction causes).
  const fatal = errors.filter(e => /is not defined|ReferenceError|SyntaxError|Failed to (load|fetch).*module|Unexpected/i.test(e));
  expect(fatal, `fatal JS errors:\n${fatal.join("\n")}`).toEqual([]);
});

// An expired Worker session mid-workout must route the user back to sign-in
// (with their draft intact) instead of a dead-end "Submit failed: 401" toast.
test("a 401 on submit returns to sign-in with the workout draft kept", async ({ page, context }) => {
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-06-10T12:00:00-05:00");   // W24 current
  await signIn(page, context);
  // Registered after the helper's mocks, so it takes precedence for this path.
  await context.route(/\/pending\/append/, route =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }));

  await page.fill("#workout-date", "2026-06-09");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();   // Tuesday Pull, unlogged
  const set0 = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='weight']").fill("60");
  await set0.locator("input[data-field='reps']").fill("9");
  await set0.locator("[data-action='done']").click();
  await expect(set0).toHaveClass(/done/);

  const draftKeys = () => page.evaluate(() =>
    Object.keys(localStorage).filter(k => k.startsWith("pt_tracker_draft_v2:")));
  await expect.poll(draftKeys).toHaveLength(1);
  const [draftKey] = await draftKeys();
  const draftBefore = await page.evaluate(k => localStorage.getItem(k), draftKey);

  await page.click("#submit-btn");

  await expect(page.locator("#signin-panel")).toBeVisible();
  await expect(page.locator("#app")).toBeHidden();
  await expect(page.locator("#toast")).toContainText(/expired/i);
  await expect(page.locator("#toast")).toContainText(/draft/i);
  expect(await page.evaluate(() => localStorage.getItem("pt_tracker_sid"))).toBeNull();
  expect(await page.evaluate(k => localStorage.getItem(k), draftKey)).toBe(draftBefore);
});
