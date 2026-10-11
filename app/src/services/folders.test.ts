import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { occurrencesIn } from '../core/calendar/occurrences';
import { formatHlc, parseHlc } from '../core/hlc';
import { type Draft, emptyContact } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { archiveFolder, deleteFolder, futureAppointments, planEnd, restoreRemoved, unarchiveFolder, undoArchive } from './folders';
import { restoreEach } from './trash';

const TZ = 'Europe/Lisbon';
// Monday 28 September 2026, 17:00: the 09:00 session of that day has happened.
const NOW = DateTime.fromISO('2026-09-28T17:00', { zone: TZ });

const appt = (folderId: string, start: string, more: Partial<Draft<'appointment'>> = {}): Draft<'appointment'> => ({
  folder_id: folderId, title: '', type_id: null, start_local: start, tz: TZ, duration_min: 50, repeat: null,
  location: '', status: 'confirmed', note: '', series_id: null, ...more,
});
const weekly = (until: string | null = null, interval_weeks: 1 | 2 = 1) => ({ interval_weeks, until, exceptions: [] as string[] });

async function setup() {
  const store = await Store.open(await SqlJsDb.create());
  const folder = await store.put('folder', {
    label: 'Inês S.', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
  });
  return { store, folderId: folder.id };
}

const sticky = (folderId: string, text: string, next: boolean, pageId: string | null = null): Draft<'sticky'> => ({
  folder_id: folderId, page_id: pageId, text, colour: 'yellow', next_session: next, origin: 'therapist', state: 'stuck', peeled_at: null,
});

describe('futureAppointments and planEnd', () => {
  it('ends a running series before its next date, removes one not yet started and cancels future one-offs', async () => {
    const { store, folderId } = await setup();
    const running = await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    const later = await store.put('appointment', appt(folderId, '2026-10-05T11:00', { repeat: weekly(null, 2) }));
    const ended = await store.put('appointment', appt(folderId, '2026-08-03T09:00', { repeat: weekly('2026-08-31') }));
    const single = await store.put('appointment', appt(folderId, '2026-10-10T10:00'));
    const past = await store.put('appointment', appt(folderId, '2026-09-28T09:00'));
    const cancelled = await store.put('appointment', appt(folderId, '2026-10-12T10:00', { status: 'cancelled' }));

    const future = futureAppointments([running, later, ended, single, past, cancelled], NOW);
    expect(future.series.map((a) => a.id).sort()).toEqual([running.id, later.id].sort());
    expect(future.singles.map((a) => a.id)).toEqual([single.id]);

    const plan = planEnd(future, NOW);
    // Today's 09:00 has happened, so the series stops on the day before next Monday.
    expect(plan.end).toEqual([{ id: running.id, until: '2026-10-04' }]);
    expect(plan.remove).toEqual([later.id]);
    expect(plan.cancel).toEqual([single.id]);
  });

  it('keeps a session that is under way', () => {
    const now = DateTime.fromISO('2026-09-28T09:20', { zone: TZ });
    const running = { ...appt('f', '2026-09-28T09:00', { repeat: weekly() }), id: 'a', created_at: '', updated_at_hlc: '', deleted: false };
    expect(planEnd(futureAppointments([running], now), now)).toEqual({ end: [{ id: 'a', until: '2026-10-04' }], remove: [], cancel: [] });
  });
});

describe('archiveFolder', () => {
  it('archives, ends future sessions without touching past ones, and peels next-session notes', async () => {
    const { store, folderId } = await setup();
    const series = await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    const fresh = await store.put('appointment', appt(folderId, '2026-10-05T11:00', { repeat: weekly() }));
    const single = await store.put('appointment', appt(folderId, '2026-10-10T10:00'));
    const next = await store.put('sticky', sticky(folderId, 'Ask about the diary', true));
    const keep = await store.put('sticky', sticky(folderId, 'Mother’s surgery', false));
    const pastBefore = occurrencesIn(await store.list('appointment'), NOW.minus({ weeks: 6 }), NOW).map((o) => o.start.toISO());

    await archiveFolder(store, folderId, { endSessions: true, peelNotes: true, now: NOW });

    expect(await store.get('folder', folderId)).toMatchObject({ status: 'archived', archived_at: '2026-09-28T16:00:00.000Z' });
    const appts = await store.list('appointment');
    expect(occurrencesIn(appts, NOW, NOW.plus({ months: 6 })).filter((o) => o.appointment.status !== 'cancelled')).toEqual([]);
    expect(occurrencesIn(appts, NOW.minus({ weeks: 6 }), NOW).map((o) => o.start.toISO())).toEqual(pastBefore);
    expect((await store.get('appointment', series.id))?.repeat?.until).toBe('2026-10-04');
    expect((await store.get('appointment', fresh.id))?.deleted).toBe(true);
    expect((await store.get('appointment', single.id))?.status).toBe('cancelled');
    expect(await store.get('sticky', next.id)).toMatchObject({ state: 'peeled' });
    expect(await store.get('sticky', keep.id)).toMatchObject({ state: 'stuck' });
  });

  it('leaves sessions and notes alone when asked to', async () => {
    const { store, folderId } = await setup();
    const series = await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    const note = await store.put('sticky', sticky(folderId, 'Ask about the diary', true));
    await archiveFolder(store, folderId, { endSessions: false, peelNotes: false, now: NOW });
    expect((await store.get('appointment', series.id))?.updated_at_hlc).toBe(series.updated_at_hlc);
    expect((await store.get('sticky', note.id))?.state).toBe('stuck');
  });

  it('is undone completely, and taking a folder out of the archive leaves ended sessions as they are', async () => {
    const { store, folderId } = await setup();
    const series = await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    const fresh = await store.put('appointment', appt(folderId, '2026-10-05T11:00', { repeat: weekly() }));
    const single = await store.put('appointment', appt(folderId, '2026-10-10T10:00'));
    const note = await store.put('sticky', sticky(folderId, 'Ask about the diary', true));

    const undo = await archiveFolder(store, folderId, { endSessions: true, peelNotes: true, now: NOW });
    await undoArchive(store, undo);
    expect(await store.get('folder', folderId)).toMatchObject({ status: 'active', archived_at: null });
    expect((await store.get('appointment', series.id))?.repeat?.until).toBeNull();
    expect(await store.get('appointment', fresh.id)).toMatchObject({ deleted: false });
    expect((await store.get('appointment', single.id))?.status).toBe('confirmed');
    expect(await store.get('sticky', note.id)).toMatchObject({ state: 'stuck', peeled_at: null });

    await archiveFolder(store, folderId, { endSessions: true, peelNotes: true, now: NOW });
    await unarchiveFolder(store, folderId);
    expect(await store.get('folder', folderId)).toMatchObject({ status: 'active', archived_at: null });
    expect((await store.get('appointment', series.id))?.repeat?.until).toBe('2026-10-04');
    expect((await store.get('appointment', single.id))?.status).toBe('cancelled');
  });
});

describe('archiveFolder with records saved by an older Sala', () => {
  it('archives and leaves alone a note it cannot peel', async () => {
    const { store, folderId } = await setup();
    const note = await store.put('sticky', sticky(folderId, 'Ask about sleep', true));
    await store.merge([{ kind: 'sticky', record: { ...note, text: 'x'.repeat(400), updated_at_hlc: later(note.updated_at_hlc) } }]);
    const fresh = await store.put('appointment', appt(folderId, '2026-10-05T11:00', { repeat: weekly() }));

    const undo = await archiveFolder(store, folderId, { endSessions: true, peelNotes: true, now: NOW });
    expect((await store.get('folder', folderId))?.status).toBe('archived');
    expect((await store.get('sticky', note.id))?.state).toBe('stuck');
    expect((await store.get('appointment', fresh.id))?.deleted).toBe(true);
    expect(await undoArchive(store, undo)).toBe(0);
    expect((await store.get('appointment', fresh.id))?.deleted).toBe(false);
  });

  it('changes nothing when the folder itself cannot be archived', async () => {
    const { store, folderId } = await setup();
    const folder = (await store.get('folder', folderId))!;
    await store.merge([{ kind: 'folder', record: { ...folder, label: 'x'.repeat(200), updated_at_hlc: later(folder.updated_at_hlc) } }]);
    const fresh = await store.put('appointment', appt(folderId, '2026-10-05T11:00', { repeat: weekly() }));

    await expect(archiveFolder(store, folderId, { endSessions: true, peelNotes: true, now: NOW })).rejects.toThrow();
    expect((await store.get('folder', folderId))?.status).toBe('active');
    expect((await store.get('appointment', fresh.id))?.deleted).toBe(false);
  });
});

describe('deleteFolder', () => {
  it('deletes the folder and everything in it as one batch, and restores it all', async () => {
    const { store, folderId } = await setup();
    const other = await store.put('folder', { ...(await store.get('folder', folderId))!, id: undefined, label: 'Rui M.' });
    const page = await store.put('page', {
      folder_id: folderId, date: '2026-09-21', time: null, duration_min: null, template: 'free', title: '', sections: { body: 'Notes' }, process_note: '', import_provenance: null,
    });
    await store.put('sticky', sticky(folderId, 'On the cover', false));
    await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    await store.put('attachment', {
      folder_id: folderId, page_id: page.id, filename: 'letter.pdf', mime: 'application/pdf', size: 1, blob_id: 'b', sha256: '', local_only: false, source: 'upload', ocr_text: null,
    });
    await store.put('sticky', sticky(other.id, 'Someone else', false));

    const removed = await deleteFolder(store, folderId);
    for (const kind of ['folder', 'page', 'sticky', 'appointment', 'attachment'] as const) {
      const gone = await store.listDeleted(kind, 0);
      expect(gone.length).toBe(1);
      expect(gone[0]!.deleted_batch).toBe(removed.batch);
    }
    expect(await store.count('sticky')).toBe(1);

    expect(await restoreRemoved(store, removed)).toBe(0);
    expect(await store.count('folder')).toBe(2);
    expect(await store.count('page')).toBe(1);
    expect(await store.count('sticky')).toBe(2);
    expect(await store.count('appointment')).toBe(1);
    expect(await store.count('attachment')).toBe(1);
  });

  it('brings back everything else when one record no longer passes its checks', async () => {
    const { store, folderId } = await setup();
    // A series saved before Sala checked that it ends on or after its start.
    const bad = await store.put('appointment', appt(folderId, '2026-09-07T09:00', { repeat: weekly() }));
    await store.merge([{ kind: 'appointment', record: { ...bad, repeat: weekly('2026-09-01'), updated_at_hlc: later(bad.updated_at_hlc) } }]);
    const good = await store.put('appointment', appt(folderId, '2026-10-10T10:00'));
    await store.put('attachment', {
      folder_id: folderId, page_id: null, filename: 'letter.pdf', mime: 'application/pdf', size: 1, blob_id: 'b', sha256: '', local_only: false, source: 'upload', ocr_text: null,
    });

    const removed = await deleteFolder(store, folderId);
    expect(await restoreRemoved(store, removed)).toBe(1);
    expect(await store.count('folder')).toBe(1);
    expect(await store.count('attachment')).toBe(1);
    expect((await store.get('appointment', good.id))?.deleted).toBe(false);
    expect((await store.get('appointment', bad.id))?.deleted).toBe(true);
  });
});

describe('restoreEach', () => {
  it('restores all it can and names the ones left deleted', async () => {
    const { store, folderId } = await setup();
    const a = await store.put('sticky', sticky(folderId, 'One', false));
    const b = await store.put('sticky', sticky(folderId, 'Two', false));
    await store.merge([{ kind: 'sticky', record: { ...b, text: 'x'.repeat(400), updated_at_hlc: later(b.updated_at_hlc) } }]);
    await store.remove('sticky', [a.id, b.id]);
    expect(await restoreEach(store, 'sticky', [a.id, b.id])).toEqual([b.id]);
    expect((await store.get('sticky', a.id))?.deleted).toBe(false);
    expect(await restoreEach(store, 'sticky', [])).toEqual([]);
  });
});

/** A write stamp just after `hlc`, so a merged copy wins. */
function later(hlc: string): string {
  const p = parseHlc(hlc);
  return formatHlc({ ...p, ms: p.ms + 1 });
}
