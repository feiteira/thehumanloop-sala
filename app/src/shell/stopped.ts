// Work that a lock stopped before it was done: an export, documents being added, a .sala file
// being imported. The unlock screen says so, once; nothing of it reaches the disk.
// Also a new passphrase or recovery phrase that was being saved as Sala locked: that is never
// stopped half-way, and the unlock screen says it was saved, since Settings never got to, or,
// for a passphrase whose current one was typed wrong, that it was not.

export type StoppedJob =
  | { kind: 'export' }
  | { kind: 'documents'; count: number }
  | { kind: 'merge' }
  | { kind: 'passphraseSaved' }
  | { kind: 'passphraseNotSaved' }
  | { kind: 'phraseSaved' };

/** `list` with `job` added: one line per kind, documents counted together. */
export function addStopped(list: readonly StoppedJob[], job: StoppedJob): StoppedJob[] {
  if (job.kind === 'documents' && job.count <= 0) return [...list];
  const same = list.find((s) => s.kind === job.kind);
  if (!same) return [...list, job];
  if (same.kind !== 'documents' || job.kind !== 'documents') return [...list];
  return list.map((s) => (s === same ? { kind: 'documents', count: same.count + job.count } : s));
}
