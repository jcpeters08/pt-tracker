import { test, expect } from "@playwright/test";
import { signIn } from "./helpers.js";

test("sign-in reaches the authenticated app and renders without fatal errors", async ({ page, context }) => {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await signIn(page, context);

  await expect(page.locator("#signin-panel")).toBeHidden();
  await expect(page.locator("#signout-btn")).toBeVisible();
  // App shell has real content (routine loaded from the served data files).
  expect((await page.locator("#app").innerText()).trim().length).toBeGreaterThan(0);

  // No module/reference regressions (the kind a bad module extraction causes).
  const fatal = errors.filter(e => /is not defined|ReferenceError|SyntaxError|Failed to (load|fetch).*module|Unexpected/i.test(e));
  expect(fatal, `fatal JS errors:\n${fatal.join("\n")}`).toEqual([]);
});
