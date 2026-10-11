# The `.sala` file, version 1

A `.sala` file holds a whole practice, or one patient's folder. Sala writes it for exports and backups and reads it to restore or import. It is meant to stay readable without Sala.

A single-folder export holds that folder, its pages, its sticky notes (not discarded ones), its appointments with the appointment types they use and, when chosen, its documents. It never holds deleted records or anything about other folders, and the folder's link to The Human Loop (`loop_vault_id`) is left empty: it belongs to the practice that made the file.

## Plain file: a ZIP archive

| Path | Content |
|---|---|
| `manifest.json` | `format: "sala-export"`, `version: 1`, `app_version`, `created_at`, `practice_id`, `include_process_notes`, `counts` per record kind, and `files`: the SHA-256 (hex) of every other file in the archive. |
| `data/<kind>.jsonl` | Every record of that kind, one JSON object per line, including deleted ones (`"deleted": true`; in an export they are written without their content, see below). Kinds: `folder`, `page`, `sticky`, `appointment`, `appointment_type`, `availability`, `availability_exception`, `attachment`, `setting`. This is the lossless copy Sala imports. |
| `notes/<folder>/README.md` | The folder's cover: label, cover note, tags, sticky notes. |
| `notes/<folder>/<date>.md` | One Markdown file per session page: its sections under their titles, then its marked passages with their themes, then the page's sticky notes. |
| `attachments/<attachment id>/<file name>` | Documents and scans exactly as they were added. A backup also holds the files of documents deleted in the last 30 days, so they can still be restored; an export holds live documents only. |
| `calendar.ics` | All appointments (RFC 5545), titled with the folder label. |
| `fhir/*.ndjson` | The same practice as FHIR R4 resources: `Patient` (folders, with the photo if the folder has one), `Encounter` and `Composition` (pages), `Appointment`, `DocumentReference` (attachments; linked to the session's `Encounter` when the file belongs to a page in the export). |
| `README.txt` | A short description of the above. |

Private process notes (`page.process_note`) are empty in every file unless `include_process_notes` is true.

Every record has `id` (UUID v4), `created_at` (ISO 8601), `updated_at_hlc` and `deleted`. `updated_at_hlc` is a hybrid logical clock stamp — 15-digit milliseconds, a 5-character base-36 counter and a device id, joined by `-` — and orders versions of a record by plain string comparison. On import, the version with the greater stamp wins.

A deleted record (`"deleted": true`) may also carry:

| Field | Meaning |
|---|---|
| `deleted_batch` | A UUID shared by records deleted together, such as a folder with its pages, sticky notes, appointments and documents, so they can be restored together. Absent on records deleted before this field existed. |
| `scrubbed` | `true` when the deleted record's content is not in the file: Sala erased it for good (30 days after a delete), or the file is an export (see `content_omitted`). Its content fields hold empty values; only `id`, `created_at`, `updated_at_hlc`, `deleted` and `deleted_batch` still mean anything, and it cannot be restored from this file. |
| `content_omitted` | `true` in an export, never in a backup: the deleted record was written without its content (it also carries `scrubbed`), so a file handed to someone never holds what was deleted. The content may still exist where the file came from. On import, a copy of the record that is already here and older keeps its content, marked deleted, so it can still be restored from Recently deleted; with no copy here, the record is stored as written. |

An appointment may also carry:

| Field | Meaning |
|---|---|
| `series_start` | On a single date taken out of a repeating appointment (its `series_id` names the series): where that date sat in the series when it was taken out, as `yyyy-MM-ddTHH:mm` in the appointment's `tz`. The date counts as moved when it no longer starts there; one only marked done or cancelled is not moved. Absent on dates taken out before this field existed. |

All these fields are optional, and readers that do not know them can ignore them.

### Pages

A page's `template` is one of `free`, `dap`, `soap` or `intake`, and `sections` maps section keys to text:

| Template | Section keys, in order |
|---|---|
| `free` | `body` |
| `dap` | `data`, `assessment`, `plan` |
| `soap` | `subjective`, `objective`, `assessment`, `plan` |
| `intake` (a first session) | `reason`, `history`, `observations`, `formulation`, `plan` |

`sections` may also hold text under keys of another template: when the therapist changes a page's template, nothing written is dropped. Readers should show the template's sections first, then every other section that holds text. The Markdown notes and the FHIR `Composition` do so, each section under its title.

A page may also have `passages`: words of its note marked with themes by the therapist. Each has an `id`, a `section` (a key of `sections`), `start` and `end` (offsets into that section's text, in UTF-16 code units), `quote` (the marked words), `themes` (one to 12 names of up to 60 characters; names that differ only in capitals, accents or spaces are the same theme) and `created_at`. When the text from `start` to `end` is not `quote`, readers should look for `quote` in the section, nearest to `start`, and set the passage aside when it is not there. Passages are never in the private process note.

`passages` is newer than the first version of this format. Sala 0.2.1 and earlier keep a page's passages when they change the page, but do not move them with the text; a later Sala finds them again by their `quote`.

`intake` is newer than the first version of this format. Sala 0.1.1 and earlier do not know it: they cannot open an intake page, and once a file holding one is merged into their practice, they fail to back up or export that practice. Update every computer before moving `.sala` files between them.

Readers must verify every checksum in `manifest.files` and refuse a file whose `version` is greater than they understand.

## Encrypted file

```
"SALAENC1" (8 bytes) | header length (uint32, big-endian) | header (UTF-8 JSON) | sealed ZIP
```

Header, password mode:

```json
{ "format": "sala-export-encrypted", "v": 1, "mode": "password",
  "kdf": { "algo": "argon2id", "m": 65536, "t": 3, "p": 4, "key_len": 32, "salt": "<base64>" } }
```

The key is Argon2id(password as Unicode NFC, salt).

Header, practice-key mode (backups):

```json
{ "format": "sala-export-encrypted", "v": 1, "mode": "practice-key", "salt": "<base64>", "keyring": { … } }
```

The keyring is the same as `keyring.json` on the computer (two AES-256-GCM-wrapped copies of the practice key, under Argon2id of the passphrase and of the recovery phrase). The file key is HKDF-SHA-256(practice key, salt, info `"sala.backup.v1"`, 32 bytes).

Sealed data:

```
"SALAF1" | frame size (uint32, big-endian) | frame…
frame = nonce (24 bytes) | XChaCha20-Poly1305 ciphertext of up to <frame size> bytes (+16-byte tag)
```

Each frame's associated data is `context | frame index (uint32 BE) | last-frame flag (1 byte)`, with `context = "sala.export.v1:" + hex(SHA-256(header bytes))`. This binds every frame to its header and position and detects reordering and truncation.
