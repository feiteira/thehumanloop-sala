import { DateTime } from 'luxon';
import type { Folder } from '../../core/model/types';
import type { FolderStats } from '../../services/folderStats';

// What the shelf shows on each card and how it orders them; no React here.

export const SHELF_SORTS = ['name', 'recent', 'next'] as const;
export type ShelfSort = (typeof SHELF_SORTS)[number];
export const isShelfSort = (v: unknown): v is ShelfSort => (SHELF_SORTS as readonly unknown[]).includes(v);

/** When a folder was last used: its own last change or the last change to one of its pages. */
export function lastUsed(folder: Folder, stats?: FolderStats): string {
  const page = stats?.lastPageHlc ?? '';
  return page > folder.updated_at_hlc ? page : folder.updated_at_hlc;
}

/**
 * The folders in the order chosen: by name, most recently used first, or soonest next session
 * first (folders with nothing booked last, by name). `nextAt` gives a next session's start in
 * milliseconds. While searching, `rank` (a search result's rank, lower is better) comes first,
 * so a folder named by the words leads one found through its notes, whatever the order chosen.
 */
export function sortFolders(
  folders: Folder[],
  sort: ShelfSort,
  ctx: {
    nextAt: (id: string) => number | undefined;
    stats: Map<string, FolderStats>;
    compare: (a: string, b: string) => number;
    rank?: (id: string) => number;
  },
): Folder[] {
  return [...folders].sort((a, b) => {
    if (ctx.rank) {
      const d = ctx.rank(a.id) - ctx.rank(b.id);
      if (d) return d;
    }
    if (sort === 'recent') {
      const ra = lastUsed(a, ctx.stats.get(a.id));
      const rb = lastUsed(b, ctx.stats.get(b.id));
      if (ra !== rb) return rb.localeCompare(ra);
    }
    if (sort === 'next') {
      const na = ctx.nextAt(a.id) ?? Infinity;
      const nb = ctx.nextAt(b.id) ?? Infinity;
      if (na !== nb) return na - nb;
    }
    return ctx.compare(a.label, b.label);
  });
}

/** Every tag used on these folders, once, in order. */
export function tagsOf(folders: Folder[], compare: (a: string, b: string) => number): string[] {
  return [...new Set(folders.flatMap((f) => f.tags))].sort(compare);
}

export type Elapsed = { unit: 'day' | 'week' | 'month' | 'year'; n: number };

/**
 * How long ago a session date was, in the unit a person would say: days for two weeks, then
 * weeks up to two months, then months, then years. Null for a date still to come.
 */
export function elapsedSince(date: string, today: string): Elapsed | null {
  const from = DateTime.fromISO(date, { zone: 'utc' });
  const to = DateTime.fromISO(today, { zone: 'utc' });
  if (!from.isValid || !to.isValid) return null;
  const days = Math.round(to.diff(from, 'days').days);
  if (days < 0) return null;
  if (days < 14) return { unit: 'day', n: days };
  if (days < 60) return { unit: 'week', n: Math.floor(days / 7) };
  const months = Math.floor(to.diff(from, 'months').months);
  if (months < 12) return { unit: 'month', n: Math.max(2, months) };
  return { unit: 'year', n: Math.floor(to.diff(from, 'years').years) };
}

/** "3 weeks ago", "yesterday", "today" in the interface language (`bcp47`). */
export function formatElapsed(e: Elapsed, bcp47: string): string {
  const numeric = e.unit === 'day' && e.n <= 1 ? 'auto' : 'always';
  return new Intl.RelativeTimeFormat(bcp47, { numeric }).format(-e.n, e.unit);
}
