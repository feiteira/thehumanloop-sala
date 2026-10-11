import { afterEach, describe, expect, it } from 'vitest';
import { DateTime, Settings } from 'luxon';
import { formatHlc, parseHlc } from '../../core/hlc';
import { emptyContact } from '../../core/model/types';
import { Store } from '../../core/store/store';
import { SqlJsDb } from '../../platform/sqljs';
import { SETTING, setSetting } from '../../services/settings';
import { sessionSlot } from '../../services/today';
import { createPageFor, deletePage, DEFAULT_TEMPLATE_SETTING, findOrCreatePageFor, forgetFreshPage, isFreshPage, sessionNumbers, undeletePage } from './pageActions';
import { pageMatchesSession } from '../../core/model/sections';

async function setup() {
  const store = await Store.open(await SqlJsDb.create());
  const folder = await store.put('folder', {
    label: 'Inês S.', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
  });
  return { store, folderId: folder.id };
}

afterEach(() => {
  Settings.now = () => Date.now();
});

describe('findOrCreatePageFor', () => {
  it('creates the session note once, then finds it', async () => {
    const { store, folderId } = await setup();
    const first = await findOrCreatePageFor(store, folderId, { date: '2026-09-28', time: '09:00', duration: 50 });
    expect(first.created).toBe(true);
    expect(first.page).toMatchObject({ folder_id: folderId, date: '2026-09-28', time: '09:00', duration_min: 50 });
    const again = await findOrCreatePageFor(store, folderId, { date: '2026-09-28', time: '09:00', duration: 50 });
    expect(again).toMatchObject({ created: false, page: { id: first.page.id } });
    expect(await store.count('page')).toBe(1);
  });

  it('matches the time only when both the page and the session have one', async () => {
    const { store, folderId } = await setup();
    const morning = await createPageFor(store, folderId, { date: '2026-09-28', time: '09:00' });
    // Another session that day gets its own page.
    const evening = await findOrCreatePageFor(store, folderId, { date: '2026-09-28', time: '18:00' });
    expect(evening.created).toBe(true);
    // A session without a time takes the first page of the day.
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-28' })).page.id).toBe(morning.id);
    // A page written without a time is the note of any session that day…
    const untimed = await createPageFor(store, folderId, { date: '2026-09-29' });
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-29', time: '10:00' })).page.id).toBe(untimed.id);
    // …but a page with the same time wins over it.
    const timed = await createPageFor(store, folderId, { date: '2026-09-29', time: '10:00' });
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-29', time: '10:00' })).page.id).toBe(timed.id);
  });

  it('opens the written page before an empty one, and an empty one before making another', async () => {
    const { store, folderId } = await setup();
    // Write note made a 09:00 page that was typed in and emptied; the note went on a page without a time.
    const empty = await createPageFor(store, folderId, { date: '2026-09-21', time: '09:00' });
    const written = await store.put('page', { folder_id: folderId, date: '2026-09-21', time: null, duration_min: null, template: 'free', title: '', sections: { body: 'Talked about her mother' }, process_note: '', import_provenance: null });
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-21', time: '09:00' })).page.id).toBe(written.id);
    // Two pages without a time: the older one is empty.
    const older = await createPageFor(store, folderId, { date: '2026-09-22' });
    const newer = await store.put('page', { folder_id: folderId, date: '2026-09-22', time: null, duration_min: null, template: 'free', title: '', sections: { body: 'Sleeps badly' }, process_note: '', import_provenance: null });
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-22', time: '10:00' })).page.id).toBe(newer.id);
    // An empty page with a document attached counts as written.
    await store.put('attachment', { folder_id: folderId, page_id: older.id, filename: 'scan.png', mime: 'image/png', size: 1, blob_id: 'b', sha256: 'x', local_only: false, source: 'scan', ocr_text: null });
    expect((await findOrCreatePageFor(store, folderId, { date: '2026-09-22', time: '10:00' })).page.id).toBe(older.id);
    // With only an empty page, it is opened again rather than a second one made.
    await store.remove('page', [written.id]);
    expect(await findOrCreatePageFor(store, folderId, { date: '2026-09-21', time: '09:00' })).toMatchObject({ created: false, page: { id: empty.id } });
  });

  it('ignores deleted pages and other folders', async () => {
    const { store, folderId } = await setup();
    const gone = await createPageFor(store, folderId, { date: '2026-09-28' });
    await store.remove('page', [gone.id]);
    const elsewhere = await createPageFor(store, 'another-folder', { date: '2026-09-28' });
    const found = await findOrCreatePageFor(store, folderId, { date: '2026-09-28' });
    expect(found.created).toBe(true);
    expect([gone.id, elsewhere.id]).not.toContain(found.page.id);
  });

  it('dates new pages in the practice time zone', async () => {
    const { store, folderId } = await setup();
    // 12:00 UTC on 30 September is already 1 October in Kiritimati (UTC+14).
    Settings.now = () => Date.UTC(2026, 8, 30, 12, 0);
    await setSetting(store, SETTING.timeZone, 'Pacific/Kiritimati');
    expect((await createPageFor(store, folderId)).date).toBe('2026-10-01');
    expect((await findOrCreatePageFor(store, folderId, { tz: 'America/Los_Angeles' })).page.date).toBe('2026-09-30');
  });

  it('dates a session booked in another time zone as Today does, in the practice zone', async () => {
    const { store, folderId } = await setup();
    // Booked at 10:00 in Madrid (an imported calendar), the practice is in Lisbon: 09:00 there.
    const start = DateTime.fromISO('2026-09-21T10:00', { zone: 'Europe/Madrid' });
    const first = await findOrCreatePageFor(store, folderId, { start, tz: 'Europe/Lisbon', duration: 50 });
    expect(first.page).toMatchObject({ date: '2026-09-21', time: '09:00' });
    expect(first.page.time).toBe(sessionSlot({ start }, 'Europe/Lisbon').time);
    // The same session from Today's card finds that page.
    const today = await findOrCreatePageFor(store, folderId, { date: '2026-09-21', time: '09:00' });
    expect(today).toMatchObject({ created: false, page: { id: first.page.id } });
  });
});

describe('pageMatchesSession', () => {
  it('compares dates, and times when both exist', () => {
    expect(pageMatchesSession({ date: '2026-09-28', time: null }, '2026-09-28', '09:00')).toBe(true);
    expect(pageMatchesSession({ date: '2026-09-28', time: '09:00' }, '2026-09-28', null)).toBe(true);
    expect(pageMatchesSession({ date: '2026-09-28', time: '09:00' }, '2026-09-28', '10:00')).toBe(false);
    expect(pageMatchesSession({ date: '2026-09-27', time: null }, '2026-09-28', null)).toBe(false);
  });
});

describe('new page templates', () => {
  it('starts a folder’s first page with Intake, later ones with the chosen default', async () => {
    const { store, folderId } = await setup();
    const first = await findOrCreatePageFor(store, folderId, { date: '2026-09-21', time: '09:00' });
    expect(first.page.template).toBe('intake');
    forgetFreshPage(first.page.id); // written in
    expect((await createPageFor(store, folderId, { date: '2026-09-28' })).template).toBe('free');
    await setSetting(store, DEFAULT_TEMPLATE_SETTING, 'dap');
    expect((await createPageFor(store, folderId, { date: '2026-10-05' })).template).toBe('dap');
    expect((await createPageFor(store, folderId, { date: '2026-10-12', template: 'soap' })).template).toBe('soap');
  });

  it('does not count a new page nobody has written in yet', async () => {
    const { store, folderId } = await setup();
    // New page pressed twice: the first, left empty, goes away; the one kept is still Intake.
    const a = await createPageFor(store, folderId, { date: '2026-09-28' });
    const b = await createPageFor(store, folderId, { date: '2026-09-28' });
    expect([a.template, b.template]).toEqual(['intake', 'intake']);
    forgetFreshPage(b.id);
    expect((await createPageFor(store, folderId, { date: '2026-10-05' })).template).toBe('free');
  });

  it('remembers pages created since Sala was opened', async () => {
    const { store, folderId } = await setup();
    const page = await createPageFor(store, folderId);
    expect(isFreshPage(page.id)).toBe(true);
    await deletePage(store, page.id);
    expect(isFreshPage(page.id)).toBe(false);
  });
});

describe('sessionNumbers', () => {
  it('counts by date and time, whatever order the pages come in', () => {
    const p = (id: string, date: string, time: string | null, created_at = '2026-01-01T00:00:00Z') => ({ id, date, time, created_at });
    const numbers = sessionNumbers([p('c', '2026-09-21', '18:00'), p('a', '2026-09-07', '09:00'), p('b', '2026-09-21', null), p('d', '2026-09-21', '09:00')]);
    expect([...numbers.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(['a', 'b', 'd', 'c']);
  });
});

describe('deletePage', () => {
  it('deletes the page and its notes, moves its files to Documents, and is undone completely', async () => {
    const { store, folderId } = await setup();
    const page = await createPageFor(store, folderId, { date: '2026-09-21' });
    const note = await store.put('sticky', { folder_id: folderId, page_id: page.id, text: 'Homework', colour: 'yellow', next_session: false, origin: 'therapist', state: 'stuck', peeled_at: null });
    const file = await store.put('attachment', {
      folder_id: folderId, page_id: page.id, filename: 'scan.png', mime: 'image/png', size: 1, blob_id: 'b', sha256: '', local_only: false, source: 'scan', ocr_text: null,
    });

    const deleted = await deletePage(store, page.id);
    expect((await store.get('page', page.id))?.deleted).toBe(true);
    expect((await store.get('sticky', note.id))?.deleted).toBe(true);
    expect(await store.get('attachment', file.id)).toMatchObject({ deleted: false, page_id: null });
    expect(deleted.movedAttachmentIds).toEqual([file.id]);

    expect(await undeletePage(store, deleted)).toBe(0);
    expect((await store.get('page', page.id))?.deleted).toBe(false);
    expect((await store.get('sticky', note.id))?.deleted).toBe(false);
    expect((await store.get('attachment', file.id))?.page_id).toBe(page.id);
  });

  it('brings back the files and the other notes when one note no longer passes its checks', async () => {
    const { store, folderId } = await setup();
    const page = await createPageFor(store, folderId, { date: '2026-09-21' });
    const note = (text: string) => store.put('sticky', { folder_id: folderId, page_id: page.id, text, colour: 'yellow', next_session: false, origin: 'therapist', state: 'stuck', peeled_at: null });
    const good = await note('Homework');
    const bad = await note('Too long');
    // Written by an older Sala, or merged from a file: longer than a note may be today.
    await store.merge([{ kind: 'sticky', record: { ...bad, text: 'x'.repeat(400), updated_at_hlc: later(bad.updated_at_hlc) } }]);
    const file = await store.put('attachment', {
      folder_id: folderId, page_id: page.id, filename: 'scan.png', mime: 'image/png', size: 1, blob_id: 'b', sha256: '', local_only: false, source: 'scan', ocr_text: null,
    });

    const deleted = await deletePage(store, page.id);
    expect(await undeletePage(store, deleted)).toBe(1);
    expect((await store.get('page', page.id))?.deleted).toBe(false);
    expect((await store.get('sticky', good.id))?.deleted).toBe(false);
    expect((await store.get('sticky', bad.id))?.deleted).toBe(true);
    expect((await store.get('attachment', file.id))?.page_id).toBe(page.id);
  });
});

/** A write stamp just after `hlc`, so a merged copy wins. */
function later(hlc: string): string {
  const p = parseHlc(hlc);
  return formatHlc({ ...p, ms: p.ms + 1 });
}
