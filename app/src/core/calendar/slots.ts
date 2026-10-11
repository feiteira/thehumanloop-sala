import { DateTime } from 'luxon';
import type { AvailabilityException, AvailabilityRule } from '../model/types';
import type { Occurrence } from './occurrences';

export interface Slot {
  start: DateTime;
  end: DateTime;
}

function at(date: DateTime, hhmm: string): DateTime {
  const [h, m] = hhmm.split(':').map(Number);
  return date.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

/** Working hours on a date, after exceptions (days off, extra hours). */
export function workingHours(
  date: DateTime, // any time on the day, in the practice time zone
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): Slot[] {
  const iso = date.toISODate()!;
  const day = date.startOf('day');
  const todays = exceptions.filter((e) => !e.deleted && e.date === iso);
  if (todays.some((e) => e.kind === 'off' && e.start === null)) return [];
  let slots: Slot[] = rules
    .filter((r) => !r.deleted && r.weekday === day.weekday)
    .map((r) => ({ start: at(day, r.start), end: at(day, r.end) }));
  for (const e of todays) {
    if (e.kind === 'extra' && e.start && e.end) slots.push({ start: at(day, e.start), end: at(day, e.end) });
    if (e.kind === 'off' && e.start && e.end) slots = subtract(slots, [{ start: at(day, e.start), end: at(day, e.end) }]);
  }
  return merge(slots);
}

/** Free time on a date: working hours minus appointments (and any other busy slots). */
export function freeSlots(
  date: DateTime,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
  busy: Occurrence[],
  minMinutes = 30,
): Slot[] {
  const hours = workingHours(date, rules, exceptions);
  const taken = busy
    .filter((o) => o.appointment.status !== 'cancelled')
    .map((o) => ({ start: o.start.setZone(date.zone), end: o.end.setZone(date.zone) }));
  return subtract(hours, taken).filter((s) => s.end.diff(s.start, 'minutes').minutes >= minMinutes);
}

function merge(slots: Slot[]): Slot[] {
  const sorted = [...slots].sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const out: Slot[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

function subtract(slots: Slot[], cuts: Slot[]): Slot[] {
  let out = merge(slots);
  for (const c of cuts) {
    out = out.flatMap((s) => {
      if (c.end <= s.start || c.start >= s.end) return [s];
      const parts: Slot[] = [];
      if (c.start > s.start) parts.push({ start: s.start, end: c.start });
      if (c.end < s.end) parts.push({ start: c.end, end: s.end });
      return parts;
    });
  }
  return out;
}
