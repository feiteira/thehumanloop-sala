import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { DateTime } from 'luxon';
import { BackupError, backupIsStale, backupStatus, type BackupStatus, META, runBackup } from '../services/data';
import { exportLabels } from '../services/labels';
import { tidyImportJobs } from '../services/importer';
import { purgeExpired } from '../services/trash';
import { useI18n } from '../ui/i18n';
import { Icon } from '../ui/Icon';
import { focusRing, T, web } from '../ui/primitives';
import { radius, space, useTheme } from '../ui/theme';
import { SAVE_STAGE, useAppState, usePractice, useRegisterSaver } from './AppState';
import { useRouter } from './router';

// Keeping the practice safe while it is open: backups (on open, hourly when a day has passed,
// and on lock and close when something changed), the screens' view of them (`useBackup`), the
// line at the foot of the menu, and erasing what was deleted more than 30 days ago.

export interface BackupValue {
  /** null until the first look at the backup settings. */
  status: BackupStatus | null;
  running: boolean;
  /** The example practice is never backed up. */
  disabled: boolean;
  /** Backs up now, changed or not. True when a backup was written. */
  runNow: () => Promise<boolean>;
  /** Lets the therapist pick a backup folder, then backs up into it. True when one was written. */
  chooseFolder: () => Promise<boolean>;
  refresh: () => Promise<void>;
}

/** Long enough for a large practice with many scans; the "Locking…" screen stays up meanwhile. */
const LOCK_BACKUP_LIMIT_MS = 120_000;
const HOUR_MS = 60 * 60 * 1000;

const BackupCtx = createContext<BackupValue | null>(null);
export const useBackup = (): BackupValue => {
  const v = useContext(BackupCtx);
  if (!v) throw new Error('useBackup outside Shell');
  return v;
};

export function BackupProvider({ children }: { children: ReactNode }) {
  const practice = usePractice();
  const { platform, example, lock } = useAppState();
  const i18n = useI18n();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [running, setRunning] = useState(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const labelsRef = useRef(exportLabels(i18n));
  labelsRef.current = exportLabels(i18n);
  const disabled = example;

  const refresh = useCallback(async () => setStatus(await backupStatus(practice)), [practice]);

  /** One backup at a time; a call made while one runs waits for it and returns its result. */
  const run = useCallback(
    (force: boolean): Promise<boolean> => {
      if (disabled) return Promise.resolve(false);
      if (inflight.current) return inflight.current;
      setRunning(true);
      const p = (async () => {
        try {
          return (await runBackup(practice, labelsRef.current, { force })).written;
        } catch (e) {
          // Reasons the therapist is told about (an unplugged drive…) are not program errors.
          if (e instanceof BackupError && e.code !== 'ERROR') console.warn('backup not made:', e.code);
          else console.error('backup failed', e);
          return false;
        } finally {
          inflight.current = null;
          setRunning(false);
          if (practice.isOpen) await refresh().catch(() => undefined);
        }
      })();
      inflight.current = p;
      return p;
    },
    [practice, refresh, disabled],
  );

  const runNow = useCallback(async () => {
    // A backup already running may have started before the latest change: then run another.
    if (inflight.current) await inflight.current;
    return run(true);
  }, [run]);

  const chooseFolder = useCallback(async () => {
    const path = await platform.dialogs.pickFolder(i18n.t('onboarding.backupChoose'));
    if (!path) return false;
    await practice.store.setMeta(META.backupFolder, path);
    await refresh();
    return runNow();
  }, [platform, practice, i18n, refresh, runNow]);

  // On open: erase what was deleted more than 30 days ago (and what finished imports kept),
  // then back up if a day has passed
  // (the backup then holds nothing erased). Again every hour while Sala stays open. The example
  // practice starts afresh every time: nothing to do there.
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const check = async () => {
      await purgeExpired(practice).catch((e) => console.error('erasing old deleted items failed', e));
      await tidyImportJobs(practice).catch((e) => console.error('tidying old imports failed', e));
      const s = await backupStatus(practice);
      if (cancelled) return;
      setStatus(s);
      if (s.due) await run(false);
    };
    void check();
    const timer = setInterval(() => void check(), HOUR_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [practice, run, disabled]);

  // Locking and closing: after pages are saved (stage flush), a backup when anything changed.
  useRegisterSaver(
    async () => {
      if (disabled || !(await practice.store.getMeta(META.backupFolder))) return;
      if (inflight.current) await inflight.current;
      await run(false);
    },
    { stage: SAVE_STAGE.backup, limitMs: LOCK_BACKUP_LIMIT_MS },
  );

  // Closing the window locks first: every saver runs (pages, then the backup) behind the
  // "Locking…" screen, whether or not a backup folder is set, and the database closes cleanly.
  useEffect(() => platform.onBeforeExit(() => lock()), [platform, lock]);

  const value = useMemo(() => ({ status, running, disabled, runNow, chooseFolder, refresh }), [status, running, disabled, runNow, chooseFolder, refresh]);
  return <BackupCtx.Provider value={value}>{children}</BackupCtx.Provider>;
}

/** The menu's last line: where the practice lives and how the backups are doing. */
export function BackupLine() {
  const { status, running, disabled } = useBackup();
  const i18n = useI18n();
  const { go } = useRouter();
  const { c } = useTheme();
  const { t } = i18n;
  let text = t('status.backupNever');
  let color = c.warningText;
  if (disabled) {
    text = t('status.backupExample');
    color = c.textSecondary;
  } else if (running) {
    text = t('status.backingUp');
    color = c.textSecondary;
  } else if (!status) {
    text = '';
  } else if (!status.folder) {
    text = t('status.backupNoFolder');
  } else if (status.lastError) {
    text = t('status.backupFailed');
    color = c.dangerText;
  } else if (status.lastOk) {
    text = t('status.backupAgo', { when: i18n.relative(status.lastOk, DateTime.now()) });
    color = backupIsStale(status) ? c.warningText : c.successText;
  }
  return (
    <Pressable
      onPress={() => go({ name: 'settings', section: 'backup' })}
      accessibilityRole="link"
      accessibilityLabel={text ? `${t('status.local')}. ${text}` : t('status.local')}
      testID="backup-line"
      style={(state) => {
        const { hovered, focused } = state as { hovered?: boolean; focused?: boolean };
        return [
          { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: 2 },
          hovered && { backgroundColor: c.surfaceAlt },
          focused && focusRing(c.focus),
          web({ cursor: 'pointer' }),
        ];
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="device" size={14} color={c.textSecondary} />
        <T variant="tiny" tone="secondary">{t('status.local')}</T>
      </View>
      {text ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginLeft: 3 }} />
          <T variant="tiny" style={{ color }}>{text}</T>
        </View>
      ) : null}
    </Pressable>
  );
}
