import { describe, expect, it } from "vitest";
import {
  buildReviewForecast,
  formatZonedDateTimeLocal,
  localDateKey,
  parseZonedDateTimeLocal,
  reviewForecastDates,
} from "@/lib/forecast";
import { State } from "ts-fsrs";

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

  it("leaves new cards out of the review forecast", () => {
    const dates = reviewForecastDates([
      { fsrs: { due: "2026-10-24T12:00:00.000Z", state: State.New } },
      { fsrs: { due: "2026-10-24T18:00:00.000Z", state: State.Review } },
    ]);
    expect(dates).toHaveLength(1);
    expect(dates[0].toISOString()).toBe("2026-10-24T18:00:00.000Z");
  });

  it("reads and writes release times in America/New_York instead of a UTC slice", () => {
    const iso = "2026-07-04T19:30:00.000Z";
    expect(formatZonedDateTimeLocal(new Date(iso), ZONE)).toBe("2026-07-04T15:30");
    expect(parseZonedDateTimeLocal("2026-07-04T15:30", ZONE)).toBe(iso);
    expect("2026-07-04T19:30:00.000Z".slice(0, 16)).not.toBe("2026-07-04T15:30");
  });

  it("keeps dates correct across daylight-saving transitions", () => {
    expect(localDateKey(new Date("2026-11-01T04:30:00Z"), ZONE)).toBe("2026-11-01");
    expect(localDateKey(new Date("2026-11-02T04:30:00Z"), ZONE)).toBe("2026-11-01");
  });
});
