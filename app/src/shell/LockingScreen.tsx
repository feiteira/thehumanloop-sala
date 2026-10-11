import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import { useI18n } from '../ui/i18n';
import { T, web } from '../ui/primitives';
import { space, useTheme } from '../ui/theme';
import { useAppState } from './AppState';

/**
 * Covers the open practice while it locks: savers still run underneath (the screens stay
 * mounted), but nothing more can be read or typed. A modal, so it also covers open dialogs.
 */
export function LockingScreen() {
  const { locking } = useAppState();
  if (!locking) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => undefined}>
      <Curtain />
    </Modal>
  );
}

function Curtain() {
  const { c } = useTheme();
  const { t } = useI18n();
  const ref = useRef<View>(null);
  // Take focus from any field, so keys pressed now cannot reach a page about to be saved.
  useEffect(() => ref.current?.focus(), []);
  return (
    <View
      ref={ref}
      focusable
      testID="locking"
      accessibilityLiveRegion="polite"
      aria-busy
      style={[{ flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', gap: space.md }, web({ outlineStyle: 'none' })]}
    >
      <ActivityIndicator color={c.textSecondary} />
      <T variant="heading">{t('shell.locking')}</T>
      <T tone="secondary">{t('shell.lockingBody')}</T>
    </View>
  );
}
