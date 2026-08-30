import { describe, it, expect } from "vitest";
import { formatHistoryDate, formatLoggedPerformance } from "./workout.js";

describe("formatLoggedPerformance", () => {
  it("compacts equal canonical loads into one weight and a rep sequence", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 24.95, reps: 12 },
      { weight_kg: 24.95, reps: 10 },
      { weight_kg: 24.95, reps: 10 },
    ] } }, "lbs")).toBe("55 lbs × 12/10/10");
  });

  it("does not compact different canonical loads that round to the same displayed pounds", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 24.91, reps: 12 },
      { weight_kg: 24.94, reps: 10 },
    ] } }, "lbs")).toBe("55 lbs × 12 · 55 lbs × 10");
  });

  it("renders missing values as unknown while preserving available reps", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: null, reps: 12 },
      { reps: null },
    ] } }, "lbs")).toBe("? × 12/?");
  });

  it("treats malformed nonnumeric reps as unknown", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 25, reps: "twelve" },
      { weight_kg: 25, reps: Number.NaN },
    ] } }, "lbs")).toBe("55 lbs × ?/?");
  });

  it("labels only numeric zero as bodyweight", () => {
    expect(formatLoggedPerformance({ exercise: { sets: [
      { weight_kg: 0, reps: 12 },
      { weight_kg: 0, reps: 12 },
    ] } }, "kg")).toBe("bodyweight × 12/12");
  });

  it("returns an empty string for a non-array set history", () => {
    expect(formatLoggedPerformance({ exercise: { sets: {} } }, "lbs")).toBe("");
  });
});

describe("formatHistoryDate", () => {
  it("formats an ISO date without timezone drift", () => {
    expect(formatHistoryDate("2026-08-24")).toBe("Aug 24");
  });

  it("omits malformed dates", () => {
    expect(formatHistoryDate("not-a-date")).toBe("");
    expect(formatHistoryDate("2026-02-31")).toBe("");
  });
});
