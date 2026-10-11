import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../core/crypto/keyring';
import type { ImportPlan, PlannedItem } from '../core/import/plan';
import { emptyContact } from '../core/model/types';
import { createMemoryPlatform } from '../platform/memory';
import { deleteFolder } from './folders';
import { type CsvDetails, type IcsDetails, mergeFolderDetails, runImport, tidyImportJobs, unfinishedJob } from './importer';
import { listTrash, purgeGroup } from './trash';
import { Practice } from './practice';
import { JobStopped } from './jobs';

const FAST = { algo: 'argon2id' as const, m: 64, t: 1, p: 1, key_len: 32 };

const item = (over: Partial<PlannedItem>): PlannedItem => ({
  id: over.id ?? Math.random().toString(36).slice(2), kind: 'page', folderKey: 'f1', source: '/in/a.txt', name: 'a.txt', date: '2024-03-12', dateSource: 'name',
  time: null, duration: null, text: 'Session text', provenance: 'text', engine: null, confidence: null, keepOriginal: false, mime: 'text/plain', include: true, warning: null, done: false, ...over,
});

const event = (over: Partial<PlannedItem> & { details?: Partial<IcsDetails> }): PlannedItem => {
  const { details, ...rest } = over;
  const ev: IcsDetails = {
    uid: 'u', summary: 'Ana Silva', start_local: '2026-10-05T09:00', tz: 'Europe/Lisbon', duration_min: 50, location: '',
    repeatWeeks: null, until: null, exceptions: [], movedFrom: null, unsupportedRepeat: false, seriesItemId: null, ...details,
  };
  return item({ kind: 'appointment', provenance: 'ics', name: ev.summary, date: ev.start_local.slice(0, 10), time: ev.start_local.slice(11), text: JSON.stringify(ev), ...rest });
};

describe('runImport', () => {
  it('creates folders, pages and kept originals, skipping excluded folders and items', async () => {
    const platform = createMemoryPlatform();
    platform.fileStore.set('/in/scan.png', new Uint8Array([1, 2, 3]));
    platform.fileStore.set('/in/b.txt', new TextEncoder().encode('b'));
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job1', createdAt: '', state: 'review',
      folders: [
        { key: 'f1', label: 'Ana Silva', existingId: null, suggestedId: null, include: true },
        { key: 'f2', label: 'Unused', existingId: null, suggestedId: null, include: true },
        { key: 'f3', label: 'Excluded', existingId: null, suggestedId: null, include: false },
      ],
      items: [
        item({ id: 'a', name: 'scan.png', source: '/in/scan.png', provenance: 'ocr', keepOriginal: true, confidence: 91, engine: 'tesseract.js (por)' }),
        item({ id: 'b', name: 'b.txt', source: '/in/b.txt' }),
        item({ id: 'c', folderKey: 'f3', name: 'c.txt' }),
        item({ id: 'd', include: false }),
      ],
    };
    await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    expect(await practice.store.count('folder')).toBe(1);
    const pages = await practice.store.list('page', { order: 'date' });
    expect(pages.map((p) => p.title).sort()).toEqual(['b', 'scan'].sort());
    expect(pages.find((p) => p.title === 'scan')?.import_provenance).toMatchObject({ source_kind: 'ocr', confidence: 91 });
    const atts = await practice.store.list('attachment');
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ source: 'scan', ocr_text: 'Session text' });
    expect(await unfinishedJob(practice)).toBeNull();
  });

  it('keeps nothing of a finished import, so Delete now erases what it brought in for good', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job-erase', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Beatriz Lemos', existingId: null, suggestedId: null, include: true }],
      items: [item({ id: 'p', text: 'Spoke about the divorce' })],
    };
    await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    const kept = async () => (await practice.store.db.query<{ data: string }>('SELECT data FROM import_jobs')).map((r) => r.data).join('\n');
    expect(await kept()).toBe('');
    const folder = (await practice.store.list('folder'))[0]!;
    await deleteFolder(practice.store, folder.id);
    for (const g of await listTrash(practice.store)) await purgeGroup(practice, g);
    expect(await kept()).toBe('');
    expect(JSON.stringify(await practice.store.get('page', 'p'))).not.toContain('divorce');
  });

  it('keeps an unfinished import without the text it already brought in, and forgets what older versions kept', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job-half', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Rui', existingId: null, suggestedId: null, include: true }],
      items: [item({ id: 'a', text: 'Imported words' }), item({ id: 'b', date: 'not a date', text: 'Waiting words' })],
    };
    await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    const waiting = (await unfinishedJob(practice))!;
    expect(waiting.items.map((i) => i.text)).toEqual(['', 'Waiting words']);

    // As earlier versions left them: a finished import, and imported text in an unfinished one.
    const db = practice.store.db;
    await db.exec("INSERT INTO import_jobs (id, created_at, updated_at, state, data) VALUES ('old', '', '', 'done', '{}')");
    await db.exec('UPDATE import_jobs SET data = ? WHERE id = ?', [JSON.stringify(plan), plan.id]);
    await tidyImportJobs(practice);
    const rows = await db.query<{ id: string; data: string }>('SELECT id, data FROM import_jobs');
    expect(rows.map((r) => r.id)).toEqual(['job-half']);
    expect(rows[0]!.data).not.toContain('Imported words');
    expect(rows[0]!.data).toContain('Waiting words');
  });

  it('carries on past an item that fails, lists it, and imports it later without copies', async () => {
    const platform = createMemoryPlatform();
    platform.fileStore.set('/in/x.pdf', new Uint8Array([9]));
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job2', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Rui', existingId: null, suggestedId: null, include: true }],
      items: [
        item({ id: 'a' }),
        item({ id: 'b', name: 'x.pdf', source: '/in/x.pdf', keepOriginal: true }),
        item({ id: 'c', name: 'bad date.txt', date: '28/09/2026' }),
        item({ id: 'd', name: 'later.txt' }),
      ],
    };
    let fail = true;
    const readFile = async (p: string) => {
      if (fail) throw new Error('drive unplugged');
      return platform.files.read(p);
    };
    const first = await runImport(practice, plan, { readFile, onProgress: () => {} });
    expect(first).toMatchObject({ folders: 1, pages: 2, attachments: 0 });
    expect(first.failed).toEqual([{ id: 'b', name: 'x.pdf', reason: 'read' }, { id: 'c', name: 'bad date.txt', reason: 'invalid' }]);
    expect(plan.items.map((i) => [i.id, i.done, i.error ?? null])).toEqual([['a', true, null], ['b', false, 'read'], ['c', false, 'invalid'], ['d', true, null]]);
    expect(plan.folders[0]).toMatchObject({ created: true });
    // The failed items wait for Continue import, even after the done screen is gone.
    const waiting = await unfinishedJob(practice);
    expect(waiting).toMatchObject({ id: 'job2', state: 'review' });
    expect(waiting?.items.filter((i) => !i.done).map((i) => i.id)).toEqual(['b', 'c']);

    // Back in review: the date is fixed and the drive plugged in again.
    fail = false;
    plan.items[2]!.date = '2026-09-28';
    const second = await runImport(practice, plan, { readFile, onProgress: () => {} });
    expect(second).toMatchObject({ folders: 0, pages: 2, attachments: 1, failed: [] });
    expect(await practice.store.count('folder')).toBe(1);
    expect(await practice.store.count('page')).toBe(4);
    expect(await practice.store.count('attachment')).toBe(1);
    expect(await unfinishedJob(practice)).toBeNull();
  });

  it('stops before encrypting a document once Sala starts locking, and continues later', async () => {
    const platform = createMemoryPlatform();
    platform.fileStore.set('/in/report.pdf', new Uint8Array([7, 7, 7]));
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const blobWrites: string[] = [];
    const writeBlob = platform.blobs.write;
    platform.blobs.write = (id, bytes) => (blobWrites.push(id), writeBlob(id, bytes));
    const plan: ImportPlan = {
      id: 'job-lock', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Rui', existingId: null, suggestedId: null, include: true }],
      items: [item({ id: 'a' }), item({ id: 'doc', kind: 'attachment', name: 'report.pdf', source: '/in/report.pdf', text: '' }), item({ id: 'c' })],
    };
    // The lock lands while the document is being read.
    let locking = false;
    const readFile = async (p: string) => {
      locking = true;
      return platform.files.read(p);
    };
    await expect(runImport(practice, plan, { readFile, onProgress: () => {}, shouldStop: () => locking })).rejects.toBeInstanceOf(JobStopped);
    expect(await practice.store.count('page')).toBe(1);
    expect(await practice.store.count('attachment')).toBe(0);
    expect(blobWrites).toEqual([]);
    const saved = await unfinishedJob(practice);
    expect(saved?.items.map((i) => [i.id, i.done])).toEqual([['a', true], ['doc', false], ['c', false]]);

    locking = false;
    const rest = await runImport(practice, saved!, { readFile: (p) => platform.files.read(p), onProgress: () => {}, shouldStop: () => false });
    expect(rest).toMatchObject({ pages: 1, attachments: 1, failed: [] });
    const [att] = await practice.store.list('attachment');
    expect(await practice.readAttachment(att!)).toEqual(new Uint8Array([7, 7, 7]));
  });

  it('refuses a document larger than 200 MB without reading it', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job-big', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Rui', existingId: null, suggestedId: null, include: true }],
      items: [item({ id: 'big', kind: 'attachment', name: 'video.mp4', source: '/in/video.mp4', text: '', size: 300 * 1024 * 1024 })],
    };
    let reads = 0;
    const result = await runImport(practice, plan, { readFile: async () => (reads++, new Uint8Array(1)), onProgress: () => {} });
    expect(reads).toBe(0);
    expect(result.failed).toEqual([{ id: 'big', name: 'video.mp4', reason: 'tooLarge' }]);
    expect(await practice.store.count('attachment')).toBe(0);
  });

  it('stops when progress cannot be saved, and resumes where it stopped', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const plan: ImportPlan = {
      id: 'job3', createdAt: '', state: 'review',
      folders: [{ key: 'f1', label: 'Rui', existingId: null, suggestedId: null, include: true }],
      items: [item({ id: 'a' }), item({ id: 'b' })],
    };
    let calls = 0;
    await expect(
      runImport(practice, plan, {
        readFile: (p) => platform.files.read(p),
        onProgress: () => {
          if (++calls === 2) throw new Error('locked');
        },
      }),
    ).rejects.toThrow('locked');
    const saved = await unfinishedJob(practice);
    expect(saved?.items.map((i) => i.done)).toEqual([true, false]);
    // Write the first page again, as an interrupted run that never saved its progress would.
    saved!.items[0]!.done = false;
    await runImport(practice, saved!, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    expect(await practice.store.count('folder')).toBe(1);
    expect(await practice.store.count('page')).toBe(2);
    expect(await unfinishedJob(practice)).toBeNull();
  });

  it('imports nothing of a folder that was unticked, not even its appointments', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const ana = await practice.store.put('folder', { label: 'Ana Silva', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
    const plan: ImportPlan = {
      id: 'job4', createdAt: '', state: 'review', source: 'ics',
      folders: [{ key: 'ana', label: 'Ana Silva', existingId: ana.id, suggestedId: null, include: false }],
      items: [event({ id: 'e1', folderKey: 'ana' }), item({ id: 'p1', folderKey: 'ana' })],
    };
    const result = await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    expect(result).toMatchObject({ appointments: 0, pages: 0, failed: [] });
    expect(await practice.store.count('appointment')).toBe(0);
    expect(await practice.store.count('page')).toBe(0);
  });

  it('brings a series in with its end, skipped dates and moved date', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const ana = await practice.store.put('folder', { label: 'Ana Silva', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
    const plan: ImportPlan = {
      id: 'job5', createdAt: '', state: 'review', source: 'ics',
      folders: [{ key: 'ana', label: 'Ana Silva', existingId: ana.id, suggestedId: null, include: true }],
      items: [
        event({ id: 'series', folderKey: 'ana', details: { repeatWeeks: 1, until: '2026-12-07', exceptions: ['2026-10-12', '2026-10-26'] } }),
        event({ id: 'moved', folderKey: 'ana', details: { start_local: '2026-10-27T15:00', seriesItemId: 'series', movedFrom: 'u1' } }),
        event({ id: 'orphan', folderKey: 'ana', details: { start_local: '2026-11-03T15:00', seriesItemId: 'not-imported', movedFrom: 'u2' } }),
        event({ id: 'meeting', folderKey: null, name: 'Team meeting', details: { summary: 'Team meeting', start_local: '2026-10-07T17:00' } }),
      ],
    };
    const result = await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {} });
    expect(result).toMatchObject({ appointments: 4, failed: [] });
    expect(await practice.store.get('appointment', 'series')).toMatchObject({ folder_id: ana.id, repeat: { interval_weeks: 1, until: '2026-12-07', exceptions: ['2026-10-12', '2026-10-26'] } });
    expect(await practice.store.get('appointment', 'moved')).toMatchObject({ start_local: '2026-10-27T15:00', repeat: null, series_id: 'series' });
    expect(await practice.store.get('appointment', 'orphan')).toMatchObject({ series_id: null });
    expect(await practice.store.get('appointment', 'meeting')).toMatchObject({ folder_id: null, title: 'Team meeting' });
  });

  it('adds a patient list to an existing folder without wiping what it has', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'p', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const ana = await practice.store.put('folder', {
      label: 'Ana Silva', colour: 'coral', status: 'active', tags: ['sleep'], contact: { email: '', phone: '910000000', language: 'pt', time_zone: '' },
      cover_note: 'Referred by Dr. Costa', archived_at: null, merged_into: null,
    });
    const details: CsvDetails = { email: 'ana@example.org', phone: '', notes: 'Prefers mornings', tags: ['anxiety', 'sleep'], start: '10/01/2025' };
    const plan: ImportPlan = {
      id: 'job6', createdAt: '', state: 'review', source: 'csv',
      folders: [
        { key: 'ana', label: 'Ana Silva', existingId: ana.id, suggestedId: ana.id, include: true },
        { key: 'rui', label: 'Rui Marques', existingId: null, suggestedId: null, include: true },
      ],
      items: [
        item({ id: 'r1', kind: 'folder', folderKey: 'ana', provenance: 'csv', date: '2025-01-10', text: JSON.stringify(details) }),
        item({ id: 'r2', kind: 'folder', folderKey: 'rui', provenance: 'csv', date: '', text: JSON.stringify({ ...details, email: 'rui@example.org', notes: '' }) }),
      ],
    };
    const result = await runImport(practice, plan, { readFile: (p) => platform.files.read(p), onProgress: () => {}, startNote: (d) => `Started: ${d}` });
    expect(result).toMatchObject({ folders: 1, updated: 1, failed: [] });
    expect(await practice.store.get('folder', ana.id)).toMatchObject({
      colour: 'coral',
      tags: ['sleep', 'anxiety'],
      contact: { email: 'ana@example.org', phone: '910000000', language: 'pt' },
      cover_note: 'Referred by Dr. Costa\nStarted: 2025-01-10\nPrefers mornings',
    });
    expect(await practice.store.get('folder', plan.folders[1]!.existingId!)).toMatchObject({ label: 'Rui Marques', contact: { email: 'rui@example.org' }, cover_note: '' });
  });
});

describe('mergeFolderDetails', () => {
  it('never repeats what the cover note already says', () => {
    const folder = { contact: emptyContact(), tags: [], cover_note: 'Started: 2025-01-10\nPrefers mornings' };
    expect(mergeFolderDetails(folder, { notes: 'prefers MORNINGS' }, 'Started: 2025-01-10').cover_note).toBe('Started: 2025-01-10\nPrefers mornings');
  });
});
