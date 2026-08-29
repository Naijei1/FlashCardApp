const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Compact human label for a scheduling interval, e.g. "<1m", "10m", "3d", "2.5mo". */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return "<1m";
  if (ms < HOUR) return `${Math.round(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  if (ms < MONTH) return `${Math.round(ms / DAY)}d`;
  if (ms < YEAR) {
    const months = ms / MONTH;
    return months < 10 ? `${(Math.round(months * 10) / 10).toString().replace(/\.0$/, "")}mo` : `${Math.round(months)}mo`;
  }
  const years = ms / YEAR;
  return `${(Math.round(years * 10) / 10).toString().replace(/\.0$/, "")}yr`;
}
