import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildSalaZip, type ExportRecord } from '../core/export/sala';
import { emptyContact, KINDS, type Draft, type Entity, type Kind } from '../core/model/types';
import { validate } from '../core/model/validate';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { PlatformError } from '../platform/types';
import { blankRecord, eraseUnused, groupCounts, listTrash, purgeExpired, purgeGroup, restoreGroup } from './trash';

const DAY = 24 * 60 * 60 * 1000;

async function setup() {
  const clock = { ms: Date.UTC(2026, 8, 1, 9) };
  const db = await SqlJsDb.create();
  const store = await Store.open(db, { now: () => new Date(clock.ms) });
  const blobs = new Map<string, Uint8Array>();
  const platform = {
    blobs: {
      write: async (id: string, b: Uint8Array) => void blobs.set(id, b),
      read: async (id: string) => {
        const b = blobs.get(id);
        if (!b) throw new PlatformError('NOT_FOUND', id);
        return b;
      },
      remove: async (id: string) => void blobs.delete(id),
    },
  };
  return { clock, db, store, blobs, host: { store, platform } };
}

const folderDraft = (label: string): Draft<'folder'> => ({
  label, colour: 'teal', status: 'active', tags: ['sleep'], contact: { ...emptyContact(), phone: '912 345 678' }, cover_note: 'Referred by Dr. Costa',
  archived_at: null, merged_into: null,
});

async function folderWithContent(s: Store, blobs: Map<string, Uint8Array>, label = 'Inês Sousa') {
  const f = await s.put('folder', folderDraft(label));
  const p1 = await s.put('page', { folder_id: f.id, date: '2026-08-31', time: '09:00', duration_min: 50, template: 'dap', title: 'First', sections: { data: 'Talked about her mother' }, process_note: 'secret thoughts', import_provenance: null });
  const p2 = await s.put('page', { folder_id: f.id, date: '2026-08-24', time: null, duration_min: null, template: 'free', title: '', sections: { body: 'Sleeps badly' }, process_note: '', import_provenance: null });
  const st = await s.put('sticky', { folder_id: f.id, page_id: null, text: 'Ask about the diary', colour: 'yellow', next_session: true, origin: 'therapist', state: 'stuck', peeled_at: null });
  blobs.set('blob-1', new Uint8Array([1, 2, 3]));
  const att = await s.put('attachment', { folder_id: f.id, page_id: p1.id, filename: 'referral letter.pdf', mime: 'application/pdf', size: 3, blob_id: 'blob-1', sha256: 'abc', local_only: false, source: 'upload', ocr_text: 'Dear colleague' });
  return { f, p1, p2, st, att };
}

async function deleteFolder(s: Store, ids: Awaited<ReturnType<typeof folderWithContent>>, batch: string) {
  await s.remove('folder', [ids.f.id], { batch });
  await s.remove('page', [ids.p1.id, ids.p2.id], { batch });
  await s.remove('sticky', [ids.st.id], { batch });
  await s.remove('attachment', [ids.att.id], { batch });
}

async function dataFiles(s: Store): Promise<string> {
  const records: ExportRecord[] = [];
  for await (const r of s.all()) records.push(r);
  const zip = await buildSalaZip(records, {
    appVersion: 't', practiceId: s.practiceId, includeProcessNotes: true, readAttachment: async () => null,
    labels: { sectionTitle: (t, k) => k, neutralAppointment: 'A', stickyHeading: 'S', themesHeading: 'T', processNoteHeading: 'P', readme: '' },
  });
  const files = unzipSync(zip);
  return Object.entries(files).filter(([p]) => p.startsWith('data/')).map(([, b]) => strFromU8(b)).join('\n');
}

describe('Recently deleted', () => {
  it('groups a deleted folder with its pages, notes and documents, named after the folder', async () => {
    const { store, blobs, clock } = await setup();
    const ids = await folderWithContent(store, blobs);
    clock.ms += DAY;
    await deleteFolder(store, ids, 'batch-1');
    clock.ms += DAY;
    await store.remove('page', [(await store.put('page', { folder_id: (await store.put('folder', folderDraft('Rui'))).id, date: '2026-09-01', time: null, duration_min: null, template: 'free', title: '', sections: { body: 'x' }, process_note: '', import_provenance: null })).id]);

    const groups = await listTrash(store, clock.ms);
    expect(groups).toHaveLength(2);
    // Newest delete first: the single page, then the folder's batch.
    expect(groups[0]!.lead.kind).toBe('page');
    const folderGroup = groups[1]!;
    expect(folderGroup.lead.kind).toBe('folder');
    expect(folderGroup.items).toHaveLength(5);
    expect(groupCounts(folderGroup)).toEqual({ page: 2, sticky: 1, attachment: 1 });
  });

  it('restores the whole batch of a deleted folder', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    await deleteFolder(store, ids, 'batch-1');
    clock.ms += DAY;
    const [group] = await listTrash(store, clock.ms);
    expect(await restoreGroup(host, group!)).toEqual({ restored: 5, failed: 0, erased: 0 });
    expect((await store.list('folder')).map((f) => f.label)).toEqual(['Inês Sousa']);
    expect(await store.count('page')).toBe(2);
    expect(await store.count('sticky')).toBe(1);
    expect(await store.count('attachment')).toBe(1);
    expect(await listTrash(store, clock.ms)).toEqual([]);
  });

  it('brings back a page’s deleted folder with the page', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    await store.remove('page', [ids.p2.id], { batch: 'page-only' });
    await store.remove('folder', [ids.f.id], { batch: 'folder-later' });
    const groups = await listTrash(store, clock.ms);
    const pageGroup = groups.find((g) => g.key === 'page-only')!;
    await restoreGroup(host, pageGroup);
    expect((await store.get('page', ids.p2.id))?.deleted).toBe(false);
    expect((await store.get('folder', ids.f.id))?.deleted).toBe(false);
  });

  it('does not bring a page back into a folder erased for good, and erases it too', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    // The page and its document are deleted on their own, then the folder, erased with Delete now.
    await store.remove('page', [ids.p1.id], { batch: 'page-only' });
    await store.remove('attachment', [ids.att.id], { batch: 'page-only' });
    clock.ms += 60_000;
    await store.remove('folder', [ids.f.id], { batch: 'folder-later' });
    await store.remove('page', [ids.p2.id], { batch: 'folder-later' });
    await store.remove('sticky', [ids.st.id], { batch: 'folder-later' });
    await purgeGroup(host, (await listTrash(store, clock.ms)).find((g) => g.key === 'folder-later')!);

    const pageGroup = (await listTrash(store, clock.ms)).find((g) => g.key === 'page-only')!;
    expect(await restoreGroup(host, pageGroup)).toEqual({ restored: 0, failed: 2, erased: 2 });
    const page = await store.get('page', ids.p1.id);
    expect(page?.deleted).toBe(true);
    expect(JSON.stringify(page)).not.toMatch(/mother|secret thoughts/);
    expect((await store.get('attachment', ids.att.id))?.deleted).toBe(true);
    expect(blobs.has('blob-1')).toBe(false);
    expect(await store.count('page')).toBe(0);
    expect(await listTrash(store, clock.ms)).toEqual([]);
  });

  it('leaves a folder deleted on its own deleted when nothing that comes back needs it', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    const note = await store.put('sticky', { folder_id: ids.f.id, page_id: ids.p2.id, text: 'On the page', colour: 'yellow', next_session: false, origin: 'therapist', state: 'stuck', peeled_at: null });
    await store.remove('sticky', [note.id], { batch: 'note-only' });
    clock.ms += 1000;
    await store.remove('page', [ids.p2.id], { batch: 'page-only' });
    await purgeGroup(host, (await listTrash(store, clock.ms)).find((g) => g.key === 'page-only')!);
    clock.ms += 1000;
    await store.remove('folder', [ids.f.id], { batch: 'folder-later' });

    const noteGroup = (await listTrash(store, clock.ms)).find((g) => g.key === 'note-only')!;
    expect(await restoreGroup(host, noteGroup)).toEqual({ restored: 0, failed: 1, erased: 1 });
    expect((await store.get('folder', ids.f.id))?.deleted).toBe(true);
    expect((await listTrash(store, clock.ms)).map((g) => g.key)).toEqual(['folder-later']);
  });

  it('leaves the page of a document whose file is gone deleted', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    await store.remove('attachment', [ids.att.id], { batch: 'document-only' });
    clock.ms += 1000;
    await store.remove('page', [ids.p1.id], { batch: 'page-later' });
    blobs.delete('blob-1');

    const group = (await listTrash(store, clock.ms)).find((g) => g.key === 'document-only')!;
    expect(await restoreGroup(host, group)).toEqual({ restored: 0, failed: 1, erased: 1 });
    expect((await store.get('page', ids.p1.id))?.deleted).toBe(true);
  });

  it('brings back the page a note was on, and that page’s folder, both deleted on their own', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    const note = await store.put('sticky', { folder_id: ids.f.id, page_id: ids.p2.id, text: 'On the page', colour: 'yellow', next_session: false, origin: 'therapist', state: 'stuck', peeled_at: null });
    await store.remove('sticky', [note.id], { batch: 'note-only' });
    clock.ms += 1000;
    await store.remove('page', [ids.p2.id], { batch: 'page-only' });
    clock.ms += 1000;
    await store.remove('folder', [ids.f.id], { batch: 'folder-later' });

    const noteGroup = (await listTrash(store, clock.ms)).find((g) => g.key === 'note-only')!;
    // Only the note counts: the page and folder came back for it, unasked.
    expect(await restoreGroup(host, noteGroup)).toEqual({ restored: 1, failed: 0, erased: 0 });
    expect((await store.get('page', ids.p2.id))?.deleted).toBe(false);
    expect((await store.get('folder', ids.f.id))?.deleted).toBe(false);
  });

  it('leaves a folder deleted on its own deleted when what needed it cannot come back', async () => {
    const { db, store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    const appt = await store.put('appointment', {
      folder_id: ids.f.id, title: '', type_id: null, start_local: '2026-09-10T09:00', tz: 'Europe/Lisbon', duration_min: 50,
      repeat: { interval_weeks: 1, until: null, exceptions: [] }, location: '', status: 'confirmed', note: '', series_id: null,
    });
    // Saved by an older Sala: a repeat that ends before it starts, which today's checks refuse.
    await db.exec(`UPDATE appointments SET data = json_set(data, '$.repeat.until', '2026-09-01') WHERE id = ?`, [appt.id]);
    await store.remove('appointment', [appt.id], { batch: 'appointment-only' });
    clock.ms += 1000;
    await deleteFolder(store, ids, 'folder-later');

    const group = (await listTrash(store, clock.ms)).find((g) => g.key === 'appointment-only')!;
    expect(await restoreGroup(host, group)).toEqual({ restored: 0, failed: 1, erased: 0 });
    expect((await store.get('appointment', appt.id))?.deleted).toBe(true);
    expect((await store.get('folder', ids.f.id))?.deleted).toBe(true);
    expect((await listTrash(store, clock.ms)).map((g) => g.key).sort()).toEqual(['appointment-only', 'folder-later']);
  });

  it('says what could not come back, and erases a document whose file is gone', async () => {
    const { store, blobs, clock, host } = await setup();
    const ids = await folderWithContent(store, blobs);
    // An older Sala removed a deleted document's file at once.
    await deleteFolder(store, ids, 'batch-1');
    blobs.delete('blob-1');
    const [group] = await listTrash(store, clock.ms);
    expect(await restoreGroup(host, group!)).toEqual({ restored: 4, failed: 1, erased: 1 });
    expect(await store.count('page')).toBe(2);
    expect(await listTrash(store, clock.ms)).toEqual([]);
  });

  it('never lists what Sala took away on its own, such as a new page left empty', async () => {
    const { store, clock } = await setup();
    const f = await store.put('folder', folderDraft('Rui'));
    const p = await store.put('page', { folder_id: f.id, date: '2026-09-01', time: null, duration_min: null, template: 'free', title: '', sections: {}, process_note: '', import_provenance: null });
    await eraseUnused(store, 'page', [p.id]);
    expect((await store.get('page', p.id))?.deleted).toBe(true);
    expect(await listTrash(store, clock.ms)).toEqual([]);
  });

  it('lists items deleted without a batch one by one', async () => {
    const { store, blobs, clock } = await setup();
    const ids = await folderWithContent(store, blobs);
    await store.remove('sticky', [ids.st.id]);
    const [g] = await listTrash(store, clock.ms);
    expect(g!.key).toBe(ids.st.id);
    expect(g!.lead.record).toMatchObject({ text: 'Ask about the diary' });
  });
});

describe('erasing deleted items', () => {
  it('leaves valid empties for every kind', () => {
    for (const kind of KINDS) {
      for (const folder_id of [null, 'f1']) {
        const record = { id: 'x', created_at: '', updated_at_hlc: '', deleted: true, folder_id } as unknown as Entity<Kind>;
        expect(() => validate(kind, blankRecord(kind, record) as Draft<Kind>), kind).not.toThrow();
      }
    }
  });

  it('erases items deleted more than 30 days ago and keeps younger ones', async () => {
    const { store, blobs, clock, host } = await setup();
    const old = await folderWithContent(store, blobs, 'Old Patient');
    blobs.set('blob-2', new Uint8Array([9]));
    const young = await folderWithContent(store, blobs, 'Young Patient');
    await store.update('attachment', young.att.id, { blob_id: 'blob-2' });
    await deleteFolder(store, old, 'old');
    clock.ms += 20 * DAY;
    await deleteFolder(store, young, 'young');
    clock.ms += 15 * DAY; // old: 35 days ago; young: 15 days ago

    expect(await purgeExpired(host, clock.ms)).toBe(5);
    const groups = await listTrash(store, clock.ms);
    expect(groups.map((g) => g.key)).toEqual(['young']);
    expect(blobs.has('blob-1')).toBe(false);
    expect(blobs.has('blob-2')).toBe(true);

    // Nothing of the erased folder is left anywhere in a backup's records: each phrase is
    // there once, in the younger folder, which is still in Recently deleted.
    const data = await dataFiles(store);
    expect(data).not.toContain('Old Patient');
    for (const phrase of ['Talked about her mother', 'secret thoughts', 'Ask about the diary', 'referral letter', 'Dear colleague', '912 345 678', 'Dr. Costa']) {
      expect(data.split(phrase).length - 1, phrase).toBe(1);
    }
    // The erased folder is still marked deleted, so an older copy merged later stays deleted.
    const tomb = await store.get('folder', old.f.id);
    expect(tomb).toMatchObject({ deleted: true, label: '—' });
    expect(await store.merge([{ kind: 'folder', record: { ...old.f } }])).toBe(0);
  });

  it('Delete now erases one group at once', async () => {
    const { store, blobs, host, clock } = await setup();
    const ids = await folderWithContent(store, blobs);
    await deleteFolder(store, ids, 'b');
    const [g] = await listTrash(store, clock.ms);
    expect(await purgeGroup(host, g!)).toBe(5);
    expect(await listTrash(store, clock.ms)).toEqual([]);
    expect(blobs.size).toBe(0);
    expect(await dataFiles(store)).not.toMatch(/Inês|mother|secret|diary|referral|colleague/);
  });

  it('keeps a document’s file that another record still uses', async () => {
    const { store, blobs, host, clock } = await setup();
    const ids = await folderWithContent(store, blobs);
    const copy = await store.put('attachment', { folder_id: ids.f.id, page_id: null, filename: 'copy.pdf', mime: 'application/pdf', size: 3, blob_id: 'blob-1', sha256: 'abc', local_only: false, source: 'upload', ocr_text: null });
    await store.remove('attachment', [ids.att.id]);
    const [g] = await listTrash(store, clock.ms);
    await purgeGroup(host, g!);
    expect(blobs.has('blob-1')).toBe(true);
    expect((await store.get('attachment', copy.id))?.deleted).toBe(false);
  });

  it('leaves a document for the next try when its file cannot be removed', async () => {
    const { store, blobs, host, clock } = await setup();
    const ids = await folderWithContent(store, blobs);
    await store.remove('attachment', [ids.att.id]);
    host.platform.blobs.remove = async () => {
      throw new Error('busy');
    };
    const [g] = await listTrash(store, clock.ms);
    expect(await purgeGroup(host, g!)).toBe(0);
    expect((await listTrash(store, clock.ms)).length).toBe(1);
  });
});
