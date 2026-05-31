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
