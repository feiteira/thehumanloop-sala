import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { DateTime } from 'luxon';
import { nextOccurrence } from '../../core/calendar/occurrences';
import type { Folder } from '../../core/model/types';
import { folderStats } from '../../services/folderStats';
import { archiveFolder, deleteFolder, futureAppointments, nextSessionNotes, restoreRemoved, unarchiveFolder, undoArchive } from '../../services/folders';
import { bookingFor } from '../../services/queries';
import { HelpButton } from '../../shell/HelpButton';
import { helpTopicFor } from '../../shell/helpTopic';
import { usePractice } from '../../shell/AppState';
import { type FolderTab, useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Badge, Button, Checkbox, Col, ConfirmDialog, EmptyState, focusRing, IconButton, Row, T, useChoiceGroup, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { AppointmentDialog } from '../calendar/AppointmentDialog';
import { useNow, usePracticeTz } from '../common/hooks';
import { FolderDialog } from '../common/FolderDialog';
import { FolderAvatar } from '../common/FolderPicture';
import { AddStickyButton, StickyCard, StickyDialog, usePeel } from '../common/Sticky';
import { Documents } from './Documents';
import { Companion, useLoopJoined } from '../../loopBridge';
import { ExportFolderDialog } from './ExportFolderDialog';
import { FolderCalendar } from './FolderCalendar';
import { dayAndTime } from '../common/dates';
import { dayMonth, describeFuture, instantDate } from './format';
import { HistoryTab } from './HistoryTab';
import { PagesTab } from './PagesTab';
import { ThemesTab } from './ThemesTab';
import { undoneExcept } from './undo';

/** What the appointment dialog starts from when booking from the cover. */
type Booking = { folderId: string; start?: DateTime; durationMin?: number; typeId?: string | null; location?: string };

export function FolderScreen({ id, tab = 'pages', pageId, passage }: { id: string; tab?: FolderTab; pageId?: string; passage?: string }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const toast = useToast();
  const peel = usePeel();
  const tz = usePracticeTz();
  // Moves inside the folder replace the route: Back leaves the folder in one step.
  const { replace, back, canGoBack } = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Set when Book is pressed and kept as is while the dialog is open (a new object would reset it).
  const [booking, setBooking] = useState<Booking | null>(null);
  const [sticky, setSticky] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const joined = useLoopJoined();

  const { data } = useLive(
    async (store) => ({
      folder: await store.get('folder', id),
      cover: await store.list('sticky', { where: "folder_id = ? AND page_id IS NULL AND state = 'stuck'", params: [id], order: 'created_at' }),
    }),
    [id],
    ['folder', 'sticky'],
  );

  const folder = data?.folder;
  const mergedInto = folder?.merged_into;
  useEffect(() => {
    if (mergedInto) replace({ name: 'folder', id: mergedInto, tab });
  }, [mergedInto, tab, replace]);

  const tabs: { key: FolderTab; label: string }[] = [
    { key: 'pages', label: t('folder.tabs.pages') },
    { key: 'themes', label: t('folder.tabs.themes') },
    { key: 'calendar', label: t('folder.tabs.calendar') },
    { key: 'documents', label: t('folder.tabs.documents') },
    { key: 'history', label: t('folder.tabs.history') },
    ...(joined ? [{ key: 'companion' as const, label: `${t('loop.companion')}${folder?.loop_vault_id ? ' ◆' : ''}` }] : []),
  ];
  const setTab = (next: FolderTab) => replace({ name: 'folder', id, tab: next });
  const tabsKb = useChoiceGroup({ values: tabs.map((x) => x.key), value: tab, onChange: setTab, role: 'tab' });

  if (data && (!folder || folder.deleted)) {
    return <EmptyState icon="folder" title="—" action={<Button label={t('common.back')} onPress={back} />} />;
  }
  if (!folder || folder.merged_into) return null;

  const archived = folder.status === 'archived';
  const editingSticky = sticky.id ? data?.cover.find((s) => s.id === sticky.id) : null;
  const contact = [folder.contact.phone, folder.contact.email].map((s) => s.trim()).filter(Boolean);

  async function remove() {
    const removed = await deleteFolder(practice.store, id);
    // Leave the folder the way it was entered, so Back never lands on the deleted folder.
    if (canGoBack) back();
    else replace({ name: 'shelf' });
    toast.undo(t('folder.deleted'), async () => undoneExcept(toast, i18n, await restoreRemoved(practice.store, removed)));
  }

  const unarchive = () => unarchiveFolder(practice.store, id).catch(() => toast.show({ message: t('errors.generic') }));

  return (
    <View style={{ flex: 1 }} testID="screen-folder">
      {/* Cover */}
      <View style={{ backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={{ height: 6, backgroundColor: c.folder[folder.colour] }} />
        <View style={{ paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: space.md, gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }} align="flex-start">
            <Row gap={space.sm} style={{ flex: 1 }} align="flex-start">
              <IconButton icon="chevronLeft" label={t('common.back')} onPress={back} />
              <Pressable
                onPress={() => setEditing(true)}
                accessibilityRole="button"
                accessibilityLabel={t('folder.picture.change', { name: folder.label })}
                testID="folder-picture"
                style={(s) => [{ borderRadius: 28 }, (s as { focused?: boolean }).focused && focusRing(c.focus), web({ cursor: 'pointer' })]}
              >
                <FolderAvatar folder={folder} size={52} />
              </Pressable>
              <Col gap={4} style={{ flex: 1 }}>
                <T variant="title" role="heading" numberOfLines={1}>{folder.label}</T>
                {archived || folder.tags.length || folder.cover_note ? (
                  <Row gap={space.xs} wrap>
                    {archived && folder.archived_at ? <Badge tone="warning" label={t('folder.archivedOn', { date: instantDate(i18n, folder.archived_at, tz) })} /> : null}
                    {folder.tags.map((tg) => (
                      <Badge key={tg} tone="neutral" label={tg} />
                    ))}
                    {folder.cover_note ? <T variant="small" tone="muted">{folder.cover_note}</T> : null}
                  </Row>
                ) : null}
                <CoverFacts folder={folder} onBook={setBooking} />
                {contact.length ? (
                  <View testID="folder-contact">
                    <T variant="small" tone="secondary" selectable>{contact.join('  ·  ')}</T>
                  </View>
                ) : null}
              </Col>
            </Row>
            <Row gap={space.xs}>
              <Button small icon="edit" label={t('common.edit')} onPress={() => setEditing(true)} testID="edit-folder" />
              <Button
                small
                icon={archived ? 'restore' : 'archive'}
                label={archived ? t('folder.restore') : t('folder.archive')}
                onPress={() => (archived ? void unarchive() : setArchiving(true))}
                testID="archive-folder"
              />
              <IconButton icon="download" label={t('folder.exportFolder')} onPress={() => setExporting(true)} testID="export-folder" />
              <IconButton icon="trash" label={t('folder.delete')} onPress={() => setConfirmDelete(true)} testID="delete-folder" />
              <HelpButton topic={helpTopicFor({ name: 'folder', id, tab }) ?? 'folder'} />
            </Row>
          </Row>

          <View accessibilityLabel={t('folder.coverNotes')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {data?.cover.map((s) => (
              <StickyCard key={s.id} sticky={s} onEdit={() => setSticky({ open: true, id: s.id })} onPeel={() => void peel(s)} testID="cover-sticky" />
            ))}
            <AddStickyButton label={t('folder.addNote')} onPress={() => setSticky({ open: true, id: null })} />
          </View>

          <View accessibilityRole="tablist" accessibilityLabel={t('folder.dividers')} style={{ flexDirection: 'row', gap: space.xs, marginBottom: -space.md - 1 }}>
            {tabs.map((tb) => {
              const active = tb.key === tab;
              return (
                <Pressable
                  key={tb.key}
                  {...tabsKb.item(tb.key)}
                  testID={`tab-${tb.key}`}
                  style={(s) => [
                    { paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, borderWidth: 1, borderBottomWidth: 0 },
                    { borderColor: active ? c.border : 'transparent', backgroundColor: active ? c.background : 'transparent' },
                    (s as { hovered?: boolean }).hovered && !active && { backgroundColor: c.surfaceAlt },
                    (s as { focused?: boolean }).focused && focusRing(c.focus),
                    web({ cursor: 'pointer' }),
                  ]}
                >
                  <T variant="label" tone={active ? 'primary' : 'secondary'}>{tb.label}</T>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'pages' ? <PagesTab folderId={id} pageId={pageId} passage={passage} /> : null}
        {tab === 'themes' ? <ThemesTab folderId={id} /> : null}
        {tab === 'calendar' ? <FolderCalendar folderId={id} /> : null}
        {tab === 'documents' ? (
          <ScrollView contentContainerStyle={{ padding: space.xxl }}>
            <Documents folderId={id} />
          </ScrollView>
        ) : null}
        {tab === 'history' ? <HistoryTab folderId={id} /> : null}
        {tab === 'companion' ? <Companion folder={folder} /> : null}
      </View>

      <FolderDialog visible={editing} onClose={() => setEditing(false)} folder={folder} />
      <StickyDialog visible={sticky.open} onClose={() => setSticky({ open: false, id: null })} folderId={id} pageId={null} sticky={editingSticky} />
      <ArchiveDialog visible={archiving} onClose={() => setArchiving(false)} folder={folder} />
      <ExportFolderDialog visible={exporting} onClose={() => setExporting(false)} folder={folder} />
      {booking ? <AppointmentDialog visible onClose={() => setBooking(null)} appointment={null} defaults={booking} /> : null}
      <ConfirmDialog
        visible={confirmDelete}
        title={t('folder.deleteTitle')}
        message={t('folder.deleteBody')}
        confirmLabel={t('folder.deleteConfirm')}
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        secondary={archived ? undefined : { label: t('folder.archive'), icon: 'archive', onPress: () => setArchiving(true) }}
        width={520}
        testID="confirm-delete-folder"
      />
    </View>
  );
}

/** "Next: Mon 5 Oct · 09:00", "14 sessions · last 21 Sept", or Book when nothing is booked. */
function CoverFacts({ folder, onBook }: { folder: Folder; onBook: (b: Booking) => void }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const tz = usePracticeTz();
  const now = useNow(tz);
  const todayIso = now.toISODate()!;
  const { data } = useLive(
    async (store) => ({
      appointments: await store.list('appointment', { where: 'folder_id = ?', params: [folder.id] }),
      stats: (await folderStats(store, todayIso)).get(folder.id) ?? null,
    }),
    [folder.id, todayIso],
    ['appointment', 'page'],
  );
  if (!data) return null;
  const archived = folder.status === 'archived';
  const next = nextOccurrence(data.appointments, now);
  const stats = data.stats;

  // The same start as Book next on Today and on the Calendar divider.
  const book = () =>
    void bookingFor(practice.store, folder.id, now).then(
      (d) => onBook({ folderId: folder.id, start: d.start, durationMin: d.durationMin, typeId: d.typeId, location: d.location }),
      () => onBook({ folderId: folder.id }),
    );

  const facts = [
    stats ? tp('folder.sessions', stats.pages) : '',
    stats?.lastPageDate ? t('folder.lastSession', { date: dayMonth(i18n, stats.lastPageDate, todayIso) }) : '',
  ].filter(Boolean);
  if (!next && archived && !facts.length) return null;

  return (
    <View testID="folder-facts" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.lg, rowGap: 2 }}>
      {next ? (
        <T variant="small" tone="secondary">{t('folder.next', { when: dayAndTime(i18n, next.start.setZone(tz), now) })}</T>
      ) : !archived ? (
        <Row gap={space.sm}>
          <T variant="small" tone="muted">{t('folder.nothingBooked')}</T>
          <LinkButton icon="calendar" label={t('folder.book')} accessibilityLabel={t('folder.bookHint')} onPress={book} testID="folder-book" />
        </Row>
      ) : null}
      {facts.length ? <T variant="small" tone="muted">{facts.join(' · ')}</T> : null}
    </View>
  );
}

/** A small text action inside a line of text, such as Book. */
function LinkButton({ icon, label, accessibilityLabel, onPress, testID }: { icon: IconName; label: string; accessibilityLabel?: string; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, borderRadius: radius.sm },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <Icon name={icon} size={14} color={c.accentText} />
      <T variant="small" tone="accent" style={{ fontWeight: '600' }}>{label}</T>
    </Pressable>
  );
}

/**
 * Archiving: the folder leaves the shelf. Offers to end the sessions still booked (series stop,
 * single appointments are cancelled; nothing in the past changes) and to peel "next session"
 * notes, then Undo.
 */
function ArchiveDialog({ visible, onClose, folder }: { visible: boolean; onClose: () => void; folder: Folder }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const toast = useToast();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const [endSessions, setEndSessions] = useState(true);
  const [peelNotes, setPeelNotes] = useState(true);
  const { data } = useLive(
    async (store) =>
      visible
        ? {
            appointments: await store.list('appointment', { where: 'folder_id = ?', params: [folder.id] }),
            notes: await nextSessionNotes(store, folder.id),
          }
        : null,
    [folder.id, visible],
    ['appointment', 'sticky'],
  );
  useEffect(() => {
    if (!visible) return;
    setEndSessions(true);
    setPeelNotes(true);
  }, [visible]);

  const future = data ? futureAppointments(data.appointments, now) : { series: [], singles: [] };
  const hasFuture = future.series.length + future.singles.length > 0;
  const notes = data?.notes.length ?? 0;

  async function archive() {
    const undo = await archiveFolder(practice.store, folder.id, { endSessions: endSessions && hasFuture, peelNotes: peelNotes && notes > 0 });
    toast.undo(t('folder.archived'), async () => undoneExcept(toast, i18n, await undoArchive(practice.store, undo)));
  }

  return (
    <ConfirmDialog
      visible={visible}
      title={t('folder.archiveTitle')}
      message={t('folder.archiveBody')}
      confirmLabel={t('folder.archive')}
      confirmIcon="archive"
      onClose={onClose}
      onConfirm={archive}
      width={480}
      testID="archive-dialog"
    >
      {hasFuture ? (
        <Checkbox checked={endSessions} onChange={setEndSessions} label={t('folder.archiveEnd')} hint={describeFuture(i18n, future.series, future.singles.length)} testID="archive-end" />
      ) : null}
      {notes ? <Checkbox checked={peelNotes} onChange={setPeelNotes} label={tp('folder.archivePeel', notes)} testID="archive-peel" /> : null}
    </ConfirmDialog>
  );
}
