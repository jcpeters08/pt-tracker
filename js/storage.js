// Draft GC + submit-dedupe logic, extracted from index.html with dependency
// injection (no module-global state, localStorage, or DOM) so it's unit-testable.
// Callers pass the storage object and config explicitly (see js/storage.test.js).

// Stable fingerprint of a submit payload's `session` — used to refuse identical
// re-submissions. Strips `submitted_at` (timestamps aren't user intent) and
// recursively sorts keys so object key order doesn't change the signature.
export function payloadSignature(session) {
  const clone = { ...session };
  delete clone.submitted_at;
  const sortKeys = (v) => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(clone));
}

// Garbage-collect drafts older than `gcDays`, and sweep every legacy v1 workout
// draft regardless of age (v1 keys lack the routine_id scoping of v2 and are no
// longer read). `storage` is a localStorage-like object; `now` is a ms epoch —
// both injected so the logic is testable without a real browser.
export function gcOldDrafts(storage, { now, draftPrefix, draftPrefixV1, recDraftPrefix, gcDays }) {
  const cutoff = now - gcDays * 24 * 60 * 60 * 1000;
  for (let i = storage.length - 1; i >= 0; i--) {
    const k = storage.key(i);
    if (!k) continue;
    if (k.startsWith(draftPrefixV1)) {
      try { storage.removeItem(k); } catch {}
      continue;
    }
    if (!k.startsWith(draftPrefix) && !k.startsWith(recDraftPrefix)) continue;
    try {
      const v = JSON.parse(storage.getItem(k));
      const t = v?.last_modified_at ? new Date(v.last_modified_at).getTime() : 0;
      if (!t || t < cutoff) storage.removeItem(k);
    } catch {
      try { storage.removeItem(k); } catch {}
    }
  }
}


// Parse a v2 workout draft key: prefix + routine_id|date|day|type. Returns null
// for anything else (recovery drafts, legacy keys, malformed).
export function parseWorkoutDraftKey(key, draftPrefix) {
  if (typeof key !== "string" || !key.startsWith(draftPrefix)) return null;
  const parts = key.slice(draftPrefix.length).split("|");
  if (parts.length !== 4) return null;
  const [routineId, date, day, type] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { routineId, date, day, type };
}

// The lost-draft case: a set was logged under the date selected at the time
// (Tue 10/20), the user never tapped Submit, and when the day is reopened the
// date picker says "today" (10/24) — so the exact key misses and the draft is
// invisible. Find the newest draft for the same routine + day + type under any
// OTHER date inside the routine week. Returns { date, draft } or null.
export function findWorkoutDraftForSlot(storage, { draftPrefix, routineId, day, type, excludeDate, weekStart, weekEnd }) {
  let best = null;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    const parsed = parseWorkoutDraftKey(k, draftPrefix);
    if (!parsed) continue;
    if (parsed.routineId !== routineId || parsed.day !== day || parsed.type !== type) continue;
    if (parsed.date === excludeDate) continue;
    if (weekStart && parsed.date < weekStart) continue;
    if (weekEnd && parsed.date > weekEnd) continue;
    let draft;
    try { draft = JSON.parse(storage.getItem(k)); } catch { continue; }
    if (!draft || typeof draft !== "object") continue;
    const t = draft.last_modified_at ? new Date(draft.last_modified_at).getTime() : 0;
    if (!best || t > best.t) best = { t, date: parsed.date, draft };
  }
  return best ? { date: best.date, draft: best.draft } : null;
}

// Drafts that have sat unsubmitted for at least `minAgeMs` — the boot reminder.
// Sorted oldest first. Only workout drafts with at least one Done set count.
export function listStaleWorkoutDrafts(storage, { draftPrefix, now, minAgeMs }) {
  const out = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    const parsed = parseWorkoutDraftKey(k, draftPrefix);
    if (!parsed) continue;
    let draft;
    try { draft = JSON.parse(storage.getItem(k)); } catch { continue; }
    const t = draft?.last_modified_at ? new Date(draft.last_modified_at).getTime() : 0;
    if (!t || now - t < minAgeMs) continue;
    const hasDone = Object.values(draft.log || {}).some(v => (v?.sets || []).some(s => s?.done));
    if (!hasDone) continue;
    out.push({ ...parsed, last_modified_at: draft.last_modified_at, key: k });
  }
  return out.sort((a, b) => a.last_modified_at.localeCompare(b.last_modified_at));
}
