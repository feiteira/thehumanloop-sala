import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { isValidRecoveryPhrase, newRecoveryPhrase, normalizeRecoveryPhrase, WrongSecretError } from '../../core/crypto/keyring';
import { UI_LOCALE_META, UI_LOCALES } from '../../core/i18n/locales';
import { NotSalaFileError } from '../../core/export/sala';
import { META, protectionOf, restoreBackup } from '../../services/data';
import { Practice } from '../../services/practice';
import { useAppState } from '../../shell/AppState';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Button, Card, Checkbox, Col, Field, Notice, Row, Segmented, T } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { OnboardingHelp } from './OnboardingHelp';
import { PassphraseFields, passphraseError } from './PassphraseFields';
import { pickCheckPositions } from './passphrase';
import { SecretField } from './SecretField';

type Step = 'welcome' | 'passphrase' | 'phrase' | 'check' | 'backup' | 'restore';

/** The page around onboarding and unlock. `onHelp` adds "Read the manual" beside the name. */
export function Frame({ children, wide, onHelp }: { children: React.ReactNode; wide?: boolean; onHelp?: () => void }) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.background }} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl }}>
      <View style={{ width: '100%', maxWidth: wide ? 720 : 560, gap: space.lg }}>
        <Row gap={space.md} style={{ marginBottom: space.sm }}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="folder" size={22} color={c.accent} />
          </View>
          <T variant="display" style={{ flex: 1 }}>Sala</T>
          {onHelp ? <Button variant="ghost" small icon="help" label={t('onboarding.readManual')} onPress={onHelp} testID="onboarding-help" /> : null}
        </Row>
        {children}
      </View>
    </ScrollView>
  );
}

export function LanguagePicker() {
  const { prefs, setPrefs } = useAppState();
  const { t } = useI18n();
  return (
    <Row style={{ justifyContent: 'space-between' }} wrap>
      <T variant="label" tone="secondary">{t('onboarding.chooseLanguage')}</T>
      <Segmented
        label={t('onboarding.chooseLanguage')}
        value={prefs.locale}
        onChange={(locale) => setPrefs({ locale })}
        options={UI_LOCALES.map((l) => ({ value: l, label: UI_LOCALE_META[l].nativeName }))}
      />
    </Row>
  );
}

export function Welcome() {
  const { platform, opened } = useAppState();
  const { t } = useI18n();
  const { c } = useTheme();
  const [step, setStep] = useState<Step>('welcome');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const phrase = useMemo(() => newRecoveryPhrase(), []);
  const [written, setWritten] = useState(false);
  const positions = useMemo(() => pickCheckPositions(), []);
  const [checks, setChecks] = useState<Record<number, string>>({});
  const [checkError, setCheckError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Enter pressed again while the practice is being made must not make a second one.
  const busyRef = useRef(false);

  const words = phrase.split(' ');
  const total = 4;

  async function create() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      setPractice(await Practice.create(platform, { passphrase: pass, recoveryPhrase: phrase }));
      setStep('backup');
    } catch (e) {
      console.error('setting up the practice failed', e);
      setError(t('errors.generic'));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function chooseBackup() {
    const path = await platform.dialogs.pickFolder(t('onboarding.backupChoose'));
    if (path && practice) {
      await practice.store.setMeta(META.backupFolder, path);
      setBackupPath(path);
    }
  }

  if (step === 'restore') return <Restore onBack={() => setStep('welcome')} />;
  // Help keeps everything typed so far: the steps' state lives here, not in the frame.
  if (help) return <OnboardingHelp topic="welcome" onClose={() => setHelp(false)} />;
  const openHelp = () => setHelp(true);

  if (step === 'welcome') {
    return (
      <Frame onHelp={openHelp}>
        <T variant="title" role="heading">{t('onboarding.welcomeTitle')}</T>
        <T tone="secondary">{t('onboarding.welcomeBody')}</T>
        <Card style={{ gap: space.lg }}>
          <LanguagePicker />
        </Card>
        <Row wrap>
          <Button variant="primary" label={t('onboarding.start')} icon="plus" onPress={() => setStep('passphrase')} testID="start-new" />
          <Button label={t('onboarding.restore')} icon="backup" onPress={() => setStep('restore')} testID="start-restore" />
        </Row>
      </Frame>
    );
  }

  const header = (n: number, title: string, body: string) => (
    <Col gap={space.sm}>
      <T variant="small" tone="muted">{t('onboarding.stepOf', { n, total })}</T>
      <T variant="title" role="heading">{title}</T>
      <T tone="secondary">{body}</T>
    </Col>
  );

  if (step === 'passphrase') {
    const err = passphraseError(pass, confirm, t);
    const next = () => (err ? setShowErrors(true) : setStep('phrase'));
    return (
      <Frame onHelp={openHelp}>
        {header(1, t('onboarding.passTitle'), t('onboarding.passBody'))}
        <Card>
          <PassphraseFields value={pass} confirm={confirm} onChange={setPass} onConfirm={setConfirm} showErrors={showErrors} onSubmit={next} autoFocus />
        </Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" label={t('common.back')} icon="chevronLeft" onPress={() => setStep('welcome')} />
          <Button variant="primary" label={t('common.next')} onPress={next} testID="next" />
        </Row>
      </Frame>
    );
  }

  if (step === 'phrase') {
    return (
      <Frame wide onHelp={openHelp}>
        {header(2, t('onboarding.phraseTitle'), t('onboarding.phraseBody'))}
        <Card style={{ backgroundColor: c.cream, borderColor: c.border }}>
          <View testID="recovery-phrase" accessibilityLabel={phrase} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {words.map((w, i) => (
              <View key={i} style={{ width: '31%', flexDirection: 'row', gap: space.sm, alignItems: 'baseline', padding: space.sm, borderRadius: radius.sm, backgroundColor: c.surface }}>
                <T variant="small" tone="muted" style={{ width: 22, textAlign: 'right' }}>{i + 1}</T>
                <T variant="heading" selectable style={{ fontFamily: 'ui-monospace, monospace' }}>{w}</T>
              </View>
            ))}
          </View>
        </Card>
        <Checkbox checked={written} onChange={setWritten} label={t('onboarding.phraseWritten')} testID="phrase-written" />
        <Row style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" label={t('common.back')} icon="chevronLeft" onPress={() => setStep('passphrase')} />
          <Button variant="primary" label={t('common.next')} disabled={!written} onPress={() => setStep('check')} testID="next" />
        </Row>
      </Frame>
    );
  }

  if (step === 'check') {
    const ok = positions.every((p) => normalizeRecoveryPhrase(checks[p] ?? '') === words[p - 1]);
    const submit = () => (ok ? void create() : setCheckError(true));
    return (
      <Frame onHelp={openHelp}>
        {header(3, t('onboarding.phraseCheckTitle'), t('onboarding.phraseCheckBody'))}
        <Card style={{ gap: space.md }}>
          {positions.map((p, i) => (
            <Field
              key={p}
              label={t('onboarding.phraseWord', { n: p })}
              value={checks[p] ?? ''}
              onChangeText={(v) => {
                setChecks({ ...checks, [p]: v });
                setCheckError(false);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={i === 0}
              testID={`check-word-${p}`}
              onSubmitEditing={i === positions.length - 1 ? submit : undefined}
            />
          ))}
          {checkError ? <Notice tone="danger">{t('onboarding.phraseWrong')}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Button variant="ghost" label={t('common.back')} icon="chevronLeft" onPress={() => setStep('phrase')} disabled={busy} />
          <Button variant="primary" label={busy ? t('onboarding.creating') : t('common.continue')} busy={busy} onPress={submit} testID="next" />
        </Row>
      </Frame>
    );
  }

  // step === 'backup'
  return (
    <Frame onHelp={openHelp}>
      {header(4, t('onboarding.backupTitle'), t('onboarding.backupBody'))}
      <Card style={{ gap: space.md }}>
        {backupPath ? (
          <Notice tone="success">{t('onboarding.backupChosen', { path: backupPath })}</Notice>
        ) : (
          <Button label={t('onboarding.backupChoose')} icon="backup" onPress={() => void chooseBackup()} testID="choose-backup" />
        )}
      </Card>
      <Row style={{ justifyContent: 'flex-end' }}>
        {!backupPath ? <Button variant="ghost" label={t('onboarding.backupLater')} onPress={() => practice && opened(practice, true)} testID="backup-later" /> : null}
        <Button variant="primary" label={t('common.done')} disabled={!backupPath} onPress={() => practice && opened(practice, true)} testID="finish" />
      </Row>
    </Frame>
  );
}

function Restore({ onBack }: { onBack: () => void }) {
  const { platform, opened } = useAppState();
  const { t } = useI18n();
  const [path, setPath] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [slot, setSlot] = useState<'passphrase' | 'recovery_phrase'>('passphrase');
  const [secret, setSecret] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // Enter pressed again while restoring must not start a second restore into the same place.
  const busyRef = useRef(false);

  async function pick() {
    setError(null);
    const [p] = await platform.dialogs.pickFiles(t('restore.pickTitle'), [{ name: 'Sala', extensions: ['sala'] }], false);
    if (!p) return;
    try {
      const b = await platform.files.read(p);
      const kind = protectionOf(b);
      // Exports carry no keyring, so they cannot become a practice: they are imported into one.
      if (kind === 'password' || kind === 'none') {
        setError(kind === 'password' ? t('restore.passwordFile') : t('restore.exportFile'));
        return;
      }
      setPath(p);
      setBytes(b);
    } catch {
      setError(t('restore.notBackup'));
    }
  }

  async function restore() {
    if (!bytes || busyRef.current) return;
    if (slot === 'recovery_phrase' && !isValidRecoveryPhrase(secret)) {
      setError(t('unlock.phraseInvalid'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      opened(await restoreBackup(platform, bytes, slot, secret));
    } catch (e) {
      setError(e instanceof WrongSecretError ? t('restore.wrong') : e instanceof NotSalaFileError ? t('restore.notBackup') : t('errors.generic'));
      await platform.practice.erase().catch(() => {});
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (help) return <OnboardingHelp topic="restore" onClose={() => setHelp(false)} />;

  return (
    <Frame onHelp={() => setHelp(true)}>
      <T variant="title" role="heading">{t('restore.title')}</T>
      <T tone="secondary">{t('restore.body')}</T>
      <Card style={{ gap: space.md }}>
        <Row>
          <Button label={t('restore.pick')} icon="file" onPress={() => void pick()} />
          {path ? <T variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>{path}</T> : null}
        </Row>
        {bytes ? (
          <>
            <Segmented
              label={t('restore.fileLabel')}
              value={slot}
              onChange={(v) => {
                setSlot(v);
                setSecret('');
                setError(null);
              }}
              options={[
                { value: 'passphrase', label: t('restore.withPass') },
                { value: 'recovery_phrase', label: t('restore.withPhrase') },
              ]}
            />
            {slot === 'passphrase' ? (
              <SecretField
                label={t('restore.withPass')}
                value={secret}
                onChangeText={setSecret}
                shown={shown}
                onToggle={() => setShown(!shown)}
                autoFocus
                testID="restore-secret"
                onSubmitEditing={() => void restore()}
              />
            ) : (
              <Field
                label={t('unlock.phraseLabel')}
                value={secret}
                onChangeText={setSecret}
                multiline
                minHeight={72}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                testID="restore-secret"
              />
            )}
          </>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" label={t('common.back')} icon="chevronLeft" onPress={onBack} disabled={busy} />
        <Button variant="primary" label={busy ? t('restore.restoring') : t('restore.restore')} busy={busy} disabled={!bytes || !secret} onPress={() => void restore()} />
      </Row>
    </Frame>
  );
}
