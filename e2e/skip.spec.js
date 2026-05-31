import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

// End-to-end guard for P1.1: a Skip must use the SELECTED workout date,
// not today. Set a non-today date, skip a planned day, and assert the
// confirmation (which reads the same dateStr the payload uses) shows it.
test("skip uses the selected workout date, not today (P1.1)", async ({ page, context }) => {
  await signIn(page, context);

  const SELECTED = "2026-05-18"; // non-today; W21 Monday (a real planned workout)
  await page.fill("#workout-date", SELECTED);
  await page.dispatchEvent("#workout-date", "change");

  // Select a planned (non-rest) day so the skip control is meaningful.
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click();
  await expect(page.locator("#skip-btn")).toBeVisible();

  // Capture the confirm() dialog and cancel it (no real write).
  let dialogMsg = "";
  page.once("dialog", d => { dialogMsg = d.message(); d.dismiss(); });
  await page.click("#skip-btn");

  await expect.poll(() => dialogMsg).toContain(SELECTED);
  // And definitely not today's date.
  expect(dialogMsg).not.toContain(new Date().toISOString().slice(0, 10));
});
