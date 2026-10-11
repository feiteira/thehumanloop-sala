import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from '../i18n/locales';
import { addDays, checkLocalDate, checkLocalTime, formatLocalDate, parseLocalDate, stepTime } from './dates';

const today = '2026-10-01';

describe.each(UI_LOCALES)('parseLocalDate (%s)', (locale) => {
  const p = (s: string) => parseLocalDate(s, locale, { today });

  it('reads day-first dates with any separator', () => {
    expect(p('28/09/2026')).toBe('2026-09-28');
    expect(p('28-9-2026')).toBe('2026-09-28');
    expect(p('2.3.2026')).toBe('2026-03-02');
    expect(p(' 28 / 09 / 2026 ')).toBe('2026-09-28');
  });

  it('reads two-digit and missing years', () => {
    expect(p('28-09-26')).toBe('2026-09-28');
    expect(p('5/1/27')).toBe('2027-01-05');
    expect(p('15/03/85')).toBe('1985-03-15');
    expect(p('28/9')).toBe('2026-09-28');
  });

  it('reads ISO dates', () => {
    expect(p('2026-09-28')).toBe('2026-09-28');
    expect(p('2026-9-8')).toBe('2026-09-08');
  });

  it('reads today, tomorrow and yesterday in every language', () => {
    for (const w of ['today', 'Hoje', 'HOY']) expect(p(w)).toBe('2026-10-01');
    for (const w of ['tomorrow', 'amanhã', 'amanha', 'mañana', 'Manana']) expect(p(w)).toBe('2026-10-02');
    for (const w of ['yesterday', 'ontem', 'ayer']) expect(p(w)).toBe('2026-09-30');
  });

  it('rejects impossible dates', () => {
    for (const s of ['30/02/2026', '29/02/2027', '31/04/2026', '0/1/2026', '1/13/2026', '2026-02-30', '1/1/1850']) {
      expect(checkLocalDate(s, locale, { today }), s).toEqual({ ok: false, reason: 'impossible' });
    }
    expect(p('29/02/2028')).toBe('2028-02-29');
  });

  it('tells empty from unreadable', () => {
    expect(checkLocalDate('  ', locale, { today })).toEqual({ ok: false, reason: 'empty' });
    for (const s of ['next week', '28/09/202', '28', '28/09/2026/1', 'constructor', '2026-09']) {
      expect(checkLocalDate(s, locale, { today }), s).toEqual({ ok: false, reason: 'format' });
    }
  });

  it('formats as the short numeric date and reads it back', () => {
    expect(formatLocalDate('2026-09-28', locale)).toBe('28/09/2026');
    expect(formatLocalDate('2026-01-05', locale)).toBe('05/01/2026');
    expect(p(formatLocalDate('2027-12-31', locale))).toBe('2027-12-31');
  });
});

describe('date helpers', () => {
  it('leaves what is not an ISO date alone', () => {
    expect(formatLocalDate('', 'pt')).toBe('');
    expect(formatLocalDate('soon', 'en')).toBe('soon');
  });

  it('adds days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(addDays('2026-10-01', -7)).toBe('2026-09-24');
  });
});

describe('checkLocalTime', () => {
  it('reads the ways people type a time', () => {
    const cases: [string, string][] = [
      ['9', '09:00'], ['21', '21:00'], ['9:5', '09:05'], ['9:30', '09:30'], ['0930', '09:30'], ['930', '09:30'],
      ['9h30', '09:30'], ['9h', '09:00'], ['9.30', '09:30'], ['21:00', '21:00'], ['2100', '21:00'], [' 07 : 45 ', '07:45'],
      ['9pm', '21:00'], ['9:30 am', '09:30'], ['12am', '00:00'], ['12 p.m.', '12:00'], ['0', '00:00'],
    ];
    for (const [s, want] of cases) expect(checkLocalTime(s), s).toEqual({ ok: true, time: want });
  });

  it('rejects impossible and unreadable times', () => {
    for (const s of ['24:00', '9:60', '25', '13pm', '0am']) expect(checkLocalTime(s), s).toEqual({ ok: false, reason: 'impossible' });
    for (const s of ['nine', '9:30:00', '12345', 'am', '9-30']) expect(checkLocalTime(s), s).toEqual({ ok: false, reason: 'format' });
    expect(checkLocalTime('')).toEqual({ ok: false, reason: 'empty' });
  });
});

describe('stepTime', () => {
  it('moves along the quarter-hour grid', () => {
    expect(stepTime('09:00', 1)).toBe('09:15');
    expect(stepTime('09:00', -1)).toBe('08:45');
    expect(stepTime('09:07', 1)).toBe('09:15');
    expect(stepTime('09:07', -1)).toBe('09:00');
    expect(stepTime('09:07', -2)).toBe('08:45');
    expect(stepTime('09:50', 4)).toBe('10:45');
    expect(stepTime('09:00', 1, 5)).toBe('09:05');
  });

  it('never crosses midnight', () => {
    expect(stepTime('23:45', 1)).toBe('23:45');
    expect(stepTime('00:00', -1)).toBe('00:00');
    expect(stepTime('00:10', -1)).toBe('00:00');
  });
});
