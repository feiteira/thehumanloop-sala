import React, { useState } from 'react';
import { View } from 'react-native';
import { Field, T } from '../../ui/primitives';
import { useI18n } from '../../ui/i18n';
import { radius, useTheme } from '../../ui/theme';
import { MIN_PASSPHRASE, strength } from './passphrase';
import { SecretField } from './SecretField';

export function passphraseError(p: string, confirm: string, t: (k: 'onboarding.passTooShort' | 'onboarding.passMismatch') => string): string | null {
  if (p.length < MIN_PASSPHRASE) return t('onboarding.passTooShort');
  if (p !== confirm) return t('onboarding.passMismatch');
  return null;
}

/**
 * A new passphrase, typed twice, with a strength meter and Show/Hide for both fields. Takes the
 * focus only when asked (`autoFocus`): below another field, such as the recovery phrase, it
 * must not pull the cursor away from it.
 */
export function PassphraseFields({
  value, confirm, onChange, onConfirm, label, showErrors, onSubmit, autoFocus = false,
}: {
  value: string;
  confirm: string;
  onChange: (v: string) => void;
  onConfirm: (v: string) => void;
  label?: string;
  showErrors: boolean;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const { c } = useTheme();
  const [shown, setShown] = useState(false);
  const s = strength(value);
  const colors = [c.dangerText, c.warningText, c.infoText, c.successText];
  const names = [t('onboarding.strength.weak'), t('onboarding.strength.fair'), t('onboarding.strength.good'), t('onboarding.strength.strong')];
  return (
    <View style={{ gap: 12 }}>
      <SecretField
        label={label ?? t('onboarding.passLabel')}
        value={value}
        onChangeText={onChange}
        shown={shown}
        onToggle={() => setShown(!shown)}
        autoFocus={autoFocus}
        testID="passphrase"
        toggleTestID="passphrase-show"
        error={showErrors && value.length < MIN_PASSPHRASE ? t('onboarding.passTooShort') : null}
      />
      {value.length > 0 ? (
        <View accessibilityLabel={names[s]} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: i <= s ? colors[s] : c.divider }} />
          ))}
          <T variant="tiny" style={{ color: colors[s], minWidth: 56, textAlign: 'right' }}>{names[s]}</T>
        </View>
      ) : null}
      <Field
        label={t('onboarding.passConfirm')}
        value={confirm}
        onChangeText={onConfirm}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        testID="passphrase-confirm"
        onSubmitEditing={onSubmit}
        error={showErrors && confirm !== value ? t('onboarding.passMismatch') : null}
      />
    </View>
  );
}
