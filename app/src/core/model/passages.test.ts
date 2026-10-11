import { describe, expect, it } from 'vitest';
import { dropTheme, folderThemes, inReadingOrder, locate, rebase, renameTheme, settle, trimRange, uniqueThemes } from './passages';
import { bySectionOrder } from './sections';
import type { Page, Passage } from './types';

const mark = (section: string, text: string, words: string, themes = ['sleep'], id = words): Passage => {
  const start = text.indexOf(words);
  if (start < 0) throw new Error(`“${words}” not in “${text}”`);
  return { id, section, start, end: start + words.length, quote: words, themes, created_at: '2026-09-28T10:00:00.000Z' };
};

/** Types `typed` at `at` (replacing `remove` characters), the way a text box changes. */
const edit = (text: string, at: number, remove: number, typed: string) => text.slice(0, at) + typed + text.slice(at + remove);

const NOTE = 'Slept badly. Worry about work at night. Walks help.';

describe('locate', () => {
  it('finds the words at their offsets, else the copy nearest to where they were', () => {
    const p = mark('body', NOTE, 'Worry about work');
    expect(locate(NOTE, p)).toEqual({ start: 13, end: 29 });
    const moved = `Another line. ${NOTE}`;
    expect(locate(moved, p)).toEqual({ start: 27, end: 43 });
    const twice = 'work, work, work';
    expect(locate(twice, { start: 6, end: 10, quote: 'work' })).toEqual({ start: 6, end: 10 });
    expect(locate(twice, { start: 13, end: 17, quote: 'work' })).toEqual({ start: 12, end: 16 });
  });

  it('is null when the words are gone', () => {
    expect(locate('Slept well.', mark('body', NOTE, 'Worry about work'))).toBeNull();
  });
});

describe('rebase', () => {
  const p = mark('body', NOTE, 'Worry about work');
  const words = (ps: Passage[], text: string) => ps.map((x) => text.slice(x.start, x.end));

  it('moves a passage with text typed before it, and keeps it when typing after it', () => {
    const before = edit(NOTE, 0, 0, 'Monday. ');
    expect(words(rebase([p], 'body', NOTE, before), before)).toEqual(['Worry about work']);
    const after = edit(NOTE, NOTE.length, 0, ' More.');
    expect(rebase([p], 'body', NOTE, after)).toEqual([p]);
  });

  it('takes in words typed inside it, but not words typed at its edges', () => {
    const inside = edit(NOTE, NOTE.indexOf('work'), 0, 'her ');
    expect(words(rebase([p], 'body', NOTE, inside), inside)).toEqual(['Worry about her work']);
    const atStart = edit(NOTE, p.start, 0, 'Much ');
    expect(words(rebase([p], 'body', NOTE, atStart), atStart)).toEqual(['Worry about work']);
    const atEnd = edit(NOTE, p.end, 0, ' deadlines');
    expect(words(rebase([p], 'body', NOTE, atEnd), atEnd)).toEqual(['Worry about work']);
  });

  it('shrinks when some of its words are removed, and goes when all of them are', () => {
    const part = edit(NOTE, p.start, 'Worry '.length, '');
    const kept = rebase([p], 'body', NOTE, part);
    expect(words(kept, part)).toEqual(['about work']);
    expect(kept[0]!.quote).toBe('about work');
    const gone = edit(NOTE, p.start - 1, p.end - p.start + 1, '');
    expect(rebase([p], 'body', NOTE, gone)).toEqual([]);
    const replaced = edit(NOTE, p.start, p.end - p.start, 'Rumination');
    expect(rebase([p], 'body', NOTE, replaced)).toEqual([]);
  });

  it('keeps only its own words when an edit runs across its edge', () => {
    // "badly. Worry" becomes "well. Fear": the passage keeps "about work".
    const from = NOTE.indexOf('badly');
    const changed = edit(NOTE, from, 'badly. Worry'.length, 'well. Fear');
    expect(words(rebase([p], 'body', NOTE, changed), changed)).toEqual(['about work']);
  });

  it('leaves passages of other sections, and passages already out of step, as they are', () => {
    const other = { ...p, section: 'plan' };
    const stale = { ...p, id: 'stale', quote: 'not in the text' };
    const typed = edit(NOTE, 0, 0, 'x');
    expect(rebase([other, stale], 'body', NOTE, typed)).toEqual([other, stale]);
  });

  it('follows a pasted block and a cut', () => {
    const pasted = edit(NOTE, 0, 0, 'A long pasted paragraph.\n\n');
    const [a] = rebase([p], 'body', NOTE, pasted);
    expect(pasted.slice(a!.start, a!.end)).toBe('Worry about work');
    const cut = edit(NOTE, 0, 'Slept badly. '.length, '');
    const [b] = rebase([p], 'body', NOTE, cut);
    expect([b!.start, cut.slice(b!.start, b!.end)]).toEqual([0, 'Worry about work']);
  });
});

describe('settle', () => {
  it('puts offsets right for text changed where they could not follow', () => {
    const p = mark('body', NOTE, 'Walks help.');
    const moved = { body: NOTE.replace('Slept badly. ', '') };
    const [s] = settle(moved, [p]);
    expect(moved.body.slice(s!.start, s!.end)).toBe('Walks help.');
    const gone = { body: 'Nothing here.' };
    expect(settle(gone, [p])).toEqual([p]);
  });
});

describe('trimRange', () => {
  it('leaves out spaces at either end, in either direction', () => {
    expect(trimRange('  sleep  ', { start: 0, end: 9 })).toEqual({ start: 2, end: 7 });
    expect(trimRange('  sleep  ', { start: 9, end: 0 })).toEqual({ start: 2, end: 7 });
    expect(trimRange('a   b', { start: 1, end: 4 })).toBeNull();
    expect(trimRange('abc', { start: 1, end: 1 })).toBeNull();
    expect(trimRange('abc', { start: 1, end: 99 })).toEqual({ start: 1, end: 3 });
  });
});

describe('themes', () => {
  it('treats names differing only in capitals, accents or spaces as one theme', () => {
    expect(uniqueThemes([' Preocupação ', 'preocupacao', 'sono', '', '  Sono'])).toEqual(['Preocupação', 'sono']);
  });

  const page = (id: string, date: string, sections: Record<string, string>, passages: Passage[], deleted = false): Page => ({
    id, created_at: `${date}T10:00:00.000Z`, updated_at_hlc: '1', deleted, folder_id: 'f', date, time: null, duration_min: null,
    template: 'dap', title: '', sections, process_note: '', import_provenance: null, passages,
  });

  it('gathers a folder’s themes, the most used first, in session order', () => {
    const one = page('p1', '2026-09-01', { data: 'Sleeps badly.', plan: 'Sleep diary.' }, [
      mark('plan', 'Sleep diary.', 'Sleep diary', ['sleep']),
      mark('data', 'Sleeps badly.', 'Sleeps badly', ['Sleep', 'mood']),
    ]);
    const two = page('p2', '2026-09-08', { data: 'Work stress, sleep better.' }, [
      mark('data', 'Work stress, sleep better.', 'Work stress', ['work']),
      mark('data', 'Work stress, sleep better.', 'sleep better', ['sleep']),
    ]);
    const gone = page('p3', '2026-09-15', { data: 'x' }, [mark('data', 'x', 'x', ['sleep'])], true);
    const themes = folderThemes([one, two, gone], bySectionOrder);
    expect(themes.map((s) => [s.name, s.passages.length, s.pageIds])).toEqual([
      ['Sleep', 3, ['p1', 'p2']],
      ['mood', 1, ['p1']],
      ['work', 1, ['p2']],
    ]);
    // Data comes before Plan on a page, whatever order the marks were made in.
    expect(themes[0]!.passages.map((x) => x.passage.quote)).toEqual(['Sleeps badly', 'Sleep diary', 'sleep better']);
  });

  it('reads passages in section order, then by place', () => {
    const a = mark('plan', 'b a', 'a');
    const b = mark('data', 'b a', 'b');
    const c = mark('data', 'b a', 'a');
    expect(inReadingOrder([a, c, b], bySectionOrder).map((p) => `${p.section}:${p.quote}`)).toEqual(['data:b', 'data:a', 'plan:a']);
  });

  it('renames a theme, merging it with one the words already carry', () => {
    const ps = [mark('body', NOTE, 'Slept badly', ['sleep', 'Insomnia']), mark('body', NOTE, 'Walks help', ['coping'])];
    expect(renameTheme(ps, 'SLEEP', 'insomnia')!.map((p) => p.themes)).toEqual([['insomnia'], ['coping']]);
    expect(renameTheme(ps, 'grief', 'loss')).toBeNull();
    expect(renameTheme(ps, 'sleep', '  ')).toBeNull();
  });

  it('removes a theme, and the mark of words left without one', () => {
    const ps = [mark('body', NOTE, 'Slept badly', ['sleep', 'mood']), mark('body', NOTE, 'Walks help', ['sleep'])];
    expect(dropTheme(ps, 'Sleep')!.map((p) => [p.quote, p.themes])).toEqual([['Slept badly', ['mood']]]);
    expect(dropTheme(ps, 'grief')).toBeNull();
  });
});
