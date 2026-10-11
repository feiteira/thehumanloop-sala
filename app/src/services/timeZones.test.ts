import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { canonicalTimeZone, IBERIAN_ZONES, searchTimeZones, zoneCity, zoneOffset } from './timeZones';

describe('time zones', () => {
  it('saves the canonical name, whatever the case', () => {
    expect(canonicalTimeZone('europe/lisbon')).toBe('Europe/Lisbon');
    expect(canonicalTimeZone(' Europe/Madrid ')).toBe('Europe/Madrid');
    expect(canonicalTimeZone('Lisboa')).toBeNull();
    expect(canonicalTimeZone('')).toBeNull();
  });

  it('lists Portugal and Spain first, then the current zone’s neighbours', () => {
    const list = searchTimeZones('', { current: 'Europe/Berlin' });
    expect(list[0]).toBe('Europe/Berlin');
    expect(list.slice(1, 1 + IBERIAN_ZONES.length)).toEqual([...IBERIAN_ZONES]);
    expect(list.length).toBeGreaterThan(100);
    expect(new Set(list).size).toBe(list.length);
  });

  it('finds zones by city or country in Portuguese, Spanish or English, accents optional', () => {
    expect(searchTimeZones('lisboa')[0]).toBe('Europe/Lisbon');
    expect(searchTimeZones('Acores')[0]).toBe('Atlantic/Azores');
    expect(searchTimeZones('canarias')[0]).toBe('Atlantic/Canary');
    expect(searchTimeZones('españa')[0]).toBe('Europe/Madrid');
    expect(searchTimeZones('new york')).toContain('America/New_York');
    expect(searchTimeZones('europe/lisbon')[0]).toBe('Europe/Lisbon');
    expect(searchTimeZones('qwertyuiop')).toEqual([]);
    expect(searchTimeZones('america', { limit: 5 })).toHaveLength(5);
  });

  it('names zones in the therapist’s language', () => {
    expect(zoneCity('Atlantic/Azores', 'pt')).toBe('Açores');
    expect(zoneCity('Atlantic/Canary', 'es')).toBe('Canarias');
    expect(zoneCity('America/New_York', 'en')).toBe('New York');
    expect(zoneOffset('Europe/Lisbon', DateTime.fromISO('2026-01-15T12:00:00Z'))).toBe('UTC+00:00');
    expect(zoneOffset('Europe/Madrid', DateTime.fromISO('2026-07-15T12:00:00Z'))).toBe('UTC+02:00');
  });
});
