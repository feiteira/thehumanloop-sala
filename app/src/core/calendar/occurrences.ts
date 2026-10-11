import { DateTime, Interval } from 'luxon';
import type { Appointment } from '../model/types';

export interface Occurrence {
  appointment: Appointment;
  /** Local date of this occurrence in the appointment's own time zone. */
  date: string;
  start: DateTime; // in the appointment's time zone
  end: DateTime;
}

/**
 * The start of an appointment, or null when it cannot be read: an older version could save an
 * impossible date (31 September). Such an appointment is kept but shown and exported nowhere,
 * rather than breaking the screen or the backup that meets it.
 */
export function readableStart(a: Pick<Appointment, 'start_local' | 'tz'>): DateTime | null {
  const dt = DateTime.fromISO(a.start_local, { zone: a.tz });
  return dt.isValid ? dt : null;
}

export function startOf(a: Appointment): DateTime {
  const dt = DateTime.fromISO(a.start_local, { zone: a.tz });
  if (!dt.isValid) throw new Error(`invalid appointment start: ${a.start_local} ${a.tz}`);
  return dt;
}

/**
 * Occurrences of an appointment that start within [from, to). Repeats keep their wall-clock
 * time across daylight-saving changes: a 09:00 weekly session stays at 09:00 in March and October.
 */
export function occurrences(a: Appointment, from: DateTime, to: DateTime): Occurrence[] {
  if (a.deleted) return [];
  const first = readableStart(a);
  if (!first) return [];
  const make = (start: DateTime): Occurrence => ({
    appointment: a,
    date: start.toISODate()!,
    start,
    end: start.plus({ minutes: a.duration_min }),
  });
  if (!a.repeat) {
    return first < to && first.plus({ minutes: a.duration_min }) > from ? [make(first)] : [];
  }
  const step = a.repeat.interval_weeks;
  const until = a.repeat.until ? DateTime.fromISO(a.repeat.until, { zone: a.tz }).endOf('day') : null;
  const skip = new Set(a.repeat.exceptions);
  // Jump straight to the first candidate at or before `from` instead of walking from the start.
  const weeksAhead = Math.max(0, Math.floor(from.diff(first, 'weeks').weeks / step) * step - step);
  const out: Occurrence[] = [];
  for (let k = weeksAhead; ; k += step) {
    const start = first.plus({ weeks: k });
    if (start >= to || (until && start > until)) break;
    const occ = make(start);
    if (occ.end > from && !skip.has(occ.date)) out.push(occ);
    if (out.length > 1000) break;
  }
  return out;
}

/**
 * Whether an appointment has any date at all. A series can have none: every date skipped, or
 * an end before its start (older files could hold one). Such a record is never shown or exported.
 */
export function hasDates(a: Pick<Appointment, 'start_local' | 'tz' | 'repeat'>): boolean {
  if (!readableStart(a)) return false;
  if (!a.repeat?.until) return true;
  const first = DateTime.fromISO(a.start_local.slice(0, 10), { zone: 'utc' });
  const until = a.repeat.until;
  const skip = new Set(a.repeat.exceptions);
  for (let d = first; d.toISODate()! <= until; d = d.plus({ weeks: a.repeat.interval_weeks })) {
    if (!skip.has(d.toISODate()!)) return true;
  }
  return false;
}

/** All occurrences of many appointments in a range, sorted by start. */
export function occurrencesIn(appointments: Appointment[], from: DateTime, to: DateTime): Occurrence[] {
  return appointments
    .flatMap((a) => occurrences(a, from, to))
    .sort((x, y) => x.start.toMillis() - y.start.toMillis());
}

/** The next occurrence of any appointment of a folder at or after `now` (for "next session"). */
export function nextOccurrence(appointments: Appointment[], now: DateTime): Occurrence | null {
  const horizon = now.plus({ days: 400 });
  return (
    occurrencesIn(
      appointments.filter((a) => a.status !== 'cancelled'),
      now,
      horizon,
    ).find((o) => o.start >= now) ?? null
  );
}

export function overlaps(a: Occurrence, b: Occurrence): boolean {
  return Interval.fromDateTimes(a.start, a.end).overlaps(Interval.fromDateTimes(b.start, b.end));
}
