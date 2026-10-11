# Security

Sala keeps therapists' clinical notes. We take reports seriously and are grateful for them.

## Reporting a vulnerability

Please report privately — **do not open a public issue**. Use GitHub's private reporting: the **Report a vulnerability** button under this repository's **Security** tab. Include what you found, how to reproduce it, and the version and operating system.

We aim to acknowledge reports within 5 working days and to agree a disclosure date with you once a fix is ready.

**Never include real patient data** in a report, a screenshot or an attached file.

## Supported versions

Only the latest release receives security fixes.

## What Sala protects against

See [`docs/security/threat-model.md`](docs/security/threat-model.md). In short: the practice on disk is encrypted with a key that only the therapist's passphrase or recovery phrase can unlock; backups are encrypted the same way; Sala makes no network connections.
