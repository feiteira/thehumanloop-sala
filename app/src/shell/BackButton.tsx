import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../ui/i18n';
import { IconButton } from '../ui/primitives';
import { space } from '../ui/theme';
import { useRouter } from './router';

/** A back chevron for screens that draw their own title (Settings); nothing when there is no way back. */
export function BackButton() {
  const { canGoBack, back } = useRouter();
  const { t } = useI18n();
  if (!canGoBack) return null;
  return (
    <View style={{ marginLeft: -space.sm }}>
      <IconButton icon="chevronLeft" label={t('common.back')} onPress={back} testID="screen-back" />
    </View>
  );
}
