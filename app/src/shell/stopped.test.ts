import { describe, expect, it } from 'vitest';
import { addStopped } from './stopped';

describe('work stopped by a lock', () => {
  it('keeps one line per kind and counts documents together', () => {
    let list = addStopped([], { kind: 'documents', count: 2 });
    list = addStopped(list, { kind: 'export' });
    list = addStopped(list, { kind: 'documents', count: 3 });
    list = addStopped(list, { kind: 'export' });
    expect(list).toEqual([{ kind: 'documents', count: 5 }, { kind: 'export' }]);
  });

  it('tells once that a new passphrase or recovery phrase was saved', () => {
    let list = addStopped([], { kind: 'passphraseSaved' });
    list = addStopped(list, { kind: 'phraseSaved' });
    list = addStopped(list, { kind: 'passphraseSaved' });
    expect(list).toEqual([{ kind: 'passphraseSaved' }, { kind: 'phraseSaved' }]);
  });

  it('says nothing about documents when none were left out', () => {
    expect(addStopped([], { kind: 'documents', count: 0 })).toEqual([]);
  });
});
