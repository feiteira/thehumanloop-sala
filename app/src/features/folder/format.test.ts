import { describe, expect, it } from 'vitest';
import type { Appointment } from '../../core/model/types';
import { makeI18n } from '../../ui/i18n';
import { sessionDate } from '../common/dates';
import { attachMessage, dayMonth, describeFuture, instantDate } from './format';

const en = makeI18n('en');
const pt = makeI18n('pt');
const TODAY = '2026-09-28';

const appt = (start: string, interval: 1 | 2 | null): Appointment => ({
  id: start, created_at: '', updated_at_hlc: '', deleted: false, folder_id: 'f', title: '', type_id: null, start_local: start, tz: 'Europe/Lisbon',
  duration_min: 50, repeat: interval ? { interval_weeks: interval, until: null, exceptions: [] } : null, location: '', status: 'confirmed', note: '', series_id: null,
});

describe('folder dates', () => {
  it('leave the year out only in the current year', () => {
    expect(sessionDate(en, '2026-09-21', TODAY)).toMatch(/Mon.*21.*Sep/);
    expect(sessionDate(en, '2025-09-21', TODAY)).toMatch(/21.*Sep.*2025/);
    expect(dayMonth(en, '2026-09-21', TODAY)).not.toMatch(/2026/);
    expect(dayMonth(pt, '2025-12-01', TODAY)).toMatch(/2025/);
  });

  it('read an instant in the practice’s time zone', () => {
    // 23:30 UTC on 30 September is already 1 October in Lisbon (UTC+1 in summer).
    expect(instantDate(en, '2026-09-30T23:30:00.000Z', 'Europe/Lisbon')).toMatch(/1 Oct/);
    expect(instantDate(en, '2026-09-30T23:30:00.000Z', 'UTC')).toMatch(/30 Sep/);
    expect(instantDate(en, null, 'UTC')).toBe('');
  });
});

describe('describeFuture', () => {
  it('names each series and counts single appointments', () => {
    const text = describeFuture(en, [appt('2026-10-01T09:00', 1), appt('2026-10-06T18:30', 2)], 2);
    expect(text).toBe('Every week: Thursday, 09:00, Every two weeks: Tuesday, 18:30 and 2 single appointments');
    expect(describeFuture(pt, [appt('2026-10-01T09:00', 1)], 0)).toBe('Todas as semanas: quinta-feira, 09:00');
    expect(describeFuture(pt, [], 1)).toBe('1 marcação isolada');
  });
});

describe('attachMessage', () => {
  it('reports what was attached and what was not', () => {
    expect(attachMessage(en, { added: 2, tooLarge: 1, failed: 0 })).toBe('2 files attached, 1 file too large (the limit is 200 MB)');
    expect(attachMessage(en, { added: 0, tooLarge: 0, failed: 1 })).toBe('1 file could not be read');
    expect(attachMessage(en, { added: 0, tooLarge: 0, failed: 0 })).toBeNull();
  });
});
