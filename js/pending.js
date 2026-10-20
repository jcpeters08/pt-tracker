// Pending-queue pre-dedupe + append (convention #5), extracted from
// appendPending's GitHub read-modify-write. Pure: given the current entries
// and a new entry, drop any stale entry for the same slot, then append the new
// one. The Worker POST around it stays in index.html (I/O).
//
// Slots: workout (log/skip) → (date, day_of_week, type); recovery →
// (date, location); routine_edit → (routine_id, day_of_week, exercise_id).
// A new log displaces a pending skip for the same slot and vice versa.

// Stable identity of the slot an entry occupies, or null when the entry is of
// an unknown type or lacks the fields that define its slot. Shared by
// mergePending and js/recent-submits.js so both agree on what "same slot" means.
export function slotKey(entry) {
  if (!entry || typeof entry !== "object") return null;
  const s = entry.session || {};
  if (entry.type === "log" || entry.type === "skip") {
    if (!s.date || !s.day_of_week) return null;
    return `workout|${s.date}|${s.day_of_week}|${s.type || ""}`;
  }
  if (entry.type === "recovery") {
    if (!s.date) return null;
    return `recovery|${s.date}|${s.location || ""}`;
  }
  if (entry.type === "routine_edit") {
    if (!entry.routine_id || !entry.day_of_week || !entry.exercise_id) return null;
    return `routine_edit|${entry.routine_id}|${entry.day_of_week}|${entry.exercise_id}`;
  }
  return null;
}

export function mergePending(entries, entry) {
  const list = Array.isArray(entries) ? entries : [];
  const key = slotKey(entry);
  const kept = key == null ? [...list] : list.filter(e => slotKey(e) !== key);
  kept.push(entry);
  return kept;
}
