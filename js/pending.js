// Pending-queue pre-dedupe + append (convention #5), extracted from
// appendPending's GitHub read-modify-write. Pure: given the current entries
// and a new entry, drop any stale entry for the same slot, then append the new
// one. The GitHub GET/PUT/sha/retry around it stays in index.html (I/O).
//
// Slots: workout (log/skip) → (date, day_of_week, type); recovery →
// (date, location); routine_edit → (routine_id, day_of_week, exercise_id).
// A new log displaces a pending skip for the same slot and vice versa.
export function mergePending(entries, entry) {
  const list = Array.isArray(entries) ? entries : [];
  const ns = entry.session || {};
  const kept = list.filter(e => {
    const s = e.session || {};
    if (entry.type === "recovery") {
      if (e.type !== "recovery") return true;
      return !(s.date === ns.date && (s.location || "") === (ns.location || ""));
    }
    if (entry.type === "log" || entry.type === "skip") {
      if (e.type !== "log" && e.type !== "skip") return true;
      return !(s.date === ns.date && s.day_of_week === ns.day_of_week && s.type === ns.type);
    }
    if (entry.type === "routine_edit") {
      if (e.type !== "routine_edit") return true;
      const sig = `${entry.routine_id}|${entry.day_of_week}|${entry.exercise_id}`;
      return `${e.routine_id}|${e.day_of_week}|${e.exercise_id}` !== sig;
    }
    return true;
  });
  kept.push(entry);
  return kept;
}
