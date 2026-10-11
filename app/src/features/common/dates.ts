import { DateTime } from 'luxon';
import type { I18n } from '../../ui/i18n';

// How screens say when a session is. Dates and times are read in the zone of the DateTimes
// given, so pass them in the practice's zone. The year appears only when it is not this one.

/** A session date (YYYY-MM-DD): "Mon 21 Sept", or "21 Sept 2025" in another year (en-GB). */
export function sessionDate(i18n: I18n, iso: string, todayIso: string): string {
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  return dt.year === Number(todayIso.slice(0, 4)) ? i18n.date(dt, 'weekday') : i18n.date(dt, 'medium');
}

/** "Today", "Yesterday", "Tomorrow", or the session date ("Fri 25 Sept"). */
export function dayName(i18n: I18n, start: DateTime, now: DateTime): string {
  const days = Math.round(now.startOf('day').diff(start.startOf('day'), 'days').days);
  if (days === 0) return i18n.t('common.today');
  if (days === 1) return i18n.t('common.yesterday');
  if (days === -1) return i18n.t('common.tomorrow');
  return i18n.date(start, start.year === now.year ? 'weekday' : 'medium');
}

/** "Tomorrow · 09:00", "Tue 29 Sept · 18:00". */
export function dayAndTime(i18n: I18n, start: DateTime, now: DateTime): string {
  return `${dayName(i18n, start, now)} · ${i18n.time(start)}`;
}
