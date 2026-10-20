import { describe, it, expect } from "vitest";
import { findIncompleteDoneSets, describeIncompleteDoneSet } from "./session-check.js";

const base = () => ({
  selectedDay: "monday",
  routine: { days: { monday: { exercises: [{ exercise_id: "a" }, { exercise_id: "b" }] } } },
  exercises: { a: { name: "Alpha Press" } },
  log: {
    a: { sets: [{ done: true, weight_kg: 10, reps: 8 }, { done: true, weight_kg: 10, reps: null }] },
    b: { sets: [{ done: false, weight_kg: null, reps: null }, { done: true, weight_kg: null, reps: 5 }] },
  },
});

describe("findIncompleteDoneSets", () => {
  it("lists Done sets missing reps or weight, in plan order, 1-indexed", () => {
    const out = findIncompleteDoneSets(base());
    expect(out.map(o => [o.exerciseId, o.set, o.missingWeight, o.missingReps])).toEqual([
      ["a", 2, false, true],
      ["b", 2, true, false],
    ]);
    expect(out[0].name).toBe("Alpha Press");
    expect(out[1].name).toBe("b"); // no metadata → id
  });

  it("ignores sets that are not Done and accepts bodyweight (0 kg) with reps", () => {
    const s = base();
    s.log.a.sets = [{ done: true, weight_kg: 0, reps: 12 }];
    s.log.b.sets = [{ done: false, weight_kg: null, reps: null }];
    expect(findIncompleteDoneSets(s)).toEqual([]);
  });

  it("flags a Done set with 0 weight and 0 reps (buildSessionPayload drops it)", () => {
    const s = base();
    s.log.a.sets = [{ done: true, weight_kg: 0, reps: 0 }];
    s.log.b.sets = [];
    expect(findIncompleteDoneSets(s).map(o => o.bothZero)).toEqual([true]);
  });

  it("tolerates missing state", () => {
    expect(findIncompleteDoneSets({})).toEqual([]);
    expect(findIncompleteDoneSets({ selectedDay: "monday", routine: { days: {} }, log: {} })).toEqual([]);
  });

  it("describes the offender", () => {
    const [item] = findIncompleteDoneSets(base());
    expect(describeIncompleteDoneSet(item)).toBe("Alpha Press set 2 is marked Done but has no reps — fill it in or un-mark it.");
    expect(describeIncompleteDoneSet({ name: "X", set: 1, missingWeight: true, missingReps: true })).toContain("no weight and no reps");
    expect(describeIncompleteDoneSet({ name: "X", set: 1, bothZero: true })).toContain("0 weight and 0 reps");
  });
});
