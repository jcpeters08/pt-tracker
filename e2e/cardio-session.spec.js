import { test, expect } from "@playwright/test";
import { freezeAppTime, signIn } from "./helpers.js";

const routineId = "2026-W45-Cardio-Test";
const notes = "Recumbent bike 20 minutes; forearm comfortable. Core omitted for floor transfers.";
const draftKey = `pt_tracker_draft_v2:${routineId}|2026-11-04|wednesday|easy-cardio-+-core`;

async function openCardioDay(page, context, onPendingAppend) {
  await freezeAppTime(page, "2026-11-04T12:00:00-06:00");
  await context.route(/\/data\/manifest\.json/, async route => {
    const manifest = await (await route.fetch()).json();
    await route.fulfill({ json: {
      ...manifest, routines: [routineId], logs: [], recovery_logs: [],
      exercises: ["dead-bug-legs-only"], latest_routine_id: routineId,
    } });
  });
  await context.route(/\/data\/pending\.json/, route => route.fulfill({ json: { entries: [] } }));
  await context.route(new RegExp(`/data/routines/${routineId}\\.json`), route => route.fulfill({ json: {
    id: routineId, name: "Cardio submission fixture", phase: "2", start_date: "2026-11-02", end_date: "2026-11-08",
    days: Object.fromEntries([["tuesday", "Lower A"], ["wednesday", "Easy Cardio + Core"]].map(([day, label]) => [day, {
      label, warmup: "Easy cardio, then optional core.", cooldown: "Seated breathing.",
      exercises: [{ exercise_id: "dead-bug-legs-only", target_weight_kg: 0, target_weight_raw: "bodyweight", target_reps: 12, target_sets: 2, notes: "Optional." }],
    }])),
  } }));
  await signIn(page, context, { onPendingAppend });
  await page.locator("#day-toggle .day-pill").nth(2).click();
  await expect(page.locator(".ex-card")).toHaveCount(1);
  await expect(page.locator(".set-row.done")).toHaveCount(0);
}

test("cardio-only notes survive a failed save and clear only after successful submission", async ({ page, context }) => {
  await openCardioDay(page, context);
  let failSave = true;
  const requests = [];
  await page.route("**/pending/append", route => {
    requests.push(route.request().postDataJSON().entry);
    return route.fulfill({ status: failSave ? 503 : 200, json: failSave ? { error: "Temporary test failure" } : { ok: true } });
  });
  await page.locator("#session-notes-input").fill(notes);
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key))?.sessionNotes, draftKey)).toBe(notes);

  await page.locator("#submit-btn").click();
  await expect(page.locator("#toast")).toContainText("Temporary test failure");
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.sessionNotes, draftKey)).toBe(notes);
  await expect(page.locator("#session-notes-input")).toHaveValue(notes);

  failSave = false;
  await page.locator("#submit-btn").click();
  await expect(page.locator("#log-status")).toHaveText("● Submitted (pending sync)");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ type: "log", session: {
    date: "2026-11-04", day_of_week: "wednesday", routine_id: routineId,
    exercises: [], session_notes: notes,
  } });
  expect(await page.evaluate(key => localStorage.getItem(key), draftKey)).toBeNull();
});

test("cardio without completed sets or notes asks for actual activity and minutes", async ({ page, context }) => {
  const requests = [];
  await openCardioDay(page, context, entry => requests.push(entry));
  await page.locator("#submit-btn").click();
  await expect(page.locator("#toast")).toContainText("Add cardio activity and minutes in Session notes");
  expect(requests).toEqual([]);
  await expect(page.locator("#submit-btn")).toBeEnabled();
});

test("strength days still refuse notes without a completed set", async ({ page, context }) => {
  const requests = [];
  await openCardioDay(page, context, entry => requests.push(entry));
  await page.locator("#day-toggle .day-pill").nth(1).click();
  await page.locator("#session-notes-input").fill("Some notes but no completed strength work.");
  await page.locator("#submit-btn").click();
  await expect(page.locator("#toast")).toContainText("Log at least one set before submitting.");
  expect(requests).toEqual([]);
});

test("cardio notes do not bypass an incomplete Done set", async ({ page, context }) => {
  const requests = [];
  await openCardioDay(page, context, entry => requests.push(entry));
  await page.locator("#session-notes-input").fill(notes);
  const row = page.locator(".set-row[data-set='0']");
  await row.locator('[data-action="done"]').click();
  await row.locator('[data-field="reps"]').fill("");
  await page.locator("#submit-btn").click();
  await expect(page.locator("#toast")).toContainText("set 1 is marked Done but has no reps");
  expect(requests).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key))?.sessionNotes, draftKey)).toBe(notes);
});
