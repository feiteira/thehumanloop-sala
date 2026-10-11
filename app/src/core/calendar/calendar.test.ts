import { DateTime, Settings } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Appointment, AvailabilityRule, Folder } from '../model/types';
import { emptyContact } from '../model/types';
import { escapeText, foldLine, initials, toIcs } from './ics';
import { calendarStart, gridHours, hourOfDay, placeOverlapping } from './layout';
import { hasDates, nextOccurrence, occurrences, occurrencesIn, readableStart } from './occurrences';
import { freeSlots } from './slots';

const base = { created_at: '', updated_at_hlc: '', deleted: false };
const appt = (over: Partial<Appointment>): Appointment => ({
  ...base, id: 'a1', folder_id: 'f1', title: '', type_id: null, start_local: '2026-09-28T09:00', tz: 'Europe/Lisbon',
  duration_min: 50, repeat: null, location: '', status: 'confirmed', note: '', series_id: null, ...over,
});
const range = (from: string, to: string, zone = 'Europe/Lisbon') =>
  [DateTime.fromISO(from, { zone }), DateTime.fromISO(to, { zone })] as const;

describe('occurrences', () => {
  for (const [tz, label] of [
    ['Europe/Lisbon', 'Lisbon'], ['Europe/Madrid', 'Madrid'], ['Atlantic/Azores', 'Azores'], ['Atlantic/Canary', 'Canaries'],
  ] as const) {
    it(`keeps weekly sessions at 09:00 across the October and March changes (${label})`, () => {
      const a = appt({ tz, start_local: '2026-10-19T09:00', repeat: { interval_weeks: 1, until: null, exceptions: [] } });
      const [from, to] = range('2026-10-19', '2027-04-05', tz);
      const occ = occurrences(a, from, to);
      expect(occ.length).toBe(24);
      expect(new Set(occ.map((o) => o.start.toFormat('HH:mm')))).toEqual(new Set(['09:00']));
      // The UTC offset does change: the wall-clock time is what is kept.
      expect(new Set(occ.map((o) => o.start.offset)).size).toBe(2);
    });
  }

  it('handles fortnightly repeats, an end date and skipped dates', () => {
    const a = appt({ repeat: { interval_weeks: 2, until: '2026-11-23', exceptions: ['2026-10-26'] } });
    const [from, to] = range('2026-09-01', '2027-01-01');
    expect(occurrences(a, from, to).map((o) => o.date)).toEqual(['2026-09-28', '2026-10-12', '2026-11-09', '2026-11-23']);
  });

  it('finds occurrences far into a series without walking from the start', () => {
    const a = appt({ start_local: '2020-01-06T10:00', repeat: { interval_weeks: 1, until: null, exceptions: [] } });
    const [from, to] = range('2026-09-28', '2026-10-05');
    expect(occurrences(a, from, to).map((o) => o.date)).toEqual(['2026-09-28']);
  });

  it('finds the next session and ignores cancelled ones', () => {
    const now = DateTime.fromISO('2026-09-28T12:00', { zone: 'Europe/Lisbon' });
    const next = nextOccurrence([
      appt({ id: 'x', start_local: '2026-09-30T10:00', status: 'cancelled' }),
      appt({ id: 'y', start_local: '2026-10-02T10:00' }),
    ], now);
    expect(next?.appointment.id).toBe('y');
  });
});

describe('free slots', () => {
  it('is working hours minus appointments', () => {
    const rule: AvailabilityRule = { ...base, id: 'r', weekday: 1, start: '09:00', end: '13:00' };
    const day = DateTime.fromISO('2026-09-28T00:00', { zone: 'Europe/Lisbon' });
    const busy = occurrencesIn([appt({ start_local: '2026-09-28T10:00', duration_min: 60 })], ...range('2026-09-28', '2026-09-29'));
    const free = freeSlots(day, [rule], [], busy);
    expect(free.map((s) => `${s.start.toFormat('HH:mm')}-${s.end.toFormat('HH:mm')}`)).toEqual(['09:00-10:00', '11:00-13:00']);
  });
});

describe('ics', () => {
  const folder: Folder = { ...base, id: 'f1', label: 'Inês Sousa', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null };

  it('writes initials-only titles by default style, repeats and skipped dates', () => {
    const ics = toIcs([appt({ repeat: { interval_weeks: 2, until: null, exceptions: ['2026-10-12'] } })], new Map([['f1', folder]]), { titleStyle: 'initials', neutralTitle: 'Appointment', now: new Date('2026-09-28T08:00:00Z') });
    expect(ics).toContain('SUMMARY:Appointment · I.S.');
    expect(ics).not.toContain('Sousa');
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20260928T090000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2');
    expect(ics).toContain('EXDATE;TZID=Europe/Lisbon:20261012T090000');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('leaves out series that end before they start, and cancelled appointments', () => {
    const empty = appt({ id: 'gone', repeat: { interval_weeks: 1, until: '2026-09-01', exceptions: [] } });
    const ics = toIcs([empty, appt({ id: 'off', status: 'cancelled' }), appt({ id: 'kept' })], new Map([['f1', folder]]), { titleStyle: 'initials', neutralTitle: 'Appointment' });
    expect(ics).toContain('UID:kept@sala');
    expect(ics).not.toContain('UID:gone@sala');
    expect(ics).not.toContain('UID:off@sala');
  });

  it('folds long lines on character boundaries', () => {
    const line = 'SUMMARY:' + 'ã'.repeat(80);
    const folded = foldLine(line);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('escapes commas, semicolons, backslashes and new lines in text', () => {
    expect(escapeText('Room 2; floor 1, left\\right\nring twice')).toBe('Room 2\\; floor 1\\, left\\\\right\\nring twice');
    const ics = toIcs([appt({ location: 'Rua A; 2.º, Lisboa' })], new Map([['f1', folder]]), { titleStyle: 'name', neutralTitle: 'Appointment' });
    expect(ics).toContain('LOCATION:Rua A\\; 2.º\\, Lisboa');
  });

  it('makes initials', () => {
    expect(initials('Inês Sousa')).toBe('I.S.');
    expect(initials('Silva, Ana')).toBe('S.A.');
  });
});

describe('the date the Calendar opens on', () => {
  it('is today in the practice’s time zone, whatever the computer’s', () => {
    const zone = Settings.defaultZone;
    Settings.defaultZone = 'America/Los_Angeles';
    try {
      // Thursday 16:42 in Los Angeles is already Friday 00:42 in Lisbon.
      const now = DateTime.fromISO('2026-10-01T23:42:00Z');
      expect(now.toISODate()).toBe('2026-10-01');
      expect(calendarStart(null, now, 'Europe/Lisbon')).toBe('2026-10-02');
      expect(calendarStart(undefined, now, 'America/Los_Angeles')).toBe('2026-10-01');
      expect(calendarStart('2026-11-05', now, 'Europe/Lisbon')).toBe('2026-11-05');
    } finally {
      Settings.defaultZone = zone;
    }
  });
});

describe('day layout', () => {
  const at = (hhmm: string) => DateTime.fromISO(`2026-09-28T${hhmm}`, { zone: 'Europe/Lisbon' });
  const item = (from: string, to: string) => ({ start: at(from), end: at(to) });

  it('narrows only the appointments that overlap', () => {
    const a = item('09:00', '09:50');
    const b = item('09:30', '10:20');
    const c = item('10:00', '10:50');
    const d = item('14:00', '14:50');
    const placed = placeOverlapping([d, c, b, a]);
    expect([a, b, c].map((x) => placed.get(x))).toEqual([{ lane: 0, lanes: 2 }, { lane: 1, lanes: 2 }, { lane: 0, lanes: 2 }]);
    expect(placed.get(d)).toEqual({ lane: 0, lanes: 1 });
  });

  it('lets appointments that only touch keep the whole width', () => {
    const a = item('09:00', '10:00');
    const b = item('10:00', '11:00');
    const placed = placeOverlapping([a, b]);
    expect([placed.get(a), placed.get(b)]).toEqual([{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
  });

  it('widens the hours to early and late appointments', () => {
    expect(gridHours([])).toEqual({ first: 7, last: 22 });
    expect(gridHours([{ start: 6.5, end: 7.5 }, { start: 21.5, end: 22.5 }])).toEqual({ first: 6, last: 23 });
    expect(gridHours([{ start: 23.5, end: 24.5 }])).toEqual({ first: 7, last: 24 });
  });

  it('reads hours on the wall clock, also on the day the clocks change', () => {
    const day = DateTime.fromISO('2026-10-25', { zone: 'Europe/Lisbon' });
    expect(hourOfDay(DateTime.fromISO('2026-10-25T09:30', { zone: 'Europe/Lisbon' }), day)).toBe(9.5);
    expect(hourOfDay(DateTime.fromISO('2026-10-26T00:30', { zone: 'Europe/Lisbon' }), day)).toBe(24.5);
  });
});

describe('an appointment an older version saved with an impossible date', () => {
  const bad = appt({ id: 'bad', start_local: '2026-09-31T10:00' });
  const good = appt({ id: 'good', start_local: '2026-10-01T10:00' });
  const [from, to] = range('2026-09-01', '2026-11-01');

  it('is shown nowhere, and breaks nothing around it', () => {
    expect(readableStart(bad)).toBeNull();
    expect(occurrences(bad, from, to)).toEqual([]);
    expect(occurrencesIn([bad, good], from, to).map((o) => o.appointment.id)).toEqual(['good']);
    expect(nextOccurrence([bad, good], from)?.appointment.id).toBe('good');
    expect(hasDates(bad)).toBe(false);
    expect(hasDates({ ...bad, repeat: { interval_weeks: 1, until: null, exceptions: [] } })).toBe(false);
  });

  it('is left out of the .ics file', () => {
    const ics = toIcs([bad, good], new Map(), { titleStyle: 'name', neutralTitle: 'Session', now: new Date('2026-09-28T09:00:00Z') });
    expect(ics).toContain('UID:good@sala');
    expect(ics).not.toContain('UID:bad@sala');
  });
});
