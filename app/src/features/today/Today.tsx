import React, { useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { DateTime } from 'luxon';
import { nextOccurrence, type Occurrence } from '../../core/calendar/occurrences';
import { freeSlots } from '../../core/calendar/slots';
import type { Appointment, Folder, Page, Sticky } from '../../core/model/types';
import {
  appointmentsBetween, bookingFor, dueStickies, folderMap, occurrencesInRange, occurrencesOn, recentPages, stuckOnCovers,
} from '../../services/queries';
import {
  dayStates, freeFrom, latestNotes, markNoNoteNeeded, previousPage, sessionKey, sessionPagesByKey, sessionSlot, unmarkNoNoteNeeded, unwrittenSessions,
  type SessionState,
} from '../../services/today';
import { usePractice } from '../../shell/AppState';
import { HelpButton } from '../../shell/HelpButton';
import { useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { type I18n, useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Card, Col, focusRing, IconButton, Row, Screen, SectionTitle, T, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { AppointmentDialog } from '../calendar/AppointmentDialog';
import { FolderAvatar } from '../common/FolderPicture';
import { usePracticeTz, useNow } from '../common/hooks';
import { StickyCard, usePeel } from '../common/Sticky';
import { findOrCreatePageFor } from '../folder/pageActions';
import { BackupNotice, UpdatesQuestion } from './BackupNotice';
import { NotesToWrite } from './NotesToWrite';
import { UpNextDetails } from './UpNext';
import { dayAndTime, sessionDate } from '../common/dates';
import { startsIn } from './when';

type DialogProps = ComponentProps<typeof AppointmentDialog>;
interface DialogState {
  appointment: Appointment | null;
  occurrenceDate?: string;
  /** Set once per opening, so the dialog never sees a new object while it is open. */
  defaults?: DialogProps['defaults'];
}

/** Content width from which Today shows two columns. */
const TWO_COLUMNS = 820;
/** Next days list this many appointments before pointing to the calendar. */
const NEXT_DAYS_MAX = 8;
const TIME_WIDTH = 56;
const AVATAR = 40;

export function Today() {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const toast = useToast();
  const peelNote = usePeel();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const day = now.toISODate()!;
  const win = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const busy = useRef(false);
  // react-native-web drops accessibilityHint: the cards point at this text instead.
  const openHintId = `${useId()}-open`;

  const { data } = useLive(
    async (store) => {
      // The day comes from the dependencies, read in the practice's zone.
      const today = DateTime.fromISO(day, { zone: tz });
      // The day's sessions and the folders first: the reads below need them too.
      const [occ, folders] = await Promise.all([occurrencesOn(store, today), folderMap(store)]);
      const active = new Set([...folders.values()].filter((f) => f.status === 'active' && !f.merged_into).map((f) => f.id));
      const [due, covers, recent, rules, exceptions, soon, unwritten, ahead] = await Promise.all([
        dueStickies(store, today, { occ, active }),
        stuckOnCovers(store),
        recentPages(store, 5),
        store.list('availability'),
        store.list('availability_exception'),
        occurrencesInRange(store, today.plus({ days: 1 }), today.plus({ days: 4 })),
        // Sessions before today: today's have their own Write note button on their cards.
        unwrittenSessions(store, today, tz, undefined, { active }),
        appointmentsBetween(store, day, '9999-12-31'),
      ]);
      const notes = await sessionPagesByKey(store, occ, tz);
      const todays = new Set(occ.flatMap((o) => (o.appointment.folder_id ? [o.appointment.folder_id] : [])));
      // Per folder seen today: its appointments from today on (is a next session booked?) and its latest notes.
      const booked = new Map<string, Appointment[]>();
      for (const a of ahead) if (a.folder_id && todays.has(a.folder_id)) booked.set(a.folder_id, [...(booked.get(a.folder_id) ?? []), a]);
      const pages = new Map<string, Page[]>(await Promise.all([...todays].map(async (id) => [id, await latestNotes(store, id, day)] as const)));
      return {
        occ, due, folders, covers, recent, unwritten, notes, booked, pages,
        hasHours: rules.length > 0,
        free: freeSlots(today, rules, exceptions, occ),
        soon: soon.filter((o) => o.appointment.status !== 'cancelled'),
      };
    },
    [day, tz],
    // Documents too: one attached to an empty page makes it a note.
    ['appointment', 'sticky', 'folder', 'page', 'attachment', 'availability', 'availability_exception', 'setting'],
  );

  // What changes with the clock, without reading the store again.
  const view = useMemo(() => {
    if (!data) return null;
    const { upNext, stateOf } = dayStates(data.occ, now);
    const nextBooked = (folderId: string) => nextOccurrence(data.booked.get(folderId) ?? [], now) !== null;
    return {
      upNext,
      stateOf,
      nextBooked,
      free: freeFrom(data.free, now),
    };
  }, [data, now]);

  const contentWidth = width || win.width - 232 - 2 * space.xxl;
  const twoColumns = contentWidth >= TWO_COLUMNS;
  const hour = now.hour;
  const greeting = hour < 12 ? t('today.greetingMorning') : hour < 19 ? t('today.greetingAfternoon') : t('today.greetingEvening');
  const label = (o: Occurrence) => (o.appointment.folder_id ? data?.folders.get(o.appointment.folder_id)?.label : o.appointment.title) || '—';

  /** Runs one action at a time, so a double press never makes two pages; a failure says so. */
  async function once(run: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await run();
    } catch (e) {
      console.error(e);
      toast.show({ message: t('errors.generic') });
    } finally {
      busy.current = false;
    }
  }

  const openPage = (page: Pick<Page, 'id' | 'folder_id'>) => go({ name: 'folder', id: page.folder_id, tab: 'pages', pageId: page.id });

  const openNote = (o: Occurrence) =>
    void once(async () => {
      const folderId = o.appointment.folder_id;
      if (!folderId) return;
      const { page } = await findOrCreatePageFor(practice.store, folderId, { start: o.start, tz, duration: o.appointment.duration_min });
      openPage(page);
    });

  const bookNext = (o: Occurrence) =>
    void once(async () => {
      const folderId = o.appointment.folder_id;
      if (!folderId) return;
      const d = await bookingFor(practice.store, folderId, now);
      setDialog({ appointment: null, defaults: { folderId, start: d.start, durationMin: d.durationMin, typeId: d.typeId, location: d.location } });
    });

  const noNoteNeeded = (o: Occurrence) =>
    void once(async () => {
      const key = sessionKey(o);
      await markNoNoteNeeded(practice.store, key, day);
      toast.undo(t('today.markedNoNote'), () => unmarkNoNoteNeeded(practice.store, key));
    });

  const peel = (s: Sticky) => void once(() => peelNote(s));

  const openSticky = (s: Sticky) => (s.page_id ? openPage({ id: s.page_id, folder_id: s.folder_id }) : go({ name: 'folder', id: s.folder_id }));
  const openAppointment = (o: Occurrence) => setDialog({ appointment: o.appointment, occurrenceDate: o.date });

  const appointments = (
    <Col gap={space.md} key="appointments">
      <SectionTitle>{t('today.appointments')}</SectionTitle>
      <T nativeID={openHintId} style={{ display: 'none' }}>{t('today.openAppointment')}</T>
      {data && data.occ.length === 0 ? <T tone="secondary">{t('today.noAppointments')}</T> : null}
      {data && view
        ? data.occ.map((o) => {
            const folder = o.appointment.folder_id ? data.folders.get(o.appointment.folder_id) : undefined;
            const state = view.stateOf(o);
            const isUpNext = o === view.upNext;
            const note = data.notes.get(sessionKey(o));
            const slot = sessionSlot(o, tz);
            return (
              <SessionCard
                key={sessionKey(o)}
                o={o}
                folder={folder}
                label={label(o)}
                tz={tz}
                now={now}
                state={state}
                upNext={isUpNext}
                note={note}
                hintId={openHintId}
                canBookNext={!!folder && (state === 'ended' || state === 'now') && !view.nextBooked(folder.id)}
                onOpen={() => openAppointment(o)}
                onNote={() => openNote(o)}
                onBookNext={() => bookNext(o)}
                onFolder={() => folder && go({ name: 'folder', id: folder.id })}
              >
                {isUpNext && folder ? (
                  <UpNextDetails
                    stickies={data.covers.get(folder.id) ?? []}
                    previous={previousPage(data.pages.get(folder.id) ?? [], slot)}
                    indent={space.md * 3 + TIME_WIDTH + AVATAR}
                    now={now}
                    onOpenPage={openPage}
                  />
                ) : null}
              </SessionCard>
            );
          })
        : null}
    </Col>
  );

  const stickies = (
    <Col gap={space.md} key="stickies">
      <SectionTitle>{t('today.dueNotes')}</SectionTitle>
      {data && data.due.length === 0 ? <T tone="secondary">{t('today.noDueNotes')}</T> : null}
      {data?.due.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {data.due.map(({ sticky }) => (
            <StickyCard
              key={sticky.id}
              sticky={sticky}
              caption={data.folders.get(sticky.folder_id)?.label}
              onEdit={() => openSticky(sticky)}
              onPeel={() => peel(sticky)}
              testID="today-sticky"
            />
          ))}
        </View>
      ) : null}
    </Col>
  );

  const notesToWrite =
    data && view ? (
      <NotesToWrite key="notes" sessions={data.unwritten} folders={data.folders} tz={tz} now={now} onWrite={openNote} onNoNote={noNoteNeeded} />
    ) : null;

  const free = data && view ? (
    <Col gap={space.md} key="free">
      <SectionTitle>{t('today.free')}</SectionTitle>
      {!data.hasHours ? (
        <LinkLine label={t('today.setHours')} onPress={() => go({ name: 'settings', section: 'calendar' })} testID="today-set-hours" />
      ) : view.free.length === 0 ? (
        <T tone="secondary">{t('today.noFree')}</T>
      ) : (
        <Row wrap>
          {view.free.map((s) => (
            <Badge key={s.start.toISO()} tone="success" label={`${i18n.time(s.start)}–${i18n.time(s.end)}`} />
          ))}
        </Row>
      )}
    </Col>
  ) : null;

  const nextDays =
    data && data.soon.length > 0 ? (
      <Col gap={space.md} key="next">
        <SectionTitle action={data.soon.length > NEXT_DAYS_MAX ? <LinkLine label={t('today.seeCalendar')} onPress={() => go({ name: 'calendar' })} /> : undefined}>
          {t('today.nextDays')}
        </SectionTitle>
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {data.soon.slice(0, NEXT_DAYS_MAX).map((o, i) => (
            <ListRow key={sessionKey(o)} first={i === 0} onPress={() => openAppointment(o)} label={`${when(i18n, o, tz, now)}, ${label(o)}`} testID="next-day-row">
              <T variant="small" tone="secondary" style={{ width: 150 }}>{when(i18n, o, tz, now)}</T>
              <T variant="small" numberOfLines={1} style={{ flex: 1 }}>{label(o)}</T>
            </ListRow>
          ))}
        </Card>
      </Col>
    ) : null;

  const recentRows = data?.recent.flatMap((p) => {
    const f = data.folders.get(p.folder_id);
    return f ? [{ p, f }] : [];
  });
  const recent = recentRows?.length ? (
    <Col gap={space.md} key="recent">
      <SectionTitle>{t('today.recent')}</SectionTitle>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {recentRows.map(({ p, f }, i) => {
          const sub = `${p.title || t('page.untitled')} · ${sessionDate(i18n, p.date, now.toISODate()!)}`;
          return (
            <ListRow key={p.id} first={i === 0} onPress={() => openPage(p)} label={`${f.label}, ${sub}`} role="link">
              <FolderAvatar folder={f} size={32} />
              <Col gap={0} style={{ flex: 1 }}>
                <T variant="label" numberOfLines={1}>{f.label}</T>
                <T variant="tiny" tone="muted" numberOfLines={1}>{sub}</T>
              </Col>
            </ListRow>
          );
        })}
      </Card>
    </Col>
  ) : null;

  return (
    <Screen testID="screen-today">
      <Row style={{ paddingTop: space.xl, justifyContent: 'space-between' }} align="flex-start">
        <View style={{ gap: 2, flexShrink: 1 }}>
          <T variant="small" tone="secondary">{greeting}</T>
          <T variant="display" role="heading">{i18n.date(now, 'long')}</T>
        </View>
        <HelpButton topic="today" />
      </Row>

      <BackupNotice />
      <UpdatesQuestion />

      <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
        {twoColumns ? (
          <View style={{ flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' }}>
            <Col gap={space.lg} style={{ flex: 3, minWidth: 0 }}>{[appointments, notesToWrite, free, nextDays]}</Col>
            <Col gap={space.lg} style={{ flex: 2, minWidth: 0 }}>{[stickies, recent]}</Col>
          </View>
        ) : (
          // One column: what matters for the sessions first, sticky notes before free time.
          <Col gap={space.lg}>{[appointments, stickies, notesToWrite, free, nextDays, recent]}</Col>
        )}
      </View>

      <AppointmentDialog
        visible={dialog !== null}
        onClose={() => setDialog(null)}
        appointment={dialog?.appointment ?? null}
        occurrenceDate={dialog?.occurrenceDate}
        defaults={dialog?.defaults}
      />
    </Screen>
  );
}

/** "Tue 29 Sept · 18:00" for a session in the next days. */
function when(i18n: I18n, o: Occurrence, tz: string, now: DateTime): string {
  return dayAndTime(i18n, o.start.setZone(tz), now);
}

/** One appointment of today: press it to open the appointment; its note, folder and Book next sit beside it. */
function SessionCard({
  o, folder, label, tz, now, state, upNext, note, hintId, canBookNext, onOpen, onNote, onBookNext, onFolder, children,
}: {
  o: Occurrence;
  folder: Folder | undefined;
  label: string;
  tz: string;
  now: DateTime;
  state: SessionState;
  upNext: boolean;
  note: Page | undefined;
  /** Id of the text that says pressing the card opens the appointment. */
  hintId: string;
  canBookNext: boolean;
  onOpen: () => void;
  onNote: () => void;
  onBookNext: () => void;
  onFolder: () => void;
  children?: ReactNode;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const start = o.start.setZone(tz);
  const time = i18n.time(start);
  const badge = state === 'now' ? t('today.now') : state === 'next' ? t('today.next') : state === 'ended' ? t('today.ended') : null;
  const timing = !upNext ? null : state === 'now' ? t('today.until', { time: i18n.time(o.end.setZone(tz)) }) : startsIn(i18n, o.start.diff(now, 'minutes').minutes);
  const proposed = o.appointment.status === 'proposed' ? t('appointment.statuses.proposed') : null;
  const spoken = [time, label, badge, timing, proposed, o.appointment.location, note ? t('today.noteWritten') : null].filter(Boolean).join(', ');
  return (
    <Card
      padded={false}
      style={[{ flexDirection: 'row', overflow: 'hidden' }, state === 'now' && { borderColor: c.accent, borderWidth: 2 }]}
    >
      <View style={{ width: 6, backgroundColor: folder ? c.folder[folder.colour] : c.border }} />
      <View style={{ flex: 1, minWidth: 0 }} testID="today-session">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.sm, padding: space.md }}>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={spoken}
            {...({ 'aria-describedby': hintId } as object)}
            testID="today-session-open"
            style={(s) => [
              { flexDirection: 'row', alignItems: 'center', gap: space.md, flexGrow: 1, flexShrink: 1, flexBasis: 260, borderRadius: radius.md, padding: space.xs, margin: -space.xs },
              (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
              (s as { focused?: boolean }).focused && focusRing(c.focus),
              web({ cursor: 'pointer' }),
            ]}
          >
            <Col gap={0} style={{ width: TIME_WIDTH }}>
              <T variant="heading">{time}</T>
              <T variant="tiny" tone="muted">{t('common.minutes', { n: o.appointment.duration_min })}</T>
            </Col>
            {folder ? <FolderAvatar folder={folder} size={AVATAR} /> : <View style={{ width: AVATAR }} />}
            <Col gap={2} style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" numberOfLines={1}>{label}</T>
              {badge || timing || proposed || o.appointment.location || note ? (
                <Row gap={space.sm} wrap>
                  {badge ? <Badge tone={state === 'now' ? 'success' : state === 'next' ? 'info' : 'neutral'} label={badge} /> : null}
                  {proposed ? <Badge tone="warning" label={proposed} /> : null}
                  {timing ? <T variant="small" tone="secondary">{timing}</T> : null}
                  {o.appointment.location ? <T variant="small" tone="secondary" numberOfLines={1}>{o.appointment.location}</T> : null}
                  {note ? (
                    <Row gap={space.xs}>
                      <Icon name="check" size={14} color={c.successText} />
                      <T variant="small" tone="success">{t('today.noteWritten')}</T>
                    </Row>
                  ) : null}
                </Row>
              ) : null}
            </Col>
          </Pressable>
          {folder ? (
            <Row gap={space.xs} style={{ marginLeft: 'auto' }}>
              <IconButton icon="folder" size={32} label={`${t('appointment.openFolder')}: ${label}`} onPress={onFolder} />
              {canBookNext ? (
                <Button small icon="calendar" label={t('today.bookNext')} accessibilityLabel={t('today.bookNextFor', { name: label })} onPress={onBookNext} testID="today-book-next" />
              ) : null}
              <Button
                small
                variant={upNext ? 'primary' : 'secondary'}
                icon={note ? 'page' : 'edit'}
                label={note ? t('today.openNote') : t('today.writeNote')}
                accessibilityLabel={t(note ? 'today.openNoteFor' : 'today.writeNoteFor', { name: label, time })}
                onPress={onNote}
                testID="today-note"
              />
            </Row>
          ) : null}
        </View>
        {children}
      </View>
    </Card>
  );
}

/** A pressable row inside a list card. */
function ListRow({ children, first, onPress, label, role = 'button', testID }: { children: ReactNode; first: boolean; onPress: () => void; label: string; role?: 'button' | 'link'; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={label}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: 40, borderTopWidth: first ? 0 : 1, borderTopColor: c.divider },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {children}
      <Icon name="chevronRight" size={16} color={c.textMuted} />
    </Pressable>
  );
}

/** A short line that takes the therapist somewhere else: "See calendar →". */
function LinkLine({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', borderRadius: radius.sm },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {(s) => (
        <>
          <T variant="small" tone="accent" style={(s as { hovered?: boolean }).hovered ? { textDecorationLine: 'underline' } : undefined}>{label}</T>
          <Icon name="arrowRight" size={14} color={c.accentText} />
        </>
      )}
    </Pressable>
  );
}
