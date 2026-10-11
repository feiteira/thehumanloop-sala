import { DateTime } from 'luxon';
import type { UiLocale } from '../i18n/locales';
import { fold } from './normalize';

// Dates and times as therapists type them. Day first, as written in Portugal and Spain and
// in Sala's British English; the year is optional, and "today", "tomorrow" and "yesterday"
// work in every interface language. Records keep ISO (yyyy-MM-dd, HH:mm); these helpers
// only sit between a field and the record.

/** The short numeric date each interface language shows: 28/09/2026. */
const DATE_FORMAT: Record<UiLocale, string> = { en: 'dd/MM/yyyy', pt: 'dd/MM/yyyy', es: 'dd/MM/yyyy' };

// Accent-folded, so "amanhã" and "mañana" match as typed or without accents.
const DAY_WORDS = new Map<string, number>([
  ['today', 0], ['hoje', 0], ['hoy', 0],
  ['tomorrow', 1], ['amanha', 1], ['manana', 1],
  ['yesterday', -1], ['ontem', -1], ['ayer', -1],
]);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export type DateCheck = { ok: true; iso: string } | { ok: false; reason: 'empty' | 'format' | 'impossible' };
export type TimeCheck = { ok: true; time: string } | { ok: false; reason: 'empty' | 'format' | 'impossible' };

const utcDate = (iso: string) => DateTime.fromISO(iso.slice(0, 10), { zone: 'utc' });

/** yy → yyyy, within 80 years before and 20 after the reference year: 85 → 1985, 27 → 2027. */
function fullYear(yy: number, refYear: number): number {
  let y = Math.floor(refYear / 100) * 100 + yy;
  if (y > refYear + 20) y -= 100;
  else if (y < refYear - 80) y += 100;
  return y;
}

function build(y: number, m: number, d: number): DateCheck {
  if (y < 1900 || y > 2199) return { ok: false, reason: 'impossible' };
  const dt = DateTime.fromObject({ year: y, month: m, day: d }, { zone: 'utc' });
  return dt.isValid ? { ok: true, iso: dt.toISODate()! } : { ok: false, reason: 'impossible' };
}

/**
 * Reads a typed date: 28/09/2026, 28-9-26, 28.9.2026, 28/9 (this year), 2026-09-28, or
 * today / tomorrow / yesterday in English, Portuguese or Spanish. `today` (ISO) anchors the
 * words and the missing year. It has no default, because the computer's date is not always
 * the practice's: pass today in the practice's time zone.
 */
export function checkLocalDate(input: string, _locale: UiLocale, opts: { today: string }): DateCheck {
  const s = fold(input).replace(/\s*([-/.])\s*/g, '$1');
  if (!s) return { ok: false, reason: 'empty' };
  const { today } = opts;
  const shift = DAY_WORDS.get(s);
  if (shift !== undefined) return { ok: true, iso: addDays(today, shift) };
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (iso) return build(+iso[1]!, +iso[2]!, +iso[3]!);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{4}|\d{2}))?$/.exec(s);
  if (!dmy) return { ok: false, reason: 'format' };
  const refYear = utcDate(today).year;
  const y = dmy[3] === undefined ? refYear : dmy[3].length === 2 ? fullYear(+dmy[3], refYear) : +dmy[3];
  return build(y, +dmy[2]!, +dmy[1]!);
}

/** `checkLocalDate`, as the ISO date or null when it is empty or not a date. */
export function parseLocalDate(input: string, locale: UiLocale, opts: { today: string }): string | null {
  const r = checkLocalDate(input, locale, opts);
  return r.ok ? r.iso : null;
}

/** An ISO calendar date (yyyy-MM-dd…) in the language's short numeric form: 28/09/2026. */
export function formatLocalDate(iso: string, locale: UiLocale): string {
  if (!ISO_DATE.test(iso)) return iso;
  const dt = utcDate(iso);
  return dt.isValid ? dt.toFormat(DATE_FORMAT[locale]) : iso;
}

/** Calendar arithmetic on ISO dates, free of time zones and daylight-saving changes. */
export function addDays(iso: string, days: number): string {
  return utcDate(iso).plus({ days }).toISODate()!;
}

/**
 * Reads a typed time of day as HH:mm: 9, 9:5 (09:05), 0930, 930, 9h30, 9.30, 21:00, and
 * 9pm or 9:30 am for those who write it that way.
 */
export function checkLocalTime(input: string): TimeCheck {
  let s = fold(input).replace(/\s+/g, '');
  if (!s) return { ok: false, reason: 'empty' };
  let half: 'a' | 'p' | null = null;
  const ampm = /^(.*?)([ap])\.?m\.?$/.exec(s);
  if (ampm) {
    s = ampm[1]!;
    half = ampm[2] as 'a' | 'p';
  }
  const m = /^(\d{1,2})(?:[:h.](\d{1,2})?)?$/.exec(s) ?? /^(\d{1,2})(\d{2})$/.exec(s);
  if (!m) return { ok: false, reason: 'format' };
  let h = +m[1]!;
  const min = m[2] === undefined ? 0 : +m[2];
  if (half) {
    if (h < 1 || h > 12) return { ok: false, reason: 'impossible' };
    h = (h % 12) + (half === 'p' ? 12 : 0);
  }
  if (h > 23 || min > 59) return { ok: false, reason: 'impossible' };
  return { ok: true, time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

/**
 * Moves an HH:mm time by whole steps along the step grid: with 15 minutes, 09:07 goes up to
 * 09:15 and down to 09:00. Stays put rather than crossing midnight.
 */
export function stepTime(time: string, steps: number, stepMin = 15): string {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || steps === 0) return time;
  const total = +m[1]! * 60 + +m[2]!;
  const off = total % stepMin;
  const next = steps > 0 ? total - off + steps * stepMin : total - off + (off ? steps + 1 : steps) * stepMin;
  if (next < 0 || next > 24 * 60 - 1) return time;
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}
