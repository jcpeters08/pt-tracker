import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// Drives the recovery panel render + submit: expand panel, set date, fill the
// first round, submit; asserts the queued recovery payload is internally
// consistent and reflects the entered values. Coverage for a future recovery
// render-module split. (The panel seeds 3 default rounds via ensureRecoveryRounds.)
test("logging recovery queues a correct recovery payload", async ({ page, context }) => {
  let put = null;
  page.on("dialog", d => d.accept());
  await signIn(page, context, { onPendingPut: (json) => { put = json; } });

  await page.click("#rec-head"); // panel starts collapsed
  await expect(page.locator("#rec-date")).toBeVisible();
  await page.fill("#rec-date", "2026-05-31");
  await page.dispatchEvent("#rec-date", "change");

  const r0 = page.locator("#rec-rounds-host .round-row[data-idx='0']");
  await r0.locator("input[data-field='sauna']").fill("18");
  await r0.locator("input[data-field='plunge']").fill("4");

  await page.click("#rec-submit-btn");

  await expect.poll(() => put, { timeout: 10_000 }).not.toBeNull();
  const rec = (put.entries || []).find(e => e.type === "recovery");
  expect(rec, "a recovery entry was queued").toBeTruthy();
  expect(rec.session.date).toBe("2026-05-31");

  const detail = rec.session.rounds_detail;
  expect(Array.isArray(detail)).toBe(true);
  expect(detail.length).toBe(rec.session.rounds);      // counts agree
  expect(detail[0]).toMatchObject({ sauna_min: 18, plunge_min: 4 }); // entered values
  const total = detail.reduce((s, r) => s + (r.sauna_min || 0) + (r.plunge_min || 0), 0);
  expect(rec.session.total_min).toBe(total);           // total matches detail
});
