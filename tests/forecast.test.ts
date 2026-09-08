import { describe, expect, it } from "vitest";
import { buildReviewForecast, localDateKey } from "@/lib/forecast";

const ZONE = "America/New_York";

describe("review forecast", () => {
  it("uses local calendar dates instead of rolling 24-hour buckets", () => {
    const now = new Date("2026-09-03T03:30:00Z"); // Sep 2, 11:30 PM in New York
    const { days, upcomingCount } = buildReviewForecast(
      [
        new Date("2026-09-03T02:00:00Z"), // overdue Sep 2
        new Date("2026-09-03T05:00:00Z"), // Sep 3, 1 AM
      ],
      now,
      ZONE
    );
    expect(days[0]).toMatchObject({ key: "2026-09-02", label: "Today", count: 1 });
    expect(days[1]).toMatchObject({ key: "2026-09-03", label: "Tomorrow", count: 1 });
    expect(upcomingCount).toBe(1);
  });

  it("keeps dates correct across daylight-saving transitions", () => {
    expect(localDateKey(new Date("2026-11-01T04:30:00Z"), ZONE)).toBe("2026-11-01");
    expect(localDateKey(new Date("2026-11-02T04:30:00Z"), ZONE)).toBe("2026-11-01");
  });
});
