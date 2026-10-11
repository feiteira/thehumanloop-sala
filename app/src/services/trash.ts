import { parseHlc } from '../core/hlc';
import { emptyContact, type Draft, type Entity, type Kind } from '../core/model/types';
import { ValidationError } from '../core/model/validate';
import type { Store, Tombstone } from '../core/store/store';
import { type Platform, PlatformError } from '../platform/types';

// Recently deleted: what was deleted in the last 30 days, grouped by the delete it belonged to
// (a folder with its pages, notes and documents is one group), so it can be restored or
// erased together. Older deleted items are erased for good: their content is blanked, the
// files of deleted documents are removed, and only the bare "this was deleted" marker stays,
// so a later import of an older copy cannot bring them back.

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the therapist can see and restore. Settings are not listed, but are erased too. */
export const TRASH_KINDS = [
  'folder', 'page', 'sticky', 'attachment', 'appointment', 'appointment_type', 'availability', 'availability_exception',
] as const satisfies readonly Kind[];
export type TrashKind = (typeof TRASH_KINDS)[number];

const ALL_KINDS: readonly Kind[] = [...TRASH_KINDS, 'setting'];

export interface TrashItem {
  kind: TrashKind;
  record: Tombstone<TrashKind>;
}

export interface TrashGroup {
  /** The delete batch, or the record's id for a delete made without one. */
  key: string;
  /** The item the group is named after: its folder when it has one, else the first deleted. */
  lead: TrashItem;
  items: TrashItem[];
  /** When it was deleted (ms). */
  deletedAt: number;
}

/** A store and where attachment files live: an open Practice is one. */
export interface TrashHost {
  store: Store;
  platform: Pick<Platform, 'blobs'>;
}

const deletedAt = (r: { updated_at_hlc: string }) => parseHlc(r.updated_at_hlc).ms;

/** Items deleted within the last 30 days, grouped by delete, newest first. */
export async function listTrash(store: Store, now = Date.now()): Promise<TrashGroup[]> {
  const groups = new Map<string, TrashItem[]>();
  for (const kind of TRASH_KINDS) {
    for (const record of await store.listDeleted(kind, now - TRASH_DAYS * DAY_MS)) {
      const key = record.deleted_batch ?? record.id;
      const list = groups.get(key) ?? [];
      list.push({ kind, record } as TrashItem);
      groups.set(key, list);
    }
  }
  const out: TrashGroup[] = [];
  for (const [key, items] of groups) {
    // TRASH_KINDS order puts a folder first, then pages, notes and documents.
    out.push({ key, lead: items[0]!, items, deletedAt: Math.max(...items.map((i) => deletedAt(i.record))) });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** How many of each kind a group holds besides its lead, for "with 14 pages, 3 notes". */
export function groupCounts(group: TrashGroup): Partial<Record<TrashKind, number>> {
  const counts: Partial<Record<TrashKind, number>> = {};
  for (const i of group.items) {
    if (i === group.lead) continue;
    counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Restores records of one kind, all together when they can be, else one by one, so one record
 * that no longer passes today's checks (an appointment saved by an older Sala, say) does not
 * keep the others deleted. Any other failure (the database closed) is thrown. Returns the ids
 * left deleted.
 */
export async function restoreEach(store: Store, kind: Kind, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  try {
    await store.restore(kind, ids);
    return [];
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await store.restore(kind, [id]);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        failed.push(id);
      }
    }
    return failed;
  }
}

export interface RestoreResult {
  restored: number;
  /**
   * Items that could not come back: they stay deleted, or are erased when their file, or the
   * folder or page they were in, is gone.
   */
  failed: number;
  /** Of `failed`, those erased for good (their file, folder or page was gone). */
  erased: number;
}

type Parented = Partial<{ folder_id: string | null; page_id: string | null }>;

/**
 * Brings a group back. A page, note or document whose folder (or page) was deleted on its own,
 * in another delete, brings that folder (or page) back too, so it never comes back hidden. One
 * whose folder (or page) has since been erased for good cannot come back, since it would be
 * live yet hidden: it is erased too. So is a document whose file is gone (deleted by an older
 * Sala, which removed files at once). Neither shows in Recently deleted afterwards. A folder
 * or page deleted on its own comes back only for what does come back with this group.
 */
export async function restoreGroup(host: TrashHost, group: TrashGroup): Promise<RestoreResult> {
  const { store } = host;
  const result: RestoreResult = { restored: 0, failed: 0, erased: 0 };
  const parents = { folder: new Set<string>(), page: new Set<string>() };
  for (const { record } of group.items) {
    const r = record as Parented;
    if (r.folder_id) parents.folder.add(r.folder_id);
    if (r.page_id) parents.page.add(r.page_id);
  }
  // Parents outside the group: erased for good (or not there at all), or deleted on their own.
  // Nothing is restored yet: first find out what can come back.
  const gone = { folder: new Set<string>(), page: new Set<string>() };
  const deleted = { folder: new Map<string, Parented>(), page: new Map<string, Parented>() };
  const lost = (r: Parented) => (!!r.folder_id && gone.folder.has(r.folder_id)) || (!!r.page_id && gone.page.has(r.page_id));
  for (const kind of ['folder', 'page'] as const) {
    const inGroup = new Set(group.items.filter((i) => i.kind === kind).map((i) => i.record.id));
    for (const id of parents[kind]) {
      if (inGroup.has(id)) continue;
      const parent = (await store.get(kind, id)) as Tombstone<typeof kind> | null;
      if (!parent || parent.scrubbed || lost(parent as Parented)) gone[kind].add(id);
      else if (parent.deleted) deleted[kind].set(id, parent as Parented);
    }
  }
  const doomed = group.items.filter((i) => lost(i.record as Parented));
  const kept = group.items.filter((i) => !doomed.includes(i));
  const withoutFile = await filesGone(host, kept.filter((i) => i.kind === 'attachment').map((i) => i.record as Entity<'attachment'>));
  const coming = kept.filter((i) => !(i.kind === 'attachment' && withoutFile.includes(i.record.id)));

  if (doomed.length) {
    await purge(host, doomed);
    result.failed += doomed.length;
    result.erased += doomed.length;
  }
  if (withoutFile.length) {
    await store.scrub('attachment', withoutFile, (rec) => blankRecord('attachment', rec));
    result.failed += withoutFile.length;
    result.erased += withoutFile.length;
  }
  // The group's own items first: one that fails today's checks stays deleted, and must not
  // bring back a parent of its own.
  const back: TrashItem[] = [];
  for (const kind of TRASH_KINDS) {
    const items = coming.filter((i) => i.kind === kind);
    const failed = new Set(await restoreEach(store, kind, items.map((i) => i.record.id)));
    result.restored += items.length - failed.size;
    result.failed += failed.size;
    back.push(...items.filter((i) => !failed.has(i.record.id)));
  }

  // Then the parents deleted on their own that what came back needs, and only those. They are
  // not counted as restored: the therapist did not pick them. (Restoring checks each record on
  // its own, so an item is live under its deleted parent only for this moment.)
  const needed = { folder: new Set<string>(), page: new Set<string>() };
  const need = (r: Parented) => {
    if (r.folder_id && deleted.folder.has(r.folder_id)) needed.folder.add(r.folder_id);
    if (r.page_id && deleted.page.has(r.page_id)) needed.page.add(r.page_id);
  };
  for (const { record } of back) need(record as Parented);
  for (const id of needed.page) need(deleted.page.get(id)!);
  result.failed += (await restoreEach(store, 'folder', [...needed.folder])).length;
  result.failed += (await restoreEach(store, 'page', [...needed.page])).length;
  return result;
}

/** The documents whose encrypted file is no longer on this computer. */
async function filesGone(host: TrashHost, attachments: Entity<'attachment'>[]): Promise<string[]> {
  const gone: string[] = [];
  for (const a of attachments) {
    try {
      await host.platform.blobs.read(a.blob_id);
    } catch (e) {
      if (e instanceof PlatformError && e.code === 'NOT_FOUND') gone.push(a.id);
      else throw e;
    }
  }
  return gone;
}

/**
 * Takes away records Sala made that the therapist never used (a new page left empty, what an
 * Undo takes back) and erases them at once: the therapist did not delete anything, so nothing
 * shows in Recently deleted. Not for documents, whose files need `purge`.
 */
export async function eraseUnused(store: Store, kind: Exclude<Kind, 'attachment'>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await store.remove(kind, ids);
  await store.scrub(kind, ids, (rec) => blankRecord(kind, rec));
}

const EPOCH = '1970-01-01';

/** The record with its content replaced by valid empties: what stays of it once erased. */
export function blankRecord<K extends Kind>(kind: K, record: Entity<K>): Draft<K> {
  const r = record as Entity<Kind> & Record<string, unknown>;
  const blank: Record<Kind, () => Record<string, unknown>> = {
    folder: () => ({
      label: '—', colour: 'grey', status: 'archived', tags: [], contact: emptyContact(), cover_note: '',
      archived_at: null, merged_into: null, loop_vault_id: null, picture: null,
    }),
    page: () => ({
      folder_id: r.folder_id, date: EPOCH, time: null, duration_min: null, template: 'free', title: '', sections: {},
      process_note: '', import_provenance: null,
    }),
    sticky: () => ({
      folder_id: r.folder_id, page_id: null, text: '—', colour: 'yellow', next_session: false, origin: 'therapist',
      state: 'discarded', peeled_at: null,
    }),
    appointment: () => ({
      folder_id: r.folder_id, title: r.folder_id ? '' : '—', type_id: null, start_local: `${EPOCH}T00:00`, tz: 'UTC',
      duration_min: 1, repeat: null, location: '', status: 'cancelled', note: '', series_id: null,
    }),
    appointment_type: () => ({ name: '—', duration_min: 1, colour: 'grey', for_new_patients: false, archived: true }),
    availability: () => ({ weekday: 1, start: '00:00', end: '00:01' }),
    availability_exception: () => ({ date: EPOCH, kind: 'off', start: null, end: null }),
    attachment: () => ({
      folder_id: r.folder_id, page_id: null, filename: '—', mime: '', size: 0, blob_id: '', sha256: '', local_only: true,
      source: 'upload', ocr_text: null,
    }),
    setting: () => ({ value: null }),
  };
  return { ...blank[kind](), id: record.id } as Draft<K>;
}

/**
 * Erases deleted records for good: removes the files of deleted documents, then blanks the
 * records. A document whose file cannot be removed is left for the next try. Returns how many
 * records were erased.
 */
export async function purge(host: TrashHost, items: { kind: Kind; record: Entity<Kind> }[]): Promise<number> {
  const { store, platform } = host;
  const byKind = new Map<Kind, Entity<Kind>[]>();
  for (const i of items) {
    if (!i.record.deleted) continue;
    byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i.record]);
  }

  const attachments = (byKind.get('attachment') ?? []) as Entity<'attachment'>[];
  if (attachments.length) {
    // A file still named by a record that stays (another copy of the document) is kept.
    const going = new Set(attachments.map((a) => a.id));
    const inUse = new Set(
      (await store.list('attachment', { includeDeleted: true })).filter((a) => !going.has(a.id) && a.blob_id).map((a) => a.blob_id),
    );
    const erasable: Entity<'attachment'>[] = [];
    for (const a of attachments) {
      try {
        if (a.blob_id && !inUse.has(a.blob_id)) await platform.blobs.remove(a.blob_id);
        erasable.push(a);
      } catch (e) {
        console.warn('could not remove a deleted document’s file; will try again', e);
      }
    }
    byKind.set('attachment', erasable);
  }

  let n = 0;
  for (const [kind, records] of byKind) {
    if (!records.length) continue;
    n += await store.scrub(kind, records.map((r) => r.id), (rec) => blankRecord(kind, rec));
  }
  return n;
}

/** Erases everything deleted more than 30 days ago. Runs when the practice opens. */
export async function purgeExpired(host: TrashHost, now = Date.now()): Promise<number> {
  const items: { kind: Kind; record: Entity<Kind> }[] = [];
  for (const kind of ALL_KINDS) {
    for (const record of await host.store.listDeleted(kind, 0, now - TRASH_DAYS * DAY_MS)) items.push({ kind, record });
  }
  return items.length ? purge(host, items) : 0;
}

/** Delete now: erases one group of Recently deleted at once. */
export function purgeGroup(host: TrashHost, group: TrashGroup): Promise<number> {
  return purge(host, group.items);
}
