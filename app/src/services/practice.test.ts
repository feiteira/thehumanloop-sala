import { describe, expect, it } from 'vitest';
import { newRecoveryPhrase, WrongSecretError } from '../core/crypto/keyring';
import type { KdfParams } from '../core/crypto/kdf';
import { createMemoryPlatform } from '../platform/memory';
import { Practice, practiceState } from './practice';

const FAST: KdfParams = { algo: 'argon2id', m: 64, t: 1, p: 1, key_len: 32 };

describe('changing a secret', () => {
  it('still wraps the real practice key when Sala locks while the key derivation runs', async () => {
    const platform = createMemoryPlatform();
    const phrase = newRecoveryPhrase();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: phrase }, { params: FAST });
    const practiceId = practice.store.practiceId;
    // A slow key derivation, like Argon2id with 64 MiB on a real computer.
    const kdf = platform.kdf;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    platform.kdf = async (...args) => {
      await gate;
      return kdf(...args);
    };
    const changing = practice.changeSecret('passphrase', 'new pass word', { params: FAST });
    await practice.lock(); // Lock pressed meanwhile: the practice's own key is wiped in place.
    release();
    await changing;
    platform.kdf = kdf;

    const reopened = await Practice.unlock(platform, 'passphrase', 'new pass word');
    expect(reopened.store.practiceId).toBe(practiceId);
    await reopened.lock();
    await (await Practice.unlock(platform, 'recovery_phrase', phrase)).lock();
  });

  it('keeps both a new passphrase and a new recovery phrase saved close together', async () => {
    const platform = createMemoryPlatform();
    const oldPhrase = newRecoveryPhrase();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: oldPhrase }, { params: FAST });
    const newPhrase = newRecoveryPhrase();
    // The second starts while the first is still deriving its key.
    const a = practice.changeSecret('passphrase', 'new pass word', { params: FAST });
    const b = practice.changeSecret('recovery_phrase', newPhrase, { params: FAST });
    await practice.lock(); // and Sala locks before either is written
    await Promise.all([a, b]);

    const opens = async (slot: 'passphrase' | 'recovery_phrase', secret: string) => {
      try {
        await (await Practice.unlock(platform, slot, secret)).lock();
        return true;
      } catch (e) {
        if (e instanceof WrongSecretError) return false;
        throw e;
      }
    };
    expect(await opens('passphrase', 'new pass word')).toBe(true);
    expect(await opens('recovery_phrase', newPhrase)).toBe(true);
    expect(await opens('passphrase', 'old pass word')).toBe(false);
    expect(await opens('recovery_phrase', oldPhrase)).toBe(false);
  });

  it('lets the next change run after one fails', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const write = platform.keyring.write.bind(platform.keyring);
    let fail = true;
    platform.keyring.write = async (text) => {
      if (fail) {
        fail = false;
        throw new Error('disk full');
      }
      return write(text);
    };
    const failing = practice.changeSecret('passphrase', 'first pass word', { params: FAST });
    const next = practice.changeSecret('passphrase', 'second pass word', { params: FAST });
    await expect(failing).rejects.toThrow('disk full');
    await next;
    await practice.lock();
    await (await Practice.unlock(platform, 'passphrase', 'second pass word')).lock();
  });

  it('checks the current passphrase and still saves the new one when Sala locks during the check', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    const kdf = platform.kdf;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let calls = 0;
    platform.kdf = async (...args) => {
      calls += 1;
      await gate;
      return kdf(...args);
    };
    // The key is copied when Change is pressed; the check of the current passphrase runs after.
    const changing = practice.changePassphrase('old pass word', 'new pass word', { params: FAST });
    await Promise.resolve();
    expect(calls).toBe(1); // the check is under way
    await practice.lock(); // and Sala locks before it is done, with nothing waiting for it
    release();
    await changing;
    platform.kdf = kdf;
    await (await Practice.unlock(platform, 'passphrase', 'new pass word')).lock();
  });

  it('leaves the passphrase as it was when the current one is typed wrong', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await expect(practice.changePassphrase('not the pass word', 'new pass word', { params: FAST })).rejects.toBeInstanceOf(WrongSecretError);
    await practice.lock();
    await expect(Practice.unlock(platform, 'passphrase', 'new pass word')).rejects.toBeInstanceOf(WrongSecretError);
    await (await Practice.unlock(platform, 'passphrase', 'old pass word')).lock();
  });

  it('refuses once the practice has locked', async () => {
    const platform = createMemoryPlatform();
    const practice = await Practice.create(platform, { passphrase: 'old pass word', recoveryPhrase: newRecoveryPhrase() }, { params: FAST });
    await practice.lock();
    await expect(practice.changeSecret('passphrase', 'new pass word', { params: FAST })).rejects.toMatchObject({ code: 'LOCKED' });
    await (await Practice.unlock(platform, 'passphrase', 'old pass word')).lock();
  });
});

describe('setting up a practice', () => {
  it('removes what it made when the keyring cannot be written, so trying again works', async () => {
    const platform = createMemoryPlatform();
    const write = platform.keyring.write.bind(platform.keyring);
    let fail = true;
    platform.keyring.write = async (text) => {
      if (fail) {
        fail = false;
        throw new Error('No space left on device');
      }
      return write(text);
    };
    const secrets = { passphrase: 'a long enough pass word', recoveryPhrase: newRecoveryPhrase() };
    await expect(Practice.create(platform, secrets, { params: FAST })).rejects.toThrow('No space left on device');
    expect(await practiceState(platform)).toBe('none');

    const practice = await Practice.create(platform, secrets, { params: FAST });
    await practice.lock();
    await (await Practice.unlock(platform, 'passphrase', secrets.passphrase)).lock();
  });
});
