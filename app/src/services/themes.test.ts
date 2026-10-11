import { describe, expect, it } from 'vitest';
import { emptyContact, type Draft, type Passage } from '../core/model/types';
import { validate, ValidationError } from '../core/model/validate';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { deletePage, undeletePage } from '../features/folder/pageActions';
import { KNOWN_THEMES_SETTING, knownThemes, rememberThemes, removeThemeInFolder, renameThemeInFolder, undoThemes } from './themes';
import { listTrash, purgeGroup } from './trash';

const passage = (text: string, words: string, themes: string[], section = 'body'): Passage => {
  const start = text.indexOf(words);
  return { id: `${section}:${words}`, section, start, end: start + words.length, quote: words, themes, created_at: '2026-09-28T10:00:00.000Z' };
};

const pageDraft = (folderId: string, body: string, passages: Passage[]): Draft<'page'> => ({
  folder_id: folderId, date: '2026-09-21', time: null, duration_min: null, template: 'free', title: '', sections: { body }, process_note: 'my own thoughts', import_provenance: null, passages,
});

async function setup() {
  const store = await Store.open(await SqlJsDb.create());
  const folder = await store.put('folder', { label: 'Inês S.', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
  const a = 'Slept badly. Worry about work at night.';
  const b = 'Better sleep this week. Work is calmer.';
  const p1 = await store.put('page', pageDraft(folder.id, a, [passage(a, 'Slept badly', ['sleep']), passage(a, 'Worry about work', ['worry', 'work'])]));
  const p2 = await store.put('page', pageDraft(folder.id, b, [passage(b, 'Better sleep', ['Sleep']), passage(b, 'Work is calmer', ['work'])]));
  return { store, folder, p1, p2 };
}

const themesOf = async (store: Store, id: string) => ((await store.get('page', id))!.passages ?? []).map((p) => p.themes);

describe('passages on a page', () => {
  it('are tidied when written: theme names trimmed and without repeats', () => {
    const body = 'Slept badly.';
    const clean = validate('page', pageDraft('f', body, [{ ...passage(body, 'Slept badly', []), themes: [' sleep ', 'Sleep', 'night  time'] }]));
    expect(clean.passages!.map((p) => p.themes)).toEqual([['sleep', 'night time']]);
  });

  it('go with the text of a section the page no longer has', () => {
    const clean = validate('page', { ...pageDraft('f', 'x', []), template: 'dap', sections: { data: 'Notes' }, passages: [passage('Old text', 'Old', ['a'], 'body')] });
    expect(clean.passages).toEqual([]);
  });

  it('are refused when malformed', () => {
    const body = 'Slept badly.';
    const bad = (p: Partial<Passage>) => () => validate('page', pageDraft('f', body, [{ ...passage(body, 'Slept', ['sleep']), ...p }]));
    expect(bad({ themes: [] })).toThrow(ValidationError);
    expect(bad({ themes: ['x'.repeat(61)] })).toThrow(ValidationError);
    expect(bad({ start: 5, end: 5 })).toThrow(ValidationError);
    expect(bad({ quote: '' })).toThrow(ValidationError);
    expect(() => validate('page', pageDraft('f', body, [passage(body, 'Slept', ['a']), passage(body, 'Slept', ['b'])]))).toThrow(ValidationError);
  });

  it('come back with their page after a delete, and are erased with it', async () => {
    const { store, p1 } = await setup();
    const deleted = await deletePage(store, p1.id);
    await undeletePage(store, deleted);
    expect(await themesOf(store, p1.id)).toEqual([['sleep'], ['worry', 'work']]);

    await deletePage(store, p1.id);
    const [group] = await listTrash(store);
    await purgeGroup({ store, platform: { blobs: { read: async () => new Uint8Array(), write: async () => undefined, remove: async () => undefined } } }, group!);
    const erased = await store.get('page', p1.id);
    expect(erased!.passages).toEqual([]);
    expect(JSON.stringify(erased)).not.toContain('Worry about work');
  });
});

describe('folder-wide theme changes', () => {
  it('rename a theme on every page, merging it with one already there, and undo', async () => {
    const { store, folder, p1, p2 } = await setup();
    const undo = await renameThemeInFolder(store, folder.id, 'sleep', 'insomnia');
    expect(await themesOf(store, p1.id)).toEqual([['insomnia'], ['worry', 'work']]);
    expect(await themesOf(store, p2.id)).toEqual([['insomnia'], ['work']]);
    expect((await knownThemes(store))[0]).toBe('insomnia');

    await renameThemeInFolder(store, folder.id, 'worry', 'Work');
    expect(await themesOf(store, p1.id)).toEqual([['insomnia'], ['Work']]);

    await undoThemes(store, undo);
    expect(await themesOf(store, p2.id)).toEqual([['Sleep'], ['work']]);
  });

  it('remove a theme without touching the text, and undo', async () => {
    const { store, folder, p1, p2 } = await setup();
    const undo = await removeThemeInFolder(store, folder.id, 'work');
    expect(await themesOf(store, p1.id)).toEqual([['sleep'], ['worry']]);
    expect(await themesOf(store, p2.id)).toEqual([['Sleep']]);
    expect((await store.get('page', p2.id))!.sections.body).toBe('Better sleep this week. Work is calmer.');
    expect(undo.before.map((b) => b.pageId).sort()).toEqual([p1.id, p2.id].sort());

    // Edited since: Undo puts the marks back on their words.
    await store.update('page', p2.id, { sections: { body: 'Note. Better sleep this week. Work is calmer.' } });
    await undoThemes(store, undo);
    const back = (await store.get('page', p2.id))!;
    expect(back.passages!.map((p) => back.sections.body!.slice(p.start, p.end))).toEqual(['Better sleep', 'Work is calmer']);
  });

  it('leave other folders alone', async () => {
    const { store, folder } = await setup();
    const other = await store.put('folder', { label: 'Rui', colour: 'blue', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
    const p = await store.put('page', pageDraft(other.id, 'Sleep diary.', [passage('Sleep diary.', 'Sleep diary', ['sleep'])]));
    await removeThemeInFolder(store, folder.id, 'sleep');
    expect(await themesOf(store, p.id)).toEqual([['sleep']]);
  });
});

describe('known themes', () => {
  it('keeps the most recently used first, once each', async () => {
    const store = await Store.open(await SqlJsDb.create());
    expect(await knownThemes(store)).toEqual([]);
    await rememberThemes(store, ['sleep', 'work']);
    await rememberThemes(store, ['grief', 'Sleep']);
    expect(await knownThemes(store)).toEqual(['grief', 'Sleep', 'work']);
  });

  it('ignores a setting that is not a list of names', async () => {
    const store = await Store.open(await SqlJsDb.create());
    await store.put('setting', { id: KNOWN_THEMES_SETTING, value: 'oops' });
    expect(await knownThemes(store)).toEqual([]);
  });
});
