import { describe, expect, it } from 'vitest';
import { parseHlc } from '../hlc';
import { SqlJsDb } from '../../platform/sqljs';
import { emptyContact, type Draft, type Page } from '../model/types';
import { ValidationError } from '../model/validate';
import { Store } from './store';

export const folderDraft = (label: string): Draft<'folder'> => ({
  label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
});

const pageDraft = (folderId: string, date: string, body = ''): Draft<'page'> => ({
  folder_id: folderId, date, time: null, duration_min: null, template: 'free', title: '', sections: { body }, process_note: '', import_provenance: null,
});

const apptDraft = (start: string, until: string | null): Draft<'appointment'> => ({
  folder_id: null, title: 'Supervision', type_id: null, start_local: start, tz: 'Europe/Lisbon', duration_min: 50,
  repeat: { interval_weeks: 1, until, exceptions: [] }, location: '', status: 'confirmed', note: '', series_id: null,
});

async function openStore() {
  return Store.open(await SqlJsDb.create());
}

/** A store whose clock only moves when the test moves it. */
async function openClockedStore(start = Date.UTC(2026, 8, 1)) {
  const clock = { ms: start };
  const store = await Store.open(await SqlJsDb.create(), { now: () => new Date(clock.ms) });
  return { store, clock };
}

const DAY = 24 * 60 * 60 * 1000;

describe('Store', () => {
  it('creates, reads, updates and tombstones records', async () => {
    const s = await openStore();
    const f = await s.put('folder', folderDraft('  Inês S. '));
    expect(f.label).toBe('Inês S.');
    const u = await s.update('folder', f.id, { tags: ['sleep', 'sleep', ' anxiety '] });
    expect(u.tags).toEqual(['sleep', 'anxiety']);
    expect(u.updated_at_hlc > f.updated_at_hlc).toBe(true);
    expect(u.created_at).toBe(f.created_at);
    await s.remove('folder', [f.id]);
    expect(await s.list('folder')).toHaveLength(0);
    const all = await s.list('folder', { includeDeleted: true });
    expect(all[0]?.deleted).toBe(true);
    expect(all[0]?.label).toBe('Inês S.');
  });

  it('searches without accents or case', async () => {
    const s = await openStore();
    await s.put('folder', folderDraft('Inês Sousa'));
    await s.put('folder', folderDraft('Rui Martins'));
    const hits = await s.list('folder', { where: 'search LIKE ?', params: ['%ines%'] });
    expect(hits.map((f) => f.label)).toEqual(['Inês Sousa']);
  });

  it('validates drafts', async () => {
    const s = await openStore();
    await expect(s.put('folder', folderDraft('   '))).rejects.toBeInstanceOf(ValidationError);
  });

  it('announces changes to subscribers', async () => {
    const s = await openStore();
    const seen: string[] = [];
    s.subscribe((kinds) => seen.push(...kinds));
    await s.put('folder', folderDraft('A'));
    expect(seen).toEqual(['folder']);
  });

  it('merges by keeping the newer version of each record', async () => {
    const a = await openStore();
    const b = await openStore();
    const f = await a.put('folder', folderDraft('Original'));
    expect(await b.merge([{ kind: 'folder', record: f }])).toBe(1);
    const newer = await b.update('folder', f.id, { label: 'Edited on B' });
    // Old copy arriving later does not overwrite the newer edit.
    expect(await b.merge([{ kind: 'folder', record: f }])).toBe(0);
    expect(await a.merge([{ kind: 'folder', record: newer }])).toBe(1);
    expect((await a.get('folder', f.id))?.label).toBe('Edited on B');
    // After observing B's stamp, A's next edit is newer than it.
    const again = await a.update('folder', f.id, { label: 'Edited on A' });
    expect(again.updated_at_hlc > newer.updated_at_hlc).toBe(true);
  });

  it('keeps a stable device and practice id across reopen', async () => {
    const db = await SqlJsDb.create();
    const s1 = await Store.open(db);
    const s2 = await Store.open(db);
    expect(s2.practiceId).toBe(s1.practiceId);
    expect(s2.hlc.device).toBe(s1.hlc.device);
  });

  it('refuses a repeating appointment that ends before it starts', async () => {
    const s = await openStore();
    await expect(s.put('appointment', apptDraft('2026-10-05T09:00', '2026-10-04'))).rejects.toBeInstanceOf(ValidationError);
    // Ending on its first date is a series of one.
    await expect(s.put('appointment', apptDraft('2026-10-05T09:00', '2026-10-05'))).resolves.toBeTruthy();
    await expect(s.put('appointment', apptDraft('2026-10-05T09:00', null))).resolves.toBeTruthy();
  });

  it('remembers which delete a tombstone belongs to, and lists recent deletes', async () => {
    const { store: s, clock } = await openClockedStore();
    const f = await s.put('folder', folderDraft('Inês S.'));
    const p1 = await s.put('page', pageDraft(f.id, '2026-09-01', 'first'));
    const p2 = await s.put('page', pageDraft(f.id, '2026-09-08', 'second'));
    const loose = await s.put('page', pageDraft(f.id, '2026-09-15', 'third'));
    clock.ms += DAY;
    const deletedAt = clock.ms;
    expect(await s.remove('page', [p1.id, p2.id], { batch: 'b1' })).toBe(2);
    expect(await s.remove('folder', [f.id], { batch: 'b1' })).toBe(1);
    // Deleting again changes nothing.
    expect(await s.remove('page', [p1.id], { batch: 'b2' })).toBe(0);
    clock.ms += 40 * DAY;
    await s.remove('page', [loose.id]);

    const recent = await s.listDeleted('page', clock.ms - 30 * DAY);
    expect(recent.map((p) => p.id)).toEqual([loose.id]);
    expect(recent[0]?.deleted_batch).toBeUndefined();

    const older = await s.listDeleted('page', 0, clock.ms - 30 * DAY);
    expect(older.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
    expect(older.every((p) => p.deleted_batch === 'b1')).toBe(true);
    expect(parseHlc(older[0]!.updated_at_hlc).ms).toBe(deletedAt);
    expect((await s.listDeleted('folder', 0))[0]?.deleted_batch).toBe('b1');
    // Live records are never listed.
    expect(await s.listDeleted('sticky', 0)).toEqual([]);
  });

  it('restores a deleted batch as it was, with a new stamp', async () => {
    const s = await openStore();
    const f = await s.put('folder', folderDraft('Inês S.'));
    const p = await s.put('page', pageDraft(f.id, '2026-09-01', 'Slept better this week.'));
    await s.remove('page', [p.id], { batch: 'b1' });
    await s.remove('folder', [f.id], { batch: 'b1' });
    const seen: string[] = [];
    s.subscribe((kinds) => seen.push(...kinds));

    const [page] = await s.restore('page', [p.id]);
    const [folder] = await s.restore('folder', [f.id]);
    expect(seen).toEqual(['page', 'folder']);
    expect(page?.sections.body).toBe('Slept better this week.');
    expect(page?.created_at).toBe(p.created_at);
    expect(folder?.label).toBe('Inês S.');

    const back = (await s.get('page', p.id)) as Page & { deleted_batch?: string };
    expect(back.deleted).toBe(false);
    expect(back.deleted_batch).toBeUndefined();
    expect(back.updated_at_hlc > p.updated_at_hlc).toBe(true);
    expect(await s.list('page')).toHaveLength(1);
    expect(await s.listDeleted('page', 0)).toEqual([]);
    // Restoring a live record does nothing.
    expect(await s.restore('page', [p.id])).toEqual([]);
  });

  it('scrubs the content of deleted records for good', async () => {
    const s = await openStore();
    const f = await s.put('folder', folderDraft('Inês S.'));
    const live = await s.put('page', pageDraft(f.id, '2026-09-01', 'still here'));
    const p = await s.put('page', { ...pageDraft(f.id, '2026-09-08', 'She spoke about her mother.'), title: 'Mother', process_note: 'private' });
    await s.remove('page', [p.id], { batch: 'tuesday-delete' });
    const [tomb] = await s.listDeleted('page', 0);
    const blank = (r: Page): Draft<'page'> => ({ ...pageDraft(r.folder_id, r.date), sections: {} });

    expect(await s.scrub('page', [p.id, live.id], blank)).toBe(1);
    const raw = await s.db.query<{ data: string; deleted: number; hlc: string; created_at: string }>('SELECT data, deleted, hlc, created_at FROM pages WHERE id = ?', [p.id]);
    expect(raw[0]?.deleted).toBe(1);
    expect(raw[0]?.created_at).toBe(p.created_at);
    // (Words that cannot appear in a random id: the record also holds the folder's uuid.)
    expect(raw[0]?.data).not.toMatch(/mother|Mother|private|tuesday-delete/);
    expect(raw[0]!.hlc > tomb!.updated_at_hlc).toBe(true);
    // The live page is untouched; the scrubbed one is neither listed nor restorable.
    expect((await s.get('page', live.id))?.sections.body).toBe('still here');
    expect(await s.listDeleted('page', 0)).toEqual([]);
    expect(await s.restore('page', [p.id])).toEqual([]);
    expect(await s.scrub('page', [p.id], blank)).toBe(0);
    // An older copy (a backup made before the delete) cannot bring the content back.
    expect(await s.merge([{ kind: 'page', record: p }, { kind: 'page', record: tomb! }])).toBe(0);
    expect((await s.get('page', p.id))?.sections.body).toBe('');
  });

  it('only scrubs to valid empties', async () => {
    const s = await openStore();
    const f = await s.put('folder', folderDraft('Rui M.'));
    await s.remove('folder', [f.id]);
    await expect(s.scrub('folder', [f.id], () => folderDraft(''))).rejects.toBeInstanceOf(ValidationError);
    expect(await s.scrub('folder', [f.id], () => folderDraft('—'))).toBe(1);
  });

  it('summarises pages per folder and reports the latest stamp', async () => {
    const s = await openStore();
    expect(await s.latestHlc()).toBeNull();
    const a = await s.put('folder', folderDraft('A'));
    const b = await s.put('folder', folderDraft('B'));
    await s.put('page', pageDraft(a.id, '2026-09-01'));
    const newest = await s.put('page', pageDraft(a.id, '2026-08-01'));
    const gone = await s.put('page', pageDraft(b.id, '2026-09-30'));
    await s.remove('page', [gone.id]);
    const groups = await s.summarise('page', 'folder_id', 'date');
    expect(groups).toEqual([{ key: a.id, count: 2, max: '2026-09-01', hlc: newest.updated_at_hlc }]);
    await expect(s.summarise('page', 'data', 'date')).rejects.toThrow();
    expect(await s.latestHlc()).toBe((await s.get('page', gone.id))?.updated_at_hlc);
  });
});
