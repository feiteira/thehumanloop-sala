import { describe, expect, it } from 'vitest';
import { chapterFrom, chapters, searchChapters, TOPICS } from './manual';

const guide = chapterFrom(
  '02-folders.md',
  [
    '# Folders',
    '',
    'Intro about folders.',
    '',
    '<a id="shelf"></a>',
    '',
    '## The shelf',
    '',
    'Search finds folders by name or tag. **Sort** by name or next session.',
    '',
    '<a id="archive"></a>',
    '',
    '## Archive a folder',
    '',
    '- Choose **Archive** when therapy ends.',
    '- The folder moves to the archive; its pages stay searchable.',
  ].join('\n'),
);

describe('searchChapters', () => {
  it('finds a section holding every word, in any order, across its paragraphs and lists', () => {
    const hits = searchChapters([guide], 'therapy archive ends');
    expect(hits.map((h) => h.anchor)).toEqual(['archive']);
    expect(hits[0]!.heading).toBe('Archive a folder');
    expect(hits[0]!.excerpt.text).toContain('therapy ends');
  });

  it('needs all the words in the same section', () => {
    expect(searchChapters([guide], 'sort therapy')).toEqual([]);
  });

  it('ignores accents and capitals, and puts sections named by the words first', () => {
    const hits = searchChapters([guide], 'FÓLDER');
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]!.heading).toMatch(/folder/i);
  });

  it('waits for two letters', () => {
    expect(searchChapters([guide], 'a')).toEqual([]);
  });

  it('opens every topic at a section that exists, in every language', () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const all = chapters(locale);
      for (const [name, topic] of Object.entries(TOPICS)) {
        const ch = all.find((c) => c.file === topic.file);
        expect(ch, `${locale} ${name}`).toBeDefined();
        if (topic.anchor) expect(ch!.blocks.some((b) => b.t === 'heading' && b.anchor === topic.anchor), `${locale} ${name}`).toBe(true);
      }
    }
  });
});
