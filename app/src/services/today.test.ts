import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { followUpType } from '../core/calendar/booking';
import type { Slot } from '../core/calendar/slots';
import { emptyContact, type Draft, type Page } from '../core/model/types';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { bookingFor, dueStickies, occurrencesOn } from './queries';
import { SETTING, setSetting, usualDuration } from './settings';
import {
  dayStates, freeFrom, latestNotes, markNoNoteNeeded, noNoteNeeded, pagePreview, previousPage, sessionKey, sessionPagesByKey, unmarkNoNoteNeeded,
  unwrittenSessions,
} from './today';

const TZ = 'Europe/Lisbon';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ });

async function setup(clock = { now: at('2026-09-20T12:00') }) {
  const store = await Store.open(await SqlJsDb.create(), { now: () => clock.now.toJSDate() });
  const folder = (label: string, status: 'active' | 'archived' = 'active') =>
    store.put('folder', {
      label, colour: 'teal', status, tags: [], contact: emptyContact(), cover_note: '', archived_at: status === 'archived' ? '2026-09-01T00:00:00.000Z' : null, merged_into: null,
    });
  const appointment = (over: Partial<Draft<'appointment'>>) =>
    store.put('appointment', {
      folder_id: null, title: '', type_id: null, start_local: '2026-09-21T09:00', tz: TZ, duration_min: 50, repeat: null, location: '',
      status: 'confirmed', note: '', series_id: null, ...over,
    });
  const page = (folderId: string, date: string, time: string | null, sections: Record<string, string> = { body: 'Talked about work' }) =>
    store.put('page', { folder_id: folderId, date, time, duration_min: 50, template: 'free', title: '', sections, process_note: '', import_provenance: null });
  const sticky = (folderId: string) =>
    store.put('sticky', { folder_id: folderId, page_id: null, text: 'Ask about the diary', colour: 'yellow', next_session: true, origin: 'therapist', state: 'stuck', peeled_at: null });
  return { store, clock, folder, appointment, page, sticky };
}

const weekly = { interval_weeks: 1 as const, until: null, exceptions: [] as string[] };
const keys = (list: { appointment: { id: string }; date: string }[]) => list.map((o) => o.date);

describe('unwrittenSessions', () => {
  it('lists ended sessions of the last 14 days that have no page, newest first', async () => {
    const { store, folder, appointment, page } = await setup();
    const ines = await folder('Inês S.');
    await appointment({ folder_id: ines.id, start_local: '2026-09-07T09:00', repeat: weekly });
    await page(ines.id, '2026-09-21', '09:00');
    const now = at('2026-09-28T09:30'); // today's session is still running
    expect(keys(await unwrittenSessions(store, now, TZ))).toEqual(['2026-09-14']);
    // A page without a time counts for the session; one at another time does not.
    await page(ines.id, '2026-09-14', '15:00');
    expect(keys(await unwrittenSessions(store, now, TZ))).toEqual(['2026-09-14']);
    await page(ines.id, '2026-09-14', null);
    expect(await unwrittenSessions(store, now, TZ)).toEqual([]);
    // Once today's session has ended, it is waiting for its note too.
    expect(keys(await unwrittenSessions(store, at('2026-09-28T10:00'), TZ))).toEqual(['2026-09-28']);
  });

  it('does not take an empty page for the note, unless a document is attached to it', async () => {
    const { store, folder, appointment, page } = await setup();
    const ines = await folder('Inês S.');
    await appointment({ folder_id: ines.id, start_local: '2026-09-21T09:00' });
    const now = at('2026-09-22T09:00');
    // Write note pressed, then left without a word (or with every word taken out again).
    const empty = await page(ines.id, '2026-09-21', '09:00', { body: '  ' });
    expect(keys(await unwrittenSessions(store, now, TZ))).toEqual(['2026-09-21']);
    await store.put('attachment', {
      folder_id: ines.id, page_id: empty.id, filename: 'notes.jpg', mime: 'image/jpeg', size: 1, blob_id: 'b', sha256: '', local_only: false, source: 'scan', ocr_text: null,
    });
    expect(await unwrittenSessions(store, now, TZ)).toEqual([]);
  });

  it('leaves out cancelled sessions, appointments without a folder and archived folders', async () => {
    const { store, folder, appointment } = await setup();
    const active = await folder('Rui M.');
    const archived = await folder('João P.', 'archived');
    await appointment({ folder_id: active.id, start_local: '2026-09-22T10:00', status: 'cancelled' });
    await appointment({ folder_id: null, title: 'Supervision', start_local: '2026-09-23T15:00' });
    await appointment({ folder_id: archived.id, start_local: '2026-09-24T11:00' });
    const done = await appointment({ folder_id: active.id, start_local: '2026-09-25T10:00', status: 'done' });
    const list = await unwrittenSessions(store, at('2026-09-28T09:00'), TZ);
    expect(list.map((o) => o.appointment.id)).toEqual([done.id]);
  });

  it('counts a date moved out of a series once, under its new time, and skips a cancelled one', async () => {
    const { store, folder, appointment } = await setup();
    const f = await folder('Laura C.');
    const series = await appointment({ folder_id: f.id, start_local: '2026-09-15T14:00', repeat: { ...weekly, exceptions: ['2026-09-22', '2026-09-29'] } });
    const moved = await appointment({ folder_id: f.id, start_local: '2026-09-23T16:00', series_id: series.id });
    await appointment({ folder_id: f.id, start_local: '2026-09-29T14:00', series_id: series.id, status: 'cancelled' });
    const list = await unwrittenSessions(store, at('2026-09-29T18:00'), TZ);
    expect(list.map((o) => [o.appointment.id, o.date])).toEqual([[moved.id, '2026-09-23'], [series.id, '2026-09-15']]);
  });

  it('leaves out sessions marked "No note needed" and sessions older than 14 days', async () => {
    const { store, folder, appointment } = await setup();
    const f = await folder('Helena R.');
    const a = await appointment({ folder_id: f.id, start_local: '2026-09-04T10:00', repeat: weekly });
    const now = at('2026-09-28T09:00');
    expect(keys(await unwrittenSessions(store, now, TZ))).toEqual(['2026-09-25', '2026-09-18']);
    await markNoNoteNeeded(store, sessionKey({ appointment: a, date: '2026-09-25' }), '2026-09-28');
    expect(keys(await unwrittenSessions(store, now, TZ))).toEqual(['2026-09-18']);
  });
});

describe('No note needed', () => {
  it('keeps marks for 60 days and can take one back', async () => {
    const { store } = await setup();
    await setSetting(store, SETTING.noNoteNeeded, ['old@2026-07-01', 'recent@2026-08-20', 42]);
    await markNoNoteNeeded(store, 'a1@2026-09-25', '2026-09-28');
    await markNoNoteNeeded(store, 'a1@2026-09-25', '2026-09-28');
    expect(await noNoteNeeded(store)).toEqual(['recent@2026-08-20', 'a1@2026-09-25']);
    await unmarkNoNoteNeeded(store, 'a1@2026-09-25');
    expect(await noNoteNeeded(store)).toEqual(['recent@2026-08-20']);
  });
});

describe('sessionPagesByKey', () => {
  it('prefers the page with the session’s time, and reads the time in the practice zone', async () => {
    const { store, folder, appointment, page } = await setup();
    const f = await folder('Inês S.');
    await appointment({ folder_id: f.id, start_local: '2026-09-28T09:00', tz: TZ });
    // Booked at 11:00 Madrid time, which is 10:00 in Lisbon.
    const madrid = await appointment({ folder_id: f.id, start_local: '2026-09-28T11:00', tz: 'Europe/Madrid' });
    const untimed = await page(f.id, '2026-09-28', null);
    const timed = await page(f.id, '2026-09-28', '10:00');
    const occ = await occurrencesOn(store, at('2026-09-28T00:00'));
    const pages = await sessionPagesByKey(store, occ, TZ);
    expect(pages.get(sessionKey({ appointment: madrid, date: '2026-09-28' }))?.id).toBe(timed.id);
    expect(pages.get(sessionKey(occ.find((o) => o.appointment.id !== madrid.id)!))?.id).toBe(untimed.id);
  });
});

describe('one rule for a session’s note', () => {
  it('takes the written page over an empty one, and Last note skips empty pages', async () => {
    const { store, folder, appointment, page } = await setup();
    const f = await folder('Inês S.');
    await appointment({ folder_id: f.id, start_local: '2026-09-21T09:00' });
    await page(f.id, '2026-09-14', '09:00', { plan: 'Keep the sleep diary' });
    const empty = await page(f.id, '2026-09-21', '09:00', {});
    const written = await page(f.id, '2026-09-21', null);
    const occ = await occurrencesOn(store, at('2026-09-21T00:00'));
    const card = (await sessionPagesByKey(store, occ, TZ)).get(sessionKey(occ[0]!));
    // The same page Open note opens (findOrCreatePageFor, pageActions.test.ts).
    expect(card?.id).toBe(written.id);
    // A week later, the last note is the written page of the 21st, never the empty one.
    await store.remove('page', [written.id]);
    const notes = await latestNotes(store, f.id, '2026-09-28');
    expect(notes.map((p) => p.date)).toEqual(['2026-09-14']);
    expect(notes.map((p) => p.id)).not.toContain(empty.id);
    expect(pagePreview(previousPage(notes, { date: '2026-09-28', time: '09:00' })!)).toEqual({ kind: 'plan', text: 'Keep the sleep diary' });
  });
});

describe('dueStickies', () => {
  it('ignores notes written after today’s session started, and notes of archived folders', async () => {
    const { store, clock, folder, appointment, sticky } = await setup();
    const ines = await folder('Inês S.');
    const old = await folder('João P.', 'archived');
    await appointment({ folder_id: ines.id, start_local: '2026-09-21T09:00', repeat: weekly });
    await appointment({ folder_id: old.id, start_local: '2026-09-28T11:00' });
    clock.now = at('2026-09-21T09:40'); // written during last week's session, for this one
    const forToday = await sticky(ines.id);
    await sticky(old.id);
    clock.now = at('2026-09-28T09:30'); // written during today's session, for next week
    await sticky(ines.id);
    const due = await dueStickies(store, at('2026-09-28T00:00'));
    expect(due.map((d) => d.sticky.id)).toEqual([forToday.id]);
  });

  it('goes with the first session of the day that starts after the note was written', async () => {
    const { store, clock, folder, appointment, sticky } = await setup();
    const f = await folder('Rui M.');
    await appointment({ folder_id: f.id, start_local: '2026-09-28T09:00' });
    const late = await appointment({ folder_id: f.id, start_local: '2026-09-28T17:00' });
    clock.now = at('2026-09-28T10:00');
    await sticky(f.id);
    const due = await dueStickies(store, at('2026-09-28T00:00'));
    expect(due.map((d) => d.occurrence.appointment.id)).toEqual([late.id]);
  });
});

describe('freeFrom', () => {
  const slot = (from: string, to: string): Slot => ({ start: at(`2026-09-28T${from}`), end: at(`2026-09-28T${to}`) });
  const show = (slots: Slot[]) => slots.map((s) => `${s.start.toFormat('HH:mm')}-${s.end.toFormat('HH:mm')}`);

  it('drops what is over and starts a slot under way at now, rounded up to 5 minutes', () => {
    const slots = [slot('09:00', '10:00'), slot('10:50', '13:00'), slot('14:00', '18:00')];
    expect(show(freeFrom(slots, at('2026-09-28T08:00')))).toEqual(['09:00-10:00', '10:50-13:00', '14:00-18:00']);
    expect(show(freeFrom(slots, at('2026-09-28T11:02')))).toEqual(['11:05-13:00', '14:00-18:00']);
    expect(show(freeFrom(slots, at('2026-09-28T12:40')))).toEqual(['14:00-18:00']);
    expect(show(freeFrom(slots, at('2026-09-28T18:00')))).toEqual([]);
  });
});

describe('pagePreview', () => {
  it('shows the plan, or else the end of the last written section', () => {
    expect(pagePreview({ sections: { data: 'Slept badly.', plan: '  Keep the diary.  ' } })).toEqual({ kind: 'plan', text: 'Keep the diary.' });
    expect(pagePreview({ sections: { data: 'Slept badly.', assessment: 'Worried about work.', plan: '' } })).toEqual({ kind: 'end', text: 'Worried about work.' });
    const long = `${'word '.repeat(80)}the last words.`;
    const end = pagePreview({ sections: { body: long } }, 40)!;
    expect(end.kind).toBe('end');
    expect(end.text.startsWith('…')).toBe(true);
    expect(end.text.endsWith('the last words.')).toBe(true);
    expect(end.text.length).toBeLessThanOrEqual(41);
    expect(pagePreview({ sections: { body: '   ' } })).toBeNull();
  });
});

describe('previousPage', () => {
  const p = (id: string, date: string, time: string | null) => ({ id, date, time }) as Page;

  it('skips the session’s own note and later pages', () => {
    const pages = [p('next', '2026-10-05', '09:00'), p('later', '2026-09-28', '17:00'), p('own', '2026-09-28', '09:00'), p('untimed', '2026-09-28', null), p('last', '2026-09-21', '09:00')];
    expect(previousPage(pages, { date: '2026-09-28', time: '09:00' })?.id).toBe('last');
    expect(previousPage(pages, { date: '2026-09-28', time: '17:00' })?.id).toBe('own');
    expect(previousPage([p('own', '2026-09-28', null)], { date: '2026-09-28', time: '09:00' })).toBeNull();
  });
});

describe('followUpType', () => {
  const type = (id: string, duration_min: number, for_new_patients = false, archived = false) => ({ id, duration_min, for_new_patients, archived, deleted: false });
  const types = [type('first', 60, true), type('old', 45, false, true), type('session', 50), type('online', 40)];

  it('keeps the type and length of an ordinary session', () => {
    expect(followUpType({ typeId: 'online', durationMin: 40 }, types, 50)).toEqual({ typeId: 'online', durationMin: 40 });
    expect(followUpType({ typeId: null, durationMin: 30 }, types, 50)).toEqual({ typeId: null, durationMin: 30 });
  });

  it('follows a first consultation with the first type in use for other sessions, at its length', () => {
    expect(followUpType({ typeId: 'first', durationMin: 60 }, types, 50)).toEqual({ typeId: 'session', durationMin: 50 });
  });

  it('falls back to no type and the usual length when every other type is archived', () => {
    expect(followUpType({ typeId: 'first', durationMin: 60 }, [type('first', 60, true), type('old', 45, false, true)], 55)).toEqual({ typeId: null, durationMin: 55 });
  });
});

describe('bookingFor', () => {
  it('books an ordinary session after a first consultation, the same from Today, the cover and the Calendar divider', async () => {
    const { store, folder, appointment } = await setup();
    const laura = await folder('Laura C.');
    const first = await store.put('appointment_type', { name: 'First consultation', duration_min: 60, colour: 'blue', for_new_patients: true, archived: false });
    const session = await store.put('appointment_type', { name: 'Session', duration_min: 50, colour: 'teal', for_new_patients: false, archived: false });
    await appointment({ folder_id: laura.id, type_id: first.id, start_local: '2026-09-28T14:00', duration_min: 60 });
    const d = await bookingFor(store, laura.id, at('2026-09-28T15:30'));
    expect(d).toMatchObject({ typeId: session.id, durationMin: 50, suggested: true });
    expect(d.start.toISO()).toBe('2026-10-05T14:00:00.000+01:00');
  });
});

describe('usualDuration', () => {
  it('reads the usual length from Settings, and 50 minutes when it is unset or not a number', async () => {
    const { store } = await setup();
    expect(await usualDuration(store)).toBe(50);
    await setSetting(store, SETTING.defaultDuration, 45);
    expect(await usualDuration(store)).toBe(45);
    await setSetting(store, SETTING.defaultDuration, 'soon');
    expect(await usualDuration(store)).toBe(50);
  });
});

describe('dayStates', () => {
  it('marks as Next the patient session Up next is about, and supervision only when no patient is left', async () => {
    const { store, folder, appointment } = await setup();
    const ines = await folder('Inês S.');
    const rui = await folder('Rui M.');
    await appointment({ folder_id: ines.id, start_local: '2026-09-21T09:00' });
    await appointment({ title: 'Supervision', start_local: '2026-09-21T10:00', duration_min: 30 });
    await appointment({ folder_id: rui.id, start_local: '2026-09-21T10:30' });
    await appointment({ folder_id: ines.id, start_local: '2026-09-21T12:00' });
    const occ = await occurrencesOn(store, at('2026-09-21T00:00'));
    const states = (now: string) => {
      const { upNext, stateOf } = dayStates(occ, at(now));
      return { upNext: upNext?.start.toFormat('HH:mm'), states: occ.map(stateOf) };
    };
    expect(states('2026-09-21T09:55')).toEqual({ upNext: '10:30', states: ['ended', null, 'next', null] });
    expect(states('2026-09-21T10:40')).toEqual({ upNext: '10:30', states: ['ended', 'ended', 'now', 'next'] });
    expect(states('2026-09-21T08:00')).toEqual({ upNext: '09:00', states: ['next', null, null, null] });
    expect(states('2026-09-21T13:00')).toEqual({ upNext: undefined, states: ['ended', 'ended', 'ended', 'ended'] });
    await appointment({ title: 'Team meeting', start_local: '2026-09-21T15:00', duration_min: 30 });
    const later = await occurrencesOn(store, at('2026-09-21T00:00'));
    expect(later.map(dayStates(later, at('2026-09-21T12:10')).stateOf)).toEqual(['ended', 'ended', 'ended', 'now', 'next']);
    expect(later.map(dayStates(later, at('2026-09-21T09:20')).stateOf)).toEqual(['now', null, 'next', null, null]);
  });
});
