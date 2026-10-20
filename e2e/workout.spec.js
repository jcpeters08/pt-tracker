import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

// Exercises the render + submit path end-to-end: day view → set inputs → Done
// → submit, asserting the queued pending payload. This is the coverage that
// makes a future workout/render module split validatable.
test("logging a workout queues a correct log payload", async ({ page, context }) => {
  let appended = null;
  page.on("dialog", d => d.accept()); // accept any submit confirm
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });

  // Deterministic: W22 Tuesday is a real Pull day in the frozen current window.
  await page.fill("#workout-date", "2026-05-26");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();

  const card = page.locator(".ex-card").first();
  await expect(card).toBeVisible();
  const set0 = card.locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='weight']").fill("20");
  await set0.locator("input[data-field='reps']").fill("10");
  await expect(set0).toHaveClass(/done/);

  await page.click("#submit-btn");

  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  const logEntry = appended;
  expect(logEntry, "a log entry was queued").toBeTruthy();
  expect(logEntry.type).toBe("log");
  expect(logEntry.session.date).toBe("2026-05-26");
  expect(logEntry.session.exercises.length).toBeGreaterThan(0);
  const ex = logEntry.session.exercises[0];
  expect(ex.sets.length).toBeGreaterThan(0);
  expect(ex.sets[0]).toMatchObject({ set: 1, reps: 10 });
  expect(ex.sets[0].weight_kg).toBeGreaterThan(0); // 20 lbs stored as kg
});

// Regression: after a successful submit the cards stayed bound to the detached
// pre-submit log objects for ~1.8s; an edit in that window was saved into the
// wrong object and then discarded by the delayed re-render.
test("an edit made right after submitting is kept", async ({ page, context }) => {
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await signIn(page, context);
  await page.fill("#workout-date", "2026-05-26");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();
  const set0 = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='reps']").fill("10");
  await page.click("#submit-btn");
  await expect(page.locator("#submit-btn")).toHaveText(/Submitted/);
  // The app clock is frozen; a real clock has moved on by now, and the draft
  // written by the edit below must be NEWER than the submission to be kept.
  await page.clock.setFixedTime("2026-05-30T12:00:05-05:00");

  // Edit immediately (well inside the old 1.8s window), then wait it out.
  const reps = page.locator(".ex-card").first().locator(".set-row[data-set='0'] input[data-field='reps']");
  await reps.fill("7");
  await page.waitForTimeout(2200);
  await expect(reps).toHaveValue("7");
  await expect(page.locator("#submit-btn")).toHaveText("Submit session");
  const drafts = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("pt_tracker_draft_v2:")));
  expect(drafts.length, "the post-submit edit is persisted as a draft").toBeGreaterThan(0);
});

// Regression: a Done set with a blank reps (or weight) field was silently
// dropped from the payload while the progress line still counted it.
test("submitting with a Done set that has no reps is refused, not silently dropped", async ({ page, context }) => {
  let appended = null;
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });
  await page.fill("#workout-date", "2026-05-26");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();
  const card = page.locator(".ex-card").first();
  const set0 = card.locator(".set-row[data-set='0']");
  await expect(set0).toHaveClass(/done/);               // logged day → sets are Done
  await set0.locator("input[data-field='reps']").fill("");  // blank the reps
  await page.click("#submit-btn");
  await expect(page.locator("#toast")).toContainText(/set 1 is marked Done but has no reps/);
  await page.waitForTimeout(500);
  expect(appended, "nothing was queued").toBeNull();
  await expect(page.locator("#submit-btn")).toBeEnabled();
});
