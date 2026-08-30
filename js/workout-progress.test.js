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
