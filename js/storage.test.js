import { describe, it, expect } from "vitest";
import { payloadSignature, gcOldDrafts, parseWorkoutDraftKey, findWorkoutDraftForSlot, listStaleWorkoutDrafts } from "./storage.js";

const PFX = {
  draftPrefix: "pt_tracker_draft_v2:",
  draftPrefixV1: "pt_tracker_draft_v1:",
  recDraftPrefix: "pt_tracker_recovery_draft_v1:",
  gcDays: 5,
};

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    get length() { return m.size; },
    key(i) { return [...m.keys()][i] ?? null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

describe("payloadSignature", () => {
  it("ignores submitted_at and key order, but reflects content", () => {
    const a = payloadSignature({ date: "2026-05-18", day_of_week: "monday", submitted_at: "T1" });
    const b = payloadSignature({ day_of_week: "monday", date: "2026-05-18", submitted_at: "T2" });
    expect(a).toBe(b); // same content/diff timestamp+order → same signature
    const c = payloadSignature({ date: "2026-05-19", day_of_week: "monday" });
    expect(a).not.toBe(c);
  });
});

describe("gcOldDrafts", () => {
  const NOW = new Date("2026-05-31T00:00:00Z").getTime();
  const recent = JSON.stringify({ last_modified_at: "2026-05-30T00:00:00Z" }); // ~1 day → keep
  const old = JSON.stringify({ last_modified_at: "2026-05-01T00:00:00Z" });     // ~30 days → drop

  it("sweeps legacy v1, GCs old drafts, keeps recent + unrelated, drops corrupt", () => {
    const s = fakeStorage({
      "pt_tracker_draft_v1:legacy": recent,                       // legacy → always removed
      "pt_tracker_draft_v2:r|2026-05-30|monday|push": recent,     // recent → keep
      "pt_tracker_draft_v2:r|2026-05-01|monday|push": old,        // old → remove
      "pt_tracker_recovery_draft_v1:2026-05-01": old,             // old → remove
      "pt_tracker_recovery_draft_v1:2026-05-30": recent,          // recent → keep
      "pt_tracker_sid": "abc",                                    // unrelated → keep
      "pt_tracker_draft_v2:corrupt": "{not json",                 // corrupt → remove
    });
    gcOldDrafts(s, { now: NOW, ...PFX });
    const keys = s.keys();
    expect(keys).toEqual(expect.arrayContaining([
      "pt_tracker_draft_v2:r|2026-05-30|monday|push",
      "pt_tracker_recovery_draft_v1:2026-05-30",
      "pt_tracker_sid",
    ]));
    expect(keys).not.toContain("pt_tracker_draft_v1:legacy");
    expect(keys).not.toContain("pt_tracker_draft_v2:r|2026-05-01|monday|push");
    expect(keys).not.toContain("pt_tracker_recovery_draft_v1:2026-05-01");
    expect(keys).not.toContain("pt_tracker_draft_v2:corrupt");
  });
});

describe("findWorkoutDraftForSlot — the unsubmitted-day case", () => {
  const PREFIX = "pt_tracker_draft_v2:";
  const draft = (iso, done = true) => JSON.stringify({ version: 1, last_modified_at: iso, log: { "lat-pulldown": { sets: [{ weight_kg: 59, reps: 10, done }] } } });

  it("finds the newest same-slot draft under another date inside the routine week", () => {
    const st = fakeStorage({
      [`${PREFIX}W43|2026-10-20|tuesday|pull`]: draft("2026-10-20T11:30:00Z"),
      [`${PREFIX}W43|2026-10-13|tuesday|pull`]: draft("2026-10-13T11:30:00Z"),   // last week's date, outside the window
      [`${PREFIX}W43|2026-10-21|wednesday|legs`]: draft("2026-10-21T11:30:00Z"), // other slot
      [`${PREFIX}W42|2026-10-20|tuesday|pull`]: draft("2026-10-20T11:30:00Z"),   // other routine
    });
    const found = findWorkoutDraftForSlot(st, { draftPrefix: PREFIX, routineId: "W43", day: "tuesday", type: "pull", excludeDate: "2026-10-24", weekStart: "2026-10-19", weekEnd: "2026-10-25" });
    expect(found?.date).toBe("2026-10-20");
    expect(found?.draft.log["lat-pulldown"].sets[0].reps).toBe(10);
  });

  it("never returns the current view's own date, and returns null when nothing matches", () => {
    const st = fakeStorage({ [`${PREFIX}W43|2026-10-24|tuesday|pull`]: draft("2026-10-24T11:30:00Z") });
    expect(findWorkoutDraftForSlot(st, { draftPrefix: PREFIX, routineId: "W43", day: "tuesday", type: "pull", excludeDate: "2026-10-24" })).toBeNull();
    expect(findWorkoutDraftForSlot(fakeStorage(), { draftPrefix: PREFIX, routineId: "W43", day: "tuesday", type: "pull", excludeDate: "2026-10-24" })).toBeNull();
  });

  it("prefers the most recently modified draft when several dates match", () => {
    const st = fakeStorage({
      [`${PREFIX}W43|2026-10-20|tuesday|pull`]: draft("2026-10-20T11:30:00Z"),
      [`${PREFIX}W43|2026-10-22|tuesday|pull`]: draft("2026-10-22T11:30:00Z"),
    });
    expect(findWorkoutDraftForSlot(st, { draftPrefix: PREFIX, routineId: "W43", day: "tuesday", type: "pull", excludeDate: "2026-10-24" })?.date).toBe("2026-10-22");
  });

  it("ignores malformed keys and bodies", () => {
    const st = fakeStorage({ [`${PREFIX}W43|not-a-date|tuesday|pull`]: draft("2026-10-20T11:30:00Z"), [`${PREFIX}W43|2026-10-20|tuesday|pull`]: "{nope" });
    expect(findWorkoutDraftForSlot(st, { draftPrefix: PREFIX, routineId: "W43", day: "tuesday", type: "pull", excludeDate: "2026-10-24" })).toBeNull();
    expect(parseWorkoutDraftKey("pt_tracker_recovery_draft_v1:2026-10-20", PREFIX)).toBeNull();
  });
});

describe("listStaleWorkoutDrafts", () => {
  const PREFIX = "pt_tracker_draft_v2:";
  const draft = (iso, done) => JSON.stringify({ version: 1, last_modified_at: iso, log: { x: { sets: [{ weight_kg: 1, reps: 1, done }] } } });
  it("lists only drafts with a Done set that are older than minAgeMs, oldest first", () => {
    const now = new Date("2026-10-24T12:00:00Z").getTime();
    const st = fakeStorage({
      [`${PREFIX}W43|2026-10-20|tuesday|pull`]: draft("2026-10-20T11:30:00Z", true),
      [`${PREFIX}W43|2026-10-23|friday|lower-hybrid`]: draft("2026-10-23T11:30:00Z", true),
      [`${PREFIX}W43|2026-10-24|saturday|push`]: draft("2026-10-24T11:00:00Z", true),   // 1h old: in progress
      [`${PREFIX}W43|2026-10-19|monday|push`]: draft("2026-10-19T11:30:00Z", false),    // nothing Done
    });
    const stale = listStaleWorkoutDrafts(st, { draftPrefix: PREFIX, now, minAgeMs: 12 * 3600 * 1000 });
    expect(stale.map(d => d.date)).toEqual(["2026-10-20", "2026-10-23"]);
    expect(stale[0]).toMatchObject({ routineId: "W43", day: "tuesday", type: "pull" });
  });
});
