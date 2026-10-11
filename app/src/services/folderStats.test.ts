import { describe, expect, it } from 'vitest';
import { emptyContact, type Draft } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { folderStats } from './folderStats';

const folder = (label: string): Draft<'folder'> => ({
  label, colour: 'sage', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
});
const page = (folderId: string, date: string): Draft<'page'> => ({
  folder_id: folderId, date, time: null, duration_min: null, template: 'free', title: '', sections: { body: '' }, process_note: '', import_provenance: null,
});

describe('folderStats', () => {
  it('counts live pages per folder, with the latest session date and the latest write', async () => {
    const store = await Store.open(await SqlJsDb.create());
    const ines = await store.put('folder', folder('Inês S.'));
    const rui = await store.put('folder', folder('Rui M.'));
    const empty = await store.put('folder', folder('Ana P.'));
    await store.put('page', page(ines.id, '2026-09-21'));
    const old = await store.put('page', page(ines.id, '2026-09-07'));
    const deleted = await store.put('page', page(ines.id, '2026-09-28'));
    await store.remove('page', [deleted.id]);
    await store.put('page', page(rui.id, '2026-08-30'));
    // Editing an older page makes it the latest write, not the latest session.
    const edited = await store.update('page', old.id, { title: 'Follow-up' });

    const stats = await folderStats(store);
    expect(stats.get(ines.id)).toEqual({ pages: 2, lastPageDate: '2026-09-21', lastPageHlc: edited.updated_at_hlc });
    expect(stats.get(rui.id)).toMatchObject({ pages: 1, lastPageDate: '2026-08-30' });
    expect(stats.has(empty.id)).toBe(false);
  });

  it('leaves a page written ahead for a coming session out of the last session date', async () => {
    const store = await Store.open(await SqlJsDb.create());
    const ines = await store.put('folder', folder('Inês S.'));
    const rui = await store.put('folder', folder('Rui M.'));
    await store.put('page', page(ines.id, '2026-09-14'));
    await store.put('page', page(ines.id, '2026-09-28'));
    await store.put('page', page(rui.id, '2026-10-05'));

    const stats = await folderStats(store, '2026-09-21');
    expect(stats.get(ines.id)).toMatchObject({ pages: 2, lastPageDate: '2026-09-14' });
    expect(stats.get(rui.id)).toMatchObject({ pages: 1, lastPageDate: null });
    expect((await folderStats(store, '2026-09-28')).get(ines.id)?.lastPageDate).toBe('2026-09-28');
  });
});
