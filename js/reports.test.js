import { describe, it, expect } from "vitest";
import { escapeHtml, personalRecordRowsHtml, calendarCells } from "./reports.js";

describe("reports escaping", () => {
  it("escapes all dynamic PR fields before table rendering", () => {
    const html = personalRecordRowsHtml([
      {
        exercise_id: "evil",
        date: "2026-05-31<script>",
        type: "load_pr",
        weight_kg: "10<img>",
        reps: "8&9",
        delta_kg: "2\"",
      },
    ], { evil: "<img src=x onerror=alert(1)>" });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("2026-05-31&lt;script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
  });

  it("escapeHtml handles quotes and ampersands", () => {
    expect(escapeHtml(`a&b"'<>`)).toBe("a&amp;b&quot;&#39;&lt;&gt;");
  });
});

describe("calendarCells", () => {
  it("marks logged session dates and keeps the date label", () => {
    const cells = calendarCells(["2026-05-18", "2026-05-20"], "2026-05-18", "2026-05-24");
    expect(cells).toHaveLength(7);
    expect(cells[0]).toMatchObject({ date: "2026-05-18", day: "18", hasSession: true });
    expect(cells[1]).toMatchObject({ date: "2026-05-19", day: "19", hasSession: false });
    expect(cells[2]).toMatchObject({ date: "2026-05-20", day: "20", hasSession: true });
  });
});
