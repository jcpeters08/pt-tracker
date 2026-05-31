import { describe, it, expect } from "vitest";
import { buildSessionPayload, buildSkipPayload, buildRecoveryPayload } from "./payloads.js";

const NOW = "2026-05-31T12:00:00Z";

function baseState(over = {}) {
  return {
    workoutDate: "2026-05-18",
    selectedDay: "monday",
    sessionNotes: "",
    routine: {
      id: "2026-W21-x", phase: "2",
      days: { monday: { label: "Push (Chest / Triceps)", exercises: [{ exercise_id: "flat-db-bench-press" }] } },
    },
    log: {},
    exercises: { "flat-db-bench-press": { name: "Flat DB Bench Press", primary_muscle: "chest" } },
    cooldownLog: {},
    ...over,
  };
}

describe("buildSessionPayload", () => {
  it("includes only Done sets and derives type/date/muscle from state", () => {
    const state = baseState({
      log: { "flat-db-bench-press": { notes: "felt good", sets: [
        { done: true, weight_kg: 16, reps: 10 },
        { done: false, weight_kg: 18, reps: 8 }, // not done → excluded
        { done: true, weight_kg: 0, reps: 0 },   // empty → excluded
      ] } },
    });
    const p = buildSessionPayload(state, NOW);
    expect(p).toMatchObject({ type: "log", submitted_at: NOW });
    expect(p.session).toMatchObject({ date: "2026-05-18", type: "push", muscle_groups: ["chest"] });
    expect(p.session.exercises).toHaveLength(1);
    expect(p.session.exercises[0]).toMatchObject({
      exercise_id: "flat-db-bench-press", display_name: "Flat DB Bench Press", notes: "felt good",
    });
    expect(p.session.exercises[0].sets).toEqual([{ set: 1, weight_kg: 16, reps: 10 }]);
  });

  it("omits exercises with no Done sets", () => {
    const state = baseState({ log: { "flat-db-bench-press": { sets: [{ done: false, weight_kg: 16, reps: 10 }] } } });
    expect(buildSessionPayload(state, NOW).session.exercises).toEqual([]);
  });
});

describe("buildSkipPayload", () => {
  it("uses the selected date and trims the reason from session notes (P1.1)", () => {
    const state = baseState({ workoutDate: "2026-05-04", sessionNotes: "  travel  " });
    const p = buildSkipPayload(state, NOW);
    expect(p).toMatchObject({ type: "skip", submitted_at: NOW });
    expect(p.session).toMatchObject({ date: "2026-05-04", type: "push", day_of_week: "monday", reason: "travel" });
  });
});

describe("buildRecoveryPayload", () => {
  it("derives rounds_detail, total, and rounded per-round averages", () => {
    const p = buildRecoveryPayload({
      date: "2026-05-14", location: "Embrace North", notes: "good",
      rounds: [{ sauna_min: 18, plunge_min: 4 }, { sauna_min: 17, plunge_min: 4 }], now: NOW,
    });
    expect(p).toMatchObject({ type: "recovery", submitted_at: NOW });
    expect(p.session).toMatchObject({
      date: "2026-05-14", location: "Embrace North", rounds: 2,
      sauna_min: 18, plunge_min: 4, total_min: 43, notes: "good",
    });
    expect(p.session.rounds_detail).toEqual([
      { round: 1, sauna_min: 18, plunge_min: 4 },
      { round: 2, sauna_min: 17, plunge_min: 4 },
    ]);
  });
});
