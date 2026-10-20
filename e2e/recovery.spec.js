import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// Drives the recovery panel render + submit: expand panel, set date, fill the
// first round, submit; asserts the queued recovery payload is internally
// consistent and reflects the entered values. Coverage for a future recovery
// render-module split. (The panel seeds 3 default rounds via ensureRecoveryRounds.)
test("logging recovery queues a correct recovery payload", async ({ page, context }) => {
  let appended = null;
  page.on("dialog", d => d.accept());
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });

  await page.click("#rec-head"); // panel starts collapsed
  await expect(page.locator("#rec-date")).toBeVisible();
  await page.fill("#rec-date", "2026-05-31");
  await page.dispatchEvent("#rec-date", "change");

  const r0 = page.locator("#rec-rounds-host .round-row[data-idx='0']");
  await r0.locator("input[data-field='sauna']").fill("18");
  await r0.locator("input[data-field='plunge']").fill("4");

  await page.click("#rec-submit-btn");

  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  const rec = appended;
  expect(rec, "a recovery entry was queued").toBeTruthy();
  expect(rec.type).toBe("recovery");
  expect(rec.session.date).toBe("2026-05-31");

  const detail = rec.session.rounds_detail;
  expect(Array.isArray(detail)).toBe(true);
  expect(detail.length).toBe(rec.session.rounds);      // counts agree
  expect(detail[0]).toMatchObject({ sauna_min: 18, plunge_min: 4 }); // entered values
  const total = detail.reduce((s, r) => s + (r.sauna_min || 0) + (r.plunge_min || 0), 0);
  expect(rec.session.total_min).toBe(total);           // total matches detail
});

// Regression: changing the recovery date used to run markRecoveryDirty() →
// saveRecoveryDraft() while #rec-date already held the NEW date and the inputs
// still held the OLD values, so the new date's draft slot was overwritten (old
// notes, no rounds) or deleted, and the old notes rode along into the new day.
test("changing the recovery date never clobbers another date's draft, and notes follow the date", async ({ page, context }) => {
  await signIn(page, context);
  await page.click("#rec-head");
  await expect(page.locator("#rec-date")).toBeVisible();

  // Draft for 2026-05-31: a round + notes.
  await page.fill("#rec-date", "2026-05-31");
  await page.dispatchEvent("#rec-date", "change");
  const r0 = page.locator("#rec-rounds-host .round-row[data-idx='0']");
  await r0.locator("input[data-field='sauna']").fill("18");
  await page.fill("#rec-notes", "two rounds, felt great");
  await page.dispatchEvent("#rec-notes", "input");
  const key31 = "pt_tracker_recovery_draft_v1:2026-05-31";
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), key31)).toContain("felt great");

  // Switch to 2026-05-30: the 05-31 draft must be intact, no 05-30 draft may
  // appear from the switch alone, and the notes field must be empty.
  await page.fill("#rec-date", "2026-05-30");
  await page.dispatchEvent("#rec-date", "change");
  const key30 = "pt_tracker_recovery_draft_v1:2026-05-30";
  expect(await page.evaluate(k => localStorage.getItem(k), key31)).toContain("felt great");
  expect(await page.evaluate(k => localStorage.getItem(k), key30)).toBeNull();
  await expect(page.locator("#rec-notes")).toHaveValue("");

  // Now draft something for 05-30, then go back: each date keeps its own.
  await page.fill("#rec-notes", "short sauna only");
  await page.dispatchEvent("#rec-notes", "input");
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), key30)).toContain("short sauna only");
  await page.fill("#rec-date", "2026-05-31");
  await page.dispatchEvent("#rec-date", "change");
  await expect(page.locator("#rec-notes")).toHaveValue("two rounds, felt great");
  await expect(r0.locator("input[data-field='sauna']")).toHaveValue("18");
  expect(await page.evaluate(k => localStorage.getItem(k), key30)).toContain("short sauna only");
});
