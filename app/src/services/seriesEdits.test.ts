import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { occurrencesIn } from '../core/calendar/occurrences';
import { type AppointmentForm, changedFields, formOf, scopesFor, type SeriesScope } from '../core/calendar/series';
import { type Appointment, emptyContact } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { deleteSeriesDates, saveSeriesEdit } from './seriesEdits';

const TZ = 'Europe/Lisbon';

async function setup() {
  let ms = Date.parse('2026-12-01T12:00:00Z');
  const store = await Store.open(await SqlJsDb.create(), { now: () => new Date((ms += 1000)) });
  const folder = (label: string) =>
    store.put('folder', { label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
  const A = await folder('Ana Dias');
  const B = await folder('Bruno Reis');
  const names = new Map([[A.id, 'A'], [B.id, 'B']]);
  return { store, A, B, names };
}

const get = async (store: Store, id: string) => (await store.get('appointment', id))!;

/** The record holding `who`'s session on `date`, and that date. */
async function at(store: Store, names: Map<string, string>, date: string, who: string): Promise<{ appointment: Appointment; date: string }> {
  const day = DateTime.fromISO(date, { zone: TZ });
  const hits = occurrencesIn(await store.list('appointment'), day, day.plus({ days: 1 })).filter((o) => names.get(o.appointment.folder_id ?? '') === who);
  if (hits.length !== 1) throw new Error(`${hits.length} sessions of ${who} on ${date}`);
  return { appointment: hits[0]!.appointment, date: hits[0]!.date };
}

/** What the dialog does on Save for one date of a series, with the scope picked. */
async function edit(store: Store, series: Appointment, date: string, change: (f: AppointmentForm) => AppointmentForm, scope: SeriesScope) {
  const before = formOf(series, date);
  const after = change(before);
  const offered = scopesFor(series, date, changedFields(before, after), after);
  if (!offered.includes(scope)) throw new Error(`${scope} is not offered: ${offered.join(', ')}`);
  return saveSeriesEdit(store, series, date, after, scope);
}

/** Every session from September to January, as the calendar shows them. */
async function calendar(store: Store, names: Map<string, string>): Promise<string[]> {
  const occ = occurrencesIn(await store.list('appointment'), DateTime.fromISO('2026-09-01', { zone: TZ }), DateTime.fromISO('2027-01-15', { zone: TZ }));
  return occ.map((o) => `${o.start.setZone(TZ).toFormat('yyyy-MM-dd HH:mm')} ${names.get(o.appointment.folder_id ?? '')}${o.appointment.status === 'confirmed' ? '' : ` ${o.appointment.status}`}`);
}

/** The live records without their stamps: what Undo must put back exactly. */
async function records(store: Store) {
  return (await store.list('appointment'))
    .map(({ updated_at_hlc: _h, created_at: _c, ...rest }) => rest)
    .sort((x, y) => x.id.localeCompare(y.id));
}

/**
 * Weekly on Thursdays at 09:00 from 3 Sep, 18:00 from 5 Nov on (a later part); 17 Sep done,
 * 15 Oct moved to the 16th, 22 Oct and 26 Nov cancelled, 3 Dec moved to the 4th at 10:00.
 */
async function family(store: Store, folderId: string) {
  const s1 = await store.put('appointment', {
    folder_id: folderId, title: '', type_id: null, start_local: '2026-09-03T09:00', tz: TZ, duration_min: 50,
    repeat: { interval_weeks: 1, until: null, exceptions: [] }, location: '', status: 'confirmed', note: '', series_id: null,
  });
  await edit(store, await get(store, s1.id), '2026-11-05', (f) => ({ ...f, time: '18:00' }), 'following');
  const s2 = (await store.list('appointment')).find((a) => a.id !== s1.id)!;
  await edit(store, await get(store, s1.id), '2026-09-17', (f) => ({ ...f, status: 'done' }), 'one');
  await edit(store, await get(store, s1.id), '2026-10-15', (f) => ({ ...f, date: '2026-10-16' }), 'one');
  await edit(store, await get(store, s1.id), '2026-10-22', (f) => ({ ...f, status: 'cancelled' }), 'one');
  await edit(store, await get(store, s2.id), '2026-11-26', (f) => ({ ...f, status: 'cancelled' }), 'one');
  await edit(store, await get(store, s2.id), '2026-12-03', (f) => ({ ...f, date: '2026-12-04', time: '10:00' }), 'one');
  return { s1: s1.id, s2: s2.id };
}

describe('Undo after a change to a repeating appointment', () => {
  it('is offered only when the change cannot simply be changed back', async () => {
    const { store, A } = await setup();
    const ids = await family(store, A.id);
    expect(await edit(store, await get(store, ids.s1), '2026-10-08', (f) => ({ ...f, time: '10:00' }), 'following')).toBeNull();
    expect(await edit(store, await get(store, ids.s1), '2026-10-01', (f) => ({ ...f, note: 'Room 3' }), 'all')).toBeNull();
  });

  it.each([
    ['only this date', '2026-10-08', 'one'],
    ['this and following dates', '2026-10-08', 'following'],
    ['every date', '2026-10-08', 'all'],
  ] as const)('puts back a hand-over to another patient with %s', async (_, date, scope) => {
    const { store, A, B, names } = await setup();
    const ids = await family(store, A.id);
    const before = await records(store);
    const shown = await calendar(store, names);
    const undo = await edit(store, await get(store, ids.s1), date, (f) => ({ ...f, folder_id: B.id }), scope);
    expect(await calendar(store, names)).not.toEqual(shown);
    await undo!();
    expect(await records(store)).toEqual(before);
  });

  it('puts back a hand-over with every date made on the first date of the later part', async () => {
    const { store, A, B, names } = await setup();
    const ids = await family(store, A.id);
    const before = await records(store);
    const undo = await edit(store, await get(store, ids.s2), '2026-11-05', (f) => ({ ...f, folder_id: B.id }), 'all');
    // The earlier part stays with the first patient.
    expect((await calendar(store, names)).filter((s) => s.startsWith('2026-10-29'))).toEqual(['2026-10-29 09:00 A']);
    await undo!();
    expect(await records(store)).toEqual(before);
  });

  it('puts back what giving the sessions back by hand would not', async () => {
    const { store, A, B, names } = await setup();
    const ids = await family(store, A.id);
    const shown = await calendar(store, names);
    await edit(store, await get(store, ids.s1), '2026-10-08', (f) => ({ ...f, folder_id: B.id }), 'following');
    // Changing the folder back gives back a series that starts afresh: the cancelled and moved dates come back as booked.
    const theirs = await at(store, names, '2026-10-08', 'B');
    await edit(store, theirs.appointment, theirs.date, (f) => ({ ...f, folder_id: A.id }), 'all');
    expect(await calendar(store, names)).toContain('2026-10-22 09:00 A');
    expect(await calendar(store, names)).not.toEqual(shown);

    // With Undo instead, the calendar is as it was.
    const again = await setup();
    const ids2 = await family(again.store, again.A.id);
    const before = await records(again.store);
    const undo = await edit(again.store, await get(again.store, ids2.s1), '2026-10-08', (f) => ({ ...f, folder_id: again.B.id }), 'following');
    await undo!();
    expect(await records(again.store)).toEqual(before);
  });

  it('keeps the first patient’s dates taken out of a later part given away in their series', async () => {
    const { store, A, B, names } = await setup();
    const ids = await family(store, A.id);
    await edit(store, await get(store, ids.s1), '2026-10-08', (f) => ({ ...f, folder_id: B.id }), 'following');
    expect((await calendar(store, names)).filter((s) => s.endsWith('A') || s.includes(' A '))).toContain('2026-12-04 10:00 A');
    // Ending the first patient's therapy from 24 Sep reaches them.
    await deleteSeriesDates(store, await get(store, ids.s1), '2026-09-24', 'following');
    expect((await calendar(store, names)).filter((s) => s >= '2026-09-24' && / A( |$)/.test(s))).toEqual([]);
  });

  it('puts back a repeat stopped from a date', async () => {
    const { store, A } = await setup();
    const ids = await family(store, A.id);
    const before = await records(store);
    const undo = await edit(store, await get(store, ids.s1), '2026-10-01', (f) => ({ ...f, interval: null }), 'following');
    await undo!();
    expect(await records(store)).toEqual(before);
  });
});
