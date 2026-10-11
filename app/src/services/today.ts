import { DateTime } from 'luxon';
import { occurrencesIn, type Occurrence } from '../core/calendar/occurrences';
import type { Slot } from '../core/calendar/slots';
import { isBlankPage, pickSessionPage } from '../core/model/sections';
import type { Page } from '../core/model/types';
import type { Store } from '../core/store/store';
import { activeFolderIds, appointmentsBetween, pagesWithFiles } from './queries';
import { getSetting, setSetting, SETTING } from './settings';

// What the Today screen reads besides the shared queries: which sessions have their note,
// which recent ones are still waiting for one, and what is left of today's free time.

/** One session, i.e. one date of an appointment: `${appointmentId}@${date}`. */
export const sessionKey = (o: Pick<Occurrence, 'appointment' | 'date'>): string => `${o.appointment.id}@${o.date}`;

/** The date and time a session's note carries: the session's wall-clock time in the practice zone. */
export function sessionSlot(o: Pick<Occurrence, 'start'>, tz: string): { date: string; time: string } {
  const start = o.start.setZone(tz);
  return { date: start.toISODate()!, time: start.toFormat('HH:mm') };
}

/**
 * The note of each session that has one, by session key: the folder's live page on the
 * session's date (and time, when both have one), chosen as `pickSessionPage` does, the rule
 * `findOrCreatePageFor` follows too. An empty page (Write note pressed, then left) is no note,
 * unless a document is attached to it; opening the note again finds that same page.
 */
export async function sessionPagesByKey(store: Store, sessions: Occurrence[], tz: string): Promise<Map<string, Page>> {
  const slots = sessions.filter((o) => o.appointment.folder_id).map((o) => ({ o, ...sessionSlot(o, tz) }));
  const out = new Map<string, Page>();
  if (!slots.length) return out;
  const dates = slots.map((s) => s.date).sort();
  const pages = await store.list('page', { where: 'date >= ? AND date <= ?', params: [dates[0]!, dates[dates.length - 1]!], order: 'created_at' });
  const withFiles = await pagesWithFiles(store, pages.filter(isBlankPage).map((p) => p.id));
  const byFolderDay = new Map<string, Page[]>();
  for (const p of pages) {
    const k = `${p.folder_id}|${p.date}`;
    byFolderDay.set(k, [...(byFolderDay.get(k) ?? []), p]);
  }
  for (const { o, date, time } of slots) {
    const found = pickSessionPage(byFolderDay.get(`${o.appointment.folder_id}|${date}`) ?? [], date, time, withFiles);
    if (found && !found.blank) out.set(sessionKey(o), found.page);
  }
  return out;
}

/**
 * A folder's latest notes dated up to `date`, newest first (by date, then time): pages with
 * something written in them or a document attached. An empty page is no note to look back on.
 */
export async function latestNotes(store: Store, folderId: string, date: string, limit = 6): Promise<Page[]> {
  const pages = await store.list('page', { where: 'folder_id = ? AND date <= ?', params: [folderId, date], order: 'date DESC', limit: limit * 2 });
  const withFiles = await pagesWithFiles(store, pages.filter(isBlankPage).map((p) => p.id));
  return pages
    .filter((p) => !isBlankPage(p) || withFiles.has(p.id))
    .sort((a, b) => (b.date + (b.time ?? '')).localeCompare(a.date + (a.time ?? '')))
    .slice(0, limit);
}

/** Sessions the therapist marked "No note needed" (keys from `sessionKey`). */
export async function noNoteNeeded(store: Store): Promise<string[]> {
  const value = await getSetting<unknown>(store, SETTING.noNoteNeeded, []);
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

/** How long a "No note needed" mark is kept: longer than the window Today looks back over. */
const KEEP_MARKS_DAYS = 60;

/** Marks a session as needing no note. Marks older than 60 days (by session date) are dropped. */
export async function markNoNoteNeeded(store: Store, key: string, today: string): Promise<void> {
  const cutoff = DateTime.fromISO(today).minus({ days: KEEP_MARKS_DAYS }).toISODate()!;
  const kept = (await noNoteNeeded(store)).filter((k) => k !== key && (k.split('@')[1] ?? '') >= cutoff);
  await setSetting(store, SETTING.noNoteNeeded, [...kept, key]);
}

/** Takes a "No note needed" mark back (Undo). */
export async function unmarkNoNoteNeeded(store: Store, key: string): Promise<void> {
  const marks = await noNoteNeeded(store);
  if (marks.includes(key)) await setSetting(store, SETTING.noNoteNeeded, marks.filter((k) => k !== key));
}

/** How far back Today looks for sessions without a note. */
export const NOTES_LOOKBACK_DAYS = 14;

/**
 * Sessions of the last `days` days (counted from the start of today in the practice zone)
 * that have ended by `now`, were not cancelled, belong to an active folder, have no note and
 * were not marked "No note needed". Newest first. A caller that has read the active folders
 * already passes them in `known`.
 */
export async function unwrittenSessions(
  store: Store,
  now: DateTime,
  tz: string,
  days = NOTES_LOOKBACK_DAYS,
  known: { active?: Set<string> } = {},
): Promise<Occurrence[]> {
  const local = now.setZone(tz);
  const from = local.startOf('day').minus({ days });
  // Appointments in other zones may fall on a neighbouring local date: widen by a day.
  const appts = (await appointmentsBetween(store, from.minus({ days: 1 }).toISODate()!, local.plus({ days: 1 }).toISODate()!)).filter(
    (a) => a.folder_id !== null && a.status !== 'cancelled',
  );
  if (!appts.length) return [];
  const active = known.active ?? (await activeFolderIds(store));
  const skip = new Set(await noNoteNeeded(store));
  const ended = occurrencesIn(appts, from, local).filter(
    (o) => o.start >= from && o.end <= local && active.has(o.appointment.folder_id!) && !skip.has(sessionKey(o)),
  );
  const pages = await sessionPagesByKey(store, ended, tz);
  return ended.filter((o) => !pages.has(sessionKey(o))).reverse();
}

/** Where a session of today stands: on now, the next one, over, or later on. */
export type SessionState = 'now' | 'next' | 'ended' | null;

/**
 * Today's sessions at `now`: the one Up next is about (the patient session on now, or else the
 * next one) and where each session stands. Next is the next session with a patient, so the card
 * marked Next is the card Up next opens on; an appointment without a folder (supervision) is Next
 * only when no patient session is left to come. Sessions are expected in order of start.
 */
export function dayStates(sessions: Occurrence[], now: DateTime): { upNext: Occurrence | undefined; stateOf: (o: Occurrence) => SessionState } {
  const withPatient = sessions.filter((o) => o.appointment.folder_id);
  const firstUpcoming = withPatient.find((o) => o.start > now) ?? sessions.find((o) => o.start > now);
  return {
    upNext: withPatient.find((o) => o.end > now),
    stateOf: (o) => (o.end <= now ? 'ended' : o.start <= now ? 'now' : o === firstUpcoming ? 'next' : null),
  };
}

/**
 * What is left of free slots from `now` on: slots that are over are dropped, one under way
 * starts at `now` (rounded up to `roundMin` minutes), and what is left of it must still be
 * `minMinutes` long.
 */
export function freeFrom(slots: Slot[], now: DateTime, minMinutes = 30, roundMin = 5): Slot[] {
  const step = roundMin * 60_000;
  const from = Math.ceil(now.toMillis() / step) * step;
  return slots.flatMap((s) => {
    if (s.start.toMillis() >= from) return [s];
    const start = DateTime.fromMillis(from, { zone: s.start.zone });
    return s.end.diff(start, 'minutes').minutes >= minMinutes ? [{ start, end: s.end }] : [];
  });
}

/**
 * A few words to remind the therapist of a session: the start of its plan, when the page has
 * one, or else the end of what was written last. Null for an empty page.
 */
export function pagePreview(page: Pick<Page, 'sections'>, max = 240): { kind: 'plan' | 'end'; text: string } | null {
  const plan = page.sections.plan?.trim();
  if (plan) return { kind: 'plan', text: plan };
  const written = Object.values(page.sections).map((s) => s.trim()).filter(Boolean);
  const last = written[written.length - 1];
  if (!last) return null;
  if (last.length <= max) return { kind: 'end', text: last };
  const tail = last.slice(-max);
  const cut = tail.search(/\s/);
  return { kind: 'end', text: `…${(cut >= 0 ? tail.slice(cut) : tail).trim()}` };
}

/**
 * The page before a session: the folder's latest page dated before the session (on its day,
 * one with an earlier time). Never the session's own note. Pages are expected newest first.
 */
export function previousPage(pagesNewestFirst: Pick<Page, 'date' | 'time'>[], session: { date: string; time: string }): Page | null {
  const before = pagesNewestFirst.find((p) => p.date < session.date || (p.date === session.date && p.time !== null && p.time < session.time));
  return (before as Page | undefined) ?? null;
}
