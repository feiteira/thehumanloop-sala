import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native';
import { DateTime } from 'luxon';
import type { Occurrence } from '../core/calendar/occurrences';
import type { Folder } from '../core/model/types';
import { AppointmentDialog } from '../features/calendar/AppointmentDialog';
import { FolderDialog } from '../features/common/FolderDialog';
import { FolderAvatar } from '../features/common/FolderPicture';
import { Highlight } from '../features/common/Highlight';
import { usePracticeTz, useNow, useSettledText } from '../features/common/hooks';
import { lastUsed } from '../features/shelf/shelfModel';
import { backupStatus } from '../services/data';
import { folderStats } from '../services/folderStats';
import { folderMap, nextSessionByFolder, occurrencesOn } from '../services/queries';
import { type FolderResult, matchesAll, searchAll, tokenize } from '../services/search';
import { useI18n } from '../ui/i18n';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { focusRing, IconButton, T, web } from '../ui/primitives';
import { useToast } from '../ui/Toast';
import { radius, space, type as typo, useTheme } from '../ui/theme';
import { useAppState, usePractice } from './AppState';
import { useBackup } from './BackupProvider';
import { helpTopicFor } from './helpTopic';
import { useKeyLabel } from './keys';
import { useRouter } from './router';
import { useLive } from './useLive';

// Find (Ctrl+K or Ctrl+F, from anywhere): one field to reach a folder, a page, today's
// sessions or an action. ↑/↓ choose, Enter opens, Esc closes.

type Item =
  | { kind: 'session'; key: string; occ: Occurrence; folder: Folder | null; label: string }
  | { kind: 'folder'; key: string; folder: Folder; result: FolderResult | null; next?: Occurrence }
  | { kind: 'action'; key: string; icon: IconName; label: string; shortcut?: string; run: () => void }
  | { kind: 'shelf'; key: string; icon: IconName; label: string; archived: boolean };

interface Section {
  title: string | null;
  items: Item[];
}

const NO_WORDS: string[] = [];
const MAX_FOLDERS = 6;
const MAX_SESSIONS = 8;
const RECENT = 5;

/** `onGone`: called once the box has left the screen, to hand the focus back. */
export function QuickOpen({ open, onClose, onGone }: { open: boolean; onClose: () => void; onGone?: () => void }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { c } = useTheme();
  const { route, go } = useRouter();
  const { lock, example } = useAppState();
  const backup = useBackup();
  const practice = usePractice();
  const toast = useToast();
  const key = useKeyLabel();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [dialog, setDialog] = useState<'folder' | 'appointment' | null>(null);
  // A new appointment asked for from inside a folder is for that folder.
  const [apptDefaults, setApptDefaults] = useState<{ folderId: string } | undefined>(undefined);
  // A dialog chosen in Find opens once Find has left the screen. Opened together, Find's focus
  // trap, letting go, took the focus from the dialog's first field (and the first space typed
  // then pressed its Close button).
  const pendingDialog = useRef<'folder' | 'appointment' | null>(null);
  const gone = () => {
    const next = pendingDialog.current;
    pendingDialog.current = null;
    if (next) setDialog(next);
    else onGone?.();
  };
  // Closing that dialog hands the focus back as Find would have, once the dialog has left the
  // page (until then the focus is still inside it, and the shell leaves it alone).
  const dialogGone = () => {
    setDialog(null);
    setTimeout(() => onGone?.(), 0);
  };

  useEffect(() => {
    if (!open) return;
    setQ('');
    setActive(0);
    enterWaiting.current = false;
  }, [open]);

  // Results follow what is typed once typing pauses; Enter before they arrive waits for them.
  const query = useSettledText(q);
  const { data } = useLive(
    async (store) => {
      if (!open) return null;
      const blank = !tokenize(query).length;
      const [found, occ, next, stats, folders] = await Promise.all([
        searchAll(store, query),
        occurrencesOn(store, now.startOf('day')),
        nextSessionByFolder(store, now),
        blank ? folderStats(store) : Promise.resolve(null),
        folderMap(store),
      ]);
      return { found, occ, next, stats, folders };
    },
    [open, query, now.toISODate()],
    ['folder', 'page', 'sticky', 'appointment', 'attachment'],
  );

  const tokens = data?.found.tokens ?? NO_WORDS;
  // The list on screen belongs to what is typed (results arrive a moment after each key).
  const fresh = !!data && tokens.join(' ') === tokenize(q).join(' ');

  const actions = useMemo(() => {
    const list: Extract<Item, { kind: 'action' }>[] = [
      { kind: 'action', key: 'today', icon: 'today', label: t('nav.today'), shortcut: key('1'), run: () => go({ name: 'today' }) },
      { kind: 'action', key: 'shelf', icon: 'shelf', label: t('nav.shelf'), shortcut: key('2'), run: () => go({ name: 'shelf' }) },
      { kind: 'action', key: 'calendar', icon: 'calendar', label: t('nav.calendar'), shortcut: key('3'), run: () => go({ name: 'calendar' }) },
      { kind: 'action', key: 'new-folder', icon: 'plus', label: t('nav.finder.newFolder'), run: () => (pendingDialog.current = 'folder') },
      {
        kind: 'action', key: 'new-appointment', icon: 'plus', label: t('nav.finder.newAppointment'),
        run: () => {
          setApptDefaults(route.name === 'folder' ? { folderId: route.id } : undefined);
          pendingDialog.current = 'appointment';
        },
      },
      ...(example
        ? []
        : [{ kind: 'action' as const, key: 'backup', icon: 'backup' as const, label: t('nav.finder.backupNow'), run: () => void backUp() }]),
      { kind: 'action', key: 'settings', icon: 'settings', label: t('nav.settings'), run: () => go({ name: 'settings' }) },
      { kind: 'action', key: 'help', icon: 'help', label: t('nav.help'), shortcut: 'F1', run: () => go({ name: 'help', topic: helpTopicFor(route) ?? undefined }) },
      { kind: 'action', key: 'lock', icon: 'lock', label: t('nav.lock'), shortcut: key('L'), run: () => void lock() },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, key, go, lock, example, route]);

  // Read when the action runs: the list of actions is made once per screen.
  const backupNow = useRef(backup);
  backupNow.current = backup;
  async function backUp() {
    const { running, status, runNow } = backupNow.current;
    if (running) {
      toast.show({ message: t('nav.finder.backupRunning') });
      return;
    }
    // Right after unlocking the status may not be read yet; it is read here then.
    const folder = (status ?? (await backupStatus(practice))).folder;
    if (!folder) {
      go({ name: 'settings', section: 'backup' });
      return;
    }
    if (await runNow()) {
      toast.show({ message: t('nav.finder.backupDone') });
      return;
    }
    // Not run: either it failed (and says why in Settings), or another backup had just started.
    const failed = !!(await backupStatus(practice)).lastError;
    toast.show({ message: t(failed ? 'nav.finder.backupFailed' : 'nav.finder.backupRunning') });
  }

  const sections = useMemo((): Section[] => {
    if (!data) return [];
    const labelOf = (o: Occurrence) => (o.appointment.folder_id ? data.folders.get(o.appointment.folder_id)?.label : o.appointment.title) || '—';
    const sessions = [...data.occ]
      .sort((a, b) => a.start.toMillis() - b.start.toMillis())
      .map((occ): Item => {
        const folder = occ.appointment.folder_id ? (data.folders.get(occ.appointment.folder_id) ?? null) : null;
        return { kind: 'session', key: `s-${occ.appointment.id}-${occ.date}`, occ, folder, label: labelOf(occ) };
      });
    const folderItem = (r: FolderResult): Item => ({ kind: 'folder', key: `f-${r.folder.id}`, folder: r.folder, result: r, next: data.next.get(r.folder.id) });
    if (!tokens.length) {
      const stats = data.stats ?? new Map();
      const recent = data.found.folders
        .map((r) => r.folder)
        .sort((a, b) => lastUsed(b, stats.get(b.id)).localeCompare(lastUsed(a, stats.get(a.id))))
        .slice(0, RECENT)
        .map((folder): Item => ({ kind: 'folder', key: `f-${folder.id}`, folder, result: null, next: data.next.get(folder.id) }));
      return [
        { title: t('nav.today'), items: sessions.slice(0, MAX_SESSIONS) },
        { title: t('nav.finder.recent'), items: recent },
        { title: t('nav.finder.actions'), items: actions },
      ].filter((s) => s.items.length);
    }
    const shelf: Item[] = [{ kind: 'shelf', key: 'search-notes', icon: 'search', label: t('nav.finder.searchNotes', { q: q.trim() }), archived: false }];
    if (data.found.elsewhere) shelf.push({ kind: 'shelf', key: 'search-archive', icon: 'archive', label: t('nav.finder.inArchive', { n: data.found.elsewhere }), archived: true });
    const folders = data.found.folders.slice(0, MAX_FOLDERS).map(folderItem);
    const todays = sessions.filter((s) => s.kind === 'session' && matchesAll(s.label, tokens)).slice(0, MAX_SESSIONS);
    const acts = actions.filter((a) => matchesAll(a.label, tokens));
    const found = folders.length + todays.length + acts.length;
    return [
      { title: t('nav.finder.folders'), items: folders },
      { title: t('nav.today'), items: todays },
      { title: t('nav.finder.actions'), items: acts },
      { title: null, items: found || data.found.elsewhere ? shelf : [] },
    ].filter((s) => s.items.length);
  }, [data, tokens, actions, q, t]);

  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const count = items.filter((i) => i.kind !== 'shelf').length;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (active >= items.length && items.length) setActive(items.length - 1);
  }, [active, items.length]);

  // Enter pressed before the results for the last key arrived opens the first of those results.
  const enterWaiting = useRef(false);
  useEffect(() => {
    if (!fresh || !enterWaiting.current) return;
    enterWaiting.current = false;
    run(items[0]);
  });

  function run(item: Item | undefined) {
    if (!item) return;
    onClose();
    switch (item.kind) {
      case 'session':
        if (item.folder) go({ name: 'folder', id: item.folder.id });
        else go({ name: 'calendar', date: item.occ.date, view: 'day' });
        return;
      case 'folder': {
        const r = item.result;
        if (!r || r.direct) go({ name: 'folder', id: item.folder.id });
        else if (r.pages[0]) go({ name: 'folder', id: item.folder.id, tab: 'pages', pageId: r.pages[0].page.id });
        else go({ name: 'folder', id: item.folder.id, tab: 'documents' });
        return;
      }
      case 'action':
        item.run();
        return;
      case 'shelf':
        go({ name: 'shelf', q: q.trim(), archived: item.archived || undefined });
    }
  }

  // Keeps the chosen row in view while ↑/↓ move through the list.
  const scroll = useRef<ScrollView>(null);
  const view = useRef({ y: 0, h: 0 });
  const groupY = useRef(new Map<number, number>());
  const rowBox = useRef(new Map<number, { y: number; h: number; group: number }>());
  useEffect(() => {
    const box = rowBox.current.get(active);
    if (!box) return;
    const top = (groupY.current.get(box.group) ?? 0) + box.y;
    const { y, h } = view.current;
    if (top < y) scroll.current?.scrollTo({ y: Math.max(0, top - space.sm), animated: false });
    else if (top + box.h > y + h) scroll.current?.scrollTo({ y: top + box.h - h + space.sm, animated: false });
  }, [active]);

  const onKey = (e: NativeSyntheticEvent<TextInputKeyPressEventData & { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }>) => {
    const k = e.nativeEvent;
    if (k.altKey) return;
    const n = items.length;
    if ((k.ctrlKey || k.metaKey) && (k.key === 'k' || k.key === 'K')) {
      e.preventDefault();
      onClose();
      return;
    }
    if (k.ctrlKey || k.metaKey) return;
    if (k.key === 'ArrowDown' && n) {
      e.preventDefault();
      setActive((a) => (a + 1) % n);
    } else if (k.key === 'ArrowUp' && n) {
      e.preventDefault();
      setActive((a) => (a - 1 + n) % n);
    } else if (k.key === 'Enter' && !k.shiftKey) {
      e.preventDefault();
      if (fresh) run(items[active]);
      else enterWaiting.current = true;
    }
  };

  let index = 0;
  return (
    <>
      <Modal transparent visible={open} animationType="none" onRequestClose={onClose} onDismiss={gone}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, alignItems: 'center', paddingHorizontal: space.xl, paddingTop: '9%' as unknown as number }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} focusable={false} {...({ 'aria-hidden': true } as object)} />
          <View
            role="dialog"
            accessibilityLabel={t('nav.find')}
            testID="quick-open"
            {...({ 'aria-modal': true } as object)}
            style={[
              { backgroundColor: c.surface, borderRadius: radius.lg, width: 640, maxWidth: '100%', maxHeight: '82%', borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
              web({ boxShadow: `0 12px 40px ${c.shadow}` }),
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.divider }}>
              <Icon name="search" size={20} color={c.textSecondary} />
              <TextInput
                autoFocus
                value={q}
                onChangeText={setQ}
                onKeyPress={onKey}
                placeholder={t('nav.finder.placeholder')}
                placeholderTextColor={c.textMuted}
                accessibilityLabel={t('nav.find')}
                testID="quick-open-input"
                {...({
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': 'quick-open-list',
                  'aria-autocomplete': 'list',
                  'aria-activedescendant': items.length ? `quick-open-${active}` : undefined,
                } as object)}
                style={[typo.heading, { flex: 1, color: c.text, paddingVertical: space.sm, fontWeight: '400' }, web({ outlineStyle: 'none' })]}
              />
              <IconButton icon="close" label={t('common.close')} onPress={onClose} testID="quick-open-close" />
            </View>

            <ScrollView
              ref={scroll}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ padding: space.sm, gap: space.xs }}
              keyboardShouldPersistTaps="handled"
              onLayout={(e) => (view.current.h = e.nativeEvent.layout.height)}
              onScroll={(e) => (view.current.y = e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={32}
            >
              <View nativeID="quick-open-list" accessibilityLabel={t('nav.find')} {...({ role: 'listbox' } as object)}>
                {data && tokens.length > 0 && count === 0 && !data.found.elsewhere ? (
                  <View style={{ padding: space.md }}>
                    <T tone="secondary">{t('nav.finder.nothing', { q: q.trim() })}</T>
                  </View>
                ) : null}
                {sections.map((s, si) => (
                  <View key={si} role="group" accessibilityLabel={s.title ?? undefined} onLayout={(e) => groupY.current.set(si, e.nativeEvent.layout.y)} style={{ paddingBottom: space.xs }}>
                    {s.title ? (
                      <T variant="tiny" tone="secondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600', paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xs }}>
                        {s.title}
                      </T>
                    ) : (
                      <View style={{ height: 1, backgroundColor: c.divider, marginVertical: space.xs }} />
                    )}
                    {s.items.map((item) => {
                      const i = index++;
                      return (
                        <Row
                          key={item.key}
                          i={i}
                          active={i === active}
                          onHover={() => setActive(i)}
                          onPress={() => run(item)}
                          onLayout={(y, h) => rowBox.current.set(i, { y, h, group: si })}
                          label={rowLabel(item)}
                          testID={`quick-open-${item.key}`}
                        >
                          <RowBody item={item} tz={tz} />
                        </Row>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.surfaceAlt }}>
              <T variant="tiny" tone="secondary" style={{ flexShrink: 1 }}>{t('nav.finder.keys')}</T>
              <Pressable
                onPress={() => {
                  onClose();
                  go({ name: 'help', topic: 'shortcuts' });
                }}
                accessibilityRole="link"
                testID="quick-open-shortcuts"
                style={(s) => [{ borderRadius: radius.sm, paddingHorizontal: 4 }, (s as { focused?: boolean }).focused && focusRing(c.focus), web({ cursor: 'pointer' })]}
              >
                <T variant="tiny" tone="accent" style={{ textDecorationLine: 'underline' }}>{t('nav.finder.allShortcuts')}</T>
              </Pressable>
            </View>
            {/* Read out as the list changes: how many things were found. */}
            <View aria-live="polite" style={HIDDEN}>
              {data && tokens.length ? <T>{tp('nav.finder.results', count)}</T> : null}
            </View>
          </View>
        </View>
      </Modal>

      <FolderDialog visible={dialog === 'folder'} onClose={dialogGone} onSaved={(f) => go({ name: 'folder', id: f.id })} />
      <AppointmentDialog visible={dialog === 'appointment'} onClose={dialogGone} appointment={null} defaults={apptDefaults} />
    </>
  );

  function rowLabel(item: Item): string {
    switch (item.kind) {
      case 'session':
        return `${i18n.time(item.occ.start.setZone(tz))} ${item.label}`;
      case 'folder':
        return item.folder.label;
      case 'action':
        return item.label;
      case 'shelf':
        return item.label;
    }
  }
}

const HIDDEN = { position: 'absolute' as const, width: 1, height: 1, overflow: 'hidden' as const, opacity: 0, left: -10000 };

function Row({
  i, active, onHover, onPress, onLayout, label, testID, children,
}: {
  i: number;
  active: boolean;
  onHover: () => void;
  onPress: () => void;
  onLayout: (y: number, h: number) => void;
  label: string;
  testID: string;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      nativeID={`quick-open-${i}`}
      role="option"
      aria-selected={active}
      accessibilityLabel={label}
      focusable={false}
      onPress={onPress}
      onHoverIn={onHover}
      onLayout={(e) => onLayout(e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
      testID={testID}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.sm, paddingVertical: 7, borderRadius: radius.md, borderLeftWidth: 3 },
        { backgroundColor: active ? c.primarySubtle : 'transparent', borderLeftColor: active ? c.primary : 'transparent' },
        web({ cursor: 'pointer' }),
      ]}
    >
      {children}
      {/* The chosen row also shows the key that opens it, so it is not marked by colour alone. */}
      <View style={{ width: 22, alignItems: 'flex-end' }}>{active ? <T variant="small" tone="secondary">↵</T> : null}</View>
    </Pressable>
  );
}

function RowBody({ item, tz }: { item: Item; tz: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  switch (item.kind) {
    case 'session':
      return (
        <>
          <T variant="small" tone="secondary" style={{ width: 44, fontVariant: ['tabular-nums'] }}>{i18n.time(item.occ.start.setZone(tz))}</T>
          {item.folder ? <FolderAvatar folder={item.folder} size={26} /> : <IconSlot icon="calendar" />}
          <T numberOfLines={1} style={{ flex: 1 }}>{item.label}</T>
        </>
      );
    case 'folder': {
      const r = item.result;
      let second: React.ReactNode = null;
      if (r?.detail) second = <Highlight excerpt={r.detail.excerpt} variant="tiny" numberOfLines={1} />;
      else if (r && !r.direct && r.pages[0]) {
        const date = i18n.date(DateTime.fromISO(r.pages[0].page.date, { zone: tz }), 'medium');
        second = (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Icon name="page" size={12} color={c.textMuted} />
            <T variant="tiny" tone="secondary">{date}</T>
            <Highlight excerpt={r.pages[0].excerpt} variant="tiny" numberOfLines={1} style={{ flex: 1 }} />
          </View>
        );
      } else if (r && !r.direct && r.documents[0]) {
        const d = r.documents[0];
        second = (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Icon name="paperclip" size={12} color={c.textMuted} />
            <Highlight excerpt={d.text ?? d.name} variant="tiny" numberOfLines={1} style={{ flex: 1 }} />
          </View>
        );
      } else if (item.next) {
        second = <T variant="tiny" tone="secondary">{t('shelf.nextSession', { when: `${i18n.date(item.next.start.setZone(tz), 'weekday')} ${i18n.time(item.next.start.setZone(tz))}` })}</T>;
      }
      return (
        <>
          <FolderAvatar folder={item.folder} size={30} />
          <View style={{ flex: 1, gap: 1 }}>
            <T numberOfLines={1} style={{ fontWeight: '600' }}>{item.folder.label}</T>
            {second}
          </View>
        </>
      );
    }
    case 'action':
      return (
        <>
          <IconSlot icon={item.icon} />
          <T numberOfLines={1} style={{ flex: 1 }}>{item.label}</T>
          {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
        </>
      );
    case 'shelf':
      return (
        <>
          <IconSlot icon={item.icon} />
          <T numberOfLines={1} tone="secondary" style={{ flex: 1 }}>{item.label}</T>
        </>
      );
  }
}

function IconSlot({ icon }: { icon: IconName }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 30, alignItems: 'center' }}>
      <Icon name={icon} size={18} color={c.textSecondary} />
    </View>
  );
}

/** A key as written on the keyboard. */
export function Kbd({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, borderBottomWidth: 2, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: c.surface }}>
      <T variant="tiny" tone="secondary">{children}</T>
    </View>
  );
}
