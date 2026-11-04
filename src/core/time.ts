/** UT and duration formatting in a pack's calendar. */
export interface Calendar {
  dayLength: number;
  yearLength: number;
}

export interface CalendarDate {
  year: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** UT seconds → calendar date. Year and day start at 1, like the game. */
export function utToDate(ut: number, cal: Calendar): CalendarDate {
  const year = Math.floor(ut / cal.yearLength);
  let rest = ut - year * cal.yearLength;
  const day = Math.floor(rest / cal.dayLength);
  rest -= day * cal.dayLength;
  const hours = Math.floor(rest / 3600);
  rest -= hours * 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = Math.floor(rest - minutes * 60);
  return { year: year + 1, day: day + 1, hours, minutes, seconds };
}

export function dateToUt(d: Pick<CalendarDate, 'year' | 'day'> & Partial<CalendarDate>, cal: Calendar): number {
  return (
    (d.year - 1) * cal.yearLength +
    (d.day - 1) * cal.dayLength +
    (d.hours ?? 0) * 3600 +
    (d.minutes ?? 0) * 60 +
    (d.seconds ?? 0)
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatUt(ut: number, cal: Calendar): string {
  const d = utToDate(ut, cal);
  return `Year ${d.year}, Day ${d.day} - ${pad(d.hours)}:${pad(d.minutes)}:${pad(d.seconds)}`;
}

/** Compact duration like "2y 41d 3h 05m". */
export function formatDuration(seconds: number, cal: Calendar): string {
  if (!Number.isFinite(seconds)) return '∞';
  let s = Math.abs(seconds);
  const parts: string[] = [];
  const y = Math.floor(s / cal.yearLength);
  s -= y * cal.yearLength;
  const d = Math.floor(s / cal.dayLength);
  s -= d * cal.dayLength;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (y) parts.push(`${y}y`);
  if (d || y) parts.push(`${d}d`);
  if (!y) {
    if (h || d) parts.push(`${h}h`);
    if (!d) parts.push(`${pad(m)}m`);
    if (!d && !h) parts.push(`${pad(Math.floor(s))}s`);
  }
  return (seconds < 0 ? '-' : '') + parts.join(' ');
}

/** Distances: m below 10 km, km below 10 Gm, then Gm. */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '∞';
  const a = Math.abs(m);
  if (a < 1e4) return `${m.toFixed(0)} m`;
  if (a < 1e10) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  return `${(m / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })} Gm`;
}
