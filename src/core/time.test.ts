import { describe, expect, it } from 'vitest';
import { dateToUt, formatDistance, formatDuration, formatUt, utToDate } from './time.ts';

const kerbin = { dayLength: 21600, yearLength: 9201600 };

describe('calendar', () => {
  it('UT 0 is Year 1, Day 1', () => {
    expect(formatUt(0, kerbin)).toBe('Year 1, Day 1 - 00:00:00');
  });
  it('round-trips dates', () => {
    const ut = dateToUt({ year: 3, day: 120, hours: 4, minutes: 5, seconds: 6 }, kerbin);
    expect(utToDate(ut, kerbin)).toEqual({ year: 3, day: 120, hours: 4, minutes: 5, seconds: 6 });
  });
  it('formats durations', () => {
    expect(formatDuration(90, kerbin)).toBe('01m 30s');
    expect(formatDuration(2 * 21600 + 3 * 3600, kerbin)).toBe('2d 3h');
    expect(formatDuration(9201600 + 21600 * 5, kerbin)).toBe('1y 5d');
  });
  it('formats distances', () => {
    expect(formatDistance(250)).toBe('250 m');
    expect(formatDistance(84159286)).toBe('84,159 km');
    expect(formatDistance(13599840256)).toBe('13.6 Gm');
  });
});
