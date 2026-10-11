import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { DateTime } from 'luxon';
import { HelpButton } from '../../shell/HelpButton';
import { decodeText } from '../../core/bytes';
import { type CsvField, type CsvTable, guessMapping, parseCsv } from '../../core/import/csv';
import type { ImportPlan } from '../../core/import/plan';
import type { Folder } from '../../core/model/types';
import { baseName } from '../../core/text/mime';
import { discardJob, type ImportResult, runImport, saveJob, unfinishedJob } from '../../services/importer';
import { JobStopped } from '../../services/jobs';
import { practiceTimeZone } from '../../services/settings';
import { useAppState, useHold, useLockAwareJob, usePractice } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useI18n, type PluralKey } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Button, Card, Col, focusRing, Notice, Row, Screen, Segmented, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { CsvMapping } from './CsvMapping';
import type { OcrLanguage } from './engines';
import { planCsv, planFiles, planFolderTree, planIcs } from './planner';
import { Review } from './Review';

type Step =
  | { name: 'choose' }
  | { name: 'reading'; text: string }
  | { name: 'csv'; table: CsvTable; mapping: CsvField[]; source: string }
  | { name: 'review'; plan: ImportPlan }
  | { name: 'importing'; done: number; total: number }
  | { name: 'done'; result: ImportResult; plan: ImportPlan };

const DOC_FILTER = [{ name: 'Documents', extensions: ['docx', 'odt', 'rtf', 'txt', 'md', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff', 'doc', 'heic'] }];

export function ImportWizard() {
  const practice = usePractice();
  const { platform } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [lang, setLang] = useState<OcrLanguage>(i18n.locale === 'pt' ? 'por' : i18n.locale === 'es' ? 'spa' : 'eng');
  const [resume, setResume] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reading scans or writing hundreds of pages takes a while: Sala must not lock itself meanwhile.
  useHold(busy);
  // When Sala is locked anyway (Lock, Ctrl+L), the import stops after the item in hand and
  // before anything more is written, while the practice is still open. Continue import picks it up.
  const job = useLockAwareJob({ limitMs: 20_000 });

  useEffect(() => void unfinishedJob(practice).then(setResume), [practice]);

  // Folders an import can go into; one merged into another is reached through that one.
  const existing = async (): Promise<Folder[]> => (await practice.store.list('folder')).filter((f) => !f.merged_into);
  const status = (s: { key: 'reading' | 'recognising'; name: string; percent?: number }) =>
    setStep({ name: 'reading', text: s.key === 'reading' ? t('import.reading', { name: s.name }) : t('import.recognising', { name: s.name, n: s.percent ?? 0 }) });

  async function guarded(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(t('errors.fileRead'));
      setStep({ name: 'choose' });
    } finally {
      setBusy(false);
    }
  }

  const pickFolderTree = () =>
    guarded(async () => {
      const root = await platform.dialogs.pickFolder(t('import.folderTree'));
      if (!root) return;
      setStep({ name: 'reading', text: t('import.reading', { name: baseName(root) }) });
      setStep({ name: 'review', plan: await planFolderTree(platform, root, await existing(), lang, status) });
    });

  const pickFiles = () =>
    guarded(async () => {
      const paths = await platform.dialogs.pickFiles(t('import.files'), DOC_FILTER, true);
      if (!paths.length) return;
      setStep({ name: 'review', plan: await planFiles(platform, paths, await existing(), lang, status, t('import.newFolder')) });
    });

  const pickCsv = () =>
    guarded(async () => {
      const [path] = await platform.dialogs.pickFiles(t('import.csv'), [{ name: 'CSV', extensions: ['csv', 'txt'] }], false);
      if (!path) return;
      const table = parseCsv(decodeText(await platform.files.read(path)));
      setStep({ name: 'csv', table, mapping: guessMapping(table.header), source: path });
    });

  const pickIcs = () =>
    guarded(async () => {
      const [path] = await platform.dialogs.pickFiles(t('import.ics'), [{ name: 'iCalendar', extensions: ['ics'] }], false);
      if (!path) return;
      const plan = planIcs(decodeText(await platform.files.read(path)), await practiceTimeZone(practice.store), await existing(), path);
      setStep({ name: 'review', plan });
    });

  async function doImport(plan: ImportPlan) {
    if (job.shouldStop()) return;
    setBusy(true);
    try {
      const result = await job.run(async (shouldStop) => {
        await saveJob(practice, plan);
        setStep({ name: 'importing', done: 0, total: plan.items.filter((i) => i.include && !i.done).length });
        return runImport(practice, plan, {
          readFile: (p) => platform.files.read(p),
          onProgress: (done, total) => setStep({ name: 'importing', done, total }),
          startNote: (iso) => t('import.startNote', { date: i18n.date(DateTime.fromISO(iso), 'medium') }),
          shouldStop,
        });
      });
      // Items that failed stay in the plan, for Continue import later.
      setResume(result.failed.length ? plan : null);
      setStep({ name: 'done', result, plan });
    } catch (e) {
      // Sala is locking, or progress could not be saved (the disk is full): it can be continued later.
      if (!(e instanceof JobStopped)) {
        console.error(e);
        setError(t('errors.generic'));
      }
      setResume(plan);
      setStep({ name: 'choose' });
    } finally {
      setBusy(false);
    }
  }

  /** Back to review with what is left of a plan: an interrupted import, or items that failed. */
  const reopen = (plan: ImportPlan) => {
    setError(null);
    setStep({ name: 'review', plan: { ...plan, state: 'review' } });
  };

  return (
    <Screen title={t('import.title')} testID="screen-import" actions={<HelpButton topic="import" />}>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {step.name === 'choose' ? (
        <>
          <T tone="secondary" style={{ maxWidth: 720 }}>{t('import.intro')}</T>
          {resume ? (
            <Notice
              tone="warning"
              icon="import"
              action={
                <Row>
                  <Button small variant="primary" label={t('import.resumeButton')} onPress={() => reopen(resume)} testID="import-resume" />
                  <Button small label={t('import.discard')} onPress={() => void discardJob(practice, resume.id).then(() => setResume(null))} />
                </Row>
              }
            >
              {t('import.resume')}
            </Notice>
          ) : null}
          <T variant="label" tone="secondary">{t('import.sources')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <SourceCard icon="folder" title={t('import.folderTree')} body={t('import.folderTreeHint')} onPress={() => void pickFolderTree()} testID="import-folder-tree" />
            <SourceCard icon="page" title={t('import.files')} body={t('import.filesHint')} onPress={() => void pickFiles()} testID="import-files" />
            <SourceCard icon="shelf" title={t('import.csv')} body={t('import.csvHint')} onPress={() => void pickCsv()} testID="import-csv" />
            <SourceCard icon="calendar" title={t('import.ics')} body={t('import.icsHint')} onPress={() => void pickIcs()} testID="import-ics" />
            <SourceCard icon="backup" title={t('import.sala')} body={t('import.fromSala')} onPress={() => go({ name: 'settings', section: 'data' })} />
          </View>
          <Card style={{ gap: space.sm, maxWidth: 720 }}>
            <T variant="label" tone="secondary">{t('import.ocrLanguage')}</T>
            <Segmented<OcrLanguage>
              label={t('import.ocrLanguage')}
              value={lang}
              onChange={setLang}
              options={[
                { value: 'por', label: 'Português' },
                { value: 'spa', label: 'Español' },
                { value: 'eng', label: 'English' },
              ]}
            />
            <T variant="small" tone="muted">{t('import.handwritingNote')}</T>
          </Card>
        </>
      ) : null}

      {step.name === 'reading' ? (
        <Card style={{ alignItems: 'center', gap: space.md, padding: space.xxl }}>
          <ActivityIndicator />
          <T tone="secondary">{step.text}</T>
        </Card>
      ) : null}

      {step.name === 'csv' ? (
        <CsvMapping
          table={step.table}
          mapping={step.mapping}
          onChange={(mapping) => setStep({ ...step, mapping })}
          onBack={() => setStep({ name: 'choose' })}
          onNext={() => void existing().then((ex) => setStep({ name: 'review', plan: planCsv(step.table, step.mapping, ex, step.source) }))}
        />
      ) : null}

      {step.name === 'review' ? <Review key={step.plan.id} plan={step.plan} onBack={() => setStep({ name: 'choose' })} onImport={(p) => void doImport(p)} /> : null}

      {step.name === 'importing' ? (
        <Card style={{ gap: space.md, padding: space.xxl }}>
          <T>{t('import.importing', { done: step.done, total: step.total })}</T>
          <Progress value={step.total ? step.done / step.total : 0} />
        </Card>
      ) : null}

      {step.name === 'done' ? (
        <Done
          result={step.result}
          onShelf={() => go({ name: 'shelf' })}
          onCalendar={() => go({ name: 'calendar' })}
          onRetry={() => reopen(step.plan)}
          onStartOver={() => setStep({ name: 'choose' })}
        />
      ) : null}
    </Screen>
  );
}

const COUNTS: [keyof Omit<ImportResult, 'failed'>, PluralKey][] = [
  ['folders', 'import.counts.folders'],
  ['updated', 'import.counts.updated'],
  ['pages', 'import.counts.pages'],
  ['attachments', 'import.counts.documents'],
  ['appointments', 'import.counts.appointments'],
];

/** What came in, what did not and why, and where to go next. */
function Done({ result, onShelf, onCalendar, onRetry, onStartOver }: { result: ImportResult; onShelf: () => void; onCalendar: () => void; onRetry: () => void; onStartOver: () => void }) {
  const { t, tp } = useI18n();
  const counts = COUNTS.filter(([k]) => result[k] > 0).map(([k, key]) => tp(key, result[k]));
  const calendarFirst = result.appointments > 0;
  return (
    <Card style={{ gap: space.md }}>
      <Notice tone="success" title={t('import.done')}>{counts.length ? counts.join(' · ') : t('import.nothingImported')}</Notice>
      {result.failed.length ? (
        <Notice tone="warning" title={tp('import.failedTitle', result.failed.length)}>
          <Col gap={2}>
            {result.failed.map((f) => (
              <T key={f.id} variant="small">{`${f.name} — ${t(`import.failed.${f.reason}`)}`}</T>
            ))}
            <T variant="small" style={{ marginTop: space.xs }}>{t('import.failedLater')}</T>
          </Col>
        </Notice>
      ) : null}
      <Row wrap>
        {calendarFirst ? <Button variant="primary" icon="calendar" label={t('import.openCalendar')} onPress={onCalendar} testID="import-open-calendar" /> : null}
        <Button variant={calendarFirst ? 'secondary' : 'primary'} icon="shelf" label={t('import.openShelf')} onPress={onShelf} testID="import-open-shelf" />
        {result.failed.length ? <Button label={t('import.reviewFailed')} onPress={onRetry} testID="import-review-failed" /> : null}
        <Button variant="ghost" label={t('import.startOver')} onPress={onStartOver} />
      </Row>
    </Card>
  );
}

function SourceCard({ icon, title, body, onPress, testID }: { icon: IconName; title: string; body: string; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      style={(s) => [
        { width: 300, minHeight: 124, padding: space.lg, gap: space.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, backgroundColor: (s as { hovered?: boolean }).hovered ? c.surfaceAlt : c.surface },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <Icon name={icon} size={22} color={c.textSecondary} />
      <T variant="heading">{title}</T>
      <T variant="small" tone="secondary">{body}</T>
    </Pressable>
  );
}

function Progress({ value }: { value: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} style={{ height: 8, borderRadius: radius.pill, backgroundColor: c.surfaceSunken, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(value * 100)}%`, height: '100%', backgroundColor: c.accent }} />
    </View>
  );
}
