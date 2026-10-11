import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { HelpButton } from '../../shell/HelpButton';
import { DateTime } from 'luxon';
import { toIcs, type IcsTitleStyle } from '../../core/calendar/ics';
import { calendarStart, gridHours, hourOfDay, placeOverlapping } from '../../core/calendar/layout';
import type { Occurrence } from '../../core/calendar/occurrences';
import { isMoved } from '../../core/calendar/series';
import { workingHours } from '../../core/calendar/slots';
import { utf8 } from '../../core/bytes';
import type { Appointment, AvailabilityException, AvailabilityRule, Folder } from '../../core/model/types';
import { folderMap, occurrencesInRange } from '../../services/queries';
import { getSetting, SETTING, setSetting } from '../../services/settings';
import { useAppState, usePractice } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { ariaState, Button, Col, Dialog, focusRing, IconButton, Notice, Row, Screen, Segmented, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { usePracticeTz, useNow } from '../common/hooks';
import { AppointmentDialog } from './AppointmentDialog';

const HOUR_PX = 52;

interface WeekData {
  /** The start of the days these were loaded for. */
  from: string;
  occ: Occurrence[];
  folders: Map<string, Folder>;
  rules: AvailabilityRule[];
  exceptions: AvailabilityException[];
}

export function CalendarScreen({ date: initialDate, view: initialView = 'week' }: { date?: string; view?: 'week' | 'day' }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const [view, setView] = useState<'week' | 'day'>(initialView);
  // Kept as a plain date so the week is always rebuilt in the current practice time zone. Until
  // the therapist moves, it is today there: read now, not on the first render, which comes
  // before the practice's time zone has loaded.
  const [anchorDate, setAnchorDate] = useState<string | null>(initialDate ?? null);
  const anchorIso = calendarStart(anchorDate, now, tz);
  const anchor = useMemo(() => DateTime.fromISO(anchorIso, { zone: tz }).startOf('day'), [anchorIso, tz]);
  const setAnchor = (d: DateTime) => setAnchorDate(d.toISODate()!);
  const [dialog, setDialog] = useState<{ open: boolean; appt: Appointment | null; date?: string; start?: DateTime }>({ open: false, appt: null });
  const dialogDefaults = useMemo(() => ({ start: dialog.start }), [dialog.start]);
  const [exporting, setExporting] = useState(false);

  const days = useMemo(() => {
    const start = view === 'week' ? anchor.startOf('week') : anchor;
    return Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => start.plus({ days: i }));
  }, [anchor, view]);
  const from = days[0]!;
  const to = days[days.length - 1]!.plus({ days: 1 });

  const { data } = useLive<WeekData>(
    async (store) => {
      const occ = await occurrencesInRange(store, from, to);
      return {
        from: from.toISO()!,
        occ,
        folders: await folderMap(store),
        rules: await store.list('availability'),
        exceptions: await store.list('availability_exception'),
      };
    },
    [from.toISO(), to.toISO()],
    ['appointment', 'folder', 'availability', 'availability_exception'],
  );

  // The hours on screen: 07:00–22:00, widened to any earlier or later appointment or working hours.
  const spans = useMemo(() => {
    if (!data) return [];
    const out: { start: number; end: number }[] = [];
    for (const d of days) for (const h of workingHours(d, data.rules, data.exceptions)) out.push({ start: hourOfDay(h.start, d), end: hourOfDay(h.end, d) });
    for (const o of data.occ) {
      const s = o.start.setZone(tz);
      out.push({ start: hourOfDay(s, s), end: hourOfDay(o.end.setZone(tz), s) });
    }
    return out;
  }, [data, days, tz]);
  const hours = useMemo(() => gridHours(spans), [spans]);

  // Opens at the current time on this week or day, otherwise at the first session or working hour.
  const scroller = useRef<ScrollView>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!data || data.from !== from.toISO()) return;
    const key = `${view}:${from.toISODate()}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const showsNow = days.some((d) => d.hasSame(now, 'day'));
    const earliest = spans.length ? Math.min(...spans.map((x) => x.start)) : 8;
    const target = showsNow ? hourOfDay(now, now) - 1.5 : earliest - 0.5;
    scroller.current?.scrollTo({ x: 0, y: Math.max(0, (target - hours.first) * HOUR_PX), animated: false });
  }, [data, view, from, days, now, spans, hours.first]);

  const step = view === 'week' ? { weeks: 1 } : { days: 1 };
  const title = view === 'week' ? t('calendar.weekOf', { date: i18n.date(from, 'medium') }) : i18n.date(anchor, 'long');

  return (
    <Screen
      title={t('calendar.title')}
      scroll={false}
      testID="screen-calendar"
      actions={
        <>
          <HelpButton topic="calendar" />
          <Button icon="download" label={t('calendar.exportIcs')} onPress={() => setExporting(true)} />
          <Button variant="primary" icon="plus" label={t('calendar.newAppointment')} onPress={() => setDialog({ open: true, appt: null })} testID="new-appointment" />
        </>
      }
    >
      <Row style={{ justifyContent: 'space-between', marginBottom: space.md }} wrap>
        <Row>
          <IconButton icon="chevronLeft" label={t('calendar.previous')} onPress={() => setAnchor(anchor.minus(step))} />
          <Button small label={t('calendar.today')} onPress={() => setAnchor(now.startOf('day'))} />
          <IconButton icon="chevronRight" label={t('calendar.next')} onPress={() => setAnchor(anchor.plus(step))} />
          <T variant="heading" role="heading" style={{ marginLeft: space.sm }}>{title}</T>
        </Row>
        <Segmented
          label={t('calendar.title')}
          value={view}
          onChange={setView}
          options={[
            { value: 'week', label: t('calendar.week') },
            { value: 'day', label: t('calendar.day') },
          ]}
        />
      </Row>

      <View style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, backgroundColor: c.surface, overflow: 'hidden' }}>
        {/* Day headers */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View style={{ width: 56 }} />
          {days.map((d) => {
            const isToday = d.hasSame(now, 'day');
            return (
              <Pressable
                key={d.toISODate()}
                onPress={() => { setAnchor(d); setView('day'); }}
                accessibilityRole="button"
                accessibilityLabel={isToday ? t('calendar.todayDay', { date: i18n.date(d, 'long') }) : i18n.date(d, 'long')}
                {...ariaState({ current: isToday ? 'date' : undefined })}
                style={(s) => [{ flex: 1, paddingVertical: space.sm, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: c.divider }, (s as { focused?: boolean }).focused && focusRing(c.focus), web({ cursor: 'pointer' })]}
              >
                <T variant="tiny" tone={isToday ? 'accent' : 'secondary'} style={{ textTransform: 'uppercase' }}>{d.setLocale(i18n.meta.bcp47).toFormat('ccc')}</T>
                <View style={{ backgroundColor: isToday ? c.accent : 'transparent', borderRadius: radius.pill, minWidth: 30, paddingHorizontal: 6, alignItems: 'center' }}>
                  <T variant="heading" style={{ color: isToday ? c.onAccent : c.text }}>{d.day}</T>
                </View>
              </Pressable>
            );
          })}
        </View>

        <ScrollView ref={scroller} style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', height: (hours.last - hours.first) * HOUR_PX }}>
            <View style={{ width: 56 }}>
              {Array.from({ length: hours.last - hours.first }, (_, i) => (
                <View key={i} style={{ height: HOUR_PX, alignItems: 'flex-end', paddingRight: 6 }}>
                  <T variant="tiny" tone="muted" style={{ marginTop: -7 }}>{i ? `${String(hours.first + i).padStart(2, '0')}:00` : ''}</T>
                </View>
              ))}
            </View>
            {days.map((d) => (
              <DayColumn
                key={d.toISODate()}
                day={d}
                now={now}
                first={hours.first}
                last={hours.last}
                data={data}
                onSlot={(start) => setDialog({ open: true, appt: null, start })}
                onOpen={(o) => setDialog({ open: true, appt: o.appointment, date: o.date })}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      <AppointmentDialog visible={dialog.open} onClose={() => setDialog({ open: false, appt: null })} appointment={dialog.appt} occurrenceDate={dialog.date} defaults={dialogDefaults} />
      <ExportIcsDialog visible={exporting} onClose={() => setExporting(false)} />
    </Screen>
  );
}

function DayColumn({
  day, now, first, last, data, onSlot, onOpen,
}: {
  day: DateTime;
  now: DateTime;
  first: number;
  last: number;
  data: WeekData | undefined;
  onSlot: (start: DateTime) => void;
  onOpen: (o: Occurrence) => void;
}) {
  const { c } = useTheme();
  const i18n = useI18n();
  const { t } = i18n;
  const top = (dt: DateTime) => (hourOfDay(dt, day) - first) * HOUR_PX;
  const hours = data ? workingHours(day, data.rules, data.exceptions) : [];
  const occ = (data?.occ ?? []).filter((o) => o.start.setZone(day.zone).hasSame(day, 'day'));
  // Side by side only where appointments overlap; the rest keep the whole width.
  const placed = placeOverlapping(occ);
  const nowHour = hourOfDay(now, day);

  return (
    <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: c.divider, backgroundColor: c.surfaceSunken }}>
      {hours.map((h) => (
        <View key={h.start.toISO()} style={{ position: 'absolute', left: 0, right: 0, top: top(h.start), height: top(h.end) - top(h.start), backgroundColor: c.surface }} />
      ))}
      {Array.from({ length: (last - first) * 2 }, (_, i) => {
        const hour = first + Math.floor(i / 2);
        const minute = (i % 2) * 30;
        return (
          <Pressable
            key={i}
            onPress={() => onSlot(day.set({ hour, minute }))}
            accessibilityRole="button"
            accessibilityLabel={`${t('calendar.newAppointment')} ${i18n.date(day, 'weekday')} ${String(hour).padStart(2, '0')}:${minute ? '30' : '00'}`}
            style={(s) => [
              { height: HOUR_PX / 2, borderTopWidth: i % 2 ? 0 : 1, borderTopColor: c.divider },
              (s as { hovered?: boolean }).hovered && { backgroundColor: c.primarySubtle },
              web({ cursor: 'cell' }),
            ]}
          />
        );
      })}
      {day.hasSame(now, 'day') && nowHour >= first && nowHour < last ? (
        <View style={{ pointerEvents: 'none', position: 'absolute', left: 0, right: 0, top: top(now), height: 2, backgroundColor: c.accent }} />
      ) : null}
      {occ.map((o) => {
        const start = o.start.setZone(day.zone);
        const a = o.appointment;
        const folder = a.folder_id ? data?.folders.get(a.folder_id) : undefined;
        const colour = folder ? c.folder[folder.colour] : c.textMuted;
        const { lane, lanes } = placed.get(o) ?? { lane: 0, lanes: 1 };
        const width = 100 / lanes;
        const cancelled = a.status === 'cancelled';
        const moved = isMoved(a);
        const marks = [a.status !== 'confirmed' ? t(`appointment.statuses.${a.status}`) : null, moved ? t('calendar.moved') : null].filter(Boolean);
        const when = `${i18n.time(start)}–${i18n.time(o.end.setZone(day.zone))}`;
        const name = folder?.label ?? a.title;
        return (
          <Pressable
            key={`${a.id}-${o.date}`}
            onPress={() => onOpen(o)}
            accessibilityRole="button"
            accessibilityLabel={[when, name, ...marks].join(', ')}
            testID="calendar-event"
            style={(s) => [
              {
                position: 'absolute',
                top: top(start) + 1,
                height: Math.max(22, (o.end.diff(o.start, 'minutes').minutes / 60) * HOUR_PX - 2),
                left: `${lane * width}%`,
                width: `${width}%`,
                paddingHorizontal: 2,
              },
              web({ cursor: 'pointer' }),
              (s as { hovered?: boolean }).hovered && { zIndex: 2 },
              (s as { focused?: boolean }).focused && [focusRing(c.focus), { zIndex: 2 }],
            ]}
          >
            <View style={{ flex: 1, borderRadius: 6, backgroundColor: c.surface, borderLeftWidth: 4, borderLeftColor: colour, borderWidth: 1, borderColor: c.border, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', opacity: cancelled ? 0.6 : 1, borderStyle: a.status === 'proposed' ? 'dashed' : 'solid' }}>
              <T variant="tiny" numberOfLines={1} style={[{ fontWeight: '600' }, cancelled && { textDecorationLine: 'line-through' }]}>
                {name}
              </T>
              {/* Marks first: in a narrow column the time is what gets cut, and the grid shows it anyway. */}
              <T variant="tiny" tone="muted" numberOfLines={1}>
                {[...marks, when].join(' · ')}
              </T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ExportIcsDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const practice = usePractice();
  const { platform } = useAppState();
  const { t } = useI18n();
  const [style, setStyle] = useState<IcsTitleStyle>('initials');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!visible) return;
    setDone(false);
    setError(null);
    void getSetting<IcsTitleStyle>(practice.store, SETTING.icsTitleStyle, 'initials').then(setStyle);
  }, [visible, practice]);

  async function exportNow() {
    const path = await platform.dialogs.saveFile(t('calendar.exportIcsTitle'), 'sala-calendar.ics', [{ name: 'iCalendar', extensions: ['ics'] }]);
    if (!path) return;
    try {
      await setSetting(practice.store, SETTING.icsTitleStyle, style);
      const ics = toIcs(await practice.store.list('appointment'), await folderMap(practice.store), { titleStyle: style, neutralTitle: t('calendar.neutralTitle') });
      await platform.files.write(path, utf8(ics));
      setDone(true);
    } catch {
      setError(t('errors.fileWrite'));
    }
  }

  return (
    <Dialog visible={visible} title={t('calendar.exportIcsTitle')} onClose={onClose} onSubmit={() => void exportNow()} footer={<><Button label={t('common.close')} onPress={onClose} /><Button variant="primary" icon="download" label={t('calendar.exportIcs')} onPress={() => void exportNow()} /></>}>
      <Col gap={space.md}>
        <T tone="secondary">{t('calendar.exportIcsBody')}</T>
        <T variant="label" tone="secondary">{t('calendar.titleStyle')}</T>
        <Segmented<IcsTitleStyle>
          label={t('calendar.titleStyle')}
          value={style}
          onChange={setStyle}
          options={[
            { value: 'initials', label: t('calendar.titleInitials') },
            { value: 'neutral', label: t('calendar.titleNeutral') },
            { value: 'name', label: t('calendar.titleName') },
          ]}
        />
        {done ? <Notice tone="success">{t('calendar.exported')}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Col>
    </Dialog>
  );
}
