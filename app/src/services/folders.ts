import { DateTime } from 'luxon';
import { nextOccurrence, occurrences, readableStart, startOf } from '../core/calendar/occurrences';
import { uuid } from '../core/ids';
import type { Appointment, Base, Draft, Entity, Folder, Kind, Sticky } from '../core/model/types';
import { validate } from '../core/model/validate';
import type { Store } from '../core/store/store';
import { restoreEach } from './trash';

// Folder-wide actions: archive (which can end therapy's future sessions), and delete with
// everything in it. Each returns what it changed, so Undo can put it back.

/** A folder's sessions still to come: open series and single appointments. */
export interface FutureAppointments {
  series: Appointment[];
  singles: Appointment[];
}

/** Appointments with a session starting at or after `now`; cancelled ones and finished ones are left out. */
export function futureAppointments(appointments: Appointment[], now: DateTime): FutureAppointments {
  const live = appointments.filter((a) => !a.deleted && a.status !== 'cancelled');
  return {
    series: live.filter((a) => a.repeat && nextOccurrence([a], now)),
    singles: live.filter((a) => {
      const start = readableStart(a);
      return !a.repeat && a.status !== 'done' && !!start && start >= now;
    }),
  };
}

/** How archiving ends a folder's future sessions. Pure, so it can be checked without a store. */
export interface EndPlan {
  /** Series that had sessions before now: they end the day before their next session. */
  end: { id: string; until: string }[];
  /** Series whose every session is still to come: nothing to keep, so they are removed. */
  remove: string[];
  /** Single appointments still to come: marked cancelled, so they stay visible as such. */
  cancel: string[];
}

export function planEnd(future: FutureAppointments, now: DateTime): EndPlan {
  const plan: EndPlan = { end: [], remove: [], cancel: future.singles.map((a) => a.id) };
  for (const a of future.series) {
    const next = nextOccurrence([a], now);
    if (!next) continue;
    // A session under way when the folder is archived has happened: it is kept.
    const before = occurrences(a, startOf(a).minus({ minutes: 1 }), next.start);
    if (before.length === 0) plan.remove.push(a.id);
    else plan.end.push({ id: a.id, until: DateTime.fromISO(next.date).minus({ days: 1 }).toISODate()! });
  }
  return plan;
}

/** What `archiveFolder` changed. */
export interface ArchiveUndo {
  /** The records as they were before, to write back. */
  before: { kind: Kind; record: Entity<Kind> }[];
  removed: Removed;
}

/** Records deleted together under one batch id. */
export interface Removed {
  batch: string;
  ids: Partial<Record<Kind, string[]>>;
}

/**
 * Archives a folder. With `endSessions`, its future sessions end (series stop before their
 * next date, single appointments are cancelled; nothing in the past changes). With
 * `peelNotes`, its "next session" sticky notes are peeled off.
 */
export async function archiveFolder(
  store: Store,
  folderId: string,
  opts: { endSessions: boolean; peelNotes: boolean; now?: DateTime },
): Promise<ArchiveUndo> {
  const now = opts.now ?? DateTime.now();
  const folder = await store.get('folder', folderId);
  if (!folder || folder.deleted) throw new Error(`folder ${folderId} not found`);
  // The folder itself must be valid to be archived: checked before anything is written.
  const folderDraft = { ...draftOf(folder), status: 'archived', archived_at: now.toUTC().toISO()! } as Draft<'folder'>;
  validate('folder', folderDraft);
  const before: ArchiveUndo['before'] = [{ kind: 'folder', record: folder }];
  const writes: { kind: Kind; draft: Draft<Kind> }[] = [{ kind: 'folder', draft: folderDraft }];
  const removed: Removed = { batch: uuid(), ids: {} };
  // Every change is checked before anything is written. A record that was already invalid
  // (an old import) is left as it is rather than block the archive.
  const change = <K extends 'appointment' | 'sticky'>(kind: K, record: Entity<K>, patch: Partial<Draft<K>>) => {
    const draft = { ...draftOf(record), ...patch } as Draft<K>;
    try {
      validate(kind, draft);
    } catch {
      return;
    }
    before.push({ kind, record });
    writes.push({ kind, draft });
  };

  if (opts.endSessions) {
    const appts = await store.list('appointment', { where: 'folder_id = ?', params: [folderId] });
    const byId = new Map(appts.map((a) => [a.id, a]));
    const plan = planEnd(futureAppointments(appts, now), now);
    for (const { id, until } of plan.end) {
      const a = byId.get(id)!;
      change('appointment', a, { repeat: { ...a.repeat!, until } });
    }
    for (const id of plan.cancel) change('appointment', byId.get(id)!, { status: 'cancelled' });
    removed.ids.appointment = plan.remove;
  }

  if (opts.peelNotes) {
    const peeledAt = now.toUTC().toISO()!;
    for (const s of await nextSessionNotes(store, folderId)) change('sticky', s, { state: 'peeled', peeled_at: peeledAt });
  }

  await store.putMany(writes);
  const series = removed.ids.appointment ?? [];
  if (series.length) {
    try {
      await store.remove('appointment', series, { batch: removed.batch });
    } catch (e) {
      // All or nothing: the folder goes back to how it was.
      await store.putMany(before.map(({ kind, record }) => ({ kind, draft: draftOf(record) }))).catch(() => undefined);
      throw e;
    }
  }
  return { before, removed };
}

/**
 * Undoes `archiveFolder`: the folder, its sessions and its notes are as they were. Returns
 * how many records could not be brought back (see `restoreRemoved`).
 */
export async function undoArchive(store: Store, undo: ArchiveUndo): Promise<number> {
  await store.putMany(undo.before.map(({ kind, record }) => ({ kind, draft: draftOf(record) })));
  return restoreRemoved(store, undo.removed);
}

/** Takes a folder out of the archive. Ended sessions stay ended. */
export async function unarchiveFolder(store: Store, folderId: string): Promise<Folder> {
  return store.update('folder', folderId, { status: 'active', archived_at: null });
}

/** The folder's sticky notes marked for the next session and still stuck (on the cover or a page). */
export async function nextSessionNotes(store: Store, folderId: string): Promise<Sticky[]> {
  return store.list('sticky', { where: "folder_id = ? AND state = 'stuck' AND next_session = 1", params: [folderId] });
}

/** Deletes a folder with its pages, sticky notes, appointments and documents, as one batch. */
export async function deleteFolder(store: Store, folderId: string): Promise<Removed> {
  const where = { where: 'folder_id = ?', params: [folderId] };
  const [pages, stickies, appts, atts] = await Promise.all([
    store.list('page', where),
    store.list('sticky', where),
    store.list('appointment', where),
    store.list('attachment', where),
  ]);
  const removed: Removed = {
    batch: uuid(),
    ids: {
      attachment: atts.map((a) => a.id),
      sticky: stickies.map((s) => s.id),
      page: pages.map((p) => p.id),
      appointment: appts.map((a) => a.id),
      folder: [folderId],
    },
  };
  // Documents' files stay on disk until the delete is final (Settings → Recently deleted).
  for (const [kind, ids] of Object.entries(removed.ids) as [Kind, string[]][]) {
    await store.remove(kind, ids, { batch: removed.batch });
  }
  return removed;
}

/**
 * Brings back what was deleted together: the folder first, then what it holds. A record that
 * no longer passes today's checks (an appointment saved by an older Sala, say) stays deleted
 * and the rest still comes back. Returns how many records stayed deleted.
 */
export async function restoreRemoved(store: Store, removed: Removed): Promise<number> {
  if (removed.ids.folder?.length) await store.restore('folder', removed.ids.folder);
  let failed = 0;
  for (const kind of ['page', 'sticky', 'attachment', 'appointment'] as const) {
    failed += (await restoreEach(store, kind, removed.ids[kind] ?? [])).length;
  }
  return failed;
}

/** A record without its base fields, ready to write back. */
function draftOf<K extends Kind>(record: Entity<K>): Draft<K> {
  const { created_at: _c, updated_at_hlc: _h, deleted: _d, ...rest } = record as Entity<K> & Base & { deleted_batch?: string; scrubbed?: boolean };
  const { deleted_batch: _b, scrubbed: _s, ...clean } = rest as typeof rest & { deleted_batch?: string; scrubbed?: boolean };
  return clean as unknown as Draft<K>;
}
