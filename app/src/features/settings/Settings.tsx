import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { BackButton } from '../../shell/BackButton';
import { useKeepRoute } from '../../shell/router';
import { HelpButton } from '../../shell/HelpButton';
import { helpTopicFor } from '../../shell/helpTopic';
import { DateTime } from 'luxon';
import { newRecoveryPhrase, WrongSecretError } from '../../core/crypto/keyring';
import { UI_LOCALE_META, UI_LOCALES } from '../../core/i18n/locales';
import { FLOWS, NO_NETWORK } from '../../core/privacy/flows';
import { backupHistoryDays, backupStatus, HISTORY_DAYS, type HistoryDays, META } from '../../services/data';
import { JobStopped } from '../../services/jobs';
import { useAppState, useLockAwareJob, usePractice } from '../../shell/AppState';
import { useBackup } from '../../shell/BackupProvider';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Badge, Button, Card, Checkbox, Col, Dialog, Divider, Field, focusRing, Notice, Row, Segmented, T, useChoiceGroup, web } from '../../ui/primitives';
import { radius, space, useTheme, type ThemeMode } from '../../ui/theme';
import { PassphraseFields, passphraseError } from '../onboarding/PassphraseFields';
import { backupErrorText } from './backupText';
import { AvailabilitySettings, TypesSettings } from './CalendarSettings';
import { DangerZone, ExportCard, ImportCard } from './DataSettings';
import { RecentlyDeleted } from './RecentlyDeleted';
import { TimeZoneSetting } from './TimeZoneSetting';
import { useLoopJoined } from '../../loopBridge';
import { checkForUpdate, dailyCheck, DOWNLOAD_PAGE, setDailyCheck, UPDATE_PREFS } from '../../services/updates';
import { useKnownUpdate } from '../../shell/useKnownUpdate';

type Section = 'general' | 'security' | 'backup' | 'data' | 'calendar' | 'privacy' | 'about';

const SECTIONS: { key: Section; icon: IconName }[] = [
  { key: 'general', icon: 'settings' },
  { key: 'security', icon: 'shield' },
  { key: 'backup', icon: 'backup' },
  { key: 'data', icon: 'download' },
  { key: 'calendar', icon: 'calendar' },
  { key: 'privacy', icon: 'eye' },
  { key: 'about', icon: 'help' },
];

export function Settings({ section: initial }: { section?: string }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const [section, setSection] = useState<Section>((SECTIONS.find((s) => s.key === initial)?.key ?? 'general') as Section);
  const tabs = useChoiceGroup({ values: SECTIONS.map((s) => s.key), value: section, onChange: setSection, role: 'tab' });
  useKeepRoute({ name: 'settings', section });
  const titles: Record<Section, string> = {
    general: t('settings.general'),
    security: t('settings.security'),
    backup: t('settings.backup'),
    data: t('settings.data'),
    calendar: t('settings.calendar'),
    privacy: t('settings.privacy'),
    about: t('settings.about'),
  };
  return (
    <View style={{ flex: 1, flexDirection: 'row' }} testID="screen-settings">
      <View style={{ width: 240, padding: space.lg, gap: 2, borderRightWidth: 1, borderRightColor: c.border }}>
        <Row style={{ marginBottom: space.md, paddingHorizontal: space.sm }}>
          <BackButton />
          <T variant="title" role="heading">{t('settings.title')}</T>
        </Row>
        <View accessibilityRole="tablist" accessibilityLabel={t('settings.title')} style={{ gap: 2 }}>
          {SECTIONS.map((s) => {
            const active = s.key === section;
            return (
              <Pressable
                key={s.key}
                {...tabs.item(s.key)}
                testID={`settings-${s.key}`}
                style={(st) => [
                  { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md, backgroundColor: active ? c.primarySubtle : (st as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent' },
                  (st as { focused?: boolean }).focused && focusRing(c.focus),
                  web({ cursor: 'pointer' }),
                ]}
              >
                <Icon name={s.icon} size={17} color={active ? c.text : c.textSecondary} />
                <T tone={active ? 'primary' : 'secondary'} style={{ fontWeight: active ? '600' : '400' }}>{titles[s.key]}</T>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xxl, gap: space.lg, maxWidth: 820 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="title" role="heading">{titles[section]}</T>
          {/* The same section as F1. */}
          <HelpButton topic={helpTopicFor({ name: 'settings', section }) ?? 'settings'} />
        </Row>
        {section === 'general' ? <General /> : null}
        {section === 'security' ? <Security /> : null}
        {section === 'backup' ? <Backup /> : null}
        {section === 'data' ? <Data /> : null}
        {section === 'calendar' ? (
          <>
            <AvailabilitySettings />
            <TypesSettings />
          </>
        ) : null}
        {section === 'privacy' ? <Privacy /> : null}
        {section === 'about' ? (
          <>
            <About />
            <Updates />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function General() {
  const { prefs, setPrefs } = useAppState();
  const { t } = useI18n();
  return (
    <Card style={{ gap: space.lg }}>
      <Col gap={space.xs}>
        <T variant="label" tone="secondary">{t('settings.language')}</T>
        <Segmented label={t('settings.language')} value={prefs.locale} onChange={(locale) => setPrefs({ locale })} options={UI_LOCALES.map((l) => ({ value: l, label: UI_LOCALE_META[l].nativeName }))} />
      </Col>
      <Col gap={space.xs}>
        <T variant="label" tone="secondary">{t('settings.theme')}</T>
        <Segmented<ThemeMode>
          label={t('settings.theme')}
          value={prefs.theme}
          onChange={(theme) => setPrefs({ theme })}
          options={(['system', 'light', 'dark'] as const).map((m) => ({ value: m, label: t(`settings.themes.${m}`) }))}
        />
      </Col>
      <Col gap={space.xs}>
        <T variant="label" tone="secondary">{t('settings.autoLock')}</T>
        <Segmented
          label={t('settings.autoLock')}
          value={String(prefs.autoLockMinutes) as '5'}
          onChange={(v) => setPrefs({ autoLockMinutes: Number(v) })}
          options={(['5', '10', '15', '30', '60'] as const).map((m) => ({ value: m, label: t(`settings.autoLockOptions.${m}`) }))}
        />
      </Col>
      <TimeZoneSetting />
    </Card>
  );
}

function Security() {
  const practice = usePractice();
  const { noteStopped } = useAppState();
  const backup = useBackup();
  const { t } = useI18n();
  const i18n = useI18n();
  const [current, setCurrent] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseConfirmed, setPhraseConfirmed] = useState(false);
  const [phraseBusy, setPhraseBusy] = useState(false);
  const [phraseFailed, setPhraseFailed] = useState(false);
  const [phraseDone, setPhraseDone] = useState(false);
  const phraseSlot = practice.currentKeyring.slots.find((s) => s.kind === 'recovery_phrase');
  // Locking waits for a new secret to be written, so the keyring never misses it. A change that
  // has started always finishes, even once this section has closed and locking no longer waits:
  // it works on a copy of the key taken when Change is pressed (practice.changePassphrase). If
  // Sala locked meanwhile, the unlock screen says whether it was saved (`noteStopped`).
  const job = useLockAwareJob({ limitMs: 20_000 });

  async function changePass() {
    if (busy || phraseBusy) return;
    if (passphraseError(pass, confirm, t)) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await job.run(() => practice.changePassphrase(current, pass));
      if (job.shouldStop()) return noteStopped({ kind: 'passphraseSaved' });
      setMessage({ tone: 'success', text: t('settings.passChanged') });
      setCurrent('');
      setPass('');
      setConfirm('');
      setShowErrors(false);
      // From now on, backups open with the new passphrase; make one at once.
      void backup.runNow();
    } catch (e) {
      if (e instanceof JobStopped) return;
      // Sala is locking or locked, so this message would never be seen: the unlock screen says it.
      if (job.shouldStop()) return noteStopped({ kind: 'passphraseNotSaved' });
      setMessage({ tone: 'danger', text: e instanceof WrongSecretError ? t('unlock.wrong') : t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  function closePhrase() {
    if (phraseBusy) return;
    setPhrase(null);
    setPhraseFailed(false);
  }

  async function savePhrase() {
    if (!phrase || !phraseConfirmed || phraseBusy || busy) return;
    setPhraseBusy(true);
    setPhraseFailed(false);
    setPhraseDone(false);
    try {
      await job.run(() => practice.changeSecret('recovery_phrase', phrase));
      if (job.shouldStop()) return noteStopped({ kind: 'phraseSaved' });
      setPhrase(null);
      setPhraseDone(true);
      void backup.runNow();
    } catch (e) {
      if (e instanceof JobStopped) return;
      console.error(e);
      setPhraseFailed(true);
    } finally {
      setPhraseBusy(false);
    }
  }

  return (
    <>
      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('settings.changePass')}</T>
        <Field label={t('settings.currentPass')} value={current} onChangeText={setCurrent} secureTextEntry />
        <PassphraseFields value={pass} confirm={confirm} onChange={setPass} onConfirm={setConfirm} label={t('settings.newPass')} showErrors={showErrors} />
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <Button variant="primary" label={t('settings.changePass')} busy={busy} disabled={!current || !pass || phraseBusy} onPress={() => void changePass()} style={{ alignSelf: 'flex-start' }} />
      </Card>
      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('settings.newPhrase')}</T>
        {phraseSlot ? <T variant="small" tone="muted">{t('settings.phraseCreated', { date: i18n.date(DateTime.fromISO(phraseSlot.created_at)) })}</T> : null}
        <T tone="secondary">{t('settings.newPhraseBody')}</T>
        {phraseDone ? <Notice tone="success">{t('settings.newPhraseDone')}</Notice> : null}
        {/* Not while a new passphrase is being saved: one change at a time. */}
        <Button label={t('settings.newPhrase')} disabled={busy} onPress={() => { setPhrase(newRecoveryPhrase()); setPhraseConfirmed(false); setPhraseFailed(false); setPhraseDone(false); }} style={{ alignSelf: 'flex-start' }} testID="new-phrase" />
      </Card>
      <Dialog
        visible={!!phrase}
        title={t('onboarding.phraseTitle')}
        onClose={closePhrase}
        onSubmit={phraseConfirmed && !phraseBusy ? () => void savePhrase() : undefined}
        width={640}
        testID="new-phrase-dialog"
        footer={
          <>
            <Button label={t('common.cancel')} onPress={closePhrase} disabled={phraseBusy} />
            <Button variant="primary" label={t('common.save')} busy={phraseBusy} disabled={!phraseConfirmed} onPress={() => void savePhrase()} testID="new-phrase-save" />
          </>
        }
      >
        <T tone="secondary">{t('onboarding.phraseBody')}</T>
        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {phrase?.split(' ').map((w, i) => (
            <View key={i} style={{ width: '31%', flexDirection: 'row', gap: space.sm }}>
              <T variant="small" tone="muted" style={{ width: 20, textAlign: 'right' }}>{i + 1}</T>
              <T variant="heading" selectable>{w}</T>
            </View>
          ))}
        </Card>
        <Checkbox checked={phraseConfirmed} onChange={setPhraseConfirmed} label={t('onboarding.phraseWritten')} />
        {phraseFailed ? <Notice tone="danger">{t('errors.generic')}</Notice> : null}
      </Dialog>
    </>
  );
}

function Backup() {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const backup = useBackup();
  const [history, setHistory] = useState<HistoryDays | null>(null);
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => void backupHistoryDays(practice.store).then(setHistory), [practice]);

  if (backup.disabled) {
    return (
      <Card style={{ gap: space.lg }}>
        <Notice tone="info" icon="backup">{t('settings.backupExampleBody')}</Notice>
      </Card>
    );
  }

  const s = backup.status;
  const last = s?.lastOk ? DateTime.fromISO(s.lastOk) : null;
  return (
    <Card style={{ gap: space.lg }}>
      <T tone="secondary">{t('settings.backupExplain')}</T>
      <Col gap={space.xs}>
        <T variant="label" tone="secondary">{t('settings.backupFolder')}</T>
        <Row>
          <T style={{ flex: 1 }} numberOfLines={1} selectable>{s?.folder ?? t('common.notSet')}</T>
          <Button
            small
            label={s?.folder ? t('common.change') : t('common.choose')}
            accessibilityLabel={`${s?.folder ? t('common.change') : t('common.choose')}: ${t('settings.backupFolder')}`}
            disabled={backup.running}
            onPress={() => void backup.chooseFolder().then((ok) => setResult(ok || null))}
            testID="choose-backup-folder"
          />
        </Row>
        <T variant="small" tone="muted">{t('settings.backupFolderHint')}</T>
      </Col>
      <Col gap={space.xs}>
        <T variant="label" tone="secondary">{t('settings.backupHistory')}</T>
        {history ? (
          <Segmented
            label={t('settings.backupHistory')}
            value={String(history) as '90'}
            onChange={(v) => {
              setHistory(Number(v) as HistoryDays);
              void practice.store.setMeta(META.backupHistory, v);
            }}
            options={HISTORY_DAYS.map((d) => ({ value: String(d) as '90', label: t(`settings.backupHistoryOptions.${String(d) as '90'}`) }))}
          />
        ) : null}
        <T variant="small" tone="muted">{t('settings.backupHistoryHint')}</T>
      </Col>
      <Divider />
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <T tone="secondary">{t('settings.backupLast', { when: last ? `${i18n.date(last)} ${i18n.time(last)}` : t('time.never') })}</T>
        <Button variant="primary" icon="backup" label={t('settings.backupNow')} busy={backup.running} disabled={!s?.folder} onPress={() => void backup.runNow().then(setResult)} testID="backup-now" />
      </Row>
      {s?.lastError ? (
        <Notice tone="danger" icon="backup" title={t('status.backupFailed')}>
          {backupErrorText(t, s.lastError.code)}
        </Notice>
      ) : null}
      {result === true && !s?.lastError ? <Notice tone="success">{t('today.backupDone')}</Notice> : null}
    </Card>
  );
}

function Data() {
  return (
    <>
      <RecentlyDeleted />
      <ExportCard />
      <ImportCard />
      <DangerZone />
    </>
  );
}

export function Privacy() {
  const i18n = useI18n();
  const { t } = i18n;
  const practice = usePractice();
  const [backupOn, setBackupOn] = useState(false);
  const loopOn = useLoopJoined();
  useEffect(() => void backupStatus(practice).then((s) => setBackupOn(!!s.folder)), [practice]);
  return (
    <Col gap={space.md}>
      <T tone="secondary">{t('privacy.intro')}</T>
      {FLOWS.map((f) => {
        const text = f.text[i18n.locale];
        const on = f.id === 'backup' ? backupOn : f.id === 'loop' ? !!loopOn : null;
        return (
          <Card key={f.id} style={{ gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="heading">{text.title}</T>
              {on !== null ? <Badge tone={on ? 'success' : 'neutral'} label={on ? t('privacy.active') : t('privacy.inactive')} /> : null}
            </Row>
            <Row align="flex-start"><T variant="label" tone="secondary" style={{ width: 150 }}>{t('privacy.when')}</T><T variant="small" style={{ flex: 1 }}>{text.when}</T></Row>
            <Row align="flex-start"><T variant="label" tone="secondary" style={{ width: 150 }}>{t('privacy.what')}</T><T variant="small" style={{ flex: 1 }}>{text.what}</T></Row>
            <Row align="flex-start"><T variant="label" tone="secondary" style={{ width: 150 }}>{t('privacy.who')}</T><T variant="small" style={{ flex: 1 }}>{text.who}</T></Row>
          </Card>
        );
      })}
      <Notice tone="success" icon="shield">{NO_NETWORK[i18n.locale]}</Notice>
    </Col>
  );
}

function About() {
  const { platform } = useAppState();
  const { t } = useI18n();
  const [info, setInfo] = useState<{ version: string; data_dir: string } | null>(null);
  useEffect(() => void platform.info().then(setInfo), [platform]);
  return (
    <Card style={{ gap: space.md }}>
      <T variant="heading">Sala</T>
      <T>{t('settings.version', { v: info?.version ?? '' })}</T>
      <T tone="secondary">{t('settings.licence')}</T>
      <T variant="small" tone="muted">{t('settings.credits')}</T>
      <Col gap={2}>
        <T variant="label" tone="secondary">{t('settings.dataFolder')}</T>
        <T variant="small" selectable>{info?.data_dir ?? ''}</T>
      </Col>
    </Card>
  );
}

/** Updates: an optional daily look at sala.thehumanloop.eu for a newer version, or one now. */
function Updates() {
  const { platform } = useAppState();
  const { t, date, time } = useI18n();
  const update = useKnownUpdate();
  const [auto, setAuto] = useState<boolean | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void platform.prefs.get().then((p) => {
      setAuto(p[UPDATE_PREFS.auto] === '1');
      setLast(p[UPDATE_PREFS.lastCheck] ?? null);
    });
  }, [platform, update]);

  async function checkNow() {
    setBusy(true);
    setFailed(false);
    try {
      await checkForUpdate(platform);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: space.md }}>
      <T variant="heading">{t('updates.title')}</T>
      {auto !== null ? (
        <Checkbox
          checked={auto}
          onChange={(on) => {
            setAuto(on);
            void setDailyCheck(platform, on).then(() => (on ? dailyCheck(platform) : null));
          }}
          label={t('updates.auto')}
          hint={t('updates.autoHint')}
          testID="updates-auto"
        />
      ) : null}
      <Row wrap>
        <Button icon="repeat" label={t('updates.checkNow')} busy={busy} onPress={() => void checkNow()} testID="updates-check" />
        {last ? <T variant="small" tone="muted">{t('updates.lastChecked', { when: `${date(DateTime.fromISO(last), 'medium')} ${time(DateTime.fromISO(last))}` })}</T> : null}
      </Row>
      {failed ? <Notice tone="warning">{t('updates.failed')}</Notice> : null}
      {update && !failed ? (
        update.newer ? (
          <Notice
            tone="info"
            title={t('updates.available', { v: update.latest })}
            action={<Button small variant="primary" icon="download" label={t('updates.download')} onPress={() => void platform.openLink(DOWNLOAD_PAGE)} testID="updates-download" />}
          >
            {t('updates.downloadHint')}
          </Notice>
        ) : (
          <Notice tone="success">{`${t('updates.upToDate')} ${t('updates.current', { v: update.current })}`}</Notice>
        )
      ) : null}
    </Card>
  );
}
