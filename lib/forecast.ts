export type ForecastDay = { key: string; label: string; count: number };

const DEFAULT_TIME_ZONE = "America/New_York";

export function appTimeZone(): string {
  const configured = process.env.APP_TIME_ZONE || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configured }).format(0);
    return configured;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function keyForParts(year: number, month: number, day: number): string {
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.toISOString().slice(0, 10);
}

export function localDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = dateParts(date, timeZone);
  return keyForParts(year, month, day);
}

/** Calendar-day forecast in the user's timezone, including overdue cards today. */
export function buildReviewForecast(
  dueDates: Date[],
  now: Date,
  timeZone: string,
  days = 7
): { days: ForecastDay[]; upcomingCount: number } {
  const today = dateParts(now, timeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const result = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + index));
    return {
      key: date.toISOString().slice(0, 10),
      label: index === 0 ? "Today" : index === 1 ? "Tomorrow" : formatter.format(date),
      count: 0,
    };
  });
  const indexes = new Map(result.map((day, index) => [day.key, index]));
  let upcomingCount = 0;

  for (const due of dueDates) {
    if (!Number.isFinite(due.getTime())) continue;
    const key = localDateKey(due, timeZone);
    const index = due <= now ? 0 : indexes.get(key);
    if (index === undefined) continue;
    result[index].count += 1;
    if (due > now) upcomingCount += 1;
  }

  return { days: result, upcomingCount };
}
