import ICAL from 'ical.js';
import { DateTime } from 'luxon';

export interface IcsEvent {
  uid: string;
  summary: string;
  start_local: string; // YYYY-MM-DDTHH:mm
  tz: string;
  duration_min: number;
  location: string;
  repeatWeeks: 1 | 2 | null;
  /** Last date of the series (inclusive), never before its first date. */
  until: string | null;
  /** Dates of the series that do not take place: removed (EXDATE), cancelled or moved. */
  exceptions: string[];
  /** A date moved out of a series: the uid of that series. */
  movedFrom: string | null;
  /** The event repeats in a way Sala cannot follow (daily, monthly, several days a week…); only its first date is kept. */
  unsupportedRepeat: boolean;
}

/**
 * An iCalendar time as a Luxon DateTime. Times with a TZID keep their wall-clock time in that
 * zone even when the file carries no VTIMEZONE block; UTC times are converted; floating times
 * and unknown zone names (e.g. Windows names) use the fallback zone.
 */
function toLocal(t: ICAL.Time, fallbackTz: string): DateTime {
  const wall = { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute };
  const raw = t as unknown as { timezone?: string; zone?: { tzid?: string } };
  const tzid = raw.timezone || raw.zone?.tzid || '';
  if (tzid === 'Z' || tzid === 'UTC') return DateTime.fromObject(wall, { zone: 'utc' }).setZone(fallbackTz);
  if (tzid && tzid !== 'floating') {
    const dt = DateTime.fromObject(wall, { zone: tzid });
    if (dt.isValid) return dt;
  }
  return DateTime.fromObject(wall, { zone: fallbackTz });
}

/** The local date of an iCalendar date or date-time, in `zone`. */
function localDate(t: ICAL.Time, zone: string): string {
  if (t.isDate) return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
  return toLocal(t, zone).toISODate()!;
}

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const OTHER_PARTS = ['BYSECOND', 'BYMINUTE', 'BYHOUR', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYMONTH', 'BYSETPOS'] as const;

/** Weekly or fortnightly on the first date's weekday: the only repeats Sala keeps. */
function weeklyInterval(rule: ICAL.Recur, start: DateTime): 1 | 2 | null {
  const interval = rule.interval || 1;
  if (rule.freq !== 'WEEKLY' || interval > 2) return null;
  if (OTHER_PARTS.some((p) => rule.parts[p]?.length)) return null;
  const byDay = rule.parts.BYDAY ?? [];
  if (byDay.length > 1) return null;
  if (byDay.length === 1 && byDay[0]!.toUpperCase() !== WEEKDAYS[start.weekday - 1]) return null;
  return interval as 1 | 2;
}

interface Override {
  uid: string;
  recurrence: ICAL.Time;
  cancelled: boolean;
  event: IcsEvent | null;
}

function readEvent(v: ICAL.Component, ev: ICAL.Event, fallbackTz: string): IcsEvent {
  const start = toLocal(ev.startDate, fallbackTz);
  const zone = start.zoneName ?? fallbackTz;
  const end = ev.endDate ? toLocal(ev.endDate, zone) : start.plus({ minutes: 50 });
  return {
    uid: ev.uid ?? '',
    summary: (ev.summary ?? '').trim(),
    start_local: start.toFormat("yyyy-MM-dd'T'HH:mm"),
    tz: zone,
    duration_min: Math.min(24 * 60, Math.max(5, Math.round(end.diff(start, 'minutes').minutes))),
    location: (ev.location ?? '').trim(),
    repeatWeeks: null,
    until: null,
    exceptions: [],
    movedFrom: null,
    unsupportedRepeat: false,
    ...repeatOf(v, start, zone),
  };
}

function repeatOf(v: ICAL.Component, start: DateTime, zone: string): Partial<IcsEvent> {
  const rule = v.getFirstPropertyValue('rrule') as ICAL.Recur | null;
  if (!rule) return {};
  const weeks = weeklyInterval(rule, start);
  if (!weeks) return { unsupportedRepeat: true };
  const first = start.toISODate()!;
  let until: string | null = null;
  if (rule.until) until = toLocal(rule.until, zone).toISODate();
  else if (rule.count) until = start.plus({ weeks: weeks * (Math.max(1, rule.count) - 1) }).toISODate();
  // DTSTART always counts as the first occurrence (RFC 5545), even when UNTIL falls before it.
  if (until && until < first) until = first;
  const exceptions = new Set<string>();
  for (const prop of v.getAllProperties('exdate')) {
    for (const value of prop.getValues() as ICAL.Time[]) {
      const date = localDate(value, zone);
      exceptions.add(date);
    }
  }
  return { repeatWeeks: weeks, until, exceptions: [...exceptions].sort() };
}

/**
 * Reads timed events from an iCalendar file. All-day and cancelled events are skipped. Weekly
 * and fortnightly series keep their end (UNTIL or COUNT) and the dates they skip (EXDATE); a
 * date moved or cancelled in a series (RECURRENCE-ID) becomes an exception of the series and,
 * when moved, a single event of its own. Other repeats are flagged and keep their first date.
 */
export function parseIcs(text: string, fallbackTz: string): IcsEvent[] {
  const comp = new ICAL.Component(ICAL.parse(text));
  const out: IcsEvent[] = [];
  const series = new Map<string, IcsEvent>();
  const cancelled = new Set<string>();
  const overrides: Override[] = [];
  for (const v of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(v);
    const isCancelled = String(v.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
    const recurrence = v.getFirstPropertyValue('recurrence-id') as ICAL.Time | null;
    const timed = !!ev.startDate && !ev.startDate.isDate;
    if (recurrence) {
      overrides.push({ uid: ev.uid ?? '', recurrence, cancelled: isCancelled, event: timed && !isCancelled ? readEvent(v, ev, fallbackTz) : null });
      continue;
    }
    if (isCancelled) {
      if (ev.uid) cancelled.add(ev.uid);
      continue;
    }
    if (!timed) continue;
    const event = readEvent(v, ev, fallbackTz);
    if (event.uid && !series.has(event.uid)) series.set(event.uid, event);
    out.push(event);
  }
  for (const o of overrides) {
    if (cancelled.has(o.uid)) continue;
    const master = series.get(o.uid);
    if (master?.repeatWeeks) {
      const date = localDate(o.recurrence, master.tz);
      if (!master.exceptions.includes(date)) master.exceptions = [...master.exceptions, date].sort();
    }
    if (o.event) out.push({ ...o.event, repeatWeeks: null, until: null, exceptions: [], unsupportedRepeat: false, movedFrom: master?.repeatWeeks ? o.uid : null });
  }
  return out;
}
