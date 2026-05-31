import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// Exercises the render + submit path end-to-end: day view → set inputs → Done
// → submit, asserting the queued pending payload. This is the coverage that
// makes a future workout/render module split validatable.
test("logging a workout queues a correct log payload", async ({ page, context }) => {
  let put = null;
  page.on("dialog", d => d.accept()); // accept any submit confirm
  await signIn(page, context, { onPendingPut: (json) => { put = json; } });

  // Deterministic: W22 Monday (a real Push day with exercises).
  await page.fill("#workout-date", "2026-05-25");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click();

  const card = page.locator(".ex-card").first();
  await expect(card).toBeVisible();
  const set0 = card.locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='weight']").fill("20");
  await set0.locator("input[data-field='reps']").fill("10");
  await set0.locator("button[data-action='done']").click();
  await expect(set0).toHaveClass(/done/);

  await page.click("#submit-btn");

  await expect.poll(() => put, { timeout: 10_000 }).not.toBeNull();
  const logEntry = (put.entries || []).find(e => e.type === "log");
  expect(logEntry, "a log entry was queued").toBeTruthy();
  expect(logEntry.session.date).toBe("2026-05-25");
  expect(logEntry.session.exercises.length).toBeGreaterThan(0);
  const ex = logEntry.session.exercises[0];
  expect(ex.sets.length).toBeGreaterThan(0);
  expect(ex.sets[0]).toMatchObject({ set: 1, reps: 10 });
  expect(ex.sets[0].weight_kg).toBeGreaterThan(0); // 20 lbs stored as kg
});
