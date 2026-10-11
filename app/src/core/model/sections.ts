import { type Page, TEMPLATE_SECTIONS, TEMPLATES } from './types';

// A page's sections in reading order. Switching template never drops text (validate.ts keeps
// it), so every reader shows the current template's sections first, then any other section
// that still holds words: the editor, the Markdown and FHIR exports, and list previews.

export interface PageSection {
  key: string;
  text: string;
  /** False for text written under another template and kept. */
  inTemplate: boolean;
}

/** Every section key Sala knows, in the order the templates list them. */
export const KNOWN_SECTIONS: readonly string[] = [...new Set(TEMPLATES.flatMap((t) => TEMPLATE_SECTIONS[t]))];

/**
 * The current template's sections (empty ones too), then every other non-empty section: known
 * keys in template order, then unknown ones (from a newer version or an import) as stored.
 */
export function sectionsOf(page: Pick<Page, 'template' | 'sections'>): PageSection[] {
  const own = TEMPLATE_SECTIONS[page.template] ?? [];
  const out: PageSection[] = own.map((key) => ({ key, text: page.sections[key] ?? '', inTemplate: true }));
  const others = Object.keys(page.sections)
    .filter((key) => !own.includes(key) && (page.sections[key] ?? '').trim())
    .sort(bySectionOrder);
  for (const key of others) out.push({ key, text: page.sections[key] ?? '', inTemplate: false });
  return out;
}

/** Sections kept from another template that still hold text. */
export function earlierSections(page: Pick<Page, 'template' | 'sections'>): PageSection[] {
  return sectionsOf(page).filter((s) => !s.inTemplate);
}

/** All the page's words in reading order, as one line: for previews and word counts. */
export function pageText(page: Pick<Page, 'template' | 'sections'>): string {
  return sectionsOf(page)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Whether a page holds nothing the therapist wrote: no title, no section text, no process note. */
export function isBlankPage(page: Pick<Page, 'title' | 'sections' | 'process_note'>): boolean {
  return !page.title.trim() && !page.process_note.trim() && Object.values(page.sections).every((v) => !v.trim());
}

/**
 * Whether a page is the note of a session on `date` at `time`: same date, and the same time
 * when both the page and the session have one.
 */
export function pageMatchesSession(page: Pick<Page, 'date' | 'time'>, date: string, time: string | null): boolean {
  return page.date === date && (page.time === null || time === null || page.time === time);
}

/**
 * The note of a session among a folder's pages (oldest first): a page that matches it (see
 * `pageMatchesSession`). A page with something written in it, or with a document attached
 * (`withFiles`), comes first; among those, the one with the session's exact time, else the
 * oldest. An empty page counts only when there is no other, so Write note opens it again
 * rather than making a second one; `blank` then says it is no note yet.
 */
export function pickSessionPage<P extends Pick<Page, 'id' | 'date' | 'time' | 'title' | 'sections' | 'process_note'>>(
  pages: readonly P[],
  date: string,
  time: string | null,
  withFiles: ReadonlySet<string>,
): { page: P; blank: boolean } | null {
  const matches = pages.filter((p) => pageMatchesSession(p, date, time));
  const best = (list: P[]) => list.find((p) => time !== null && p.time === time) ?? list[0];
  const written = best(matches.filter((p) => !isBlankPage(p) || withFiles.has(p.id)));
  if (written) return { page: written, blank: false };
  const blank = best(matches);
  return blank ? { page: blank, blank: true } : null;
}

function rank(key: string): number {
  const i = KNOWN_SECTIONS.indexOf(key);
  return i === -1 ? KNOWN_SECTIONS.length : i;
}

/** Sorts section keys the way `sectionsOf` lists kept sections: known ones in template order first. */
export const bySectionOrder = (a: string, b: string): number => rank(a) - rank(b);
