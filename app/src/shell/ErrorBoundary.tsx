import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { i18nStatic } from '../ui/i18n';
import { Button, T } from '../ui/primitives';

/**
 * Last-resort screen. Data is already saved on every change, so a restart loses nothing. It shows
 * what went wrong and where, as selectable text the therapist can copy into a report: the desktop
 * app has no developer console, so this is the only place the error can be seen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string }> {
  override state = { error: null as Error | null, where: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ where: (info.componentStack ?? '').trim() });
  }

  override render() {
    const { error, where } = this.state;
    if (!error) return this.props.children;
    const { t } = i18nStatic();
    const details = [
      `${error.name}: ${error.message}`,
      ...(error.stack ?? '').split('\n').slice(0, 8),
      '',
      ...where.split('\n').slice(0, 12).map((l) => l.trim()),
    ].join('\n');
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 }}>
        <T variant="title">{t('errors.crashTitle')}</T>
        <T tone="secondary">{t('errors.crashBody')}</T>
        <Button variant="primary" label={t('errors.restart')} onPress={() => window.location.reload()} />
        <T variant="label" tone="secondary" style={{ marginTop: 16 }}>{t('errors.crashDetails')}</T>
        <ScrollView style={{ maxHeight: 220, maxWidth: 760, alignSelf: 'stretch' }} testID="crash-details">
          <Text selectable style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.8 }}>{details}</Text>
        </ScrollView>
      </View>
    );
  }
}
