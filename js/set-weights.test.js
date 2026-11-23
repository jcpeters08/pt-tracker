import { describe, it, expect } from "vitest";
import { applySetWeightEdit } from "./set-weights.js";

// Seeded rows as ensureLogState builds them from a routine target.
const seeded = (kg, n = 3) => Array.from({ length: n }, () => ({ weight_kg: kg, reps: 12, done: false }));

describe("applySetWeightEdit", () => {
  it("carries a set-1 weight edit to later sets still on the seeded target", () => {
    // W47 lateral raise: target 15 lbs, Jonathan lifted 10 on every set.
    const sets = seeded(6.8);
    const carried = applySetWeightEdit(sets, 0, 4.54);
    expect(sets.map(s => s.weight_kg)).toEqual([4.54, 4.54, 4.54]);
    expect(carried).toEqual([1, 2]);
  });

  it("carries into later sets already marked Done when their weight is untouched", () => {
    const sets = seeded(43.09);
    sets[1].done = true;
    applySetWeightEdit(sets, 0, 45.36);
    expect(sets[1]).toMatchObject({ weight_kg: 45.36, done: true });
    expect(sets[2].weight_kg).toBe(45.36);
  });

  it("marks only the edited set as user-edited", () => {
    const sets = seeded(20);
    applySetWeightEdit(sets, 0, 25);
    expect(sets.map(s => !!s.weight_edited)).toEqual([true, false, false]);
  });

  it("never overwrites a later set the user typed a weight into", () => {
    const sets = seeded(49.9);
    applySetWeightEdit(sets, 2, 59);
    applySetWeightEdit(sets, 0, 54.43);
    expect(sets.map(s => s.weight_kg)).toEqual([54.43, 54.43, 59]);
  });

  it("stops at the first user-edited later set so a drop set keeps its tail", () => {
    // 10/8 squat 110/130/130, with set 2 typed before set 1.
    const sets = seeded(52.16);
    applySetWeightEdit(sets, 1, 58.97);
    expect(sets.map(s => s.weight_kg)).toEqual([52.16, 58.97, 58.97]);
    applySetWeightEdit(sets, 0, 49.9);
    expect(sets.map(s => s.weight_kg)).toEqual([49.9, 58.97, 58.97]);
  });

  it("never changes earlier sets", () => {
    const sets = seeded(20);
    applySetWeightEdit(sets, 1, 25);
    expect(sets.map(s => s.weight_kg)).toEqual([20, 25, 25]);
  });

  it("does not carry a cleared weight forward", () => {
    const sets = seeded(20);
    const carried = applySetWeightEdit(sets, 0, null);
    expect(sets.map(s => s.weight_kg)).toEqual([null, 20, 20]);
    expect(sets[0].weight_edited).toBe(true);
    expect(carried).toEqual([]);
  });

  it("keeps the user-edited flag through a JSON draft round trip", () => {
    const sets = seeded(20);
    applySetWeightEdit(sets, 1, 25);
    const restored = JSON.parse(JSON.stringify({ log: { ex: { sets } } })).log.ex.sets;
    applySetWeightEdit(restored, 0, 22.68);
    expect(restored.map(s => s.weight_kg)).toEqual([22.68, 25, 25]);
  });

  it("ignores an out-of-range set index", () => {
    const sets = seeded(20);
    expect(applySetWeightEdit(sets, 5, 25)).toEqual([]);
    expect(sets.map(s => s.weight_kg)).toEqual([20, 20, 20]);
  });
});
