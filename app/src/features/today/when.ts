import type { I18n } from '../../ui/i18n';

// How Today says how soon a session starts. Dates are in features/common/dates.ts.

/** "in 25 min", "in 2 h", "in 1 h 30 min"; never "in 0 min". */
export function startsIn(i18n: I18n, minutes: number): string {
  const m = Math.max(1, Math.ceil(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = i18n.t('today.hours', { n: h });
  const duration = h === 0 ? i18n.t('common.minutes', { n: m }) : rest === 0 ? hours : `${hours} ${i18n.t('common.minutes', { n: rest })}`;
  return i18n.t('today.startsIn', { duration });
}
