import { sha256 } from '@noble/hashes/sha2.js';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { DateTime } from 'luxon';
import { concatBytes, fromBase64, fromUtf8, randomBytes, readU32be, toBase64, toHex, u32be, utf8 } from '../bytes';
import { toIcs } from '../calendar/ics';
import { readableStart } from '../calendar/occurrences';
import { ARGON2_PARAMS, type Kdf, type KdfParams, normalizePassphrase } from '../crypto/kdf';
import { open, seal } from '../crypto/frames';
import { type Keyring, type SlotKind, subkey, unlockKeyring } from '../crypto/keyring';
import type { Attachment, Entity, Folder, Kind, Page, Sticky } from '../model/types';
import { KINDS } from '../model/types';
import { inReadingOrder, locate } from '../model/passages';
import { bySectionOrder, sectionsOf } from '../model/sections';
import type { Tombstone } from '../store/store';
import * as fhir from './fhir';

// The .sala file: one ZIP with everything, in open formats (see docs/spec/export-v1.md).
// It may be wrapped in an encrypted container, either under a password the therapist
// chooses (exports) or under the practice key with the keyring alongside (backups).

export const FORMAT = 'sala-export';
export const FORMAT_VERSION = 1;

export interface ExportRecord {
  kind: Kind;
  record: Entity<Kind>;
}

export interface ExportLabels {
  sectionTitle: (template: string, key: string) => string;
  neutralAppointment: string;
  stickyHeading: string;
  themesHeading: string;
  processNoteHeading: string;
  readme: string;
}

export interface Manifest {
  format: typeof FORMAT;
  version: number;
  app_version: string;
  created_at: string;
  practice_id: string;
  include_process_notes: boolean;
  counts: Partial<Record<Kind, number>>;
  files: Record<string, string>; // path → SHA-256 (hex)
}

export interface BuildOptions {
  appVersion: string;
  practiceId: string;
  includeProcessNotes: boolean;
  labels: ExportLabels;
  readAttachment: (a: Attachment) => Promise<Uint8Array | null>;
  /**
   * Also writes the files of deleted documents that still have their content (backups, so a
   * document in Recently deleted can still be restored after a restore). The calendar and FHIR
   * files list live documents only.
   */
  keepDeletedFiles?: boolean;
  now?: Date;
}

const safeName = (s: string) =>
  s.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';

const ALREADY_COMPRESSED = /^(image\/(jpeg|png|webp|gif|heic)|application\/(pdf|zip)|video|audio)/;

function pageMarkdown(p: Page, stickies: Sticky[], labels: ExportLabels, includeProcess: boolean): string {
  const lines = [`# ${p.title || p.date}`, '', `${p.date}${p.time ? ` ${p.time}` : ''}${p.duration_min ? ` · ${p.duration_min} min` : ''}`, ''];
  // The template's sections, then text kept from an earlier template, each under its title
  // (a free-text page's own notes need none).
  for (const s of sectionsOf(p)) {
    const text = s.text.trim();
    if (!text) continue;
    if (!(s.inTemplate && p.template === 'free')) lines.push(`## ${labels.sectionTitle(p.template, s.key)}`, '');
    lines.push(text, '');
  }
  // Marked words with their themes; words no longer in the note are left out.
  const marked = inReadingOrder(p.passages ?? [], bySectionOrder).filter((x) => locate(p.sections[x.section] ?? '', x));
  if (marked.length) {
    lines.push(`## ${labels.themesHeading}`, '');
    for (const x of marked) lines.push(`- “${x.quote.replace(/\s+/g, ' ').trim()}” — ${x.themes.join(', ')}`);
    lines.push('');
  }
  if (includeProcess && p.process_note.trim()) lines.push(`## ${labels.processNoteHeading}`, '', p.process_note.trim(), '');
  if (stickies.length) {
    lines.push(`## ${labels.stickyHeading}`, '');
    for (const s of stickies) lines.push(`- ${s.state === 'peeled' ? '~~' : ''}${s.text}${s.state === 'peeled' ? '~~' : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Builds the (unencrypted) ZIP of a whole practice. */
export async function buildSalaZip(records: ExportRecord[], opts: BuildOptions): Promise<Uint8Array> {
  const now = opts.now ?? new Date();
  const files: Zippable = {};
  const hashes: Record<string, string> = {};
  const add = (path: string, bytes: Uint8Array, compress = true) => {
    files[path] = [bytes, { level: compress ? 6 : 0 }];
    hashes[path] = toHex(sha256(bytes));
  };

  const byKind = new Map<Kind, Entity<Kind>[]>(KINDS.map((k) => [k, []]));
  for (const r of records) byKind.get(r.kind)?.push(r.record);

  // 1. Lossless records, one JSON object per line. Process notes are blanked unless asked for.
  const counts: Partial<Record<Kind, number>> = {};
  for (const [kind, list] of byKind) {
    const rows = list.map((r) =>
      kind === 'page' && !opts.includeProcessNotes ? { ...(r as Page), process_note: '' } : r,
    );
    counts[kind] = rows.filter((r) => !r.deleted).length;
    add(`data/${kind}.jsonl`, utf8(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')));
  }

  const folders = (byKind.get('folder') as Folder[]).filter((f) => !f.deleted);
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const pages = (byKind.get('page') as Page[]).filter((p) => !p.deleted);
  const stickies = (byKind.get('sticky') as Sticky[]).filter((s) => !s.deleted && s.state !== 'discarded');
  const attachments = (byKind.get('attachment') as Attachment[]).filter((a) => !a.deleted);
  const appointments = (byKind.get('appointment') as Entity<'appointment'>[]).filter((a) => !a.deleted);

  // 2. Readable notes: one Markdown file per page, cover sticky notes in the folder's README.
  const folderDirs = new Map<string, string>();
  const usedDirs = new Set<string>();
  for (const f of folders) {
    let dir = safeName(f.label);
    for (let i = 2; usedDirs.has(dir); i++) dir = `${safeName(f.label)} (${i})`;
    usedDirs.add(dir);
    folderDirs.set(f.id, dir);
    const cover = stickies.filter((s) => s.folder_id === f.id && !s.page_id);
    const coverLines = [`# ${f.label}`, '', ...(f.cover_note ? [f.cover_note, ''] : [])];
    if (f.tags.length) coverLines.push(f.tags.map((t) => `#${t}`).join(' '), '');
    if (cover.length) coverLines.push(`## ${opts.labels.stickyHeading}`, '', ...cover.map((s) => `- ${s.state === 'peeled' ? `~~${s.text}~~` : s.text}`), '');
    add(`notes/${dir}/README.md`, utf8(coverLines.join('\n')));
  }
  const usedNames = new Set<string>();
  for (const p of [...pages].sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))) {
    const dir = folderDirs.get(p.folder_id);
    if (!dir) continue;
    let name = `notes/${dir}/${p.date}.md`;
    for (let i = 2; usedNames.has(name); i++) name = `notes/${dir}/${p.date} (${i}).md`;
    usedNames.add(name);
    add(name, utf8(pageMarkdown(p, stickies.filter((s) => s.page_id === p.id), opts.labels, opts.includeProcessNotes)));
  }

  // 3. Attachments, as the original files.
  const attachmentPaths = new Map<string, string>();
  const withFiles = opts.keepDeletedFiles
    ? (byKind.get('attachment') as Tombstone<'attachment'>[]).filter((a) => !a.deleted || !a.scrubbed)
    : attachments;
  for (const a of withFiles) {
    const bytes = await opts.readAttachment(a);
    if (!bytes) continue;
    const path = `attachments/${a.id}/${safeName(a.filename)}`;
    if (!a.deleted) attachmentPaths.set(a.id, path);
    add(path, bytes, !ALREADY_COMPRESSED.test(a.mime));
  }

  // 4. Calendar and FHIR, for other programs.
  add('calendar.ics', utf8(toIcs(appointments, folderById, { titleStyle: 'name', neutralTitle: opts.labels.neutralAppointment, now })));
  const ndjson = (rows: unknown[]) => utf8(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  add('fhir/Patient.ndjson', ndjson(folders.map(fhir.patient)));
  const encounters = pages.filter((p) => folderById.has(p.folder_id));
  const encounterIds = new Set(encounters.map((p) => p.id));
  add('fhir/Encounter.ndjson', ndjson(encounters.map(fhir.encounter)));
  add('fhir/Composition.ndjson', ndjson(encounters.map((p) => fhir.composition(p, opts.labels.sectionTitle, opts.includeProcessNotes))));
  add('fhir/Appointment.ndjson', ndjson(appointments.flatMap((a) => {
    // One an older version saved with an impossible date stays in data/ only.
    const s = readableStart(a);
    return s ? [fhir.appointment(a, s.plus({ minutes: a.duration_min }).toISO()!, s.toISO()!)] : [];
  })));
  // A document points at its session only while that page is in the file (never at a deleted one).
  add('fhir/DocumentReference.ndjson', ndjson(attachments.filter((a) => attachmentPaths.has(a.id)).map((a) =>
    fhir.documentReference(a.page_id && !encounterIds.has(a.page_id) ? { ...a, page_id: null } : a, attachmentPaths.get(a.id)!),
  )));
  add('README.txt', utf8(opts.labels.readme));

  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    app_version: opts.appVersion,
    created_at: DateTime.fromJSDate(now).toUTC().toISO()!,
    practice_id: opts.practiceId,
    include_process_notes: opts.includeProcessNotes,
    counts,
    files: hashes,
  };
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  return zipSync(files, { mtime: now });
}

export class NotSalaFileError extends Error {
  constructor(reason: string) {
    super(`This is not a Sala file, or it is damaged (${reason}).`);
  }
}

export interface ReadResult {
  manifest: Manifest;
  records: ExportRecord[];
  /** Attachment bytes by attachment id. */
  attachments: Map<string, Uint8Array>;
}

/** Reads and verifies an unencrypted .sala ZIP. */
export function readSalaZip(zip: Uint8Array): ReadResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new NotSalaFileError('not a ZIP archive');
  }
  const rawManifest = files['manifest.json'];
  if (!rawManifest) throw new NotSalaFileError('no manifest');
  const manifest = JSON.parse(strFromU8(rawManifest)) as Manifest;
  if (manifest.format !== FORMAT) throw new NotSalaFileError('wrong format');
  if (manifest.version > FORMAT_VERSION) throw new NotSalaFileError('made by a newer version of Sala');
  for (const [path, hash] of Object.entries(manifest.files)) {
    const bytes = files[path];
    if (!bytes || toHex(sha256(bytes)) !== hash) throw new NotSalaFileError(`checksum mismatch in ${path}`);
  }
  const records: ExportRecord[] = [];
  for (const kind of KINDS) {
    const raw = files[`data/${kind}.jsonl`];
    if (!raw) continue;
    for (const line of fromUtf8(raw).split('\n')) {
      if (line.trim()) records.push({ kind, record: JSON.parse(line) as Entity<Kind> });
    }
  }
  const attachments = new Map<string, Uint8Array>();
  for (const [path, bytes] of Object.entries(files)) {
    const m = /^attachments\/([^/]+)\//.exec(path);
    if (m) attachments.set(m[1]!, bytes);
  }
  return { manifest, records, attachments };
}

// ── Encrypted container ────────────────────────────────────────────────────────────────

const MAGIC = utf8('SALAENC1');

type Header =
  | { format: 'sala-export-encrypted'; v: 1; mode: 'password'; kdf: KdfParams & { salt: string } }
  | { format: 'sala-export-encrypted'; v: 1; mode: 'practice-key'; salt: string; keyring: Keyring };

export type Protection = Header['mode'] | 'none';

const context = (headerBytes: Uint8Array) => `sala.export.v1:${toHex(sha256(headerBytes))}`;

function wrap(header: Header, key: Uint8Array, zip: Uint8Array): Uint8Array {
  const h = utf8(JSON.stringify(header));
  return concatBytes(MAGIC, u32be(h.length), h, seal(key, zip, context(h)));
}

export async function encryptWithPassword(zip: Uint8Array, password: string, kdf: Kdf, params: KdfParams = ARGON2_PARAMS): Promise<Uint8Array> {
  const salt = randomBytes(32);
  const key = await kdf(utf8(normalizePassphrase(password)), salt, params);
  return wrap({ format: 'sala-export-encrypted', v: 1, mode: 'password', kdf: { ...params, salt: toBase64(salt) } }, key, zip);
}

/** Backups: encrypted under the practice key, restorable with the passphrase or recovery phrase. */
export function encryptWithPracticeKey(zip: Uint8Array, practiceKey: Uint8Array, keyring: Keyring): Uint8Array {
  const salt = randomBytes(32);
  return wrap({ format: 'sala-export-encrypted', v: 1, mode: 'practice-key', salt: toBase64(salt), keyring }, subkey(practiceKey, 'sala.backup.v1', salt), zip);
}

export function protectionOf(bytes: Uint8Array): Protection {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'none';
  if (MAGIC.every((b, i) => bytes[i] === b)) return readHeader(bytes).header.mode;
  throw new NotSalaFileError('unknown file type');
}

function readHeader(bytes: Uint8Array): { header: Header; headerBytes: Uint8Array; body: Uint8Array } {
  const len = readU32be(bytes, 8);
  const headerBytes = bytes.subarray(12, 12 + len);
  const header = JSON.parse(fromUtf8(headerBytes)) as Header;
  if (header.format !== 'sala-export-encrypted' || header.v !== 1) throw new NotSalaFileError('unknown encryption header');
  return { header, headerBytes, body: bytes.subarray(12 + len) };
}

export type Unlock =
  | { kind: 'none' }
  | { kind: 'password'; password: string }
  | { kind: 'secret'; slot: SlotKind; secret: string }
  | { kind: 'practice-key'; practiceKey: Uint8Array };

/**
 * Returns the ZIP inside a .sala file. For backups it also returns the practice key and the
 * keyring they were made with, so a restore on a new device keeps the same passphrase.
 */
export async function decryptSala(bytes: Uint8Array, unlock: Unlock, kdf: Kdf): Promise<{ zip: Uint8Array; practiceKey?: Uint8Array; keyring?: Keyring }> {
  if (protectionOf(bytes) === 'none') return { zip: bytes };
  const { header, headerBytes, body } = readHeader(bytes);
  if (header.mode === 'password') {
    if (unlock.kind !== 'password') throw new Error('password required');
    const { salt, ...params } = header.kdf;
    const key = await kdf(utf8(normalizePassphrase(unlock.password)), fromBase64(salt), params);
    return { zip: open(key, body, context(headerBytes)) };
  }
  let practiceKey: Uint8Array;
  if (unlock.kind === 'practice-key') practiceKey = unlock.practiceKey;
  else if (unlock.kind === 'secret') practiceKey = await unlockKeyring(header.keyring, unlock.slot, unlock.secret, kdf);
  else throw new Error('passphrase or recovery phrase required');
  const zip = open(subkey(practiceKey, 'sala.backup.v1', fromBase64(header.salt)), body, context(headerBytes));
  return { zip, practiceKey, keyring: header.keyring };
}
