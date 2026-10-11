import React, { useEffect, useState } from 'react';
import type { Folder } from '../../core/model/types';
import { exportFolderTo, folderExportName } from '../../services/folderExport';
import { JobStopped } from '../../services/jobs';
import { exportLabels } from '../../services/labels';
import { useAppState, useLockAwareJob, usePractice } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Button, Checkbox, Col, Dialog, Field, Notice, T } from '../../ui/primitives';
import { space } from '../../ui/theme';
import { useToast } from '../../ui/Toast';
import { useNow, usePracticeTz } from '../common/hooks';

const MIN_PASSWORD = 8;

/**
 * Exports one patient's folder as a .sala file, for an access request or a handover: their
 * pages, sticky notes, appointments and (by default) documents. Private process notes stay
 * out unless ticked; a password is optional, because without one the patient can open the
 * file without Sala.
 */
export function ExportFolderDialog({ visible, onClose, folder }: { visible: boolean; onClose: () => void; folder: Folder }) {
  const practice = usePractice();
  const { platform, noteStopped } = useAppState();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const today = useNow(usePracticeTz()).toISODate()!;
  const [process, setProcess] = useState(false);
  const [documents, setDocuments] = useState(true);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Locking during an export (Lock, Ctrl+L) stops it before the keys are wiped: no file is
  // written, rather than one with documents missing. The unlock screen asks to export again.
  const job = useLockAwareJob();
  const { data: docCount = 0 } = useLive((s) => s.count('attachment', 'folder_id = ?', [folder.id]), [folder.id], ['attachment']);

  // Each time it opens: the safe defaults again, and no password left over.
  useEffect(() => {
    if (!visible) return;
    setProcess(false);
    setDocuments(true);
    setUsePassword(false);
    setPassword('');
    setConfirm('');
    setShowErrors(false);
    setError(null);
  }, [visible]);

  const passwordError = usePassword && password.length < MIN_PASSWORD ? t('folderExport.passwordShort') : null;
  const confirmError = usePassword && !passwordError && confirm !== password ? t('folderExport.passwordMismatch') : null;

  async function run() {
    if (busy) return;
    if (passwordError || confirmError) {
      setShowErrors(true);
      return;
    }
    const path = await platform.dialogs.saveFile(t('folderExport.saveTitle'), folderExportName(folder, today), [{ name: 'Sala', extensions: ['sala'] }]);
    if (!path) return;
    if (job.shouldStop()) return noteStopped({ kind: 'export' });
    setBusy(true);
    setError(null);
    try {
      await job.run((shouldStop) =>
        exportFolderTo(practice, folder.id, path, exportLabels(i18n), {
          includeProcessNotes: process,
          includeDocuments: documents && docCount > 0,
          password: usePassword ? password : null,
          shouldStop,
        }),
      );
      onClose();
      toast.show({ message: t('folderExport.done', { path }) });
    } catch (e) {
      if (e instanceof JobStopped || !practice.isOpen) return noteStopped({ kind: 'export' });
      console.error(e);
      setError(t('errors.fileWrite'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      visible={visible}
      title={t('folderExport.title')}
      onClose={busy ? () => undefined : onClose}
      onSubmit={busy ? undefined : () => void run()}
      testID="export-folder-dialog"
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} disabled={busy} />
          <Button
            variant="primary"
            icon="download"
            label={busy ? t('folderExport.exporting') : t('folderExport.export')}
            busy={busy}
            onPress={() => void run()}
            testID="export-folder-run"
          />
        </>
      }
    >
      <T tone="secondary">{t('folderExport.body', { name: folder.label })}</T>
      <Col gap={space.md}>
        <Checkbox checked={process} onChange={setProcess} label={t('folderExport.process')} testID="export-folder-process" />
        {docCount > 0 ? <Checkbox checked={documents} onChange={setDocuments} label={tp('folderExport.documents', docCount)} testID="export-folder-documents" /> : null}
        <Checkbox
          checked={usePassword}
          onChange={(on) => {
            setUsePassword(on);
            setShowErrors(false);
          }}
          label={t('folderExport.password')}
          hint={usePassword ? t('folderExport.passwordOn') : t('folderExport.passwordOff')}
          testID="export-folder-password"
        />
        {usePassword ? (
          <Col gap={space.sm} style={{ paddingLeft: space.xl, maxWidth: 360 + space.xl }}>
            <Field
              label={t('folderExport.passwordLabel')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              error={showErrors ? passwordError : null}
              testID="export-folder-pass"
            />
            <Field
              label={t('folderExport.passwordConfirm')}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
              autoCapitalize="none"
              error={showErrors ? confirmError : null}
              onSubmitEditing={() => void run()}
              testID="export-folder-confirm"
            />
          </Col>
        ) : null}
      </Col>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
