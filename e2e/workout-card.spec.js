import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
});

// Coverage for the interactive branches of the workout day view that a
// renderExerciseCard / renderCooldown extraction will touch (beyond the
// happy-path set-fill+submit already in workout.spec.js).
async function openPlannedDay(page) {
  await page.fill("#workout-date", "2026-05-25"); // W22 Monday (Push), current under the frozen clock
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
}

async function openFirstWaveDay(page) {
  await page.fill("#workout-date", "2026-08-30");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(6).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
}

test("token replacement is unavailable before sign-in", async ({ page, context }) => {
  await page.goto("/index.html");
  await expect(page.locator("#signin-panel")).toBeVisible();
  await expect(page.locator("#replace-token-btn")).toBeHidden();
  await expect(page.locator("#pat-panel")).toBeHidden();

  await signIn(page, context);
  await expect(page.locator("#replace-token-btn")).toBeVisible();
});

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
  let appended = null;
  page.on("dialog", d => d.accept());
  await signIn(page, context, { onPendingAppend: (entry) => { appended = entry; } });
  await openPlannedDay(page); // W22 is current under the frozen clock → target line is editable

  const tl = page.locator(".ex-card .target-line").first();
  await tl.click();
  const editor = tl.locator(".target-editor");
  await expect(editor).toBeVisible();
  await editor.locator("input[data-field='reps']").fill("8");
  await editor.locator("input[data-field='sets']").fill("4");
  await editor.locator(".editor-btn.save").click();

  await expect.poll(() => appended, { timeout: 10_000 }).not.toBeNull();
  const edit = appended;
  expect(edit, "a routine_edit entry was queued").toBeTruthy();
  expect(edit.type).toBe("routine_edit");
  expect(edit.exercise_id).toBeTruthy();
  expect(edit.changes.target_reps).toBe(8);
  expect(edit.changes.target_sets).toBe(4);
});

test("first wave: workout controls form one accessible mobile flow", async ({ page, context }, testInfo) => {
  await freezeAppTime(page, "2026-08-30T12:00:00-05:00");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, context);
  await openFirstWaveDay(page);

  await expect(page.locator("#submit-row > #rest-bar-host .rest-bar")).toBeVisible();
  await expect(page.locator("#workout-top-actions > #skip-btn")).toBeVisible();
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveJSProperty("tagName", "BUTTON");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", "Start 120-second rest timer");
  await expect(page.locator("#rest-bar-host .rest-chip[aria-pressed='true']")).toHaveCount(1);
  await expect(page.locator("#session-progress")).toContainText(/0\/\d+ exercises · 0\/\d+ sets/);
  await expect(page.locator(".ex-card .previous-line").first()).toContainText(/Last Push · Aug \d+:/);
  await expect(page.locator(".dock-sync-copy")).toHaveText("Saves to GitHub now. Syncs to your vault overnight.");
  await expect(page.locator("#exercises-host a[href*='muscleandstrength.com']").first()).toBeVisible();

  const hitTargets = page.locator("#rest-bar-host button, #submit-btn, #skip-btn, #reports-link, #replace-token-btn, #unit-toggle button, #signout-btn");
  for (let index = 0; index < await hitTargets.count(); index += 1) {
    const box = await hitTargets.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  await expect(page.locator("header.app a[href='reports.html']")).toHaveCount(1);
  await expect(page.locator("#replace-token-btn")).toBeVisible();
  await expect(page.locator("header.app a[href*='muscleandstrength.com']")).toHaveCount(0);

  const progressBefore = await page.locator("#session-progress").textContent();
  await page.locator(".ex-card [data-action='done']").first().click();
  await expect(page.locator("#session-progress")).not.toHaveText(progressBefore || "");
  await expect(page.locator("#rest-status-live")).toHaveText("Rest started");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);

  const setsBeforeAdd = Number((await page.locator("#session-progress").textContent())?.match(/\/(\d+) sets$/)?.[1]);
  await page.locator(".ex-card [data-action='add-set']").first().click();
  await expect.poll(async () => Number((await page.locator("#session-progress").textContent())?.match(/\/(\d+) sets$/)?.[1]))
    .toBe(setsBeforeAdd + 1);

  const storedEnd = await page.evaluate(() => JSON.parse(localStorage.getItem("pt_tracker_rest_timer_v1")).endsAtMs);
  await page.locator("#day-toggle .day-pill.rest").first().click();
  await expect(page.locator("#submit-row")).toBeHidden();
  await expect(page.locator("#workout-top-actions")).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pt_tracker_rest_timer_v1")).endsAtMs)).toBe(storedEnd);
  await page.locator("#day-toggle .day-pill").nth(6).click();
  await expect(page.locator("#submit-row")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pt_tracker_rest_timer_v1")).endsAtMs)).toBe(storedEnd);

  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest stopped");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", "Start 120-second rest timer");
  expect(await page.evaluate(() => localStorage.getItem("pt_tracker_rest_timer_v1"))).toBeNull();

  await page.locator("#rest-bar-host .rest-time").click();
  await page.clock.setFixedTime("2026-08-30T12:03:00-05:00");
  await expect(page.locator("#rest-status-live")).toHaveText("Rest complete");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveText("GO");
  expect(await page.evaluate(() => localStorage.getItem("pt_tracker_rest_timer_v1"))).toBeNull();

  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest started");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);
  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest stopped");

  await page.locator("#session-notes-input").scrollIntoViewIfNeeded();
  const notesBox = await page.locator("#session-notes-input").boundingBox();
  const notesDockBox = await page.locator("#submit-row").boundingBox();
  expect((notesBox?.y || 0) + (notesBox?.height || 0)).toBeLessThanOrEqual((notesDockBox?.y || 0) - 8);

  await page.evaluate(async () => {
    const { toast } = await import("/js/ui.js");
    toast("Dock clearance", "ok");
  });
  const toastBox = await page.locator("#toast").boundingBox();
  const toastDockBox = await page.locator("#submit-row").boundingBox();
  expect((toastBox?.y || 0) + (toastBox?.height || 0)).toBeLessThanOrEqual((toastDockBox?.y || 0) - 8);

  await page.locator("#rec-head").click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const recoveryBox = await page.locator("#rec-submit-btn").boundingBox();
  const recoveryDockBox = await page.locator("#submit-row").boundingBox();
  expect((recoveryBox?.y || 0) + (recoveryBox?.height || 0)).toBeLessThanOrEqual((recoveryDockBox?.y || 0) - 8);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator("#skip-btn")).toBeVisible();
  const skipTop = await page.locator("#skip-btn").evaluate(element => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollBy(0, 500));
  const skipAfter = await page.locator("#skip-btn").evaluate(element => element.getBoundingClientRect().top);
  expect(skipAfter).toBeLessThan(skipTop - 300);

  const dockBefore = await page.locator("#submit-row").boundingBox();
  await page.evaluate(() => window.scrollBy(0, 250));
  const dockAfter = await page.locator("#submit-row").boundingBox();
  expect(Math.abs((dockAfter?.y || 0) - (dockBefore?.y || 0))).toBeLessThan(3);
  expect(Math.abs(((dockAfter?.y || 0) + (dockAfter?.height || 0)) - 844)).toBeLessThan(3);

  await testInfo.attach("first-wave-mobile-dock", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });

  await page.locator("#replace-token-btn").click();
  await expect(page.locator("#pat-panel")).toBeVisible();
  await expect(page.locator("#pat-input")).toBeFocused();
  await page.locator("#pat-cancel").click();
  await expect(page.locator("#replace-token-btn")).toBeFocused();

  await page.locator("#replace-token-btn").click();
  await page.locator("#pat-input").fill("github_pat_e2e");
  await page.locator("#pat-save").click();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#replace-token-btn")).toBeFocused();

  await page.locator("#day-toggle .day-pill.rest").first().click();
  await expect(page.locator("#submit-row")).toBeHidden();
  await expect(page.locator("#workout-top-actions")).toBeHidden();

  await page.locator("#day-toggle .day-pill").nth(3).click();
  await expect(page.locator("#cooldown-card .cd-duration")).toContainText("Legs-day cooldown");
  await page.locator("#cd-complete-btn").click();
  expect(await page.evaluate(async () => {
    const { state } = await import("/js/app-context.js");
    return state.cooldownLog?.["2026-08-30|thursday"]?.source_key;
  })).toBe("legs");
});

test("first wave: a live rest timer resumes from its stored end after reload", async ({ page, context }) => {
  await freezeAppTime(page, "2026-08-30T12:00:00-05:00");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, context);
  await openFirstWaveDay(page);
  await page.locator(".ex-card [data-action='done']").first().click();
  await page.evaluate(() => {
    const key = "pt_tracker_rest_timer_v1";
    const timer = JSON.parse(localStorage.getItem(key));
    timer.endsAtMs = Date.now() + 45000;
    timer.durationSec = 90;
    localStorage.setItem(key, JSON.stringify(timer));
    localStorage.setItem("pt_tracker_rest_duration_v1", "120");
  });

  await page.reload();
  await expect(page.locator("#app")).toBeVisible({ timeout: 15000 });
  await openFirstWaveDay(page);

  await expect(page.locator("#rest-bar-host .rest-time")).toHaveText(/0:4[45]/);
  await expect(page.locator("#rest-bar-host .rest-chip[data-seconds='90']")).toHaveAttribute("aria-pressed", "true");
});

test("first wave: history context respects routine mode", async ({ page, context }) => {
  await freezeAppTime(page, "2026-08-29T12:00:00-05:00");
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, context);

  await page.fill("#workout-date", "2026-08-30");
  await page.dispatchEvent("#workout-date", "change");
  await expect(page.locator("body")).toHaveClass(/mode-upcoming/);
  await page.locator("#day-toggle .day-pill").nth(6).click();
  await expect(page.locator(".ex-card .previous-line").first()).toContainText(/Last Push · Aug \d+:/);
  await expect(page.locator("#submit-row")).toBeHidden();
  await expect(page.locator("#workout-top-actions")).toBeHidden();

  await page.fill("#workout-date", "2026-08-23");
  await page.dispatchEvent("#workout-date", "change");
  await expect(page.locator("body")).toHaveClass(/mode-past/);
  await page.locator("#day-toggle .day-pill:not(.rest)").first().click();
  await expect(page.locator(".ex-card .previous-line")).toHaveCount(0);
  await expect(page.locator("#submit-row")).toBeHidden();
  await expect(page.locator("#workout-top-actions")).toBeHidden();
  await expect(page.locator("#workout-date")).toBeEnabled();
  await expect(page.locator("#unit-toggle button[data-unit='kg']")).toBeEnabled();
  await page.locator("#unit-toggle button[data-unit='kg']").click();
  await expect(page.locator("#unit-toggle button[data-unit='kg']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#unit-toggle button[data-unit='lbs']")).toHaveAttribute("aria-pressed", "false");
});

test("first wave: the dock and header reflow across supported mobile viewports", async ({ page, context }, testInfo) => {
  await freezeAppTime(page, "2026-08-30T12:00:00-05:00");
  await signIn(page, context);
  await openFirstWaveDay(page);

  const viewports = [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 667, height: 375 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const initial = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      headerBottom: document.querySelector("header.app")?.getBoundingClientRect().bottom || 0,
      dockTop: document.querySelector("#submit-row")?.getBoundingClientRect().top || 0,
    }));
    expect(initial.documentWidth).toBeLessThanOrEqual(initial.viewportWidth);
    expect(initial.dockTop).toBeGreaterThanOrEqual(initial.headerBottom);

    const controls = page.locator("#rest-bar-host button, #submit-btn, #skip-btn, #reports-link, #replace-token-btn, #unit-toggle button, #signout-btn");
    for (let index = 0; index < await controls.count(); index += 1) {
      const box = await controls.nth(index).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await page.evaluate(() => window.scrollTo(0, 400));
    const pinnedBefore = await page.locator("#submit-row").boundingBox();
    expect(Math.abs(((pinnedBefore?.y || 0) + (pinnedBefore?.height || 0)) - viewport.height)).toBeLessThan(3);
    await page.evaluate(() => window.scrollBy(0, 120));
    const pinnedAfter = await page.locator("#submit-row").boundingBox();
    expect(Math.abs((pinnedAfter?.y || 0) - (pinnedBefore?.y || 0))).toBeLessThan(3);

    await testInfo.attach(`first-wave-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });
  }

  // A 195×422 CSS viewport is the effective layout viewport of the
  // 390×844 target at 200% browser zoom. At this extreme size the dock may
  // become static, but every control and all content must remain operable.
  await page.setViewportSize({ width: 195, height: 422 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(195);
  await page.locator("#unit-toggle button[data-unit='kg']").click();
  await expect(page.locator("#unit-toggle button[data-unit='kg']")).toHaveAttribute("aria-pressed", "true");
  await testInfo.attach("first-wave-effective-200-percent-header", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });

  await page.locator("#submit-row").scrollIntoViewIfNeeded();
  const zoomControls = page.locator("#rest-bar-host button, #submit-btn, #skip-btn, #reports-link, #replace-token-btn, #unit-toggle button, #signout-btn");
  for (let index = 0; index < await zoomControls.count(); index += 1) {
    const box = await zoomControls.nth(index).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest started");
  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest stopped");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(195);
  await testInfo.attach("first-wave-effective-200-percent-dock", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
});
