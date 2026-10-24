import { State } from "ts-fsrs";

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

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

function dateParts(date: Date, timeZone: string) {
  const parts = dateFormatter(timeZone).formatToParts(date);
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

/** New cards are not scheduled reviews. The forecast should not count them as due today. */
export function reviewForecastDates(
  cards: readonly { fsrs: { due: string; state: number } }[]
): Date[] {
  return cards
    .filter((card) => card.fsrs.state !== State.New)
    .map((card) => new Date(card.fsrs.due))
    .filter((due) => Number.isFinite(due.getTime()));
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return { year: read("year"), month: read("month"), day: read("day"), hour, minute: read("minute") };
}

/** `datetime-local` value for a UTC instant in the app timezone. */
export function formatZonedDateTimeLocal(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Interpret a `datetime-local` value as wall time in `timeZone` and return UTC ISO.
 * Returns null when the value is not a complete local date-time.
 */
export function parseZonedDateTimeLocal(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const diff = desired - asUtc;
    if (diff === 0) return new Date(utc).toISOString();
    utc += diff;
  }
  return new Date(utc).toISOString();
}
