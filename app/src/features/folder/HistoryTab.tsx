import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLive } from '../../shell/useLive';
import { useI18n } from '../../ui/i18n';
import { EmptyState } from '../../ui/primitives';
import { space } from '../../ui/theme';
import { usePracticeTz } from '../common/hooks';
import { StickyCard, usePeel } from '../common/Sticky';
import { instantDate } from './format';

/** The History divider: sticky notes peeled off the folder, newest first. */
export function HistoryTab({ folderId }: { folderId: string }) {
  const peel = usePeel();
  const i18n = useI18n();
  const { t } = i18n;
  const tz = usePracticeTz();
  const { data } = useLive((store) => store.list('sticky', { where: "folder_id = ? AND state = 'peeled'", params: [folderId], order: 'hlc DESC' }), [folderId], ['sticky']);
  if (data && data.length === 0) return <EmptyState icon="history" title={t('folder.historyEmpty')} />;
  return (
    <ScrollView contentContainerStyle={{ padding: space.xxl }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {data?.map((s) => (
          <StickyCard key={s.id} sticky={s} caption={t('folder.peeledOn', { date: instantDate(i18n, s.peeled_at, tz) })} onPeel={() => void peel(s)} />
        ))}
      </View>
    </ScrollView>
  );
}
