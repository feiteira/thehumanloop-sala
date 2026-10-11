import { describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../../core/import/csv';
import { emptyContact, type Folder } from '../../core/model/types';
import { createMemoryPlatform } from '../../platform/memory';
import type { IcsDetails } from '../../services/importer';
import { canInclude, fileEvent, normaliseDates, planCsv, planIcs, readFile, sameTitleWithoutFolder } from './planner';

// The planner's file readers need a browser; CSV and calendar planning do not.
vi.mock('./engines', () => ({}));

const folder = (id: string, label: string): Folder => ({
  id, label, colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
  created_at: '', updated_at_hlc: '', deleted: false,
});
const existing = [folder('ana', 'Ana Silva'), folder('ines-r', 'Inês R.'), folder('rui', 'Rui Marques')];

describe('planCsv', () => {
  it('adds to a folder of the same name only when ticked, and never merges a different initial', () => {
    const table = parseCsv('Nome;Data de início\nSilva, Ana;10/01/2025\nInês S.;ontem há muito\nBeatriz Nunes;\n');
    const plan = planCsv(table, ['label', 'start'], existing, '/in/list.csv');
    expect(plan.source).toBe('csv');
    expect(plan.folders.map((f) => [f.label, f.existingId, f.suggestedId, f.include])).toEqual([
      ['Silva, Ana', 'ana', 'ana', false],
      ['Inês S.', null, null, true],
      ['Beatriz Nunes', null, null, true],
    ]);
    expect(plan.items.map((i) => [i.name, i.include, i.date, i.warning])).toEqual([
      ['Silva, Ana', false, '2025-01-10', null],
      ['Inês S.', true, '', 'startUnread'],
      ['Beatriz Nunes', true, '', null],
    ]);
  });
});

describe('planIcs', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:a', 'RECURRENCE-ID;TZID=Europe/Lisbon:20261012T090000', 'SUMMARY:Ana Silva', 'DTSTART;TZID=Europe/Lisbon:20261013T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Sessão Rui Marques', 'DTSTART;TZID=Europe/Lisbon:20261006T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:c', 'SUMMARY:Reunião de equipa', 'DTSTART;TZID=Europe/Lisbon:20261007T170000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:d', 'SUMMARY:Rui Marques', 'DTSTART;TZID=Europe/Lisbon:20261008T100000', 'RRULE:FREQ=MONTHLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:e', 'SUMMARY:Reunião de equipa', 'DTSTART;TZID=Europe/Lisbon:20261014T170000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('files only exact names, offers likely folders, and leaves the rest unticked', () => {
    const plan = planIcs(ics, 'Europe/Lisbon', existing, '/in/cal.ics');
    const keyOf = (id: string) => plan.folders.find((f) => f.existingId === id)!.key;
    const row = (name: string, date: string) => plan.items.find((i) => i.name === name && i.date === date)!;
    expect(row('Ana Silva', '2026-10-05')).toMatchObject({ folderKey: keyOf('ana'), include: true, warning: null });
    // The moved date goes with its series, into the same folder.
    const moved = row('Ana Silva', '2026-10-13');
    expect(moved).toMatchObject({ folderKey: keyOf('ana'), include: true });
    expect((JSON.parse(moved.text) as IcsDetails).seriesItemId).toBe(row('Ana Silva', '2026-10-05').id);
    expect(row('Sessão Rui Marques', '2026-10-06')).toMatchObject({ folderKey: null, suggestedFolderKey: keyOf('rui'), suggestedBy: 'name', include: false });
    expect(row('Reunião de equipa', '2026-10-07')).toMatchObject({ folderKey: null, suggestedFolderKey: null, include: false });
    expect(row('Rui Marques', '2026-10-08')).toMatchObject({ folderKey: keyOf('rui'), include: false, warning: 'repeatUnsupported' });
    expect(sameTitleWithoutFolder(plan, row('Reunião de equipa', '2026-10-07')).map((i) => i.date)).toEqual(['2026-10-07', '2026-10-14']);
  });
});

describe('fileEvent', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:r', 'SUMMARY:Rui Marques', 'DTSTART;TZID=Europe/Lisbon:20261008T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:r', 'RECURRENCE-ID;TZID=Europe/Lisbon:20261029T100000', 'SUMMARY:Rui Marques', 'DTSTART;TZID=Europe/Lisbon:20261029T120000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:l1', 'SUMMARY:Laura', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:l2', 'SUMMARY:Laura', 'DTSTART;TZID=Europe/Lisbon:20261006T090000', 'RRULE:FREQ=MONTHLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:l3', 'SUMMARY:Laura', 'DTSTART;TZID=Europe/Lisbon:20261007T090000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const people = [...existing, folder('tomas', 'Tomás Ferreira'), folder('laura', 'Laura Costa')];
  const setup = () => {
    const plan = planIcs(ics, 'Europe/Lisbon', people, '/in/cal.ics');
    const keyOf = (id: string) => plan.folders.find((f) => f.existingId === id)!.key;
    const row = (name: string, date: string) => plan.items.find((i) => i.name === name && i.date === date)!;
    return { plan, keyOf, row };
  };

  it('moves a series and its moved dates together, whichever row is changed', () => {
    const { plan, keyOf, row } = setup();
    const series = row('Rui Marques', '2026-10-08');
    const moved = row('Rui Marques', '2026-10-29');
    expect([series.folderKey, moved.folderKey]).toEqual([keyOf('rui'), keyOf('rui')]);
    const bySeries = fileEvent(plan, series.id, keyOf('tomas'));
    expect(bySeries.items.filter((i) => i.name === 'Rui Marques').map((i) => i.folderKey)).toEqual([keyOf('tomas'), keyOf('tomas')]);
    const byMoved = fileEvent(plan, moved.id, keyOf('tomas'));
    expect(byMoved.items.filter((i) => i.name === 'Rui Marques').map((i) => i.folderKey)).toEqual([keyOf('tomas'), keyOf('tomas')]);
    const none = fileEvent(bySeries, series.id, null);
    expect(none.items.filter((i) => i.name === 'Rui Marques').map((i) => i.folderKey)).toEqual([null, null]);
  });

  it('only suggests the folder for other events of the same title, and files nothing on its own', () => {
    const { plan, keyOf, row } = setup();
    const next = fileEvent(plan, row('Laura', '2026-10-05').id, keyOf('laura'));
    const laura = (date: string) => next.items.find((i) => i.name === 'Laura' && i.date === date)!;
    expect(laura('2026-10-05')).toMatchObject({ folderKey: keyOf('laura'), include: true });
    expect(laura('2026-10-06')).toMatchObject({ folderKey: null, suggestedFolderKey: keyOf('laura'), suggestedBy: 'sameTitle', include: false });
    expect(laura('2026-10-07')).toMatchObject({ folderKey: null, suggestedFolderKey: keyOf('laura'), suggestedBy: 'sameTitle', include: false });
    // Chosen on its own row, the monthly one is ticked: the therapist asked for it.
    const chosen = fileEvent(plan, row('Laura', '2026-10-06').id, keyOf('laura'));
    expect(chosen.items.find((i) => i.name === 'Laura' && i.date === '2026-10-06')).toMatchObject({ folderKey: keyOf('laura'), include: true });
  });

  it('says where another event of the title went only while one is there', () => {
    const { plan, keyOf, row } = setup();
    // "Laura" looks like Laura Costa's folder.
    expect(row('Laura', '2026-10-07')).toMatchObject({ suggestedFolderKey: keyOf('laura'), suggestedBy: 'name' });
    const filed = fileEvent(plan, row('Laura', '2026-10-05').id, keyOf('tomas'));
    const laura = (p: typeof plan, date: string) => p.items.find((i) => i.name === 'Laura' && i.date === date)!;
    expect(laura(filed, '2026-10-07')).toMatchObject({ suggestedFolderKey: keyOf('tomas'), suggestedBy: 'sameTitle' });
    // Taken out again: no "Laura" event is in Tomás's folder, so the suggestion by name is back.
    const unfiled = fileEvent(filed, row('Laura', '2026-10-05').id, null);
    expect(laura(unfiled, '2026-10-05')).toMatchObject({ folderKey: null, suggestedFolderKey: keyOf('laura'), suggestedBy: 'name' });
    expect(laura(unfiled, '2026-10-07')).toMatchObject({ suggestedFolderKey: keyOf('laura'), suggestedBy: 'name' });
    // While another stays filed, that is the one named.
    const two = fileEvent(fileEvent(filed, row('Laura', '2026-10-06').id, keyOf('ana')), row('Laura', '2026-10-05').id, null);
    expect(laura(two, '2026-10-07')).toMatchObject({ suggestedFolderKey: keyOf('ana'), suggestedBy: 'sameTitle' });
  });

  it('suggests nothing for events without a title', () => {
    const untitled = [
      'BEGIN:VCALENDAR', 'VERSION:2.0',
      'BEGIN:VEVENT', 'UID:u1', 'DTSTART;TZID=Europe/Lisbon:20261005T090000', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:u2', 'DTSTART;TZID=Europe/Lisbon:20261006T090000', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const plan = planIcs(untitled, 'Europe/Lisbon', existing, '/in/cal.ics');
    const [a, b] = plan.items;
    expect(sameTitleWithoutFolder(plan, a!)).toEqual([]);
    const ana = plan.folders.find((f) => f.existingId === 'ana')!.key;
    const next = fileEvent(plan, a!.id, ana);
    expect(next.items.find((i) => i.id === b!.id)).toMatchObject({ folderKey: null, suggestedFolderKey: null, suggestedBy: null });
  });
});

describe('normaliseDates', () => {
  it('reads dates an earlier version kept as typed, and empties those it cannot read', () => {
    const plan = planCsv(parseCsv('Nome\nAna\nRui\nLaura\n'), ['label'], [], '/in/list.csv');
    plan.items[0]!.date = '28/09/2026';
    plan.items[1]!.date = 'next week';
    plan.items[2]!.date = '2026-01-10';
    const fixed = normaliseDates(plan, 'pt', '2026-10-01');
    expect(fixed.items.map((i) => i.date)).toEqual(['2026-09-28', '', '2026-01-10']);
    expect(normaliseDates(fixed, 'pt', '2026-10-01')).toBe(fixed);
  });
});

describe('readFile', () => {
  it('lists a file larger than 200 MB without reading it, and it cannot be ticked', async () => {
    const platform = createMemoryPlatform();
    const entry = { path: '/in/video.mp4', name: 'video.mp4', is_dir: false, size: 300 * 1024 * 1024, modified_ms: 0, depth: 1 };
    const item = await readFile(platform, entry, 'f1', 'por', () => {});
    expect(item).toMatchObject({ kind: 'attachment', include: false, warning: 'tooBig', size: entry.size });
    expect(canInclude(item)).toBe(false);
  });
});
