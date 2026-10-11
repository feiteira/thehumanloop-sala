import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DateTime } from 'luxon';
import { conflictsFor, outsideWorkingHours, type Clash } from '../../core/calendar/booking';
import {
  changedFields, deleteScopes, editEveryDate, firstDateOf, formOf, fromForm, scopesFor, type AppointmentForm, type SeriesScope,
} from '../../core/calendar/series';
import type { Appointment, AppointmentStatus, Folder } from '../../core/model/types';
import { ValidationError } from '../../core/model/validate';
import { addDays, formatLocalDate } from '../../core/text/dates';
import { appointmentsBetween } from '../../services/queries';
import { deleteSeriesDates, saveSeriesEdit } from '../../services/seriesEdits';
import { usualDuration } from '../../services/settings';
import { usePractice } from '../../shell/AppState';
import { type Route, useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { DateField, TimeField } from '../../ui/DateField';
import { useI18n } from '../../ui/i18n';
import { Button, type ChoiceItemProps, Col, Dialog, Field, focusRing, Notice, Row, Segmented, T, useChoiceGroup, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { useNow, usePracticeTz } from '../common/hooks';
import { findOrCreatePageFor } from '../folder/pageActions';
import { FolderButton, FolderPickerDialog } from '../common/FolderPicker';
import { SeriesScopeDialog } from './SeriesScopeDialog';

type RepeatChoice = 'none' | '1' | '2';
const WHEN: (keyof AppointmentForm)[] = ['date', 'time', 'duration_min', 'interval'];

const emptyForm: AppointmentForm = {
  folder_id: null, title: '', type_id: null, date: '', time: '', duration_min: 50, interval: null, until: null, location: '', status: 'confirmed', note: '',
};

export function AppointmentDialog({
  visible, onClose, appointment, occurrenceDate, defaults,
}: {
  visible: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  /** For an occurrence of a series: which date was clicked. */
  occurrenceDate?: string;
  /**
   * For a new appointment. Callers pass a memoised object; the fields reset when its values
   * change (not merely its identity) or when the dialog opens.
   */
  defaults?: { folderId?: string | null; start?: DateTime; durationMin?: number; typeId?: string | null; location?: string };
}) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t, tp, locale } = i18n;
  const toast = useToast();
  const { route, go, replace } = useRouter();
  // Opened from inside the same folder, a move replaces the route so Back still leaves the folder.
  const openFolder = (to: Extract<Route, { name: 'folder' }>) => (route.name === 'folder' && route.id === to.id ? replace(to) : go(to));
  const tz = usePracticeTz();
  const todayIso = useNow(tz).toISODate()!;
  // Read only while open: several screens keep a closed dialog mounted.
  const { data: ctx } = useLive(
    async (store) =>
      visible
        ? {
            folders: await store.list('folder'),
            types: await store.list('appointment_type', { order: 'created_at' }),
            usual: await usualDuration(store),
            rules: await store.list('availability'),
            exceptions: await store.list('availability_exception'),
          }
        : null,
    [visible],
    ['folder', 'appointment_type', 'setting', 'availability', 'availability_exception'],
  );

  const [form, setForm] = useState<AppointmentForm>(emptyForm);
  const [initial, setInitial] = useState<AppointmentForm>(emptyForm);
  const [durationText, setDurationText] = useState('50');
  const [ok, setOk] = useState({ date: true, time: true, until: true });
  const [showErrors, setShowErrors] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ mode: 'save' | 'delete'; scopes: SeriesScope[] } | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const set = <K extends keyof AppointmentForm>(key: K, value: AppointmentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const usual = ctx?.usual;
  const defaultsKey = defaults
    ? [defaults.folderId ?? '', defaults.start?.toMillis() ?? '', defaults.durationMin ?? '', defaults.typeId ?? '', defaults.location ?? ''].join('|')
    : '';
  useEffect(() => {
    if (!visible) return;
    let f: AppointmentForm;
    if (appointment) {
      f = formOf(appointment, occurrenceDate ?? firstDateOf(appointment));
    } else {
      const start = (defaults?.start ?? DateTime.now().plus({ hours: 1 }).startOf('hour')).setZone(tz);
      f = {
        ...emptyForm,
        folder_id: defaults?.folderId ?? null,
        type_id: defaults?.typeId ?? null,
        date: start.toISODate()!,
        time: start.toFormat('HH:mm'),
        duration_min: defaults?.durationMin ?? usual ?? 50,
        location: defaults?.location ?? '',
      };
    }
    setForm(f);
    setInitial(f);
    setDurationText(String(f.duration_min));
    setOk({ date: true, time: true, until: true });
    setShowErrors(false);
    setFailure(null);
    setAsk(null);
    setPickingFolder(false);
    // Keyed on values, not identities: a caller that rebuilds `defaults` or reloads the
    // appointment without changing it must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, appointment?.id, appointment?.updated_at_hlc, occurrenceDate, defaultsKey, tz, usual]);

  const series = appointment?.repeat ? appointment : null;
  const onSeriesDate = !!(series && occurrenceDate);
  const dur = Number(durationText);
  const durOk = /^\d+$/.test(durationText) && dur > 0 && dur <= 1440;
  const current: AppointmentForm = { ...form, duration_min: durOk ? dur : form.duration_min, until: form.interval ? form.until : null };
  const changed = changedFields(initial, current);
  // An end date the therapist left alone moves with the dates (see `series.ts`), so only a
  // new end date is checked against the date.
  const untilChecked = !series || changed.includes('until');
  const untilError = untilChecked && form.interval && form.until && form.date && form.until < form.date ? t('appointment.untilBefore', { date: formatLocalDate(form.date, locale) }) : null;
  const titleMissing = form.folder_id === null && !form.title.trim();
  const valid = ok.date && !!form.date && ok.time && !!form.time && durOk && !titleMissing && (!form.interval || (ok.until && !untilError));
  const dateLabel = (iso: string) => i18n.date(DateTime.fromISO(iso, { zone: appointment?.tz ?? tz }), 'weekday');

  // Nearby appointments, for clashes on this date or the next dates of a series.
  const { data: nearby } = useLive(
    async (store) => (visible && form.date ? appointmentsBetween(store, addDays(form.date, -1), addDays(form.date, 7 * 26)) : []),
    [visible, form.date],
    ['appointment'],
  );
  const folderById = useMemo(() => new Map((ctx?.folders ?? []).map((f) => [f.id, f])), [ctx?.folders]);
  const warnings = useMemo(() => {
    if (!visible || !ctx || !nearby || !form.date || !form.time || !ok.date || !ok.time || !durOk) return [];
    if (appointment && !changed.some((f) => WHEN.includes(f))) return [];
    const zone = appointment?.tz ?? tz;
    const start = DateTime.fromISO(`${form.date}T${form.time}`, { zone });
    if (!start.isValid) return [];
    // A changed date of a series is checked on its own unless its repeat changes too.
    const asSeries = !!form.interval && (!onSeriesDate || changed.includes('interval'));
    const clashes = conflictsFor(
      {
        start,
        durationMin: dur,
        repeat: asSeries && form.interval ? { interval_weeks: form.interval, until: form.until } : null,
        ignoreIds: appointment && (!onSeriesDate || asSeries) ? [appointment.id] : [],
        ignoreOccurrences: appointment && onSeriesDate && !asSeries && occurrenceDate ? [{ id: appointment.id, date: occurrenceDate }] : [],
      },
      nearby,
    );
    const out: string[] = [];
    const describe = (c: Clash) => {
      const a = c.with.appointment;
      const who = (a.folder_id ? folderById.get(a.folder_id)?.label : null) ?? a.title;
      return `${who}, ${i18n.time(c.with.start.setZone(zone))}–${i18n.time(c.with.end.setZone(zone))}`;
    };
    const firstClash = clashes[0];
    if (firstClash) {
      if (!asSeries) out.push(t('appointment.conflict', { other: describe(firstClash) }));
      else {
        const dates = new Set(clashes.map((c) => c.date)).size;
        out.push(tp('appointment.conflictSeries', dates, { first: t('appointment.conflictOn', { date: i18n.date(firstClash.start, 'weekday'), other: describe(firstClash) }) }));
      }
    }
    const hours = outsideWorkingHours(start.setZone(tz), dur, ctx.rules, ctx.exceptions);
    if (hours) out.push(t(hours === 'off' ? 'appointment.dayOff' : 'appointment.outsideHours'));
    return out;
    // `changed` follows `form`, `initial` and the duration text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ctx, nearby, form, initial, durationText, ok, appointment, onSeriesDate, occurrenceDate, tz, folderById, i18n]);

  /** Runs a write; a refused one keeps the dialog open with a message instead of failing silently. */
  async function attempt(write: () => Promise<unknown>): Promise<boolean> {
    setFailure(null);
    try {
      await write();
      return true;
    } catch (e) {
      console.error(e);
      setFailure(e instanceof ValidationError && e.field === 'repeat.until' ? t('appointment.untilBefore', { date: formatLocalDate(form.date, locale) }) : t('errors.generic'));
      return false;
    }
  }
  /** Every appointment, deleted ones too: they still link the parts of a series. */
  const allAppointments = () => practice.store.list('appointment', { includeDeleted: true });

  async function save() {
    if (!valid) {
      setShowErrors(true);
      return;
    }
    if (!appointment) {
      if (await attempt(() => practice.store.put('appointment', fromForm(current, tz)))) onClose();
      return;
    }
    if (changed.length === 0) return onClose();
    if (!series || !occurrenceDate) {
      if (await attempt(() => practice.store.put('appointment', editEveryDate(appointment, firstDateOf(appointment), current)))) onClose();
      return;
    }
    const scopes = scopesFor(series, occurrenceDate, changed, current);
    if (scopes.length === 1) await applyEdit(scopes[0]!);
    else setAsk({ mode: 'save', scopes });
  }

  async function applyEdit(scope: SeriesScope) {
    if (!series?.repeat || !occurrenceDate) return;
    const date = occurrenceDate;
    const result: { undo?: (() => Promise<void>) | null } = {};
    const done = await attempt(async () => {
      result.undo = await saveSeriesEdit(practice.store, series, date, current, scope);
    });
    setAsk(null);
    if (!done) return;
    onClose();
    // Undo only where changing the fields back would not put it right (see `saveSeriesEdit`).
    if (!result.undo) return;
    const newFolder = current.folder_id ? folderById.get(current.folder_id) : undefined;
    const message =
      current.interval === null
        ? t('appointment.repeatStopped', { date: dateLabel(date) })
        : newFolder
          ? t('appointment.movedTo', { name: newFolder.label })
          : t('appointment.movedOut');
    toast.undo(message, result.undo);
  }

  async function remove() {
    if (!appointment) return;
    if (series) {
      if (!occurrenceDate) return setAsk({ mode: 'delete', scopes: ['all'] });
      const scopes: SeriesScope[] = [];
      const read = await attempt(async () => {
        scopes.push(...deleteScopes(series, occurrenceDate, await allAppointments()));
      });
      if (!read) return;
      // The only date left is deleted like a single appointment, with Undo.
      if (scopes.length === 1) return void applyDelete('all', t('appointment.deleted'));
      return setAsk({ mode: 'delete', scopes });
    }
    const id = appointment.id;
    if (await attempt(() => practice.store.remove('appointment', [id]))) {
      onClose();
      toast.undo(t('appointment.deleted'), () => practice.store.restore('appointment', [id]));
    }
  }

  async function applyDelete(scope: SeriesScope, message?: string) {
    if (!series) return;
    const date = occurrenceDate ?? firstDateOf(series);
    const result: { undo?: () => Promise<void> } = {};
    const done = await attempt(async () => {
      result.undo = await deleteSeriesDates(practice.store, series, date, scope);
    });
    setAsk(null);
    const { undo } = result;
    if (!done || !undo) return;
    onClose();
    const text = message ?? (scope === 'one' ? t('appointment.dateRemoved') : scope === 'following' ? t('appointment.seriesEnded', { date: dateLabel(date) }) : t('appointment.seriesDeleted'));
    toast.undo(text, undo);
  }

  /**
   * The page of the session as booked (not as the unsaved fields read now), the same one Today's
   * Write note opens: the fields are wall-clock in the appointment's zone, the page is dated in
   * the practice's.
   */
  async function writePage(folder: Folder) {
    await attempt(async () => {
      const start = DateTime.fromISO(`${initial.date}T${initial.time}`, { zone: appointment?.tz ?? tz });
      const { page } = await findOrCreatePageFor(practice.store, folder.id, { start, tz, duration: initial.duration_min });
      onClose();
      openFolder({ name: 'folder', id: folder.id, tab: 'pages', pageId: page.id });
    });
  }

  const folder = form.folder_id ? folderById.get(form.folder_id) : undefined;
  // Open folder and Write session page act on the session as booked, not on an unsaved folder.
  const bookedFolder = appointment?.folder_id ? folderById.get(appointment.folder_id) : undefined;
  // On the first date of a later part, a hand-over with Every date gives this date and the
  // following ones (`withFamily`): the dialog says so.
  const handOverFromHere = !!series?.series_id && !!occurrenceDate && occurrenceDate <= firstDateOf(series) && form.folder_id !== series.folder_id;
  const types = (ctx?.types ?? []).filter((x) => !x.archived || x.id === form.type_id);
  const repeat: RepeatChoice = form.interval ? (String(form.interval) as RepeatChoice) : 'none';

  return (
    <Dialog
      visible={visible}
      title={appointment ? t('appointment.editTitle') : t('appointment.newTitle')}
      onClose={onClose}
      onSubmit={ask ? undefined : () => void save()}
      width={620}
      testID="appointment-dialog"
      footer={
        <>
          {appointment ? <Button variant="ghost" icon="trash" label={t('common.delete')} accessibilityLabel={t('appointment.delete')} onPress={() => void remove()} testID="delete-appointment" /> : null}
          <View style={{ flex: 1 }} />
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={t('common.save')} onPress={() => void save()} testID="save-appointment" />
        </>
      }
    >
      <Col gap={space.md}>
        {onSeriesDate ? (
          <Notice tone="info" icon="repeat">
            {t('appointment.occurrenceOf')}
          </Notice>
        ) : null}
        {failure ? <Notice tone="danger">{failure}</Notice> : null}

        <View style={{ gap: space.xs }}>
          <T variant="label" tone="secondary">{t('appointment.folder')}</T>
          <FolderButton
            folder={folder && folder.status === 'archived' ? { ...folder, label: t('appointment.archivedFolder', { label: folder.label }) } : (folder ?? null)}
            placeholder={t('appointment.noFolder')}
            label={t('appointment.folder')}
            onPress={() => setPickingFolder(true)}
            testID="folder-select"
          />
        </View>
        <FolderPickerDialog
          visible={visible && pickingFolder}
          folders={ctx?.folders ?? []}
          value={form.folder_id}
          allowNone
          title={t('appointment.chooseFolder')}
          noneLabel={t('appointment.noFolder')}
          onPick={(id) => {
            set('folder_id', id);
            setPickingFolder(false);
          }}
          onClose={() => setPickingFolder(false)}
        />
        {form.folder_id === null ? (
          <Field label={t('appointment.title')} value={form.title} onChangeText={(v) => set('title', v)} error={showErrors && titleMissing ? t('errors.required') : null} testID="appointment-title" />
        ) : null}

        {types.length ? (
          <TypeChoice
            types={types}
            value={form.type_id}
            onChange={(id, minutes) => {
              setForm((f) => ({ ...f, type_id: id, duration_min: minutes ?? f.duration_min }));
              if (minutes) setDurationText(String(minutes));
            }}
          />
        ) : null}

        <Row gap={space.md} align="flex-start" wrap>
          <DateField
            label={t('appointment.date')}
            value={form.date || null}
            today={todayIso}
            required
            showErrors={showErrors}
            onChange={(iso, valid) => {
              setOk((o) => ({ ...o, date: valid }));
              if (iso) set('date', iso);
              else if (valid) set('date', '');
            }}
            style={{ width: 160 }}
            testID="appointment-date"
          />
          <TimeField
            label={t('appointment.start')}
            value={form.time || null}
            required
            showErrors={showErrors}
            onChange={(time, valid) => {
              setOk((o) => ({ ...o, time: valid }));
              if (time) set('time', time);
              else if (valid) set('time', '');
            }}
            style={{ width: 110 }}
            testID="appointment-time"
          />
          <Field
            label={t('appointment.duration')}
            value={durationText}
            onChangeText={(v) => setDurationText(v.replace(/\D/g, '').slice(0, 4))}
            style={{ width: 120 }}
            keyboardType="number-pad"
            error={showErrors && !durOk ? t('errors.required') : null}
            testID="appointment-duration"
          />
        </Row>
        <View aria-live="polite" testID="appointment-warnings">
          {warnings.length ? <Notice tone="warning">{warnings.join(' ')}</Notice> : null}
        </View>

        <Row gap={space.md} align="flex-start" wrap>
          <View style={{ gap: space.xs }}>
            <T variant="label" tone="secondary">{t('appointment.repeat')}</T>
            <Segmented<RepeatChoice>
              label={t('appointment.repeat')}
              value={repeat}
              onChange={(v) => {
                set('interval', v === 'none' ? null : (Number(v) as 1 | 2));
                // The Until field starts again from the last valid end date (or none).
                setOk((o) => ({ ...o, until: true }));
              }}
              options={[
                { value: 'none', label: t('appointment.repeatNone') },
                { value: '1', label: t('appointment.repeatWeekly') },
                { value: '2', label: t('appointment.repeatFortnightly') },
              ]}
            />
          </View>
          {form.interval ? (
            <DateField
              label={t('appointment.until')}
              value={form.until}
              today={todayIso}
              showErrors={showErrors}
              error={untilError}
              onChange={(iso, valid) => {
                setOk((o) => ({ ...o, until: valid }));
                set('until', iso);
              }}
              style={{ width: 160 }}
              testID="appointment-until"
            />
          ) : null}
        </Row>
        {form.interval ? (
          <T variant="small" tone="muted" style={{ marginTop: -space.sm }}>{t('appointment.untilHint')}</T>
        ) : onSeriesDate ? (
          <T variant="small" tone="secondary" style={{ marginTop: -space.sm }}>{t('appointment.stopRepeatHint')}</T>
        ) : null}

        <Field label={t('appointment.location')} value={form.location} onChangeText={(v) => set('location', v)} testID="appointment-location" />
        <View style={{ gap: space.xs }}>
          <T variant="label" tone="secondary">{t('appointment.status')}</T>
          <Segmented<AppointmentStatus>
            label={t('appointment.status')}
            value={form.status}
            onChange={(v) => set('status', v)}
            options={(['proposed', 'confirmed', 'done', 'cancelled'] as const).map((s) => ({ value: s, label: t(`appointment.statuses.${s}`) }))}
          />
        </View>
        <Field label={t('appointment.note')} value={form.note} onChangeText={(v) => set('note', v)} autoGrow minHeight={60} maxHeight={240} />

        {appointment && bookedFolder ? (
          <Row wrap>
            <Button small icon="folder" label={t('appointment.openFolder')} onPress={() => { onClose(); openFolder({ name: 'folder', id: bookedFolder.id, tab: 'calendar' }); }} />
            <Button small icon="page" label={t('appointment.writePage')} onPress={() => void writePage(bookedFolder)} />
          </Row>
        ) : null}
      </Col>
      <SeriesScopeDialog
        visible={!!ask}
        mode={ask?.mode ?? 'save'}
        scopes={ask?.scopes ?? []}
        dateLabel={dateLabel(occurrenceDate ?? (series ? firstDateOf(series) : form.date || todayIso))}
        allFromHere={handOverFromHere}
        onChoose={(scope) => (ask?.mode === 'delete' ? applyDelete(scope) : applyEdit(scope))}
        onClose={() => setAsk(null)}
      />
    </Dialog>
  );
}

/** The appointment types as one row of choices; picking one sets its length. */
function TypeChoice({
  types, value, onChange,
}: {
  types: { id: string; name: string; duration_min: number }[];
  value: string | null;
  onChange: (id: string | null, minutes: number | null) => void;
}) {
  const { t } = useI18n();
  const options = [{ id: null as string | null, name: t('appointment.noType'), duration_min: null as number | null }, ...types];
  const group = useChoiceGroup<string | null>({
    values: options.map((o) => o.id),
    value,
    onChange: (id) => onChange(id, options.find((o) => o.id === id)?.duration_min ?? null),
  });
  return (
    <View style={{ gap: space.xs }}>
      <T variant="label" tone="secondary">{t('appointment.type')}</T>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('appointment.type')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        {options.map((ty) => (
          <Chip key={ty.id ?? 'none'} item={group.item(ty.id)} label={ty.duration_min ? `${ty.name} · ${t('common.minutes', { n: ty.duration_min })}` : ty.name} active={value === ty.id} />
        ))}
      </View>
    </View>
  );
}

function Chip({ label, active, item }: { label: string; active: boolean; item: ChoiceItemProps }) {
  const { c } = useTheme();
  return (
    <Pressable
      {...item}
      accessibilityLabel={label}
      style={(s) => [
        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primarySubtle : 'transparent' },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <T variant="small" tone={active ? 'primary' : 'secondary'} style={active ? { fontWeight: '600' } : undefined}>{label}</T>
    </Pressable>
  );
}

