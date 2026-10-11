import type { Store } from '../core/store/store';

// Practice-wide settings live in the encrypted store (they travel with exports);
// device preferences such as language and theme do not.

export const SETTING = {
  timeZone: 'practice.time_zone',
  icsTitleStyle: 'calendar.ics_title_style',
  importOcrLanguage: 'import.ocr_language',
  /** Minutes for a new appointment when nothing else suggests a length. */
  defaultDuration: 'calendar.default_duration',
  /** Sessions the therapist marked "No note needed" on Today: `${appointmentId}@${date}`. */
  noNoteNeeded: 'today.no_note_needed',
  /** How the shelf is sorted. */
  shelfSort: 'shelf.sort',
} as const;

export const deviceTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon';

export async function getSetting<T>(store: Store, key: string, fallback: T): Promise<T> {
  const r = await store.get('setting', key);
  return r && !r.deleted ? (r.value as T) : fallback;
}

export async function setSetting(store: Store, key: string, value: unknown): Promise<void> {
  await store.put('setting', { id: key, value });
}

/** Minutes for a session when nothing else suggests a length (Settings → Calendar), always a whole number. */
export async function usualDuration(store: Store): Promise<number> {
  const value = await getSetting<unknown>(store, SETTING.defaultDuration, 50);
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 50;
}

export async function practiceTimeZone(store: Store): Promise<string> {
  return getSetting(store, SETTING.timeZone, deviceTimeZone());
}
