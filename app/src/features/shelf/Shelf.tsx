import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { DateTime } from 'luxon';
import { HelpButton } from '../../shell/HelpButton';
import type { Occurrence } from '../../core/calendar/occurrences';
import type { Folder, Sticky } from '../../core/model/types';
import { type FolderStats, folderStats } from '../../services/folderStats';
import { nextSessionByFolder, stuckOnCovers } from '../../services/queries';
import { type FolderResult, searchAll, tokenize } from '../../services/search';
import { getSetting, setSetting, SETTING } from '../../services/settings';
import { usePractice } from '../../shell/AppState';
import { type Route, useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { ariaState, Badge, Button, Col, EmptyState, Field, focusRing, Row, Screen, SectionTitle, Segmented, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';
import { FolderDialog } from '../common/FolderDialog';
import { FolderAvatar } from '../common/FolderPicture';
import { Highlight } from '../common/Highlight';
import { usePracticeTz, useNow, useSettledText } from '../common/hooks';
import { elapsedSince, formatElapsed, isShelfSort, type ShelfSort, sortFolders, tagsOf } from './shelfModel';

/** How long the shelf waits after the last key before writing its search into its route. */
const ROUTE_DELAY_MS = 300;

/**
 * Keeps the shelf's search, tag and archive choice in its own place in the history, so Back
 * from a folder finds the shelf as it was left. Written a moment after typing stops, and at
 * once when the shelf is left.
 */
function useRememberedFilters(state: { q: string; tag: string | null; archived: boolean }) {
  const { update, routeKey } = useRouter();
  const route: Route = { name: 'shelf', archived: state.archived || undefined, q: state.q.trim() ? state.q : undefined, tag: state.tag ?? undefined };
  const latest = useRef(route);
  latest.current = route;
  const key = useRef(routeKey);
  const id = JSON.stringify(route);
  useEffect(() => {
    const timer = setTimeout(() => update(key.current, latest.current), ROUTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [id, update]);
  useEffect(() => () => update(key.current, latest.current), [update]);
}

export function Shelf({ archived: initialArchived = false, q: initialQ, tag: initialTag }: { archived?: boolean; q?: string; tag?: string }) {
  const i18n = useI18n();
  const { t, tp } = i18n;
  const practice = usePractice();
  const { go } = useRouter();
  const tz = usePracticeTz();
  const now = useNow(tz);
  const [q, setQ] = useState(initialQ ?? '');
  const [archived, setArchived] = useState(initialArchived);
  const [tag, setTag] = useState<string | null>(initialTag ?? null);
  const [sortChoice, setSortChoice] = useState<ShelfSort | null>(null);
  const [creating, setCreating] = useState(false);
  useRememberedFilters({ q, tag, archived });

  const collator = useMemo(() => new Intl.Collator(i18n.meta.bcp47, { sensitivity: 'base' }), [i18n.meta.bcp47]);

  const { data: savedSort } = useLive((store) => getSetting<unknown>(store, SETTING.shelfSort, 'name'), [], ['setting']);
  const sort: ShelfSort = sortChoice ?? (isShelfSort(savedSort) ? savedSort : 'name');
  const chooseSort = (v: ShelfSort) => {
    setSortChoice(v);
    void setSetting(practice.store, SETTING.shelfSort, v).catch((e) => console.error(e));
  };

  // Results follow what is typed once typing pauses; Enter before they arrive waits for them.
  const query = useSettledText(q);
  const { data } = useLive(
    async (store) => {
      const [found, shelf, notes, next, stats] = await Promise.all([
        searchAll(store, query, { archived }),
        store.list('folder', { where: 'status = ?', params: [archived ? 'archived' : 'active'] }),
        stuckOnCovers(store),
        nextSessionByFolder(store, now),
        folderStats(store, now.toISODate()!),
      ]);
      const onShelf = shelf.filter((f) => !f.merged_into);
      return { found, archived, tags: tagsOf(onShelf, collator.compare), total: onShelf.length, notes, next, stats };
    },
    [query, archived, now.toISODate(), collator],
    ['folder', 'sticky', 'appointment', 'page', 'attachment'],
  );

  // A tag whose last folder went away (or that is not on this side of the shelf) filters nothing.
  const activeTag = tag && data?.tags.includes(tag) ? tag : null;
  useEffect(() => {
    if (data && tag && !data.tags.includes(tag)) setTag(null);
  }, [data, tag]);

  const searching = (data?.found.tokens.length ?? 0) > 0;
  const withTag = (r: FolderResult) => !activeTag || r.folder.tags.includes(activeTag);
  // While searching, the best matches lead (a folder named by the words before one found through
  // a cover note), in the order chosen among equals. Find puts them first too.
  const cards = useMemo(() => {
    if (!data) return [];
    const direct = data.found.folders.filter((r) => r.direct && withTag(r));
    const ranks = new Map(direct.map((r) => [r.folder.id, r.rank]));
    return sortFolders(direct.map((r) => r.folder), sort, {
      nextAt: (id) => data.next.get(id)?.start.toMillis(),
      stats: data.stats,
      compare: collator.compare,
      rank: (id) => ranks.get(id) ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort, activeTag, collator]);
  const groups = useMemo(
    () => (data && searching ? data.found.folders.filter((r) => (r.pages.length || r.documents.length) && withTag(r)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, searching, activeTag],
  );

  const openFolder = (f: Folder) => go({ name: 'folder', id: f.id });
  const openFirstHit = (r: FolderResult) => {
    const page = r.pages[0];
    if (page) go({ name: 'folder', id: r.folder.id, tab: 'pages', pageId: page.page.id });
    else go({ name: 'folder', id: r.folder.id, tab: 'documents' });
  };
  // Enter in the search field: the first folder, or else the first page or document found. The
  // results arrive a moment after each key; an Enter pressed before waits for them. With nothing
  // typed, Enter opens nothing.
  const fresh = !!data && data.archived === archived && data.found.tokens.join(' ') === tokenize(q).join(' ');
  const openFirst = () => {
    if (!searching) return;
    if (cards[0]) openFolder(cards[0]);
    else if (groups[0]) openFirstHit(groups[0]);
  };
  const enterWaiting = useRef(false);
  useEffect(() => {
    if (!fresh || !enterWaiting.current) return;
    enterWaiting.current = false;
    openFirst();
  });
  const submit = () => {
    enterWaiting.current = false;
    if (!tokenize(q).length) return;
    if (fresh) openFirst();
    else enterWaiting.current = true;
  };

  // Only when nothing matches at all: matches on the other side of the shelf show as a button.
  const nothing = !!data && searching && !cards.length && !groups.length && !data.found.elsewhere;

  return (
    <Screen
      title={t('shelf.title')}
      testID="screen-shelf"
      actions={<><HelpButton topic="shelf" /><Button variant="primary" icon="plus" label={t('shelf.newFolder')} onPress={() => setCreating(true)} testID="new-folder" /></>}
    >
      <Row wrap gap={space.md}>
        <Field
          style={{ flex: 1, minWidth: 260 }}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={submit}
          placeholder={t('shelf.searchPlaceholder')}
          accessibilityLabel={t('common.search')}
          autoFocus={initialQ !== undefined}
          testID="shelf-search"
        />
        <Segmented
          label={t('shelf.title')}
          value={archived ? 'archived' : 'active'}
          onChange={(v) => setArchived(v === 'archived')}
          options={[
            { value: 'active', label: t('shelf.active') },
            { value: 'archived', label: t('shelf.archived') },
          ]}
        />
        <Segmented
          label={t('shelf.sort')}
          value={sort}
          onChange={chooseSort}
          options={[
            { value: 'name', label: t('shelf.sortName') },
            { value: 'recent', label: t('shelf.sortRecent') },
            { value: 'next', label: t('shelf.sortNext') },
          ]}
        />
      </Row>
      {data?.tags.length ? (
        <Row wrap gap={space.xs}>
          <TagChip label={t('shelf.allTags')} active={activeTag === null} onPress={() => setTag(null)} />
          {data.tags.map((tg) => (
            <TagChip key={tg} label={`#${tg}`} active={activeTag === tg} onPress={() => setTag(activeTag === tg ? null : tg)} />
          ))}
        </Row>
      ) : null}
      {data && savedSort !== undefined && (!searching || cards.length > 0) ? <T variant="small" tone="muted">{tp('shelf.count', cards.length)}</T> : null}

      {data && data.total === 0 && !searching ? (
        archived ? (
          <EmptyState icon="archive" title={t('shelf.emptyArchive')} />
        ) : (
          <EmptyState
            icon="folder"
            title={t('shelf.empty')}
            body={t('shelf.emptyBody')}
            action={
              <Row>
                <Button variant="primary" icon="plus" label={t('shelf.newFolder')} onPress={() => setCreating(true)} />
                <Button icon="import" label={t('nav.import')} onPress={() => go({ name: 'import' })} />
              </Row>
            }
          />
        )
      ) : null}
      {nothing ? (
        <View testID="shelf-nothing">
          <T tone="secondary">{t('shelf.noResults', { q: q.trim() })}</T>
        </View>
      ) : null}

      {data && savedSort !== undefined ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          {cards.map((f) => (
            <FolderCard
              key={f.id}
              folder={f}
              notes={data.notes.get(f.id) ?? []}
              next={data.next.get(f.id)}
              stats={data.stats.get(f.id)}
              today={now.toISODate()!}
              tz={tz}
              onPress={() => openFolder(f)}
            />
          ))}
        </View>
      ) : null}

      {groups.length ? (
        <Col gap={space.md}>
          <SectionTitle>{t('shelf.inNotes')}</SectionTitle>
          {groups.map((r) => (
            <HitGroup key={r.folder.id} result={r} tz={tz} />
          ))}
        </Col>
      ) : null}

      {data && searching && data.found.elsewhere > 0 ? (
        <Row>
          <Button
            small
            variant="ghost"
            icon={archived ? 'folder' : 'archive'}
            label={t(archived ? 'shelf.alsoInActive' : 'shelf.alsoInArchive', { n: data.found.elsewhere })}
            onPress={() => setArchived(!archived)}
            testID="shelf-elsewhere"
          />
        </Row>
      ) : null}

      <FolderDialog visible={creating} onClose={() => setCreating(false)} onSaved={(f) => go({ name: 'folder', id: f.id })} />
    </Screen>
  );
}

/** One patient's pages and documents that match, under their name. */
function HitGroup({ result, tz }: { result: FolderResult; tz: string }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { go } = useRouter();
  const { folder } = result;
  const shown = 3;
  const pages = result.pages.slice(0, shown);
  const docs = result.documents.slice(0, Math.max(0, shown - pages.length));
  const more = result.pages.length + result.documents.length - pages.length - docs.length;
  return (
    <View style={{ gap: 2 }} testID={`hit-group-${folder.label}`}>
      <HitRow onPress={() => go({ name: 'folder', id: folder.id })} label={folder.label}>
        <FolderAvatar folder={folder} size={28} />
        <T variant="label" numberOfLines={1} style={{ flex: 1 }}>{folder.label}</T>
      </HitRow>
      {pages.map(({ page, excerpt }) => {
        const date = i18n.date(DateTime.fromISO(page.date, { zone: tz }), 'medium');
        return (
          <HitRow
            key={page.id}
            indent
            label={`${folder.label}. ${t('shelf.pageOf', { date })}: ${excerpt.text}`}
            onPress={() => go({ name: 'folder', id: folder.id, tab: 'pages', pageId: page.id })}
          >
            <HitIcon name="page" />
            <T variant="small" style={{ width: 104 }}>{date}</T>
            <Highlight excerpt={excerpt} numberOfLines={2} style={{ flex: 1 }} />
          </HitRow>
        );
      })}
      {docs.map(({ attachment, name, text }) => (
        <HitRow
          key={attachment.id}
          indent
          label={`${folder.label}. ${attachment.filename}${text ? `: ${text.text}` : ''}`}
          onPress={() => go({ name: 'folder', id: folder.id, tab: 'documents' })}
        >
          <HitIcon name="paperclip" />
          <Highlight excerpt={name} variant="small" tone="primary" numberOfLines={1} style={{ width: 104 }} />
          {text ? <Highlight excerpt={text} numberOfLines={2} style={{ flex: 1 }} /> : <View style={{ flex: 1 }} />}
        </HitRow>
      ))}
      {more > 0 ? (
        <HitRow indent label={`${folder.label}: ${t('shelf.moreNotes', { n: more })}`} onPress={() => go({ name: 'folder', id: folder.id })}>
          <View style={{ width: 16 }} />
          <T variant="small" tone="accent">{t('shelf.moreNotes', { n: more })}</T>
        </HitRow>
      ) : null}
    </View>
  );
}

function HitIcon({ name }: { name: IconName }) {
  const { c } = useTheme();
  return <Icon name={name} size={16} color={c.textSecondary} />;
}

function HitRow({ children, onPress, label, indent }: { children: React.ReactNode; onPress: () => void; label: string; indent?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={(s) => [
        { flexDirection: 'row', gap: space.md, paddingVertical: 6, paddingHorizontal: space.sm, borderRadius: radius.md, alignItems: 'center', marginLeft: indent ? 36 : 0 },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      {children}
    </Pressable>
  );
}

function TagChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...ariaState({ pressed: active })}
      accessibilityState={{ selected: active }} // phones; the web reads aria-pressed
      style={(s) => [
        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: active ? c.primary : c.border, backgroundColor: active ? c.primarySubtle : 'transparent' },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <T variant="small" tone={active ? 'primary' : 'secondary'}>{label}</T>
    </Pressable>
  );
}

export function FolderCard({
  folder, notes, next, stats, today, tz, onPress,
}: {
  folder: Folder;
  notes: Sticky[];
  next?: Occurrence;
  stats?: FolderStats;
  /** Today's date in the practice's time zone. */
  today: string;
  tz: string;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const tab = c.folder[folder.colour];
  const shown = notes.slice(0, 2);
  const nextText = next ? t('shelf.nextSession', { when: `${i18n.date(next.start.setZone(tz), 'weekday')} ${i18n.time(next.start.setZone(tz))}` }) : t('shelf.noNextSession');
  const ago = stats?.lastPageDate ? elapsedSince(stats.lastPageDate, today) : null;
  const seenText = ago ? t('shelf.lastSeen', { when: formatElapsed(ago, i18n.meta.bcp47) }) : null;
  const name = [
    folder.label,
    folder.loop_vault_id ? t('loop.linkedMark') : null,
    nextText,
    seenText,
    notes.length ? tp('shelf.stickyCount', notes.length) : null,
  ].filter(Boolean).join('. ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={name}
      testID={`folder-card-${folder.label}`}
      style={(s) => {
        const { hovered, focused } = s as { hovered?: boolean; focused?: boolean };
        return [{ width: 236 }, web({ cursor: 'pointer', transform: hovered ? 'translateY(-2px)' : 'none', transitionDuration: '120ms' }), focused && focusRing(c.focus)];
      }}
    >
      {/* The tab */}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ backgroundColor: tab, height: 14, width: 96, borderTopLeftRadius: 8, borderTopRightRadius: 8, marginLeft: 10 }} />
      </View>
      <View style={[{ backgroundColor: c.surface, borderRadius: radius.md, borderTopWidth: 4, borderTopColor: tab, borderWidth: 1, borderColor: c.border, padding: space.md, minHeight: 176, gap: space.sm }, web({ boxShadow: `0 1px 2px ${c.shadow}` })]}>
        <Row gap={space.sm}>
          <FolderAvatar folder={folder} size={40} />
          <T variant="heading" numberOfLines={2} style={{ flex: 1 }}>{folder.label}</T>
          {folder.loop_vault_id ? <T variant="small" tone="accent">◆</T> : null}
        </Row>
        {folder.cover_note ? <T variant="tiny" tone="muted" numberOfLines={1}>{folder.cover_note}</T> : null}
        <View style={{ gap: 6, flex: 1 }}>
          {shown.map((n) => (
            <View key={n.id} style={{ backgroundColor: c.sticky[n.colour].bg, borderRadius: 2, paddingHorizontal: 6, paddingVertical: 4, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
              {n.next_session ? <Icon name="clock" size={11} color={c.sticky[n.colour].text} /> : null}
              <T variant="tiny" numberOfLines={1} style={{ color: c.sticky[n.colour].text, flex: 1 }}>{n.text}</T>
            </View>
          ))}
          {notes.length > 2 ? <T variant="tiny" tone="muted">{t('shelf.moreNotes', { n: notes.length - 2 })}</T> : null}
        </View>
        <Row gap={space.xs} wrap>
          {folder.tags.slice(0, 3).map((tg) => (
            <Badge key={tg} tone="neutral" label={tg} />
          ))}
        </Row>
        <Col gap={2}>
          <Row gap={6}>
            <Icon name="calendar" size={13} color={c.textMuted} />
            <T variant="tiny" tone="muted">{nextText}</T>
          </Row>
          {seenText ? (
            <Row gap={6}>
              <Icon name="page" size={13} color={c.textMuted} />
              <T variant="tiny" tone="muted">{seenText}</T>
            </Row>
          ) : null}
        </Col>
      </View>
    </Pressable>
  );
}
