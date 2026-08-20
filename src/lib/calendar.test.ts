import { describe, expect, it } from "vitest";
import { calendarCells, formatCalendarMonth, isDateInCalendarMonth, monthBounds, shiftCalendarMonth } from "@/lib/calendar";

describe("calendar helpers", () => {
  it("builds a Monday-first month grid", () => {
    const cells = calendarCells("2026-08");
    expect(cells).toHaveLength(42);
    expect(cells[0]).toBeNull();
    expect(cells[5]).toBe("2026-08-01");
    expect(cells[35]).toBe("2026-08-31");
  });

  it("moves across year boundaries and returns exact bounds", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(monthBounds("2028-02")).toEqual({ dateFrom: "2028-02-01", dateTo: "2028-02-29" });
    expect(formatCalendarMonth("2026-08")).toBe("2026年8月");
    expect(isDateInCalendarMonth("2026-08-31", "2026-08")).toBe(true);
    expect(isDateInCalendarMonth("2026-08-99", "2026-08")).toBe(false);
  });
});
