import { hasDates } from '../core/calendar/occurrences';
import {
  type AppointmentForm, editSeries, endFrom, firstDateOf, type PartChange, type Removal, removeDates, type SeriesScope, seriesFamily, toDraft,
  undoChange, withFamily, withLaterParts,
} from '../core/calendar/series';
import { uuid } from '../core/ids';
import type { Appointment, Base, Draft } from '../core/model/types';
import { addDays } from '../core/text/dates';
import type { Store } from '../core/store/store';
import { eraseUnused } from './trash';

// The writes behind a change or a delete of a repeating appointment, made from the appointment
// dialog, and the Undo that puts them back. The drafts themselves come from core/calendar/series.

const write = (store: Store, drafts: Draft<'appointment'>[]): Promise<Base[]> =>
  drafts.length ? store.putMany(drafts.map((draft) => ({ kind: 'appointment' as const, draft }))) : Promise.resolve([]);

/** Every appointment, deleted ones too: they still link the parts of a series. */
const allAppointments = (store: Store) => store.list('appointment', { includeDeleted: true });

/** Writes a removal: the series that keep some dates, then the records deleted whole, as one delete. */
async function writeRemoval(store: Store, r: Removal): Promise<void> {
  await write(store, r.write);
  if (r.remove.length) await store.remove('appointment', r.remove, { batch: uuid() });
}

/** Puts back what a removal changed, leaving anything changed since then. */
async function undoRemoval(store: Store, r: Removal, extra: PartChange[] = []): Promise<void> {
  if (r.remove.length) await store.restore('appointment', r.remove);
  const back: Draft<'appointment'>[] = [];
  for (const change of [...r.changes, ...extra]) {
    const now = await store.get('appointment', change.id);
    const draft = now ? undoChange(now, change) : null;
    if (draft) back.push(draft);
  }
  await write(store, back);
}

/** Removes dates of a repeating appointment opened on `date` (see `removeDates`); returns its Undo. */
export async function deleteSeriesDates(store: Store, series: Appointment, date: string, scope: SeriesScope): Promise<() => Promise<void>> {
  const removal = removeDates(series, date, scope, await allAppointments(store));
  await writeRemoval(store, removal);
  return () => undoRemoval(store, removal);
}

/**
 * Saves a change to one date of a repeating appointment, in the chosen scope. Returns its Undo
 * when the change stopped the repeat or gave dates to another patient, else null: changing the
 * fields back puts any other change right, but not these. Stopping removes the later dates, and
 * a series given to another patient starts without the dates the first patient had moved,
 * cancelled or skipped, so changing the folder back would bring those back as booked.
 */
export async function saveSeriesEdit(
  store: Store, series: Appointment, date: string, current: AppointmentForm, scope: SeriesScope,
): Promise<(() => Promise<void>) | null> {
  if (!series.repeat) throw new Error('not a series');
  // New records get their ids here: a hand-over links to them, and Undo takes them away.
  const fresh = new Set<string>();
  const drafts = editSeries(series, date, current, scope).map((d) => {
    if (d.id) return d;
    const id = uuid();
    fresh.add(id);
    return { ...d, id };
  });
  // "This and following" from a later date ends the series and starts a new one (`splitSeries`).
  const split = scope === 'following' && date > firstDateOf(series);
  // Stopping the repeat keeps this date and the ones before it: every later date goes, in
  // the other parts of the series and the dates taken out of it too.
  const stops = current.interval === null;
  const handedOver = current.folder_id !== series.folder_id;
  // A series left without any date (every earlier one skipped) goes rather than stays empty.
  const empty = drafts.filter((d) => d.id && !hasDates(d)).map((d) => d.id!);
  const removal: Removal = { write: drafts.filter((d) => !d.id || !empty.includes(d.id)), changes: [], remove: empty };
  /** Other records given to the other patient, or linked anew, as they were before, for Undo. */
  const given = new Map<string, Draft<'appointment'>>();
  const all = stops || handedOver ? await allAppointments(store) : [];
  if (stops) {
    const others = endFrom(seriesFamily(series, all).filter((a) => a.id !== series.id), addDays(date, 1));
    removal.write.push(...others.write);
    removal.changes.push(...others.changes);
    removal.remove.push(...others.remove);
  }
  if (handedOver) {
    // Another patient: the rest of the repeating appointment from here on goes with it.
    // On the first date of a later part, "every date" is this date and the following ones:
    // the earlier parts stay with the first patient.
    const later = series.series_id && date <= firstDateOf(series) ? date : undefined;
    const head = split ? [...fresh][0] : undefined;
    const handed = scope === 'all' ? withFamily(series, removal.write, all, later) : head ? withLaterParts(series, date, removal.write, head, all) : removal.write;
    removal.write = handed.filter((d) => !d.id || !removal.remove.includes(d.id));
    const byId = new Map(all.map((a) => [a.id, a]));
    for (const d of removal.write) {
      const was = d.id && d.id !== series.id ? byId.get(d.id) : undefined;
      if (was && (was.folder_id !== d.folder_id || was.series_id !== d.series_id)) given.set(was.id, toDraft(was));
    }
  }
  const saved = await write(store, removal.write);
  if (removal.remove.length) await store.remove('appointment', removal.remove, { batch: uuid() });
  if (!stops && !handedOver) return null;

  const before = toDraft(series);
  const rewritten = saved.find((r) => r.id === series.id);
  const created = saved.filter((r) => fresh.has(r.id)).map((r) => r.id);
  const { until, exceptions } = series.repeat;
  return async () => {
    // What the change made goes again without a trace: nothing to find in Recently deleted.
    await eraseUnused(store, 'appointment', created);
    // What was given to the other patient goes back as it was, unless changed again since.
    const back: Draft<'appointment'>[] = [];
    for (const [id, was] of given) {
      const now = await store.get('appointment', id);
      const then = saved.find((r) => r.id === id);
      if (now && !now.deleted && then && now.updated_at_hlc === then.updated_at_hlc) back.push(was);
    }
    await write(store, back);
    const restored = new Set(back.map((d) => d.id));
    await undoRemoval(
      store,
      { ...removal, write: [], changes: removal.changes.filter((c) => !restored.has(c.id)) },
      split && rewritten ? [{ id: series.id, until, added: [], dropped: exceptions.filter((e) => e >= date) }] : [],
    );
    // Otherwise the series itself was rewritten (it became one appointment, took the change, or
    // let go of this date): put it back as it was, unless it has been changed again since.
    if (!split && rewritten) {
      const now = await store.get('appointment', series.id);
      if (now && !now.deleted && now.updated_at_hlc === rewritten.updated_at_hlc) await store.put('appointment', before);
    }
  };
}
