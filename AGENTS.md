# AGENTS.md

Guidance for coding agents (and people) working in this repository. `CLAUDE.md` imports this file.

## What Sala is

Sala is an offline-first practice app for therapists: patient folders, session pages, sticky notes, a calendar, backups, and import from existing files. It keeps everything on the therapist's computer, encrypted, and works with no account and no internet. This repository contains only the app. Desktop builds (Windows, Linux) ship today; the UI is written so phone builds can share it later.


## Commands

```bash
npm install                      # from the repo root (npm workspaces: app, desktop)
npm run dev                      # desktop app with hot reload (Tauri + Vite)
npm run dev:web                  # browser demo at http://localhost:1420 — fictional practice, in memory
npm run typecheck                # tsc --noEmit — also fails on any missing translation
npm test                         # Vitest (app/src/**/*.test.ts)
npx vitest run src/core/calendar --root app     # one directory or file
npx vitest run -t "keeps weekly sessions" --root app   # one test by name
npm run test:rust                # cargo test (SQLCipher, Argon2 vectors, file helpers)
npm run lint:rust                # cargo fmt --check + clippy -D warnings
npm run build:desktop            # installers for the current OS (AppImage/deb/rpm or NSIS/MSI) — build locally;
                                 # the GitHub workflow is manual-only (Actions tab) to save hosted minutes
                                 # (gh workflow run ci.yml --ref <branch> -f run=Windows builds only Windows;
                                 # -f run=macOS builds the universal Mac app, signed ad hoc)
tools/macos-release/sign-and-notarise.sh <CI Mac artifact> <out-dir>   # Developer ID signature + Apple
                                 # notarisation on Linux (rcodesign) → Sala_<version>_universal.zip
npm run gen:privacy              # regenerate PRIVACY.md from app/src/core/privacy/flows.ts
npm run screenshots              # manual screenshots, all three languages (Playwright + the demo)
npm run screenshots --workspace @sala/app -- --only=today --lang=pt   # a subset
xvfb-run -a node tools/desktop-e2e/run.mjs   # the real desktop app via WebDriver (after a release build;
                                             # needs webkit2gtk-driver and `cargo install tauri-driver`)
node app/e2e/fixtures/make-fixtures.mjs      # regenerate the fictional import fixtures (needs ImageMagick)
```

Linux builds need WebKitGTK 4.1 and friends: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev patchelf`.

## Architecture

```
app/src/core/       platform-free TypeScript: model, hlc, store, crypto, calendar, export, import, i18n, privacy
app/src/platform/   the device boundary (types.ts) + adapters: tauri.ts (desktop), memory.ts + sqljs.ts (tests, demo)
app/src/services/   an unlocked Practice (keys, attachments), backups/exports, shared queries, settings
app/src/ui/         design system built from react-native primitives; theme tokens; i18n provider; icons
app/src/features/   screens: onboarding, today, shelf, folder, calendar, settings, import, help
app/src/shell/      app state (locked/open), router, sidebar, auto-lock, backup scheduler
app/src/demo/       browser demo: fictional practice and a stand-in for Sala's website (websiteMock.ts)
desktop/src-tauri/  Rust shell: SQLCipher database, Argon2id, file I/O, dialogs. No network.
test-vectors/       crypto vectors checked by both Vitest and cargo test
docs/               manual (en/pt/es), public specs, security notes
```

Key rules that span files:

- **One UI, many shells.** UI code imports from `react-native`; on desktop and in the browser Vite aliases it to `react-native-web`. Platform-specific files use suffixes (`Icon.web.tsx`, `activity.web.ts`); a `.native` twin will come with the phone apps. Do not use DOM APIs outside `.web.*` files and `platform/`.
- **Styles in the desktop app depend on `dangerousDisableAssetCspModification: ["style-src"]`** in `tauri.conf.json`. react-native-web applies most styles as inline `style` attributes; if Tauri adds a nonce to `style-src`, the browser ignores `'unsafe-inline'` and the whole layout collapses in the real app while the browser demo still looks fine. The desktop e2e test checks the layout for this reason — screenshots of the demo alone do not prove the real app renders.
- **Brand type and the BETA ribbon.** UI text is Alegreya Sans and display text Alegreya, self-hosted from `app/src/ui/fonts.css` (never a font CDN). A small plugin in `app/vite.config.ts` puts Alegreya Sans first in react-native-web's default font stack, so screens need no `fontFamily`; set one only for monospace or `font.serif`. `shell/BetaRibbon.tsx` is mounted once at the root, bottom-left, the corner kept free of controls on every screen.
- **All device access goes through `platform/types.ts`.** The only network access is `platform.http`, used by the opt-in update check (`services/updates.ts`: one GET of `https://sala.thehumanloop.eu/downloads/manifest.json`, off until the therapist turns it on or presses Check now). The desktop shell's capability limits it to that one URL, and the desktop e2e test checks other hosts are refused. `platform.openLink` opens pages of `sala.thehumanloop.eu` in the browser (the opener capability is scoped to it). Do not add any other `fetch`, WebSocket or HTTP client.
- **All SQL lives in `core/store`.** Rust runs statements it is given (`db_exec`, `db_query`, `db_batch`, `db_script`); it knows no schema. Each record kind is one table: base columns, the record as JSON in `data`, plus indexed columns copied out of it (`core/store/schema.ts`). Schema changes are new entries appended to `MIGRATIONS` — never edit a shipped one.
- **Every write goes through `Store`**, which validates (`core/model/validate.ts`), stamps a hybrid logical clock and notifies subscribers; screens read through `useLive` so they refresh on change. Deletes are tombstones (`deleted = 1`), never row deletions.
- **Keys.** A random 256-bit practice key encrypts the database (SQLCipher) and, through HKDF subkeys, attachments and backups. `keyring.json` holds that key wrapped twice (passphrase slot, 12-word BIP-39 recovery-phrase slot) with Argon2id m=64 MiB, t=3, p=4. Changing either secret rewraps one slot; the practice key never changes. Backups embed the keyring, so a restore on a new computer keeps the same passphrase.
- **The `.sala` format** (`core/export/sala.ts`, spec in `docs/spec/export-v1.md`): a ZIP with lossless JSONL (`data/`), Markdown notes, FHIR R4 NDJSON, `calendar.ics`, attachments and a checksummed manifest, optionally wrapped in an encrypted container (password, or practice key for backups).
- **Calendar times** are stored as wall-clock `start_local` plus an IANA `tz`; repeats keep the wall-clock time across daylight-saving changes. Always build `DateTime`s in the practice time zone (`usePracticeTz`), never cache one built before it loads.
- **The example practice** (`sala-desktop --example`, the "Sala (example)" launcher from `desktop/src-tauri/linux/` and `windows/`): a separate data folder that the shell empties at every start and exit; the app seeds it from `demo/demoPractice.ts` with passphrase `sala` (`services/example.ts`). It must never read or write the therapist's own practice.
- **Private process notes** are excluded from exports unless the therapist opts in; keep it that way in any new export path.
- **Import** (`core/import`, `features/import`): sources are read into an `ImportPlan` (plain data), reviewed, then written by `services/importer.ts`, which saves progress after every item so an interrupted job resumes without duplicates. Word/PDF/OCR engines are in `features/import/engines.web.ts`; OCR is tesseract.js with language data bundled in `app/public/ocr/lang` and the engine copied there by `scripts/copy-ocr.mjs` — never load anything from a CDN.
- **"What leaves this device"**: `core/privacy/flows.ts` is the single source for the in-app screen and `PRIVACY.md`. Any feature that writes data outside the practice must add an entry and regenerate.

## Languages

Everything user-facing ships in **English, European Portuguese (pt-PT) and European Spanish (es-ES)**: the UI, the manual, privacy text, release notes.

- UI strings live in `app/src/core/i18n/locales/en.ts` (source of truth); `pt.ts` and `es.ts` are typed as `Messages`, so a missing key fails `npm run typecheck`. Add a key to all three in the same change.
- Portuguese is European: ecrã, ficheiro, palavra-passe, frase-passe, pasta, marcação. Spanish is from Spain: ordenador, contraseña, cita, consulta.
- Glossary (keep consistent everywhere): Folder / Pasta / Carpeta · Shelf / Estante / Estantería · Page / Página / Página · Sticky note / Nota adesiva / Nota adhesiva · Divider / Separador / Separador · Theme / Tema / Tema (words marked on passages of notes; folder *tags* are Etiquetas). Never write "Post-it" (a trademark).
- Plurals use `{ one, other }` objects and `tp(key, n)`.

## Manual

`docs/manual/{en,pt,es}/` — task-first, plain language, no technical jargon, written for therapists. Screenshots in `docs/manual/img/{lang}/` are generated by `npm run screenshots` from the fictional demo practice (`app/src/demo/demoPractice.ts`) with a fixed clock; never edit screenshots by hand and never use real patient data. A feature is not done until its manual section exists in all three languages. The in-app Help screen shows the same Markdown.

## What belongs in this repository

This repository is public. It holds the app and material about the app — code, the user manual, public file-format specs, security and privacy notes. Never commit patient data (even "anonymised"), credentials, signing keys, server or infrastructure details, internal planning documents or roadmaps. Test fixtures and screenshots use invented people only.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`; no `any` in core code.
- Match the surrounding style: small components, `useI18n()` for every visible string, colours only from `useTheme()`, spacing from `space`.
- Accessibility: every control has an accessible name (`accessibilityLabel` or visible label), focus rings stay visible, and state is never shown by colour alone.
- Commit only when asked. Commits are signed off (`git commit -s`, DCO — see CONTRIBUTING.md).
