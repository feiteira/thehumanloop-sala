import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { cleanTheme, folderThemes, locate, THEME_MAX, themeKey, type ThemeSummary } from '../../core/model/passages';
import { bySectionOrder } from '../../core/model/sections';
import type { Page } from '../../core/model/types';
import { sectionLabel } from '../../services/labels';
import { removeThemeInFolder, renameThemeInFolder, undoThemes } from '../../services/themes';
import { usePractice } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Badge, Button, Col, ConfirmDialog, Dialog, EmptyState, Field, focusRing, Row, T, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { radius, space, useTheme } from '../../ui/theme';
import { sessionDate } from '../common/dates';
import { useNow, usePracticeTz } from '../common/hooks';
import { sessionNumbers } from './pageActions';

const CELL = 18;
const CELL_GAP = 4;
const NAME_WIDTH = 170;

/**
 * The Themes divider: every theme marked on the folder's pages. All themes shows when each
 * comes up, session by session; one theme shows its passages in session order, each opening
 * its page with the words selected.
 */
export function ThemesTab({ folderId }: { folderId: string }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t, tp } = i18n;
  const { c } = useTheme();
  const toast = useToast();
  const todayIso = useNow(usePracticeTz()).toISODate()!;
  const { replace } = useRouter();
  const { data: pages } = useLive((store) => store.list('page', { where: 'folder_id = ?', params: [folderId] }), [folderId], ['page']);
  const [chosen, setChosen] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<ThemeSummary | null>(null);
  const [removing, setRemoving] = useState<ThemeSummary | null>(null);

  const numbers = sessionNumbers(pages ?? []);
  const ordered = [...(pages ?? [])].sort((a, b) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0));
  const themes = folderThemes(ordered, bySectionOrder);
  const current = themes.find((s) => s.key === chosen) ?? null;
  // A theme renamed or removed elsewhere leaves All themes on screen.
  useEffect(() => {
    if (chosen && pages && !current) setChosen(null);
  }, [chosen, pages, current]);

  if (!pages) return null;
  if (!themes.length) return <EmptyState icon="tag" title={t('themes.none')} body={t('themes.noneBody')} />;

  const total = themes.reduce((n, s) => n + s.passages.length, 0);
  const when = (p: Page) => `${t('page.session', { n: numbers.get(p.id) ?? 0 })} · ${sessionDate(i18n, p.date, todayIso)}`;
  const open = (pageId: string, passage: string) => replace({ name: 'folder', id: folderId, tab: 'pages', pageId, passage });

  async function rename(s: ThemeSummary, to: string) {
    const undo = await renameThemeInFolder(practice.store, folderId, s.name, to);
    setChosen(themeKey(to));
    toast.undo(t('themes.renamed'), () => undoThemes(practice.store, undo));
  }

  async function remove(s: ThemeSummary) {
    const undo = await removeThemeInFolder(practice.store, folderId, s.name);
    setChosen(null);
    toast.undo(t('themes.removed'), () => undoThemes(practice.store, undo));
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row' }} testID="themes-tab">
      <View style={{ width: 250, borderRightWidth: 1, borderRightColor: c.border }}>
        <ScrollView contentContainerStyle={{ paddingVertical: space.sm }}>
          <ListRow label={t('themes.all')} detail={tp('themes.passages', total)} active={!current} onPress={() => setChosen(null)} testID="theme-all" />
          {themes.map((s) => (
            <ListRow
              key={s.key}
              label={s.name}
              detail={`${tp('themes.passages', s.passages.length)} · ${tp('folder.sessions', s.pageIds.length)}`}
              active={current?.key === s.key}
              onPress={() => setChosen(s.key)}
              testID={`theme-row-${s.name}`}
            />
          ))}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xxl, maxWidth: 900, gap: space.lg }}>
        {current ? (
          <>
            <Row style={{ justifyContent: 'space-between' }} align="flex-start" wrap>
              <Col gap={2} style={{ flexShrink: 1 }}>
                <T variant="title" role="heading">{current.name}</T>
                <T variant="small" tone="secondary">
                  {[
                    t('themes.inSessions', { n: current.pageIds.length, total: ordered.length }),
                    spanOf(current, ordered, (p) => sessionDate(i18n, p.date, todayIso), t),
                  ].join(' · ')}
                </T>
              </Col>
              <Row gap={space.xs}>
                <Button small icon="edit" label={t('themes.rename')} onPress={() => setRenaming(current)} testID="rename-theme" />
                <Button small icon="trash" label={t('themes.remove')} onPress={() => setRemoving(current)} testID="remove-theme" />
              </Row>
            </Row>
            <SessionStrip
              pages={ordered}
              marked={new Set(current.pageIds)}
              label={t('themes.sessionsWith', { list: current.pageIds.map((id) => numbers.get(id)).join(', ') })}
            />
            {groupByPage(current).map(({ page, passages }) => (
              <Col key={page.id} gap={space.sm}>
                <T variant="label" role="heading">{[when(page), page.title].filter(Boolean).join(' · ')}</T>
                {passages.map((p) => {
                  const gone = !locate(page.sections[p.section] ?? '', p);
                  const words = p.quote.replace(/\s+/g, ' ').trim();
                  const others = p.themes.filter((n) => themeKey(n) !== current.key);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => open(page.id, p.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('themes.open', { n: numbers.get(page.id) ?? 0, quote: words.length > 80 ? `${words.slice(0, 80)}…` : words })}
                      testID="theme-passage"
                      style={(s) => [
                        { gap: 4, borderLeftWidth: 3, borderLeftColor: gone ? c.border : c.accent, paddingLeft: space.md, paddingVertical: space.xs, borderRadius: 2 },
                        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
                        (s as { focused?: boolean }).focused && focusRing(c.focus),
                        web({ cursor: 'pointer' }),
                      ]}
                    >
                      <T tone={gone ? 'muted' : 'primary'} style={{ fontStyle: 'italic' }}>{words}</T>
                      <Row wrap gap={space.xs}>
                        {others.map((n) => (
                          <Badge key={n} tone="info" label={n} />
                        ))}
                        <T variant="tiny" tone="muted">{sectionLabel(i18n, p.section)}</T>
                        {gone ? <T variant="tiny" tone="muted">{t('themes.gone')}</T> : null}
                      </Row>
                    </Pressable>
                  );
                })}
              </Col>
            ))}
          </>
        ) : (
          <>
            <Col gap={2}>
              <T variant="title" role="heading">{t('themes.list')}</T>
              <T variant="small" tone="secondary">{t('themes.overviewHint')}</T>
            </Col>
            <ScrollView horizontal contentContainerStyle={{ paddingBottom: space.sm }}>
              <View style={{ gap: 2 }} testID="themes-overview">
                <Row gap={0}>
                  <View style={{ width: NAME_WIDTH }} />
                  {ordered.map((p, i) => (
                    <View key={p.id} style={{ width: CELL + CELL_GAP }} aria-hidden>
                      {i === 0 || i === ordered.length - 1 || (i + 1) % 5 === 0 ? <T variant="tiny" tone="muted">{String(i + 1)}</T> : null}
                    </View>
                  ))}
                </Row>
                {themes.map((s) => (
                  <Pressable
                    key={s.key}
                    onPress={() => setChosen(s.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`${s.name}: ${tp('themes.passages', s.passages.length)}, ${t('themes.sessionsWith', { list: s.pageIds.map((id) => numbers.get(id)).join(', ') })}`}
                    testID={`overview-row-${s.name}`}
                    style={(st) => [
                      { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, borderRadius: radius.sm },
                      (st as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
                      (st as { focused?: boolean }).focused && focusRing(c.focus),
                      web({ cursor: 'pointer' }),
                    ]}
                  >
                    <View style={{ width: NAME_WIDTH, paddingRight: space.sm }}>
                      <T variant="small" numberOfLines={1}>{s.name}</T>
                    </View>
                    <Cells pages={ordered} marked={new Set(s.pageIds)} />
                    <T variant="tiny" tone="muted" style={{ marginLeft: space.sm }}>{String(s.passages.length)}</T>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </ScrollView>

      <RenameDialog theme={renaming} onClose={() => setRenaming(null)} onRename={rename} />
      <ConfirmDialog
        visible={!!removing}
        title={t('themes.removeTitle')}
        message={removing ? tp('themes.removeBody', removing.passages.length, { name: removing.name }) : ''}
        confirmLabel={t('themes.remove')}
        confirmIcon="trash"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={() => (removing ? remove(removing) : undefined)}
        testID="remove-theme-dialog"
      />
    </View>
  );
}

/** "first Mon 3 Aug · last Mon 21 Sept", or the one date when the theme came up in one session. */
function spanOf(s: ThemeSummary, ordered: Page[], date: (p: Page) => string, t: ReturnType<typeof useI18n>['t']): string {
  const pages = ordered.filter((p) => s.pageIds.includes(p.id));
  const first = pages[0];
  const last = pages[pages.length - 1];
  if (!first || !last) return '';
  return first === last ? date(first) : t('themes.span', { first: date(first), last: date(last) });
}

function groupByPage(s: ThemeSummary): { page: Page; passages: ThemeSummary['passages'][number]['passage'][] }[] {
  const out: { page: Page; passages: ThemeSummary['passages'][number]['passage'][] }[] = [];
  for (const { page, passage } of s.passages) {
    const last = out[out.length - 1];
    if (last && last.page.id === page.id) last.passages.push(passage);
    else out.push({ page, passages: [passage] });
  }
  return out;
}

/** One square per session, filled where the theme comes up: drawn only, the label says it. */
function Cells({ pages, marked, wrap }: { pages: Page[]; marked: Set<string>; /** Onto more lines when there are many sessions (never in the overview, whose columns line up). */ wrap?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[{ flexDirection: 'row' }, wrap && { flexWrap: 'wrap', flexShrink: 1, rowGap: CELL_GAP }]} aria-hidden>
      {pages.map((p) => {
        const on = marked.has(p.id);
        return (
          <View
            key={p.id}
            style={{ width: CELL, height: CELL, marginRight: CELL_GAP, borderRadius: 2, borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent' }}
          />
        );
      })}
    </View>
  );
}

function SessionStrip({ pages, marked, label }: { pages: Page[]; marked: Set<string>; label: string }) {
  return (
    <View accessibilityRole="image" accessibilityLabel={label} testID="theme-strip" style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <T variant="tiny" tone="muted">1</T>
      <Cells pages={pages} marked={marked} wrap />
      <T variant="tiny" tone="muted">{String(pages.length)}</T>
    </View>
  );
}

function ListRow({ label, detail, active, onPress, testID }: { label: string; detail: string; active: boolean; onPress: () => void; testID?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${detail}`}
      aria-current={active ? 'true' : undefined}
      accessibilityState={{ selected: active }} // phones; the web reads aria-current
      testID={testID}
      style={(s) => [
        { paddingHorizontal: space.md, paddingVertical: space.sm, borderLeftWidth: 3, borderLeftColor: active ? c.accent : 'transparent', gap: 2 },
        { backgroundColor: active ? c.primarySubtle : (s as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent' },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <T variant="label" numberOfLines={1}>{label}</T>
      <T variant="tiny" tone="muted" numberOfLines={1}>{detail}</T>
    </Pressable>
  );
}

function RenameDialog({ theme, onClose, onRename }: { theme: ThemeSummary | null; onClose: () => void; onRename: (s: ThemeSummary, to: string) => Promise<void> }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (theme) setName(theme.name);
  }, [theme]);
  const clean = cleanTheme(name);
  const tooLong = clean.length > THEME_MAX;
  const ok = !!theme && !!clean && !tooLong && clean !== theme.name;
  async function save() {
    if (!ok || busy || !theme) return;
    setBusy(true);
    try {
      await onRename(theme, clean);
      onClose();
    } catch {
      toast.show({ message: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      visible={!!theme}
      title={t('themes.renameTitle')}
      onClose={onClose}
      onSubmit={ok ? () => void save() : undefined}
      width={440}
      testID="rename-theme-dialog"
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button variant="primary" label={t('common.save')} disabled={!ok} busy={busy} onPress={() => void save()} testID="rename-theme-save" />
        </>
      }
    >
      <Field
        label={t('themes.name')}
        value={name}
        onChangeText={setName}
        onSubmitEditing={() => void save()}
        autoFocus
        hint={t('themes.renameHint')}
        error={tooLong ? t('themes.nameTooLong', { n: THEME_MAX }) : null}
        testID="rename-theme-name"
      />
    </Dialog>
  );
}
