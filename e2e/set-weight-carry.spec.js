import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

// Regression (W47, 2026-11-17..20): changing set 1's weight left sets 2–3 on
// the seeded routine target, so tapping Done on them without retyping
// submitted weights Jonathan never lifted (lateral raise 10/15/15 lbs for a
// real 10/10/10). A set-weight edit now fills down to later sets still on
// their seeded weight; a set the user typed a weight into is never rewritten.

const lbsToKg2 = lbs => Math.round(lbs * 0.45359237 * 100) / 100;

async function openUnloggedPullDay(page) {
  // W24 Tuesday Pull (2026-06-09) has no synced log; lat pulldown is the
  // first card, seeded 110 lbs × 8 × 3.
  await page.fill("#workout-date", "2026-06-09");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();
  const card = page.locator(".ex-card[data-exid='lat-pulldown']");
  await expect(card).toBeVisible();
  return card;
}

const weightInput = (card, i) => card.locator(`.set-row[data-set='${i}'] input[data-field='weight']`);
const doneButton = (card, i) => card.locator(`.set-row[data-set='${i}'] [data-action='done']`);

async function submitAndCapture(page, getAppended) {
  await page.click("#submit-btn");
  await expect.poll(getAppended, { timeout: 10_000 }).not.toBeNull();
  const entry = getAppended();
  return entry.session.exercises.find(e => e.exercise_id === "lat-pulldown");
}

test.beforeEach(async ({ page, context }) => {
  await context.route(/\/data\/pending\.json/, route => route.fulfill({ json: { entries: [] } }));
  page.on("dialog", d => d.accept());
  await freezeAppTime(page, "2026-06-10T12:00:00-05:00");   // W24 current
});

test("a set-1 weight edit carries to sets 2–3, which then submit the lifted weight", async ({ page, context }) => {
  let appended = null;
  await signIn(page, context, { onPendingAppend: entry => { appended = entry; } });
  const card = await openUnloggedPullDay(page);
  await expect(weightInput(card, 1)).toHaveValue("110");

  await weightInput(card, 0).fill("120");
  await expect(weightInput(card, 1)).toHaveValue("120");
  await expect(weightInput(card, 2)).toHaveValue("120");

  // Done on every set, never retyping sets 2–3.
  for (const i of [0, 1, 2]) await doneButton(card, i).click();

  const ex = await submitAndCapture(page, () => appended);
  expect(ex.sets.map(s => s.weight_kg)).toEqual([lbsToKg2(120), lbsToKg2(120), lbsToKg2(120)]);
  expect(ex.sets.map(s => s.reps)).toEqual([8, 8, 8]);
});

test("a later set the user typed a weight into is kept, also across a reload", async ({ page, context }) => {
  let appended = null;
  await signIn(page, context, { onPendingAppend: entry => { appended = entry; } });
  let card = await openUnloggedPullDay(page);

  // Set 3 typed first; the edited flag must survive the draft round trip.
  await weightInput(card, 2).fill("130");
  await page.reload();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15_000 });
  card = await openUnloggedPullDay(page);
  await expect(weightInput(card, 2)).toHaveValue("130");

  await weightInput(card, 0).fill("100");
  await expect(weightInput(card, 1)).toHaveValue("100");
  await expect(weightInput(card, 2)).toHaveValue("130");

  for (const i of [0, 1, 2]) await doneButton(card, i).click();

  const ex = await submitAndCapture(page, () => appended);
  expect(ex.sets.map(s => s.weight_kg)).toEqual([lbsToKg2(100), lbsToKg2(100), lbsToKg2(130)]);
});
