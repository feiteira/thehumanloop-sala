import React, { type ReactNode, useEffect, useState } from 'react';
import { fold } from '../../core/text/normalize';
import { useI18n } from '../../ui/i18n';
import { Button, Col, Dialog, Field, Notice, T } from '../../ui/primitives';

/**
 * Asks before removing the practice from this computer: the therapist types the confirmation
 * word (any case, any accents: "delete", "Apagar", "eliminar"). `onConfirm` does the removal;
 * when it fails, the dialog stays and says so. `extra` sits between the text and the word, for
 * a last look at the backups.
 */
export function EraseConfirmDialog({ visible, onClose, onConfirm, extra }: { visible: boolean; onClose: () => void; onConfirm: () => Promise<void>; extra?: ReactNode }) {
  const { t } = useI18n();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmed = fold(word) === fold(t('unlock.eraseConfirmWord'));
  useEffect(() => {
    if (!visible) return;
    setWord('');
    setBusy(false);
    setFailed(false);
  }, [visible]);
  const close = () => {
    if (!busy) onClose();
  };
  async function erase() {
    if (!confirmed || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch (e) {
      console.error(e);
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <Dialog
      visible={visible}
      title={t('unlock.eraseTitle')}
      onClose={close}
      testID="erase-dialog"
      footer={
        <>
          <Button label={t('common.cancel')} onPress={close} disabled={busy} />
          <Button
            variant="danger"
            label={busy ? t('unlock.erasing') : t('unlock.eraseButton')}
            busy={busy}
            disabled={!confirmed}
            onPress={() => void erase()}
            testID="erase-confirm"
          />
        </>
      }
    >
      <Col>
        <T>{t('unlock.eraseBody')}</T>
        {extra}
        <Field label={t('unlock.eraseConfirmLabel')} value={word} onChangeText={setWord} autoCapitalize="characters" autoCorrect={false} autoFocus testID="erase-word" />
        {failed ? <Notice tone="danger">{t('errors.generic')}</Notice> : null}
      </Col>
    </Dialog>
  );
}
