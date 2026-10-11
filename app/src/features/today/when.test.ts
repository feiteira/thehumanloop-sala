import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { makeI18n } from '../../ui/i18n';
import { dayAndTime, dayName, sessionDate } from '../common/dates';
import { startsIn } from './when';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/Lisbon' });
const now = at('2026-09-28T09:00');
const en = makeI18n('en');
const pt = makeI18n('pt');

describe('dayName', () => {
  it('names the days around today, and dates the others', () => {
    expect(dayName(en, at('2026-09-28T18:00'), now)).toBe('Today');
    expect(dayName(en, at('2026-09-27T10:00'), now)).toBe('Yesterday');
    expect(dayName(pt, at('2026-09-29T10:00'), now)).toBe('Amanhã');
    expect(dayName(en, at('2026-09-25T10:00'), now)).toBe(en.date(at('2026-09-25T10:00'), 'weekday'));
    expect(dayName(en, at('2025-12-30T10:00'), now)).toBe(en.date(at('2025-12-30T10:00'), 'medium'));
  });
});

describe('startsIn', () => {
  it('counts minutes, then hours and minutes, never zero', () => {
    expect(startsIn(en, 25)).toBe('in 25 min');
    expect(startsIn(en, 0.2)).toBe('in 1 min');
    expect(startsIn(en, 120)).toBe('in 2 h');
    expect(startsIn(en, 90)).toBe('in 1 h 30 min');
    expect(startsIn(pt, 90)).toBe('daqui a 1 h 30 min');
  });
});

describe('sessionDate', () => {
  it('leaves out this year', () => {
    expect(sessionDate(en, '2026-09-21', '2026-09-28')).toBe(en.date(DateTime.fromISO('2026-09-21'), 'weekday'));
    expect(sessionDate(en, '2025-09-21', '2026-09-28')).toContain('2025');
    expect(sessionDate(en, 'not a date', '2026-09-28')).toBe('not a date');
  });
});

describe('dayAndTime', () => {
  it('says the day as Today does, then the time', () => {
    expect(dayAndTime(en, at('2026-09-28T18:00'), now)).toBe('Today · 18:00');
    expect(dayAndTime(en, at('2026-09-29T09:00'), now)).toBe('Tomorrow · 09:00');
  });
});
