import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../../ui/i18n';
import { Button, Row } from '../../ui/primitives';
import { space, useTheme } from '../../ui/theme';
import { Help } from '../help/Help';

/** The manual, before a practice is open (welcome, restore, unlock). Back returns to where the therapist was. */
export function OnboardingHelp({ topic, onClose }: { topic: string; onClose: () => void }) {
  const { t } = useI18n();
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Row style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <Button variant="ghost" small icon="chevronLeft" label={t('common.back')} onPress={onClose} testID="onboarding-help-back" />
      </Row>
      <Help topic={topic} />
    </View>
  );
}
