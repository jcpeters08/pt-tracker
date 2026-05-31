import { describe, it, expect } from "vitest";
import { mergePending } from "./pending.js";

const log = (date, day, type) => ({ type: "log", session: { date, day_of_week: day, type } });
const skip = (date, day, type) => ({ type: "skip", session: { date, day_of_week: day, type } });
const rec = (date, location) => ({ type: "recovery", session: { date, location } });
const edit = (rid, day, ex) => ({ type: "routine_edit", routine_id: rid, day_of_week: day, exercise_id: ex });

describe("mergePending (convention #5 pre-dedupe)", () => {
  it("always appends the new entry", () => {
    expect(mergePending([], log("2026-05-18", "monday", "push"))).toHaveLength(1);
    expect(mergePending(undefined, log("2026-05-18", "monday", "push"))).toHaveLength(1);
  });

  it("a new log displaces a pending entry for the same (date,day,type) — incl. a skip", () => {
    const out = mergePending([skip("2026-05-18", "monday", "push")], log("2026-05-18", "monday", "push"));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("log");
  });

  it("keeps entries for different workout slots", () => {
    const out = mergePending(
      [log("2026-05-18", "monday", "push"), log("2026-05-19", "tuesday", "pull")],
      log("2026-05-18", "monday", "push"),
    );
    expect(out).toHaveLength(2); // tuesday kept, monday replaced
    expect(out.filter(e => e.session.day_of_week === "monday")).toHaveLength(1);
  });

  it("recovery dedupes by (date, location)", () => {
    const out = mergePending([rec("2026-05-18", "Embrace North")], rec("2026-05-18", "Embrace North"));
    expect(out).toHaveLength(1);
    const out2 = mergePending([rec("2026-05-18", "Embrace North")], rec("2026-05-18", "Other Gym"));
    expect(out2).toHaveLength(2); // different location kept
  });

  it("routine_edit dedupes by (routine_id, day, exercise_id)", () => {
    const out = mergePending([edit("W21", "monday", "flat-db-bench-press")], edit("W21", "monday", "flat-db-bench-press"));
    expect(out).toHaveLength(1);
    const out2 = mergePending([edit("W21", "monday", "flat-db-bench-press")], edit("W21", "monday", "incline-db-bench-press"));
    expect(out2).toHaveLength(2);
  });

  it("does not cross-dedupe between unrelated entry types", () => {
    const out = mergePending([rec("2026-05-18", "Embrace North")], log("2026-05-18", "monday", "push"));
    expect(out).toHaveLength(2);
  });
});
