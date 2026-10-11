import { DateTime } from 'luxon';
import { uuid } from '../../core/ids';
import { isBlankPage, pageMatchesSession, pickSessionPage } from '../../core/model/sections';
import type { Page, Template } from '../../core/model/types';
import type { Store } from '../../core/store/store';
import { pagesWithFiles } from '../../services/queries';
import { sessionSlot } from '../../services/today';
import { restoreEach } from '../../services/trash';
import { getSetting, practiceTimeZone } from '../../services/settings';

export const DEFAULT_TEMPLATE_SETTING = 'pages.default_template';

/** Today's date in the practice's time zone (or in `tz`, when given). */
async function todayIn(store: Store, tz?: string): Promise<string> {
  return DateTime.now().setZone(tz ?? (await practiceTimeZone(store))).toISODate()!;
}

// Pages created since Sala was opened. An editor that closes on one of these, still empty and
// never touched, removes it quietly, so a "New page" pressed by mistake leaves nothing behind.
const createdThisSession = new Set<string>();

/** Whether the page was created since Sala was opened (and not yet written in). */
export const isFreshPage = (id: string): boolean => createdThisSession.has(id);
/** The page has been written in, or removed: it is no longer a candidate for quiet removal. */
export const forgetFreshPage = (id: string): void => void createdThisSession.delete(id);

/**
 * The template a new page starts with: Intake for a folder's first page, else the therapist's
 * default. A new page not yet written in does not count: it goes away quietly if left empty.
 */
export async function templateForNewPage(store: Store, folderId: string): Promise<Template> {
  const pages = await store.list('page', { where: 'folder_id = ?', params: [folderId] });
  if (pages.every((p) => isFreshPage(p.id))) return 'intake';
  return getSetting<Template>(store, DEFAULT_TEMPLATE_SETTING, 'free');
}

/** Creates an empty session page, dated today (in the practice's time zone) unless told otherwise. */
export async function createPageFor(
  store: Store,
  folderId: string,
  opts: { date?: string; time?: string | null; duration?: number | null; template?: Template; tz?: string } = {},
): Promise<Page> {
  const template = opts.template ?? (await templateForNewPage(store, folderId));
  const page = await store.put('page', {
    folder_id: folderId,
    date: opts.date ?? (await todayIn(store, opts.tz)),
    time: opts.time ?? null,
    duration_min: opts.duration ?? null,
    template,
    title: '',
    sections: {},
    process_note: '',
    import_provenance: null,
  });
  createdThisSession.add(page.id);
  return page;
}

/**
 * The note of one session: the folder's live page for that date (and time, when both have
 * one), chosen as `pickSessionPage` does (Today's rule too): a written page before an empty
 * one, then the same time before none. A new page when there is none. A session given by its
 * `start` is dated as Today dates it (`sessionSlot`): the day and time in the practice zone
 * `tz`, whatever zone the appointment was booked in.
 */
export async function findOrCreatePageFor(
  store: Store,
  folderId: string,
  session: { start: DateTime; tz: string; duration?: number | null } | { date?: string; time?: string | null; duration?: number | null; tz?: string },
): Promise<{ page: Page; created: boolean }> {
  const slot = 'start' in session ? sessionSlot(session, session.tz) : session;
  const date = slot.date ?? (await todayIn(store, session.tz));
  const time = slot.time ?? null;
  const pages = await store.list('page', { where: 'folder_id = ? AND date = ?', params: [folderId, date], order: 'created_at' });
  const blank = pages.filter((p) => pageMatchesSession(p, date, time) && isBlankPage(p)).map((p) => p.id);
  const found = pickSessionPage(pages, date, time, await pagesWithFiles(store, blank));
  if (found) return { page: found.page, created: false };
  const page = await createPageFor(store, folderId, { date, time, duration: session.duration ?? null });
  return { page, created: true };
}

/**
 * Session numbers, counted from the folder's first page by date and time (pages without a
 * time come first on their day, then the older page first). Never stored: deleting or
 * re-dating a page renumbers the rest.
 */
export function sessionNumbers(pages: Pick<Page, 'id' | 'date' | 'time' | 'created_at'>[]): Map<string, number> {
  const sorted = [...pages].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return new Map(sorted.map((p, i) => [p.id, i + 1]));
}

/** What a page delete did, so Undo can put it back. */
export interface DeletedPage {
  batch: string;
  pageId: string;
  stickyIds: string[];
  /** Files that were attached to the page and now sit in the folder's Documents. */
  movedAttachmentIds: string[];
}

/**
 * Deletes a page with its sticky notes. Its attached files are kept: they move to the
 * folder's Documents, so nothing points at a deleted page.
 */
export async function deletePage(store: Store, pageId: string): Promise<DeletedPage> {
  const batch = uuid();
  const [stickies, attachments] = await Promise.all([
    store.list('sticky', { where: 'page_id = ?', params: [pageId] }),
    store.list('attachment', { where: 'page_id = ?', params: [pageId] }),
  ]);
  for (const a of attachments) await store.update('attachment', a.id, { page_id: null });
  await store.remove('sticky', stickies.map((s) => s.id), { batch });
  await store.remove('page', [pageId], { batch });
  forgetFreshPage(pageId);
  return { batch, pageId, stickyIds: stickies.map((s) => s.id), movedAttachmentIds: attachments.map((a) => a.id) };
}

/**
 * Undoes `deletePage`: the page and its notes come back, and its files are attached to it
 * again. Returns how many notes stayed deleted because they no longer pass today's checks.
 */
export async function undeletePage(store: Store, d: DeletedPage): Promise<number> {
  await store.restore('page', [d.pageId]);
  for (const id of d.movedAttachmentIds) {
    const a = await store.get('attachment', id);
    // Only files still in Documents: one moved or deleted since stays where it is.
    if (a && !a.deleted && a.page_id === null) await store.update('attachment', id, { page_id: d.pageId });
  }
  return (await restoreEach(store, 'sticky', d.stickyIds)).length;
}
