import React, { type ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DateTime } from 'luxon';
import { bookingDefaults } from '../../core/calendar/booking';
import { type Occurrence, occurrencesIn } from '../../core/calendar/occurrences';
import { isMoved } from '../../core/calendar/series';
import type { Appointment } from '../../core/model/types';
import { usualDuration } from '../../services/settings';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Card, focusRing, Row, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { AppointmentDialog } from '../calendar/AppointmentDialog';
import { usePracticeTz, useNow } from '../common/hooks';

const FIRST_UPCOMING = 6;
const FIRST_PAST = 12;

/** The Calendar divider: the folder's coming sessions and its whole history, with the next one to book. */
export function FolderCalendar({ folderId }: { folderId: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const [dialog, setDialog] = useState<{ open: boolean; appt: Appointment | null; date?: string }>({ open: false, appt: null });
  const [upcomingShown, setUpcomingShown] = useState(FIRST_UPCOMING);
  const [pastShown, setPastShown] = useState(FIRST_PAST);
  const { data } = useLive(
    async (store) => ({
      appts: await store.list('appointment', { where: 'folder_id = ?', params: [folderId] }),
      usual: await usualDuration(store),
      types: await store.list('appointment_type', { order: 'created_at' }),
    }),
    [folderId],
    ['appointment', 'appointment_type', 'setting'],
  );
  const appts = useMemo(() => data?.appts ?? [], [data]);

  const { upcoming, past } = useMemo(() => {
    const first = appts.reduce<DateTime | null>((min, a) => {
      const s = DateTime.fromISO(a.start_local, { zone: a.tz });
      return s.isValid && (!min || s < min) ? s : min;
    }, null);
    const occ = occurrencesIn(appts, (first ?? now).minus({ days: 1 }), now.plus({ years: 2 }));
    return { upcoming: occ.filter((o) => o.end >= now), past: occ.filter((o) => o.end < now).reverse() };
  }, [appts, now]);

  // New appointments start from the next session at the usual rhythm (while a series is still
  // running, tomorrow at its time: an extra session).
  const defaults = useMemo(() => {
    if (!data) return undefined;
    const d = bookingDefaults(appts, now, data.usual, data.types);
    return { folderId, start: d.start, durationMin: d.durationMin, typeId: d.typeId, location: d.location, suggested: d.suggested };
  }, [data, appts, now, folderId]);
  const openNew = () => setDialog({ open: true, appt: null });

  const row = (o: Occurrence) => {
    const a = o.appointment;
    const start = o.start.setZone(tz);
    const moved = isMoved(a);
    const when = `${i18n.date(start, 'weekday')} · ${i18n.time(start)}`;
    const marks = [a.status !== 'confirmed' ? t(`appointment.statuses.${a.status}`) : null, moved ? t('calendar.moved') : null].filter((m): m is string => !!m);
    return (
      <Pressable
        key={`${a.id}-${o.date}`}
        onPress={() => setDialog({ open: true, appt: a, date: o.date })}
        accessibilityRole="button"
        accessibilityLabel={[i18n.date(start, 'long'), i18n.time(start), t('common.minutes', { n: a.duration_min }), ...marks].join(', ')}
        testID="folder-appointment"
        style={(s) => [
          { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md },
          (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
          (s as { focused?: boolean }).focused && focusRing(c.focus),
          web({ cursor: 'pointer' }),
        ]}
      >
        <Icon name={a.repeat ? 'repeat' : 'calendar'} size={16} color={c.textSecondary} />
        <T variant="small" style={[{ width: 190 }, a.status === 'cancelled' && { textDecorationLine: 'line-through' }]}>{when}</T>
        <T variant="small" tone="secondary" style={{ width: 64 }}>{t('common.minutes', { n: a.duration_min })}</T>
        {a.status !== 'confirmed' ? <Badge tone={a.status === 'cancelled' ? 'danger' : a.status === 'done' ? 'success' : 'neutral'} label={t(`appointment.statuses.${a.status}`)} /> : null}
        {moved ? <Badge tone="info" label={t('calendar.moved')} /> : null}
      </Pressable>
    );
  };

  /** Rows with a year heading wherever the year is not this one. */
  const rows = (list: Occurrence[]) => {
    const out: ReactNode[] = [];
    let year = now.year;
    for (const o of list) {
      const y = o.start.setZone(tz).year;
      if (y !== year) {
        out.push(
          <T key={`year-${y}`} variant="label" tone="secondary" role="heading" style={{ paddingHorizontal: space.sm, paddingTop: space.md, paddingBottom: space.xs }}>
            {String(y)}
          </T>,
        );
        year = y;
      }
      out.push(row(o));
    }
    return out;
  };

  const suggested = defaults?.suggested ? defaults.start : null;
  // Cancelled dates are listed, but they are not booked.
  const booked = upcoming.some((o) => o.appointment.status !== 'cancelled');
  const nothingBooked = (
    <Row wrap style={{ padding: space.sm, justifyContent: 'space-between' }}>
      <T tone="secondary">{appts.length ? t('calendar.nothingBooked') : t('folder.noAppointments')}</T>
      {suggested ? (
        <Button
          small
          variant="primary"
          icon="calendar"
          label={t('calendar.bookNextOn', { when: `${i18n.date(suggested, 'weekday')}, ${i18n.time(suggested)}` })}
          onPress={openNew}
          testID="folder-book-next"
        />
      ) : null}
    </Row>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.xxl, gap: space.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="label" tone="secondary" role="heading">{t('folder.upcoming')}</T>
        <Button small icon="plus" label={t('folder.newAppointment')} onPress={openNew} testID="folder-new-appointment" />
      </Row>
      <Card padded={false} style={{ padding: space.sm }}>
        {rows(upcoming.slice(0, upcomingShown))}
        {upcoming.length > upcomingShown ? (
          <View style={{ alignItems: 'flex-start', padding: space.xs }}>
            <Button small variant="ghost" icon="chevronDown" label={t('calendar.showMore')} onPress={() => setUpcomingShown((n) => n + 10)} />
          </View>
        ) : null}
        {booked ? null : nothingBooked}
      </Card>
      {past.length ? (
        <>
          <T variant="label" tone="secondary" role="heading">{t('folder.past')}</T>
          <Card padded={false} style={{ padding: space.sm }}>
            {rows(past.slice(0, pastShown))}
            {past.length > pastShown ? (
              <View style={{ alignItems: 'flex-start', padding: space.xs }}>
                <Button small variant="ghost" icon="chevronDown" label={t('calendar.showAll', { n: past.length })} onPress={() => setPastShown(Infinity)} />
              </View>
            ) : null}
          </Card>
        </>
      ) : null}
      <AppointmentDialog visible={dialog.open} onClose={() => setDialog({ open: false, appt: null })} appointment={dialog.appt} occurrenceDate={dialog.date} defaults={defaults} />
    </ScrollView>
  );
}
