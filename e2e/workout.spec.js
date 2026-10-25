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

// A just-submitted session must survive a relaunch inside the GitHub Pages
// deploy window: the Worker has committed the entry, but data/pending.json as
// served by Pages still lacks it for ~1–2 min. Before the fix the entry lived
// only in memory, so a reload showed the day as unlogged with routine defaults
// (inviting a duplicate submit). The route below pins pending.json to the
// pre-submit file to simulate that window.
test("a just-submitted session still shows as pending after a reload inside the deploy window", async ({ page, context }) => {
  await context.route(/\/data\/pending\.json/, route => route.fulfill({ json: { entries: [] } }));
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-06-10T12:00:00-05:00");   // W24 current
  await signIn(page, context);

  // W24 Tuesday Pull (2026-06-09) has no synced log → starts unlogged.
  const openTuesday = async () => {
    await page.fill("#workout-date", "2026-06-09");
    await page.dispatchEvent("#workout-date", "change");
    await page.locator("#day-toggle .day-pill").nth(1).click();
    await expect(page.locator(".ex-card").first()).toBeVisible();
  };
  await openTuesday();
  await expect(page.locator("#log-status")).toBeHidden();

  const set0 = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='weight']").fill("60");
  await set0.locator("input[data-field='reps']").fill("9");
  await set0.locator("[data-action='done']").click();
  await expect(set0).toHaveClass(/done/);
  await page.click("#submit-btn");
  await expect(page.locator("#log-status")).toHaveText("● Submitted (pending sync)");

  // Relaunch: pending.json still returns the old (empty) file.
  await page.reload();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
  await openTuesday();
  await expect(page.locator("#log-status")).toHaveText("● Submitted (pending sync)");
  await expect(page.locator(".ex-card").first().locator(".set-row[data-set='0'] input[data-field='reps']")).toHaveValue("9");
});

// Regression (2026-10-24): a day logged under one date and never submitted was
// invisible when reopened later, because drafts are keyed by the date that was
// selected at the time and the picker defaults to today. The app now rescues
// the same-slot draft from inside the routine week, switches the view to its
// real date, says so, and submits it on that date.
test("an unsubmitted day logged under an earlier date is rescued when its pill is reopened", async ({ page, context }) => {
  let appended = null;
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-06-10T12:00:00-05:00");   // W24 current; Tue 06-09 has no synced log
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });
  const openTuesday = async () => {
    await page.locator("#day-toggle .day-pill").nth(1).click();
    await expect(page.locator(".ex-card").first()).toBeVisible();
  };
  // Log a set on Tuesday 06-09 and walk away without submitting.
  await page.fill("#workout-date", "2026-06-09");
  await page.dispatchEvent("#workout-date", "change");
  await openTuesday();
  const set0 = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await set0.locator("input[data-field='weight']").fill("60");
  await set0.locator("input[data-field='reps']").fill("9");
  await set0.locator("[data-action='done']").click();
  await expect(set0).toHaveClass(/done/);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes("|2026-06-09|tuesday|")).length)).toBe(1);

  // Come back "later": a relaunch puts the picker on today (06-10); tap the Tue pill.
  await page.reload();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#workout-date")).toHaveValue("2026-06-10");
  await openTuesday();
  await expect(page.locator("#workout-date")).toHaveValue("2026-06-09");
  await expect(page.locator(".draft-banner")).toContainText(/Unsubmitted workout from .*restored/);
  const restored = page.locator(".ex-card").first().locator(".set-row[data-set='0']");
  await expect(restored).toHaveClass(/done/);
  await expect(restored.locator("input[data-field='reps']")).toHaveValue("9");

  // Submitting writes the day it was actually logged.
  await page.click("#submit-btn");
  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  expect(appended.session.date).toBe("2026-06-09");
  expect(appended.session.day_of_week).toBe("tuesday");
  expect(appended.session.exercises[0].sets[0].reps).toBe(9);
});

test("a stale unsubmitted draft is announced at boot", async ({ page, context }) => {
  await freezeAppTime(page, "2026-06-12T12:00:00-05:00");
  await page.addInitScript(() => {
    localStorage.setItem("pt_tracker_draft_v2:2026-W24-Phase-2-Week-5|2026-06-09|tuesday|pull",
      JSON.stringify({ version: 1, last_modified_at: "2026-06-09T12:30:00-05:00", log: { "lat-pulldown": { sets: [{ weight_kg: 59, reps: 10, done: true }] } }, sessionNotes: "", cooldown: null }));
  });
  await signIn(page, context);
  await expect(page.locator("#toast")).toContainText(/Unsubmitted workout from Tue .* open that day and tap Submit/);
});
