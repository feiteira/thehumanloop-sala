import { describe, expect, it } from 'vitest';
import { emptyContact, type Folder } from '../../core/model/types';
import type { FolderStats } from '../../services/folderStats';
import { elapsedSince, formatElapsed, isShelfSort, lastUsed, sortFolders, tagsOf } from './shelfModel';

const folder = (id: string, label: string, hlc: string, tags: string[] = []): Folder => ({
  id, label, updated_at_hlc: hlc, created_at: '2026-01-01T00:00:00.000Z', deleted: false,
  colour: 'teal', status: 'active', tags, contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
});
const stats = (lastPageHlc: string): FolderStats => ({ pages: 1, lastPageDate: '2026-09-21', lastPageHlc });
const compare = (a: string, b: string) => a.localeCompare(b);

describe('shelf order', () => {
  const ana = folder('a', 'Ana', '000000000000300-00000-x');
  const rui = folder('r', 'Rui', '000000000000100-00000-x');
  const ines = folder('i', 'Inês', '000000000000200-00000-x');

  it('counts a page written in a folder as using the folder', () => {
    expect(lastUsed(rui, stats('000000000000900-00000-x'))).toBe('000000000000900-00000-x');
    expect(lastUsed(ana, stats('000000000000100-00000-x'))).toBe(ana.updated_at_hlc);
    expect(lastUsed(ana)).toBe(ana.updated_at_hlc);
  });

  it('sorts by name, by last use and by next session', () => {
    const ctx = { nextAt: (id: string) => ({ r: 5, i: 1 })[id], stats: new Map([['r', stats('000000000000900-00000-x')]]), compare };
    expect(sortFolders([ana, rui, ines], 'name', ctx).map((f) => f.label)).toEqual(['Ana', 'Inês', 'Rui']);
    expect(sortFolders([ana, rui, ines], 'recent', ctx).map((f) => f.label)).toEqual(['Rui', 'Ana', 'Inês']);
    expect(sortFolders([ana, rui, ines], 'next', ctx).map((f) => f.label)).toEqual(['Inês', 'Rui', 'Ana']);
  });

  it('puts the best search matches first, then the order chosen', () => {
    // Searching "costa": Rui's cover note says "brother of Laura Costa"; Inês Costa and Ana Costa are named.
    const anaCosta = folder('ac', 'Ana Costa', '000000000000100-00000-x');
    const inesCosta = folder('ic', 'Inês Costa', '000000000000500-00000-x');
    const rank = (id: string) => ({ r: 2, ac: 1, ic: 1 })[id] ?? 3;
    const ctx = { nextAt: () => undefined, stats: new Map<string, FolderStats>(), compare, rank };
    expect(sortFolders([rui, anaCosta, inesCosta], 'name', ctx).map((f) => f.label)).toEqual(['Ana Costa', 'Inês Costa', 'Rui']);
    expect(sortFolders([rui, anaCosta, inesCosta], 'recent', ctx).map((f) => f.label)).toEqual(['Inês Costa', 'Ana Costa', 'Rui']);
    expect(sortFolders([rui, anaCosta, inesCosta], 'next', { ...ctx, nextAt: (id: string) => ({ r: 1 })[id] }).map((f) => f.label)).toEqual(['Ana Costa', 'Inês Costa', 'Rui']);
  });

  it('knows its sorts', () => {
    expect(isShelfSort('recent')).toBe(true);
    expect(isShelfSort('size')).toBe(false);
    expect(isShelfSort(undefined)).toBe(false);
  });

  it('lists each tag once, in order', () => {
    expect(tagsOf([folder('1', 'A', 'h', ['sono', 'ansiedade']), folder('2', 'B', 'h', ['sono'])], compare)).toEqual(['ansiedade', 'sono']);
  });
});

describe('last seen', () => {
  it('says how long ago in days, then weeks, months and years', () => {
    expect(elapsedSince('2026-09-28', '2026-09-28')).toEqual({ unit: 'day', n: 0 });
    expect(elapsedSince('2026-09-27', '2026-09-28')).toEqual({ unit: 'day', n: 1 });
    expect(elapsedSince('2026-09-16', '2026-09-28')).toEqual({ unit: 'day', n: 12 });
    expect(elapsedSince('2026-09-07', '2026-09-28')).toEqual({ unit: 'week', n: 3 });
    expect(elapsedSince('2026-08-01', '2026-09-28')).toEqual({ unit: 'week', n: 8 });
    expect(elapsedSince('2026-07-20', '2026-09-28')).toEqual({ unit: 'month', n: 2 });
    expect(elapsedSince('2025-11-01', '2026-09-28')).toEqual({ unit: 'month', n: 10 });
    expect(elapsedSince('2024-06-01', '2026-09-28')).toEqual({ unit: 'year', n: 2 });
    expect(elapsedSince('2026-10-02', '2026-09-28')).toBeNull();
  });

  it('reads naturally in each language', () => {
    expect(formatElapsed({ unit: 'week', n: 3 }, 'en-GB')).toBe('3 weeks ago');
    expect(formatElapsed({ unit: 'day', n: 1 }, 'en-GB')).toBe('yesterday');
    expect(formatElapsed({ unit: 'day', n: 0 }, 'pt-PT')).toBe('hoje');
    expect(formatElapsed({ unit: 'week', n: 3 }, 'pt-PT')).toBe('há 3 semanas');
    expect(formatElapsed({ unit: 'month', n: 2 }, 'es-ES')).toBe('hace 2 meses');
  });
});
