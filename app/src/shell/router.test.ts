import { describe, expect, it } from 'vitest';
import { dropFolderEntries, type Entry, pushEntry, type Route, sameRoute, updateEntry } from './router';

const e = (key: number, route: Route): Entry => ({ key, route });
const names = (s: Entry[]) => s.map((x) => (x.route.name === 'folder' ? `folder:${x.route.id}` : x.route.name));

describe('router history', () => {
  it('treats routes as equal whatever their key order and unset fields', () => {
    expect(sameRoute({ name: 'shelf', q: 'ana', archived: false }, { name: 'shelf', q: 'ana' })).toBe(true);
    expect(sameRoute({ name: 'shelf', q: '' }, { name: 'shelf' })).toBe(true);
    expect(sameRoute({ name: 'folder', id: 'a', tab: 'pages' }, { tab: 'pages', id: 'a', name: 'folder' } as Route)).toBe(true);
    expect(sameRoute({ name: 'shelf', q: 'ana' }, { name: 'shelf', q: 'rui' })).toBe(false);
  });

  it('skips a step to the place already showing', () => {
    const s = [e(0, { name: 'today' }), e(1, { name: 'shelf', q: 'ana' })];
    expect(pushEntry(s, { name: 'shelf', q: 'ana' }, 2)).toBe(s);
    expect(names(pushEntry(s, { name: 'shelf' }, 2))).toEqual(['today', 'shelf', 'shelf']);
    expect(pushEntry(s, { name: 'today' }, 2)).toHaveLength(3);
  });

  it('rewrites one place where it is, without adding a step (a Settings section, a shelf search)', () => {
    const s = [e(0, { name: 'settings' }), e(1, { name: 'help', topic: 'unlock' })];
    const out = updateEntry(s, 0, { name: 'settings', section: 'privacy' });
    expect(out).toEqual([e(0, { name: 'settings', section: 'privacy' }), e(1, { name: 'help', topic: 'unlock' })]);
    expect(updateEntry(out, 0, { name: 'settings', section: 'privacy' })).toBe(out);
    expect(updateEntry(out, 7, { name: 'today' })).toBe(out);
  });

  it('keeps at most 50 steps', () => {
    let s: Entry[] = [e(0, { name: 'today' })];
    for (let i = 1; i <= 80; i++) s = pushEntry(s, { name: 'folder', id: String(i) }, i);
    expect(s).toHaveLength(50);
    expect(s[s.length - 1]!.route).toEqual({ name: 'folder', id: '80' });
  });

  it('drops every visit to a deleted folder and joins what becomes equal', () => {
    const s = [
      e(0, { name: 'today' }),
      e(1, { name: 'folder', id: 'x', tab: 'pages' }),
      e(2, { name: 'today' }),
      e(3, { name: 'folder', id: 'y' }),
      e(4, { name: 'folder', id: 'x', tab: 'calendar' }),
    ];
    const out = dropFolderEntries(s, 'x', e(9, { name: 'shelf' }));
    expect(names(out)).toEqual(['today', 'folder:y']);
    // The later of two joined places is kept, with its key.
    expect(out[0]!.key).toBe(2);
  });

  it('falls back to the shelf when nothing else is left', () => {
    const out = dropFolderEntries([e(0, { name: 'folder', id: 'x' })], 'x', e(9, { name: 'shelf' }));
    expect(out).toEqual([e(9, { name: 'shelf' })]);
  });
});
