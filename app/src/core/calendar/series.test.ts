import ICAL from 'ical.js';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import type { Appointment, Draft, Folder } from '../model/types';
import { emptyContact } from '../model/types';
import { validate } from '../model/validate';
import { toIcs } from './ics';
import { hasDates, nextOccurrence, occurrencesIn } from './occurrences';
import {
  changedFields, deleteScopes, detachOccurrence, editEveryDate, editSeries, endFrom, endSeriesFrom, formOf, isMoved, removeDates, scopesFor,
  seriesFamily, seriesStartOf, skipDate, splitSeries, undoChange, withFamily, withLaterParts,
} from './series';

const base = { created_at: '', updated_at_hlc: '', deleted: false };
const weekly = (over: Partial<Appointment> = {}): Appointment => ({
  ...base, id: 's1', folder_id: 'f1', title: '', type_id: 't1', start_local: '2026-09-03T09:00', tz: 'Europe/Lisbon',
  duration_min: 50, repeat: { interval_weeks: 1, until: null, exceptions: [] }, location: 'Room 2', status: 'confirmed', note: '', series_id: null, ...over,
});
let n = 0;
/** What the store would hold after writing these drafts: validated, with ids for new records. */
const saved = (drafts: Draft<'appointment'>[]): Appointment[] =>
  drafts.map((d) => ({ ...base, ...(validate('appointment', d) as Draft<'appointment'>), id: d.id ?? `new${++n}` }) as Appointment);
const range = (from: string, to: string) => [DateTime.fromISO(from, { zone: 'Europe/Lisbon' }), DateTime.fromISO(to, { zone: 'Europe/Lisbon' })] as const;
const starts = (appts: Appointment[], from: string, to: string) =>
  occurrencesIn(appts, ...range(from, to)).map((o) => `${o.start.toFormat("ccc yyyy-MM-dd HH:mm")}${o.appointment.status === 'confirmed' ? '' : ` ${o.appointment.status}`}`);

describe('which dates a change applies to', () => {
  const s = weekly();
  const before = formOf(s, '2026-10-01');

  it('offers only this date, this and following, and every date for a change to one date', () => {
    const after = { ...before, time: '10:00' };
    expect(changedFields(before, after)).toEqual(['time']);
    expect(scopesFor(s, '2026-10-01', ['time'], after)).toEqual(['one', 'following', 'all']);
    expect(scopesFor(s, '2026-09-03', ['status'], after)).toEqual(['one', 'all']);
  });

  it('asks nothing when nothing changed, or when only the end date did', () => {
    expect(changedFields(before, { ...before, note: '  ' })).toEqual([]);
    expect(scopesFor(s, '2026-10-01', [], before)).toEqual([]);
    expect(scopesFor(s, '2026-10-01', ['until'], before)).toEqual(['all']);
  });

  it('never offers one date for a change to how it repeats', () => {
    expect(scopesFor(s, '2026-10-01', ['interval'], { ...before, interval: 2 })).toEqual(['following', 'all']);
    expect(scopesFor(s, '2026-10-01', ['interval'], { ...before, interval: null })).toEqual(['following']);
    expect(scopesFor(s, '2026-09-03', ['interval'], { ...before, interval: null })).toEqual(['all']);
    expect(scopesFor(s, '2026-10-01', ['until', 'time'], before)).toEqual(['following', 'all']);
  });
});

describe('only this date', () => {
  it('shows a moved date once, on its new day, and leaves the others alone', () => {
    const s = weekly();
    const drafts = detachOccurrence(s, '2026-10-01', { ...formOf(s, '2026-10-01'), date: '2026-10-02', time: '11:00' });
    const after = saved(drafts);
    expect(starts(after, '2026-09-24', '2026-10-09')).toEqual(['Thu 2026-09-24 09:00', 'Fri 2026-10-02 11:00', 'Thu 2026-10-08 09:00']);
    expect(after[1]!.series_id).toBe('s1');
    expect(after[0]!.start_local).toBe('2026-09-03T09:00');
  });

  it('cancels one date without touching the rest of the series', () => {
    const s = weekly();
    const after = saved(detachOccurrence(s, '2026-10-01', { ...formOf(s, '2026-10-01'), status: 'cancelled' }));
    expect(starts(after, '2026-09-24', '2026-10-09')).toEqual(['Thu 2026-09-24 09:00', 'Thu 2026-10-01 09:00 cancelled', 'Thu 2026-10-08 09:00']);
    expect(after[0]!.status).toBe('confirmed');
  });

  it('keeps the wall-clock time when the clocks change', () => {
    const s = weekly({ start_local: '2026-10-12T09:00' });
    const after = saved(detachOccurrence(s, '2026-10-19', { ...formOf(s, '2026-10-19'), date: '2026-10-26', time: '09:30' }));
    const occ = occurrencesIn(after, ...range('2026-10-19', '2026-11-03'));
    expect(occ.map((o) => o.start.toFormat('yyyy-MM-dd HH:mm'))).toEqual(['2026-10-26 09:00', '2026-10-26 09:30', '2026-11-02 09:00']);
    expect(new Set(occ.map((o) => o.start.offset)).size).toBe(1);
  });
});

describe('this and following dates', () => {
  const s = weekly({ repeat: { interval_weeks: 1, until: null, exceptions: ['2026-09-17', '2026-10-15'] } });

  it('keeps every earlier start time and moves the rest', () => {
    const [old, next] = splitSeries(s, '2026-10-01', { ...formOf(s, '2026-10-01'), date: '2026-10-02', time: '10:00' });
    expect(old.repeat).toEqual({ interval_weeks: 1, until: '2026-09-30', exceptions: ['2026-09-17'] });
    expect(old.start_local).toBe('2026-09-03T09:00');
    expect(next.start_local).toBe('2026-10-02T10:00');
    expect(next.series_id).toBe('s1');
    const after = saved([old, next]);
    expect(starts(after, '2026-09-03', '2026-10-24')).toEqual([
      'Thu 2026-09-03 09:00', 'Thu 2026-09-10 09:00', 'Thu 2026-09-24 09:00',
      'Fri 2026-10-02 10:00', 'Fri 2026-10-09 10:00', 'Fri 2026-10-23 10:00',
    ]);
  });

  it('carries skipped dates over to the new series, on its new weekday', () => {
    const [, next] = splitSeries(s, '2026-10-01', { ...formOf(s, '2026-10-01'), date: '2026-10-02' });
    expect(next.repeat?.exceptions).toEqual(['2026-10-16']);
    const [, same] = splitSeries(s, '2026-10-01', { ...formOf(s, '2026-10-01'), interval: 2 });
    expect(same.repeat).toEqual({ interval_weeks: 2, until: null, exceptions: ['2026-10-15'] });
  });

  it('keeps the end date of the series for the new part', () => {
    const ending = weekly({ repeat: { interval_weeks: 1, until: '2026-12-17', exceptions: [] } });
    const [old, next] = editSeries(ending, '2026-10-01', { ...formOf(ending, '2026-10-01'), time: '18:00' }, 'following');
    expect(old!.repeat?.until).toBe('2026-09-30');
    expect(next!.repeat?.until).toBe('2026-12-17');
  });

  it('moves an end date that was left alone along with the dates, so no session is lost', () => {
    const ending = weekly({ repeat: { interval_weeks: 1, until: '2026-12-17', exceptions: [] } });
    const all = (appts: Appointment[]) => starts(appts, '2026-09-01', '2027-01-31');
    expect(all([ending])).toHaveLength(16);
    const toFriday = { ...formOf(ending, '2026-10-01'), date: '2026-10-02' };
    for (const scope of ['following', 'all'] as const) {
      const after = all(saved(editSeries(ending, '2026-10-01', toFriday, scope)));
      expect(after).toHaveLength(16);
      expect(after[after.length - 1]).toBe('Fri 2026-12-18 09:00');
    }
    // An end date the therapist changed is taken as typed.
    const [, next] = splitSeries(ending, '2026-10-01', { ...toFriday, until: '2026-11-27' });
    expect(next.repeat?.until).toBe('2026-11-27');
  });

  it('stops repeating from a date and keeps that date as a single appointment', () => {
    const [old, next] = editSeries(s, '2026-10-01', { ...formOf(s, '2026-10-01'), interval: null }, 'following');
    expect(next!.repeat).toBeNull();
    expect(starts(saved([old!, next!]), '2026-09-20', '2026-10-30')).toEqual(['Thu 2026-09-24 09:00', 'Thu 2026-10-01 09:00']);
  });

  it('on the first date it is the same as every date', () => {
    const drafts = editSeries(s, '2026-09-03', { ...formOf(s, '2026-09-03'), time: '08:00' }, 'following');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.start_local).toBe('2026-09-03T08:00');
  });

  it('exports both parts so other calendars show the same dates', () => {
    const [old, next] = splitSeries(s, '2026-10-01', { ...formOf(s, '2026-10-01'), date: '2026-10-02', time: '10:00' });
    const after = saved([old, next]);
    const moved = saved(detachOccurrence(after[1]!, '2026-10-09', { ...formOf(after[1]!, '2026-10-09'), date: '2026-10-08', time: '17:00' }));
    const all = [after[0]!, ...moved];
    const folder: Folder = { ...base, id: 'f1', label: 'Inês Sousa', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null };
    const ics = toIcs(all, new Map([['f1', folder]]), { titleStyle: 'initials', neutralTitle: 'Appointment', now: new Date('2026-09-28T08:00:00Z') });
    const until = ICAL.Time.fromDateTimeString('2026-11-01T00:00:00');
    const fromIcs: string[] = [];
    for (const v of new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')) {
      const it = new ICAL.Event(v).iterator();
      for (let t = it.next(); t && t.compare(until) < 0; t = it.next()) fromIcs.push(t.toString().slice(0, 16).replace('T', ' '));
    }
    const fromSala = occurrencesIn(all, ...range('2026-09-01', '2026-11-01')).map((o) => o.start.toFormat('yyyy-MM-dd HH:mm'));
    expect(fromIcs.sort()).toEqual(fromSala);
    expect(fromSala).toContain('2026-10-08 17:00');
    expect(fromSala).not.toContain('2026-10-09 10:00');
  });
});

describe('every date', () => {
  it('moves every date by the same number of days, skipped ones too', () => {
    const s = weekly({ repeat: { interval_weeks: 1, until: null, exceptions: ['2026-09-17'] } });
    const d = editEveryDate(s, '2026-10-01', { ...formOf(s, '2026-10-01'), date: '2026-10-02', time: '09:30' });
    expect(d.id).toBe('s1');
    expect(d.start_local).toBe('2026-09-04T09:30');
    expect(d.repeat?.exceptions).toEqual(['2026-09-18']);
  });

  it('changes a single appointment like any other edit', () => {
    const one = weekly({ repeat: null, start_local: '2026-10-01T09:00' });
    const d = editEveryDate(one, '2026-10-01', { ...formOf(one), date: '2026-10-05', interval: 2 });
    expect([d.start_local, d.repeat?.interval_weeks]).toEqual(['2026-10-05T09:00', 2]);
  });
});

describe('removing dates', () => {
  const s = weekly({ repeat: { interval_weeks: 1, until: null, exceptions: ['2026-09-10', '2026-10-15'] } });

  it('skips one date', () => {
    expect(skipDate(s, '2026-10-01').repeat?.exceptions).toEqual(['2026-09-10', '2026-10-01', '2026-10-15']);
  });

  it('ends a series before a date and keeps the past', () => {
    const d = endSeriesFrom(s, '2026-10-01')!;
    expect(d.repeat).toEqual({ interval_weeks: 1, until: '2026-09-30', exceptions: ['2026-09-10'] });
    expect(starts(saved([d]), '2026-09-01', '2026-12-01')).toHaveLength(3);
  });

  it('cannot end a series on its first date, and never makes one end later', () => {
    expect(endSeriesFrom(s, '2026-09-03')).toBeNull();
    const short = weekly({ repeat: { interval_weeks: 1, until: '2026-09-20', exceptions: [] } });
    expect(endSeriesFrom(short, '2026-10-01')!.repeat?.until).toBe('2026-09-20');
  });
});

describe('moved dates', () => {
  const s = weekly({ repeat: { interval_weeks: 2, until: null, exceptions: [] } });
  const detach = (over: Partial<ReturnType<typeof formOf>>, series: Appointment = s) =>
    saved(detachOccurrence(series, '2026-10-01', { ...formOf(series, '2026-10-01'), ...over }))[1]!;

  it('is moved when the day or time changed, not when only the status did', () => {
    expect(isMoved(detach({ date: '2026-10-02' }))).toBe(true);
    expect(isMoved(detach({ time: '10:00' }))).toBe(true);
    expect(isMoved(detach({ status: 'done' }))).toBe(false);
    expect(isMoved(s)).toBe(false);
    expect(seriesStartOf(detach({ date: '2026-10-02' }))).toBe('2026-10-01T09:00');
  });

  it('a date only marked done stays where it was when every date changes later', () => {
    const done = detach({ status: 'done' });
    const later = saved([editEveryDate(s, '2026-10-15', { ...formOf(s, '2026-10-15'), date: '2026-10-16', time: '10:00' })])[0]!;
    expect(later.start_local).toBe('2026-09-04T10:00');
    expect(isMoved(done)).toBe(false);
  });

  it('remembers where a moved date sat when it is changed again', () => {
    const moved = detach({ date: '2026-10-02' });
    const again = saved([editEveryDate(moved, '2026-10-02', { ...formOf(moved), note: 'Room 3 this time' })])[0]!;
    expect(seriesStartOf(again)).toBe('2026-10-01T09:00');
    const back = saved([editEveryDate(moved, '2026-10-02', { ...formOf(moved), date: '2026-10-01' })])[0]!;
    expect(isMoved(back)).toBe(false);
  });
});

describe('deleting dates of a series', () => {
  // Weekly on Thursdays; 15 Oct moved to Friday 16 Oct 11:00, 17 Sep marked done.
  const s = weekly();
  const [s1, movedDraft] = detachOccurrence(s, '2026-10-15', { ...formOf(s, '2026-10-15'), date: '2026-10-16', time: '11:00' });
  const [s2, doneDraft] = detachOccurrence(saved([s1])[0]!, '2026-09-17', { ...formOf(s, '2026-09-17'), status: 'done' });
  const series = saved([s2])[0]!;
  const moved = { ...saved([movedDraft])[0]!, id: 'moved' };
  const done = { ...saved([doneDraft])[0]!, id: 'done' };
  const store = [series, moved, done];
  /** The store after a removal. */
  const apply = (r: ReturnType<typeof removeDates>) => {
    const written = new Map(saved(r.write).map((a) => [a.id, a]));
    return store.filter((a) => !r.remove.includes(a.id)).map((a) => written.get(a.id) ?? a);
  };

  it('this and following dates also removes dates moved on their own after it', () => {
    const left = apply(removeDates(series, '2026-10-01', 'following', store));
    expect(starts(left, '2026-09-01', '2027-01-01')).toEqual(['Thu 2026-09-03 09:00', 'Thu 2026-09-10 09:00', 'Thu 2026-09-17 09:00 done', 'Thu 2026-09-24 09:00']);
    expect(nextOccurrence(left, DateTime.fromISO('2026-10-02T08:00', { zone: 'Europe/Lisbon' }))).toBeNull();
  });

  it('a date moved before the cut stays, and one moved after it goes', () => {
    const early = { ...moved, id: 'early', start_local: '2026-09-30T11:00' };
    const r = removeDates(series, '2026-10-01', 'following', [series, early]);
    expect(r.remove).toEqual([]);
  });

  it('every date finds the dates taken out of the series, and leaves alone one given to another patient', () => {
    const elsewhere = { ...moved, id: 'elsewhere', start_local: '2026-10-22T09:00', folder_id: 'f2' };
    const all = [series, moved, elsewhere, done, weekly({ id: 'other', series_id: null })];
    expect(removeDates(series, '2026-10-01', 'all', all).remove.sort()).toEqual(['done', 'moved', 's1']);
    expect(removeDates(series, '2026-10-01', 'following', all).remove.sort()).toEqual(['moved']);
  });

  it('a date or the later dates given to another patient are no longer part of the series', () => {
    const [, single] = detachOccurrence(series, '2026-10-01', { ...formOf(series, '2026-10-01'), folder_id: 'f2' });
    expect(single.series_id).toBeNull();
    expect((single as { series_start?: string }).series_start).toBeUndefined();
    const [, later] = splitSeries(series, '2026-10-08', { ...formOf(series, '2026-10-08'), folder_id: 'f2' });
    expect(later.series_id).toBeNull();
    const [, same] = splitSeries(series, '2026-10-08', { ...formOf(series, '2026-10-08'), time: '10:00' });
    expect(same.series_id).toBe('s1');
    // A date taken out earlier and then given to someone else lets go of the series too.
    expect(editEveryDate(moved, '2026-10-16', { ...formOf(moved, '2026-10-16'), folder_id: 'f2' }).series_id).toBeNull();
  });

  it('every date given to another patient takes the dates taken out of the series along', () => {
    const drafts = withFamily(series, editSeries(series, '2026-10-08', { ...formOf(series, '2026-10-08'), folder_id: 'f2' }, 'all'), store);
    const after = saved(drafts);
    expect(after.map((a) => [a.id, a.folder_id, a.series_id])).toEqual([['s1', 'f2', null], ['moved', 'f2', 's1'], ['done', 'f2', 's1']]);
    expect(isMoved(after.find((a) => a.id === 'moved')!)).toBe(true);
    const theirs = after.find((a) => a.id === 's1')!;
    expect(removeDates(theirs, '2026-10-08', 'all', after).remove.sort()).toEqual(['done', 'moved', 's1']);
    expect(removeDates(theirs, '2026-10-01', 'following', after).remove).toEqual(['moved']);
    // For the same patient, only the series itself is written.
    expect(withFamily(series, editSeries(series, '2026-10-08', { ...formOf(series, '2026-10-08'), time: '10:00' }, 'all'), store)).toHaveLength(1);
  });

  it('this and following dates given to another patient leaves the first patient’s skipped dates behind', () => {
    // The first patient's 22 Oct session was moved to the 23rd.
    const [kept] = detachOccurrence(weekly(), '2026-10-22', { ...formOf(weekly(), '2026-10-22'), date: '2026-10-23' });
    const first = saved([kept])[0]!;
    const [, theirs] = splitSeries(first, '2026-10-08', { ...formOf(first, '2026-10-08'), folder_id: 'f2' });
    expect(theirs.repeat?.exceptions).toEqual([]);
    expect(starts(saved([theirs]), '2026-10-08', '2026-10-30')).toEqual(['Thu 2026-10-08 09:00', 'Thu 2026-10-15 09:00', 'Thu 2026-10-22 09:00', 'Thu 2026-10-29 09:00']);
    // Kept for the same patient.
    const [, same] = splitSeries(first, '2026-10-08', { ...formOf(first, '2026-10-08'), time: '10:00' });
    expect(same.repeat?.exceptions).toEqual(['2026-10-22']);
  });

  it('this and following dates reaches the later part of a series changed from a date on', () => {
    const [oldDraft, nextDraft] = splitSeries(series, '2026-11-05', { ...formOf(series, '2026-11-05'), time: '18:00' });
    const [old, next] = saved([oldDraft, { ...nextDraft, id: 'next' }]);
    const r = removeDates(old!, '2026-10-01', 'following', [old!, next!, moved, done]);
    expect(r.remove.sort()).toEqual(['moved', 'next']);
    expect(r.write.map((d) => d.repeat?.until)).toEqual(['2026-09-30']);
    // Opened on the later part, every date reaches the earlier one too.
    expect(removeDates(next!, '2026-11-12', 'all', [old!, next!, moved, done]).remove.sort()).toEqual(['done', 'moved', 'next', 's1']);
  });

  describe('given to another patient, with a later part changed from 5 Nov on', () => {
    // 09:00 until 4 Nov, then 18:00 from 5 Nov (`next`, linked to s1); 15 Oct moved, 17 Sep done.
    const [oldDraft, nextDraft] = splitSeries(series, '2026-11-05', { ...formOf(series, '2026-11-05'), time: '18:00' });
    const [old, next] = saved([oldDraft, { ...nextDraft, id: 'next' }]) as [Appointment, Appointment];
    // 26 Nov of the later part cancelled on its own.
    const [nextKept, cancelledDraft] = detachOccurrence(next, '2026-11-26', { ...formOf(next, '2026-11-26'), status: 'cancelled' });
    const later = saved([nextKept])[0]!;
    const cancelled = { ...saved([cancelledDraft])[0]!, id: 'cancelled' };
    const family = [old, later, moved, done, cancelled];
    const owner = (drafts: Draft<'appointment'>[]) => Object.fromEntries(saved(drafts).map((a) => [a.id, [a.folder_id, a.series_id]]));

    it('every date from the first date of the later part leaves the earlier part with the first patient', () => {
      const form = { ...formOf(later, '2026-11-05'), folder_id: 'f2', interval: null };
      expect(scopesFor(later, '2026-11-05', changedFields(formOf(later, '2026-11-05'), form), form)).toEqual(['all']);
      const drafts = withFamily(later, editSeries(later, '2026-11-05', form, 'all'), family, '2026-11-05');
      expect(owner(drafts)).toEqual({ next: ['f2', null], cancelled: ['f2', 'next'] });
    });

    it('every date from another date of it takes the whole series, earlier part too', () => {
      const drafts = withFamily(later, editSeries(later, '2026-11-12', { ...formOf(later, '2026-11-12'), folder_id: 'f2' }, 'all'), family);
      expect(Object.keys(owner(drafts)).sort()).toEqual(['cancelled', 'done', 'moved', 'next', 's1']);
      expect(saved(drafts).every((a) => a.folder_id === 'f2')).toBe(true);
    });

    it('this and following dates from 8 Oct gives the later part too, linked to the new series', () => {
      const [ended, fresh] = editSeries(old, '2026-10-08', { ...formOf(old, '2026-10-08'), folder_id: 'f2' }, 'following');
      const drafts = withLaterParts(old, '2026-10-08', [ended!, { ...fresh!, id: 'fresh' }], 'fresh', family);
      // The cancelled 26 Nov stays the first patient's, linked to the part that stays.
      expect(owner(drafts)).toEqual({ s1: ['f1', null], fresh: ['f2', null], next: ['f2', 'fresh'], cancelled: ['f1', 's1'] });
      // The later part starts afresh too: the first patient's cancelled 26 Nov stays theirs, and the new patient has that date.
      const theirs = saved(drafts).filter((a) => a.folder_id === 'f2');
      expect(starts(theirs, '2026-10-01', '2026-12-01')).toEqual([
        'Thu 2026-10-08 09:00', 'Thu 2026-10-15 09:00', 'Thu 2026-10-22 09:00', 'Thu 2026-10-29 09:00',
        'Thu 2026-11-05 18:00', 'Thu 2026-11-12 18:00', 'Thu 2026-11-19 18:00', 'Thu 2026-11-26 18:00',
      ]);
      // Deleting the new patient's dates from 8 Oct on reaches the part from 5 Nov.
      const afterAll = [...saved(drafts), moved, done];
      expect(removeDates(afterAll.find((a) => a.id === 'fresh')!, '2026-10-15', 'following', afterAll).remove).toEqual(['next']);
      // And the first patient's still reach the dates they had taken out of it.
      expect(removeDates(afterAll.find((a) => a.id === 's1')!, '2026-09-24', 'following', afterAll).remove.sort()).toEqual(['cancelled', 'moved']);
      expect(removeDates(afterAll.find((a) => a.id === 's1')!, '2026-09-24', 'all', afterAll).remove.sort()).toEqual(['cancelled', 'done', 'moved', 's1']);
      // For the same patient, the later part is left alone.
      const [e2, f2] = editSeries(old, '2026-10-08', { ...formOf(old, '2026-10-08'), time: '10:00' }, 'following');
      expect(withLaterParts(old, '2026-10-08', [e2!, { ...f2!, id: 'fresh' }], 'fresh', family)).toHaveLength(2);
    });
  });

  it('every date from the first date of a later part takes a date moved before that part was split off', () => {
    // 15 Oct was moved to the 16th (`moved`), then 10:00 from 8 Oct on: the later part holds 15 Oct's place.
    const [firstDraft, partDraft] = splitSeries(series, '2026-10-08', { ...formOf(series, '2026-10-08'), time: '10:00' });
    const [first, part] = saved([firstDraft, { ...partDraft, id: 'part' }]) as [Appointment, Appointment];
    expect(part.repeat?.exceptions).toEqual(['2026-10-15']);
    const form = { ...formOf(part, '2026-10-08'), folder_id: 'f2' };
    expect(scopesFor(part, '2026-10-08', changedFields(formOf(part, '2026-10-08'), form), form)).toEqual(['one', 'all']);
    const drafts = withFamily(part, editSeries(part, '2026-10-08', form, 'all'), [first, part, moved, done], '2026-10-08');
    expect(Object.fromEntries(saved(drafts).map((a) => [a.id, [a.folder_id, a.series_id]]))).toEqual({ part: ['f2', null], moved: ['f2', 'part'] });
    const after = saved(drafts);
    expect(starts(after, '2026-10-01', '2026-10-30')).toEqual(['Thu 2026-10-08 10:00', 'Fri 2026-10-16 11:00', 'Thu 2026-10-22 10:00', 'Thu 2026-10-29 10:00']);
    expect(starts([first, done], '2026-10-08', '2026-10-30')).toEqual([]);
  });

  it('deleting the last date of a series deletes the record instead of leaving it empty', () => {
    const one = weekly({ repeat: { interval_weeks: 1, until: '2026-09-10', exceptions: ['2026-09-03'] } });
    expect(removeDates(one, '2026-09-10', 'one', [one])).toEqual({ write: [], changes: [], remove: ['s1'] });
    expect(deleteScopes(one, '2026-09-10', [one])).toEqual(['all']);
  });

  it('offers this and following only when earlier dates stay', () => {
    expect(deleteScopes(series, '2026-10-01', store)).toEqual(['one', 'following', 'all']);
    expect(deleteScopes(series, '2026-09-03', store)).toEqual(['one', 'all']);
    // The last date of its series, but a date taken out of it is still there.
    const last = weekly({ repeat: { interval_weeks: 1, until: '2026-09-03', exceptions: [] } });
    expect(deleteScopes(last, '2026-09-03', [last, { ...done, start_local: '2026-09-10T09:00' }])).toEqual(['one', 'all']);
  });

  it('undo puts back only what the delete changed', () => {
    const r = removeDates(series, '2026-10-01', 'following', store);
    const ended = saved(r.write)[0]!;
    // Another date was skipped meanwhile; undo keeps that.
    const since = { ...ended, repeat: { ...ended.repeat!, exceptions: [...ended.repeat!.exceptions, '2026-09-24'] } };
    const back = undoChange(since, r.changes[0]!)!;
    expect(back.repeat).toEqual({ interval_weeks: 1, until: null, exceptions: ['2026-09-17', '2026-09-24', '2026-10-15'] });
    const one = removeDates(series, '2026-10-08', 'one', store);
    expect(undoChange(saved(one.write)[0]!, one.changes[0]!)!.repeat?.exceptions).toEqual(['2026-09-17', '2026-10-15']);
  });

  it('stopping the repeat from a date removes the later dates of the rest of the series', () => {
    const others = seriesFamily(series, store).filter((a) => a.id !== series.id);
    expect(endFrom(others, '2026-10-02').remove).toEqual(['moved']);
    expect(endFrom(others, '2026-10-17').remove).toEqual([]);
  });

  it('links the parts of a series through deleted ones', () => {
    const gone = { ...series, deleted: true };
    expect(seriesFamily(moved, [gone, moved, done]).map((a) => a.id).sort()).toEqual(['done', 'moved']);
  });
});

describe('series without dates', () => {
  it('has no dates when every date is skipped or it ends before it starts', () => {
    expect(hasDates(weekly())).toBe(true);
    expect(hasDates(weekly({ repeat: { interval_weeks: 2, until: '2026-09-17', exceptions: ['2026-09-03'] } }))).toBe(true);
    expect(hasDates(weekly({ repeat: { interval_weeks: 2, until: '2026-09-17', exceptions: ['2026-09-03', '2026-09-17'] } }))).toBe(false);
    expect(hasDates(weekly({ repeat: { interval_weeks: 1, until: '2026-09-01', exceptions: [] } }))).toBe(false);
  });

  it('is left out of the calendar file', () => {
    const empty = weekly({ repeat: { interval_weeks: 1, until: '2026-09-03', exceptions: ['2026-09-03'] } });
    const ics = toIcs([empty], new Map(), { titleStyle: 'neutral', neutralTitle: 'Appointment', now: new Date('2026-09-28T08:00:00Z') });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
