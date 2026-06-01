// Pending-entry payload builders, extracted from index.html's submit handlers.
// Pure given their inputs (state object, or gathered values) — no DOM, no I/O —
// so the exact shape written to data/pending.json is unit-testable.
import { isoNow, localDateIso, dayTypeKey } from "./util.js";

function workoutPayloadDate(state) {
  if (state.activeSession?.kind === "log") {
    return state.activeSession.resolvedDate || state.activeSession.session?.date || state.workoutDate || localDateIso();
  }
  return state.workoutDate || localDateIso();
}

// Workout log payload. Only sets explicitly marked Done count as real work.
export function buildSessionPayload(state, now = isoNow()) {
  const day = state.routine?.days?.[state.selectedDay];
  const sessionDate = workoutPayloadDate(state);
  const muscleSet = new Set();
  const exercises = [];
  for (const planEx of (day?.exercises || [])) {
    const log = state.log[planEx.exercise_id];
    if (!log) continue;
    const doneSets = log.sets
      .filter(s => s.done && s.weight_kg !== null && s.reps !== null && (s.weight_kg !== 0 || s.reps !== 0))
      .map((s, i) => ({ set: i + 1, weight_kg: s.weight_kg, reps: s.reps }));
    if (!doneSets.length) continue;
    const meta = state.exercises[planEx.exercise_id];
    if (meta?.primary_muscle) muscleSet.add(meta.primary_muscle);
    exercises.push({
      exercise_id: planEx.exercise_id,
      display_name: meta?.name || planEx.exercise_id,
      sets: doneSets,
      notes: log.notes || "",
    });
  }
  const selectedCooldownKey = `${state.workoutDate || ""}|${state.selectedDay || ""}`;
  const resolvedCooldownKey = `${sessionDate}|${state.selectedDay || ""}`;
  const cdLog = state.cooldownLog?.[selectedCooldownKey] || state.cooldownLog?.[resolvedCooldownKey];
  const cooldown = (cdLog && cdLog.completed_at) ? {
    type: cdLog.type,
    source_key: cdLog.source_key || null,
    fitnessplus_name: cdLog.fitnessplus_name || "",
    completed_at: cdLog.completed_at,
  } : null;
  return {
    type: "log",
    submitted_at: now,
    session: {
      date: sessionDate,
      submitted_at: now,
      day_of_week: state.selectedDay,
      type: dayTypeKey(state.routine?.days?.[state.selectedDay]?.label, state.selectedDay),
      muscle_groups: [...muscleSet],
      routine_id: state.routine?.id,
      phase: state.routine?.phase || null,
      exercises,
      cooldown,
      session_notes: state.sessionNotes || "",
    },
  };
}

// Skip-marker payload. Uses the SELECTED workout date (P1.1), not today.
export function buildSkipPayload(state, now = isoNow()) {
  const day = state.routine?.days?.[state.selectedDay];
  return {
    type: "skip",
    submitted_at: now,
    session: {
      date: state.workoutDate || localDateIso(),
      submitted_at: now,
      day_of_week: state.selectedDay,
      type: dayTypeKey(day?.label, state.selectedDay),
      routine_id: state.routine?.id,
      phase: state.routine?.phase || null,
      reason: (state.sessionNotes || "").trim(),
    },
  };
}

// Recovery (sauna/plunge) payload. Caller gathers the DOM fields; this derives
// rounds_detail, total, and the rounded per-round averages (legacy summary).
export function buildRecoveryPayload({ date, location, notes, rounds, now = isoNow() }) {
  const detail = (rounds || []).map((r, i) => ({
    round: i + 1,
    sauna_min: r.sauna_min ?? 0,
    plunge_min: r.plunge_min ?? 0,
  }));
  const total_min = detail.reduce((s, r) => s + (r.sauna_min || 0) + (r.plunge_min || 0), 0);
  const n = detail.length || 1;
  const sauna_avg = Math.round(detail.reduce((s, r) => s + (r.sauna_min || 0), 0) / n);
  const plunge_avg = Math.round(detail.reduce((s, r) => s + (r.plunge_min || 0), 0) / n);
  return {
    type: "recovery",
    submitted_at: now,
    session: {
      date,
      location,
      rounds: detail.length,
      sauna_min: sauna_avg,
      plunge_min: plunge_avg,
      total_min,
      rounds_detail: detail,
      notes,
      submitted_at: now,
    },
  };
}
