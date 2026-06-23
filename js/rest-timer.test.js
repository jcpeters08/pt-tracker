import { describe, it, expect } from "vitest";
import {
  REST_PRESETS,
  DEFAULT_REST_SECONDS,
  formatClock,
  remainingSeconds,
  startTimer,
  loadDuration,
  saveDuration,
} from "./rest-timer.js";

function fakeStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

describe("presets", () => {
  it("offers 1:00 / 1:30 / 2:00 / 3:00 and defaults to 2:00", () => {
    expect(REST_PRESETS).toEqual([60, 90, 120, 180]);
    expect(DEFAULT_REST_SECONDS).toBe(120);
  });
});

describe("formatClock", () => {
  it("formats seconds as M:SS with zero-padded seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(83)).toBe("1:23");
    expect(formatClock(120)).toBe("2:00");
    expect(formatClock(180)).toBe("3:00");
    expect(formatClock(600)).toBe("10:00");
  });

  it("clamps negative input to 0:00", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("remainingSeconds", () => {
  it("shows the full duration at the moment it starts (ceil)", () => {
    expect(remainingSeconds(120000, 0)).toBe(120);
  });

  it("ceils partial seconds so the display ticks down cleanly", () => {
    expect(remainingSeconds(10000, 2500)).toBe(8); // 7.5s left → 8
    expect(remainingSeconds(10000, 9999)).toBe(1); // 1ms left → 1
  });

  it("is 0 exactly at the end", () => {
    expect(remainingSeconds(10000, 10000)).toBe(0);
  });

  it("never goes negative once the timer is past due", () => {
    expect(remainingSeconds(10000, 11000)).toBe(0);
  });
});

describe("startTimer", () => {
  it("computes the end timestamp from now + duration", () => {
    expect(startTimer(120, 5000)).toEqual({ endsAtMs: 125000, durationSec: 120 });
  });
});

describe("loadDuration / saveDuration", () => {
  const KEY = "pt_tracker_rest_duration_v1";

  it("returns the default when nothing is stored", () => {
    expect(loadDuration(fakeStorage())).toBe(120);
  });

  it("loads a previously saved valid preset", () => {
    expect(loadDuration(fakeStorage({ [KEY]: "90" }))).toBe(90);
  });

  it("falls back to default for a non-preset or garbage value", () => {
    expect(loadDuration(fakeStorage({ [KEY]: "45" }))).toBe(120);
    expect(loadDuration(fakeStorage({ [KEY]: "abc" }))).toBe(120);
  });

  it("persists a valid preset and ignores an invalid one", () => {
    const s = fakeStorage();
    saveDuration(s, 90);
    expect(s.getItem(KEY)).toBe("90");
    saveDuration(s, 45); // not a preset → no change
    expect(s.getItem(KEY)).toBe("90");
  });
});
