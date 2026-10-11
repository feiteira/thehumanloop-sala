import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { DateTime, Info } from 'luxon';
import type { AvailabilityException, AvailabilityRule } from '../../core/model/types';
import { SETTING, setSetting, usualDuration } from '../../services/settings';
import { usePractice } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { DateField, TimeField } from '../../ui/DateField';
import { useI18n } from '../../ui/i18n';
import { Button, Card, Checkbox, Col, Field, IconButton, Row, Segmented, T } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { space } from '../../ui/theme';
import { useNow, usePracticeTz } from '../common/hooks';

export function AvailabilitySettings() {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const toast = useToast();
  const tz = usePracticeTz();
  const todayIso = useNow(tz).toISODate()!;
  const { data } = useLive(
    async (store) => ({
      rules: await store.list('availability'),
      exceptions: await store.list('availability_exception', { where: 'date >= ?', params: [todayIso], order: 'date' }),
    }),
    [todayIso],
    ['availability', 'availability_exception'],
  );
  const [weekday, setWeekday] = useState<string>('1');
  const [start, setStart] = useState<string | null>('09:00');
  const [end, setEnd] = useState<string | null>('13:00');
  const [exDate, setExDate] = useState<string | null>(null);
  const [exDateOk, setExDateOk] = useState(true);
  const [exKind, setExKind] = useState<'off' | 'extra'>('off');
  const [exStart, setExStart] = useState<string | null>(null);
  const [exEnd, setExEnd] = useState<string | null>(null);
  const [timesOk, setTimesOk] = useState({ start: true, end: true, exStart: true, exEnd: true });
  const days = Info.weekdays('long', { locale: i18n.meta.bcp47 });

  const byDay = (w: number) => (data?.rules ?? []).filter((r) => r.weekday === w).sort((a, b) => a.start.localeCompare(b.start));
  const hoursOrderError = start && end && start >= end ? t('calendar.endAfterStart') : null;
  const canAdd = !!start && !!end && timesOk.start && timesOk.end && !hoursOrderError;
  const exOrderError = exStart && exEnd && exStart >= exEnd ? t('calendar.endAfterStart') : null;
  const exTimesOk = timesOk.exStart && timesOk.exEnd && !exOrderError;
  const exValid = !!exDate && exDateOk && exTimesOk && (exKind === 'off' ? (!exStart && !exEnd) || (!!exStart && !!exEnd) : !!exStart && !!exEnd);

  async function removeRule(r: AvailabilityRule) {
    await practice.store.remove('availability', [r.id]);
    toast.undo(t('calendar.hoursRemoved'), () => practice.store.restore('availability', [r.id]));
  }
  async function removeException(e: AvailabilityException) {
    await practice.store.remove('availability_exception', [e.id]);
    toast.undo(t('calendar.exceptionRemoved'), () => practice.store.restore('availability_exception', [e.id]));
  }

  return (
    <>
      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('settings.availability')}</T>
        <T tone="secondary">{t('settings.availabilityBody')}</T>
        {days.map((name, i) => {
          const rules = byDay(i + 1);
          return (
            <Row key={name} align="center" style={{ minHeight: 32 }}>
              <T variant="label" style={{ width: 150 }}>{name}</T>
              <Row wrap style={{ flex: 1 }}>
                {rules.length === 0 ? <T variant="small" tone="muted">{t('calendar.noHours')}</T> : null}
                {rules.map((r) => (
                  <Row key={r.id} gap={2}>
                    <T variant="small">{`${r.start}–${r.end}`}</T>
                    <IconButton icon="close" size={28} label={t('calendar.removeHours', { day: name, from: r.start, to: r.end })} onPress={() => void removeRule(r)} />
                  </Row>
                ))}
              </Row>
            </Row>
          );
        })}
        <View style={{ gap: space.xs }}>
          <T variant="label" tone="secondary">{t('settings.addHours')}</T>
          <Segmented label={t('settings.addHours')} value={weekday} onChange={setWeekday} options={days.map((d, i) => ({ value: String(i + 1), label: d.slice(0, 3) }))} />
        </View>
        <Row wrap align="flex-start" gap={space.md}>
          <TimeField label={t('calendar.hoursFrom')} value={start} onChange={(v, ok) => { setStart(v); setTimesOk((o) => ({ ...o, start: ok })); }} required style={{ width: 100 }} testID="hours-from" />
          <TimeField label={t('calendar.hoursTo')} value={end} onChange={(v, ok) => { setEnd(v); setTimesOk((o) => ({ ...o, end: ok })); }} required error={hoursOrderError} style={{ width: 100 }} testID="hours-to" />
          <View style={{ paddingTop: 22 }}>
            <Button
              icon="plus"
              label={t('common.add')}
              disabled={!canAdd}
              onPress={() => void practice.store.put('availability', { weekday: Number(weekday) as AvailabilityRule['weekday'], start: start!, end: end! })}
              testID="add-hours"
            />
          </View>
        </Row>
      </Card>

      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('settings.exceptions')}</T>
        {data?.exceptions.map((e) => {
          const when = i18n.date(DateTime.fromISO(e.date, { zone: tz }), 'long');
          return (
            <Row key={e.id}>
              <T variant="small" style={{ width: 260 }}>{when}</T>
              <T variant="small" tone="secondary" style={{ flex: 1 }}>
                {e.kind === 'off' ? t('settings.dayOff') : t('settings.extraHours')}
                {e.start ? ` · ${e.start}–${e.end}` : ''}
              </T>
              <IconButton icon="close" size={28} label={t('calendar.removeException', { date: when })} onPress={() => void removeException(e)} />
            </Row>
          );
        })}
        <Segmented
          label={t('settings.exceptions')}
          value={exKind}
          onChange={setExKind}
          options={[
            { value: 'off', label: t('settings.dayOff') },
            { value: 'extra', label: t('settings.extraHours') },
          ]}
        />
        <Row wrap align="flex-start" gap={space.md}>
          <DateField label={t('appointment.date')} value={exDate} today={todayIso} onChange={(iso, ok) => { setExDate(iso); setExDateOk(ok); }} style={{ width: 160 }} testID="exception-date" />
          <TimeField label={t('calendar.hoursFrom')} value={exStart} placeholder={exKind === 'off' ? t('common.optional') : undefined} onChange={(v, ok) => { setExStart(v); setTimesOk((o) => ({ ...o, exStart: ok })); }} required={exKind === 'extra'} style={{ width: 100 }} />
          <TimeField label={t('calendar.hoursTo')} value={exEnd} placeholder={exKind === 'off' ? t('common.optional') : undefined} onChange={(v, ok) => { setExEnd(v); setTimesOk((o) => ({ ...o, exEnd: ok })); }} required={exKind === 'extra'} error={exOrderError} style={{ width: 100 }} />
          <View style={{ paddingTop: 22 }}>
            <Button
              icon="plus"
              label={t('common.add')}
              disabled={!exValid}
              onPress={() =>
                void practice.store.put('availability_exception', { date: exDate!, kind: exKind, start: exStart || null, end: exEnd || null }).then(() => {
                  setExDate(null);
                  setExStart(null);
                  setExEnd(null);
                })
              }
              testID="add-exception"
            />
          </View>
        </Row>
      </Card>
    </>
  );
}

/** Usual session length, then the appointment types. */
export function TypesSettings() {
  const practice = usePractice();
  const { t } = useI18n();
  const toast = useToast();
  const { data } = useLive(
    async (store) => ({
      types: await store.list('appointment_type', { order: 'created_at' }),
      usual: await usualDuration(store),
    }),
    [],
    ['appointment_type', 'setting'],
  );
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('50');
  const [forNew, setForNew] = useState(false);
  const [usualText, setUsualText] = useState<string | null>(null);
  const dur = Number(duration);
  const usualShown = usualText ?? (data ? String(data.usual) : '');
  const usualNumber = Number(usualShown);
  const usualOk = /^\d+$/.test(usualShown) && usualNumber > 0 && usualNumber <= 1440;

  // A new type starts at the usual length.
  useEffect(() => {
    if (data) setDuration(String(data.usual));
  }, [data?.usual]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeType(id: string) {
    await practice.store.remove('appointment_type', [id]);
    toast.undo(t('calendar.typeDeleted'), () => practice.store.restore('appointment_type', [id]));
  }

  return (
    <>
      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('calendar.sessionLength')}</T>
        <T tone="secondary">{t('calendar.sessionLengthBody')}</T>
        <Field
          label={t('appointment.duration')}
          value={usualShown}
          onChangeText={(v) => {
            const text = v.replace(/\D/g, '').slice(0, 4);
            setUsualText(text);
            const n = Number(text);
            if (text && n > 0 && n <= 1440) void setSetting(practice.store, SETTING.defaultDuration, n);
          }}
          onBlur={() => setUsualText(null)}
          keyboardType="number-pad"
          error={usualText !== null && !usualOk ? t('errors.required') : null}
          style={{ width: 160 }}
          testID="usual-duration"
        />
      </Card>
      <Card style={{ gap: space.md }}>
        <T variant="heading" role="heading">{t('settings.types')}</T>
        <T tone="secondary">{t('settings.typesBody')}</T>
        {data?.types.map((ty) => (
          <Row key={ty.id}>
            <T style={{ flex: 1 }}>{ty.name}</T>
            <T variant="small" tone="secondary">{t('common.minutes', { n: ty.duration_min })}</T>
            {ty.for_new_patients ? <T variant="tiny" tone="accent">{t('settings.forNewPatients')}</T> : null}
            <IconButton icon="trash" size={28} label={t('calendar.deleteType', { name: ty.name })} onPress={() => void removeType(ty.id)} />
          </Row>
        ))}
        <Col gap={space.sm}>
          <Row wrap align="flex-start" gap={space.md}>
            <Field label={t('settings.typeName')} value={name} onChangeText={setName} style={{ flex: 1, minWidth: 200 }} testID="type-name" />
            <Field label={t('appointment.duration')} value={duration} onChangeText={(v) => setDuration(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" style={{ width: 120 }} />
          </Row>
          <Checkbox checked={forNew} onChange={setForNew} label={t('settings.forNewPatients')} />
          <Button
            icon="plus"
            label={t('settings.addType')}
            disabled={!name.trim() || !(dur > 0 && dur <= 1440)}
            style={{ alignSelf: 'flex-start' }}
            onPress={() =>
              void practice.store.put('appointment_type', { name, duration_min: dur, colour: 'teal', for_new_patients: forNew, archived: false }).then(() => {
                setName('');
                setForNew(false);
              })
            }
          />
        </Col>
      </Card>
    </>
  );
}
