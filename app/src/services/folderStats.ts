import type { Store } from '../core/store/store';

export interface FolderStats {
  /** Live pages in the folder. */
  pages: number;
  /**
   * The latest session date among them (YYYY-MM-DD), up to the `today` given: a page written
   * ahead for a coming session is not the last one seen.
   */
  lastPageDate: string | null;
  /** When a page of the folder was last written: compare with a folder's `updated_at_hlc`. */
  lastPageHlc: string;
}

/**
 * Page counts and recency for every folder that has pages; folders without pages are absent.
 * `today` (YYYY-MM-DD, in the practice zone) leaves pages dated later out of `lastPageDate`.
 */
export async function folderStats(store: Store, today?: string): Promise<Map<string, FolderStats>> {
  const groups = await store.summarise('page', 'folder_id', 'date', { maxUpTo: today });
  const stats = new Map<string, FolderStats>();
  for (const g of groups) {
    if (g.key) stats.set(g.key, { pages: g.count, lastPageDate: g.max, lastPageHlc: g.hlc });
  }
  return stats;
}
