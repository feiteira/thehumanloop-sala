import React, { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { pageText } from '../../core/model/sections';
import { usePractice } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { Button, EmptyState, focusRing, T, web } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { space, useTheme } from '../../ui/theme';
import { useNow, usePracticeTz } from '../common/hooks';
import { sessionDate } from '../common/dates';
import { PageEditor } from './PageEditor';
import { createPageFor, sessionNumbers } from './pageActions';

/** The Pages divider: the folder's pages, newest first, and the one being read or written. */
export function PagesTab({ folderId, pageId, passage }: { folderId: string; pageId?: string; /** A marked passage of `pageId` to select. */ passage?: string }) {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const toast = useToast();
  const todayIso = useNow(usePracticeTz()).toISODate()!;
  // Moving between pages replaces the route, so Back leaves the folder instead of
  // stepping through every page that was opened.
  const { replace } = useRouter();
  const { data: pages } = useLive(
    (store) => store.list('page', { where: 'folder_id = ?', params: [folderId], order: 'date DESC, created_at DESC' }),
    [folderId],
    ['page'],
  );
  const numbers = sessionNumbers(pages ?? []);

  // The page asked for; else the one already open (re-dating it re-sorts the list, and must
  // not open another session under the therapist's hands, nor while a new page is on its
  // way); else the newest, also when the page asked for is gone.
  const shown = useRef<string | undefined>(undefined);
  const selected = pages?.find((p) => p.id === pageId) ?? pages?.find((p) => p.id === shown.current) ?? pages?.[0];
  const selectedId = selected?.id;
  useEffect(() => {
    shown.current = selectedId;
  }, [selectedId]);

  async function newPage() {
    try {
      const p = await createPageFor(practice.store, folderId);
      replace({ name: 'folder', id: folderId, tab: 'pages', pageId: p.id });
    } catch {
      toast.show({ message: t('errors.generic') });
    }
  }

  if (pages && pages.length === 0) {
    return <EmptyState icon="page" title={t('folder.noPages')} body={t('folder.noPagesBody')} action={<Button variant="primary" icon="plus" label={t('folder.newPage')} onPress={() => void newPage()} testID="new-page" />} />;
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ width: 250, borderRightWidth: 1, borderRightColor: c.border }}>
        <View style={{ padding: space.md }}>
          <Button icon="plus" label={t('folder.newPage')} onPress={() => void newPage()} testID="new-page" />
        </View>
        <ScrollView>
          {pages?.map((p) => {
            const active = p.id === selectedId;
            const preview = pageText(p);
            const when = `${t('page.session', { n: numbers.get(p.id) ?? 0 })} · ${sessionDate(i18n, p.date, todayIso)}`;
            const template = p.template !== 'free' ? (p.template === 'intake' ? t('page.templates.intake') : p.template.toUpperCase()) : '';
            return (
              <Pressable
                key={p.id}
                onPress={() => replace({ name: 'folder', id: folderId, tab: 'pages', pageId: p.id })}
                accessibilityRole="button"
                accessibilityLabel={[when, template, p.title].filter(Boolean).join(', ')}
                aria-current={active ? 'true' : undefined}
                accessibilityState={{ selected: active }} // phones; the web reads aria-current
                testID="page-row"
                style={(s) => [
                  { paddingHorizontal: space.md, paddingVertical: space.sm, borderLeftWidth: 3, borderLeftColor: active ? c.accent : 'transparent', gap: 2 },
                  { backgroundColor: active ? c.primarySubtle : (s as { hovered?: boolean }).hovered ? c.surfaceAlt : 'transparent' },
                  (s as { focused?: boolean }).focused && focusRing(c.focus),
                  web({ cursor: 'pointer' }),
                ]}
              >
                <T variant="label" numberOfLines={1}>{when}</T>
                {template || p.title ? <T variant="tiny" tone="secondary" numberOfLines={1}>{[template, p.title].filter(Boolean).join(' · ')}</T> : null}
                {preview ? <T variant="tiny" tone="muted" numberOfLines={2}>{preview}</T> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xxl, maxWidth: 900 }}>
        {selected ? (
          <PageEditor
            key={selected.id}
            page={selected}
            focusPassage={selected.id === pageId ? passage : undefined}
            onDeleted={() => replace({ name: 'folder', id: folderId, tab: 'pages' })}
          />
        ) : (
          <T tone="secondary">{t('page.selectPage')}</T>
        )}
      </ScrollView>
    </View>
  );
}
