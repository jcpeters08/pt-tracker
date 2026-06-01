import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// Validates two reported navigation bugs in the workout day view:
//   Bug 2 — viewing a prior workout day in the current week showed routine
//           DEFAULTS instead of the actual logged session.
//   Bug 1 — switching to another routine via the pill and back reset the
//           in-progress workout to defaults (lost edits).
// W22 (2026-05-25 → 05-31) is the deterministic fixture: setting the date into
// that window makes W22 the active routine, and it has logged sessions Tue–Fri
// (data/logs/2026-05-26..29). Tuesday 5/26 is a logged Pull day.

test("Bug 2: a prior logged day in the current week shows the logged session, not defaults", async ({ page, context }) => {
  await signIn(page, context);
  await page.fill("#workout-date", "2026-05-25");           // land in the W22 week
  await page.dispatchEvent("#workout-date", "change");
  await expect(page.locator("#app")).toBeVisible();

  // Navigate to Tuesday (a different, already-logged day) via the day pill.
  // Day toggle order is Mon=0, Tue=1, …
  await page.locator("#day-toggle .day-pill").nth(1).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();

  // The logged session must be detected: "✓ Logged" status + a pre-filled Done
  // set. Before the fix the lookup keyed on today's date, so this stayed hidden
  // and the cards showed routine defaults.
  await expect(page.locator("#log-status")).toBeVisible();
  await expect(page.locator("#log-status")).toContainText(/Logged|Submitted/);
  await expect(page.locator(".ex-card .set-row.done").first()).toBeVisible();
});

test("Bug 1 (regression): switching routine via the pill and back keeps in-progress edits", async ({ page, context }) => {
  page.on("dialog", d => d.accept());
  await signIn(page, context);
  await page.fill("#workout-date", "2026-05-25");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click(); // Monday (Push)

  const weight = () => page.locator(".ex-card").first()
    .locator(".set-row[data-set='0'] input[data-field='weight']");
  await expect(weight()).toBeVisible();
  await weight().fill("137");                 // distinctive, non-default value
  await weight().dispatchEvent("input");
  await expect(weight()).toHaveValue("137");

  // Switch to a different routine via the pill, then back to W22.
  await page.click("#routine-label");
  await page.locator(".routine-popover-item:not(.active)").first().click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
  await page.click("#routine-label");
  await page.locator('.routine-popover-item[data-id="2026-W22-Phase-2-Week-3-Reentry"]').click();
  await expect(page.locator(".ex-card").first()).toBeVisible();

  // The in-progress edit must survive the routine round-trip.
  await expect(weight()).toHaveValue("137");
});
