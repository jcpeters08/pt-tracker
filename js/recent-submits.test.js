import { describe, it, expect } from "vitest";
import {
  rememberSubmit,
  overlayRecentSubmits,
  loadRecentSubmits,
  saveRecentSubmits,
  RECENT_SUBMITS_KEY,
  RECENT_SUBMITS_TTL_MS,
} from "./recent-submits.js";

const T0 = Date.parse("2026-10-20T12:00:00Z");
const MIN = 60 * 1000;

const log = (date, day, type, submittedAt = "2026-10-20T12:00:00Z") =>
  ({ type: "log", submitted_at: submittedAt, session: { date, day_of_week: day, type, submitted_at: submittedAt } });
const skip = (date, day, type, submittedAt = "2026-10-20T12:00:00Z") =>
  ({ type: "skip", submitted_at: submittedAt, session: { date, day_of_week: day, type, submitted_at: submittedAt } });
const rec = (date, location, submittedAt = "2026-10-20T12:00:00Z") =>
  ({ type: "recovery", submitted_at: submittedAt, session: { date, location, submitted_at: submittedAt } });
const edit = (rid, day, ex) => ({ type: "routine_edit", routine_id: rid, day_of_week: day, exercise_id: ex });

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map,
  };
}

describe("rememberSubmit", () => {
  it("appends a log stamped with recorded_at", () => {
    const out = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("log");
    expect(out[0].recorded_at).toBe(T0);
    expect(out[0].session.date).toBe("2026-10-20");
  });

  it("replaces a remembered entry for the same workout slot (log displaces skip)", () => {
    const first = rememberSubmit([], skip("2026-10-20", "tuesday", "pull"), T0);
    const out = rememberSubmit(first, log("2026-10-20", "tuesday", "pull"), T0 + MIN);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("log");
    expect(out[0].recorded_at).toBe(T0 + MIN);
  });

  it("keeps entries for other slots and other kinds", () => {
    let list = rememberSubmit([], log("2026-10-19", "monday", "push"), T0);
    list = rememberSubmit(list, rec("2026-10-19", "Embrace North"), T0);
    list = rememberSubmit(list, log("2026-10-20", "tuesday", "pull"), T0);
    expect(list).toHaveLength(3);
  });

  it("ignores routine_edit entries (they do not affect the day view)", () => {
    const out = rememberSubmit([], edit("W43", "monday", "flat-db-bench-press"), T0);
    expect(out).toEqual([]);
  });

  it("does not mutate the input list or the entry", () => {
    const input = [];
    const entry = log("2026-10-20", "tuesday", "pull");
    const out = rememberSubmit(input, entry, T0);
    expect(input).toEqual([]);
    expect(entry.recorded_at).toBeUndefined();
    expect(out[0]).not.toBe(entry);
  });
});

describe("overlayRecentSubmits", () => {
  it("overlays a fresh remembered log that pending.json does not yet contain", () => {
    const recent = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    const { entries, remaining } = overlayRecentSubmits([], recent, T0 + 2 * MIN);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("log");
    expect(entries[0].session.date).toBe("2026-10-20");
    expect(remaining).toHaveLength(1);
  });

  it("drops a remembered entry once pending.json already has that slot", () => {
    const recent = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    const fetched = [log("2026-10-20", "tuesday", "pull")];
    const { entries, remaining } = overlayRecentSubmits(fetched, recent, T0 + 2 * MIN);
    expect(entries).toHaveLength(1);
    expect(remaining).toEqual([]);
  });

  it("keeps a newer re-submit when pending.json only has the older same-slot entry", () => {
    const older = log("2026-10-20", "tuesday", "pull", "2026-10-20T12:00:00Z");
    const newer = log("2026-10-20", "tuesday", "pull", "2026-10-20T12:05:00Z");
    const recent = rememberSubmit([], newer, T0 + 5 * MIN);
    const { entries, remaining } = overlayRecentSubmits([older], recent, T0 + 6 * MIN);
    expect(entries).toHaveLength(1);
    expect(entries[0].submitted_at).toBe("2026-10-20T12:05:00Z");
    expect(remaining).toHaveLength(1);
  });

  it("drops remembered entries older than the TTL", () => {
    const recent = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    const { entries, remaining } = overlayRecentSubmits([], recent, T0 + RECENT_SUBMITS_TTL_MS + 1);
    expect(entries).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it("keeps an entry right up to the TTL boundary", () => {
    const recent = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    const { remaining } = overlayRecentSubmits([], recent, T0 + RECENT_SUBMITS_TTL_MS - 1);
    expect(remaining).toHaveLength(1);
  });

  it("overlays recovery by (date, location) and leaves other fetched entries alone", () => {
    const recent = rememberSubmit([], rec("2026-10-19", "Embrace North"), T0);
    const fetched = [log("2026-10-19", "monday", "push")];
    const { entries, remaining } = overlayRecentSubmits(fetched, recent, T0 + MIN);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.type).sort()).toEqual(["log", "recovery"]);
    expect(remaining).toHaveLength(1);
  });

  it("does not leak recorded_at into the overlaid entries", () => {
    const recent = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    const { entries } = overlayRecentSubmits([], recent, T0 + MIN);
    expect(entries[0].recorded_at).toBeUndefined();
  });

  it("tolerates missing or malformed inputs", () => {
    expect(overlayRecentSubmits(undefined, undefined, T0)).toEqual({ entries: [], remaining: [] });
    expect(overlayRecentSubmits([], [null, {}, { type: "log" }], T0).remaining).toEqual([]);
  });
});

describe("loadRecentSubmits / saveRecentSubmits", () => {
  it("round-trips a list through storage under the v1 key", () => {
    const storage = fakeStorage();
    const list = rememberSubmit([], log("2026-10-20", "tuesday", "pull"), T0);
    saveRecentSubmits(storage, list);
    expect(storage.getItem(RECENT_SUBMITS_KEY)).toBeTruthy();
    expect(loadRecentSubmits(storage)).toEqual(list);
  });

  it("returns [] for missing or corrupt storage values", () => {
    expect(loadRecentSubmits(fakeStorage())).toEqual([]);
    expect(loadRecentSubmits(fakeStorage({ [RECENT_SUBMITS_KEY]: "{not json" }))).toEqual([]);
    expect(loadRecentSubmits(fakeStorage({ [RECENT_SUBMITS_KEY]: "{\"x\":1}" }))).toEqual([]);
  });

  it("removes the key when saving an empty list", () => {
    const storage = fakeStorage({ [RECENT_SUBMITS_KEY]: "[]" });
    saveRecentSubmits(storage, []);
    expect(storage.getItem(RECENT_SUBMITS_KEY)).toBeNull();
  });

  it("swallows storage errors", () => {
    const broken = { getItem: () => { throw new Error("nope"); }, setItem: () => { throw new Error("nope"); }, removeItem: () => { throw new Error("nope"); } };
    expect(loadRecentSubmits(broken)).toEqual([]);
    expect(() => saveRecentSubmits(broken, [])).not.toThrow();
    expect(() => saveRecentSubmits(broken, [{ type: "log" }])).not.toThrow();
  });
});
