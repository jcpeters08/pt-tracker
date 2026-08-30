// Selects history for the same workout type, independent of weekday.
function isIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const normalized = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .toISOString()
    .slice(0, 10);
  return normalized === value;
}

export function findPreviousExercisePerformance(lookup, { beforeDate, type, exerciseId } = {}) {
  if (!lookup || typeof lookup[Symbol.iterator] !== "function"
    || !isIsoDate(beforeDate) || typeof type !== "string" || !type || !exerciseId) return null;
  let latest = null;
  for (const [key, entry] of lookup) {
    if (entry?.kind !== "log") continue;
    const session = entry.session || {};
    const keyParts = String(key).split("|");
    const date = session.date || keyParts[0] || "";
    const sessionType = session.type || keyParts[2] || "";
    if (!isIsoDate(date) || date >= beforeDate || sessionType !== type) continue;
    if (!Array.isArray(session.exercises)) continue;
    const exercise = session.exercises.find(item => item?.exercise_id === exerciseId);
    if (!exercise || !Array.isArray(exercise.sets) || exercise.sets.length === 0) continue;
    if (!latest || date > latest.date) latest = { date, type: sessionType, exercise };
  }
  return latest;
}
