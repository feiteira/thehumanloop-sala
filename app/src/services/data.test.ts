import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { newRecoveryPhrase, WrongSecretError } from '../core/crypto/keyring';
import type { KdfParams } from '../core/crypto/kdf';
import { type ExportLabels, protectionOf, readSalaZip } from '../core/export/sala';
import { formatHlc } from '../core/hlc';
import { emptyContact } from '../core/model/types';
import { createMemoryPlatform } from '../platform/memory';
import { type Platform, PlatformError } from '../platform/types';
import {
  BackupError, backupErrorCode, backupFileName, backupIsStale, backupStatus, backupsToPrune, buildZip, exportTo, historyFromKeep, META,
  mergeInto, openOwnBackup, openSalaFile, parseBackupName, restoreBackup, runBackup,
} from './data';
import { JobStopped } from './jobs';
import { Practice, practiceState } from './practice';
import { listTrash, purgeGroup, restoreGroup } from './trash';

const FAST: KdfParams = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 };
const labels: ExportLabels = {
  sectionTitle: (t, k) => `${t}:${k}`,
  neutralAppointment: 'Appointment',
  stickyHeading: 'Sticky notes',
  themesHeading: 'Themes',
  processNoteHeading: 'Process note',
  readme: 'Sala export',
};

async function seeded() {
  const platform = createMemoryPlatform();
  const phrase = newRecoveryPhrase();
  const practice = await Practice.create(platform, { passphrase: 'pass word', recoveryPhrase: phrase }, { params: FAST });
  const s = practice.store;
  const f = await s.put('folder', { label: 'Inês Sousa', colour: 'teal', status: 'active', tags: ['sleep'], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
  const p = await s.put('page', { folder_id: f.id, date: '2026-09-21', time: '09:00', duration_min: 50, template: 'dap', title: '', sections: { data: 'Sleeps badly', assessment: 'Improving', plan: 'Sleep diary' }, process_note: 'my private thoughts', import_provenance: null });
  await s.put('sticky', { folder_id: f.id, page_id: null, text: 'Ask about the sleep diary', colour: 'yellow', next_session: true, origin: 'therapist', state: 'stuck', peeled_at: null });
  await s.put('appointment', { folder_id: f.id, title: '', type_id: null, start_local: '2026-09-28T09:00', tz: 'Europe/Lisbon', duration_min: 50, repeat: { interval_weeks: 1, until: null, exceptions: [] }, location: '', status: 'confirmed', note: '', series_id: null });
  const att = await practice.addAttachment(new TextEncoder().encode('scan bytes'), { folder_id: f.id, page_id: p.id, filename: 'scan.png', mime: 'image/png', local_only: false, source: 'scan', ocr_text: 'hello' });
  return { platform, practice, phrase, folder: f, page: p, att };
}

/** Every file of a ZIP as text, to look for words that must not be there. */
const allText = (zip: Uint8Array) => Object.values(unzipSync(zip)).map((f) => strFromU8(f)).join('\n');

describe('attachments', () => {
  it('are stored encrypted and read back', async () => {
    const { platform, practice, att } = await seeded();
    const raw = await platform.blobs.read(att.blob_id);
    expect(new TextDecoder().decode(raw)).not.toContain('scan bytes');
    expect(new TextDecoder().decode(await practice.readAttachment(att))).toBe('scan bytes');
  });
});

describe('export', () => {
  it('writes a verifiable ZIP with records, notes, FHIR and calendar, without process notes by default', async () => {
    const { practice } = await seeded();
    const zip = await buildZip(practice, labels, { includeProcessNotes: false });
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'manifest.json', 'data/folder.jsonl', 'data/page.jsonl', 'notes/Inês Sousa/README.md', 'notes/Inês Sousa/2026-09-21.md',
      'calendar.ics', 'fhir/Patient.ndjson', 'fhir/Composition.ndjson', 'README.txt',
    ]));
    expect(strFromU8(files['notes/Inês Sousa/2026-09-21.md']!)).toContain('## dap:data');
    expect(strFromU8(files['notes/Inês Sousa/README.md']!)).toContain('Ask about the sleep diary');
    expect(strFromU8(zip, true)).not.toContain('my private thoughts');
    const read = readSalaZip(zip);
    expect(read.manifest.counts.folder).toBe(1);
    expect(read.attachments.size).toBe(1);
  });

  it('detects tampering', async () => {
    const { practice } = await seeded();
    const files = unzipSync(await buildZip(practice, labels, { includeProcessNotes: true }));
    files['notes/Inês Sousa/2026-09-21.md'] = new TextEncoder().encode('changed');
    const { zipSync } = await import('fflate');
    expect(() => readSalaZip(zipSync(files))).toThrow(/checksum/);
  });

  it('leaves out what was deleted, while backups keep it for Recently deleted', async () => {
    const { practice, platform, folder, page } = await seeded();
    await practice.store.remove('page', [page.id], { batch: 'b1' });
    await practice.store.remove('folder', [folder.id], { batch: 'b1' });
    await exportTo(practice, '/out/plain.sala', labels, { includeProcessNotes: true, password: null });
    const text = allText(await platform.files.read('/out/plain.sala'));
    expect(text).not.toContain('Inês Sousa');
    expect(text).not.toContain('Sleeps badly');
    expect(text).not.toContain('my private thoughts');
    // The delete itself is still there, so an import elsewhere deletes it too.
    const { contents } = await openSalaFile(platform, await platform.files.read('/out/plain.sala'), { kind: 'none' });
    expect(contents.records.find((r) => r.record.id === page.id)?.record).toMatchObject({ deleted: true, scrubbed: true, content_omitted: true, deleted_batch: 'b1' });

    const backup = await buildZip(practice, labels, { includeProcessNotes: true, keepDeletedContent: true });
    expect(allText(backup)).toContain('Sleeps badly');
  });

  it('round-trips through a password-protected file into another practice', async () => {
    const { practice, folder } = await seeded();
    await exportTo(practice, '/out/x.sala', labels, { includeProcessNotes: true, password: 'export pw' });
    const bytes = await practice.platform.files.read('/out/x.sala');
    expect(protectionOf(bytes)).toBe('password');
    const other = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const { contents } = await openSalaFile(other.platform, bytes, { kind: 'password', password: 'export pw' });
    const result = await mergeInto(other, contents);
    expect(result.attachments).toBe(1);
    const pages = await other.store.list('page');
    expect(pages[0]?.process_note).toBe('my private thoughts');
    expect((await other.store.get('folder', folder.id))?.label).toBe('Inês Sousa');
    const att = (await other.store.list('attachment'))[0]!;
    expect(new TextDecoder().decode(await other.readAttachment(att))).toBe('scan bytes');
    await expect(openSalaFile(other.platform, bytes, { kind: 'password', password: 'nope' })).rejects.toThrow();
  });
});

describe('backup', () => {
  async function withFolder() {
    const s = await seeded();
    s.platform.addDir('/usb');
    await s.practice.store.setMeta(META.backupFolder, '/usb');
    return s;
  }
  const names = async (platform: Platform, dir = '/usb') =>
    (await platform.files.list(dir, false)).map((e) => e.name);

  it('writes encrypted backups that restore on a new device with the recovery phrase', async () => {
    const { practice, phrase } = await withFolder();
    const t0 = new Date('2026-09-28T08:00:00Z');
    expect((await backupStatus(practice, t0)).due).toBe(true);
    const r = await runBackup(practice, labels, { now: t0 });
    expect(r.written).toBe(true);
    const [name] = await names(practice.platform);
    expect(name).toMatch(new RegExp(`^Sala backup ${practice.backupTag} 2026-09-28 \\d{6}\\.sala$`));
    expect((await backupStatus(practice, new Date(t0.getTime() + 3600_000))).due).toBe(false);
    expect((await backupStatus(practice, new Date(t0.getTime() + 25 * 3600_000))).due).toBe(true);

    const bytes = await practice.platform.files.read(`/usb/${name}`);
    expect(protectionOf(bytes)).toBe('practice-key');
    const fresh = createMemoryPlatform();
    await expect(restoreBackup(fresh, bytes, 'recovery_phrase', 'wrong words')).rejects.toBeInstanceOf(WrongSecretError);
    const restored = await restoreBackup(fresh, bytes, 'recovery_phrase', phrase);
    expect(await restored.store.count('page')).toBe(1);
    expect((await restored.store.list('page'))[0]?.process_note).toBe('my private thoughts');
    // The tag comes from the practice key, so it survives the restore.
    expect(restored.backupTag).toBe(practice.backupTag);
    await restored.lock();
    // The restored device unlocks with the original passphrase.
    const again = await Practice.unlock(fresh, 'passphrase', 'pass word');
    expect(await again.store.count('folder')).toBe(1);
  });

  it('leaves no practice behind when a restore is cut short', async () => {
    const { practice, phrase } = await withFolder();
    await runBackup(practice, labels, { now: new Date('2026-09-28T08:00:00Z') });
    const [name] = await names(practice.platform);
    const bytes = await practice.platform.files.read(`/usb/${name}`);
    const fresh = createMemoryPlatform();
    // The window closes (or the power goes) while the documents are being written.
    fresh.blobs.write = async () => {
      throw new Error('the process is gone');
    };
    await expect(restoreBackup(fresh, bytes, 'recovery_phrase', phrase)).rejects.toThrow('the process is gone');
    // Records are in, but no keyring: nothing can open it. It is never removed on its own; the
    // unlock screen says so and offers to remove it.
    expect(await fresh.practice.exists()).toBe(true);
    expect(await fresh.keyring.read()).toBeNull();
    expect(await practiceState(fresh)).toBe('noKeyring');
    expect(await fresh.practice.exists()).toBe(true);
    expect(await practiceState(practice.platform)).toBe('ready');
    expect(await practiceState(createMemoryPlatform())).toBe('none');
  });

  it('skips a practice that has not changed, unless asked', async () => {
    const { practice } = await withFolder();
    const t0 = new Date('2026-09-28T08:00:00Z');
    await runBackup(practice, labels, { now: t0 });
    const later = new Date(t0.getTime() + 26 * 3600_000);
    expect(await runBackup(practice, labels, { now: later })).toEqual({ written: false, reason: 'unchanged' });
    expect(await names(practice.platform)).toHaveLength(1);
    // Still counts as backed up: the newest backup holds everything.
    expect((await backupStatus(practice, later)).lastOk).toBe(later.toISOString());
    // Asked for, or after a change, a new one is written.
    expect((await runBackup(practice, labels, { now: new Date(later.getTime() + 1000), force: true })).written).toBe(true);
    await practice.store.put('folder', { label: 'Rui', colour: 'sage', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
    expect((await runBackup(practice, labels, { now: new Date(later.getTime() + 2000) })).written).toBe(true);
    expect(await names(practice.platform)).toHaveLength(3);
  });

  it('backs up again when the last backup file is gone or the passphrase changed', async () => {
    const { practice } = await withFolder();
    const t0 = new Date('2026-09-28T08:00:00Z');
    await runBackup(practice, labels, { now: t0 });
    const [first] = await names(practice.platform);
    await practice.platform.files.remove(`/usb/${first}`);
    expect((await runBackup(practice, labels, { now: new Date(t0.getTime() + 1000) })).written).toBe(true);
    await practice.changeSecret('passphrase', 'a new pass', { params: FAST });
    expect((await runBackup(practice, labels, { now: new Date(t0.getTime() + 2000) })).written).toBe(true);
  });

  it('a lock in the middle of a backup still leaves a file that opens', async () => {
    const { practice, platform } = await withFolder();
    const key = practice.practiceKey.slice();
    const read = platform.blobs.read;
    // Lock while the backup reads the documents, after the records were read.
    platform.blobs.read = async (id) => {
      await practice.lock();
      return read(id);
    };
    const r = await runBackup(practice, labels, { now: new Date('2026-09-28T08:00:00Z') });
    expect(practice.practiceKey.every((b) => b === 0)).toBe(true);
    expect(r.written).toBe(true);
    const bytes = await platform.files.read((r as { path: string }).path);
    const { contents } = await openSalaFile(platform, bytes, { kind: 'practice-key', practiceKey: key });
    expect(contents.attachments.size).toBe(1);
    expect(contents.manifest.counts.page).toBe(1);
  });

  it('never runs in the example practice', async () => {
    const { practice, platform } = await withFolder();
    platform.info = async () => ({ version: '0.1.0', os: 'demo', data_dir: '/demo', example: true });
    await expect(runBackup(practice, labels)).rejects.toMatchObject({ code: 'EXAMPLE' });
    expect(await names(platform)).toEqual([]);
  });

  it('fails fast with a reason when the folder is not there, and keeps the reason', async () => {
    const { practice } = await seeded();
    await practice.store.setMeta(META.backupFolder, '/media/usb-unplugged');
    const now = new Date('2026-09-28T08:00:00Z');
    await expect(runBackup(practice, labels, { now })).rejects.toMatchObject({ code: 'FOLDER_MISSING' });
    const status = await backupStatus(practice, now);
    expect(status.lastError).toEqual({ at: now.toISOString(), code: 'FOLDER_MISSING' });
    expect(status.due).toBe(true);
  });

  it('calls a backup stale after three days, so Today can say so', () => {
    const now = new Date('2026-09-28T09:00:00Z');
    const at = (days: number) => new Date(now.getTime() - days * 86400_000).toISOString();
    const status = (lastOk: string | null) => ({ folder: '/usb', lastOk, lastError: null, due: false });
    expect(backupIsStale(status(at(2)), now)).toBe(false);
    expect(backupIsStale(status(at(3.5)), now)).toBe(true);
    expect(backupIsStale(status(null), now)).toBe(true);
  });

  it('turns platform errors into reasons a therapist can act on', () => {
    expect(backupErrorCode(new PlatformError('NOT_FOUND', 'x'))).toBe('FOLDER_MISSING');
    expect(backupErrorCode(new PlatformError('PERMISSION_DENIED', 'x'))).toBe('PERMISSION');
    expect(backupErrorCode(new PlatformError('IO_ERROR', 'file error: No space left on device (os error 28)'))).toBe('DISK_FULL');
    expect(backupErrorCode(new PlatformError('IO_ERROR', 'file error: There is not enough space on the disk. (os error 112)'))).toBe('DISK_FULL');
    expect(backupErrorCode(new BackupError('FOLDER_MISSING', 'x'))).toBe('FOLDER_MISSING');
    expect(backupErrorCode(new Error('boom'))).toBe('ERROR');
  });

  it('does not prune good backups when the new one does not read back', async () => {
    const { practice, platform } = await withFolder();
    const t0 = new Date('2026-09-01T08:00:00Z');
    for (let d = 0; d < 6; d++) await runBackup(practice, labels, { now: new Date(t0.getTime() + d * 86400_000), force: true });
    const before = await names(platform);
    const write = platform.files.write;
    platform.files.write = async (path, bytes) => write(path, bytes.slice(0, bytes.length - 10));
    await expect(runBackup(practice, labels, { now: new Date('2026-12-30T08:00:00Z'), force: true })).rejects.toBeInstanceOf(BackupError);
    expect(await names(platform)).toEqual(before);
  });

  it('removes half-written files older than an hour', async () => {
    const { practice, platform } = await withFolder();
    platform.fileStore.set('/usb/Sala backup abcdef 2026-09-01 080000.sala.tmp', new Uint8Array([1])); // written long ago
    await platform.files.write('/usb/Sala backup abcdef 2026-09-28 075959.sala.tmp', new Uint8Array([1])); // being written now
    await runBackup(practice, labels, { now: new Date() });
    const left = await names(platform);
    expect(left).not.toContain('Sala backup abcdef 2026-09-01 080000.sala.tmp');
    expect(left).toContain('Sala backup abcdef 2026-09-28 075959.sala.tmp');
  });

  it('never prunes another practice’s backups in a shared folder', async () => {
    const { practice, platform } = await withFolder();
    const other = 'ffffff' === practice.backupTag ? 'eeeeee' : 'ffffff';
    const theirs = ['2025-01-01 080000', '2025-06-01 080000', '2026-09-27 080000'].map((d) => `Sala backup ${other} ${d}.sala`);
    for (const n of theirs) platform.fileStore.set(`/usb/${n}`, new Uint8Array([1]));
    await runBackup(practice, labels, { now: new Date('2026-09-28T08:00:00Z') });
    const left = await names(platform);
    for (const n of theirs) expect(left).toContain(n);
  });
});

describe('backup history', () => {
  const tag = 'a1b2c3';
  const at = (iso: string) => backupFileName(tag, new Date(iso));
  const now = new Date('2026-09-28T12:00:00');

  it('names files with the practice tag and seconds, and reads old names', () => {
    expect(backupFileName(tag, new Date(2026, 8, 28, 9, 5, 7))).toBe('Sala backup a1b2c3 2026-09-28 090507.sala');
    expect(parseBackupName('Sala backup a1b2c3 2026-09-28 090507.sala')).toMatchObject({ tag });
    expect(parseBackupName('Sala backup 2026-09-28 0905.sala')).toMatchObject({ tag: null });
    expect(parseBackupName('Sala backup notes.sala')).toBeNull();
    expect(parseBackupName('Holiday photos.sala')).toBeNull();
  });

  it('reads the old "keep n backups" as a history length', () => {
    expect([historyFromKeep('5'), historyFromKeep('10'), historyFromKeep('30'), historyFromKeep(null)]).toEqual([30, 90, 365, 90]);
  });

  it('keeps everything from the last day, then one a day, a week and a month', () => {
    const files: string[] = [];
    // A backup every 2 hours for 400 days.
    for (let h = 0; h < 400 * 24; h += 2) files.push(at(new Date(now.getTime() - h * 3600_000).toISOString()));
    const removed = new Set(backupsToPrune(files, { tag, historyDays: 365, legacyKeep: 10, now }));
    const kept = files.filter((f) => !removed.has(f)).map((f) => parseBackupName(f)!.at);
    const ages = kept.map((d) => (now.getTime() - d.toMillis()) / 86400_000);
    expect(ages.filter((a) => a < 1)).toHaveLength(10);
    // One per calendar day for two weeks (the last day's ten included).
    const days = new Set(kept.filter((d, i) => ages[i]! < 14).map((d) => d.toISODate()));
    expect(days.size).toBeGreaterThanOrEqual(14);
    expect(kept.filter((_, i) => ages[i]! >= 1 && ages[i]! < 14).length).toBeLessThanOrEqual(14);
    // About one a week until 8 weeks, one a month after that, nothing past a year.
    expect(kept.filter((_, i) => ages[i]! >= 14 && ages[i]! < 56).length).toBeGreaterThanOrEqual(5);
    expect(kept.filter((_, i) => ages[i]! >= 14 && ages[i]! < 56).length).toBeLessThanOrEqual(7);
    expect(kept.filter((_, i) => ages[i]! >= 56).length).toBeGreaterThanOrEqual(9);
    expect(kept.filter((_, i) => ages[i]! >= 56).length).toBeLessThanOrEqual(11);
    expect(Math.max(...ages)).toBeLessThan(365);
    expect(kept.length).toBeLessThan(50);
  });

  it('keeps no more than the chosen history, but always the newest few', () => {
    const files = [1, 5, 20, 40, 100, 200].map((d) => at(new Date(now.getTime() - d * 86400_000).toISOString()));
    const removed = backupsToPrune(files, { tag, historyDays: 30, legacyKeep: 10, now });
    expect(removed.map((n) => parseBackupName(n)!.at.toISODate())).toEqual(['2026-08-19', '2026-06-20', '2026-03-12']);
    // A clock gone wrong (everything looks years old) still leaves the newest three.
    const later = new Date('2030-01-01T00:00:00');
    expect(backupsToPrune(files, { tag, historyDays: 30, legacyKeep: 10, now: later })).toHaveLength(3);
  });

  it('applies the old count rule to files named without a tag, and leaves other files alone', () => {
    const legacy = ['2026-09-20 0800', '2026-09-21 0800', '2026-09-22 0800', '2026-09-23 0800'].map((d) => `Sala backup ${d}.sala`);
    const others = ['Sala backup ffffff 2020-01-01 080000.sala', 'notes.txt', 'Sala backup copy.sala'];
    const removed = backupsToPrune([...legacy, ...others], { tag, historyDays: 365, legacyKeep: 2, now });
    expect(removed).toEqual(['Sala backup 2026-09-21 0800.sala', 'Sala backup 2026-09-20 0800.sala']);
  });
});

describe('importing a .sala file', () => {
  it('opens this practice’s own backups without asking for the passphrase', async () => {
    const { practice, platform } = await seeded();
    platform.addDir('/usb');
    await practice.store.setMeta(META.backupFolder, '/usb');
    const r = await runBackup(practice, labels);
    const bytes = await platform.files.read((r as { path: string }).path);
    expect((await openOwnBackup(practice, bytes))?.manifest.include_process_notes).toBe(true);
    const stranger = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    expect(await openOwnBackup(stranger, bytes)).toBeNull();
  });

  it('keeps your private process notes when the file left them out', async () => {
    const { practice, page } = await seeded();
    // The same practice elsewhere: a newer edit of the page, exported without process notes.
    const elsewhere = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await elsewhere.store.merge([{ kind: 'page', record: page }]);
    await elsewhere.store.update('page', page.id, { sections: { data: 'Sleeps better now' } });
    await exportTo(elsewhere, '/out/no-notes.sala', labels, { includeProcessNotes: false, password: null });
    const { contents } = await openSalaFile(practice.platform, await elsewhere.platform.files.read('/out/no-notes.sala'), { kind: 'none' });
    expect(contents.manifest.include_process_notes).toBe(false);
    await mergeInto(practice, contents);
    const merged = await practice.store.get('page', page.id);
    expect(merged?.sections.data).toBe('Sleeps better now');
    expect(merged?.process_note).toBe('my private thoughts');
  });

  it('a deleted item in an export stays restorable where a copy of it exists', async () => {
    const { practice, folder, page } = await seeded();
    // The same practice elsewhere, where the folder and its page get deleted, then exported.
    const elsewhere = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await elsewhere.store.merge([{ kind: 'folder', record: folder }, { kind: 'page', record: page }]);
    await elsewhere.store.remove('page', [page.id], { batch: 'gone' });
    await elsewhere.store.remove('folder', [folder.id], { batch: 'gone' });
    await exportTo(elsewhere, '/out/x.sala', labels, { includeProcessNotes: true, password: null });
    const { contents } = await openSalaFile(practice.platform, await elsewhere.platform.files.read('/out/x.sala'), { kind: 'none' });

    await mergeInto(practice, contents);
    expect(await practice.store.list('folder')).toEqual([]);
    const [group] = await listTrash(practice.store);
    expect(group?.key).toBe('gone');
    await restoreGroup(practice, group!);
    expect((await practice.store.get('folder', folder.id))?.label).toBe('Inês Sousa');
    expect((await practice.store.get('page', page.id))?.process_note).toBe('my private thoughts');

    // A practice that never had them gets only the delete: nothing to list or restore.
    const fresh = await Practice.create(createMemoryPlatform(), { passphrase: 'c', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await mergeInto(fresh, contents);
    expect(await listTrash(fresh.store)).toEqual([]);
    expect((await fresh.store.get('folder', folder.id))?.deleted).toBe(true);
    expect(JSON.stringify(await fresh.store.get('page', page.id))).not.toContain('Sleeps badly');
  });

  it('backs up after an import, even of records older than the practice’s last change', async () => {
    const { practice, platform } = await seeded();
    platform.addDir('/usb');
    await practice.store.setMeta(META.backupFolder, '/usb');
    const t0 = new Date('2026-09-28T08:00:00Z');
    await runBackup(practice, labels, { now: t0 });
    // A colleague's handover, written long ago.
    const colleague = await Practice.create(createMemoryPlatform(), { passphrase: 'b', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await colleague.store.put('folder', { label: 'Handover patient', colour: 'sage', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
    await exportTo(colleague, '/out/handover.sala', labels, { includeProcessNotes: false, password: null });
    const { contents } = await openSalaFile(platform, await colleague.platform.files.read('/out/handover.sala'), { kind: 'none' });
    const old = formatHlc({ ms: 1_000_000, counter: 0, device: 'colleague' });
    for (const r of contents.records) r.record.updated_at_hlc = old;
    const latest = await practice.store.latestHlc();

    expect((await mergeInto(practice, contents)).records).toBeGreaterThan(0);
    expect(await practice.store.latestHlc()).toBe(latest);
    const r = await runBackup(practice, labels, { now: new Date(t0.getTime() + 3600_000) });
    expect(r.written).toBe(true);
  });

  it('does not bring back the file of a document erased here for good', async () => {
    const { practice, att } = await seeded();
    await exportTo(practice, '/out/all.sala', labels, { includeProcessNotes: true, password: null });
    await practice.store.remove('attachment', [att.id]);
    await purgeGroup(practice, (await listTrash(practice.store))[0]!);
    const { contents } = await openSalaFile(practice.platform, await practice.platform.files.read('/out/all.sala'), { kind: 'none' });
    expect((await mergeInto(practice, contents)).attachments).toBe(0);
    await expect(practice.platform.blobs.read(att.blob_id)).rejects.toThrow();
  });

  it('gives a document in Recently deleted its file back, so Restore opens it', async () => {
    // A document deleted under 0.1.1 lost its file at once; an older backup still has it.
    const { practice, att } = await seeded();
    await exportTo(practice, '/out/all.sala', labels, { includeProcessNotes: true, password: null });
    await practice.store.remove('attachment', [att.id]);
    await practice.platform.blobs.remove(att.blob_id);
    const { contents } = await openSalaFile(practice.platform, await practice.platform.files.read('/out/all.sala'), { kind: 'none' });
    expect((await mergeInto(practice, contents)).attachments).toBe(1);
    expect((await practice.store.get('attachment', att.id))?.deleted).toBe(true);
    await restoreGroup(practice, (await listTrash(practice.store))[0]!);
    expect(new TextDecoder().decode(await practice.readAttachment(att))).toBe('scan bytes');
  });
});

describe('when Sala locks part-way', () => {
  /** Locks the practice while the `n`th document file is being read. */
  function lockOnRead(platform: Platform, practice: Practice, n = 1) {
    const read = platform.blobs.read;
    let reads = 0;
    platform.blobs.read = async (id) => {
      const bytes = await read(id);
      if (++reads === n) await practice.lock();
      return bytes;
    };
    return () => {
      platform.blobs.read = read;
    };
  }

  it('an export writes no file rather than one with documents missing', async () => {
    const { platform, practice, folder } = await seeded();
    await practice.addAttachment(new TextEncoder().encode('second scan'), { folder_id: folder.id, page_id: null, filename: 'b.png', mime: 'image/png', local_only: false, source: 'scan', ocr_text: null });
    lockOnRead(platform, practice);
    await expect(exportTo(practice, '/out/all.sala', labels, { includeProcessNotes: false, password: null, shouldStop: () => !practice.isOpen })).rejects.toThrow();
    expect(await platform.files.exists('/out/all.sala')).toBe(false);
  });

  it('adding a .sala file stops between documents, and adding it again brings the rest', async () => {
    const { platform, practice, folder } = await seeded();
    await practice.addAttachment(new TextEncoder().encode('second scan'), { folder_id: folder.id, page_id: null, filename: 'b.png', mime: 'image/png', local_only: false, source: 'scan', ocr_text: null });
    await exportTo(practice, '/out/all.sala', labels, { includeProcessNotes: true, password: null });
    const { contents } = await openSalaFile(platform, await platform.files.read('/out/all.sala'), { kind: 'none' });
    const target = createMemoryPlatform();
    const other = await Practice.create(target, { passphrase: 'other pass', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await other.store.setMeta(META.backupLastHlc, 'fingerprint of the last backup');
    // Locking starts once the first document's file is written.
    let locking = false;
    const write = target.blobs.write;
    target.blobs.write = async (id, bytes) => {
      await write(id, bytes);
      locking = true;
    };
    await expect(mergeInto(other, contents, () => locking)).rejects.toBeInstanceOf(JobStopped);
    target.blobs.write = write;
    expect(await other.store.count('attachment')).toBe(2);
    // The records came in, so the next backup is made even though the stamps are older.
    expect(await other.store.getMeta(META.backupLastHlc)).toBeFalsy();
    expect(await mergeInto(other, contents)).toEqual({ records: 0, attachments: 1 });
  });

  it('adding a .sala file never overwrites a good document with one it can no longer check', async () => {
    const { platform, practice, att } = await seeded();
    await exportTo(practice, '/out/all.sala', labels, { includeProcessNotes: true, password: null });
    const { contents } = await openSalaFile(platform, await platform.files.read('/out/all.sala'), { kind: 'none' });
    const restore = lockOnRead(platform, practice);
    await expect(mergeInto(practice, contents)).rejects.toThrow();
    restore();
    const again = await Practice.unlock(platform, 'passphrase', 'pass word');
    expect(new TextDecoder().decode(await again.readAttachment(att))).toBe('scan bytes');
  });

  it('a document added after the lock is refused, and nothing is written with the wiped key', async () => {
    const { platform, practice, folder } = await seeded();
    const writes: string[] = [];
    const write = platform.blobs.write;
    platform.blobs.write = async (id, bytes) => {
      writes.push(id);
      return write(id, bytes);
    };
    await practice.lock();
    await expect(
      practice.addAttachment(new TextEncoder().encode('psychiatric report'), { folder_id: folder.id, page_id: null, filename: 'r.pdf', mime: 'application/pdf', local_only: false, source: 'upload', ocr_text: null }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(practice.readAttachment((await seeded()).att)).rejects.toMatchObject({ code: 'LOCKED' });
    expect(writes).toEqual([]);
  });
});

describe('a document in Recently deleted', () => {
  it('can still be restored after the practice moves to a new computer', async () => {
    const { platform, practice, att } = await seeded();
    platform.addDir('/usb');
    await practice.store.setMeta(META.backupFolder, '/usb');
    await practice.removeAttachment(att, { batch: 'b1' });
    const r = await runBackup(practice, labels, { force: true });
    if (!r.written) throw new Error('no backup');
    const backup = await platform.files.read(r.path);
    // Exports never carry it; only backups do.
    const plain = readSalaZip(await buildZip(practice, labels, { includeProcessNotes: true }));
    expect(plain.attachments.size).toBe(0);

    const elsewhere = await restoreBackup(createMemoryPlatform(), backup, 'passphrase', 'pass word');
    const [group] = await listTrash(elsewhere.store);
    expect(group?.lead.kind).toBe('attachment');
    expect(await restoreGroup(elsewhere, group!)).toEqual({ restored: 1, failed: 0, erased: 0 });
    expect(new TextDecoder().decode(await elsewhere.readAttachment(att))).toBe('scan bytes');
  });
});
