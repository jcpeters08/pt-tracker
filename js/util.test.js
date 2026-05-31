import { describe, it, expect } from "vitest";
import {
  kgToLbs, lbsToKg, roundTo, fmtNum, escapeHtml, localDateIso, dayTypeKey,
} from "./util.js";

describe("unit conversion", () => {
  it("kgToLbs / lbsToKg convert and pass through null", () => {
    expect(kgToLbs(10)).toBeCloseTo(22.0462, 3);
    expect(lbsToKg(22.0462)).toBeCloseTo(10, 3);
    expect(kgToLbs(null)).toBeNull();
    expect(lbsToKg(null)).toBeNull();
  });
});

describe("roundTo / fmtNum", () => {
  it("roundTo rounds to places and passes through null/NaN", () => {
    expect(roundTo(2.34567, 1)).toBe(2.3);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(null, 1)).toBeNull();
    expect(Number.isNaN(roundTo(NaN, 1))).toBe(true);
  });
  it("fmtNum drops trailing .0 and blanks null/NaN", () => {
    expect(fmtNum(14.0, 1)).toBe("14");
    expect(fmtNum(14.25, 1)).toBe("14.3");
    expect(fmtNum(null, 1)).toBe("");
    expect(fmtNum(NaN, 1)).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-significant characters and coerces non-strings", () => {
    expect(escapeHtml("<img src=x onerror=1>")).toBe("&lt;img src=x onerror=1&gt;");
    expect(escapeHtml(`a & b "q" 'r'`)).toBe("a &amp; b &quot;q&quot; &#39;r&#39;");
    expect(escapeHtml(5)).toBe("5");
  });
});

describe("localDateIso", () => {
  it("formats a Date as local YYYY-MM-DD (zero-padded)", () => {
    expect(localDateIso(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDateIso(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("dayTypeKey", () => {
  it("slugifies a routine day label to a type key", () => {
    expect(dayTypeKey("Push (Chest / Shoulders / Triceps)")).toBe("push");
    expect(dayTypeKey("Upper Hybrid")).toBe("upper-hybrid");
    expect(dayTypeKey("", "fallback")).toBe("fallback");
  });
});
