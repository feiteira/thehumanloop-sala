import { DateTime } from 'luxon';
import type { IcsEvent } from '../core/import/ics';
import type { ImportPlan, ItemError, PlannedItem } from '../core/import/plan';
import { ValidationError } from '../core/model/validate';
import { emptyContact, type Folder, MAX_DOCUMENT_BYTES } from '../core/model/types';
import { fold } from '../core/text/normalize';
import { baseName, extensionOf, mimeOf } from '../core/text/mime';
import { JobStopped, stopper } from './jobs';
import { isLocked, type Practice } from './practice';

// Writes a reviewed import plan into the practice. Progress is saved after every item,
// so an interrupted import (closed window, locked screen) can be resumed where it stopped.
// Pages and appointments take their planned item's id, so writing an item twice replaces
// it instead of making a copy.

// A plan is kept only while the import is unfinished, and without the text of what it already
// imported: that now lives in the practice, where Delete now can erase it for good.

/** The plan as kept: items already imported keep their place, not their text. */
function storable(plan: ImportPlan): ImportPlan {
  return { ...plan, items: plan.items.map((i) => (i.done && i.text ? { ...i, text: '' } : i)) };
}

export async function saveJob(practice: Practice, plan: ImportPlan): Promise<void> {
  const now = new Date().toISOString();
  await practice.store.db.exec(
    'INSERT INTO import_jobs (id, created_at, updated_at, state, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, state = excluded.state, data = excluded.data',
    [plan.id, plan.createdAt, now, plan.state, JSON.stringify(storable(plan))],
  );
}

/**
 * Forgets finished imports and the imported text of unfinished ones, as kept by earlier
 * versions of Sala. Runs when the practice opens.
 */
export async function tidyImportJobs(practice: Practice): Promise<void> {
  const db = practice.store.db;
  await db.exec("DELETE FROM import_jobs WHERE state = 'done'");
  for (const row of await db.query<{ data: string }>('SELECT data FROM import_jobs')) {
    const plan = JSON.parse(row.data) as ImportPlan;
    if (plan.items.some((i) => i.done && i.text)) {
      await db.exec('UPDATE import_jobs SET data = ? WHERE id = ?', [JSON.stringify(storable(plan)), plan.id]);
    }
  }
}

export async function unfinishedJob(practice: Practice): Promise<ImportPlan | null> {
  const rows = await practice.store.db.query<{ data: string }>("SELECT data FROM import_jobs WHERE state != 'done' ORDER BY updated_at DESC LIMIT 1");
  return rows[0] ? (JSON.parse(rows[0].data) as ImportPlan) : null;
}

export async function discardJob(practice: Practice, id: string): Promise<void> {
  await practice.store.db.exec('DELETE FROM import_jobs WHERE id = ?', [id]);
}

/** A patient row of a CSV list, as kept in its planned item's `text`. */
export interface CsvDetails {
  email: string;
  phone: string;
  notes: string;
  tags: string[];
  /** The start date as written in the list; the item's `date` holds it as ISO when it could be read. */
  start: string;
}

/** A calendar event, as kept in its planned item's `text`. */
export interface IcsDetails extends IcsEvent {
  /** A date moved out of a series: the planned item of that series. */
  seriesItemId: string | null;
}

export interface ImportFailure {
  id: string;
  name: string;
  reason: ItemError;
}

export interface ImportResult {
  /** Folders created. */
  folders: number;
  /** Existing folders given details from a patient list. */
  updated: number;
  pages: number;
  attachments: number;
  appointments: number;
  /**
   * Items that could not be imported; the rest carried on. They stay in the plan, not done,
   * and the plan stays unfinished, so Continue import offers them again later.
   */
  failed: ImportFailure[];
}

/**
 * Adds a patient list's details to a folder without losing what it has: a new phone or email
 * replaces the old one only when the list has one, tags are added, and the notes and start
 * date are added to the cover note unless it already says so.
 */
export function mergeFolderDetails(folder: Pick<Folder, 'contact' | 'tags' | 'cover_note'>, details: Partial<CsvDetails>, startLine: string | null): Pick<Folder, 'contact' | 'tags' | 'cover_note'> {
  const cover = folder.cover_note.trim();
  const lines = [cover];
  for (const add of [startLine, details.notes]) {
    const text = add?.trim();
    if (text && !fold(lines.join('\n')).includes(fold(text))) lines.push(text);
  }
  return {
    contact: { ...emptyContact(), ...folder.contact, email: details.email?.trim() || folder.contact.email, phone: details.phone?.trim() || folder.contact.phone },
    tags: [...new Set([...folder.tags, ...(details.tags ?? [])])],
    cover_note: lines.filter(Boolean).join('\n'),
  };
}

/** An error while reading an original file, so it is reported as "could not be read". */
class ReadError extends Error {}
/** An original larger than a document may be. */
class TooLargeError extends Error {}

const reasonOf = (e: unknown): ItemError =>
  e instanceof ReadError ? 'read' : e instanceof TooLargeError ? 'tooLarge' : e instanceof ValidationError ? 'invalid' : 'other';

async function reading<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    throw new ReadError((e as Error)?.message ?? 'read failed');
  }
}

/**
 * Imports every included, not-yet-done item of an included folder. An item that fails is
 * marked with its reason and the import carries on; it is listed in the result, and the plan
 * stays unfinished so it can be tried again. A failure to save progress (the practice was
 * locked or closed) stops the import, which can be resumed. `onProgress` is called after each
 * item.
 *
 * `shouldStop` is asked before every write, and just before a document is encrypted: once it
 * says yes (Sala is locking, and its keys are about to be wiped), the import throws
 * `JobStopped` without writing anything more. Nothing of the item in hand has been written;
 * the plan keeps its progress and can be continued.
 */
export async function runImport(
  practice: Practice,
  plan: ImportPlan,
  opts: {
    readFile: (path: string) => Promise<Uint8Array>;
    onProgress: (done: number, total: number) => void;
    /** The line a patient list's start date adds to the cover note, e.g. "Started: 10 Jan 2025". */
    startNote?: (isoDate: string) => string;
    shouldStop?: () => boolean;
  },
): Promise<ImportResult> {
  const stopIfAsked = stopper(opts.shouldStop);
  const store = practice.store;
  const result: ImportResult = { folders: 0, updated: 0, pages: 0, attachments: 0, appointments: 0, failed: [] };
  plan.state = 'importing';
  await saveJob(practice, plan);

  const includedFolder = new Map(plan.folders.map((f) => [f.key, f.include]));
  const todo = plan.items.filter((i) => i.include && (i.folderKey === null || includedFolder.get(i.folderKey) === true));
  const fail = (item: PlannedItem, e: unknown) => {
    console.error('import item failed', item.name, e);
    item.error = reasonOf(e);
    result.failed.push({ id: item.id, name: item.name, reason: item.error });
  };

  // Folders first: create new ones once, remember their ids in the plan.
  const folderIds = new Map<string, string>();
  const brokenFolders = new Map<string, unknown>();
  for (const f of plan.folders) {
    if (!f.include) continue;
    if (f.existingId) {
      folderIds.set(f.key, f.existingId);
      continue;
    }
    if (!todo.some((i) => !i.done && i.folderKey === f.key)) continue;
    stopIfAsked();
    try {
      const created: Folder = await store.put('folder', {
        label: f.label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
      });
      f.existingId = created.id;
      f.created = true;
      folderIds.set(f.key, created.id);
      result.folders++;
    } catch (e) {
      brokenFolders.set(f.key, e);
      continue;
    }
    await saveJob(practice, plan);
  }

  let done = todo.filter((i) => i.done).length;
  opts.onProgress(done, todo.length);
  const importedAt = new Date().toISOString();
  const imported = new Set(plan.items.filter((i) => i.done).map((i) => i.id));

  for (const item of todo) {
    if (item.done) continue;
    stopIfAsked();
    try {
      if (item.folderKey && brokenFolders.has(item.folderKey)) throw brokenFolders.get(item.folderKey);
      const folderId = item.folderKey ? (folderIds.get(item.folderKey) ?? null) : null;
      if (item.kind === 'folder') {
        if (folderId) await addFolderDetails(practice, folderId, item, opts.startNote);
        if (folderId && plan.folders.find((f) => f.key === item.folderKey)?.created !== true) result.updated++;
      } else if (item.kind === 'appointment') {
        await addAppointment(practice, item, folderId, imported);
        result.appointments++;
      } else if (folderId) {
        const added = await addPageOrDocument(practice, item, folderId, importedAt, { ...opts, stopIfAsked });
        result.pages += added.pages;
        result.attachments += added.attachments;
      }
      item.done = true;
      item.error = null;
      imported.add(item.id);
      done++;
    } catch (e) {
      // Sala is locking: nothing of the item in hand was written, and it is tried again later.
      if (e instanceof JobStopped) throw e;
      if (isLocked(e)) throw new JobStopped();
      fail(item, e);
    }
    await saveJob(practice, plan);
    opts.onProgress(done, todo.length);
  }

  // With items left that failed, the plan stays open for Continue import; else it goes.
  if (result.failed.length) {
    plan.state = 'review';
    await saveJob(practice, plan);
  } else {
    plan.state = 'done';
    await discardJob(practice, plan.id);
  }
  return result;
}

async function addFolderDetails(practice: Practice, folderId: string, item: PlannedItem, startNote?: (iso: string) => string): Promise<void> {
  const current = await practice.store.get('folder', folderId);
  if (!current || current.deleted) throw new Error('folder not found');
  const details = JSON.parse(item.text || '{}') as Partial<CsvDetails>;
  const start = item.date ? (startNote?.(item.date) ?? item.date) : null;
  await practice.store.update('folder', folderId, mergeFolderDetails(current, details, start));
}

async function addAppointment(practice: Practice, item: PlannedItem, folderId: string | null, imported: Set<string>): Promise<void> {
  const ev = JSON.parse(item.text) as Partial<IcsDetails> & Pick<IcsEvent, 'start_local' | 'tz' | 'duration_min'>;
  const repeat = ev.repeatWeeks ? { interval_weeks: ev.repeatWeeks, until: ev.until ?? null, exceptions: ev.exceptions ?? [] } : null;
  await practice.store.put('appointment', {
    id: item.id,
    folder_id: folderId,
    title: folderId ? '' : ev.summary || item.name,
    type_id: null,
    start_local: ev.start_local,
    tz: ev.tz,
    duration_min: ev.duration_min,
    repeat,
    location: ev.location ?? '',
    status: DateTime.fromISO(ev.start_local, { zone: ev.tz }) < DateTime.now() && !repeat ? 'done' : 'confirmed',
    note: '',
    // A moved date points at its series, when that series came in too.
    series_id: ev.seriesItemId && imported.has(ev.seriesItemId) ? ev.seriesItemId : null,
  });
}

async function addPageOrDocument(
  practice: Practice,
  item: PlannedItem,
  folderId: string,
  importedAt: string,
  opts: {
    readFile: (path: string) => Promise<Uint8Array>;
    stopIfAsked: () => void;
  },
): Promise<{ pages: number; attachments: number }> {
  // Read the original first: if that fails, nothing has been written for this item yet.
  const keep = item.kind === 'attachment' || item.keepOriginal;
  if (keep && (item.size ?? 0) > MAX_DOCUMENT_BYTES) throw new TooLargeError(item.source);
  const original = keep ? await reading(() => opts.readFile(item.source)) : null;
  if (original && original.length > MAX_DOCUMENT_BYTES) throw new TooLargeError(item.source);
  opts.stopIfAsked();
  let pageId: string | null = null;
  if (item.kind === 'page') {
    const page = await practice.store.put('page', {
      id: item.id,
      folder_id: folderId,
      date: item.date,
      time: item.time,
      duration_min: item.duration,
      template: 'free',
      title: item.name.replace(/\.[^.]+$/, ''),
      sections: { body: item.text },
      process_note: '',
      import_provenance: { source_name: baseName(item.source), source_kind: item.provenance, engine: item.engine, confidence: item.confidence, imported_at: importedAt },
    });
    pageId = page.id;
  }
  if (original) {
    // Asked right before: addAttachment encrypts the bytes at once, with the key a lock wipes.
    opts.stopIfAsked();
    await practice.addAttachment(original, {
      folder_id: folderId,
      page_id: pageId,
      filename: baseName(item.source),
      mime: mimeOf(item.source),
      local_only: false,
      source: item.provenance === 'ocr' ? 'scan' : 'import',
      ocr_text: item.provenance === 'ocr' ? item.text : null,
    });
  }
  return { pages: pageId ? 1 : 0, attachments: original ? 1 : 0 };
}

/** File types the wizard can read, by extension. */
export const READABLE = {
  text: ['txt', 'md', 'markdown'],
  docx: ['docx'],
  odt: ['odt'],
  rtf: ['rtf'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff'],
  attachmentOnly: ['doc', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'],
  unsupportedImage: ['heic', 'heif'],
};

export function kindOfFile(name: string): keyof typeof READABLE | 'other' {
  const ext = extensionOf(name);
  for (const [k, list] of Object.entries(READABLE)) if (list.includes(ext)) return k as keyof typeof READABLE;
  return 'other';
}
