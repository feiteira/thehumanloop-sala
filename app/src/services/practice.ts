import { sha256 } from '@noble/hashes/sha2.js';
import { toHex, wipe } from '../core/bytes';
import { open, seal } from '../core/crypto/frames';
import {
  createKeyring, type Keyring, newPracticeKey, parseKeyring, replaceSlot, type SlotKind, subkey, unlockKeyring,
} from '../core/crypto/keyring';
import type { KdfParams } from '../core/crypto/kdf';
import { uuid } from '../core/ids';
import type { Attachment, Draft } from '../core/model/types';
import { Store } from '../core/store/store';
import { type Platform, PlatformError } from '../platform/types';

/**
 * Copies of the keys one backup needs. A lock that happens meanwhile wipes the practice's own
 * keys, not these, so a backup that is already running still writes a file that opens.
 * Call `wipe()` when done.
 */
export interface KeyCopy {
  practiceKey: Uint8Array;
  keyring: Keyring;
  readAttachment(att: Attachment): Promise<Uint8Array>;
  wipe(): void;
}

/**
 * An unlocked practice: the store, the practice key held in memory while unlocked, and the
 * operations that need that key (attachments, passphrase changes, backups).
 */
export class Practice {
  private fileKey: Uint8Array;
  private closed = false;
  /** The secret change running now, if any: the next one waits for it (see `changeSecret`). */
  private secretQueue: Promise<void> = Promise.resolve();
  /**
   * Six hex digits that name this practice's backup files, so two computers sharing one
   * backup folder never prune each other's. Derived from the practice key, so it survives a
   * restore onto a new computer.
   */
  readonly backupTag: string;

  private constructor(
    readonly platform: Platform,
    readonly store: Store,
    private key: Uint8Array,
    private keyring: Keyring,
  ) {
    this.fileKey = subkey(key, 'sala.files.v1');
    this.backupTag = backupTagOf(key);
  }

  /**
   * First run: a new practice key, protected by the passphrase and the recovery phrase. If the
   * new database cannot be set up or the keyring cannot be written (a full disk), what was made
   * is removed again, so trying again starts afresh instead of meeting a database that only the
   * lost key opens.
   */
  static async create(platform: Platform, secrets: { passphrase: string; recoveryPhrase: string }, opts: { params?: KdfParams } = {}): Promise<Practice> {
    const key = newPracticeKey();
    const keyring = await createKeyring(key, secrets, platform.kdf, opts);
    const db = await platform.practice.open(key, true);
    let store: Store | null = null;
    try {
      store = await Store.open(db);
      await platform.keyring.write(JSON.stringify(keyring, null, 2));
    } catch (e) {
      // The database opened with a key made just now, so it is a new one: nothing else is lost.
      await (store ? store.close() : db.close()).catch(() => undefined);
      wipe(key);
      await platform.practice.erase().catch((err: unknown) => console.error('removing a practice that was not set up failed', err));
      throw e;
    }
    return new Practice(platform, store, key, keyring);
  }

  /**
   * Restores a practice from a backup onto a device with no practice, keeping its keyring. The
   * keyring is not written yet: the caller writes it with `saveKeyring()` once everything is in.
   * Until then nobody can open the database, so a restore cut short (the window closed, the
   * computer switched off) leaves a database nobody can open, which the unlock screen offers to remove (see `practiceState`).
   */
  static async adopt(platform: Platform, key: Uint8Array, keyring: Keyring): Promise<Practice> {
    const db = await platform.practice.open(key, true);
    const store = await Store.open(db);
    return new Practice(platform, store, key.slice(), keyring);
  }

  /** Writes the keyring to this device: the last step of a restore (see `adopt`). */
  async saveKeyring(): Promise<void> {
    this.ensureOpen();
    await this.platform.keyring.write(JSON.stringify(this.keyring, null, 2));
  }

  static async unlock(platform: Platform, slot: SlotKind, secret: string): Promise<Practice> {
    const raw = await platform.keyring.read();
    if (!raw) throw new PlatformError('NOT_FOUND', 'no keyring on this device');
    const keyring = parseKeyring(raw);
    const key = await unlockKeyring(keyring, slot, secret, platform.kdf);
    const db = await platform.practice.open(key, false);
    return new Practice(platform, await Store.open(db), key, keyring);
  }

  get practiceKey(): Uint8Array {
    return this.key;
  }

  get currentKeyring(): Keyring {
    return this.keyring;
  }

  /** False once `lock()` has started: the store is closing and the keys are wiped. */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Copies of the keys, for work that must outlive a lock that starts meanwhile (a backup). */
  copyKeys(): KeyCopy {
    this.ensureOpen();
    const practiceKey = this.key.slice();
    const fileKey = this.fileKey.slice();
    const keyring = JSON.parse(JSON.stringify(this.keyring)) as Keyring;
    const blobs = this.platform.blobs;
    return {
      practiceKey,
      keyring,
      readAttachment: async (att) => open(fileKey, await blobs.read(att.blob_id), `attachment:${att.blob_id}`),
      wipe: () => {
        wipe(practiceKey);
        wipe(fileKey);
      },
    };
  }

  /**
   * Rewraps one slot of the keyring for a new passphrase or recovery phrase. It works on a copy
   * of the practice key, taken at the call: a lock that lands while the key derivation runs (or
   * while this change waits for another) wipes the practice's own key in place, and the new slot
   * must still wrap the real key, never a wiped one. Changes run one after the other, each on
   * the keyring the previous one wrote, so a new passphrase and a new recovery phrase saved
   * close together both end up in it.
   */
  changeSecret(slot: SlotKind, secret: string, opts: { params?: KdfParams } = {}): Promise<void> {
    return this.rewrap(slot, secret, opts);
  }

  /**
   * A new passphrase, once `current` is checked against the passphrase slot (WrongSecretError
   * if it does not open it). The key is copied before the check, as in `changeSecret`, so a lock
   * that lands while the check runs does not stop a change that has started.
   */
  changePassphrase(current: string, secret: string, opts: { params?: KdfParams } = {}): Promise<void> {
    return this.rewrap('passphrase', secret, opts, current);
  }

  private async rewrap(slot: SlotKind, secret: string, opts: { params?: KdfParams }, current?: string): Promise<void> {
    this.ensureOpen();
    const key = this.key.slice();
    const run = async () => {
      try {
        if (current !== undefined) wipe(await unlockKeyring(this.keyring, 'passphrase', current, this.platform.kdf));
        const next = await replaceSlot(this.keyring, slot, secret, key, this.platform.kdf, opts);
        await this.platform.keyring.write(JSON.stringify(next, null, 2));
        this.keyring = next;
      } finally {
        wipe(key);
      }
    };
    const p = this.secretQueue.then(run, run);
    this.secretQueue = p.catch(() => undefined);
    return p;
  }

  // ── Attachments ──────────────────────────────────────────────────────────────────────

  // Locking wipes the file key in place. Each use of it checks first, with no await between
  // the check and the use, so nothing is ever sealed or opened with a wiped key: once Sala
  // locks, these throw PlatformError('LOCKED') instead (see `isLocked`).

  private sealBlob(blobId: string, bytes: Uint8Array): Uint8Array {
    this.ensureOpen();
    return seal(this.fileKey, bytes, `attachment:${blobId}`);
  }

  private ensureOpen(): void {
    if (this.closed) throw new PlatformError('LOCKED', 'the practice is locked');
  }

  async addAttachment(
    bytes: Uint8Array,
    meta: Omit<Draft<'attachment'>, 'blob_id' | 'sha256' | 'size'>,
  ): Promise<Attachment> {
    const blobId = uuid();
    await this.platform.blobs.write(blobId, this.sealBlob(blobId, bytes));
    try {
      return await this.store.put('attachment', { ...meta, blob_id: blobId, sha256: toHex(sha256(bytes)), size: bytes.length });
    } catch (e) {
      // No record points at the file: remove it rather than leave it behind.
      await this.platform.blobs.remove(blobId).catch(() => undefined);
      throw e;
    }
  }

  /** Stores bytes for an attachment record that came from a restore or import. */
  async restoreAttachmentBytes(att: Attachment, bytes: Uint8Array): Promise<void> {
    await this.platform.blobs.write(att.blob_id, this.sealBlob(att.blob_id, bytes));
  }

  async readAttachment(att: Attachment): Promise<Uint8Array> {
    this.ensureOpen();
    const sealed = await this.platform.blobs.read(att.blob_id);
    this.ensureOpen();
    return open(this.fileKey, sealed, `attachment:${att.blob_id}`);
  }

  /**
   * Deletes an attachment. Only the record is marked deleted, so Undo and Recently deleted can
   * bring it back; the encrypted file is removed when the deleted item is erased for good
   * (services/trash.ts), 30 days later or on Delete now.
   */
  async removeAttachment(att: Attachment, opts: { batch?: string } = {}): Promise<void> {
    await this.store.remove('attachment', [att.id], opts);
  }

  /** Closes the database and forgets the keys. */
  async lock(): Promise<void> {
    this.closed = true;
    try {
      await this.store.close();
    } finally {
      wipe(this.key);
      wipe(this.fileKey);
    }
  }
}

/**
 * What is on this device: no practice, one that can be unlocked, or a database without its
 * keyring (a restore or a first setup cut short, or a keyring file lost). Without the keyring
 * nothing can open the database; Sala never removes it on its own: the unlock screen says what
 * happened and the therapist chooses to remove it.
 */
export async function practiceState(platform: Platform): Promise<'none' | 'ready' | 'noKeyring'> {
  if (!(await platform.practice.exists())) return 'none';
  try {
    return (await platform.keyring.read()) === null ? 'noKeyring' : 'ready';
  } catch (e) {
    // The keyring could not be read: Unlock says what is wrong.
    console.error('checking the practice on this device failed', e);
    return 'ready';
  }
}

/** True for the error a practice's file operations throw once it has locked. */
export function isLocked(e: unknown): boolean {
  return e instanceof PlatformError && e.code === 'LOCKED';
}

/** The tag in this practice's backup file names: the first six hex digits of a subkey. */
export function backupTagOf(practiceKey: Uint8Array): string {
  const k = subkey(practiceKey, 'sala.backup.tag');
  const tag = toHex(k).slice(0, 6);
  wipe(k);
  return tag;
}
