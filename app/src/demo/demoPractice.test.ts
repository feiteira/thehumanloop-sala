import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { Store } from '../core/store/store';
import { SqlJsDb } from '../platform/sqljs';
import { dueStickies, folderMap, occurrencesOn, recentPages } from '../services/queries';
import { unwrittenSessions } from '../services/today';
import { folderThemes, locate } from '../core/model/passages';
import { bySectionOrder } from '../core/model/sections';
import { knownThemes } from '../services/themes';
import { seedDemoPractice } from './demoPractice';

// The manual's screenshots show the demo on Monday 28 September 2026 at 09:00 in Lisbon.
const TZ = 'Europe/Lisbon';
const clock = DateTime.fromISO('2026-09-28T09:00', { zone: TZ });

async function demo() {
  const store = await Store.open(await SqlJsDb.create());
  await seedDemoPractice(store, 'en', clock);
  const folders = await folderMap(store);
  const name = (id: string | null) => (id ? folders.get(id)?.label : null);
  return { store, name };
}

describe('the demo practice at its screenshot clock', () => {
  it('has three sessions today and exactly one recent session without a note', async () => {
    const { store, name } = await demo();
    const today = await occurrencesOn(store, clock.startOf('day'));
    expect(today.map((o) => [o.start.toFormat('HH:mm'), name(o.appointment.folder_id)])).toEqual([
      ['09:00', 'Inês Salgado'], ['10:30', 'Rui Marques'], ['14:00', 'Laura Costa'],
    ]);
    const unwritten = await unwrittenSessions(store, clock, TZ);
    expect(unwritten.map((o) => [o.date, name(o.appointment.folder_id)])).toEqual([['2026-09-25', 'Helena Rocha']]);
  });

  it('shows the "next session" notes written before today’s sessions', async () => {
    const { store, name } = await demo();
    const due = await dueStickies(store, clock.startOf('day'));
    expect(due.map((d) => name(d.sticky.folder_id))).toEqual(['Inês Salgado', 'Rui Marques', 'Laura Costa']);
  });

  it('dates pages on their sessions, the latest edited last', async () => {
    const { store, name } = await demo();
    const recent = await recentPages(store, 3);
    expect(recent.map((p) => [p.date, p.time, name(p.folder_id)])).toEqual([
      ['2026-09-24', '16:00', 'Beatriz Nunes'], ['2026-09-23', '11:00', 'Tomás Ferreira'], ['2026-09-21', '10:30', 'Rui Marques'],
    ]);
    expect(recent[0]!.created_at).toBe('2026-09-24T15:50:00.000Z');
  });

  it('gives each folder its pages from the first session, so titles never carry a number', async () => {
    const { store } = await demo();
    const ines = await store.list('page', { where: 'folder_id = ?', params: ['00000000-0000-4000-8000-000000000001'], order: 'date' });
    expect(ines.map((p) => [p.date, p.template, p.title])).toEqual([
      ['2026-08-17', 'intake', ''], ['2026-08-24', 'free', ''], ['2026-08-31', 'free', ''], ['2026-09-07', 'free', ''],
      ['2026-09-14', 'dap', 'A hard week'], ['2026-09-21', 'dap', 'The worry window'],
    ]);
    expect((await store.list('page')).filter((p) => /\d/.test(p.title))).toEqual([]);
  });

  it('marks themes on Inês’s pages in every language, each on its words', async () => {
    for (const locale of ['en', 'pt', 'es'] as const) {
      const store = await Store.open(await SqlJsDb.create());
      await seedDemoPractice(store, locale, clock);
      const pages = await store.list('page', { where: 'folder_id = ?', params: ['00000000-0000-4000-8000-000000000001'], order: 'date' });
      const themes = folderThemes(pages, bySectionOrder);
      // sleep: 3 passages in 3 sessions; worry: 3 in 2; work: 2 in 2.
      expect(themes.map((s) => `${s.passages.length}/${s.pageIds.length}`).sort(), locale).toEqual(['2/2', '3/2', '3/3']);
      for (const p of pages) for (const x of p.passages ?? []) expect(locate(p.sections[x.section] ?? '', x), x.quote).toEqual({ start: x.start, end: x.end });
      // Rui's "avoidance" is offered in Inês's folder too.
      expect(await knownThemes(store), locale).toHaveLength(4);
    }
  });
});
