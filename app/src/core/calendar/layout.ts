import type { DateTime } from 'luxon';

// Placing appointments on the calendar's day columns.

/**
 * The date the Calendar opens on: the one asked for, else today in the practice's time zone,
 * not the computer's, which may already (or still) be on another day.
 */
export function calendarStart(asked: string | null | undefined, now: DateTime, tz: string): string {
  return asked ?? now.setZone(tz).toISODate()!;
}

export interface Placed {
  /** Column inside its group of overlapping appointments, from 0. */
  lane: number;
  /** How many columns that group needs. */
  lanes: number;
}

/**
 * Side-by-side columns for appointments that overlap. Only appointments that overlap (directly
 * or through a chain) share the width of the day; every other appointment keeps it whole.
 */
export function placeOverlapping<T extends { start: DateTime; end: DateTime }>(items: T[]): Map<T, Placed> {
  const sorted = [...items].sort((a, b) => a.start.toMillis() - b.start.toMillis() || b.end.toMillis() - a.end.toMillis());
  const out = new Map<T, Placed>();
  let group: { item: T; lane: number }[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const close = () => {
    for (const g of group) out.set(g.item, { lane: g.lane, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = item.start.toMillis();
    const end = item.end.toMillis();
    if (start >= groupEnd) {
      close();
      groupEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane < 0) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    group.push({ item, lane });
    groupEnd = Math.max(groupEnd, end);
  }
  close();
  return out;
}

/**
 * The hours a day grid shows: the usual range, widened to every appointment and working hour
 * of the days on screen, so nothing is hidden before 07:00 or cut off after 22:00. Times are
 * hours of the day as decimals (13.5 = 13:30); an end after midnight counts as 24.
 */
export function gridHours(times: { start: number; end: number }[], usual: { first: number; last: number } = { first: 7, last: 22 }): { first: number; last: number } {
  let first = usual.first;
  let last = usual.last;
  for (const t of times) {
    first = Math.min(first, Math.floor(t.start));
    last = Math.max(last, Math.ceil(Math.min(24, t.end)));
  }
  return { first: Math.max(0, first), last: Math.min(24, last) };
}

/**
 * The wall-clock hour of `dt` on `day` (both in the same zone) as a decimal: 0 for a time on an
 * earlier day, 24 or more for one on a later day. Wall-clock, so 09:00 sits at 9 on the days
 * the clocks change.
 */
export function hourOfDay(dt: DateTime, day: DateTime): number {
  if (dt.hasSame(day, 'day')) return dt.hour + dt.minute / 60;
  return dt < day ? 0 : 24 + dt.diff(day.startOf('day').plus({ days: 1 }), 'minutes').minutes / 60;
}
