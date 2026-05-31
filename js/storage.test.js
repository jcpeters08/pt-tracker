import { describe, it, expect } from "vitest";
import { payloadSignature, gcOldDrafts } from "./storage.js";

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
