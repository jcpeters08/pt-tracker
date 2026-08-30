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
