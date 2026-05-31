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
