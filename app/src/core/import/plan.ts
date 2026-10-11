import type { DateSource } from './dates';
import type { ImportProvenance } from '../model/types';
import { fold } from '../text/normalize';

// An import is planned first and written only after review. The plan is plain data so it
// can be saved (and an interrupted import resumed) without keeping any file handles.

export interface PlannedFolder {
  key: string;
  label: string;
  /** An existing folder to add to instead of creating a new one. */
  existingId: string | null;
  /** The existing folder this one looks like: offered as "Merge into", and kept for "Keep separate". */
  suggestedId: string | null;
  include: boolean;
  /** Created by this import (an earlier, interrupted run); `existingId` is that new folder. */
  created?: boolean;
}

export type ItemKind = 'page' | 'attachment' | 'folder' | 'appointment';

/** Why an item could not be imported: its file could not be read, is too large to keep, or what it holds is not valid. */
export type ItemError = 'read' | 'tooLarge' | 'invalid' | 'other';

export interface PlannedItem {
  id: string;
  kind: ItemKind;
  folderKey: string | null;
  /** Where the content came from: an absolute path, or a label for CSV rows and calendar events. */
  source: string;
  name: string;
  date: string;
  dateSource: DateSource;
  time: string | null;
  duration: number | null;
  text: string;
  provenance: ImportProvenance['source_kind'];
  engine: string | null;
  confidence: number | null;
  /** Keep the original file as a document beside the page. */
  keepOriginal: boolean;
  mime: string;
  include: boolean;
  warning: string | null;
  done: boolean;
  /** Set when the last import attempt failed for this item; the others carried on. */
  error?: ItemError | null;
  /** A calendar event: the folder its title looks like, when that is not an exact match. */
  suggestedFolderKey?: string | null;
  /**
   * Why that folder: its name looks like the title, or another event of the same title was
   * put in it. Absent in plans saved by earlier versions, which suggested by name only.
   */
  suggestedBy?: 'name' | 'sameTitle' | null;
  /**
   * The folder the event's own title looks like, kept so it is offered again once no event of
   * the same title is in a folder any more. Absent in plans saved by earlier versions.
   */
  nameSuggestion?: string | null;
  /** The original file's size in bytes, when known. */
  size?: number;
}

export type PlanSource = 'tree' | 'files' | 'csv' | 'ics';

export interface ImportPlan {
  id: string;
  createdAt: string;
  folders: PlannedFolder[];
  items: PlannedItem[];
  state: 'review' | 'importing' | 'done';
  /** What was picked; plans saved before this field existed have none. */
  source?: PlanSource;
}

/**
 * The words of a person's name for matching an import against existing folders: order-free,
 * without accents, case or punctuation. Initials are kept, so "Inês S." and "Inês R." stay two
 * different people.
 */
export function importTokens(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort();
}

/** The same name, word for word, in any order and whatever the accents, case or punctuation. */
export function sameName(a: string, b: string): boolean {
  const ta = importTokens(a);
  return ta.length > 0 && ta.join(' ') === importTokens(b).join(' ');
}

/**
 * How alike two names are, 0–1, ignoring order, accents and punctuation. A word counts fully
 * when both names have it; an initial ("S.") counts half against a word starting with that
 * letter ("Sousa"), so a shortened name is a likely match but never an exact one.
 */
export function labelSimilarity(a: string, b: string): number {
  const ta = importTokens(a);
  const tb = importTokens(b);
  if (!ta.length || !tb.length) return 0;
  const restA = [...ta];
  const restB = [...tb];
  let score = 0;
  for (let i = restA.length - 1; i >= 0; i--) {
    const j = restB.indexOf(restA[i]!);
    if (j < 0) continue;
    score += 1;
    restA.splice(i, 1);
    restB.splice(j, 1);
  }
  const initialsAgainst = (initials: string[], words: string[]) => {
    for (const ini of initials.filter((t) => t.length === 1)) {
      const j = words.findIndex((w) => w.length > 1 && w.startsWith(ini));
      if (j < 0) continue;
      score += 0.5;
      words.splice(j, 1);
    }
  };
  initialsAgainst(restA, restB);
  initialsAgainst(restB, restA);
  return (2 * score) / (ta.length + tb.length);
}

/** At or above this, a name is offered as "Looks like…" (never merged without the therapist). */
export const SIMILAR = 0.66;

/**
 * The existing folder an imported name belongs to. Only the same name (`sameName`) counts as
 * `exact` and may be merged on its own; otherwise `similar` is the closest likely match.
 */
export function matchFolder<T extends { id: string; label: string }>(label: string, existing: T[]): { exact: T | null; similar: T | null } {
  const exact = existing.find((f) => sameName(label, f.label)) ?? null;
  if (exact) return { exact, similar: exact };
  let best: { f: T; s: number } | null = null;
  for (const f of existing) {
    const s = labelSimilarity(label, f.label);
    if (s >= SIMILAR && (!best || s > best.s)) best = { f, s };
  }
  return { exact: null, similar: best?.f ?? null };
}
