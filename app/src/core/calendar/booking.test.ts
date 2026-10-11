import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Appointment, AvailabilityRule } from '../model/types';
import { bookingDefaults, conflictsFor, outsideWorkingHours, suggestNextSession } from './booking';
import { detachOccurrence, formOf } from './series';

const base = { created_at: '', updated_at_hlc: '', deleted: false };
const appt = (over: Partial<Appointment>): Appointment => ({
  ...base, id: 'a1', folder_id: 'f1', title: '', type_id: 't1', start_local: '2026-09-14T09:00', tz: 'Europe/Lisbon',
  duration_min: 50, repeat: null, location: 'Room 2', status: 'confirmed', note: '', series_id: null, ...over,
});
const at = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Lisbon' });

describe('suggestNextSession', () => {
  it('is null for a folder with no appointments', () => {
    expect(suggestNextSession([], at('2026-09-28T10:00'))).toBeNull();
  });

  it('suggests a week after a single session, with its length, type and place', () => {
    const s = suggestNextSession([appt({ start_local: '2026-09-28T09:00' })], at('2026-09-28T10:00'))!;
    expect(s.start.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-10-05T09:00');
    expect([s.durationMin, s.typeId, s.location, s.intervalWeeks]).toEqual([50, 't1', 'Room 2', null]);
  });

  it('follows a fortnightly series that has ended, after now', () => {
    const a = appt({ start_local: '2026-08-03T18:00', repeat: { interval_weeks: 2, until: '2026-09-14', exceptions: [] } });
    const s = suggestNextSession([a], at('2026-09-28T19:00'))!;
    expect(s.start.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-10-12T18:00');
    expect(s.intervalWeeks).toBe(2);
  });

  it('keeps a fortnightly rhythm after its last date was marked done or moved on its own', () => {
    const series = appt({ id: 's1', start_local: '2026-09-03T09:00', repeat: { interval_weeks: 2, until: '2026-10-01', exceptions: [] } });
    const now = at('2026-10-02T10:00');
    expect(suggestNextSession([series], now)!.start.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-10-15T09:00');
    for (const change of [{ status: 'done' as const }, { date: '2026-10-02', time: '08:00' }]) {
      const [kept, single] = detachOccurrence(series, '2026-10-01', { ...formOf(series, '2026-10-01'), ...change });
      const after = [{ ...series, ...kept, id: 's1' }, { ...base, ...single, id: 'x1' }] as Appointment[];
      const s = suggestNextSession(after, now)!;
      expect([s.start.toFormat("yyyy-MM-dd'T'HH:mm"), s.intervalWeeks, s.durationMin]).toEqual(['2026-10-15T09:00', 2, 50]);
    }
  });

  it('skips dates already booked for the folder', () => {
    const past = appt({ id: 'a1', start_local: '2026-09-28T09:00' });
    const booked = appt({ id: 'a2', start_local: '2026-10-05T09:00' });
    const s = suggestNextSession([past, booked], at('2026-09-28T10:00'))!;
    expect(s.start.toISODate()).toBe('2026-10-12');
  });

  it('does not offer a date that was called off', () => {
    const past = appt({ id: 'a1', start_local: '2026-09-28T09:00' });
    const off = appt({ id: 'a2', start_local: '2026-10-05T09:00', status: 'cancelled' });
    expect(suggestNextSession([past, off], at('2026-09-28T10:00'))!.start.toISODate()).toBe('2026-10-12');
  });

  it('ignores cancelled and deleted appointments', () => {
    const s = suggestNextSession([appt({ status: 'cancelled' }), appt({ id: 'a2', deleted: true })], at('2026-09-28T10:00'));
    expect(s).toBeNull();
  });

  it('says when a running series already books every date', () => {
    const running = appt({ start_local: '2026-09-14T09:00', repeat: { interval_weeks: 1, until: null, exceptions: [] } });
    const s = suggestNextSession([running], at('2026-09-28T10:00'))!;
    expect([s.start.toISODate(), s.booked]).toEqual(['2026-10-05', true]);
    expect(suggestNextSession([appt({ start_local: '2026-09-28T09:00' })], at('2026-09-28T10:00'))!.booked).toBe(false);
  });

  it('keeps the wall-clock time across the October change', () => {
    const s = suggestNextSession([appt({ start_local: '2026-10-19T09:00' })], at('2026-10-19T10:00'))!;
    expect(s.start.toFormat("yyyy-MM-dd'T'HH:mm")).toBe('2026-10-26T09:00');
  });
});

describe('bookingDefaults', () => {
  const now = at('2026-09-28T10:00');

  it('starts from the suggestion when there is one', () => {
    const d = bookingDefaults([appt({ start_local: '2026-09-21T15:00', duration_min: 45 })], now, 50);
    expect([d.start.toFormat("yyyy-MM-dd'T'HH:mm"), d.durationMin, d.typeId, d.suggested]).toEqual(['2026-09-28T15:00', 45, 't1', true]);
  });

  it('offers tomorrow at the series time while a series is running', () => {
    const running = appt({ start_local: '2026-09-14T18:00', repeat: { interval_weeks: 1, until: null, exceptions: [] } });
    const d = bookingDefaults([running], now, 50);
    expect([d.start.toFormat("yyyy-MM-dd'T'HH:mm"), d.durationMin, d.suggested]).toEqual(['2026-09-29T18:00', 50, false]);
  });

  it('offers tomorrow at 09:00 for the usual length without any appointment', () => {
    const d = bookingDefaults([], now, 45);
    expect([d.start.toFormat("yyyy-MM-dd'T'HH:mm"), d.durationMin, d.typeId, d.location]).toEqual(['2026-09-29T09:00', 45, null, '']);
  });
});

describe('conflictsFor', () => {
  const other = appt({ id: 'b1', folder_id: 'f2', start_local: '2026-10-05T09:30', repeat: { interval_weeks: 1, until: null, exceptions: ['2026-10-12'] } });

  it('finds an overlapping session', () => {
    const c = conflictsFor({ start: at('2026-10-05T09:00'), durationMin: 50 }, [other]);
    expect(c.map((x) => [x.date, x.with.appointment.id])).toEqual([['2026-10-05', 'b1']]);
  });

  it('checks the next dates of a planned series, minus the other series’ exceptions', () => {
    const c = conflictsFor({ start: at('2026-10-05T09:00'), durationMin: 50, repeat: { interval_weeks: 1, until: null } }, [other], 3);
    expect(c.map((x) => x.date)).toEqual(['2026-10-05', '2026-10-19']);
  });

  it('does not count the appointment being edited, or cancelled ones', () => {
    expect(conflictsFor({ start: at('2026-10-05T09:00'), durationMin: 50, ignoreIds: ['b1'] }, [other])).toEqual([]);
    expect(conflictsFor({ start: at('2026-10-05T09:00'), durationMin: 50 }, [{ ...other, status: 'cancelled' }])).toEqual([]);
  });

  it('does not count the date being changed, but does count the rest of its series', () => {
    const own = appt({ id: 's1', start_local: '2026-09-28T09:00', repeat: { interval_weeks: 1, until: null, exceptions: [] } });
    expect(conflictsFor({ start: at('2026-10-05T09:15'), durationMin: 50, ignoreOccurrences: [{ id: 's1', date: '2026-10-05' }] }, [own])).toEqual([]);
    expect(conflictsFor({ start: at('2026-10-12T09:15'), durationMin: 50, ignoreOccurrences: [{ id: 's1', date: '2026-10-05' }] }, [own])).toHaveLength(1);
  });

  it('does not count sessions that only touch', () => {
    expect(conflictsFor({ start: at('2026-10-05T08:40'), durationMin: 50 }, [other])).toEqual([]);
  });
});

describe('outsideWorkingHours', () => {
  const rule = (weekday: AvailabilityRule['weekday'], start: string, end: string): AvailabilityRule => ({ ...base, id: `r${weekday}`, weekday, start, end });
  const rules = [rule(1, '09:00', '13:00'), rule(1, '14:00', '18:00')];

  it('is null without working hours, or when the session fits', () => {
    expect(outsideWorkingHours(at('2026-09-28T07:00'), 50, [], [])).toBeNull();
    expect(outsideWorkingHours(at('2026-09-28T09:00'), 50, rules, [])).toBeNull();
  });

  it('says outside when the session runs past the hours, and off on a day without hours', () => {
    expect(outsideWorkingHours(at('2026-09-28T12:30'), 50, rules, [])).toBe('outside');
    expect(outsideWorkingHours(at('2026-09-29T09:00'), 50, rules, [])).toBe('off');
    expect(outsideWorkingHours(at('2026-09-28T09:00'), 50, rules, [{ ...base, id: 'x', date: '2026-09-28', kind: 'off', start: null, end: null }])).toBe('off');
  });
});
