// Pure rest-timer logic: presets, clock formatting, countdown math, and
// duration persistence. No DOM and no real timers — the UI layer (workout view)
// owns the setInterval ticker, the sticky bar, and the silent flash; this module
// stays trivially unit-testable (js/rest-timer.test.js).

export const REST_PRESETS = [60, 90, 120, 180]; // 1:00 / 1:30 / 2:00 / 3:00
export const DEFAULT_REST_SECONDS = 120;        // 2:00
export const REST_DURATION_KEY = "pt_tracker_rest_duration_v1";

// Seconds → "M:SS" with zero-padded seconds, clamped at 0.
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

// Whole seconds left until endsAtMs, measured from nowMs. Ceils partial seconds
// so a freshly started timer reads its full duration; never negative.
export function remainingSeconds(endsAtMs, nowMs) {
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

// Pure "start" → the timer state the UI stores on `state.restTimer`.
export function startTimer(durationSec, nowMs) {
  return { endsAtMs: nowMs + durationSec * 1000, durationSec };
}

// Persisted duration is restricted to a known preset; anything else → default.
export function loadDuration(storage) {
  const n = Number(storage?.getItem?.(REST_DURATION_KEY));
  return REST_PRESETS.includes(n) ? n : DEFAULT_REST_SECONDS;
}

export function saveDuration(storage, seconds) {
  if (!REST_PRESETS.includes(seconds)) return;
  storage?.setItem?.(REST_DURATION_KEY, String(seconds));
}
