import { sha256 } from '@noble/hashes/sha2.js';
import { DateTime } from 'luxon';
import { toHex, wipe } from '../core/bytes';
import type { SlotKind } from '../core/crypto/keyring';
import {
  buildSalaZip, decryptSala, encryptWithPassword, encryptWithPracticeKey, type ExportLabels, type ExportRecord,
  protectionOf, readSalaZip, type ReadResult, type Unlock,
} from '../core/export/sala';
import { compareHlc } from '../core/hlc';
import type { Attachment, Entity, Kind, Page } from '../core/model/types';
import type { Store, Tombstone, TombstoneInfo } from '../core/store/store';
import { type FileEntry, type Platform, PlatformError } from '../platform/types';
import { JobStopped, stopper } from './jobs';
import { isLocked, Practice } from './practice';
import { blankRecord } from './trash';

// Backups, exports and restores of the whole practice.

export const BACKUP_PREFIX = 'Sala backup ';
export const META = {
  backupFolder: 'backup.folder',
  /** The old setting: how many backup files to keep. Still rules files named without a tag. */
  backupKeep: 'backup.keep',
  /** How far back backups go, in days (HISTORY_DAYS). */
  backupHistory: 'backup.history_days',
  backupLastOk: 'backup.last_ok_at',
  /** `<ISO time> <BackupErrorCode>` of the last failed backup; '' after a good one. */
  backupLastError: 'backup.last_error',
  /** The practice's newest write stamp when the last backup was made. */
  backupLastHlc: 'backup.last_hlc',
  /** The last backup's file name, so an unchanged practice is skipped only while it exists. */
  backupLastFile: 'backup.last_file',
  /** A fingerprint of the keyring in the last backup: a new passphrase means a new backup. */
  backupLastKeyring: 'backup.last_keyring',
} as const;

/** Old default for `backup.keep`. */
export const DEFAULT_KEEP = 10;
export const BACKUP_INTERVAL_HOURS = 24;
/** Today warns when the last good backup is older than this. */
export const BACKUP_STALE_DAYS = 3;

export const HISTORY_DAYS = [30, 90, 365] as const;
export type HistoryDays = (typeof HISTORY_DAYS)[number];
export const DEFAULT_HISTORY_DAYS: HistoryDays = 90;

/** The old "keep the last n backups" choice, read as a history length. */
export function historyFromKeep(keep: string | null): HistoryDays {
  const n = Number(keep);
  if (!keep || !Number.isFinite(n)) return DEFAULT_HISTORY_DAYS;
  return n <= 5 ? 30 : n <= 10 ? 90 : 365;
}

export async function backupHistoryDays(store: Store): Promise<HistoryDays> {
  const days = Number(await store.getMeta(META.backupHistory));
  if ((HISTORY_DAYS as readonly number[]).includes(days)) return days as HistoryDays;
  return historyFromKeep(await store.getMeta(META.backupKeep));
}

/**
 * How an export carries a deleted item: only that it was deleted, never its content. Marked
 * `scrubbed` (there is nothing in it to restore) and `content_omitted` (the content still
 * exists where the file came from, so an import keeps a copy it already has, as deleted).
 */
export interface OmittedInfo extends TombstoneInfo {
  content_omitted?: boolean;
}

/** A deleted record as an export writes it: its id, dates and delete, with the content blanked. */
export function withoutContent(kind: Kind, r: Entity<Kind>): Entity<Kind> {
  const { deleted_batch } = r as Tombstone<Kind>;
  const info: OmittedInfo = { scrubbed: true, content_omitted: true, ...(deleted_batch ? { deleted_batch } : {}) };
  return { ...blankRecord(kind, r), ...info, id: r.id, created_at: r.created_at, updated_at_hlc: r.updated_at_hlc, deleted: true } as Entity<Kind>;
}

async function records(practice: Practice, keepDeletedContent: boolean): Promise<ExportRecord[]> {
  const out: ExportRecord[] = [];
  for await (const r of practice.store.all()) {
    out.push(r.record.deleted && !keepDeletedContent && !(r.record as Tombstone<Kind>).scrubbed ? { kind: r.kind, record: withoutContent(r.kind, r.record) } : r);
  }
  return out;
}

export interface ZipOptions {
  includeProcessNotes: boolean;
  /**
   * Deleted items keep their content (backups: Recently deleted survives a restore). Exports
   * leave it out, so a file handed to someone never holds what was deleted.
   */
  keepDeletedContent?: boolean;
  now?: Date;
  readAttachment?: (a: Attachment) => Promise<Uint8Array>;
  /** Asked before each document is read; once it says yes, the build throws `JobStopped`. */
  shouldStop?: () => boolean;
}

/**
 * The practice as a .sala ZIP. A document whose file is missing or damaged is left out; a lock
 * that wiped the keys meanwhile stops the build instead (the file would lack every document
 * after that point).
 */
export async function buildZip(practice: Practice, labels: ExportLabels, opts: ZipOptions) {
  const { includeProcessNotes, now = new Date(), readAttachment = (a: Attachment) => practice.readAttachment(a) } = opts;
  const stopIfAsked = stopper(opts.shouldStop);
  const info = await practice.platform.info();
  return buildSalaZip(await records(practice, !!opts.keepDeletedContent), {
    appVersion: info.version,
    practiceId: practice.store.practiceId,
    includeProcessNotes,
    keepDeletedFiles: !!opts.keepDeletedContent,
    labels,
    now,
    readAttachment: async (a: Attachment) => {
      stopIfAsked();
      try {
        return await readAttachment(a);
      } catch (e) {
        if (isLocked(e)) throw new JobStopped();
        stopIfAsked();
        console.error('document left out of the file', a.id, e);
        return null; // a missing file must not stop the whole export
      }
    },
  });
}

// ── Backup file names ────────────────────────────────────────────────────────────────

const TAGGED = /^Sala backup ([0-9a-f]{6}) (\d{4}-\d{2}-\d{2} \d{6})\.sala$/;
const LEGACY = /^Sala backup (\d{4}-\d{2}-\d{2} \d{4})\.sala$/;
const TEMP = /^Sala backup .*\.sala\.tmp$/;

/** `Sala backup <tag> 2026-09-28 093015.sala`, in the computer's local time. */
export function backupFileName(tag: string, now: Date): string {
  return `${BACKUP_PREFIX}${tag} ${DateTime.fromJSDate(now).toFormat('yyyy-MM-dd HHmmss')}.sala`;
}

export interface BackupName {
  /** null for files named before backups carried a tag. */
  tag: string | null;
  at: DateTime;
}

export function parseBackupName(name: string): BackupName | null {
  const tagged = TAGGED.exec(name);
  if (tagged) {
    const at = DateTime.fromFormat(tagged[2]!, 'yyyy-MM-dd HHmmss');
    return at.isValid ? { tag: tagged[1]!, at } : null;
  }
  const legacy = LEGACY.exec(name);
  if (legacy) {
    const at = DateTime.fromFormat(legacy[1]!, 'yyyy-MM-dd HHmm');
    return at.isValid ? { tag: null, at } : null;
  }
  return null;
}

// ── Which backups to keep ────────────────────────────────────────────────────────────

/** Backups always kept, however old: a wrong clock must never empty the folder. */
const KEEP_NEWEST = 3;
/** Everything from the last day is kept, up to this many. */
const KEEP_RECENT = 10;

export interface PruneOptions {
  tag: string;
  historyDays: number;
  /** The old count rule, for files named without a tag. */
  legacyKeep: number;
  now: Date;
  /** Never removed (the backup just written). */
  keep?: string;
}

/**
 * The backup files to delete, by name. This practice's backups thin out with age: everything
 * from the last 24 hours (at most 10), one a day for 14 days, one a week for 8 weeks, one a
 * month for 12 months, never older than the history length. Files of other practices are
 * never touched. Files named without a tag keep the old rule: the newest `legacyKeep`.
 */
export function backupsToPrune(names: string[], opts: PruneOptions): string[] {
  const now = DateTime.fromJSDate(opts.now);
  const parsed = names.flatMap((name) => {
    const p = parseBackupName(name);
    return p ? [{ name, ...p }] : [];
  });
  const remove: string[] = [];

  const ours = parsed.filter((p) => p.tag === opts.tag).sort((a, b) => b.at.toMillis() - a.at.toMillis());
  const seen = new Set<string>();
  let recent = 0;
  ours.forEach((b, i) => {
    const ageDays = now.diff(b.at, 'days').days;
    const day = `d${b.at.toISODate()}`;
    const week = `w${b.at.toFormat("kkkk-'W'WW")}`;
    const month = `m${b.at.toFormat('yyyy-MM')}`;
    let keep = false;
    if (i < KEEP_NEWEST || b.name === opts.keep) keep = true;
    else if (ageDays < 1 && recent < KEEP_RECENT) keep = true;
    else if (ageDays >= opts.historyDays) keep = false;
    else if (ageDays < 14) keep = !seen.has(day);
    else if (ageDays < 56) keep = !seen.has(week);
    else if (ageDays < 365) keep = !seen.has(month);
    if (!keep) {
      remove.push(b.name);
      return;
    }
    if (ageDays < 1) recent++;
    seen.add(day).add(week).add(month);
  });

  const legacy = parsed.filter((p) => p.tag === null).sort((a, b) => b.name.localeCompare(a.name));
  for (const old of legacy.slice(Math.max(1, opts.legacyKeep))) remove.push(old.name);
  return remove;
}

// ── Errors ───────────────────────────────────────────────────────────────────────────

export const BACKUP_ERRORS = ['FOLDER_MISSING', 'PERMISSION', 'DISK_FULL', 'ERROR'] as const;
export type BackupErrorCode = (typeof BACKUP_ERRORS)[number];

/** Why a backup did not happen. `code` is what the screens translate. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode | 'EXAMPLE' | 'NO_FOLDER' | 'LOCKED',
    message: string,
  ) {
    super(message);
  }
}

/** Sorts any failure into one of the reasons the therapist is told. */
export function backupErrorCode(e: unknown): BackupErrorCode {
  if (e instanceof BackupError && (BACKUP_ERRORS as readonly string[]).includes(e.code)) return e.code as BackupErrorCode;
  if (e instanceof PlatformError) {
    if (e.code === 'NOT_FOUND') return 'FOLDER_MISSING';
    if (e.code === 'PERMISSION_DENIED') return 'PERMISSION';
    // The shell reports the operating system's text: ENOSPC is error 28, Windows says 112 or 39.
    if (/os error (28|39|112)\b|no space left|not enough space|disk (is )?full/i.test(e.message)) return 'DISK_FULL';
  }
  return 'ERROR';
}

// ── Status ───────────────────────────────────────────────────────────────────────────

export interface BackupStatus {
  folder: string | null;
  lastOk: string | null;
  lastError: { at: string; code: BackupErrorCode } | null;
  /** A day has passed since the last good backup, or the last one failed. */
  due: boolean;
}

function parseLastError(raw: string | null): BackupStatus['lastError'] {
  if (!raw) return null;
  const [at = '', code = ''] = raw.split(' ');
  return { at, code: (BACKUP_ERRORS as readonly string[]).includes(code) ? (code as BackupErrorCode) : 'ERROR' };
}

export async function backupStatus(practice: Practice, now = new Date()): Promise<BackupStatus> {
  const folder = await practice.store.getMeta(META.backupFolder);
  const lastOk = await practice.store.getMeta(META.backupLastOk);
  const lastError = parseLastError(await practice.store.getMeta(META.backupLastError));
  const old = !lastOk || DateTime.fromJSDate(now).diff(DateTime.fromISO(lastOk), 'hours').hours >= BACKUP_INTERVAL_HOURS;
  return { folder: folder || null, lastOk, lastError, due: !!folder && (old || !!lastError) };
}

/** True when the last good backup is older than BACKUP_STALE_DAYS (or there never was one). */
export function backupIsStale(status: BackupStatus, now = new Date()): boolean {
  if (!status.lastOk) return true;
  return DateTime.fromJSDate(now).diff(DateTime.fromISO(status.lastOk), 'days').days > BACKUP_STALE_DAYS;
}

// ── Backing up ───────────────────────────────────────────────────────────────────────

export interface BackupOptions {
  now?: Date;
  /** Back up even when nothing changed since the last backup (Back up now, a new folder). */
  force?: boolean;
}

export type BackupResult = { written: true; path: string } | { written: false; reason: 'unchanged' };

const TEMP_MAX_AGE_MS = 60 * 60 * 1000;

const keyringPrint = (keyring: unknown) => toHex(sha256(new TextEncoder().encode(JSON.stringify(keyring)))).slice(0, 16);

/**
 * Writes an encrypted backup of the whole practice to the chosen folder, checks that it opens,
 * then thins out older backups. Without `force`, does nothing when the practice has not
 * changed since the last backup and that backup is still in the folder.
 *
 * Works on copies of the keys, so a lock that starts meanwhile cannot spoil the file. Never
 * runs in the example practice.
 */
export async function runBackup(practice: Practice, labels: ExportLabels, opts: BackupOptions = {}): Promise<BackupResult> {
  const now = opts.now ?? new Date();
  const { store, platform } = practice;
  const { files } = platform;
  if ((await platform.info()).example) throw new BackupError('EXAMPLE', 'the example practice is never backed up');
  const folder = await store.getMeta(META.backupFolder);
  if (!folder) throw new BackupError('NO_FOLDER', 'no backup folder chosen');

  // Everything the backup needs from the database or the keys, read before any slow step.
  const keys = practice.copyKeys();
  try {
    const [latestHlc, lastHlc, lastFile, lastKeyring, historyDays, legacyKeep] = await Promise.all([
      store.latestHlc(),
      store.getMeta(META.backupLastHlc),
      store.getMeta(META.backupLastFile),
      store.getMeta(META.backupLastKeyring),
      backupHistoryDays(store),
      store.getMeta(META.backupKeep),
    ]);
    const latest = latestHlc ?? '';
    const keyring = keyringPrint(keys.keyring);
    try {
      // An unplugged drive or a moved folder fails here, at once.
      if (!(await files.exists(folder))) throw new BackupError('FOLDER_MISSING', 'backup folder not found');
      const listed = await files.list(folder, false);

      const unchanged = latest === lastHlc && keyring === lastKeyring && !!lastFile && listed.some((e) => e.name === lastFile);
      if (unchanged && !opts.force) {
        await markGood(store, now);
        return { written: false, reason: 'unchanged' };
      }

      // Large practices hold many scans: let go of each copy as soon as it is no longer needed.
      let zip: Uint8Array | null = await buildZip(practice, labels, {
        includeProcessNotes: true,
        keepDeletedContent: true,
        now,
        readAttachment: keys.readAttachment,
      });
      const zipLength = zip.length;
      let bytes: Uint8Array | null = encryptWithPracticeKey(zip, keys.practiceKey, keys.keyring);
      zip = null;
      let name = backupFileName(practice.backupTag, now);
      for (let s = 1; listed.some((e) => e.name === name) && s < 60; s++) {
        name = backupFileName(practice.backupTag, new Date(now.getTime() + s * 1000));
      }
      const path = files.join(folder, name);
      await files.write(path, bytes);
      bytes = null;

      // Read it back: a file that does not open must never replace good ones. Opening checks
      // every byte (the encryption is authenticated).
      const back = await decryptSala(await files.read(path), { kind: 'practice-key', practiceKey: keys.practiceKey }, platform.kdf).catch(() => null);
      if (!back || back.zip.length !== zipLength) {
        await files.remove(path).catch(() => undefined);
        throw new BackupError('ERROR', 'the backup did not read back');
      }

      await prune(files, listed, name, {
        tag: practice.backupTag,
        historyDays,
        legacyKeep: Number(legacyKeep ?? DEFAULT_KEEP) || DEFAULT_KEEP,
        now,
      });

      await store.setMeta(META.backupLastHlc, latest);
      await store.setMeta(META.backupLastFile, name);
      await store.setMeta(META.backupLastKeyring, keyring);
      await markGood(store, now);
      return { written: true, path };
    } catch (e) {
      const code = backupErrorCode(e);
      await store.setMeta(META.backupLastError, `${now.toISOString()} ${code}`).catch(() => undefined);
      throw e instanceof BackupError ? e : new BackupError(code, (e as Error).message);
    }
  } finally {
    keys.wipe();
  }
}

async function markGood(store: Store, now: Date): Promise<void> {
  await store.setMeta(META.backupLastOk, now.toISOString());
  await store.setMeta(META.backupLastError, '');
}

async function prune(files: Platform['files'], listed: FileEntry[], written: string, opts: Omit<PruneOptions, 'keep'>): Promise<void> {
  const byName = new Map(listed.filter((e) => !e.is_dir).map((e) => [e.name, e]));
  for (const name of backupsToPrune([...byName.keys(), written], { ...opts, keep: written })) {
    const entry = byName.get(name);
    if (entry) await files.remove(entry.path).catch((e) => console.warn('could not remove an old backup', e));
  }
  // Half-written files left by a crash or an unplugged drive.
  for (const e of listed) {
    if (!e.is_dir && TEMP.test(e.name) && opts.now.getTime() - e.modified_ms > TEMP_MAX_AGE_MS) {
      await files.remove(e.path).catch(() => undefined);
    }
  }
}

// ── Export and import ────────────────────────────────────────────────────────────────

/**
 * Writes the whole practice to one .sala file. Once `shouldStop` says yes (Sala is locking), it
 * throws `JobStopped` and writes nothing, rather than a file with documents missing.
 */
export async function exportTo(
  practice: Practice,
  path: string,
  labels: ExportLabels,
  opts: { includeProcessNotes: boolean; password: string | null; shouldStop?: () => boolean },
): Promise<void> {
  const zip = await buildZip(practice, labels, { includeProcessNotes: opts.includeProcessNotes, shouldStop: opts.shouldStop });
  const bytes = opts.password ? await encryptWithPassword(zip, opts.password, practice.platform.kdf) : zip;
  stopper(opts.shouldStop)();
  if (!practice.isOpen) throw new JobStopped();
  await practice.platform.files.write(path, bytes);
}

export { protectionOf };

export async function openSalaFile(platform: Platform, bytes: Uint8Array, unlock: Unlock) {
  const { zip, practiceKey, keyring } = await decryptSala(bytes, unlock, platform.kdf);
  return { contents: readSalaZip(zip), practiceKey, keyring };
}

/**
 * Opens a .sala file with this practice's own key: its own backups need no passphrase.
 * Returns null when the file is not one of them (another practice's backup, or an export).
 */
export async function openOwnBackup(practice: Practice, bytes: Uint8Array): Promise<ReadResult | null> {
  if (protectionOf(bytes) !== 'practice-key') return null;
  const keys = practice.copyKeys();
  try {
    return (await openSalaFile(practice.platform, bytes, { kind: 'practice-key', practiceKey: keys.practiceKey })).contents;
  } catch {
    return null;
  } finally {
    keys.wipe();
  }
}

/**
 * Readies a file's records for merging, so that an import never erases what the file left out:
 * - A deleted item the file carries without its content (exports do) keeps the content of the
 *   copy here, deleted, so it can still be restored from Recently deleted.
 * - A file made without private process notes carries them blank. Where such a page would
 *   replace one of ours, our note stays.
 */
async function readyToMerge(store: Store, contents: ReadResult): Promise<ExportRecord[]> {
  const keepNotes = !contents.manifest.include_process_notes;
  const out: ExportRecord[] = [];
  for (const r of contents.records) {
    const omitted = !!(r.record as OmittedInfo).content_omitted;
    if (!omitted && !(keepNotes && r.kind === 'page')) {
      out.push(r);
      continue;
    }
    const local = (await store.get(r.kind, r.record.id)) as Tombstone<Kind> | null;
    const newer = !local || compareHlc(local.updated_at_hlc, r.record.updated_at_hlc) < 0;
    if (omitted) {
      const { content_omitted: _o, ...incoming } = r.record as Tombstone<Kind> & OmittedInfo;
      if (!newer || !local || local.scrubbed) {
        out.push({ kind: r.kind, record: incoming as Entity<Kind> });
        continue;
      }
      const { deleted_batch: _b, ...kept } = local;
      const batch = incoming.deleted_batch ? { deleted_batch: incoming.deleted_batch } : {};
      out.push({ kind: r.kind, record: { ...kept, ...batch, deleted: true, updated_at_hlc: incoming.updated_at_hlc } as Entity<Kind> });
      continue;
    }
    const incoming = r.record as Page;
    const own = local as Page | null;
    if (newer && own?.process_note && !incoming.process_note) {
      out.push({ kind: 'page', record: { ...incoming, process_note: own.process_note } });
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * Merges a .sala file's contents into the open practice. Newer versions of each record win.
 * Anything it changes counts as a change for the next backup, even when the file's records are
 * older than this practice's newest write.
 *
 * Once `shouldStop` says yes (Sala is locking), it throws `JobStopped` before the next document
 * file. The records are in by then, and merging the same file again adds the missing files and
 * nothing twice.
 */
export async function mergeInto(
  practice: Practice,
  contents: ReadResult,
  shouldStop?: () => boolean,
): Promise<{ records: number; attachments: number }> {
  const check = stopper(shouldStop);
  check();
  const written = await practice.store.merge(await readyToMerge(practice.store, contents));
  let attachments = 0;
  // The newest write stamp may not have moved (a colleague's older notes, an old backup):
  // forget the last backup's fingerprint so the next one is made, also after a stop.
  const forgetLastBackup = async () => {
    if (written || attachments) await practice.store.deleteMeta(META.backupLastHlc);
  };
  try {
    for (const { kind, record } of contents.records) {
      if (kind !== 'attachment') continue;
      const bytes = contents.attachments.get(record.id);
      if (!bytes) continue;
      check();
      // For documents here that still have their content, deleted ones too (a backup carries
      // the files of Recently deleted). One erased for good here never gets its file back.
      const local = (await practice.store.get('attachment', record.id)) as Tombstone<'attachment'> | null;
      if (!local || local.scrubbed || local.sha256 !== (record as Attachment).sha256) continue;
      try {
        await practice.readAttachment(local);
      } catch (e) {
        // Sala locked meanwhile: the file here may be fine, and the key to check it is gone.
        if (isLocked(e)) throw e;
        await practice.restoreAttachmentBytes(local, bytes);
        attachments++;
      }
    }
  } catch (e) {
    await forgetLastBackup().catch(() => undefined);
    throw e;
  }
  await forgetLastBackup();
  return { records: written, attachments };
}

/**
 * Restores a backup onto a device that has no practice yet. The practice keeps its original
 * key and keyring, so the same passphrase and recovery phrase keep working.
 */
export async function restoreBackup(platform: Platform, bytes: Uint8Array, slot: SlotKind, secret: string): Promise<Practice> {
  const { contents, practiceKey, keyring } = await openSalaFile(platform, bytes, { kind: 'secret', slot, secret });
  let practice: Practice;
  try {
    if (!practiceKey || !keyring) throw new Error('not a backup file');
    practice = await Practice.adopt(platform, practiceKey, keyring);
  } finally {
    // The practice keeps its own copy; this one would otherwise stay in memory after a lock.
    if (practiceKey) wipe(practiceKey);
  }
  try {
    await mergeInto(practice, contents);
    // Last: a restore cut short before this leaves no practice behind, only leftovers that the
    // unlock screen offers to remove (practiceState), rather than a practice with things missing.
    await practice.saveKeyring();
  } catch (e) {
    // Not opened: close it, so its keys do not stay in memory and what is left can be removed.
    await practice.lock().catch(() => undefined);
    throw e;
  }
  return practice;
}
