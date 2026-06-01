import { describe, it, expect } from "vitest";
import { selectRoutineForDate, resolveSessionForView } from "./routines.js";

// All four current routines have end_date null (open-ended) — the C9 case.
const ROUTINES = [
  "2026-W18-CDMX-Phase-1-Closeout",
  "2026-W20-Phase-2-Launch-Reentry",
  "2026-W21-Phase-2-Week-2-Progression",
  "2026-W22-Phase-2-Week-3-Reentry",
];
const META = [
  { id: "2026-W18-CDMX-Phase-1-Closeout", start_date: "2026-05-04", end_date: null },
  { id: "2026-W20-Phase-2-Launch-Reentry", start_date: "2026-05-11", end_date: null },
  { id: "2026-W21-Phase-2-Week-2-Progression", start_date: "2026-05-18", end_date: null },
  { id: "2026-W22-Phase-2-Week-3-Reentry", start_date: "2026-05-25", end_date: null },
];

const pick = (date, extra = {}) => selectRoutineForDate({ date, routines: ROUTINES, meta: META, ...extra });

describe("selectRoutineForDate", () => {
  it("picks the latest routine whose start_date <= date (open-ended)", () => {
    expect(pick("2026-05-20")).toBe("2026-W21-Phase-2-Week-2-Progression");
    expect(pick("2026-05-30")).toBe("2026-W22-Phase-2-Week-3-Reentry");
    expect(pick("2026-05-04")).toBe("2026-W18-CDMX-Phase-1-Closeout");
  });

  it("a future routine does not become active before its start_date", () => {
    expect(pick("2026-05-12")).toBe("2026-W20-Phase-2-Launch-Reentry"); // W21 (5/18) not yet active
  });

  it("honors a valid pin but ignores a pin outside its window", () => {
    expect(pick("2026-05-26", { pinned: "2026-W20-Phase-2-Launch-Reentry" }))
      .toBe("2026-W20-Phase-2-Launch-Reentry"); // pinned + still date-valid (open-ended)
    const withEnd = META.map(m => m.id.startsWith("2026-W20")
      ? { ...m, end_date: "2026-05-17" } : m);
    expect(selectRoutineForDate({ date: "2026-05-26", routines: ROUTINES, meta: withEnd, pinned: "2026-W20-Phase-2-Launch-Reentry" }))
      .toBe("2026-W22-Phase-2-Week-3-Reentry"); // pin expired (end < date) → ignored
  });

  it("respects end_date windows", () => {
    const bounded = [
      { id: "a", start_date: "2026-05-01", end_date: "2026-05-07" },
      { id: "b", start_date: "2026-05-15", end_date: "2026-05-21" },
    ];
    expect(selectRoutineForDate({ date: "2026-05-10", routines: ["a", "b"], meta: bounded })).toBe("a"); // gap → latest past
    expect(selectRoutineForDate({ date: "2026-05-16", routines: ["a", "b"], meta: bounded })).toBe("b");
  });

  it("falls back to the lexically-last id when nothing has a start_date", () => {
    expect(selectRoutineForDate({ date: "2026-01-01", routines: ["a", "z", "m"], meta: [] })).toBe("z");
  });
});

describe("resolveSessionForView (tapping a day shows the actual logged session)", () => {
  const wk = { weekStart: "2026-05-25", weekEnd: "2026-05-31" }; // W22 week

  it("returns the exact-date session when one exists (over a catch-up)", () => {
    const lookup = new Map([
      ["2026-05-25|monday|push", { kind: "log", id: "exact" }],
      ["2026-05-28|monday|push", { kind: "log", id: "catchup" }],
    ]);
    expect(resolveSessionForView(lookup, { date: "2026-05-25", day: "monday", type: "push", ...wk }))
      .toMatchObject({ id: "exact", resolvedDate: "2026-05-25", isFallback: false });
  });

  it("falls back to a catch-up: a day's workout performed on a DIFFERENT date in the week", () => {
    // The bug scenario: Monday's Push was actually done Thu 5/28; viewing it
    // from another day in the week must still surface the real session.
    const lookup = new Map([["2026-05-28|monday|push", { kind: "log", id: "catchup" }]]);
    expect(resolveSessionForView(lookup, { date: "2026-05-27", day: "monday", type: "push", ...wk }))
      .toMatchObject({ id: "catchup", resolvedDate: "2026-05-28", isFallback: true });
  });

  it("prefers the latest matching date when several exist", () => {
    const lookup = new Map([
      ["2026-05-26|monday|push", { kind: "log", id: "early" }],
      ["2026-05-28|monday|push", { kind: "log", id: "late" }],
    ]);
    expect(resolveSessionForView(lookup, { date: "2026-05-30", day: "monday", type: "push", ...wk }))
      .toMatchObject({ id: "late" });
  });

  it("ignores skip entries in the day-of-week fallback (only logs surface)", () => {
    const lookup = new Map([["2026-05-28|monday|push", { kind: "skip", id: "skip" }]]);
    expect(resolveSessionForView(lookup, { date: "2026-05-27", day: "monday", type: "push", ...wk }))
      .toBeNull();
  });

  it("still returns an exact-date skip for the queried day (date-specific)", () => {
    const lookup = new Map([["2026-05-27|wednesday|legs", { kind: "skip", id: "skip" }]]);
    expect(resolveSessionForView(lookup, { date: "2026-05-27", day: "wednesday", type: "legs", ...wk }))
      .toMatchObject({ id: "skip" });
  });

  it("does not match a log outside the routine week window", () => {
    const lookup = new Map([["2026-05-20|monday|push", { kind: "log", id: "prev-week" }]]);
    expect(resolveSessionForView(lookup, { date: "2026-05-27", day: "monday", type: "push", ...wk }))
      .toBeNull();
  });

  it("returns null with no exact match and no week window", () => {
    const lookup = new Map([["2026-05-28|monday|push", { kind: "log", id: "x" }]]);
    expect(resolveSessionForView(lookup, { date: "2026-05-27", day: "monday", type: "push" }))
      .toBeNull();
  });
});
