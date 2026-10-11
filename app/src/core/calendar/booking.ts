import { DateTime } from 'luxon';
import type { Appointment, AppointmentType, AvailabilityException, AvailabilityRule, Repeat } from '../model/types';
import { occurrences, occurrencesIn, type Occurrence } from './occurrences';
import { seriesStartOf, timeOf } from './series';
import { workingHours } from './slots';

export interface SessionSuggestion {
  /** In the time zone of the appointment it follows. */
  start: DateTime;
  durationMin: number;
  typeId: string | null;
  location: string;
  /** The interval of the series it follows; null when that was a single appointment. */
  intervalWeeks: 1 | 2 | null;
  /**
   * True when every date at that interval is already booked for the folder (a series that is
   * still running): `start` is then the next of those booked dates, not a free one.
   */
  booked: boolean;
}

const live = (appointments: Appointment[]) => appointments.filter((a) => !a.deleted && a.status !== 'cancelled');

/**
 * The session a suggestion follows. A date taken out of a series (marked done, cancelled or
 * moved on its own) stands for the series: its rhythm, length and type, from where the date
 * sat in it, so a one-off move does not move the next session too.
 */
function rhythmOf(ref: Occurrence, own: Appointment[]): { a: Appointment; start: DateTime } {
  const single = ref.appointment;
  const series = !single.repeat && single.series_id ? own.find((x) => x.id === single.series_id && x.repeat) : undefined;
  if (!series) return { a: single, start: ref.start };
  const slot = seriesStartOf(single) ?? `${ref.date}T${timeOf(series)}`;
  const start = DateTime.fromISO(slot, { zone: series.tz });
  return { a: series, start: start.isValid ? start : ref.start };
}

/**
 * The next session for one folder's appointments: same weekday, time, length and type as its
 * latest session that has started (or, with none yet, its first), one interval later (a week
 * after a single appointment), after `now` and on a date not already booked (or called off)
 * for the folder. Null when the folder has no appointments.
 */
export function suggestNextSession(appointments: Appointment[], now: DateTime): SessionSuggestion | null {
  const own = live(appointments);
  if (own.length === 0) return null;
  const past = occurrencesIn(own, now.minus({ days: 400 }), now).filter((o) => o.start <= now);
  const found = past[past.length - 1] ?? occurrencesIn(own, now.minus({ days: 400 }), now.plus({ days: 800 }))[0];
  if (!found) return null;
  const { a, start: from } = rhythmOf(found, own);
  const step = a.repeat?.interval_weeks ?? 1;
  // A single date that was called off is not offered again.
  const calledOff = appointments.filter((x) => !x.deleted && !x.repeat && x.status === 'cancelled');
  const booked = (start: DateTime) => {
    const end = start.plus({ minutes: a.duration_min });
    return own.some((x) => occurrences(x, start, end).length > 0) || calledOff.some((x) => occurrences(x, start, end).length > 0);
  };
  let candidate = from.plus({ weeks: step });
  let first: DateTime | null = null;
  for (let i = 0; i < 104; i++, candidate = candidate.plus({ weeks: step })) {
    if (candidate <= now) continue;
    first ??= candidate;
    if (!booked(candidate)) break;
  }
  const taken = booked(candidate);
  return {
    start: taken ? first ?? candidate : candidate,
    durationMin: a.duration_min,
    typeId: a.type_id,
    location: a.location,
    intervalWeeks: a.repeat ? a.repeat.interval_weeks : null,
    booked: taken,
  };
}

export interface BookingDefaults {
  start: DateTime;
  durationMin: number;
  typeId: string | null;
  location: string;
  /** True when `start` is the suggested next session, false for a plain "tomorrow" start. */
  suggested: boolean;
}

/**
 * What a new appointment for a folder starts with: the suggested next session; with a series
 * still running, tomorrow at its time, length and type (an extra session); with no
 * appointments, tomorrow at 09:00 for the usual length.
 */
export function bookingDefaults(appointments: Appointment[], now: DateTime, usualMin: number, types: FollowUpTypes = []): BookingDefaults {
  const s = suggestNextSession(appointments, now);
  const tomorrow = now.plus({ days: 1 });
  // After a first consultation, the next one is an ordinary session.
  const kind = s ? followUpType({ typeId: s.typeId, durationMin: s.durationMin }, types, usualMin) : null;
  if (s && kind && !s.booked) return { start: s.start.setZone(now.zone), ...kind, location: s.location, suggested: true };
  if (s && kind) {
    const local = s.start.setZone(now.zone);
    return { start: tomorrow.set({ hour: local.hour, minute: local.minute, second: 0, millisecond: 0 }), ...kind, location: s.location, suggested: false };
  }
  return { start: tomorrow.set({ hour: 9, minute: 0, second: 0, millisecond: 0 }), durationMin: usualMin, typeId: null, location: '', suggested: false };
}

type FollowUpTypes = Pick<AppointmentType, 'id' | 'duration_min' | 'for_new_patients' | 'archived' | 'deleted'>[];

/**
 * The type and length to suggest for the session after one of type `typeId`: the same, except
 * after a type for new patients (a first consultation). Then it is the first type in use that is
 * not for new patients, with its length, or no type and `usualMin` when there is none.
 */
export function followUpType(
  session: { typeId: string | null; durationMin: number },
  types: FollowUpTypes,
  usualMin: number,
): { typeId: string | null; durationMin: number } {
  if (!types.find((ty) => ty.id === session.typeId)?.for_new_patients) return session;
  const next = types.find((ty) => !ty.deleted && !ty.archived && !ty.for_new_patients);
  return next ? { typeId: next.id, durationMin: next.duration_min } : { typeId: null, durationMin: usualMin };
}

export interface PlannedAppointment {
  start: DateTime;
  durationMin: number;
  repeat?: Pick<Repeat, 'interval_weeks' | 'until'> | null;
  /** Appointments not to count, e.g. the one being edited and the series it belongs to. */
  ignoreIds?: string[];
  /** Single dates not to count, e.g. the date of a series being changed on its own. */
  ignoreOccurrences?: { id: string; date: string }[];
}

export interface Clash {
  date: string;
  start: DateTime;
  with: Occurrence;
}

/** Existing sessions that overlap a planned appointment: its own date, or a series' next `count` dates. */
export function conflictsFor(planned: PlannedAppointment, appointments: Appointment[], count = 12): Clash[] {
  const ignore = new Set(planned.ignoreIds ?? []);
  const others = live(appointments).filter((a) => !ignore.has(a.id));
  const skip = new Set((planned.ignoreOccurrences ?? []).map((o) => `${o.id}@${o.date}`));
  const zone = planned.start.zoneName ?? 'UTC';
  const self: Appointment = {
    id: '', created_at: '', updated_at_hlc: '', deleted: false, folder_id: null, title: '', type_id: null,
    start_local: planned.start.toFormat("yyyy-MM-dd'T'HH:mm"), tz: zone, duration_min: planned.durationMin,
    repeat: planned.repeat ? { interval_weeks: planned.repeat.interval_weeks, until: planned.repeat.until, exceptions: [] } : null,
    location: '', status: 'confirmed', note: '', series_id: null,
  };
  const span = planned.repeat ? planned.repeat.interval_weeks * count : 1;
  const dates = occurrences(self, planned.start, planned.start.plus({ weeks: span })).slice(0, count);
  return dates.flatMap((d) =>
    occurrencesIn(others, d.start, d.end)
      .filter((o) => !skip.has(`${o.appointment.id}@${o.date}`))
      .map((o) => ({ date: d.date, start: d.start, with: o })),
  );
}

/**
 * Whether a session falls outside the working hours: 'off' on a day with no hours (or a day off),
 * 'outside' when it does not fit inside the hours, null when it fits. With no working hours set
 * at all, nothing is ever outside them.
 */
export function outsideWorkingHours(
  start: DateTime, // in the practice time zone
  durationMin: number,
  rules: AvailabilityRule[],
  exceptions: AvailabilityException[],
): 'off' | 'outside' | null {
  if (!rules.some((r) => !r.deleted)) return null;
  const hours = workingHours(start, rules, exceptions);
  if (hours.length === 0) return 'off';
  const end = start.plus({ minutes: durationMin });
  return hours.some((h) => h.start <= start && end <= h.end) ? null : 'outside';
}
