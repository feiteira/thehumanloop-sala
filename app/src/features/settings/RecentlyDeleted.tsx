import React, { useState } from 'react';
import { View } from 'react-native';
import { DateTime, Info } from 'luxon';
import type { Entity } from '../../core/model/types';
import { groupCounts, listTrash, purgeGroup, restoreGroup, TRASH_KINDS, type TrashGroup, type TrashItem, type TrashKind } from '../../services/trash';
import { usePractice } from '../../shell/AppState';
import { useLive } from '../../shell/useLive';
import { type I18n, useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { Button, Card, Col, ConfirmDialog, Divider, Row, T } from '../../ui/primitives';
import { useToast } from '../../ui/Toast';
import { restoreMessage } from './trashText';
import { space, useTheme } from '../../ui/theme';

const ICONS: Record<TrashKind, IconName> = {
  folder: 'folder',
  page: 'page',
  sticky: 'sticky',
  attachment: 'paperclip',
  appointment: 'calendar',
  appointment_type: 'calendar',
  availability: 'clock',
  availability_exception: 'clock',
};

const PAGE_SIZE = 8;

const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** "Folder Inês S.", "Page of 21 Sep 2026 · Inês S.", "Sticky note “Ask about…”". */
export function trashItemTitle(item: TrashItem, folders: Map<string, string>, i18n: I18n): string {
  const { t } = i18n;
  const day = (iso: string) => i18n.date(DateTime.fromISO(iso));
  switch (item.kind) {
    case 'folder':
      return t('trash.item.folder', { name: (item.record as Entity<'folder'>).label });
    case 'page': {
      const p = item.record as Entity<'page'>;
      const folder = folders.get(p.folder_id);
      return folder ? t('trash.item.pageIn', { date: day(p.date), folder }) : t('trash.item.page', { date: day(p.date) });
    }
    case 'sticky':
      return t('trash.item.sticky', { text: short((item.record as Entity<'sticky'>).text, 40) });
    case 'attachment':
      return t('trash.item.attachment', { name: short((item.record as Entity<'attachment'>).filename) });
    case 'appointment': {
      const a = item.record as Entity<'appointment'>;
      const start = DateTime.fromISO(a.start_local);
      const date = `${i18n.date(start)} ${i18n.time(start)}`;
      const name = (a.folder_id ? folders.get(a.folder_id) : a.title) ?? '';
      return name ? t('trash.item.appointment', { date, name }) : t('trash.item.appointmentPlain', { date });
    }
    case 'appointment_type':
      return t('trash.item.appointment_type', { name: (item.record as Entity<'appointment_type'>).name });
    case 'availability': {
      const a = item.record as Entity<'availability'>;
      const weekday = Info.weekdays('long', { locale: i18n.meta.bcp47 })[a.weekday - 1] ?? '';
      return t('trash.item.availability', { day: weekday, from: a.start, to: a.end });
    }
    case 'availability_exception': {
      const x = item.record as Entity<'availability_exception'>;
      return t(x.kind === 'off' ? 'trash.item.dayOff' : 'trash.item.extraHours', { date: day(x.date) });
    }
  }
}

/** "with 14 pages, 3 sticky notes, 2 documents · 2 days ago" */
function groupDetail(group: TrashGroup, i18n: I18n): string {
  const counts = groupCounts(group);
  const parts = TRASH_KINDS.filter((k) => counts[k]).map((k) => i18n.tp(`settings.counts.${k}`, counts[k]!));
  const ago = i18n.relative(DateTime.fromMillis(group.deletedAt).toISO());
  const when = ago.charAt(0).toLocaleUpperCase(i18n.meta.bcp47) + ago.slice(1);
  return parts.length ? `${when} · ${i18n.t('trash.with', { items: parts.join(', ') })}` : when;
}

/** Settings → Your data → Recently deleted: restore, or erase for good, what was deleted. */
export function RecentlyDeleted() {
  const practice = usePractice();
  const i18n = useI18n();
  const { t } = i18n;
  const { c } = useTheme();
  const toast = useToast();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [confirm, setConfirm] = useState<{ group: TrashGroup; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useLive(
    async (store) => {
      const [groups, folders] = await Promise.all([listTrash(store), store.list('folder', { includeDeleted: true })]);
      return { groups, folders: new Map(folders.map((f) => [f.id, f.label])) };
    },
    [],
    [...TRASH_KINDS],
  );

  async function restore(group: TrashGroup, title: string) {
    setBusy(group.key);
    try {
      toast.show({ message: restoreMessage(await restoreGroup(practice, group), title, i18n) });
    } catch (e) {
      console.error(e);
      toast.show({ message: t('errors.generic') });
    } finally {
      setBusy(null);
    }
  }

  const groups = data?.groups ?? [];
  return (
    <Card style={{ gap: space.md }}>
      <View testID="recently-deleted" style={{ gap: space.xs }}>
        <T variant="heading" role="heading">{t('trash.title')}</T>
        <T tone="secondary">{t('trash.body')}</T>
      </View>
      {data && groups.length === 0 ? <T tone="muted">{t('trash.empty')}</T> : null}
      {groups.length ? (
        <View role="list" accessibilityLabel={t('trash.title')}>
          {groups.slice(0, limit).map((g, i) => {
            const title = trashItemTitle(g.lead, data!.folders, i18n);
            return (
              <View key={g.key} role="listitem" testID="trash-item">
                {i > 0 ? <Divider /> : null}
                <Row style={{ paddingVertical: space.sm }} gap={space.md}>
                  <Icon name={ICONS[g.lead.kind]} size={18} color={c.textSecondary} />
                  <Col gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <T numberOfLines={2}>{title}</T>
                    <T variant="small" tone="muted">{groupDetail(g, i18n)}</T>
                  </Col>
                  <Button
                    small
                    icon="restore"
                    label={t('trash.restore')}
                    accessibilityLabel={t('trash.restoreLabel', { item: title })}
                    busy={busy === g.key}
                    disabled={!!busy}
                    onPress={() => void restore(g, title)}
                    testID="trash-restore"
                  />
                  <Button
                    small
                    variant="ghost"
                    icon="trash"
                    label={t('trash.deleteNow')}
                    accessibilityLabel={t('trash.deleteNowLabel', { item: title })}
                    disabled={!!busy}
                    onPress={() => setConfirm({ group: g, title })}
                    testID="trash-delete"
                  />
                </Row>
              </View>
            );
          })}
        </View>
      ) : null}
      {groups.length > limit ? (
        <Button small variant="ghost" label={t('trash.more')} onPress={() => setLimit((n) => n + PAGE_SIZE)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      <ConfirmDialog
        visible={!!confirm}
        title={t('trash.confirmTitle')}

        confirmLabel={t('trash.confirmButton')}
        confirmIcon="trash"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          await purgeGroup(practice, confirm.group);
          toast.show({ message: t('trash.erased', { item: confirm.title }) });
        }}
        testID="trash-confirm"
      >
        <T style={{ fontWeight: '600' }}>{confirm?.title ?? ''}</T>
        <T>{t('trash.confirmBody')}</T>
        <T variant="small" tone="secondary">{t('trash.confirmBackups')}</T>
      </ConfirmDialog>
    </Card>
  );
}
