import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { DateTime } from 'luxon';
import { backupIsStale } from '../../services/data';
import { dailyCheck, setDailyCheck, UPDATE_PREFS } from '../../services/updates';
import { useAppState } from '../../shell/AppState';
import { useBackup } from '../../shell/BackupProvider';
import { useI18n } from '../../ui/i18n';
import { Button, Col, Notice, Row, T } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { backupErrorText } from '../settings/backupText';

/**
 * Today's word on backups, only when something needs doing: no folder chosen yet, the last
 * backup failed, or the last good one is more than three days old. Never in the example practice.
 */
export function BackupNotice() {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const backup = useBackup();
  const toast = useToast();
  const s = backup.status;
  // The notice goes once the backup is made; a short message says so.
  const done = (ok: boolean) => ok && toast.show({ message: t('today.backupDone') });

  // Nothing until the first look at the settings, so nothing flashes on every unlock.
  if (backup.disabled || !s) return null;

  if (!s.folder) {
    return (
      <View testID="backup-notice">
        <Notice
          tone="warning"
          icon="backup"
          title={t('today.backupTitle')}
          action={<Button small variant="primary" label={t('today.backupChoose')} onPress={() => void backup.chooseFolder().then(done)} testID="backup-notice-choose" />}
        >
          {t('today.backupNone')}
        </Notice>
      </View>
    );
  }

  const failed = !!s.lastError;
  if (!failed && (!s.lastOk || !backupIsStale(s))) return null;

  const last = s.lastOk ? t('status.lastGood', { when: i18n.relative(s.lastOk, DateTime.now()) }) : t('status.lastGoodNever');
  return (
    <View testID="backup-notice">
      <Notice tone={failed ? 'danger' : 'warning'} icon="backup" title={failed ? t('status.backupFailed') : t('status.backupStale')}>
        <Col gap={space.sm}>
          <T variant="small" style={{ color: failed ? c.dangerText : c.warningText }}>
            {failed ? `${backupErrorText(t, s.lastError!.code)} ${last}` : last}
          </T>
          <Row wrap gap={space.sm}>
            <Button small variant="primary" icon="backup" label={t('today.backupNow')} busy={backup.running} onPress={() => void backup.runNow().then(done)} testID="backup-notice-now" />
            <Button small label={t('status.chooseAnother')} disabled={backup.running} onPress={() => void backup.chooseFolder().then(done)} testID="backup-notice-choose" />
          </Row>
        </Col>
      </Notice>
    </View>
  );
}

/** Asks once whether Sala may look for new versions; nothing is sent until the therapist agrees. */
export function UpdatesQuestion() {
  const { platform, example } = useAppState();
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    // The example practice starts afresh every time: asking there would ask at every start.
    if (platform.http && !example) void platform.prefs.get().then((p) => setAsk(p[UPDATE_PREFS.auto] === undefined));
  }, [platform, example]);
  if (!ask || example) return null;
  const answer = (on: boolean) => {
    setAsk(false);
    void setDailyCheck(platform, on).then(() => (on ? dailyCheck(platform) : null));
  };
  return (
    <Notice
      tone="info"
      icon="download"
      title={t('updates.askTitle')}
      action={
        <Row gap={space.xs}>
          <Button small label={t('updates.askNo')} onPress={() => answer(false)} testID="updates-no" />
          <Button small variant="primary" label={t('updates.askYes')} onPress={() => answer(true)} testID="updates-yes" />
        </Row>
      }
    >
      {t('updates.askBody')}
    </Notice>
  );
}
