import { describe, it, expect } from "vitest";
import { shortDate } from "./ui.js";

describe("shortDate", () => {
  it("formats ISO dates as M/D, drops leading zeros, handles empty", () => {
    expect(shortDate("2026-05-18")).toBe("5/18");
    expect(shortDate("2026-12-01")).toBe("12/1");
    expect(shortDate("")).toBe("?");
    expect(shortDate(null)).toBe("?");
  });
});
