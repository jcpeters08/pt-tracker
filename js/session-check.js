// Pre-submit validation for the in-progress workout log. Pure: takes the shared
// state object, returns data. buildSessionPayload silently drops Done sets that
// have no reps or no weight (they can't be rendered to the vault), so the
// submit handler refuses to submit while any exist instead of losing them.
export function findIncompleteDoneSets(state) {
  const day = state?.routine?.days?.[state?.selectedDay];
  const out = [];
  for (const planEx of (day?.exercises || [])) {
    const log = state.log?.[planEx.exercise_id];
    if (!log) continue;
    log.sets.forEach((s, i) => {
      if (!s.done) return;
      const missingWeight = s.weight_kg === null || s.weight_kg === undefined;
      const missingReps = s.reps === null || s.reps === undefined;
      const bothZero = !missingWeight && !missingReps && s.weight_kg === 0 && s.reps === 0;
      if (missingWeight || missingReps || bothZero) {
        const name = state.exercises?.[planEx.exercise_id]?.name || planEx.exercise_id;
        out.push({ exerciseId: planEx.exercise_id, name, set: i + 1, missingWeight, missingReps, bothZero });
      }
    });
  }
  return out;
}

// Short human message for the first offender: "Incline DB Bench Press set 2 is Done but has no reps".
export function describeIncompleteDoneSet(item) {
  const what = item.bothZero ? "0 weight and 0 reps" : [item.missingWeight && "no weight", item.missingReps && "no reps"].filter(Boolean).join(" and ");
  return `${item.name} set ${item.set} is marked Done but has ${what} — fill it in or un-mark it.`;
}
