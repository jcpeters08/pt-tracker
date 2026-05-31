// Pure, DOM/state-free helpers shared by the PT Tracker web app.
// Extracted from index.html (P3 modularization) so they can be unit-tested
// (see js/util.test.js). Keep this module free of DOM, app state, and imports.

export const KG_PER_LB = 0.453592;
export const LBS_PER_KG = 2.20462;

export function kgToLbs(kg) { return kg == null ? null : kg * LBS_PER_KG; }
export function lbsToKg(lbs) { return lbs == null ? null : lbs * KG_PER_LB; }

export function roundTo(n, places) {
  if (n == null || isNaN(n)) return n;
  const p = Math.pow(10, places);
  return Math.round(n * p) / p;
}

export function fmtNum(n, places) {
  if (n == null || isNaN(n)) return "";
  const r = roundTo(n, places);
  return r === Math.trunc(r) ? String(Math.trunc(r)) : String(r);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function isoNow() { return new Date().toISOString(); }

export function localDateIso(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Slugify a routine day label → workout type key: "Push (Chest / ...)" → "push".
export function dayTypeKey(dayLabel, fallback) {
  return (dayLabel || "").toLowerCase().split("(")[0].trim().replace(/\s+/g, "-") || fallback;
}
