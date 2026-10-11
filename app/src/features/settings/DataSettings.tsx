import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { wipe } from '../../core/bytes';
import { DecryptError } from '../../core/crypto/frames';
import { WrongSecretError } from '../../core/crypto/keyring';
import type { ReadResult } from '../../core/export/sala';
import { exportTo, mergeInto, openOwnBackup, openSalaFile, protectionOf } from '../../services/data';
import { EraseConfirmDialog } from '../common/EraseConfirm';
import { JobStopped } from '../../services/jobs';
import { exportLabels } from '../../services/labels';
import { useAppState, useLockAwareJob, usePractice } from '../../shell/AppState';
import { backupErrorText } from './backupText';
import { useBackup } from '../../shell/BackupProvider';
import { useI18n } from '../../ui/i18n';
import { Button, Card, Checkbox, Col, Dialog, Field, Notice, Row, Segmented, T } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';

type Message = { tone: 'success' | 'danger'; text: string } | null;

/** Export everything: one .sala file, by default with a password typed twice. */
export function ExportCard() {
  const practice = usePractice();
  const { platform, noteStopped } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const [includeProcess, setIncludeProcess] = useState(false);
  const [usePassword, setUsePassword] = useState(true);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // Locking during an export stops it before the keys are wiped: no file is written, rather
  // than one with documents missing. The unlock screen asks the therapist to export again.
  const job = useLockAwareJob();

  // The second field shows a mismatch as soon as it stops being the start of the first.
  const mismatch = usePassword && again !== '' && !password.startsWith(again);
  const ready = !usePassword || (password.length >= 8 && again === password);

  async function doExport() {
    if (!ready) return;
    const stamp = DateTime.now().toISODate();
    const path = await platform.dialogs.saveFile(t('settings.export'), `Sala export ${stamp}.sala`, [{ name: 'Sala', extensions: ['sala'] }]);
    if (!path) return;
    if (job.shouldStop()) return noteStopped({ kind: 'export' });
    setBusy(true);
    setMessage(null);
    try {
      await job.run((shouldStop) =>
        exportTo(practice, path, exportLabels(i18n), { includeProcessNotes: includeProcess, password: usePassword ? password : null, shouldStop }),
      );
      setMessage({ tone: 'success', text: t('settings.exportDone', { path }) });
      setPassword('');
      setAgain('');
    } catch (e) {
      if (e instanceof JobStopped || !practice.isOpen) return noteStopped({ kind: 'export' });
      console.error(e);
      setMessage({ tone: 'danger', text: t('errors.fileWrite') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.md }}>
      <T variant="heading" role="heading">{t('settings.export')}</T>
      <T tone="secondary">{t('settings.exportBody')}</T>
      <Checkbox checked={includeProcess} onChange={setIncludeProcess} label={t('settings.exportProcess')} />
      <Checkbox checked={usePassword} onChange={setUsePassword} label={t('settings.exportPassword')} hint={usePassword ? undefined : t('settings.exportPasswordHint')} />
      {usePassword ? (
        <Row wrap align="flex-start" gap={space.md}>
          <Field
            label={t('settings.exportPasswordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            hint={t('settings.exportPasswordMin')}
            style={{ flex: 1, minWidth: 220, maxWidth: 320 }}
            testID="export-password"
          />
          <Field
            label={t('settings.exportPasswordConfirm')}
            value={again}
            onChangeText={setAgain}
            secureTextEntry
            error={mismatch ? t('settings.exportPasswordMismatch') : null}
            onSubmitEditing={() => void doExport()}
            style={{ flex: 1, minWidth: 220, maxWidth: 320 }}
            testID="export-password-again"
          />
        </Row>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button variant="primary" icon="download" label={t('settings.export')} busy={busy} disabled={!ready} onPress={() => void doExport()} style={{ alignSelf: 'flex-start' }} testID="export" />
    </Card>
  );
}

type ImportStep =
  | { name: 'secret'; path: string; bytes: Uint8Array; needs: 'password' | 'secret' }
  | { name: 'preview'; path: string; contents: ReadResult };

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Import a .sala file: open it (own backups need no passphrase), see what is in it, then add it. */
export function ImportCard() {
  const practice = usePractice();
  const { platform, noteStopped } = useAppState();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const [step, setStep] = useState<ImportStep | null>(null);
  const [secret, setSecret] = useState('');
  const [slot, setSlot] = useState<'passphrase' | 'recovery_phrase'>('passphrase');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  // Locking waits for the file's records to be merged, then stops before the next document's
  // file. The unlock screen asks the therapist to add the file again, which brings the missing
  // files and adds nothing twice.
  const job = useLockAwareJob({ limitMs: 60_000 });

  const close = () => {
    setStep(null);
    setSecret('');
    setWrong(false);
  };

  async function pick() {
    setMessage(null);
    const [path] = await platform.dialogs.pickFiles(t('settings.importSala'), [{ name: 'Sala', extensions: ['sala'] }], false);
    if (!path) return;
    setBusy(true);
    try {
      const bytes = await platform.files.read(path);
      const kind = protectionOf(bytes);
      if (kind === 'none') {
        setStep({ name: 'preview', path, contents: (await openSalaFile(platform, bytes, { kind: 'none' })).contents });
      } else {
        const own = kind === 'practice-key' ? await openOwnBackup(practice, bytes) : null;
        setStep(own ? { name: 'preview', path, contents: own } : { name: 'secret', path, bytes, needs: kind === 'password' ? 'password' : 'secret' });
      }
    } catch {
      setMessage({ tone: 'danger', text: t('restore.notBackup') });
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    if (step?.name !== 'secret' || !secret) return;
    setBusy(true);
    setWrong(false);
    try {
      const how = step.needs === 'password' ? ({ kind: 'password', password: secret } as const) : ({ kind: 'secret', slot, secret } as const);
      const { contents, practiceKey } = await openSalaFile(platform, step.bytes, how);
      wipe(practiceKey); // another practice's key: only its contents are needed
      setSecret('');
      setStep({ name: 'preview', path: step.path, contents });
    } catch (e) {
      if (e instanceof WrongSecretError || e instanceof DecryptError) setWrong(true);
      else {
        close();
        setMessage({ tone: 'danger', text: t('restore.notBackup') });
      }
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (step?.name !== 'preview' || job.shouldStop()) return;
    const { contents } = step;
    setBusy(true);
    try {
      const r = await job.run((shouldStop) => mergeInto(practice, contents, shouldStop));
      close();
      setMessage({
        tone: 'success',
        text: r.records || r.attachments ? t('settings.importSalaDone', { records: r.records, files: r.attachments }) : t('settings.importNothingNew'),
      });
    } catch (e) {
      if (e instanceof JobStopped || !practice.isOpen) return noteStopped({ kind: 'merge' });
      console.error(e);
      close();
      setMessage({ tone: 'danger', text: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  const preview = step?.name === 'preview' ? step.contents.manifest : null;
  const counts = preview
    ? (['folder', 'page', 'sticky', 'appointment', 'attachment'] as const).filter((k) => (preview.counts[k] ?? 0) > 0).map((k) => tp(`settings.counts.${k}`, preview.counts[k]!))
    : [];
  const made = preview ? DateTime.fromISO(preview.created_at).setLocale(i18n.meta.bcp47) : null;

  return (
    <Card style={{ gap: space.md }}>
      <T variant="heading" role="heading">{t('settings.importSala')}</T>
      <T tone="secondary">{t('settings.importSalaBody')}</T>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button icon="upload" label={t('settings.importSala')} busy={busy && !step} onPress={() => void pick()} style={{ alignSelf: 'flex-start' }} testID="import-sala" />

      <Dialog
        visible={!!step}
        title={t('settings.importSala')}
        onClose={busy ? () => undefined : close}
        onSubmit={step?.name === 'secret' ? (secret ? () => void unlock() : undefined) : busy ? undefined : () => void add()}
        testID="import-sala-dialog"
        footer={
          <>
            <Button label={t('common.cancel')} onPress={close} disabled={busy} />
            {step?.name === 'secret' ? (
              <Button variant="primary" label={t('common.continue')} busy={busy} disabled={!secret} onPress={() => void unlock()} testID="import-sala-unlock" />
            ) : (
              <Button variant="primary" icon="upload" label={t('settings.importConfirm')} busy={busy} onPress={() => void add()} testID="import-sala-confirm" />
            )}
          </>
        }
      >
        {step ? <T variant="small" tone="secondary" numberOfLines={1} selectable>{fileName(step.path)}</T> : null}
        {step?.name === 'secret' ? (
          <Col gap={space.md}>
            <T>{step.needs === 'password' ? t('settings.importNeedsPassword') : t('settings.importNeedsSecret')}</T>
            {step.needs === 'secret' ? (
              <Segmented
                label={t('restore.fileLabel')}
                value={slot}
                onChange={(v) => {
                  setSlot(v);
                  setWrong(false);
                }}
                options={[
                  { value: 'passphrase', label: t('restore.withPass') },
                  { value: 'recovery_phrase', label: t('restore.withPhrase') },
                ]}
              />
            ) : null}
            <Field
              label={step.needs === 'password' ? t('restore.passwordLabel') : slot === 'passphrase' ? t('restore.withPass') : t('unlock.phraseLabel')}
              value={secret}
              onChangeText={(v) => {
                setSecret(v);
                setWrong(false);
              }}
              secureTextEntry={step.needs === 'password' || slot === 'passphrase'}
              autoFocus
              autoCapitalize="none"
              onSubmitEditing={() => void unlock()}
              error={wrong ? t('settings.importWrong') : null}
              testID="import-sala-secret"
            />
          </Col>
        ) : null}
        {preview && made ? (
          <Col gap={space.sm}>
            <T variant="label" tone="secondary">{t('settings.importWhat')}</T>
            <T style={{ fontWeight: '600' }}>{counts.length ? counts.join(', ') : t('settings.importNothing')}</T>
            <T variant="small" tone="secondary">{t('settings.importMade', { date: `${i18n.date(made)} ${i18n.time(made)}`, version: preview.app_version })}</T>
            <T variant="small" tone="secondary">{preview.practice_id === practice.store.practiceId ? t('settings.importOwn') : t('settings.importOther')}</T>
            <T variant="small" tone="secondary">{preview.include_process_notes ? t('settings.importNotesIn') : t('settings.importNotesOut')}</T>
          </Col>
        ) : null}
      </Dialog>
    </Card>
  );
}

/** Remove from this computer, with a last look at the backups first. */
export function DangerZone() {
  const { erasePractice, example } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const backup = useBackup();
  const [open, setOpen] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const close = () => {
    setOpen(false);
    setBackedUp(false);
  };
  const s = backup.status;
  const last = s?.lastOk ? DateTime.fromISO(s.lastOk) : null;
  return (
    <Card style={{ gap: space.md, borderColor: c.dangerBorder }}>
      <T variant="heading" role="heading">{t('settings.danger')}</T>
      <T tone="secondary">{t('settings.dangerBody')}</T>
      <Button variant="danger" icon="trash" label={t('unlock.eraseButton')} onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} testID="erase-open" />
      <EraseConfirmDialog
        visible={open}
        onClose={close}
        // Locking unmounts this screen; a failure is told on the unlock screen.
        onConfirm={erasePractice}
        extra={
          example ? null : (
            <Card style={{ gap: space.sm }}>
              <T variant="small" tone="secondary">
                {t('settings.backupLast', { when: last ? `${i18n.date(last)} ${i18n.time(last)}` : t('time.never') })}
              </T>
              <T variant="small">{t('settings.eraseBackupFirst')}</T>
              {backedUp ? (
                <Notice tone="success">{t('today.backupDone')}</Notice>
              ) : s?.folder ? (
                <Button small icon="backup" label={t('settings.backupNow')} busy={backup.running} onPress={() => void backup.runNow().then(setBackedUp)} style={{ alignSelf: 'flex-start' }} testID="erase-backup-now" />
              ) : (
                <Button small icon="backup" label={t('today.backupChoose')} busy={backup.running} onPress={() => void backup.chooseFolder().then(setBackedUp)} style={{ alignSelf: 'flex-start' }} />
              )}
              {s?.lastError && !backedUp ? <T variant="small" tone="danger">{backupErrorText(t, s.lastError.code)}</T> : null}
            </Card>
          )
        }
      />
    </Card>
  );
}
