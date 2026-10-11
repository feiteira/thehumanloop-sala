import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import type { KdfParams } from '../core/crypto/kdf';
import { type ExportLabels, protectionOf, readSalaZip } from '../core/export/sala';
import { emptyContact, type Page } from '../core/model/types';
import { createMemoryPlatform } from '../platform/memory';
import { mergeInto, openSalaFile } from './data';
import { exportFolderTo, folderExportName } from './folderExport';
import { Practice } from './practice';
import { JobStopped } from './jobs';

const FAST: KdfParams = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 };
const labels: ExportLabels = {
  sectionTitle: (t, k) => `${t}:${k}`,
  neutralAppointment: 'Appointment',
  stickyHeading: 'Sticky notes',
  themesHeading: 'Themes',
  processNoteHeading: 'Process note',
  readme: 'Sala export',
};

async function twoPatients() {
  const platform = createMemoryPlatform();
  const practice = await Practice.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
  const s = practice.store;
  const folder = (label: string) => s.put('folder', { label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
  const page = (folderId: string, date: string, note: string) =>
    s.put('page', { folder_id: folderId, date, time: null, duration_min: null, template: 'free', title: '', sections: { body: `Session ${date}` }, process_note: note, import_provenance: null });
  const ines = await s.update('folder', (await folder('Inês Sousa')).id, { loop_vault_id: 'vault-of-this-practice' });
  const rui = await folder('Rui Marques');
  const p1 = await page(ines.id, '2026-09-21', 'my private thoughts');
  await page(ines.id, '2026-09-28', '');
  const gone = await page(ines.id, '2026-09-14', 'deleted');
  await s.remove('page', [gone.id]);
  await page(rui.id, '2026-09-22', 'about Rui');
  const sticky = (folderId: string, text: string, state: 'stuck' | 'discarded') =>
    s.put('sticky', { folder_id: folderId, page_id: null, text, colour: 'yellow', next_session: false, origin: 'therapist', state, peeled_at: null });
  await sticky(ines.id, 'Ask about the sleep diary', 'stuck');
  await sticky(ines.id, 'Thrown away', 'discarded');
  await sticky(rui.id, 'Rui’s note', 'stuck');
  const type = await s.put('appointment_type', { name: 'Session', duration_min: 50, colour: 'teal', for_new_patients: false, archived: false });
  await s.put('appointment_type', { name: 'Unused', duration_min: 90, colour: 'blue', for_new_patients: true, archived: false });
  const appt = (folderId: string | null, typeId: string | null) =>
    s.put('appointment', { folder_id: folderId, title: folderId ? '' : 'Supervision', type_id: typeId, start_local: '2026-09-28T09:00', tz: 'Europe/Lisbon', duration_min: 50, repeat: null, location: '', status: 'confirmed', note: '', series_id: null });
  await appt(ines.id, type.id);
  await appt(rui.id, null);
  await appt(null, null);
  await practice.addAttachment(new TextEncoder().encode('scan bytes'), { folder_id: ines.id, page_id: p1.id, filename: 'scan.png', mime: 'image/png', local_only: false, source: 'scan', ocr_text: 'hello' });
  await practice.addAttachment(new TextEncoder().encode('rui bytes'), { folder_id: rui.id, page_id: null, filename: 'rui.pdf', mime: 'application/pdf', local_only: false, source: 'upload', ocr_text: null });
  return { platform, practice, ines, rui };
}

describe('exportFolderTo', () => {
  it('writes only that folder’s live records, without process notes unless asked', async () => {
    const { platform, practice, ines } = await twoPatients();
    await exportFolderTo(practice, ines.id, '/out/ines.sala', labels, { includeProcessNotes: false, includeDocuments: true, password: null });
    const zip = await platform.files.read('/out/ines.sala');
    expect(protectionOf(zip)).toBe('none');
    const { records, attachments, manifest } = readSalaZip(zip);
    const of = (kind: string) => records.filter((r) => r.kind === kind).map((r) => r.record);
    expect(of('folder').map((f) => (f as { label: string }).label)).toEqual(['Inês Sousa']);
    // The link to The Human Loop belongs to this practice, not to whoever gets the file.
    expect(of('folder').map((f) => (f as { loop_vault_id?: string | null }).loop_vault_id ?? null)).toEqual([null]);
    expect((of('page') as Page[]).map((p) => p.date).sort()).toEqual(['2026-09-21', '2026-09-28']);
    expect((of('page') as Page[]).every((p) => p.process_note === '')).toBe(true);
    expect(of('sticky').map((x) => (x as { text: string }).text)).toEqual(['Ask about the sleep diary']);
    expect(of('appointment')).toHaveLength(1);
    expect(of('appointment_type').map((x) => (x as { name: string }).name)).toEqual(['Session']);
    expect(of('setting')).toEqual([]);
    expect(records.every((r) => !r.record.deleted)).toBe(true);
    expect([...attachments.values()].map((b) => strFromU8(b))).toEqual(['scan bytes']);
    expect(manifest.include_process_notes).toBe(false);
    const files = Object.keys(unzipSync(zip));
    expect(files.filter((f) => f.startsWith('notes/'))).toEqual(expect.arrayContaining(['notes/Inês Sousa/README.md', 'notes/Inês Sousa/2026-09-21.md']));
    expect(files.some((f) => f.includes('Rui'))).toBe(false);
    expect(strFromU8(unzipSync(zip)['calendar.ics']!)).not.toContain('Supervision');
  });

  it('can leave documents out, keep process notes, and protect the file with a password', async () => {
    const { platform, practice, ines } = await twoPatients();
    await exportFolderTo(practice, ines.id, '/out/ines.sala', labels, { includeProcessNotes: true, includeDocuments: false, password: 'handover pw' });
    const bytes = await platform.files.read('/out/ines.sala');
    expect(protectionOf(bytes)).toBe('password');
    const other = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const { contents } = await openSalaFile(other.platform, bytes, { kind: 'password', password: 'handover pw' });
    await mergeInto(other, contents);
    expect(await other.store.count('folder')).toBe(1);
    expect(await other.store.count('attachment')).toBe(0);
    expect((await other.store.list('page')).map((p) => p.process_note).sort()).toEqual(['', 'my private thoughts']);
  });

  it('writes nothing when Sala starts locking, rather than a file with documents missing', async () => {
    const { platform, practice, ines } = await twoPatients();
    let locking = false;
    // The lock wipes the keys while a document is being read.
    const read = practice.readAttachment.bind(practice);
    practice.readAttachment = async (a) => {
      locking = true;
      await practice.lock();
      return read(a);
    };
    await expect(
      exportFolderTo(practice, ines.id, '/out/ines.sala', labels, { includeProcessNotes: false, includeDocuments: true, password: null, shouldStop: () => locking }),
    ).rejects.toBeInstanceOf(JobStopped);
    expect(platform.fileStore.has('/out/ines.sala')).toBe(false);
  });

  it('still leaves out a document whose file is missing', async () => {
    const { platform, practice, ines } = await twoPatients();
    const [att] = await practice.store.list('attachment', { where: 'folder_id = ?', params: [ines.id] });
    await platform.blobs.remove(att!.blob_id);
    await exportFolderTo(practice, ines.id, '/out/ines.sala', labels, { includeProcessNotes: false, includeDocuments: true, password: null, shouldStop: () => false });
    expect(readSalaZip(await platform.files.read('/out/ines.sala')).attachments.size).toBe(0);
  });

  it('names the file after the folder and the date', () => {
    expect(folderExportName({ label: 'Ana Silva' }, '2026-10-01')).toBe('Ana Silva 2026-10-01.sala');
    expect(folderExportName({ label: 'Miguel / Sofia: "casal"' }, '2026-10-01')).toBe('Miguel Sofia casal 2026-10-01.sala');
  });
});
