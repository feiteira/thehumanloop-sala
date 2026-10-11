import { DateTime } from 'luxon';
import { type BookingDefaults, bookingDefaults } from '../core/calendar/booking';
import { nextOccurrence, type Occurrence, occurrencesIn } from '../core/calendar/occurrences';
import type { Appointment, Folder, Page, Sticky } from '../core/model/types';
import type { Store } from '../core/store/store';
import { usualDuration } from './settings';

// Reads shared by several screens.

export async function folderMap(store: Store): Promise<Map<string, Folder>> {
  return new Map((await store.list('folder')).map((f) => [f.id, f]));
}

/** Appointments that can have an occurrence between two local dates (inclusive). */
export async function appointmentsBetween(store: Store, fromDate: string, toDate: string, folderId?: string): Promise<Appointment[]> {
  const conds = ['substr(start_local, 1, 10) <= ?', 'last_date >= ?'];
  const params: (string | number)[] = [toDate, fromDate];
  if (folderId) {
    conds.push('folder_id = ?');
    params.push(folderId);
  }
  return store.list('appointment', { where: conds.join(' AND '), params });
}

export async function occurrencesOn(store: Store, day: DateTime): Promise<Occurrence[]> {
  const from = day.startOf('day');
  const to = from.plus({ days: 1 });
  // Appointments in other time zones may fall on a neighbouring local date: widen by a day.
  const appts = await appointmentsBetween(store, from.minus({ days: 1 }).toISODate()!, to.toISODate()!);
  return occurrencesIn(appts, from, to).filter((o) => o.appointment.status !== 'cancelled');
}

export async function occurrencesInRange(store: Store, from: DateTime, to: DateTime): Promise<Occurrence[]> {
  const appts = await appointmentsBetween(store, from.minus({ days: 1 }).toISODate()!, to.plus({ days: 1 }).toISODate()!);
  return occurrencesIn(appts, from, to);
}

export async function nextSessionByFolder(store: Store, now: DateTime): Promise<Map<string, Occurrence>> {
  const appts = await appointmentsBetween(store, now.toISODate()!, '9999-12-31');
  const byFolder = new Map<string, Appointment[]>();
  for (const a of appts) {
    if (!a.folder_id) continue;
    byFolder.set(a.folder_id, [...(byFolder.get(a.folder_id) ?? []), a]);
  }
  const out = new Map<string, Occurrence>();
  for (const [id, list] of byFolder) {
    const n = nextOccurrence(list, now);
    if (n) out.set(id, n);
  }
  return out;
}

/** The ids of active folders (not archived, not merged into another). */
export async function activeFolderIds(store: Store): Promise<Set<string>> {
  return new Set((await store.list('folder', { where: "status = 'active'" })).filter((f) => !f.merged_into).map((f) => f.id));
}

/**
 * Sticky notes marked "next session" for the active folders seen on `day`, each with the
 * first of that day's sessions that starts after the note was written: a note written during
 * or after today's session is for the next one, not for today. In session order. A caller that
 * has read the day's sessions or the active folders already passes them in `known`.
 */
export async function dueStickies(
  store: Store,
  day: DateTime,
  known: { occ?: Occurrence[]; active?: Set<string> } = {},
): Promise<{ sticky: Sticky; occurrence: Occurrence }[]> {
  const occ = (known.occ ?? (await occurrencesOn(store, day))).filter((o) => o.appointment.folder_id);
  if (!occ.length) return [];
  const active = known.active ?? (await activeFolderIds(store));
  const notes = await store.list('sticky', { where: "state = 'stuck' AND next_session = 1", order: 'created_at' });
  const due = notes.flatMap((sticky) => {
    if (!active.has(sticky.folder_id)) return [];
    const written = DateTime.fromISO(sticky.created_at).toMillis();
    const occurrence = occ.find((o) => o.appointment.folder_id === sticky.folder_id && o.start.toMillis() > written);
    return occurrence ? [{ sticky, occurrence }] : [];
  });
  return due.sort((a, b) => a.occurrence.start.toMillis() - b.occurrence.start.toMillis());
}

export async function stuckOnCovers(store: Store): Promise<Map<string, Sticky[]>> {
  const notes = await store.list('sticky', { where: "state = 'stuck' AND page_id IS NULL", order: 'created_at' });
  const out = new Map<string, Sticky[]>();
  for (const s of notes) out.set(s.folder_id, [...(out.get(s.folder_id) ?? []), s]);
  return out;
}

export async function recentPages(store: Store, limit = 6): Promise<Page[]> {
  return store.list('page', { order: 'hlc DESC', limit });
}

/**
 * What a new appointment for a folder starts with (`bookingDefaults`): the next session at the
 * usual rhythm, an ordinary session after a first consultation. Book next on Today, Book on the
 * folder's cover and its Calendar divider all start from this.
 */
export async function bookingFor(store: Store, folderId: string, now: DateTime): Promise<BookingDefaults> {
  const [appointments, types, usual] = await Promise.all([
    store.list('appointment', { where: 'folder_id = ?', params: [folderId] }),
    store.list('appointment_type', { order: 'created_at' }),
    usualDuration(store),
  ]);
  return bookingDefaults(appointments, now, usual, types);
}

/** Of the given pages, those with a live document attached. */
export async function pagesWithFiles(store: Store, pageIds: readonly string[]): Promise<Set<string>> {
  if (!pageIds.length) return new Set();
  const attachments = await store.list('attachment', { where: `page_id IN (${pageIds.map(() => '?').join(', ')})`, params: [...pageIds] });
  return new Set(attachments.flatMap((a) => (a.page_id ? [a.page_id] : [])));
}
