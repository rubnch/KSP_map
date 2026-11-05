import type { Body, Calendar } from '../core/index.ts';

/**
 * Timeline spans scaled to the origin: 2, 5, 10 and 20 of its orbital periods, rounded to
 * whole years, days or hours. From Kerbin that is 2 to 20 years; from Laythe, 5 to 49 days.
 */
export const SPAN_MULTIPLES = [2, 5, 10, 20] as const;

export interface Span {
  seconds: number;
  label: string;
}

export function spansFor(origin: Body, cal: Calendar): Span[] {
  const period = origin.orbit!.period;
  return SPAN_MULTIPLES.map((m) => roundSpan(m * period, cal));
}

function roundSpan(s: number, cal: Calendar): Span {
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (s >= cal.yearLength * 0.95) {
    const n = Math.max(1, Math.round(s / cal.yearLength));
    return { seconds: n * cal.yearLength, label: unit(n, 'year', 'years') };
  }
  if (s >= cal.dayLength) {
    const n = Math.max(1, Math.round(s / cal.dayLength));
    return { seconds: n * cal.dayLength, label: unit(n, 'day', 'days') };
  }
  const n = Math.max(1, Math.round(s / 3600));
  return { seconds: n * 3600, label: unit(n, 'hour', 'hours') };
}

/** Axis tick spacing: the smallest round calendar step that gives at most ~10 ticks. */
export function tickStep(span: number, cal: Calendar): number {
  const steps = [
    3600,
    2 * 3600,
    cal.dayLength,
    ...[2, 5, 10, 20, 50, 100].map((n) => n * cal.dayLength).filter((d) => d < cal.yearLength),
    ...[1, 2, 5, 10, 20, 50, 100].map((n) => n * cal.yearLength),
  ].sort((a, b) => a - b);
  return steps.find((s) => span / s <= 10) ?? steps[steps.length - 1]!;
}

/** Tick label: years alone when the step is a year or more, else the day (with the year where it changes). */
export function tickLabel(t: number, step: number, cal: Calendar, first: boolean): string {
  const year = Math.floor(t / cal.yearLength) + 1;
  if (step >= cal.yearLength) return `Y${year}`;
  const day = Math.floor((t % cal.yearLength) / cal.dayLength) + 1;
  const hour = Math.round((t % cal.dayLength) / 3600);
  const prefix = first || day === 1 ? `Y${year} ` : '';
  if (step < cal.dayLength) return hour === 0 ? `${prefix}D${day}` : `${hour}h`;
  return `${prefix}D${day}`;
}
