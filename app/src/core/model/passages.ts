import { fold } from '../text/normalize';
import type { Page, Passage } from './types';

// Themes: the therapist marks words of a note with one or more themes ("sleep", "work"), and
// the folder gathers every marked passage of a theme, session by session. Passages live on
// their page; these helpers keep them on their words while the note is edited, and gather
// them across a folder.

/** The longest theme name, in characters. */
export const THEME_MAX = 60;
/** The most themes the same words can carry. */
export const PASSAGE_THEMES_MAX = 12;
/** The longest passage that can be marked, in characters. */
export const PASSAGE_MAX = 5000;

/** A theme name as kept: spaces trimmed and collapsed. */
export const cleanTheme = (name: string): string => name.replace(/\s+/g, ' ').trim();

/** Two names are the same theme when they differ only in capitals, accents or spaces. */
export const themeKey = (name: string): string => fold(name);

export const sameTheme = (a: string, b: string): boolean => themeKey(a) === themeKey(b);

/** Names without blanks or repeats; the first spelling of a theme is the one kept. */
export function uniqueThemes(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanTheme(raw);
    const key = themeKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export interface TextRange {
  start: number;
  end: number;
}

/**
 * Where a passage's words are in `text` now: at its offsets while they still hold its words,
 * else the copy of its words nearest to where they were. Null when the words are gone.
 */
export function locate(text: string, p: Pick<Passage, 'start' | 'end' | 'quote'>): TextRange | null {
  if (!p.quote) return null;
  if (text.slice(p.start, p.end) === p.quote) return { start: p.start, end: p.end };
  let best: number | null = null;
  for (let i = text.indexOf(p.quote); i >= 0; i = text.indexOf(p.quote, i + 1)) {
    if (best === null || Math.abs(i - p.start) < Math.abs(best - p.start)) best = i;
  }
  return best === null ? null : { start: best, end: best + p.quote.length };
}

/**
 * The passages with their offsets put right for the page's text as it is now (see `locate`):
 * text changed by an older Sala, or by an import, moves the words without moving the marks.
 * A passage whose words are gone is left as it is.
 */
export function settle(sections: Record<string, string>, passages: readonly Passage[]): Passage[] {
  return passages.map((p) => {
    const at = locate(sections[p.section] ?? '', p);
    return at && (at.start !== p.start || at.end !== p.end) ? { ...p, ...at } : p;
  });
}

/**
 * Keeps the passages of one section on their words while its text changes from `before` to
 * `after` by one edit (typing, a paste, a cut). Words typed inside a passage become part of
 * it; words typed at its edges do not. A passage whose words are all removed or replaced goes
 * with them; one already out of step with `before` is left as it is.
 */
export function rebase(passages: readonly Passage[], section: string, before: string, after: string): Passage[] {
  if (before === after || !passages.some((p) => p.section === section)) return [...passages];
  // The edit: the same text before `from`, the same text after `oldTo` (before) / `newTo` (after).
  const shortest = Math.min(before.length, after.length);
  let from = 0;
  while (from < shortest && before.charCodeAt(from) === after.charCodeAt(from)) from++;
  let tail = 0;
  while (tail < shortest - from && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
  const oldTo = before.length - tail;
  const newTo = after.length - tail;
  const shift = after.length - before.length;

  const out: Passage[] = [];
  for (const p of passages) {
    const at = p.section === section ? locate(before, p) : null;
    if (!at) {
      out.push(p);
      continue;
    }
    // An edge inside the changed text moves out of it: the passage keeps only its own words.
    const start = at.start < from ? at.start : at.start >= oldTo ? at.start + shift : newTo;
    const end = at.end <= from ? at.end : at.end >= oldTo ? at.end + shift : from;
    const range = end > start ? trimRange(after, { start, end }) : null;
    if (!range) continue;
    out.push({ ...p, ...range, quote: after.slice(range.start, range.end) });
  }
  return out;
}

/**
 * The selection as a passage's words: leading and trailing spaces left out. Null when only
 * spaces are selected.
 */
export function trimRange(text: string, range: TextRange): TextRange | null {
  let { start, end } = range;
  if (start > end) [start, end] = [end, start];
  start = Math.max(0, Math.min(start, text.length));
  end = Math.max(0, Math.min(end, text.length));
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** Passages in the order they are read: by section (as `order` sorts section keys), then by place. */
export function inReadingOrder(passages: readonly Passage[], order: (a: string, b: string) => number): Passage[] {
  return [...passages].sort((a, b) => (a.section === b.section ? a.start - b.start || a.end - b.end : order(a.section, b.section)));
}

/** One theme across a folder. */
export interface ThemeSummary {
  /** The spelling of its earliest use. */
  name: string;
  key: string;
  /** Every passage with the theme, in the order of `pages`, then as read. */
  passages: { page: Page; passage: Passage }[];
  /** The pages it appears on, in the order of `pages`. */
  pageIds: string[];
}

/**
 * The themes of a folder's pages (given in session order, earliest first), the most used
 * first. `order` sorts section keys (see `inReadingOrder`).
 */
export function folderThemes(pages: readonly Page[], order: (a: string, b: string) => number): ThemeSummary[] {
  const byKey = new Map<string, ThemeSummary>();
  for (const page of pages) {
    if (page.deleted) continue;
    for (const passage of inReadingOrder(page.passages ?? [], order)) {
      for (const name of passage.themes) {
        const key = themeKey(name);
        let s = byKey.get(key);
        if (!s) {
          s = { name: cleanTheme(name), key, passages: [], pageIds: [] };
          byKey.set(key, s);
        }
        s.passages.push({ page, passage });
        if (s.pageIds[s.pageIds.length - 1] !== page.id) s.pageIds.push(page.id);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.passages.length - a.passages.length || a.name.localeCompare(b.name));
}

/**
 * The passages with the theme `from` called `to` instead (on words that carry both, they
 * become one). Null when no passage has `from`.
 */
export function renameTheme(passages: readonly Passage[], from: string, to: string): Passage[] | null {
  const name = cleanTheme(to);
  if (!name || !passages.some((p) => p.themes.some((t) => sameTheme(t, from)))) return null;
  return passages.map((p) => (p.themes.some((t) => sameTheme(t, from)) ? { ...p, themes: uniqueThemes(p.themes.map((t) => (sameTheme(t, from) ? name : t))) } : p));
}

/** The passages without the theme `name`; words left with no theme lose their mark. Null when no passage has it. */
export function dropTheme(passages: readonly Passage[], name: string): Passage[] | null {
  if (!passages.some((p) => p.themes.some((t) => sameTheme(t, name)))) return null;
  return passages.flatMap((p) => {
    const themes = p.themes.filter((t) => !sameTheme(t, name));
    return themes.length ? [{ ...p, themes }] : [];
  });
}
