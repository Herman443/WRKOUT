// Calendar helpers. Calendar dates are "YYYY-MM-DD" strings in the athlete's timezone;
// arithmetic on them is done in UTC so DST never shifts a day.

export const TIMEZONE = process.env.APP_TIMEZONE ?? "Europe/Oslo";

const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function toLocalDate(d: Date): string {
  return ymd.format(d);
}

export function todayLocal(now = new Date()): string {
  return toLocalDate(now);
}

/** Local wall-clock hour and minute. */
export function localTime(now = new Date()): { hour: number; minute: number } {
  const [h, m] = hm.format(now).split(":").map(Number);
  return { hour: h, minute: m };
}

const parse = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));

export function addDays(date: string, days: number): string {
  return new Date(parse(date) + days * 86400000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

/** 0 = Monday … 6 = Sunday */
export function weekday(date: string): number {
  return (new Date(parse(date)).getUTCDay() + 6) % 7;
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekday(date));
}

export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function formatDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(parse(date)));
}
