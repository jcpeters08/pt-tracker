import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

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

  // The countdown kept running through every scroll + re-layout.
  await expect(page.locator("#rest-bar-host .rest-time")).toHaveAttribute("aria-label", /Stop rest timer, \d+ seconds remaining/);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).endsAtMs, TIMER_KEY)).toBe(storedEnd);

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

// iOS keeps the layout viewport full-height while the software keyboard is up
// and only shrinks window.visualViewport. Chromium can't open a keyboard, so
// these tests install a controllable visualViewport stand-in before the app
// boots and drive it the way iOS does.
async function installFakeVisualViewport(page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    const fake = {
      offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
      get width() { return this._width ?? window.innerWidth; },
      set width(v) { this._width = v; },
      get height() { return this._height ?? window.innerHeight; },
      set height(v) { this._height = v; },
      addEventListener: (...args) => target.addEventListener(...args),
      removeEventListener: (...args) => target.removeEventListener(...args),
      dispatchEvent: (event) => target.dispatchEvent(event),
    };
    Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
    window.__fakeVisualViewport = fake;
  });
}

async function setVisualViewport(page, { height, offsetTop = 0, scale = 1 }, eventName = "resize") {
  await page.evaluate(([h, top, sc, name]) => {
    const vv = window.__fakeVisualViewport;
    vv.height = h; vv.offsetTop = top; vv.scale = sc;
    vv.dispatchEvent(new Event(name));
  }, [height, offsetTop, scale, eventName]);
  await page.waitForTimeout(100); // rAF-coalesced update
}

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
