import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { ResumePoint } from './resume';

const LISBON = 'Europe/Lisbon';
const at = (day: number, hour: number, zone = LISBON) => DateTime.fromObject({ year: 2026, month: 9, day, hour }, { zone }).toMillis();

describe('ResumePoint', () => {
  it('returns to the place of an idle lock once, for the same practice, on the same day', () => {
    const r = new ResumePoint();
    r.remember('p1', { name: 'folder', id: 'f', pageId: 'pg' }, LISBON, at(28, 10));
    expect(r.take('p1', at(28, 11))).toEqual({ name: 'folder', id: 'f', pageId: 'pg' });
    expect(r.take('p1', at(28, 11))).toBeNull();
  });

  it('never opens another practice at the place', () => {
    const r = new ResumePoint();
    r.remember('p1', { name: 'shelf', q: 'ana' }, LISBON, at(28, 10));
    expect(r.take('p2', at(28, 10))).toBeNull();
    expect(r.take('p1', at(28, 10))).toBeNull();
  });

  it('starts a new day on Today', () => {
    const r = new ResumePoint();
    r.remember('p1', { name: 'calendar' }, LISBON, at(28, 18));
    expect(r.take('p1', at(29, 9))).toBeNull();
  });

  it('forgets on a lock the therapist chose', () => {
    const r = new ResumePoint();
    r.remember('p1', { name: 'calendar' }, LISBON, at(28, 10));
    r.forget();
    expect(r.take('p1', at(28, 10))).toBeNull();
  });

  it('does not return to The Human Loop’s screens', () => {
    const r = new ResumePoint();
    r.remember('p1', { name: 'loop', screen: 'Patients' }, LISBON, at(28, 10));
    expect(r.take('p1', at(28, 10))).toBeNull();
  });

  it('judges the same day in the practice’s time zone, not the computer’s', () => {
    const r = new ResumePoint();
    // 23:00 and 00:00 in Lisbon (summer, UTC+1) fall on one UTC date but are two days.
    r.remember('p1', { name: 'calendar' }, LISBON, at(28, 23));
    expect(r.take('p1', at(29, 0))).toBeNull();
    // 00:00 and 23:00 in Lisbon fall on two UTC dates but are one day.
    r.remember('p1', { name: 'calendar' }, LISBON, at(28, 0));
    expect(r.take('p1', at(28, 23))).toEqual({ name: 'calendar' });
    // The same moments in São Paulo (UTC-3): 20:00 and 22:00, one day there.
    r.remember('p1', { name: 'today' }, 'America/Sao_Paulo', at(28, 20, 'America/Sao_Paulo'));
    expect(r.take('p1', at(28, 22, 'America/Sao_Paulo'))).toEqual({ name: 'today' });
  });
});
