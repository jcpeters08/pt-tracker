# Mobile Workout First-Wave Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the iPhone workout logger around one accessible lower control dock, add live progress and same-session history, correct report/cool-down semantics, and make the rest timer reload-safe.

**Architecture:** Keep the existing static page shell and mutable `state` orchestration, while extracting the new history and progress calculations into pure ES modules. Extend the existing pure rest-timer module for persistence, then integrate all UI behavior through the existing `index.html`, `js/rest-bar.js`, and `js/workout.js` boundaries without changing payload or vault-sync interfaces.

**Tech Stack:** Static HTML/CSS, browser-native ES modules, localStorage, Vitest 4, Playwright 1.60, Python data audit.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-workout-first-wave-design.md`

## Global Constraints

- Storage remains canonical kg; lbs remains the preferred display and input unit.
- Do not change workout, skip, routine-edit, recovery, pending, analytics, or vault schemas.
- Preserve `buildSessionPayload()` use of `state.activeSession.resolvedDate` and `buildSkipPayload()` use of `state.workoutDate`.
- Preserve `refreshActiveSession()` hydration gating on `state.workoutHydrationKey`, never `hydratedKeys`.
- Keep `#submit-row`, `#submit-btn`, `#skip-btn`, and `#rest-bar-host` as stable DOM nodes; boot-time listeners must survive re-renders.
- The unified dock and Skip appear only for a current routine day containing exercises.
- The exact report heading is `Programmed target met`; it must never imply automatic load readiness.
- The exact dock microcopy is `Saves to GitHub now. Syncs to your vault overnight.`
- All controls changed in this wave require visible keyboard focus and a minimum 44-by-44 CSS-pixel hit region.
- Do not add dependencies or make a visual rebrand.
- Run the full Playwright suite once, at final verification. Use one targeted first-wave RED run and one GREEN cycle; an observed focused failure may be rerun only after diagnosis and a corrective change.
- No change to `docs/COWORK_SYNC_TASK.md` is required because this wave changes no synced data contract.

## File map

**Create:**

- `js/workout-history.js` — pure same-session prior-performance selection.
- `js/workout-history.test.js` — lookup behavior and exclusion tests.
- `js/workout-progress.js` — pure exercise/set progress summary.
- `js/workout-progress.test.js` — progress denominator and completion tests.
- `js/workout.test.js` — cool-down routing and prior-performance formatting tests.

**Modify:**

- `js/rest-timer.js`, `js/rest-timer.test.js` — active countdown persistence.
- `js/app-context.js` — explicit timer hydration state.
- `js/rest-bar.js` — stable semantic timer UI, persistence wiring, and announcements.
- `js/workout.js` — cool-down fix, card context, and progress painting.
- `index.html` — unified dock, top Skip, header actions, focus flow, safe-area and responsive styles.
- `js/reports.js`, `js/reports.test.js`, `reports.html` — target-achievement terminology.
- `e2e/workout-card.spec.js` — first-wave mobile integration and responsive contract.
- `README.md`, `AGENTS.md`, `CLAUDE.md` — report terminology.

---

### Task 1: Persist only a valid active rest countdown

**Files:**

- Modify: `js/rest-timer.test.js`
- Modify: `js/rest-timer.js`
- Modify: `js/app-context.js`

**Interfaces:**

- Produces: `REST_TIMER_KEY: string`
- Produces: `saveRunningTimer(storage, timer): void`
- Produces: `loadRunningTimer(storage, nowMs): {endsAtMs: number, durationSec: number} | null`
- Produces: `clearRunningTimer(storage): void`
- Produces state fields: `restTimer`, `restTimerHydrated`, `restDurationSec`

- [ ] **Step 1: Write failing persistence tests**

Extend the import in `js/rest-timer.test.js` and append this block:

```js
import {
  REST_PRESETS,
  DEFAULT_REST_SECONDS,
  REST_DURATION_KEY,
  REST_TIMER_KEY,
  formatClock,
  remainingSeconds,
  startTimer,
  loadDuration,
  saveDuration,
  loadRunningTimer,
  saveRunningTimer,
  clearRunningTimer,
} from "./rest-timer.js";

describe("running timer persistence", () => {
  it("stores only the absolute end and selected duration, then restores a live timer", () => {
    const storage = fakeStorage();
    saveRunningTimer(storage, { endsAtMs: 125000, durationSec: 120, flashed: true });

    expect(REST_TIMER_KEY).toBe("pt_tracker_rest_timer_v1");
    expect(JSON.parse(storage.getItem(REST_TIMER_KEY))).toEqual({
      endsAtMs: 125000,
      durationSec: 120,
    });
    expect(loadRunningTimer(storage, 5000)).toEqual({
      endsAtMs: 125000,
      durationSec: 120,
    });
  });

  it.each([
    ["expired", JSON.stringify({ endsAtMs: 5000, durationSec: 120 }), 5000],
    ["malformed", "not-json", 5000],
    ["unknown preset", JSON.stringify({ endsAtMs: 50000, durationSec: 45 }), 5000],
    ["impossibly far future", JSON.stringify({ endsAtMs: 200000, durationSec: 60 }), 5000],
  ])("rejects and clears %s stored state", (_label, raw, nowMs) => {
    const storage = fakeStorage({ [REST_TIMER_KEY]: raw });

    expect(loadRunningTimer(storage, nowMs)).toBeNull();
    expect(storage.getItem(REST_TIMER_KEY)).toBeNull();
  });

  it("clears a running timer explicitly", () => {
    const storage = fakeStorage({
      [REST_TIMER_KEY]: JSON.stringify({ endsAtMs: 125000, durationSec: 120 }),
    });

    clearRunningTimer(storage);

    expect(storage.getItem(REST_TIMER_KEY)).toBeNull();
  });

  it("restores the running timer's duration as the selected preset", () => {
    const storage = fakeStorage({
      [REST_DURATION_KEY]: "120",
      [REST_TIMER_KEY]: JSON.stringify({ endsAtMs: 95000, durationSec: 90 }),
    });

    expect(loadRunningTimer(storage, 5000)).toEqual({ endsAtMs: 95000, durationSec: 90 });
    expect(storage.getItem(REST_DURATION_KEY)).toBe("90");
  });

  it("rejects numeric strings as structurally invalid", () => {
    const storage = fakeStorage({
      [REST_TIMER_KEY]: JSON.stringify({ endsAtMs: "95000", durationSec: "90" }),
    });

    expect(loadRunningTimer(storage, 5000)).toBeNull();
    expect(storage.getItem(REST_TIMER_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/rest-timer.test.js`

Expected: FAIL because `REST_TIMER_KEY`, `loadRunningTimer`, `saveRunningTimer`, and `clearRunningTimer` are not exported.

- [ ] **Step 3: Implement the pure persistence boundary**

Add to `js/rest-timer.js`:

```js
export const REST_TIMER_KEY = "pt_tracker_rest_timer_v1";

export function clearRunningTimer(storage) {
  storage?.removeItem?.(REST_TIMER_KEY);
}

export function saveRunningTimer(storage, timer) {
  const endsAtMs = timer?.endsAtMs;
  const durationSec = timer?.durationSec;
  if (typeof endsAtMs !== "number" || !Number.isFinite(endsAtMs) || !REST_PRESETS.includes(durationSec)) return;
  storage?.setItem?.(REST_TIMER_KEY, JSON.stringify({ endsAtMs, durationSec }));
}

export function loadRunningTimer(storage, nowMs = Date.now()) {
  let stored;
  try {
    stored = JSON.parse(storage?.getItem?.(REST_TIMER_KEY) || "null");
  } catch {
    clearRunningTimer(storage);
    return null;
  }
  const endsAtMs = stored?.endsAtMs;
  const durationSec = stored?.durationSec;
  const remainingMs = endsAtMs - nowMs;
  const valid = typeof endsAtMs === "number"
    && Number.isFinite(endsAtMs)
    && REST_PRESETS.includes(durationSec)
    && remainingMs > 0
    && remainingMs <= durationSec * 1000;
  if (!valid) {
    clearRunningTimer(storage);
    return null;
  }
  saveDuration(storage, durationSec);
  return { endsAtMs, durationSec };
}
```

Add explicit state fields to `js/app-context.js` beside the other workout state:

```js
  restDurationSec: null,
  restTimer: null,
  restTimerHydrated: false,
```

- [ ] **Step 4: Run focused and full unit tests**

Run: `npm test -- --run js/rest-timer.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

- [ ] **Step 5: Commit the timer persistence foundation**

```bash
git add js/rest-timer.js js/rest-timer.test.js js/app-context.js
git commit -m "feat: persist active rest timer state"
```

---

### Task 2: Select the latest earlier performance from the same workout type

**Files:**

- Create: `js/workout-history.test.js`
- Create: `js/workout-history.js`

**Interfaces:**

- Produces: `findPreviousExercisePerformance(lookup, criteria): {date: string, type: string, exercise: object} | null`
- `criteria` is `{beforeDate: string, type: string, exerciseId: string}`.

- [ ] **Step 1: Write failing lookup tests**

Create `js/workout-history.test.js`:

```js
import { describe, it, expect } from "vitest";
import { findPreviousExercisePerformance } from "./workout-history.js";

function entry({ date, day = "monday", type = "push", exerciseId = "bench", kind = "log", status = "synced", reps = [8] }) {
  return [`${date}|${day}|${type}`, {
    kind,
    status,
    session: {
      date,
      day_of_week: day,
      type,
      exercises: exerciseId ? [{
        exercise_id: exerciseId,
        sets: reps.map((value, index) => ({ set: index + 1, weight_kg: 25, reps: value })),
      }] : [],
    },
  }];
}

describe("findPreviousExercisePerformance", () => {
  it("returns the latest strictly earlier same-type log regardless of weekday", () => {
    const lookup = new Map([
      entry({ date: "2026-08-10", day: "monday", reps: [8, 8, 8] }),
      entry({ date: "2026-08-24", day: "monday", reps: [12, 10, 10] }),
      entry({ date: "2026-08-30", day: "sunday", reps: [10, 10, 10] }),
    ]);

    const result = findPreviousExercisePerformance(lookup, {
      beforeDate: "2026-08-30",
      type: "push",
      exerciseId: "bench",
    });

    expect(result).toMatchObject({ date: "2026-08-24", type: "push" });
    expect(result.exercise.sets.map(set => set.reps)).toEqual([12, 10, 10]);
  });

  it("ignores skips, another workout type, and logs without the exercise", () => {
    const lookup = new Map([
      entry({ date: "2026-08-27", type: "push", kind: "skip" }),
      entry({ date: "2026-08-26", type: "upper-hybrid" }),
      entry({ date: "2026-08-25", type: "push", exerciseId: "incline-bench" }),
    ]);

    expect(findPreviousExercisePerformance(lookup, {
      beforeDate: "2026-08-30",
      type: "push",
      exerciseId: "bench",
    })).toBeNull();
  });

  it("accepts a pending overlay when its entry kind is still log", () => {
    const lookup = new Map([
      entry({ date: "2026-08-28", type: "pull", exerciseId: "row", status: "pending", reps: [12, 12, 12] }),
    ]);

    expect(findPreviousExercisePerformance(lookup, {
      beforeDate: "2026-08-29",
      type: "pull",
      exerciseId: "row",
    })).toMatchObject({ date: "2026-08-28", type: "pull" });
  });

  it("uses the supplied catch-up comparison date to exclude the resolved session", () => {
    const lookup = new Map([
      entry({ date: "2026-08-22", type: "lower-hybrid", exerciseId: "leg-press" }),
      entry({ date: "2026-08-29", type: "lower-hybrid", exerciseId: "leg-press" }),
    ]);

    expect(findPreviousExercisePerformance(lookup, {
      beforeDate: "2026-08-29",
      type: "lower-hybrid",
      exerciseId: "leg-press",
    })).toMatchObject({ date: "2026-08-22" });
  });

  it("ignores malformed dates, exercise collections, and set histories", () => {
    const lookup = new Map([
      ["not-a-date|monday|push", {
        kind: "log",
        session: { date: "not-a-date", type: "push", exercises: [] },
      }],
      ["2026-13-40|monday|push", {
        kind: "log",
        session: {
          date: "2026-13-40",
          type: "push",
          exercises: [{ exercise_id: "bench", sets: [{ weight_kg: 25, reps: 8 }] }],
        },
      }],
      ["2026-08-28|monday|push", {
        kind: "log",
        session: { date: "2026-08-28", type: "push", exercises: {} },
      }],
      ["2026-08-27|monday|push", {
        kind: "log",
        session: {
          date: "2026-08-27",
          type: "push",
          exercises: [{ exercise_id: "bench", sets: {} }],
        },
      }],
    ]);

    expect(findPreviousExercisePerformance(lookup, {
      beforeDate: "2026-08-30",
      type: "push",
      exerciseId: "bench",
    })).toBeNull();
  });

  it("returns null for a malformed non-iterable lookup", () => {
    expect(findPreviousExercisePerformance({}, {
      beforeDate: "2026-08-30",
      type: "push",
      exerciseId: "bench",
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/workout-history.test.js`

Expected: FAIL because `js/workout-history.js` does not exist.

- [ ] **Step 3: Implement the pure selector**

Create `js/workout-history.js`:

```js
// Selects history for the same workout type, independent of weekday.
function isIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const normalized = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toISOString()
    .slice(0, 10);
  return normalized === value;
}

export function findPreviousExercisePerformance(lookup, { beforeDate, type, exerciseId } = {}) {
  if (!lookup || typeof lookup[Symbol.iterator] !== "function"
    || !isIsoDate(beforeDate) || typeof type !== "string" || !type || !exerciseId) return null;
  let latest = null;
  for (const [key, entry] of lookup) {
    if (entry?.kind !== "log") continue;
    const session = entry.session || {};
    const keyParts = String(key).split("|");
    const date = session.date || keyParts[0] || "";
    const sessionType = session.type || keyParts[2] || "";
    if (!isIsoDate(date) || date >= beforeDate || sessionType !== type) continue;
    if (!Array.isArray(session.exercises)) continue;
    const exercise = session.exercises.find(item => item?.exercise_id === exerciseId);
    if (!exercise || !Array.isArray(exercise.sets) || exercise.sets.length === 0) continue;
    if (!latest || date > latest.date) latest = { date, type: sessionType, exercise };
  }
  return latest;
}
```

- [ ] **Step 4: Run focused and full unit tests**

Run: `npm test -- --run js/workout-history.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

- [ ] **Step 5: Commit the history selector**

```bash
git add js/workout-history.js js/workout-history.test.js
git commit -m "feat: select prior same-session performance"
```

---

### Task 3: Add live session-progress logic

**Files:**

- Create: `js/workout-progress.test.js`
- Create: `js/workout-progress.js`

**Interfaces:**

- Produces: `summarizeWorkoutProgress(day, log): {completedExercises, totalExercises, completedSets, totalSets, text, ariaLabel}`

- [ ] **Step 1: Write failing progress tests**

Create `js/workout-progress.test.js`:

```js
import { describe, it, expect } from "vitest";
import { summarizeWorkoutProgress } from "./workout-progress.js";

const day = {
  exercises: [
    { exercise_id: "bench", target_sets: 2 },
    { exercise_id: "fly", target_sets: 1 },
  ],
};

describe("summarizeWorkoutProgress", () => {
  it("reports untouched displayed sets as incomplete", () => {
    const result = summarizeWorkoutProgress(day, {
      bench: { sets: [{ done: false }, { done: false }] },
      fly: { sets: [{ done: false }] },
    });

    expect(result).toEqual({
      completedExercises: 0,
      totalExercises: 2,
      completedSets: 0,
      totalSets: 3,
      text: "0/2 exercises · 0/3 sets",
      ariaLabel: "0 of 2 exercises; 0 of 3 sets complete",
    });
  });

  it("counts an exercise only when every displayed set is done", () => {
    const result = summarizeWorkoutProgress(day, {
      bench: { sets: [{ done: true }, { done: true }] },
      fly: { sets: [{ done: false }] },
    });

    expect(result).toMatchObject({
      completedExercises: 1,
      completedSets: 2,
      totalSets: 3,
      text: "1/2 exercises · 2/3 sets",
    });
  });

  it("makes an added set part of the denominator and incomplete until done", () => {
    const result = summarizeWorkoutProgress(day, {
      bench: { sets: [{ done: true }, { done: true }, { done: false }] },
      fly: { sets: [{ done: true }] },
      unplanned: { sets: [{ done: true }] },
    });

    expect(result).toMatchObject({
      completedExercises: 1,
      totalExercises: 2,
      completedSets: 3,
      totalSets: 4,
      text: "1/2 exercises · 3/4 sets",
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/workout-progress.test.js`

Expected: FAIL because `js/workout-progress.js` does not exist.

- [ ] **Step 3: Implement the pure progress summary**

Create `js/workout-progress.js`:

```js
export function summarizeWorkoutProgress(day, log = {}) {
  const exercises = Array.isArray(day?.exercises) ? day.exercises : [];
  let completedExercises = 0;
  let completedSets = 0;
  let totalSets = 0;
  for (const exercise of exercises) {
    const storedSets = log?.[exercise.exercise_id]?.sets;
    const sets = Array.isArray(storedSets)
      ? storedSets
      : Array.from({ length: Math.max(0, Number(exercise.target_sets) || 0) }, () => ({ done: false }));
    const doneCount = sets.filter(set => set?.done === true).length;
    completedSets += doneCount;
    totalSets += sets.length;
    if (sets.length > 0 && doneCount === sets.length) completedExercises += 1;
  }
  const totalExercises = exercises.length;
  return {
    completedExercises,
    totalExercises,
    completedSets,
    totalSets,
    text: `${completedExercises}/${totalExercises} exercises · ${completedSets}/${totalSets} sets`,
    ariaLabel: `${completedExercises} of ${totalExercises} exercises; ${completedSets} of ${totalSets} sets complete`,
  };
}
```

- [ ] **Step 4: Run focused and full unit tests**

Run: `npm test -- --run js/workout-progress.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

- [ ] **Step 5: Commit the progress helper**

```bash
git add js/workout-progress.js js/workout-progress.test.js
git commit -m "feat: summarize live workout progress"
```

---

### Task 4: Format prior-performance context safely

**Files:**

- Create: `js/workout.test.js`
- Modify: `js/workout.js`

**Interfaces:**

- Produces: `formatLoggedPerformance(performance, unitPref): string`
- Produces: `formatHistoryDate(isoDate): string`

- [ ] **Step 1: Write failing formatting tests**

Create `js/workout.test.js`:

```js
import { describe, it, expect } from "vitest";
import { formatHistoryDate, formatLoggedPerformance } from "./workout.js";

describe("formatLoggedPerformance", () => {
  it("compacts equal canonical loads into one weight and a rep sequence", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 24.95, reps: 12 },
      { weight_kg: 24.95, reps: 10 },
      { weight_kg: 24.95, reps: 10 },
    ] } }, "lbs")).toBe("55 lbs × 12/10/10");
  });

  it("does not compact different canonical loads that round to the same displayed pounds", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 24.91, reps: 12 },
      { weight_kg: 24.94, reps: 10 },
    ] } }, "lbs")).toBe("55 lbs × 12 · 55 lbs × 10");
  });

  it("renders missing values as unknown while preserving available reps", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: null, reps: 12 },
      { reps: null },
    ] } }, "lbs")).toBe("? × 12/?");
  });

  it("treats malformed nonnumeric reps as unknown", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 25, reps: "twelve" },
      { weight_kg: 25, reps: Number.NaN },
    ] } }, "lbs")).toBe("55 lbs × ?/?");
  });

  it("labels only numeric zero as bodyweight", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 0, reps: 12 },
      { weight_kg: 0, reps: 12 },
    ] } }, "kg")).toBe("bodyweight × 12/12");
  });

  it("returns an empty string for a non-array set history", () => {
    expect(formatLoggedPerformance({ exercise: { sets: {} } }, "lbs")).toBe("");
  });
});

describe("formatHistoryDate", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatHistoryDate("2026-08-24")).toBe("Aug 24");
  });

  it("omits malformed dates", () => {
    expect(formatHistoryDate("not-a-date")).toBe("");
    expect(formatHistoryDate("2026-02-31")).toBe("");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/workout.test.js`

Expected: FAIL because the formatting exports do not exist.

- [ ] **Step 3: Implement canonical comparison and explicit unknown rendering**

Add near the existing display helpers in `js/workout.js`:

```js
function canonicalLoggedWeight(weightKg) {
  return typeof weightKg === "number" && Number.isFinite(weightKg) ? weightKg : null;
}

function loggedWeightLabel(weightKg, unitPref) {
  const canonical = canonicalLoggedWeight(weightKg);
  if (canonical == null) return "?";
  if (canonical === 0) return "bodyweight";
  if (unitPref === "kg") return `${fmtNum(canonical, 1)} kg`;
  return `${Math.round(kgToLbs(canonical))} lbs`;
}

function loggedRepLabel(reps) {
  return typeof reps === "number" && Number.isFinite(reps) ? String(reps) : "?";
}

export function formatLoggedPerformance(performance, unitPref = "lbs") {
  const sets = Array.isArray(performance?.exercise?.sets) ? performance.exercise.sets : [];
  if (!sets.length) return "";
  const weights = sets.map(set => canonicalLoggedWeight(set?.weight_kg));
  const labels = sets.map((set, index) => loggedWeightLabel(weights[index], unitPref));
  const reps = sets.map(set => loggedRepLabel(set?.reps));
  if (weights.every(weight => Object.is(weight, weights[0]))) {
    return `${labels[0]} × ${reps.join("/")}`;
  }
  return sets.map((_set, index) => `${labels[index]} × ${reps[index]}`).join(" · ");
}

const HISTORY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatHistoryDate(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const month = Number(match[2]);
  const day = Number(match[3]);
  const normalized = new Date(Date.UTC(Number(match[1]), month - 1, day)).toISOString().slice(0, 10);
  if (normalized !== isoDate) return "";
  return `${HISTORY_MONTHS[month - 1]} ${day}`;
}
```

- [ ] **Step 4: Run focused and full unit tests**

Run: `npm test -- --run js/workout.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

- [ ] **Step 5: Commit the formatter**

```bash
git add js/workout.js js/workout.test.js
git commit -m "feat: format prior workout performance"
```

---

### Task 5: Route Lower Hybrid to the lower-body cool-down

**Files:**

- Modify: `js/workout.test.js`
- Modify: `js/workout.js`

**Interfaces:**

- Exposes: `cooldownKeyForDay(day): "push" | "pull" | "legs" | "upper-hybrid" | "default"`

- [ ] **Step 1: Write the failing route matrix**

Add `cooldownKeyForDay` to the import in `js/workout.test.js` and append:

```js
describe("cooldownKeyForDay", () => {
  it.each([
    ["Push (Chest / Shoulders / Triceps)", "push"],
    ["Pull (Back / Biceps)", "pull"],
    ["Legs", "legs"],
    ["Lower Hybrid", "legs"],
    ["Upper Hybrid", "upper-hybrid"],
    ["Hybrid", "upper-hybrid"],
    ["Mobility", "default"],
  ])("maps %s to %s", (label, expected) => {
    expect(cooldownKeyForDay({ label })).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/workout.test.js`

Expected: FAIL because the resolver is private and Lower Hybrid currently resolves to `upper-hybrid`.

- [ ] **Step 3: Export the resolver and put lower matching before generic hybrid**

Replace the resolver in `js/workout.js` with:

```js
export function cooldownKeyForDay(day) {
  const label = (day?.label || "").toLowerCase();
  if (label.startsWith("push")) return "push";
  if (label.startsWith("pull")) return "pull";
  if (label.startsWith("legs")) return "legs";
  if (label.includes("lower")) return "legs";
  if (label.includes("upper")) return "upper-hybrid";
  if (label.includes("hybrid")) return "upper-hybrid";
  return "default";
}
```

- [ ] **Step 4: Run focused and full unit tests**

Run: `npm test -- --run js/workout.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

- [ ] **Step 5: Commit the cool-down correction**

```bash
git add js/workout.js js/workout.test.js
git commit -m "fix: use lower-body cooldown for Lower Hybrid"
```

---

### Task 6: Replace false load-readiness language with programmed-target achievement

**Files:**

- Modify: `js/reports.test.js`
- Modify: `js/reports.js`
- Modify: `reports.html`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Renames: `readinessRows(...)` → `targetAchievementRows(...)`
- Renames: `renderReadiness(...)` → `renderTargetAchievement(...)`
- Produces row signal: `Programmed target met`

- [ ] **Step 1: Write the failing semantic test**

In `js/reports.test.js`, replace the `readinessRows` import with `targetAchievementRows`, rename the existing test to `finds latest logs that met the programmed target without claiming load readiness`, and make its assertions explicit:

```js
const rows = targetAchievementRows(logs, [routine], names);
expect(rows.find(row => row.exercise === "Bench")).toMatchObject({
  target: "22 lbs × 10 × 2",
  actual: "22 lbs × 11/10",
  signal: "Programmed target met",
});
expect(rows.find(row => row.exercise === "Triceps")).toMatchObject({
  target: "25 lbs × 12 × 1",
  actual: "25 lbs × 12",
  signal: "Programmed target met",
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run js/reports.test.js`

Expected: FAIL because `targetAchievementRows` is not exported.

- [ ] **Step 3: Rename the calculation without changing eligibility**

In `js/reports.js`, replace `readinessRows` with this function. It is the existing eligibility algorithm with only the export name and signal semantics changed:

```js
export function targetAchievementRows(logs, routines, exerciseNames = {}) {
  const latestByExercise = new Map();
  for (const log of logs || []) {
    for (const exercise of log.exercises || []) {
      const prior = latestByExercise.get(exercise.exercise_id);
      if (!prior || String(log.date).localeCompare(prior.log.date) > 0) {
        latestByExercise.set(exercise.exercise_id, { log, exercise });
      }
    }
  }
  const rows = [];
  for (const [exerciseId, item] of latestByExercise) {
    const target = targetForLogExercise(item.log, routines, exerciseId);
    if (!target || !target.target_sets || !target.target_reps) continue;
    const sets = item.exercise.sets || [];
    const counted = sets.slice(0, target.target_sets);
    const targetWeight = target.target_weight_kg || 0;
    const hitSets = counted.length >= target.target_sets
      && counted.every(set => (set.reps || 0) >= target.target_reps && (set.weight_kg || 0) >= targetWeight);
    if (!hitSets) continue;
    rows.push({
      exercise_id: exerciseId,
      exercise: exerciseNames[exerciseId] || exerciseId,
      date: item.log.date,
      target: `${fmtTargetLbs(target)} × ${target.target_reps} × ${target.target_sets}`,
      actual: `${fmtLbsFromKg(counted[0]?.weight_kg)} × ${actualRepsText(counted)}`,
      signal: "Programmed target met",
    });
  }
  return rows.sort((a, b) => a.exercise.localeCompare(b.exercise));
}
```

- [ ] **Step 4: Update Reports markup and renderer names**

Use this section in `reports.html`:

```html
<section class="section">
  <h2>Programmed target met</h2>
  <p class="subtle">Latest logged exercises that met that week's programmed weight, reps, and set count. This does not automatically mean add weight.</p>
  <div id="target-achievement-host"></div>
</section>
```

Update the module import to `targetAchievementRows`, rename the renderer to `renderTargetAchievement`, select `#target-achievement-host`, call the renamed helper, use this empty state, and update the boot call:

```js
host.innerHTML = `<div class="empty">No latest logs met every programmed target.</div>`;
```

- [ ] **Step 5: Correct duplicated documentation language**

Make these exact wording changes:

In `README.md`, replace the existing Ready to progress bullet with:

```markdown
- **Programmed target met** — latest logs whose sets met that week's programmed weight/reps/sets; this is not automatically a load-increase signal.
```

In both `AGENTS.md` and `CLAUDE.md`, replace the literal phrase `reports.html adds ready-to-progress, actual-vs-planned` with `reports.html adds programmed-target achievement, actual-vs-planned`.

- [ ] **Step 6: Run tests and terminology scan**

Run: `npm test -- --run js/reports.test.js`

Expected: PASS.

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

Run: `rg -n -i "ready.?to.?progress|readiness" reports.html js/reports.js js/reports.test.js README.md AGENTS.md CLAUDE.md`

Expected: no matches.

- [ ] **Step 7: Commit the semantic correction**

```bash
git add js/reports.js js/reports.test.js reports.html README.md AGENTS.md CLAUDE.md
git commit -m "fix: clarify programmed target achievement"
```

---

### Task 7: Integrate the unified dock, top Skip, accessible header, progress, history, and reload-safe timer

**Files:**

- Modify: `e2e/workout-card.spec.js`
- Modify: `index.html`
- Modify: `js/rest-bar.js`
- Modify: `js/workout.js`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: timer persistence functions from Task 1.
- Consumes: `findPreviousExercisePerformance(...)` from Task 2.
- Consumes: `summarizeWorkoutProgress(...)` from Task 3.
- Consumes: `formatLoggedPerformance(...)` and `formatHistoryDate(...)` from Task 4.
- Consumes: corrected `cooldownKeyForDay(...)` from Task 5.
- Produces DOM nodes: `#workout-top-actions`, `#replace-token-btn`, `#session-progress`, `#rest-status-live`.
- Preserves existing DOM nodes: `#submit-row`, `#submit-btn`, `#skip-btn`, `#rest-bar-host`.

- [ ] **Step 1: Write the focused first-wave browser contract**

Delete the existing `rest timer remains in workout flow while the page scrolls` test because its fixed-document-position assertion contradicts the approved dock. Add this helper below `openPlannedDay`; it selects the unlogged W36 Sunday Push while preserving the older helper for existing tests:

```js
async function openFirstWaveDay(page) {
  await page.fill("#workout-date", "2026-08-30");
  await page.dispatchEvent("#workout-date", "change");
  await page.locator("#day-toggle .day-pill").nth(6).click();
  await expect(page.locator(".ex-card").first()).toBeVisible();
}
```

Append three tests. The first verifies observable layout, actions, progress, prior context, and visibility:

```js
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
```

The second test verifies persisted absolute-time restoration without relying on the frozen test clock advancing:

```js
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
```

The third test verifies current/upcoming/past history and action visibility:

```js
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
```

The fourth test verifies all approved viewport contracts in one browser session:

```js
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
```

- [ ] **Step 2: Run the targeted browser tests and verify RED**

Run: `npx playwright test e2e/workout-card.spec.js --grep "first wave:" --workers=1`

Expected: FAIL because the timer is outside `#submit-row`, the timer display is a `DIV`, the top Skip and new header button do not exist, and progress/history are absent.

- [ ] **Step 3: Restructure the static shell without replacing event-bound nodes**

In `index.html`:

1. Remove the top-level `<div id="rest-bar-host"></div>` from the start of `<main>`.
2. Replace the global M&S header anchor with this button beside Reports:

```html
<button class="header-link" id="replace-token-btn" type="button" aria-label="Replace GitHub token">
  <span aria-hidden="true">🔑</span><span class="token-long">Replace token</span><span class="token-short">Token</span>
</button>
```

3. Add this stable row immediately after `#mode-banner-host`:

```html
<div class="skip-row hidden" id="workout-top-actions">
  <button class="skip-link" id="skip-btn" type="button">I didn't do this workout — mark as skipped</button>
</div>
```

4. Replace the current submit-row contents with these static children, then move the intact `#submit-row` to the end of `<main>`, immediately after `#recovery-panel` and before `</main>`. Keeping the dock last in its sticky containing block lets it remain bottom-pinned while the recovery panel scrolls; moving the stable node does not disturb its boot-time listener:

```html
<div class="submit-row hidden" id="submit-row">
  <div id="rest-bar-host"></div>
  <div class="session-progress" id="session-progress" role="status" aria-live="polite" aria-atomic="true"></div>
  <button class="btn" id="submit-btn">Submit session</button>
  <p class="dock-sync-copy">Saves to GitHub now. Syncs to your vault overnight.</p>
</div>
```

Remove the old dock Reports/token links and old nested Skip row. Add `aria-label="Sign out"` to `#signout-btn` and add `class="unit-btn"` plus initial `aria-pressed` values to both unit buttons.

- [ ] **Step 4: Add exact visibility, responsive, safe-area, and focus styles**

Update `index.html` CSS with these behaviors. Replace the existing broad `body.mode-past input`, `textarea`, and `button` rule in full with the scoped `#app` rule below; leaving the old selectors in place would still disable the header date and PAT panel:

```css
button:focus-visible,
a:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.header-link,
.signout-btn,
.unit-toggle button,
.skip-link,
.rest-time,
.rest-chip {
  min-height: 44px;
}
.header-link,
.signout-btn,
.unit-toggle button,
.rest-time,
.rest-chip { min-width: 44px; }

.token-short { display: none; }

.submit-row {
  position: sticky;
  bottom: 0;
  z-index: 40;
  background: var(--bg);
  padding-top: 10px;
  padding-right: max(2px, env(safe-area-inset-right));
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
  padding-left: max(2px, env(safe-area-inset-left));
  box-shadow: 0 -8px 16px -8px rgba(40,25,15,.12);
}
.session-progress {
  margin: 2px 0 8px;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 700;
}
.dock-sync-copy {
  margin: 6px 0 0;
  text-align: center;
  color: var(--ink-muted);
  font-size: 12px;
}
.rest-bar { margin-bottom: 8px; }
.rest-time { border: 0; background: transparent; }
.rest-presets { flex-wrap: wrap; }
.rest-chip { flex: 1 1 44px; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.toast { bottom: calc(18px + var(--workout-dock-offset, env(safe-area-inset-bottom))); }
body.workout-dock-visible { padding-bottom: 0; }
body.workout-dock-visible .container { padding-bottom: 0; }
#cooldown-card,
#session-notes-input,
#recovery-panel {
  scroll-margin-bottom: calc(var(--workout-dock-offset, 0px) + 8px);
}

body.mode-past .submit-row,
body.mode-upcoming .submit-row,
body.mode-past #workout-top-actions,
body.mode-upcoming #workout-top-actions { display: none !important; }

body.mode-past #app input,
body.mode-past #app textarea,
body.mode-past #app button {
  pointer-events: none;
  opacity: 0.6;
}

@media (max-width: 480px) {
  .header-row { flex-wrap: wrap; justify-content: flex-start; gap: 6px; }
  header.app h1 { order: 1; flex: 1 0 calc(100% - 50px); }
  .signout-btn { order: 1; }
  .unit-toggle, .header-link { order: 2; }
  .token-long { display: none; }
  .token-short { display: inline; }
}

@media (max-height: 600px) {
  header.app { position: static; }
}

@media (max-width: 240px) {
  .submit-row { position: static; }
  .rest-bar { flex-direction: column; align-items: stretch; }
  .ex-head { flex-direction: column; }
  .ex-meta { width: 100%; min-width: 0; }
  .set-row { grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1fr); gap: 6px; }
  .set-row > :last-child { grid-column: 2 / -1; width: 100%; }
  .set-row.set-header > :last-child { display: none; }
  .date-picker-wrap { width: 100%; flex-wrap: wrap; }
  .date-picker-wrap input { width: 100%; min-width: 0; }
}
```

Keep the existing `.rest-bar.done`, `.flash`, and reduced-motion rules. Replace every existing `min-height: 0` override for controls in scope with the 44-pixel rule above.

- [ ] **Step 5: Wire dock height, Skip visibility, token focus, and unit semantics**

In `index.html`, keep a focus return reference and measure the live dock:

```js
let patReturnFocus = null;

function updateDockOffset() {
  const dock = $("#submit-row");
  const visible = dock && dock.getClientRects().length > 0;
  document.body.classList.toggle("workout-dock-visible", !!visible);
  if (visible) {
    const height = Math.ceil(dock.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--workout-dock-offset", `${height}px`);
  } else {
    document.documentElement.style.removeProperty("--workout-dock-offset");
  }
}
```

Call `requestAnimationFrame(updateDockOffset)` at the end of both `renderApp()` and `showPanel()`, observe `#submit-row` with one `ResizeObserver` during `DOMContentLoaded`, and call `updateDockOffset` on `resize`. The body class removes the page's legacy bottom padding only while the dock is visible; the dock itself owns the safe-area inset, so it can stay flush to the viewport even at the end of the recovery panel.

Use these focus helpers and replace the old `#replace-token-link` listener:

```js
function restorePatReturnFocus() {
  const target = patReturnFocus;
  patReturnFocus = null;
  if (target) requestAnimationFrame(() => target.focus());
}

$("#replace-token-btn").addEventListener("click", event => {
  patReturnFocus = event.currentTarget;
  showPanel("pat");
  requestAnimationFrame(() => $("#pat-input").focus());
});
```

Immediately after `showPanel("app")` in the successful PAT-save branch and in the PAT-cancel handler, call `restorePatReturnFocus()`. A first-time PAT setup has no saved return target, so the helper intentionally does nothing.

Update `syncUnitToggleUI()`:

```js
function syncUnitToggleUI() {
  document.querySelectorAll("#unit-toggle button").forEach(button => {
    const active = button.dataset.unit === state.unitPref;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}
```

In `js/workout.js`, have `renderExercises()` separately toggle `#workout-top-actions` and `#submit-row` using:

```js
const hasExercises = !!day?.exercises?.length;
const canLog = hasExercises && hooks.getRoutineMode(state.routine) === "current";
document.querySelector("#workout-top-actions")?.classList.toggle("hidden", !canLog);
document.querySelector("#submit-row")?.classList.toggle("hidden", !canLog);
```

Keep session notes visible for any day with exercises, matching current upcoming/past behavior.

- [ ] **Step 6: Make the timer semantic, stable, persisted, and quiet for screen readers**

Replace `js/rest-bar.js` with this implementation:

```js
// Accessible rest-timer UI. Countdown math and persistence live in rest-timer.js.
import { state } from "./app-context.js";
import {
  REST_PRESETS,
  formatClock,
  remainingSeconds,
  startTimer,
  loadDuration,
  saveDuration,
  loadRunningTimer,
  saveRunningTimer,
  clearRunningTimer,
} from "./rest-timer.js";

const PRESET_LABELS = { 60: "1:00", 90: "1:30", 120: "2:00", 180: "3:00" };
let ticker = null;

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

function ensureDuration() {
  if (state.restDurationSec == null) state.restDurationSec = loadDuration(localStorage);
  return state.restDurationSec;
}

function ensureTimerHydrated() {
  if (state.restTimerHydrated) return;
  state.restTimer = loadRunningTimer(localStorage, Date.now());
  if (state.restTimer) state.restDurationSec = state.restTimer.durationSec;
  state.restTimerHydrated = true;
}

function stopTicker() {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
}

function announce(message) {
  const live = document.querySelector("#rest-status-live");
  if (live) live.textContent = message;
}

function syncPresetState(bar) {
  const selected = ensureDuration();
  for (const chip of bar.querySelectorAll(".rest-chip")) {
    const active = Number(chip.dataset.seconds) === selected;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function paint() {
  const bar = document.querySelector("#rest-bar-host .rest-bar");
  if (!bar) return;
  const time = bar.querySelector(".rest-time");
  const duration = ensureDuration();
  const timer = state.restTimer;
  if (!timer) {
    bar.classList.remove("flash", "done");
    time.textContent = formatClock(duration);
    time.setAttribute("aria-label", `Start ${duration}-second rest timer`);
    return;
  }
  const remaining = remainingSeconds(timer.endsAtMs, Date.now());
  if (remaining > 0) {
    bar.classList.remove("flash", "done");
    time.textContent = formatClock(remaining);
    time.setAttribute("aria-label", `Stop rest timer, ${remaining} seconds remaining`);
    return;
  }
  time.textContent = "GO";
  time.setAttribute("aria-label", `Rest complete; start ${duration}-second timer`);
  bar.classList.add("done");
  if (!timer.flashed) {
    bar.classList.add("flash");
    timer.flashed = true;
    clearRunningTimer(localStorage);
    announce("Rest complete");
  }
  stopTicker();
}

function buildRestBar() {
  const time = el("button", {
    type: "button",
    class: "rest-time",
    title: "Start or stop rest timer",
  });
  time.addEventListener("click", () => {
    const running = state.restTimer && remainingSeconds(state.restTimer.endsAtMs, Date.now()) > 0;
    if (running) cancelRest();
    else startRest();
  });

  const presets = el("div", { class: "rest-presets" });
  for (const seconds of REST_PRESETS) {
    const chip = el("button", {
      type: "button",
      class: "rest-chip",
      text: PRESET_LABELS[seconds],
      "aria-label": `Start a ${seconds}-second rest timer`,
      "aria-pressed": "false",
    });
    chip.dataset.seconds = String(seconds);
    chip.addEventListener("click", () => setRestDuration(seconds));
    presets.append(chip);
  }

  const live = el("span", {
    id: "rest-status-live",
    class: "sr-only",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  return el("div", { class: "rest-bar" }, time, presets, live);
}

export function startRest() {
  ensureTimerHydrated();
  state.restTimer = startTimer(ensureDuration(), Date.now());
  saveRunningTimer(localStorage, state.restTimer);
  renderRestBar(true);
  announce("Rest started");
}

export function cancelRest() {
  state.restTimer = null;
  clearRunningTimer(localStorage);
  stopTicker();
  renderRestBar(true);
  announce("Rest stopped");
}

export function setRestDuration(seconds) {
  state.restDurationSec = seconds;
  saveDuration(localStorage, seconds);
  startRest();
}

export function renderRestBar(active) {
  const host = document.querySelector("#rest-bar-host");
  if (!host) return;
  if (!active) {
    stopTicker();
    return;
  }
  ensureTimerHydrated();
  let bar = host.querySelector(".rest-bar");
  if (!bar) {
    bar = buildRestBar();
    host.append(bar);
  }
  syncPresetState(bar);
  const live = state.restTimer && remainingSeconds(state.restTimer.endsAtMs, Date.now()) > 0;
  if (live && !ticker) ticker = setInterval(paint, 250);
  paint();
}
```

This keeps controls stable across start, stop, preset, and countdown paints; the screen-reader live region announces exactly `Rest started`, `Rest stopped`, and `Rest complete`. `renderRestBar(false)` stops only the DOM ticker. It deliberately retains the timer state, persisted absolute end, selected preset, and stable DOM so a rest-day, past-view, or day-switch round trip resumes the same countdown.

- [ ] **Step 7: Integrate progress and prior-performance card context**

In `js/workout.js`, import:

```js
import { dayTypeKey } from "./util.js";
import { findPreviousExercisePerformance } from "./workout-history.js";
import { summarizeWorkoutProgress } from "./workout-progress.js";
```

Merge `dayTypeKey` into the existing util import rather than creating a duplicate import statement. `formatHistoryDate` is defined in this module by Task 4.

Add and export a DOM painter:

```js
export function renderWorkoutProgress(day = state.routine?.days?.[state.selectedDay]) {
  const node = document.querySelector("#session-progress");
  if (!node) return;
  const progress = summarizeWorkoutProgress(day, state.log);
  node.textContent = progress.text;
  node.setAttribute("aria-label", progress.ariaLabel);
}
```

Call it immediately after the Done handler mutates `log.sets[idx].done`. Add-set already calls the full renderer and therefore recalculates its increased denominator. Replace `renderExercises()` with the final visibility/progress form:

```js
export function renderExercises() {
  const host = document.querySelector("#exercises-host");
  if (!host) return;
  host.replaceChildren();
  const day = state.routine?.days?.[state.selectedDay];
  const hasExercises = !!day?.exercises?.length;
  const canLog = hasExercises && hooks.getRoutineMode(state.routine) === "current";

  document.querySelector("#session-notes-host")?.classList.toggle("hidden", !hasExercises);
  document.querySelector("#workout-top-actions")?.classList.toggle("hidden", !canLog);
  document.querySelector("#submit-row")?.classList.toggle("hidden", !canLog);

  if (!hasExercises) {
    host.append(el("div", { class: "rest-day-msg" },
      document.createTextNode("Rest day — no scheduled exercises."),
      el("br"),
      document.createTextNode("Use the day toggle to see another day."),
    ));
    return;
  }
  for (const exercise of day.exercises) {
    const card = renderExerciseCard(state.routine, exercise);
    host.appendChild(card);
    bindCardEvents(card, exercise.exercise_id);
  }
  renderWorkoutProgress(day);
}
```

In `renderExerciseCard()`, change the bold target prefix to `Today:`. For non-past modes, find and render history with:

```js
const selectedRoutineDay = state.routine?.days?.[state.selectedDay];
const selectedType = dayTypeKey(selectedRoutineDay?.label, state.selectedDay);
const beforeDate = state.activeSession?.kind === "log"
  ? (state.activeSession.resolvedDate || state.activeSession.session?.date || state.workoutDate)
  : state.workoutDate;
const previous = findPreviousExercisePerformance(state.sessionLookup, {
  beforeDate,
  type: selectedType,
  exerciseId: ex.exercise_id,
});
if (hooks.getRoutineMode(state.routine) !== "past" && previous) {
  targetDiv.append(el("div", { class: "previous-line" },
    el("b", { text: `Last ${dayLabel(state.selectedDay)} · ${formatHistoryDate(previous.date)}:` }),
    document.createTextNode(` ${formatLoggedPerformance(previous, state.unitPref)}`),
  ));
}
```

Style `.previous-line` as muted 12-pixel text with a 4-pixel top margin and normal wrapping. Keep the historical `.actual-line` branch unchanged.

In `renderApp()`, pass `true` to `renderRestBar` only when the routine mode is current and the selected day has exercises.

- [ ] **Step 8: Run unit tests, then the targeted browser tests and verify GREEN**

Run: `npm test -- --run`

Expected: all unit tests pass with zero failures.

Run: `npx playwright test e2e/workout-card.spec.js --grep "first wave:" --workers=1`

Expected: all four first-wave tests pass. This is the planned targeted green Playwright run. If a first-wave browser assertion fails, diagnose it, make the smallest correction, and rerun only the failing first-wave case until it passes; the one-run restriction applies to the full suite, not focused debugging.

Inspect the attached `first-wave-mobile-dock` screenshot for header wrapping, visible set content between header/dock, preset hit targets, and dock occlusion. Correct only deviations from the approved spec; rerun unit tests after any correction. Do not rerun Playwright here.

- [ ] **Step 9: Synchronize the frontend module map**

In `CLAUDE.md`:

1. Add `workout-history` and `workout-progress` to the pure-logic module list.
2. Add these exact table rows:

```markdown
| `workout-history.js` | pure prior-performance selection by workout type/date/exercise | `findPreviousExercisePerformance` |
| `workout-progress.js` | pure live exercise/set progress summary | `summarizeWorkoutProgress` |
```

3. Update the existing rows to describe the final responsibilities:

```markdown
| `workout.js` | workout day-view renderers, progress painter, prior-performance formatting, cool-down routing | `renderDayToggle`, `renderExercises`, `renderWorkoutProgress`, `renderCooldown`, `renderExerciseCard`, `formatLoggedPerformance`, `formatHistoryDate`, `cooldownKeyForDay` |
| `rest-timer.js` | pure rest-timer math plus duration and active-countdown persistence | `formatClock`, `remainingSeconds`, `startTimer`, `loadDuration`, `saveDuration`, `loadRunningTimer`, `saveRunningTimer`, `clearRunningTimer`, `REST_PRESETS` |
| `rest-bar.js` | accessible timer controls inside the unified workout dock; stable DOM, ticker, completion flash, transition announcements | `renderRestBar`, `startRest`, `cancelRest`, `setRestDuration` |
```

4. Add this operational convention to both `AGENTS.md` and `CLAUDE.md`:

```markdown
- **Unified workout dock + active rest timer.** `#submit-row`, `#submit-btn`, `#skip-btn`, and `#rest-bar-host` are static, boot-bound DOM nodes; move them but do not replace them during renders. The selected rest duration lives at `pt_tracker_rest_duration_v1`; a running countdown lives separately at `pt_tracker_rest_timer_v1` as an absolute `endsAtMs` plus preset `durationSec`. Day/rest/past-view switches stop only the ticker repaint and must not cancel the countdown. Explicit stop and expiry clear the running key.
```

- [ ] **Step 10: Commit the integrated mobile flow**

```bash
git add index.html js/rest-bar.js js/workout.js e2e/workout-card.spec.js AGENTS.md CLAUDE.md
git commit -m "feat: unify the mobile workout flow"
```

---

### Task 8: Verify every preserved contract and the responsive result

**Files:**

- Verify only: all changed files
- Modify only when a verification failure has a reproducing test.

**Interfaces:**

- Consumes the complete first-wave implementation.
- Produces fresh test, audit, responsive, and repository-cleanliness evidence.

- [ ] **Step 1: Request an independent code review before final verification**

Dispatch a read-only reviewer with the spec, this plan, and `git diff 2dc0a81..HEAD`. Require findings to name concrete regressions in priority order and explicitly check:

```text
workoutHydrationKey draft gate
resolvedDate workout submit identity
selected workout date for Skip
one static submit dock
timer expiry/cancel persistence clearing
same-type history selection
Lower Hybrid cooldown source_key
no automatic load-readiness claim
390px and landscape control visibility
```

If the reviewer finds a defect, write a focused failing test, verify RED, implement the smallest fix, verify GREEN, run the complete unit suite, and commit as `fix: address first-wave review findings`. A browser-only finding receives one focused Playwright red/green cycle here, before the final full-suite run.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm test -- --run`

Expected: every Vitest file passes with zero failed tests and no warnings.

- [ ] **Step 3: Run the repository data audit**

Run: `python3 scripts/audit_data.py .`

Expected: audit passes with no missing exercise metadata, image, routine, log, or PF-increment violations.

- [ ] **Step 4: Run the full browser suite exactly once**

Run: `npm run e2e`

Expected: every Playwright test passes, including catch-up submit identity, selected-date Skip, day-switch draft retention, historical mode, target editing, and all first-wave scenarios.

- [ ] **Step 5: Inspect the final responsive evidence**

Use the first-wave Playwright scenario at `320×568`, `390×844`, `430×932`, and `667×375`. At scroll position zero, assert:

```js
const initial = await page.evaluate(() => ({
  viewportWidth: window.innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  headerBottom: document.querySelector("header.app")?.getBoundingClientRect().bottom || 0,
  dockTop: document.querySelector("#submit-row")?.getBoundingClientRect().top || 0,
}));
expect(initial.documentWidth).toBeLessThanOrEqual(initial.viewportWidth);
expect(initial.dockTop).toBeGreaterThanOrEqual(initial.headerBottom);
```

Then scroll to 400 pixels, assert the dock bottom equals the viewport bottom, scroll another 120 pixels, and assert its viewport Y position stays stable. This separates the initial header/dock non-overlap check from the pinned-dock check, including at `667×375` where the short-height header scrolls normally.

At 320 pixels the preset buttons must wrap rather than fall below 44 pixels. Repeat horizontal-overflow, 44-pixel targets, unit-toggle operation, and timer start/stop at an effective `195×422` CSS viewport (the `390×844` target at 200% browser zoom). The extreme-zoom media rule may make the dock static so the entire interface remains available. Inspect both header and dock screenshots; no action, label, timer digit, or session control may be clipped.

- [ ] **Step 6: Verify exact terminology and preserved implementation gates**

Run: `rg -n -i "ready.?to.?progress|readiness" reports.html js/reports.js js/reports.test.js README.md AGENTS.md CLAUDE.md`

Expected: no matches.

Run: `rg -n "workoutHydrationKey !== key|resolvedDate|buildSkipPayload|pt_tracker_rest_timer_v1|Lower Hybrid|Programmed target met" index.html js e2e README.md AGENTS.md CLAUDE.md`

Expected: the hydration gate, resolved-date workout path, selected-date Skip builder, timer key, Lower Hybrid test, and corrected report copy are all present.

- [ ] **Step 7: Review the final diff and working tree**

Run: `git diff --check 2dc0a81..HEAD`

Expected: no whitespace errors.

Run: `git status --short`

Expected: empty output. All implementation commits are present and no generated Playwright artifact is tracked.
