import type { Attachment, Folder, Page, Sticky } from '../core/model/types';
import type { Store } from '../core/store/store';
import { fold } from '../core/text/normalize';

// Finding things across the practice: one query, every word must be found (in any order),
// accents and capitals ignored, each at the start of a word ("ana" finds Ana, not "semana"). A folder matches through its own details (name, tags, cover
// note, email, phone digits, sticky notes); a page or a document matches through its text,
// and the words may be split between the folder and the page ("ana sleep" finds Ana's pages
// about sleep). Results come grouped by folder, labelled with the folder's name.

/** A short piece of text with the found words marked: [start, end) ranges into `text`. */
export interface Excerpt {
  text: string;
  marks: [number, number][];
}

export interface PageHit {
  page: Page;
  excerpt: Excerpt;
}

export interface DocumentHit {
  attachment: Attachment;
  /** The file name, with any found words marked. */
  name: Excerpt;
  /** Recognised text around the found words, when the words are in it. */
  text: Excerpt | null;
}

export type FolderField = 'label' | 'tag' | 'cover' | 'email' | 'phone' | 'sticky';

export interface FolderResult {
  folder: Folder;
  /** Every word was found in the folder's own details. */
  direct: boolean;
  /**
   * How well the folder matches, best first: 0 its name starts with one of the words, 1 its name
   * holds them all, 2 its other details do, 3 only its pages or documents do.
   */
  rank: number;
  /** For a direct match that is not in the name alone: the detail that matched, to show under it. */
  detail: { field: FolderField; excerpt: Excerpt } | null;
  /** Pages that match, newest session first. */
  pages: PageHit[];
  documents: DocumentHit[];
}

export interface SearchResults {
  /** The words searched for, folded. Empty for a blank query, which lists every folder. */
  tokens: string[];
  /** Folders on the side of the shelf asked for (active or archive), best match first. */
  folders: FolderResult[];
  /** How many folders on the other side (the archive, or the active folders) match too. */
  elsewhere: number;
}

export interface SearchOptions {
  /** Search the archive instead of the active folders. */
  archived?: boolean;
  /** At most this many pages are read (newest first). */
  pageLimit?: number;
  documentLimit?: number;
}

/** The words of a query: folded, without a tag's "#" or surrounding quotes and punctuation. */
export function tokenize(q: string): string[] {
  const words = fold(q)
    .split(' ')
    .map((w) => w.replace(/^[#"'“”‘’«»([{]+/, '').replace(/[,;:"'“”‘’«»)\]}.!?]+$/, ''))
    .filter(Boolean);
  return [...new Set(words)];
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * Where `token` begins a word in the folded `hay`, from `from` on, or -1. A word begins after
 * anything that is not a letter or a digit; a token that itself starts with one ("@ex", "+351")
 * may be found anywhere.
 */
export function findWord(hay: string, token: string, from = 0): number {
  const anywhere = !WORD.test(token[0] ?? '');
  for (let i = hay.indexOf(token, from); i >= 0; i = hay.indexOf(token, i + 1)) {
    if (anywhere || i === 0 || !WORD.test(hay[i - 1]!)) return i;
  }
  return -1;
}

const hasWord = (hay: string, token: string) => findWord(hay, token) >= 0;

/** Digits of a word that looks like part of a phone number ("+351", "912-345"), else null. */
function phoneDigits(token: string): string | null {
  if (!/^\+?[\d().\-/]+$/.test(token)) return null;
  const digits = token.replace(/\D/g, '');
  return digits.length >= 3 ? digits : null;
}

/**
 * `s` folded character by character, remembering where each folded character came from, so
 * matches found in the folded text can be marked in the original. Whitespace becomes one
 * space per character (words never contain spaces, so matching is as with `fold`).
 */
function foldChars(s: string): { folded: string; from: number[]; to: number[] } {
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!);
    const f = /\s/.test(ch) ? ' ' : fold(ch);
    for (let k = 0; k < f.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    folded += f;
    i += ch.length;
  }
  return { folded, from, to };
}

/**
 * Up to `width` characters of `source` around the first of the words, cut at word edges,
 * with every occurrence of the words marked. Without any of the words, the start of the text.
 */
export function makeExcerpt(source: string, tokens: string[], width = 140, before = 40): Excerpt {
  const s = source.replace(/\s+/g, ' ').trim();
  const { folded, from, to } = foldChars(s);
  const hits: [number, number][] = [];
  for (const t of tokens) {
    if (!t) continue;
    for (let i = findWord(folded, t); i >= 0; i = findWord(folded, t, i + t.length)) hits.push([from[i]!, to[i + t.length - 1]!]);
  }
  if (!hits.length) return { text: s.length > width ? `${s.slice(0, width).trimEnd()}…` : s, marks: [] };
  const first = Math.min(...hits.map((h) => h[0]));
  let start = Math.max(0, first - before);
  if (start > 0) {
    const sp = s.indexOf(' ', start);
    if (sp >= 0 && sp < first) start = sp + 1;
  }
  let end = Math.min(s.length, start + width);
  if (end < s.length) {
    const sp = s.lastIndexOf(' ', end);
    if (sp > first) end = sp;
  }
  const prefix = start > 0 ? '…' : '';
  const text = `${prefix}${s.slice(start, end)}${end < s.length ? '…' : ''}`;
  const shift = prefix.length - start;
  const marks = hits
    .filter(([a, b]) => b > start && a < end)
    .map(([a, b]): [number, number] => [Math.max(a, start) + shift, Math.min(b, end) + shift])
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  return { text, marks: merged };
}

/** Whether every word is found in `text`, each at the start of a word (accents and capitals ignored). */
export function matchesAll(text: string, tokens: string[]): boolean {
  const hay = fold(text);
  return tokens.every((t) => hasWord(hay, t));
}

interface FolderHay {
  folder: Folder;
  fields: { field: FolderField; text: string; folded: string }[];
  phone: string;
  /** Indexes of the words found in the folder's own details. */
  found: Set<number>;
}

function folderHay(folder: Folder, stickies: Sticky[], tokens: string[]): FolderHay {
  const fields: FolderHay['fields'] = [];
  const add = (field: FolderField, text: string) => {
    if (text.trim()) fields.push({ field, text, folded: fold(text) });
  };
  add('label', folder.label);
  add('tag', folder.tags.map((t) => `#${t}`).join(' '));
  add('cover', folder.cover_note);
  add('email', folder.contact.email);
  add('phone', folder.contact.phone);
  for (const s of stickies) add('sticky', s.text);
  const phone = folder.contact.phone.replace(/\D/g, '');
  const found = new Set<number>();
  tokens.forEach((t, i) => fields.some((f) => fieldHas(f, t, phone)) && found.add(i));
  return { folder, fields, phone, found };
}

/** Whether a word is in one of a folder's details (phone numbers by their digits too). */
function fieldHas(f: FolderHay['fields'][number], t: string, phone: string): boolean {
  if (hasWord(f.folded, t)) return true;
  const digits = f.field === 'phone' ? phoneDigits(t) : null;
  return !!digits && phone.includes(digits);
}

/** The detail to show under a folder found outside its name: the field holding most of the words. */
function detailOf(h: FolderHay, tokens: string[]): FolderResult['detail'] {
  const label = h.fields.find((f) => f.field === 'label');
  const rest = tokens.filter((t) => !label || !hasWord(label.folded, t));
  if (!rest.length) return null;
  let best: { field: FolderField; text: string; n: number } | null = null;
  for (const f of h.fields) {
    if (f.field === 'label') continue;
    const n = rest.filter((t) => fieldHas(f, t, h.phone)).length;
    if (n && (!best || n > best.n)) best = { field: f.field, text: f.text, n };
  }
  if (!best) return null;
  return { field: best.field, excerpt: makeExcerpt(best.text, tokens, 90, 30) };
}

const globArg = (t: string) => t.replace(/[*?[]/g, (m) => `[${m}]`);

/**
 * SQL for "the item's text has `t` at the start of a word". The search column is folded, so a
 * word starts at the beginning or after anything but a-z and 0-9; TypeScript checks again.
 */
function wordSql(t: string, params: string[]): string {
  const g = globArg(t);
  if (!WORD.test(t[0] ?? '')) {
    params.push(`*${g}*`);
    return 'search GLOB ?';
  }
  params.push(`${g}*`, `*[^a-z0-9]${g}*`);
  return '(search GLOB ? OR search GLOB ?)';
}
/** Above this many folders, a word found in folders is checked in TypeScript, not in SQL. */
const MAX_IDS = 400;

/**
 * The SQL condition for pages or documents worth reading: at least one word in the item, and
 * each word either in the item or in its folder's details. The final check is done again in
 * TypeScript; this only keeps the read small.
 */
function itemWhere(tokens: string[], hays: FolderHay[]): { where: string; params: string[] } {
  const params: string[] = [];
  const any = tokens.map((t) => wordSql(t, params));
  const each: string[] = [];
  tokens.forEach((t, i) => {
    const ids = hays.filter((h) => h.found.has(i)).map((h) => h.folder.id);
    if (ids.length > MAX_IDS) return;
    const word = wordSql(t, params);
    params.push(...ids);
    each.push(ids.length ? `(${word} OR folder_id IN (${ids.map(() => '?').join(', ')}))` : word);
  });
  return { where: [`(${any.join(' OR ')})`, ...each].join(' AND '), params };
}

/** Indexes of the words found in an item's text, or null when the item does not match. */
function itemMatch(text: string, tokens: string[], folder: FolderHay): Set<number> | null {
  const hay = fold(text);
  const own = new Set<number>();
  tokens.forEach((t, i) => hasWord(hay, t) && own.add(i));
  if (!own.size) return null;
  return tokens.every((_, i) => own.has(i) || folder.found.has(i)) ? own : null;
}

const pageText = (p: Page) => [p.title, ...Object.values(p.sections)].filter((s) => s.trim()).join(' · ');

/** Named by the words, the name starting with one of them first; then other details; then notes. */
function rankOf(folder: Folder, direct: boolean, tokens: string[]): number {
  if (!direct) return 3;
  const label = fold(folder.label);
  if (!tokens.every((t) => hasWord(label, t))) return 2;
  return tokens.some((t) => label.startsWith(t)) ? 0 : 1;
}

const latestHit = (r: FolderResult) => r.pages[0]?.page.date ?? '';

/**
 * Searches folders, pages and documents. A blank query lists every folder on that side of the
 * shelf. Merged and deleted folders, and private process notes, are never searched.
 */
export async function searchAll(store: Store, q: string, opts: SearchOptions = {}): Promise<SearchResults> {
  const status = opts.archived ? 'archived' : 'active';
  const tokens = tokenize(q);
  const all = (await store.list('folder')).filter((f) => !f.merged_into);
  if (!tokens.length) {
    const folders = all.filter((f) => f.status === status).map((folder) => ({ folder, direct: true, rank: 0, detail: null, pages: [], documents: [] }));
    return { tokens, folders, elsewhere: 0 };
  }

  const stickies = await store.list('sticky', { where: "state = 'stuck'", order: 'created_at' });
  const byFolder = new Map<string, Sticky[]>();
  for (const s of stickies) byFolder.set(s.folder_id, [...(byFolder.get(s.folder_id) ?? []), s]);
  const hays = all.map((f) => folderHay(f, byFolder.get(f.id) ?? [], tokens));
  const hayById = new Map(hays.map((h) => [h.folder.id, h]));

  const results = new Map<string, FolderResult>();
  const result = (h: FolderHay): FolderResult => {
    let r = results.get(h.folder.id);
    if (!r) {
      const direct = h.found.size === tokens.length;
      r = { folder: h.folder, direct, rank: rankOf(h.folder, direct, tokens), detail: direct ? detailOf(h, tokens) : null, pages: [], documents: [] };
      results.set(h.folder.id, r);
    }
    return r;
  };
  for (const h of hays) if (h.found.size === tokens.length) result(h);

  // One letter would match nearly every page: pages and documents wait for a second letter.
  if (tokens.join('').length >= 2) {
    const { where, params } = itemWhere(tokens, hays);
    const pages = await store.list('page', { where, params, order: 'date DESC, id', limit: opts.pageLimit ?? 300 });
    for (const page of pages) {
      const h = hayById.get(page.folder_id);
      if (!h) continue;
      const text = pageText(page);
      const own = itemMatch(text, tokens, h);
      if (own) result(h).pages.push({ page, excerpt: makeExcerpt(text, tokens.filter((_, i) => own.has(i))) });
    }
    const docs = await store.list('attachment', { where, params, order: 'created_at DESC', limit: opts.documentLimit ?? 100 });
    for (const attachment of docs) {
      const h = hayById.get(attachment.folder_id);
      if (!h) continue;
      const own = itemMatch(`${attachment.filename} ${attachment.ocr_text ?? ''}`, tokens, h);
      if (!own) continue;
      const words = tokens.filter((_, i) => own.has(i));
      const ocr = attachment.ocr_text ?? '';
      result(h).documents.push({
        attachment,
        name: makeExcerpt(attachment.filename, words, 200),
        text: matchesAny(ocr, words) ? makeExcerpt(ocr, words) : null,
      });
    }
  }

  const here: FolderResult[] = [];
  let elsewhere = 0;
  for (const r of results.values()) {
    if (r.folder.status === status) here.push(r);
    else elsewhere++;
  }
  here.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.rank === 3 && latestHit(a) !== latestHit(b)) return latestHit(b).localeCompare(latestHit(a));
    return a.folder.label.localeCompare(b.folder.label);
  });
  return { tokens, folders: here, elsewhere };
}

function matchesAny(text: string, tokens: string[]): boolean {
  const hay = fold(text);
  return tokens.some((t) => hasWord(hay, t));
}
