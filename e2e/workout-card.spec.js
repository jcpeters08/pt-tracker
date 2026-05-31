import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// Coverage for the interactive branches of the workout day view that a
// renderExerciseCard / renderCooldown extraction will touch (beyond the
// happy-path set-fill+submit already in workout.spec.js).
async function openPlannedDay(page) {
  await page.fill("#workout-date", "2026-05-25"); // W22 Monday (Push)
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
}

test("add-set appends a working set row to an exercise card", async ({ page, context }) => {
  await signIn(page, context);
  await openPlannedDay(page);
  const card = page.locator(".ex-card").first();
  const before = await card.locator(".set-row[data-set]").count();
  await card.locator("[data-action='add-set']").click();
  await expect(card.locator(".set-row[data-set]")).toHaveCount(before + 1);
});

test("how-to pill opens the exercise modal with content", async ({ page, context }) => {
  await signIn(page, context);
  await openPlannedDay(page);
  await page.locator(".ex-card .pill[data-action='show-howto']").first().click();
  await expect(page.locator("#howto-modal")).toHaveClass(/show/);
  await expect(page.locator("#ht-title")).not.toBeEmpty();
  await expect(page.locator("#ht-body")).not.toBeEmpty();
});

test("cooldown tab switches to Apple Fitness+", async ({ page, context }) => {
  await signIn(page, context);
  await openPlannedDay(page);
  const fp = page.locator(".cd-tab[data-choice='fitnessplus']").first();
  await expect(fp).toBeVisible();
  await fp.click();
  await expect(fp).toHaveClass(/active/);
});

test("editing a target queues a routine_edit payload", async ({ page, context }) => {
  let put = null;
  page.on("dialog", d => d.accept());
  await signIn(page, context, { onPendingPut: (json) => { put = json; } });
  await openPlannedDay(page); // W22 is the current routine today → target line is editable

  const tl = page.locator(".ex-card .target-line").first();
  await tl.click();
  const editor = tl.locator(".target-editor");
  await expect(editor).toBeVisible();
  await editor.locator("input[data-field='reps']").fill("8");
  await editor.locator("input[data-field='sets']").fill("4");
  await editor.locator(".editor-btn.save").click();

  await expect.poll(() => put, { timeout: 10_000 }).not.toBeNull();
  const edit = (put.entries || []).find(e => e.type === "routine_edit");
  expect(edit, "a routine_edit entry was queued").toBeTruthy();
  expect(edit.exercise_id).toBeTruthy();
  expect(edit.changes.target_reps).toBe(8);
  expect(edit.changes.target_sets).toBe(4);
});
