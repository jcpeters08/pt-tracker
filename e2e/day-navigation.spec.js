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

test("Bug 2: tapping a prior day shows the actual logged session — even a catch-up done on a different date", async ({ page, context }) => {
  await signIn(page, context);
  await page.fill("#workout-date", "2026-05-27");          // a Wed inside the W22 week
  await page.dispatchEvent("#workout-date", "change");
  await expect(page.locator("#app")).toBeVisible();

  // Tap Monday. W22's Monday Push was actually performed on Thu 5/28 (a catch-up),
  // not on its nominal Monday date — so the exact (date|day|type) lookup misses
  // and this exercises the day-of-week fallback. Before the fix it showed defaults.
  await page.locator("#day-toggle .day-pill").nth(0).click();   // Monday
  await expect(page.locator(".ex-card").first()).toBeVisible();

  // The logged session must be detected: "✓ Logged" status + a pre-filled Done set.
  await expect(page.locator("#log-status")).toBeVisible();
  await expect(page.locator("#log-status")).toContainText(/Logged|Submitted/);
  await expect(page.locator(".ex-card .set-row.done").first()).toBeVisible();
});

test("Bug 2 regression: submitting a catch-up view preserves the actual logged date", async ({ page, context }) => {
  let appended = null;
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });
  await page.fill("#workout-date", "2026-05-27");
  await page.dispatchEvent("#workout-date", "change");

  await page.locator("#day-toggle .day-pill").nth(0).click();   // Monday catch-up logged on Thu 5/28
  await expect(page.locator(".ex-card .set-row.done").first()).toBeVisible();
  await page.click("#submit-btn");

  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  expect(appended.session.date).toBe("2026-05-28");
  expect(appended.session.day_of_week).toBe("monday");
  expect(appended.session.type).toBe("push");
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

test("Bug 1 regression: switching workout days and back keeps in-progress Done sets", async ({ page, context }) => {
  await signIn(page, context);
  await page.fill("#workout-date", "2026-06-08");
  await page.dispatchEvent("#workout-date", "change");

  await page.locator("#day-toggle .day-pill").nth(0).click();   // Monday Push
  const firstCard = page.locator(".ex-card").first();
  const firstSet = firstCard.locator(".set-row[data-set='0']");
  await expect(firstSet.locator("input[data-field='weight']")).toHaveValue("40");
  await firstSet.locator("input[data-field='reps']").fill("12");
  await firstSet.locator("input[data-field='reps']").dispatchEvent("input");
  await firstSet.locator("[data-action='done']").click();
  await expect(firstSet).toHaveClass(/done/);

  await page.locator("#day-toggle .day-pill").nth(1).click();   // Tuesday Pull
  await expect(page.locator(".ex-card").first().locator("h3")).toContainText("Lat Pulldown");
  await page.locator("#day-toggle .day-pill").nth(0).click();   // back to Monday Push

  const restoredSet = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await expect(restoredSet.locator("input[data-field='weight']")).toHaveValue("40");
  await expect(restoredSet.locator("input[data-field='reps']")).toHaveValue("12");
  await expect(restoredSet).toHaveClass(/done/);
});

test("PF target defaults use authored pounds for set inputs and pending payloads", async ({ page, context }) => {
  let appended = null;
  await context.route(/\/data\/pending\.json/, route => {
    return route.fulfill({ json: { entries: [] } });
  });
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });
  await page.fill("#workout-date", "2026-06-01");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(0).click();   // Monday Push

  const tricepsCard = page.locator(".ex-card").filter({
    has: page.locator("h3", { hasText: "Rope Tricep Pushdown" }),
  });
  const tricepsWeights = tricepsCard.locator("input[data-field='weight']");
  await expect(tricepsWeights.nth(0)).toHaveValue("25");
  await expect(tricepsWeights.nth(1)).toHaveValue("25");
  await expect(tricepsWeights.nth(2)).toHaveValue("25");

  await tricepsCard.locator(".set-row[data-set='0'] [data-action='done']").click();
  await page.click("#submit-btn");

  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  const triceps = appended.session.exercises.find(e => e.exercise_id === "rope-tricep-pushdown");
  expect(triceps.sets[0].weight_kg).toBeCloseTo(11.34, 2);
});
