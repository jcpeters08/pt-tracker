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

export function prDeltaText(record) {
  if (record.type === "load_pr") return `+${record.delta_kg} kg`;
  if (record.type === "rep_pr") return `+${record.delta_reps} reps`;
  if (record.type === "volume_pr") return `+${record.delta_volume_kg} kg volume`;
  if (record.delta_kg != null) return `+${record.delta_kg} kg`;
  return "";
}

export function personalRecordRowsHtml(records, exerciseNames = {}) {
  return (records || []).map(p => `
    <tr>
      <td>${escapeHtml(exerciseNames[p.exercise_id] || p.exercise_id)}</td>
      <td>${escapeHtml(p.date)}</td>
      <td>${escapeHtml(prTypeLabel(p.type))}</td>
      <td>${escapeHtml(p.weight_kg ?? "")} kg × ${escapeHtml(p.reps ?? "")}</td>
      <td class="delta">${escapeHtml(prDeltaText(p))}</td>
    </tr>
  `).join("");
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
