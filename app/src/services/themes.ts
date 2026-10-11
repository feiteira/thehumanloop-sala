import { dropTheme, renameTheme, settle, uniqueThemes } from '../core/model/passages';
import type { Base, Draft, Page, Passage } from '../core/model/types';
import type { Store } from '../core/store/store';
import { getSetting, setSetting } from './settings';

// Themes across the practice: the names used so far (offered when marking words in any
// folder), and folder-wide changes to a theme, each of which can be undone.

/** Theme names used in the practice, the most recently used first. */
export const KNOWN_THEMES_SETTING = 'themes.known';
const KNOWN_MAX = 300;

export async function knownThemes(store: Store): Promise<string[]> {
  const names = await getSetting<unknown>(store, KNOWN_THEMES_SETTING, []);
  return Array.isArray(names) ? uniqueThemes(names.filter((n): n is string => typeof n === 'string')) : [];
}

/** Puts `names` first among the practice's known themes. */
export async function rememberThemes(store: Store, names: readonly string[]): Promise<void> {
  const known = await knownThemes(store);
  const next = uniqueThemes([...names, ...known]).slice(0, KNOWN_MAX);
  if (next.length === known.length && next.every((n, i) => n === known[i])) return;
  await setSetting(store, KNOWN_THEMES_SETTING, next);
}

/** The folder's pages' passages as they were before a folder-wide change, for Undo. */
export interface ThemesUndo {
  before: { pageId: string; passages: Passage[] }[];
}

async function changeEachPage(store: Store, folderId: string, change: (passages: Passage[]) => Passage[] | null): Promise<ThemesUndo> {
  const pages = await store.list('page', { where: 'folder_id = ?', params: [folderId] });
  const before: ThemesUndo['before'] = [];
  const writes: { kind: 'page'; draft: Draft<'page'> }[] = [];
  for (const page of pages) {
    const passages = page.passages ?? [];
    const next = change(passages);
    if (!next) continue;
    before.push({ pageId: page.id, passages });
    writes.push({ kind: 'page', draft: { ...draftOf(page), passages: next } });
  }
  if (writes.length) await store.putMany(writes);
  return { before };
}

/** Calls the theme `from` `to` on every page of the folder; where `to` is already a theme there, the two become one. */
export async function renameThemeInFolder(store: Store, folderId: string, from: string, to: string): Promise<ThemesUndo> {
  const undo = await changeEachPage(store, folderId, (passages) => renameTheme(passages, from, to));
  if (undo.before.length) await rememberThemes(store, [to]);
  return undo;
}

/** Takes the theme off every page of the folder; words left with no theme lose their mark. The text is not touched. */
export function removeThemeInFolder(store: Store, folderId: string, name: string): Promise<ThemesUndo> {
  return changeEachPage(store, folderId, (passages) => dropTheme(passages, name));
}

/** Puts the passages back as they were. A page deleted since is left alone; one edited since keeps its marks on their words. */
export async function undoThemes(store: Store, undo: ThemesUndo): Promise<void> {
  const writes: { kind: 'page'; draft: Draft<'page'> }[] = [];
  for (const { pageId, passages } of undo.before) {
    const page = await store.get('page', pageId);
    if (!page || page.deleted) continue;
    writes.push({ kind: 'page', draft: { ...draftOf(page), passages: settle(page.sections, passages) } });
  }
  if (writes.length) await store.putMany(writes);
}

function draftOf(page: Page): Draft<'page'> {
  const { created_at: _c, updated_at_hlc: _h, deleted: _d, ...rest } = page as Page & Base;
  return rest;
}
