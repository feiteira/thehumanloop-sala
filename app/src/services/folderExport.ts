import { buildSalaZip, encryptWithPassword, type ExportLabels, type ExportRecord } from '../core/export/sala';
import type { Attachment, Folder, Kind } from '../core/model/types';
import { JobStopped, stopper } from './jobs';
import { isLocked, type Practice } from './practice';

// One patient's folder as a .sala file, for an access request or a handover to a colleague:
// the same open formats as a whole-practice export, with nothing about anyone else.

export interface FolderExportOptions {
  includeProcessNotes: boolean;
  includeDocuments: boolean;
  /** Encrypts the file; it then opens only in Sala. */
  password: string | null;
  /**
   * Asked before each document is read and before the file is written. Once it says yes
   * (Sala is locking, and its keys are about to be wiped), the export throws `JobStopped`
   * and writes nothing, rather than a file with documents missing.
   */
  shouldStop?: () => boolean;
}

/**
 * The live records of one folder: the folder, its pages, its sticky notes (not the discarded
 * ones), its appointments and the appointment types they use, and its documents when asked.
 * Deleted records are never included.
 */
export async function folderRecords(practice: Practice, folderId: string, opts: { includeDocuments: boolean }): Promise<ExportRecord[]> {
  const store = practice.store;
  const folder = await store.get('folder', folderId);
  if (!folder || folder.deleted) throw new Error('folder not found');
  const of = { where: 'folder_id = ?', params: [folderId] };
  const pages = await store.list('page', of);
  const stickies = (await store.list('sticky', of)).filter((s) => s.state !== 'discarded');
  const appointments = await store.list('appointment', of);
  const typeIds = new Set(appointments.map((a) => a.type_id).filter((id): id is string => !!id));
  const types = (await store.list('appointment_type')).filter((t) => typeIds.has(t.id));
  const attachments = opts.includeDocuments ? await store.list('attachment', of) : [];
  const out: ExportRecord[] = [];
  const add = (kind: Kind, records: { deleted: boolean }[]) => {
    for (const record of records) if (!record.deleted) out.push({ kind, record: record as ExportRecord['record'] });
  };
  // The link to The Human Loop belongs to this practice's account, not to the person who gets the file.
  const unlinked: Folder = { ...folder, loop_vault_id: null };
  add('folder', [unlinked]);
  add('page', pages);
  add('sticky', stickies);
  add('appointment_type', types);
  add('appointment', appointments);
  add('attachment', attachments);
  return out;
}

/** "Ana Silva 2026-10-01.sala", without characters that file systems refuse. */
export function folderExportName(folder: Pick<Folder, 'label'>, isoDate: string): string {
  const label = folder.label.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sala';
  return `${label} ${isoDate}.sala`;
}

/** Writes one folder's .sala file to `path`. */
export async function exportFolderTo(practice: Practice, folderId: string, path: string, labels: ExportLabels, opts: FolderExportOptions): Promise<void> {
  const stopIfAsked = stopper(opts.shouldStop);
  const records = await folderRecords(practice, folderId, opts);
  const info = await practice.platform.info();
  const zip = await buildSalaZip(records, {
    appVersion: info.version,
    practiceId: practice.store.practiceId,
    includeProcessNotes: opts.includeProcessNotes,
    labels,
    readAttachment: async (a: Attachment) => {
      stopIfAsked();
      try {
        return await practice.readAttachment(a);
      } catch (e) {
        // A missing file must not stop the export; a lock that wiped the key meanwhile must.
        if (isLocked(e)) throw new JobStopped();
        stopIfAsked();
        console.error('document left out of the folder export', a.id, e);
        return null;
      }
    },
  });
  const bytes = opts.password ? await encryptWithPassword(zip, opts.password, practice.platform.kdf) : zip;
  stopIfAsked();
  await practice.platform.files.write(path, bytes);
}
