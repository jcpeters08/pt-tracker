import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn, installFakeVisualViewport, setVisualViewport } from "./helpers.js";

// Regression coverage for the 2026-10-09 report: "That timer bar floats when
// you scroll up and down — it needs to be locked to the bottom." iOS WebKit
// computes `position: sticky` offsets from the document scroll position, which
// overshoots during rubber-band / momentum scrolling, so a sticky bottom dock
// visibly drifts. Chromium can't rubber-band, so this spec pins the properties
// that make the dock viewport-anchored instead: fixed positioning, a bottom
// edge that never moves across scroll positions (and when content is shorter
// than the viewport), reserved space so the last card is never hidden under
// the dock, and a running rest countdown that survives all of it.

const DOCK = "#submit-row";
const TIMER_KEY = "pt_tracker_rest_timer_v1";

async function openWorkoutDay(page) {
  // Deterministic: W22 Tuesday is a real Pull day in the frozen current window.
  await page.fill("#workout-date", "2026-05-26");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
  await expect(page.locator(`${DOCK} > #rest-bar-host .rest-bar`)).toBeVisible();
}

function dockMetrics(page) {
  return page.evaluate((sel) => {
    const dock = document.querySelector(sel);
    const rect = dock.getBoundingClientRect();
    return {
      position: getComputedStyle(dock).position,
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      scrollY: Math.round(window.scrollY),
      maxScrollY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    };
  }, DOCK);
}

async function scrollTo(page, y) {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  // Let sticky/fixed layout and ResizeObserver callbacks settle.
  await page.waitForTimeout(150);
}

test("workout dock stays locked to the viewport bottom while scrolling with a running rest timer", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, context);
  await openWorkoutDay(page);

  // Start a rest countdown so the dock is in its tallest, timer-running state.
  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest started");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);
  const storedEnd = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY);
  expect(storedEnd).toBeGreaterThan(0);

  const atTop = await dockMetrics(page);
  expect(atTop.position, "dock is anchored to the layout viewport, not the scroll offset").toBe("fixed");
  expect(atTop.bottom).toBe(atTop.innerHeight);
  expect(atTop.left).toBe(0);
  expect(atTop.right).toBe(atTop.innerWidth);
  expect(atTop.maxScrollY, "day view is long enough to scroll").toBeGreaterThan(atTop.innerHeight);

  // Scroll down, to the very bottom, back up, and down again: the dock's top
  // and bottom edges must not move at all.
  for (const y of [600, atTop.maxScrollY, 300, atTop.maxScrollY, 0]) {
    await scrollTo(page, y);
    const m = await dockMetrics(page);
    expect(m.scrollY, `scrolled to ${y}`).toBe(Math.min(y, m.maxScrollY));
    expect(m.position).toBe("fixed");
    expect(m.top, `dock top at scrollY=${y}`).toBe(atTop.top);
    expect(m.bottom, `dock bottom at scrollY=${y}`).toBe(m.innerHeight);
  }

  // At max scroll, the last in-flow content (session notes) clears the dock —
  // nothing is hidden underneath the fixed bar.
  await scrollTo(page, atTop.maxScrollY);
  const notesBottom = await page.evaluate(() => {
    const el = document.querySelector("#session-notes-input") || document.querySelector(".session-notes");
    return Math.round(el.getBoundingClientRect().bottom);
  });
  expect(notesBottom).toBeLessThanOrEqual(atTop.top);

  // The countdown kept running through every scroll + re-layout: the stored
  // end is untouched AND the displayed remainder actually goes down.
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY)).toBe(storedEnd);
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveText("2:00");
  await page.clock.setFixedTime("2026-05-30T12:00:07-05:00");
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveText("1:53");

  // Switching days re-renders around the static dock nodes; the running timer
  // must survive that too (pt_tracker_rest_timer_v1 is never cancelled by renders).
  await page.locator("#day-toggle .day-pill").nth(2).click();
  await page.locator("#day-toggle .day-pill").nth(1).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY)).toBe(storedEnd);
  const afterRender = await dockMetrics(page);
  expect(afterRender.position).toBe("fixed");
  expect(afterRender.bottom).toBe(afterRender.innerHeight);
});

test("every text field on the day view is at least 16px so iOS never auto-zooms on focus", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, context);
  await openWorkoutDay(page);
  await page.locator(".ex-card .target-line").first().click();   // opens the inline target editor
  await expect(page.locator(".target-editor input").first()).toBeVisible();
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#app input, #app textarea")) {
      if (["checkbox", "radio", "hidden", "range"].includes(el.type)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`${el.id || el.className || el.name || el.type}:${size}px`);
    }
    return out;
  });
  expect(small, "fields under 16px trigger the iOS focus auto-zoom").toEqual([]);
});

test("workout dock sits at the viewport bottom even when the day view is shorter than the viewport", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, context);
  await openWorkoutDay(page);

  // Make the viewport taller than the whole document (measured at phone
  // width): a sticky bottom element would settle at its in-flow position
  // mid-screen; a fixed one stays pinned.
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 375, height: docHeight + 400 });
  await page.waitForTimeout(150);

  const m = await dockMetrics(page);
  expect(m.maxScrollY).toBeLessThanOrEqual(0);
  expect(m.position).toBe("fixed");
  expect(m.bottom).toBe(m.innerHeight);
});

// Keyboard-up behaviour is driven through the fake visualViewport installed by
// installFakeVisualViewport / setVisualViewport in helpers.js.
function containerPaddingBottom(page) {
  return page.evaluate(() => getComputedStyle(document.querySelector(".container")).paddingBottom);
}

test("workout dock rides above the iOS keyboard, compacts to the timer, and drops back when it closes", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize({ width: 375, height: 812 });
  await installFakeVisualViewport(page);
  await signIn(page, context);
  await openWorkoutDay(page);
  await page.locator("#rest-bar-host .rest-time").click();
  await expect(page.locator("#rest-status-live")).toHaveText("Rest started");
  const storedEnd = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY);

  const closed = await dockMetrics(page);
  expect(closed.bottom).toBe(closed.innerHeight);
  const reserved = await containerPaddingBottom(page);
  expect(parseFloat(reserved)).toBeGreaterThan(100);

  // Keyboard opens: the visual viewport loses 300px at the bottom.
  await setVisualViewport(page, { height: 812 - 300 });
  await expect(page.locator("body")).toHaveClass(/keyboard-open/);
  let m = await dockMetrics(page);
  expect(m.bottom, "dock bottom sits on the visible edge above the keyboard").toBe(812 - 300);
  await expect(page.locator("#rest-bar-host .rest-bar")).toBeVisible();
  await expect(page.locator("#submit-btn")).toBeHidden();
  await expect(page.locator("#session-progress")).toBeHidden();
  expect(await containerPaddingBottom(page), "reserved content padding does not jump mid-entry").toBe(reserved);

  // Scrolling with the keyboard up: iOS slides the visual viewport inside the
  // layout viewport (offsetTop) — the dock must follow the visible edge.
  await setVisualViewport(page, { height: 812 - 300 - 40, offsetTop: 40 }, "scroll");
  m = await dockMetrics(page);
  expect(m.bottom).toBe(812 - 300);
  await expect(page.locator("#rest-bar-host .rest-bar")).toBeVisible();

  // Pinch-zoom also shrinks the visual viewport but is not a keyboard.
  await setVisualViewport(page, { height: 406, offsetTop: 100, scale: 2 });
  m = await dockMetrics(page);
  expect(m.bottom).toBe(812);

  // Keyboard closes: full dock returns to the viewport bottom.
  await setVisualViewport(page, { height: 812, offsetTop: 0 });
  await expect(page.locator("body")).not.toHaveClass(/keyboard-open/);
  m = await dockMetrics(page);
  expect(m.bottom).toBe(812);
  await expect(page.locator("#submit-btn")).toBeVisible();
  await expect(page.locator("#session-progress")).toBeVisible();
  expect(await containerPaddingBottom(page)).toBe(reserved);

  // The countdown was never touched.
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY)).toBe(storedEnd);
});

test.describe("touch devices", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test("a zoomed user who opens the keyboard still gets the dock on the visible edge", async ({ page, context }) => {
    await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
    await installFakeVisualViewport(page);
    await signIn(page, context);
    await openWorkoutDay(page);

    // Pinch-zoom alone: not a keyboard, the dock stays at the layout bottom.
    await setVisualViewport(page, { height: 406, offsetTop: 100, scale: 2 });
    expect((await dockMetrics(page)).bottom).toBe(812);
    await expect(page.locator("body")).not.toHaveClass(/keyboard-open/);

    // Now focus a set input while still zoomed (coarse pointer → keyboard):
    // the compact dock must sit on the visible bottom edge (100 + 406), not
    // stay hidden behind the keyboard at the layout bottom.
    const weight = page.locator(".ex-card").first().locator(".set-row[data-set='0'] input[data-field='weight']");
    await weight.focus();
    await setVisualViewport(page, { height: 406, offsetTop: 100, scale: 2 });
    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    await expect(page.locator("#submit-btn")).toBeHidden();
    expect((await dockMetrics(page)).bottom).toBe(506);

    // Blur → zoom guard applies again, dock drops back to the layout bottom.
    await weight.blur();
    await setVisualViewport(page, { height: 406, offsetTop: 100, scale: 2 });
    await expect(page.locator("body")).not.toHaveClass(/keyboard-open/);
    expect((await dockMetrics(page)).bottom).toBe(812);
  });

  test("the <=240px static dock neither lifts nor compacts while typing", async ({ page, context }) => {
    await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
    await installFakeVisualViewport(page);
    await signIn(page, context);
    await openWorkoutDay(page);
    // 195x422 is the effective CSS viewport of a 390x844 phone at 200% zoom.
    await page.setViewportSize({ width: 195, height: 422 });
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => ({
      position: getComputedStyle(document.querySelector("#submit-row")).position,
      transform: getComputedStyle(document.querySelector("#submit-row")).transform,
      dockHeight: Math.round(document.querySelector("#submit-row").getBoundingClientRect().height),
      scrollHeight: document.documentElement.scrollHeight,
      padding: getComputedStyle(document.querySelector(".container")).paddingBottom,
    }));
    expect(before.position).toBe("static");
    expect(before.padding).toBe("0px");

    const weight = page.locator(".ex-card").first().locator(".set-row[data-set='0'] input[data-field='weight']");
    await weight.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));
    await weight.focus();
    await setVisualViewport(page, { height: 422 - 300 });
    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    const after = await page.evaluate(() => ({
      transform: getComputedStyle(document.querySelector("#submit-row")).transform,
      dockHeight: Math.round(document.querySelector("#submit-row").getBoundingClientRect().height),
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: Math.round(window.scrollY),
      submitVisible: getComputedStyle(document.querySelector("#submit-btn")).display !== "none",
    }));
    expect(after.transform, "in-flow dock is never translated").toBe("none");
    expect(after.submitVisible, "in-flow dock keeps its full content").toBe(true);
    expect(after.dockHeight).toBe(before.dockHeight);
    expect(after.scrollHeight, "document height does not change under the user").toBe(before.scrollHeight);
    expect(after.scrollY).toBe(scrollBefore);
  });

  test("focusing a set input compacts the dock before the keyboard even reports its size", async ({ page, context }) => {
    await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
    await signIn(page, context);
    await openWorkoutDay(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), "touch emulation reports a coarse pointer").toBe(true);

    const weight = page.locator(".ex-card").first().locator(".set-row[data-set='0'] input[data-field='weight']");
    await weight.focus();
    await expect(page.locator("body")).toHaveClass(/keyboard-open/);
    await expect(page.locator("#submit-btn")).toBeHidden();
    await expect(page.locator("#rest-bar-host .rest-bar")).toBeVisible();

    await weight.blur();
    await expect(page.locator("body")).not.toHaveClass(/keyboard-open/);
    await expect(page.locator("#submit-btn")).toBeVisible();
  });
});
