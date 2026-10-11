import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { detectUiLocale, isUiLocale, type UiLocale } from '../core/i18n/locales';
import type { Platform } from '../platform/types';
import { createExamplePractice } from '../services/example';
import { JobStopped } from '../services/jobs';
import { type Practice, practiceState } from '../services/practice';
import { attachLoop, detachLoop } from '../loopBridge';
import type { ThemeMode } from '../ui/theme';
import { ResumePoint } from './resume';
import { addStopped, type StoppedJob } from './stopped';
import type { Route } from './router';
import { oneAtATime, type Saver, type SaverOptions, Savers } from './savers';

export { SAVE_STAGE, type Saver, type SaverOptions } from './savers';
export type { StoppedJob } from './stopped';

// Top-level state: which platform we run on, device preferences, and whether a practice
// is open. Everything under a practice lives in its encrypted store.

/**
 * Why the unlock screen shows: `idle` (Sala locked itself), `eraseFailed`, or `noKeyring` (a
 * database without its keyring, which only removing can clear).
 */
export type LockedReason = 'idle' | 'eraseFailed' | 'noKeyring';

export type Phase =
  | { name: 'loading' }
  | { name: 'welcome' }
  /** `eraseFailed`: Remove from this computer locked the practice, then could not remove it. */
  | { name: 'locked'; reason?: LockedReason }
  /** `resume`: where Sala was when it locked itself (same day only), to open there again. */
  | { name: 'open'; practice: Practice; fresh: boolean; resume?: Route };

export interface Prefs {
  locale: UiLocale;
  theme: ThemeMode;
  autoLockMinutes: number;
}

interface AppStateValue {
  platform: Platform;
  /** The example practice: fictional, reset at every start. */
  example: boolean;
  phase: Phase;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  opened: (practice: Practice, fresh?: boolean) => void;
  /** Runs every saver, then closes the practice. Calls made while locking share one run. */
  lock: (reason?: 'idle') => Promise<void>;
  /** True while `lock` waits for savers; the shell shows an opaque "Locking…" screen. */
  locking: boolean;
  erased: () => void;
  /**
   * Remove from this computer, from inside the practice: locks it (savers first), then removes
   * it. When removing fails, the practice stays, locked, and the unlock screen says so.
   */
  erasePractice: () => Promise<void>;
  /** Adds a saver; returns the function that removes it. Prefer `useRegisterSaver`. */
  registerSaver: (fn: Saver, opts?: SaverOptions) => () => void;
  /** Runs every saver, stage by stage. Errors are logged, never thrown. */
  runSavers: () => Promise<void>;
  /** Keeps the idle auto-lock away until the returned release is called. Prefer `useHold`. */
  hold: () => () => void;
  /** Whether anything holds the idle auto-lock off right now. */
  isHeld: () => boolean;
  /**
   * Tells the app state where the open practice is (and its time zone, for "the same day"), so
   * an idle lock can return there. Memory only.
   */
  noteRoute: (practiceId: string, route: Route, tz: string) => void;
  /** Work a lock stopped before it was done, for the unlock screen to tell. Memory only. */
  stopped: StoppedJob[];
  /** A job that a lock stopped records it here; opening the practice clears the list. */
  noteStopped: (job: StoppedJob) => void;
}

const Ctx = createContext<AppStateValue | null>(null);

export const DEFAULT_PREFS: Prefs = { locale: 'en', theme: 'system', autoLockMinutes: 10 };

function readPrefs(raw: Record<string, string>): Prefs {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return {
    locale: isUiLocale(raw.locale) ? raw.locale : detectUiLocale(nav),
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    autoLockMinutes: Number(raw.autoLockMinutes) > 0 ? Number(raw.autoLockMinutes) : DEFAULT_PREFS.autoLockMinutes,
  };
}

export function AppStateProvider({ platform, children, initialPhase }: { platform: Platform; children: ReactNode; initialPhase?: Phase }) {
  const [phase, setPhase] = useState<Phase>(initialPhase ?? { name: 'loading' });
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [example, setExample] = useState(false);

  useEffect(() => {
    void (async () => {
      const p = readPrefs(await platform.prefs.get());
      setPrefsState(p);
      if (initialPhase) {
        if (initialPhase.name === 'open') await attachLoop(initialPhase.practice);
        return;
      }
      let state = await practiceState(platform);
      if ((await platform.info()).example) {
        setExample(true);
        // The example is fictional and made afresh at every start: leftovers are just replaced.
        if (state === 'noKeyring') await platform.practice.erase();
        if (state !== 'ready') {
          await createExamplePractice(platform, p.locale);
          state = 'ready';
        }
      }
      setPhase(state === 'none' ? { name: 'welcome' } : state === 'noKeyring' ? { name: 'locked', reason: 'noKeyring' } : { name: 'locked' });
    })();
  }, [platform, initialPhase]);

  const setPrefs = useCallback(
    (p: Partial<Prefs>) => {
      setPrefsState((cur) => {
        const next = { ...cur, ...p };
        void platform.prefs.set({ locale: next.locale, theme: next.theme, autoLockMinutes: String(next.autoLockMinutes) });
        return next;
      });
    },
    [platform],
  );

  // Where the practice is, and where it was when it locked itself: memory only, never disk.
  const [resumePoint] = useState(() => new ResumePoint());
  const lastRoute = useRef<{ practiceId: string; route: Route; tz: string } | null>(null);
  const noteRoute = useCallback((practiceId: string, route: Route, tz: string) => {
    lastRoute.current = { practiceId, route, tz };
  }, []);

  const [stopped, setStopped] = useState<StoppedJob[]>([]);
  const noteStopped = useCallback((job: StoppedJob) => setStopped((cur) => addStopped(cur, job)), []);

  const opened = useCallback(
    (practice: Practice, fresh = false) => {
      setStopped([]);
      void attachLoop(practice).catch((e) => console.error('loop attach failed', e));
      const resume = fresh ? null : resumePoint.take(practice.store.practiceId);
      setPhase(resume ? { name: 'open', practice, fresh, resume } : { name: 'open', practice, fresh });
    },
    [resumePoint],
  );

  const [savers] = useState(() => new Savers());
  const registerSaver = useCallback((fn: Saver, opts?: SaverOptions) => savers.register(fn, opts), [savers]);
  const runSavers = useCallback(() => savers.run(), [savers]);

  const holds = useRef(0);
  const hold = useCallback(() => {
    holds.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds.current--;
    };
  }, []);
  const isHeld = useCallback(() => holds.current > 0, []);

  // Locking keeps the shell mounted behind an opaque screen until every saver has finished,
  // so nothing writes to a closed database; only then are the store and keys let go.
  const [locking, setLocking] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const lock = useMemo(
    () =>
      oneAtATime(async (reason?: 'idle') => {
        const current = phaseRef.current;
        // After an idle lock, unlocking returns to the same place; a chosen lock starts afresh.
        const here = lastRoute.current;
        if (reason === 'idle' && current.name === 'open' && here?.practiceId === current.practice.store.practiceId) {
          resumePoint.remember(here.practiceId, here.route, here.tz);
        } else {
          resumePoint.forget();
        }
        lastRoute.current = null;
        try {
          if (current.name === 'open') {
            setLocking(true);
            await runSavers();
          }
        } finally {
          detachLoop();
          if (current.name === 'open') await current.practice.lock().catch((e) => console.error('lock failed', e));
          setLocking(false);
          setPhase({ name: 'locked', reason });
        }
      }),
    [runSavers, resumePoint],
  );

  const erased = useCallback(() => {
    resumePoint.forget();
    setStopped([]);
    setPhase({ name: 'welcome' });
  }, [resumePoint]);

  const erasePractice = useCallback(async () => {
    await lock();
    try {
      await platform.practice.erase();
      erased();
    } catch (e) {
      console.error('removing the practice failed', e);
      setPhase({ name: 'locked', reason: 'eraseFailed' });
    }
  }, [lock, platform, erased]);

  const value = useMemo(
    () => ({ platform, example, phase, prefs, setPrefs, opened, lock, locking, erased, erasePractice, registerSaver, runSavers, hold, isHeld, noteRoute, stopped, noteStopped }),
    [platform, example, phase, prefs, setPrefs, opened, lock, locking, erased, erasePractice, registerSaver, runSavers, hold, isHeld, noteRoute, stopped, noteStopped],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState outside AppStateProvider');
  return v;
}

export function usePractice(): Practice {
  const { phase } = useAppState();
  if (phase.name !== 'open') throw new Error('no open practice');
  return phase.practice;
}

/**
 * Registers `fn` as a saver for as long as the calling component is mounted. The latest `fn`
 * is the one called, so it may close over fresh state.
 */
export function useRegisterSaver(fn: Saver, opts: SaverOptions = {}): void {
  const { registerSaver } = useAppState();
  const latest = useRef(fn);
  latest.current = fn;
  const { stage, limitMs } = opts;
  useEffect(() => registerSaver(() => latest.current(), { stage, limitMs }), [registerSaver, stage, limitMs]);
}

/** Holds the idle auto-lock off while `active` is true (a long import, a scan being read). */
export function useHold(active: boolean): void {
  const { hold } = useAppState();
  useEffect(() => (active ? hold() : undefined), [hold, active]);
}

/**
 * A long job (an import, an export, documents being added) that keeps the idle auto-lock away
 * while it runs and that locking stops. `run` hands the job a `shouldStop` that says yes once
 * Sala starts locking; the job asks it before each step that reads or writes and throws
 * `JobStopped` (services/jobs.ts). Locking waits for running jobs, up to `limitMs`, before the
 * keys are wiped. A step that must not stop half-way (a merge's records) does not ask: locking
 * then waits for it. A job that a lock stopped tells the unlock screen (`noteStopped`).
 */
export function useLockAwareJob(opts: { limitMs?: number } = {}): {
  run: <T>(job: (shouldStop: () => boolean) => Promise<T>) => Promise<T>;
  shouldStop: () => boolean;
} {
  const practice = usePractice();
  // Once set, it stays set: locking unmounts the screen, and unlocking mounts a new one.
  const stop = useRef(false);
  const running = useRef(new Set<Promise<unknown>>());
  const [count, setCount] = useState(0);
  useHold(count > 0);
  useRegisterSaver(
    async () => {
      stop.current = true;
      await Promise.all([...running.current].map((p) => p.catch(() => undefined)));
    },
    { limitMs: opts.limitMs },
  );
  const shouldStop = useCallback(() => stop.current || !practice.isOpen, [practice]);
  const run = useCallback(
    <T,>(job: (shouldStop: () => boolean) => Promise<T>): Promise<T> => {
      if (shouldStop()) return Promise.reject(new JobStopped());
      const p = (async () => job(shouldStop))();
      running.current.add(p);
      setCount((n) => n + 1);
      const settled = () => {
        running.current.delete(p);
        setCount((n) => n - 1);
      };
      void p.then(settled, settled);
      return p;
    },
    [shouldStop],
  );
  return { run, shouldStop };
}
