import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn, installFakeVisualViewport, setVisualViewport } from "./helpers.js";

// 2026-10-20 bug sweep: on a 390/402px-wide phone the sticky header (title
// row, lbs/kg + Reports + Token controls, routine pill, day toggle, date row)
// stacked to 299px. With the 195px fixed dock (229px in the PWA) that pinned
// 57% of a 754px viewport, and with the software keyboard up (~330px) the
// clear band left for the focused set input was ~150px.
//
// Phone-first compaction: the header is in normal flow and scrolls away; only
// the day strip (#day-toggle) is sticky, and it un-pins while body.keyboard-open
// so typing time has nothing but the compact rest timer as chrome.

const VIEWPORT = { width: 390, height: 844 };
const KEYBOARD_HEIGHT = 330;             // iOS number pad + accessory bar
const MAX_PINNED_HEADER = 120;           // px of top chrome allowed while scrolled
const MIN_TYPING_BAND = 250;             // px between top chrome and dock with the keyboard up

async function openWorkoutDay(page) {
  // Deterministic: W22 Tuesday is a real Pull day in the frozen current window.
  await page.fill("#workout-date", "2026-05-26");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(1).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
  await expect(page.locator("#submit-row > #rest-bar-host .rest-bar")).toBeVisible();
}

// Geometry of everything that can occupy the top and bottom of the viewport.
// `pinnedBottom` is the lower edge of whatever top chrome is still on screen
// (the in-flow header near the top of the page, the sticky day strip further
// down) — the focused input has to sit between it and the dock top.
function chromeMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header.app");
    const strip = document.querySelector("#day-toggle");
    const dock = document.querySelector("#submit-row");
    const h = header.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    return {
      scrollY: Math.round(window.scrollY),
      innerHeight: window.innerHeight,
      headerPosition: getComputedStyle(header).position,
      headerBottom: Math.round(h.bottom),
      stripPosition: getComputedStyle(strip).position,
      stripTop: Math.round(s.top),
      stripBottom: Math.round(s.bottom),
      stripHeight: Math.round(s.height),
      pinnedBottom: Math.max(0, Math.round(h.bottom), Math.round(s.bottom)),
      dockTop: Math.round(d.top),
      dockBottom: Math.round(d.bottom),
      dockHeight: Math.round(d.height),
    };
  });
}

async function scrollTo(page, y) {
  await page.evaluate((target) => window.scrollTo(0, target), y);
  await page.waitForTimeout(150); // sticky layout + ResizeObserver settle
}

test("scrolled mid-workout, only the day strip stays pinned and it is at most 120px tall", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize(VIEWPORT);
  await signIn(page, context);
  await openWorkoutDay(page);

  const atTop = await chromeMetrics(page);
  expect(atTop.headerPosition, "title/controls/routine/date header is in normal flow").toBe("static");
  expect(atTop.stripPosition).toBe("sticky");
  expect(atTop.stripTop, "at the top of the page the day strip sits below the header").toBeGreaterThanOrEqual(atTop.headerBottom);
  expect(atTop.stripHeight).toBeLessThanOrEqual(MAX_PINNED_HEADER);
  const maxScrollY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(maxScrollY, "day view is long enough to scroll").toBeGreaterThan(600);

  for (const y of [600, maxScrollY]) {
    await scrollTo(page, y);
    const m = await chromeMetrics(page);
    expect(m.scrollY).toBe(Math.min(y, maxScrollY));
    expect(m.headerBottom, `header scrolled away at scrollY=${y}`).toBeLessThanOrEqual(0);
    expect(m.stripPosition).toBe("sticky");
    expect(m.stripTop, `day strip pinned to the top edge at scrollY=${y}`).toBe(0);
    expect(m.pinnedBottom, `pinned top chrome at scrollY=${y}`).toBeLessThanOrEqual(MAX_PINNED_HEADER);
    // Most of the phone is content: dock + pinned strip leave well over half of
    // the 844px viewport to the exercise cards.
    expect(m.dockTop - m.pinnedBottom).toBeGreaterThanOrEqual(VIEWPORT.height / 2);
  }

  // The pinned strip is still a real control surface: 44px pills that sit
  // above the cards and switch days from anywhere in the page.
  await scrollTo(page, 600);
  const pills = page.locator("#day-toggle .day-pill");
  for (let index = 0; index < await pills.count(); index += 1) {
    const box = await pills.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const wedActive = await page.evaluate(() => {
    const pill = document.querySelectorAll("#day-toggle .day-pill")[2];
    const r = pill.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return pill === hit || pill.contains(hit);
  });
  expect(wedActive, "pinned pill is the element under the tap, not a card scrolled beneath it").toBe(true);
  await pills.nth(2).click();
  await expect(pills.nth(2)).toHaveClass(/active/);
  await expect(pills.nth(1)).not.toHaveClass(/active/);
  await expect(page.locator(".ex-card").first()).toBeVisible();
});

test("with the keyboard up the focused set input has at least 250px clear between top chrome and dock", async ({ page, context }) => {
  await freezeAppTime(page, "2026-05-30T12:00:00-05:00");
  await page.setViewportSize(VIEWPORT);
  await installFakeVisualViewport(page);
  await signIn(page, context);
  await openWorkoutDay(page);

  // Scroll so the header is gone and the strip is pinned, then put the second
  // card's first weight input 150px below the top edge — the kind of spot iOS
  // leaves a tapped input in after it scrolls the field into the visible band.
  const weight = page.locator(".ex-card").nth(1).locator(".set-row[data-set='0'] input[data-field='weight']");
  await weight.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelectorAll(".ex-card")[1].querySelector(".set-row[data-set='0'] input[data-field='weight']");
    window.scrollBy(0, el.getBoundingClientRect().top - 150);
  });
  await page.waitForTimeout(150);
  const before = await chromeMetrics(page);
  expect(before.stripTop, "precondition: strip is pinned before the keyboard opens").toBe(0);
  expect(before.headerBottom).toBeLessThanOrEqual(0);

  await weight.focus();
  await setVisualViewport(page, { height: VIEWPORT.height - KEYBOARD_HEIGHT });
  await expect(page.locator("body")).toHaveClass(/keyboard-open/);

  const typing = await chromeMetrics(page);
  expect(typing.dockBottom, "compact dock rides the visible edge above the keyboard").toBe(VIEWPORT.height - KEYBOARD_HEIGHT);
  expect(typing.dockHeight).toBeLessThanOrEqual(120);
  expect(typing.stripPosition, "the day strip un-pins while typing").toBe("static");
  expect(typing.stripBottom, "un-pinned strip is scrolled away with the header").toBeLessThanOrEqual(0);
  expect(typing.pinnedBottom).toBe(0);
  const band = typing.dockTop - typing.pinnedBottom;
  expect(band, "clear band between top chrome and dock top").toBeGreaterThanOrEqual(MIN_TYPING_BAND);

  const input = await weight.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
  });
  expect(input.top).toBeGreaterThanOrEqual(typing.pinnedBottom);
  expect(input.bottom).toBeLessThanOrEqual(typing.dockTop);
  expect(await page.evaluate(() => document.activeElement?.dataset?.field)).toBe("weight");

  // Keyboard closes: full dock back, strip pinned again.
  await weight.blur();
  await setVisualViewport(page, { height: VIEWPORT.height, offsetTop: 0 });
  await expect(page.locator("body")).not.toHaveClass(/keyboard-open/);
  await scrollTo(page, 600);
  const after = await chromeMetrics(page);
  expect(after.dockBottom).toBe(VIEWPORT.height);
  expect(after.stripPosition).toBe("sticky");
  expect(after.stripTop).toBe(0);
  expect(after.pinnedBottom).toBeLessThanOrEqual(MAX_PINNED_HEADER);
});
