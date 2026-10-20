import { describe, it, expect } from "vitest";
import {
  actualVsPlannedRows,
  bodyAreaForExercise,
  calendarCells,
  escapeHtml,
  muscleTargetBandRows,
  monthCalendarCells,
  personalRecordRowsHtml,
  prDeltaText,
  targetAchievementRows,
  recoveryCorrelationRows,
  renderSections,
  reportRoutineId,
  staleLiftRows,
} from "./reports.js";
import { formatTargetText } from "./workout.js";

describe("reports escaping", () => {
  it("escapes all dynamic PR fields before table rendering", () => {
    const html = personalRecordRowsHtml([
      {
        exercise_id: "evil",
        date: "2026-05-31<script>",
        type: "load_pr",
        weight_kg: 10,
        reps: "8&9",
        delta_kg: 2,
      },
    ], { evil: "<img src=x onerror=alert(1)>" });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("2026-05-31&lt;script&gt;");
    expect(html).toContain("22 lbs");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
  });

  it("escapeHtml handles quotes and ampersands", () => {
    expect(escapeHtml(`a&b"'<>`)).toBe("a&amp;b&quot;&#39;&lt;&gt;");
  });
});

describe("PR pounds display", () => {
  it("renders load and volume PR deltas in pounds", () => {
    expect(prDeltaText({ type: "load_pr", delta_kg: 2.27 })).toBe("+5 lbs");
    expect(prDeltaText({ type: "volume_pr", delta_volume_kg: 45.36 })).toBe("+100 lbs volume");
  });

  it("groups exercises into readable body areas", () => {
    expect(bodyAreaForExercise({ primary_muscle: "triceps" })).toBe("Arms");
    expect(bodyAreaForExercise({ primary_muscle: "rear-delts" })).toBe("Shoulders");
    expect(bodyAreaForExercise({ primary_muscle: "quads" })).toBe("Lower Body");
  });
});

describe("calendarCells", () => {
  it("marks logged session dates and keeps the date label", () => {
    const cells = calendarCells(["2026-05-18", "2026-05-20"], "2026-05-18", "2026-05-24");
    expect(cells).toHaveLength(7);
    expect(cells[0]).toMatchObject({ date: "2026-05-18", day: "18", hasSession: true });
    expect(cells[1]).toMatchObject({ date: "2026-05-19", day: "19", hasSession: false });
    expect(cells[2]).toMatchObject({ date: "2026-05-20", day: "20", hasSession: true });
  });

  it("builds a month grid with leading blanks and recovery markers", () => {
    const cells = monthCalendarCells(["2026-06-01", "2026-06-03"], ["2026-06-02"], "2026-06");
    expect(cells).toHaveLength(35);
    expect(cells[0]).toMatchObject({ date: null, inMonth: false });
    expect(cells[1]).toMatchObject({ date: "2026-06-01", day: "1", inMonth: true, hasSession: true });
    expect(cells[2]).toMatchObject({ date: "2026-06-02", hasRecovery: true });
    expect(cells[3]).toMatchObject({ date: "2026-06-03", hasSession: true });
  });
});

describe("workout target display", () => {
  it("preserves authored pound targets instead of re-rounding from stored kg", () => {
    expect(formatTargetText({
      target_weight_kg: 11,
      target_weight_raw: "25 lbs (11 kg)",
      target_reps: 12,
      target_sets: 3,
    })).toBe("25 lbs (11 kg) × 12 × 3");
  });
});

describe("decision report helpers", () => {
  const routine = {
    id: "2026-W23",
    start_date: "2026-06-01",
    end_date: "2026-06-07",
    days: {
      monday: { label: "Push", exercises: [
        { exercise_id: "bench", target_weight_kg: 10, target_reps: 10, target_sets: 2 },
        { exercise_id: "fly", target_weight_kg: 5, target_reps: 12, target_sets: 2 },
        { exercise_id: "triceps", target_weight_kg: 11, target_weight_raw: "25 lbs (11 kg)", target_reps: 12, target_sets: 1 },
      ] },
      tuesday: { label: "Pull", exercises: [
        { exercise_id: "row", target_weight_kg: 20, target_reps: 10, target_sets: 3 },
      ] },
    },
  };
  const logs = [{
    date: "2026-06-02",
    day_of_week: "monday",
    type: "push",
    exercises: [
      { exercise_id: "bench", sets: [{ weight_kg: 10, reps: 11 }, { weight_kg: 10, reps: 10 }] },
      { exercise_id: "fly", sets: [{ weight_kg: 5, reps: 10 }] },
      { exercise_id: "triceps", sets: [{ weight_kg: 11.3, reps: 12 }] },
    ],
  }];
  const names = { bench: "Bench", fly: "Fly", row: "Row", triceps: "Triceps" };

  it("finds latest logs that met the programmed target without implying an automatic load increase", () => {
    const rows = targetAchievementRows(logs, [routine], names);
    expect(rows.find(row => row.exercise === "Bench")).toMatchObject({
      target: "22 lbs × 10 × 2",
      actual: "22 lbs × 11/10",
      signal: "Programmed target met",
    });
    expect(rows.find(row => row.exercise === "Triceps")).toMatchObject({
      target: "25 lbs × 12 × 1",
      actual: "25 lbs × 12",
      signal: "Programmed target met",
    });
  });

  it("compares planned routine days with completed logs", () => {
    const rows = actualVsPlannedRows([routine], logs, names, "2026-W23");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "Monday", status: "Done", completed_exercises: 3, planned_exercises: 3 });
    expect(rows[1]).toMatchObject({ day: "Tuesday", status: "Open", completed_exercises: 0, planned_exercises: 1 });
  });

  it("summarizes body-area volume against target bands", () => {
    const rows = muscleTargetBandRows({
      weekly_volume_by_muscle: [
        { week: "2026-W23", muscle: "chest", sets: 7 },
        { week: "2026-W23", muscle: "triceps", sets: 2 },
      ],
    }, "2026-W23");
    expect(rows.find(r => r.area === "Chest")).toMatchObject({ sets: 7, status: "In range" });
    expect(rows.find(r => r.area === "Arms")).toMatchObject({ sets: 2, status: "Low" });
  });

  it("flags active routine lifts not trained recently", () => {
    const rows = staleLiftRows([routine], logs, names, "2026-06-10");
    expect(rows.find(r => r.exercise === "Row")).toMatchObject({ last_seen: "Never", stale_days: null, severity: "Never logged" });
    expect(rows.find(r => r.exercise === "Bench")).toMatchObject({ last_seen: "2026-06-02", stale_days: 8, severity: "7+ days" });
  });

  it("combines compliance, recovery, and PR counts by week", () => {
    const rows = recoveryCorrelationRows({
      session_compliance: { "2026-W23": { planned: 5, completed: 4, completion_rate: 0.8 } },
      recovery_by_week: { "2026-W23": { sessions: 2, sauna_min_total: 60, plunge_min_total: 12 } },
      personal_records: [{ date: "2026-06-03" }, { date: "2026-06-08" }],
    });
    expect(rows[0]).toMatchObject({ week: "2026-W23", compliance: "4/5", recovery: "2 sessions", prs: 1 });
  });
});

describe("report routine selection", () => {
  // Windows as sync.py derives them: end_date = day before the next start; latest open-ended.
  const routines = [
    { id: "2026-W40-Return", start_date: "2026-09-28", end_date: "2026-10-05" },
    { id: "2026-W41-Rebuild", start_date: "2026-10-06", end_date: "2026-10-11" },
    { id: "2026-W42-Full-Load", start_date: "2026-10-12", end_date: "2026-10-18" },
    { id: "2026-W43-Progression", start_date: "2026-10-19", end_date: null },
  ];

  it("keys on the routine whose window covers the latest log date, not a stale profile pointer", () => {
    const logs = [{ date: "2026-10-13" }, { date: "2026-10-19" }, { date: "2026-10-15" }];
    expect(reportRoutineId(routines, logs, "2026-10-20")).toBe("2026-W43-Progression");
  });

  it("falls back to today's routine when nothing is logged yet", () => {
    expect(reportRoutineId(routines, [], "2026-10-07")).toBe("2026-W41-Rebuild");
  });

  it("uses the latest routine started before the log when the log date falls in a gap", () => {
    const gapped = routines.filter(r => r.id !== "2026-W41-Rebuild"); // 10/06–10/11 uncovered
    expect(reportRoutineId(gapped, [{ date: "2026-10-08" }], "2026-10-20")).toBe("2026-W40-Return");
  });

  it("returns null when there are no routines", () => {
    expect(reportRoutineId([], [{ date: "2026-10-08" }], "2026-10-20")).toBeNull();
  });
});

describe("renderSections", () => {
  it("keeps rendering later sections after one throws and reports the failure", () => {
    const calls = [];
    const failures = [];
    const result = renderSections([
      { name: "Weekly volume", render: () => calls.push("volume") },
      { name: "Lift progression", render: () => { throw new Error("Chart is not defined"); } },
      { name: "PRs", render: () => calls.push("prs") },
    ], { onError: (section, error) => failures.push([section.name, error.message]) });
    expect(calls).toEqual(["volume", "prs"]);
    expect(failures).toEqual([["Lift progression", "Chart is not defined"]]);
    expect(result.rendered).toEqual(["Weekly volume", "PRs"]);
    expect(result.failed.map(f => f.name)).toEqual(["Lift progression"]);
  });

  it("does not let a throwing onError handler abort the remaining sections", () => {
    const calls = [];
    const result = renderSections([
      { name: "a", render: () => { throw new Error("boom"); } },
      { name: "b", render: () => calls.push("b") },
    ], { onError: () => { throw new Error("handler broke"); } });
    expect(calls).toEqual(["b"]);
    expect(result.failed.map(f => f.name)).toEqual(["a"]);
  });
});
