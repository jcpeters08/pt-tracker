// Recently submitted entries, persisted so a just-submitted session survives a
// PWA relaunch. After POST /pending/append succeeds the Worker commits to
// data/pending.json, but GitHub Pages serves the new file only after the deploy
// (~1–2 min). Inside that window loadSessions() would otherwise show the day as
// unlogged with routine defaults, inviting a duplicate submit.
//
// Pure given its inputs (list, entry, now in ms, storage object) — no DOM, no
// Date.now(), no module-global state — so the merge/expiry logic is unit-testable
// (see js/recent-submits.test.js). index.html owns the localStorage call site.
import { mergePending, slotKey } from "./pending.js";

export const RECENT_SUBMITS_KEY = "pt_tracker_recent_submits_v1";
export const RECENT_SUBMITS_TTL_MS = 15 * 60 * 1000;

const REMEMBERED_TYPES = new Set(["log", "skip", "recovery"]);

function cloneEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}

function submittedAtMs(entry) {
  const iso = entry?.submitted_at || entry?.session?.submitted_at || null;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

// Record a successful submit. Returns a new list: the entry (cloned, stamped
// with recorded_at = nowMs) replaces any remembered entry for the same slot.
// Only log/skip/recovery affect the day view; other types are ignored.
export function rememberSubmit(list, entry, nowMs) {
  const current = Array.isArray(list) ? list : [];
  if (!entry || !REMEMBERED_TYPES.has(entry.type)) return [...current];
  const stamped = { ...cloneEntry(entry), recorded_at: nowMs };
  return mergePending(current, stamped);
}

// Is a remembered entry already reflected in the fetched pending.json? Same
// slot, and the fetched copy is at least as new (a re-submit of the same slot
// stays remembered until its own write lands).
function reflectedInFetched(fetched, recent) {
  const key = slotKey(recent);
  if (!key) return false;
  const recentMs = submittedAtMs(recent);
  return fetched.some(e => {
    if (slotKey(e) !== key) return false;
    const fetchedMs = submittedAtMs(e);
    if (recentMs == null || fetchedMs == null) return true;
    return fetchedMs >= recentMs;
  });
}

// Reconcile remembered submits against the freshly fetched pending.json entries.
// Returns { entries, remaining }: `entries` is the fetched list with every
// still-relevant remembered entry overlaid (same pre-dedupe as the Worker);
// `remaining` is the pruned list to persist — entries older than ttlMs or
// already present in the fetched list are dropped.
export function overlayRecentSubmits(fetchedEntries, recentList, nowMs, ttlMs = RECENT_SUBMITS_TTL_MS) {
  const fetched = Array.isArray(fetchedEntries) ? fetchedEntries : [];
  const recent = Array.isArray(recentList) ? recentList : [];
  const remaining = recent.filter(r => {
    if (!r || !REMEMBERED_TYPES.has(r.type) || !slotKey(r)) return false;
    const recordedAt = Number(r.recorded_at);
    if (!Number.isFinite(recordedAt) || nowMs - recordedAt >= ttlMs) return false;
    return !reflectedInFetched(fetched, r);
  });
  let entries = [...fetched];
  for (const r of remaining) {
    const { recorded_at, ...entry } = r;
    entries = mergePending(entries, entry);
  }
  return { entries, remaining };
}

// Storage I/O. `storage` is a localStorage-like object (injected so the module
// stays testable). Every call swallows storage errors: a private-mode or
// quota failure must never break a submit or a boot.
export function loadRecentSubmits(storage) {
  try {
    const raw = storage.getItem(RECENT_SUBMITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRecentSubmits(storage, list) {
  try {
    if (!Array.isArray(list) || !list.length) {
      storage.removeItem(RECENT_SUBMITS_KEY);
      return;
    }
    storage.setItem(RECENT_SUBMITS_KEY, JSON.stringify(list));
  } catch {}
}
