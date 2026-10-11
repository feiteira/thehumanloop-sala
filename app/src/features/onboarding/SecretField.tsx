import React from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useI18n } from '../../ui/i18n';
import { Icon } from '../../ui/Icon';
import { Field, type FieldProps, focusRing, Row, T, web } from '../../ui/primitives';
import { radius, space, useTheme } from '../../ui/theme';

/** "Show" / "Hide" beside a passphrase field's label: typing a long passphrase blind is error-prone. */
export function ShowSecret({ shown, onToggle, testID }: { shown: boolean; onToggle: () => void; testID?: string }) {
  const { t } = useI18n();
  const { c } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={shown ? t('unlock.hidePassphrase') : t('unlock.showPassphrase')}
      testID={testID}
      style={(s) => [
        { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xs, borderRadius: radius.sm },
        (s as { hovered?: boolean }).hovered && { backgroundColor: c.surfaceAlt },
        (s as { focused?: boolean }).focused && focusRing(c.focus),
        web({ cursor: 'pointer' }),
      ]}
    >
      <Icon name={shown ? 'eyeOff' : 'eye'} size={16} color={c.textSecondary} />
      <T variant="small" tone="secondary">{shown ? t('common.hide') : t('common.show')}</T>
    </Pressable>
  );
}

/** A passphrase field whose text can be shown while typing. */
export function SecretField({
  label, shown, onToggle, style, toggleTestID, ...rest
}: Omit<FieldProps, 'label' | 'secureTextEntry' | 'style'> & { label: string; shown: boolean; onToggle: () => void; style?: StyleProp<ViewStyle>; toggleTestID?: string }) {
  return (
    <View style={style}>
      <Row style={{ justifyContent: 'space-between', marginBottom: space.xs }}>
        <T variant="label" tone="secondary">{label}</T>
        <ShowSecret shown={shown} onToggle={onToggle} testID={toggleTestID} />
      </Row>
      <Field {...rest} accessibilityLabel={label} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} />
    </View>
  );
}
