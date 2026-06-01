// Active-routine selection — the pure logic behind index.html's
// pickRoutineForDate (a thin wrapper there reads it from state/localStorage).
// Given routine ids, their metadata ({id, start_date, end_date}), an optional
// pinned id, and a date, choose the routine that should be active.
//
// Rules (cf. C9 / A2): honor a user pin only while it's still date-valid; else
// the latest routine whose [start_date, end_date] window covers the date;
// else the latest routine that started on/before the date; else the last id.
export function selectRoutineForDate({ date, routines = [], meta = [], pinned = null }) {
  const inWindow = (m) => {
    if (!m.start_date) return false;
    if (m.start_date > date) return false;
    if (m.end_date && m.end_date < date) return false;
    return true;
  };

  if (pinned && routines.includes(pinned)) {
    const m = meta.find(x => x.id === pinned);
    if (m && inWindow(m)) return pinned;
  }

  const covering = meta.filter(inWindow);
  if (covering.length) {
    covering.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
    return covering[0].id;
  }

  const past = meta.filter(m => m.start_date && m.start_date <= date);
  if (past.length) {
    past.sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
    return past[0].id;
  }

  return routines.slice().sort().pop();
}

// Resolve which logged/pending session to show for a (date, day, type) view.
// Prefers an exact date match; otherwise the latest LOGGED session for the same
// day-of-week + type within the routine week [weekStart, weekEnd] — so a workout
// performed on a different date than its nominal day (a catch-up: e.g. Monday's
// session actually done Tuesday) still surfaces when you tap that day pill.
// `lookup` is a Map keyed "date|day|type" → entry ({ kind, session, … }).
export function resolveSessionForView(lookup, { date, day, type, weekStart, weekEnd } = {}) {
  if (!lookup || !day) return null;
  const exact = lookup.get(`${date}|${day}|${type}`);
  if (exact) return { ...exact, resolvedDate: date, isFallback: false };
  if (!weekStart) return null;
  const end = weekEnd || "9999-12-31";
  let best = null;                          // latest LOGGED match within the week
  for (const [k, v] of lookup) {
    if (!v || v.kind !== "log") continue;
    const [d, dow, t] = k.split("|");
    if (dow === day && t === type && d >= weekStart && d <= end) {
      if (!best || d > best.date) best = { date: d, entry: v };
    }
  }
  return best ? { ...best.entry, resolvedDate: best.date, isFallback: true } : null;
}
