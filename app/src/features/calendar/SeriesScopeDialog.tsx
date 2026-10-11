import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { SeriesScope } from '../../core/calendar/series';
import { Icon } from '../../ui/Icon';
import { useI18n } from '../../ui/i18n';
import { Button, Col, Dialog, focusRing, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';

/**
 * Asks which dates of a repeating appointment a change or a delete applies to. Each choice
 * is one press: it acts at once. The first choice is the most cautious; for a change,
 * Ctrl+Enter takes it, while a delete is always pressed on purpose.
 */
export function SeriesScopeDialog({
  visible, mode, scopes, dateLabel, allFromHere, onChoose, onClose,
}: {
  visible: boolean;
  mode: 'save' | 'delete';
  scopes: SeriesScope[];
  /** The date the dialog was opened on, as the therapist reads it ("Thu 1 Oct"). */
  dateLabel: string;
  /** A change where Every date leaves the earlier dates as they were (a hand-over on the first date of a later part). */
  allFromHere?: boolean;
  onChoose: (scope: SeriesScope) => Promise<unknown>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<SeriesScope | null>(null);
  useEffect(() => {
    if (visible) setBusy(null);
  }, [visible]);

  const choose = async (scope: SeriesScope) => {
    if (busy) return;
    setBusy(scope);
    try {
      await onChoose(scope);
    } finally {
      setBusy(null);
    }
  };

  const text: Record<SeriesScope, { title: string; hint: string }> =
    mode === 'save'
      ? {
          one: { title: t('appointment.scopeOne'), hint: t('appointment.scopeOneHint', { date: dateLabel }) },
          following: { title: t('appointment.scopeFollowing'), hint: t('appointment.scopeFollowingHint', { date: dateLabel }) },
          all: { title: t('appointment.scopeAll'), hint: allFromHere ? t('appointment.scopeFollowingHint', { date: dateLabel }) : t('appointment.scopeAllHint') },
        }
      : {
          one: { title: t('appointment.scopeOne'), hint: t('appointment.scopeOneDeleteHint', { date: dateLabel }) },
          following: { title: t('appointment.scopeFollowing'), hint: t('appointment.scopeFollowingDeleteHint', { date: dateLabel }) },
          all: { title: t('appointment.scopeAllDelete'), hint: t('appointment.scopeAllDeleteHint') },
        };
  // The most cautious change is the main choice; a delete is only ever chosen by hand.
  const safeDefault = mode === 'save' ? scopes[0] : undefined;

  return (
    <Dialog
      visible={visible}
      title={mode === 'save' ? t('appointment.scopeTitle') : t('appointment.scopeDeleteTitle')}
      onClose={busy ? () => undefined : onClose}
      onSubmit={safeDefault && !busy ? () => void choose(safeDefault) : undefined}
      width={460}
      testID="series-scope"
      footer={<Button label={t('common.cancel')} onPress={onClose} disabled={!!busy} testID="series-scope-cancel" />}
    >
      <Col gap={space.sm}>
        {scopes.map((scope, i) => (
          <ScopeOption
            key={scope}
            title={text[scope].title}
            hint={text[scope].hint}
            main={i === 0 && (mode === 'save' || scope !== 'all')}
            danger={mode === 'delete' && scope === 'all'}
            busy={busy === scope}
            disabled={!!busy}
            onPress={() => void choose(scope)}
            testID={`scope-${scope}`}
          />
        ))}
      </Col>
    </Dialog>
  );
}

function ScopeOption({
  title, hint, main, danger, busy, disabled, onPress, testID,
}: {
  title: string;
  hint: string;
  main: boolean;
  danger: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { c } = useTheme();
  const fg = danger ? c.dangerText : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // No label of its own: the title and the line under it, read together, name the choice.
      aria-busy={busy}
      testID={testID}
      style={(s) => {
        const { hovered, focused, pressed } = s as { hovered?: boolean; focused?: boolean; pressed?: boolean };
        return [
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: main ? 2 : 1,
            borderColor: danger ? c.dangerBorder : main ? c.accent : c.border,
            backgroundColor: pressed ? c.primarySubtle : hovered ? (danger ? c.dangerBg : c.surfaceAlt) : c.surface,
            opacity: disabled && !busy ? 0.6 : 1,
          },
          focused && focusRing(c.focus),
          web({ cursor: disabled ? 'default' : 'pointer' }),
        ];
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="label" style={{ color: fg }}>{title}</T>
        <T variant="small" tone="secondary">{hint}</T>
      </View>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon name="chevronRight" size={18} color={danger ? c.dangerText : c.textSecondary} />}
    </Pressable>
  );
}
