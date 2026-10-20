import { test, expect } from "@playwright/test";

// reports.html loads Chart.js from a CDN. Replace it per-test so the suite is
// hermetic and so we can make every chart constructor throw (offline PWA,
// blocked CDN) and prove the data tables still render.
const CHART_CDN = /chart\.umd\.min\.js/;
const THROWING_CHART = "window.Chart = function () { throw new Error('chart stub boom'); };";
const NOOP_CHART = "window.Chart = class { constructor() {} destroy() {} update() {} };";

async function stubChart(context, body) {
  await context.route(CHART_CDN, route => route.fulfill({ contentType: "application/javascript", body }));
}

// Same ISO-week algorithm reports.html uses for its week selectors.
function isoWeekForDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

test("data tables still render when Chart.js throws", async ({ page, context }) => {
  await stubChart(context, THROWING_CHART);
  await page.goto("/reports.html");

  await expect(page.locator("#prs-host table").first()).toBeVisible();
  await expect(page.locator("#actual-planned-host table")).toBeVisible();
  await expect(page.locator("#target-achievement-host table, #target-achievement-host .empty")).toHaveCount(1);
  await expect(page.locator("#stale-lifts-host table, #stale-lifts-host .empty")).toHaveCount(1);
  await expect(page.locator("#calendar-host > *").first()).toBeVisible();

  // The four chart sections (volume, lift, compliance, recovery) each report
  // their own failure inline; nothing else is blanked.
  await expect(page.locator(".section-error")).toHaveCount(4);
  await expect(page.locator(".section-error").first()).toContainText("chart stub boom");
  await expect(page.getByText("Failed to load reports")).toHaveCount(0);
});

test("actual vs planned defaults to the routine week covering the latest log, not profile.active_routine", async ({ page, context }) => {
  await stubChart(context, NOOP_CHART);
  // A sync that predates the current week leaves profile.active_routine stale.
  // Serve the oldest routine as the pointer; the page must not follow it.
  await context.route(/data\/profile\.json/, route => route.fulfill({
    json: { active_routine: "2026-W18-CDMX-Phase-1-Closeout" },
  }));
  await page.goto("/reports.html");
  await expect(page.locator("#actual-planned-host table")).toBeVisible();

  const { latestLogDate, routineStart } = await page.evaluate(async () => {
    const manifest = await (await fetch("data/manifest.json")).json();
    const logs = await Promise.all(manifest.logs.map(id => fetch(`data/logs/${id}.json`).then(r => r.json())));
    const routines = await Promise.all(manifest.routines.map(id => fetch(`data/routines/${id}.json`).then(r => r.json())));
    const latestLogDate = logs.map(l => l.date).sort().pop();
    const covering = routines
      .filter(r => r.start_date && r.start_date <= latestLogDate && (!r.end_date || r.end_date >= latestLogDate))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    return { latestLogDate, routineStart: covering.start_date };
  });
  const expectedWeek = isoWeekForDate(routineStart);
  expect(expectedWeek).not.toBe("2026-W18");
  await expect(page.locator("#planned-week-select")).toHaveValue(expectedWeek);
  test.info().annotations.push({ type: "latest log", description: latestLogDate });
});
