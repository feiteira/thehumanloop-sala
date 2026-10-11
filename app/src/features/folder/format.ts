import { DateTime } from 'luxon';
import { startOf } from '../../core/calendar/occurrences';
import type { Appointment } from '../../core/model/types';
import type { I18n } from '../../ui/i18n';

// Dates as the folder shows them. Session dates are local dates already (YYYY-MM-DD); instants
// (archived, peeled) are read in the practice's time zone. The year appears only when it is
// not the current one.

const sameYear = (dt: DateTime, todayIso: string) => dt.year === Number(todayIso.slice(0, 4));

/** "21 Sept", or "21 Sept 2025" in another year (en-GB). */
export function dayMonth(i18n: I18n, iso: string, todayIso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  return sameYear(dt, todayIso) ? dt.setLocale(i18n.meta.bcp47).toLocaleString({ day: 'numeric', month: 'short' }) : i18n.date(dt, 'medium');
}

/** The day an instant (an ISO timestamp) fell on in the practice's time zone, as "28 Sep 2026". */
export function instantDate(i18n: I18n, isoInstant: string | null, tz: string): string {
  if (!isoInstant) return '';
  const dt = DateTime.fromISO(isoInstant, { zone: 'utc' }).setZone(tz);
  return dt.isValid ? i18n.date(dt, 'medium') : isoInstant.slice(0, 10);
}

/** Sessions still to come, in words: "Every week: Thursday, 09:00 and 2 single appointments". */
export function describeFuture(i18n: I18n, series: Appointment[], singles: number): string {
  const parts = series.map((a) => {
    const start = startOf(a);
    const vars = { weekday: start.setLocale(i18n.meta.bcp47).toFormat('cccc'), time: i18n.time(start) };
    return a.repeat?.interval_weeks === 2 ? i18n.t('folder.everyTwoWeeks', vars) : i18n.t('folder.everyWeek', vars);
  });
  if (singles) parts.push(i18n.tp('folder.singles', singles));
  try {
    return new Intl.ListFormat(i18n.meta.bcp47, { type: 'conjunction' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}

/** What happened to the files chosen in one go. */
export interface AttachResult {
  added: number;
  tooLarge: number;
  failed: number;
}

/** "2 files attached, 1 file too large (the limit is 200 MB)", or null when nothing was chosen. */
export function attachMessage({ tp }: Pick<I18n, 'tp'>, r: AttachResult): string | null {
  const parts = [
    r.added ? tp('page.attached', r.added) : '',
    r.tooLarge ? tp('page.attachTooLarge', r.tooLarge) : '',
    r.failed ? tp('page.attachFailed', r.failed) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
