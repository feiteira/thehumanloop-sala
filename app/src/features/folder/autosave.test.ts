import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyContact } from '../../core/model/types';
import { Store } from '../../core/store/store';
import { SqlJsDb } from '../../platform/sqljs';
import { Savers } from '../../shell/savers';
import { Autosave, type SaveState } from './autosave';

afterEach(() => {
  vi.useRealTimers();
});

/** A write that waits until the test lets it finish. */
function gatedWrites() {
  const log: string[] = [];
  const gates: (() => void)[] = [];
  const write = (title: string) =>
    new Promise<void>((resolve) => {
      log.push(`start ${title}`);
      gates.push(() => {
        log.push(`done ${title}`);
        resolve();
      });
    });
  return { log, write, open: () => gates.shift()?.() };
}

describe('Autosave', () => {
  it('writes once typing stops', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const states: SaveState['kind'][] = [];
    const auto = new Autosave<string>(async (d) => void writes.push(d), (s) => states.push(s.kind), 700);
    auto.change('a');
    auto.change('ab');
    await vi.advanceTimersByTimeAsync(699);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(['ab']);
    expect(states.at(-1)).toBe('saved');
  });

  it('waits for the write already running, then writes what was typed meanwhile', async () => {
    const { log, write, open } = gatedWrites();
    const auto = new Autosave<string>(write);
    auto.change('Sl');
    const first = auto.flush();
    auto.change('Slept badly');
    const second = auto.flush();
    await Promise.resolve();
    expect(log).toEqual(['start Sl']);
    open();
    await first;
    await vi.waitFor(() => expect(log).toEqual(['start Sl', 'done Sl', 'start Slept badly']));
    open();
    expect(await second).toBe(true);
    expect(auto.hasPending).toBe(false);
  });

  it('keeps what was typed after a failed write, so it can be tried again', async () => {
    let fail = true;
    const writes: string[] = [];
    const states: SaveState['kind'][] = [];
    const auto = new Autosave<string>(
      async (d) => {
        if (fail) throw new Error('disk full');
        writes.push(d);
      },
      (s) => states.push(s.kind),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auto.change('notes');
    expect(await auto.flush()).toBe(false);
    expect(states.at(-1)).toBe('failed');
    expect(auto.hasPending).toBe(true);
    fail = false;
    expect(await auto.flush()).toBe(true);
    expect(writes).toEqual(['notes']);
    expect(states.at(-1)).toBe('saved');
  });

  it('as a saver, finishes the last words before the store is closed', async () => {
    const store = await Store.open(await SqlJsDb.create());
    const folder = await store.put('folder', {
      label: 'Inês S.', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null,
    });
    const page = await store.put('page', {
      folder_id: folder.id, date: '2026-09-28', time: null, duration_min: null, template: 'free', title: '', sections: {}, process_note: '', import_provenance: null,
    });
    const order: string[] = [];
    const auto = new Autosave<string>(async (body) => {
      // A slow disk: the write is still running when the lock starts.
      await new Promise((r) => setTimeout(r, 30));
      await store.update('page', page.id, { sections: { body } });
      order.push(`saved ${body}`);
    });
    auto.change('Slept');
    void auto.flush();
    auto.change('Slept badly');

    // What AppState.lock does: run the savers, then close the store.
    const savers = new Savers();
    savers.register(() => auto.flush().then(() => undefined));
    await savers.run();
    expect((await store.get('page', page.id))?.sections.body).toBe('Slept badly');
    order.push('closed');
    await store.close();
    expect(order).toEqual(['saved Slept', 'saved Slept badly', 'closed']);
  });
});
