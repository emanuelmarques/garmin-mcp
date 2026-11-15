import { describe, expect, it } from "vitest";
import { isoWeekKey, monthKey, splitRange } from "@/lib/dates";

describe("splitRange", () => {
  it("splits into consecutive inclusive blocks", () => {
    expect(splitRange("2026-01-01", "2026-01-10", 4)).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-08" },
      { from: "2026-01-09", to: "2026-01-10" },
    ]);
  });
  it("returns [] when from is after to", () => {
    expect(splitRange("2026-02-01", "2026-01-01", 4)).toEqual([]);
  });
  it("returns a single block when the range fits", () => {
    expect(splitRange("2026-01-01", "2026-01-01", 30)).toEqual([{ from: "2026-01-01", to: "2026-01-01" }]);
  });
});

describe("period keys", () => {
  it("uses ISO weeks (Monday start)", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2027-01-03")).toBe("2026-W53");
    expect(isoWeekKey("2026-01-05")).toBe("2026-W02");
  });
  it("formats month keys", () => {
    expect(monthKey("2026-03-15")).toBe("2026-03");
  });
});
