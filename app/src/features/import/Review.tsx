import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { DateTime } from 'luxon';
import { type ImportPlan, type PlannedFolder, type PlannedItem, type PlanSource, sameName } from '../../core/import/plan';
import { uuid } from '../../core/ids';
import { type Folder, FOLDER_LABEL_MAX } from '../../core/model/types';
import { type CsvDetails, type IcsDetails, saveJob } from '../../services/importer';
import { usePractice, useRegisterSaver } from '../../shell/AppState';
import { DateField } from '../../ui/DateField';
import { useI18n, type MessageKey } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Card, Checkbox, Col, Field, Notice, Row, Segmented, T } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';
import { useNow, usePracticeTz } from '../common/hooks';
import { FolderButton, FolderPickerDialog } from '../common/FolderPicker';
import { canInclude, fileEvent, normaliseDates } from './planner';

// The review step: nothing is written until Import. Shows what is still to do in the plan
// (a resumed import hides what is already in), with the folder each thing goes into.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** What kind of review a plan needs; plans saved before `source` existed are folder imports. */
export function planSource(plan: ImportPlan): PlanSource {
  if (plan.source) return plan.source;
  if (plan.items.length && plan.items.every((i) => i.kind === 'appointment')) return 'ics';
  if (plan.items.length && plan.items.every((i) => i.kind === 'folder')) return 'csv';
  return 'tree';
}

type Picking = { kind: 'item'; id: string } | { kind: 'folder'; key: string } | null;
type UpdateItem = (id: string, patch: Partial<PlannedItem>) => void;
type DateChange = (id: string, iso: string | null, valid: boolean) => void;

export function Review({ plan: initial, onBack, onImport }: { plan: ImportPlan; onBack: () => void; onImport: (p: ImportPlan) => void }) {
  const practice = usePractice();
  const { t, tp, locale } = useI18n();
  const today = useNow(usePracticeTz()).toISODate()!;
  const [plan, setPlan] = useState(() => normaliseDates(initial, locale, today));
  const [folders, setFolders] = useState<Folder[]>([]);
  const [unreadable, setUnreadable] = useState<ReadonlySet<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [picking, setPicking] = useState<Picking>(null);
  useEffect(() => void practice.store.list('folder').then(setFolders), [practice]);
  // A long read (hundreds of scans) and the choices made here survive a lock: Continue import
  // brings them back. Once Import is pressed, the import keeps the plan itself.
  const submitted = useRef(false);
  useRegisterSaver(() => (submitted.current ? undefined : saveJob(practice, { ...plan, state: 'review' })));
  const source = planSource(plan);

  const updateItem = useCallback<UpdateItem>((id, patch) => setPlan((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })), []);
  const updateFolder = useCallback((key: string, patch: Partial<PlannedFolder>) => setPlan((p) => ({ ...p, folders: p.folders.map((f) => (f.key === key ? { ...f, ...patch } : f)) })), []);
  const onDate = useCallback<DateChange>(
    (id, iso, valid) => {
      updateItem(id, { date: iso ?? '', dateSource: 'none' });
      setUnreadable((s) => {
        if (valid === !s.has(id)) return s;
        const next = new Set(s);
        if (valid) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [updateItem],
  );

  const folderByKey = useMemo(() => new Map(plan.folders.map((f) => [f.key, f])), [plan.folders]);
  const existingById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const pending = plan.items.filter((i) => !i.done);
  const doneCount = plan.items.length - pending.length;
  const included = pending.filter((i) => i.include && (i.folderKey === null || folderByKey.get(i.folderKey)?.include === true));

  // A new folder needs a name; a page needs a date. Both are checked before anything is written.
  const newFolderKeys = new Set(included.flatMap((i) => (i.folderKey && !folderByKey.get(i.folderKey)?.existingId ? [i.folderKey] : [])));
  const labelError = (f: PlannedFolder): string | null => {
    if (!showErrors || !newFolderKeys.has(f.key)) return null;
    return !f.label.trim() ? t('errors.required') : f.label.trim().length > FOLDER_LABEL_MAX ? t('folder.labelTooLong', { n: FOLDER_LABEL_MAX }) : null;
  };
  const problems =
    plan.folders.some((f) => newFolderKeys.has(f.key) && (!f.label.trim() || f.label.trim().length > FOLDER_LABEL_MAX)) ||
    included.some((i) => unreadable.has(i.id) || (i.kind === 'page' && !ISO_DATE.test(i.date)));

  const importNow = () => {
    if (problems) {
      setShowErrors(true);
      return;
    }
    submitted.current = true;
    onImport(plan);
  };

  const setAll = (include: boolean) =>
    setPlan((p) => ({
      ...p,
      // Calendar events and individual files have no folder ticks of their own.
      folders: source === 'ics' || source === 'files' ? p.folders : p.folders.map((f) => (f.created ? f : { ...f, include })),
      items: p.items.map((i) => (i.done || !canInclude(i) ? i : { ...i, include })),
    }));

  /** The planned folder for an existing folder, added to the plan when it has none yet. */
  const keyForFolder = (p: ImportPlan, folder: Folder): [ImportPlan, string] => {
    const found = p.folders.find((f) => f.existingId === folder.id);
    if (found) return [p, found.key];
    const key = uuid();
    return [{ ...p, folders: [...p.folders, { key, label: folder.label, existingId: folder.id, suggestedId: null, include: true }] }, key];
  };

  /** Files an event in a folder, with its series; other events of the same title get that folder as a suggestion. */
  const assign = (itemId: string, folder: Folder | null) =>
    setPlan((p) => {
      if (!folder) return fileEvent(p, itemId, null);
      const [next, key] = keyForFolder(p, folder);
      return fileEvent(next, itemId, key);
    });

  const pick = (id: string | null) => {
    const target = picking;
    setPicking(null);
    if (target?.kind === 'folder') updateFolder(target.key, { existingId: id });
    else if (target?.kind === 'item') assign(target.id, id ? (existingById.get(id) ?? null) : null);
  };

  const putIn = (item: PlannedItem) => {
    const id = item.suggestedFolderKey ? folderByKey.get(item.suggestedFolderKey)?.existingId : null;
    const folder = id ? existingById.get(id) : undefined;
    if (folder) assign(item.id, folder);
  };

  const pickingValue = picking?.kind === 'item'
    ? (folderByKey.get(plan.items.find((i) => i.id === picking.id)?.folderKey ?? '')?.existingId ?? null)
    : picking?.kind === 'folder'
      ? (folderByKey.get(picking.key)?.existingId ?? null)
      : null;

  return (
    <Col gap={space.lg}>
      <Notice tone="info" title={t('import.review')}>{t('import.reviewBody')}</Notice>
      <Row wrap style={{ justifyContent: 'space-between' }}>
        <T variant="small" tone="secondary">{doneCount ? tp('import.alreadyImported', doneCount) : ''}</T>
        <Row gap={space.xs}>
          <Button variant="ghost" small icon="check" label={t('import.selectAll')} onPress={() => setAll(true)} testID="import-select-all" />
          <Button variant="ghost" small label={t('import.selectNone')} onPress={() => setAll(false)} testID="import-select-none" />
        </Row>
      </Row>

      {source === 'ics' ? (
        <EventList plan={plan} pending={pending} folderByKey={folderByKey} existingById={existingById} updateItem={updateItem} onPick={(id) => setPicking({ kind: 'item', id })} onPutIn={putIn} />
      ) : source === 'csv' ? (
        <PatientList
          pending={pending} folderByKey={folderByKey} existingById={existingById} updateItem={updateItem} updateFolder={updateFolder} onDate={onDate}
          today={today} labelError={labelError}
        />
      ) : (
        plan.folders
          .filter((f) => pending.some((i) => i.folderKey === f.key))
          .map((f) => (
            <FolderCard
              key={f.key} folder={f} existing={f.existingId ? (existingById.get(f.existingId) ?? null) : null} suggested={f.suggestedId ? (existingById.get(f.suggestedId) ?? null) : null}
              items={pending.filter((i) => i.folderKey === f.key)} filesTarget={source === 'files'} updateFolder={updateFolder} updateItem={updateItem} onDate={onDate}
              onPickFolder={() => setPicking({ kind: 'folder', key: f.key })} today={today} showErrors={showErrors} labelError={labelError(f)}
            />
          ))
      )}

      {showErrors && problems ? <Notice tone="danger">{t('import.fixFirst')}</Notice> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" icon="chevronLeft" label={t('common.back')} onPress={onBack} />
        {included.length ? (
          <Button variant="primary" icon="import" label={tp('import.importButton', included.length)} onPress={importNow} testID="run-import" />
        ) : (
          <T tone="muted">{t('import.nothingToImport')}</T>
        )}
      </Row>
      <FolderPickerDialog visible={!!picking} folders={folders} value={pickingValue} allowNone={picking?.kind === 'item'} onPick={pick} onClose={() => setPicking(null)} />
    </Col>
  );
}

/** "Add to “Ana Silva”" or "Keep separate", both always there for a folder that looks like an existing one. */
function MergeChoice({ folder, suggested, onChange }: { folder: PlannedFolder; suggested: Folder; onChange: (existingId: string | null) => void }) {
  const { t } = useI18n();
  const exact = sameName(folder.label, suggested.label);
  return (
    <Row wrap gap={space.sm}>
      {exact ? null : <Badge tone="warning" label={t('import.possibleDuplicate', { name: suggested.label })} />}
      <Segmented
        label={t('import.folderChoice')}
        value={folder.existingId === suggested.id ? 'merge' : 'separate'}
        onChange={(v) => onChange(v === 'merge' ? suggested.id : null)}
        options={[
          { value: 'merge', label: t('import.mergeInto', { name: suggested.label }) },
          { value: 'separate', label: t('import.keepSeparate') },
        ]}
      />
    </Row>
  );
}

function FolderCard({
  folder: f, existing, suggested, items, filesTarget, updateFolder, updateItem, onDate, onPickFolder, today, showErrors, labelError,
}: {
  folder: PlannedFolder;
  existing: Folder | null;
  suggested: Folder | null;
  items: PlannedItem[];
  filesTarget: boolean;
  updateFolder: (key: string, patch: Partial<PlannedFolder>) => void;
  updateItem: UpdateItem;
  onDate: DateChange;
  onPickFolder: () => void;
  today: string;
  showErrors: boolean;
  labelError: string | null;
}) {
  const { t, tp } = useI18n();
  const { c } = useTheme();
  const nameField = (
    <Field
      value={f.label}
      onChangeText={(label) => updateFolder(f.key, { label })}
      accessibilityLabel={t('import.newFolderNamed')}
      maxLength={FOLDER_LABEL_MAX}
      error={labelError}
      style={{ flex: 1, minWidth: 240, maxWidth: 420 }}
      testID="import-folder-name"
    />
  );
  return (
    <Card style={{ gap: space.md }}>
      {filesTarget && !f.created ? (
        <Col gap={space.sm}>
          <T variant="label" tone="secondary">{t('import.targetFolder')}</T>
          <Segmented
            label={t('import.targetFolder')}
            value={f.existingId ? 'existing' : 'new'}
            onChange={(v) => (v === 'new' ? updateFolder(f.key, { existingId: null }) : onPickFolder())}
            options={[
              { value: 'new', label: t('import.newFolder') },
              { value: 'existing', label: t('import.existingChoice') },
            ]}
          />
          {f.existingId ? (
            <FolderButton folder={existing} placeholder={t('import.chooseFolder')} label={t('import.targetFolder')} onPress={onPickFolder} testID="import-target-folder" />
          ) : (
            <Row>{nameField}</Row>
          )}
        </Col>
      ) : (
        <>
          <Row wrap>
            {f.created ? null : <Checkbox checked={f.include} onChange={(include) => updateFolder(f.key, { include })} label={existing?.label ?? f.label} hideLabel testID="import-folder-include" />}
            <Icon name="folder" size={18} color={c.textSecondary} />
            {f.existingId ? <T variant="heading" style={{ flexShrink: 1 }}>{existing?.label ?? f.label}</T> : nameField}
          </Row>
          {suggested && !f.created && f.include ? <MergeChoice folder={f} suggested={suggested} onChange={(existingId) => updateFolder(f.key, { existingId })} /> : null}
        </>
      )}
      {f.include ? (
        items.map((item) => <ItemRow key={item.id} item={item} onChange={updateItem} onDate={onDate} today={today} showErrors={showErrors} />)
      ) : (
        <T variant="small" tone="muted">{tp('import.skippedItems', items.length)}</T>
      )}
    </Card>
  );
}

const WARNINGS: Record<string, MessageKey> = {
  heic: 'import.heic', docLegacy: 'import.docLegacy', unsupported: 'import.unsupported', tooLarge: 'import.tooLarge', tooBig: 'import.tooBig',
};

const ItemRow = memo(function ItemRow({ item, onChange, onDate, today, showErrors }: { item: PlannedItem; onChange: UpdateItem; onDate: DateChange; today: string; showErrors: boolean }) {
  const { t } = useI18n();
  const { c } = useTheme();
  const warning = item.warning && WARNINGS[item.warning] ? t(WARNINGS[item.warning]!, { name: item.name }) : null;
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: c.divider, paddingTop: space.sm, gap: space.xs }}>
      <Row wrap>
        {canInclude(item) ? <Checkbox checked={item.include} onChange={(include) => onChange(item.id, { include })} label={item.name} hideLabel /> : <View style={{ width: 20 }} />}
        <View>
          <Badge tone={item.kind === 'page' ? 'info' : 'neutral'} label={t(`import.item.${item.kind}`)} />
        </View>
        <T variant="small" tone={item.include ? 'primary' : 'secondary'} numberOfLines={1} style={{ flex: 1, minWidth: 180 }}>{item.name}</T>
        {item.kind === 'page' ? (
          <DateField
            label=""
            accessibilityLabel={`${t('import.detectedDate')}: ${item.name}`}
            value={item.date || null}
            today={today}
            required={item.include}
            showErrors={showErrors && item.include}
            onChange={(iso, valid) => onDate(item.id, iso, valid)}
            style={{ width: 150 }}
          />
        ) : null}
      </Row>
      {item.kind === 'page' && item.dateSource === 'file' ? <T variant="tiny" tone="accent">{`${t('import.detectedDate')}: ${t('import.dateFromFile')}`}</T> : null}
      {item.error ? <T variant="small" tone="danger">{t(`import.failed.${item.error}`)}</T> : null}
      {item.provenance === 'ocr' ? (
        <Notice tone="warning">{`${t('page.fromScan')} ${item.confidence !== null ? t('page.confidence', { n: Math.round(item.confidence) }) : ''}`}</Notice>
      ) : null}
      {item.kind === 'page' && item.text ? <T variant="tiny" tone="muted" numberOfLines={2}>{item.text.slice(0, 300)}</T> : null}
      {item.kind === 'page' && item.provenance !== 'ocr' ? (
        <Checkbox checked={item.keepOriginal} onChange={(keepOriginal) => onChange(item.id, { keepOriginal })} label={t('import.keepOriginals')} />
      ) : null}
      {warning ? <Notice tone="warning">{warning}</Notice> : null}
    </View>
  );
});

/** A patient list: one row per patient, each its own folder. */
function PatientList({
  pending, folderByKey, existingById, updateItem, updateFolder, onDate, today, labelError,
}: {
  pending: PlannedItem[];
  folderByKey: Map<string, PlannedFolder>;
  existingById: Map<string, Folder>;
  updateItem: UpdateItem;
  updateFolder: (key: string, patch: Partial<PlannedFolder>) => void;
  onDate: DateChange;
  today: string;
  labelError: (f: PlannedFolder) => string | null;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  return (
    <Card style={{ gap: space.sm }}>
      <Row style={{ paddingLeft: 30 }}>
        <T variant="label" tone="secondary" style={{ flex: 1 }}>{t('import.csvField.label')}</T>
        <T variant="label" tone="secondary" style={{ width: 150 }}>{t('import.csvField.start')}</T>
      </Row>
      {pending.map((item) => {
        const f = item.folderKey ? folderByKey.get(item.folderKey) : undefined;
        if (!f) return null;
        const existing = f.existingId ? existingById.get(f.existingId) : undefined;
        const suggested = f.suggestedId ? existingById.get(f.suggestedId) : undefined;
        const details = JSON.parse(item.text || '{}') as Partial<CsvDetails>;
        const on = item.include && f.include;
        const contact = [details.email, details.phone].filter(Boolean).join(' · ');
        return (
          <View key={item.id} style={{ borderTopWidth: 1, borderTopColor: c.divider, paddingTop: space.sm, gap: space.xs }}>
            <Row wrap align="flex-start">
              <View style={{ paddingTop: 10 }}>
                <Checkbox
                  checked={on}
                  onChange={(include) => {
                    updateFolder(f.key, { include });
                    updateItem(item.id, { include });
                  }}
                  label={item.name}
                  hideLabel
                  testID="import-patient-include"
                />
              </View>
              <Col gap={2} style={{ flex: 1, minWidth: 220 }}>
                {f.existingId ? (
                  <T variant="heading" style={{ paddingTop: 8 }}>{existing?.label ?? f.label}</T>
                ) : (
                  <Field value={f.label} onChangeText={(label) => updateFolder(f.key, { label })} accessibilityLabel={t('import.newFolderNamed')} maxLength={FOLDER_LABEL_MAX} error={on ? labelError(f) : null} style={{ maxWidth: 360 }} />
                )}
                {contact ? <T variant="small" tone="secondary" numberOfLines={1}>{contact}</T> : null}
              </Col>
              <DateField
                label=""
                accessibilityLabel={`${t('import.csvField.start')}: ${item.name}`}
                value={item.date || null}
                today={today}
                onChange={(iso, valid) => onDate(item.id, iso, valid)}
                style={{ width: 150 }}
              />
            </Row>
            <View style={{ paddingLeft: 30, gap: space.xs }}>
              {f.existingId && !on && existing && sameName(f.label, existing.label) ? <T variant="small" tone="muted">{t('import.csvExisting')}</T> : null}
              {suggested && !f.created && on ? (
                <MergeChoice folder={f} suggested={suggested} onChange={(existingId) => updateFolder(f.key, { existingId })} />
              ) : null}
              {item.warning === 'startUnread' && !item.date ? <T variant="small" tone="danger">{t('import.startUnread', { value: details.start ?? '' })}</T> : null}
              {item.error ? <T variant="small" tone="danger">{t(`import.failed.${item.error}`)}</T> : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** Calendar events in date order, each with the folder it goes into. */
function EventList({
  plan, pending, folderByKey, existingById, updateItem, onPick, onPutIn,
}: {
  plan: ImportPlan;
  pending: PlannedItem[];
  folderByKey: Map<string, PlannedFolder>;
  existingById: Map<string, Folder>;
  updateItem: UpdateItem;
  onPick: (itemId: string) => void;
  onPutIn: (item: PlannedItem) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const details = useMemo(() => new Map(plan.items.map((i) => [i.id, JSON.parse(i.text || '{}') as Partial<IcsDetails>])), [plan.items]);
  const rows = [...pending].sort((a, b) => `${a.date}T${a.time ?? ''}`.localeCompare(`${b.date}T${b.time ?? ''}`));
  const folderOf = (key: string | null | undefined) => {
    const id = key ? folderByKey.get(key)?.existingId : null;
    return id ? (existingById.get(id) ?? null) : null;
  };
  return (
    <Card style={{ gap: space.sm }}>
      {rows.map((item, index) => {
        const ev = details.get(item.id) ?? {};
        const folder = folderOf(item.folderKey);
        const suggested = item.folderKey ? null : folderOf(item.suggestedFolderKey);
        const repeat = [
          ev.repeatWeeks === 1 ? t('import.weekly') : ev.repeatWeeks === 2 ? t('import.fortnightly') : null,
          ev.repeatWeeks && ev.until ? t('import.until', { date: i18n.date(DateTime.fromISO(ev.until), 'medium') }) : null,
          ev.seriesItemId ? t('import.moved') : null,
        ].filter(Boolean).join(' · ');
        return (
          <View key={item.id} style={[{ gap: space.xs }, index > 0 && { borderTopWidth: 1, borderTopColor: c.divider, paddingTop: space.sm }]}>
            <Row wrap>
              <Checkbox checked={item.include} onChange={(include) => updateItem(item.id, { include })} label={`${item.name}, ${item.date} ${item.time ?? ''}`} hideLabel testID="import-event-include" />
              <T variant="small" tone="secondary" style={{ width: 150 }}>{`${i18n.date(DateTime.fromISO(item.date), 'medium')} · ${item.time ?? ''}`}</T>
              <Col gap={0} style={{ flex: 1, minWidth: 160 }}>
                <T variant="small" tone={item.include ? 'primary' : 'secondary'} numberOfLines={1}>{item.name}</T>
                {repeat ? <T variant="tiny" tone="muted">{repeat}</T> : null}
              </Col>
              <FolderButton folder={folder} placeholder={t('import.noFolder')} label={t('import.icsMatch')} onPress={() => onPick(item.id)} testID="import-event-folder" />
            </Row>
            {suggested ? (
              <Row wrap gap={space.sm} style={{ paddingLeft: 30 }}>
                <T variant="small" tone="secondary">
                  {item.suggestedBy === 'sameTitle'
                    ? t('import.sameTitleSuggestion', { title: item.name, name: suggested.label })
                    : t('import.possibleDuplicate', { name: suggested.label })}
                </T>
                <Button small label={t('import.putIn', { name: suggested.label })} onPress={() => onPutIn(item)} />
              </Row>
            ) : null}
            {item.warning === 'repeatUnsupported' ? <Notice tone="warning">{t('import.repeatUnsupported')}</Notice> : null}
            {item.error ? <T variant="small" tone="danger">{t(`import.failed.${item.error}`)}</T> : null}
          </View>
        );
      })}
    </Card>
  );
}
