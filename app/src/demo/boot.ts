import { DateTime, Settings } from 'luxon';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { KdfParams } from '../core/crypto/kdf';
import { isUiLocale, type UiLocale } from '../core/i18n/locales';
import { META } from '../services/data';
import { Practice } from '../services/practice';
import { createMemoryPlatform } from '../platform/memory';
import type { Phase } from '../shell/AppState';
import type { FolderTab, Route } from '../shell/router';
import { seedDemoPractice } from './demoPractice';
import { demoHttp, joinDemoLoop } from '../loopBridge';

// The browser demo. URL parameters (all optional):
//   demo=practice|empty   a filled fictional practice (default) or a first run
//   lang=en|pt|es         interface and demo content language
//   theme=light|dark
//   clock=2026-09-28T09:00  fixed "now" (Europe/Lisbon) — used for stable screenshots
//   route=today|shelf|calendar|settings|settings:<section>|import|help|loopHome|folder:<n>[:<tab>]|loop:<Screen>|locked
//   loop=joined           signed in to the demo Human Loop, first two folders linked
//   updates=ask|on        the update check: ask on Today, or already on (default: turned off)
//   latest=0.4.0          the version the demo's "website" names as the latest
//   backup=failed|none    the last backup failed (USB drive unplugged), or no backup folder yet
//   deleted=1             a folder, a page and a sticky note in Settings → Your data → Recently deleted
// Everything lives in memory and disappears when the tab closes.

const DEMO_PARAMS: KdfParams = { algo: 'argon2id', m: 1024, t: 1, p: 1, key_len: 32 };

export async function bootDemo(): Promise<{ platform: ReturnType<typeof createMemoryPlatform>; initialPhase?: Phase; initialRoute?: Route }> {
  const q = new URLSearchParams(window.location.search);
  const lang: UiLocale = isUiLocale(q.get('lang')) ? (q.get('lang') as UiLocale) : 'en';
  const clock = q.get('clock');
  if (clock) {
    // Screenshot mode: deterministic "randomness" too, so ids, the recovery phrase and the
    // sticky-note tilt are identical on every run. Demo only — the real app never does this.
    let seed = 0x5a1a;
    globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
      if (arr) {
        const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        for (let i = 0; i < bytes.length; i++) {
          // Math.imul keeps the product exact (a plain * loses bits above 2^53 and falls
          // into a cycle of a few hundred ids).
          seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
          bytes[i] = seed >>> 24;
        }
      }
      return arr;
    }) as Crypto['getRandomValues'];
    const fixed = DateTime.fromISO(clock, { zone: 'Europe/Lisbon' }).toMillis();
    Settings.now = () => fixed;
    Settings.defaultZone = 'Europe/Lisbon';
    const RealDate = Date;
    // Freeze Date too, so every "today" in the app agrees.
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(fixed);
        else super(...(args as [number]));
      }
      static override now() {
        return fixed;
      }
    } as DateConstructor;
  }

  const platform = createMemoryPlatform({
    locateFile: () => wasmUrl,
    defaultFolder: '/home/demo/Backups',
    // Sala's website for the update check and, where Sala has it, a fictional Human Loop.
    http: demoHttp({ locale: lang, latestVersion: q.get('latest') ?? undefined }),
    openLink: (url) => void window.open(url, '_blank', 'noopener'),
  });
  // Hook for the end-to-end tests and the screenshot pipeline (demo only).
  (window as unknown as { __salaDemo: unknown }).__salaDemo = {
    addFile: (path: string, base64: string) => platform.fileStore.set(path, Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))),
    queueAnswer: platform.queueAnswer,
  };
  await platform.prefs.set({ locale: lang, theme: q.get('theme') === 'dark' ? 'dark' : q.get('theme') === 'light' ? 'light' : 'system' });
  // The update check: already answered "not now" unless the URL says otherwise (updates=ask|on).
  const updates = q.get('updates');
  if (updates !== 'ask') await platform.prefs.set({ 'updates.auto': updates === 'on' ? '1' : '0' });

  if (q.get('demo') === 'empty') return { platform };
  const r = q.get('route') ?? 'today';

  const practice = await Practice.create(platform, { passphrase: 'demo passphrase', recoveryPhrase: 'abandon ability able about above absent absorb abstract absurd abuse access accident' }, { params: DEMO_PARAMS });
  await seedDemoPractice(practice.store, lang, DateTime.now().setZone('Europe/Lisbon'));
  await practice.store.setMeta(META.backupFolder, '/home/demo/Backups');
  await practice.store.setMeta(META.backupLastOk, new Date(Date.now() - 2 * 3600_000).toISOString());
  if (q.get('backup') === 'none') await practice.store.deleteMeta(META.backupFolder);
  if (q.get('backup') === 'failed') {
    await practice.store.setMeta(META.backupFolder, '/media/demo/USB');
    await practice.store.setMeta(META.backupLastOk, new Date(Date.now() - 5 * 86400_000).toISOString());
    await practice.store.setMeta(META.backupLastError, `${new Date(Date.now() - 3600_000).toISOString()} FOLDER_MISSING`);
  }
  if (q.get('deleted') === '1') {
    const s = practice.store;
    const archived = (await s.list('folder')).find((f) => f.status === 'archived');
    if (archived) await s.remove('folder', [archived.id], { batch: 'demo-folder' });
    const [oldest] = await s.list('page', { order: 'date', limit: 1 });
    if (oldest) await s.remove('page', [oldest.id], { batch: 'demo-page' });
    const [note] = await s.list('sticky', { where: "state = 'stuck'", limit: 1 });
    if (note) await s.remove('sticky', [note.id], { batch: 'demo-sticky' });
  }
  if (q.get('loop') === 'joined') {
    // Pre-joined demo (screenshots): signed in, with the first two folders linked.
    await joinDemoLoop(practice);
  }

  if (r === 'locked') return { platform, initialPhase: { name: 'locked' } };
  let initialRoute: Route = { name: 'today' };
  if (r.startsWith('folder:')) {
    const [, n, tab] = r.split(':');
    initialRoute = { name: 'folder', id: `00000000-0000-4000-8000-${String(Number(n) || 1).padStart(12, '0')}`, tab: (tab as FolderTab | undefined) ?? 'pages' };
  } else if (r.startsWith('loop:')) {
    initialRoute = { name: 'loop', screen: r.slice(5) as 'Patients' };
  } else if (r.startsWith('settings:')) {
    initialRoute = { name: 'settings', section: r.slice(9) };
  } else if (['today', 'shelf', 'calendar', 'settings', 'import', 'help', 'loopHome'].includes(r)) {
    initialRoute = { name: r } as Route;
  }
  return { platform, initialPhase: { name: 'open', practice, fresh: false }, initialRoute };
}
