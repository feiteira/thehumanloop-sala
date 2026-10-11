import type { Platform } from '../platform/types';

// "Is there a newer Sala?" One GET of the public file on Sala's website that names the latest
// version, only when the therapist turns the daily check on or presses Check now. Nothing
// from the practice is sent. The download itself is done by the therapist, in the browser.

export const DOWNLOAD_PAGE = 'https://sala.thehumanloop.eu/#download';
export const MANIFEST_URL = 'https://sala.thehumanloop.eu/downloads/manifest.json';

/** Device preferences (not practice data), so they apply before unlock and to every practice. */
export const UPDATE_PREFS = {
  /** '1' = check once a day, '0' = never; unset until the therapist has answered. */
  auto: 'updates.auto',
  lastCheck: 'updates.last_check',
  latest: 'updates.latest',
  published: 'updates.published',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  current: string;
  latest: string;
  /** When that version was published (ISO), if the website says. */
  published: string | null;
  newer: boolean;
}

/** Compares dotted versions numerically ("0.10.0" > "0.9.2"); a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.trim().replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre.localeCompare(y.pre, 'en', { numeric: true });
}

// The last result, for the menu and Settings: a newer version stays announced until installed.
let known: UpdateInfo | null = null;
const listeners = new Set<() => void>();

export function knownUpdate(): UpdateInfo | null {
  return known;
}

export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Asks Sala's website for the latest version. Throws when it cannot be reached or read. */
export async function checkForUpdate(platform: Platform, now = new Date()): Promise<UpdateInfo> {
  if (!platform.http) throw new Error('No network access on this platform.');
  const res = await platform.http.fetch(MANIFEST_URL, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const manifest = (await res.json()) as { version?: unknown; published?: unknown };
  if (typeof manifest.version !== 'string' || !/^v?\d+(\.\d+)*(-[\w.]+)?$/.test(manifest.version)) throw new Error('No version in the manifest.');
  const published = typeof manifest.published === 'string' ? manifest.published : '';
  await platform.prefs.set({ [UPDATE_PREFS.lastCheck]: now.toISOString(), [UPDATE_PREFS.latest]: manifest.version, [UPDATE_PREFS.published]: published });
  return announce(platform, manifest.version, published);
}

async function announce(platform: Platform, latest: string, published: string): Promise<UpdateInfo> {
  const current = (await platform.info()).version;
  known = { current, latest, published: published || null, newer: compareVersions(latest, current) > 0 };
  listeners.forEach((l) => l());
  return known;
}

/** The daily check: runs only when turned on, at most once a day. Never throws. */
export async function dailyCheck(platform: Platform, now = new Date()): Promise<UpdateInfo | null> {
  const prefs = await platform.prefs.get();
  if (prefs[UPDATE_PREFS.auto] !== '1') return null;
  const last = Date.parse(prefs[UPDATE_PREFS.lastCheck] ?? '');
  const latest = prefs[UPDATE_PREFS.latest];
  // Checked less than a day ago: use what the website said then.
  if (Number.isFinite(last) && now.getTime() - last < DAY_MS && latest) return announce(platform, latest, prefs[UPDATE_PREFS.published] ?? '');
  try {
    return await checkForUpdate(platform, now);
  } catch {
    return null; // offline: try again next time Sala opens
  }
}

export async function setDailyCheck(platform: Platform, on: boolean): Promise<void> {
  await platform.prefs.set({ [UPDATE_PREFS.auto]: on ? '1' : '0' });
}
