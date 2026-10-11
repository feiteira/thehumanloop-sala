# Contributing to Sala

Thank you for helping. Sala is used by therapists for clinical notes, so correctness, privacy and plain language matter more than speed.

## Before you start

- For anything beyond a small fix, open an issue first so we can agree on the approach.
- **Never paste real patient data** into issues, pull requests, tests, fixtures or screenshots — not even with names changed. Use invented people, like the demo practice does.

## Development

See [AGENTS.md](AGENTS.md) for the commands and the architecture. The checks every pull request must pass:

```bash
npm run typecheck
npm test
npm run lint:rust
npm run test:rust
```

## Languages

Sala ships in English, European Portuguese and European Spanish. A change that adds or changes visible text must update all three catalogs in `app/src/core/i18n/locales/` (the typecheck fails otherwise) and, if it changes how something is done, the manual in `docs/manual/{en,pt,es}/`. If you do not write one of the languages, say so in the pull request and we will help.

## Privacy

Sala makes no network connections. Pull requests that add network access, analytics or telemetry will not be accepted. Anything that writes practice data outside the encrypted store (a new export, a new file type) must be added to `app/src/core/privacy/flows.ts` and `PRIVACY.md` regenerated with `npm run gen:privacy`.

## Sign-off (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/). Sign off every commit to certify you wrote it or have the right to submit it under the project's licence:

```bash
git commit -s -m "Explain what changed and why"
```

## Licence

By contributing you agree that your contributions are licensed under the Mozilla Public License 2.0.
