import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase } from '../../core/crypto/keyring';
import { emptyContact } from '../../core/model/types';
import { createMemoryPlatform } from '../../platform/memory';
import { Practice } from '../../services/practice';
import { attachFiles } from './Documents';

const FAST = { algo: 'argon2id' as const, m: 64, t: 1, p: 1, key_len: 32 };

async function setup() {
  const platform = createMemoryPlatform();
  const practice = await Practice.create(platform, { passphrase: 'pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
  const folder = await practice.store.put('folder', { label: 'Rui', colour: 'teal', status: 'active', tags: [], contact: emptyContact(), cover_note: '', archived_at: null, merged_into: null });
  for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) platform.fileStore.set(`/in/${name}`, new TextEncoder().encode(name));
  const writes: string[] = [];
  const write = platform.blobs.write;
  platform.blobs.write = async (id, bytes) => {
    writes.push(id);
    return write(id, bytes);
  };
  return { platform, practice, folder, writes };
}

describe('attachFiles', () => {
  it('stops between files once Sala starts locking, and writes nothing after', async () => {
    const { platform, practice, folder, writes } = await setup();
    let locking = false;
    const read = platform.files.read;
    platform.files.read = async (p) => {
      const bytes = await read(p);
      if (p.endsWith('b.pdf')) locking = true;
      return bytes;
    };
    const r = await attachFiles(practice, platform, ['/in/a.pdf', '/in/b.pdf', '/in/c.pdf'], { folderId: folder.id, pageId: null }, () => locking);
    expect(r).toEqual({ added: 1, tooLarge: 0, failed: 0 });
    expect(writes).toHaveLength(1);
  });

  it('a lock that lands while a file is read leaves nothing behind under the wiped key', async () => {
    const { platform, practice, folder, writes } = await setup();
    const read = platform.files.read;
    platform.files.read = async (p) => {
      const bytes = await read(p);
      await practice.lock();
      return bytes;
    };
    const r = await attachFiles(practice, platform, ['/in/a.pdf', '/in/b.pdf'], { folderId: folder.id, pageId: null }, () => false);
    expect(r).toEqual({ added: 0, tooLarge: 0, failed: 0 });
    expect(writes).toEqual([]);
  });
});
