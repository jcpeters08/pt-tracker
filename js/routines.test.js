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

describe("resolveSessionForView — the VIEW date must itself be inside the routine week", () => {
  // Real shape of the bug: W43 starts 2026-10-19 with end_date null, so
  // index.html derives weekEnd = start+6 = 2026-10-25, yet selectRoutineForDate
  // keeps W43 active for every later date until W44 is synced. Viewing Monday
  // 2026-10-26 must NOT surface the 10/19 Monday log as a catch-up — doing so
  // makes buildSessionPayload write date 2026-10-19 and overwrite last week.
  const w43 = { weekStart: "2026-10-19", weekEnd: "2026-10-25" };
  const lookup = new Map([["2026-10-19|monday|push", { kind: "log", id: "last-monday" }]]);
  const view = (date, extra = {}) =>
    resolveSessionForView(lookup, { date, day: "monday", type: "push", ...w43, ...extra });

  it("(a) view date inside the week still falls back to that week's catch-up log", () => {
    expect(view("2026-10-21"))
      .toMatchObject({ id: "last-monday", resolvedDate: "2026-10-19", isFallback: true });
    expect(view("2026-10-25")).toMatchObject({ resolvedDate: "2026-10-19", isFallback: true }); // inclusive end
  });

  it("(b) view date after weekEnd returns null (routine defaults, nominal date)", () => {
    expect(view("2026-10-26")).toBeNull(); // next Monday, W44 not yet synced
    expect(view("2026-11-02")).toBeNull();
  });

  it("(c) view date before weekStart returns null", () => {
    expect(view("2026-10-18")).toBeNull(); // the Sunday before the week
    expect(view("2026-10-12")).toBeNull(); // last week's Monday
  });

  it("(d) with no weekEnd the window is open-ended for the fallback, but still requires date >= weekStart", () => {
    // index.html always passes a derived weekEnd (start+6) when end_date is
    // missing; a caller that omits it is declaring the week open-ended.
    expect(view("2026-10-21", { weekEnd: undefined }))
      .toMatchObject({ id: "last-monday", resolvedDate: "2026-10-19", isFallback: true });
    expect(view("2026-10-18", { weekEnd: undefined })).toBeNull();
    // Open-ended by contract: a far-future view date still matches. Bounding
    // the week is the caller's job (index.html derives start+6).
    expect(view("2026-12-07", { weekEnd: undefined }))
      .toMatchObject({ id: "last-monday", resolvedDate: "2026-10-19", isFallback: true });
  });

  it("an exact-date match still wins even when the view date is outside the window", () => {
    const withNext = new Map([
      ...lookup,
      ["2026-10-26|monday|push", { kind: "log", id: "this-monday" }],
    ]);
    expect(resolveSessionForView(withNext, { date: "2026-10-26", day: "monday", type: "push", ...w43 }))
      .toMatchObject({ id: "this-monday", resolvedDate: "2026-10-26", isFallback: false });
  });

  it("a missing view date never falls back (nothing to place inside the window)", () => {
    expect(view(undefined)).toBeNull();
  });
});
