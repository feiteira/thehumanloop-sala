# Threat model (desktop, offline)

What Sala protects, against whom, and where the limits are. Reviewed whenever a feature changes how data is stored or leaves the device.

## Assets

- The practice: folders, session pages, private process notes, sticky notes, appointments, documents.
- The keys that protect it: the passphrase, the 12-word recovery phrase, and the practice key they unlock.

## How data is protected

| Where | Protection |
|---|---|
| Practice database | SQLCipher (AES-256), keyed with a random 256-bit practice key. |
| Documents and scans | XChaCha20-Poly1305 in 1 MiB authenticated frames, with a key derived (HKDF-SHA-256) from the practice key. |
| `keyring.json` | The practice key wrapped with AES-256-GCM, once under Argon2id(passphrase) and once under Argon2id(recovery phrase); m = 64 MiB, t = 3, p = 4, a fresh 32-byte salt per slot. Contains no usable secret on its own. |
| Backups | The whole `.sala` export, encrypted with a per-backup key derived from the practice key; the keyring travels with it so the passphrase or recovery phrase opens it on another computer. |
| Password-protected exports | Argon2id(password) with the same parameters, then the same authenticated framing. |
| While open | The practice key stays in memory while Sala is unlocked. Sala locks itself after a period without use (5–60 minutes, default 10) and on request; locking closes the database and overwrites the keys it holds. |

## Threats considered

| Threat | Mitigation | Limits |
|---|---|---|
| Lost or stolen computer, powered off or locked | Everything on disk is encrypted; nothing readable without the passphrase or recovery phrase. | A weak passphrase can be guessed offline; Argon2id makes each guess slow and the app asks for at least 10 characters. |
| Someone uses the computer while Sala is open | Auto-lock; manual lock (Ctrl+L). | Before auto-lock triggers, whoever is at the keyboard sees what the therapist sees. |
| Backup drive or cloud folder is accessed by someone else | Backups are encrypted and authenticated; tampering is detected. | File names reveal that a Sala backup exists, when it was made, and which backups come from the same practice (a six-hex-digit tag, HKDF of the practice key with its own label, that reveals nothing about the key). |
| An exported file is shared by mistake | Exports can be password-protected; private process notes are excluded unless chosen. | An export without a password is readable by anyone who has it — the app says so. |
| Network attacker, tracking | Sala makes no network connections unless the therapist turns one on: the update check (one request for a small version file on Sala's website). The desktop shell allows only that address, over HTTPS, and a strict content security policy forbids remote content. There is no telemetry. | None beyond the update check: Sala's website sees one request for the version file, as any web server would. |
| Malicious file imported | Imported files are parsed as data only; nothing is executed. Unsupported formats are refused. | Parsers (PDF, DOCX, images) are third-party libraries and may have bugs; keep Sala updated. |
| Compromised dependency or build | Lockfiles, secret scanning, dependency review on pull requests, installers built by CI from tagged commits. | Installers are not yet code-signed. |

## Out of scope

- Malware running with the therapist's user rights on an unlocked computer (it can read the screen and memory).
- Forgotten passphrase **and** lost recovery phrase: by design nobody, including us, can open the practice.
