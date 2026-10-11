import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import { isValidRecoveryPhrase, WrongSecretError } from '../../core/crypto/keyring';
import { EXAMPLE_PASSPHRASE } from '../../services/example';
import { Practice } from '../../services/practice';
import { type LockedReason, type StoppedJob, useAppState } from '../../shell/AppState';
import { type I18n, useI18n } from '../../ui/i18n';
import { Button, Card, Field, Notice, Row, T } from '../../ui/primitives';
import { space } from '../../ui/theme';
import { EraseConfirmDialog } from '../common/EraseConfirm';
import { OnboardingHelp } from './OnboardingHelp';
import { PassphraseFields, passphraseError } from './PassphraseFields';
import { SecretField } from './SecretField';
import { Frame, LanguagePicker } from './Welcome';

export function Unlock({ reason }: { reason?: LockedReason }) {
  const { platform, example, opened, prefs, erased, stopped } = useAppState();
  const { t, tp } = useI18n();
  const [mode, setMode] = useState<'pass' | 'phrase'>('pass');
  const [pass, setPass] = useState('');
  const [shown, setShown] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newConfirm, setNewConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Enter pressed again while the practice opens must not open it twice: a second Practice
  // would hold the keys where locking never wipes them. A ref, since state lags a render.
  const busyRef = useRef(false);

  async function openWithPass() {
    if (!pass || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      opened(await Practice.unlock(platform, 'passphrase', pass));
    } catch (e) {
      setError(e instanceof WrongSecretError ? t('unlock.wrong') : describe(e, t('errors.generic'), t('errors.newerVersion')));
      setPass('');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function openWithPhrase() {
    if (busyRef.current) return;
    if (!isValidRecoveryPhrase(phrase)) {
      setError(t('unlock.phraseInvalid'));
      return;
    }
    if (passphraseError(newPass, newConfirm, t)) {
      setShowErrors(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let practice: Practice | null = null;
    try {
      practice = await Practice.unlock(platform, 'recovery_phrase', phrase);
      await practice.changeSecret('passphrase', newPass);
      opened(practice);
    } catch (e) {
      // Not opened: close it again, so its keys do not stay in memory.
      await practice?.lock().catch(() => undefined);
      setError(e instanceof WrongSecretError ? t('unlock.phraseWrong') : describe(e, t('errors.generic'), t('errors.newerVersion')));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (help) return <OnboardingHelp topic="forgot" onClose={() => setHelp(false)} />;

  if (reason === 'noKeyring') {
    return (
      <Frame onHelp={() => setHelp(true)}>
        <View testID="unlock-no-keyring">
          <Notice tone="danger" title={t('unlock.noKeyringTitle')}>{t('unlock.noKeyring')}</Notice>
        </View>
        <Row>
          <EraseButton onErased={erased} />
        </Row>
        <Card>
          <LanguagePicker />
        </Card>
      </Frame>
    );
  }

  return (
    <Frame onHelp={() => setHelp(true)}>
      {example ? <Notice tone="warning" title={t('example.badge')}>{t('example.unlockHint', { pass: EXAMPLE_PASSPHRASE })}</Notice> : null}
      {reason === 'idle' ? <Notice tone="info" icon="lock">{t('unlock.locked', { n: prefs.autoLockMinutes })}</Notice> : null}
      {reason === 'eraseFailed' ? <Notice tone="danger">{t('unlock.eraseFailed')}</Notice> : null}
      {stopped.map((s) => (
        <Notice key={s.kind} tone={s.kind === 'passphraseSaved' || s.kind === 'phraseSaved' ? 'success' : 'warning'}>
          {stoppedText(s, t, tp)}
        </Notice>
      ))}
      {mode === 'pass' ? (
        <>
          <T variant="title" role="heading">{t('unlock.title')}</T>
          <Card style={{ gap: space.md }}>
            <SecretField
              label={t('unlock.passLabel')}
              value={pass}
              onChangeText={(v) => {
                setPass(v);
                setError(null);
              }}
              shown={shown}
              onToggle={() => setShown(!shown)}
              autoFocus
              testID="unlock-passphrase"
              toggleTestID="unlock-show"
              onSubmitEditing={() => void openWithPass()}
              error={error}
            />
            <Button variant="primary" label={busy ? t('unlock.opening') : t('unlock.open')} busy={busy} disabled={!pass} onPress={() => void openWithPass()} testID="unlock" />
          </Card>
          <Row style={{ justifyContent: 'space-between' }} wrap>
            <Button variant="ghost" small label={t('unlock.usePhrase')} onPress={() => { setMode('phrase'); setError(null); }} testID="unlock-use-phrase" />
            <EraseButton onErased={erased} />
          </Row>
        </>
      ) : (
        <>
          <T variant="title" role="heading">{t('unlock.phraseTitle')}</T>
          <Card style={{ gap: space.md }}>
            <Field label={t('unlock.phraseLabel')} value={phrase} onChangeText={setPhrase} multiline minHeight={72} autoCapitalize="none" autoCorrect={false} autoFocus testID="unlock-phrase" />
            <T variant="label" tone="secondary">{t('unlock.newPass')}</T>
            {/* No autoFocus here: the cursor stays in the recovery phrase above. */}
            <PassphraseFields value={newPass} confirm={newConfirm} onChange={setNewPass} onConfirm={setNewConfirm} label={t('settings.newPass')} showErrors={showErrors} onSubmit={() => void openWithPhrase()} />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button variant="primary" label={busy ? t('unlock.opening') : t('unlock.open')} busy={busy} onPress={() => void openWithPhrase()} testID="unlock-with-phrase" />
          </Card>
          <Button variant="ghost" small label={t('unlock.usePass')} onPress={() => { setMode('pass'); setError(null); }} style={{ alignSelf: 'flex-start' }} />
        </>
      )}
      <Card>
        <LanguagePicker />
      </Card>
    </Frame>
  );
}

/** "Remove this practice…": deletes the encrypted practice after the therapist types the confirmation word. */
function EraseButton({ onErased }: { onErased: () => void }) {
  const { platform } = useAppState();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" small label={t('unlock.removePractice')} onPress={() => setOpen(true)} testID="unlock-remove" />
      <EraseConfirmDialog
        visible={open}
        onClose={() => setOpen(false)}
        onConfirm={async () => {
          await platform.practice.erase();
          onErased();
        }}
      />
    </>
  );
}

function stoppedText(s: StoppedJob, t: I18n['t'], tp: I18n['tp']): string {
  switch (s.kind) {
    case 'documents':
      return tp('unlock.stoppedDocuments', s.count);
    case 'export':
      return t('unlock.stoppedExport');
    case 'merge':
      return t('unlock.stoppedMerge');
    case 'passphraseSaved':
      return t('unlock.savedPassphrase');
    case 'passphraseNotSaved':
      return t('unlock.notSavedPassphrase');
    case 'phraseSaved':
      return t('unlock.savedPhrase');
  }
}

function describe(e: unknown, generic: string, newer: string): string {
  const msg = (e as Error)?.message ?? '';
  return /newer version/i.test(msg) ? newer : generic;
}
