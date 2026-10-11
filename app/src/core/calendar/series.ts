import { DateTime } from 'luxon';
import type { Appointment, AppointmentStatus, Draft } from '../model/types';
import { addDays } from '../text/dates';
import { hasDates } from './occurrences';

// Changes to repeating appointments. A series is one record with a weekly or fortnightly
// repeat; a date taken out of it is listed in `repeat.exceptions`. Changing one date puts a
// single appointment in its place (`series_id` = the series), and changing "this and
// following dates" ends the series the day before and starts a new one (`series_id` = the
// old series). Everything here is pure: it returns the drafts to write.

/**
 * Kept in the record data of a single date taken out of a series: where that date sat in the
 * series (yyyy-MM-ddTHH:mm) when it was taken out. The date is "moved" when it no longer
 * starts there; one only marked done or cancelled is not, whatever later happens to the series.
 */
export interface DetachedInfo {
  series_start?: string;
}

/** Where a single date taken out of a series sat in it, if known. */
export const seriesStartOf = (a: Appointment): string | null => (a as Appointment & DetachedInfo).series_start ?? null;

/** Which dates of a series a change applies to. */
export type SeriesScope = 'one' | 'following' | 'all';

/** What the appointment dialog edits: the appointment's fields, its start split into date and time. */
export interface AppointmentForm {
  folder_id: string | null;
  title: string;
  type_id: string | null;
  /** yyyy-MM-dd, in the appointment's time zone. */
  date: string;
  /** HH:mm */
  time: string;
  duration_min: number;
  /** Weeks between dates, or null for a single appointment. */
  interval: 1 | 2 | null;
  /** Last date of a series (inclusive), or null to repeat until stopped. */
  until: string | null;
  location: string;
  status: AppointmentStatus;
  note: string;
}

export type FormField = keyof AppointmentForm;

const FIELDS: FormField[] = ['folder_id', 'title', 'type_id', 'date', 'time', 'duration_min', 'interval', 'until', 'location', 'status', 'note'];

export const firstDateOf = (a: Pick<Appointment, 'start_local'>): string => a.start_local.slice(0, 10);
export const timeOf = (a: Pick<Appointment, 'start_local'>): string => a.start_local.slice(11, 16);

/** The form for an appointment, on one of its dates (a series' first date when none is given). */
export function formOf(a: Appointment, date: string = firstDateOf(a)): AppointmentForm {
  return {
    folder_id: a.folder_id,
    title: a.title,
    type_id: a.type_id,
    date,
    time: timeOf(a),
    duration_min: a.duration_min,
    interval: a.repeat?.interval_weeks ?? null,
    until: a.repeat?.until ?? null,
    location: a.location,
    status: a.status,
    note: a.note,
  };
}

/** The fields that differ between two forms. Text is compared trimmed, as it is saved. */
export function changedFields(before: AppointmentForm, after: AppointmentForm): FormField[] {
  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
  return FIELDS.filter((f) => norm(before[f]) !== norm(after[f]));
}

/** A stored appointment as a draft that replaces it (same id). */
export function toDraft(a: Appointment): Draft<'appointment'> {
  const { created_at: _c, updated_at_hlc: _h, deleted: _d, ...rest } = a;
  return { ...rest, repeat: a.repeat ? { ...a.repeat, exceptions: [...a.repeat.exceptions] } : null };
}

/** Whole days from one ISO date to another. */
export function daysBetween(from: string, to: string): number {
  const f = DateTime.fromISO(from, { zone: 'utc' });
  const t = DateTime.fromISO(to, { zone: 'utc' });
  return Math.round(t.diff(f, 'days').days);
}

const sortedUnique = (dates: string[]) => [...new Set(dates)].sort();

/** The form's fields as an appointment draft, on the form's date and time. */
export function fromForm(form: AppointmentForm, tz: string, exceptions: string[] = [], series_id: string | null = null): Draft<'appointment'> {
  return {
    folder_id: form.folder_id,
    title: form.title.trim(),
    type_id: form.type_id,
    start_local: `${form.date}T${form.time}`,
    tz,
    duration_min: form.duration_min,
    repeat: form.interval ? { interval_weeks: form.interval, until: form.until, exceptions: sortedUnique(exceptions) } : null,
    location: form.location.trim(),
    status: form.status,
    note: form.note.trim(),
    series_id,
  };
}

/**
 * The choices that make sense after changing one date of a series, most cautious first. One
 * choice means there is nothing to ask; none means nothing changed.
 * - Date, time, length, status and the other fields of one date: only this date, this and
 *   following dates, or every date.
 * - How often it repeats (or when it ends, along with other changes): this and following, or
 *   every date. Only the end date: every date, since the past is not touched.
 * - Stops repeating: this and following, which keeps this date and the ones before it.
 * On the first date, "this and following" is every date.
 */
export function scopesFor(series: Appointment, date: string, changed: FormField[], after: Pick<AppointmentForm, 'interval'>): SeriesScope[] {
  if (changed.length === 0) return [];
  if (!series.repeat) return ['all'];
  const onFirst = date <= firstDateOf(series);
  if (changed.includes('interval')) {
    if (after.interval === null) return onFirst ? ['all'] : ['following'];
    return onFirst ? ['all'] : ['following', 'all'];
  }
  if (changed.includes('until')) {
    if (changed.length === 1) return ['all'];
    return onFirst ? ['all'] : ['following', 'all'];
  }
  return onFirst ? ['one', 'all'] : ['one', 'following', 'all'];
}

/**
 * The series a record made from `series` with these changes stays linked to: `link`, unless the
 * changes give it to another patient. Another patient's appointment is never part of this one's
 * series, so ending or deleting the series leaves it alone.
 */
function linkFor(series: Appointment, form: Pick<AppointmentForm, 'folder_id'>, link: string | null): string | null {
  return form.folder_id === series.folder_id ? link : null;
}

/**
 * Only this date: the date leaves the series (an exception) and a single appointment with the
 * changes takes its place, linked to the series (unless it now belongs to another patient).
 */
export function detachOccurrence(series: Appointment, date: string, form: AppointmentForm): [Draft<'appointment'>, Draft<'appointment'>] {
  if (!series.repeat) throw new Error('not a series');
  const kept = { ...toDraft(series), repeat: { ...series.repeat, exceptions: sortedUnique([...series.repeat.exceptions, date]) } };
  const link = linkFor(series, form, series.id);
  const single: Draft<'appointment'> & DetachedInfo = fromForm({ ...form, interval: null }, series.tz, [], link);
  if (link) single.series_start = `${date}T${timeOf(series)}`;
  return [kept, single];
}

/**
 * The end date for a series whose dates move by `shift` days: an end date the therapist left
 * alone moves with them, so the series keeps its number of sessions.
 */
function movedUntil(series: Appointment, form: AppointmentForm, shift: number): string | null {
  return form.until && series.repeat && form.until === series.repeat.until ? addDays(form.until, shift) : form.until;
}

/**
 * This and following dates: the series ends the day before `date`, and a new one with the
 * changes starts on the form's date. Skipped dates from `date` on move to the new series,
 * shifted with it when the day changes (a skipped Thursday becomes that week's Friday), and so
 * does an end date that was not changed. A series given to another patient starts without
 * them: the dates the first patient moved, cancelled or skipped are not the new patient's, and
 * a date shown that should not be is safer than one missing with nothing to say why.
 */
export function splitSeries(series: Appointment, date: string, form: AppointmentForm): [Draft<'appointment'>, Draft<'appointment'>] {
  if (!series.repeat) throw new Error('not a series');
  if (date <= firstDateOf(series)) throw new Error('split on the first date');
  const shift = daysBetween(date, form.date);
  const before = series.repeat.exceptions.filter((e) => e < date);
  const handedOver = form.folder_id !== series.folder_id;
  const after = handedOver ? [] : series.repeat.exceptions.filter((e) => e >= date).map((e) => addDays(e, shift)).filter((e) => e >= form.date);
  const old = { ...toDraft(series), repeat: { ...series.repeat, until: addDays(date, -1), exceptions: before } };
  return [old, fromForm({ ...form, until: movedUntil(series, form, shift) }, series.tz, after, linkFor(series, form, series.id))];
}

/**
 * Every date: the whole series takes the changes. When the date moves, every date moves by
 * the same number of days, skipped dates and an unchanged end date included. A series that
 * stops repeating becomes one appointment on the form's date. Also the plain edit of a single
 * appointment, which keeps where it sat in its series when it was taken out of one.
 */
export function editEveryDate(series: Appointment, date: string, form: AppointmentForm): Draft<'appointment'> {
  const shift = daysBetween(date, form.date);
  const exceptions = (series.repeat?.exceptions ?? []).map((e) => addDays(e, shift));
  const start = form.interval && series.repeat ? addDays(firstDateOf(series), shift) : form.date;
  const link = linkFor(series, form, series.series_id);
  const draft: Draft<'appointment'> & DetachedInfo = { ...fromForm({ ...form, date: start, until: movedUntil(series, form, shift) }, series.tz, exceptions, link), id: series.id };
  const slot = link && !series.repeat && !form.interval ? seriesStartOf(series) : null;
  if (slot) draft.series_start = slot;
  return draft;
}

/**
 * Every date, given to another patient: the whole repeating appointment is theirs, so the other
 * parts of the series and the dates taken out of it (moved, done or cancelled) go to them too,
 * and all of it stays linked (a series booked for the wrong patient, put right). `drafts` are
 * `editSeries`'s for that change; `appointments` may hold deleted records too.
 *
 * With `from` (the change was made on the first date of a later part, where every date of it
 * means this date and the following ones): only that part, the parts after it and the dates
 * taken out of them go. The earlier parts stay with the first patient, and the part given lets
 * go of them. A date taken out of an earlier part before the later part was split off it sat
 * from `from` on, so it goes too: the split carried its place into the later part.
 */
export function withFamily(series: Appointment, drafts: Draft<'appointment'>[], appointments: Appointment[], from?: string): Draft<'appointment'>[] {
  const own = drafts.find((d) => d.id === series.id);
  if (!own || own.folder_id === series.folder_id) return drafts;
  const give = (d: Draft<'appointment'>): Draft<'appointment'> => ({ ...d, folder_id: own.folder_id, title: own.folder_id ? d.title : d.title || own.title });
  let members = seriesFamily(series, appointments).filter((a) => a.id !== series.id);
  if (from) {
    const parts = new Set([series.id, ...members.filter((a) => a.repeat && firstDateOf(a) >= from).map((a) => a.id)]);
    members = members.filter((a) => {
      if (a.repeat) return parts.has(a.id);
      if (!a.series_id) return false;
      if (parts.has(a.series_id)) return true;
      const slot = seriesStartOf(a);
      return !!slot && slot.slice(0, 10) >= from;
    });
  }
  const family = new Map(members.map((a) => [a.id, a]));
  const linked = new Set([series.id, ...family.keys()]);
  // A part given whose link led to a part that stays is linked to the part this change was made on.
  const relink = (d: Draft<'appointment'>): Draft<'appointment'> => (from && d.series_id && !linked.has(d.series_id) ? { ...d, series_id: series.id } : d);
  const written = new Set(drafts.map((d) => d.id));
  return [
    ...drafts.map((d) => (d === own ? { ...d, series_id: from ? null : series.series_id } : d.id && family.has(d.id) ? relink(give(d)) : d)),
    ...[...family.values()].filter((a) => !written.has(a.id)).map((a) => relink(give(toDraft(a)))),
  ];
}

/**
 * This and following dates, given to another patient: the later parts of the series (from
 * earlier "this and following dates" changes) are given too, as they are, so every date from
 * `date` on is the new patient's. Like the part split here (see `splitSeries`), they start
 * afresh: their skipped dates are dropped, and the single dates taken out of them (moved, done
 * or cancelled) stay with the first patient, linked now to the part that stays, so they remain
 * in the first patient's series. The parts given are linked to the new series, the draft with
 * id `headId`. `drafts` are `editSeries`'s for that change; `appointments` may hold deleted
 * records too.
 */
export function withLaterParts(series: Appointment, date: string, drafts: Draft<'appointment'>[], headId: string, appointments: Appointment[]): Draft<'appointment'>[] {
  const head = drafts.find((d) => d.id === headId);
  if (!head || head.folder_id === series.folder_id) return drafts;
  const family = seriesFamily(series, appointments);
  const later = family.filter((a) => a.id !== series.id && a.repeat && firstDateOf(a) >= date);
  const parts = new Set(later.map((a) => a.id));
  const give = (d: Draft<'appointment'>): Draft<'appointment'> => ({
    ...d,
    folder_id: head.folder_id,
    title: head.folder_id ? d.title : d.title || head.title,
    repeat: d.repeat ? { ...d.repeat, exceptions: [] } : null,
    series_id: d.series_id && parts.has(d.series_id) ? d.series_id : headId,
  });
  const written = new Set(drafts.map((d) => d.id));
  const kept = family.filter((a) => !a.repeat && !!a.series_id && parts.has(a.series_id) && !written.has(a.id));
  return [
    ...drafts.map((d) => (d.id && parts.has(d.id) ? give(d) : d)),
    ...later.filter((a) => !written.has(a.id)).map((a) => give(toDraft(a))),
    ...kept.map((a) => ({ ...toDraft(a), series_id: series.id })),
  ];
}

/** The drafts to write for a change to one date of a series, in the chosen scope. */
export function editSeries(series: Appointment, date: string, form: AppointmentForm, scope: SeriesScope): Draft<'appointment'>[] {
  if (scope === 'one' && series.repeat) return detachOccurrence(series, date, form);
  if (scope === 'following' && series.repeat && date > firstDateOf(series)) return splitSeries(series, date, form);
  return [editEveryDate(series, date, form)];
}

/** Takes one date out of a series. */
export function skipDate(series: Appointment, date: string): Draft<'appointment'> {
  if (!series.repeat) throw new Error('not a series');
  return { ...toDraft(series), repeat: { ...series.repeat, exceptions: sortedUnique([...series.repeat.exceptions, date]) } };
}

/**
 * Ends a series the day before `date`, keeping every earlier date. Null on the first date,
 * where nothing would be left: deleting the series is the way to do that.
 */
export function endSeriesFrom(series: Appointment, date: string): Draft<'appointment'> | null {
  if (!series.repeat) throw new Error('not a series');
  if (date <= firstDateOf(series)) return null;
  const until = addDays(date, -1);
  const keepUntil = series.repeat.until && series.repeat.until < until ? series.repeat.until : until;
  return { ...toDraft(series), repeat: { ...series.repeat, until: keepUntil, exceptions: series.repeat.exceptions.filter((e) => e < date) } };
}

/**
 * Everything that belongs to the same repeating appointment as `series`, live records only:
 * the parts it was split into by "this and following dates" changes and the single dates
 * taken out of any of them, all linked through `series_id`, for the same patient (a date given
 * to someone else is theirs). `appointments` may hold deleted records too; they still link
 * the others.
 */
export function seriesFamily(series: Appointment, appointments: Appointment[]): Appointment[] {
  const byId = new Map(appointments.map((a) => [a.id, a]));
  byId.set(series.id, series);
  let root = series;
  const climbed = new Set<string>();
  while (root.series_id && !climbed.has(root.id)) {
    climbed.add(root.id);
    const up = byId.get(root.series_id);
    if (!up) break;
    root = up;
  }
  const children = new Map<string, Appointment[]>();
  for (const a of byId.values()) {
    if (!a.series_id) continue;
    const list = children.get(a.series_id) ?? [];
    list.push(a);
    children.set(a.series_id, list);
  }
  const out: Appointment[] = [];
  const seen = new Set<string>();
  const queue = [root];
  for (let a = queue.shift(); a; a = queue.shift()) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    if (!a.deleted && a.folder_id === series.folder_id) out.push(a);
    queue.push(...(children.get(a.id) ?? []));
  }
  return out;
}

/** What a removal changed on a series that keeps some dates, so Undo can put back only that. */
export interface PartChange {
  id: string;
  /** The end date before; absent when the end did not change. */
  until?: string | null;
  /** Dates the removal skipped. */
  added: string[];
  /** Skipped dates the removal let go of (they fell after the new end). */
  dropped: string[];
}

/** The writes for removing dates: series that keep some dates, and records deleted whole. */
export interface Removal {
  write: Draft<'appointment'>[];
  changes: PartChange[];
  remove: string[];
}

const noRemoval = (): Removal => ({ write: [], changes: [], remove: [] });

/**
 * Removes `date` and every later date from these records: a series ends the day before (or
 * goes whole when it starts on or after `date`, or keeps no date), and a single date on or
 * after `date` goes. Dates are compared as the therapist sees them, so a date moved before
 * `date` stays.
 */
export function endFrom(members: Appointment[], date: string): Removal {
  const out = noRemoval();
  for (const a of members) {
    if (!a.repeat) {
      if (firstDateOf(a) >= date) out.remove.push(a.id);
      continue;
    }
    if ((a.repeat.until ?? '9999-12-31') < date) continue;
    const ended = endSeriesFrom(a, date);
    if (!ended || !hasDates(ended)) {
      out.remove.push(a.id);
      continue;
    }
    out.write.push(ended);
    out.changes.push({ id: a.id, until: a.repeat.until, added: [], dropped: a.repeat.exceptions.filter((e) => e >= date) });
  }
  return out;
}

/**
 * Removing dates of a repeating appointment, opened on `date`:
 * - one: only that date (the series goes whole when it was its last date);
 * - following: that date and every later one, in every part of the series and the single
 *   dates taken out of it;
 * - all: every date, past ones too.
 */
export function removeDates(series: Appointment, date: string, scope: SeriesScope, appointments: Appointment[]): Removal {
  if (!series.repeat) throw new Error('not a series');
  const family = seriesFamily(series, appointments);
  if (scope === 'all') return { ...noRemoval(), remove: family.map((a) => a.id) };
  if (scope === 'following') return endFrom(family, date);
  const skipped = skipDate(series, date);
  if (!hasDates(skipped)) return { ...noRemoval(), remove: [series.id] };
  const added = series.repeat.exceptions.includes(date) ? [] : [date];
  return { write: [skipped], changes: [{ id: series.id, added, dropped: [] }], remove: [] };
}

/**
 * The choices for deleting one date of a repeating appointment, most cautious first. A single
 * choice needs no question: the date is the only one left, so it is deleted like any other.
 */
export function deleteScopes(series: Appointment, date: string, appointments: Appointment[]): SeriesScope[] {
  const family = seriesFamily(series, appointments);
  const others = family.some((a) => (a.id === series.id ? hasDates(skipDate(series, date)) : !a.repeat || hasDates(a)));
  if (!others) return ['all'];
  const earlier = family.some((a) => {
    if (!a.repeat) return firstDateOf(a) < date;
    const ended = endSeriesFrom(a, date);
    return !!ended && hasDates(ended);
  });
  return earlier ? ['one', 'following', 'all'] : ['one', 'all'];
}

/** The series as it was before a removal, keeping anything else changed on it since. Null when it is gone or no longer repeats. */
export function undoChange(current: Appointment, change: PartChange): Draft<'appointment'> | null {
  if (current.deleted || !current.repeat) return null;
  const added = new Set(change.added);
  const exceptions = sortedUnique([...current.repeat.exceptions.filter((e) => !added.has(e)), ...change.dropped]);
  const until = change.until === undefined ? current.repeat.until : change.until;
  return { ...toDraft(current), repeat: { ...current.repeat, until, exceptions } };
}

/**
 * Whether a single date taken out of a series was moved: it no longer starts where it sat in
 * the series. A date only marked cancelled or done keeps its place and is not "moved".
 */
export function isMoved(a: Appointment): boolean {
  const slot = seriesStartOf(a);
  return !a.repeat && !!a.series_id && !!slot && a.start_local !== slot;
}
