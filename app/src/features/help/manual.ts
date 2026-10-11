import type { UiLocale } from '../../core/i18n/locales';
import { type Block, inlineText, parseMarkdown } from '../../core/text/markdown';
import { fold } from '../../core/text/normalize';
import { type Excerpt, findWord, makeExcerpt, matchesAll, tokenize } from '../../services/search';

// The user manual, bundled into the app so Help works offline. Source: docs/manual/<lang>/.

const sources = import.meta.glob('../../../../docs/manual/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const images = import.meta.glob('../../../../docs/manual/img/*/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface Chapter {
  file: string;
  title: string;
  blocks: Block[];
  text: string; // for search
}

export const CHAPTER_ORDER = [
  'index.md',
  '01-getting-started.md',
  '02-folders-pages-notes.md',
  '03-calendar.md',
  '04-bringing-your-practice.md',
  '05-your-data.md',
  '06-questions.md',
  'glossary.md',
];

const cache = new Map<UiLocale, Chapter[]>();

export function chapters(locale: UiLocale): Chapter[] {
  const hit = cache.get(locale);
  if (hit) return hit;
  const out: Chapter[] = [];
  for (const file of CHAPTER_ORDER) {
    const src = sources[`../../../../docs/manual/${locale}/${file}`] ?? sources[`../../../../docs/manual/en/${file}`];
    if (src) out.push(chapterFrom(file, src));
  }
  cache.set(locale, out);
  return out;
}

export function chapterFrom(file: string, src: string): Chapter {
  const blocks = parseMarkdown(src);
  const first = blocks.find((b) => b.t === 'heading');
  return { file, title: first && first.t === 'heading' ? inlineText(first.c) : file, blocks, text: src };
}

/** Resolves an image path as written in the manual ("../img/pt/today.png") to a bundled URL. */
export function imageUrl(src: string): string | null {
  const m = /img\/([a-z]+)\/([^/]+\.png)$/.exec(src);
  if (!m) return null;
  return images[`../../../../docs/manual/img/${m[1]}/${m[2]}`] ?? images[`../../../../docs/manual/img/en/${m[2]}`] ?? null;
}

/** Help topics: the "?" on each screen, and F1 (`helpTopicFor` in shell/helpTopic.ts). */
export const TOPICS: Record<string, { file: string; anchor?: string }> = {
  today: { file: '03-calendar.md', anchor: 'today' },
  shelf: { file: '02-folders-pages-notes.md', anchor: 'shelf' },
  folder: { file: '02-folders-pages-notes.md', anchor: 'pages' },
  documents: { file: '02-folders-pages-notes.md', anchor: 'documents' },
  themes: { file: '02-folders-pages-notes.md', anchor: 'themes' },
  calendar: { file: '03-calendar.md', anchor: 'calendar' },
  appointment: { file: '03-calendar.md', anchor: 'appointment' },
  'working-hours': { file: '03-calendar.md', anchor: 'working-hours' },
  import: { file: '04-bringing-your-practice.md' },
  settings: { file: '05-your-data.md', anchor: 'backups' },
  export: { file: '05-your-data.md', anchor: 'export' },
  privacy: { file: '05-your-data.md', anchor: 'privacy' },
  updates: { file: '05-your-data.md', anchor: 'updates' },
  unlock: { file: '01-getting-started.md', anchor: 'unlock' },
  passphrase: { file: '01-getting-started.md', anchor: 'passphrase' },
  shortcuts: { file: '01-getting-started.md', anchor: 'shortcuts' },
  // Before a practice is open (onboarding and unlock).
  welcome: { file: '01-getting-started.md', anchor: 'first-run' },
  restore: { file: '05-your-data.md', anchor: 'restore' },
  forgot: { file: '06-questions.md', anchor: 'forgot' },
};

export interface SearchHit {
  file: string;
  chapter: string;
  heading: string;
  anchor: string | null;
  excerpt: Excerpt;
}

function blockText(b: Block): string {
  switch (b.t) {
    case 'heading':
    case 'para':
    case 'quote':
      return inlineText(b.c);
    case 'list':
      return b.items.map((i) => inlineText(i.c)).join(' ');
    case 'table':
      return [b.head, ...b.rows].flat().map(inlineText).join(' ');
    default:
      return '';
  }
}

/**
 * Sections of the manual (a heading and what follows it) holding every word of `q`, in any
 * order and anywhere in the section, each at the start of a word. Sections whose heading holds more of the words come first.
 */
export function searchChapters(all: Chapter[], q: string): SearchHit[] {
  const words = tokenize(q);
  if (words.join('').length < 2) return [];
  const hits: (SearchHit & { score: number; order: number })[] = [];
  for (const ch of all) {
    let section: { heading: string; anchor: string | null; texts: string[] } = { heading: ch.title, anchor: null, texts: [] };
    const close = () => {
      if (!matchesAll(section.texts.join(' '), words)) return;
      const count = (text: string) => words.filter((w) => findWord(fold(text), w) >= 0).length;
      // The excerpt comes from the paragraph or list holding most of the words.
      const body = section.texts.slice(1).filter(Boolean);
      const best = body.reduce<{ text: string; n: number }>((acc, text) => {
        const n = count(text);
        return n > acc.n ? { text, n } : acc;
      }, { text: body[0] ?? '', n: -1 });
      hits.push({
        file: ch.file, chapter: ch.title, heading: section.heading, anchor: section.anchor,
        excerpt: makeExcerpt(best.text, words, 150, 50),
        score: count(section.heading), order: hits.length,
      });
    };
    for (const b of ch.blocks) {
      if (b.t === 'heading') {
        close();
        section = { heading: inlineText(b.c), anchor: b.anchor, texts: [inlineText(b.c)] };
      } else {
        section.texts.push(blockText(b));
      }
    }
    close();
  }
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, 30).map(({ score: _s, order: _o, ...h }) => h);
}

export function searchManual(locale: UiLocale, q: string): SearchHit[] {
  return searchChapters(chapters(locale), q);
}
