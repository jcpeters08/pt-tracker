export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function prTypeLabel(type) {
  return {
    load_pr: "Load",
    rep_pr: "Reps",
    volume_pr: "Volume",
  }[type] || String(type || "PR");
}

const LBS_PER_KG = 2.20462;

function kgToLbs(kg) {
  const n = Number(kg);
  return Number.isFinite(n) ? n * LBS_PER_KG : null;
}

function fmtLbsFromKg(kg) {
  const lbs = kgToLbs(kg);
  return lbs == null ? "" : `${Math.round(lbs)} lbs`;
}

function fmtTargetLbs(ex) {
  const raw = String(ex?.target_weight_raw || "");
  const match = raw.match(/(\d+(?:\.\d+)?)\s*lbs?/i);
  return match ? `${Number(match[1])} lbs` : fmtLbsFromKg(ex?.target_weight_kg);
}

function isoDateMs(dateStr) {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

function titleCaseDay(day) {
  return String(day || "").slice(0, 1).toUpperCase() + String(day || "").slice(1);
}

export function prDeltaText(record) {
  if (record.type === "load_pr") return `+${fmtLbsFromKg(record.delta_kg)}`;
  if (record.type === "rep_pr") return `+${record.delta_reps} reps`;
  if (record.type === "volume_pr") return `+${fmtLbsFromKg(record.delta_volume_kg)} volume`;
  if (record.delta_kg != null) return `+${fmtLbsFromKg(record.delta_kg)}`;
  return "";
}

export function personalRecordRowsHtml(records, exerciseNames = {}) {
  return (records || []).map(p => `
    <tr>
      <td>${escapeHtml(exerciseNames[p.exercise_id] || p.exercise_id)}</td>
      <td>${escapeHtml(p.date)}</td>
      <td>${escapeHtml(prTypeLabel(p.type))}</td>
      <td>${escapeHtml(fmtLbsFromKg(p.weight_kg))} × ${escapeHtml(p.reps ?? "")}</td>
      <td class="delta">${escapeHtml(prDeltaText(p))}</td>
    </tr>
  `).join("");
}

const BODY_AREA_BY_MUSCLE = {
  chest: "Chest",
  back: "Back",
  lats: "Back",
  "lower-back": "Back",
  shoulders: "Shoulders",
  "front-delts": "Shoulders",
  "lateral-delts": "Shoulders",
  "rear-delts": "Shoulders",
  traps: "Shoulders",
  biceps: "Arms",
  triceps: "Arms",
  forearms: "Arms",
  quads: "Lower Body",
  hamstrings: "Lower Body",
  glutes: "Lower Body",
  calves: "Lower Body",
  "glute-medius": "Lower Body",
  tfl: "Lower Body",
  core: "Core",
  obliques: "Core",
};

export function bodyAreaForExercise(exercise = {}) {
  return BODY_AREA_BY_MUSCLE[exercise.primary_muscle] || "Other";
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function calendarCells(sessionDates, startDate, endDate) {
  const sessionSet = new Set(sessionDates || []);
  const cells = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    cells.push({
      date: d,
      day: String(Number(d.slice(8, 10))),
      hasSession: sessionSet.has(d),
    });
  }
  return cells;
}

export function monthCalendarCells(sessionDates, recoveryDates, month) {
  const sessionSet = new Set(sessionDates || []);
  const recoverySet = new Set(recoveryDates || []);
  const [year, monthNum] = String(month || "").split("-").map(Number);
  if (!year || !monthNum) return [];
  const first = new Date(Date.UTC(year, monthNum - 1, 1));
  const firstDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: null, day: "", inMonth: false, hasSession: false, hasRecovery: false });
      continue;
    }
    const date = `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    cells.push({
      date,
      day: String(dayNum),
      inMonth: true,
      hasSession: sessionSet.has(date),
      hasRecovery: recoverySet.has(date),
    });
  }
  return cells;
}

export function weekRangeFromIso(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(week || "");
  if (!m) return null;
  const year = Number(m[1]);
  const weekNum = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNum - 1) * 7);
  const start = monday.toISOString().slice(0, 10);
  const end = addDays(start, 6);
  return { start, end };
}

function routineForDate(routines, date) {
  return (routines || []).find(r => {
    const start = r.start_date || "";
    const end = r.end_date || "9999-12-31";
    return start && date >= start && date <= end;
  }) || null;
}

function latestRoutine(routines) {
  return [...(routines || [])]
    .filter(r => r.start_date)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
    .pop() || null;
}

function targetForLogExercise(log, routines, exerciseId) {
  const routine = routineForDate(routines, log.date);
  const day = routine?.days?.[log.day_of_week];
  return (day?.exercises || []).find(ex => ex.exercise_id === exerciseId) || null;
}

function actualRepsText(sets) {
  return (sets || []).map(s => s.reps ?? "?").join("/");
}

export function readinessRows(logs, routines, exerciseNames = {}) {
  const latestByExercise = new Map();
  for (const log of logs || []) {
    for (const ex of log.exercises || []) {
      const prior = latestByExercise.get(ex.exercise_id);
      if (!prior || String(log.date).localeCompare(prior.log.date) > 0) {
        latestByExercise.set(ex.exercise_id, { log, ex });
      }
    }
  }
  const rows = [];
  for (const [exerciseId, item] of latestByExercise) {
    const target = targetForLogExercise(item.log, routines, exerciseId);
    if (!target || !target.target_sets || !target.target_reps) continue;
    const sets = item.ex.sets || [];
    const counted = sets.slice(0, target.target_sets);
    const targetWeight = target.target_weight_kg || 0;
    const hitSets = counted.length >= target.target_sets
      && counted.every(s => (s.reps || 0) >= target.target_reps && (s.weight_kg || 0) >= targetWeight);
    if (!hitSets) continue;
    rows.push({
      exercise_id: exerciseId,
      exercise: exerciseNames[exerciseId] || exerciseId,
      date: item.log.date,
      target: `${fmtTargetLbs(target)} × ${target.target_reps} × ${target.target_sets}`,
      actual: `${fmtLbsFromKg(counted[0]?.weight_kg)} × ${actualRepsText(counted)}`,
      signal: `Hit target across ${target.target_sets} sets`,
    });
  }
  return rows.sort((a, b) => a.exercise.localeCompare(b.exercise));
}

export function actualVsPlannedRows(routines, logs, exerciseNames = {}, week) {
  const routine = week
    ? (routines || []).find(r => r.start_date && weekRangeFromIso(week) && r.start_date >= weekRangeFromIso(week).start && r.start_date <= weekRangeFromIso(week).end)
    : latestRoutine(routines);
  if (!routine) return [];
  const byDay = new Map((logs || [])
    .filter(l => l.date >= routine.start_date && l.date <= (routine.end_date || "9999-12-31"))
    .map(l => [l.day_of_week, l]));
  return Object.entries(routine.days || {})
    .filter(([, day]) => (day.exercises || []).length)
    .map(([dayKey, day]) => {
      const log = byDay.get(dayKey);
      return {
        day: titleCaseDay(dayKey),
        type: day.label || dayKey,
        status: log ? "Done" : "Open",
        planned_exercises: (day.exercises || []).length,
        completed_exercises: (log?.exercises || []).length,
        planned: (day.exercises || []).slice(0, 3).map(ex => exerciseNames[ex.exercise_id] || ex.exercise_id).join(", "),
        completed: (log?.exercises || []).slice(0, 3).map(ex => exerciseNames[ex.exercise_id] || ex.exercise_id).join(", "),
      };
    });
}

const BODY_AREA_TARGETS = {
  Chest: [6, 12],
  Back: [8, 16],
  Shoulders: [6, 14],
  Arms: [4, 12],
  "Lower Body": [10, 20],
  Core: [3, 10],
  Other: [0, 99],
};

export function muscleTargetBandRows(analytics, week) {
  const rows = {};
  for (const [area, [min, max]] of Object.entries(BODY_AREA_TARGETS)) {
    rows[area] = { area, sets: 0, min, max, status: "Low" };
  }
  for (const row of analytics.weekly_volume_by_muscle || []) {
    if (row.week !== week) continue;
    const area = BODY_AREA_BY_MUSCLE[row.muscle] || "Other";
    rows[area] ||= { area, sets: 0, min: 0, max: 99, status: "Low" };
    rows[area].sets += row.sets || 0;
  }
  return Object.values(rows).map(row => ({
    ...row,
    status: row.sets < row.min ? "Low" : row.sets > row.max ? "High" : "In range",
  }));
}

export function staleLiftRows(routines, logs, exerciseNames = {}, referenceDate) {
  const routine = latestRoutine(routines);
  if (!routine) return [];
  const activeIds = new Set();
  for (const day of Object.values(routine.days || {})) {
    for (const ex of day.exercises || []) activeIds.add(ex.exercise_id);
  }
  const lastSeen = new Map();
  for (const log of logs || []) {
    for (const ex of log.exercises || []) {
      if (!activeIds.has(ex.exercise_id)) continue;
      if (!lastSeen.has(ex.exercise_id) || log.date > lastSeen.get(ex.exercise_id)) {
        lastSeen.set(ex.exercise_id, log.date);
      }
    }
  }
  const ref = referenceDate || (logs || []).map(l => l.date).filter(Boolean).sort().pop() || routine.start_date;
  return [...activeIds].map(id => {
    const seen = lastSeen.get(id);
    const staleDays = seen ? Math.floor((isoDateMs(ref) - isoDateMs(seen)) / 86400000) : null;
    return {
      exercise_id: id,
      exercise: exerciseNames[id] || id,
      last_seen: seen || "Never",
      stale_days: staleDays,
      severity: staleDays == null ? "Never logged" : staleDays >= 21 ? "21+ days" : staleDays >= 14 ? "14+ days" : staleDays >= 7 ? "7+ days" : "Current",
    };
  }).filter(row => row.severity !== "Current")
    .sort((a, b) => (b.stale_days ?? 9999) - (a.stale_days ?? 9999));
}

export function recoveryCorrelationRows(analytics) {
  const weeks = Object.keys(analytics.session_compliance || {}).sort().reverse();
  return weeks.map(week => {
    const compliance = analytics.session_compliance?.[week] || {};
    const recovery = analytics.recovery_by_week?.[week] || {};
    const range = weekRangeFromIso(week);
    const prs = (analytics.personal_records || []).filter(p => range && p.date >= range.start && p.date <= range.end).length;
    return {
      week,
      compliance: compliance.planned ? `${compliance.completed || 0}/${compliance.planned}` : `${compliance.completed || 0} logged`,
      completion_rate: compliance.completion_rate == null ? null : Math.round(compliance.completion_rate * 100),
      recovery: `${recovery.sessions || 0} sessions`,
      recovery_minutes: (recovery.sauna_min_total || 0) + (recovery.plunge_min_total || 0),
      prs,
    };
  });
}
